/**
 * ECOS — Pipeline Store (module-level singleton)
 *
 * Manages the volume generation pipeline OUTSIDE React component lifecycle.
 * This ensures that:
 *   - If the user navigates away during generation, the Worker keeps running
 *   - When generation completes, results are saved to IndexedDB (navigation safety)
 *   - "Poster" publishes to the repo via Vite dev server API (persistent + shared)
 *   - When ScanPage remounts, it can restore in-progress or completed state
 */

import type {
  PreprocessingSettings,
  BeamSettings,
  VolumeGridSettings,
  PipelineV2Progress,
  GpxTrack,
  CropRect,
  SessionManifestEntry,
} from '@echos/core';
import { serializeVolume } from '@echos/core';
import { saveSession, saveVolume, findDuplicate } from './session-db.js';

// ─── Build spatial (stacked-frame) volume for Mode B + orthogonal slices ────

function buildSpatialVolumeFromFrames(
  frameList: Array<{ intensity: Float32Array; width: number; height: number }>,
): { data: Float32Array; dimensions: [number, number, number]; extent: [number, number, number] } | null {
  if (!frameList || frameList.length === 0) return null;
  const dimX = frameList[0].width;
  const dimY = frameList.length;
  const dimZ = frameList[0].height;
  if (dimX === 0 || dimZ === 0) return null;
  const data = new Float32Array(dimX * dimY * dimZ);
  const strideZ = dimY * dimX;
  for (let yi = 0; yi < dimY; yi++) {
    const intensity = frameList[yi].intensity;
    const yiOffset = yi * dimX;
    for (let zi = 0; zi < dimZ; zi++) {
      const srcOffset = zi * dimX;
      const dstOffset = zi * strideZ + yiOffset;
      data.set(intensity.subarray(srcOffset, srcOffset + dimX), dstOffset);
    }
  }
  const aspect = dimX / dimZ;
  return { data, dimensions: [dimX, dimY, dimZ], extent: [aspect, 0.5, 1] };
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PipelineResult {
  sessionId: string;
  volumeData: Float32Array;
  volumeDims: [number, number, number];
  volumeExtent: [number, number, number];
  instrumentFrames: Array<{
    index: number;
    timeS: number;
    intensity: Float32Array;
    width: number;
    height: number;
  }>;
  // Session metadata
  videoFileName: string;
  gpxFileName: string;
  gpxText: string;
  gpxPoints: Array<{ lat: number; lon: number }>;
  bounds: [number, number, number, number];
  totalDistanceM: number;
  durationS: number;
  preprocessing: PreprocessingSettings;
  beam: BeamSettings;
  grid: VolumeGridSettings;
}

export type PipelineStatus = 'idle' | 'extracting' | 'projecting' | 'saving' | 'ready' | 'error';

export interface PipelineState {
  status: PipelineStatus;
  progress: PipelineV2Progress | null;
  result: PipelineResult | null;
  error: string | null;
  /** Whether the session has been published to the repo (via Vite dev API). */
  published: boolean;
  /** Whether saving to IDB completed (for navigation safety). */
  savedToIDB: boolean;
}

type Listener = (state: PipelineState) => void;

// ─── Module-level singleton state ────────────────────────────────────────────

let worker: Worker | null = null;
let aborted = false;

const state: PipelineState = {
  status: 'idle',
  progress: null,
  result: null,
  error: null,
  published: false,
  savedToIDB: false,
};

const listeners = new Set<Listener>();

function notify() {
  for (const fn of listeners) fn({ ...state });
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function getState(): PipelineState {
  return { ...state };
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function abort() {
  aborted = true;
  if (worker) {
    worker.terminate();
    worker = null;
  }
  state.status = 'idle';
  state.progress = null;
  state.error = null;
  notify();
}

export function reset() {
  abort();
  state.result = null;
  state.published = false;
  state.savedToIDB = false;
  notify();
}

/**
 * Publish session to the repo via the Vite dev server API.
 * Writes .echos-vol + GPX + updates manifest.json in public/sessions/.
 */
export async function publishToRepo(): Promise<void> {
  const r = state.result;
  if (!r) throw new Error('No pipeline result to publish');

  // Build spatial volume from frames
  const spatialVol = buildSpatialVolumeFromFrames(r.instrumentFrames);

  const manifest: SessionManifestEntry = {
    id: r.sessionId,
    name: r.videoFileName.replace(/\.\w+$/, ''),
    createdAt: new Date().toISOString(),
    videoFileName: r.videoFileName,
    gpxFileName: r.gpxFileName,
    bounds: r.bounds,
    totalDistanceM: r.totalDistanceM,
    durationS: r.durationS,
    frameCount: r.instrumentFrames.length,
    gridDimensions: r.volumeDims,
    preprocessing: r.preprocessing,
    beam: r.beam,
    files: {
      gpx: r.gpxFileName || undefined,
      volumeInstrument: 'volume-instrument.echos-vol',
      ...(spatialVol ? { volumeSpatial: 'volume-spatial.echos-vol' } : {}),
    },
  };

  // Serialize volumes to binary
  const volumeBuffer = serializeVolume({
    data: r.volumeData,
    dimensions: r.volumeDims,
    extent: r.volumeExtent,
  });

  const spatialBuffer = spatialVol
    ? serializeVolume({ data: spatialVol.data, dimensions: spatialVol.dimensions, extent: spatialVol.extent })
    : null;

  // Build wire protocol: [headerLen:u32] [headerJSON] [instrumentBytes] [spatialBytes?]
  const header = JSON.stringify({
    manifest,
    volumeSize: volumeBuffer.byteLength,
    spatialVolumeSize: spatialBuffer ? spatialBuffer.byteLength : 0,
    gpxText: r.gpxText || null,
  });
  const headerBytes = new TextEncoder().encode(header);
  const totalSize = 4 + headerBytes.length + volumeBuffer.byteLength + (spatialBuffer ? spatialBuffer.byteLength : 0);
  const payload = new Uint8Array(totalSize);
  new DataView(payload.buffer).setUint32(0, headerBytes.length, true);
  payload.set(headerBytes, 4);
  payload.set(new Uint8Array(volumeBuffer), 4 + headerBytes.length);
  if (spatialBuffer) {
    payload.set(new Uint8Array(spatialBuffer), 4 + headerBytes.length + volumeBuffer.byteLength);
  }

  const resp = await fetch('/api/publish-session', {
    method: 'POST',
    body: payload,
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(err.error || `HTTP ${resp.status}`);
  }

  state.published = true;
  notify();
}

/**
 * Starts the pipeline. Runs frame extraction and Worker-based projection.
 * Survives component unmounts — the Worker and extraction continue.
 * On completion, auto-saves to IndexedDB for navigation safety.
 */
export async function runPipeline(opts: {
  videoFile: File;
  videoUrl: string | null;
  gpxTrack: GpxTrack | null;
  gpxFile: File | null;
  videoDurationS: number;
  crop: CropRect;
  preprocessing: PreprocessingSettings;
  beam: BeamSettings;
  grid: VolumeGridSettings;
  fpsExtraction: number;
  progressMessage: (key: string) => string;
}): Promise<void> {
  const {
    videoFile, videoUrl, gpxTrack, gpxFile, videoDurationS,
    crop, preprocessing, beam, grid, fpsExtraction,
    progressMessage,
  } = opts;

  aborted = false;
  state.status = 'extracting';
  state.progress = null;
  state.result = null;
  state.error = null;
  state.published = false;
  state.savedToIDB = false;
  notify();

  // Read GPX text for later repo publishing
  let gpxText = '';
  if (gpxFile && gpxFile.size > 0) {
    try { gpxText = await gpxFile.text(); } catch { /* empty */ }
  }

  // Create video element (module-level, not tied to React)
  const video = document.createElement('video');
  video.preload = 'auto';
  video.crossOrigin = 'anonymous';
  const blobUrl = videoUrl ?? URL.createObjectURL(videoFile);
  video.src = blobUrl;
  await new Promise<void>((r) => { video.oncanplaythrough = () => r(); });

  const totalFrames = Math.floor(videoDurationS * fpsExtraction);

  const EXTRACT_WEIGHT = 0.7;
  const PROJECT_WEIGHT = 0.3;

  state.progress = {
    stage: 'preprocessing',
    progress: 0,
    message: progressMessage('extracting'),
    currentFrame: 0,
    totalFrames,
  };
  notify();

  // Create Worker
  const w = new Worker(
    new URL('../workers/pipeline-worker.ts', import.meta.url),
    { type: 'module' },
  );
  worker = w;

  w.postMessage({
    type: 'init',
    preprocessing,
    beam,
    grid,
  });

  let extractionDone = false;

  const resultPromise = new Promise<{
    normalizedData: Float32Array;
    dims: [number, number, number];
    extent: [number, number, number];
    frames: Array<{ index: number; timeS: number; intensity: Float32Array; width: number; height: number }>;
  }>((resolve, reject) => {
    w.onmessage = (e: MessageEvent) => {
      const msg = e.data;
      if (msg.type === 'preprocessed') {
        if (extractionDone) {
          const p = EXTRACT_WEIGHT + (msg.count / totalFrames) * PROJECT_WEIGHT * 0.5;
          state.progress = { stage: 'preprocessing', progress: Math.min(p, 0.95), message: progressMessage('extracting'), currentFrame: msg.count, totalFrames };
          notify();
        }
      } else if (msg.type === 'stage' && msg.stage === 'projecting') {
        state.status = 'projecting';
        state.progress = { stage: 'projecting', progress: EXTRACT_WEIGHT + PROJECT_WEIGHT * 0.5, message: progressMessage('projecting') };
        notify();
      } else if (msg.type === 'projection-progress') {
        const p = EXTRACT_WEIGHT + PROJECT_WEIGHT * 0.5 + (msg.current / msg.total) * PROJECT_WEIGHT * 0.5;
        state.progress = { stage: 'projecting', progress: Math.min(p, 0.98), message: progressMessage('projecting'), currentFrame: msg.current, totalFrames: msg.total };
        notify();
      } else if (msg.type === 'complete') {
        resolve({ normalizedData: msg.normalizedData, dims: msg.dims, extent: msg.extent, frames: msg.frames });
      } else if (msg.type === 'error') {
        reject(new Error(msg.message));
      }
    };
    w.onerror = (err) => reject(new Error(err.message));
  });

  // Parallel frame extraction
  const PARALLEL = Math.min(6, Math.max(2, navigator.hardwareConcurrency || 4));
  const chunkSize = Math.ceil(totalFrames / PARALLEL);
  let extractedCount = 0;

  const extractChunk = async (videoEl: HTMLVideoElement, startIdx: number, endIdx: number) => {
    for (let i = startIdx; i < endIdx; i++) {
      if (aborted) break;
      const timeS = i / fpsExtraction;
      videoEl.currentTime = timeS;
      await new Promise<void>((r) => { videoEl.onseeked = () => r(); });
      const bitmap = await createImageBitmap(
        videoEl, crop.x, crop.y, crop.width, crop.height,
      );
      w.postMessage({ type: 'frame', index: i, timeS, bitmap }, [bitmap]);
      extractedCount++;
      if (extractedCount % 5 === 0 || extractedCount === totalFrames) {
        const p = (extractedCount / totalFrames) * EXTRACT_WEIGHT;
        state.progress = { stage: 'preprocessing', progress: p, message: progressMessage('extracting'), currentFrame: extractedCount, totalFrames };
        notify();
      }
    }
  };

  const videos: HTMLVideoElement[] = [video];
  for (let p = 1; p < PARALLEL; p++) {
    const v = document.createElement('video');
    v.preload = 'auto';
    v.src = blobUrl;
    videos.push(v);
  }
  await Promise.all(
    videos.slice(1).map((v) => new Promise<void>((r) => {
      if (v.readyState >= 4) { r(); return; }
      v.oncanplaythrough = () => r();
    })),
  );

  try {
    const chunkPromises = videos.map((v, p) => {
      const start = p * chunkSize;
      const end = Math.min(start + chunkSize, totalFrames);
      return extractChunk(v, start, end);
    });
    await Promise.all(chunkPromises);
  } finally {
    if (!videoUrl) URL.revokeObjectURL(blobUrl);
  }

  extractionDone = true;

  if (aborted) {
    w.terminate();
    worker = null;
    return;
  }

  w.postMessage({ type: 'done' });

  const result = await resultPromise;
  w.terminate();
  worker = null;

  if (aborted) return;

  const { normalizedData, dims, extent, frames: preprocessedFrames } = result;

  // Build session metadata
  const sessionId = crypto.randomUUID();
  const gpxPoints = gpxTrack ? gpxTrack.points.map((pt: { lat: number; lon: number }) => ({ lat: pt.lat, lon: pt.lon })) : [];
  const bounds: [number, number, number, number] = gpxPoints.length > 0
    ? [
        Math.min(...gpxPoints.map((pt: { lat: number }) => pt.lat)),
        Math.min(...gpxPoints.map((pt: { lon: number }) => pt.lon)),
        Math.max(...gpxPoints.map((pt: { lat: number }) => pt.lat)),
        Math.max(...gpxPoints.map((pt: { lon: number }) => pt.lon)),
      ]
    : [0, 0, 0, 0];

  const pipelineResult: PipelineResult = {
    sessionId,
    volumeData: normalizedData,
    volumeDims: dims,
    volumeExtent: extent,
    instrumentFrames: preprocessedFrames,
    videoFileName: videoFile.name,
    gpxFileName: gpxFile?.name ?? '',
    gpxText,
    gpxPoints,
    bounds,
    totalDistanceM: gpxTrack?.totalDistanceM ?? 0,
    durationS: gpxTrack?.durationS ?? videoDurationS,
    preprocessing,
    beam,
    grid,
  };

  // Show ready state
  state.progress = { stage: 'ready', progress: 1, message: progressMessage('ready') };
  state.result = pipelineResult;
  state.status = 'ready';
  notify();

  // Auto-save to IndexedDB for navigation safety (local only, not shared)
  try {
    const duplicate = await findDuplicate(pipelineResult.videoFileName, pipelineResult.gpxFileName);
    if (!duplicate) {
      const manifest: SessionManifestEntry = {
        id: sessionId,
        name: videoFile.name.replace(/\.\w+$/, ''),
        createdAt: new Date().toISOString(),
        videoFileName: pipelineResult.videoFileName,
        gpxFileName: pipelineResult.gpxFileName,
        bounds,
        totalDistanceM: pipelineResult.totalDistanceM,
        durationS: pipelineResult.durationS,
        frameCount: preprocessedFrames.length,
        gridDimensions: dims,
        preprocessing,
        beam,
        files: {
          gpx: pipelineResult.gpxFileName,
          volumeInstrument: 'volume-instrument.echos-vol',
        },
      };

      await saveVolume(sessionId, 'instrument', {
        data: normalizedData,
        dimensions: dims,
        extent,
      });

      // Build and save spatial volume (stacked frames) for Mode B + slices
      const spatialVol = buildSpatialVolumeFromFrames(preprocessedFrames);
      if (spatialVol) {
        await saveVolume(sessionId, 'spatial', {
          data: spatialVol.data,
          dimensions: spatialVol.dimensions,
          extent: spatialVol.extent,
        });
        manifest.files.volumeSpatial = 'volume-spatial.echos-vol';
      }

      await saveSession({
        id: sessionId,
        manifest,
        gpxTrack: gpxPoints,
      });
    }
    state.savedToIDB = true;
    notify();
  } catch {
    // IDB save failed — user can still view and publish to repo
  }
}

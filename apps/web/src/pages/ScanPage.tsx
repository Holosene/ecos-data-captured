/**
 * ECOS — Scan Page (V2 only)
 *
 * Workflow:
 *   1. Importer — MP4 + GPX
 *   2. Recadrer — visual drag crop tool
 *   3. Configurer — mode, depth, sync, generate (processing happens here)
 *   4. Visualiser — 3D volumetric viewer (step bar slides away)
 */

import React, { useCallback, useRef, useState, useEffect, useMemo } from 'react';
import { GlassPanel, Button, FileDropZone, ProgressBar, Slider, StepIndicator, colors } from '@echos/ui';
import {
  parseGpx,
  enrichTrackpoints,
  estimateVolumeMemoryMB,
  autoDetectCropRegion,
  autoDetectDepthMax,
} from '@echos/core';
import type {
  PreprocessingSettings,
  BeamSettings,
  VolumeGridSettings,
  PipelineV2Progress,
  CropRect,
} from '@echos/core';
import {
  DEFAULT_PREPROCESSING,
  DEFAULT_BEAM,
  DEFAULT_GRID,
} from '@echos/core';
import { useAppState } from '../store/app-state.js';
import { useTranslation } from '../i18n/index.js';
import { VolumeViewer } from '../components/VolumeViewer.js';

type ScanPhase = 'import' | 'crop' | 'settings' | 'processing' | 'viewer';

// Steps shown in the bar (no "Traitement")
const PIPELINE_STEP_KEYS = [
  { labelKey: 'v2.step.import', key: 'import' },
  { labelKey: 'v2.step.crop', key: 'crop' },
  { labelKey: 'v2.step.settings', key: 'settings' },
  { labelKey: 'v2.step.viewer', key: 'viewer' },
] as const;

function phaseToStepIndex(phase: ScanPhase): number {
  if (phase === 'processing') return 3; // Configurer is done, show checkmark; progress bar fills toward Visualiser
  return PIPELINE_STEP_KEYS.findIndex((s) => s.key === phase);
}

// ─── Quality presets ─────────────────────────────────────────────────────────

type QualityPreset = 'minimal' | 'medium' | 'complete';

interface QualityConfig {
  fps: number;
  grid: VolumeGridSettings;
  preprocessing: PreprocessingSettings;
}

const QUALITY_PRESETS: Record<QualityPreset, QualityConfig> = {
  minimal: {
    fps: 1,
    grid: { resX: 64, resY: 64, resZ: 64 },
    preprocessing: {
      upscaleFactor: 1,
      denoiseStrength: 0,
      gamma: 0.9,
      gaussianSigma: 0,
      deblockStrength: 0,
    },
  },
  medium: {
    fps: 2,
    grid: { resX: 96, resY: 96, resZ: 96 },
    preprocessing: {
      upscaleFactor: 1,
      denoiseStrength: 0.08,
      gamma: 0.9,
      gaussianSigma: 0.2,
      deblockStrength: 0,
    },
  },
  complete: {
    fps: 4,
    grid: { resX: 128, resY: 128, resZ: 128 },
    preprocessing: {
      ...DEFAULT_PREPROCESSING,
    },
  },
};

// Exponential depth steps: fine resolution at shallow depths
const DEPTH_STEPS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 14, 16, 18, 20, 25, 30, 35, 40, 50, 60, 80, 100];

function depthToSliderIndex(depth: number): number {
  let closest = 0;
  let minDiff = Math.abs(DEPTH_STEPS[0] - depth);
  for (let i = 1; i < DEPTH_STEPS.length; i++) {
    const diff = Math.abs(DEPTH_STEPS[i] - depth);
    if (diff < minDiff) { minDiff = diff; closest = i; }
  }
  return closest;
}

export function ScanPage() {
  const { state, dispatch } = useAppState();
  const { t } = useTranslation();

  const [phase, setPhase] = useState<ScanPhase>('import');
  // All 3 modes generated simultaneously — no mode selection needed

  // Settings — driven by quality preset
  const [quality, setQuality] = useState<QualityPreset>('medium');
  const activeConfig = QUALITY_PRESETS[quality];
  const preprocessing = activeConfig.preprocessing;
  const grid = activeConfig.grid;
  const fpsExtraction = activeConfig.fps;
  const [beam, setBeam] = useState<BeamSettings>({ ...DEFAULT_BEAM });
  const [crop, setCrop] = useState<CropRect>({ x: 0, y: 0, width: 640, height: 480 });

  // Auto-depth
  const [autoDepth, setAutoDepth] = useState(false);
  const [detectedDepth, setDetectedDepth] = useState<number | null>(null);

  // Depth slider index (exponential)
  const [depthSliderIdx, setDepthSliderIdx] = useState(() => depthToSliderIndex(DEFAULT_BEAM.depthMaxM));

  // Crop tool state
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [frameReady, setFrameReady] = useState(false);
  const [scale, setScale] = useState(1);
  const frameBitmapRef = useRef<ImageBitmap | null>(null);
  const draggingRef = useRef(false);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const cropRef = useRef(crop);
  const scaleRef = useRef(scale);
  const rafIdRef = useRef(0);
  cropRef.current = crop;
  scaleRef.current = scale;

  // Processing state
  const [progress, setProgress] = useState<PipelineV2Progress | null>(null);
  const [volumeData, setVolumeData] = useState<Float32Array | null>(null);
  const [volumeDims, setVolumeDims] = useState<[number, number, number]>([1, 1, 1]);
  const [volumeExtent, setVolumeExtent] = useState<[number, number, number]>([1, 1, 1]);
  const [instrumentFrames, setInstrumentFrames] = useState<Array<{
    index: number; timeS: number; intensity: Float32Array; width: number; height: number;
  }> | null>(null);
  const abortRef = useRef(false);

  // Step bar animation state
  const [stepBarVisible, setStepBarVisible] = useState(true);
  const [stepBarAnimating, setStepBarAnimating] = useState(false);

  // Sync: distance-over-time chart
  const enriched = useMemo(
    () => (state.gpxTrack ? enrichTrackpoints(state.gpxTrack) : []),
    [state.gpxTrack],
  );
  const maxDist = enriched.length > 0 ? enriched[enriched.length - 1].cumulativeDistanceM : 0;
  const chartWidth = 600;
  const chartHeight = 120;
  const chartPoints = useMemo(() => {
    if (enriched.length === 0) return '';
    const maxT = enriched[enriched.length - 1].elapsedS || 1;
    return enriched
      .map((pt) => {
        const x = (pt.elapsedS / maxT) * chartWidth;
        const y = chartHeight - (pt.cumulativeDistanceM / (maxDist || 1)) * chartHeight;
        return `${x},${y}`;
      })
      .join(' ');
  }, [enriched, maxDist]);

  // ─── File handlers ────────────────────────────────────────────────────

  const handleVideoFile = useCallback(
    async (files: File[]) => {
      const file = files[0];
      if (!file) return;
      try {
        const url = URL.createObjectURL(file);
        const video = document.createElement('video');
        video.preload = 'metadata';
        await new Promise<void>((resolve, reject) => {
          video.onloadedmetadata = () => resolve();
          video.onerror = () => reject(new Error('Failed to read video metadata'));
          video.src = url;
        });
        dispatch({
          type: 'SET_VIDEO',
          file,
          durationS: video.duration,
          width: video.videoWidth,
          height: video.videoHeight,
        });
        setCrop({ x: 0, y: 0, width: video.videoWidth, height: video.videoHeight });
        URL.revokeObjectURL(url);
      } catch (e) {
        dispatch({ type: 'SET_ERROR', error: `Could not read video: ${(e as Error).message}` });
      }
    },
    [dispatch],
  );

  const handleGpxFile = useCallback(
    async (files: File[]) => {
      const file = files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const track = parseGpx(text);
        console.log(`[GPX Import] ${file.name}: ${track.points.length} points, ${track.durationS.toFixed(1)}s, ${track.totalDistanceM.toFixed(0)}m, start=${track.startTime.toISOString()}, end=${track.endTime.toISOString()}`);
        dispatch({ type: 'SET_GPX', file, track });
      } catch (e) {
        dispatch({ type: 'SET_ERROR', error: `Could not parse GPX: ${(e as Error).message}` });
      }
    },
    [dispatch],
  );

  // Both Rendu A and Rendu B only require video; GPX is optional
  const canConfigure = !!state.videoFile;

  // ─── Crop tool: auto-detect + visual canvas ───────────────────────────

  useEffect(() => {
    if (phase !== 'crop' || !state.videoFile) return;
    setFrameReady(false);

    const url = URL.createObjectURL(state.videoFile);
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    let disposed = false;

    video.onloadeddata = () => {
      video.currentTime = Math.min(video.duration / 3, 10);
    };

    video.onseeked = async () => {
      if (disposed) return;
      const canvas = canvasRef.current;
      if (!canvas) { URL.revokeObjectURL(url); return; }

      const container = containerRef.current;
      const maxW = container ? container.clientWidth - 20 : 800;
      const maxH = container ? container.clientHeight - 10 : 600;
      const s = Math.min(1, maxW / video.videoWidth, maxH / video.videoHeight);
      setScale(s);
      scaleRef.current = s;

      canvas.width = video.videoWidth * s;
      canvas.height = video.videoHeight * s;

      const offscreen = document.createElement('canvas');
      offscreen.width = canvas.width;
      offscreen.height = canvas.height;
      const offCtx = offscreen.getContext('2d');
      if (offCtx) {
        offCtx.drawImage(video, 0, 0, canvas.width, canvas.height);
        try {
          frameBitmapRef.current = await createImageBitmap(offscreen);
        } catch {
          frameBitmapRef.current = null;
        }
      }

      const fullCanvas = new OffscreenCanvas(video.videoWidth, video.videoHeight);
      const fullCtx = fullCanvas.getContext('2d')!;
      fullCtx.drawImage(video, 0, 0);
      const fullImageData = fullCtx.getImageData(0, 0, video.videoWidth, video.videoHeight);
      const detected = autoDetectCropRegion(fullImageData);
      setCrop(detected);
      cropRef.current = detected;

      const depthResult = autoDetectDepthMax(fullImageData, detected);
      if (depthResult !== null) {
        setDetectedDepth(depthResult);
        setBeam((b) => ({ ...b, depthMaxM: depthResult }));
        setDepthSliderIdx(depthToSliderIndex(depthResult));
        setAutoDepth(true);
      }

      URL.revokeObjectURL(url);
      if (!disposed) setFrameReady(true);
    };

    video.src = url;
    return () => { disposed = true; URL.revokeObjectURL(url); };
  }, [phase, state.videoFile]);

  // ─── Draw crop overlay ──────────
  const drawCropOverlay = useCallback(() => {
    const canvas = canvasRef.current;
    const bitmap = frameBitmapRef.current;
    if (!canvas || !bitmap) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const c = cropRef.current;
    const s = scaleRef.current;

    ctx.drawImage(bitmap, 0, 0);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const cx = c.x * s;
    const cy = c.y * s;
    const cw = c.width * s;
    const ch = c.height * s;

    ctx.save();
    ctx.beginPath();
    ctx.rect(cx, cy, cw, ch);
    ctx.clip();
    ctx.drawImage(bitmap, 0, 0);
    ctx.restore();

    ctx.strokeStyle = '#8A7CFF';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(cx, cy, cw, ch);
    ctx.setLineDash([]);

    const hs = 8;
    ctx.fillStyle = '#8A7CFF';
    for (const [hx, hy] of [[cx, cy], [cx + cw, cy], [cx, cy + ch], [cx + cw, cy + ch]]) {
      ctx.fillRect(hx - hs / 2, hy - hs / 2, hs, hs);
    }
  }, []);

  useEffect(() => {
    if (frameReady) drawCropOverlay();
  }, [frameReady, crop, scale, drawCropOverlay]);

  // ─── Mouse events ─────────────────
  const getCanvasCoords = useCallback(
    (e: React.MouseEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      return {
        x: Math.round((e.clientX - rect.left) / scaleRef.current),
        y: Math.round((e.clientY - rect.top) / scaleRef.current),
      };
    },
    [],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      dragStartRef.current = getCanvasCoords(e);
      draggingRef.current = true;
    },
    [getCanvasCoords],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!draggingRef.current || !dragStartRef.current) return;

      const coords = getCanvasCoords(e);
      const start = dragStartRef.current;
      const x = Math.max(0, Math.min(start.x, coords.x));
      const y = Math.max(0, Math.min(start.y, coords.y));
      const w = Math.abs(coords.x - start.x);
      const h = Math.abs(coords.y - start.y);
      const newCrop = {
        x,
        y,
        width: Math.max(20, Math.min(w, state.videoWidth - x)),
        height: Math.max(20, Math.min(h, state.videoHeight - y)),
      };

      cropRef.current = newCrop;

      if (!rafIdRef.current) {
        rafIdRef.current = requestAnimationFrame(() => {
          rafIdRef.current = 0;
          drawCropOverlay();
          setCrop(cropRef.current);
        });
      }
    },
    [getCanvasCoords, drawCropOverlay, state.videoWidth, state.videoHeight],
  );

  const handleMouseUp = useCallback(() => {
    draggingRef.current = false;
    dragStartRef.current = null;
    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = 0;
    }
    setCrop(cropRef.current);
    drawCropOverlay();
  }, [drawCropOverlay]);

  // ─── V2 Processing pipeline ───────────────────────────────────────────

  const workerRef = useRef<Worker | null>(null);

  const runPipeline = useCallback(async () => {
    // Both renderers only need video; GPX is optional
    if (!state.videoFile) return;
    abortRef.current = false;
    setPhase('processing');

    const video = document.createElement('video');
    video.preload = 'auto';
    video.src = URL.createObjectURL(state.videoFile);
    await new Promise<void>((r) => { video.oncanplaythrough = () => r(); });

    const track = state.gpxTrack;

    const totalFrames = Math.floor(state.videoDurationS * fpsExtraction);
    const frameTimes = Array.from({ length: totalFrames }, (_, i) => ({
      index: i,
      timeS: i / fpsExtraction,
    }));

    // Unified progress: extraction = 0-70%, projection = 70-100%
    const EXTRACT_WEIGHT = 0.7;
    const PROJECT_WEIGHT = 0.3;

    setProgress({
      stage: 'preprocessing',
      progress: 0,
      message: t('v2.pipeline.extracting'),
      currentFrame: 0,
      totalFrames,
    });

    const worker = new Worker(
      new URL('../workers/pipeline-worker.ts', import.meta.url),
      { type: 'module' },
    );
    workerRef.current = worker;

    worker.postMessage({
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
      worker.onmessage = (e: MessageEvent) => {
        const msg = e.data;

        if (msg.type === 'preprocessed') {
          if (extractionDone) {
            const p = EXTRACT_WEIGHT + (msg.count / totalFrames) * PROJECT_WEIGHT * 0.5;
            setProgress({ stage: 'preprocessing', progress: Math.min(p, 0.95), message: t('v2.pipeline.extracting'), currentFrame: msg.count, totalFrames });
          }
        } else if (msg.type === 'stage' && msg.stage === 'projecting') {
          setProgress({ stage: 'projecting', progress: EXTRACT_WEIGHT + PROJECT_WEIGHT * 0.5, message: t('v2.pipeline.projecting') });
        } else if (msg.type === 'projection-progress') {
          const p = EXTRACT_WEIGHT + PROJECT_WEIGHT * 0.5 + (msg.current / msg.total) * PROJECT_WEIGHT * 0.5;
          setProgress({ stage: 'projecting', progress: Math.min(p, 0.98), message: t('v2.pipeline.projecting'), currentFrame: msg.current, totalFrames: msg.total });
        } else if (msg.type === 'complete') {
          resolve({ normalizedData: msg.normalizedData, dims: msg.dims, extent: msg.extent, frames: msg.frames });
        } else if (msg.type === 'error') {
          reject(new Error(msg.message));
        }
      };

      worker.onerror = (err) => reject(new Error(err.message));
    });

    // Use more parallel video decoders — each handles sequential seeks in its chunk
    const PARALLEL = Math.min(6, Math.max(2, navigator.hardwareConcurrency || 4));
    const blobUrl = video.src;
    const chunkSize = Math.ceil(totalFrames / PARALLEL);
    let extractedCount = 0;

    const extractChunk = async (videoEl: HTMLVideoElement, startIdx: number, endIdx: number) => {
      for (let i = startIdx; i < endIdx; i++) {
        if (abortRef.current) break;

        const timeS = i / fpsExtraction;
        videoEl.currentTime = timeS;
        await new Promise<void>((r) => { videoEl.onseeked = () => r(); });

        const bitmap = await createImageBitmap(
          videoEl, crop.x, crop.y, crop.width, crop.height,
        );

        worker.postMessage({ type: 'frame', index: i, timeS, bitmap }, [bitmap]);

        extractedCount++;
        // Throttle progress updates to every 5 frames to reduce React re-renders
        if (extractedCount % 5 === 0 || extractedCount === totalFrames) {
          const p = (extractedCount / totalFrames) * EXTRACT_WEIGHT;
          setProgress({ stage: 'preprocessing', progress: p, message: t('v2.pipeline.extracting'), currentFrame: extractedCount, totalFrames });
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

    // Wait for all video elements to be ready (parallel load)
    await Promise.all(
      videos.slice(1).map((v) => new Promise<void>((r) => {
        if (v.readyState >= 4) { r(); return; }
        v.oncanplaythrough = () => r();
      })),
    );

    const chunkPromises = videos.map((v, p) => {
      const start = p * chunkSize;
      const end = Math.min(start + chunkSize, totalFrames);
      return extractChunk(v, start, end);
    });

    await Promise.all(chunkPromises);

    URL.revokeObjectURL(blobUrl);
    extractionDone = true;

    if (abortRef.current) {
      worker.terminate();
      workerRef.current = null;
      return;
    }

    worker.postMessage({ type: 'done' });

    const result = await resultPromise;
    worker.terminate();
    workerRef.current = null;

    if (abortRef.current) return;

    const { normalizedData, dims, extent, frames: preprocessedFrames } = result;

    setInstrumentFrames(preprocessedFrames);
    setVolumeData(normalizedData);
    setVolumeDims(dims);
    setVolumeExtent(extent);

    dispatch({ type: 'SET_V2_VOLUME', data: normalizedData, dimensions: dims, extent });
    setProgress({ stage: 'ready', progress: 1, message: t('v2.pipeline.ready') });

    // Show completion state briefly before transitioning
    await new Promise((r) => setTimeout(r, 1200));

    const sessionId = crypto.randomUUID();
    const gpxPoints = track ? track.points.map((p) => ({ lat: p.lat, lon: p.lon })) : undefined;
    const bounds: [number, number, number, number] = gpxPoints
      ? [
          Math.min(...gpxPoints.map((p) => p.lat)),
          Math.min(...gpxPoints.map((p) => p.lon)),
          Math.max(...gpxPoints.map((p) => p.lat)),
          Math.max(...gpxPoints.map((p) => p.lon)),
        ]
      : [0, 0, 0, 0];

    dispatch({
      type: 'ADD_SESSION',
      session: {
        id: sessionId,
        name: state.videoFile!.name.replace(/\.\w+$/, ''),
        createdAt: new Date().toISOString(),
        videoFileName: state.videoFile!.name,
        gpxFileName: state.gpxFile?.name ?? '',
        bounds,
        totalDistanceM: track?.totalDistanceM ?? 0,
        durationS: track?.durationS ?? state.videoDurationS,
        frameCount: preprocessedFrames.length,
        gridDimensions: dims,
        preprocessing,
        beam,
      },
      gpxTrack: gpxPoints,
    });

    // Smooth transition to viewer
    setPhase('viewer');
    // Slide step bar away after a short delay
    setTimeout(() => {
      setStepBarAnimating(true);
      setTimeout(() => setStepBarVisible(false), 500);
    }, 600);
  }, [state, crop, preprocessing, beam, grid, fpsExtraction, dispatch, t]);

  const memEstimate = estimateVolumeMemoryMB(grid);

  // ─── Render ───────────────────────────────────────────────────────────

  return (
    <div style={{ background: colors.black, minHeight: 'calc(100vh - 72px)', display: 'flex', flexDirection: 'column' }}>
      {/* Pipeline Step Indicator — slides up when viewer is reached */}
      {stepBarVisible && (
        <div
          style={{
            padding: '12px var(--content-gutter) 0',
            flexShrink: 0,
            transition: 'transform 500ms cubic-bezier(0.4, 0, 0.2, 1), opacity 500ms ease',
            transform: stepBarAnimating ? 'translateY(-100%)' : 'translateY(0)',
            opacity: stepBarAnimating ? 0 : 1,
          }}
        >
          <StepIndicator
            steps={PIPELINE_STEP_KEYS.map((s) => ({ label: t(s.labelKey as any), key: s.key }))}
            currentStep={phaseToStepIndex(phase)}
            processingProgress={phase === 'processing' && progress ? progress.progress : undefined}
            onStepClick={(idx: number) => {
              const target = PIPELINE_STEP_KEYS[idx];
              if (!target) return;
              if (idx < phaseToStepIndex(phase) && phase !== 'processing') {
                setPhase(target.key as ScanPhase);
              }
            }}
          />
        </div>
      )}

      <div style={{ padding: 'clamp(8px, 1.5vw, 16px) var(--content-gutter)', flex: 1, display: 'flex', flexDirection: 'column' }}>

        {/* ── Import Phase ──────────────────────────────────────────── */}
        {phase === 'import' && (
          <div style={{ flex: 1, overflow: 'auto' }}>
            <h1 style={{ color: colors.text1, fontSize: 'clamp(24px, 3vw, 36px)', fontWeight: 600, marginBottom: '8px' }}>
              {t('v2.scan.title')}
            </h1>
            <p style={{ color: colors.text2, fontSize: '15px', marginBottom: '32px', lineHeight: 1.6, maxWidth: '700px' }}>
              {t('v2.scan.desc')}
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '24px' }}>
              <GlassPanel style={{ padding: '24px' }}>
                <h3 style={{ color: colors.text1, fontSize: '14px', marginBottom: '12px' }}>
                  {t('import.dropVideo')}
                </h3>
                <FileDropZone
                  accept="video/mp4,video/*"
                  onFile={(file: File) => handleVideoFile([file])}
                  label={state.videoFile ? state.videoFile.name : t('import.dropVideo')}
                  hint={t('import.videoHint')}
                />
              </GlassPanel>

              <GlassPanel style={{ padding: '24px', opacity: !state.gpxFile ? 0.7 : 1 }}>
                <h3 style={{ color: colors.text1, fontSize: '14px', marginBottom: '12px' }}>
                  {t('import.dropGpx')}
                  <span style={{ fontWeight: 400, fontSize: '12px', color: colors.text3, marginLeft: '8px' }}>
                    ({t('common.optional')})
                  </span>
                </h3>
                <FileDropZone
                  accept=".gpx"
                  onFile={(file: File) => handleGpxFile([file])}
                  label={state.gpxFile ? state.gpxFile.name : t('import.dropGpx')}
                  hint={t('import.gpxHint')}
                />
              </GlassPanel>
            </div>

            {state.error && (
              <div style={{
                background: 'rgba(239, 68, 68, 0.1)',
                border: `1px solid ${colors.error}`,
                borderRadius: '12px',
                padding: '14px 18px',
                color: colors.error,
                fontSize: '15px',
                marginBottom: '16px',
              }}>
                {state.error}
              </div>
            )}

            {canConfigure && (
              <div style={{ textAlign: 'center' }}>
                <Button variant="primary" size="lg" onClick={() => setPhase('crop')}>
                  {t('v2.scan.next')}
                </Button>
              </div>
            )}
          </div>
        )}

        {/* ── Crop Phase ─────────────────────── */}
        {phase === 'crop' && (
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
            <h2 style={{ color: colors.text1, fontSize: 'clamp(18px, 2vw, 24px)', fontWeight: 600, marginBottom: '4px', flexShrink: 0 }}>
              {t('crop.title')}
            </h2>
            <p style={{ color: colors.text2, fontSize: '13px', marginBottom: '12px', lineHeight: 1.4, maxWidth: '640px', flexShrink: 0 }}>
              {t('crop.desc')}
            </p>

            <GlassPanel style={{ padding: '12px', marginBottom: '12px', flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <div
                ref={containerRef}
                style={{
                  position: 'relative',
                  display: 'flex',
                  justifyContent: 'center',
                  alignItems: 'center',
                  cursor: 'crosshair',
                  flex: 1,
                  overflow: 'hidden',
                }}
              >
                <canvas
                  ref={canvasRef}
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                  onMouseLeave={handleMouseUp}
                  style={{ borderRadius: '8px', maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                />
                {!frameReady && (
                  <div style={{
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: colors.text3,
                    fontSize: '15px',
                  }}>
                    {t('v2.preview.analyzing')}
                  </div>
                )}
              </div>

              <div style={{
                marginTop: '8px',
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                gap: '8px',
                flexShrink: 0,
              }}>
                {[
                  { label: 'X', value: crop.x },
                  { label: 'Y', value: crop.y },
                  { label: 'W', value: crop.width },
                  { label: 'H', value: crop.height },
                ].map(({ label, value }) => (
                  <div key={label} style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '11px', color: colors.text3, marginBottom: '2px' }}>{label}</div>
                    <div style={{ fontSize: '14px', fontWeight: 600, color: colors.accent, fontVariantNumeric: 'tabular-nums' }}>
                      {value}px
                    </div>
                  </div>
                ))}
              </div>
            </GlassPanel>

            <div style={{ display: 'flex', justifyContent: 'space-between', flexShrink: 0 }}>
              <Button variant="ghost" size="lg" onClick={() => setPhase('import')}>
                {t('common.back')}
              </Button>
              <Button
                variant="primary"
                size="lg"
                disabled={crop.width < 20 || crop.height < 20}
                onClick={() => setPhase('settings')}
              >
                {t('v2.scan.nextSettings')}
              </Button>
            </div>
          </div>
        )}

        {/* ── Settings Phase (includes sync + processing overlay) ─── */}
        {(phase === 'settings' || phase === 'processing') && (
          <div style={{ flex: 1, overflow: phase === 'processing' ? 'hidden' : 'auto', position: 'relative' }}>
            {/* Processing overlay — minimal, centered */}
            {phase === 'processing' && progress && (
              <div style={{
                position: 'absolute',
                inset: 0,
                zIndex: 20,
                background: 'var(--c-black)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'opacity 600ms ease',
              }}>
                <div style={{ width: '100%', maxWidth: '380px', textAlign: 'center' }}>
                  {progress.stage === 'ready' ? (
                    /* Completion state — checkmark animation */
                    <div style={{ animation: 'echos-fade-in 400ms ease' }}>
                      <div style={{
                        width: '64px',
                        height: '64px',
                        borderRadius: '50%',
                        background: colors.accentMuted,
                        border: `2px solid ${colors.accent}`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        margin: '0 auto 20px',
                        animation: 'echos-scale-in 400ms cubic-bezier(0.34, 1.56, 0.64, 1)',
                      }}>
                        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={colors.accent} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      </div>
                      <div style={{ fontSize: '16px', fontWeight: 600, color: colors.text1 }}>
                        {t('v2.pipeline.ready')}
                      </div>
                    </div>
                  ) : (
                    /* Progress state */
                    <>
                      <div style={{
                        fontSize: '48px',
                        fontWeight: 700,
                        color: colors.text1,
                        fontVariantNumeric: 'tabular-nums',
                        lineHeight: 1,
                        marginBottom: '20px',
                        letterSpacing: '-0.02em',
                      }}>
                        {Math.round(progress.progress * 100)}%
                      </div>

                      <ProgressBar value={progress.progress} showPercent={false} />

                      <div style={{ marginTop: '32px' }}>
                        <Button
                          variant="ghost"
                          onClick={() => {
                            abortRef.current = true;
                            setPhase('settings');
                          }}
                        >
                          {t('v2.pipeline.abort')}
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            <h2 style={{ color: colors.text1, fontSize: 'clamp(18px, 2vw, 24px)', fontWeight: 600, marginBottom: '4px' }}>
              {t('v2.settings.title')}
            </h2>
            <p style={{ color: colors.text2, fontSize: '13px', marginBottom: '12px', lineHeight: 1.5, maxWidth: '700px' }}>
              {t('v2.settings.desc')}
            </p>

            {/* Quality preset selector — big centered titles, minimal info */}
            <GlassPanel style={{ padding: '16px', marginBottom: '12px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
                {(['minimal', 'medium', 'complete'] as const).map((q) => {
                  const selected = quality === q;
                  const cfg = QUALITY_PRESETS[q];
                  const accentMap = { minimal: '#22c55e', medium: colors.accent, complete: '#f59e0b' };
                  const color = accentMap[q];
                  const titleMap = { minimal: 'Rapide', medium: 'Équilibré', complete: 'Complet' };
                  const hintMap = {
                    minimal: `${cfg.fps} image/s, aperçu en quelques secondes`,
                    medium: `${cfg.fps} images/s, bon compromis`,
                    complete: `${cfg.fps} images/s, qualité maximale`,
                  };
                  return (
                    <button
                      key={q}
                      onClick={() => setQuality(q)}
                      style={{
                        padding: '18px 14px',
                        borderRadius: '12px',
                        border: `2px solid ${selected ? color : colors.border}`,
                        background: selected ? `${color}15` : 'transparent',
                        cursor: 'pointer',
                        textAlign: 'center',
                        transition: 'all 150ms ease',
                      }}
                    >
                      <div style={{ color: selected ? color : colors.text1, fontWeight: 700, fontSize: '20px', marginBottom: '6px' }}>
                        {titleMap[q]}
                      </div>
                      <div style={{ color: colors.text3, fontSize: '11px', lineHeight: 1.4 }}>
                        {hintMap[q]}
                      </div>
                    </button>
                  );
                })}
              </div>
            </GlassPanel>

            {/* Synchronization section — only when GPX is loaded */}
            {state.gpxTrack && (
            <GlassPanel style={{ padding: '14px', marginBottom: '10px' }}>
              <h3 style={{ color: colors.text1, fontSize: '14px', fontWeight: 600, marginBottom: '8px' }}>
                {t('v2.sync.title')}
              </h3>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '8px', marginBottom: '8px' }}>
                <div style={{ padding: '8px 12px', borderRadius: '8px', background: colors.surface }}>
                  <div style={{ fontSize: '11px', color: colors.text3, marginBottom: '2px' }}>{t('v2.sync.videoDuration')}</div>
                  <div style={{ fontSize: '16px', fontWeight: 600, color: colors.text1 }}>{state.videoDurationS.toFixed(1)}s</div>
                </div>
                <div style={{ padding: '8px 12px', borderRadius: '8px', background: colors.surface }}>
                  <div style={{ fontSize: '11px', color: colors.text3, marginBottom: '2px' }}>{t('v2.sync.gpxDuration')}</div>
                  <div style={{ fontSize: '16px', fontWeight: 600, color: colors.text1 }}>{state.gpxTrack?.durationS.toFixed(1) ?? '-'}s</div>
                </div>
                <div style={{ padding: '8px 12px', borderRadius: '8px', background: colors.surface }}>
                  <div style={{ fontSize: '11px', color: colors.text3, marginBottom: '2px' }}>{t('v2.sync.totalDist')}</div>
                  <div style={{ fontSize: '16px', fontWeight: 600, color: colors.text1 }}>{maxDist.toFixed(0)} m</div>
                </div>
                <div style={{ padding: '8px 12px', borderRadius: '8px', background: colors.surface }}>
                  <div style={{ fontSize: '11px', color: colors.text3, marginBottom: '2px' }}>{t('v2.sync.avgSpeed')}</div>
                  <div style={{ fontSize: '16px', fontWeight: 600, color: colors.text1 }}>
                    {state.gpxTrack && state.gpxTrack.durationS > 0
                      ? (maxDist / state.gpxTrack.durationS).toFixed(1)
                      : '-'}{' '}
                    m/s
                  </div>
                </div>
              </div>

              {/* Chart with trim zones */}
              <div style={{ marginBottom: '8px' }}>
                <div style={{ fontSize: '11px', color: colors.text3, marginBottom: '3px' }}>
                  {t('v2.sync.distOverTime')}
                </div>
                <svg
                  viewBox={`0 0 ${chartWidth} ${chartHeight}`}
                  style={{ width: '100%', height: '80px', background: colors.surface, borderRadius: '8px' }}
                >
                  {/* Trim start zone (left, red overlay) */}
                  {state.sync.trimStartS > 0 && state.gpxTrack && (
                    <rect
                      x={0}
                      y={0}
                      width={(state.sync.trimStartS / (state.gpxTrack.durationS || 1)) * chartWidth}
                      height={chartHeight}
                      fill="rgba(248, 113, 113, 0.15)"
                    />
                  )}
                  {state.sync.trimStartS > 0 && state.gpxTrack && (
                    <line
                      x1={(state.sync.trimStartS / (state.gpxTrack.durationS || 1)) * chartWidth}
                      y1={0}
                      x2={(state.sync.trimStartS / (state.gpxTrack.durationS || 1)) * chartWidth}
                      y2={chartHeight}
                      stroke={colors.success}
                      strokeWidth={1.5}
                      strokeDasharray="4 3"
                    />
                  )}
                  {/* Trim end zone (right, red overlay) */}
                  {state.sync.trimEndS > 0 && state.gpxTrack && (
                    <rect
                      x={chartWidth - (state.sync.trimEndS / (state.gpxTrack.durationS || 1)) * chartWidth}
                      y={0}
                      width={(state.sync.trimEndS / (state.gpxTrack.durationS || 1)) * chartWidth}
                      height={chartHeight}
                      fill="rgba(248, 113, 113, 0.15)"
                    />
                  )}
                  {state.sync.trimEndS > 0 && state.gpxTrack && (
                    <line
                      x1={chartWidth - (state.sync.trimEndS / (state.gpxTrack.durationS || 1)) * chartWidth}
                      y1={0}
                      x2={chartWidth - (state.sync.trimEndS / (state.gpxTrack.durationS || 1)) * chartWidth}
                      y2={chartHeight}
                      stroke={colors.error}
                      strokeWidth={1.5}
                      strokeDasharray="4 3"
                    />
                  )}
                  <polyline
                    points={chartPoints}
                    fill="none"
                    stroke={colors.accent}
                    strokeWidth={2}
                  />
                </svg>
              </div>

              {/* Two trim sliders side by side */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <Slider
                  label={t('v2.sync.trimStart')}
                  value={state.sync.trimStartS}
                  min={0}
                  max={Math.floor((state.gpxTrack?.durationS ?? 60) / 2)}
                  step={0.5}
                  unit=" s"
                  tooltip={t('v2.sync.trimStartTooltip')}
                  onChange={(v) => dispatch({ type: 'SET_SYNC', sync: { trimStartS: v } })}
                />
                <Slider
                  label={t('v2.sync.trimEnd')}
                  value={state.sync.trimEndS}
                  min={0}
                  max={Math.floor((state.gpxTrack?.durationS ?? 60) / 2)}
                  step={0.5}
                  unit=" s"
                  tooltip={t('v2.sync.trimEndTooltip')}
                  onChange={(v) => dispatch({ type: 'SET_SYNC', sync: { trimEndS: v } })}
                />
              </div>
            </GlassPanel>
            )}

            {/* Summary — minimal */}
            <GlassPanel style={{ padding: '12px', marginBottom: '12px' }}>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: '12px',
                fontSize: '13px',
              }}>
                <div>
                  <div style={{ color: colors.text3, fontSize: '11px', marginBottom: '2px' }}>{t('v2.preview.frames')}</div>
                  <div style={{ color: colors.text1, fontWeight: 500 }}>~{Math.floor(state.videoDurationS * fpsExtraction)}</div>
                </div>
                <div>
                  <div style={{ color: colors.text3, fontSize: '11px', marginBottom: '2px' }}>{t('v2.preview.distance')}</div>
                  <div style={{ color: colors.text1, fontWeight: 500 }}>{state.gpxTrack ? `${state.gpxTrack.totalDistanceM.toFixed(0)}m` : '-'}</div>
                </div>
                <div>
                  <div style={{ color: colors.text3, fontSize: '11px', marginBottom: '2px' }}>{t('v2.config.memory')}</div>
                  <div style={{ color: memEstimate > 512 ? colors.error : colors.text1, fontWeight: 500 }}>~{memEstimate.toFixed(0)} MB</div>
                </div>
              </div>
            </GlassPanel>

            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <Button variant="ghost" size="lg" onClick={() => setPhase('crop')}>
                {t('common.back')}
              </Button>
              <Button variant="primary" size="lg" onClick={runPipeline} disabled={phase === 'processing'}>
                {t('v2.config.generate')}
              </Button>
            </div>
          </div>
        )}

        {/* ── Viewer Phase ──────────────────────────────────────────── */}
        {phase === 'viewer' && (
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, animation: 'echos-fade-in 500ms ease' }}>
            <VolumeViewer
              volumeData={volumeData}
              dimensions={volumeDims}
              extent={volumeExtent}
              frames={instrumentFrames ?? undefined}
              beam={beam}
              grid={grid}
              onReconfigure={() => {
                setStepBarVisible(true);
                setStepBarAnimating(false);
                setPhase('settings');
              }}
              onNewScan={() => {
                setStepBarVisible(true);
                setStepBarAnimating(false);
                setPhase('import');
                setVolumeData(null);
                setFrameReady(false);
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

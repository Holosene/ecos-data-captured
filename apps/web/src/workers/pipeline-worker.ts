/**
 * ECHOS V2 — Pipeline Web Worker
 *
 * Offloads heavy computation from the main thread:
 *   1. Frame preprocessing (bilateral denoise, gamma, Gaussian blur, median)
 *   2. Conic projection + normalization (Mode B)
 *
 * Main thread sends ImageBitmaps (zero-copy Transferable) for each frame.
 * Worker preprocesses each frame in parallel with video seeking,
 * then runs projection when all frames are received.
 *
 * Protocol:
 *   Main → Worker: 'init' | 'frame' | 'done'
 *   Worker → Main: 'preprocessed' | 'stage' | 'projection-progress' | 'complete' | 'error'
 */

import { preprocessFrame } from '@echos/core';
import {
  createEmptyVolume,
  projectFramesSpatial,
  normalizeVolume,
} from '@echos/core';
import type {
  PreprocessingSettings,
  BeamSettings,
  VolumeGridSettings,
  PreprocessedFrame,
  FrameMapping,
} from '@echos/core';

// ─── State ───────────────────────────────────────────────────────────────────

let preprocessing: PreprocessingSettings;
let beam: BeamSettings;
let grid: VolumeGridSettings;
let viewMode: 'instrument' | 'spatial';
let trackTotalDistanceM: number;
let mappings: FrameMapping[];

const frames: PreprocessedFrame[] = [];

// ─── Message handler ─────────────────────────────────────────────────────────

self.onmessage = (e: MessageEvent) => {
  const msg = e.data;

  if (msg.type === 'init') {
    preprocessing = msg.preprocessing;
    beam = msg.beam;
    grid = msg.grid;
    viewMode = msg.viewMode;
    trackTotalDistanceM = msg.trackTotalDistanceM;
    mappings = msg.mappings;
    frames.length = 0;
    return;
  }

  if (msg.type === 'frame') {
    try {
      // Decode ImageBitmap → ImageData via OffscreenCanvas
      const bitmap: ImageBitmap = msg.bitmap;
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(bitmap, 0, 0);
      const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
      bitmap.close();

      // Preprocess (bilateral denoise, gamma, Gaussian, median)
      const result = preprocessFrame(imageData, preprocessing);
      frames.push({ index: msg.index, timeS: msg.timeS, ...result });

      self.postMessage({ type: 'preprocessed', index: msg.index, count: frames.length });
    } catch (err) {
      self.postMessage({ type: 'error', message: String(err) });
    }
    return;
  }

  if (msg.type === 'done') {
    try {
      // Sort by index (safety, in case frames arrived out of order)
      frames.sort((a, b) => a.index - b.index);

      let normalizedData: Float32Array;
      let dims: [number, number, number];
      let ext: [number, number, number];

      if (viewMode === 'spatial') {
        // ── Mode B: conic spatial projection ──
        self.postMessage({ type: 'stage', stage: 'projecting' });

        const halfAngle = (beam.beamAngleDeg / 2) * Math.PI / 180;
        const maxRadius = beam.depthMaxM * Math.tan(halfAngle);
        const adaptiveResY = Math.max(256, Math.min(1024, Math.round(trackTotalDistanceM)));
        const spatialGrid: VolumeGridSettings = { ...grid, resY: adaptiveResY };

        const volume = createEmptyVolume(
          spatialGrid,
          maxRadius * 2.5,
          trackTotalDistanceM,
          beam.depthMaxM,
        );

        projectFramesSpatial(frames, mappings, volume, beam, (current, total) => {
          self.postMessage({ type: 'projection-progress', current, total });
        });

        normalizedData = normalizeVolume(volume);
        dims = volume.dimensions;
        ext = volume.extent;
      } else {
        // ── Mode A: no static volume — frames are used for live playback ──
        normalizedData = new Float32Array(0);
        // dims order: [lateral, track, depth] — matches grid directly, no swap
        dims = [grid.resX, grid.resY, grid.resZ];
        ext = [1, 1, 1];
      }

      // Transfer all buffers (zero-copy back to main thread)
      const transferables: Transferable[] = [];
      if (normalizedData.buffer.byteLength > 0) {
        transferables.push(normalizedData.buffer);
      }

      const frameData = frames.map((f) => {
        transferables.push(f.intensity.buffer);
        return {
          index: f.index,
          timeS: f.timeS,
          intensity: f.intensity,
          width: f.width,
          height: f.height,
        };
      });

      self.postMessage(
        { type: 'complete', normalizedData, dims, extent: ext, frames: frameData },
        transferables,
      );
    } catch (err) {
      self.postMessage({ type: 'error', message: String(err) });
    }
  }
};

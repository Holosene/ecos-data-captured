/**
 * ECHOS V2 — Pipeline Web Worker
 *
 * Offloads heavy computation from the main thread:
 *   1. Frame preprocessing (bilateral denoise, gamma, Gaussian blur, median)
 *   2. Multi-mode projection: generates ALL render modes in a single pass
 *      - Mode A (Instrument): stacked cone volume — always generated
 *      - Mode B (Spatial): GPS-mapped spatial volume — generated when GPS mappings available
 *      - Mode C (Classic): no static volume, uses frames for live temporal playback
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
  buildInstrumentVolume,
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

      // ── Mode A: build stacked instrument volume (always) ──
      self.postMessage({ type: 'stage', stage: 'projecting' });

      const instrumentResult = buildInstrumentVolume(frames, beam, grid, (current, total) => {
        self.postMessage({ type: 'projection-progress', current, total });
      });

      // ── Mode B: spatial projection (only when GPS mappings available) ──
      let spatialNormalized: Float32Array | null = null;
      let spatialDims: [number, number, number] | null = null;
      let spatialExtent: [number, number, number] | null = null;

      const hasGPS = mappings && mappings.length > 0 && trackTotalDistanceM > 0;

      if (hasGPS) {
        self.postMessage({ type: 'stage', stage: 'projecting-spatial' });

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

        projectFramesSpatial(frames, mappings, volume, beam);

        spatialNormalized = normalizeVolume(volume);
        spatialDims = volume.dimensions;
        spatialExtent = volume.extent;
      }

      // ── Mode C: no static volume — preprocessed frames passed directly ──
      // (frames are transferred below)

      // Transfer all buffers (zero-copy back to main thread)
      const transferables: Transferable[] = [];

      if (instrumentResult.normalized.buffer.byteLength > 0) {
        transferables.push(instrumentResult.normalized.buffer);
      }
      if (spatialNormalized && spatialNormalized.buffer.byteLength > 0) {
        transferables.push(spatialNormalized.buffer);
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
        {
          type: 'complete',
          // Mode A (always present)
          instrument: {
            normalizedData: instrumentResult.normalized,
            dims: instrumentResult.dimensions,
            extent: instrumentResult.extent,
          },
          // Mode B (null if no GPS)
          spatial: hasGPS ? {
            normalizedData: spatialNormalized,
            dims: spatialDims,
            extent: spatialExtent,
          } : null,
          // Frames for Mode C + slice building
          frames: frameData,
        },
        transferables,
      );
    } catch (err) {
      self.postMessage({ type: 'error', message: String(err) });
    }
  }
};

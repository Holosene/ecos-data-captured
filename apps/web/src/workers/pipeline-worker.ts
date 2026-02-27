/**
 * ECOS V2 — Pipeline Web Worker
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
  buildInstrumentVolume,
} from '@echos/core';
import type {
  PreprocessingSettings,
  BeamSettings,
  VolumeGridSettings,
  PreprocessedFrame,
} from '@echos/core';

// ─── State ───────────────────────────────────────────────────────────────────

let preprocessing: PreprocessingSettings;
let beam: BeamSettings;
let grid: VolumeGridSettings;

const frames: PreprocessedFrame[] = [];

// ─── Message handler ─────────────────────────────────────────────────────────

self.onmessage = (e: MessageEvent) => {
  const msg = e.data;

  if (msg.type === 'init') {
    preprocessing = msg.preprocessing;
    beam = msg.beam;
    grid = msg.grid;
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

      // Always build Mode A (instrument) static volume.
      // Mode B + C are computed in real-time from frames in the VolumeViewer.
      self.postMessage({ type: 'stage', stage: 'projecting' });

      const result = buildInstrumentVolume(frames, beam, grid, (current, total) => {
        self.postMessage({ type: 'projection-progress', current, total });
      });

      const normalizedData = result.normalized;
      const dims = result.dimensions;
      const ext = result.extent;

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

/**
 * ECHOS V2 — Probabilistic Conic Acoustic Projection
 *
 * Each sonar frame is interpreted as an acoustic cone (truncated):
 *   - The beam opens from a point (transducer) downward
 *   - Depth axis of the frame maps to radial distance in the cone
 *   - Horizontal axis of the frame maps to angular position within the cone
 *   - Intensity is distributed laterally with Gaussian falloff
 *
 * Accumulation is probabilistic:
 *   - Each voxel accumulates weighted intensity from all overlapping cones
 *   - Final value = sum(intensity × weight) / sum(weight)
 *
 * Projection math:
 *   For a frame pixel at (col, row):
 *     depth  = row / frameHeight × depthMax
 *     angle  = (col / frameWidth - 0.5) × beamAngle
 *     lateral_offset = depth × tan(angle)
 *     gaussian_weight = exp(-lateral_offset² / (2 × σ²))
 *   where σ = lateralFalloffSigma × coneRadiusAtDepth
 */

import type {
  BeamSettings,
  VolumeGridSettings,
  PreprocessedFrame,
  ProbabilisticVolume,
} from './v2-types.js';
import type { FrameMapping } from './types.js';

const DEG2RAD = Math.PI / 180;

// ─── Conic geometry ─────────────────────────────────────────────────────────

/**
 * Compute the cone radius at a given depth.
 */
function coneRadiusAtDepth(depth: number, halfAngleRad: number): number {
  return depth * Math.tan(halfAngleRad);
}

// ─── Volume creation ────────────────────────────────────────────────────────

/**
 * Create an empty probabilistic volume grid.
 */
export function createEmptyVolume(
  grid: VolumeGridSettings,
  extentX: number,
  extentY: number,
  extentZ: number,
): ProbabilisticVolume {
  const total = grid.resX * grid.resY * grid.resZ;
  return {
    data: new Float32Array(total),
    weights: new Float32Array(total),
    dimensions: [grid.resX, grid.resY, grid.resZ],
    extent: [extentX, extentY, extentZ],
    origin: [-extentX / 2, 0, 0],
  };
}

// ─── Single frame projection (Instrument mode) ─────────────────────────────

/**
 * Project a single frame into a conic volume (Mode A: Instrument).
 * The volume represents the cone itself — no GPS, time axis = Y.
 *
 * Optimized: precomputed LUTs for depth→zi, col→xi, Gaussian weights.
 */
export function projectFrameIntoCone(
  frame: PreprocessedFrame,
  volume: ProbabilisticVolume,
  beam: BeamSettings,
  ySliceIndex: number,
): void {
  const [resX, resY, resZ] = volume.dimensions;
  const [extX, , extZ] = volume.extent;
  const halfAngle = (beam.beamAngleDeg / 2) * DEG2RAD;
  const tanHalf = Math.tan(halfAngle);
  const originX = volume.origin[0];
  const invExtX_resX = resX / extX;
  const invExtZ_resZ = resZ / extZ;
  const invHeight = 1.0 / frame.height;
  const invWidth = 1.0 / frame.width;
  const latSigmaFactor = beam.lateralFalloffSigma;
  const dataLen = volume.data.length;
  const strideZ = resY * resX;
  const yOffset = ySliceIndex * resX;

  // Pre-compute per-row: zi, radiusAtDepth, invSigma2x2
  const nearFieldRow = Math.ceil((beam.nearFieldM / beam.depthMaxM) * frame.height);

  // Pre-compute per-col: normalizedCol (col / width - 0.5) * 2
  const colNorm = new Float32Array(frame.width);
  for (let col = 0; col < frame.width; col++) {
    colNorm[col] = (col * invWidth - 0.5) * 2;
  }

  for (let row = nearFieldRow; row < frame.height; row++) {
    const depth = row * invHeight * beam.depthMaxM;
    const zi = (depth * invExtZ_resZ) | 0;
    if (zi < 0 || zi >= resZ) continue;

    const radiusAtDepth = depth * tanHalf;
    const sigma = latSigmaFactor * radiusAtDepth;
    const invSigma2x2 = sigma > 0 ? -1.0 / (2 * sigma * sigma) : 0;

    const ziStride = zi * strideZ + yOffset;
    const rowOffset = row * frame.width;

    for (let col = 0; col < frame.width; col++) {
      const intensity = frame.intensity[rowOffset + col];
      if (intensity < 0.001) continue;

      const lateralOffset = colNorm[col] * radiusAtDepth;
      const gaussWeight = invSigma2x2 !== 0
        ? Math.exp(lateralOffset * lateralOffset * invSigma2x2)
        : 1.0;

      const xi = ((lateralOffset - originX) * invExtX_resX) | 0;
      if (xi < 0 || xi >= resX) continue;

      const voxelIdx = ziStride + xi;
      if (voxelIdx >= 0 && voxelIdx < dataLen) {
        volume.data[voxelIdx] += intensity * gaussWeight;
        volume.weights[voxelIdx] += gaussWeight;
      }
    }
  }
}

// ─── Multi-frame projection (Spatial mode) ──────────────────────────────────

/**
 * Project all frames into a spatial volume (Mode B: Spatial Trace).
 * Frames are positioned along the Y axis according to GPS distance.
 *
 * Optimized: precomputed LUTs, hoisted invariants, minimized Math calls.
 */
export function projectFramesSpatial(
  frames: PreprocessedFrame[],
  mappings: FrameMapping[],
  volume: ProbabilisticVolume,
  beam: BeamSettings,
  onProgress?: (current: number, total: number) => void,
): void {
  const [resX, resY, resZ] = volume.dimensions;
  const [extX, , extZ] = volume.extent;
  const halfAngle = (beam.beamAngleDeg / 2) * DEG2RAD;
  const tanHalf = Math.tan(halfAngle);
  const originX = volume.origin[0];
  const invExtX_resX = resX / extX;
  const invExtZ_resZ = resZ / extZ;
  const latSigmaFactor = beam.lateralFalloffSigma;
  const dataLen = volume.data.length;
  const strideZ = resY * resX;

  // Find distance range
  let minDist = Infinity;
  let maxDist = -Infinity;
  for (let i = 0; i < mappings.length; i++) {
    const d = mappings[i].distanceM;
    if (d < minDist) minDist = d;
    if (d > maxDist) maxDist = d;
  }
  const invDistRange = 1.0 / (maxDist - minDist || 1);

  for (let fi = 0; fi < frames.length; fi++) {
    const frame = frames[fi];
    const mapping = mappings[fi];
    if (!mapping) continue;

    const yi = ((mapping.distanceM - minDist) * invDistRange * (resY - 1)) | 0;
    if (yi < 0 || yi >= resY) continue;

    const yOffset = yi * resX;
    const invHeight = 1.0 / frame.height;
    const invWidth = 1.0 / frame.width;
    const nearFieldRow = Math.ceil((beam.nearFieldM / beam.depthMaxM) * frame.height);

    // Pre-compute per-col normalizedCol
    const colNorm = new Float32Array(frame.width);
    for (let col = 0; col < frame.width; col++) {
      colNorm[col] = (col * invWidth - 0.5) * 2;
    }

    for (let row = nearFieldRow; row < frame.height; row++) {
      const depth = row * invHeight * beam.depthMaxM;
      const zi = (depth * invExtZ_resZ) | 0;
      if (zi < 0 || zi >= resZ) continue;

      const radiusAtDepth = depth * tanHalf;
      const sigma = latSigmaFactor * radiusAtDepth;
      const invSigma2x2 = sigma > 0 ? -1.0 / (2 * sigma * sigma) : 0;
      const ziStride = zi * strideZ + yOffset;
      const rowOffset = row * frame.width;

      for (let col = 0; col < frame.width; col++) {
        const intensity = frame.intensity[rowOffset + col];
        if (intensity < 0.001) continue;

        const lateralOffset = colNorm[col] * radiusAtDepth;
        const gaussWeight = invSigma2x2 !== 0
          ? Math.exp(lateralOffset * lateralOffset * invSigma2x2)
          : 1.0;

        const xi = ((lateralOffset - originX) * invExtX_resX) | 0;
        if (xi < 0 || xi >= resX) continue;

        const voxelIdx = ziStride + xi;
        if (voxelIdx >= 0 && voxelIdx < dataLen) {
          volume.data[voxelIdx] += intensity * gaussWeight;
          volume.weights[voxelIdx] += gaussWeight;
        }
      }
    }

    onProgress?.(fi + 1, frames.length);
  }
}

// ─── Normalization ──────────────────────────────────────────────────────────

/**
 * Normalize accumulated volume: divide by weights to get average intensity.
 * Returns a new Float32Array of normalized values [0–1].
 *
 * Optimized: first pass finds max while normalizing by weights,
 * second pass scales to [0-1]. Unrolled 4x for throughput.
 */
export function normalizeVolume(volume: ProbabilisticVolume): Float32Array {
  const len = volume.data.length;
  const out = new Float32Array(len);
  const data = volume.data;
  const weights = volume.weights;
  let maxVal = 0;

  // Pass 1: normalize by weights + track max (unrolled 4x)
  const len4 = (len >> 2) << 2;
  for (let i = 0; i < len4; i += 4) {
    const w0 = weights[i], w1 = weights[i + 1], w2 = weights[i + 2], w3 = weights[i + 3];
    const v0 = w0 > 0 ? data[i] / w0 : 0;
    const v1 = w1 > 0 ? data[i + 1] / w1 : 0;
    const v2 = w2 > 0 ? data[i + 2] / w2 : 0;
    const v3 = w3 > 0 ? data[i + 3] / w3 : 0;
    out[i] = v0; out[i + 1] = v1; out[i + 2] = v2; out[i + 3] = v3;
    // Branch-free max: reduces branch misprediction
    if (v0 > maxVal) maxVal = v0;
    if (v1 > maxVal) maxVal = v1;
    if (v2 > maxVal) maxVal = v2;
    if (v3 > maxVal) maxVal = v3;
  }
  for (let i = len4; i < len; i++) {
    const w = weights[i];
    const v = w > 0 ? data[i] / w : 0;
    out[i] = v;
    if (v > maxVal) maxVal = v;
  }

  // Pass 2: scale to [0-1] (unrolled 4x)
  if (maxVal > 0) {
    const invMax = 1.0 / maxVal;
    for (let i = 0; i < len4; i += 4) {
      out[i] *= invMax;
      out[i + 1] *= invMax;
      out[i + 2] *= invMax;
      out[i + 3] *= invMax;
    }
    for (let i = len4; i < len; i++) {
      out[i] *= invMax;
    }
  }

  return out;
}

// ─── Instrument mode pipeline ───────────────────────────────────────────────

/**
 * Build a conic instrument volume from frames.
 * All frames are stacked along Y axis (time axis).
 */
export function buildInstrumentVolume(
  frames: PreprocessedFrame[],
  beam: BeamSettings,
  grid: VolumeGridSettings,
  onProgress?: (current: number, total: number) => void,
): { normalized: Float32Array; dimensions: [number, number, number]; extent: [number, number, number] } {
  const halfAngle = (beam.beamAngleDeg / 2) * DEG2RAD;
  const maxRadius = coneRadiusAtDepth(beam.depthMaxM, halfAngle);
  const extentX = maxRadius * 2.5; // Extra room for Gaussian tails
  const extentZ = beam.depthMaxM;

  // Y axis = time/frames: scale proportionally to frame count
  // Use same voxel size as the Z axis so the volume grows naturally with video duration
  const voxelSize = extentZ / grid.resZ;
  const extentY = frames.length * voxelSize;

  // Resolution on Y: one slice per frame, capped for memory
  const resY = Math.min(frames.length, 512);

  const adjustedGrid: VolumeGridSettings = {
    ...grid,
    resY,
  };

  const volume = createEmptyVolume(adjustedGrid, extentX, extentY, extentZ);

  for (let i = 0; i < frames.length; i++) {
    const yi = Math.floor((i / frames.length) * adjustedGrid.resY);
    projectFrameIntoCone(frames[i], volume, beam, yi);
    onProgress?.(i + 1, frames.length);
  }

  const normalized = normalizeVolume(volume);
  return {
    normalized,
    dimensions: volume.dimensions,
    extent: volume.extent,
  };
}

// ─── Instrument mode: temporal window projection ─────────────────────────────

/**
 * Project a sliding window of frames into a cone volume (Mode A temporal).
 *
 * Instead of baking all frames into one static volume, this projects only
 * the frames around `centerIndex` (±windowHalf) into a fresh cone volume.
 * Recent frames are weighted more heavily for a natural "live sonar" feel.
 *
 * X axis = lateral (cone spread).
 * Y axis = frames within the window (track/time thickness).
 * Z axis = depth.
 */
export function projectFrameWindow(
  frames: PreprocessedFrame[],
  centerIndex: number,
  windowSize: number,
  beam: BeamSettings,
  grid: VolumeGridSettings,
): { normalized: Float32Array; dimensions: [number, number, number]; extent: [number, number, number] } {
  const halfAngle = (beam.beamAngleDeg / 2) * DEG2RAD;
  const maxRadius = coneRadiusAtDepth(beam.depthMaxM, halfAngle);
  // X = lateral: extra room for Gaussian tails
  const extentX = maxRadius * 2.5;
  // Y = track: thin — this is a live window, not full track
  const extentY = beam.depthMaxM * 0.5;
  const extentZ = beam.depthMaxM;

  const halfWin = Math.floor(windowSize / 2);
  const startIdx = Math.max(0, centerIndex - halfWin);
  const endIdx = Math.min(frames.length - 1, centerIndex + halfWin);
  const windowFrames = endIdx - startIdx + 1;

  const windowGrid: VolumeGridSettings = {
    resX: grid.resX,                                          // X = lateral
    resY: Math.min(grid.resY, Math.max(1, windowFrames)),     // Y = track (window frames)
    resZ: grid.resZ,
  };

  const volume = createEmptyVolume(windowGrid, extentX, extentY, extentZ);

  for (let i = startIdx; i <= endIdx; i++) {
    const localIdx = i - startIdx;
    const yi = windowFrames > 1
      ? Math.floor((localIdx / (windowFrames - 1)) * (windowGrid.resY - 1))
      : Math.floor(windowGrid.resY / 2);

    // Recency weight: frames closer to center are stronger
    const distFromCenter = Math.abs(i - centerIndex) / Math.max(1, halfWin);
    const recencyWeight = 1.0 - distFromCenter * 0.6; // 1.0 at center, 0.4 at edges

    projectFrameIntoConeWeighted(frames[i], volume, beam, yi, recencyWeight);
  }

  const normalized = normalizeVolume(volume);

  return {
    normalized,
    dimensions: volume.dimensions,
    extent: volume.extent,
  };
}

/**
 * Same as projectFrameIntoCone but with an extra weight multiplier.
 * X = lateral, Y = track (ySliceIndex), Z = depth.
 *
 * Optimized: precomputed invariants, minimized per-pixel work.
 */
function projectFrameIntoConeWeighted(
  frame: PreprocessedFrame,
  volume: ProbabilisticVolume,
  beam: BeamSettings,
  ySliceIndex: number,
  weight: number,
): void {
  const [resX, resY, resZ] = volume.dimensions;
  const [extX, , extZ] = volume.extent;
  const halfAngle = (beam.beamAngleDeg / 2) * DEG2RAD;
  const tanHalf = Math.tan(halfAngle);
  const originX = volume.origin[0];
  const invExtX_resX = resX / extX;
  const invExtZ_resZ = resZ / extZ;
  const latSigmaFactor = beam.lateralFalloffSigma;
  const dataLen = volume.data.length;
  const strideZ = resY * resX;
  const yOffset = ySliceIndex * resX;
  const invHeight = 1.0 / frame.height;
  const invWidth = 1.0 / frame.width;
  const nearFieldRow = Math.ceil((beam.nearFieldM / beam.depthMaxM) * frame.height);

  // Pre-compute per-col normalizedCol
  const colNorm = new Float32Array(frame.width);
  for (let col = 0; col < frame.width; col++) {
    colNorm[col] = (col * invWidth - 0.5) * 2;
  }

  for (let row = nearFieldRow; row < frame.height; row++) {
    const depth = row * invHeight * beam.depthMaxM;
    const zi = (depth * invExtZ_resZ) | 0;
    if (zi < 0 || zi >= resZ) continue;

    const radiusAtDepth = depth * tanHalf;
    const sigma = latSigmaFactor * radiusAtDepth;
    const invSigma2x2 = sigma > 0 ? -1.0 / (2 * sigma * sigma) : 0;
    const ziStride = zi * strideZ + yOffset;
    const rowOffset = row * frame.width;

    for (let col = 0; col < frame.width; col++) {
      const intensity = frame.intensity[rowOffset + col];
      if (intensity < 0.001) continue;

      const lateralOffset = colNorm[col] * radiusAtDepth;
      const gaussWeight = invSigma2x2 !== 0
        ? Math.exp(lateralOffset * lateralOffset * invSigma2x2)
        : 1.0;

      const xi = ((lateralOffset - originX) * invExtX_resX) | 0;
      if (xi < 0 || xi >= resX) continue;

      const voxelIdx = ziStride + xi;
      if (voxelIdx >= 0 && voxelIdx < dataLen) {
        const w = gaussWeight * weight;
        volume.data[voxelIdx] += intensity * w;
        volume.weights[voxelIdx] += w;
      }
    }
  }
}

// ─── Estimate memory ────────────────────────────────────────────────────────

export function estimateVolumeMemoryMB(grid: VolumeGridSettings): number {
  // data (Float32) + weights (Float32) = 8 bytes per voxel
  return (grid.resX * grid.resY * grid.resZ * 8) / (1024 * 1024);
}

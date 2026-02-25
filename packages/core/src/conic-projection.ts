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
  // dims/extent order: [lateral(X), track(Y), depth(Z)] — no swap, direct from grid
  const dims: [number, number, number] = [grid.resX, grid.resY, grid.resZ];
  const ext: [number, number, number] = [extentX, extentY, extentZ];
  return {
    data: new Float32Array(total),
    weights: new Float32Array(total),
    dimensions: dims,
    extent: ext,
    origin: [-extentX / 2, 0, 0],
  };
}

// ─── Single frame projection (Instrument mode) ─────────────────────────────

/**
 * Project a single frame into a conic volume (Mode A: Instrument).
 * The volume represents the cone itself — no GPS, time axis = Z.
 */
export function projectFrameIntoCone(
  frame: PreprocessedFrame,
  volume: ProbabilisticVolume,
  beam: BeamSettings,
  frameSliceIndex: number,
): void {
  // dims = [lateral(X), track(Y), depth(Z)], extent = [lateral, track, depth]
  const resX = volume.dimensions[0];
  const resTrack = volume.dimensions[1];
  const resDepth = volume.dimensions[2];
  const extX = volume.extent[0];
  const extDepth = volume.extent[2];
  const halfAngle = (beam.beamAngleDeg / 2) * DEG2RAD;

  for (let row = 0; row < frame.height; row++) {
    const depth = (row / frame.height) * beam.depthMaxM;
    if (depth < beam.nearFieldM) continue;

    const radiusAtDepth = coneRadiusAtDepth(depth, halfAngle);
    const sigma = beam.lateralFalloffSigma * radiusAtDepth;
    const sigma2x2 = 2 * sigma * sigma;

    const di = Math.floor((depth / extDepth) * resDepth);
    if (di < 0 || di >= resDepth) continue;

    for (let col = 0; col < frame.width; col++) {
      const intensity = frame.intensity[row * frame.width + col];
      if (intensity < 0.001) continue;

      const normalizedCol = (col / frame.width - 0.5) * 2;
      const lateralOffset = normalizedCol * radiusAtDepth;

      const lateralDist2 = lateralOffset * lateralOffset;
      const gaussWeight = sigma2x2 > 0
        ? Math.exp(-lateralDist2 / sigma2x2)
        : 1.0;

      const xi = Math.floor(((lateralOffset - volume.origin[0]) / extX) * resX);
      if (xi < 0 || xi >= resX) continue;

      // Z-outer (depth), Y-middle (track), X-inner (lateral)
      const voxelIdx = di * resTrack * resX + frameSliceIndex * resX + xi;
      if (voxelIdx >= 0 && voxelIdx < volume.data.length) {
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
 */
export function projectFramesSpatial(
  frames: PreprocessedFrame[],
  mappings: FrameMapping[],
  volume: ProbabilisticVolume,
  beam: BeamSettings,
  onProgress?: (current: number, total: number) => void,
): void {
  // dims = [lateral(X), track(Y), depth(Z)], extent = [lateral, track, depth]
  const [resX, resTrack, resDepth] = volume.dimensions;
  const [extX, extTrack, extDepth] = volume.extent;
  const halfAngle = (beam.beamAngleDeg / 2) * DEG2RAD;

  // Find distance range
  const distances = mappings.map((m) => m.distanceM);
  const minDist = Math.min(...distances);
  const maxDist = Math.max(...distances);
  const distRange = maxDist - minDist || 1;

  for (let fi = 0; fi < frames.length; fi++) {
    const frame = frames[fi];
    const mapping = mappings[fi];
    if (!mapping) continue;

    // Track position → Y axis (middle)
    const tNorm = (mapping.distanceM - minDist) / distRange;
    const ti = Math.floor(tNorm * (resTrack - 1));
    if (ti < 0 || ti >= resTrack) continue;

    for (let row = 0; row < frame.height; row++) {
      const depth = (row / frame.height) * beam.depthMaxM;
      if (depth < beam.nearFieldM) continue;

      const radiusAtDepth = coneRadiusAtDepth(depth, halfAngle);
      const sigma = beam.lateralFalloffSigma * radiusAtDepth;
      const sigma2x2 = 2 * sigma * sigma;

      // Depth → Z axis (outermost)
      const di = Math.floor((depth / extDepth) * resDepth);
      if (di < 0 || di >= resDepth) continue;

      for (let col = 0; col < frame.width; col++) {
        const intensity = frame.intensity[row * frame.width + col];
        if (intensity < 0.001) continue;

        const normalizedCol = (col / frame.width - 0.5) * 2;
        const lateralOffset = normalizedCol * radiusAtDepth;
        const lateralDist2 = lateralOffset * lateralOffset;
        const gaussWeight = sigma2x2 > 0
          ? Math.exp(-lateralDist2 / sigma2x2)
          : 1.0;

        const xi = Math.floor(((lateralOffset - volume.origin[0]) / extX) * resX);
        if (xi < 0 || xi >= resX) continue;

        // Z-outer (depth), Y-middle (track), X-inner (lateral)
        const voxelIdx = di * resTrack * resX + ti * resX + xi;
        if (voxelIdx >= 0 && voxelIdx < volume.data.length) {
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
 */
export function normalizeVolume(volume: ProbabilisticVolume): Float32Array {
  const out = new Float32Array(volume.data.length);
  let maxVal = 0;

  // First pass: normalize by weights
  for (let i = 0; i < volume.data.length; i++) {
    if (volume.weights[i] > 0) {
      out[i] = volume.data[i] / volume.weights[i];
      if (out[i] > maxVal) maxVal = out[i];
    }
  }

  // Second pass: normalize to 0–1 range
  if (maxVal > 0) {
    const invMax = 1.0 / maxVal;
    for (let i = 0; i < out.length; i++) {
      out[i] *= invMax;
    }
  }

  return out;
}

// ─── Instrument mode pipeline ───────────────────────────────────────────────

/**
 * Build a conic instrument volume from frames.
 * All frames are stacked along Y axis (track axis).
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
  // Use depth-proportional extent for Y so the volume has a sensible aspect ratio
  // (frame count made Y dominate enormously, producing an invisible thin slab)
  const extentY = beam.depthMaxM * 1.5;
  const extentZ = beam.depthMaxM;

  // Adjust Y resolution to match frame count
  const adjustedGrid: VolumeGridSettings = {
    ...grid,
    resY: Math.min(grid.resY, frames.length),
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
 * Build a rectangular volume from a sliding window of frames (Mode A temporal).
 *
 * For waterfall sonar images (single-beam):
 *   - frame rows  = depth   (top = shallow, bottom = deep)
 *   - frame cols  = track   (each column is one ping / time step)
 *   - frame index = track   (successive captures along the boat's path)
 *
 * Volume layout — Three.js axis convention (Y = vertical):
 *   - X = frame columns (track within one frame)    — downsampled to grid.resX
 *   - Y = frame rows    (depth, vertical in Three.js) — downsampled to grid.resZ
 *   - Z = frame index   (track between frames)      — windowSize frames
 *   - data[z * dimY * dimX + y * dimX + x]
 *
 * No cone projection: the data is stacked directly as a rectangular prism.
 */
export function projectFrameWindow(
  frames: PreprocessedFrame[],
  centerIndex: number,
  windowSize: number,
  beam: BeamSettings,
  grid: VolumeGridSettings,
): { normalized: Float32Array; dimensions: [number, number, number]; extent: [number, number, number] } {
  const halfWin = Math.floor(windowSize / 2);
  const startIdx = Math.max(0, centerIndex - halfWin);
  const endIdx = Math.min(frames.length - 1, centerIndex + halfWin);
  const windowFrameCount = endIdx - startIdx + 1;

  if (windowFrameCount === 0 || !frames[startIdx]) {
    return {
      normalized: new Float32Array(0),
      dimensions: [1, 1, 1],
      extent: [1, 1, 1],
    };
  }

  const frameW = frames[startIdx].width;
  const frameH = frames[startIdx].height;

  // Downsample to grid resolution
  // X = track within frame, Y = depth (vertical in Three.js), Z = frame index
  const dimX = Math.min(grid.resX, frameW);    // track within frame
  const dimY = Math.min(grid.resZ, frameH);     // depth (vertical)
  const dimZ = windowFrameCount;                // frames in window

  const data = new Float32Array(dimX * dimY * dimZ);

  for (let zi = 0; zi < dimZ; zi++) {
    const frame = frames[startIdx + zi];
    if (!frame) continue;

    // Recency weight: center frame is strongest
    const distFromCenter = Math.abs((startIdx + zi) - centerIndex) / Math.max(1, halfWin);
    const weight = 1.0 - distFromCenter * 0.6; // 1.0 at center, 0.4 at edges

    for (let yi = 0; yi < dimY; yi++) {
      const srcRow = Math.floor(yi * frameH / dimY);
      for (let xi = 0; xi < dimX; xi++) {
        const srcCol = Math.floor(xi * frameW / dimX);
        const srcIdx = srcRow * frameW + srcCol;
        const dstIdx = zi * dimY * dimX + yi * dimX + xi;
        data[dstIdx] = (frame.intensity[srcIdx] ?? 0) * weight;
      }
    }
  }

  // Normalize to [0, 1]
  let maxVal = 0;
  for (let i = 0; i < data.length; i++) {
    if (data[i] > maxVal) maxVal = data[i];
  }
  if (maxVal > 0) {
    const invMax = 1.0 / maxVal;
    for (let i = 0; i < data.length; i++) {
      data[i] *= invMax;
    }
  }

  // Physical extents: Y = depth (vertical), X = track width, Z = temporal window
  const extentY = beam.depthMaxM;
  const extentX = beam.depthMaxM * (frameW / frameH);
  const extentZ = extentX * (windowFrameCount / frameW);

  return {
    normalized: data,
    dimensions: [dimX, dimY, dimZ],
    extent: [extentX, extentY, extentZ],
  };
}

// ─── Estimate memory ────────────────────────────────────────────────────────

export function estimateVolumeMemoryMB(grid: VolumeGridSettings): number {
  // data (Float32) + weights (Float32) = 8 bytes per voxel
  return (grid.resX * grid.resY * grid.resZ * 8) / (1024 * 1024);
}

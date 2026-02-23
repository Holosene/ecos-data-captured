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
 */
export function projectFrameIntoCone(
  frame: PreprocessedFrame,
  volume: ProbabilisticVolume,
  beam: BeamSettings,
  ySliceIndex: number,
): void {
  const [resX, _resY, resZ] = volume.dimensions;
  const [extX, , extZ] = volume.extent;
  const halfAngle = (beam.beamAngleDeg / 2) * DEG2RAD;
  const maxRadius = coneRadiusAtDepth(beam.depthMaxM, halfAngle);

  for (let row = 0; row < frame.height; row++) {
    // Depth mapped from pixel row
    const depth = (row / frame.height) * beam.depthMaxM;
    if (depth < beam.nearFieldM) continue;

    const radiusAtDepth = coneRadiusAtDepth(depth, halfAngle);
    const sigma = beam.lateralFalloffSigma * radiusAtDepth;
    const sigma2x2 = 2 * sigma * sigma;

    // Map depth to Z voxel
    const zi = Math.floor((depth / extZ) * resZ);
    if (zi < 0 || zi >= resZ) continue;

    for (let col = 0; col < frame.width; col++) {
      const intensity = frame.intensity[row * frame.width + col];
      if (intensity < 0.001) continue;

      // Angular position within beam
      const normalizedCol = (col / frame.width - 0.5) * 2; // -1 to 1
      const lateralOffset = normalizedCol * radiusAtDepth;

      // Gaussian weight based on lateral distance from center
      const lateralDist2 = lateralOffset * lateralOffset;
      const gaussWeight = sigma2x2 > 0
        ? Math.exp(-lateralDist2 / sigma2x2)
        : 1.0;

      // Map lateral offset to X voxel
      const xWorld = lateralOffset;
      const xi = Math.floor(((xWorld - volume.origin[0]) / extX) * resX);
      if (xi < 0 || xi >= resX) continue;

      // Accumulate
      const voxelIdx = zi * volume.dimensions[1] * resX + ySliceIndex * resX + xi;
      if (voxelIdx >= 0 && voxelIdx < volume.data.length) {
        const weightedIntensity = intensity * gaussWeight;
        volume.data[voxelIdx] += weightedIntensity;
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
  const [resX, resY, resZ] = volume.dimensions;
  const [extX, extY, extZ] = volume.extent;
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

    // Y position in volume based on distance
    const yNorm = (mapping.distanceM - minDist) / distRange;
    const yi = Math.floor(yNorm * (resY - 1));
    if (yi < 0 || yi >= resY) continue;

    for (let row = 0; row < frame.height; row++) {
      const depth = (row / frame.height) * beam.depthMaxM;
      if (depth < beam.nearFieldM) continue;

      const radiusAtDepth = coneRadiusAtDepth(depth, halfAngle);
      const sigma = beam.lateralFalloffSigma * radiusAtDepth;
      const sigma2x2 = 2 * sigma * sigma;

      const zi = Math.floor((depth / extZ) * resZ);
      if (zi < 0 || zi >= resZ) continue;

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

        const voxelIdx = zi * resY * resX + yi * resX + xi;
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

// ─── Estimate memory ────────────────────────────────────────────────────────

export function estimateVolumeMemoryMB(grid: VolumeGridSettings): number {
  // data (Float32) + weights (Float32) = 8 bytes per voxel
  return (grid.resX * grid.resY * grid.resZ * 8) / (1024 * 1024);
}

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
  // dims/extent order: [lateral(X), depth(Y), track(Z)] — direct texture mapping
  const dims: [number, number, number] = [grid.resX, grid.resZ, grid.resY];
  const ext: [number, number, number] = [extentX, extentZ, extentY];
  console.log('[ECHOS] createEmptyVolume — grid:', JSON.stringify(grid),
    '→ dims [lat,depth,track]:', dims, '→ extent:', ext);
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
 *
 * Coordinate system (fixed direction, boat along Z+):
 *   X = lateral (perpendicular to boat heading)
 *   Y = depth  (beam axis, downward from transducer)
 *   Z = track  (boat forward direction, orthogonal to beam)
 *
 * @param trackPositionM — spatial position of this frame along the track axis (metres)
 */
export function projectFrameIntoCone(
  frame: PreprocessedFrame,
  volume: ProbabilisticVolume,
  beam: BeamSettings,
  trackPositionM: number,
): void {
  const resX = volume.dimensions[0];
  const resDepth = volume.dimensions[1];
  const resTrack = volume.dimensions[2];
  const extX = volume.extent[0];
  const extDepth = volume.extent[1];
  const extTrack = volume.extent[2];
  const halfAngle = (beam.beamAngleDeg / 2) * DEG2RAD;

  // Map spatial track position (metres) → grid index
  const ti = extTrack > 0
    ? Math.floor((trackPositionM / extTrack) * (resTrack - 1))
    : 0;
  if (ti < 0 || ti >= resTrack) return;

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

      // Z-outer (track), Y-middle (depth), X-inner (lateral)
      const voxelIdx = ti * resDepth * resX + di * resX + xi;
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
 * Frames are positioned along the Z axis according to GPS distance.
 */
export function projectFramesSpatial(
  frames: PreprocessedFrame[],
  mappings: FrameMapping[],
  volume: ProbabilisticVolume,
  beam: BeamSettings,
  onProgress?: (current: number, total: number) => void,
): void {
  // dims = [lateral(X), depth(Y), track(Z)], extent = [lateral, depth, track]
  const [resX, resDepth, resTrack] = volume.dimensions;
  const [extX, extDepth, extTrack] = volume.extent;
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

    // Track position → Z axis (outermost)
    const tNorm = (mapping.distanceM - minDist) / distRange;
    const ti = Math.floor(tNorm * (resTrack - 1));
    if (ti < 0 || ti >= resTrack) continue;

    for (let row = 0; row < frame.height; row++) {
      const depth = (row / frame.height) * beam.depthMaxM;
      if (depth < beam.nearFieldM) continue;

      const radiusAtDepth = coneRadiusAtDepth(depth, halfAngle);
      const sigma = beam.lateralFalloffSigma * radiusAtDepth;
      const sigma2x2 = 2 * sigma * sigma;

      // Depth → Y axis (middle)
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

        // Z-outer (track), Y-middle (depth), X-inner (lateral)
        const voxelIdx = ti * resDepth * resX + di * resX + xi;
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
 * All frames are stacked along Z axis (time/track axis).
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
  const trackExtent = volume.extent[2];

  for (let i = 0; i < frames.length; i++) {
    // Uniform spacing: map frame index → spatial position along track (metres)
    const trackPosM = frames.length > 1
      ? (i / (frames.length - 1)) * trackExtent
      : trackExtent / 2;
    projectFrameIntoCone(frames[i], volume, beam, trackPosM);
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
 * The Z axis maps to frames within the window (time thickness).
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
  const extentX = maxRadius * 2.5;
  const extentY = beam.depthMaxM * 0.5; // Thin Y — this is a live slice, not full track
  const extentZ = beam.depthMaxM;

  const halfWin = Math.floor(windowSize / 2);
  const startIdx = Math.max(0, centerIndex - halfWin);
  const endIdx = Math.min(frames.length - 1, centerIndex + halfWin);
  const windowFrames = endIdx - startIdx + 1;

  const windowGrid: VolumeGridSettings = {
    resX: grid.resX,
    resY: Math.min(grid.resY, Math.max(1, windowFrames)),
    resZ: grid.resZ,
  };

  const volume = createEmptyVolume(windowGrid, extentX, extentY, extentZ);
  const trackExtent = volume.extent[2];

  for (let i = startIdx; i <= endIdx; i++) {
    const localIdx = i - startIdx;

    // Uniform spacing: map window position → spatial track position (metres)
    const trackPosM = windowFrames > 1
      ? (localIdx / (windowFrames - 1)) * trackExtent
      : trackExtent / 2;

    // Recency weight: frames closer to center are stronger
    const distFromCenter = Math.abs(i - centerIndex) / Math.max(1, halfWin);
    const recencyWeight = 1.0 - distFromCenter * 0.6; // 1.0 at center, 0.4 at edges

    projectFrameIntoConeWeighted(frames[i], volume, beam, trackPosM, recencyWeight);
  }

  const normalized = normalizeVolume(volume);

  // ─── DIAGNOSTIC TEST: override with uniaxial test pattern ───
  // Fill only track slice yi=0 with 1.0, rest stays 0.0
  // This should produce a single bright slab at one end of the track axis (Box Z)
  const [testResX, testResDepth, testResTrack] = volume.dimensions;
  const testData = new Float32Array(testResX * testResDepth * testResTrack);
  for (let yi = 0; yi < testResTrack; yi++) {
    for (let di = 0; di < testResDepth; di++) {
      for (let xi = 0; xi < testResX; xi++) {
        const index = yi * (testResDepth * testResX) + di * testResX + xi;
        if (yi === 0) {
          testData[index] = 1.0;
        }
      }
    }
  }
  console.log('[ECHOS] TEST PATTERN — resX:', testResX, 'resDepth:', testResDepth, 'resTrack:', testResTrack);
  console.log('[ECHOS] TEST PATTERN — track=0 filled, data length:', testData.length);
  // ─── END DIAGNOSTIC TEST ───

  return {
    normalized: testData,
    dimensions: volume.dimensions,
    extent: volume.extent,
  };
}

/**
 * Same as projectFrameIntoCone but with an extra weight multiplier.
 *
 * @param trackPositionM — spatial position along the track axis (metres)
 */
function projectFrameIntoConeWeighted(
  frame: PreprocessedFrame,
  volume: ProbabilisticVolume,
  beam: BeamSettings,
  trackPositionM: number,
  weight: number,
): void {
  const resX = volume.dimensions[0];
  const resDepth = volume.dimensions[1];
  const resTrack = volume.dimensions[2];
  const extX = volume.extent[0];
  const extDepth = volume.extent[1];
  const extTrack = volume.extent[2];
  const halfAngle = (beam.beamAngleDeg / 2) * DEG2RAD;

  // Map spatial track position (metres) → grid index
  const ti = extTrack > 0
    ? Math.floor((trackPositionM / extTrack) * (resTrack - 1))
    : 0;
  if (ti < 0 || ti >= resTrack) return;

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

      // Z-outer (track), Y-middle (depth), X-inner (lateral)
      const voxelIdx = ti * resDepth * resX + di * resX + xi;
      if (voxelIdx >= 0 && voxelIdx < volume.data.length) {
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

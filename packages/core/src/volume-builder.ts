/**
 * Volume builder.
 *
 * Takes a sequence of grayscale frame slices (each mapped to a distance),
 * resamples them onto a regular Y-grid (y_step), and produces a 3D Float32Array.
 *
 * Volume layout: Float32Array of size dimX × dimY × dimZ
 * Index: data[z * dimY * dimX + y * dimX + x]
 *
 * Axes:
 *   X = horizontal position in sonar image (0..cropWidth)
 *   Y = distance along track (resampled at y_step intervals)
 *   Z = depth (0 = surface, depthMax = bottom)
 */

import type {
  FrameData,
  FrameMapping,
  Volume,
  VolumeMetadata,
  CalibrationSettings,
} from './types.js';

export interface VolumeBuilderInput {
  frames: FrameData[];
  mappings: FrameMapping[];
  calibration: CalibrationSettings;
}

interface ResampledSlice {
  distanceM: number;
  pixels: Float32Array;
  width: number;
  height: number;
}

/**
 * Resample frames onto a regular distance grid using linear interpolation.
 */
function resampleSlices(
  frames: FrameData[],
  mappings: FrameMapping[],
  yStepM: number,
): ResampledSlice[] {
  if (frames.length === 0) return [];

  // Sort by distance
  const indexed = frames
    .map((f, i) => ({ frame: f, mapping: mappings[i] }))
    .filter((item) => item.mapping !== undefined)
    .sort((a, b) => a.mapping.distanceM - b.mapping.distanceM);

  if (indexed.length === 0) return [];

  const minDist = indexed[0].mapping.distanceM;
  const maxDist = indexed[indexed.length - 1].mapping.distanceM;
  const totalDist = maxDist - minDist;

  if (totalDist <= 0) {
    // All frames at same distance — return single slice
    const f = indexed[0].frame;
    const pixels = new Float32Array(f.pixels.length);
    for (let i = 0; i < f.pixels.length; i++) {
      pixels[i] = f.pixels[i] / 255;
    }
    return [{ distanceM: minDist, pixels, width: f.width, height: f.height }];
  }

  const numSlices = Math.max(1, Math.floor(totalDist / yStepM) + 1);
  const { width, height } = indexed[0].frame;
  const slices: ResampledSlice[] = [];

  for (let yi = 0; yi < numSlices; yi++) {
    const targetDist = minDist + yi * yStepM;

    // Find surrounding frames for interpolation
    let lo = 0;
    let hi = indexed.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (indexed[mid].mapping.distanceM <= targetDist) {
        lo = mid;
      } else {
        hi = mid;
      }
    }

    const d0 = indexed[lo].mapping.distanceM;
    const d1 = indexed[hi].mapping.distanceM;
    const dd = d1 - d0;
    const t = dd > 0 ? Math.max(0, Math.min(1, (targetDist - d0) / dd)) : 0;

    const f0 = indexed[lo].frame;
    const f1 = indexed[hi].frame;

    // Linear interpolation between two frames (optimized: avoid per-pixel undef checks)
    const len = width * height;
    const pixels = new Float32Array(len);
    const p0 = f0.pixels;
    const p1 = f1.pixels;
    const inv255 = 1.0 / 255;
    const oneMinusT = 1.0 - t;
    // Unrolled 4x for throughput
    const len4 = (len >> 2) << 2;
    for (let i = 0; i < len4; i += 4) {
      pixels[i]     = (p0[i]     * oneMinusT + p1[i]     * t) * inv255;
      pixels[i + 1] = (p0[i + 1] * oneMinusT + p1[i + 1] * t) * inv255;
      pixels[i + 2] = (p0[i + 2] * oneMinusT + p1[i + 2] * t) * inv255;
      pixels[i + 3] = (p0[i + 3] * oneMinusT + p1[i + 3] * t) * inv255;
    }
    for (let i = len4; i < len; i++) {
      pixels[i] = (p0[i] * oneMinusT + p1[i] * t) * inv255;
    }

    slices.push({ distanceM: targetDist, pixels, width, height });
  }

  return slices;
}

/**
 * Build a 3D volume from frames and their GPS mappings.
 *
 * Memory estimate: dimX × dimY × dimZ × 4 bytes (Float32)
 * For 200×500×400 = 160 MB — we warn if exceeding limit.
 */
export function buildVolume(
  input: VolumeBuilderInput,
  onProgress?: (progress: number, message: string) => void,
): Volume {
  const { frames, mappings, calibration } = input;

  if (frames.length === 0) {
    throw new Error('No frames to build volume from.');
  }

  if (frames.length !== mappings.length) {
    throw new Error(
      `Frame count (${frames.length}) does not match mapping count (${mappings.length}).`,
    );
  }

  onProgress?.(0.1, 'Resampling slices onto regular grid...');

  const slices = resampleSlices(frames, mappings, calibration.yStepM);

  if (slices.length === 0) {
    throw new Error('Resampling produced 0 slices. Check your data and settings.');
  }

  const dimX = slices[0].width;
  const dimZ = slices[0].height;
  const dimY = slices.length;

  // Memory check (warn, don't block)
  const estimatedMB = (dimX * dimY * dimZ * 4) / (1024 * 1024);
  if (estimatedMB > 1024) {
    console.warn(
      `[ECOS] Volume size will be ~${estimatedMB.toFixed(0)} MB. Consider reducing resolution.`,
    );
  }

  onProgress?.(0.3, `Building volume: ${dimX}×${dimY}×${dimZ} (${estimatedMB.toFixed(1)} MB)...`);

  // Allocate volume
  const data = new Float32Array(dimX * dimY * dimZ);

  // Fill volume: data[z * dimY * dimX + y * dimX + x]
  // Optimized: copy row-by-row using TypedArray.set instead of pixel-by-pixel
  const strideZ = dimY * dimX;
  for (let yi = 0; yi < dimY; yi++) {
    const pixels = slices[yi].pixels;
    const yiOffset = yi * dimX;

    for (let zi = 0; zi < dimZ; zi++) {
      const srcOffset = zi * dimX;
      const dstOffset = zi * strideZ + yiOffset;
      data.set(pixels.subarray(srcOffset, srcOffset + dimX), dstOffset);
    }

    if (yi % 50 === 0) {
      onProgress?.(0.3 + 0.6 * (yi / dimY), `Filling volume slice ${yi}/${dimY}...`);
    }
  }

  // Compute spacing
  const totalDistanceM =
    slices.length > 1 ? slices[slices.length - 1].distanceM - slices[0].distanceM : 0;
  const ySpacing = calibration.yStepM;
  const zSpacing = calibration.depthMaxM / dimZ;
  const xSpacing = zSpacing; // Assume square pixels in sonar image (approximation)

  onProgress?.(1.0, 'Volume build complete.');

  const metadata: VolumeMetadata = {
    dimensions: [dimX, dimY, dimZ],
    spacing: [xSpacing, ySpacing, zSpacing],
    origin: [0, 0, 0],
    totalDistanceM,
    depthMaxM: calibration.depthMaxM,
    sourceFrameCount: frames.length,
    resampledSliceCount: dimY,
  };

  return { data, metadata };
}

/**
 * Estimate volume dimensions and memory usage before building.
 */
export function estimateVolume(
  cropWidth: number,
  cropHeight: number,
  totalDistanceM: number,
  yStepM: number,
  downscaleFactor: number,
): { dimX: number; dimY: number; dimZ: number; estimatedMB: number } {
  const dimX = Math.round(cropWidth * downscaleFactor);
  const dimZ = Math.round(cropHeight * downscaleFactor);
  const dimY = Math.max(1, Math.floor(totalDistanceM / yStepM) + 1);
  const estimatedMB = (dimX * dimY * dimZ * 4) / (1024 * 1024);
  return { dimX, dimY, dimZ, estimatedMB };
}

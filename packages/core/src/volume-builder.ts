/**
 * Volume builder.
 *
 * Takes a sequence of grayscale frame slices (each mapped to a distance),
 * resamples them onto a regular grid (y_step), and produces a 3D Float32Array.
 *
 * Volume layout: Float32Array of size dimX × dimY × dimZ
 * Index: data[z * dimY * dimX + y * dimX + x]
 *
 * Axes:
 *   X = distance along track (resampled at y_step intervals)
 *   Y = horizontal position in sonar image (lateral)
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

    // Linear interpolation between two frames
    const pixels = new Float32Array(width * height);
    for (let i = 0; i < width * height; i++) {
      const v0 = f0.pixels[i] !== undefined ? f0.pixels[i] / 255 : 0;
      const v1 = f1.pixels[i] !== undefined ? f1.pixels[i] / 255 : 0;
      pixels[i] = v0 + t * (v1 - v0);
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

  const dimX = slices.length;       // track (stacking direction)
  const dimY = slices[0].width;     // lateral
  const dimZ = slices[0].height;    // depth

  // Memory check (warn, don't block)
  const estimatedMB = (dimX * dimY * dimZ * 4) / (1024 * 1024);
  if (estimatedMB > 1024) {
    console.warn(
      `[ECHOS] Volume size will be ~${estimatedMB.toFixed(0)} MB. Consider reducing resolution.`,
    );
  }

  onProgress?.(0.3, `Building volume: ${dimX}×${dimY}×${dimZ} (${estimatedMB.toFixed(1)} MB)...`);

  // Allocate volume
  const data = new Float32Array(dimX * dimY * dimZ);

  // Fill volume: data[z * dimY * dimX + y * dimX + x]
  // Z-outer (depth), Y-middle (lateral), X-inner (track)
  for (let xi = 0; xi < dimX; xi++) {
    const slice = slices[xi];
    for (let zi = 0; zi < dimZ; zi++) {
      for (let yi = 0; yi < dimY; yi++) {
        const srcIdx = zi * dimY + yi;   // frame pixels: row-major [depth × width]
        const dstIdx = zi * dimY * dimX + yi * dimX + xi;
        data[dstIdx] = slice.pixels[srcIdx] ?? 0;
      }
    }

    if (xi % 50 === 0) {
      onProgress?.(0.3 + 0.6 * (xi / dimX), `Filling volume slice ${xi}/${dimX}...`);
    }
  }

  // Compute spacing
  const totalDistanceM =
    slices.length > 1 ? slices[slices.length - 1].distanceM - slices[0].distanceM : 0;
  const xSpacing = calibration.yStepM;             // track spacing (X axis)
  const zSpacing = calibration.depthMaxM / dimZ;   // depth spacing
  const ySpacing = zSpacing; // lateral spacing ≈ depth pixel size (approximation)

  onProgress?.(1.0, 'Volume build complete.');

  const metadata: VolumeMetadata = {
    dimensions: [dimX, dimY, dimZ],
    spacing: [xSpacing, ySpacing, zSpacing],
    origin: [0, 0, 0],
    totalDistanceM,
    depthMaxM: calibration.depthMaxM,
    sourceFrameCount: frames.length,
    resampledSliceCount: dimX,
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
  const dimX = Math.max(1, Math.floor(totalDistanceM / yStepM) + 1); // track
  const dimY = Math.round(cropWidth * downscaleFactor);    // lateral
  const dimZ = Math.round(cropHeight * downscaleFactor);   // depth
  const estimatedMB = (dimX * dimY * dimZ * 4) / (1024 * 1024);
  return { dimX, dimY, dimZ, estimatedMB };
}

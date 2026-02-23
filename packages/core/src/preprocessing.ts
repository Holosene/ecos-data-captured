/**
 * ECHOS V2 — Preprocessing pipeline
 *
 * Transforms raw sonar screen-capture frames into clean intensity data.
 * All operations run on CPU via Canvas API.
 *
 * Pipeline:
 * 1. Upscaling (bicubic via Canvas)
 * 2. Bilateral denoising
 * 3. Intensity extraction (luminance)
 * 4. Gamma correction
 * 5. Gaussian smoothing
 * 6. Block artifact removal (median filter)
 */

import type { PreprocessingSettings, PreprocessedFrame } from './v2-types.js';

// ─── Utility ────────────────────────────────────────────────────────────────

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

// ─── Upscale via Canvas ─────────────────────────────────────────────────────

function upscale(
  src: ImageData,
  factor: number,
): ImageData {
  if (factor <= 1) return src;

  const w = Math.round(src.width * factor);
  const h = Math.round(src.height * factor);

  const srcCanvas = new OffscreenCanvas(src.width, src.height);
  const srcCtx = srcCanvas.getContext('2d')!;
  srcCtx.putImageData(src, 0, 0);

  const dstCanvas = new OffscreenCanvas(w, h);
  const dstCtx = dstCanvas.getContext('2d')!;
  dstCtx.imageSmoothingEnabled = true;
  dstCtx.imageSmoothingQuality = 'high';
  dstCtx.drawImage(srcCanvas, 0, 0, w, h);

  return dstCtx.getImageData(0, 0, w, h);
}

// ─── Intensity extraction (luminance) ───────────────────────────────────────

function extractIntensity(imgData: ImageData): Float32Array {
  const { data, width, height } = imgData;
  const out = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    // ITU-R BT.709 luminance
    out[i] = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  }
  return out;
}

// ─── Gamma correction ───────────────────────────────────────────────────────

function applyGamma(pixels: Float32Array, gamma: number): void {
  if (gamma === 1.0) return;
  const invGamma = 1.0 / gamma;
  for (let i = 0; i < pixels.length; i++) {
    pixels[i] = Math.pow(clamp(pixels[i], 0, 1), invGamma);
  }
}

// ─── Gaussian blur (separable) ──────────────────────────────────────────────

function makeGaussianKernel(sigma: number): Float32Array {
  const radius = Math.ceil(sigma * 3);
  const size = radius * 2 + 1;
  const kernel = new Float32Array(size);
  let sum = 0;
  for (let i = 0; i < size; i++) {
    const x = i - radius;
    const v = Math.exp(-(x * x) / (2 * sigma * sigma));
    kernel[i] = v;
    sum += v;
  }
  for (let i = 0; i < size; i++) kernel[i] /= sum;
  return kernel;
}

function gaussianBlur(
  pixels: Float32Array,
  w: number,
  h: number,
  sigma: number,
): Float32Array {
  if (sigma <= 0) return pixels;

  const kernel = makeGaussianKernel(sigma);
  const radius = (kernel.length - 1) >> 1;
  const temp = new Float32Array(w * h);
  const out = new Float32Array(w * h);

  // Horizontal pass
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) {
        const sx = clamp(x + k, 0, w - 1);
        sum += pixels[y * w + sx] * kernel[k + radius];
      }
      temp[y * w + x] = sum;
    }
  }

  // Vertical pass
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) {
        const sy = clamp(y + k, 0, h - 1);
        sum += temp[sy * w + x] * kernel[k + radius];
      }
      out[y * w + x] = sum;
    }
  }

  return out;
}

// ─── Bilateral denoise ──────────────────────────────────────────────────────

function bilateralDenoise(
  pixels: Float32Array,
  w: number,
  h: number,
  strength: number,
): Float32Array {
  if (strength <= 0) return pixels;

  const spatialSigma = 2.0;
  const rangeSigma = 0.1 + strength * 0.3;
  const radius = Math.ceil(spatialSigma * 2);
  const out = new Float32Array(w * h);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const centerVal = pixels[y * w + x];
      let weightSum = 0;
      let valSum = 0;

      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = clamp(x + dx, 0, w - 1);
          const ny = clamp(y + dy, 0, h - 1);
          const neighborVal = pixels[ny * w + nx];

          const spatialDist2 = dx * dx + dy * dy;
          const rangeDist2 = (centerVal - neighborVal) ** 2;

          const weight =
            Math.exp(-spatialDist2 / (2 * spatialSigma * spatialSigma)) *
            Math.exp(-rangeDist2 / (2 * rangeSigma * rangeSigma));

          weightSum += weight;
          valSum += neighborVal * weight;
        }
      }

      out[y * w + x] = weightSum > 0 ? valSum / weightSum : centerVal;
    }
  }

  return out;
}

// ─── Block artifact removal (3x3 median) ────────────────────────────────────

function medianFilter3x3(
  pixels: Float32Array,
  w: number,
  h: number,
  strength: number,
): Float32Array {
  if (strength <= 0) return pixels;

  const out = new Float32Array(w * h);
  const window: number[] = new Array(9);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let idx = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = clamp(x + dx, 0, w - 1);
          const ny = clamp(y + dy, 0, h - 1);
          window[idx++] = pixels[ny * w + nx];
        }
      }
      window.sort((a, b) => a - b);
      const median = window[4];
      const original = pixels[y * w + x];
      out[y * w + x] = original + strength * (median - original);
    }
  }

  return out;
}

// ─── Auto-crop detection ────────────────────────────────────────────────────

/**
 * Auto-detect the sonar display region from a video frame.
 *
 * Strategy:
 *   1. Skip mobile status bar (top 6-8% of screen)
 *   2. Skip bottom navigation bar if present (bottom 5%)
 *   3. Analyze block-level variance to find the sonar echo region
 *   4. Exclude UI overlay panels (Profondeur, Température, menus)
 *      by looking for the largest high-variance rectangular region
 *
 * Returns an optimized CropRect.
 */
export function autoDetectCropRegion(
  imageData: ImageData,
): { x: number; y: number; width: number; height: number } {
  const { data, width, height } = imageData;

  // Step 1: Skip mobile status bar and bottom nav
  const statusBarH = Math.ceil(height * 0.07); // ~7% top for status bar
  const bottomNavH = Math.ceil(height * 0.04); // ~4% bottom for nav bar
  const safeTop = statusBarH;
  const safeBottom = height - bottomNavH;

  // Step 2: Divide the safe area into blocks and compute variance per block
  const blockSize = 16;
  const blocksW = Math.floor(width / blockSize);
  const blocksH = Math.floor((safeBottom - safeTop) / blockSize);
  const blockVariance = new Float32Array(blocksW * blocksH);

  for (let by = 0; by < blocksH; by++) {
    for (let bx = 0; bx < blocksW; bx++) {
      const startY = safeTop + by * blockSize;
      const startX = bx * blockSize;
      let sum = 0;
      let sumSq = 0;
      const count = blockSize * blockSize;

      for (let dy = 0; dy < blockSize; dy++) {
        for (let dx = 0; dx < blockSize; dx++) {
          const px = startX + dx;
          const py = startY + dy;
          const i = (py * width + px) * 4;
          const brightness = (data[i] + data[i + 1] + data[i + 2]) / 3;
          sum += brightness;
          sumSq += brightness * brightness;
        }
      }

      const mean = sum / count;
      const variance = sumSq / count - mean * mean;
      blockVariance[by * blocksW + bx] = variance;
    }
  }

  // Step 3: Find the high-variance threshold (sonar echo has high variance)
  // Use percentile-based threshold: the sonar area should be >30% of the frame
  const sortedVariances = Array.from(blockVariance).sort((a, b) => a - b);
  const p60 = sortedVariances[Math.floor(sortedVariances.length * 0.4)] || 0;
  const varianceThreshold = Math.max(p60, 100); // at least 100

  // Step 4: Find the bounding box of high-variance blocks
  let bTop = blocksH;
  let bBottom = 0;
  let bLeft = blocksW;
  let bRight = 0;

  for (let by = 0; by < blocksH; by++) {
    for (let bx = 0; bx < blocksW; bx++) {
      if (blockVariance[by * blocksW + bx] >= varianceThreshold) {
        if (by < bTop) bTop = by;
        if (by > bBottom) bBottom = by;
        if (bx < bLeft) bLeft = bx;
        if (bx > bRight) bRight = bx;
      }
    }
  }

  // Step 5: Refine — look for the largest contiguous high-variance rectangle
  // Count high-variance blocks per column to detect UI panels on the sides
  const colHighCount = new Float32Array(blocksW);
  for (let bx = 0; bx < blocksW; bx++) {
    let count = 0;
    for (let by = bTop; by <= bBottom; by++) {
      if (blockVariance[by * blocksW + bx] >= varianceThreshold) count++;
    }
    colHighCount[bx] = count / (bBottom - bTop + 1);
  }

  // Trim columns where less than 30% of rows have high variance (likely UI panels)
  while (bLeft < bRight && colHighCount[bLeft] < 0.3) bLeft++;
  while (bRight > bLeft && colHighCount[bRight] < 0.3) bRight--;

  // Same for rows
  const rowHighCount = new Float32Array(blocksH);
  for (let by = 0; by < blocksH; by++) {
    let count = 0;
    for (let bx = bLeft; bx <= bRight; bx++) {
      if (blockVariance[by * blocksW + bx] >= varianceThreshold) count++;
    }
    rowHighCount[by] = count / (bRight - bLeft + 1);
  }

  while (bTop < bBottom && rowHighCount[bTop] < 0.3) bTop++;
  while (bBottom > bTop && rowHighCount[bBottom] < 0.3) bBottom--;

  // Convert block coordinates to pixel coordinates
  let cropX = bLeft * blockSize;
  let cropY = safeTop + bTop * blockSize;
  let cropW = (bRight - bLeft + 1) * blockSize;
  let cropH = (bBottom - bTop + 1) * blockSize;

  // Clamp to image bounds
  cropX = Math.max(0, cropX);
  cropY = Math.max(0, cropY);
  cropW = Math.min(width - cropX, cropW);
  cropH = Math.min(height - cropY, cropH);

  // Safety: ensure minimum crop size (at least 30% of original)
  const minW = Math.floor(width * 0.3);
  const minH = Math.floor(height * 0.3);

  if (cropW < minW || cropH < minH) {
    // Fallback: use full frame minus status bar
    return {
      x: 0,
      y: statusBarH,
      width,
      height: safeBottom - statusBarH,
    };
  }

  return { x: cropX, y: cropY, width: cropW, height: cropH };
}

/**
 * Try to auto-detect the max depth from a sonar display frame.
 * Looks for depth scale markings along the left/right edges of the sonar image.
 * Returns estimated depth in meters, or null if detection fails.
 */
export function autoDetectDepthMax(
  imageData: ImageData,
  cropRegion: { x: number; y: number; width: number; height: number },
): number | null {
  const { data, width } = imageData;
  const { x: cx, y: cy, width: cw, height: ch } = cropRegion;

  // Strategy: sample the left and right edges of the crop region
  // Looking for depth scale patterns (dark background with bright text/lines)
  // The depth scale typically has horizontal ruler lines at regular intervals

  // Check both left and right margin zones (10% of crop width)
  const marginW = Math.max(10, Math.floor(cw * 0.1));

  // Count horizontal line features in left and right margins
  // (ruler lines appear as rows with sudden brightness change)
  const edgeTransitions: number[] = [];

  for (let side = 0; side < 2; side++) {
    const startX = side === 0 ? cx : cx + cw - marginW;

    for (let row = cy; row < cy + ch - 1; row++) {
      let rowMean = 0;
      let nextRowMean = 0;

      for (let col = startX; col < startX + marginW; col++) {
        const i1 = (row * width + col) * 4;
        const i2 = ((row + 1) * width + col) * 4;
        rowMean += (data[i1] + data[i1 + 1] + data[i1 + 2]) / 3;
        nextRowMean += (data[i2] + data[i2 + 1] + data[i2 + 2]) / 3;
      }

      rowMean /= marginW;
      nextRowMean /= marginW;

      // Sharp brightness transition = potential ruler line
      if (Math.abs(nextRowMean - rowMean) > 30) {
        edgeTransitions.push(row - cy);
      }
    }
  }

  // If we found regular ruler line intervals, estimate depth
  if (edgeTransitions.length >= 3) {
    // Find the most common interval between transitions
    const intervals: number[] = [];
    const sorted = [...new Set(edgeTransitions)].sort((a, b) => a - b);

    for (let i = 1; i < sorted.length; i++) {
      const gap = sorted[i] - sorted[i - 1];
      if (gap > ch * 0.05) { // minimum 5% of height between lines
        intervals.push(gap);
      }
    }

    if (intervals.length >= 2) {
      // Median interval
      intervals.sort((a, b) => a - b);
      const medianInterval = intervals[Math.floor(intervals.length / 2)];
      const numDivisions = Math.round(ch / medianInterval);

      // Common sonar depth settings: 5, 10, 15, 20, 30, 50, 100m
      // Typically the ruler shows divisions at round numbers
      const commonDepths = [5, 10, 15, 20, 25, 30, 40, 50, 60, 80, 100];

      // Estimate: numDivisions ruler lines typically span the full depth
      // Try to match to common depth values
      for (const depth of commonDepths) {
        const divSize = depth / numDivisions;
        // Check if divisions are round numbers (1, 2, 5, 10, etc.)
        if (divSize >= 1 && (divSize === Math.round(divSize)) &&
            [1, 2, 5, 10, 15, 20, 25].includes(Math.round(divSize))) {
          return depth;
        }
      }

      // Fallback: use numDivisions × 5m as rough estimate
      return Math.min(100, Math.max(5, numDivisions * 5));
    }
  }

  return null; // Detection failed
}

// ─── Main preprocessing pipeline ────────────────────────────────────────────

/**
 * Extract a single video frame as ImageData from a video element.
 */
export function extractFrameImageData(
  video: HTMLVideoElement,
  cropX: number,
  cropY: number,
  cropW: number,
  cropH: number,
): ImageData {
  const canvas = new OffscreenCanvas(cropW, cropH);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
  return ctx.getImageData(0, 0, cropW, cropH);
}

/**
 * Run the full preprocessing pipeline on a raw frame ImageData.
 * Returns a clean Float32 intensity array ready for conic projection.
 */
export function preprocessFrame(
  rawFrame: ImageData,
  settings: PreprocessingSettings,
): { intensity: Float32Array; width: number; height: number } {
  // 1. Upscale
  const scaled = upscale(rawFrame, settings.upscaleFactor);
  const w = scaled.width;
  const h = scaled.height;

  // 2. Extract intensity (grayscale luminance)
  let intensity = extractIntensity(scaled);

  // 3. Bilateral denoise
  intensity = bilateralDenoise(intensity, w, h, settings.denoiseStrength);

  // 4. Gamma correction
  applyGamma(intensity, settings.gamma);

  // 5. Gaussian smoothing
  intensity = gaussianBlur(intensity, w, h, settings.gaussianSigma);

  // 6. Block artifact removal
  intensity = medianFilter3x3(intensity, w, h, settings.deblockStrength);

  return { intensity, width: w, height: h };
}

/**
 * Batch-preprocess multiple frames. Returns preprocessed frame data.
 */
export function preprocessFrames(
  frames: Array<{ imageData: ImageData; index: number; timeS: number }>,
  settings: PreprocessingSettings,
  onProgress?: (current: number, total: number) => void,
): PreprocessedFrame[] {
  const results: PreprocessedFrame[] = [];

  for (let i = 0; i < frames.length; i++) {
    const { imageData, index, timeS } = frames[i];
    const { intensity, width, height } = preprocessFrame(imageData, settings);
    results.push({ index, timeS, intensity, width, height });
    onProgress?.(i + 1, frames.length);
  }

  return results;
}

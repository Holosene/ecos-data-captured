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

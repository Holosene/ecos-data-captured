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
  const len = width * height;
  const out = new Float32Array(len);
  // Unrolled loop: process 4 pixels per iteration to reduce loop overhead.
  // Uses integer approximation of BT.709: (r*55 + g*183 + b*18) >> 8 ≈ /255
  const len4 = (len >> 2) << 2;
  let j = 0;
  for (let i = 0; i < len4; i += 4) {
    const i0 = j; const i1 = j + 4; const i2 = j + 8; const i3 = j + 12;
    out[i]     = (data[i0] * 55 + data[i0 + 1] * 183 + data[i0 + 2] * 18) / 65280;
    out[i + 1] = (data[i1] * 55 + data[i1 + 1] * 183 + data[i1 + 2] * 18) / 65280;
    out[i + 2] = (data[i2] * 55 + data[i2 + 1] * 183 + data[i2 + 2] * 18) / 65280;
    out[i + 3] = (data[i3] * 55 + data[i3 + 1] * 183 + data[i3 + 2] * 18) / 65280;
    j += 16;
  }
  for (let i = len4; i < len; i++) {
    const off = i * 4;
    out[i] = (data[off] * 55 + data[off + 1] * 183 + data[off + 2] * 18) / 65280;
  }
  return out;
}

// ─── Gamma correction (LUT-accelerated) ─────────────────────────────────────

function applyGamma(pixels: Float32Array, gamma: number): void {
  if (gamma === 1.0) return;
  // Build a 1024-entry LUT to avoid per-pixel Math.pow
  const LUT_SIZE = 1024;
  const lut = new Float32Array(LUT_SIZE + 1);
  const invGamma = 1.0 / gamma;
  for (let i = 0; i <= LUT_SIZE; i++) {
    lut[i] = Math.pow(i / LUT_SIZE, invGamma);
  }
  for (let i = 0; i < pixels.length; i++) {
    const v = pixels[i];
    // Fast LUT lookup with linear interpolation
    const idx = (v < 0 ? 0 : v > 1 ? LUT_SIZE : v * LUT_SIZE);
    const lo = idx | 0; // fast floor
    const frac = idx - lo;
    pixels[i] = lut[lo] + frac * (lut[lo + 1 > LUT_SIZE ? LUT_SIZE : lo + 1] - lut[lo]);
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

  // Horizontal pass — avoid clamp() call in hot loop
  for (let y = 0; y < h; y++) {
    const yOff = y * w;

    // Left edge (needs clamping)
    for (let x = 0; x < radius && x < w; x++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) {
        const sx = x + k < 0 ? 0 : x + k;
        sum += pixels[yOff + sx] * kernel[k + radius];
      }
      temp[yOff + x] = sum;
    }

    // Center (no clamping needed)
    const xEnd = w - radius;
    for (let x = radius; x < xEnd; x++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) {
        sum += pixels[yOff + x + k] * kernel[k + radius];
      }
      temp[yOff + x] = sum;
    }

    // Right edge (needs clamping)
    for (let x = Math.max(radius, xEnd); x < w; x++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) {
        const sx = x + k >= w ? w - 1 : x + k;
        sum += pixels[yOff + sx] * kernel[k + radius];
      }
      temp[yOff + x] = sum;
    }
  }

  // Vertical pass — avoid clamp() call in hot loop
  // Top edge
  for (let y = 0; y < radius && y < h; y++) {
    const yOff = y * w;
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) {
        const sy = y + k < 0 ? 0 : y + k;
        sum += temp[sy * w + x] * kernel[k + radius];
      }
      out[yOff + x] = sum;
    }
  }

  // Center rows
  const yEnd = h - radius;
  for (let y = radius; y < yEnd; y++) {
    const yOff = y * w;
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) {
        sum += temp[(y + k) * w + x] * kernel[k + radius];
      }
      out[yOff + x] = sum;
    }
  }

  // Bottom edge
  for (let y = Math.max(radius, yEnd); y < h; y++) {
    const yOff = y * w;
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) {
        const sy = y + k >= h ? h - 1 : y + k;
        sum += temp[sy * w + x] * kernel[k + radius];
      }
      out[yOff + x] = sum;
    }
  }

  return out;
}

// ─── Bilateral denoise (fast LUT-based) ─────────────────────────────────────

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

  // Pre-compute spatial weight LUT (kernel is symmetric, index by dx*dx+dy*dy)
  const maxSpatialDist2 = 2 * radius * radius;
  const spatialLUT = new Float32Array(maxSpatialDist2 + 1);
  const invSpatial2 = -1 / (2 * spatialSigma * spatialSigma);
  for (let d2 = 0; d2 <= maxSpatialDist2; d2++) {
    spatialLUT[d2] = Math.exp(d2 * invSpatial2);
  }

  // Pre-compute range weight LUT (quantize intensity diff to 256 levels)
  const RANGE_LUT_SIZE = 256;
  const rangeLUT = new Float32Array(RANGE_LUT_SIZE);
  const invRange2 = -1 / (2 * rangeSigma * rangeSigma);
  for (let i = 0; i < RANGE_LUT_SIZE; i++) {
    const diff = i / RANGE_LUT_SIZE; // max diff is 1.0
    rangeLUT[i] = Math.exp(diff * diff * invRange2);
  }

  for (let y = 0; y < h; y++) {
    const yOff = y * w;
    // Pre-compute clamped y bounds
    const yMin = Math.max(0, y - radius);
    const yMax = Math.min(h - 1, y + radius);

    for (let x = 0; x < w; x++) {
      const centerVal = pixels[yOff + x];
      let weightSum = 0;
      let valSum = 0;

      // Pre-compute clamped x bounds
      const xMin = Math.max(0, x - radius);
      const xMax = Math.min(w - 1, x + radius);

      for (let ny = yMin; ny <= yMax; ny++) {
        const dy = ny - y;
        const dy2 = dy * dy;
        const nyOff = ny * w;

        for (let nx = xMin; nx <= xMax; nx++) {
          const dx = nx - x;
          const spatialDist2 = dx * dx + dy2;
          const neighborVal = pixels[nyOff + nx];

          const rangeDiff = Math.abs(centerVal - neighborVal);
          const rangeIdx = (rangeDiff * RANGE_LUT_SIZE) | 0; // fast floor
          const rangeWeight = rangeIdx < RANGE_LUT_SIZE ? rangeLUT[rangeIdx] : 0;

          const weight = spatialLUT[spatialDist2] * rangeWeight;
          weightSum += weight;
          valSum += neighborVal * weight;
        }
      }

      out[yOff + x] = weightSum > 0 ? valSum / weightSum : centerVal;
    }
  }

  return out;
}

// ─── Block artifact removal (3x3 median) ────────────────────────────────────

// Sorting network for 9 elements to find median — zero allocation, no Array.sort
function median9(a: number, b: number, c: number, d: number, e: number,
                 f: number, g: number, h: number, i: number): number {
  // Optimal sorting network for finding median of 9 (only 19 comparisons)
  let t: number;
  if (a > b) { t = a; a = b; b = t; }
  if (d > e) { t = d; d = e; e = t; }
  if (g > h) { t = g; g = h; h = t; }
  if (a > d) { t = a; a = d; d = t; t = b; b = e; e = t; }
  if (g > d) { t = g; g = d; d = t; t = h; h = e; e = t; }  // now a <= d <= g (3 min sorted)
  if (b > c) { t = b; b = c; c = t; }
  if (e > f) { t = e; e = f; f = t; }
  if (h > i) { t = h; h = i; i = t; }
  // Median is max(min-of-3-maxes, max-of-3-mins, middle-of-middles)
  // Simplified: use partial sort to get 5th element
  if (b > e) { t = b; b = e; e = t; }
  if (e > h) { t = e; e = h; h = t; }
  if (b > e) { t = b; b = e; e = t; }
  if (d > e) { t = d; d = e; e = t; }
  if (e > f) { t = e; e = f; f = t; }
  return e;
}

function medianFilter3x3(
  pixels: Float32Array,
  w: number,
  h: number,
  strength: number,
): Float32Array {
  if (strength <= 0) return pixels;

  const out = new Float32Array(w * h);

  for (let y = 0; y < h; y++) {
    const yOff = y * w;
    const y0 = (y > 0 ? y - 1 : 0) * w;
    const y1 = yOff;
    const y2 = (y < h - 1 ? y + 1 : y) * w;

    for (let x = 0; x < w; x++) {
      const x0 = x > 0 ? x - 1 : 0;
      const x2 = x < w - 1 ? x + 1 : x;

      const med = median9(
        pixels[y0 + x0], pixels[y0 + x], pixels[y0 + x2],
        pixels[y1 + x0], pixels[y1 + x], pixels[y1 + x2],
        pixels[y2 + x0], pixels[y2 + x], pixels[y2 + x2],
      );
      const original = pixels[yOff + x];
      out[yOff + x] = original + strength * (med - original);
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

  // Step 1: Aggressively skip mobile UI chrome.
  // Phone screen recordings typically have:
  //   - Status bar (~5%) + app toolbar (~10%) at top = ~15%
  //   - Bottom nav bar + controls (~10-12%) at bottom
  const statusBarH = Math.ceil(height * 0.15); // top 15%: status bar + app toolbar
  const bottomNavH = Math.ceil(height * 0.12); // bottom 12%: nav bar + controls
  const safeTop = statusBarH;
  const safeBottom = height - bottomNavH;

  // Step 2: Use finer blocks (8×8) for more precise detection
  const blockSize = 8;
  const blocksW = Math.floor(width / blockSize);
  const blocksH = Math.floor((safeBottom - safeTop) / blockSize);
  if (blocksW < 2 || blocksH < 2) {
    return { x: 0, y: safeTop, width, height: safeBottom - safeTop };
  }

  const blockVariance = new Float32Array(blocksW * blocksH);
  const blockBrightness = new Float32Array(blocksW * blocksH);

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
      blockBrightness[by * blocksW + bx] = mean;
    }
  }

  // Step 3: Detect sonar area vs UI.
  // Sonar display: dark background with scattered bright echoes = moderate-to-high variance + low-to-medium brightness.
  // UI elements (toolbars, buttons, text): either very uniform (low variance) or bright with icons.
  // Strategy: look for blocks that have sonar-like characteristics.
  const sortedVariances = Array.from(blockVariance).sort((a, b) => a - b);
  const medianVariance = sortedVariances[Math.floor(sortedVariances.length * 0.5)] || 0;

  // Use 30th percentile as threshold — sonar area should cover a significant portion
  const p30 = sortedVariances[Math.floor(sortedVariances.length * 0.3)] || 0;
  const varianceThreshold = Math.max(p30, 50); // lowered from 100 for better sensitivity

  // Also detect rows/columns that are uniformly colored (UI bars):
  // compute per-row average brightness variance to find solid-colored horizontal bars
  const rowUniformity = new Float32Array(blocksH);
  for (let by = 0; by < blocksH; by++) {
    let brightnessSum = 0;
    let brightnessSqSum = 0;
    for (let bx = 0; bx < blocksW; bx++) {
      const b = blockBrightness[by * blocksW + bx];
      brightnessSum += b;
      brightnessSqSum += b * b;
    }
    const mean = brightnessSum / blocksW;
    rowUniformity[by] = brightnessSqSum / blocksW - mean * mean;
  }

  // Step 4: Find the bounding box of high-variance blocks (sonar content)
  let bTop = blocksH;
  let bBottom = 0;
  let bLeft = blocksW;
  let bRight = 0;

  for (let by = 0; by < blocksH; by++) {
    // Skip rows that are very uniform across the width (likely UI bars)
    if (rowUniformity[by] < 20) continue;

    for (let bx = 0; bx < blocksW; bx++) {
      if (blockVariance[by * blocksW + bx] >= varianceThreshold) {
        if (by < bTop) bTop = by;
        if (by > bBottom) bBottom = by;
        if (bx < bLeft) bLeft = bx;
        if (bx > bRight) bRight = bx;
      }
    }
  }

  // No valid blocks found — fallback
  if (bTop >= bBottom || bLeft >= bRight) {
    return { x: 0, y: safeTop, width, height: safeBottom - safeTop };
  }

  // Step 5: Refine — trim edges with sparse sonar content
  const colHighCount = new Float32Array(blocksW);
  for (let bx = 0; bx < blocksW; bx++) {
    let count = 0;
    for (let by = bTop; by <= bBottom; by++) {
      if (blockVariance[by * blocksW + bx] >= varianceThreshold) count++;
    }
    colHighCount[bx] = count / (bBottom - bTop + 1);
  }

  // Trim columns with less than 40% coverage (likely side UI panels / depth ruler)
  while (bLeft < bRight && colHighCount[bLeft] < 0.4) bLeft++;
  while (bRight > bLeft && colHighCount[bRight] < 0.4) bRight--;

  const rowHighCount = new Float32Array(blocksH);
  for (let by = 0; by < blocksH; by++) {
    let count = 0;
    for (let bx = bLeft; bx <= bRight; bx++) {
      if (blockVariance[by * blocksW + bx] >= varianceThreshold) count++;
    }
    rowHighCount[by] = count / (bRight - bLeft + 1);
  }

  // Trim rows with less than 40% coverage (UI bars at edges of sonar area)
  while (bTop < bBottom && rowHighCount[bTop] < 0.4) bTop++;
  while (bBottom > bTop && rowHighCount[bBottom] < 0.4) bBottom--;

  // Step 6: Additional refinement — detect and remove side panels
  // Check if left or right 15% of detected area has very different brightness (depth ruler)
  const detectedW = bRight - bLeft + 1;
  const sideCheckBlocks = Math.max(1, Math.floor(detectedW * 0.12));

  // Check left side
  let leftAvgBrightness = 0;
  let centerAvgBrightness = 0;
  const centerStart = bLeft + sideCheckBlocks;
  const centerEnd = bRight - sideCheckBlocks;

  if (centerStart < centerEnd) {
    let leftCount = 0;
    let centerCount = 0;

    for (let by = bTop; by <= bBottom; by++) {
      for (let bx = bLeft; bx < bLeft + sideCheckBlocks; bx++) {
        leftAvgBrightness += blockBrightness[by * blocksW + bx];
        leftCount++;
      }
      for (let bx = centerStart; bx <= centerEnd; bx++) {
        centerAvgBrightness += blockBrightness[by * blocksW + bx];
        centerCount++;
      }
    }

    leftAvgBrightness /= Math.max(1, leftCount);
    centerAvgBrightness /= Math.max(1, centerCount);

    // If left panel is significantly brighter (UI/ruler), trim it
    if (leftAvgBrightness > centerAvgBrightness * 1.8) {
      bLeft += sideCheckBlocks;
    }

    // Check right side
    let rightAvgBrightness = 0;
    let rightCount = 0;
    for (let by = bTop; by <= bBottom; by++) {
      for (let bx = bRight - sideCheckBlocks + 1; bx <= bRight; bx++) {
        rightAvgBrightness += blockBrightness[by * blocksW + bx];
        rightCount++;
      }
    }
    rightAvgBrightness /= Math.max(1, rightCount);

    if (rightAvgBrightness > centerAvgBrightness * 1.8) {
      bRight -= sideCheckBlocks;
    }
  }

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

  // Safety: ensure minimum crop size (at least 25% of original)
  const minW = Math.floor(width * 0.25);
  const minH = Math.floor(height * 0.25);

  if (cropW < minW || cropH < minH) {
    // Fallback: use frame minus generous UI margins
    return {
      x: 0,
      y: safeTop,
      width,
      height: safeBottom - safeTop,
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

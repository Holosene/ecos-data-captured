/**
 * ECOS V2 — Preprocessing pipeline
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

  // ── Step 1: Adaptive status-bar / nav-bar detection ─────────────────────
  // Scan rows for horizontal uniform bands (solid-color bars / status bars).
  const ROW_SAMPLE_STEP = 2;
  const rowBrightness = new Float32Array(height);
  const rowVariance = new Float32Array(height);

  for (let y = 0; y < height; y++) {
    let sum = 0;
    let sumSq = 0;
    let count = 0;
    for (let x = 0; x < width; x += ROW_SAMPLE_STEP) {
      const i = (y * width + x) * 4;
      const b = (data[i] + data[i + 1] + data[i + 2]) / 3;
      sum += b;
      sumSq += b * b;
      count++;
    }
    const mean = sum / count;
    rowBrightness[y] = mean;
    rowVariance[y] = sumSq / count - mean * mean;
  }

  // Find top content edge: scan down from top, skip uniform rows
  // (status bar, dark header bar, solid-color toolbars)
  // Also skip rows that are very dark AND uniform (sonar app dark headers)
  const UNIFORM_THRESHOLD = 25;
  let safeTop = 0;
  for (let y = 0; y < Math.floor(height * 0.40); y++) {
    if (rowVariance[y] > UNIFORM_THRESHOLD) break;
    safeTop = y + 1;
  }

  // Find bottom content edge: scan up from bottom
  let safeBottom = height;
  for (let y = height - 1; y > Math.floor(height * 0.60); y--) {
    if (rowVariance[y] > UNIFORM_THRESHOLD) break;
    safeBottom = y;
  }

  // Detect toolbar bands (UI overlays within the content zone)
  const TOOLBAR_MIN_HEIGHT = 4;
  const toolbarBands: Array<{ top: number; bottom: number }> = [];
  let bandStart = -1;
  for (let y = safeTop; y < safeBottom; y++) {
    if (rowVariance[y] < UNIFORM_THRESHOLD && rowBrightness[y] > 35) {
      if (bandStart === -1) bandStart = y;
    } else {
      if (bandStart !== -1 && y - bandStart >= TOOLBAR_MIN_HEIGHT) {
        if (y - bandStart < height * 0.08) {
          toolbarBands.push({ top: bandStart, bottom: y });
        }
      }
      bandStart = -1;
    }
  }

  for (const band of toolbarBands) {
    if (band.top <= safeTop + height * 0.05) safeTop = band.bottom;
    if (band.bottom >= safeBottom - height * 0.05) safeBottom = band.top;
  }

  // ── Step 1b: Skip sonar UI text overlays at top of content area ──────
  // Sonar apps (Deeper, Lowrance) overlay depth/temp text in the top ~10%
  // of the sonar zone. These are sparse bright pixels on dark background.
  // Detect by checking if rows have mostly dark pixels with a few bright spots
  // (text) vs genuine sonar content (broad variance across the full row width).
  const textOverlayEnd = Math.min(safeTop + Math.ceil(height * 0.12), safeBottom);
  for (let y = safeTop; y < textOverlayEnd; y++) {
    // Count bright pixel clusters in this row (bright = >120)
    let brightRuns = 0;
    let inBright = false;
    let brightPixels = 0;
    let totalSampled = 0;
    for (let x = 0; x < width; x += ROW_SAMPLE_STEP) {
      const i = (y * width + x) * 4;
      const b = (data[i] + data[i + 1] + data[i + 2]) / 3;
      totalSampled++;
      if (b > 120) {
        brightPixels++;
        if (!inBright) { brightRuns++; inBright = true; }
      } else {
        inBright = false;
      }
    }
    const brightRatio = brightPixels / totalSampled;
    // Text overlay: few bright clusters (<15% bright pixels) on dark background
    // vs sonar content: more distributed brightness variations
    if (brightRuns > 0 && brightRuns <= 6 && brightRatio < 0.15 && brightRatio > 0.005) {
      safeTop = y + 1;
    } else if (brightRatio >= 0.15 || rowVariance[y] > UNIFORM_THRESHOLD * 2) {
      break; // genuine sonar content starts
    }
  }

  // Safety: ensure we have enough area to analyze
  if (safeBottom - safeTop < height * 0.2) {
    safeTop = Math.ceil(height * 0.08);
    safeBottom = height - Math.ceil(height * 0.06);
  }

  // ── Step 2: Block-level analysis (6×6 blocks for precision) ─────────────
  const blockSize = 6;
  const blocksW = Math.floor(width / blockSize);
  const blocksH = Math.floor((safeBottom - safeTop) / blockSize);
  if (blocksW < 3 || blocksH < 3) {
    return { x: 0, y: safeTop, width, height: safeBottom - safeTop };
  }

  const blockVar = new Float32Array(blocksW * blocksH);
  const blockBri = new Float32Array(blocksW * blocksH);
  const blockSat = new Float32Array(blocksW * blocksH); // color saturation

  for (let by = 0; by < blocksH; by++) {
    for (let bx = 0; bx < blocksW; bx++) {
      const startY = safeTop + by * blockSize;
      const startX = bx * blockSize;
      let sum = 0;
      let sumSq = 0;
      let satSum = 0;
      const count = blockSize * blockSize;

      for (let dy = 0; dy < blockSize; dy++) {
        for (let dx = 0; dx < blockSize; dx++) {
          const i = ((startY + dy) * width + startX + dx) * 4;
          const r = data[i], g = data[i + 1], bl = data[i + 2];
          const brightness = (r + g + bl) / 3;
          sum += brightness;
          sumSq += brightness * brightness;
          // Saturation: how colorful vs gray
          const maxC = Math.max(r, g, bl);
          const minC = Math.min(r, g, bl);
          satSum += maxC > 0 ? (maxC - minC) / maxC : 0;
        }
      }

      const mean = sum / count;
      const idx = by * blocksW + bx;
      blockVar[idx] = sumSq / count - mean * mean;
      blockBri[idx] = mean;
      blockSat[idx] = satSum / count;
    }
  }

  // ── Step 3: Sonar vs UI discrimination ──────────────────────────────────
  // Sonar characteristics:
  //   - Dark background (brightness < 100) with scattered bright echoes
  //   - Low-to-moderate variance (ocean floor) or high variance (echo regions)
  //   - Low color saturation (sonar is typically monochrome/single-hue)
  // UI characteristics:
  //   - Very uniform (low variance) and often bright: buttons, toolbars
  //   - OR high saturation: colored icons, indicators
  //   - OR very high brightness: white backgrounds

  // Compute per-column brightness profiles (vertical stripes indicate side panels)
  const colAvgBri = new Float32Array(blocksW);
  const colAvgVar = new Float32Array(blocksW);
  for (let bx = 0; bx < blocksW; bx++) {
    let briSum = 0;
    let varSum = 0;
    for (let by = 0; by < blocksH; by++) {
      briSum += blockBri[by * blocksW + bx];
      varSum += blockVar[by * blocksW + bx];
    }
    colAvgBri[bx] = briSum / blocksH;
    colAvgVar[bx] = varSum / blocksH;
  }

  // Detect side panels: columns that are significantly brighter or more uniform than the center
  const centerColStart = Math.floor(blocksW * 0.3);
  const centerColEnd = Math.floor(blocksW * 0.7);
  let centerBri = 0;
  let centerVar = 0;
  let centerCount = 0;
  for (let bx = centerColStart; bx < centerColEnd; bx++) {
    centerBri += colAvgBri[bx];
    centerVar += colAvgVar[bx];
    centerCount++;
  }
  centerBri /= Math.max(1, centerCount);
  centerVar /= Math.max(1, centerCount);

  // Find left content edge: skip columns that are consistently different from center
  let leftEdge = 0;
  for (let bx = 0; bx < centerColStart; bx++) {
    const briDiff = Math.abs(colAvgBri[bx] - centerBri);
    const isPanel = briDiff > 25 || (colAvgVar[bx] < centerVar * 0.15 && colAvgBri[bx] > centerBri * 1.3);
    if (isPanel) leftEdge = bx + 1;
    else break;
  }

  // Find right content edge
  let rightEdge = blocksW - 1;
  for (let bx = blocksW - 1; bx > centerColEnd; bx--) {
    const briDiff = Math.abs(colAvgBri[bx] - centerBri);
    const isPanel = briDiff > 25 || (colAvgVar[bx] < centerVar * 0.15 && colAvgBri[bx] > centerBri * 1.3);
    if (isPanel) rightEdge = bx - 1;
    else break;
  }

  // ── Step 4: Find sonar content bounding box (within trimmed columns) ────
  // Use adaptive threshold: Otsu-like method on block variance within the safe region
  const safeVars: number[] = [];
  for (let by = 0; by < blocksH; by++) {
    for (let bx = leftEdge; bx <= rightEdge; bx++) {
      safeVars.push(blockVar[by * blocksW + bx]);
    }
  }
  safeVars.sort((a, b) => a - b);

  // Otsu threshold: find the variance value that best separates background from content
  const totalN = safeVars.length;
  let bestThreshold = Math.max(safeVars[Math.floor(totalN * 0.2)] || 0, 15);
  let bestBetween = 0;
  const totalSum = safeVars.reduce((s, v) => s + v, 0);
  let sumBg = 0;
  let countBg = 0;

  for (let i = 0; i < totalN - 1; i++) {
    countBg++;
    sumBg += safeVars[i];
    const countFg = totalN - countBg;
    if (countFg === 0) break;
    const meanBg = sumBg / countBg;
    const meanFg = (totalSum - sumBg) / countFg;
    const between = countBg * countFg * (meanBg - meanFg) * (meanBg - meanFg);
    if (between > bestBetween) {
      bestBetween = between;
      bestThreshold = safeVars[i];
    }
  }
  // Ensure minimum sensitivity
  bestThreshold = Math.max(bestThreshold, 10);

  // Find bounding box of sonar content blocks
  let bTop = blocksH;
  let bBottom = 0;
  let bLeft = rightEdge;
  let bRight = leftEdge;

  for (let by = 0; by < blocksH; by++) {
    for (let bx = leftEdge; bx <= rightEdge; bx++) {
      const idx = by * blocksW + bx;
      // Sonar block: has some variance (not solid) AND not excessively bright UI
      if (blockVar[idx] >= bestThreshold && blockBri[idx] < 200) {
        if (by < bTop) bTop = by;
        if (by > bBottom) bBottom = by;
        if (bx < bLeft) bLeft = bx;
        if (bx > bRight) bRight = bx;
      }
    }
  }

  if (bTop >= bBottom || bLeft >= bRight) {
    return { x: 0, y: safeTop, width, height: safeBottom - safeTop };
  }

  // ── Step 5: Fine-grain edge trimming using gradient analysis ────────────
  // Compute coverage density per column and row within the detected region
  const regionH = bBottom - bTop + 1;
  const regionW = bRight - bLeft + 1;

  // Column coverage (trim sparse edges)
  for (let bx = bLeft; bx <= bRight; bx++) {
    let count = 0;
    for (let by = bTop; by <= bBottom; by++) {
      if (blockVar[by * blocksW + bx] >= bestThreshold) count++;
    }
    if (count / regionH < 0.2) { // very sparse column
      if (bx === bLeft) bLeft++;
      else if (bx === bRight) bRight--;
    }
  }

  // Row coverage (trim sparse edges)
  for (let by = bTop; by <= bBottom; by++) {
    let count = 0;
    for (let bx = bLeft; bx <= bRight; bx++) {
      if (blockVar[by * blocksW + bx] >= bestThreshold) count++;
    }
    if (count / regionW < 0.2) {
      if (by === bTop) bTop++;
      else if (by === bBottom) bBottom--;
    }
  }

  // ── Step 6: Detect strong horizontal/vertical edges at content boundaries ──
  // Look for sharp brightness transitions that indicate panel borders.
  // Scan the left edge columns for a vertical brightness step.
  const checkSidePanel = (startBx: number, endBx: number, dir: 1 | -1): number => {
    let edge = startBx;
    for (let bx = startBx; bx !== endBx; bx += dir) {
      const nextBx = bx + dir;
      if (nextBx < 0 || nextBx >= blocksW) break;
      // Compute brightness difference between adjacent columns
      let diffSum = 0;
      let diffCount = 0;
      for (let by = bTop; by <= bBottom; by++) {
        const bri1 = blockBri[by * blocksW + bx];
        const bri2 = blockBri[by * blocksW + nextBx];
        diffSum += Math.abs(bri1 - bri2);
        diffCount++;
      }
      const avgDiff = diffSum / Math.max(1, diffCount);
      // Strong edge: brightness changes by > 15 between adjacent columns
      if (avgDiff > 15) {
        // The panel is on the side of the edge with higher brightness
        const sideAvg = blockBri.slice(bTop * blocksW, (bBottom + 1) * blocksW)
          .reduce((s, _, i) => {
            const by2 = Math.floor(i / blocksW) + bTop;
            return by2 >= bTop && by2 <= bBottom && (i % blocksW) === bx ? s + blockBri[by2 * blocksW + bx] : s;
          }, 0);
        // If the outer column is brighter, it's a UI panel — trim it
        let outerBri = 0;
        let innerBri = 0;
        for (let by = bTop; by <= bBottom; by++) {
          outerBri += blockBri[by * blocksW + bx];
          innerBri += blockBri[by * blocksW + nextBx];
        }
        if (outerBri > innerBri) {
          edge = nextBx;
        }
        break;
      }
    }
    return edge;
  };

  // Refine left and right edges
  const refinedLeft = checkSidePanel(bLeft, bLeft + Math.min(5, regionW), 1);
  const refinedRight = checkSidePanel(bRight, bRight - Math.min(5, regionW), -1);
  if (refinedLeft < refinedRight) {
    bLeft = refinedLeft;
    bRight = refinedRight;
  }

  // ── Step 7: Convert to pixel coordinates ────────────────────────────────
  let cropX = bLeft * blockSize;
  let cropY = safeTop + bTop * blockSize;
  let cropW = (bRight - bLeft + 1) * blockSize;
  let cropH = (bBottom - bTop + 1) * blockSize;

  // Clamp to image bounds
  cropX = Math.max(0, cropX);
  cropY = Math.max(0, cropY);
  cropW = Math.min(width - cropX, cropW);
  cropH = Math.min(height - cropY, cropH);

  // Safety: ensure minimum crop size (at least 20% of original)
  if (cropW < width * 0.2 || cropH < height * 0.2) {
    // Fallback: conservative margins
    const fallTop = Math.ceil(height * 0.08);
    const fallBottom = height - Math.ceil(height * 0.06);
    return { x: 0, y: fallTop, width, height: fallBottom - fallTop };
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

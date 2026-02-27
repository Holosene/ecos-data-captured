/**
 * ECOS — Adaptive Threshold
 *
 * Computes a percentile-based noise floor from volume data.
 * Used to auto-set the threshold that separates signal from noise.
 */

/**
 * Compute an auto threshold using percentile-based noise floor.
 *
 * Samples the volume data, builds a histogram, then returns the value
 * at the given percentile. Default percentile = 85 (removes bottom 85% as noise).
 */
export function computeAutoThreshold(
  data: Float32Array,
  percentile: number = 85,
): number {
  // Sample up to 100k voxels for speed
  const sampleCount = Math.min(data.length, 100_000);
  const step = Math.max(1, Math.floor(data.length / sampleCount));

  // Collect non-zero samples
  const samples: number[] = [];
  for (let i = 0; i < data.length; i += step) {
    if (data[i] > 0.0001) {
      samples.push(data[i]);
    }
  }

  if (samples.length === 0) return 0.02;

  // Sort ascending
  samples.sort((a, b) => a - b);

  // Percentile index
  const idx = Math.floor((percentile / 100) * (samples.length - 1));
  return samples[idx];
}

/**
 * Compute histogram statistics for a volume.
 * Returns { min, max, mean, median, p25, p75, p95 }.
 */
export function computeVolumeStats(
  data: Float32Array,
): { min: number; max: number; mean: number; median: number; p25: number; p75: number; p95: number; nonZeroCount: number } {
  const sampleCount = Math.min(data.length, 200_000);
  const step = Math.max(1, Math.floor(data.length / sampleCount));

  const samples: number[] = [];
  let sum = 0;
  let min = Infinity;
  let max = -Infinity;

  for (let i = 0; i < data.length; i += step) {
    const v = data[i];
    if (v > 0.0001) {
      samples.push(v);
      sum += v;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }

  if (samples.length === 0) {
    return { min: 0, max: 0, mean: 0, median: 0, p25: 0, p75: 0, p95: 0, nonZeroCount: 0 };
  }

  samples.sort((a, b) => a - b);
  const n = samples.length;

  return {
    min,
    max,
    mean: sum / n,
    median: samples[Math.floor(n * 0.5)],
    p25: samples[Math.floor(n * 0.25)],
    p75: samples[Math.floor(n * 0.75)],
    p95: samples[Math.floor(n * 0.95)],
    nonZeroCount: n,
  };
}

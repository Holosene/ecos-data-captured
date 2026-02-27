/**
 * NRRD (Nearly Raw Raster Data) exporter.
 *
 * Produces a .nrrd file from a Volume object.
 * Format spec: http://teem.sourceforge.net/nrrd/format.html
 *
 * We write:
 *   - ASCII header
 *   - raw binary float32 data (little-endian)
 */

import type { Volume } from './types.js';

/**
 * Encode a Volume as a NRRD Uint8Array (ready for Blob/download).
 */
export function encodeNrrd(volume: Volume): Uint8Array {
  const { data, metadata } = volume;
  const [dimX, dimY, dimZ] = metadata.dimensions;
  const [sX, sY, sZ] = metadata.spacing;

  const header = [
    'NRRD0004',
    'type: float',
    'dimension: 3',
    `sizes: ${dimX} ${dimY} ${dimZ}`,
    `spacings: ${sX} ${sY} ${sZ}`,
    'encoding: raw',
    'endian: little',
    `space origin: (${metadata.origin.join(',')})`,
    'space directions: (1,0,0) (0,1,0) (0,0,1)',
    `# ECOS volume — depth_max=${metadata.depthMaxM}m, distance=${metadata.totalDistanceM.toFixed(1)}m`,
    `# frames=${metadata.sourceFrameCount}, slices=${metadata.resampledSliceCount}`,
    '',
    '',
  ].join('\n');

  const headerBytes = new TextEncoder().encode(header);
  const dataBytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);

  const result = new Uint8Array(headerBytes.length + dataBytes.length);
  result.set(headerBytes, 0);
  result.set(dataBytes, headerBytes.length);

  return result;
}

/**
 * Create a downloadable Blob from NRRD data.
 */
export function nrrdToBlob(nrrdData: Uint8Array): Blob {
  return new Blob([nrrdData], { type: 'application/octet-stream' });
}

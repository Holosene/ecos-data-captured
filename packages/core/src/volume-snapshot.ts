/**
 * ECOS — Volume Snapshot (.echos-vol)
 *
 * Fast binary format for saving/loading pre-computed volumes.
 * Skips the entire pipeline (video decode → preprocessing → projection)
 * while remaining fully compatible with engine updates (the renderer
 * treats this data identically to freshly-projected data).
 *
 * Layout:
 *   Bytes  0– 3: magic "EVOL" (4 bytes)
 *   Bytes  4– 7: version uint32 (currently 1)
 *   Bytes  8–11: dimX uint32
 *   Bytes 12–15: dimY uint32
 *   Bytes 16–19: dimZ uint32
 *   Bytes 20–23: extentX float32
 *   Bytes 24–27: extentY float32
 *   Bytes 28–31: extentZ float32
 *   Bytes 32–39: reserved (8 bytes, zeroed)
 *   Bytes 40+  : Float32Array voxel data (dimX × dimY × dimZ × 4 bytes)
 */

const MAGIC = 0x4C4F5645; // "EVOL" in little-endian
const VERSION = 1;
const HEADER_SIZE = 40;

export interface VolumeSnapshot {
  data: Float32Array;
  dimensions: [number, number, number];
  extent: [number, number, number];
}

/** Serialize a volume to a compact binary ArrayBuffer. */
export function serializeVolume(snap: VolumeSnapshot): ArrayBuffer {
  const [dimX, dimY, dimZ] = snap.dimensions;
  const voxelCount = dimX * dimY * dimZ;
  const totalBytes = HEADER_SIZE + voxelCount * 4;
  const buffer = new ArrayBuffer(totalBytes);
  const view = new DataView(buffer);

  // Header
  view.setUint32(0, MAGIC, true);
  view.setUint32(4, VERSION, true);
  view.setUint32(8, dimX, true);
  view.setUint32(12, dimY, true);
  view.setUint32(16, dimZ, true);
  view.setFloat32(20, snap.extent[0], true);
  view.setFloat32(24, snap.extent[1], true);
  view.setFloat32(28, snap.extent[2], true);
  // bytes 32-39: reserved (already zeroed)

  // Voxel data
  const dst = new Float32Array(buffer, HEADER_SIZE, voxelCount);
  dst.set(snap.data.subarray(0, voxelCount));

  return buffer;
}

/** Deserialize a .echos-vol binary buffer back to volume data. */
export function deserializeVolume(buffer: ArrayBuffer): VolumeSnapshot {
  if (buffer.byteLength < HEADER_SIZE) {
    throw new Error('Invalid .echos-vol file: too small');
  }

  const view = new DataView(buffer);
  const magic = view.getUint32(0, true);
  if (magic !== MAGIC) {
    throw new Error('Invalid .echos-vol file: bad magic number');
  }

  const version = view.getUint32(4, true);
  if (version > VERSION) {
    throw new Error(`Unsupported .echos-vol version: ${version} (max supported: ${VERSION})`);
  }

  const dimX = view.getUint32(8, true);
  const dimY = view.getUint32(12, true);
  const dimZ = view.getUint32(16, true);
  const extentX = view.getFloat32(20, true);
  const extentY = view.getFloat32(24, true);
  const extentZ = view.getFloat32(28, true);

  const voxelCount = dimX * dimY * dimZ;
  const expectedSize = HEADER_SIZE + voxelCount * 4;
  if (buffer.byteLength < expectedSize) {
    throw new Error(
      `Invalid .echos-vol file: expected ${expectedSize} bytes, got ${buffer.byteLength}`,
    );
  }

  // IMPORTANT: copy into a fresh Float32Array (byteOffset=0).
  // A view with byteOffset>0 causes issues in Three.js Data3DTexture upload.
  const data = new Float32Array(buffer.slice(HEADER_SIZE, HEADER_SIZE + voxelCount * 4));

  return {
    data,
    dimensions: [dimX, dimY, dimZ],
    extent: [extentX, extentY, extentZ],
  };
}

/** Create a Blob from a serialized volume (for download). */
export function volumeSnapshotToBlob(snap: VolumeSnapshot): Blob {
  return new Blob([serializeVolume(snap)], { type: 'application/octet-stream' });
}

/**
 * @echos/core — Main entry point
 */

// ─── V1 Types ───────────────────────────────────────────────────────────────

export type {
  GpxTrackpoint,
  GpxTrack,
  GpxPointWithDistance,
  CropRect,
  CalibrationSettings,
  SyncSettings,
  FrameData,
  FrameMapping,
  VolumeMetadata,
  Volume,
  EchosSession,
  QcReport,
  PipelineStage,
  PipelineProgress,
  ProcessingConfig,
} from './types.js';

export { DEFAULT_CALIBRATION, DEFAULT_PROCESSING_CONFIG } from './types.js';

// ─── V2 Types ───────────────────────────────────────────────────────────────

export type {
  PreprocessingSettings,
  BeamSettings,
  VolumeGridSettings,
  ProbabilisticVolume,
  PreprocessedFrame,
  RecordingSession,
  ViewMode,
  TransferFunctionPoint,
  ChromaticMode,
  PipelineV2Stage,
  PipelineV2Progress,
  RendererSettings,
  PerformanceConfig,
} from './v2-types.js';

export {
  DEFAULT_PREPROCESSING,
  DEFAULT_BEAM,
  DEFAULT_GRID,
  DEFAULT_RENDERER,
  DEFAULT_PERFORMANCE,
} from './v2-types.js';

// ─── Haversine ──────────────────────────────────────────────────────────────

export { haversineDistance, cumulativeDistances } from './haversine.js';

// ─── GPX ────────────────────────────────────────────────────────────────────

export { parseGpx, enrichTrackpoints, interpolateDistance } from './gpx-parser.js';

// ─── Sync ───────────────────────────────────────────────────────────────────

export { createSyncContext, mapFrameToPosition, mapAllFrames } from './sync.js';
export type { SyncContext } from './sync.js';

// ─── V1 Volume ──────────────────────────────────────────────────────────────

export { buildVolume, estimateVolume } from './volume-builder.js';
export type { VolumeBuilderInput } from './volume-builder.js';

// ─── V2 Preprocessing ──────────────────────────────────────────────────────

export {
  extractFrameImageData,
  preprocessFrame,
  preprocessFrames,
  autoDetectCropRegion,
  autoDetectDepthMax,
} from './preprocessing.js';

// ─── V2 Conic Projection ───────────────────────────────────────────────────

export {
  createEmptyVolume,
  projectFrameIntoCone,
  projectFramesSpatial,
  normalizeVolume,
  buildInstrumentVolume,
  projectFrameWindow,
  computeAutoSkewX,
  estimateVolumeMemoryMB,
} from './conic-projection.js';

// ─── NRRD ───────────────────────────────────────────────────────────────────

export { encodeNrrd, nrrdToBlob } from './nrrd-export.js';

// ─── Session ────────────────────────────────────────────────────────────────

export { createSession, serializeSession, deserializeSession, sessionToBlob } from './session.js';

// ─── QC Report ──────────────────────────────────────────────────────────────

export { generateQcReport, qcReportToBlob } from './qc-report.js';

// ─── Adaptive Threshold ─────────────────────────────────────────────────────

export { computeAutoThreshold, computeVolumeStats } from './adaptive-threshold.js';

// ─── Volume Snapshot (.echos-vol) ───────────────────────────────────────────

export { serializeVolume, deserializeVolume, volumeSnapshotToBlob } from './volume-snapshot.js';
export type { VolumeSnapshot } from './volume-snapshot.js';

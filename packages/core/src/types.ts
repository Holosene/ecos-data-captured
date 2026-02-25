/**
 * @echos/core — Type definitions
 *
 * Coordinate system convention:
 *   X = horizontal (sonar scan width, pixels → meters not applicable)
 *   Y = distance along track (meters, from GPX)
 *   Z = depth (meters, from 0 at surface to depthMax)
 *
 * Volume is stored as Float32Array in row-major order: [z][y][x]
 */

// ─── GPX ────────────────────────────────────────────────────────────────────

export interface GpxTrackpoint {
  lat: number;
  lon: number;
  ele?: number;
  time: Date;
}

export interface GpxTrack {
  name?: string;
  points: GpxTrackpoint[];
  totalDistanceM: number;
  durationS: number;
  startTime: Date;
  endTime: Date;
}

export interface GpxPointWithDistance extends GpxTrackpoint {
  /** Cumulative distance from start in meters */
  cumulativeDistanceM: number;
  /** Seconds since track start */
  elapsedS: number;
  /** Instantaneous speed m/s (smoothed) */
  speedMs: number;
}

// ─── Crop & Calibration ─────────────────────────────────────────────────────

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CalibrationSettings {
  depthMaxM: number;
  fpsExtraction: number;
  downscaleFactor: number;
  yStepM: number;
}

// ─── Sync ───────────────────────────────────────────────────────────────────

export interface SyncSettings {
  /** Offset in seconds: positive = GPX starts after video */
  offsetS: number;
  /** Video start time (epoch ms) — set by user or auto */
  videoStartEpochMs: number;
  /** Video end time (epoch ms) */
  videoEndEpochMs: number;
}

// ─── Frame ──────────────────────────────────────────────────────────────────

export interface FrameData {
  /** Frame index in extraction sequence */
  index: number;
  /** Timestamp in seconds from video start */
  timeS: number;
  /** Grayscale pixel data (Uint8Array), row-major, cropped */
  pixels: Uint8Array;
  /** Width of cropped frame */
  width: number;
  /** Height of cropped frame (= depth axis resolution) */
  height: number;
}

export interface FrameMapping {
  frameIndex: number;
  timeS: number;
  distanceM: number;
  lat: number;
  lon: number;
}

// ─── Volume ─────────────────────────────────────────────────────────────────

export interface VolumeMetadata {
  /** Dimensions: [X, Y, Z] */
  dimensions: [number, number, number];
  /** Spacing in meters: [xSpacing, ySpacing, zSpacing] */
  spacing: [number, number, number];
  /** Origin: [x0, y0, z0] */
  origin: [number, number, number];
  /** Total distance covered in meters */
  totalDistanceM: number;
  /** Depth max in meters */
  depthMaxM: number;
  /** Number of source frames */
  sourceFrameCount: number;
  /** Number of resampled slices (Y) */
  resampledSliceCount: number;
}

export interface Volume {
  data: Float32Array;
  metadata: VolumeMetadata;
}

// ─── Session / Project ──────────────────────────────────────────────────────

export interface EchosSession {
  version: string;
  createdAt: string;
  updatedAt: string;
  videoFileName: string;
  gpxFileName: string;
  crop: CropRect;
  calibration: CalibrationSettings;
  sync: SyncSettings;
  volumeMetadata?: VolumeMetadata;
}

// ─── QC Report ──────────────────────────────────────────────────────────────

export interface QcReport {
  version: string;
  generatedAt: string;
  videoFile: string;
  gpxFile: string;
  videoDurationS: number;
  gpxDurationS: number;
  gpxTotalDistanceM: number;
  extractedFrames: number;
  fpsExtraction: number;
  downscaleFactor: number;
  cropRect: CropRect;
  depthMaxM: number;
  yStepM: number;
  volumeDimensions: [number, number, number];
  volumeSpacing: [number, number, number];
  volumeSizeBytes: number;
  meanIntensity: number;
  maxIntensity: number;
  warnings: string[];
}

// ─── Pipeline Events ────────────────────────────────────────────────────────

export type PipelineStage =
  | 'extracting'
  | 'processing'
  | 'mapping'
  | 'resampling'
  | 'building'
  | 'done'
  | 'error';

export interface PipelineProgress {
  stage: PipelineStage;
  /** 0..1 */
  progress: number;
  message: string;
  framesCurrent?: number;
  framesTotal?: number;
}

// ─── Processing config ──────────────────────────────────────────────────────

export interface ProcessingConfig {
  crop: CropRect;
  calibration: CalibrationSettings;
  sync: SyncSettings;
  quickPreview: boolean;
  /** Max duration in seconds for quick preview */
  quickPreviewDurationS: number;
  /** Memory limit in MB (soft limit, for warnings) */
  memoryLimitMB: number;
}

export const DEFAULT_CALIBRATION: CalibrationSettings = {
  depthMaxM: 10,
  fpsExtraction: 2,
  downscaleFactor: 1.0,
  yStepM: 0.1,
};

export const DEFAULT_PROCESSING_CONFIG: ProcessingConfig = {
  crop: { x: 0, y: 0, width: 640, height: 480 },
  calibration: DEFAULT_CALIBRATION,
  sync: { offsetS: 0, videoStartEpochMs: 0, videoEndEpochMs: 0 },
  quickPreview: false,
  quickPreviewDurationS: 30,
  memoryLimitMB: 512,
};

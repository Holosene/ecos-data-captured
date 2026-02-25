/**
 * ECHOS V2 — Type definitions
 *
 * Probabilistic Conic Acoustic Projection Model
 *
 * Coordinate system:
 *   X = lateral (perpendicular to boat heading)
 *   Y = distance along GPS track (meters)
 *   Z = depth (meters, 0 at surface, positive downward)
 */

// ─── Preprocessing ──────────────────────────────────────────────────────────

export interface PreprocessingSettings {
  /** Upscale factor (1 = no upscale, 2 = 2x bicubic) */
  upscaleFactor: number;
  /** Bilateral denoise strength (0 = off, 1 = max) */
  denoiseStrength: number;
  /** Gamma correction (1.0 = linear, <1 = brighter, >1 = darker) */
  gamma: number;
  /** Gaussian smooth sigma in pixels (0 = off) */
  gaussianSigma: number;
  /** Block artifact removal strength (0 = off, 1 = max) */
  deblockStrength: number;
}

export const DEFAULT_PREPROCESSING: PreprocessingSettings = {
  upscaleFactor: 1,
  denoiseStrength: 0.2,
  gamma: 0.85,
  gaussianSigma: 0.8,
  deblockStrength: 0.3,
};

// ─── Conic Projection ───────────────────────────────────────────────────────

export interface BeamSettings {
  /** Full cone angle in degrees (typical sonar: 10–60°) */
  beamAngleDeg: number;
  /** Lateral Gaussian falloff sigma as fraction of cone radius */
  lateralFalloffSigma: number;
  /** Max depth in meters */
  depthMaxM: number;
  /** Near field start depth (truncated cone) */
  nearFieldM: number;
}

export const DEFAULT_BEAM: BeamSettings = {
  beamAngleDeg: 20,
  lateralFalloffSigma: 0.5,
  depthMaxM: 30,
  nearFieldM: 0.3,
};

// ─── Volume Grid ────────────────────────────────────────────────────────────

export interface VolumeGridSettings {
  /** Resolution along X (lateral) in voxels */
  resX: number;
  /** Resolution along Y (track distance) in voxels */
  resY: number;
  /** Resolution along Z (depth) in voxels */
  resZ: number;
}

export const DEFAULT_GRID: VolumeGridSettings = {
  resX: 96,
  resY: 128,
  resZ: 96,
};

// ─── Probabilistic Volume ───────────────────────────────────────────────────

export interface ProbabilisticVolume {
  /** Accumulated intensity values (Float32Array) */
  data: Float32Array;
  /** Accumulation count per voxel (for normalization) */
  weights: Float32Array;
  /** Grid dimensions [X, Y, Z] */
  dimensions: [number, number, number];
  /** Spatial extent in meters [width, length, depth] */
  extent: [number, number, number];
  /** Origin in meters [x0, y0, z0] */
  origin: [number, number, number];
}

// ─── Preprocessed Frame ─────────────────────────────────────────────────────

export interface PreprocessedFrame {
  /** Frame index */
  index: number;
  /** Timestamp from video start (seconds) */
  timeS: number;
  /** Preprocessed intensity data (Float32, 0–1, row-major) */
  intensity: Float32Array;
  /** Width after preprocessing */
  width: number;
  /** Height after preprocessing (depth axis) */
  height: number;
}

// ─── Session Recording ──────────────────────────────────────────────────────

export interface RecordingSession {
  id: string;
  name: string;
  createdAt: string;
  videoFileName: string;
  gpxFileName: string;
  /** GPS bounding box [minLat, minLon, maxLat, maxLon] */
  bounds: [number, number, number, number];
  /** Total distance in meters */
  totalDistanceM: number;
  /** Total duration in seconds */
  durationS: number;
  /** Number of frames extracted */
  frameCount: number;
  /** Volume grid dimensions */
  gridDimensions: [number, number, number];
  /** Preprocessing settings used */
  preprocessing: PreprocessingSettings;
  /** Beam settings used */
  beam: BeamSettings;
}

// ─── View Modes ─────────────────────────────────────────────────────────────

export type ViewMode = 'instrument' | 'spatial';

// ─── Transfer Function ──────────────────────────────────────────────────────

export interface TransferFunctionPoint {
  /** Position 0–1 */
  position: number;
  /** RGBA color [r, g, b, a] each 0–1 */
  color: [number, number, number, number];
}

export type ChromaticMode =
  | 'sonar-original'
  | 'scientific-grayscale'
  | 'thermal'
  | 'density-probabilistic'
  | 'ghost-accumulation';

// ─── Pipeline V2 ────────────────────────────────────────────────────────────

export type PipelineV2Stage =
  | 'importing'
  | 'preprocessing'
  | 'projecting'
  | 'accumulating'
  | 'finalizing'
  | 'ready'
  | 'error';

export interface PipelineV2Progress {
  stage: PipelineV2Stage;
  progress: number; // 0–1
  message: string;
  currentFrame?: number;
  totalFrames?: number;
}

// ─── Renderer Settings ──────────────────────────────────────────────────────

export interface RendererSettings {
  /** Opacity multiplier for ray marching */
  opacityScale: number;
  /** Intensity threshold (values below are transparent) */
  threshold: number;
  /** Density amplification multiplier */
  densityScale: number;
  /** Smoothing strength (spatial interpolation) */
  smoothing: number;
  /** Show sonar beam geometry */
  showBeam: boolean;
  /** Ghost enhancement (amplify multi-pass accumulation) */
  ghostEnhancement: number;
  /** Ray march step count */
  stepCount: number;
  /** Current chromatic mode */
  chromaticMode: ChromaticMode;
}

export const DEFAULT_RENDERER: RendererSettings = {
  opacityScale: 1.0,
  threshold: 0.05,
  densityScale: 1.0,
  smoothing: 0.3,
  showBeam: false,
  ghostEnhancement: 0.0,
  stepCount: 128,
  chromaticMode: 'thermal',
};

// ─── Performance ────────────────────────────────────────────────────────────

export interface PerformanceConfig {
  /** Max texture dimension (will auto-downscale if exceeded) */
  maxTextureDim: number;
  /** Memory limit in MB */
  memoryLimitMB: number;
  /** Enable progressive refinement */
  progressiveRefinement: boolean;
  /** Preview grid scale (0.25–1.0) */
  previewScale: number;
}

export const DEFAULT_PERFORMANCE: PerformanceConfig = {
  maxTextureDim: 512,
  memoryLimitMB: 1024,
  progressiveRefinement: true,
  previewScale: 0.5,
};

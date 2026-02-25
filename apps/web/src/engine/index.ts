/**
 * ECHOS V2 — Engine exports
 */

export { VolumeRenderer } from './volume-renderer.js';
export type { CameraPreset, CalibrationConfig, DataDim } from './volume-renderer.js';
export { DEFAULT_CALIBRATION } from './volume-renderer.js';
export { generateLUT, getChromaticModes, CHROMATIC_LABELS } from './transfer-function.js';
export {
  volumeVertexShader,
  volumeFragmentShader,
  beamVertexShader,
  beamFragmentShader,
} from './shaders.js';

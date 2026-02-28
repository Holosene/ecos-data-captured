/**
 * ECOS V2 — Application state (React context-based).
 *
 * Manages both V1 wizard flow and V2 volumetric pipeline.
 */

import { createContext, useContext } from 'react';
import type {
  CropRect,
  CalibrationSettings,
  SyncSettings,
  GpxTrack,
  Volume,
  FrameMapping,
  PipelineProgress,
  QcReport,
  PreprocessingSettings,
  BeamSettings,
  VolumeGridSettings,
  PipelineV2Progress,
  RendererSettings,
  ViewMode,
  RecordingSession,
} from '@echos/core';
import {
  DEFAULT_CALIBRATION,
  DEFAULT_PREPROCESSING,
  DEFAULT_BEAM,
  DEFAULT_GRID,
  DEFAULT_RENDERER,
} from '@echos/core';

// ─── Step types ─────────────────────────────────────────────────────────────

export type WizardStep = 'home' | 'import' | 'crop' | 'calibration' | 'sync' | 'generate' | 'viewer';

export type V2Step = 'import' | 'processing' | 'viewer';

// ─── State ──────────────────────────────────────────────────────────────────

export interface AppState {
  // Navigation
  currentStep: WizardStep;
  v2Step: V2Step;
  useV2: boolean;

  // Files
  videoFile: File | null;
  videoUrl: string | null;
  gpxFile: File | null;
  videoDurationS: number;
  videoWidth: number;
  videoHeight: number;

  // GPX
  gpxTrack: GpxTrack | null;

  // Crop
  crop: CropRect;
  cropConfirmed: boolean;

  // V1 Calibration
  calibration: CalibrationSettings;

  // Sync
  sync: SyncSettings;

  // V1 Processing
  quickPreview: boolean;
  processing: boolean;
  progress: PipelineProgress | null;
  logs: string[];

  // V1 Volume
  volume: Volume | null;
  mappings: FrameMapping[];
  qcReport: QcReport | null;

  // ─── V2 State ─────────────────────────────────────────────────────────

  // V2 preprocessing
  preprocessing: PreprocessingSettings;

  // V2 beam
  beam: BeamSettings;

  // V2 grid
  grid: VolumeGridSettings;

  // V2 renderer
  rendererSettings: RendererSettings;

  // V2 view mode
  viewMode: ViewMode;

  // V2 pipeline
  v2Processing: boolean;
  v2Progress: PipelineV2Progress | null;

  // V2 volume (normalized Float32Array for GPU upload)
  v2VolumeData: Float32Array | null;
  v2VolumeDimensions: [number, number, number];
  v2VolumeExtent: [number, number, number];

  // Sessions
  sessions: RecordingSession[];
  activeSessionId: string | null;

  // Map
  gpxTracks: Map<string, Array<{ lat: number; lon: number }>>;

  // Errors
  error: string | null;
}

export const INITIAL_STATE: AppState = {
  currentStep: 'home',
  v2Step: 'import',
  useV2: true,

  videoFile: null,
  videoUrl: null,
  gpxFile: null,
  videoDurationS: 0,
  videoWidth: 0,
  videoHeight: 0,

  gpxTrack: null,

  crop: { x: 0, y: 0, width: 640, height: 480 },
  cropConfirmed: false,
  calibration: { ...DEFAULT_CALIBRATION },
  sync: { offsetS: 0, trimStartS: 0, trimEndS: 0, videoStartEpochMs: 0, videoEndEpochMs: 0 },

  quickPreview: false,
  processing: false,
  progress: null,
  logs: [],

  volume: null,
  mappings: [],
  qcReport: null,

  // V2
  preprocessing: { ...DEFAULT_PREPROCESSING },
  beam: { ...DEFAULT_BEAM },
  grid: { ...DEFAULT_GRID },
  rendererSettings: { ...DEFAULT_RENDERER },
  viewMode: 'instrument',

  v2Processing: false,
  v2Progress: null,
  v2VolumeData: null,
  v2VolumeDimensions: [1, 1, 1],
  v2VolumeExtent: [1, 1, 1],

  sessions: [],
  activeSessionId: null,
  gpxTracks: new Map(),

  error: null,
};

// ─── Actions ────────────────────────────────────────────────────────────────

export type AppAction =
  // Navigation
  | { type: 'SET_STEP'; step: WizardStep }
  | { type: 'SET_V2_STEP'; step: V2Step }
  | { type: 'SET_USE_V2'; useV2: boolean }
  // Files
  | { type: 'SET_VIDEO'; file: File; durationS: number; width: number; height: number; url?: string }
  | { type: 'SET_GPX'; file: File; track: GpxTrack }
  // Crop
  | { type: 'SET_CROP'; crop: CropRect }
  | { type: 'CONFIRM_CROP' }
  // V1 calibration
  | { type: 'SET_CALIBRATION'; calibration: Partial<CalibrationSettings> }
  | { type: 'SET_SYNC'; sync: Partial<SyncSettings> }
  | { type: 'SET_QUICK_PREVIEW'; enabled: boolean }
  // V1 processing
  | { type: 'START_PROCESSING' }
  | { type: 'SET_PROGRESS'; progress: PipelineProgress }
  | { type: 'ADD_LOG'; message: string }
  | { type: 'SET_VOLUME'; volume: Volume; mappings: FrameMapping[] }
  | { type: 'SET_QC_REPORT'; report: QcReport }
  | { type: 'FINISH_PROCESSING' }
  // V2 settings
  | { type: 'SET_PREPROCESSING'; preprocessing: Partial<PreprocessingSettings> }
  | { type: 'SET_BEAM'; beam: Partial<BeamSettings> }
  | { type: 'SET_GRID'; grid: Partial<VolumeGridSettings> }
  | { type: 'SET_RENDERER'; settings: Partial<RendererSettings> }
  | { type: 'SET_VIEW_MODE'; mode: ViewMode }
  // V2 processing
  | { type: 'START_V2_PROCESSING' }
  | { type: 'SET_V2_PROGRESS'; progress: PipelineV2Progress }
  | { type: 'SET_V2_VOLUME'; data: Float32Array; dimensions: [number, number, number]; extent: [number, number, number] }
  | { type: 'FINISH_V2_PROCESSING' }
  // Sessions
  | { type: 'ADD_SESSION'; session: RecordingSession; gpxTrack?: Array<{ lat: number; lon: number }> }
  | { type: 'SET_ACTIVE_SESSION'; id: string | null }
  // General
  | { type: 'SET_ERROR'; error: string | null }
  | { type: 'RESET' }
  | { type: 'LOAD_SESSION'; state: Partial<AppState> };

// ─── Reducer ────────────────────────────────────────────────────────────────

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'SET_STEP':
      return { ...state, currentStep: action.step, error: null };
    case 'SET_V2_STEP':
      return { ...state, v2Step: action.step, error: null };
    case 'SET_USE_V2':
      return { ...state, useV2: action.useV2 };
    case 'SET_VIDEO':
      return {
        ...state,
        videoFile: action.file,
        videoUrl: action.url ?? null,
        videoDurationS: action.durationS,
        videoWidth: action.width,
        videoHeight: action.height,
        crop: { x: 0, y: 0, width: action.width, height: action.height },
      };
    case 'SET_GPX':
      return { ...state, gpxFile: action.file, gpxTrack: action.track };
    case 'SET_CROP':
      return { ...state, crop: action.crop };
    case 'CONFIRM_CROP':
      return { ...state, cropConfirmed: true };
    case 'SET_CALIBRATION':
      return { ...state, calibration: { ...state.calibration, ...action.calibration } };
    case 'SET_SYNC':
      return { ...state, sync: { ...state.sync, ...action.sync } };
    case 'SET_QUICK_PREVIEW':
      return { ...state, quickPreview: action.enabled };
    case 'START_PROCESSING':
      return { ...state, processing: true, error: null, logs: [], progress: null };
    case 'SET_PROGRESS':
      return { ...state, progress: action.progress };
    case 'ADD_LOG':
      return { ...state, logs: [...state.logs, `[${new Date().toLocaleTimeString()}] ${action.message}`] };
    case 'SET_VOLUME':
      return { ...state, volume: action.volume, mappings: action.mappings };
    case 'SET_QC_REPORT':
      return { ...state, qcReport: action.report };
    case 'FINISH_PROCESSING':
      return { ...state, processing: false };
    // V2
    case 'SET_PREPROCESSING':
      return { ...state, preprocessing: { ...state.preprocessing, ...action.preprocessing } };
    case 'SET_BEAM':
      return { ...state, beam: { ...state.beam, ...action.beam } };
    case 'SET_GRID':
      return { ...state, grid: { ...state.grid, ...action.grid } };
    case 'SET_RENDERER':
      return { ...state, rendererSettings: { ...state.rendererSettings, ...action.settings } };
    case 'SET_VIEW_MODE':
      return { ...state, viewMode: action.mode };
    case 'START_V2_PROCESSING':
      return { ...state, v2Processing: true, error: null, logs: [], v2Progress: null };
    case 'SET_V2_PROGRESS':
      return { ...state, v2Progress: action.progress };
    case 'SET_V2_VOLUME':
      return {
        ...state,
        v2VolumeData: action.data,
        v2VolumeDimensions: action.dimensions,
        v2VolumeExtent: action.extent,
      };
    case 'FINISH_V2_PROCESSING':
      return { ...state, v2Processing: false };
    case 'ADD_SESSION': {
      const newTracks = new Map(state.gpxTracks);
      if (action.gpxTrack) {
        newTracks.set(action.session.id, action.gpxTrack);
      }
      return {
        ...state,
        sessions: [...state.sessions, action.session],
        gpxTracks: newTracks,
      };
    }
    case 'SET_ACTIVE_SESSION':
      return { ...state, activeSessionId: action.id };
    case 'SET_ERROR':
      return { ...state, error: action.error, processing: false, v2Processing: false };
    case 'RESET':
      return { ...INITIAL_STATE };
    case 'LOAD_SESSION':
      return { ...state, ...action.state };
    default:
      return state;
  }
}

// ─── Context ────────────────────────────────────────────────────────────────

export interface AppContextValue {
  state: AppState;
  dispatch: React.Dispatch<AppAction>;
}

export const AppContext = createContext<AppContextValue>({
  state: INITIAL_STATE,
  dispatch: () => {},
});

export function useAppState() {
  return useContext(AppContext);
}

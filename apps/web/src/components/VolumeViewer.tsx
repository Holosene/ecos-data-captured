/**
 * ECOS V2 — Volume Viewer Component (Redesigned)
 *
 * Marketing-style presentation of 3 render modes:
 *   - Cône (Instrument): static stacked cone volume
 *   - Trace (Spatial): spatial volume (GPS or synthetic distance)
 *   - Projection (Classic): windowed conic projection with temporal playback
 *
 * Design principles:
 *   - Volumes presented as clean, borderless 3D elements
 *   - Controls hidden by default — "Éditer" button reveals per-volume settings
 *   - Grid/axes only visible in edit mode
 *   - Leaflet-based interactive map for GPS visualization
 *   - Calibration panel via "bbbbb" shortcut
 */

import React, { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import { GlassPanel, Slider, Button, colors, fonts } from '@echos/ui';
import type { RendererSettings, ChromaticMode, PreprocessedFrame, BeamSettings, VolumeGridSettings } from '@echos/core';
import { DEFAULT_RENDERER, projectFrameWindow, computeAutoThreshold } from '@echos/core';
import { VolumeRenderer, DEFAULT_CALIBRATION, DEFAULT_CALIBRATION_B, DEFAULT_CALIBRATION_C } from '../engine/volume-renderer.js';
import type { CameraPreset, CalibrationConfig } from '../engine/volume-renderer.js';
import { VolumeRendererClassic } from '../engine/volume-renderer-classic.js';
import { CalibrationPanel } from './CalibrationPanel.js';
import { getChromaticModes, CHROMATIC_LABELS } from '../engine/transfer-function.js';
import { SlicePanel } from './SlicePanel.js';
import { ExportPanel } from './ExportPanel.js';
import { useTranslation } from '../i18n/index.js';
import { useTheme } from '../theme/index.js';
import type { TranslationKey } from '../i18n/translations.js';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

interface VolumeViewerProps {
  /** Mode A (Instrument) data — always present */
  volumeData: Float32Array | null;
  dimensions: [number, number, number];
  extent: [number, number, number];
  /** Mode B (Spatial) data — always present */
  spatialData?: Float32Array | null;
  spatialDimensions?: [number, number, number];
  spatialExtent?: [number, number, number];
  /** Preprocessed frames for Mode C + slices */
  frames?: PreprocessedFrame[];
  beam?: BeamSettings;
  grid?: VolumeGridSettings;
  /** GPX track for map */
  gpxTrack?: { points: Array<{ lat: number; lon: number }>; totalDistanceM: number; durationS: number };
  /** File info for the header zone */
  videoFileName?: string;
  gpxFileName?: string;
  videoDurationS?: number;
  onSettingsChange?: (settings: RendererSettings) => void;
  onReconfigure?: () => void;
  onNewScan?: () => void;
}

const WINDOW_SIZE = 12;

// ─── Build v1-style stacked volume from raw preprocessed frames ──────────
function buildSliceVolumeFromFrames(
  frameList: PreprocessedFrame[],
): { data: Float32Array; dimensions: [number, number, number] } | null {
  if (!frameList || frameList.length === 0) return null;
  const dimX = frameList[0].width;
  const dimY = frameList.length;
  const dimZ = frameList[0].height;
  if (dimX === 0 || dimZ === 0) return null;
  const data = new Float32Array(dimX * dimY * dimZ);
  const strideZ = dimY * dimX;
  for (let yi = 0; yi < dimY; yi++) {
    const intensity = frameList[yi].intensity;
    const yiOffset = yi * dimX;
    for (let zi = 0; zi < dimZ; zi++) {
      const srcOffset = zi * dimX;
      const dstOffset = zi * strideZ + yiOffset;
      data.set(intensity.subarray(srcOffset, srcOffset + dimX), dstOffset);
    }
  }
  return { data, dimensions: [dimX, dimY, dimZ] };
}

// ─── Rendu B: windowed volume for temporal playback ────────────────────────
// Direct pixel stacking (no cone projection). Sliding window of N frames.
// Layout: data[z * dimY * dimX + y * dimX + x]
//   X = pixel col (lateral), Y = frame index (window), Z = pixel row (depth)

function buildWindowVolume(
  allFrames: PreprocessedFrame[],
  centerIndex: number,
  windowSize: number,
): { normalized: Float32Array; dimensions: [number, number, number]; extent: [number, number, number] } {
  const half = Math.floor(windowSize / 2);
  const start = Math.max(0, centerIndex - half);
  const end = Math.min(allFrames.length, start + windowSize);
  const windowFrames = allFrames.slice(start, end);

  if (windowFrames.length === 0 || windowFrames[0].width === 0 || windowFrames[0].height === 0) {
    return { normalized: new Float32Array(1), dimensions: [1, 1, 1], extent: [1, 1, 1] };
  }

  const dimX = windowFrames[0].width;    // lateral (beam columns)
  const dimY = windowFrames.length;      // track (window frames)
  const dimZ = windowFrames[0].height;   // depth (sonar rows)

  const data = new Float32Array(dimX * dimY * dimZ);

  for (let yi = 0; yi < dimY; yi++) {
    const frame = windowFrames[yi];
    for (let zi = 0; zi < dimZ; zi++) {
      for (let xi = 0; xi < dimX; xi++) {
        const srcIdx = zi * dimX + xi;
        const dstIdx = zi * dimY * dimX + yi * dimX + xi;
        data[dstIdx] = frame.intensity[srcIdx] ?? 0;
      }
    }
  }

  // Extent: Y forced thick (0.5) so volume has visible depth
  // even with few frames (12 frames vs 200+ pixels).
  const aspect = dimX / dimZ;
  return {
    normalized: data,
    dimensions: [dimX, dimY, dimZ],
    extent: [aspect, 0.5, 1],
  };
}

// ─── SVG Icons ──────────────────────────────────────────────────────────
const IconFrontal = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="2" width="12" height="12" rx="1" />
    <line x1="8" y1="2" x2="8" y2="14" opacity="0.4" />
    <line x1="2" y1="8" x2="14" y2="8" opacity="0.4" />
  </svg>
);
const IconHorizontal = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 12L6 4H14L10 12H2Z" />
    <line x1="8" y1="4" x2="6" y2="12" opacity="0.4" />
  </svg>
);
const IconVertical = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <rect x="5" y="1" width="6" height="14" rx="1" />
    <line x1="8" y1="1" x2="8" y2="15" opacity="0.4" />
  </svg>
);
const IconFree = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 12L2 7L8 4L14 7L12 12H4Z" />
    <path d="M8 4V1" /><path d="M8 4L14 7" /><path d="M8 4L2 7" />
    <path d="M8 9L8 12" opacity="0.4" />
  </svg>
);
const IconEdit = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
  </svg>
);
const IconClose = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);
const IconChevronDown = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

const CAMERA_PRESETS: { key: CameraPreset; labelKey: string; Icon: React.FC }[] = [
  { key: 'frontal', labelKey: 'v2.camera.frontal', Icon: IconFrontal },
  { key: 'horizontal', labelKey: 'v2.camera.horizontal', Icon: IconHorizontal },
  { key: 'vertical', labelKey: 'v2.camera.vertical', Icon: IconVertical },
  { key: 'free', labelKey: 'v2.camera.free', Icon: IconFree },
];

// Mode definitions — clean labels, no color coding
const MODE_DEFS = [
  { key: 'classic' as const, label: 'Cône', desc: 'Projection conique glissante' },
  { key: 'instrument' as const, label: 'Trace', desc: 'Empilement statique' },
  { key: 'spatial' as const, label: 'Cube', desc: 'Projection cubique du parcours' },
] as const;

// ─── Leaflet Map component ─────────────────────────────────────────────────
function GpsMap({ points, theme }: { points?: Array<{ lat: number; lon: number }>; theme: string }) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);

  const hasPoints = points && points.length >= 2;

  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    const tileUrl = theme === 'light'
      ? 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'
      : 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';

    const map = L.map(mapContainerRef.current, {
      zoomControl: false,
      attributionControl: false,
      scrollWheelZoom: false,
    });

    L.control.zoom({ position: 'topright' }).addTo(map);
    L.tileLayer(tileUrl, { maxZoom: 19 }).addTo(map);

    if (hasPoints) {
      const latLngs = points.map((p) => L.latLng(p.lat, p.lon));
      const polyline = L.polyline(latLngs, {
        color: colors.accent,
        weight: 3,
        opacity: 0.8,
        smoothFactor: 1.5,
      }).addTo(map);

      L.circleMarker(latLngs[0], {
        radius: 5, color: '#22c55e', fillColor: '#22c55e', fillOpacity: 1, weight: 0,
      }).addTo(map);

      L.circleMarker(latLngs[latLngs.length - 1], {
        radius: 5, color: '#f59e0b', fillColor: '#f59e0b', fillOpacity: 1, weight: 0,
      }).addTo(map);

      map.fitBounds(polyline.getBounds(), { padding: [20, 20], maxZoom: 19 });
    } else {
      // Neutral view — world overview, no markers
      map.setView([20, 0], 2);
    }

    map.on('click', () => map.scrollWheelZoom.enable());
    map.on('mouseout', () => map.scrollWheelZoom.disable());

    mapInstanceRef.current = map;
    const sizeTimer = setTimeout(() => map.invalidateSize(), 200);

    return () => {
      clearTimeout(sizeTimer);
      map.remove();
      mapInstanceRef.current = null;
    };
  }, [points, theme, hasPoints]);

  // Swap tiles on theme change
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    map.eachLayer((layer) => {
      if (layer instanceof L.TileLayer) layer.remove();
    });
    const tileUrl = theme === 'light'
      ? 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'
      : 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
    L.tileLayer(tileUrl, { maxZoom: 19 }).addTo(map);
  }, [theme]);

  return (
    <div
      ref={mapContainerRef}
      style={{
        width: '100%',
        height: '100%',
        borderRadius: '16px',
        overflow: 'hidden',
      }}
    />
  );
}

// ─── Settings controls (rendered as fragment, parent provides container) ──
function SettingsControls({
  settings, cameraPreset, autoThreshold, showGhostSlider,
  showBeamToggle, showSpeedSlider, playSpeed, chromaticModes,
  lang, t, onUpdateSetting, onCameraPreset, onAutoThreshold, onPlaySpeed,
}: {
  settings: RendererSettings; cameraPreset: CameraPreset;
  autoThreshold: boolean; showGhostSlider: boolean;
  showBeamToggle: boolean; showSpeedSlider: boolean;
  playSpeed: number; chromaticModes: ChromaticMode[];
  lang: string; t: (key: any) => string;
  onUpdateSetting: (key: keyof RendererSettings, value: number | boolean | string) => void;
  onCameraPreset: (preset: CameraPreset) => void;
  onAutoThreshold: (enabled: boolean) => void;
  onPlaySpeed: (speed: number) => void;
}) {
  return (
    <>
      {/* Camera presets */}
      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
        {CAMERA_PRESETS.map((p) => (
          <button
            key={p.key}
            onClick={() => onCameraPreset(p.key)}
            title={t(p.labelKey as TranslationKey)}
            style={{
              width: '28px', height: '28px', borderRadius: '8px',
              border: `1px solid ${cameraPreset === p.key ? colors.accent : colors.border}`,
              background: cameraPreset === p.key ? colors.accentMuted : colors.surface,
              color: cameraPreset === p.key ? colors.accent : colors.text3,
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'all 150ms ease',
            }}
          >
            <p.Icon />
          </button>
        ))}
      </div>

      {/* Sliders */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <Slider label={t('v2.controls.opacity')} value={settings.opacityScale} min={0.1} max={5.0} step={0.1} onChange={(v: number) => onUpdateSetting('opacityScale', v)} />
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
            <span style={{ fontSize: '11px', color: colors.text2 }}>{t('v2.controls.threshold')}</span>
            <label style={{ fontSize: '10px', color: colors.text3, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <input type="checkbox" checked={autoThreshold} onChange={(e: React.ChangeEvent<HTMLInputElement>) => onAutoThreshold(e.target.checked)} style={{ width: '12px', height: '12px' }} />
              {t('v2.controls.auto')}
            </label>
          </div>
          <Slider label="" value={settings.threshold} min={0} max={0.5} step={0.01} onChange={(v: number) => { onAutoThreshold(false); onUpdateSetting('threshold', v); }} />
        </div>
        <Slider label={t('v2.controls.density')} value={settings.densityScale} min={0.1} max={5.0} step={0.1} onChange={(v: number) => onUpdateSetting('densityScale', v)} />
        <Slider label={t('v2.controls.smoothing')} value={settings.smoothing} min={0} max={1.0} step={0.05} onChange={(v: number) => onUpdateSetting('smoothing', v)} />
        <Slider label={t('v2.controls.steps')} value={settings.stepCount} min={64} max={512} step={32} onChange={(v: number) => onUpdateSetting('stepCount', v)} />
        {showGhostSlider && (
          <Slider label={t('v2.controls.ghost')} value={settings.ghostEnhancement} min={0} max={3.0} step={0.1} onChange={(v: number) => onUpdateSetting('ghostEnhancement', v)} />
        )}
      </div>

      {showBeamToggle && (
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: colors.text2, cursor: 'pointer' }}>
          <input type="checkbox" checked={settings.showBeam} onChange={(e: React.ChangeEvent<HTMLInputElement>) => onUpdateSetting('showBeam', e.target.checked)} />
          {t('v2.controls.showBeam')}
        </label>
      )}

      {showSpeedSlider && (
        <Slider label={t('v2.controls.playSpeed') || 'Vitesse'} value={playSpeed} min={1} max={16} step={1} onChange={(v: number) => onPlaySpeed(v)} />
      )}
    </>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────
export function VolumeViewer({
  volumeData,
  dimensions,
  extent,
  spatialData,
  spatialDimensions,
  spatialExtent,
  frames,
  beam,
  grid,
  gpxTrack,
  videoFileName,
  gpxFileName,
  videoDurationS,
  onSettingsChange,
  onReconfigure,
  onNewScan,
}: VolumeViewerProps) {
  // Refs for the 3 viewport containers
  const containerARef = useRef<HTMLDivElement>(null);
  const containerBRef = useRef<HTMLDivElement>(null);
  const containerCRef = useRef<HTMLDivElement>(null);

  // Renderers
  const rendererARef = useRef<VolumeRenderer | null>(null);
  const rendererBRef = useRef<VolumeRenderer | null>(null);
  const rendererCRef = useRef<VolumeRendererClassic | null>(null);

  // Edit mode: which volume is currently being edited (null = none)
  const [editingMode, setEditingMode] = useState<'instrument' | 'spatial' | 'classic' | null>(null);

  // Per-mode settings — strict hardcoded defaults (Ctrl+S freezes to localStorage)
  const [modeSettings, setModeSettings] = useState<Record<string, RendererSettings>>({
    instrument: {
      ...DEFAULT_RENDERER,
      showBeam: true,
      ghostEnhancement: 0,
    },
    spatial: {
      ...DEFAULT_RENDERER,
      chromaticMode: 'high-contrast' as ChromaticMode,
      opacityScale: 1.0,
      threshold: 0,
      densityScale: 1.2,
      smoothing: 1.0,
      ghostEnhancement: 3.0,
      stepCount: 192,
      showBeam: false,
    },
    classic: {
      ...DEFAULT_RENDERER,
      chromaticMode: 'sonar-original' as ChromaticMode,
      opacityScale: 1.0,
      threshold: 0.02,
      densityScale: 1.3,
      smoothing: 1.0,
      ghostEnhancement: 0,
      stepCount: 512,
      showBeam: false,
    },
  });
  const [modeCamera, setModeCamera] = useState<Record<string, CameraPreset>>({
    instrument: 'frontal',
    spatial: 'horizontal',
    classic: 'frontal',
  });
  const [autoThreshold, setAutoThreshold] = useState(false);
  const { t, lang } = useTranslation();
  const { theme } = useTheme();

  // ─── Strict Presentation Position System ────────────────────────────────
  // Each volume has a saved "presentation pose". In Stage 1, OrbitControls
  // are fully enabled but after the user releases, the camera smoothly
  // snaps back to the presentation pose. In Stage 2 (settings), Ctrl+S
  // saves the current camera position as the new presentation pose.

  type CameraState = { position: [number, number, number]; up: [number, number, number]; target: [number, number, number] };

  const getRenderer = useCallback((mode: string) => {
    if (mode === 'instrument') return rendererARef.current;
    if (mode === 'spatial') return rendererBRef.current;
    if (mode === 'classic') return rendererCRef.current;
    return null;
  }, []);

  const presentationPoses = useRef<Record<string, CameraState | null>>({
    instrument: null, spatial: null, classic: null,
  });

  const snapBackRefs = useRef<Record<string, { rafId: number | null; timeoutId: number | null }>>({
    instrument: { rafId: null, timeoutId: null },
    spatial: { rafId: null, timeoutId: null },
    classic: { rafId: null, timeoutId: null },
  });

  const cancelSnapBack = useCallback((mode: string) => {
    const snap = snapBackRefs.current[mode];
    if (snap.rafId) { cancelAnimationFrame(snap.rafId); snap.rafId = null; }
    if (snap.timeoutId) { clearTimeout(snap.timeoutId); snap.timeoutId = null; }
  }, []);

  const lerp3 = (a: [number, number, number], b: [number, number, number], t: number): [number, number, number] => [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];

  const startSnapBack = useCallback((mode: string) => {
    const renderer = getRenderer(mode);
    const pose = presentationPoses.current[mode];
    if (!renderer || !pose) return;
    const startState = renderer.getCameraState();
    // Preserve current camera distance (zoom level) at EVERY frame
    const vecDist = (p: [number, number, number], t: [number, number, number]) =>
      Math.sqrt((p[0] - t[0]) ** 2 + (p[1] - t[1]) ** 2 + (p[2] - t[2]) ** 2);
    const fixedDist = vecDist(startState.position, startState.target);
    const totalSteps = 40;
    let step = 0;
    const animate = () => {
      step++;
      const t = step / totalSteps;
      const ease = 1 - Math.pow(1 - t, 3);
      // Lerp target
      const tgt = lerp3(startState.target, pose.target, ease);
      // Lerp position
      const rawPos = lerp3(startState.position, pose.position, ease);
      // Normalize distance: keep camera at fixedDist from interpolated target
      const dx = rawPos[0] - tgt[0], dy = rawPos[1] - tgt[1], dz = rawPos[2] - tgt[2];
      const rawDist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      const scale = fixedDist / rawDist;
      const pos: [number, number, number] = [
        tgt[0] + dx * scale,
        tgt[1] + dy * scale,
        tgt[2] + dz * scale,
      ];
      renderer.setCameraState({
        position: pos,
        up: lerp3(startState.up, pose.up, ease),
        target: tgt,
      });
      if (step < totalSteps) {
        snapBackRefs.current[mode].rafId = requestAnimationFrame(animate);
      } else {
        snapBackRefs.current[mode].rafId = null;
      }
    };
    snapBackRefs.current[mode].rafId = requestAnimationFrame(animate);
  }, [getRenderer]);

  const handleStage1PointerDown = useCallback((mode: string) => {
    cancelSnapBack(mode);
  }, [cancelSnapBack]);

  const handleStage1PointerUp = useCallback((mode: string) => {
    // Wait 400ms for OrbitControls damping to settle, then snap back
    const snap = snapBackRefs.current[mode];
    snap.timeoutId = window.setTimeout(() => {
      snap.timeoutId = null;
      startSnapBack(mode);
    }, 400);
  }, [startSnapBack]);

  // Per-mode calibration configs — strict defaults, each renderer has its OWN calibration
  const [calibrations, setCalibrations] = useState<Record<string, CalibrationConfig>>({
    instrument: { ...DEFAULT_CALIBRATION },
    spatial: { ...DEFAULT_CALIBRATION_B },
    classic: { ...DEFAULT_CALIBRATION_C },
  });
  const [calibrationOpen, setCalibrationOpen] = useState(false);
  const [calibrationSaved, setCalibrationSaved] = useState(false);
  const [calibrationSaveLabel, setCalibrationSaveLabel] = useState('');
  const bPressCountRef = useRef(0);
  const bPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keyboard shortcuts
  useEffect(() => {
    const ORBIT_SPEED = 0.05;
    const handleKey = (e: KeyboardEvent) => {
      const activeRenderer = editingMode === 'instrument' ? rendererARef.current
        : editingMode === 'spatial' ? rendererBRef.current
        : editingMode === 'classic' ? rendererCRef.current
        : null;

      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key) && activeRenderer) {
        e.preventDefault();
        switch (e.key) {
          case 'ArrowLeft':  activeRenderer.rotateBy( ORBIT_SPEED, 0); break;
          case 'ArrowRight': activeRenderer.rotateBy(-ORBIT_SPEED, 0); break;
          case 'ArrowUp':    activeRenderer.rotateBy(0,  ORBIT_SPEED); break;
          case 'ArrowDown':  activeRenderer.rotateBy(0, -ORBIT_SPEED); break;
        }
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (editingMode) {
          // Stage 2: save presentation pose for the active volume
          const renderer = getRenderer(editingMode);
          if (renderer) {
            const state = renderer.getCameraState();
            presentationPoses.current[editingMode] = state;
            console.log(`[ECOS] Presentation pose saved for "${editingMode}":`, JSON.stringify(state));
          }
        } else {
          // Stage 1: snap ALL volumes back to their presentation poses at once
          (['instrument', 'spatial', 'classic'] as const).forEach((m) => {
            const renderer = getRenderer(m);
            if (renderer && presentationPoses.current[m]) {
              cancelSnapBack(m);
              startSnapBack(m);
            }
          });
        }
        // Calibration save — all 3 volumes + base settings
        if (calibrationOpen) {
          const names: string[] = [];
          const cals: Record<string, CalibrationConfig> = {};
          if (rendererARef.current) {
            cals.instrument = rendererARef.current.getCalibration();
            localStorage.setItem('echos-cal-instrument', JSON.stringify(cals.instrument));
            names.push('Trace');
          }
          if (rendererBRef.current) {
            cals.spatial = rendererBRef.current.getCalibration();
            localStorage.setItem('echos-cal-spatial', JSON.stringify(cals.spatial));
            names.push('Cube');
          }
          if (rendererCRef.current) {
            cals.classic = rendererCRef.current.getCalibration();
            localStorage.setItem('echos-cal-classic', JSON.stringify(cals.classic));
            names.push('Cône');
          }
          // Sync React state with renderer state
          setCalibrations(prev => ({ ...prev, ...cals }));
          // Save base renderer settings
          localStorage.setItem('echos-mode-settings', JSON.stringify(modeSettings));
          // Download combined JSON
          const combined = {
            _version: 'echos-calibration-v2',
            _timestamp: new Date().toISOString(),
            calibrations: cals,
            modeSettings,
          };
          const blob = new Blob([JSON.stringify(combined, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `echos-calibration-${Date.now()}.json`;
          a.click();
          URL.revokeObjectURL(url);
          setCalibrationSaveLabel(names.join(', '));
          setCalibrationSaved(true);
          setTimeout(() => { setCalibrationSaved(false); setCalibrationSaveLabel(''); }, 3000);
        }
        return;
      }

      if (e.key === 'b' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        bPressCountRef.current += 1;
        if (bPressTimerRef.current) clearTimeout(bPressTimerRef.current);
        bPressTimerRef.current = setTimeout(() => { bPressCountRef.current = 0; }, 2000);
        if (bPressCountRef.current >= 5) {
          bPressCountRef.current = 0;
          // Only toggle calibration when at least one settings panel is open
          if (editingMode) {
            setCalibrationOpen((prev) => !prev);
          }
        }
      }

      if (e.key === 'Escape') {
        if (calibrationOpen) setCalibrationOpen(false);
        else if (editingMode) setEditingMode(null);
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [calibrationOpen, editingMode, modeSettings, startSnapBack, cancelSnapBack, getRenderer]);

  // Theme sync + editingMode → update scene bg + scroll zoom
  // IMPORTANT: only update bg color and zoom, do NOT overwrite calibration with defaults
  useEffect(() => {
    const stage1Bg = theme === 'light' ? '#f5f5f7' : '#111111';
    const stage2Bg = theme === 'light' ? '#FFFFFF' : '#1A1A20';
    const modes = [
      { ref: rendererARef, mode: 'instrument' as const },
      { ref: rendererBRef, mode: 'spatial' as const },
      { ref: rendererCRef, mode: 'classic' as const },
    ];
    modes.forEach(({ ref, mode }) => {
      if (!ref.current) return;
      const isExpanded = editingMode === mode;
      const bgColor = isExpanded ? stage2Bg : stage1Bg;
      ref.current.setSceneBg(bgColor);
      ref.current.setScrollZoom(isExpanded);
    });
  }, [theme, editingMode]);

  const handleCalibrationChange = useCallback((cal: CalibrationConfig) => {
    if (!editingMode) return;
    setCalibrations(prev => ({ ...prev, [editingMode]: cal }));
    setCalibrationSaved(false);
    // Apply calibration to ACTIVE renderer only
    getRenderer(editingMode)?.setCalibration(cal);
  }, [editingMode, getRenderer]);

  // Temporal playback state
  const hasFrames = !!(frames && frames.length > 0);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [playSpeed, setPlaySpeed] = useState(4);
  const playingRef = useRef(false);
  const currentFrameRef = useRef(0);

  // Slice data
  const [sliceVolumeData, setSliceVolumeData] = useState<Float32Array | null>(null);
  const [sliceDimensions, setSliceDimensions] = useState<[number, number, number]>([1, 1, 1]);

  const fullSliceVolume = useMemo(() => {
    if (!frames || frames.length === 0) return null;
    return buildSliceVolumeFromFrames(frames);
  }, [frames]);

  // ─── Initialize 3 renderers — strict defaults, no localStorage ──────────
  useEffect(() => {
    const bgColor = theme === 'light' ? '#f5f5f7' : '#111111';

    // Mode A — VolumeRenderer + DEFAULT_CALIBRATION, camera 'frontal'
    if (containerARef.current && !rendererARef.current) {
      rendererARef.current = new VolumeRenderer(
        containerARef.current, modeSettings.instrument, { ...DEFAULT_CALIBRATION, bgColor },
      );
      rendererARef.current.setCameraPreset('frontal');
      rendererARef.current.setGridAxesVisible(false);
      rendererARef.current.setScrollZoom(false);
    }

    // Mode B — VolumeRenderer + DEFAULT_CALIBRATION_B, camera 'horizontal'
    if (containerBRef.current && !rendererBRef.current && hasFrames) {
      rendererBRef.current = new VolumeRenderer(
        containerBRef.current, modeSettings.spatial, { ...DEFAULT_CALIBRATION_B, bgColor },
      );
      rendererBRef.current.setCameraPreset('horizontal');
      rendererBRef.current.setGridAxesVisible(false);
      rendererBRef.current.setScrollZoom(false);
    }

    // Mode C — VolumeRendererClassic + DEFAULT_CALIBRATION_C, camera 'frontal'
    if (containerCRef.current && !rendererCRef.current && hasFrames) {
      rendererCRef.current = new VolumeRendererClassic(
        containerCRef.current, modeSettings.classic, { ...DEFAULT_CALIBRATION_C, bgColor },
      );
      rendererCRef.current.setCameraPreset('frontal');
      rendererCRef.current.setGridAxesVisible(false);
      rendererCRef.current.setScrollZoom(false);
    }

    return () => {
      // Clean up snap-back animations and timeouts
      (['instrument', 'spatial', 'classic'] as const).forEach((m) => {
        const snap = snapBackRefs.current[m];
        if (snap.rafId) cancelAnimationFrame(snap.rafId);
        if (snap.timeoutId) clearTimeout(snap.timeoutId);
      });
      rendererARef.current?.dispose(); rendererARef.current = null;
      rendererBRef.current?.dispose(); rendererBRef.current = null;
      rendererCRef.current?.dispose(); rendererCRef.current = null;
      // Clear volume caches to free Float32Array memory
      frameCacheBRef.current.clear();
      frameCacheCRef.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasFrames]);

  // Initialize presentation poses after renderers are created
  useEffect(() => {
    const timer = setTimeout(() => {
      (['instrument', 'spatial', 'classic'] as const).forEach((mode) => {
        const renderer = getRenderer(mode);
        if (renderer && !presentationPoses.current[mode]) {
          presentationPoses.current[mode] = renderer.getCameraState();
        }
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [hasFrames, getRenderer]);

  // Toggle grid/axes visibility based on edit mode
  useEffect(() => {
    rendererARef.current?.setGridAxesVisible(editingMode === 'instrument');
    rendererBRef.current?.setGridAxesVisible(editingMode === 'spatial');
    rendererCRef.current?.setGridAxesVisible(editingMode === 'classic');
  }, [editingMode]);

  // Upload beam wireframe
  useEffect(() => {
    if (!beam) return;
    rendererARef.current?.updateBeamGeometry(beam.beamAngleDeg / 2, beam.depthMaxM);
  }, [beam]);

  // Upload Mode A data
  useEffect(() => {
    if (!rendererARef.current || !volumeData || volumeData.length === 0) return;
    rendererARef.current.uploadVolume(volumeData, dimensions, extent);
    if (autoThreshold) {
      const threshold = computeAutoThreshold(volumeData, 85);
      // Apply directly to Mode A settings (doesn't need editingMode)
      setModeSettings((prev) => ({ ...prev, instrument: { ...prev.instrument, threshold } }));
      rendererARef.current?.updateSettings({ threshold });
    }
  }, [volumeData, dimensions, extent]);

  // ─── Mode B: sliding window temporal playback (buildWindowVolume) ────────
  // Exactly as in 7024cc8: pre-compute windowed volumes ahead of current position
  const frameCacheBRef = useRef<Map<number, { normalized: Float32Array; dimensions: [number, number, number]; extent: [number, number, number] }>>(new Map());

  useEffect(() => {
    if (!hasFrames || !frames || frames.length === 0) return;

    const cache = frameCacheBRef.current;
    const lookAhead = 8;
    let cancelled = false;
    (async () => {
      for (let offset = 0; offset <= lookAhead && !cancelled; offset++) {
        const idx = currentFrame + offset;
        if (idx >= frames.length || cache.has(idx)) continue;
        const result = buildWindowVolume(frames, idx, WINDOW_SIZE);
        if (!cancelled) cache.set(idx, result);
        if (offset % 4 === 3) await new Promise((r) => setTimeout(r, 0));
      }

      if (!cancelled) {
        const minKeep = Math.max(0, currentFrame - 2);
        for (const key of cache.keys()) {
          if (key < minKeep) cache.delete(key);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [currentFrame, frames, hasFrames]);

  // Mode B: build windowed volume and upload to renderer
  useEffect(() => {
    if (!rendererBRef.current || !hasFrames || !frames || frames.length === 0) return;

    const cache = frameCacheBRef.current;
    const cached = cache.get(currentFrame);
    const vol = cached ?? buildWindowVolume(frames, currentFrame, WINDOW_SIZE);
    if (!cached) cache.set(currentFrame, vol);

    rendererBRef.current.uploadVolume(vol.normalized, vol.dimensions, vol.extent);
  }, [currentFrame, frames, hasFrames]);

  // Slice data
  useEffect(() => {
    if (fullSliceVolume) {
      setSliceVolumeData(fullSliceVolume.data);
      setSliceDimensions(fullSliceVolume.dimensions);
    } else if (volumeData && volumeData.length > 0) {
      setSliceVolumeData(volumeData);
      setSliceDimensions(dimensions);
    }
  }, [fullSliceVolume, volumeData, dimensions]);

  // ─── Mode C: temporal projection + cache ────────────────────────────
  const frameCacheCRef = useRef<Map<number, { normalized: Float32Array; dimensions: [number, number, number]; extent: [number, number, number] }>>(new Map());

  useEffect(() => {
    if (!hasFrames || !beam || !grid) return;
    const cache = frameCacheCRef.current;
    let cancelled = false;
    (async () => {
      for (let offset = 0; offset <= 8 && !cancelled; offset++) {
        const idx = currentFrame + offset;
        if (idx >= frames!.length || cache.has(idx)) continue;
        const result = projectFrameWindow(frames!, idx, WINDOW_SIZE, beam!, grid!);
        if (!cancelled) cache.set(idx, result);
        if (offset % 4 === 3) await new Promise((r) => setTimeout(r, 0));
      }
      if (!cancelled) {
        const minKeep = Math.max(0, currentFrame - 2);
        for (const key of cache.keys()) { if (key < minKeep) cache.delete(key); }
      }
    })();
    return () => { cancelled = true; };
  }, [currentFrame, frames, beam, grid, hasFrames]);

  useEffect(() => {
    if (!rendererCRef.current || !hasFrames || !beam || !grid) return;
    const cache = frameCacheCRef.current;
    const cached = cache.get(currentFrame);
    const vol = cached ?? projectFrameWindow(frames!, currentFrame, WINDOW_SIZE, beam!, grid!);
    if (!cached) cache.set(currentFrame, vol);
    rendererCRef.current.uploadVolume(vol.normalized, vol.dimensions, vol.extent);
  }, [currentFrame, frames, beam, grid, hasFrames]);

  // Playback loop
  useEffect(() => {
    if (!hasFrames) return;
    playingRef.current = playing;
    currentFrameRef.current = currentFrame;
    if (!playing) return;
    let lastTime = 0;
    const intervalMs = 1000 / playSpeed;
    let rafId: number;
    const tick = (timestamp: number) => {
      if (!playingRef.current) return;
      if (timestamp - lastTime >= intervalMs) {
        lastTime = timestamp;
        const next = currentFrameRef.current + 1;
        if (next >= frames!.length) { setPlaying(false); return; }
        currentFrameRef.current = next;
        setCurrentFrame(next);
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [playing, playSpeed, hasFrames, frames, currentFrame]);

  // Settings update — per-mode
  const updateSetting = useCallback(
    (key: keyof RendererSettings, value: number | boolean | string) => {
      if (!editingMode) return;
      setModeSettings((prev) => {
        const modeKey = editingMode;
        const next = { ...prev, [modeKey]: { ...prev[modeKey], [key]: value } };
        if (modeKey === 'instrument') rendererARef.current?.updateSettings({ [key]: value });
        else if (modeKey === 'spatial') rendererBRef.current?.updateSettings({ [key]: value });
        else if (modeKey === 'classic') rendererCRef.current?.updateSettings({ [key]: value });
        onSettingsChange?.(next[modeKey]);
        return next;
      });
    },
    [onSettingsChange, editingMode],
  );

  const handleCameraPreset = useCallback((preset: CameraPreset) => {
    if (!editingMode) return;
    setModeCamera((prev) => ({ ...prev, [editingMode]: preset }));
    if (editingMode === 'instrument') rendererARef.current?.setCameraPreset(preset);
    else if (editingMode === 'spatial') rendererBRef.current?.setCameraPreset(preset);
    else if (editingMode === 'classic') rendererCRef.current?.setCameraPreset(preset);
  }, [editingMode]);

  const handleAutoThreshold = useCallback((enabled: boolean) => {
    setAutoThreshold(enabled);
    if (enabled && sliceVolumeData && sliceVolumeData.length > 0) {
      const threshold = computeAutoThreshold(sliceVolumeData, 85);
      updateSetting('threshold', threshold);
    }
  }, [sliceVolumeData, updateSetting]);

  const handleChromaticChange = useCallback((mode: string, chromaticMode: ChromaticMode) => {
    setModeSettings((prev) => {
      const next = { ...prev, [mode]: { ...prev[mode], chromaticMode } };
      if (mode === 'instrument') rendererARef.current?.updateSettings({ chromaticMode });
      else if (mode === 'spatial') rendererBRef.current?.updateSettings({ chromaticMode });
      else if (mode === 'classic') rendererCRef.current?.updateSettings({ chromaticMode });
      return next;
    });
  }, []);

  const handleCaptureScreenshot = useCallback(() => {
    return rendererARef.current?.captureScreenshot() ?? null;
  }, []);

  const chromaticModes = getChromaticModes();
  const totalFrames = frames?.length ?? 0;
  const currentTimeS = hasFrames && frames!.length > 0 ? frames![currentFrame]?.timeS ?? 0 : 0;

  const showB = hasFrames;
  const showC = hasFrames && !!beam && !!grid;

  // Background matches the renderer scene background for seamless 3D
  const viewportBg = theme === 'light' ? '#f5f5f7' : '#111111';
  // Stage 2 bg matches the settings panel (GlassPanel / colors.surface)
  const viewportBgEditing = theme === 'light' ? '#FFFFFF' : '#1A1A20';

  // ─── Render a single volume section (Two-Stage Grid UI) ─────────────
  const volumeHeight = 'clamp(440px, 62vh, 680px)';

  const renderVolumeSection = (
    mode: 'instrument' | 'spatial' | 'classic',
    containerRef: React.RefObject<HTMLDivElement | null>,
    title: string,
    subtitle: string,
    sectionIndex: number,
  ) => {
    const isExpanded = editingMode === mode;
    const volumeOnLeft = sectionIndex % 2 === 0;
    const isTemporal = mode === 'classic' || mode === 'spatial';
    const settings = modeSettings[mode];

    // Slider spacing: equal gap from volume→slider and slider→play
    const sliderGap = 0; // px from volume bottom to slider (tight)
    const sliderPlayGap = 12; // px between slider and play

    return (
      <section key={mode} style={{ marginBottom: '80px' }}>
        {/* ── 4-column grid: 3/4 volume + 1/4 title/settings ───── */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: '24px',
          gridTemplateRows: `${volumeHeight} auto`,
        }}>
          {/* ── Volume viewport: 3 columns, row 1 ──────────────── */}
          <div
            ref={containerRef}
            onPointerDown={() => { if (!isExpanded) handleStage1PointerDown(mode); }}
            onPointerUp={() => { if (!isExpanded) handleStage1PointerUp(mode); }}
            style={{
              gridColumn: volumeOnLeft ? '1 / 4' : '2 / 5',
              gridRow: '1',
              width: '100%',
              height: '100%',
              borderRadius: '16px',
              overflow: 'hidden',
              background: isExpanded ? viewportBgEditing : viewportBg,
              cursor: 'grab',
              transition: 'box-shadow 400ms ease, background 400ms ease, border-color 400ms ease',
              border: `1.5px solid ${isExpanded ? colors.accent : colors.border}`,
              boxShadow: isExpanded
                ? `0 8px 32px rgba(0,0,0,0.2)`
                : theme === 'light'
                  ? '0 2px 20px rgba(0,0,0,0.06)'
                  : '0 2px 20px rgba(0,0,0,0.3)',
            }}
          />

          {/* ── Slider + Play — row 2, under volume columns ── */}
          <div style={{
            gridColumn: volumeOnLeft ? '1 / 4' : '2 / 5',
            gridRow: '2',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            paddingTop: `${sliderGap}px`,
          }}>
            <div style={{
              width: 'max(260px, 40%)',
              padding: '10px 18px',
              background: colors.surface,
              borderRadius: '24px',
              border: `1px solid ${colors.border}`,
              backdropFilter: 'blur(12px)',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
            }}>
              <input
                type="range"
                min={0}
                max={isTemporal && hasFrames ? totalFrames - 1 : 100}
                value={isTemporal && hasFrames ? currentFrame : 50}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                  if (isTemporal && hasFrames) {
                    setPlaying(false);
                    setCurrentFrame(Number(e.target.value));
                  }
                }}
                style={{ flex: 1, accentColor: colors.accent, cursor: 'pointer', height: '6px' }}
              />
            </div>

            <div style={{ height: `${sliderPlayGap}px` }} />

            <button
              onClick={() => {
                if (isTemporal && hasFrames) {
                  if (currentFrame >= totalFrames - 1) setCurrentFrame(0);
                  setPlaying((p) => !p);
                }
              }}
              style={{
                width: '48px', height: '48px', borderRadius: '50%',
                border: `1.5px solid ${colors.accent}`,
                background: playing && isTemporal ? colors.accentMuted : colors.surface,
                color: colors.accent,
                cursor: 'pointer',
                fontSize: '16px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                paddingLeft: playing && isTemporal ? '0' : '2px',
                transition: 'all 150ms ease',
              }}
            >
              {playing && isTemporal ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="4" y="3" width="6" height="18" rx="1.5" />
                  <rect x="14" y="3" width="6" height="18" rx="1.5" />
                </svg>
              ) : '\u25B6'}
            </button>
          </div>

          {/* ── Settings column: 1 column, row 1 — TOP and BOTTOM aligned to volume ── */}
          <div style={{
            gridColumn: volumeOnLeft ? '4' : '1',
            gridRow: '1',
            alignSelf: 'stretch',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            /* NO paddingTop — title top aligns exactly with volume top */
          }}>
            {/* Title row: title (left) + number + chevron/close (right) */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <h2 style={{
                  margin: 0,
                  fontFamily: fonts.display,
                  fontVariationSettings: "'wght' 600",
                  fontSize: 'clamp(26px, 2.5vw, 40px)',
                  color: colors.text1,
                  letterSpacing: '-0.02em',
                  lineHeight: 1.1,
                }}>
                  <span style={{ color: colors.accent, fontSize: '0.7em', marginRight: '4px', position: 'relative', top: '-0.35em' }}>"</span>{title}<span style={{ color: colors.accent, fontSize: '0.7em', marginLeft: '4px', position: 'relative', top: '-0.35em' }}>"</span>
                </h2>
                <p style={{
                  margin: '2px 0 0',
                  fontSize: '13px',
                  color: colors.text3,
                  lineHeight: 1.3,
                }}>
                  {subtitle}
                </p>
              </div>
              {/* Section number */}
              <div style={{
                width: '44px', height: '44px', minWidth: '44px',
                borderRadius: '50%',
                border: `2px solid ${colors.accent}`,
                background: 'transparent',
                color: colors.accent,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '15px', fontWeight: 600,
                flexShrink: 0,
                paddingTop: '2px',
              }}>
                {String(sectionIndex + 1).padStart(2, '0')}
              </div>
              {/* Chevron (settings toggle) or X (calibration close) */}
              {isExpanded && calibrationOpen ? (
                <button
                  onClick={() => setCalibrationOpen(false)}
                  style={{
                    width: '48px', height: '48px', minWidth: '48px',
                    borderRadius: '50%',
                    border: `1.5px solid ${colors.accent}`,
                    background: colors.accentMuted,
                    color: colors.accent,
                    cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'all 200ms ease',
                    flexShrink: 0,
                  }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              ) : (
                <button
                  onClick={() => setEditingMode(isExpanded ? null : mode)}
                  style={{
                    width: '48px', height: '48px', minWidth: '48px',
                    borderRadius: '50%',
                    border: `1.5px solid ${isExpanded ? colors.accent : colors.border}`,
                    background: isExpanded ? colors.accentMuted : colors.surface,
                    color: isExpanded ? colors.accent : colors.text2,
                    cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transform: isExpanded ? 'rotate(180deg)' : 'none',
                    transition: 'all 200ms ease',
                    flexShrink: 0,
                  }}
                >
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginTop: '2px' }}>
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
              )}
            </div>

            {/* Chromatic pills */}
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'nowrap', overflow: 'hidden' }}>
              {chromaticModes.map((m: ChromaticMode) => (
                <button
                  key={m}
                  onClick={() => handleChromaticChange(mode, m)}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '9999px',
                    border: `1px solid ${settings.chromaticMode === m ? colors.accent : 'transparent'}`,
                    background: settings.chromaticMode === m ? colors.accentMuted : colors.surface,
                    color: settings.chromaticMode === m ? colors.accent : colors.text1,
                    fontSize: '11px',
                    fontWeight: 500,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    transition: 'all 150ms ease',
                    whiteSpace: 'nowrap',
                    flexShrink: 0,
                  }}
                >
                  {CHROMATIC_LABELS[m][lang as 'en' | 'fr'] || CHROMATIC_LABELS[m].en}
                </button>
              ))}
            </div>

            {/* Settings or Calibration panel — flex:1 fills remaining height to align bottom with volume */}
            {isExpanded && (
              <GlassPanel className="echos-controls-panel" style={{
                padding: '14px',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
                flex: 1,
                minHeight: 0,
                overflowY: 'auto',
                borderRadius: '16px',
                backdropFilter: 'blur(24px)',
                animation: 'echos-fade-in 200ms ease',
              }}>
                {calibrationOpen ? (
                  <CalibrationPanel
                    config={calibrations[mode]}
                    onChange={handleCalibrationChange}
                    onClose={() => setCalibrationOpen(false)}
                    saved={calibrationSaved}
                    saveLabel={calibrationSaveLabel}
                  />
                ) : (
                  <SettingsControls
                    settings={modeSettings[mode]}
                    cameraPreset={modeCamera[mode]}
                    autoThreshold={autoThreshold}
                    showGhostSlider={mode === 'spatial'}
                    showBeamToggle={mode === 'instrument'}
                    showSpeedSlider={mode === 'classic' && hasFrames}
                    playSpeed={playSpeed}
                    chromaticModes={chromaticModes}
                    lang={lang}
                    t={t}
                    onUpdateSetting={updateSetting}
                    onCameraPreset={handleCameraPreset}
                    onAutoThreshold={handleAutoThreshold}
                    onPlaySpeed={setPlaySpeed}
                  />
                )}
              </GlassPanel>
            )}
          </div>
        </div>
      </section>
    );
  };

  // Generate YZ slice thumbnail — same colorMap as SlicePanel "Water Off"
  const WATER_OFF_MAP = [
    [0.0, 0, 0, 0, 0], [0.15, 0, 0, 0, 0], [0.3, 10, 20, 60, 20],
    [0.5, 66, 33, 206, 120], [0.7, 140, 100, 255, 200], [1.0, 225, 224, 235, 255],
  ];
  const yzThumbnailRef = useRef<string | null>(null);
  if (volumeData && dimensions[0] > 0 && !yzThumbnailRef.current) {
    try {
      const [dimX, dimY, dimZ] = dimensions;
      const sliceX = Math.floor(dimX / 2);
      // axis=x: w=dimY, h=dimZ, idx = row*dimY*dimX + col*dimX + sliceX
      const cW = dimY, cH = dimZ;
      const canvas = document.createElement('canvas');
      canvas.width = cW;
      canvas.height = cH;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const imgData = ctx.createImageData(cW, cH);
        for (let row = 0; row < cH; row++) {
          for (let col = 0; col < cW; col++) {
            const idx = row * dimY * dimX + col * dimX + sliceX;
            const val = Math.max(0, Math.min(1, idx < volumeData.length ? volumeData[idx] : 0));
            let r = 0, g = 0, b = 0, a = 0;
            for (let i = 1; i < WATER_OFF_MAP.length; i++) {
              if (val <= WATER_OFF_MAP[i][0]) {
                const t = (val - WATER_OFF_MAP[i - 1][0]) / (WATER_OFF_MAP[i][0] - WATER_OFF_MAP[i - 1][0]);
                r = WATER_OFF_MAP[i - 1][1] + t * (WATER_OFF_MAP[i][1] - WATER_OFF_MAP[i - 1][1]);
                g = WATER_OFF_MAP[i - 1][2] + t * (WATER_OFF_MAP[i][2] - WATER_OFF_MAP[i - 1][2]);
                b = WATER_OFF_MAP[i - 1][3] + t * (WATER_OFF_MAP[i][3] - WATER_OFF_MAP[i - 1][3]);
                a = WATER_OFF_MAP[i - 1][4] + t * (WATER_OFF_MAP[i][4] - WATER_OFF_MAP[i - 1][4]);
                break;
              }
            }
            const pxIdx = (row * cW + col) * 4;
            imgData.data[pxIdx] = r;
            imgData.data[pxIdx + 1] = g;
            imgData.data[pxIdx + 2] = b;
            imgData.data[pxIdx + 3] = a;
          }
        }
        ctx.putImageData(imgData, 0, 0);
        yzThumbnailRef.current = canvas.toDataURL('image/png');
      }
    } catch { /* ignore */ }
  }

  const hasMap = gpxTrack && gpxTrack.points.length > 1;

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {/* ── Title — always at top, full width ───────────── */}
      <div style={{ paddingTop: 'clamp(32px, 5vh, 64px)', marginBottom: '40px' }}>
        <h1 style={{
          margin: 0,
          color: colors.text1,
          fontSize: 'clamp(24px, 3vw, 36px)',
          fontWeight: 600,
          marginBottom: '2px',
        }}>
          {t('v2.viewer.title')}
        </h1>
        <p style={{
          margin: 0,
          color: colors.text2,
          fontSize: '15px',
          lineHeight: 1.6,
          maxWidth: '700px',
        }}>
          {t('v2.viewer.desc')}
        </p>
      </div>

      {/* ── File info (3 cols) + Map (1 col) — aligned to 4-column grid ─── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: '24px',
        marginBottom: '64px',
      }}>
        {/* File identification — 3 columns */}
        <div style={{
          gridColumn: '1 / 4',
          display: 'flex',
          alignItems: 'center',
          gap: '16px',
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: '16px',
          padding: '16px 20px',
          overflow: 'hidden',
        }}>
          {/* Thumbnail from YZ slice — rotated 90deg counter-clockwise */}
          <div style={{
            width: '120px',
            height: '120px',
            borderRadius: '12px',
            overflow: 'hidden',
            flexShrink: 0,
            background: viewportBg,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            {yzThumbnailRef.current ? (
              <img
                src={yzThumbnailRef.current}
                alt="YZ slice"
                style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'rotate(90deg)' }}
              />
            ) : (
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke={colors.text3} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
            )}
          </div>
          {/* File details */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '15px', fontWeight: 600, color: colors.text1, marginBottom: '8px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {videoFileName || 'Session'}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px 24px', fontSize: '13px', color: colors.text2 }}>
              {videoDurationS != null && videoDurationS > 0 && (
                <span>{videoDurationS.toFixed(1)}s</span>
              )}
              {dimensions && (
                <span>{dimensions[0]}×{dimensions[1]}×{dimensions[2]}</span>
              )}
              {gpxTrack && (
                <span>{gpxTrack.totalDistanceM.toFixed(0)}m</span>
              )}
              {gpxFileName && (
                <span style={{ color: colors.text3 }}>{gpxFileName}</span>
              )}
              {frames && frames.length > 0 && (
                <span>{frames.length} frames</span>
              )}
              {gpxTrack && gpxTrack.points.length > 0 && (
                <span>
                  {gpxTrack.points[0].lat.toFixed(4)}°N, {gpxTrack.points[0].lon.toFixed(4)}°E
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Map — 1 column, aligned to file info height */}
        <div style={{
          gridColumn: '4',
          borderRadius: '16px',
          overflow: 'hidden',
          border: `1px solid ${colors.border}`,
          position: 'relative',
        }}>
          <GpsMap points={hasMap ? gpxTrack.points : undefined} theme={theme} />
          {!hasMap && (
            <div style={{
              position: 'absolute',
              bottom: '8px',
              left: '8px',
              right: '8px',
              background: theme === 'light' ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.7)',
              borderRadius: '8px',
              padding: '6px 10px',
              fontSize: '10px',
              color: colors.text3,
              lineHeight: 1.3,
              textAlign: 'center',
            }}>
              {lang === 'fr'
                ? 'Importez un fichier GPX pour accéder à la carte.'
                : 'Import a GPX file to access the map.'}
            </div>
          )}
        </div>
      </div>

      {/* ── Volume sections — 4-column grid, alternating layout ──── */}
      {(() => {
        const sections: Array<{ mode: 'instrument' | 'spatial' | 'classic'; ref: typeof containerARef; title: string; subtitle: string }> = [];
        if (showC) sections.push({ mode: 'classic', ref: containerCRef, title: 'Cône', subtitle: 'Projection conique glissante' });
        sections.push({ mode: 'instrument', ref: containerARef, title: 'Trace', subtitle: 'Empilement statique' });
        if (showB) sections.push({ mode: 'spatial', ref: containerBRef, title: 'Cube', subtitle: 'Projection cubique du parcours' });
        return sections.map((s, i) => renderVolumeSection(s.mode, s.ref, s.title, s.subtitle, i));
      })()}

      {/* Orthogonal slice panels */}
      {sliceVolumeData && sliceVolumeData.length > 0 && (
        <div style={{ marginBottom: '32px' }}>
          <SlicePanel volumeData={sliceVolumeData} dimensions={sliceDimensions} />
        </div>
      )}

      {/* Export panel */}
      <ExportPanel
        volumeData={sliceVolumeData}
        dimensions={sliceDimensions}
        extent={extent}
        onCaptureScreenshot={handleCaptureScreenshot}
      />

      {/* Bottom action buttons */}
      <div style={{ height: '32px', flexShrink: 0 }} />
      {(onReconfigure || onNewScan) && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: '16px', flexShrink: 0, paddingBottom: '24px' }}>
          {/* Poster button — accent outline */}
          <button
            className="echos-action-btn"
            onClick={() => {
              const sessionData = {
                timestamp: new Date().toISOString(),
                gpxTrack: gpxTrack ? { points: gpxTrack.points, totalDistanceM: gpxTrack.totalDistanceM } : null,
                dimensions,
                extent,
                beam,
                grid,
                settings: modeSettings,
              };
              const blob = new Blob([JSON.stringify(sessionData, null, 2)], { type: 'application/json' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `ecos-session-${Date.now()}.json`;
              a.click();
              URL.revokeObjectURL(url);
            }}
            style={{
              padding: '12px 32px', borderRadius: '9999px',
              border: `1.5px solid ${colors.accent}`,
              background: 'transparent', color: colors.accent,
              fontSize: '15px', fontWeight: 600, fontFamily: 'inherit',
              cursor: 'pointer', transition: 'all 150ms ease',
            }}
          >
            Poster
          </button>
          {onReconfigure && (
            <button
              className="echos-action-btn"
              onClick={onReconfigure}
              style={{
                padding: '12px 32px', borderRadius: '9999px',
                border: `1.5px solid ${colors.accent}`,
                background: 'transparent', color: colors.accent,
                fontSize: '15px', fontWeight: 600, fontFamily: 'inherit',
                cursor: 'pointer', transition: 'all 150ms ease',
              }}
            >
              {t('v2.viewer.reconfigure')}
            </button>
          )}
          {onNewScan && (
            <Button variant="primary" size="lg" onClick={onNewScan}>
              {t('v2.viewer.newScan')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

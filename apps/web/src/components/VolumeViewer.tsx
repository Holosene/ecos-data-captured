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
import { GlassPanel, Slider, Button, colors } from '@echos/ui';
import type { RendererSettings, ChromaticMode, PreprocessedFrame, BeamSettings, VolumeGridSettings } from '@echos/core';
import { DEFAULT_RENDERER, projectFrameWindow, computeAutoThreshold } from '@echos/core';
import { VolumeRenderer, DEFAULT_CALIBRATION, DEFAULT_CALIBRATION_B, DEFAULT_CALIBRATION_C } from '../engine/volume-renderer.js';
import type { CameraPreset, CalibrationConfig } from '../engine/volume-renderer.js';
import { VolumeRendererClassic } from '../engine/volume-renderer-classic.js';
import { CalibrationPanel, loadCalibration, saveCalibration, downloadCalibration } from './CalibrationPanel.js';
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
function GpsMap({ points, theme }: { points: Array<{ lat: number; lon: number }>; theme: string }) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;
    if (points.length < 2) return;

    const map = L.map(mapContainerRef.current, {
      zoomControl: false,
      attributionControl: false,
      scrollWheelZoom: false,
    });

    L.control.zoom({ position: 'topright' }).addTo(map);

    const tileUrl = theme === 'light'
      ? 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'
      : 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
    L.tileLayer(tileUrl, { maxZoom: 19 }).addTo(map);

    const latLngs = points.map((p) => L.latLng(p.lat, p.lon));
    const polyline = L.polyline(latLngs, {
      color: colors.accent,
      weight: 3,
      opacity: 0.8,
      smoothFactor: 1.5,
    }).addTo(map);

    // Start marker
    L.circleMarker(latLngs[0], {
      radius: 5, color: '#22c55e', fillColor: '#22c55e', fillOpacity: 1, weight: 0,
    }).addTo(map);

    // End marker
    L.circleMarker(latLngs[latLngs.length - 1], {
      radius: 5, color: '#ef4444', fillColor: '#ef4444', fillOpacity: 1, weight: 0,
    }).addTo(map);

    map.fitBounds(polyline.getBounds(), { padding: [30, 30], maxZoom: 16 });

    map.on('click', () => map.scrollWheelZoom.enable());
    map.on('mouseout', () => map.scrollWheelZoom.disable());

    mapInstanceRef.current = map;

    return () => {
      map.remove();
      mapInstanceRef.current = null;
    };
  }, [points, theme]);

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

// ─── Edit controls panel (floating overlay) ─────────────────────────────
function EditPanel({
  settings,
  cameraPreset,
  autoThreshold,
  activeMode,
  showGhostSlider,
  showBeamToggle,
  showSpeedSlider,
  playSpeed,
  chromaticModes,
  lang,
  t,
  onUpdateSetting,
  onCameraPreset,
  onAutoThreshold,
  onPlaySpeed,
  onClose,
}: {
  settings: RendererSettings;
  cameraPreset: CameraPreset;
  autoThreshold: boolean;
  activeMode: string;
  showGhostSlider: boolean;
  showBeamToggle: boolean;
  showSpeedSlider: boolean;
  playSpeed: number;
  chromaticModes: ChromaticMode[];
  lang: string;
  t: (key: any) => string;
  onUpdateSetting: (key: keyof RendererSettings, value: number | boolean | string) => void;
  onCameraPreset: (preset: CameraPreset) => void;
  onAutoThreshold: (enabled: boolean) => void;
  onPlaySpeed: (speed: number) => void;
  onClose: () => void;
}) {
  return (
    <div style={{
      width: '320px',
      flexShrink: 0,
      display: 'flex',
      flexDirection: 'column',
      animation: 'echos-fade-in 200ms ease',
    }}>
      <GlassPanel style={{
        padding: '14px',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        flex: 1,
        overflowY: 'auto',
        borderRadius: '16px',
        backdropFilter: 'blur(24px)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontSize: '13px', color: colors.text1, fontWeight: 600 }}>
            {t('v2.controls.title')}
          </h3>
          <button
            onClick={onClose}
            style={{
              width: '28px', height: '28px', borderRadius: '8px',
              border: `1px solid ${colors.border}`, background: colors.surface,
              color: colors.text2, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <IconClose />
          </button>
        </div>

        {/* Camera presets */}
        <div style={{ display: 'flex', gap: '4px' }}>
          {CAMERA_PRESETS.map((p) => (
            <button
              key={p.key}
              onClick={() => onCameraPreset(p.key)}
              title={t(p.labelKey as TranslationKey)}
              style={{
                width: '30px', height: '30px', borderRadius: '8px',
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

        {/* Chromatic mode */}
        <div>
          <label style={{ fontSize: '11px', color: colors.text2, marginBottom: '4px', display: 'block' }}>
            {t('v2.controls.palette')}
          </label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
            {chromaticModes.map((m: ChromaticMode) => (
              <button
                key={m}
                onClick={() => onUpdateSetting('chromaticMode', m)}
                style={{
                  padding: '5px 10px', borderRadius: '16px',
                  border: `1px solid ${settings.chromaticMode === m ? colors.accent : colors.border}`,
                  background: settings.chromaticMode === m ? colors.accentMuted : 'transparent',
                  color: settings.chromaticMode === m ? colors.accent : colors.text2,
                  fontSize: '11px', fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
                  transition: 'all 150ms ease',
                }}
              >
                {CHROMATIC_LABELS[m][lang as 'en' | 'fr'] || CHROMATIC_LABELS[m].en}
              </button>
            ))}
          </div>
        </div>

        {/* Sliders */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 12px' }}>
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
      </GlassPanel>
    </div>
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

  // Per-mode settings — each mode has its EXACT configuration from 7024cc8
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

  // ─── Micro-interaction (Stage 1 only): CSS perspective tilt ─────────
  const microRefs = useRef<Record<string, {
    wrapperEl: HTMLDivElement | null;
    startX: number; startY: number;
    dragging: boolean;
  }>>({
    instrument: { wrapperEl: null, startX: 0, startY: 0, dragging: false },
    spatial: { wrapperEl: null, startX: 0, startY: 0, dragging: false },
    classic: { wrapperEl: null, startX: 0, startY: 0, dragging: false },
  });

  const handleMicroPointerDown = useCallback((mode: string, e: React.PointerEvent) => {
    const micro = microRefs.current[mode];
    micro.dragging = true;
    micro.startX = e.clientX;
    micro.startY = e.clientY;
    if (micro.wrapperEl) micro.wrapperEl.style.transition = 'none';
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const handleMicroPointerMove = useCallback((mode: string, e: React.PointerEvent) => {
    const micro = microRefs.current[mode];
    if (!micro.dragging || !micro.wrapperEl) return;
    const dx = (e.clientX - micro.startX) * 0.04;
    const dy = (e.clientY - micro.startY) * 0.04;
    const max = 8;
    const rotY = Math.max(-max, Math.min(max, dx));
    const rotX = Math.max(-max, Math.min(max, -dy));
    micro.wrapperEl.style.transform = `perspective(800px) rotateX(${rotX}deg) rotateY(${rotY}deg)`;
  }, []);

  const handleMicroPointerUp = useCallback((mode: string) => {
    const micro = microRefs.current[mode];
    micro.dragging = false;
    if (micro.wrapperEl) {
      micro.wrapperEl.style.transition = 'transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)';
      micro.wrapperEl.style.transform = 'perspective(800px) rotateX(0deg) rotateY(0deg)';
    }
  }, []);

  // Calibration (hidden dev tool: press "b" x5)
  const [calibrationOpen, setCalibrationOpen] = useState(false);
  const [calibration, setCalibration] = useState<CalibrationConfig>(() => {
    const saved = loadCalibration();
    return saved ?? { ...DEFAULT_CALIBRATION };
  });
  const [calibrationSaved, setCalibrationSaved] = useState(false);
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

      if ((e.ctrlKey || e.metaKey) && e.key === 's' && calibrationOpen) {
        e.preventDefault();
        const cal = rendererARef.current?.getCalibration() ?? calibration;
        saveCalibration(cal);
        downloadCalibration(cal);
        setCalibrationSaved(true);
        setTimeout(() => setCalibrationSaved(false), 2000);
        return;
      }

      if (e.key === 'b' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        bPressCountRef.current += 1;
        if (bPressTimerRef.current) clearTimeout(bPressTimerRef.current);
        bPressTimerRef.current = setTimeout(() => { bPressCountRef.current = 0; }, 2000);
        if (bPressCountRef.current >= 5) {
          bPressCountRef.current = 0;
          setCalibrationOpen((prev) => !prev);
        }
      }

      if (e.key === 'Escape') {
        if (calibrationOpen) setCalibrationOpen(false);
        else if (editingMode) setEditingMode(null);
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [calibrationOpen, calibration, editingMode]);

  // Theme sync
  useEffect(() => {
    const bgColor = theme === 'light' ? '#f5f5f7' : '#0a0a0f';
    [rendererARef, rendererBRef, rendererCRef].forEach((ref) => {
      if (ref.current) {
        const cal = ref.current === rendererARef.current ? { ...DEFAULT_CALIBRATION, bgColor }
          : ref.current === rendererBRef.current ? { ...DEFAULT_CALIBRATION_B, bgColor }
          : { ...DEFAULT_CALIBRATION_C, bgColor };
        ref.current.setCalibration(cal);
      }
    });
  }, [theme]);

  const handleCalibrationChange = useCallback((cal: CalibrationConfig) => {
    setCalibration(cal);
    setCalibrationSaved(false);
    rendererARef.current?.setCalibration(cal);
  }, []);

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

  // ─── Initialize 3 renderers (each with its OWN engine + calibration from 7024cc8) ──
  useEffect(() => {
    const bgColor = theme === 'light' ? '#f5f5f7' : '#0a0a0f';

    // Mode A — VolumeRenderer + DEFAULT_CALIBRATION, camera 'frontal'
    if (containerARef.current && !rendererARef.current) {
      rendererARef.current = new VolumeRenderer(containerARef.current, modeSettings.instrument, { ...DEFAULT_CALIBRATION, bgColor });
      rendererARef.current.setCameraPreset('frontal');
      rendererARef.current.setGridAxesVisible(false);
    }

    // Mode B — VolumeRenderer + DEFAULT_CALIBRATION_B, camera 'horizontal'
    // Uses frames for buildWindowVolume temporal playback (NOT static spatial data)
    if (containerBRef.current && !rendererBRef.current && hasFrames) {
      rendererBRef.current = new VolumeRenderer(containerBRef.current, modeSettings.spatial, { ...DEFAULT_CALIBRATION_B, bgColor });
      rendererBRef.current.setCameraPreset('horizontal');
      rendererBRef.current.setGridAxesVisible(false);
    }

    // Mode C — VolumeRendererClassic + DEFAULT_CALIBRATION_C, camera 'frontal'
    // Uses frames for projectFrameWindow temporal playback
    if (containerCRef.current && !rendererCRef.current && hasFrames) {
      rendererCRef.current = new VolumeRendererClassic(containerCRef.current, modeSettings.classic, { ...DEFAULT_CALIBRATION_C, bgColor });
      rendererCRef.current.setCameraPreset('frontal');
      rendererCRef.current.setGridAxesVisible(false);
    }

    return () => {
      rendererARef.current?.dispose(); rendererARef.current = null;
      rendererBRef.current?.dispose(); rendererBRef.current = null;
      rendererCRef.current?.dispose(); rendererCRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasFrames]);

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
    const lookAhead = 16;
    let cancelled = false;
    (async () => {
      for (let offset = 0; offset <= lookAhead && !cancelled; offset++) {
        const idx = currentFrame + offset;
        if (idx >= frames.length || cache.has(idx)) continue;
        const result = buildWindowVolume(frames, idx, WINDOW_SIZE);
        if (!cancelled) cache.set(idx, result);
        if (offset % 4 === 3) await new Promise((r) => setTimeout(r, 0));
      }

      const minKeep = Math.max(0, currentFrame - 4);
      for (const key of cache.keys()) {
        if (key < minKeep) cache.delete(key);
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
      for (let offset = 0; offset <= 16 && !cancelled; offset++) {
        const idx = currentFrame + offset;
        if (idx >= frames!.length || cache.has(idx)) continue;
        const result = projectFrameWindow(frames!, idx, WINDOW_SIZE, beam!, grid!);
        if (!cancelled) cache.set(idx, result);
        if (offset % 4 === 3) await new Promise((r) => setTimeout(r, 0));
      }
      const minKeep = Math.max(0, currentFrame - 4);
      for (const key of cache.keys()) { if (key < minKeep) cache.delete(key); }
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

  const handleCaptureScreenshot = useCallback(() => {
    return rendererARef.current?.captureScreenshot() ?? null;
  }, []);

  const chromaticModes = getChromaticModes();
  const totalFrames = frames?.length ?? 0;
  const currentTimeS = hasFrames && frames!.length > 0 ? frames![currentFrame]?.timeS ?? 0 : 0;

  const showB = hasFrames;
  const showC = hasFrames && !!beam && !!grid;

  // Background that matches the page for borderless feel
  const viewportBg = theme === 'light' ? '#f5f5f7' : '#0a0a0f';

  // ─── Render a single volume section (Two-Stage UI) ──────────────────
  const encapsulatedBg = theme === 'light' ? '#e8e8ec' : '#141418';

  const renderVolumeSection = (
    mode: 'instrument' | 'spatial' | 'classic',
    containerRef: React.RefObject<HTMLDivElement | null>,
    title: string,
    subtitle: string,
    height: string,
    sectionIndex: number,
  ) => {
    const isExpanded = editingMode === mode;
    const isTemporal = mode === 'classic' || mode === 'spatial';
    const settingsOnRight = sectionIndex % 2 === 0;

    return (
      <section
        key={mode}
        style={{
          marginBottom: '48px',
          borderRadius: isExpanded ? '20px' : '0',
          background: isExpanded ? encapsulatedBg : 'transparent',
          border: isExpanded ? `1px solid ${colors.border}` : '1px solid transparent',
          padding: isExpanded ? '24px' : '0',
          transition: 'background 400ms ease, border-color 400ms ease, padding 400ms ease, border-radius 400ms ease',
        }}
      >
        {/* ── Title + Chevron Toggle ──────────────────────────────── */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '16px',
          padding: isExpanded ? '10px 20px' : '0 4px',
          background: isExpanded ? colors.surface : 'transparent',
          borderRadius: isExpanded ? '24px' : '0',
          border: isExpanded ? `1px solid ${colors.border}` : 'none',
          transition: 'all 300ms ease',
        }}>
          <div>
            <h2 style={{
              margin: 0,
              fontSize: isExpanded ? '18px' : '24px',
              fontWeight: 700,
              color: colors.text1,
              letterSpacing: '-0.02em',
              transition: 'font-size 300ms ease',
            }}>
              {title}
            </h2>
            <p style={{
              margin: '2px 0 0',
              fontSize: isExpanded ? '12px' : '14px',
              color: colors.text3,
              transition: 'font-size 300ms ease',
            }}>
              {subtitle}
            </p>
          </div>
          <button
            onClick={() => setEditingMode(isExpanded ? null : mode)}
            style={{
              width: '32px', height: '32px',
              borderRadius: '50%',
              border: `1px solid ${colors.border}`,
              background: 'transparent',
              color: colors.text2,
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
              transition: 'transform 300ms ease, border-color 200ms ease',
            }}
          >
            <IconChevronDown />
          </button>
        </div>

        {/* ── Content: Volume viewport + optional EditPanel ───────── */}
        <div style={{
          display: 'flex',
          flexDirection: isExpanded ? (settingsOnRight ? 'row' : 'row-reverse') : 'column',
          gap: isExpanded ? '16px' : '0',
          transition: 'gap 300ms ease',
        }}>
          {/* Volume column */}
          <div style={{ flex: 1, minWidth: 0 }}>
            {/* Micro-interaction wrapper (CSS perspective tilt in Stage 1) */}
            <div
              ref={(el) => { if (el) microRefs.current[mode].wrapperEl = el; }}
              style={{
                position: 'relative',
                transform: 'perspective(800px) rotateX(0deg) rotateY(0deg)',
                transition: 'transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)',
              }}
            >
              <div
                ref={containerRef}
                style={{
                  width: '100%',
                  height,
                  borderRadius: '16px',
                  overflow: 'hidden',
                  background: viewportBg,
                  cursor: isExpanded ? 'grab' : 'default',
                  pointerEvents: isExpanded ? 'auto' : 'none',
                  transition: 'box-shadow 300ms ease',
                  boxShadow: isExpanded
                    ? `0 0 0 2px ${colors.accent}40, 0 8px 32px rgba(0,0,0,0.2)`
                    : theme === 'light'
                      ? '0 2px 20px rgba(0,0,0,0.06)'
                      : '0 2px 20px rgba(0,0,0,0.3)',
                  border: isExpanded ? `1px solid ${colors.border}` : 'none',
                }}
              />

              {/* Micro-interaction overlay (Stage 1 only — captures pointer for tilt) */}
              {!isExpanded && (
                <div
                  style={{ position: 'absolute', inset: 0, cursor: 'grab', borderRadius: '16px' }}
                  onPointerDown={(e) => handleMicroPointerDown(mode, e)}
                  onPointerMove={(e) => handleMicroPointerMove(mode, e)}
                  onPointerUp={() => handleMicroPointerUp(mode)}
                  onPointerLeave={() => handleMicroPointerUp(mode)}
                />
              )}
            </div>
          </div>

          {/* Settings panel (Stage 2 only — flows beside the volume) */}
          {isExpanded && (
            <EditPanel
              settings={modeSettings[mode]}
              cameraPreset={modeCamera[mode]}
              autoThreshold={autoThreshold}
              activeMode={mode}
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
              onClose={() => setEditingMode(null)}
            />
          )}
        </div>

        {/* ── Timeline slider (temporal modes only) ───────────────── */}
        {isTemporal && hasFrames && totalFrames > 0 && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            marginTop: '12px',
            padding: '10px 16px',
            background: isExpanded ? colors.surface : 'transparent',
            borderRadius: isExpanded ? '24px' : '8px',
            border: isExpanded ? `1px solid ${colors.border}` : 'none',
            transition: 'all 300ms ease',
          }}>
            <button
              onClick={() => {
                if (currentFrame >= totalFrames - 1) setCurrentFrame(0);
                setPlaying((p) => !p);
              }}
              style={{
                width: '28px', height: '28px', borderRadius: '50%',
                border: `1px solid ${colors.accent}`,
                background: playing ? colors.accentMuted : 'transparent',
                color: colors.accent, cursor: 'pointer', fontSize: '12px',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}
            >
              {playing ? '||' : '\u25B6'}
            </button>
            <input
              type="range" min={0} max={totalFrames - 1} value={currentFrame}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setPlaying(false); setCurrentFrame(Number(e.target.value)); }}
              style={{ flex: 1, height: '4px', cursor: 'pointer', accentColor: colors.accent }}
            />
            <div style={{ fontSize: '11px', color: colors.text3, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
              {currentTimeS.toFixed(1)}s — {currentFrame + 1}/{totalFrames}
            </div>
          </div>
        )}

        {/* Calibration panel (dev tool — only for instrument in Stage 2) */}
        {isExpanded && calibrationOpen && mode === 'instrument' && (
          <div style={{ marginTop: '16px' }}>
            <CalibrationPanel
              config={calibration}
              onChange={handleCalibrationChange}
              onClose={() => setCalibrationOpen(false)}
              saved={calibrationSaved}
            />
          </div>
        )}
      </section>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {/* Page title */}
      <div style={{ marginBottom: '40px', textAlign: 'center' }}>
        <h1 style={{
          margin: 0,
          fontSize: 'clamp(28px, 3.5vw, 42px)',
          fontWeight: 700,
          color: colors.text1,
          letterSpacing: '-0.03em',
        }}>
          {t('v2.viewer.title')}
        </h1>
      </div>

      {/* Volume sections — two-stage UI, stacked vertically */}
      {(() => {
        const sections: Array<{ mode: 'instrument' | 'spatial' | 'classic'; ref: typeof containerARef; title: string; subtitle: string; height: string }> = [];
        if (showC) sections.push({ mode: 'classic', ref: containerCRef, title: 'Cône', subtitle: 'Projection conique glissante', height: 'clamp(400px, 50vh, 600px)' });
        sections.push({ mode: 'instrument', ref: containerARef, title: 'Trace', subtitle: 'Empilement statique', height: 'clamp(350px, 45vh, 550px)' });
        if (showB) sections.push({ mode: 'spatial', ref: containerBRef, title: 'Cube', subtitle: 'Projection cubique du parcours', height: 'clamp(350px, 45vh, 550px)' });
        return sections.map((s, i) => renderVolumeSection(s.mode, s.ref, s.title, s.subtitle, s.height, i));
      })()}

      {/* GPS Map section */}
      {gpxTrack && gpxTrack.points.length > 1 && (
        <section style={{ marginBottom: '48px' }}>
          <div style={{ marginBottom: '16px', padding: '0 4px' }}>
            <h2 style={{
              margin: 0,
              fontSize: '24px',
              fontWeight: 700,
              color: colors.text1,
              letterSpacing: '-0.02em',
            }}>
              Carte
            </h2>
            <p style={{ margin: '4px 0 0', fontSize: '14px', color: colors.text3 }}>
              Tracé GPS — {gpxTrack.totalDistanceM.toFixed(0)}m parcourus
            </p>
          </div>
          <div style={{
            width: '100%',
            height: '340px',
            borderRadius: '16px',
            overflow: 'hidden',
            boxShadow: theme === 'light'
              ? '0 2px 20px rgba(0,0,0,0.06)'
              : '0 2px 20px rgba(0,0,0,0.3)',
          }}>
            <GpsMap points={gpxTrack.points} theme={theme} />
          </div>
        </section>
      )}

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

      {/* Poster button */}
      <div style={{ marginTop: '32px', display: 'flex', justifyContent: 'center' }}>
        <Button
          variant="primary"
          size="lg"
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
        >
          Poster
        </Button>
      </div>

      {/* Bottom action buttons */}
      <div style={{ height: '32px', flexShrink: 0 }} />
      {(onReconfigure || onNewScan) && (
        <div style={{ display: 'flex', justifyContent: 'space-between', flexShrink: 0, paddingBottom: '24px' }}>
          {onReconfigure && (
            <Button variant="ghost" size="lg" onClick={onReconfigure}>
              {t('v2.viewer.reconfigure')}
            </Button>
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

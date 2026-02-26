/**
 * ECHOS V2 — Volume Viewer Component (Multi-mode)
 *
 * Displays all 3 render modes simultaneously:
 *   - Cône (Instrument): static stacked cone volume
 *   - Trace (Spatial): GPS-mapped spatial volume with temporal playback
 *   - Projection (Classic): windowed conic projection with temporal playback
 *
 * Layout:
 *   - 3 viewports side by side
 *   - Mini-map overlay (top-left) showing GPS trace
 *   - Grid/axes only in "manipulation" mode (toggle button)
 *   - Calibration panel via "bbbbb" shortcut
 *   - Shared controls panel on the right
 *   - Poster button at bottom
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

interface VolumeViewerProps {
  /** Mode A (Instrument) data — always present */
  volumeData: Float32Array | null;
  dimensions: [number, number, number];
  extent: [number, number, number];
  /** Mode B (Spatial) data — null when no GPS */
  spatialData?: Float32Array | null;
  spatialDimensions?: [number, number, number];
  spatialExtent?: [number, number, number];
  /** Preprocessed frames for Mode C + slices */
  frames?: PreprocessedFrame[];
  beam?: BeamSettings;
  grid?: VolumeGridSettings;
  /** GPX track for mini-map */
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
  const dimX = windowFrames[0].width;
  const dimY = windowFrames.length;
  const dimZ = windowFrames[0].height;
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
  const aspect = dimX / dimZ;
  return { normalized: data, dimensions: [dimX, dimY, dimZ], extent: [aspect, 0.5, 1] };
}

// ─── SVG View Icons ──────────────────────────────────────────────────────
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

const CAMERA_PRESETS: { key: CameraPreset; labelKey: string; Icon: React.FC }[] = [
  { key: 'frontal', labelKey: 'v2.camera.frontal', Icon: IconFrontal },
  { key: 'horizontal', labelKey: 'v2.camera.horizontal', Icon: IconHorizontal },
  { key: 'vertical', labelKey: 'v2.camera.vertical', Icon: IconVertical },
  { key: 'free', labelKey: 'v2.camera.free', Icon: IconFree },
];

// Mode definitions — short names based on rendering method
const MODE_DEFS = [
  { key: 'instrument' as const, label: 'Cône', desc: 'Empilement statique', color: '#4488ff' },
  { key: 'spatial' as const, label: 'Trace', desc: 'Déroulé GPS', color: '#ff8844' },
  { key: 'classic' as const, label: 'Projection', desc: 'Fenêtre temporelle', color: '#22cc88' },
] as const;

// ─── Mini-map component (canvas-based GPS trace) ─────────────────────────
function MiniMap({ points, size = 120 }: { points: Array<{ lat: number; lon: number }>; size?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || points.length < 2) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const pad = 12;
    const lats = points.map((p) => p.lat);
    const lons = points.map((p) => p.lon);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const minLon = Math.min(...lons), maxLon = Math.max(...lons);
    const dLat = maxLat - minLat || 0.001;
    const dLon = maxLon - minLon || 0.001;
    const scale = Math.min((size - pad * 2) / dLon, (size - pad * 2) / dLat);

    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 0, size, size);

    ctx.beginPath();
    ctx.strokeStyle = '#4488ff';
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    for (let i = 0; i < points.length; i++) {
      const x = pad + (points[i].lon - minLon) * scale;
      const y = pad + (maxLat - points[i].lat) * scale;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Start/end markers
    const sx = pad + (points[0].lon - minLon) * scale;
    const sy = pad + (maxLat - points[0].lat) * scale;
    ctx.fillStyle = '#34D399';
    ctx.beginPath(); ctx.arc(sx, sy, 3, 0, Math.PI * 2); ctx.fill();

    const ex = pad + (points[points.length - 1].lon - minLon) * scale;
    const ey = pad + (maxLat - points[points.length - 1].lat) * scale;
    ctx.fillStyle = '#F87171';
    ctx.beginPath(); ctx.arc(ex, ey, 3, 0, Math.PI * 2); ctx.fill();
  }, [points, size]);

  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      style={{ borderRadius: '8px', border: '1px solid rgba(255,255,255,0.12)' }}
    />
  );
}

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

  // Active viewport for controls
  const [activeMode, setActiveMode] = useState<'instrument' | 'spatial' | 'classic'>('instrument');

  // Manipulation mode (grid/axes visible)
  const [manipulationMode, setManipulationMode] = useState(false);

  // Settings
  const [settings, setSettings] = useState<RendererSettings>(() => ({
    ...DEFAULT_RENDERER,
    showBeam: true,
    ghostEnhancement: 0,
  }));
  const [cameraPreset, setCameraPreset] = useState<CameraPreset>('frontal');
  const [autoThreshold, setAutoThreshold] = useState(false);
  const { t, lang } = useTranslation();
  const { theme } = useTheme();

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
      const activeRenderer = activeMode === 'instrument' ? rendererARef.current
        : activeMode === 'spatial' ? rendererBRef.current
        : rendererCRef.current;

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

      if (e.key === 'Escape' && calibrationOpen) setCalibrationOpen(false);
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [calibrationOpen, calibration, activeMode]);

  // Theme sync
  useEffect(() => {
    const bgColor = theme === 'light' ? '#fafafa' : '#111111';
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
  const hasSpatial = !!(spatialData && spatialData.length > 0);
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

  // ─── Initialize 3 renderers ─────────────────────────────────────────
  useEffect(() => {
    // Mode A — Instrument (always)
    if (containerARef.current && !rendererARef.current) {
      const settingsA = { ...settings, showBeam: true, ghostEnhancement: 0 };
      rendererARef.current = new VolumeRenderer(containerARef.current, settingsA, { ...DEFAULT_CALIBRATION });
      rendererARef.current.setCameraPreset('frontal');
      rendererARef.current.setGridAxesVisible(false);
    }

    // Mode B — Spatial (only if data)
    if (containerBRef.current && !rendererBRef.current && hasSpatial) {
      const settingsB = { ...settings, chromaticMode: 'high-contrast' as ChromaticMode, ghostEnhancement: 3.0, showBeam: false };
      rendererBRef.current = new VolumeRenderer(containerBRef.current, settingsB, { ...DEFAULT_CALIBRATION_B });
      rendererBRef.current.setCameraPreset('horizontal');
      rendererBRef.current.setGridAxesVisible(false);
    }

    // Mode C — Classic (only if frames)
    if (containerCRef.current && !rendererCRef.current && hasFrames) {
      const settingsC = { ...settings, chromaticMode: 'sonar-original' as ChromaticMode, ghostEnhancement: 0, showBeam: false, stepCount: 512 };
      rendererCRef.current = new VolumeRendererClassic(containerCRef.current, settingsC, { ...DEFAULT_CALIBRATION_C });
      rendererCRef.current.setCameraPreset('frontal');
      rendererCRef.current.setGridAxesVisible(false);
    }

    return () => {
      rendererARef.current?.dispose(); rendererARef.current = null;
      rendererBRef.current?.dispose(); rendererBRef.current = null;
      rendererCRef.current?.dispose(); rendererCRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasSpatial, hasFrames]);

  // Toggle grid/axes visibility based on manipulation mode
  useEffect(() => {
    rendererARef.current?.setGridAxesVisible(manipulationMode);
    rendererBRef.current?.setGridAxesVisible(manipulationMode);
    rendererCRef.current?.setGridAxesVisible(manipulationMode);
  }, [manipulationMode]);

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
      updateSetting('threshold', threshold);
    }
  }, [volumeData, dimensions, extent]);

  // Upload Mode B data
  useEffect(() => {
    if (!rendererBRef.current || !spatialData || spatialData.length === 0) return;
    rendererBRef.current.uploadVolume(spatialData, spatialDimensions!, spatialExtent!);
  }, [spatialData, spatialDimensions, spatialExtent]);

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
    let result = cache.get(currentFrame);
    if (!result) {
      result = projectFrameWindow(frames!, currentFrame, WINDOW_SIZE, beam!, grid!);
      cache.set(currentFrame, result);
    }
    rendererCRef.current.uploadVolume(result.normalized, result.dimensions, result.extent);
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

  // Settings
  const updateSetting = useCallback(
    (key: keyof RendererSettings, value: number | boolean | string) => {
      setSettings((prev: RendererSettings) => {
        const next = { ...prev, [key]: value };
        // Apply to the active renderer
        if (activeMode === 'instrument') rendererARef.current?.updateSettings({ [key]: value });
        else if (activeMode === 'spatial') rendererBRef.current?.updateSettings({ [key]: value });
        else rendererCRef.current?.updateSettings({ [key]: value });
        onSettingsChange?.(next);
        return next;
      });
    },
    [onSettingsChange, activeMode],
  );

  const handleCameraPreset = useCallback((preset: CameraPreset) => {
    setCameraPreset(preset);
    if (activeMode === 'instrument') rendererARef.current?.setCameraPreset(preset);
    else if (activeMode === 'spatial') rendererBRef.current?.setCameraPreset(preset);
    else rendererCRef.current?.setCameraPreset(preset);
  }, [activeMode]);

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

  // Determine which viewports to show
  const showB = hasSpatial;
  const showC = hasFrames && !!beam && !!grid;
  const viewportCount = 1 + (showB ? 1 : 0) + (showC ? 1 : 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {/* Main row: viewports + controls */}
      <div style={{ display: 'flex', gap: '10px', height: 'calc(100vh - 160px)', minHeight: '400px' }}>
        {/* Viewports column */}
        <div style={{ flex: 1, display: 'flex', gap: '6px', position: 'relative' }}>
          {/* Mini-map overlay (top-left) */}
          {gpxTrack && gpxTrack.points.length > 1 && (
            <div style={{
              position: 'absolute',
              top: '8px',
              left: '8px',
              zIndex: 15,
              pointerEvents: 'none',
            }}>
              <MiniMap points={gpxTrack.points} size={100} />
            </div>
          )}
          {!gpxTrack && (
            <div style={{
              position: 'absolute',
              top: '8px',
              left: '8px',
              zIndex: 15,
              padding: '6px 10px',
              borderRadius: '8px',
              background: colors.surface,
              border: `1px solid ${colors.border}`,
              fontSize: '10px',
              color: colors.text3,
              pointerEvents: 'none',
            }}>
              Ajoutez un GPX pour la mini-map
            </div>
          )}

          {/* Manipulation mode toggle */}
          <div style={{
            position: 'absolute',
            bottom: '8px',
            left: '8px',
            zIndex: 15,
          }}>
            <button
              onClick={() => setManipulationMode((m) => !m)}
              style={{
                padding: '5px 10px',
                borderRadius: '6px',
                border: `1px solid ${manipulationMode ? colors.accent : colors.border}`,
                background: manipulationMode ? colors.accentMuted : colors.surface,
                color: manipulationMode ? colors.accent : colors.text3,
                fontSize: '10px',
                fontWeight: 600,
                cursor: 'pointer',
                backdropFilter: 'blur(8px)',
              }}
            >
              {manipulationMode ? 'Manipulation ON' : 'Manipulation'}
            </button>
          </div>

          {/* Mode A viewport */}
          <div
            ref={containerARef}
            onClick={() => setActiveMode('instrument')}
            style={{
              flex: 1,
              borderRadius: '10px',
              overflow: 'hidden',
              border: `1px solid ${activeMode === 'instrument' ? '#4488ff50' : colors.border}`,
              background: theme === 'light' ? '#fafafa' : '#111111',
              position: 'relative',
              cursor: 'pointer',
              transition: 'border-color 150ms ease',
            }}
          >
            <div style={{
              position: 'absolute', top: '6px', left: '6px', padding: '2px 8px',
              borderRadius: '12px', background: 'rgba(68,136,255,0.2)', border: '1px solid rgba(68,136,255,0.4)',
              color: '#4488ff', fontSize: '10px', fontWeight: 500, zIndex: 10, pointerEvents: 'none',
            }}>
              Cône
            </div>
          </div>

          {/* Mode B viewport */}
          {showB && (
            <div
              ref={containerBRef}
              onClick={() => setActiveMode('spatial')}
              style={{
                flex: 1,
                borderRadius: '10px',
                overflow: 'hidden',
                border: `1px solid ${activeMode === 'spatial' ? '#ff884450' : colors.border}`,
                background: theme === 'light' ? '#fafafa' : '#111111',
                position: 'relative',
                cursor: 'pointer',
                transition: 'border-color 150ms ease',
              }}
            >
              <div style={{
                position: 'absolute', top: '6px', left: '6px', padding: '2px 8px',
                borderRadius: '12px', background: 'rgba(255,136,68,0.2)', border: '1px solid rgba(255,136,68,0.4)',
                color: '#ff8844', fontSize: '10px', fontWeight: 500, zIndex: 10, pointerEvents: 'none',
              }}>
                Trace
              </div>
            </div>
          )}

          {/* Mode C viewport */}
          {showC && (
            <div
              ref={containerCRef}
              onClick={() => setActiveMode('classic')}
              style={{
                flex: 1,
                borderRadius: '10px',
                overflow: 'hidden',
                border: `1px solid ${activeMode === 'classic' ? '#22cc8850' : colors.border}`,
                background: theme === 'light' ? '#fafafa' : '#111111',
                position: 'relative',
                cursor: 'pointer',
                transition: 'border-color 150ms ease',
              }}
            >
              <div style={{
                position: 'absolute', top: '6px', left: '6px', padding: '2px 8px',
                borderRadius: '12px', background: 'rgba(34,204,136,0.2)', border: '1px solid rgba(34,204,136,0.4)',
                color: '#22cc88', fontSize: '10px', fontWeight: 500, zIndex: 10, pointerEvents: 'none',
              }}>
                Projection
              </div>
            </div>
          )}
        </div>

        {/* Controls / Calibration panel */}
        <div
          className="echos-controls-panel"
          style={{
            width: '360px',
            minWidth: '360px',
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
            overflowY: 'auto',
          }}
        >
          {calibrationOpen ? (
            <CalibrationPanel
              config={calibration}
              onChange={handleCalibrationChange}
              onClose={() => setCalibrationOpen(false)}
              saved={calibrationSaved}
            />
          ) : (
            <GlassPanel style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px', flex: 1 }}>
              {/* Active mode selector */}
              <div style={{ display: 'flex', gap: '4px', marginBottom: '4px' }}>
                {MODE_DEFS.filter((m) => m.key === 'instrument' || (m.key === 'spatial' && showB) || (m.key === 'classic' && showC)).map((m) => (
                  <button
                    key={m.key}
                    onClick={() => setActiveMode(m.key)}
                    style={{
                      flex: 1,
                      padding: '4px 8px',
                      borderRadius: '6px',
                      border: `1px solid ${activeMode === m.key ? m.color + '60' : colors.border}`,
                      background: activeMode === m.key ? m.color + '15' : 'transparent',
                      color: activeMode === m.key ? m.color : colors.text3,
                      fontSize: '11px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      transition: 'all 150ms ease',
                    }}
                  >
                    {m.label}
                  </button>
                ))}
              </div>

              <h3 style={{ margin: 0, fontSize: '12px', color: colors.text1, fontWeight: 600 }}>
                {t('v2.controls.title')}
              </h3>

              {/* Camera presets */}
              <div style={{ display: 'flex', gap: '4px' }}>
                {CAMERA_PRESETS.map((p) => (
                  <button
                    key={p.key}
                    onClick={() => handleCameraPreset(p.key)}
                    title={t(p.labelKey as TranslationKey)}
                    style={{
                      width: '28px', height: '28px', borderRadius: '6px',
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
                <label style={{ fontSize: '10px', color: colors.text2, marginBottom: '3px', display: 'block' }}>
                  {t('v2.controls.palette')}
                </label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                  {chromaticModes.map((m: ChromaticMode) => (
                    <button
                      key={m}
                      onClick={() => updateSetting('chromaticMode', m)}
                      style={{
                        padding: '4px 9px', borderRadius: '16px',
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
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px' }}>
                <Slider label={t('v2.controls.opacity')} value={settings.opacityScale} min={0.1} max={5.0} step={0.1} onChange={(v: number) => updateSetting('opacityScale', v)} />
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '3px' }}>
                    <span style={{ fontSize: '10px', color: colors.text2 }}>{t('v2.controls.threshold')}</span>
                    <label style={{ fontSize: '9px', color: colors.text3, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '3px' }}>
                      <input type="checkbox" checked={autoThreshold} onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleAutoThreshold(e.target.checked)} style={{ width: '10px', height: '10px' }} />
                      {t('v2.controls.auto')}
                    </label>
                  </div>
                  <Slider label="" value={settings.threshold} min={0} max={0.5} step={0.01} onChange={(v: number) => { setAutoThreshold(false); updateSetting('threshold', v); }} />
                </div>
                <Slider label={t('v2.controls.density')} value={settings.densityScale} min={0.1} max={5.0} step={0.1} onChange={(v: number) => updateSetting('densityScale', v)} />
                <Slider label={t('v2.controls.smoothing')} value={settings.smoothing} min={0} max={1.0} step={0.05} onChange={(v: number) => updateSetting('smoothing', v)} />
                <Slider label={t('v2.controls.steps')} value={settings.stepCount} min={64} max={512} step={32} onChange={(v: number) => updateSetting('stepCount', v)} />
                {activeMode === 'spatial' && (
                  <Slider label={t('v2.controls.ghost')} value={settings.ghostEnhancement} min={0} max={3.0} step={0.1} onChange={(v: number) => updateSetting('ghostEnhancement', v)} />
                )}
              </div>

              {activeMode === 'instrument' && (
                <label style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: colors.text2, cursor: 'pointer' }}>
                  <input type="checkbox" checked={settings.showBeam} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateSetting('showBeam', e.target.checked)} />
                  {t('v2.controls.showBeam')}
                </label>
              )}

              {hasFrames && (
                <Slider label={t('v2.controls.playSpeed') || 'Vitesse'} value={playSpeed} min={1} max={16} step={1} onChange={(v: number) => setPlaySpeed(v)} />
              )}
            </GlassPanel>
          )}
        </div>
      </div>

      {/* Timeline bar (temporal playback for Mode C) */}
      {hasFrames && totalFrames > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: '10px',
          padding: '6px 12px', background: colors.surface, borderRadius: '8px',
          border: `1px solid ${colors.border}`, flexShrink: 0,
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
          <div style={{ fontSize: '11px', color: colors.text2, fontVariantNumeric: 'tabular-nums', minWidth: '50px', flexShrink: 0 }}>
            {currentTimeS.toFixed(1)}s
          </div>
          <input
            type="range" min={0} max={totalFrames - 1} value={currentFrame}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setPlaying(false); setCurrentFrame(Number(e.target.value)); }}
            style={{ flex: 1, height: '4px', cursor: 'pointer', accentColor: colors.accent }}
          />
          <div style={{ fontSize: '10px', color: colors.text3, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
            {currentFrame + 1}/{totalFrames}
          </div>
        </div>
      )}

      {/* Mode descriptions — visible in visualization */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${viewportCount}, 1fr)`,
        gap: '6px',
      }}>
        {MODE_DEFS.filter((m) => m.key === 'instrument' || (m.key === 'spatial' && showB) || (m.key === 'classic' && showC)).map((m) => (
          <div key={m.key} style={{
            padding: '8px 12px',
            borderRadius: '8px',
            background: colors.surface,
            border: `1px solid ${colors.border}`,
          }}>
            <div style={{ fontSize: '13px', fontWeight: 600, color: m.color, marginBottom: '2px' }}>{m.label}</div>
            <div style={{ fontSize: '11px', color: colors.text3, lineHeight: 1.4 }}>{m.desc}</div>
          </div>
        ))}
      </div>

      {/* Orthogonal slice panels */}
      {sliceVolumeData && sliceVolumeData.length > 0 && (
        <div style={{ marginTop: '24px' }}>
          <SlicePanel volumeData={sliceVolumeData} dimensions={sliceDimensions} />
        </div>
      )}

      {/* Export panel */}
      <div style={{ marginTop: '24px' }} />
      <ExportPanel
        volumeData={sliceVolumeData}
        dimensions={sliceDimensions}
        extent={extent}
        onCaptureScreenshot={handleCaptureScreenshot}
      />

      {/* Poster button */}
      <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'center' }}>
        <Button
          variant="primary"
          size="lg"
          onClick={() => {
            // Save session data — in a real implementation this would commit to git
            // For now, trigger a download of the session data
            const sessionData = {
              timestamp: new Date().toISOString(),
              gpxTrack: gpxTrack ? { points: gpxTrack.points, totalDistanceM: gpxTrack.totalDistanceM } : null,
              dimensions,
              extent,
              beam,
              grid,
              settings,
            };
            const blob = new Blob([JSON.stringify(sessionData, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `echos-session-${Date.now()}.json`;
            a.click();
            URL.revokeObjectURL(url);
          }}
        >
          Poster
        </Button>
      </div>

      {/* Bottom action buttons */}
      <div style={{ height: '16px', flexShrink: 0 }} />
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

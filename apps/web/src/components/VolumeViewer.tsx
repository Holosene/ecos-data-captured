/**
 * ECHOS V2 — Volume Viewer Component
 *
 * Main 3D viewer wrapping the WebGL ray marching engine.
 * Provides:
 *   - 3D ray-marched volume
 *   - Camera presets (frontal, horizontal, vertical, free)
 *   - Rendering controls (opacity, threshold, density, etc.)
 *   - Adaptive threshold (auto percentile-based)
 *   - Time scrubbing (Mode A: live playback through cone)
 *   - Orthogonal slice panels (XZ, XY, YZ) with v1-style inline presets (axis layout: X=track, Y=lateral, Z=depth)
 *   - Export panel (NRRD, PNG, CSV)
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
  /** Static volume data (Rendu A, or fallback) */
  volumeData: Float32Array | null;
  dimensions: [number, number, number];
  extent: [number, number, number];
  mode: 'instrument' | 'spatial' | 'classic';
  /** Preprocessed frames for Rendu B (sliding window playback) */
  frames?: PreprocessedFrame[];
  beam?: BeamSettings;
  grid?: VolumeGridSettings;
  onSettingsChange?: (settings: RendererSettings) => void;
  /** Action callbacks from parent */
  onReconfigure?: () => void;
  onNewScan?: () => void;
}

const WINDOW_SIZE = 12;

// ─── Build a v1-style stacked volume from raw preprocessed frames ──────────
// This gives full pixel resolution for 2D slice views instead of the
// low-res conic projection grid.
// Layout: data[z * dimY * dimX + y * dimX + x]
//   X = pixel col (lateral), Y = frame index (track/time), Z = pixel row (depth)

function buildSliceVolumeFromFrames(
  frameList: PreprocessedFrame[],
): { data: Float32Array; dimensions: [number, number, number] } | null {
  if (!frameList || frameList.length === 0) return null;

  const dimX = frameList[0].width;   // lateral (beam columns)
  const dimY = frameList.length;     // track (frames) — stacking along Y
  const dimZ = frameList[0].height;  // depth (sonar rows)

  if (dimX === 0 || dimZ === 0) return null;

  const data = new Float32Array(dimX * dimY * dimZ);
  const strideZ = dimY * dimX;

  // Optimized: copy row-by-row using subarray views instead of pixel-by-pixel.
  // Layout: data[z * dimY * dimX + y * dimX + x]
  // Each frame row (zi) of width dimX gets copied as a contiguous block.
  for (let yi = 0; yi < dimY; yi++) {
    const intensity = frameList[yi].intensity;
    const yiOffset = yi * dimX;

    for (let zi = 0; zi < dimZ; zi++) {
      const srcOffset = zi * dimX;
      const dstOffset = zi * strideZ + yiOffset;
      // Copy entire row at once (dimX floats)
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

// ─── SVG View Icons (harmonized, minimal line style) ──────────────────────

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
    <path d="M8 4V1" />
    <path d="M8 4L14 7" />
    <path d="M8 4L2 7" />
    <path d="M8 9L8 12" opacity="0.4" />
  </svg>
);

const CAMERA_PRESETS: { key: CameraPreset; labelKey: string; Icon: React.FC }[] = [
  { key: 'frontal', labelKey: 'v2.camera.frontal', Icon: IconFrontal },
  { key: 'horizontal', labelKey: 'v2.camera.horizontal', Icon: IconHorizontal },
  { key: 'vertical', labelKey: 'v2.camera.vertical', Icon: IconVertical },
  { key: 'free', labelKey: 'v2.camera.free', Icon: IconFree },
];

export function VolumeViewer({
  volumeData,
  dimensions,
  extent,
  mode,
  frames,
  beam,
  grid,
  onSettingsChange,
  onReconfigure,
  onNewScan,
}: VolumeViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<VolumeRenderer | VolumeRendererClassic | null>(null);
  const [settings, setSettings] = useState<RendererSettings>(() => {
    if (mode === 'spatial') {
      return {
        ...DEFAULT_RENDERER,
        chromaticMode: 'high-contrast' as RendererSettings['chromaticMode'],
        opacityScale: 1.0,
        threshold: 0,
        densityScale: 1.2,
        smoothing: 1.0,
        ghostEnhancement: 3.0,
        stepCount: 192,
        showBeam: false,
      };
    }
    if (mode === 'classic') {
      return {
        ...DEFAULT_RENDERER,
        chromaticMode: 'sonar-original' as RendererSettings['chromaticMode'],
        opacityScale: 1.0,
        threshold: 0.02,
        densityScale: 1.3,
        smoothing: 1.0,
        ghostEnhancement: 0,
        stepCount: 512,
        showBeam: false,
      };
    }
    return {
      ...DEFAULT_RENDERER,
      showBeam: mode === 'instrument',
      ghostEnhancement: 0,
    };
  });
  const [cameraPreset, setCameraPreset] = useState<CameraPreset>((mode === 'instrument' || mode === 'classic') ? 'frontal' : 'horizontal');
  const [autoThreshold, setAutoThreshold] = useState(false);
  const { t, lang } = useTranslation();
  const { theme } = useTheme();

  // ─── Calibration (hidden dev tool: press "b" x5 to toggle) ──────────
  const [calibrationOpen, setCalibrationOpen] = useState(false);
  const [calibration, setCalibration] = useState<CalibrationConfig>(() => {
    const saved = loadCalibration();
    if (saved) return saved;
    if (mode === 'spatial') return { ...DEFAULT_CALIBRATION_B };
    if (mode === 'classic') return { ...DEFAULT_CALIBRATION_C };
    return { ...DEFAULT_CALIBRATION };
  });
  const [calibrationSaved, setCalibrationSaved] = useState(false);
  const bPressCountRef = useRef(0);
  const bPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // "b" x5 toggle + Ctrl+S save + arrow keys orbit
  useEffect(() => {
    const ORBIT_SPEED = 0.05; // radians per key press

    const handleKey = (e: KeyboardEvent) => {
      // Arrow keys — orbit camera
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key) && rendererRef.current) {
        e.preventDefault();
        switch (e.key) {
          case 'ArrowLeft':  rendererRef.current.rotateBy( ORBIT_SPEED, 0); break;
          case 'ArrowRight': rendererRef.current.rotateBy(-ORBIT_SPEED, 0); break;
          case 'ArrowUp':    rendererRef.current.rotateBy(0,  ORBIT_SPEED); break;
          case 'ArrowDown':  rendererRef.current.rotateBy(0, -ORBIT_SPEED); break;
        }
        return;
      }

      // Ctrl+S / Cmd+S — save calibration
      if ((e.ctrlKey || e.metaKey) && e.key === 's' && calibrationOpen) {
        e.preventDefault();
        const cal = rendererRef.current?.getCalibration() ?? calibration;
        saveCalibration(cal);
        downloadCalibration(cal);
        setCalibrationSaved(true);
        setTimeout(() => setCalibrationSaved(false), 2000);
        return;
      }

      // Press "b" 5 times within 2 seconds
      if (e.key === 'b' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        bPressCountRef.current += 1;
        if (bPressTimerRef.current) clearTimeout(bPressTimerRef.current);
        bPressTimerRef.current = setTimeout(() => { bPressCountRef.current = 0; }, 2000);
        if (bPressCountRef.current >= 5) {
          bPressCountRef.current = 0;
          setCalibrationOpen((prev) => !prev);
        }
      }

      // Escape closes calibration
      if (e.key === 'Escape' && calibrationOpen) {
        setCalibrationOpen(false);
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [calibrationOpen, calibration]);

  // Sync renderer background color with theme
  useEffect(() => {
    if (!rendererRef.current) return;
    const bgColor = theme === 'light' ? '#fafafa' : '#111111';
    rendererRef.current.setCalibration({ ...calibration, bgColor });
  }, [theme]); // eslint-disable-line react-hooks/exhaustive-deps

  // Apply calibration to renderer when it changes
  const handleCalibrationChange = useCallback((cal: CalibrationConfig) => {
    setCalibration(cal);
    setCalibrationSaved(false);
    rendererRef.current?.setCalibration(cal);
  }, []);

  // Rendu B: temporal playback with sliding window (active when mode === 'spatial')
  const isRenduB = mode === 'spatial' && frames && frames.length > 0;
  // Rendu C: temporal playback with conic projection (active when mode === 'classic')
  const isRenduC = mode === 'classic' && frames && frames.length > 0 && !!beam && !!grid;
  // Any temporal mode active?
  const isTemporalMode = isRenduB || isRenduC;
  const [currentFrame, setCurrentFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [playSpeed, setPlaySpeed] = useState(mode === 'classic' ? 1 : 4);
  const playingRef = useRef(false);
  const currentFrameRef = useRef(0);

  // Volume data for 2D orthogonal slices:
  // - Mode A: built from ALL raw frames at full pixel resolution (v1-style stacking)
  // - Mode B: uses conic-projected data
  const [sliceVolumeData, setSliceVolumeData] = useState<Float32Array | null>(null);
  const [sliceDimensions, setSliceDimensions] = useState<[number, number, number]>([1, 1, 1]);

  // Build full-resolution slice volume from ALL frames once (v1 approach).
  // This gives proper resolution on every axis instead of the 12-frame window.
  const fullSliceVolume = useMemo(() => {
    if (!frames || frames.length === 0) return null;
    return buildSliceVolumeFromFrames(frames);
  }, [frames]);

  // Initialize renderer
  useEffect(() => {
    if (!containerRef.current) return;

    const renderer = mode === 'classic'
      ? new VolumeRendererClassic(containerRef.current, settings, calibration)
      : new VolumeRenderer(containerRef.current, settings, calibration);
    rendererRef.current = renderer;

    const defaultPreset = (mode === 'instrument' || mode === 'classic') ? 'frontal' : 'horizontal';
    renderer.setCameraPreset(defaultPreset);

    return () => {
      renderer.dispose();
      rendererRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update beam wireframe when beam settings are available
  useEffect(() => {
    if (!rendererRef.current || !beam) return;
    rendererRef.current.updateBeamGeometry(beam.beamAngleDeg / 2, beam.depthMaxM);
  }, [beam]);

  // Rendu A: upload static volume data from worker (skip for temporal modes B/C)
  useEffect(() => {
    if (!rendererRef.current || !volumeData || volumeData.length === 0 || isTemporalMode) return;
    rendererRef.current.uploadVolume(volumeData, dimensions, extent);

    if (autoThreshold) {
      const threshold = computeAutoThreshold(volumeData, 85);
      updateSetting('threshold', threshold);
    }
  }, [volumeData, dimensions, extent, isTemporalMode]);

  // Set slice data: use full-frame volume (v1-style stacking) when frames are
  // available (both Mode A and Mode B), fall back to projected volume otherwise.
  useEffect(() => {
    if (fullSliceVolume) {
      setSliceVolumeData(fullSliceVolume.data);
      setSliceDimensions(fullSliceVolume.dimensions);
    } else if (volumeData && volumeData.length > 0) {
      setSliceVolumeData(volumeData);
      setSliceDimensions(dimensions);
    }
  }, [fullSliceVolume, volumeData, dimensions]);

  // Pre-computed frame projection cache for smooth playback
  const frameCacheRef = useRef<Map<number, { normalized: Float32Array; dimensions: [number, number, number]; extent: [number, number, number] }>>(new Map());

  // Rendu B: pre-compute windowed volumes ahead of current position
  useEffect(() => {
    if (!isRenduB) return;

    const cache = frameCacheRef.current;
    const lookAhead = 16;

    let cancelled = false;
    (async () => {
      for (let offset = 0; offset <= lookAhead && !cancelled; offset++) {
        const idx = currentFrame + offset;
        if (idx >= frames!.length || cache.has(idx)) continue;
        const result = buildWindowVolume(frames!, idx, WINDOW_SIZE);
        if (!cancelled) cache.set(idx, result);
        if (offset % 4 === 3) await new Promise((r) => setTimeout(r, 0));
      }

      const minKeep = Math.max(0, currentFrame - 4);
      for (const key of cache.keys()) {
        if (key < minKeep) cache.delete(key);
      }
    })();

    return () => { cancelled = true; };
  }, [isRenduB, currentFrame, frames]);

  // Rendu B: build windowed volume and upload
  useEffect(() => {
    if (!isRenduB || !rendererRef.current) return;

    const cache = frameCacheRef.current;
    let result = cache.get(currentFrame);
    if (!result) {
      result = buildWindowVolume(frames!, currentFrame, WINDOW_SIZE);
      cache.set(currentFrame, result);
    }

    rendererRef.current.uploadVolume(result.normalized, result.dimensions, result.extent);
  }, [isRenduB, currentFrame, frames]);

  // Rendu C: pre-compute conic projections ahead of current position
  const frameCacheCRef = useRef<Map<number, { normalized: Float32Array; dimensions: [number, number, number]; extent: [number, number, number] }>>(new Map());

  useEffect(() => {
    if (!isRenduC) return;

    const cache = frameCacheCRef.current;
    const lookAhead = 16;

    let cancelled = false;
    (async () => {
      for (let offset = 0; offset <= lookAhead && !cancelled; offset++) {
        const idx = currentFrame + offset;
        if (idx >= frames!.length || cache.has(idx)) continue;
        const result = projectFrameWindow(frames!, idx, WINDOW_SIZE, beam!, grid!);
        if (!cancelled) cache.set(idx, result);
        if (offset % 4 === 3) await new Promise((r) => setTimeout(r, 0));
      }

      const minKeep = Math.max(0, currentFrame - 4);
      for (const key of cache.keys()) {
        if (key < minKeep) cache.delete(key);
      }
    })();

    return () => { cancelled = true; };
  }, [isRenduC, currentFrame, frames, beam, grid]);

  // Rendu C: conic-project current frame and upload
  useEffect(() => {
    if (!isRenduC || !rendererRef.current) return;

    const cache = frameCacheCRef.current;
    let result = cache.get(currentFrame);
    if (!result) {
      result = projectFrameWindow(frames!, currentFrame, WINDOW_SIZE, beam!, grid!);
      cache.set(currentFrame, result);
    }

    rendererRef.current.uploadVolume(result.normalized, result.dimensions, result.extent);
  }, [isRenduC, currentFrame, frames, beam, grid]);

  // Playback animation loop (Rendu B + Rendu C)
  useEffect(() => {
    if (!isTemporalMode) return;
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
        if (next >= frames!.length) {
          setPlaying(false);
          return;
        }
        currentFrameRef.current = next;
        setCurrentFrame(next);
      }
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [playing, playSpeed, isTemporalMode, frames, currentFrame]);

  // Update settings
  const updateSetting = useCallback(
    (key: keyof RendererSettings, value: number | boolean | string) => {
      setSettings((prev: RendererSettings) => {
        const next = { ...prev, [key]: value };
        rendererRef.current?.updateSettings({ [key]: value });
        onSettingsChange?.(next);
        return next;
      });
    },
    [onSettingsChange],
  );

  // Camera preset
  const handleCameraPreset = useCallback((preset: CameraPreset) => {
    setCameraPreset(preset);
    rendererRef.current?.setCameraPreset(preset);
  }, []);

  // Auto threshold toggle
  const handleAutoThreshold = useCallback((enabled: boolean) => {
    setAutoThreshold(enabled);
    if (enabled && sliceVolumeData && sliceVolumeData.length > 0) {
      const threshold = computeAutoThreshold(sliceVolumeData, 85);
      updateSetting('threshold', threshold);
    }
  }, [sliceVolumeData, updateSetting]);

  // Screenshot capture
  const handleCaptureScreenshot = useCallback(() => {
    return rendererRef.current?.captureScreenshot() ?? null;
  }, []);

  const chromaticModes = getChromaticModes();
  const totalFrames = frames?.length ?? 0;
  const currentTimeS = isTemporalMode && frames!.length > 0 ? frames![currentFrame]?.timeS ?? 0 : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {/* Volume viewer title */}
      <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: colors.text1 }}>
        {t('v2.viewer.title')}
      </h3>

      {/* Main row: 3D viewport + controls */}
      <div style={{ display: 'flex', gap: '10px', height: 'calc(100vh - 190px)', minHeight: '400px' }}>
        {/* 3D viewport */}
        <div
          ref={containerRef}
          style={{
            flex: 1,
            borderRadius: '12px',
            overflow: 'hidden',
            border: `1px solid ${colors.border}`,
            background: theme === 'light' ? '#fafafa' : '#111111',
            position: 'relative',
          }}
        >
          {/* Mode badge */}
          <div
            style={{
              position: 'absolute',
              top: '10px',
              left: '10px',
              padding: '3px 10px',
              borderRadius: '16px',
              background: mode === 'classic' ? 'rgba(34,204,136,0.2)' : mode === 'instrument' ? 'rgba(68,136,255,0.2)' : 'rgba(255,136,68,0.2)',
              border: `1px solid ${mode === 'classic' ? 'rgba(34,204,136,0.4)' : mode === 'instrument' ? 'rgba(68,136,255,0.4)' : 'rgba(255,136,68,0.4)'}`,
              color: mode === 'classic' ? '#22cc88' : mode === 'instrument' ? '#4488ff' : '#ff8844',
              fontSize: '11px',
              fontWeight: 500,
              zIndex: 10,
              pointerEvents: 'none',
            }}
          >
            {mode === 'classic' ? 'Rendu C' : mode === 'instrument' ? 'Rendu A' : 'Rendu B'}
          </div>

          {/* Camera preset buttons */}
          <div
            style={{
              position: 'absolute',
              top: '10px',
              right: '10px',
              display: 'flex',
              gap: '4px',
              zIndex: 10,
            }}
          >
            {CAMERA_PRESETS.map((p) => (
              <button
                key={p.key}
                onClick={() => handleCameraPreset(p.key)}
                title={t(p.labelKey as TranslationKey)}
                style={{
                  width: '30px',
                  height: '30px',
                  borderRadius: '8px',
                  border: `1px solid ${cameraPreset === p.key ? colors.accent : 'rgba(255,255,255,0.12)'}`,
                  background: cameraPreset === p.key ? 'rgba(68,136,255,0.2)' : 'rgba(10,10,15,0.7)',
                  color: cameraPreset === p.key ? colors.accent : 'rgba(255,255,255,0.5)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  backdropFilter: 'blur(8px)',
                  transition: 'all 150ms ease',
                }}
              >
                <p.Icon />
              </button>
            ))}
          </div>

          {!volumeData && !isTemporalMode && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: colors.text3,
                fontSize: '15px',
              }}
            >
              {t('v2.viewer.noData')}
            </div>
          )}
        </div>

        {/* Controls / Calibration panel */}
        <div
          className="echos-controls-panel"
          style={{
            width: '480px',
            minWidth: '480px',
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
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
              <h3 style={{ margin: 0, fontSize: '13px', color: colors.text1, fontWeight: 600 }}>
                {t('v2.controls.title')}
              </h3>

              {/* Chromatic mode — pill buttons in a row */}
              <div>
                <label style={{ fontSize: '11px', color: colors.text2, marginBottom: '4px', display: 'block' }}>
                  {t('v2.controls.palette')}
                </label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                  {chromaticModes.map((m: ChromaticMode) => (
                    <button
                      key={m}
                      onClick={() => updateSetting('chromaticMode', m)}
                      style={{
                        padding: '5px 11px',
                        borderRadius: '20px',
                        border: `1px solid ${settings.chromaticMode === m ? colors.accent : colors.border}`,
                        background: settings.chromaticMode === m ? colors.accentMuted : 'transparent',
                        color: settings.chromaticMode === m ? colors.accent : colors.text2,
                        fontSize: '12px',
                        fontWeight: 500,
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                        transition: 'all 150ms ease',
                      }}
                    >
                      {CHROMATIC_LABELS[m][lang as 'en' | 'fr'] || CHROMATIC_LABELS[m].en}
                    </button>
                  ))}
                </div>
              </div>

              {/* Two-column layout for sliders to reduce height */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px' }}>
                <Slider label={t('v2.controls.opacity')} value={settings.opacityScale} min={0.1} max={5.0} step={0.1} onChange={(v: number) => updateSetting('opacityScale', v)} />

                {/* Threshold with auto toggle */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                    <span style={{ fontSize: '11px', color: colors.text2 }}>{t('v2.controls.threshold')}</span>
                    <label style={{ fontSize: '10px', color: colors.text3, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <input
                        type="checkbox"
                        checked={autoThreshold}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleAutoThreshold(e.target.checked)}
                        style={{ width: '12px', height: '12px' }}
                      />
                      {t('v2.controls.auto')}
                    </label>
                  </div>
                  <Slider label="" value={settings.threshold} min={0} max={0.5} step={0.01} onChange={(v: number) => { setAutoThreshold(false); updateSetting('threshold', v); }} />
                </div>

                <Slider label={t('v2.controls.density')} value={settings.densityScale} min={0.1} max={5.0} step={0.1} onChange={(v: number) => updateSetting('densityScale', v)} />
                <Slider label={t('v2.controls.smoothing')} value={settings.smoothing} min={0} max={1.0} step={0.05} onChange={(v: number) => updateSetting('smoothing', v)} />

                {mode === 'spatial' && (
                  <Slider label={t('v2.controls.ghost')} value={settings.ghostEnhancement} min={0} max={3.0} step={0.1} onChange={(v: number) => updateSetting('ghostEnhancement', v)} />
                )}

                <Slider label={t('v2.controls.steps')} value={settings.stepCount} min={64} max={512} step={32} onChange={(v: number) => updateSetting('stepCount', v)} />
              </div>

              {mode === 'instrument' && (
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: colors.text2, cursor: 'pointer' }}>
                  <input type="checkbox" checked={settings.showBeam} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateSetting('showBeam', e.target.checked)} />
                  {t('v2.controls.showBeam')}
                </label>
              )}

              {isTemporalMode && (
                <Slider label={t('v2.controls.playSpeed') || 'Vitesse'} value={playSpeed} min={1} max={16} step={1} onChange={(v: number) => setPlaySpeed(v)} />
              )}

              {/* Calibration toggle button */}
              <button
                onClick={() => setCalibrationOpen(true)}
                style={{
                  marginTop: '8px',
                  padding: '6px 12px',
                  borderRadius: '8px',
                  border: `1px solid rgba(255,136,68,0.3)`,
                  background: 'rgba(255,136,68,0.08)',
                  color: '#ff8844',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                }}
              >
                Calibration
              </button>
            </GlassPanel>
          )}
        </div>
      </div>

      {/* Timeline bar (Rendu B + Rendu C temporal playback) */}
      {isTemporalMode && totalFrames > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            padding: '6px 12px',
            background: colors.surface,
            borderRadius: '8px',
            border: `1px solid ${colors.border}`,
            flexShrink: 0,
          }}
        >
          <button
            onClick={() => {
              if (currentFrame >= totalFrames - 1) setCurrentFrame(0);
              setPlaying((p) => !p);
            }}
            style={{
              width: '28px',
              height: '28px',
              borderRadius: '50%',
              border: `1px solid ${colors.accent}`,
              background: playing ? colors.accentMuted : 'transparent',
              color: colors.accent,
              cursor: 'pointer',
              fontSize: '12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            {playing ? '||' : '\u25B6'}
          </button>

          <div style={{ fontSize: '11px', color: colors.text2, fontVariantNumeric: 'tabular-nums', minWidth: '50px', flexShrink: 0 }}>
            {currentTimeS.toFixed(1)}s
          </div>

          <input
            type="range"
            min={0}
            max={totalFrames - 1}
            value={currentFrame}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
              setPlaying(false);
              setCurrentFrame(Number(e.target.value));
            }}
            style={{ flex: 1, height: '4px', cursor: 'pointer', accentColor: colors.accent }}
          />

          <div style={{ fontSize: '10px', color: colors.text3, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
            {currentFrame + 1}/{totalFrames}
          </div>
        </div>
      )}

      {/* Orthogonal slice panels — v1-style with inline presets */}
      {sliceVolumeData && sliceVolumeData.length > 0 && (
        <div style={{ marginTop: '32px' }}>
          <SlicePanel
            volumeData={sliceVolumeData}
            dimensions={sliceDimensions}
          />
        </div>
      )}

      {/* Export panel — at bottom */}
      <div style={{ marginTop: '32px' }} />
      <ExportPanel
        volumeData={sliceVolumeData}
        dimensions={sliceDimensions}
        extent={extent}
        onCaptureScreenshot={handleCaptureScreenshot}
      />

      {/* Bottom spacing + action buttons */}
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

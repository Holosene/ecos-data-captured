/**
 * ECHOS V2 — Volume Viewer Component
 *
 * Main 3D viewer wrapping the WebGL ray marching engine.
 * Provides:
 *   - 3D ray-marched volume
 *   - Camera presets (horizontal, vertical section, free)
 *   - Rendering controls (opacity, threshold, density, etc.)
 *   - Adaptive threshold (auto percentile-based)
 *   - Time scrubbing (Mode A: live playback through cone)
 *   - Orthogonal slice panels (XZ, XY, YZ)
 *   - Export panel (NRRD, PNG, CSV)
 */

import React, { useRef, useEffect, useCallback, useState } from 'react';
import { GlassPanel, Slider, Button, colors } from '@echos/ui';
import type { RendererSettings, ChromaticMode, PreprocessedFrame, BeamSettings, VolumeGridSettings } from '@echos/core';
import { DEFAULT_RENDERER, projectFrameWindow, computeAutoThreshold } from '@echos/core';
import { VolumeRenderer } from '../engine/volume-renderer.js';
import type { CameraPreset } from '../engine/volume-renderer.js';
import { getChromaticModes, CHROMATIC_LABELS } from '../engine/transfer-function.js';
import { SlicePanel } from './SlicePanel.js';
import { ExportPanel } from './ExportPanel.js';
import { useTranslation } from '../i18n/index.js';

interface VolumeViewerProps {
  /** Static volume data (Mode B spatial, or fallback) */
  volumeData: Float32Array | null;
  dimensions: [number, number, number];
  extent: [number, number, number];
  mode: 'instrument' | 'spatial';
  /** Mode A temporal: preprocessed frames for live playback */
  frames?: PreprocessedFrame[];
  beam?: BeamSettings;
  grid?: VolumeGridSettings;
  onSettingsChange?: (settings: RendererSettings) => void;
}

const WINDOW_SIZE = 12;

const CAMERA_PRESETS: { key: CameraPreset; label: string; icon: string }[] = [
  { key: 'frontal', label: 'Frontale 2D', icon: '▣' },
  { key: 'horizontal', label: 'Horizontale', icon: '⬛' },
  { key: 'vertical', label: 'Coupe verticale', icon: '▮' },
  { key: 'free', label: 'Libre', icon: '◇' },
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
}: VolumeViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<VolumeRenderer | null>(null);
  const [settings, setSettings] = useState<RendererSettings>({
    ...DEFAULT_RENDERER,
    showBeam: mode === 'instrument',
    ghostEnhancement: mode === 'spatial' ? 0.5 : 0,
  });
  const [cameraPreset, setCameraPreset] = useState<CameraPreset>(mode === 'instrument' ? 'frontal' : 'horizontal');
  const [autoThreshold, setAutoThreshold] = useState(false);
  const { t, lang } = useTranslation();

  // Temporal playback state (Mode A)
  const isTemporalMode = mode === 'instrument' && frames && frames.length > 0 && beam && grid;
  const [currentFrame, setCurrentFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [playSpeed, setPlaySpeed] = useState(4);
  const playingRef = useRef(false);
  const currentFrameRef = useRef(0);

  // Volume data for slices (either static or current temporal projection)
  const [sliceVolumeData, setSliceVolumeData] = useState<Float32Array | null>(null);
  const [sliceDimensions, setSliceDimensions] = useState<[number, number, number]>([1, 1, 1]);

  // Initialize renderer
  useEffect(() => {
    if (!containerRef.current) return;

    const renderer = new VolumeRenderer(containerRef.current, settings);
    rendererRef.current = renderer;

    // Set default camera preset based on mode
    const defaultPreset = mode === 'instrument' ? 'frontal' : 'horizontal';
    renderer.setCameraPreset(defaultPreset);

    return () => {
      renderer.dispose();
      rendererRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Upload static volume data (Mode B or non-temporal Mode A)
  useEffect(() => {
    if (!rendererRef.current || !volumeData || volumeData.length === 0 || isTemporalMode) return;
    rendererRef.current.uploadVolume(volumeData, dimensions, extent);
    setSliceVolumeData(volumeData);
    setSliceDimensions(dimensions);

    // Auto threshold on new volume
    if (autoThreshold) {
      const threshold = computeAutoThreshold(volumeData, 85);
      updateSetting('threshold', threshold);
    }
  }, [volumeData, dimensions, extent, isTemporalMode]);

  // Pre-computed frame projection cache for smooth playback
  const frameCacheRef = useRef<Map<number, { normalized: Float32Array; dimensions: [number, number, number]; extent: [number, number, number] }>>(new Map());

  // Pre-compute frame projections ahead of current position
  useEffect(() => {
    if (!isTemporalMode) return;

    const cache = frameCacheRef.current;
    const lookAhead = 16;

    // Pre-compute frames ahead in a microtask to avoid blocking
    let cancelled = false;
    (async () => {
      for (let offset = 0; offset <= lookAhead && !cancelled; offset++) {
        const idx = currentFrame + offset;
        if (idx >= frames!.length || cache.has(idx)) continue;
        const result = projectFrameWindow(frames!, idx, WINDOW_SIZE, beam!, grid!);
        if (!cancelled) cache.set(idx, result);
        // Yield to main thread every few frames
        if (offset % 4 === 3) await new Promise((r) => setTimeout(r, 0));
      }

      // Evict old entries to limit memory
      const minKeep = Math.max(0, currentFrame - 4);
      for (const key of cache.keys()) {
        if (key < minKeep) cache.delete(key);
      }
    })();

    return () => { cancelled = true; };
  }, [isTemporalMode, currentFrame, frames, beam, grid]);

  // Temporal projection: use cache or compute on-demand
  useEffect(() => {
    if (!isTemporalMode || !rendererRef.current) return;

    const cache = frameCacheRef.current;
    let result = cache.get(currentFrame);
    if (!result) {
      result = projectFrameWindow(frames!, currentFrame, WINDOW_SIZE, beam!, grid!);
      cache.set(currentFrame, result);
    }

    rendererRef.current.uploadVolume(result.normalized, result.dimensions, result.extent);
    setSliceVolumeData(result.normalized);
    setSliceDimensions(result.dimensions);
  }, [isTemporalMode, currentFrame, frames, beam, grid]);

  // Playback animation loop — uses requestAnimationFrame for smooth timing
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {/* Main row: 3D viewport + controls */}
      <div style={{ display: 'flex', gap: '10px', height: 'calc(100vh - 180px)', minHeight: '400px' }}>
        {/* 3D viewport */}
        <div
          ref={containerRef}
          style={{
            flex: 1,
            borderRadius: '12px',
            overflow: 'hidden',
            border: `1px solid ${colors.border}`,
            background: '#080810',
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
              background: mode === 'instrument' ? 'rgba(68,136,255,0.2)' : 'rgba(255,136,68,0.2)',
              border: `1px solid ${mode === 'instrument' ? 'rgba(68,136,255,0.4)' : 'rgba(255,136,68,0.4)'}`,
              color: mode === 'instrument' ? '#4488ff' : '#ff8844',
              fontSize: '11px',
              fontWeight: 500,
              zIndex: 10,
              pointerEvents: 'none',
            }}
          >
            {mode === 'instrument' ? 'Mode A — Instrument' : 'Mode B — Spatial'}
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
                title={p.label}
                style={{
                  width: '28px',
                  height: '28px',
                  borderRadius: '6px',
                  border: `1px solid ${cameraPreset === p.key ? colors.accent : 'rgba(255,255,255,0.15)'}`,
                  background: cameraPreset === p.key ? 'rgba(68,136,255,0.25)' : 'rgba(0,0,0,0.4)',
                  color: cameraPreset === p.key ? colors.accent : colors.text3,
                  cursor: 'pointer',
                  fontSize: '12px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {p.icon}
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

        {/* Controls panel — always visible */}
        <div
          style={{
            width: '240px',
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            overflowY: 'auto',
          }}
        >
          <GlassPanel style={{ padding: '10px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <h3 style={{ margin: 0, fontSize: '13px', color: colors.text1, fontWeight: 600 }}>
              {t('v2.controls.title')}
            </h3>

            {/* Chromatic mode */}
            <div>
              <label style={{ fontSize: '11px', color: colors.text2, marginBottom: '4px', display: 'block' }}>
                {t('v2.controls.palette')}
              </label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px' }}>
                {chromaticModes.map((m: ChromaticMode) => (
                  <button
                    key={m}
                    onClick={() => updateSetting('chromaticMode', m)}
                    style={{
                      padding: '3px 8px',
                      borderRadius: '12px',
                      border: `1px solid ${settings.chromaticMode === m ? colors.accent : colors.border}`,
                      background: settings.chromaticMode === m ? colors.accentMuted : 'transparent',
                      color: settings.chromaticMode === m ? colors.text1 : colors.text2,
                      fontSize: '10px',
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                    }}
                  >
                    {CHROMATIC_LABELS[m][lang as 'en' | 'fr'] || CHROMATIC_LABELS[m].en}
                  </button>
                ))}
              </div>
            </div>

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
                  Auto
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

            {mode === 'instrument' && (
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: colors.text2, cursor: 'pointer' }}>
                <input type="checkbox" checked={settings.showBeam} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateSetting('showBeam', e.target.checked)} />
                {t('v2.controls.showBeam')}
              </label>
            )}

            {isTemporalMode && (
              <Slider label={t('v2.controls.playSpeed') || 'Vitesse'} value={playSpeed} min={1} max={16} step={1} onChange={(v: number) => setPlaySpeed(v)} />
            )}
          </GlassPanel>

          {/* Export panel */}
          <ExportPanel
            volumeData={sliceVolumeData}
            dimensions={sliceDimensions}
            extent={extent}
            onCaptureScreenshot={handleCaptureScreenshot}
          />
        </div>
      </div>

      {/* Timeline bar (Mode A temporal) */}
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

      {/* Orthogonal slice panels — always visible */}
      {sliceVolumeData && sliceVolumeData.length > 0 && (
        <div>
          <h3 style={{ fontSize: '13px', color: colors.text1, fontWeight: 600, marginBottom: '8px' }}>
            {t('v2.slices.title') || 'Coupes orthogonales'}
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
            <SlicePanel
              volumeData={sliceVolumeData}
              dimensions={sliceDimensions}
              axis="y"
              label={t('v2.slices.crossSection') || 'Transversale (XZ)'}
              chromaticMode={settings.chromaticMode}
            />
            <SlicePanel
              volumeData={sliceVolumeData}
              dimensions={sliceDimensions}
              axis="z"
              label={t('v2.slices.planView') || 'Vue en plan (XY)'}
              chromaticMode={settings.chromaticMode}
            />
            <SlicePanel
              volumeData={sliceVolumeData}
              dimensions={sliceDimensions}
              axis="x"
              label={t('v2.slices.longitudinal') || 'Longitudinale (YZ)'}
              chromaticMode={settings.chromaticMode}
            />
          </div>
        </div>
      )}
    </div>
  );
}

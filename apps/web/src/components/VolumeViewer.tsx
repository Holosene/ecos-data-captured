/**
 * ECHOS V2 — Volume Viewer Component
 *
 * Main 3D viewer wrapping the WebGL ray marching engine.
 * Provides:
 *   - 3D ray-marched volume
 *   - Rendering controls (opacity, threshold, density, etc.)
 *   - Adaptive threshold (auto percentile-based)
 *   - Time scrubbing (Mode A: live playback through cone)
 *   - Orthogonal slice panels (XZ, XY, YZ) with v1-style inline presets (axis layout: X=lateral, Y=track, Z=depth)
 *   - Export panel (NRRD, PNG, CSV)
 */

import React, { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import { GlassPanel, Slider, Button, colors } from '@echos/ui';
import type { RendererSettings, ChromaticMode, PreprocessedFrame, BeamSettings, VolumeGridSettings } from '@echos/core';
import { DEFAULT_RENDERER, projectFrameWindow, computeAutoThreshold } from '@echos/core';
import { VolumeRenderer } from '../engine/volume-renderer.js';
import { getChromaticModes, CHROMATIC_LABELS } from '../engine/transfer-function.js';
import { SlicePanel } from './SlicePanel.js';
import { ExportPanel } from './ExportPanel.js';
import { useTranslation } from '../i18n/index.js';
import { useTheme } from '../theme/index.js';

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
  /** Action callbacks from parent */
  onReconfigure?: () => void;
  onNewScan?: () => void;
}

const WINDOW_SIZE = 12;

// ─── Build a v1-style stacked volume from raw preprocessed frames ──────────
// This gives full pixel resolution for 2D slice views instead of the
// low-res conic projection grid (128×12×128).
// Layout: data[z * dimY * dimX + y * dimX + x]
//   X = pixel col (lateral), Y = frame index (track/time), Z = pixel row (depth)
// This matches the conic projection layout: [lateral, track, depth].

function buildSliceVolumeFromFrames(
  frameList: PreprocessedFrame[],
): { data: Float32Array; dimensions: [number, number, number] } | null {
  if (!frameList || frameList.length === 0) return null;

  const dimX = frameList[0].width;   // lateral (beam columns)
  const dimY = frameList.length;     // frames (track/time)
  const dimZ = frameList[0].height;  // depth (sonar rows)

  if (dimX === 0 || dimZ === 0) return null;

  const data = new Float32Array(dimX * dimY * dimZ);

  for (let y = 0; y < dimY; y++) {
    const frame = frameList[y];
    for (let z = 0; z < dimZ; z++) {
      for (let x = 0; x < dimX; x++) {
        data[z * dimY * dimX + y * dimX + x] = frame.intensity[z * dimX + x] ?? 0;
      }
    }
  }

  return { data, dimensions: [dimX, dimY, dimZ] };
}

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
  const rendererRef = useRef<VolumeRenderer | null>(null);
  const [settings, setSettings] = useState<RendererSettings>({
    ...DEFAULT_RENDERER,
    showBeam: mode === 'instrument',
    ghostEnhancement: mode === 'spatial' ? 0.5 : 0,
  });
  const [autoThreshold, setAutoThreshold] = useState(false);
  const { t, lang } = useTranslation();
  const { theme } = useTheme();

  // Temporal playback state (Mode A)
  const isTemporalMode = mode === 'instrument' && frames && frames.length > 0 && beam && grid;
  const [currentFrame, setCurrentFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [playSpeed, setPlaySpeed] = useState(4);
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

    const renderer = new VolumeRenderer(containerRef.current, settings);
    rendererRef.current = renderer;

    return () => {
      renderer.dispose();
      rendererRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Upload static volume data — ALWAYS, like ff97375.
  // buildInstrumentVolume (pipeline-worker) produces the correct extents.
  // Temporal playback will update the texture via the fast path afterwards.
  useEffect(() => {
    if (!rendererRef.current || !volumeData || volumeData.length === 0) return;
    rendererRef.current.uploadVolume(volumeData, dimensions, extent);

    if (autoThreshold) {
      const threshold = computeAutoThreshold(volumeData, 85);
      updateSetting('threshold', threshold);
    }
  }, [volumeData, dimensions, extent]);

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

  // Pre-compute frame projections ahead of current position
  useEffect(() => {
    if (!isTemporalMode) return;

    const cache = frameCacheRef.current;
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

    // Upload conic-projected volume for 3D ray marching
    rendererRef.current.uploadVolume(result.normalized, result.dimensions, result.extent);
  }, [isTemporalMode, currentFrame, frames, beam, grid]);

  // Playback animation loop
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
              background: mode === 'instrument' ? 'rgba(68,136,255,0.2)' : 'rgba(255,136,68,0.2)',
              border: `1px solid ${mode === 'instrument' ? 'rgba(68,136,255,0.4)' : 'rgba(255,136,68,0.4)'}`,
              color: mode === 'instrument' ? '#4488ff' : '#ff8844',
              fontSize: '11px',
              fontWeight: 500,
              zIndex: 10,
              pointerEvents: 'none',
            }}
          >
            {mode === 'instrument' ? `Mode A — ${t('v2.mode.instrument')}` : `Mode B — ${t('v2.mode.spatial')}`}
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

        {/* Controls panel */}
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
          </GlassPanel>
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

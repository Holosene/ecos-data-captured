/**
 * ECHOS V2 — Volume Viewer Component
 *
 * Main 3D viewer wrapping the WebGL ray marching engine.
 * Provides controls for:
 *   - Opacity, threshold, density, smoothing
 *   - Chromatic mode selection
 *   - Beam visualization toggle
 *   - Ghost enhancement
 *   - Time scrubbing (Mode A: live playback through cone)
 */

import React, { useRef, useEffect, useCallback, useState } from 'react';
import { GlassPanel, Slider, Button, colors } from '@echos/ui';
import type { RendererSettings, ChromaticMode, PreprocessedFrame, BeamSettings, VolumeGridSettings } from '@echos/core';
import { DEFAULT_RENDERER, projectFrameWindow } from '@echos/core';
import { VolumeRenderer } from '../engine/volume-renderer.js';
import { getChromaticModes, CHROMATIC_LABELS } from '../engine/transfer-function.js';
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

const WINDOW_SIZE = 12; // frames in the sliding window

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
  const [controlsOpen, setControlsOpen] = useState(true);
  const { t, lang } = useTranslation();

  // Temporal playback state (Mode A)
  const isTemporalMode = mode === 'instrument' && frames && frames.length > 0 && beam && grid;
  const [currentFrame, setCurrentFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [playSpeed, setPlaySpeed] = useState(4); // frames per second
  const playingRef = useRef(false);
  const currentFrameRef = useRef(0);

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

  // Upload static volume data (Mode B or non-temporal Mode A)
  useEffect(() => {
    if (!rendererRef.current || !volumeData || isTemporalMode) return;
    rendererRef.current.uploadVolume(volumeData, dimensions, extent);
  }, [volumeData, dimensions, extent, isTemporalMode]);

  // Temporal projection: reproject cone volume when frame changes (Mode A)
  useEffect(() => {
    if (!isTemporalMode || !rendererRef.current) return;

    const result = projectFrameWindow(frames!, currentFrame, WINDOW_SIZE, beam!, grid!);
    rendererRef.current.uploadVolume(result.normalized, result.dimensions, result.extent);
  }, [isTemporalMode, currentFrame, frames, beam, grid]);

  // Playback animation loop
  useEffect(() => {
    if (!isTemporalMode) return;
    playingRef.current = playing;
    currentFrameRef.current = currentFrame;

    if (!playing) return;

    const interval = setInterval(() => {
      if (!playingRef.current) return;
      const next = currentFrameRef.current + 1;
      if (next >= frames!.length) {
        setPlaying(false);
        return;
      }
      currentFrameRef.current = next;
      setCurrentFrame(next);
    }, 1000 / playSpeed);

    return () => clearInterval(interval);
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

  const chromaticModes = getChromaticModes();

  const totalFrames = frames?.length ?? 0;
  const currentTimeS = isTemporalMode && frames!.length > 0 ? frames![currentFrame]?.timeS ?? 0 : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', flex: 1, gap: '8px', overflow: 'hidden' }}>
      <div style={{ display: 'flex', flex: 1, gap: '12px', overflow: 'hidden', minHeight: 0 }}>
        {/* 3D viewport */}
        <div
          ref={containerRef}
          style={{
            flex: 1,
            borderRadius: '12px',
            overflow: 'hidden',
            border: `1px solid ${colors.border}`,
            background: '#0a0a0f',
            position: 'relative',
            minHeight: 0,
          }}
        >
          {/* Mode badge */}
          <div
            style={{
              position: 'absolute',
              top: '12px',
              left: '12px',
              padding: '4px 12px',
              borderRadius: '20px',
              background: mode === 'instrument' ? 'rgba(68,136,255,0.2)' : 'rgba(255,136,68,0.2)',
              border: `1px solid ${mode === 'instrument' ? 'rgba(68,136,255,0.4)' : 'rgba(255,136,68,0.4)'}`,
              color: mode === 'instrument' ? '#4488ff' : '#ff8844',
              fontSize: '12px',
              fontWeight: 500,
              zIndex: 10,
              pointerEvents: 'none',
            }}
          >
            {mode === 'instrument' ? 'Mode A — Instrument' : 'Mode B — Spatial'}
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
          style={{
            width: controlsOpen ? '260px' : '40px',
            transition: 'width 200ms ease',
            flexShrink: 0,
          }}
        >
          <button
            onClick={() => setControlsOpen((o) => !o)}
            style={{
              width: '100%',
              padding: '8px',
              background: colors.surface,
              border: `1px solid ${colors.border}`,
              borderRadius: '8px',
              color: colors.text2,
              cursor: 'pointer',
              fontSize: '13px',
              marginBottom: '8px',
            }}
          >
            {controlsOpen ? '▶' : '◀'}
          </button>

          {controlsOpen && (
            <GlassPanel style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '12px', maxHeight: 'calc(100vh - 200px)', overflowY: 'auto' }}>
              <h3 style={{ margin: 0, fontSize: '14px', color: colors.text1, fontWeight: 600 }}>
                {t('v2.controls.title')}
              </h3>

              {/* Chromatic mode */}
              <div>
                <label style={{ fontSize: '12px', color: colors.text2, marginBottom: '6px', display: 'block' }}>
                  {t('v2.controls.palette')}
                </label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                  {chromaticModes.map((m) => (
                    <button
                      key={m}
                      onClick={() => updateSetting('chromaticMode', m)}
                      style={{
                        padding: '4px 10px',
                        borderRadius: '16px',
                        border: `1px solid ${settings.chromaticMode === m ? colors.accent : colors.border}`,
                        background: settings.chromaticMode === m ? colors.accentMuted : 'transparent',
                        color: settings.chromaticMode === m ? colors.text1 : colors.text2,
                        fontSize: '11px',
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                      }}
                    >
                      {CHROMATIC_LABELS[m][lang as 'en' | 'fr'] || CHROMATIC_LABELS[m].en}
                    </button>
                  ))}
                </div>
              </div>

              {/* Opacity */}
              <Slider
                label={t('v2.controls.opacity')}
                value={settings.opacityScale}
                min={0.1}
                max={5.0}
                step={0.1}
                onChange={(v) => updateSetting('opacityScale', v)}
              />

              {/* Threshold */}
              <Slider
                label={t('v2.controls.threshold')}
                value={settings.threshold}
                min={0}
                max={0.5}
                step={0.01}
                onChange={(v) => updateSetting('threshold', v)}
              />

              {/* Density */}
              <Slider
                label={t('v2.controls.density')}
                value={settings.densityScale}
                min={0.1}
                max={5.0}
                step={0.1}
                onChange={(v) => updateSetting('densityScale', v)}
              />

              {/* Smoothing */}
              <Slider
                label={t('v2.controls.smoothing')}
                value={settings.smoothing}
                min={0}
                max={1.0}
                step={0.05}
                onChange={(v) => updateSetting('smoothing', v)}
              />

              {/* Ghost Enhancement (Spatial mode) */}
              {mode === 'spatial' && (
                <Slider
                  label={t('v2.controls.ghost')}
                  value={settings.ghostEnhancement}
                  min={0}
                  max={3.0}
                  step={0.1}
                  onChange={(v) => updateSetting('ghostEnhancement', v)}
                />
              )}

              {/* Step count */}
              <Slider
                label={t('v2.controls.steps')}
                value={settings.stepCount}
                min={64}
                max={512}
                step={32}
                onChange={(v) => updateSetting('stepCount', v)}
              />

              {/* Beam toggle (Instrument mode) */}
              {mode === 'instrument' && (
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    fontSize: '13px',
                    color: colors.text2,
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={settings.showBeam}
                    onChange={(e) => updateSetting('showBeam', e.target.checked)}
                  />
                  {t('v2.controls.showBeam')}
                </label>
              )}

              {/* Playback speed (Mode A temporal) */}
              {isTemporalMode && (
                <Slider
                  label={t('v2.controls.playSpeed') || 'Vitesse'}
                  value={playSpeed}
                  min={1}
                  max={16}
                  step={1}
                  onChange={(v) => setPlaySpeed(v)}
                />
              )}
            </GlassPanel>
          )}
        </div>
      </div>

      {/* Timeline bar (Mode A temporal) */}
      {isTemporalMode && totalFrames > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            padding: '8px 12px',
            background: colors.surface,
            borderRadius: '10px',
            border: `1px solid ${colors.border}`,
            flexShrink: 0,
          }}
        >
          {/* Play/Pause */}
          <button
            onClick={() => {
              if (currentFrame >= totalFrames - 1) {
                setCurrentFrame(0);
              }
              setPlaying((p) => !p);
            }}
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '50%',
              border: `1px solid ${colors.accent}`,
              background: playing ? colors.accentMuted : 'transparent',
              color: colors.accent,
              cursor: 'pointer',
              fontSize: '14px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            {playing ? '⏸' : '▶'}
          </button>

          {/* Time display */}
          <div style={{
            fontSize: '12px',
            color: colors.text2,
            fontVariantNumeric: 'tabular-nums',
            minWidth: '60px',
            flexShrink: 0,
          }}>
            {currentTimeS.toFixed(1)}s
          </div>

          {/* Timeline slider */}
          <input
            type="range"
            min={0}
            max={totalFrames - 1}
            value={currentFrame}
            onChange={(e) => {
              setPlaying(false);
              setCurrentFrame(Number(e.target.value));
            }}
            style={{
              flex: 1,
              height: '4px',
              cursor: 'pointer',
              accentColor: colors.accent,
            }}
          />

          {/* Frame counter */}
          <div style={{
            fontSize: '11px',
            color: colors.text3,
            fontVariantNumeric: 'tabular-nums',
            flexShrink: 0,
          }}>
            {currentFrame + 1}/{totalFrames}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * ECHOS V2 — Volume Viewer Component
 *
 * Main 3D viewer wrapping the WebGL ray marching engine.
 * Provides controls for:
 *   - Opacity, threshold, density, smoothing
 *   - Chromatic mode selection
 *   - Beam visualization toggle
 *   - Ghost enhancement
 *   - Time scrubbing
 */

import React, { useRef, useEffect, useCallback, useState } from 'react';
import { GlassPanel, Slider, Button, colors } from '@echos/ui';
import type { RendererSettings, ChromaticMode } from '@echos/core';
import { DEFAULT_RENDERER } from '@echos/core';
import { VolumeRenderer } from '../engine/volume-renderer.js';
import { getChromaticModes, CHROMATIC_LABELS } from '../engine/transfer-function.js';
import { useTranslation } from '../i18n/index.js';

interface VolumeViewerProps {
  volumeData: Float32Array | null;
  dimensions: [number, number, number];
  extent: [number, number, number];
  mode: 'instrument' | 'spatial';
  onSettingsChange?: (settings: RendererSettings) => void;
}

export function VolumeViewer({
  volumeData,
  dimensions,
  extent,
  mode,
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

  // Upload volume data when it changes
  useEffect(() => {
    if (!rendererRef.current || !volumeData) return;
    rendererRef.current.uploadVolume(volumeData, dimensions, extent);
  }, [volumeData, dimensions, extent]);

  // Update settings
  const updateSetting = useCallback(
    (key: keyof RendererSettings, value: number | boolean | string) => {
      setSettings((prev) => {
        const next = { ...prev, [key]: value };
        rendererRef.current?.updateSettings({ [key]: value });
        onSettingsChange?.(next);
        return next;
      });
    },
    [onSettingsChange],
  );

  const chromaticModes = getChromaticModes();

  return (
    <div style={{ display: 'flex', height: '100%', minHeight: '600px', gap: '16px' }}>
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
          minHeight: '500px',
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

        {!volumeData && (
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
          width: controlsOpen ? '280px' : '40px',
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
          <GlassPanel style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px', maxHeight: 'calc(100vh - 200px)', overflowY: 'auto' }}>
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
          </GlassPanel>
        )}
      </div>
    </div>
  );
}

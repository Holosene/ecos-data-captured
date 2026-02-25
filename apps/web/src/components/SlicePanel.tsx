/**
 * ECHOS — Orthogonal Slice View
 *
 * Renders 2D slices of a 3D Float32Array volume along X, Y, and Z axes.
 * Inline color presets with adaptive canvas sizing to match content aspect ratio.
 */

import React, { useRef, useEffect, useState } from 'react';
import { GlassPanel, colors } from '@echos/ui';
import { useTranslation } from '../i18n/index.js';
import type { TranslationKey } from '../i18n/translations.js';

// ─── Color map presets ────────────────────────────────────────────────────

const PRESETS = {
  'Sonar Original': {
    labelKey: 'v2.slices.presetSonarOriginal',
    colorMap: [
      [0.0, 0, 0, 40, 0],
      [0.1, 0, 20, 80, 20],
      [0.25, 0, 60, 160, 80],
      [0.4, 0, 120, 200, 140],
      [0.5, 40, 180, 200, 180],
      [0.65, 120, 220, 120, 200],
      [0.8, 220, 220, 40, 230],
      [0.9, 255, 140, 0, 245],
      [1.0, 255, 40, 0, 255],
    ] as number[][],
  },
  'Water Off': {
    labelKey: 'v2.slices.presetWaterOff',
    colorMap: [
      [0.0, 0, 0, 0, 0],
      [0.15, 0, 0, 0, 0],
      [0.3, 10, 20, 60, 20],
      [0.5, 66, 33, 206, 120],
      [0.7, 140, 100, 255, 200],
      [1.0, 225, 224, 235, 255],
    ] as number[][],
  },
  Structures: {
    labelKey: 'v2.slices.presetStructures',
    colorMap: [
      [0.0, 0, 0, 0, 0],
      [0.1, 0, 0, 0, 0],
      [0.2, 20, 10, 40, 30],
      [0.4, 66, 33, 206, 80],
      [0.6, 45, 212, 160, 180],
      [0.8, 225, 200, 100, 230],
      [1.0, 255, 255, 255, 255],
    ] as number[][],
  },
  'High Contrast': {
    labelKey: 'v2.slices.presetHighContrast',
    colorMap: [
      [0.0, 0, 0, 0, 0],
      [0.05, 0, 0, 0, 0],
      [0.1, 30, 0, 60, 60],
      [0.3, 100, 30, 206, 150],
      [0.5, 200, 100, 255, 220],
      [0.7, 255, 200, 100, 245],
      [1.0, 255, 255, 255, 255],
    ] as number[][],
  },
  Grayscale: {
    labelKey: 'v2.slices.presetGrayscale',
    colorMap: [
      [0.0, 0, 0, 0, 0],
      [0.1, 0, 0, 0, 0],
      [0.2, 40, 40, 40, 40],
      [0.5, 128, 128, 128, 128],
      [0.8, 200, 200, 200, 220],
      [1.0, 255, 255, 255, 255],
    ] as number[][],
  },
} as const;

type PresetName = keyof typeof PRESETS;

// ─── Slice rendering ─────────────────────────────────────────────────────

function renderSlice(
  canvas: HTMLCanvasElement,
  data: Float32Array,
  dims: [number, number, number],
  axis: 'x' | 'y' | 'z',
  sliceIndex: number,
  preset: PresetName,
) {
  const [dimX, dimY, dimZ] = dims;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  let w: number, h: number;
  if (axis === 'z') { w = dimX; h = dimY; }
  else if (axis === 'y') { w = dimX; h = dimZ; }
  else { w = dimY; h = dimZ; }

  canvas.width = w;
  canvas.height = h;
  const imageData = ctx.createImageData(w, h);
  const colorMap = PRESETS[preset].colorMap;

  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      let idx: number;
      if (axis === 'z') idx = sliceIndex * dimY * dimX + row * dimX + col;
      else if (axis === 'y') idx = row * dimY * dimX + sliceIndex * dimX + col;
      else idx = row * dimY * dimX + col * dimX + sliceIndex;

      const val = idx < data.length ? data[idx] : 0;
      const clamped = Math.max(0, Math.min(1, val));
      let r = 0, g = 0, b = 0, a = 0;

      for (let i = 1; i < colorMap.length; i++) {
        if (clamped <= colorMap[i][0]) {
          const t = (clamped - colorMap[i - 1][0]) / (colorMap[i][0] - colorMap[i - 1][0]);
          r = colorMap[i - 1][1] + t * (colorMap[i][1] - colorMap[i - 1][1]);
          g = colorMap[i - 1][2] + t * (colorMap[i][2] - colorMap[i - 1][2]);
          b = colorMap[i - 1][3] + t * (colorMap[i][3] - colorMap[i - 1][3]);
          a = colorMap[i - 1][4] + t * (colorMap[i][4] - colorMap[i - 1][4]);
          break;
        }
      }

      const pxIdx = (row * w + col) * 4;
      imageData.data[pxIdx] = r;
      imageData.data[pxIdx + 1] = g;
      imageData.data[pxIdx + 2] = b;
      imageData.data[pxIdx + 3] = a;
    }
  }

  ctx.putImageData(imageData, 0, 0);
}

// ─── Axis label mapping ──────────────────────────────────────────────

const AXIS_LABEL_KEYS: Record<string, { h: TranslationKey; v: TranslationKey }> = {
  x: { h: 'v2.slices.axisDepth', v: 'v2.slices.axisDistance' },
  y: { h: 'v2.slices.axisWidth', v: 'v2.slices.axisDistance' },
  z: { h: 'v2.slices.axisWidth', v: 'v2.slices.axisDepth' },
};

// ─── Single axis slice view ─────────────────────────────────────────────

function SliceView({
  volumeData,
  dimensions,
  axis,
  label,
  preset,
}: {
  volumeData: Float32Array;
  dimensions: [number, number, number];
  axis: 'x' | 'y' | 'z';
  label: string;
  preset: PresetName;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { t } = useTranslation();
  const [dimX, dimY, dimZ] = dimensions;
  const maxSlice = axis === 'x' ? dimX - 1 : axis === 'y' ? dimY - 1 : dimZ - 1;
  const [sliceIdx, setSliceIdx] = useState(Math.floor(maxSlice / 2));

  // Compute actual content aspect ratio for this axis
  let contentW: number, contentH: number;
  if (axis === 'z') { contentW = dimX; contentH = dimY; }
  else if (axis === 'y') { contentW = dimX; contentH = dimZ; }
  else { contentW = dimY; contentH = dimZ; }

  const aspectRatio = contentW / contentH;
  const isPortrait = aspectRatio < 1;

  useEffect(() => {
    if (canvasRef.current && volumeData.length > 0) {
      renderSlice(canvasRef.current, volumeData, dimensions, axis, sliceIdx, preset);
    }
  }, [volumeData, dimensions, axis, sliceIdx, preset]);

  useEffect(() => {
    if (sliceIdx > maxSlice) setSliceIdx(Math.floor(maxSlice / 2));
  }, [maxSlice, sliceIdx]);

  const labelKeys = AXIS_LABEL_KEYS[axis];

  return (
    <GlassPanel padding="16px">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
        <div style={{ fontSize: '14px', fontWeight: 600, color: colors.accent }}>{label}</div>
        <div style={{ fontSize: '12px', color: colors.text3 }}>
          {t(labelKeys.h)} / {t(labelKeys.v)}
        </div>
      </div>
      <div style={{
        width: '100%',
        background: colors.black,
        borderRadius: '6px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        maxHeight: isPortrait ? '500px' : '300px',
        minHeight: '120px',
        overflow: 'hidden',
      }}>
        <canvas
          ref={canvasRef}
          style={{
            maxWidth: '100%',
            maxHeight: isPortrait ? '500px' : '300px',
            borderRadius: '6px',
            imageRendering: 'pixelated',
            objectFit: 'contain',
            display: 'block',
          }}
        />
      </div>
      <div style={{ marginTop: '10px', display: 'flex', alignItems: 'center', gap: '10px' }}>
        <span style={{ fontSize: '12px', color: colors.text3, minWidth: '28px', fontVariantNumeric: 'tabular-nums' }}>
          {sliceIdx}
        </span>
        <input
          type="range"
          min={0}
          max={maxSlice}
          value={sliceIdx}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSliceIdx(parseInt(e.target.value))}
          style={{ flex: 1, accentColor: colors.accent }}
        />
        <span style={{ fontSize: '12px', color: colors.text3, minWidth: '28px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
          {maxSlice}
        </span>
      </div>
    </GlassPanel>
  );
}

// ─── Main SlicePanel (exported) ─────────────────────────────────────────

interface SlicePanelProps {
  volumeData: Float32Array;
  dimensions: [number, number, number];
}

export function SlicePanel({ volumeData, dimensions }: SlicePanelProps) {
  const [preset, setPreset] = useState<PresetName>('Water Off');
  const { t } = useTranslation();

  return (
    <div style={{ display: 'grid', gap: '20px' }}>
      {/* Header: title + preset selector */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <h3 style={{ fontSize: '16px', fontWeight: 600, color: colors.text1, margin: 0 }}>
          {t('v2.slices.title')}
        </h3>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {(Object.keys(PRESETS) as PresetName[]).map((name) => (
            <button
              key={name}
              onClick={() => setPreset(name)}
              style={{
                padding: '7px 14px',
                borderRadius: '20px',
                border: `1px solid ${preset === name ? colors.accent : colors.border}`,
                background: preset === name ? colors.accentMuted : 'transparent',
                color: preset === name ? colors.accent : colors.text2,
                fontSize: '13px',
                fontWeight: 500,
                cursor: 'pointer',
                transition: 'all 150ms ease',
                fontFamily: 'inherit',
              }}
            >
              {t(PRESETS[name].labelKey as TranslationKey)}
            </button>
          ))}
        </div>
      </div>

      {/* 2-column layout: plan view + cross-section */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
        <SliceView
          volumeData={volumeData}
          dimensions={dimensions}
          axis="y"
          label={t('v2.slices.planView')}
          preset={preset}
        />
        <SliceView
          volumeData={volumeData}
          dimensions={dimensions}
          axis="z"
          label={t('v2.slices.crossSection')}
          preset={preset}
        />
      </div>

      {/* Full-width: longitudinal */}
      <SliceView
        volumeData={volumeData}
        dimensions={dimensions}
        axis="x"
        label={t('v2.slices.longitudinal')}
        preset={preset}
      />
    </div>
  );
}

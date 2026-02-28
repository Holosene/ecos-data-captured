/**
 * ECOS — Orthogonal Slice View (Redesigned)
 *
 * Clean, airy layout matching the volume viewer design language:
 *   - No heavy GlassPanel backgrounds
 *   - Bordered canvas views
 *   - Pill-shaped slider bars matching the volume section
 *   - Memory-optimized: cached ImageData, skip unnecessary canvas resets
 */

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { colors, fonts } from '@echos/ui';
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

// ─── Optimized slice rendering ──────────────────────────────────────────

function renderSlice(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  imageDataCache: React.MutableRefObject<ImageData | null>,
  data: Float32Array,
  dims: [number, number, number],
  axis: 'x' | 'y' | 'z',
  sliceIndex: number,
  preset: PresetName,
) {
  const [dimX, dimY, dimZ] = dims;

  let w: number, h: number;
  if (axis === 'z') { w = dimX; h = dimY; }
  else if (axis === 'y') { w = dimX; h = dimZ; }
  else { w = dimY; h = dimZ; }

  // Only reset canvas size if dimensions changed (avoids pixel buffer reallocation)
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
    imageDataCache.current = null; // invalidate cache
  }

  // Reuse ImageData if possible
  let imageData = imageDataCache.current;
  if (!imageData || imageData.width !== w || imageData.height !== h) {
    imageData = ctx.createImageData(w, h);
    imageDataCache.current = imageData;
  }

  const colorMap = PRESETS[preset].colorMap;
  const pixels = imageData.data;

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
      pixels[pxIdx] = r;
      pixels[pxIdx + 1] = g;
      pixels[pxIdx + 2] = b;
      pixels[pxIdx + 3] = a;
    }
  }

  ctx.putImageData(imageData, 0, 0);
}

// ─── Axis label mapping ──────────────────────────────────────────────

const AXIS_LABEL_KEYS: Record<string, { h: TranslationKey; v: TranslationKey }> = {
  x: { h: 'v2.slices.axisDistance',  v: 'v2.slices.axisDepth' },
  y: { h: 'v2.slices.axisWidth',     v: 'v2.slices.axisDepth' },
  z: { h: 'v2.slices.axisWidth',     v: 'v2.slices.axisDistance' },
};

// ─── Single axis slice view — clean, borderless ─────────────────────────

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
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const imageDataCacheRef = useRef<ImageData | null>(null);
  const { t } = useTranslation();
  const [dimX, dimY, dimZ] = dimensions;
  const maxSlice = axis === 'x' ? dimX - 1 : axis === 'y' ? dimY - 1 : dimZ - 1;
  const [sliceIdx, setSliceIdx] = useState(Math.floor(maxSlice / 2));

  let contentW: number, contentH: number;
  if (axis === 'z') { contentW = dimX; contentH = dimY; }
  else if (axis === 'y') { contentW = dimX; contentH = dimZ; }
  else { contentW = dimY; contentH = dimZ; }

  const aspectRatio = contentW / contentH;
  const isPortrait = aspectRatio < 1;

  // Cache canvas context once
  useEffect(() => {
    if (canvasRef.current && !ctxRef.current) {
      ctxRef.current = canvasRef.current.getContext('2d');
    }
  }, []);

  useEffect(() => {
    if (canvasRef.current && ctxRef.current && volumeData.length > 0) {
      renderSlice(canvasRef.current, ctxRef.current, imageDataCacheRef, volumeData, dimensions, axis, sliceIdx, preset);
    }
  }, [volumeData, dimensions, axis, sliceIdx, preset]);

  useEffect(() => {
    if (sliceIdx > maxSlice) setSliceIdx(Math.floor(maxSlice / 2));
  }, [maxSlice, sliceIdx]);

  // Cleanup ImageData cache on unmount
  useEffect(() => {
    return () => { imageDataCacheRef.current = null; };
  }, []);

  const labelKeys = AXIS_LABEL_KEYS[axis];

  return (
    <div>
      {/* Label row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
        <span style={{ fontSize: '14px', fontWeight: 600, color: colors.text1 }}>{label}</span>
        <span style={{ fontSize: '12px', color: colors.text3 }}>
          {t(labelKeys.h)} / {t(labelKeys.v)}
        </span>
      </div>

      {/* Canvas with clean border */}
      <div style={{
        width: '100%',
        borderRadius: '16px',
        border: `1.5px solid ${colors.border}`,
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        maxHeight: isPortrait ? '500px' : '300px',
        minHeight: '120px',
      }}>
        <canvas
          ref={canvasRef}
          style={{
            maxWidth: '100%',
            maxHeight: isPortrait ? '500px' : '300px',
            imageRendering: 'pixelated',
            objectFit: 'contain',
            display: 'block',
          }}
        />
      </div>

      {/* Pill-shaped slider — matching volume viewer style */}
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        marginTop: '12px',
      }}>
        <div style={{
          width: 'max(200px, 50%)',
          padding: '8px 16px',
          background: colors.surface,
          borderRadius: '24px',
          border: `1px solid ${colors.border}`,
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
        }}>
          <span style={{ fontSize: '11px', color: colors.text3, minWidth: '24px', fontVariantNumeric: 'tabular-nums' }}>
            {sliceIdx}
          </span>
          <input
            type="range"
            min={0}
            max={maxSlice}
            value={sliceIdx}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSliceIdx(parseInt(e.target.value))}
            style={{ flex: 1, accentColor: colors.accent, cursor: 'pointer', height: '6px' }}
          />
          <span style={{ fontSize: '11px', color: colors.text3, minWidth: '24px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
            {maxSlice}
          </span>
        </div>
      </div>
    </div>
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
      {/* Section header — same style as volume titles */}
      <div>
        <h2 style={{
          fontFamily: fonts.display,
          fontVariationSettings: "'wght' 600",
          fontSize: 'clamp(24px, 2.5vw, 36px)',
          color: colors.text1,
          letterSpacing: '-0.02em',
          lineHeight: 1.1,
          margin: 0,
          marginBottom: '8px',
        }}>
          {t('v2.slices.title')}
        </h2>
        <p style={{ margin: 0, color: colors.text2, fontSize: '15px', lineHeight: 1.6, maxWidth: '700px' }}>
          {t('v2.slices.desc')}
        </p>
      </div>

      {/* Preset pills — same style as chromatic mode pills */}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        {(Object.keys(PRESETS) as PresetName[]).map((name) => (
          <button
            key={name}
            onClick={() => setPreset(name)}
            style={{
              padding: '6px 12px',
              borderRadius: '9999px',
              border: `1px solid ${preset === name ? colors.accent : 'transparent'}`,
              background: preset === name ? colors.accentMuted : colors.surface,
              color: preset === name ? colors.accent : colors.text1,
              fontSize: '11px',
              fontWeight: 500,
              cursor: 'pointer',
              transition: 'all 150ms ease',
              fontFamily: 'inherit',
              whiteSpace: 'nowrap',
            }}
          >
            {t(PRESETS[name].labelKey as TranslationKey)}
          </button>
        ))}
      </div>

      {/* 2-column layout: plan + cross-section */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
        <SliceView
          volumeData={volumeData}
          dimensions={dimensions}
          axis="z"
          label={t('v2.slices.planView')}
          preset={preset}
        />
        <SliceView
          volumeData={volumeData}
          dimensions={dimensions}
          axis="y"
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

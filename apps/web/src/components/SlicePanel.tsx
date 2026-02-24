/**
 * ECHOS — Orthogonal Slice View (v1-style)
 *
 * Renders 2D slices of a 3D Float32Array volume along X, Y, and Z axes.
 * Inline color presets (Water Off, Structures, High Contrast, Grayscale)
 * with 2+1 column layout matching the original v1 viewer.
 */

import React, { useRef, useEffect, useState } from 'react';
import { GlassPanel, colors } from '@echos/ui';

// ─── Color map presets (inline, no external LUT) ────────────────────────────

const PRESETS = {
  'Water Off': {
    description: 'Suppress water column, show strong echoes',
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
    description: 'Highlight bottom structures and vegetation',
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
    description: 'Maximum contrast for detail analysis',
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
    description: 'Simple grayscale mapping',
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

// ─── Single axis slice view ─────────────────────────────────────────────

const AXIS_LABELS: Record<string, { h: string; v: string }> = {
  x: { h: 'Distance (Y)', v: 'Depth (Z)' },
  y: { h: 'Width (X)', v: 'Depth (Z)' },
  z: { h: 'Width (X)', v: 'Distance (Y)' },
};

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
  const [dimX, dimY, dimZ] = dimensions;
  const maxSlice = axis === 'x' ? dimX - 1 : axis === 'y' ? dimY - 1 : dimZ - 1;
  const [sliceIdx, setSliceIdx] = useState(Math.floor(maxSlice / 2));

  useEffect(() => {
    if (canvasRef.current && volumeData.length > 0) {
      renderSlice(canvasRef.current, volumeData, dimensions, axis, sliceIdx, preset);
    }
  }, [volumeData, dimensions, axis, sliceIdx, preset]);

  useEffect(() => {
    if (sliceIdx > maxSlice) setSliceIdx(Math.floor(maxSlice / 2));
  }, [maxSlice, sliceIdx]);

  return (
    <GlassPanel padding="16px">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
        <div style={{ fontSize: '14px', fontWeight: 600, color: colors.accent }}>{label}</div>
        <div style={{ fontSize: '12px', color: colors.text3 }}>
          {AXIS_LABELS[axis].h} / {AXIS_LABELS[axis].v}
        </div>
      </div>
      <canvas
        ref={canvasRef}
        style={{
          width: '100%',
          height: 'auto',
          borderRadius: '6px',
          imageRendering: 'auto',
          background: colors.black,
          display: 'block',
        }}
      />
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

  const [dimX, dimY, dimZ] = dimensions;

  return (
    <div style={{ display: 'grid', gap: '20px' }}>
      {/* Header: title + preset selector */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <h3 style={{ fontSize: '16px', fontWeight: 600, color: colors.text1, margin: 0 }}>
          Coupes orthogonales
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
              {name}
            </button>
          ))}
        </div>
      </div>

      {/* Volume info */}
      <GlassPanel padding="16px">
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', flexWrap: 'wrap', gap: '8px' }}>
          <span style={{ color: colors.text3 }}>
            Volume: {dimX} x {dimY} x {dimZ}
          </span>
        </div>
      </GlassPanel>

      {/* 2-column layout: cross-section + plan view */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
        <SliceView
          volumeData={volumeData}
          dimensions={dimensions}
          axis="y"
          label="Transversale (XZ)"
          preset={preset}
        />
        <SliceView
          volumeData={volumeData}
          dimensions={dimensions}
          axis="z"
          label="Vue en plan (XY)"
          preset={preset}
        />
      </div>

      {/* Full-width: longitudinal */}
      <SliceView
        volumeData={volumeData}
        dimensions={dimensions}
        axis="x"
        label="Longitudinale (YZ)"
        preset={preset}
      />
    </div>
  );
}

/**
 * ECHOS V2 — Orthogonal Slice View Panel
 *
 * Renders a 2D slice of a 3D Float32Array volume along X, Y, or Z axis.
 * Applies the current chromatic transfer function for coloring.
 */

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { GlassPanel, colors } from '@echos/ui';
import type { ChromaticMode } from '@echos/core';
import { generateLUT } from '../engine/transfer-function.js';

interface SlicePanelProps {
  volumeData: Float32Array;
  dimensions: [number, number, number];
  axis: 'x' | 'y' | 'z';
  label: string;
  chromaticMode: ChromaticMode;
}

const AXIS_LABELS: Record<string, { h: string; v: string }> = {
  x: { h: 'Distance (Y)', v: 'Profondeur (Z)' },
  y: { h: 'Lateral (X)', v: 'Profondeur (Z)' },
  z: { h: 'Lateral (X)', v: 'Distance (Y)' },
};

function renderSliceV2(
  canvas: HTMLCanvasElement,
  data: Float32Array,
  dims: [number, number, number],
  axis: 'x' | 'y' | 'z',
  sliceIndex: number,
  lut: Uint8Array,
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

  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      let idx: number;
      if (axis === 'z') idx = sliceIndex * dimY * dimX + row * dimX + col;
      else if (axis === 'y') idx = row * dimY * dimX + sliceIndex * dimX + col;
      else idx = row * dimY * dimX + col * dimX + sliceIndex;

      const val = idx < data.length ? data[idx] : 0;
      const lutIdx = Math.floor(Math.max(0, Math.min(1, val)) * 255) * 4;

      const pxIdx = (row * w + col) * 4;
      imageData.data[pxIdx] = lut[lutIdx];
      imageData.data[pxIdx + 1] = lut[lutIdx + 1];
      imageData.data[pxIdx + 2] = lut[lutIdx + 2];
      imageData.data[pxIdx + 3] = lut[lutIdx + 3];
    }
  }

  ctx.putImageData(imageData, 0, 0);
}

export function SlicePanel({ volumeData, dimensions, axis, label, chromaticMode }: SlicePanelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dimX, dimY, dimZ] = dimensions;
  const maxSlice = axis === 'x' ? dimX - 1 : axis === 'y' ? dimY - 1 : dimZ - 1;
  const [sliceIdx, setSliceIdx] = useState(Math.floor(maxSlice / 2));

  const lut = React.useMemo(() => generateLUT(chromaticMode), [chromaticMode]);

  useEffect(() => {
    if (canvasRef.current && volumeData.length > 0) {
      renderSliceV2(canvasRef.current, volumeData, dimensions, axis, sliceIdx, lut);
    }
  }, [volumeData, dimensions, axis, sliceIdx, lut]);

  // Clamp slice when dimensions change
  useEffect(() => {
    if (sliceIdx > maxSlice) setSliceIdx(Math.floor(maxSlice / 2));
  }, [maxSlice, sliceIdx]);

  return (
    <GlassPanel padding="12px" style={{ minWidth: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
        <div style={{ fontSize: '13px', fontWeight: 600, color: colors.accent }}>{label}</div>
        <div style={{ fontSize: '11px', color: colors.text3 }}>
          {AXIS_LABELS[axis].h} / {AXIS_LABELS[axis].v}
        </div>
      </div>
      <canvas
        ref={canvasRef}
        style={{
          width: '100%',
          height: 'auto',
          borderRadius: '4px',
          imageRendering: 'pixelated',
          background: colors.black,
          display: 'block',
        }}
      />
      <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ fontSize: '11px', color: colors.text3, minWidth: '24px', fontVariantNumeric: 'tabular-nums' }}>
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
        <span style={{ fontSize: '11px', color: colors.text3, minWidth: '24px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
          {maxSlice}
        </span>
      </div>
    </GlassPanel>
  );
}

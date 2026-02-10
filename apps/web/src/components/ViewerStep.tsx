import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { GlassPanel, Button, colors } from '@echos/ui';
import {
  encodeNrrd,
  nrrdToBlob,
  createSession,
  sessionToBlob,
  qcReportToBlob,
} from '@echos/core';
import type { Volume } from '@echos/core';
import { useTranslation } from '../i18n/index.js';
import { IconDownload } from './Icons.js';
import { useAppState } from '../store/app-state.js';

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
};

type PresetName = keyof typeof PRESETS;

function renderSlice(
  canvas: HTMLCanvasElement,
  volume: Volume,
  axis: 'x' | 'y' | 'z',
  sliceIndex: number,
  preset: PresetName,
) {
  const { data, metadata } = volume;
  const [dimX, dimY, dimZ] = metadata.dimensions;
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
      let val: number;
      if (axis === 'z') val = data[sliceIndex * dimY * dimX + row * dimX + col];
      else if (axis === 'y') val = data[row * dimY * dimX + sliceIndex * dimX + col];
      else val = data[row * dimY * dimX + col * dimX + sliceIndex];

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

      const idx = (row * w + col) * 4;
      imageData.data[idx] = r;
      imageData.data[idx + 1] = g;
      imageData.data[idx + 2] = b;
      imageData.data[idx + 3] = a;
    }
  }

  ctx.putImageData(imageData, 0, 0);
}

function SliceView({
  volume,
  axis,
  label,
  preset,
}: {
  volume: Volume;
  axis: 'x' | 'y' | 'z';
  label: string;
  preset: PresetName;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dimX, dimY, dimZ] = volume.metadata.dimensions;
  const maxSlice = axis === 'x' ? dimX - 1 : axis === 'y' ? dimY - 1 : dimZ - 1;
  const [sliceIdx, setSliceIdx] = useState(Math.floor(maxSlice / 2));

  useEffect(() => {
    if (canvasRef.current) {
      renderSlice(canvasRef.current, volume, axis, sliceIdx, preset);
    }
  }, [volume, axis, sliceIdx, preset]);

  const axisLabels = {
    x: { h: 'Distance (Y)', v: 'Depth (Z)' },
    y: { h: 'Width (X)', v: 'Depth (Z)' },
    z: { h: 'Width (X)', v: 'Distance (Y)' },
  };

  return (
    <GlassPanel padding="16px">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
        <div style={{ fontSize: '14px', fontWeight: 600, color: colors.accent }}>{label}</div>
        <div style={{ fontSize: '12px', color: colors.text3 }}>
          {axisLabels[axis].h} / {axisLabels[axis].v}
        </div>
      </div>
      <canvas
        ref={canvasRef}
        style={{
          width: '100%',
          height: 'auto',
          borderRadius: '6px',
          imageRendering: 'pixelated',
          background: colors.black,
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
          onChange={(e) => setSliceIdx(parseInt(e.target.value))}
          style={{ flex: 1 }}
        />
        <span style={{ fontSize: '12px', color: colors.text3, minWidth: '28px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
          {maxSlice}
        </span>
      </div>
    </GlassPanel>
  );
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function ViewerStep() {
  const { state, dispatch } = useAppState();
  const { t } = useTranslation();
  const [preset, setPreset] = useState<PresetName>('Water Off');

  const { volume, qcReport, mappings } = state;

  const handleExportNrrd = useCallback(() => {
    if (!volume) return;
    const nrrd = encodeNrrd(volume);
    const blob = nrrdToBlob(nrrd);
    download(blob, 'echos_volume.nrrd');
  }, [volume]);

  const handleExportMapping = useCallback(() => {
    const blob = new Blob([JSON.stringify(mappings, null, 2)], { type: 'application/json' });
    download(blob, 'echos_mapping.json');
  }, [mappings]);

  const handleExportQc = useCallback(() => {
    if (!qcReport) return;
    const blob = qcReportToBlob(qcReport);
    download(blob, 'echos_qc_report.json');
  }, [qcReport]);

  const handleExportSession = useCallback(() => {
    if (!state.videoFile || !state.gpxFile) return;
    const session = createSession({
      videoFileName: state.videoFile.name,
      gpxFileName: state.gpxFile.name,
      crop: state.crop,
      calibration: state.calibration,
      sync: state.sync,
      volumeMetadata: volume?.metadata,
    });
    const blob = sessionToBlob(session);
    download(blob, `echos_session_${Date.now()}.echos.json`);
  }, [state, volume]);

  if (!volume) {
    return (
      <div style={{ textAlign: 'center', padding: '64px 24px' }}>
        <p style={{ color: colors.text3, fontSize: '16px' }}>{t('viewer.noVolume')}</p>
        <Button
          variant="secondary"
          size="lg"
          onClick={() => dispatch({ type: 'SET_STEP', step: 'generate' })}
          style={{ marginTop: '20px' }}
        >
          {t('viewer.backToGenerate')}
        </Button>
      </div>
    );
  }

  const [dimX, dimY, dimZ] = volume.metadata.dimensions;

  return (
    <div style={{ display: 'grid', gap: '32px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <h2 style={{ fontSize: 'clamp(24px, 2.5vw, 32px)', fontWeight: 600 }}>{t('viewer.title')}</h2>
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

      <GlassPanel padding="16px">
        <div className="grid-4-cols" style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', flexWrap: 'wrap', gap: '8px' }}>
          <span style={{ color: colors.text3 }}>
            Volume: {dimX} x {dimY} x {dimZ}
          </span>
          <span style={{ color: colors.text3 }}>
            Spacing: {volume.metadata.spacing.map((s) => s.toFixed(3)).join(' x ')} m
          </span>
          <span style={{ color: colors.text3 }}>
            Distance: {volume.metadata.totalDistanceM.toFixed(1)} m
          </span>
          <span style={{ color: colors.text3 }}>
            Depth: {volume.metadata.depthMaxM} m
          </span>
        </div>
      </GlassPanel>

      <div className="grid-2-cols" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
        <SliceView volume={volume} axis="y" label={t('viewer.crossSection')} preset={preset} />
        <SliceView volume={volume} axis="z" label={t('viewer.planView')} preset={preset} />
      </div>
      <SliceView volume={volume} axis="x" label={t('viewer.longitudinal')} preset={preset} />

      {qcReport && qcReport.warnings.length > 0 && (
        <GlassPanel padding="16px" style={{ borderColor: colors.warning }}>
          <div style={{ fontSize: '14px', fontWeight: 600, color: colors.warning, marginBottom: '10px' }}>
            {t('viewer.warnings')}
          </div>
          {qcReport.warnings.map((w, i) => (
            <div key={i} style={{ fontSize: '13px', color: colors.text2, marginBottom: '4px' }}>
              - {w}
            </div>
          ))}
        </GlassPanel>
      )}

      <GlassPanel padding="28px">
        <h3 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '20px' }}>{t('viewer.export')}</h3>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <Button variant="primary" onClick={handleExportNrrd}>
            <IconDownload size={16} /> {t('viewer.dlVolume')}
          </Button>
          <Button variant="secondary" onClick={handleExportMapping}>
            {t('viewer.dlMapping')}
          </Button>
          <Button variant="secondary" onClick={handleExportQc}>
            {t('viewer.dlQc')}
          </Button>
          <Button variant="secondary" onClick={handleExportSession}>
            {t('viewer.saveSession')}
          </Button>
        </div>
      </GlassPanel>

      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <Button variant="ghost" size="lg" onClick={() => dispatch({ type: 'SET_STEP', step: 'generate' })}>
          {t('viewer.back')}
        </Button>
        <Button variant="ghost" size="lg" onClick={() => dispatch({ type: 'RESET' })}>
          {t('viewer.newScan')}
        </Button>
      </div>
    </div>
  );
}

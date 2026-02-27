/**
 * ECOS V2 — Export Panel
 *
 * Provides multi-format export for the current volume:
 *   - NRRD volume
 *   - Mapping JSON
 *   - QC Report
 *   - Session file
 *   - PNG screenshot
 *   - CSV metrics
 */

import React, { useCallback } from 'react';
import { colors } from '@echos/ui';
import { useTranslation } from '../i18n/index.js';

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

interface ExportPanelProps {
  volumeData: Float32Array | null;
  dimensions: [number, number, number];
  extent: [number, number, number];
  onCaptureScreenshot?: () => string | null;
}

export function ExportPanel({ volumeData, dimensions, extent, onCaptureScreenshot }: ExportPanelProps) {
  const { t } = useTranslation();

  const handleExportNrrd = useCallback(() => {
    if (!volumeData || volumeData.length === 0) return;

    const [dimX, dimY, dimZ] = dimensions;
    const [eX, eY, eZ] = extent;
    const spacingX = eX / dimX;
    const spacingY = eY / dimY;
    const spacingZ = eZ / dimZ;

    const header = [
      'NRRD0004',
      'type: float',
      'dimension: 3',
      `sizes: ${dimX} ${dimY} ${dimZ}`,
      `spacings: ${spacingX.toFixed(6)} ${spacingY.toFixed(6)} ${spacingZ.toFixed(6)}`,
      'encoding: raw',
      'endian: little',
      'space origin: (0,0,0)',
      'space directions: (1,0,0) (0,1,0) (0,0,1)',
      `# ECOS V2 volume — extent: ${eX.toFixed(1)} x ${eY.toFixed(1)} x ${eZ.toFixed(1)} m`,
      '',
      '',
    ].join('\n');

    const headerBytes = new TextEncoder().encode(header);
    const dataBytes = new Uint8Array(volumeData.buffer, volumeData.byteOffset, volumeData.byteLength);
    const result = new Uint8Array(headerBytes.length + dataBytes.length);
    result.set(headerBytes, 0);
    result.set(dataBytes, headerBytes.length);

    download(new Blob([result], { type: 'application/octet-stream' }), 'echos_volume.nrrd');
  }, [volumeData, dimensions, extent]);

  const handleExportPng = useCallback(() => {
    if (!onCaptureScreenshot) return;
    const dataUrl = onCaptureScreenshot();
    if (!dataUrl) return;

    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = 'echos_capture.png';
    a.click();
  }, [onCaptureScreenshot]);

  const handleExportCsv = useCallback(() => {
    if (!volumeData || volumeData.length === 0) return;

    // Compute basic volume metrics
    let min = Infinity, max = -Infinity, sum = 0, nonZero = 0;
    for (let i = 0; i < volumeData.length; i++) {
      const v = volumeData[i];
      if (v > 0.0001) {
        if (v < min) min = v;
        if (v > max) max = v;
        sum += v;
        nonZero++;
      }
    }

    const mean = nonZero > 0 ? sum / nonZero : 0;
    const [dimX, dimY, dimZ] = dimensions;
    const [eX, eY, eZ] = extent;

    const csv = [
      'metric,value',
      `dimensions,"${dimX}x${dimY}x${dimZ}"`,
      `extent_m,"${eX.toFixed(1)}x${eY.toFixed(1)}x${eZ.toFixed(1)}"`,
      `total_voxels,${volumeData.length}`,
      `non_zero_voxels,${nonZero}`,
      `fill_ratio,${(nonZero / volumeData.length).toFixed(4)}`,
      `min_intensity,${min === Infinity ? 0 : min.toFixed(6)}`,
      `max_intensity,${max.toFixed(6)}`,
      `mean_intensity,${mean.toFixed(6)}`,
      `memory_mb,${(volumeData.byteLength / (1024 * 1024)).toFixed(2)}`,
    ].join('\n');

    download(new Blob([csv], { type: 'text/csv' }), 'echos_metrics.csv');
  }, [volumeData, dimensions, extent]);

  const hasVolume = volumeData && volumeData.length > 0;

  const exportButtons = [
    { label: 'NRRD', onClick: handleExportNrrd, disabled: !hasVolume },
    { label: 'PNG', onClick: handleExportPng, disabled: !onCaptureScreenshot },
    { label: 'CSV', onClick: handleExportCsv, disabled: !hasVolume },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: colors.text1 }}>
        {t('v2.export.title')}
      </h3>
      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
        {exportButtons.map((btn) => (
          <button
            key={btn.label}
            onClick={btn.onClick}
            disabled={btn.disabled}
            style={{
              padding: '10px 28px',
              borderRadius: '10px',
              border: `1.5px solid ${colors.text1}`,
              background: 'transparent',
              color: colors.text1,
              fontSize: '14px',
              fontWeight: 600,
              fontFamily: 'inherit',
              cursor: btn.disabled ? 'not-allowed' : 'pointer',
              opacity: btn.disabled ? 0.35 : 1,
              transition: 'all 150ms ease',
            }}
            onMouseEnter={(e) => {
              if (btn.disabled) return;
              (e.currentTarget as HTMLElement).style.background = colors.accent;
              (e.currentTarget as HTMLElement).style.borderColor = colors.accent;
              (e.currentTarget as HTMLElement).style.color = '#FFFFFF';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = 'transparent';
              (e.currentTarget as HTMLElement).style.borderColor = colors.text1;
              (e.currentTarget as HTMLElement).style.color = colors.text1;
            }}
          >
            {btn.label}
          </button>
        ))}
      </div>
    </div>
  );
}

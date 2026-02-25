/**
 * ECHOS — Calibration Panel (hidden dev tool)
 *
 * Activated by pressing "b" 5 times in the volume viewer.
 * Provides real-time sliders for all calibration parameters.
 * Ctrl+S saves to localStorage + downloads JSON.
 */

import React, { useCallback } from 'react';
import { colors } from '@echos/ui';
import { DEFAULT_CALIBRATION } from '../engine/volume-renderer.js';
import type { CalibrationConfig } from '../engine/volume-renderer.js';

const STORAGE_KEY = 'echos-calibration-v2';

type Axis = 'x' | 'y' | 'z';

interface CalibrationPanelProps {
  config: CalibrationConfig;
  onChange: (config: CalibrationConfig) => void;
  onClose: () => void;
  saved: boolean;
}

// ─── Compact slider row ─────────────────────────────────────────────────────

function Row({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', height: '22px' }}>
      <span style={{ width: '24px', fontSize: '10px', color: colors.text3, textAlign: 'right', flexShrink: 0 }}>
        {label}
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ flex: 1, height: '3px', cursor: 'pointer', accentColor: '#ff8844' }}
      />
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          if (!isNaN(v)) onChange(Math.min(max, Math.max(min, v)));
        }}
        style={{
          width: '52px',
          fontSize: '10px',
          fontFamily: 'monospace',
          background: 'rgba(255,255,255,0.05)',
          border: `1px solid ${colors.border}`,
          borderRadius: '4px',
          color: colors.text1,
          padding: '2px 4px',
          textAlign: 'right',
          flexShrink: 0,
        }}
      />
    </div>
  );
}

// ─── Axis dropdown ──────────────────────────────────────────────────────────

function AxisSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: Axis;
  onChange: (v: Axis) => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', height: '22px' }}>
      <span style={{ width: '48px', fontSize: '10px', color: colors.text3, flexShrink: 0 }}>
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as Axis)}
        style={{
          flex: 1,
          fontSize: '10px',
          fontFamily: 'monospace',
          background: 'rgba(255,255,255,0.05)',
          border: `1px solid ${colors.border}`,
          borderRadius: '4px',
          color: colors.text1,
          padding: '2px 4px',
          cursor: 'pointer',
        }}
      >
        <option value="x">X</option>
        <option value="y">Y</option>
        <option value="z">Z</option>
      </select>
    </div>
  );
}

// ─── Section header ─────────────────────────────────────────────────────────

function Section({ title }: { title: string }) {
  return (
    <div
      style={{
        fontSize: '10px',
        fontWeight: 600,
        color: '#ff8844',
        textTransform: 'uppercase',
        letterSpacing: '0.8px',
        marginTop: '8px',
        marginBottom: '2px',
        borderBottom: '1px solid rgba(255,136,68,0.15)',
        paddingBottom: '2px',
      }}
    >
      {title}
    </div>
  );
}

// ─── Main component ─────────────────────────────────────────────────────────

export function CalibrationPanel({ config, onChange, onClose, saved }: CalibrationPanelProps) {
  const update = useCallback(
    (path: string, value: number | string) => {
      const next = JSON.parse(JSON.stringify(config)) as CalibrationConfig;
      const parts = path.split('.');
      let obj: Record<string, unknown> = next as unknown as Record<string, unknown>;
      for (let i = 0; i < parts.length - 1; i++) {
        obj = obj[parts[i]] as Record<string, unknown>;
      }
      obj[parts[parts.length - 1]] = value;
      onChange(next);
    },
    [config, onChange],
  );

  const handleCopyJSON = useCallback(() => {
    const json = JSON.stringify(
      {
        _version: 'echos-calibration-v2',
        _timestamp: new Date().toISOString(),
        ...config,
      },
      null,
      2,
    );
    navigator.clipboard.writeText(json);
  }, [config]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '2px',
        padding: '10px',
        background: 'rgba(10,10,15,0.95)',
        borderRadius: '12px',
        border: '1px solid rgba(255,136,68,0.25)',
        backdropFilter: 'blur(12px)',
        overflowY: 'auto',
        fontSize: '11px',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '12px', fontWeight: 700, color: '#ff8844' }}>CALIBRATION</span>
          {saved && (
            <span
              style={{
                fontSize: '9px',
                padding: '1px 6px',
                borderRadius: '8px',
                background: 'rgba(0,200,100,0.15)',
                color: '#00c864',
                fontWeight: 600,
              }}
            >
              Saved
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            color: colors.text3,
            cursor: 'pointer',
            fontSize: '14px',
            padding: '0 2px',
            lineHeight: 1,
          }}
        >
          x
        </button>
      </div>

      <div style={{ fontSize: '9px', color: colors.text3, marginBottom: '4px' }}>
        b x5 toggle | Ctrl+S save
      </div>

      {/* Position */}
      <Section title="Position" />
      <Row label="X" value={config.position.x} min={-2} max={2} step={0.01} onChange={(v) => update('position.x', v)} />
      <Row label="Y" value={config.position.y} min={-2} max={2} step={0.01} onChange={(v) => update('position.y', v)} />
      <Row label="Z" value={config.position.z} min={-2} max={2} step={0.01} onChange={(v) => update('position.z', v)} />

      {/* Rotation */}
      <Section title="Rotation" />
      <Row label="Rx" value={config.rotation.x} min={0} max={360} step={1} onChange={(v) => update('rotation.x', v)} />
      <Row label="Ry" value={config.rotation.y} min={0} max={360} step={1} onChange={(v) => update('rotation.y', v)} />
      <Row label="Rz" value={config.rotation.z} min={0} max={360} step={1} onChange={(v) => update('rotation.z', v)} />

      {/* Scale */}
      <Section title="Scale" />
      <Row label="Sx" value={config.scale.x} min={0.1} max={3} step={0.01} onChange={(v) => update('scale.x', v)} />
      <Row label="Sy" value={config.scale.y} min={0.1} max={3} step={0.01} onChange={(v) => update('scale.y', v)} />
      <Row label="Sz" value={config.scale.z} min={0.1} max={3} step={0.01} onChange={(v) => update('scale.z', v)} />

      {/* Axis Mapping */}
      <Section title="Axis Mapping" />
      <AxisSelect label="Lateral" value={config.axisMapping.lateral} onChange={(v) => update('axisMapping.lateral', v)} />
      <AxisSelect label="Depth" value={config.axisMapping.depth} onChange={(v) => update('axisMapping.depth', v)} />
      <AxisSelect label="Track" value={config.axisMapping.track} onChange={(v) => update('axisMapping.track', v)} />

      {/* Camera */}
      <Section title="Camera" />
      <Row label="Dist" value={config.camera.dist} min={0.5} max={5} step={0.1} onChange={(v) => update('camera.dist', v)} />
      <Row label="FOV" value={config.camera.fov} min={20} max={120} step={1} onChange={(v) => update('camera.fov', v)} />

      {/* Scene */}
      <Section title="Scene" />
      <Row label="Grid" value={config.grid.y} min={-2} max={2} step={0.05} onChange={(v) => update('grid.y', v)} />
      <Row label="Axes" value={config.axes.size} min={0.1} max={2} step={0.05} onChange={(v) => update('axes.size', v)} />

      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', height: '22px' }}>
        <span style={{ width: '24px', fontSize: '10px', color: colors.text3, textAlign: 'right', flexShrink: 0 }}>
          BG
        </span>
        <input
          type="color"
          value={config.bgColor}
          onChange={(e) => update('bgColor', e.target.value)}
          style={{
            width: '28px',
            height: '18px',
            border: `1px solid ${colors.border}`,
            borderRadius: '4px',
            cursor: 'pointer',
            background: 'none',
            padding: 0,
          }}
        />
        <span style={{ fontSize: '10px', color: colors.text3, fontFamily: 'monospace' }}>
          {config.bgColor}
        </span>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
        <button
          onClick={handleCopyJSON}
          style={{
            flex: 1,
            padding: '5px 0',
            borderRadius: '6px',
            border: `1px solid ${colors.border}`,
            background: 'rgba(255,255,255,0.05)',
            color: colors.text2,
            fontSize: '10px',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Copy JSON
        </button>
      </div>
    </div>
  );
}

/** Load calibration from localStorage (merges with defaults for forward-compatibility) */
export function loadCalibration(): CalibrationConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as Partial<CalibrationConfig>;
    return { ...DEFAULT_CALIBRATION, ...saved } as CalibrationConfig;
  } catch {
    return null;
  }
}

/** Save calibration to localStorage */
export function saveCalibration(config: CalibrationConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

/** Download calibration as JSON file */
export function downloadCalibration(config: CalibrationConfig): void {
  const json = JSON.stringify(
    {
      _version: 'echos-calibration-v2',
      _timestamp: new Date().toISOString(),
      ...config,
    },
    null,
    2,
  );
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `echos-calibration-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

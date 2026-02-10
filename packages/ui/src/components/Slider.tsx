import React from 'react';
import { colors } from '../tokens.js';

export interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  unit?: string;
  tooltip?: string;
  disabled?: boolean;
}

export function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  unit = '',
  tooltip,
  disabled = false,
}: SliderProps) {
  return (
    <div style={{ marginBottom: '16px' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '8px',
        }}
      >
        <label
          style={{
            fontSize: '13px',
            fontWeight: 500,
            color: colors.text1,
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          {label}
          {tooltip && (
            <span
              title={tooltip}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '16px',
                height: '16px',
                borderRadius: '50%',
                border: `1px solid ${colors.border}`,
                color: colors.text3,
                fontSize: '10px',
                cursor: 'help',
              }}
            >
              ?
            </span>
          )}
        </label>
        <span
          style={{
            fontSize: '13px',
            fontWeight: 600,
            color: colors.text1,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {value}{unit}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        disabled={disabled}
        style={{ width: '100%' }}
      />
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: '11px',
          color: colors.text3,
          marginTop: '4px',
        }}
      >
        <span>{min}{unit}</span>
        <span>{max}{unit}</span>
      </div>
    </div>
  );
}

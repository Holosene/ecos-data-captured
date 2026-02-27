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
    <div style={{ marginBottom: '2px' }}>
      {label && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '3px',
          }}
        >
          <label
            style={{
              fontSize: '11px',
              fontWeight: 500,
              color: colors.text2,
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
                  width: '14px',
                  height: '14px',
                  borderRadius: '50%',
                  border: `1px solid ${colors.border}`,
                  color: colors.text3,
                  fontSize: '9px',
                  cursor: 'help',
                }}
              >
                ?
              </span>
            )}
          </label>
          <span
            style={{
              fontSize: '10px',
              fontWeight: 600,
              color: colors.text3,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {value}{unit}
          </span>
        </div>
      )}
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
    </div>
  );
}

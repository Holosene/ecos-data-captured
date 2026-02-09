import React from 'react';
import { colors, transitions } from '../tokens.js';

export interface Step {
  label: string;
  key: string;
}

export interface StepIndicatorProps {
  steps: Step[];
  currentStep: number;
  onStepClick?: (index: number) => void;
}

export function StepIndicator({ steps, currentStep, onStepClick }: StepIndicatorProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0',
        overflowX: 'auto',
        WebkitOverflowScrolling: 'touch',
        scrollbarWidth: 'none',
      }}
    >
      {steps.map((step, i) => {
        const isActive = i === currentStep;
        const isCompleted = i < currentStep;
        const isClickable = onStepClick && i <= currentStep;

        return (
          <button
            key={step.key}
            onClick={() => isClickable && onStepClick?.(i)}
            disabled={!isClickable}
            style={{
              position: 'relative',
              padding: '8px 16px',
              border: 'none',
              background: 'transparent',
              color: isActive ? colors.text1 : isCompleted ? colors.text2 : colors.text3,
              fontSize: '13px',
              fontWeight: isActive ? 600 : 400,
              cursor: isClickable ? 'pointer' : 'default',
              transition: `all ${transitions.normal}`,
              whiteSpace: 'nowrap',
              fontFamily: 'inherit',
            }}
          >
            {isCompleted && (
              <span style={{ marginRight: '4px', fontSize: '11px', opacity: 0.6 }}>&#10003;</span>
            )}
            {step.label}
            {isActive && (
              <span
                style={{
                  position: 'absolute',
                  bottom: 0,
                  left: '16px',
                  right: '16px',
                  height: '2px',
                  background: colors.accent,
                  borderRadius: '1px',
                }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

import React from 'react';
import { colors, transitions, fonts } from '../tokens.js';

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
        width: '100%',
        padding: '28px 0',
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
          <React.Fragment key={step.key}>
            {/* Step node */}
            <button
              onClick={() => isClickable && onStepClick?.(i)}
              disabled={!isClickable}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '8px',
                background: 'none',
                border: 'none',
                cursor: isClickable ? 'pointer' : 'default',
                padding: '0',
                minWidth: '76px',
                flexShrink: 0,
              }}
            >
              {/* Circle */}
              <div
                style={{
                  width: '44px',
                  height: '44px',
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '15px',
                  fontWeight: 600,
                  fontFamily: fonts.body,
                  transition: `all ${transitions.normal}`,
                  ...(isCompleted
                    ? {
                        background: colors.accent,
                        color: colors.onAccent,
                        border: `2px solid ${colors.accent}`,
                      }
                    : isActive
                    ? {
                        background: 'transparent',
                        color: colors.accent,
                        border: `2px solid ${colors.accent}`,
                      }
                    : {
                        background: 'transparent',
                        color: colors.text3,
                        border: `2px solid ${colors.border}`,
                      }),
                }}
              >
                {isCompleted ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : (
                  i + 1
                )}
              </div>

              {/* Label */}
              <span
                style={{
                  fontSize: '13px',
                  fontWeight: isActive ? 600 : 400,
                  color: isActive ? colors.text1 : isCompleted ? colors.text2 : colors.text3,
                  whiteSpace: 'nowrap',
                  transition: `color ${transitions.normal}`,
                  fontFamily: fonts.body,
                }}
              >
                {step.label}
              </span>
            </button>

            {/* Connector line */}
            {i < steps.length - 1 && (
              <div
                style={{
                  flex: 1,
                  height: '2px',
                  minWidth: '24px',
                  background: i < currentStep ? colors.accent : colors.border,
                  transition: `background ${transitions.normal}`,
                  marginBottom: '32px',
                }}
              />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

import React, { useState } from 'react';
import { colors, radius, shadows, transitions } from '../tokens.js';

export interface TooltipProps {
  text: string;
  children: React.ReactNode;
}

export function Tooltip({ text, children }: TooltipProps) {
  const [visible, setVisible] = useState(false);

  return (
    <span
      style={{ position: 'relative', display: 'inline-flex' }}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
    >
      {children}
      {visible && (
        <span
          role="tooltip"
          style={{
            position: 'absolute',
            bottom: 'calc(100% + 8px)',
            left: '50%',
            transform: 'translateX(-50%)',
            background: colors.surfaceRaised,
            color: colors.text1,
            padding: '8px 12px',
            borderRadius: radius.sm,
            border: `1px solid ${colors.border}`,
            fontSize: '13px',
            lineHeight: '1.4',
            whiteSpace: 'nowrap',
            maxWidth: '280px',
            boxShadow: shadows.md,
            zIndex: 100,
            pointerEvents: 'none',
            transition: `opacity ${transitions.fast}`,
          }}
        >
          {text}
        </span>
      )}
    </span>
  );
}

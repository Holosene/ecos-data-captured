import React from 'react';
import { colors, radius } from '../tokens.js';

export interface GlassPanelProps {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  padding?: string;
  onClick?: () => void;
}

export function GlassPanel({
  children,
  className = '',
  style,
  padding = '24px',
  onClick,
}: GlassPanelProps) {
  return (
    <div
      className={`card ${className}`}
      onClick={onClick}
      style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: radius.md,
        padding,
        transition: 'border-color 200ms ease',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

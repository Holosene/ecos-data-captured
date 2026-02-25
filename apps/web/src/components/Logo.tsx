import React from 'react';
import { getBrandingForTheme } from '../branding.js';
import { useTheme } from '../theme/index.js';

interface LogoProps {
  height?: number;
  onClick?: () => void;
  style?: React.CSSProperties;
}

/**
 * Logo component - renders theme-aware logotype from branding assets.
 */
export function Logo({ height = 32, onClick, style }: LogoProps) {
  const { theme } = useTheme();
  const src = getBrandingForTheme(theme).logotype;

  return (
    <img
      src={src}
      alt="ECHOS"
      height={height}
      style={{
        width: 'auto',
        objectFit: 'contain',
        display: 'block',
        cursor: onClick ? 'pointer' : undefined,
        ...style,
      }}
      onClick={onClick}
      draggable={false}
    />
  );
}

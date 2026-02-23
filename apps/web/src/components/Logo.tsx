import React from 'react';

interface LogoProps {
  height?: number;
  onClick?: () => void;
  style?: React.CSSProperties;
}

/**
 * Logo component - renders logotype.png from public/.
 * Uses <img> with explicit dimensions for zero CLS.
 */
export function Logo({ height = 32, onClick, style }: LogoProps) {
  const src = `${import.meta.env.BASE_URL}logotype.png`;

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

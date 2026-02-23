import React, { useState } from 'react';
import { colors, radius, transitions, fonts } from '../tokens.js';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps {
  children: React.ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  loading?: boolean;
  onClick?: () => void;
  type?: 'button' | 'submit';
  style?: React.CSSProperties;
  className?: string;
}

const variantStyles: Record<ButtonVariant, { base: React.CSSProperties; hover: React.CSSProperties }> = {
  primary: {
    base: { background: colors.accent, color: colors.onAccent, border: 'none' },
    hover: { background: colors.accentHover },
  },
  secondary: {
    base: { background: 'transparent', color: colors.text1, border: `1px solid ${colors.border}` },
    hover: { background: colors.surface, borderColor: colors.borderHover },
  },
  ghost: {
    base: { background: 'transparent', color: colors.text2, border: '1px solid transparent' },
    hover: { background: colors.surface, color: colors.text1 },
  },
  danger: {
    base: { background: 'transparent', color: colors.error, border: `1px solid ${colors.error}` },
    hover: { background: 'rgba(248, 113, 113, 0.1)' },
  },
};

const sizeStyles: Record<ButtonSize, React.CSSProperties> = {
  sm: { padding: '6px 14px', fontSize: '13px' },
  md: { padding: '10px 20px', fontSize: '14px' },
  lg: { padding: '12px 28px', fontSize: '15px' },
};

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  disabled = false,
  loading = false,
  onClick,
  type = 'button',
  style,
  className = '',
}: ButtonProps) {
  const [hovered, setHovered] = useState(false);
  const vs = variantStyles[variant];

  const baseStyle: React.CSSProperties = {
    ...vs.base,
    ...(hovered && !disabled ? vs.hover : {}),
    ...sizeStyles[size],
    borderRadius: radius.full,
    fontFamily: fonts.body,
    fontWeight: 500,
    cursor: disabled || loading ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.4 : 1,
    transition: `all ${transitions.fast}`,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    letterSpacing: '-0.01em',
    ...style,
  };

  return (
    <button
      type={type}
      className={className}
      style={baseStyle}
      disabled={disabled || loading}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {loading && (
        <span
          style={{
            width: '14px',
            height: '14px',
            border: `2px solid ${colors.text3}`,
            borderTopColor: 'transparent',
            borderRadius: '50%',
            animation: 'echos-spin 0.8s linear infinite',
            display: 'inline-block',
          }}
        />
      )}
      {children}
    </button>
  );
}

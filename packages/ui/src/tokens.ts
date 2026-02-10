/**
 * ECHOS Design Tokens — Marketplace-inspired, 3-color system
 */

export const colors = {
  // Brand triad
  black: '#111111',
  white: '#F2F2F2',
  accent: '#4221CE',
  accentHover: '#5835E4',
  accentMuted: 'rgba(66, 33, 206, 0.15)',

  // Surfaces
  surface: '#1A1A1E',
  surfaceHover: '#222228',
  surfaceRaised: '#252530',

  // Borders
  border: 'rgba(255, 255, 255, 0.08)',
  borderHover: 'rgba(255, 255, 255, 0.15)',
  borderActive: 'rgba(255, 255, 255, 0.25)',

  // Text
  text1: '#F2F2F2',
  text2: 'rgba(242, 242, 242, 0.55)',
  text3: 'rgba(242, 242, 242, 0.3)',

  // Functional
  success: '#34D399',
  warning: '#FBBF24',
  error: '#F87171',

  // Legacy aliases (backward compat)
  primary: '#4221CE',
  primaryLight: '#5835E4',
  primaryDark: '#3318A8',
  blackLight: '#1A1A1E',
  blackLighter: '#252530',
  whiteDim: 'rgba(242, 242, 242, 0.55)',
  whiteMuted: 'rgba(242, 242, 242, 0.3)',
  glass: '#1A1A1E',
  glassBorder: 'rgba(255, 255, 255, 0.08)',
  glassHover: '#222228',
} as const;

export const spacing = {
  xs: '4px',
  sm: '8px',
  md: '16px',
  lg: '24px',
  xl: '32px',
  xxl: '48px',
} as const;

export const radius = {
  sm: '8px',
  md: '12px',
  lg: '16px',
  xl: '20px',
  full: '9999px',
} as const;

export const fonts = {
  display: "'halyard-display-variable', sans-serif",
  body: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  mono: "'JetBrains Mono', 'Fira Code', monospace",
} as const;

export const shadows = {
  sm: '0 1px 2px rgba(0, 0, 0, 0.3)',
  md: '0 4px 12px rgba(0, 0, 0, 0.4)',
  lg: '0 8px 24px rgba(0, 0, 0, 0.5)',
  glow: '0 0 20px rgba(66, 33, 206, 0.25)',
} as const;

export const transitions = {
  fast: '150ms ease',
  normal: '200ms ease',
  slow: '350ms ease',
} as const;

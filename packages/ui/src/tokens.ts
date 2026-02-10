/**
 * ECHOS Design Tokens - Marketplace-inspired, 3-color system
 */

export const colors = {
  // Brand triad — CSS variables for theme reactivity
  black: 'var(--c-black)',
  white: 'var(--c-white)',
  accent: 'var(--c-accent)',
  accentHover: 'var(--c-accent-hover)',
  accentMuted: 'var(--c-accent-muted)',

  // Surfaces
  surface: 'var(--c-surface)',
  surfaceHover: 'var(--c-surface-hover)',
  surfaceRaised: 'var(--c-surface-raised)',

  // Borders
  border: 'var(--c-border)',
  borderHover: 'var(--c-border-hover)',
  borderActive: 'var(--c-border-active)',

  // Text
  text1: 'var(--c-text-1)',
  text2: 'var(--c-text-2)',
  text3: 'var(--c-text-3)',

  // Functional
  success: 'var(--c-success)',
  warning: 'var(--c-warning)',
  error: 'var(--c-error)',

  // Legacy aliases (backward compat)
  primary: 'var(--c-accent)',
  primaryLight: 'var(--c-accent-hover)',
  primaryDark: '#3318A8',
  blackLight: 'var(--c-surface)',
  blackLighter: 'var(--c-surface-raised)',
  whiteDim: 'var(--c-text-2)',
  whiteMuted: 'var(--c-text-3)',
  glass: 'var(--c-surface)',
  glassBorder: 'var(--c-border)',
  glassHover: 'var(--c-surface-hover)',
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

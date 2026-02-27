/**
 * ECOS V2 — Transfer Function & Chromatic Modes
 *
 * Generates 1D color lookup textures (256 RGBA entries)
 * for ray marching volume rendering.
 *
 * Palette is applied AFTER volumetric accumulation.
 */

import type { ChromaticMode } from '@echos/core';

export interface ColorStop {
  pos: number; // 0–1
  r: number;   // 0–255
  g: number;
  b: number;
  a: number;   // 0–255
}

// ─── Chromatic mode definitions ─────────────────────────────────────────────

const PALETTES: Record<ChromaticMode, ColorStop[]> = {
  'sonar-original': [
    { pos: 0.0, r: 0, g: 0, b: 40, a: 0 },
    { pos: 0.1, r: 0, g: 20, b: 80, a: 20 },
    { pos: 0.25, r: 0, g: 60, b: 160, a: 80 },
    { pos: 0.4, r: 0, g: 120, b: 200, a: 140 },
    { pos: 0.5, r: 40, g: 180, b: 200, a: 180 },
    { pos: 0.65, r: 120, g: 220, b: 120, a: 200 },
    { pos: 0.8, r: 220, g: 220, b: 40, a: 230 },
    { pos: 0.9, r: 255, g: 140, b: 0, a: 245 },
    { pos: 1.0, r: 255, g: 40, b: 0, a: 255 },
  ],
  'water-off': [
    { pos: 0.0, r: 0, g: 0, b: 0, a: 0 },
    { pos: 0.15, r: 0, g: 0, b: 0, a: 0 },
    { pos: 0.3, r: 10, g: 20, b: 60, a: 20 },
    { pos: 0.5, r: 66, g: 33, b: 206, a: 120 },
    { pos: 0.7, r: 140, g: 100, b: 255, a: 200 },
    { pos: 1.0, r: 225, g: 224, b: 235, a: 255 },
  ],
  'high-contrast': [
    { pos: 0.0, r: 0, g: 0, b: 0, a: 0 },
    { pos: 0.05, r: 0, g: 0, b: 0, a: 0 },
    { pos: 0.1, r: 30, g: 0, b: 60, a: 60 },
    { pos: 0.3, r: 100, g: 30, b: 206, a: 150 },
    { pos: 0.5, r: 200, g: 100, b: 255, a: 220 },
    { pos: 0.7, r: 255, g: 200, b: 100, a: 245 },
    { pos: 1.0, r: 255, g: 255, b: 255, a: 255 },
  ],
  'grayscale': [
    { pos: 0.0, r: 0, g: 0, b: 0, a: 0 },
    { pos: 0.1, r: 30, g: 30, b: 30, a: 30 },
    { pos: 0.5, r: 128, g: 128, b: 128, a: 160 },
    { pos: 0.8, r: 210, g: 210, b: 210, a: 220 },
    { pos: 1.0, r: 255, g: 255, b: 255, a: 255 },
  ],
};

// ─── LUT generation ─────────────────────────────────────────────────────────

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Generate a 256-entry RGBA LUT (Uint8Array of 256×4 = 1024 bytes).
 */
export function generateLUT(mode: ChromaticMode): Uint8Array {
  const stops = PALETTES[mode];
  const lut = new Uint8Array(256 * 4);

  for (let i = 0; i < 256; i++) {
    const pos = i / 255;

    // Find surrounding stops
    let lo = 0;
    let hi = stops.length - 1;
    for (let s = 0; s < stops.length - 1; s++) {
      if (stops[s].pos <= pos && stops[s + 1].pos >= pos) {
        lo = s;
        hi = s + 1;
        break;
      }
    }

    const s0 = stops[lo];
    const s1 = stops[hi];
    const range = s1.pos - s0.pos;
    const t = range > 0 ? (pos - s0.pos) / range : 0;

    lut[i * 4 + 0] = Math.round(lerp(s0.r, s1.r, t));
    lut[i * 4 + 1] = Math.round(lerp(s0.g, s1.g, t));
    lut[i * 4 + 2] = Math.round(lerp(s0.b, s1.b, t));
    lut[i * 4 + 3] = Math.round(lerp(s0.a, s1.a, t));
  }

  return lut;
}

/**
 * Get all available chromatic modes.
 */
export function getChromaticModes(): ChromaticMode[] {
  return Object.keys(PALETTES) as ChromaticMode[];
}

/**
 * Human-readable labels for chromatic modes.
 */
export const CHROMATIC_LABELS: Record<ChromaticMode, { en: string; fr: string }> = {
  'sonar-original': { en: 'Sonar Original', fr: 'Sonar Original' },
  'water-off': { en: 'Water Off', fr: 'Water Off' },
  'high-contrast': { en: 'High Contrast', fr: 'Haut contraste' },
  'grayscale': { en: 'Grayscale', fr: 'Niveaux de gris' },
};

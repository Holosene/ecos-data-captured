/**
 * ECHOS — Centralized branding assets
 *
 * Single source of truth for all logo / favicon / title references.
 * All paths are relative to the public root via import.meta.env.BASE_URL.
 */

const base = () => import.meta.env.BASE_URL;

export const BRANDING = {
  logo: {
    dark: () => `${base()}assets/branding/logo-dark.svg`,
    light: () => `${base()}assets/branding/logo-light.svg`,
  },
  logotype: {
    dark: () => `${base()}assets/branding/logotype-dark.svg`,
    light: () => `${base()}assets/branding/logotype-light.svg`,
  },
  favicon: {
    dark: () => `${base()}assets/branding/favicon-dark.svg`,
    light: () => `${base()}assets/branding/favicon-light.svg`,
  },
  texteTitle: {
    dark: () => `${base()}assets/branding/texte-titre-dark.svg`,
    light: () => `${base()}assets/branding/texte-titre-light.svg`,
  },
} as const;

/** Returns the correct asset variant for the current theme */
export function getBrandingForTheme(theme: 'dark' | 'light') {
  return {
    logotype: theme === 'dark' ? BRANDING.logotype.dark() : BRANDING.logotype.light(),
    favicon: theme === 'dark' ? BRANDING.favicon.dark() : BRANDING.favicon.light(),
    logo: theme === 'dark' ? BRANDING.logo.dark() : BRANDING.logo.light(),
    texteTitle: theme === 'dark' ? BRANDING.texteTitle.dark() : BRANDING.texteTitle.light(),
  };
}

import React, { createContext, useContext, useState, useCallback } from 'react';
import { translations, type Lang, type TranslationKey } from './translations.js';

interface I18nContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: TranslationKey) => string;
  tArray: (key: TranslationKey) => string[];
}

const I18nContext = createContext<I18nContextValue>({
  lang: 'fr',
  setLang: () => {},
  t: (key) => key,
  tArray: () => [],
});

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('echos-lang');
      if (saved === 'en' || saved === 'fr') return saved;
    }
    return 'fr';
  });

  const setLang = useCallback((newLang: Lang) => {
    setLangState(newLang);
    localStorage.setItem('echos-lang', newLang);
    document.documentElement.lang = newLang;
  }, []);

  const t = useCallback(
    (key: TranslationKey): string => {
      const val = (translations[lang] as Record<string, unknown>)[key];
      if (typeof val === 'string') return val;
      return key;
    },
    [lang],
  );

  const tArray = useCallback(
    (key: TranslationKey): string[] => {
      const val = (translations[lang] as Record<string, unknown>)[key];
      if (Array.isArray(val)) return val as string[];
      return [];
    },
    [lang],
  );

  return (
    <I18nContext.Provider value={{ lang, setLang, t, tArray }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useTranslation() {
  return useContext(I18nContext);
}

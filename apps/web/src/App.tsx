import React, { useReducer } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { colors } from '@echos/ui';
import { useTranslation } from './i18n/index.js';
import { useTheme } from './theme/index.js';
import { IconGlobe, IconSun, IconMoon } from './components/Icons.js';
import { AppContext, appReducer, INITIAL_STATE } from './store/app-state.js';
import { HomePage } from './pages/HomePage.js';
import { WizardPage } from './pages/WizardPage.js';
import { ManifestoPage } from './pages/ManifestoPage.js';
import { DocsPage } from './pages/DocsPage.js';

function Topbar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { t, lang, setLang } = useTranslation();
  const { theme, toggleTheme } = useTheme();

  const navItems = [
    { label: t('nav.scan'), path: '/scan' },
    { label: t('nav.manifesto'), path: '/manifesto' },
    { label: t('nav.docs'), path: '/docs' },
  ];

  // Logo: dark.png en mode sombre, white.png en mode clair
  const darkLogoSrc = `${import.meta.env.BASE_URL}logotype-02-dark.png`;
  const lightLogoSrc = `${import.meta.env.BASE_URL}logotype-02-white.png`;
  const logoSrc = theme === 'dark' ? darkLogoSrc : lightLogoSrc;

  return (
    <header className="echos-topbar">
      {/* Logo */}
      <button
        onClick={() => navigate('/')}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          padding: 0,
          flexShrink: 0,
        }}
      >
        <img
          src={logoSrc}
          alt="echos"
          style={{ height: '28px', width: 'auto' }}
        />
      </button>

      {/* Nav - hidden on mobile */}
      <nav
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0',
          marginLeft: '40px',
        }}
        className="topbar-nav"
      >
        {navItems.map((item) => {
          const isActive = location.pathname === item.path;
          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              style={{
                position: 'relative',
                padding: '24px 18px',
                background: 'none',
                border: 'none',
                color: isActive ? 'var(--c-text-1)' : 'var(--c-text-2)',
                fontSize: '15px',
                fontWeight: isActive ? 500 : 400,
                cursor: 'pointer',
                fontFamily: 'inherit',
                transition: 'color 150ms ease',
              }}
            >
              {item.label}
              {isActive && (
                <span
                  style={{
                    position: 'absolute',
                    bottom: '0',
                    left: '18px',
                    right: '18px',
                    height: '2px',
                    background: 'var(--c-accent)',
                    borderRadius: '1px',
                  }}
                />
              )}
            </button>
          );
        })}
      </nav>

      <div style={{ flex: 1 }} />

      {/* Theme toggle */}
      <button
        onClick={toggleTheme}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '32px',
          height: '32px',
          borderRadius: '9999px',
          border: '1px solid var(--c-border)',
          background: 'transparent',
          color: 'var(--c-text-2)',
          cursor: 'pointer',
          transition: 'all 150ms ease',
          marginRight: '8px',
        }}
        title={theme === 'dark' ? 'Mode clair' : 'Mode sombre'}
      >
        {theme === 'dark' ? <IconSun size={14} /> : <IconMoon size={14} />}
      </button>

      {/* Language toggle */}
      <button
        onClick={() => setLang(lang === 'fr' ? 'en' : 'fr')}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: '6px 12px',
          borderRadius: '9999px',
          border: '1px solid var(--c-border)',
          background: 'transparent',
          color: 'var(--c-text-2)',
          fontSize: '13px',
          fontWeight: 500,
          cursor: 'pointer',
          fontFamily: 'inherit',
          transition: 'all 150ms ease',
          marginRight: '12px',
        }}
        title={lang === 'fr' ? 'Switch to English' : 'Passer en français'}
      >
        <IconGlobe size={14} />
        {lang === 'fr' ? 'EN' : 'FR'}
      </button>

      {/* CTA */}
      {!location.pathname.startsWith('/scan') && (
        <button
          onClick={() => navigate('/scan')}
          style={{
            padding: '10px 24px',
            borderRadius: '9999px',
            border: 'none',
            background: colors.accent,
            color: '#FFFFFF',
            fontSize: '14px',
            fontWeight: 500,
            cursor: 'pointer',
            fontFamily: 'inherit',
            transition: 'background 150ms ease',
          }}
          onMouseEnter={(e) => { (e.target as HTMLElement).style.background = colors.accentHover; }}
          onMouseLeave={(e) => { (e.target as HTMLElement).style.background = colors.accent; }}
        >
          {t('nav.newScan')}
        </button>
      )}
    </header>
  );
}

export function App() {
  const [state, dispatch] = useReducer(appReducer, INITIAL_STATE);

  return (
    <AppContext.Provider value={{ state, dispatch }}>
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--c-black)', transition: 'background 350ms ease' }}>
        <Topbar />
        <main style={{ flex: 1 }}>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/scan" element={<WizardPage />} />
            <Route path="/manifesto" element={<ManifestoPage />} />
            <Route path="/docs" element={<DocsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </AppContext.Provider>
  );
}

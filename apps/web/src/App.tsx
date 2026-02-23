import React, { useReducer, useEffect, useState } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { colors } from '@echos/ui';
import { useTranslation } from './i18n/index.js';
import { useTheme } from './theme/index.js';
import { IconGlobe, IconSun, IconMoon } from './components/Icons.js';
import { AppContext, appReducer, INITIAL_STATE } from './store/app-state.js';
import { HomePage } from './pages/HomePage.js';
import { ScanPage } from './pages/ScanPage.js';
import { MapPage } from './pages/MapPage.js';
import { WizardPage } from './pages/WizardPage.js';
import { ManifestoPage } from './pages/ManifestoPage.js';
import { DocsPage } from './pages/DocsPage.js';

function Topbar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { t, lang, setLang } = useTranslation();
  const { theme, toggleTheme } = useTheme();
  const [docsInView, setDocsInView] = useState(false);

  // Scroll detection: highlight "Documentation" when docs section is visible on homepage
  useEffect(() => {
    if (location.pathname !== '/') {
      setDocsInView(false);
      return;
    }
    const el = document.getElementById('docs-section');
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setDocsInView(entry.isIntersecting),
      { threshold: 0.15 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [location.pathname]);

  // Nav items — Documentation first (desktop only, hidden on mobile anyway)
  const navItems = [
    { label: t('nav.scan'), path: '/scan' },
    { label: t('nav.map'), path: '/map' },
    { label: t('nav.docs'), path: '/docs', scrollTarget: 'docs-section' },
    { label: t('nav.manifesto'), path: '/manifesto' },
  ];

  const isNavActive = (item: typeof navItems[0]) => {
    if (item.path === '/docs') {
      return location.pathname === '/docs' || (location.pathname === '/' && docsInView);
    }
    return location.pathname === item.path;
  };

  const handleNavClick = (item: typeof navItems[0]) => {
    if (item.scrollTarget && location.pathname === '/') {
      // Smooth scroll to section on homepage
      const el = document.getElementById(item.scrollTarget);
      if (el) { el.scrollIntoView({ behavior: 'smooth' }); return; }
    }
    if (item.scrollTarget) {
      // Navigate to home then scroll
      navigate('/');
      setTimeout(() => {
        const el = document.getElementById(item.scrollTarget!);
        if (el) el.scrollIntoView({ behavior: 'smooth' });
      }, 100);
      return;
    }
    navigate(item.path);
  };

  // Logo: dark.png en mode sombre, white.png en mode clair
  const darkLogoSrc = `${import.meta.env.BASE_URL}logotype-02-dark.png`;
  const lightLogoSrc = `${import.meta.env.BASE_URL}logotype-02-white.png`;
  const logoSrc = theme === 'dark' ? darkLogoSrc : lightLogoSrc;

  return (
    <header className="echos-topbar">
      <div className="topbar-inner">
      {/* Logo */}
      <button
        onClick={() => {
          if (location.pathname === '/') {
            window.scrollTo({ top: 0, behavior: 'smooth' });
          } else {
            navigate('/');
          }
        }}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          padding: '0 16px 0 0',
          margin: 0,
          height: '100%',
          flexShrink: 0,
        }}
      >
        <img
          src={logoSrc}
          alt="echos"
          style={{ height: '28px', width: 'auto' }}
        />
      </button>

      {/* Nav — hidden on mobile via CSS */}
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
          const active = isNavActive(item);
          return (
            <button
              key={item.path}
              onClick={() => handleNavClick(item)}
              className="nav-item"
              style={{
                position: 'relative',
                padding: '24px 18px',
                background: 'none',
                border: 'none',
                color: active ? 'var(--c-text-1)' : 'var(--c-text-2)',
                fontSize: '15px',
                fontWeight: active ? 500 : 400,
                cursor: 'pointer',
                fontFamily: 'inherit',
                transition: 'color 150ms ease',
              }}
            >
              {item.label}
              {/* Active indicator — thicker, rounded, higher */}
              {active && (
                <span className="nav-indicator" />
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

      {/* CTA — hidden on mobile via CSS class */}
      {!location.pathname.startsWith('/scan') && (
        <button
          className="topbar-cta"
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
      </div>
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
            <Route path="/scan" element={<ScanPage />} />
            <Route path="/scan/classic" element={<WizardPage />} />
            <Route path="/map" element={<MapPage />} />
            <Route path="/manifesto" element={<ManifestoPage />} />
            <Route path="/docs" element={<DocsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </AppContext.Provider>
  );
}

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
  const [activeSection, setActiveSection] = useState<string | null>(null);

  // Multi-section scroll-spy for homepage sections
  useEffect(() => {
    if (location.pathname !== '/') {
      setActiveSection(null);
      return;
    }
    const sectionIds = ['docs-section', 'manifesto-section', 'map-section'];
    const observers: IntersectionObserver[] = [];

    for (const id of sectionIds) {
      const el = document.getElementById(id);
      if (!el) continue;
      const observer = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) {
            setActiveSection(id);
          } else {
            setActiveSection((prev) => (prev === id ? null : prev));
          }
        },
        { threshold: 0.15 },
      );
      observer.observe(el);
      observers.push(observer);
    }

    return () => observers.forEach((o) => o.disconnect());
  }, [location.pathname]);

  // Nav items: Scan is a route, others scroll on homepage
  const navItems = [
    { label: t('nav.scan'), path: '/scan' },
    { label: t('nav.map'), path: '/map', scrollTarget: 'map-section' },
    { label: t('nav.docs'), path: '/docs', scrollTarget: 'docs-section' },
    { label: t('nav.manifesto'), path: '/manifesto', scrollTarget: 'manifesto-section' },
  ];

  const isNavActive = (item: typeof navItems[0]) => {
    if (location.pathname === '/' && item.scrollTarget) {
      return activeSection === item.scrollTarget;
    }
    if (item.path === '/docs') return location.pathname === '/docs';
    if (item.path === '/manifesto') return location.pathname === '/manifesto';
    if (item.path === '/map') return location.pathname === '/map';
    return location.pathname === item.path;
  };

  const handleNavClick = (item: typeof navItems[0]) => {
    if (item.scrollTarget && location.pathname === '/') {
      const el = document.getElementById(item.scrollTarget);
      if (el) { el.scrollIntoView({ behavior: 'smooth' }); return; }
    }
    if (item.scrollTarget) {
      navigate('/');
      setTimeout(() => {
        const el = document.getElementById(item.scrollTarget!);
        if (el) el.scrollIntoView({ behavior: 'smooth' });
      }, 150);
      return;
    }
    navigate(item.path);
  };

  const darkLogoSrc = `${import.meta.env.BASE_URL}logotype-02-dark.png`;
  const lightLogoSrc = `${import.meta.env.BASE_URL}logotype-02-white.png`;
  const logoSrc = theme === 'dark' ? darkLogoSrc : lightLogoSrc;

  return (
    <header className="echos-topbar">
      <div className="topbar-inner">
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
        <img src={logoSrc} alt="echos" style={{ height: '28px', width: 'auto' }} />
      </button>

      <nav style={{ display: 'flex', alignItems: 'center', gap: '0', marginLeft: '40px' }} className="topbar-nav">
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
              {active && <span className="nav-indicator" />}
            </button>
          );
        })}
      </nav>

      <div style={{ flex: 1 }} />

      <button
        onClick={toggleTheme}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: '32px', height: '32px', borderRadius: '9999px',
          border: '1px solid var(--c-border)', background: 'transparent',
          color: 'var(--c-text-2)', cursor: 'pointer', transition: 'all 150ms ease',
          marginRight: '8px',
        }}
        title={theme === 'dark' ? 'Mode clair' : 'Mode sombre'}
      >
        {theme === 'dark' ? <IconSun size={14} /> : <IconMoon size={14} />}
      </button>

      <button
        onClick={() => setLang(lang === 'fr' ? 'en' : 'fr')}
        style={{
          display: 'flex', alignItems: 'center', gap: '6px',
          padding: '6px 12px', borderRadius: '9999px',
          border: '1px solid var(--c-border)', background: 'transparent',
          color: 'var(--c-text-2)', fontSize: '13px', fontWeight: 500,
          cursor: 'pointer', fontFamily: 'inherit', transition: 'all 150ms ease',
          marginRight: '12px',
        }}
        title={lang === 'fr' ? 'Switch to English' : 'Passer en français'}
      >
        <IconGlobe size={14} />
        {lang === 'fr' ? 'EN' : 'FR'}
      </button>

      {!location.pathname.startsWith('/scan') && (
        <button
          className="topbar-cta"
          onClick={() => navigate('/scan')}
          style={{
            padding: '10px 24px', borderRadius: '9999px', border: 'none',
            background: colors.accent, color: '#FFFFFF', fontSize: '14px',
            fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
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

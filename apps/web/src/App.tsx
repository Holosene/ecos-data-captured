import React, { useReducer, useEffect, useState } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { colors } from '@echos/ui';
import { useTranslation } from './i18n/index.js';
import { useTheme } from './theme/index.js';
import { IconGlobe, IconSun, IconMoon } from './components/Icons.js';
import { AppContext, appReducer, INITIAL_STATE } from './store/app-state.js';
import { getBrandingForTheme } from './branding.js';
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

  // Dynamic favicon based on theme
  useEffect(() => {
    const faviconEl = document.querySelector('link[rel="icon"]') as HTMLLinkElement | null;
    if (faviconEl) {
      faviconEl.href = getBrandingForTheme(theme as 'dark' | 'light').favicon;
    }
  }, [theme]);

  // Multi-section scroll-spy for homepage sections
  useEffect(() => {
    if (location.pathname !== '/') {
      setActiveSection(null);
      return;
    }
    const sectionIds = ['map-section', 'docs-section', 'manifesto-section'];
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

  // Nav items in order: Accueil, Carte, Documentation, Manifeste, Scanner
  // All except Scanner are scroll sections on homepage
  const navItems = [
    { label: t('nav.home'), path: '/' },
    { label: t('nav.map'), path: '/map', scrollTarget: 'map-section' },
    { label: t('nav.docs'), path: '/docs', scrollTarget: 'docs-section' },
    { label: t('nav.manifesto'), path: '/manifesto', scrollTarget: 'manifesto-section' },
    { label: t('nav.scan'), path: '/scan' },
  ];

  const isNavActive = (item: typeof navItems[0]) => {
    // Home link: active when on / and no section is in view
    if (item.path === '/') {
      return location.pathname === '/' && !activeSection;
    }
    if (location.pathname === '/' && item.scrollTarget) {
      return activeSection === item.scrollTarget;
    }
    return location.pathname === item.path;
  };

  const handleNavClick = (item: typeof navItems[0]) => {
    // Home: scroll to top or navigate to /
    if (item.path === '/') {
      if (location.pathname === '/') {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        navigate('/');
      }
      return;
    }
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

  // Theme-aware branding
  const branding = getBrandingForTheme(theme as 'dark' | 'light');
  const logoSrc = branding.logotype;

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
                padding: '24px 20px',
                background: 'none',
                border: 'none',
                color: active ? 'var(--c-text-1)' : 'rgba(255, 255, 255, 0.75)',
                fontSize: '16px',
                fontWeight: active ? 600 : 450,
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
          width: '36px', height: '36px', borderRadius: '9999px',
          border: '1px solid var(--c-border)', background: 'transparent',
          color: 'rgba(255, 255, 255, 0.85)', cursor: 'pointer', transition: 'all 150ms ease',
          marginRight: '8px',
        }}
        title={theme === 'dark' ? 'Mode clair' : 'Mode sombre'}
      >
        {theme === 'dark' ? <IconSun size={17} /> : <IconMoon size={17} />}
      </button>

      <button
        onClick={() => setLang(lang === 'fr' ? 'en' : 'fr')}
        style={{
          display: 'flex', alignItems: 'center', gap: '6px',
          padding: '7px 14px', borderRadius: '9999px',
          border: '1px solid var(--c-border)', background: 'transparent',
          color: 'rgba(255, 255, 255, 0.85)', fontSize: '14px', fontWeight: 500,
          cursor: 'pointer', fontFamily: 'inherit', transition: 'all 150ms ease',
          marginRight: '12px',
        }}
        title={lang === 'fr' ? 'Switch to English' : 'Passer en français'}
      >
        <IconGlobe size={16} />
        {lang === 'fr' ? 'EN' : 'FR'}
      </button>

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

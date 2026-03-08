import React, { useReducer, useEffect, useState, useCallback, lazy, Suspense } from 'react';
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
import { ManifestoPage } from './pages/ManifestoPage.js';
import { DocsPage } from './pages/DocsPage.js';
import {
  fetchSessionManifest,
  fetchSessionGpxTrack,
  manifestEntryToSession,
  parseGpx,
} from '@echos/core';

const SessionViewerPage = lazy(() => import('./pages/SessionViewerPage.js'));

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
    const mainContent = document.getElementById('main-content');
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
        { threshold: 0.15, root: mainContent },
      );
      observer.observe(el);
      observers.push(observer);
    }

    return () => observers.forEach((o) => o.disconnect());
  }, [location.pathname]);

  const navItems = [
    { label: t('nav.home'), path: '/' },
    { label: t('nav.map'), path: '/map', scrollTarget: 'map-section' },
    { label: t('nav.docs'), path: '/docs', scrollTarget: 'docs-section' },
    { label: t('nav.manifesto'), path: '/manifesto', scrollTarget: 'manifesto-section' },
    { label: t('nav.scan'), path: '/scan' },
  ];

  const isNavActive = (item: typeof navItems[0]) => {
    if (item.path === '/') {
      return location.pathname === '/' && !activeSection;
    }
    if (location.pathname === '/' && item.scrollTarget) {
      return activeSection === item.scrollTarget;
    }
    return location.pathname === item.path;
  };

  const handleNavClick = useCallback((item: typeof navItems[0]) => {
    if (item.path === '/') {
      if (location.pathname === '/') {
        (document.getElementById('main-content') ?? window).scrollTo({ top: 0, behavior: 'smooth' });
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
  }, [location.pathname, navigate]);

  // Theme-aware branding
  const branding = getBrandingForTheme(theme as 'dark' | 'light');
  const logoSrc = branding.logotype;

  return (
      <header className="echos-topbar">
        <div className="topbar-inner">
        <a
          href={import.meta.env.BASE_URL || '/ecos-data-captured/'}
          onClick={(e) => {
            e.preventDefault();
            if (location.pathname === '/') {
              (document.getElementById('main-content') ?? window).scrollTo({ top: 0, behavior: 'smooth' });
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
            textDecoration: 'none',
          }}
        >
          <img src={logoSrc} alt="echos" style={{ height: '28px', width: 'auto', pointerEvents: 'none' }} />
        </a>

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
                  padding: '20px 16px',
                  background: 'none',
                  border: 'none',
                  color: active ? 'var(--c-text-1)' : 'var(--c-text-2)',
                  fontSize: '13px',
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
            width: '30px', height: '30px', borderRadius: '9999px',
            border: '1px solid var(--c-border)', background: 'transparent',
            color: 'var(--c-text-2)', cursor: 'pointer', transition: 'all 150ms ease',
            marginRight: '6px',
          }}
          title={theme === 'dark' ? 'Mode clair' : 'Mode sombre'}
        >
          {theme === 'dark' ? <IconSun size={14} /> : <IconMoon size={14} />}
        </button>

        <button
          onClick={() => setLang(lang === 'fr' ? 'en' : 'fr')}
          style={{
            display: 'flex', alignItems: 'center', gap: '4px',
            padding: '5px 11px', borderRadius: '9999px',
            border: '1px solid var(--c-border)', background: 'transparent',
            color: 'var(--c-text-2)', fontSize: '12px', fontWeight: 500,
            cursor: 'pointer', fontFamily: 'inherit', transition: 'all 150ms ease',
            marginRight: '8px',
          }}
          title={lang === 'fr' ? 'Switch to English' : 'Passer en français'}
        >
          <IconGlobe size={13} />
          {lang === 'fr' ? 'EN' : 'FR'}
        </button>

        </div>
      </header>
  );
}

export function App() {
  const [state, dispatch] = useReducer(appReducer, INITIAL_STATE);

  // Load pre-generated sessions manifest at boot
  useEffect(() => {
    const basePath = import.meta.env.BASE_URL ?? '/ecos-data-captured/';
    fetchSessionManifest(basePath)
      .then(async (entries) => {
        const sessions = entries.map(manifestEntryToSession);
        const gpxTracks = new Map<string, Array<{ lat: number; lon: number }>>();

        // Fetch all GPX tracks in parallel (lightweight, few KB each)
        await Promise.allSettled(
          entries.map(async (entry) => {
            try {
              const track = await fetchSessionGpxTrack(
                basePath,
                entry.id,
                entry.files.gpx,
                parseGpx,
              );
              gpxTracks.set(entry.id, track);
            } catch {
              // GPX fetch failed — session still shows on map via bounds
            }
          }),
        );

        dispatch({ type: 'LOAD_MANIFEST', entries, sessions, gpxTracks });
      })
      .catch(() => {
        // Manifest not found — app works normally without pre-generated sessions
      });
  }, []);

  return (
    <AppContext.Provider value={{ state, dispatch }}>
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--c-black)', transition: 'background 350ms ease', overflow: 'hidden' }}>
        <Topbar />
        <main id="main-content" style={{ flex: 1, overflowY: 'auto' }}>
          <Suspense fallback={<div style={{ color: colors.text3, padding: '48px', textAlign: 'center' }}>Chargement...</div>}>
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/scan" element={<ScanPage />} />
              <Route path="/map" element={<MapPage />} />
              <Route path="/session/:sessionId" element={<SessionViewerPage />} />
              <Route path="/manifesto" element={<ManifestoPage />} />
              <Route path="/docs" element={<DocsPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </main>
      </div>
    </AppContext.Provider>
  );
}

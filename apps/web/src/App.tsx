import React, { useReducer, useEffect, useState, useCallback } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { colors } from '@echos/ui';
import { useTranslation } from './i18n/index.js';
import { useTheme } from './theme/index.js';
import { IconGlobe, IconSun, IconMoon, IconMenu, IconX } from './components/Icons.js';
import { AppContext, appReducer, INITIAL_STATE } from './store/app-state.js';
import { getBrandingForTheme } from './branding.js';
import { HomePage } from './pages/HomePage.js';
import { ScanPage } from './pages/ScanPage.js';
import { MapPage } from './pages/MapPage.js';
import { ManifestoPage } from './pages/ManifestoPage.js';
import { DocsPage } from './pages/DocsPage.js';

function Topbar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { t, lang, setLang } = useTranslation();
  const { theme, toggleTheme } = useTheme();
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Close mobile menu on route change
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  // Prevent body scroll when mobile menu is open
  useEffect(() => {
    if (mobileMenuOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [mobileMenuOpen]);

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
    setMobileMenuOpen(false);
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
    <>
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
                  padding: '24px 20px',
                  background: 'none',
                  border: 'none',
                  color: active ? 'var(--c-text-1)' : 'var(--c-text-2)',
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

        {/* Desktop action buttons */}
        <div className="topbar-actions">
          <button
            onClick={toggleTheme}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: '36px', height: '36px', borderRadius: '9999px',
              border: '1px solid var(--c-border)', background: 'transparent',
              color: 'var(--c-text-2)', cursor: 'pointer', transition: 'all 150ms ease',
              marginRight: '8px',
            }}
            title={theme === 'dark' ? t('common.themeLight') : t('common.themeDark')}
          >
            {theme === 'dark' ? <IconSun size={17} /> : <IconMoon size={17} />}
          </button>

          <button
            onClick={() => setLang(lang === 'fr' ? 'en' : 'fr')}
            style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              padding: '7px 14px', borderRadius: '9999px',
              border: '1px solid var(--c-border)', background: 'transparent',
              color: 'var(--c-text-2)', fontSize: '14px', fontWeight: 500,
              cursor: 'pointer', fontFamily: 'inherit', transition: 'all 150ms ease',
              marginRight: '12px',
            }}
            title={lang === 'fr' ? 'Switch to English' : 'Passer en français'}
          >
            <IconGlobe size={16} />
            {lang === 'fr' ? 'EN' : 'FR'}
          </button>
        </div>

        {/* Mobile hamburger button */}
        <button
          className="mobile-menu-btn"
          onClick={() => setMobileMenuOpen(true)}
          aria-label="Menu"
        >
          <IconMenu size={20} />
        </button>

        </div>
      </header>

      {/* Mobile nav drawer + backdrop */}
      <div
        className={`mobile-nav-backdrop${mobileMenuOpen ? ' open' : ''}`}
        onClick={() => setMobileMenuOpen(false)}
      />
      <div className={`mobile-nav-drawer${mobileMenuOpen ? ' open' : ''}`}>
        <div className="mobile-nav-header">
          <img src={logoSrc} alt="echos" style={{ height: '22px', width: 'auto' }} />
          <button
            onClick={() => setMobileMenuOpen(false)}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: '36px', height: '36px', borderRadius: '9999px',
              border: '1px solid var(--c-border)', background: 'transparent',
              color: 'var(--c-text-2)', cursor: 'pointer',
            }}
            aria-label="Close"
          >
            <IconX size={18} />
          </button>
        </div>

        {navItems.map((item) => (
          <button
            key={item.path}
            className={`mobile-nav-link${isNavActive(item) ? ' active' : ''}`}
            onClick={() => handleNavClick(item)}
          >
            {item.label}
          </button>
        ))}

        <div className="mobile-nav-footer">
          <button
            onClick={toggleTheme}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: '40px', height: '40px', borderRadius: '9999px',
              border: '1px solid var(--c-border)', background: 'transparent',
              color: 'var(--c-text-2)', cursor: 'pointer',
            }}
          >
            {theme === 'dark' ? <IconSun size={18} /> : <IconMoon size={18} />}
          </button>
          <button
            onClick={() => setLang(lang === 'fr' ? 'en' : 'fr')}
            style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              padding: '8px 16px', borderRadius: '9999px',
              border: '1px solid var(--c-border)', background: 'transparent',
              color: 'var(--c-text-2)', fontSize: '14px', fontWeight: 500,
              cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            <IconGlobe size={16} />
            {lang === 'fr' ? 'EN' : 'FR'}
          </button>
        </div>
      </div>
    </>
  );
}

export function App() {
  const [state, dispatch] = useReducer(appReducer, INITIAL_STATE);

  return (
    <AppContext.Provider value={{ state, dispatch }}>
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--c-black)', transition: 'background 350ms ease', overflow: 'hidden' }}>
        <Topbar />
        <main id="main-content" style={{ flex: 1, overflowY: 'auto' }}>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/scan" element={<ScanPage />} />
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

import React, { useReducer, useState, useEffect } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { colors, fonts } from '@echos/ui';
import { useTranslation } from './i18n/index.js';
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
  const [docsInView, setDocsInView] = useState(false);
  const [hoveredTab, setHoveredTab] = useState<string | null>(null);
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('echos-theme') as 'dark' | 'light') || 'dark';
    }
    return 'dark';
  });

  // Theme effect
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('echos-theme', theme);
  }, [theme]);

  // IntersectionObserver for docs section on home page
  useEffect(() => {
    if (location.pathname !== '/') {
      setDocsInView(false);
      return;
    }

    let observer: IntersectionObserver | null = null;
    let timeoutId: ReturnType<typeof setTimeout>;

    const setup = () => {
      const el = document.getElementById('docs-section');
      if (!el) {
        timeoutId = setTimeout(setup, 200);
        return;
      }
      observer = new IntersectionObserver(
        ([entry]) => setDocsInView(entry.isIntersecting),
        { threshold: 0.1 },
      );
      observer.observe(el);
    };

    setup();

    return () => {
      clearTimeout(timeoutId);
      observer?.disconnect();
    };
  }, [location.pathname]);

  const navItems = [
    { label: t('nav.docs'), key: 'docs', isDocsScroll: true },
    { label: t('nav.manifesto'), key: 'manifesto', path: '/manifesto' },
    { label: t('nav.scan'), key: 'scan', path: '/scan' },
  ];

  const handleNavClick = (item: (typeof navItems)[0]) => {
    if (item.isDocsScroll) {
      if (location.pathname === '/') {
        document.getElementById('docs-section')?.scrollIntoView({ behavior: 'smooth' });
      } else {
        navigate('/');
        setTimeout(() => {
          document.getElementById('docs-section')?.scrollIntoView({ behavior: 'smooth' });
        }, 150);
      }
    } else if (item.path) {
      navigate(item.path);
    }
  };

  const isTabActive = (item: (typeof navItems)[0]) => {
    if (item.isDocsScroll) return docsInView;
    return item.path ? location.pathname === item.path : false;
  };

  return (
    <header
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 50,
        height: '72px',
        display: 'flex',
        alignItems: 'center',
        padding: '0 clamp(16px, 4vw, 40px)',
        background: 'rgba(17, 17, 17, 0.88)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        borderBottom: `1px solid ${colors.border}`,
      }}
      className="topbar"
    >
      {/* Logo */}
      <button
        onClick={() => {
          navigate('/');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
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
          src={`${import.meta.env.BASE_URL}logotype-02-dark.svg`}
          alt="échos"
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
          const active = isTabActive(item);
          const hovered = hoveredTab === item.key;
          return (
            <button
              key={item.key}
              onClick={() => handleNavClick(item)}
              onMouseEnter={() => setHoveredTab(item.key)}
              onMouseLeave={() => setHoveredTab(null)}
              className="topbar-tab"
              style={{
                position: 'relative',
                padding: '24px 18px',
                background: 'none',
                border: 'none',
                color: active ? colors.text1 : colors.text2,
                fontSize: '15px',
                fontWeight: active ? 500 : 400,
                cursor: 'pointer',
                fontFamily: 'inherit',
                transition: 'color 150ms ease',
              }}
            >
              {item.label}
              {/* Active indicator — thick, rounded, higher */}
              {active && (
                <span
                  className="tab-active-indicator"
                  style={{
                    position: 'absolute',
                    bottom: '10px',
                    left: '14px',
                    right: '14px',
                    height: '4px',
                    background: colors.accent,
                    borderRadius: '3px',
                  }}
                />
              )}
              {/* Hover wave indicator — CSS animated */}
              {hovered && !active && <span className="tab-wave-indicator" />}
            </button>
          );
        })}
      </nav>

      <div style={{ flex: 1 }} />

      {/* Language toggle */}
      <button
        onClick={() => setLang(lang === 'fr' ? 'en' : 'fr')}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: '6px 12px',
          borderRadius: '9999px',
          border: `1px solid ${colors.border}`,
          background: 'transparent',
          color: colors.text2,
          fontSize: '13px',
          fontWeight: 500,
          cursor: 'pointer',
          fontFamily: 'inherit',
          transition: 'all 150ms ease',
          marginRight: '8px',
        }}
        title={lang === 'fr' ? 'Switch to English' : 'Passer en français'}
      >
        <IconGlobe size={14} />
        {lang === 'fr' ? 'EN' : 'FR'}
      </button>

      {/* Theme toggle */}
      <button
        onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        className="topbar-theme-toggle"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '36px',
          height: '36px',
          borderRadius: '9999px',
          border: `1px solid ${colors.border}`,
          background: 'transparent',
          color: colors.text2,
          cursor: 'pointer',
          transition: 'all 150ms ease',
          marginRight: '12px',
        }}
        title={theme === 'dark' ? 'Mode clair' : 'Mode sombre'}
      >
        {theme === 'dark' ? <IconSun size={16} /> : <IconMoon size={16} />}
      </button>

      {/* CTA — hidden on mobile via CSS */}
      {!location.pathname.startsWith('/scan') && (
        <button
          className="topbar-cta"
          onClick={() => navigate('/scan')}
          style={{
            padding: '10px 24px',
            borderRadius: '9999px',
            border: 'none',
            background: colors.accent,
            color: '#F2F2F2',
            fontSize: '14px',
            fontWeight: 500,
            cursor: 'pointer',
            fontFamily: 'inherit',
            transition: 'background 150ms ease',
          }}
          onMouseEnter={(e) => {
            (e.target as HTMLElement).style.background = colors.accentHover;
          }}
          onMouseLeave={(e) => {
            (e.target as HTMLElement).style.background = colors.accent;
          }}
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
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          background: colors.black,
        }}
      >
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

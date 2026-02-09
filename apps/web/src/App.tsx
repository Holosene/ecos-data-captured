import React, { useReducer } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { colors, fonts } from '@echos/ui';
import { AppContext, appReducer, INITIAL_STATE } from './store/app-state.js';
import { HomePage } from './pages/HomePage.js';
import { WizardPage } from './pages/WizardPage.js';
import { ManifestoPage } from './pages/ManifestoPage.js';
import { DocsPage } from './pages/DocsPage.js';

function Topbar() {
  const navigate = useNavigate();
  const location = useLocation();

  const navItems = [
    { label: 'Scan', path: '/scan' },
    { label: 'Manifesto', path: '/manifesto' },
    { label: 'Docs', path: '/docs' },
  ];

  return (
    <header
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 50,
        height: '64px',
        display: 'flex',
        alignItems: 'center',
        padding: '0 24px',
        background: 'rgba(17, 17, 17, 0.85)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        borderBottom: `1px solid ${colors.border}`,
      }}
    >
      {/* Logo */}
      <button
        onClick={() => navigate('/')}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          padding: 0,
        }}
      >
        <img
          src="/echos-donees-capturees/brand/logo-mark.png"
          alt=""
          style={{ height: '28px', width: 'auto' }}
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
        />
        <span
          style={{
            fontFamily: fonts.display,
            fontVariationSettings: "'wght' 500",
            fontSize: '22px',
            lineHeight: 0.85,
            color: colors.text1,
            letterSpacing: '-0.02em',
          }}
        >
          echos
        </span>
      </button>

      {/* Nav */}
      <nav style={{ display: 'flex', alignItems: 'center', gap: '0', marginLeft: '40px' }}>
        {navItems.map((item) => {
          const isActive = location.pathname === item.path;
          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              style={{
                position: 'relative',
                padding: '20px 16px',
                background: 'none',
                border: 'none',
                color: isActive ? colors.text1 : colors.text2,
                fontSize: '14px',
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
                    left: '16px',
                    right: '16px',
                    height: '2px',
                    background: colors.accent,
                    borderRadius: '1px',
                  }}
                />
              )}
            </button>
          );
        })}
      </nav>

      <div style={{ flex: 1 }} />

      {/* CTA */}
      {!location.pathname.startsWith('/scan') && (
        <button
          onClick={() => navigate('/scan')}
          style={{
            padding: '8px 20px',
            borderRadius: '9999px',
            border: 'none',
            background: colors.accent,
            color: colors.white,
            fontSize: '13px',
            fontWeight: 500,
            cursor: 'pointer',
            fontFamily: 'inherit',
            transition: 'background 150ms ease',
          }}
          onMouseEnter={(e) => { (e.target as HTMLElement).style.background = colors.accentHover; }}
          onMouseLeave={(e) => { (e.target as HTMLElement).style.background = colors.accent; }}
        >
          New Scan
        </button>
      )}
    </header>
  );
}

export function App() {
  const [state, dispatch] = useReducer(appReducer, INITIAL_STATE);

  return (
    <AppContext.Provider value={{ state, dispatch }}>
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: colors.black }}>
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

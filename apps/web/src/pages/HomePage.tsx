import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, GlassPanel, colors, fonts } from '@echos/ui';
import { useTranslation } from '../i18n/index.js';
import { useTheme } from '../theme/index.js';
import { getBrandingForTheme } from '../branding.js';
import { IconImage, IconChevronUp } from '../components/Icons.js';
import { ImageLightbox } from '../components/ImageLightbox.js';
import { DocsSection } from '../components/DocsSection.js';
import { MapView } from '../components/MapView.js';
import { useAppState } from '../store/app-state.js';

export function HomePage() {
  const navigate = useNavigate();
  const { t, tArray } = useTranslation();
  const { theme } = useTheme();
  const { state, dispatch } = useAppState();
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [lightboxImages, setLightboxImages] = useState<string[]>([]);
  const [hoveredImage, setHoveredImage] = useState<string | null>(null);
  const [showFloatingCta, setShowFloatingCta] = useState(false);
  const heroCtaRef = useRef<HTMLDivElement>(null);

  // Show floating CTA when hero button scrolls out of view
  useEffect(() => {
    const el = heroCtaRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setShowFloatingCta(!entry.isIntersecting),
      { threshold: 0 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const FEATURES = [
    { title: t('home.feat1.title'), desc: t('home.feat1.desc'), num: '01' },
    { title: t('home.feat2.title'), desc: t('home.feat2.desc'), num: '02' },
    { title: t('home.feat3.title'), desc: t('home.feat3.desc'), num: '03' },
    { title: t('home.feat4.title'), desc: t('home.feat4.desc'), num: '04' },
  ];

  const STATS = [
    { value: '100%', label: t('home.stat.clientSide') },
    { value: '6', label: t('home.stat.steps') },
    { value: 'NRRD', label: t('home.stat.export') },
    { value: '0', label: t('home.stat.dataSent') },
  ];

  const openLightbox = (images: string[], startIndex: number) => {
    setLightboxImages(images);
    setLightboxIndex(startIndex);
    setLightboxOpen(true);
  };

  const heroImages = [
    `${import.meta.env.BASE_URL}hero-main.png`,
    `${import.meta.env.BASE_URL}hero-side.png`,
  ];

  const galleryRow1 = [
    { file: 'gallery-01.png', baseFlex: 2, index: 0 },
    { file: 'gallery-03.png', baseFlex: 1, index: 1 },
  ];
  const galleryRow2 = [
    { file: 'gallery-04.png', baseFlex: 1, index: 2 },
    { file: 'gallery-05.png', baseFlex: 1, index: 3 },
    { file: 'gallery-06.png', baseFlex: 1, index: 4 },
  ];

  const allGalleryFiles = [...galleryRow1, ...galleryRow2];
  const galleryImages = allGalleryFiles.map((item) => `${import.meta.env.BASE_URL}${item.file}`);

  return (
    <div style={{ background: colors.black }}>
      {/* Hero */}
      <section
        style={{
          padding: 'clamp(48px, 8vw, 100px) var(--content-gutter) clamp(32px, 4vw, 64px)',
        }}
      >
        <div style={{ marginBottom: '12px' }}>
          <img
            src={getBrandingForTheme(theme).texteTitle}
            alt="echos - donnees capturees"
            style={{ width: 'clamp(280px, 35vw, 480px)', height: 'auto', display: 'block' }}
          />
        </div>

        <p
          style={{
            fontSize: 'clamp(15px, 1.2vw, 17px)',
            color: colors.text3,
            maxWidth: '560px',
            lineHeight: 1.7,
            marginBottom: '48px',
          }}
        >
          {t('home.description')}
        </p>

        <div ref={heroCtaRef} style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <Button variant="primary" size="lg" onClick={() => navigate('/scan')}>
            {t('home.cta')}
          </Button>
          <Button variant="secondary" size="lg" onClick={() => {
            const el = document.getElementById('manifesto-section');
            if (el) el.scrollIntoView({ behavior: 'smooth' });
          }}>
            {t('home.cta2')}
          </Button>
        </div>
      </section>

      {/* Hero visual zone */}
      <section style={{ padding: `0 var(--content-gutter) clamp(48px, 5vw, 80px)` }}>
        <div
          className="hero-visual-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: '2fr 1fr',
            gridTemplateRows: 'minmax(324px, 486px)',
            gap: '16px',
          }}
        >
          {heroImages.map((src, i) => (
            <div
              key={src}
              className="visual-placeholder"
              style={{ minHeight: '240px', cursor: 'pointer', position: 'relative', overflow: 'hidden' }}
              onClick={() => openLightbox(heroImages, i)}
              onMouseEnter={(e) => {
                const img = e.currentTarget.querySelector('img');
                if (img) { img.style.transform = 'scale(1.05)'; img.style.filter = 'brightness(1.1)'; }
              }}
              onMouseLeave={(e) => {
                const img = e.currentTarget.querySelector('img');
                if (img) { img.style.transform = 'scale(1)'; img.style.filter = 'brightness(1)'; }
              }}
            >
              <img
                src={src}
                alt=""
                style={{ transition: 'transform 400ms cubic-bezier(0.34, 1.56, 0.64, 1), filter 300ms ease' }}
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
              <div style={{ position: 'absolute', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', pointerEvents: 'none' }}>
                <IconImage size={32} color={colors.text3} />
                <span style={{ fontSize: '13px' }}>{i === 0 ? 'hero-main.png' : 'hero-side.png'}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Stats */}
      <section style={{ padding: `0 var(--content-gutter) clamp(40px, 4vw, 64px)` }}>
        <div
          className="stats-row"
          style={{
            display: 'flex',
            background: colors.surface,
            border: `1px solid ${colors.border}`,
            borderRadius: '12px',
            padding: '24px 0',
          }}
        >
          {STATS.map((stat, i) => (
            <div
              key={stat.label}
              style={{
                textAlign: 'center',
                padding: '0 32px',
                borderRight: i < STATS.length - 1 ? `1px solid ${colors.border}` : 'none',
                flex: 1,
              }}
            >
              <div style={{ fontSize: '24px', fontWeight: 600, color: colors.text1, fontVariantNumeric: 'tabular-nums' }}>
                {stat.value}
              </div>
              <div style={{ fontSize: '13px', color: colors.text3, marginTop: '4px' }}>{stat.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section style={{ padding: `clamp(40px, 4vw, 64px) var(--content-gutter)` }}>
        <h2
          style={{
            fontFamily: fonts.display,
            fontVariationSettings: "'wght' 600",
            fontSize: 'clamp(28px, 3vw, 36px)',
            lineHeight: 1.1,
            letterSpacing: '-0.02em',
            color: colors.text1,
            marginBottom: '32px',
          }}
        >
          {t('home.howItWorks')}
        </h2>
        <div
          className="grid-4-cols"
          style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '20px' }}
        >
          {FEATURES.map((f) => (
            <GlassPanel key={f.title} padding="28px">
              <div
                style={{
                  fontSize: '12px',
                  fontWeight: 600,
                  color: colors.accent,
                  fontVariantNumeric: 'tabular-nums',
                  marginBottom: '16px',
                  letterSpacing: '0.5px',
                }}
              >
                {f.num}
              </div>
              <h3 style={{ fontSize: '18px', fontWeight: 600, color: colors.text1, marginBottom: '10px' }}>
                {f.title}
              </h3>
              <p style={{ fontSize: '15px', color: colors.text2, lineHeight: 1.6 }}>{f.desc}</p>
            </GlassPanel>
          ))}
        </div>
      </section>

      {/* Gallery — flex rows with hover zoom on desktop, horizontal scroll on mobile */}
      <section style={{ padding: `0 var(--content-gutter) clamp(48px, 6vw, 100px)` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '24px' }}>
          <div>
            <h2
              style={{
                fontFamily: fonts.display,
                fontVariationSettings: "'wght' 600",
                fontSize: 'clamp(28px, 3vw, 36px)',
                lineHeight: 1.1,
                letterSpacing: '-0.02em',
                color: colors.text1,
                marginBottom: '8px',
              }}
            >
              {t('home.gallery.title')}
            </h2>
            <p style={{ fontSize: '15px', color: colors.text3 }}>{t('home.gallery.subtitle')}</p>
          </div>
        </div>

        {/* Gallery container — single horizontal scroll block on mobile */}
        <div className="gallery-container">
          {/* Row 1: gallery-01 (wide) + gallery-03 */}
          <div className="gallery-row" style={{ display: 'flex', gap: '16px', height: '378px', marginBottom: '16px' }}>
            {galleryRow1.map((item) => (
              <div
                key={item.file}
                className="gallery-card visual-placeholder"
                data-baseflex={item.baseFlex}
                style={{
                  flex: hoveredImage === item.file ? item.baseFlex * 1.8 : item.baseFlex,
                  cursor: 'pointer',
                  position: 'relative',
                  overflow: 'hidden',
                  borderRadius: '12px',
                }}
                onClick={() => openLightbox(galleryImages, item.index)}
                onMouseEnter={() => setHoveredImage(item.file)}
                onMouseLeave={() => setHoveredImage(null)}
              >
                <img
                  src={`${import.meta.env.BASE_URL}${item.file}`}
                  alt=""
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
                <div style={{ position: 'absolute', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', pointerEvents: 'none' }}>
                  <IconImage size={24} color={colors.text3} />
                  <span style={{ fontSize: '11px' }}>{item.file}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Row 2: gallery-04, gallery-05, gallery-06 */}
          <div className="gallery-row" style={{ display: 'flex', gap: '16px', height: '324px' }}>
            {galleryRow2.map((item) => (
              <div
                key={item.file}
                className="gallery-card visual-placeholder"
                data-baseflex={item.baseFlex}
                style={{
                  flex: hoveredImage === item.file ? item.baseFlex * 1.8 : item.baseFlex,
                  cursor: 'pointer',
                  position: 'relative',
                  overflow: 'hidden',
                  borderRadius: '12px',
                }}
                onClick={() => openLightbox(galleryImages, item.index)}
                onMouseEnter={() => setHoveredImage(item.file)}
                onMouseLeave={() => setHoveredImage(null)}
              >
                <img
                  src={`${import.meta.env.BASE_URL}${item.file}`}
                  alt=""
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
                <div style={{ position: 'absolute', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', pointerEvents: 'none' }}>
                  <IconImage size={24} color={colors.text3} />
                  <span style={{ fontSize: '11px' }}>{item.file}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Map — after Accueil, matching nav order: Accueil > Carte > Docs > Manifeste */}
      <section
        id="map-section"
        style={{
          padding: `clamp(48px, 5vw, 80px) var(--content-gutter) clamp(64px, 6vw, 120px)`,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h2
            style={{
              fontFamily: fonts.display,
              fontVariationSettings: "'wght' 600",
              fontSize: 'clamp(28px, 3vw, 36px)',
              lineHeight: 1.1,
              letterSpacing: '-0.02em',
              color: colors.text1,
              margin: 0,
            }}
          >
            {t('v2.map.title')}
          </h2>
          <span style={{ color: colors.text3, fontSize: '13px' }}>
            {state.sessions.length} {t('v2.map.sessions')}
          </span>
        </div>

        <div style={{ height: 'clamp(400px, 50vh, 600px)', borderRadius: '12px', overflow: 'hidden' }}>
          <MapView
            sessions={state.sessions}
            selectedSessionId={state.activeSessionId}
            onSessionSelect={useCallback((id: string) => dispatch({ type: 'SET_ACTIVE_SESSION', id }), [dispatch])}
            gpxTracks={state.gpxTracks}
            theme={theme}
          />
        </div>

      </section>

      {/* Documentation */}
      <section
        id="docs-section"
        style={{
          padding: `clamp(48px, 5vw, 80px) var(--content-gutter) clamp(64px, 6vw, 120px)`,
        }}
      >
        <DocsSection />
      </section>

      {/* Manifesto */}
      <section
        id="manifesto-section"
        style={{
          padding: `clamp(48px, 5vw, 80px) var(--content-gutter) clamp(64px, 6vw, 120px)`,
        }}
      >
        <h2
          style={{
            fontFamily: fonts.display,
            fontVariationSettings: "'wght' 500",
            fontSize: 'clamp(36px, 4vw, 56px)',
            lineHeight: 1,
            letterSpacing: '-0.02em',
            color: colors.text1,
            marginBottom: '4px',
          }}
        >
          {t('manifesto.title')}
        </h2>
        <p
          style={{
            fontFamily: fonts.display,
            fontVariationSettings: "'wght' 500",
            fontSize: 'clamp(18px, 2vw, 24px)',
            lineHeight: 1.2,
            color: colors.accent,
            marginBottom: '56px',
          }}
        >
          {t('manifesto.subtitle')}
        </p>

        <div
          className="manifesto-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '28px',
          }}
        >
          <GlassPanel padding="32px">
            <h3 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '16px', color: colors.text1 }}>
              {t('manifesto.s1.title')}
            </h3>
            <p style={{ color: colors.text2, lineHeight: '1.8', fontSize: '16px' }}>{t('manifesto.s1.p1')}</p>
            <p style={{ color: colors.text2, lineHeight: '1.8', fontSize: '16px', marginTop: '14px' }}>{t('manifesto.s1.p2')}</p>
          </GlassPanel>

          <GlassPanel padding="32px">
            <h3 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '16px', color: colors.text1 }}>
              {t('manifesto.s2.title')}
            </h3>
            <p style={{ color: colors.text2, lineHeight: '1.8', fontSize: '16px' }}>{t('manifesto.s2.p1')}</p>
            <p style={{ color: colors.text2, lineHeight: '1.8', fontSize: '16px', marginTop: '14px' }}>{t('manifesto.s2.p2')}</p>
          </GlassPanel>

          <GlassPanel padding="32px">
            <h3 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '16px', color: colors.text1 }}>
              {t('manifesto.s3.title')}
            </h3>
            <p style={{ color: colors.text2, lineHeight: '1.8', fontSize: '16px' }}>{t('manifesto.s3.p1')}</p>
            <p style={{ color: colors.text2, lineHeight: '1.8', fontSize: '16px', marginTop: '14px' }}>{t('manifesto.s3.p2')}</p>
          </GlassPanel>

          <GlassPanel padding="32px">
            <h3 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '16px', color: colors.text1 }}>
              {t('manifesto.s4.title')}
            </h3>
            <ul style={{ color: colors.text2, lineHeight: '1.8', fontSize: '16px', listStyle: 'none', padding: 0, display: 'grid', gap: '8px' }}>
              {tArray('manifesto.s4.items').map((item, i) => (
                <li key={i} style={{ display: 'flex', gap: '12px' }}>
                  <span style={{ color: colors.accent, flexShrink: 0 }}>-</span>
                  {item}
                </li>
              ))}
            </ul>
          </GlassPanel>

          <GlassPanel padding="32px" style={{ gridColumn: 'span 2' }}>
            <h3 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '16px', color: colors.text1 }}>
              {t('manifesto.s5.title')}
            </h3>
            <ul style={{ color: colors.text2, lineHeight: '1.8', fontSize: '16px', listStyle: 'none', padding: 0, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 32px' }}>
              {tArray('manifesto.s5.items').map((item, i) => (
                <li key={i} style={{ display: 'flex', gap: '12px' }}>
                  <span style={{ color: colors.accent, flexShrink: 0 }}>+</span>
                  {item}
                </li>
              ))}
            </ul>
          </GlassPanel>
        </div>

      </section>

      {/* Scroll to top */}
      <div style={{ display: 'flex', justifyContent: 'center', padding: '0 0 clamp(32px, 4vw, 56px)' }}>
        <button
          onClick={() => (document.getElementById('main-content') ?? window).scrollTo({ top: 0, behavior: 'smooth' })}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '44px',
            height: '44px',
            borderRadius: '50%',
            border: 'none',
            background: colors.accent,
            color: '#FFFFFF',
            cursor: 'pointer',
            transition: 'background 200ms ease',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.background = 'var(--c-accent-hover)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.background = 'var(--c-accent)';
          }}
        >
          <IconChevronUp size={20} />
        </button>
      </div>

      {/* Floating scan CTA — accent bg, frosted, appears when hero CTA scrolls out */}
      <button
        onClick={() => navigate('/scan')}
        className="floating-scan-cta"
        style={{
          position: 'fixed',
          bottom: '32px',
          right: '32px',
          zIndex: 90,
          padding: '20px 48px 22px',
          fontSize: '20px',
          fontWeight: 600,
          letterSpacing: '-0.01em',
          fontFamily: 'inherit',
          color: '#FFFFFF',
          background: 'var(--cta-bg-soft)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          border: '1px solid rgba(255, 255, 255, 0.15)',
          borderRadius: 'var(--radius-full)',
          cursor: 'pointer',
          boxShadow: 'none',
          opacity: showFloatingCta ? 1 : 0,
          transform: showFloatingCta ? 'translateY(0)' : 'translateY(20px)',
          pointerEvents: showFloatingCta ? 'auto' : 'none',
        }}
      >
        {t('home.cta')}
      </button>

      {/* Lightbox */}
      {lightboxOpen && (
        <ImageLightbox
          images={lightboxImages}
          currentIndex={lightboxIndex}
          onClose={() => setLightboxOpen(false)}
          onNavigate={(index) => setLightboxIndex(index)}
        />
      )}
    </div>
  );
}

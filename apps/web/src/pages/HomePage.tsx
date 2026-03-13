import React, { useState, useCallback, useEffect } from 'react';
import ReactDOM from 'react-dom';
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

/* Tiny blur placeholders (base64 ~20px WebP, <200 bytes each) */
const BLUR: Record<string, string> = {
  'hero-main': 'data:image/webp;base64,UklGRj4AAABXRUJQVlA4IDIAAADQAgCdASoUAAwAPzmGulQvKSWjMAgB4CcJYwAAifQAAP7uSHyMP8eXjMR8tdIBzvNQAA==',
  'hero-side': 'data:image/webp;base64,UklGRlQAAABXRUJQVlA4IEgAAADQAwCdASoUABAAPzmGu1QvKSYjMAgB4CcJZgC7AB6Wg9jO6qDlZMAA/ulDC88wAs55bgyrfkyO7hGzsuR1tjJZjibJVLxMAAA=',
  'gallery-01': 'data:image/webp;base64,UklGRlAAAABXRUJQVlA4IEQAAACwAwCdASoUABIAPzGCtVOuqKUisAwB0CYJZwAAW+yZCjjvMbLLQAD+3NSu6DibBjaOtn2Gvi4ob74DVzuC5ZwoafAAAA==',
  'gallery-03': 'data:image/webp;base64,UklGRkgAAABXRUJQVlA4IDwAAAAQBACdASoUABQAPyV+s1OuKKSit/qoAcAkiWUAAFu1mHilvtuzup8MAAD+7ndBkDHnwLLPZW2L50AAAAA=',
  'gallery-04': 'data:image/webp;base64,UklGRkIAAABXRUJQVlA4IDYAAAAwAwCdASoUABIAPzmUwVmvKicqqAgB4CcJaQAALmXZ8sDwAP7r2Lwm7Yx29Zuv8Ko++CYAAAA=',
  'gallery-05': 'data:image/webp;base64,UklGRkoAAABXRUJQVlA4ID4AAACwAwCdASoUABAAPzmEuVOvKKWisAgB4CcJYwCAAAh1f86Vnr7iMAD+6+MgEa9aQRq0T/XxWpnnHgfgOjAAAA==',
  'gallery-06': 'data:image/webp;base64,UklGRloAAABXRUJQVlA4IE4AAABwBACdASoUABQAPzWAtlOvKCUit/VYAeAmiUAYmwIcecO8wkkr/9g5/NUSUAD+6+s0j0j577ocOx6UXXN69CtFOA3e5YWQ8R1F1IhBwAA=',
};

/** Progressive image: blur placeholder -> WebP with PNG fallback */
function ProgressiveImg({ name, alt, loading, style, onError }: {
  name: string; alt: string; loading?: 'eager' | 'lazy';
  style?: React.CSSProperties; onError?: React.ReactEventHandler<HTMLImageElement>;
}) {
  const [loaded, setLoaded] = useState(false);
  const base = import.meta.env.BASE_URL;
  const blur = BLUR[name];
  return (
    <>
      {blur && !loaded && (
        <img
          src={blur}
          alt=""
          aria-hidden
          style={{
            ...style,
            position: 'absolute', inset: 0, width: '100%', height: '100%',
            objectFit: 'cover', filter: 'blur(20px)', transform: 'scale(1.1)',
            zIndex: 1, pointerEvents: 'none',
          }}
        />
      )}
      <picture>
        <source srcSet={`${base}${name}.webp`} type="image/webp" />
        <img
          src={`${base}${name}.png`}
          alt={alt}
          loading={loading ?? 'lazy'}
          decoding={loading === 'eager' ? 'sync' : 'async'}
          {...(loading === 'eager' ? { fetchPriority: 'high' } as any : {})}
          onLoad={() => setLoaded(true)}
          onError={onError}
          style={{
            ...style,
            opacity: loaded ? 1 : 0,
            transition: (style?.transition ? style.transition + ', ' : '') + 'opacity 400ms ease',
          }}
        />
      </picture>
    </>
  );
}

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
  const [focusedSessionId, setFocusedSessionId] = useState<string | null>(null);

  // Show floating CTA when user scrolls past the hero section
  useEffect(() => {
    const scroller = document.getElementById('main-content');
    if (!scroller) return;
    const onScroll = () => {
      setShowFloatingCta(scroller.scrollTop > 150);
    };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => scroller.removeEventListener('scroll', onScroll);
  }, []);

  const FEATURES = [
    { title: t('home.feat1.title'), desc: t('home.feat1.desc'), num: '01' },
    { title: t('home.feat2.title'), desc: t('home.feat2.desc'), num: '02' },
    { title: t('home.feat3.title'), desc: t('home.feat3.desc'), num: '03' },
    { title: t('home.feat4.title'), desc: t('home.feat4.desc'), num: '04' },
  ];

  const openLightbox = (images: string[], startIndex: number) => {
    setLightboxImages(images);
    setLightboxIndex(startIndex);
    setLightboxOpen(true);
  };

  const heroImageNames = ['hero-side', 'hero-main'];
  const heroImages = heroImageNames.map((n) => `${import.meta.env.BASE_URL}${n}.png`);

  const galleryRow1 = [
    { name: 'gallery-01', baseFlex: 2, index: 0 },
    { name: 'gallery-03', baseFlex: 1, index: 1 },
  ];
  const galleryRow2 = [
    { name: 'gallery-04', baseFlex: 1, index: 2 },
    { name: 'gallery-05', baseFlex: 1, index: 3 },
    { name: 'gallery-06', baseFlex: 1, index: 4 },
  ];

  const allGalleryItems = [...galleryRow1, ...galleryRow2];
  const galleryImages = allGalleryItems.map((item) => `${import.meta.env.BASE_URL}${item.name}.png`);

  return (
    <div style={{ background: colors.black }}>
      {/* Hero */}
      <section
        style={{
          padding: 'clamp(36px, 6vw, 80px) var(--content-gutter) clamp(24px, 3vw, 48px)',
        }}
      >
        <div style={{ marginBottom: '12px' }}>
          <img
            src={getBrandingForTheme(theme).texteTitle}
            alt="ecos"
            style={{ width: 'clamp(220px, 28vw, 380px)', height: 'auto', display: 'block' }}
          />
        </div>

        <p
          className="hero-desc"
          style={{
            fontSize: 'clamp(13px, 1vw, 14px)',
            color: colors.text3,
            maxWidth: '480px',
            lineHeight: 1.7,
            marginBottom: '36px',
          }}
        >
          {t('home.description')}
        </p>

        <div className="hero-cta-row" style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <Button variant="primary" size="md" onClick={() => navigate('/scan')}>
            {t('home.cta')}
          </Button>
          <Button variant="secondary" size="md" onClick={() => {
            const el = document.getElementById('manifesto-section');
            if (el) el.scrollIntoView({ behavior: 'smooth' });
          }} style={{ border: `2px solid ${colors.border}` }}>
            {t('home.cta2')}
          </Button>
        </div>
      </section>

      {/* Hero visual zone */}
      <section style={{ padding: `0 var(--content-gutter) clamp(36px, 4vw, 64px)` }}>
        <div
          className="hero-visual-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 2fr',
            gridTemplateRows: 'minmax(260px, 390px)',
            gap: '12px',
          }}
        >
          {heroImageNames.map((name, i) => (
            <div
              key={name}
              className="visual-placeholder"
              style={{ minHeight: '240px', cursor: 'pointer', position: 'relative', overflow: 'hidden', border: `2px solid transparent`, borderRadius: '12px', transition: 'border-color 300ms ease' }}
              onClick={() => openLightbox(heroImages, i)}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = colors.accent;
                const img = e.currentTarget.querySelector('picture img') as HTMLImageElement;
                if (img) { img.style.transform = 'scale(1.02)'; img.style.filter = 'brightness(1.05)'; }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'transparent';
                const img = e.currentTarget.querySelector('picture img') as HTMLImageElement;
                if (img) { img.style.transform = 'scale(1)'; img.style.filter = 'brightness(1)'; }
              }}
            >
              <ProgressiveImg
                name={name}
                alt=""
                loading="eager"
                style={{ transition: 'transform 300ms ease, filter 300ms ease' }}
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
              <div style={{ position: 'absolute', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', pointerEvents: 'none' }}>
                <IconImage size={32} color={colors.text3} />
                <span style={{ fontSize: '13px' }}>{name}.png</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section style={{ padding: `clamp(28px, 3vw, 48px) var(--content-gutter)` }}>
        <h2
          style={{
            fontFamily: fonts.display,
            fontVariationSettings: "'wght' 600",
            fontSize: 'clamp(22px, 2.4vw, 29px)',
            lineHeight: 1.1,
            letterSpacing: '-0.02em',
            color: colors.text1,
            marginBottom: '24px',
          }}
        >
          {t('home.howItWorks')}
        </h2>
        <div
          className="grid-4-cols"
          style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}
        >
          {FEATURES.map((f) => (
            <GlassPanel key={f.title} padding="22px">
              <div
                style={{
                  fontSize: '11px',
                  fontWeight: 600,
                  color: colors.accent,
                  fontVariantNumeric: 'tabular-nums',
                  marginBottom: '12px',
                  letterSpacing: '0.5px',
                }}
              >
                {f.num}
              </div>
              <h3 style={{ fontSize: '15px', fontWeight: 600, color: colors.text1, marginBottom: '8px' }}>
                {f.title}
              </h3>
              <p style={{ fontSize: '13px', color: colors.text2, lineHeight: 1.6 }}>{f.desc}</p>
            </GlassPanel>
          ))}
        </div>
      </section>

      {/* Gallery — flex rows with hover zoom on desktop, horizontal scroll on mobile */}
      <section style={{ padding: `0 var(--content-gutter) clamp(36px, 5vw, 80px)` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '18px' }}>
          <div>
            <h2
              style={{
                fontFamily: fonts.display,
                fontVariationSettings: "'wght' 600",
                fontSize: 'clamp(22px, 2.4vw, 29px)',
                lineHeight: 1.1,
                letterSpacing: '-0.02em',
                color: colors.text1,
                marginBottom: '6px',
              }}
            >
              {t('home.gallery.title')}
            </h2>
            <p style={{ fontSize: '13px', color: colors.text3 }}>{t('home.gallery.subtitle')}</p>
          </div>
        </div>

        {/* Gallery container — single horizontal scroll block on mobile */}
        <div className="gallery-container">
          {/* Row 1: gallery-01 (wide) + gallery-03 */}
          <div className="gallery-row" style={{ display: 'flex', gap: '12px', height: '300px', marginBottom: '12px' }}>
            {galleryRow1.map((item) => (
              <div
                key={item.name}
                className="gallery-card visual-placeholder"
                data-baseflex={item.baseFlex}
                style={{
                  flex: hoveredImage === item.name ? item.baseFlex * 1.8 : item.baseFlex,
                  cursor: 'pointer',
                  position: 'relative',
                  overflow: 'hidden',
                  borderRadius: '12px',
                  border: hoveredImage === item.name ? `2px solid ${colors.accent}` : '2px solid transparent',
                  transition: 'flex 500ms cubic-bezier(0.34, 1.56, 0.64, 1), border-color 300ms ease',
                }}
                onClick={() => openLightbox(galleryImages, item.index)}
                onMouseEnter={() => setHoveredImage(item.name)}
                onMouseLeave={() => setHoveredImage(null)}
              >
                <ProgressiveImg
                  name={item.name}
                  alt=""
                  style={{ transition: 'transform 400ms cubic-bezier(0.34, 1.56, 0.64, 1)', transform: hoveredImage === item.name ? 'scale(1.05)' : 'scale(1)' }}
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
                <div style={{ position: 'absolute', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', pointerEvents: 'none' }}>
                  <IconImage size={24} color={colors.text3} />
                  <span style={{ fontSize: '11px' }}>{item.name}.png</span>
                </div>
              </div>
            ))}
          </div>

          {/* Row 2: gallery-04, gallery-05, gallery-06 */}
          <div className="gallery-row" style={{ display: 'flex', gap: '12px', height: '260px' }}>
            {galleryRow2.map((item) => (
              <div
                key={item.name}
                className="gallery-card visual-placeholder"
                data-baseflex={item.baseFlex}
                style={{
                  flex: hoveredImage === item.name ? item.baseFlex * 1.8 : item.baseFlex,
                  cursor: 'pointer',
                  position: 'relative',
                  overflow: 'hidden',
                  borderRadius: '12px',
                  border: hoveredImage === item.name ? `2px solid ${colors.accent}` : '2px solid transparent',
                  transition: 'flex 500ms cubic-bezier(0.34, 1.56, 0.64, 1), border-color 300ms ease',
                }}
                onClick={() => openLightbox(galleryImages, item.index)}
                onMouseEnter={() => setHoveredImage(item.name)}
                onMouseLeave={() => setHoveredImage(null)}
              >
                <ProgressiveImg
                  name={item.name}
                  alt=""
                  style={{ transition: 'transform 400ms cubic-bezier(0.34, 1.56, 0.64, 1)', transform: hoveredImage === item.name ? 'scale(1.05)' : 'scale(1)' }}
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
                <div style={{ position: 'absolute', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', pointerEvents: 'none' }}>
                  <IconImage size={24} color={colors.text3} />
                  <span style={{ fontSize: '11px' }}>{item.name}.png</span>
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
          padding: `clamp(36px, 4vw, 64px) var(--content-gutter) clamp(48px, 5vw, 96px)`,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '20px' }}>
          <div>
            <h2
              style={{
                fontFamily: fonts.display,
                fontVariationSettings: "'wght' 600",
                fontSize: 'clamp(22px, 2.4vw, 29px)',
                lineHeight: 1.1,
                letterSpacing: '-0.02em',
                color: colors.text1,
                marginBottom: '8px',
              }}
            >
              {t('v2.map.title')}
            </h2>
            <p style={{ fontSize: '15px', color: colors.text3 }}>{t('v2.map.subtitle')}</p>
          </div>
          <span style={{ fontSize: '12px', fontWeight: 500, flexShrink: 0 }}>
            <span style={{ color: colors.accent, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{state.sessions.length}</span>
            {' '}
            <span style={{ color: colors.text2 }}>{t('v2.map.sessions')}</span>
          </span>
        </div>

        <div className="map-outer-container" style={{
          height: 'clamp(480px, 60vh, 720px)',
          borderRadius: '12px',
          overflow: 'hidden',
          border: `1px solid ${colors.border}`,
          display: 'flex',
          transition: 'all 400ms ease',
        }}>
          {/* Map — shrinks to 1/4 when a trace is focused */}
          <div className="map-main-area" style={{
            flex: focusedSessionId ? '0 0 25%' : '1 1 100%',
            height: '100%',
            transition: 'flex 400ms ease',
            overflow: 'hidden',
          }}>
            <MapView
              sessions={state.sessions}
              selectedSessionId={focusedSessionId ?? state.activeSessionId}
              onSessionSelect={useCallback((id: string) => {
                dispatch({ type: 'SET_ACTIVE_SESSION', id });
                setFocusedSessionId(id);
              }, [dispatch])}
              gpxTracks={state.gpxTracks}
              theme={theme}
              deepFocus={!!focusedSessionId}
            />
          </div>

          {/* Info panel — 3/4 right side, visible when a trace is focused */}
          {focusedSessionId && (() => {
            const session = state.sessions.find((s) => s.id === focusedSessionId);
            if (!session) return null;
            const basePath = import.meta.env.BASE_URL ?? '/ecos-data-captured/';
            const manifestEntry = state.manifestEntries.find((e) => e.id === focusedSessionId);
            const thumbnailUrl = manifestEntry?.files.thumbnail
              ? `${basePath}sessions/${focusedSessionId}/${manifestEntry.files.thumbnail}`
              : null;
            return (
              <div className="map-info-panel" style={{
                flex: '0 0 75%',
                height: '100%',
                padding: '0',
                display: 'flex',
                flexDirection: 'column',
                background: colors.surface,
                borderLeft: `1px solid ${colors.border}`,
                animation: 'echos-fade-in 300ms ease',
                position: 'relative',
                overflow: 'hidden',
              }}>
                {/* Close button — top right, well positioned */}
                <button
                  onClick={() => setFocusedSessionId(null)}
                  style={{
                    position: 'absolute',
                    top: '12px',
                    right: '12px',
                    width: '32px',
                    height: '32px',
                    borderRadius: '50%',
                    border: `1px solid ${colors.border}`,
                    background: colors.black,
                    color: colors.text2,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '14px',
                    zIndex: 5,
                    transition: 'all 150ms ease',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = colors.accent; e.currentTarget.style.color = colors.accent; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = colors.border; e.currentTarget.style.color = colors.text2; }}
                >
                  ×
                </button>

                {/* Content area — vertically centered */}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: 'clamp(20px, 3vw, 40px) clamp(24px, 3vw, 48px)', gap: '20px' }}>
                  {/* Session thumbnail / profile photo */}
                  {thumbnailUrl && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                      <img
                        src={thumbnailUrl}
                        alt={session.name}
                        style={{
                          width: '64px',
                          height: '64px',
                          borderRadius: '50%',
                          objectFit: 'cover',
                          border: `2px solid ${colors.accent}`,
                          background: colors.black,
                          flexShrink: 0,
                        }}
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                      />
                      <div style={{ fontSize: '11px', color: colors.text3, lineHeight: 1.4 }}>
                        <div style={{ color: colors.accent, fontWeight: 600, fontSize: '12px' }}>ECOS</div>
                        Session enregistrée
                      </div>
                    </div>
                  )}

                  {/* Title + date */}
                  <div>
                    <h3 style={{
                      fontFamily: fonts.display,
                      fontVariationSettings: "'wght' 600",
                      fontSize: 'clamp(18px, 2vw, 28px)',
                      color: colors.text1,
                      lineHeight: 1.1,
                      letterSpacing: '-0.02em',
                      marginBottom: '6px',
                      paddingRight: '40px',
                    }}>
                      {session.name}
                    </h3>
                    <p style={{ fontSize: '13px', color: colors.text3 }}>
                      {new Date(session.createdAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}
                    </p>
                  </div>

                  {/* Stats row */}
                  <div className="map-info-stats" style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(3, 1fr)',
                    gap: '10px',
                  }}>
                    {[
                      { value: `${session.totalDistanceM.toFixed(0)}m`, label: 'Distance' },
                      { value: `${(session.durationS / 60).toFixed(1)}min`, label: 'Durée' },
                      { value: `${session.frameCount}`, label: 'Frames' },
                    ].map((stat) => (
                      <div key={stat.label} style={{
                        padding: 'clamp(10px, 1.2vw, 16px)',
                        borderRadius: '10px',
                        background: colors.black,
                        border: `1px solid ${colors.border}`,
                      }}>
                        <div style={{
                          fontSize: 'clamp(16px, 1.8vw, 22px)',
                          fontWeight: 600,
                          color: colors.accent,
                          fontVariantNumeric: 'tabular-nums',
                          lineHeight: 1.2,
                        }}>
                          {stat.value}
                        </div>
                        <div style={{ fontSize: '11px', color: colors.text3, marginTop: '3px' }}>{stat.label}</div>
                      </div>
                    ))}
                  </div>

                  {/* Tags */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    <span style={{ padding: '4px 12px', borderRadius: '9999px', background: colors.accentMuted, color: colors.accent, fontSize: '11px', fontWeight: 500, maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {session.videoFileName}
                    </span>
                    {session.gpxFileName && (
                      <span style={{ padding: '4px 12px', borderRadius: '9999px', background: colors.accentMuted, color: colors.accent, fontSize: '11px', fontWeight: 500, maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {session.gpxFileName}
                      </span>
                    )}
                    <span style={{ padding: '4px 12px', borderRadius: '9999px', background: colors.accentMuted, color: colors.accent, fontSize: '11px', fontWeight: 500 }}>
                      {session.gridDimensions[0]}×{session.gridDimensions[1]}×{session.gridDimensions[2]}
                    </span>
                  </div>

                  {/* Coordinates */}
                  {session.bounds && (
                    <p style={{ fontSize: '12px', color: colors.text3, fontVariantNumeric: 'tabular-nums', margin: 0 }}>
                      {((session.bounds[0] + session.bounds[2]) / 2).toFixed(5)}°N, {((session.bounds[1] + session.bounds[3]) / 2).toFixed(5)}°E
                    </p>
                  )}

                  {/* Explorer button — refined, not full width */}
                  <Button variant="primary" size="lg" onClick={() => navigate(`/session/${session.id}`)}
                    style={{ alignSelf: 'stretch' }}
                  >
                    Explorer
                  </Button>
                </div>
              </div>
            );
          })()}
        </div>

      </section>

      {/* Manifesto */}
      <section
        id="manifesto-section"
        style={{
          padding: `clamp(36px, 4vw, 64px) var(--content-gutter) clamp(48px, 5vw, 96px)`,
        }}
      >
        <h2
          style={{
            fontFamily: fonts.display,
            fontVariationSettings: "'wght' 500",
            fontSize: 'clamp(28px, 3.2vw, 44px)',
            lineHeight: 1,
            letterSpacing: '-0.02em',
            color: colors.text1,
            marginBottom: '4px',
          }}
        >
          {t('manifesto.title')}
        </h2>
        <p
          className="manifesto-subtitle"
          style={{
            fontFamily: fonts.display,
            fontVariationSettings: "'wght' 500",
            fontSize: 'clamp(15px, 1.6vw, 19px)',
            lineHeight: 1.2,
            color: colors.accent,
            marginBottom: '40px',
          }}
        >
          {t('manifesto.subtitle')}
        </p>

        <div
          className="manifesto-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '20px',
            alignItems: 'stretch',
          }}
        >
          {/* Column 1: S1 + S3 — vertical reading order */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <GlassPanel padding="24px">
              <h3 style={{ fontSize: '19px', fontWeight: 700, marginBottom: '12px', color: colors.text1 }}>
                {t('manifesto.s1.title')}
              </h3>
              <p style={{ color: colors.text2, lineHeight: '1.7', fontSize: '13px' }}>{t('manifesto.s1.p1')}</p>
              <p style={{ color: colors.text2, lineHeight: '1.7', fontSize: '13px', marginTop: '10px' }}>{t('manifesto.s1.p2')}</p>
            </GlassPanel>

            <GlassPanel padding="24px">
              <h3 style={{ fontSize: '19px', fontWeight: 700, marginBottom: '12px', color: colors.text1 }}>
                {t('manifesto.s3.title')}
              </h3>
              <p style={{ color: colors.text2, lineHeight: '1.7', fontSize: '13px' }}>{t('manifesto.s3.p1')}</p>
              <p style={{ color: colors.text2, lineHeight: '1.7', fontSize: '13px', marginTop: '10px' }}>{t('manifesto.s3.p2')}</p>
            </GlassPanel>
          </div>

          {/* Column 2: S2 — stretches to align bottom with S3 */}
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <GlassPanel padding="24px" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
              <h3 style={{ fontSize: '19px', fontWeight: 700, marginBottom: '12px', color: colors.text1 }}>
                {t('manifesto.s2.title')}
              </h3>
              <p style={{ color: colors.text2, lineHeight: '1.7', fontSize: '13px' }}>{t('manifesto.s2.p1')}</p>
              <p style={{ color: colors.text2, lineHeight: '1.7', fontSize: '13px', marginTop: '10px' }}>{t('manifesto.s2.p2')}</p>
            </GlassPanel>
          </div>
        </div>


      </section>

      {/* Documentation */}
      <section
        id="docs-section"
        style={{
          padding: `clamp(24px, 2.5vw, 40px) var(--content-gutter) clamp(24px, 2.5vw, 40px)`,
        }}
      >
        <DocsSection />
      </section>

      {/* Scroll to top — hidden on mobile via .scroll-to-top */}
      <div className="scroll-to-top" style={{ display: 'flex', justifyContent: 'center', padding: '0 0 clamp(32px, 4vw, 56px)' }}>
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

      {/* Lightbox — rendered via portal to bypass transform containing block issues */}
      {lightboxOpen && ReactDOM.createPortal(
        <ImageLightbox
          images={lightboxImages}
          currentIndex={lightboxIndex}
          onClose={() => setLightboxOpen(false)}
          onNavigate={(index) => setLightboxIndex(index)}
        />,
        document.body,
      )}

      {/* Floating scan CTA — rendered via portal to bypass overflow/transform containing block issues */}
      {ReactDOM.createPortal(
        <button
          onClick={() => navigate('/scan')}
          className="floating-scan-cta"
          style={{
            position: 'fixed',
            bottom: '32px',
            right: '32px',
            zIndex: 9999,
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
            transition: 'opacity 300ms ease, transform 300ms ease, background 200ms ease, filter 200ms ease',
          }}
        >
          {t('home.cta')}
        </button>,
        document.body,
      )}
    </div>
  );
}

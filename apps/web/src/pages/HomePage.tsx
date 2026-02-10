import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, GlassPanel, colors, fonts } from '@echos/ui';
import { useTranslation } from '../i18n/index.js';
import { IconImage, IconArrowRight } from '../components/Icons.js';

const SIDE_PAD = 'clamp(16px, 2.5vw, 24px)';

export function HomePage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [hoveredImage, setHoveredImage] = useState<string | null>(null);

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

  const galleryRow1 = [
    { file: 'gallery-01.png', baseFlex: 2 },
    { file: 'gallery-03.png', baseFlex: 1 },
  ];

  const galleryRow2 = [
    { file: 'gallery-04.png', baseFlex: 1 },
    { file: 'gallery-05.png', baseFlex: 1 },
    { file: 'gallery-06.png', baseFlex: 1 },
  ];

  const stepsLeft = [
    { title: t('docs.step1.title'), body: t('docs.step1.body') },
    { title: t('docs.step2.title'), body: t('docs.step2.body') },
    { title: t('docs.step3.title'), body: t('docs.step3.body') },
    { title: t('docs.step4.title'), body: t('docs.step4.body') },
  ];

  const stepsRight = [
    { title: t('docs.step5.title'), body: t('docs.step5.body') },
    { title: t('docs.step6.title'), body: t('docs.step6.body') },
    { title: t('docs.step7.title'), body: t('docs.step7.body') },
  ];

  const techTerms = [
    { term: t('docs.cropRegion'), def: t('docs.cropRegionDef') },
    { term: t('docs.depthMax'), def: t('docs.depthMaxDef') },
    { term: t('docs.yStep'), def: t('docs.yStepDef') },
    { term: t('docs.fpsExtraction'), def: t('docs.fpsExtractionDef') },
    { term: t('docs.downscale'), def: t('docs.downscaleDef') },
    { term: t('docs.nrrd'), def: t('docs.nrrdDef') },
    { term: t('docs.transferFn'), def: t('docs.transferFnDef') },
  ];

  const renderGalleryCard = (item: { file: string; baseFlex: number }) => {
    const isHovered = hoveredImage === item.file;
    return (
      <div
        key={item.file}
        className="gallery-card"
        onMouseEnter={() => setHoveredImage(item.file)}
        onMouseLeave={() => setHoveredImage(null)}
        style={{
          flex: isHovered ? item.baseFlex * 1.8 : item.baseFlex,
          transition: 'flex 0.45s cubic-bezier(0.22, 0.61, 0.36, 1)',
          borderRadius: '12px',
          overflow: 'hidden',
          border: `1px solid ${colors.border}`,
          background: colors.surface,
          position: 'relative',
          cursor: 'pointer',
        }}
      >
        <img
          src={`${import.meta.env.BASE_URL}${item.file}`}
          alt=""
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            display: 'block',
          }}
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = 'none';
          }}
        />
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
            color: colors.text3,
            pointerEvents: 'none',
          }}
        >
          <IconImage size={24} color={colors.text3} />
          <span style={{ fontSize: '11px' }}>{item.file}</span>
        </div>
      </div>
    );
  };

  return (
    <div style={{ background: colors.black }}>
      {/* ── Hero ── */}
      <section
        style={{
          maxWidth: '1400px',
          margin: '0 auto',
          padding: `clamp(48px, 8vw, 100px) ${SIDE_PAD} clamp(32px, 4vw, 64px)`,
        }}
      >
        <div style={{ marginBottom: '32px' }}>
          <img
            src={`${import.meta.env.BASE_URL}logotype.svg`}
            alt="échos — données capturées"
            style={{
              width: 'clamp(280px, 35vw, 480px)',
              height: 'auto',
              display: 'block',
            }}
          />
        </div>

        <p
          style={{
            fontFamily: fonts.display,
            fontVariationSettings: "'wght' 500",
            fontSize: 'clamp(24px, 3.5vw, 40px)',
            lineHeight: 1.1,
            letterSpacing: '-0.01em',
            color: colors.text2,
            maxWidth: '700px',
            marginBottom: '20px',
          }}
        >
          {t('home.subtitle')}
        </p>

        <p
          style={{
            fontSize: 'clamp(15px, 1.2vw, 17px)',
            color: colors.text3,
            maxWidth: '560px',
            lineHeight: 1.7,
            marginBottom: '36px',
          }}
        >
          {t('home.description')}
        </p>

        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <Button variant="primary" size="lg" onClick={() => navigate('/scan')}>
            {t('home.cta')}
          </Button>
          <Button variant="secondary" size="lg" onClick={() => navigate('/manifesto')}>
            {t('home.cta2')}
          </Button>
        </div>
      </section>

      {/* ── Hero visual zone ── */}
      <section
        style={{
          maxWidth: '1400px',
          margin: '0 auto',
          padding: `0 ${SIDE_PAD} clamp(48px, 5vw, 80px)`,
        }}
      >
        <div
          className="hero-visual-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: '2fr 1fr',
            gridTemplateRows: 'minmax(240px, 360px)',
            gap: '16px',
          }}
        >
          <div className="visual-placeholder" style={{ minHeight: '240px' }}>
            <img
              src={`${import.meta.env.BASE_URL}hero-main.png`}
              alt=""
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
            <div
              style={{
                position: 'absolute',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <IconImage size={32} color={colors.text3} />
              <span style={{ fontSize: '13px' }}>hero-main.png</span>
            </div>
          </div>
          <div className="visual-placeholder" style={{ minHeight: '240px' }}>
            <img
              src={`${import.meta.env.BASE_URL}hero-side.png`}
              alt=""
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
            <div
              style={{
                position: 'absolute',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <IconImage size={32} color={colors.text3} />
              <span style={{ fontSize: '13px' }}>hero-side.png</span>
            </div>
          </div>
        </div>
      </section>

      {/* ── Stats ── */}
      <section
        style={{
          maxWidth: '1400px',
          margin: '0 auto',
          padding: `0 ${SIDE_PAD} clamp(40px, 4vw, 64px)`,
        }}
      >
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
              <div
                style={{
                  fontSize: '24px',
                  fontWeight: 600,
                  color: colors.text1,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {stat.value}
              </div>
              <div style={{ fontSize: '13px', color: colors.text3, marginTop: '4px' }}>
                {stat.label}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── How it works ── */}
      <section
        style={{
          maxWidth: '1400px',
          margin: '0 auto',
          padding: `clamp(40px, 4vw, 64px) ${SIDE_PAD}`,
        }}
      >
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
              <h3
                style={{
                  fontSize: '18px',
                  fontWeight: 600,
                  color: colors.text1,
                  marginBottom: '10px',
                }}
              >
                {f.title}
              </h3>
              <p style={{ fontSize: '15px', color: colors.text2, lineHeight: 1.6 }}>{f.desc}</p>
            </GlassPanel>
          ))}
        </div>
      </section>

      {/* ── Gallery with hover zoom ── */}
      <section
        style={{
          maxWidth: '1400px',
          margin: '0 auto',
          padding: `0 ${SIDE_PAD} clamp(48px, 6vw, 100px)`,
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            marginBottom: '24px',
          }}
        >
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
            <p style={{ fontSize: '15px', color: colors.text3 }}>
              {t('home.gallery.subtitle')}
            </p>
          </div>
        </div>

        {/* Flex-based gallery rows — hover zoom pushes neighbors */}
        <div className="gallery-rows">
          <div
            className="gallery-row"
            style={{
              display: 'flex',
              gap: '16px',
              height: '280px',
              marginBottom: '16px',
            }}
          >
            {galleryRow1.map(renderGalleryCard)}
          </div>
          <div
            className="gallery-row"
            style={{
              display: 'flex',
              gap: '16px',
              height: '220px',
            }}
          >
            {galleryRow2.map(renderGalleryCard)}
          </div>
        </div>
      </section>

      {/* ── Inline Documentation Section ── */}
      <section
        id="docs-section"
        style={{
          maxWidth: '1400px',
          margin: '0 auto',
          padding: `clamp(48px, 5vw, 80px) ${SIDE_PAD}`,
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
            marginBottom: '40px',
          }}
        >
          {t('docs.title')}
        </h2>

        <div
          className="docs-grid"
          style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '28px' }}
        >
          {/* User Guide — Left */}
          <GlassPanel padding="32px">
            <h3
              style={{
                fontSize: '20px',
                fontWeight: 700,
                marginBottom: '24px',
                color: colors.accent,
              }}
            >
              {t('docs.userGuide')}
            </h3>
            {stepsLeft.map(({ title, body }) => (
              <div key={title} style={{ marginBottom: '20px' }}>
                <h4
                  style={{
                    fontSize: '16px',
                    fontWeight: 700,
                    marginBottom: '8px',
                    color: colors.text1,
                  }}
                >
                  {title}
                </h4>
                <p style={{ color: colors.text2, lineHeight: '1.8', fontSize: '15px' }}>{body}</p>
              </div>
            ))}
          </GlassPanel>

          {/* User Guide (cont.) + Coordinate System — Right */}
          <div style={{ display: 'grid', gap: '28px' }}>
            <GlassPanel padding="32px">
              <h3
                style={{
                  fontSize: '20px',
                  fontWeight: 700,
                  marginBottom: '24px',
                  color: colors.accent,
                }}
              >
                {t('docs.userGuide')} (suite)
              </h3>
              {stepsRight.map(({ title, body }) => (
                <div key={title} style={{ marginBottom: '20px' }}>
                  <h4
                    style={{
                      fontSize: '16px',
                      fontWeight: 700,
                      marginBottom: '8px',
                      color: colors.text1,
                    }}
                  >
                    {title}
                  </h4>
                  <p style={{ color: colors.text2, lineHeight: '1.8', fontSize: '15px' }}>
                    {body}
                  </p>
                </div>
              ))}
            </GlassPanel>

            <GlassPanel padding="32px">
              <h3
                style={{
                  fontSize: '20px',
                  fontWeight: 700,
                  marginBottom: '16px',
                  color: colors.accent,
                }}
              >
                {t('docs.coordSystem')}
              </h3>
              <ul
                style={{
                  color: colors.text2,
                  lineHeight: '2',
                  fontSize: '15px',
                  paddingLeft: '20px',
                }}
              >
                <li>
                  <strong style={{ color: colors.text1 }}>X</strong> — {t('docs.coordX')}
                </li>
                <li>
                  <strong style={{ color: colors.text1 }}>Y</strong> — {t('docs.coordY')}
                </li>
                <li>
                  <strong style={{ color: colors.text1 }}>Z</strong> — {t('docs.coordZ')}
                </li>
              </ul>
              <p
                style={{
                  color: colors.text2,
                  lineHeight: '1.8',
                  fontSize: '14px',
                  marginTop: '14px',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                {t('docs.coordNote')}
              </p>
            </GlassPanel>
          </div>

          {/* Technical Concepts — Left */}
          <GlassPanel padding="32px">
            <h3
              style={{
                fontSize: '20px',
                fontWeight: 700,
                marginBottom: '24px',
                color: colors.accent,
              }}
            >
              {t('docs.techConcepts')}
            </h3>
            <div style={{ display: 'grid', gap: '18px' }}>
              {techTerms.map(({ term, def }) => (
                <div key={term}>
                  <dt style={{ fontSize: '15px', fontWeight: 600, color: colors.text1 }}>
                    {term}
                  </dt>
                  <dd
                    style={{
                      fontSize: '15px',
                      color: colors.text2,
                      lineHeight: '1.6',
                      margin: '4px 0 0 0',
                    }}
                  >
                    {def}
                  </dd>
                </div>
              ))}
            </div>
          </GlassPanel>

          {/* Privacy — Right */}
          <GlassPanel padding="32px">
            <h3
              style={{
                fontSize: '20px',
                fontWeight: 700,
                marginBottom: '16px',
                color: colors.accent,
              }}
            >
              {t('docs.privacy')}
            </h3>
            <p style={{ color: colors.text2, lineHeight: '1.8', fontSize: '16px' }}>
              {t('docs.privacyText')}
            </p>
          </GlassPanel>
        </div>
      </section>
    </div>
  );
}

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, GlassPanel, colors, fonts } from '@echos/ui';
import { useTranslation } from '../i18n/index.js';
import { IconImage, IconArrowRight } from '../components/Icons.js';

export function HomePage() {
  const navigate = useNavigate();
  const { t } = useTranslation();

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

  return (
    <div style={{ background: colors.black }}>
      {/* Hero */}
      <section
        style={{
          maxWidth: '1400px',
          margin: '0 auto',
          padding: 'clamp(48px, 8vw, 100px) clamp(20px, 5vw, 48px) clamp(32px, 4vw, 64px)',
        }}
      >
        {/* Logotype PNG - left-aligned */}
        <div style={{ marginBottom: '32px' }}>
          <img
            src={`${import.meta.env.BASE_URL}logotype.png`}
            alt="echos - donnees capturees"
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

      {/* Hero visual zone */}
      <section
        style={{
          maxWidth: '1400px',
          margin: '0 auto',
          padding: '0 clamp(20px, 5vw, 48px) clamp(48px, 5vw, 80px)',
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
          {/* Main hero visual */}
          <div className="visual-placeholder" style={{ minHeight: '240px' }}>
            <img
              src={`${import.meta.env.BASE_URL}hero-main.png`}
              alt=""
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
            <div style={{ position: 'absolute', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
              <IconImage size={32} color={colors.text3} />
              <span style={{ fontSize: '13px' }}>hero-main.png</span>
            </div>
          </div>
          {/* Side visual */}
          <div className="visual-placeholder" style={{ minHeight: '240px' }}>
            <img
              src={`${import.meta.env.BASE_URL}hero-side.png`}
              alt=""
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
            <div style={{ position: 'absolute', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
              <IconImage size={32} color={colors.text3} />
              <span style={{ fontSize: '13px' }}>hero-side.png</span>
            </div>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section style={{ maxWidth: '1400px', margin: '0 auto', padding: '0 clamp(20px, 5vw, 48px) clamp(40px, 4vw, 64px)' }}>
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
      <section style={{ maxWidth: '1400px', margin: '0 auto', padding: 'clamp(40px, 4vw, 64px) clamp(20px, 5vw, 48px)' }}>
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

      {/* Gallery */}
      <section style={{ maxWidth: '1400px', margin: '0 auto', padding: '0 clamp(20px, 5vw, 48px) clamp(48px, 6vw, 100px)' }}>
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

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gridAutoRows: '200px',
            gap: '16px',
          }}
        >
          {[
            { file: 'gallery-01.png', span: '2' },
            { file: 'gallery-03.png', span: '1' },
            { file: 'gallery-04.png', span: '1' },
            { file: 'gallery-05.png', span: '1' },
            { file: 'gallery-06.png', span: '1' },
          ].map((item) => (
            <div
              key={item.file}
              className="visual-placeholder"
              style={{
                gridColumn: item.span === '2' ? 'span 2' : 'span 1',
                minHeight: '200px',
              }}
            >
              <img
                src={`${import.meta.env.BASE_URL}${item.file}`}
                alt=""
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
              <div style={{ position: 'absolute', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
                <IconImage size={24} color={colors.text3} />
                <span style={{ fontSize: '11px' }}>{item.file}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Bottom CTA */}
      <section
        style={{
          maxWidth: '1400px',
          margin: '0 auto',
          padding: '0 clamp(20px, 5vw, 48px) clamp(64px, 6vw, 120px)',
          textAlign: 'center',
        }}
      >
        <div
          style={{
            background: colors.surface,
            border: `1px solid ${colors.border}`,
            borderRadius: '16px',
            padding: 'clamp(40px, 4vw, 64px)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
          }}
        >
          <h2
            style={{
              fontFamily: fonts.display,
              fontVariationSettings: "'wght' 600",
              fontSize: 'clamp(24px, 3vw, 36px)',
              lineHeight: 1.1,
              color: colors.text1,
              marginBottom: '16px',
            }}
          >
            {t('home.subtitle')}
          </h2>
          <p style={{ fontSize: '15px', color: colors.text3, maxWidth: '480px', lineHeight: 1.7, marginBottom: '28px' }}>
            {t('home.description')}
          </p>
          <Button variant="primary" size="lg" onClick={() => navigate('/scan')}>
            {t('home.cta')} <IconArrowRight size={16} />
          </Button>
        </div>
      </section>
    </div>
  );
}

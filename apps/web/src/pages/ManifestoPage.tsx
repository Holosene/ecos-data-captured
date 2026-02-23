import React from 'react';
import { useNavigate } from 'react-router-dom';
import { GlassPanel, Button, colors, fonts } from '@echos/ui';
import { useTranslation } from '../i18n/index.js';

export function ManifestoPage() {
  const navigate = useNavigate();
  const { t, tArray } = useTranslation();

  return (
    <div style={{ background: colors.black, padding: 'clamp(40px, 5vw, 80px) var(--content-gutter)' }}>
      <div>
        {/* Header - full width */}
        <h1
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
        </h1>
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

        {/* Two-column grid - Z-reading order */}
        <div
          className="manifesto-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '28px',
          }}
        >
          {/* Row 1, Left */}
          <GlassPanel padding="32px">
            <h2 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '16px', color: colors.text1 }}>
              {t('manifesto.s1.title')}
            </h2>
            <p style={{ color: colors.text2, lineHeight: '1.8', fontSize: '16px' }}>
              {t('manifesto.s1.p1')}
            </p>
            <p style={{ color: colors.text2, lineHeight: '1.8', fontSize: '16px', marginTop: '14px' }}>
              {t('manifesto.s1.p2')}
            </p>
          </GlassPanel>

          {/* Row 1, Right */}
          <GlassPanel padding="32px">
            <h2 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '16px', color: colors.text1 }}>
              {t('manifesto.s2.title')}
            </h2>
            <p style={{ color: colors.text2, lineHeight: '1.8', fontSize: '16px' }}>
              {t('manifesto.s2.p1')}
            </p>
            <p style={{ color: colors.text2, lineHeight: '1.8', fontSize: '16px', marginTop: '14px' }}>
              {t('manifesto.s2.p2')}
            </p>
          </GlassPanel>

          {/* Row 2, Left */}
          <GlassPanel padding="32px">
            <h2 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '16px', color: colors.text1 }}>
              {t('manifesto.s3.title')}
            </h2>
            <p style={{ color: colors.text2, lineHeight: '1.8', fontSize: '16px' }}>
              {t('manifesto.s3.p1')}
            </p>
            <p style={{ color: colors.text2, lineHeight: '1.8', fontSize: '16px', marginTop: '14px' }}>
              {t('manifesto.s3.p2')}
            </p>
          </GlassPanel>

          {/* Row 2, Right */}
          <GlassPanel padding="32px">
            <h2 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '16px', color: colors.text1 }}>
              {t('manifesto.s4.title')}
            </h2>
            <ul style={{ color: colors.text2, lineHeight: '1.8', fontSize: '16px', listStyle: 'none', padding: 0, display: 'grid', gap: '8px' }}>
              {tArray('manifesto.s4.items').map((item, i) => (
                <li key={i} style={{ display: 'flex', gap: '12px' }}>
                  <span style={{ color: colors.accent, flexShrink: 0 }}>-</span>
                  {item}
                </li>
              ))}
            </ul>
          </GlassPanel>

          {/* Row 3, full width */}
          <GlassPanel padding="32px" style={{ gridColumn: 'span 2' }}>
            <h2 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '16px', color: colors.text1 }}>
              {t('manifesto.s5.title')}
            </h2>
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

        <div style={{ textAlign: 'center', marginTop: '56px' }}>
          <Button variant="primary" size="lg" onClick={() => navigate('/scan')}>
            {t('manifesto.cta')}
          </Button>
        </div>
      </div>
    </div>
  );
}

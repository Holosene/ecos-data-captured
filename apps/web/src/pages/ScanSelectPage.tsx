import React from 'react';
import { useNavigate } from 'react-router-dom';
import { GlassPanel, Button, colors, fonts } from '@echos/ui';
import { useTranslation } from '../i18n/index.js';

function HoverCard({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = colors.accent;
        e.currentTarget.style.transform = 'translateY(-2px)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = colors.border;
        e.currentTarget.style.transform = 'translateY(0)';
      }}
      style={{
        background: colors.surface,
        border: `2px solid ${colors.border}`,
        borderRadius: '12px',
        padding: '28px',
        cursor: 'pointer',
        transition: 'border-color 200ms ease, transform 150ms ease',
      }}
    >
      {children}
    </div>
  );
}

export function ScanSelectPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();

  return (
    <div style={{ background: colors.black, minHeight: 'calc(100vh - 72px)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '32px var(--content-gutter)' }}>
      <h1 style={{
        fontFamily: fonts.display,
        fontVariationSettings: "'wght' 600",
        fontSize: 'clamp(24px, 3vw, 36px)',
        color: colors.text1,
        marginBottom: '8px',
        textAlign: 'center',
      }}>
        {t('scanSelect.title')}
      </h1>
      <p style={{ color: colors.text3, fontSize: '15px', marginBottom: '40px', textAlign: 'center', maxWidth: '500px', lineHeight: 1.6 }}>
        {t('scanSelect.desc')}
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', maxWidth: '700px', width: '100%' }}>
        {/* V2 — Current */}
        <HoverCard onClick={() => navigate('/scan/v2')}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: colors.accent, background: colors.accentMuted, padding: '2px 8px', borderRadius: '4px' }}>V2</span>
            <span style={{ fontSize: '12px', color: colors.text3 }}>{t('scanSelect.current')}</span>
          </div>
          <h3 style={{ color: colors.text1, fontSize: '18px', fontWeight: 600, marginBottom: '8px' }}>
            {t('scanSelect.v2.title')}
          </h3>
          <p style={{ color: colors.text2, fontSize: '13px', lineHeight: 1.6, marginBottom: '20px' }}>
            {t('scanSelect.v2.desc')}
          </p>
          <Button variant="primary" size="lg" style={{ width: '100%' }} onClick={(e: React.MouseEvent) => { e.stopPropagation(); navigate('/scan/v2'); }}>
            {t('scanSelect.v2.cta')}
          </Button>
        </HoverCard>

        {/* V1 — Classic */}
        <HoverCard onClick={() => navigate('/scan/classic')}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: colors.text3, background: colors.surface, padding: '2px 8px', borderRadius: '4px', border: `1px solid ${colors.border}` }}>V1</span>
            <span style={{ fontSize: '12px', color: colors.text3 }}>{t('scanSelect.classic')}</span>
          </div>
          <h3 style={{ color: colors.text1, fontSize: '18px', fontWeight: 600, marginBottom: '8px' }}>
            {t('scanSelect.v1.title')}
          </h3>
          <p style={{ color: colors.text2, fontSize: '13px', lineHeight: 1.6, marginBottom: '20px' }}>
            {t('scanSelect.v1.desc')}
          </p>
          <Button variant="secondary" size="lg" style={{ width: '100%' }} onClick={(e: React.MouseEvent) => { e.stopPropagation(); navigate('/scan/classic'); }}>
            {t('scanSelect.v1.cta')}
          </Button>
        </HoverCard>
      </div>
    </div>
  );
}

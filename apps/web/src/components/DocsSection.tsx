import React from 'react';
import { GlassPanel, colors, fonts } from '@echos/ui';
import { useTranslation } from '../i18n/index.js';

export function DocsSection() {
  const { t } = useTranslation();

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

  return (
    <div>
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
        {t('docs.title')}
      </h2>

      <div
        className="docs-grid"
        style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '28px' }}
      >
        <GlassPanel padding="32px">
          <h3 style={{ fontSize: '22px', fontWeight: 700, marginBottom: '24px', color: colors.accent }}>
            {t('docs.userGuide')}
          </h3>
          {stepsLeft.map(({ title, body }) => (
            <div key={title} style={{ marginBottom: '20px' }}>
              <h4 style={{ fontSize: '17px', fontWeight: 700, marginBottom: '8px', color: colors.text1 }}>{title}</h4>
              <p style={{ color: colors.text2, lineHeight: '1.8', fontSize: '15px' }}>{body}</p>
            </div>
          ))}
        </GlassPanel>

        <div style={{ display: 'grid', gap: '28px' }}>
          <GlassPanel padding="32px">
            <h3 style={{ fontSize: '22px', fontWeight: 700, marginBottom: '24px', color: colors.accent }}>
              {t('docs.userGuide')} (suite)
            </h3>
            {stepsRight.map(({ title, body }) => (
              <div key={title} style={{ marginBottom: '20px' }}>
                <h4 style={{ fontSize: '17px', fontWeight: 700, marginBottom: '8px', color: colors.text1 }}>{title}</h4>
                <p style={{ color: colors.text2, lineHeight: '1.8', fontSize: '15px' }}>{body}</p>
              </div>
            ))}
          </GlassPanel>

          <GlassPanel padding="32px">
            <h3 style={{ fontSize: '22px', fontWeight: 700, marginBottom: '16px', color: colors.accent }}>
              {t('docs.coordSystem')}
            </h3>
            <ul style={{ color: colors.text2, lineHeight: '2', fontSize: '15px', paddingLeft: '20px' }}>
              <li><strong style={{ color: colors.text1 }}>X</strong> <span style={{ color: colors.accent }}>-</span> {t('docs.coordX')}</li>
              <li><strong style={{ color: colors.text1 }}>Y</strong> <span style={{ color: colors.accent }}>-</span> {t('docs.coordY')}</li>
              <li><strong style={{ color: colors.text1 }}>Z</strong> <span style={{ color: colors.accent }}>-</span> {t('docs.coordZ')}</li>
            </ul>
            <p style={{ color: colors.text2, lineHeight: '1.8', fontSize: '14px', marginTop: '14px', fontFamily: 'var(--font-mono)' }}>
              {t('docs.coordNote')}
            </p>
          </GlassPanel>
        </div>

        <GlassPanel padding="32px">
          <h3 style={{ fontSize: '22px', fontWeight: 700, marginBottom: '24px', color: colors.accent }}>
            {t('docs.techConcepts')}
          </h3>
          <div style={{ display: 'grid', gap: '18px' }}>
            {techTerms.map(({ term, def }) => (
              <div key={term}>
                <dt style={{ fontSize: '15px', fontWeight: 600, color: colors.text1 }}>{term}</dt>
                <dd style={{ fontSize: '15px', color: colors.text2, lineHeight: '1.6', margin: '4px 0 0 0' }}>{def}</dd>
              </div>
            ))}
          </div>
        </GlassPanel>

        <GlassPanel padding="32px">
          <h3 style={{ fontSize: '22px', fontWeight: 700, marginBottom: '16px', color: colors.accent }}>
            {t('docs.privacy')}
          </h3>
          <p style={{ color: colors.text2, lineHeight: '1.8', fontSize: '16px' }}>
            {t('docs.privacyText')}
          </p>
        </GlassPanel>
      </div>
    </div>
  );
}

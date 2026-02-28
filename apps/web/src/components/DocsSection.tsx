import React from 'react';
import { GlassPanel, colors, fonts } from '@echos/ui';
import { useTranslation } from '../i18n/index.js';

export function DocsSection() {
  const { t } = useTranslation();

  const guideSteps = [
    { title: t('docs.step1.title'), body: t('docs.step1.body') },
    { title: t('docs.step2.title'), body: t('docs.step2.body') },
    { title: t('docs.step3.title'), body: t('docs.step3.body') },
    { title: t('docs.step4.title'), body: t('docs.step4.body') },
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
          marginBottom: '20px',
        }}
      >
        {t('docs.title')}
      </h2>

      <div
        className="docs-grid"
        style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', alignItems: 'stretch' }}
      >
        {/* Left column: User Guide + Privacy — stacked, never side-by-side */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <GlassPanel padding="24px" style={{ flex: 1 }}>
            <h3 style={{ fontSize: '20px', fontWeight: 700, marginBottom: '20px', color: colors.accent }}>
              {t('docs.userGuide')}
            </h3>
            {guideSteps.map(({ title, body }, i) => (
              <div key={title} style={{ marginBottom: i < guideSteps.length - 1 ? '16px' : 0 }}>
                <h4 style={{ fontSize: '15px', fontWeight: 700, marginBottom: '4px', color: colors.text1 }}>{title}</h4>
                <p style={{ color: colors.text2, lineHeight: '1.6', fontSize: '14px', margin: 0 }}>{body}</p>
              </div>
            ))}
          </GlassPanel>

          <GlassPanel padding="20px">
            <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '10px', color: colors.accent }}>
              {t('docs.privacy')}
            </h3>
            <p style={{ color: colors.text2, lineHeight: '1.6', fontSize: '13px', margin: 0 }}>
              {t('docs.privacyText')}
            </p>
          </GlassPanel>
        </div>

        {/* Right column: Tech Concepts + Coord System — stacked, never side-by-side */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <GlassPanel padding="24px" style={{ flex: 1 }}>
            <h3 style={{ fontSize: '20px', fontWeight: 700, marginBottom: '12px', color: colors.accent }}>
              {t('docs.techConcepts')}
            </h3>
            <div style={{ display: 'grid', gap: '10px' }}>
              {techTerms.map(({ term, def }) => (
                <div key={term}>
                  <dt style={{ fontSize: '14px', fontWeight: 600, color: colors.text1 }}>{term}</dt>
                  <dd style={{ fontSize: '13px', color: colors.text2, lineHeight: '1.5', margin: '2px 0 0 0' }}>{def}</dd>
                </div>
              ))}
            </div>
          </GlassPanel>

          <GlassPanel padding="20px">
            <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '10px', color: colors.accent }}>
              {t('docs.coordSystem')}
            </h3>
            <ul style={{ color: colors.text2, lineHeight: '1.7', fontSize: '13px', paddingLeft: '16px', margin: 0 }}>
              <li><strong style={{ color: colors.text1 }}>X</strong> — {t('docs.coordX')}</li>
              <li><strong style={{ color: colors.text1 }}>Y</strong> — {t('docs.coordY')}</li>
              <li><strong style={{ color: colors.text1 }}>Z</strong> — {t('docs.coordZ')}</li>
            </ul>
            <p style={{ color: colors.text3, lineHeight: '1.5', fontSize: '11px', marginTop: '8px', marginBottom: 0, fontFamily: 'var(--font-mono)' }}>
              {t('docs.coordNote')}
            </p>
          </GlassPanel>
        </div>
      </div>
    </div>
  );
}

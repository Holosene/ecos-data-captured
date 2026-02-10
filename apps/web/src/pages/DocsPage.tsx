import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, colors } from '@echos/ui';
import { useTranslation } from '../i18n/index.js';
import { DocsSection } from '../components/DocsSection.js';

export function DocsPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();

  return (
    <div style={{ background: colors.black, padding: 'clamp(40px, 5vw, 80px) var(--content-gutter)' }}>
      <DocsSection />
      <div style={{ textAlign: 'center', marginTop: '56px' }}>
        <Button variant="primary" size="lg" onClick={() => navigate('/scan')}>
          {t('docs.cta')}
        </Button>
      </div>
    </div>
  );
}

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, GlassPanel, colors, fonts } from '@echos/ui';

const FEATURES = [
  { title: 'Import', desc: 'Drop your sonar MP4 and GPS track. ECHOS reads metadata instantly.', num: '01' },
  { title: 'Crop & Calibrate', desc: 'Isolate the echo region, set depth and resolution parameters.', num: '02' },
  { title: 'Generate', desc: 'Build a 3D volume from frames mapped to GPS coordinates.', num: '03' },
  { title: 'Explore & Export', desc: 'Slice views, color presets, NRRD export for 3D Slicer / ParaView.', num: '04' },
];

const STATS = [
  { value: '100%', label: 'Client-side' },
  { value: '6', label: 'Steps' },
  { value: 'NRRD', label: 'Export' },
  { value: '0', label: 'Data sent' },
];

export function HomePage() {
  const navigate = useNavigate();

  return (
    <div style={{ background: colors.black }}>
      {/* Hero */}
      <section style={{ maxWidth: '1200px', margin: '0 auto', padding: '80px 24px 48px', textAlign: 'center' }}>
        <h1
          style={{
            fontFamily: fonts.display,
            fontVariationSettings: "'wght' 500",
            fontSize: 'clamp(48px, 8vw, 80px)',
            lineHeight: 0.85,
            letterSpacing: '-0.03em',
            color: colors.text1,
            marginBottom: '16px',
          }}
        >
          echos
        </h1>
        <p
          style={{
            fontFamily: fonts.display,
            fontVariationSettings: "'wght' 400",
            fontSize: 'clamp(22px, 3.5vw, 36px)',
            lineHeight: 0.92,
            letterSpacing: '-0.01em',
            color: colors.text2,
            maxWidth: '600px',
            margin: '0 auto 40px',
          }}
        >
          Archive perceptive des fonds aquatiques
        </p>
        <p style={{ fontSize: '15px', color: colors.text3, maxWidth: '520px', margin: '0 auto 40px', lineHeight: 1.6 }}>
          Transformez vos captures d'ecran sonar et traces GPS en volumes 3D explorables. Tout se passe dans votre navigateur.
        </p>
        <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
          <Button variant="primary" size="lg" onClick={() => navigate('/scan')}>
            Start New Scan
          </Button>
          <Button variant="secondary" size="lg" onClick={() => navigate('/manifesto')}>
            Manifesto
          </Button>
        </div>
      </section>

      {/* Stats */}
      <section style={{ maxWidth: '720px', margin: '0 auto', padding: '0 24px 48px' }}>
        <div
          style={{
            display: 'flex',
            background: colors.surface,
            border: `1px solid ${colors.border}`,
            borderRadius: '12px',
            padding: '20px 0',
          }}
        >
          {STATS.map((stat, i) => (
            <div
              key={stat.label}
              style={{
                textAlign: 'center',
                padding: '0 24px',
                borderRight: i < STATS.length - 1 ? `1px solid ${colors.border}` : 'none',
                flex: 1,
              }}
            >
              <div style={{ fontSize: '20px', fontWeight: 600, color: colors.text1, fontVariantNumeric: 'tabular-nums' }}>
                {stat.value}
              </div>
              <div style={{ fontSize: '12px', color: colors.text3, marginTop: '2px' }}>{stat.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section style={{ maxWidth: '1200px', margin: '0 auto', padding: '0 24px 80px' }}>
        <h2
          style={{
            fontSize: '12px',
            fontWeight: 600,
            color: colors.text3,
            textTransform: 'uppercase',
            letterSpacing: '1.5px',
            marginBottom: '24px',
            textAlign: 'center',
          }}
        >
          How it works
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px' }}>
          {FEATURES.map((f) => (
            <GlassPanel key={f.title} padding="24px">
              <div style={{ fontSize: '11px', fontWeight: 600, color: colors.accent, fontVariantNumeric: 'tabular-nums', marginBottom: '12px', letterSpacing: '0.5px' }}>
                {f.num}
              </div>
              <h3 style={{ fontSize: '16px', fontWeight: 600, color: colors.text1, marginBottom: '8px' }}>{f.title}</h3>
              <p style={{ fontSize: '13px', color: colors.text2, lineHeight: 1.5 }}>{f.desc}</p>
            </GlassPanel>
          ))}
        </div>
      </section>
    </div>
  );
}

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { GlassPanel, Button, colors, fonts } from '@echos/ui';

export function ManifestoPage() {
  const navigate = useNavigate();

  return (
    <div style={{ background: colors.black, padding: '48px 24px 80px' }}>
      <div style={{ maxWidth: '720px', margin: '0 auto' }}>
        <h1
          style={{
            fontFamily: fonts.display,
            fontVariationSettings: "'wght' 500",
            fontSize: '42px',
            lineHeight: 0.85,
            letterSpacing: '-0.02em',
            color: colors.text1,
            marginBottom: '12px',
          }}
        >
          Manifesto
        </h1>
        <p
          style={{
            fontFamily: fonts.display,
            fontVariationSettings: "'wght' 400",
            fontSize: '20px',
            lineHeight: 0.92,
            color: colors.accent,
            marginBottom: '48px',
          }}
        >
          On the captured echo and the perceptive archive
        </p>

        <div style={{ display: 'grid', gap: '24px' }}>
          <GlassPanel>
            <h2 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '12px', color: colors.text1 }}>
              The confined measurement
            </h2>
            <p style={{ color: colors.text2, lineHeight: '1.7', fontSize: '14px' }}>
              Consumer sonar devices — fishfinders, depth sounders — produce a real acoustic
              measurement. Sound travels through water, bounces off the bottom, off vegetation,
              off suspended matter. The device captures this echo and turns it into an image.
            </p>
            <p style={{ color: colors.text2, lineHeight: '1.7', fontSize: '14px', marginTop: '12px' }}>
              But this measurement is confined. The raw data — the acoustic samples, the return
              signal envelopes — are locked inside proprietary systems. You cannot export them.
              The screen becomes the only sanctioned output.
            </p>
          </GlassPanel>

          <GlassPanel>
            <h2 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '12px', color: colors.text1 }}>
              The screen as primary source
            </h2>
            <p style={{ color: colors.text2, lineHeight: '1.7', fontSize: '14px' }}>
              When the raw data is unreachable, the screen image becomes the primary source.
              Not a perfect source — it carries the biases of rendering algorithms, color maps,
              gain settings, screen resolution. But it is a faithful trace of what the instrument
              "decided to show."
            </p>
            <p style={{ color: colors.text2, lineHeight: '1.7', fontSize: '14px', marginTop: '12px' }}>
              ECHOS takes this position seriously: the screen recording is not a degraded copy
              of something better. It is the most accessible, most shareable, most reproducible
              form of the sonar observation.
            </p>
          </GlassPanel>

          <GlassPanel>
            <h2 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '12px', color: colors.text1 }}>
              The perceptive archive
            </h2>
            <p style={{ color: colors.text2, lineHeight: '1.7', fontSize: '14px' }}>
              By combining a screen capture (MP4) with a simultaneous GPS trace (GPX), ECHOS
              builds a spatial volume — a three-dimensional reconstruction of what the sonar
              showed, placed in geographic context. This is not a bathymetric survey. It claims
              perceptive coherence.
            </p>
            <p style={{ color: colors.text2, lineHeight: '1.7', fontSize: '14px', marginTop: '12px' }}>
              The result is a volume you can slice, rotate, explore. A readable archive of an
              underwater observation session. An "echo of echoes" — captured, structured, opened.
            </p>
          </GlassPanel>

          <GlassPanel>
            <h2 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '12px', color: colors.text1 }}>
              What ECHOS is not
            </h2>
            <ul style={{ color: colors.text2, lineHeight: '1.7', fontSize: '14px', listStyle: 'none', padding: 0, display: 'grid', gap: '6px' }}>
              {[
                'Not a bathymetric tool — it does not produce metrically calibrated depth maps.',
                'Not a scientific instrument — the source data is a screen image, not raw acoustic samples.',
                'Not a replacement for professional survey software.',
                'Not dependent on any sonar brand or protocol.',
              ].map((item, i) => (
                <li key={i} style={{ display: 'flex', gap: '10px' }}>
                  <span style={{ color: colors.text3, flexShrink: 0 }}>--</span>
                  {item}
                </li>
              ))}
            </ul>
          </GlassPanel>

          <GlassPanel>
            <h2 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '12px', color: colors.text1 }}>
              What ECHOS is
            </h2>
            <ul style={{ color: colors.text2, lineHeight: '1.7', fontSize: '14px', listStyle: 'none', padding: 0, display: 'grid', gap: '6px' }}>
              {[
                'A tool for building readable, shareable, explorable volumes from consumer sonar screens.',
                'An assertion that the screen capture is a valid primary source.',
                'An accessible bridge between consumer devices and scientific visualization.',
                'An open archive format for underwater perceptive data.',
                'A starting point — not an endpoint.',
              ].map((item, i) => (
                <li key={i} style={{ display: 'flex', gap: '10px' }}>
                  <span style={{ color: colors.accent, flexShrink: 0 }}>+</span>
                  {item}
                </li>
              ))}
            </ul>
          </GlassPanel>
        </div>

        <div style={{ textAlign: 'center', marginTop: '48px' }}>
          <Button variant="primary" onClick={() => navigate('/scan')}>
            Start Using ECHOS
          </Button>
        </div>
      </div>
    </div>
  );
}

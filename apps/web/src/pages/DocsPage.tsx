import React from 'react';
import { useNavigate } from 'react-router-dom';
import { GlassPanel, Button, colors, fonts } from '@echos/ui';

export function DocsPage() {
  const navigate = useNavigate();

  return (
    <div style={{ background: colors.black, padding: '48px 24px 80px' }}>
      <div style={{ maxWidth: '720px', margin: '0 auto' }}>
        <h1
          style={{
            fontFamily: fonts.display,
            fontVariationSettings: "'wght' 500",
            fontSize: '36px',
            lineHeight: 0.85,
            letterSpacing: '-0.02em',
            color: colors.text1,
            marginBottom: '32px',
          }}
        >
          Documentation
        </h1>

        <div style={{ display: 'grid', gap: '24px' }}>
          <GlassPanel>
            <h2 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '16px', color: colors.accent }}>
              User Guide
            </h2>

            {[
              { title: '1. Recording', body: 'Record your sonar screen using your phone or tablet\'s built-in screen recording. Simultaneously, start a GPS tracking app (like GPX Recorder, Strava, or any app that exports .gpx files). Both recordings should cover the same time period.' },
              { title: '2. Import', body: 'Drag and drop your MP4 video and GPX file into the import step. ECHOS reads video metadata (resolution, duration) and parses the GPX track (points, distance, timestamps).' },
              { title: '3. Crop', body: 'Draw a rectangle over the sonar echo display. Exclude menus, toolbars, depth scales, and decorations. Only the actual echo image should be inside the crop.' },
              { title: '4. Calibrate', body: 'Set the Depth Max — the maximum depth shown on your sonar screen. Adjust FPS extraction (2 is usually enough), downscale factor (0.5 saves memory), and Y step (distance between slices).' },
              { title: '5. Sync', body: 'By default, the video start aligns with the GPX start. If there\'s a time difference, use the offset slider to adjust. The distance-time chart helps you verify alignment.' },
              { title: '6. Generate', body: 'Choose "Quick Preview" to verify settings, or "Full Generation" for the complete volume. All processing happens in your browser — no data is sent to any server.' },
              { title: '7. View & Export', body: 'Explore the volume using three orthogonal slice views with color presets. Export as NRRD (compatible with 3D Slicer, ParaView), mapping JSON, QC report, and session settings.' },
            ].map(({ title, body }) => (
              <div key={title} style={{ marginBottom: '16px' }}>
                <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '6px', color: colors.text1 }}>{title}</h3>
                <p style={{ color: colors.text2, lineHeight: '1.7', fontSize: '14px' }}>{body}</p>
              </div>
            ))}
          </GlassPanel>

          <GlassPanel>
            <h2 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '16px', color: colors.accent }}>
              Technical Concepts
            </h2>
            <div style={{ display: 'grid', gap: '14px' }}>
              {[
                { term: 'Crop Region', def: 'The rectangle that isolates the sonar echo display from the screen recording.' },
                { term: 'Depth Max', def: 'The maximum depth shown on the sonar screen, in meters. Calibrates the Z axis.' },
                { term: 'Y Step', def: 'Distance interval between resampled volume slices along the GPS track.' },
                { term: 'FPS Extraction', def: 'Frames per second extracted from the video. Higher = more data but slower.' },
                { term: 'Downscale Factor', def: 'Spatial scaling applied to each frame. 0.5 = half resolution.' },
                { term: 'NRRD', def: 'Nearly Raw Raster Data — a standard volumetric format for 3D Slicer, ParaView, ITK.' },
                { term: 'Transfer Function', def: 'A color and opacity mapping applied to volume intensity values.' },
              ].map(({ term, def }) => (
                <div key={term}>
                  <dt style={{ fontSize: '13px', fontWeight: 600, color: colors.text1 }}>{term}</dt>
                  <dd style={{ fontSize: '13px', color: colors.text2, lineHeight: '1.5', margin: '4px 0 0 0' }}>{def}</dd>
                </div>
              ))}
            </div>
          </GlassPanel>

          <GlassPanel>
            <h2 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '12px', color: colors.accent }}>
              Volume Coordinate System
            </h2>
            <ul style={{ color: colors.text2, lineHeight: '1.8', fontSize: '14px', paddingLeft: '20px' }}>
              <li><strong style={{ color: colors.text1 }}>X</strong> — Horizontal position in the sonar image</li>
              <li><strong style={{ color: colors.text1 }}>Y</strong> — Distance along the GPS track (meters)</li>
              <li><strong style={{ color: colors.text1 }}>Z</strong> — Depth (0 = surface, depth_max = bottom)</li>
            </ul>
            <p style={{ color: colors.text2, lineHeight: '1.7', fontSize: '14px', marginTop: '12px' }}>
              Data stored as Float32 [0, 1]. Array indexed: data[z * dimY * dimX + y * dimX + x].
            </p>
          </GlassPanel>

          <GlassPanel>
            <h2 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '12px', color: colors.accent }}>
              Privacy & Processing
            </h2>
            <p style={{ color: colors.text2, lineHeight: '1.7', fontSize: '14px' }}>
              All processing happens locally in your web browser. No video, GPS, or volume data
              is ever sent to a server. The application is a static site hosted on GitHub Pages.
            </p>
          </GlassPanel>
        </div>

        <div style={{ textAlign: 'center', marginTop: '48px' }}>
          <Button variant="primary" onClick={() => navigate('/scan')}>
            Start Scanning
          </Button>
        </div>
      </div>
    </div>
  );
}

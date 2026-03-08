/**
 * ECOS — Session Viewer Page
 *
 * Loads a pre-generated session from the manifest and displays
 * the volume viewer without requiring the full processing pipeline.
 *
 * Route: /session/:sessionId
 *
 * Flow:
 *   1. Read sessionId from URL params
 *   2. Look up manifest entry for volume file paths
 *   3. Lazy-fetch the .echos-vol binary on demand
 *   4. Deserialize → display in VolumeViewer
 */

import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { GlassPanel, Button, ProgressBar, colors, fonts } from '@echos/ui';
import {
  deserializeVolume,
  fetchSessionVolume,
} from '@echos/core';
import type { SessionManifestEntry, VolumeSnapshot } from '@echos/core';
import { useAppState } from '../store/app-state.js';
import { useTranslation } from '../i18n/index.js';
import { VolumeViewer } from '../components/VolumeViewer.js';

type LoadState = 'idle' | 'loading' | 'ready' | 'error';

export default function SessionViewerPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const { state } = useAppState();
  const { t } = useTranslation();

  const [loadState, setLoadState] = useState<LoadState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

  // Volume data
  const [instrumentData, setInstrumentData] = useState<Float32Array | null>(null);
  const [instrumentDims, setInstrumentDims] = useState<[number, number, number]>([1, 1, 1]);
  const [instrumentExtent, setInstrumentExtent] = useState<[number, number, number]>([1, 1, 1]);
  const [spatialData, setSpatialData] = useState<Float32Array | null>(null);
  const [spatialDims, setSpatialDims] = useState<[number, number, number]>([1, 1, 1]);
  const [spatialExtent, setSpatialExtent] = useState<[number, number, number]>([1, 1, 1]);

  // Find manifest entry
  const entry = state.manifestEntries.find((e) => e.id === sessionId);
  const session = state.sessions.find((s) => s.id === sessionId);
  const gpxTrackPoints = sessionId ? state.gpxTracks.get(sessionId) : undefined;

  const basePath = import.meta.env.BASE_URL ?? '/ecos-data-captured/';

  const loadVolumes = useCallback(async () => {
    if (!entry || !sessionId) return;

    setLoadState('loading');
    setError(null);
    setProgress(0);

    try {
      const fetches: Promise<void>[] = [];

      // Load instrument volume
      if (entry.files.volumeInstrument) {
        fetches.push(
          fetchSessionVolume(basePath, sessionId, entry.files.volumeInstrument)
            .then((buffer) => {
              const snap = deserializeVolume(buffer);
              setInstrumentData(snap.data);
              setInstrumentDims(snap.dimensions);
              setInstrumentExtent(snap.extent);
              setProgress((p) => Math.min(p + 50, 100));
            }),
        );
      }

      // Load spatial volume
      if (entry.files.volumeSpatial) {
        fetches.push(
          fetchSessionVolume(basePath, sessionId, entry.files.volumeSpatial)
            .then((buffer) => {
              const snap = deserializeVolume(buffer);
              setSpatialData(snap.data);
              setSpatialDims(snap.dimensions);
              setSpatialExtent(snap.extent);
              setProgress((p) => Math.min(p + 50, 100));
            }),
        );
      }

      await Promise.all(fetches);
      setProgress(100);
      setLoadState('ready');
    } catch (err) {
      setError((err as Error).message);
      setLoadState('error');
    }
  }, [entry, sessionId, basePath]);

  // Auto-load when entry is available
  useEffect(() => {
    if (entry && loadState === 'idle') {
      loadVolumes();
    }
  }, [entry, loadState, loadVolumes]);

  // Session not found
  if (!sessionId || (!entry && state.manifestLoaded)) {
    return (
      <div style={{ padding: '80px var(--content-gutter)', textAlign: 'center', background: colors.black, minHeight: '60vh' }}>
        <h2 style={{ color: colors.text1, fontSize: '24px', fontWeight: 600, marginBottom: '16px' }}>
          Session introuvable
        </h2>
        <p style={{ color: colors.text3, fontSize: '14px', marginBottom: '32px' }}>
          La session "{sessionId}" n'existe pas dans le registre.
        </p>
        <Button variant="primary" size="md" onClick={() => navigate('/')}>
          Retour
        </Button>
      </div>
    );
  }

  // Loading state
  if (loadState === 'loading' || loadState === 'idle') {
    return (
      <div style={{ padding: '80px var(--content-gutter)', background: colors.black, minHeight: '60vh' }}>
        <div style={{ maxWidth: '480px', margin: '0 auto', textAlign: 'center' }}>
          <h2 style={{
            fontFamily: fonts.display,
            fontVariationSettings: "'wght' 600",
            fontSize: 'clamp(20px, 2.5vw, 28px)',
            color: colors.text1,
            marginBottom: '8px',
          }}>
            {entry?.name ?? 'Chargement...'}
          </h2>
          {session && (
            <p style={{ color: colors.text3, fontSize: '13px', marginBottom: '32px' }}>
              {session.totalDistanceM.toFixed(0)}m &bull; {(session.durationS / 60).toFixed(1)}min &bull; {session.frameCount} frames
            </p>
          )}
          <GlassPanel padding="24px">
            <p style={{ color: colors.text2, fontSize: '14px', marginBottom: '16px' }}>
              Chargement du volume pré-généré...
            </p>
            <ProgressBar progress={progress / 100} />
          </GlassPanel>
        </div>
      </div>
    );
  }

  // Error state
  if (loadState === 'error') {
    return (
      <div style={{ padding: '80px var(--content-gutter)', background: colors.black, minHeight: '60vh' }}>
        <div style={{ maxWidth: '480px', margin: '0 auto', textAlign: 'center' }}>
          <h2 style={{ color: colors.text1, fontSize: '24px', fontWeight: 600, marginBottom: '16px' }}>
            Erreur de chargement
          </h2>
          <GlassPanel padding="24px" style={{ marginBottom: '24px' }}>
            <p style={{ color: colors.error, fontSize: '14px' }}>{error}</p>
          </GlassPanel>
          <p style={{ color: colors.text3, fontSize: '13px', marginBottom: '24px' }}>
            Le fichier volume (.echos-vol) n'a pas pu être chargé. Il sera disponible après la première génération.
          </p>
          <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
            <Button variant="secondary" size="md" onClick={() => navigate('/')}>
              Retour
            </Button>
            <Button variant="primary" size="md" onClick={() => { setLoadState('idle'); }}>
              Réessayer
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Build GPX track object for viewer
  const gpxTrackObj = gpxTrackPoints && gpxTrackPoints.length > 0 && session
    ? {
        points: gpxTrackPoints,
        totalDistanceM: session.totalDistanceM,
        durationS: session.durationS,
      }
    : undefined;

  // Ready — render VolumeViewer
  return (
    <div style={{ background: colors.black, minHeight: 'calc(100vh - 72px)' }}>
      {/* Session header bar */}
      <div style={{
        padding: '12px var(--content-gutter)',
        display: 'flex',
        alignItems: 'center',
        gap: '16px',
        borderBottom: `1px solid ${colors.border}`,
      }}>
        <button
          onClick={() => navigate('/')}
          style={{
            background: 'none',
            border: `1px solid ${colors.border}`,
            borderRadius: '8px',
            padding: '6px 14px',
            color: colors.text2,
            fontSize: '13px',
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          &larr; Retour
        </button>
        <div style={{ flex: 1 }}>
          <span style={{
            fontFamily: fonts.display,
            fontVariationSettings: "'wght' 600",
            fontSize: '16px',
            color: colors.text1,
          }}>
            {entry?.name ?? sessionId}
          </span>
          {session && (
            <span style={{ marginLeft: '12px', fontSize: '12px', color: colors.text3 }}>
              {session.totalDistanceM.toFixed(0)}m &bull; {(session.durationS / 60).toFixed(1)}min &bull;
              {session.gridDimensions[0]}×{session.gridDimensions[1]}×{session.gridDimensions[2]}
            </span>
          )}
        </div>
        <span style={{
          padding: '4px 10px',
          borderRadius: '9999px',
          background: colors.accentMuted,
          color: colors.accent,
          fontSize: '11px',
          fontWeight: 500,
        }}>
          pré-généré
        </span>
      </div>

      {/* Volume viewer */}
      <VolumeViewer
        volumeData={instrumentData}
        dimensions={instrumentDims}
        extent={instrumentExtent}
        spatialData={spatialData}
        spatialDimensions={spatialDims}
        spatialExtent={spatialExtent}
        gpxTrack={gpxTrackObj}
        videoFileName={entry?.videoFileName}
        gpxFileName={entry?.gpxFileName}
        beam={entry?.beam}
        grid={entry ? { resX: entry.gridDimensions[0], resY: entry.gridDimensions[1], resZ: entry.gridDimensions[2] } : undefined}
        onNewScan={() => navigate('/scan')}
      />
    </div>
  );
}

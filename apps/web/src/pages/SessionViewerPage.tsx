/**
 * ECOS — Session Viewer Page
 *
 * Loads a pre-generated session from the manifest and displays
 * the volume viewer — identical layout to the ScanPage viewer phase,
 * with a slim top bar showing back button + "pré-généré" badge.
 *
 * Route: /session/:sessionId
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
import { ViewerErrorBoundary } from '../components/ErrorBoundary.js';
import { loadVolume as loadVolumeFromIDB } from '../store/session-db.js';

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
  const [classicData, setClassicData] = useState<Float32Array | null>(null);
  const [classicDims, setClassicDims] = useState<[number, number, number]>([1, 1, 1]);
  const [classicExtent, setClassicExtent] = useState<[number, number, number]>([1, 1, 1]);

  // Find manifest entry
  const entry = state.manifestEntries.find((e) => e.id === sessionId);
  const session = state.sessions.find((s) => s.id === sessionId);
  const gpxTrackPoints = sessionId ? state.gpxTracks.get(sessionId) : undefined;

  const basePath = import.meta.env.BASE_URL ?? '/ecos-data-captured/';

  /** Try IndexedDB first (user-published sessions), then fall back to static files. */
  const loadVolumes = useCallback(async () => {
    if (!entry || !sessionId) return;

    setLoadState('loading');
    setError(null);
    setProgress(0);

    try {
      // ── Try IndexedDB first ──
      try {
        const idbBuffer = await loadVolumeFromIDB(sessionId, 'instrument');
        if (idbBuffer) {
          const snap = deserializeVolume(idbBuffer);
          setInstrumentData(snap.data);
          setInstrumentDims(snap.dimensions);
          setInstrumentExtent(snap.extent);
          setProgress(50);

          const idbSpatial = await loadVolumeFromIDB(sessionId, 'spatial');
          if (idbSpatial) {
            const snapS = deserializeVolume(idbSpatial);
            setSpatialData(snapS.data);
            setSpatialDims(snapS.dimensions);
            setSpatialExtent(snapS.extent);
          }
          const idbClassic = await loadVolumeFromIDB(sessionId, 'classic');
          if (idbClassic) {
            const snapCl = deserializeVolume(idbClassic);
            setClassicData(snapCl.data);
            setClassicDims(snapCl.dimensions);
            setClassicExtent(snapCl.extent);
          }
          setProgress(100);
          setLoadState('ready');
          return;
        }
      } catch {
        // IndexedDB not available or empty — try static files
      }

      // ── Fall back to static files ──
      const fetches: Promise<void>[] = [];

      if (entry.files.volumeInstrument) {
        fetches.push(
          fetchSessionVolume(basePath, sessionId, entry.files.volumeInstrument)
            .then((buffer: ArrayBuffer) => {
              const snap = deserializeVolume(buffer);
              setInstrumentData(snap.data);
              setInstrumentDims(snap.dimensions);
              setInstrumentExtent(snap.extent);
              setProgress((p) => Math.min(p + 50, 100));
            }),
        );
      }

      if (entry.files.volumeSpatial) {
        fetches.push(
          fetchSessionVolume(basePath, sessionId, entry.files.volumeSpatial)
            .then((buffer: ArrayBuffer) => {
              const snap = deserializeVolume(buffer);
              setSpatialData(snap.data);
              setSpatialDims(snap.dimensions);
              setSpatialExtent(snap.extent);
              setProgress((p) => Math.min(p + 30, 100));
            }),
        );
      }

      if (entry.files.volumeClassic) {
        fetches.push(
          fetchSessionVolume(basePath, sessionId, entry.files.volumeClassic)
            .then((buffer: ArrayBuffer) => {
              const snap = deserializeVolume(buffer);
              setClassicData(snap.data);
              setClassicDims(snap.dimensions);
              setClassicExtent(snap.extent);
              setProgress((p) => Math.min(p + 20, 100));
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

  // Build GPX track object for viewer
  const gpxTrackObj = (gpxTrackPoints && gpxTrackPoints.length > 0 && session)
    ? {
        points: gpxTrackPoints,
        totalDistanceM: session.totalDistanceM,
        durationS: session.durationS,
      }
    : undefined;

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
            <ProgressBar value={progress / 100} />
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

  // Ready — render exactly like ScanPage viewer phase
  return (
    <div style={{ background: colors.black, minHeight: 'calc(100vh - 72px)', display: 'flex', flexDirection: 'column' }}>
      {/* Slim top bar — matches ScanPage publish bar layout */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        padding: '10px 16px',
        borderBottom: `1px solid ${colors.border}`,
        flexShrink: 0,
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
            transition: 'all 150ms ease',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = colors.accent; e.currentTarget.style.color = colors.accent; }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = colors.border; e.currentTarget.style.color = colors.text2; }}
        >
          &larr; Retour
        </button>
        <div style={{ flex: 1 }} />
        <span style={{
          padding: '5px 14px',
          borderRadius: '9999px',
          background: colors.accentMuted,
          color: colors.accent,
          fontSize: '12px',
          fontWeight: 600,
          letterSpacing: '0.02em',
        }}>
          pré-généré
        </span>
      </div>

      {/* Volume viewer — identical component as ScanPage */}
      <ViewerErrorBoundary onReset={() => navigate('/')}>
        <VolumeViewer
          volumeData={instrumentData}
          dimensions={instrumentDims}
          extent={instrumentExtent}
          spatialData={spatialData}
          spatialDimensions={spatialDims}
          spatialExtent={spatialExtent}
          classicData={classicData}
          classicDimensions={classicDims}
          classicExtent={classicExtent}
          beam={entry?.beam}
          grid={entry ? { resX: entry.gridDimensions[0], resY: entry.gridDimensions[1], resZ: entry.gridDimensions[2] } : undefined}
          gpxTrack={gpxTrackObj}
          videoFileName={entry?.videoFileName ?? entry?.name}
          gpxFileName={entry?.gpxFileName}
          videoDurationS={session ? session.durationS : undefined}
          onNewScan={() => navigate('/scan')}
          onClose={() => navigate('/')}
        />
      </ViewerErrorBoundary>
    </div>
  );
}

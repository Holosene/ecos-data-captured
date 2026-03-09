/**
 * ECOS — Session Page
 *
 * Loads a pre-computed session by slug from the URL.
 * Tries to fetch the .echos-vol binary; if 404, redirects
 * to the scan page with example data pre-loaded.
 */

import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { GlassPanel, Button, colors } from '@echos/ui';
import { deserializeVolume } from '@echos/core';
import { useAppState } from '../store/app-state.js';
import { useTranslation } from '../i18n/index.js';
import { parseGpx } from '@echos/core';

/** Known session manifests — maps slug to example files. */
const SESSION_MANIFEST: Record<string, { video: string; gpx: string; volume?: string }> = {
  'exemple-lac-bourget': {
    video: 'exemple_video_2026-02-28_at_00.05.10.mp4',
    gpx: 'exemple_22_févr._2026_15_35_50.gpx',
    volume: 'exemple-lac-bourget.echos-vol',
  },
};

type LoadState = 'loading' | 'volume-loaded' | 'no-volume' | 'error';

export function SessionPage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { dispatch } = useAppState();
  const { t } = useTranslation();
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [errorMsg, setErrorMsg] = useState('');

  const basePath = import.meta.env.BASE_URL ?? '/ecos-data-captured/';

  const loadSession = useCallback(async () => {
    if (!slug) {
      navigate('/scan');
      return;
    }

    const manifest = SESSION_MANIFEST[slug];
    if (!manifest) {
      setLoadState('error');
      setErrorMsg(t('session.unknownSession').replace('{slug}', slug));
      return;
    }

    // Try to load the .echos-vol file
    if (manifest.volume) {
      try {
        const volUrl = `${basePath}examples/${encodeURIComponent(manifest.volume)}`;
        const resp = await fetch(volUrl);

        if (resp.ok) {
          const buffer = await resp.arrayBuffer();
          const snapshot = deserializeVolume(buffer);

          // Load volume into state and navigate to viewer
          dispatch({
            type: 'SET_V2_VOLUME',
            data: snapshot.data,
            dimensions: snapshot.dimensions,
            extent: snapshot.extent,
          });

          // Also load the example video + GPX for context
          await loadExampleFiles(manifest);

          setLoadState('volume-loaded');
          // Navigate to scan page in viewer mode
          navigate('/scan', { state: { autoViewer: true } });
          return;
        }

        // 404 or other error — volume not generated yet
        if (resp.status === 404) {
          setLoadState('no-volume');
          return;
        }

        setLoadState('error');
        setErrorMsg(`${t('session.fetchError')}: ${resp.status}`);
      } catch (e) {
        setLoadState('error');
        setErrorMsg((e as Error).message);
      }
    } else {
      setLoadState('no-volume');
    }
  }, [slug, basePath, dispatch, navigate, t]);

  const loadExampleFiles = async (manifest: { video: string; gpx: string }) => {
    try {
      // Load video metadata (HEAD only)
      const videoUrl = `${basePath}examples/${encodeURIComponent(manifest.video)}`;
      const video = document.createElement('video');
      video.preload = 'metadata';
      await new Promise<void>((resolve, reject) => {
        video.onloadedmetadata = () => resolve();
        video.onerror = () => reject(new Error('Failed to read video metadata'));
        video.src = videoUrl;
      });
      dispatch({
        type: 'SET_VIDEO',
        file: new File([], manifest.video, { type: 'video/mp4' }),
        url: videoUrl,
        durationS: video.duration,
        width: video.videoWidth,
        height: video.videoHeight,
      });

      // Load GPX
      const gpxUrl = `${basePath}examples/${encodeURIComponent(manifest.gpx)}`;
      const gpxResp = await fetch(gpxUrl);
      if (gpxResp.ok) {
        const gpxText = await gpxResp.text();
        const track = parseGpx(gpxText);
        const gpxBlob = new Blob([gpxText], { type: 'application/gpx+xml' });
        const gpxFile = new File([gpxBlob], manifest.gpx, { type: 'application/gpx+xml' });
        dispatch({ type: 'SET_GPX', file: gpxFile, track });
      }
    } catch {
      // Non-blocking — files may not be available
    }
  };

  const handleGoToScan = useCallback(async () => {
    if (!slug) return;
    const manifest = SESSION_MANIFEST[slug];
    if (manifest) {
      await loadExampleFiles(manifest);
    }
    navigate('/scan');
  }, [slug, basePath, dispatch, navigate]);

  useEffect(() => {
    loadSession();
  }, [loadSession]);

  if (loadState === 'loading') {
    return (
      <div style={{
        background: colors.black,
        minHeight: 'calc(100vh - 72px)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '32px var(--content-gutter)',
      }}>
        <div style={{
          width: '40px',
          height: '40px',
          border: `3px solid ${colors.border}`,
          borderTopColor: colors.accent,
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
        }} />
        <p style={{ color: colors.text2, marginTop: '20px', fontSize: '15px' }}>
          {t('session.loading')}
        </p>
      </div>
    );
  }

  // Volume not found (404) — offer to generate
  if (loadState === 'no-volume') {
    return (
      <div style={{
        background: colors.black,
        minHeight: 'calc(100vh - 72px)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '32px var(--content-gutter)',
      }}>
        <h1 style={{
          color: colors.text1,
          fontSize: 'clamp(22px, 3vw, 30px)',
          fontWeight: 600,
          marginBottom: '16px',
          textAlign: 'center',
        }}>
          {t('session.noVolumeTitle')}
        </h1>

        <p style={{
          color: colors.text2,
          fontSize: '15px',
          textAlign: 'center',
          maxWidth: '500px',
          lineHeight: 1.6,
          marginBottom: '32px',
        }}>
          {t('session.noVolumeDesc')}
        </p>

        <div style={{ display: 'flex', gap: '12px' }}>
          <Button variant="secondary" size="lg" onClick={() => navigate('/')}>
            {t('common.back')}
          </Button>
          <Button variant="primary" size="lg" onClick={handleGoToScan}>
            {t('session.generateNow')}
          </Button>
        </div>
      </div>
    );
  }

  // Error state
  return (
    <div style={{
      background: colors.black,
      minHeight: 'calc(100vh - 72px)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '32px var(--content-gutter)',
    }}>
      <h1 style={{
        color: colors.text1,
        fontSize: 'clamp(22px, 3vw, 30px)',
        fontWeight: 600,
        marginBottom: '16px',
        textAlign: 'center',
      }}>
        {t('session.errorTitle')}
      </h1>

      {errorMsg && (
        <GlassPanel style={{
          padding: '16px 24px',
          marginBottom: '20px',
          maxWidth: '600px',
          textAlign: 'center',
        }}>
          <p style={{ color: colors.error, fontSize: '14px', margin: 0 }}>{errorMsg}</p>
        </GlassPanel>
      )}

      <div style={{ display: 'flex', gap: '12px' }}>
        <Button variant="secondary" size="lg" onClick={() => navigate('/')}>
          {t('common.back')}
        </Button>
        <Button variant="primary" size="lg" onClick={() => { setLoadState('loading'); loadSession(); }}>
          {t('session.retry')}
        </Button>
      </div>
    </div>
  );
}

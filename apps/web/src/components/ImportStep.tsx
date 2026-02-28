import React, { useCallback, useState } from 'react';
import { GlassPanel, FileDropZone, Button, colors } from '@echos/ui';
import { parseGpx } from '@echos/core';
import { useTranslation } from '../i18n/index.js';
import { IconVideo, IconMapPin, IconFolder } from './Icons.js';
import { useAppState } from '../store/app-state.js';

export function ImportStep() {
  const { state, dispatch } = useAppState();
  const { t } = useTranslation();

  const handleVideoFile = useCallback(
    async (file: File) => {
      if (!file.type.startsWith('video/') && !file.name.endsWith('.mp4')) {
        dispatch({ type: 'SET_ERROR', error: t('import.errorMp4') });
        return;
      }

      try {
        const url = URL.createObjectURL(file);
        const video = document.createElement('video');
        video.preload = 'metadata';

        await new Promise<void>((resolve, reject) => {
          video.onloadedmetadata = () => resolve();
          video.onerror = () => reject(new Error('Failed to read video metadata.'));
          video.src = url;
        });

        dispatch({
          type: 'SET_VIDEO',
          file,
          durationS: video.duration,
          width: video.videoWidth,
          height: video.videoHeight,
        });
        dispatch({ type: 'ADD_LOG', message: `Video loaded: ${file.name} (${video.videoWidth}x${video.videoHeight}, ${video.duration.toFixed(1)}s)` });
        URL.revokeObjectURL(url);
      } catch (e) {
        dispatch({ type: 'SET_ERROR', error: `Could not read video: ${(e as Error).message}` });
      }
    },
    [dispatch, t],
  );

  const handleGpxFile = useCallback(
    async (file: File) => {
      if (!file.name.endsWith('.gpx')) {
        dispatch({ type: 'SET_ERROR', error: t('import.errorGpx') });
        return;
      }

      try {
        const text = await file.text();
        const track = parseGpx(text);
        dispatch({ type: 'SET_GPX', file, track });
        dispatch({
          type: 'ADD_LOG',
          message: `GPX loaded: ${file.name} (${track.points.length} points, ${track.totalDistanceM.toFixed(0)}m, ${track.durationS.toFixed(0)}s)`,
        });
      } catch (e) {
        dispatch({ type: 'SET_ERROR', error: `Could not parse GPX: ${(e as Error).message}` });
      }
    },
    [dispatch, t],
  );

  const handleSessionFile = useCallback(
    async (file: File) => {
      try {
        const text = await file.text();
        const { deserializeSession } = await import('@echos/core');
        const session = deserializeSession(text);
        dispatch({
          type: 'LOAD_SESSION',
          state: {
            crop: session.crop,
            calibration: session.calibration,
            sync: session.sync,
            cropConfirmed: true,
          },
        });
        dispatch({ type: 'ADD_LOG', message: `Session loaded: ${file.name}` });
      } catch (e) {
        dispatch({ type: 'SET_ERROR', error: `Invalid session file: ${(e as Error).message}` });
      }
    },
    [dispatch],
  );

  const canProceed = state.videoFile !== null && state.gpxFile !== null;
  const noFilesYet = state.videoFile === null && state.gpxFile === null;
  const [loadingTest, setLoadingTest] = useState(false);

  const handleLoadTest = useCallback(async () => {
    setLoadingTest(true);
    try {
      const videoName = 'exemple_video_2026-02-28_at_00.05.10.mp4';
      const gpxName = 'exemple_22_févr._2026_15_35_50.gpx';
      const basePath = import.meta.env.BASE_URL ?? '/echos-data-capture/';
      const videoUrl = `${basePath}examples/${encodeURIComponent(videoName)}`;
      const gpxUrl = `${basePath}examples/${encodeURIComponent(gpxName)}`;
      const [mp4Resp, gpxResp] = await Promise.all([
        fetch(videoUrl),
        fetch(gpxUrl),
      ]);
      const missing: string[] = [];
      if (!mp4Resp.ok) missing.push(videoName);
      if (!gpxResp.ok) missing.push(gpxName);
      if (missing.length > 0) {
        dispatch({ type: 'SET_ERROR', error: `Fichiers introuvables dans ${basePath}examples/ : ${missing.join(', ')}` });
        return;
      }
      const mp4Blob = await mp4Resp.blob();
      const mp4File = new File([mp4Blob], videoName, { type: 'video/mp4' });
      await handleVideoFile(mp4File);

      const gpxBlob = await gpxResp.blob();
      const gpxFile = new File([gpxBlob], gpxName, { type: 'application/gpx+xml' });
      await handleGpxFile(gpxFile);
    } catch (e) {
      dispatch({ type: 'SET_ERROR', error: `Erreur chargement test: ${(e as Error).message}` });
    } finally {
      setLoadingTest(false);
    }
  }, [dispatch, handleVideoFile, handleGpxFile]);

  return (
    <div style={{ display: 'grid', gap: '32px' }}>
      <div>
        <h2 style={{ fontSize: 'clamp(24px, 2.5vw, 32px)', fontWeight: 600, marginBottom: '12px' }}>
          {t('import.title')}
        </h2>
        <p style={{ color: colors.text2, fontSize: '16px', lineHeight: 1.7, maxWidth: '640px' }}>
          {t('import.desc')}
        </p>
      </div>

      <div className="grid-2-cols" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
        <GlassPanel padding="0">
          <FileDropZone
            accept="video/mp4,video/*"
            label={state.videoFile ? state.videoFile.name : t('import.dropVideo')}
            hint={t('import.videoHint')}
            onFile={handleVideoFile}
            icon={<IconVideo size={28} color={colors.text3} />}
          />
        </GlassPanel>

        <GlassPanel padding="0">
          <FileDropZone
            accept=".gpx"
            label={state.gpxFile ? state.gpxFile.name : t('import.dropGpx')}
            hint={t('import.gpxHint')}
            onFile={handleGpxFile}
            icon={<IconMapPin size={28} color={colors.text3} />}
          />
        </GlassPanel>
      </div>

      <GlassPanel padding="0" style={{ opacity: 0.7 }}>
        <FileDropZone
          accept=".json,.echos.json"
          label={t('import.loadSession')}
          hint={t('import.loadSessionHint')}
          onFile={handleSessionFile}
          icon={<IconFolder size={24} color={colors.text3} />}
        />
      </GlassPanel>

      {state.error && (
        <div
          style={{
            background: 'rgba(239, 68, 68, 0.1)',
            border: `1px solid ${colors.error}`,
            borderRadius: '12px',
            padding: '14px 18px',
            color: colors.error,
            fontSize: '15px',
          }}
        >
          {state.error}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button
          variant="primary"
          size="lg"
          disabled={!canProceed}
          onClick={() => dispatch({ type: 'SET_STEP', step: 'crop' })}
        >
          {t('import.next')}
        </Button>
      </div>

      {noFilesYet && (
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          gap: '12px',
          marginTop: '48px',
        }}>
          <span style={{ fontSize: '14px', color: colors.text3 }}>
            Pas de fichiers ?
          </span>
          <button
            onClick={handleLoadTest}
            disabled={loadingTest}
            style={{
              padding: '8px 20px',
              borderRadius: '9999px',
              border: `1.5px solid ${colors.accent}`,
              background: 'transparent',
              color: colors.accent,
              fontSize: '14px',
              fontWeight: 600,
              fontFamily: 'inherit',
              cursor: loadingTest ? 'wait' : 'pointer',
              transition: 'all 150ms ease',
              opacity: loadingTest ? 0.7 : 1,
              position: 'relative',
            }}
            className="echos-action-btn"
          >
            <span style={{ visibility: loadingTest ? 'hidden' : 'visible' }}>test</span>
            {loadingTest && (
              <span style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}>
                <span style={{
                  display: 'inline-block',
                  width: '14px',
                  height: '14px',
                  border: '2px solid color-mix(in srgb, currentColor 20%, transparent)',
                  borderTopColor: 'currentColor',
                  borderRadius: '50%',
                  animation: 'echos-spin 0.8s linear infinite',
                }} />
              </span>
            )}
          </button>
        </div>
      )}
    </div>
  );
}

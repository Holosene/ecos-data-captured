import React, { useCallback } from 'react';
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

  const handleLoadTest = useCallback(async () => {
    try {
      // Generate synthetic sonar video in-memory using Canvas + MediaRecorder
      const W = 360, H = 640;
      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext('2d')!;

      // Draw sonar-like frame
      const drawFrame = (frame: number) => {
        const sTop = Math.round(H * 0.07), sBot = Math.round(H * 0.95), sH = sBot - sTop;
        ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, sTop);
        ctx.fillStyle = '#060e1e'; ctx.fillRect(0, sTop, W, sH);
        ctx.fillStyle = '#000'; ctx.fillRect(0, sBot, W, H - sBot);
        const bY = sTop + sH * 0.82 + Math.sin(frame * 0.15) * 6;
        const g = ctx.createLinearGradient(0, bY - 15, 0, bY + 30);
        g.addColorStop(0, 'transparent'); g.addColorStop(0.4, 'rgba(50,140,255,0.8)'); g.addColorStop(1, 'transparent');
        ctx.fillStyle = g; ctx.fillRect(0, bY - 15, W, 45);
        for (let i = 0; i < 60; i++) {
          const x = (Math.random() * W + frame * 3) % W, y = sTop + Math.random() * sH * 0.75, b = 20 + Math.random() * 80;
          ctx.fillStyle = `rgba(${b * 0.2},${b * 0.4},${b},0.3)`; ctx.fillRect(x, y, 2, 2);
        }
        ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.font = 'bold 16px sans-serif';
        ctx.fillText('12.5m', 8, sTop + 22); ctx.fillText('17°C', W - 55, sTop + 22);
      };

      drawFrame(0);
      const stream = canvas.captureStream(30);
      const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
        ? 'video/webm;codecs=vp9'
        : MediaRecorder.isTypeSupported('video/webm') ? 'video/webm' : 'video/mp4';
      const recorder = new MediaRecorder(stream, { mimeType });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      const videoReady = new Promise<Blob>((resolve) => {
        recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
      });
      recorder.start();
      let frameN = 0;
      const endTime = performance.now() + 2000;
      await new Promise<void>((resolve) => {
        const tick = () => {
          if (performance.now() >= endTime) { resolve(); return; }
          drawFrame(frameN++);
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      recorder.stop();

      const videoBlob = await videoReady;
      const ext = mimeType.includes('webm') ? 'webm' : 'mp4';
      const videoFile = new File([videoBlob], `test-sonar.${ext}`, { type: mimeType });
      await handleVideoFile(videoFile);

      // Generate synthetic GPX track
      const base = new Date('2026-02-28T10:00:00Z');
      let pts = '';
      for (let i = 0; i < 120; i++) {
        const t = new Date(base.getTime() + i * 500);
        pts += `<trkpt lat="${(48.8566 + i * 0.00004).toFixed(6)}" lon="${(2.3522 + Math.sin(i * 0.08) * 0.00002).toFixed(6)}"><ele>0</ele><time>${t.toISOString()}</time></trkpt>\n`;
      }
      const gpxXml = `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="echos-test" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Test</name><trkseg>${pts}</trkseg></trk></gpx>`;
      const gpxFile = new File([new Blob([gpxXml], { type: 'application/gpx+xml' })], 'test-track.gpx', { type: 'application/gpx+xml' });
      await handleGpxFile(gpxFile);
    } catch (e) {
      dispatch({ type: 'SET_ERROR', error: `Erreur test: ${(e as Error).message}` });
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
            style={{
              padding: '8px 20px',
              borderRadius: '9999px',
              border: `1.5px solid ${colors.accent}`,
              background: 'transparent',
              color: colors.accent,
              fontSize: '14px',
              fontWeight: 600,
              fontFamily: 'inherit',
              cursor: 'pointer',
              transition: 'all 150ms ease',
            }}
            className="echos-action-btn"
          >
            test
          </button>
        </div>
      )}
    </div>
  );
}

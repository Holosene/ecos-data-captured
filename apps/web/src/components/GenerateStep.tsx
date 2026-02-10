import React, { useCallback, useState, useRef } from 'react';
import { GlassPanel, Button, ProgressBar, colors } from '@echos/ui';
import {
  createSyncContext,
  mapAllFrames,
  buildVolume,
  generateQcReport,
  estimateVolume,
} from '@echos/core';
import type { FrameData, FrameMapping } from '@echos/core';
import { useTranslation } from '../i18n/index.js';
import { useAppState } from '../store/app-state.js';

export function GenerateStep() {
  const { state, dispatch } = useAppState();
  const { t } = useTranslation();
  const [showLogs, setShowLogs] = useState(false);
  const abortRef = useRef(false);

  const totalDistM = state.gpxTrack?.totalDistanceM ?? 0;
  const est = estimateVolume(
    state.crop.width,
    state.crop.height,
    totalDistM,
    state.calibration.yStepM,
    state.calibration.downscaleFactor,
  );

  const extractFramesFromVideo = useCallback(
    async (
      videoFile: File,
      fps: number,
      maxDurationS: number | null,
      onProgress: (p: number, msg: string) => void,
    ): Promise<FrameData[]> => {
      const url = URL.createObjectURL(videoFile);
      const video = document.createElement('video');
      video.preload = 'auto';
      video.muted = true;

      await new Promise<void>((resolve, reject) => {
        video.onloadeddata = () => resolve();
        video.onerror = () => reject(new Error('Failed to load video'));
        video.src = url;
      });

      const duration = maxDurationS ?? video.duration;
      const interval = 1 / fps;
      const totalFrames = Math.floor(duration * fps);
      const { crop, calibration } = state;

      const offscreen = document.createElement('canvas');
      const targetW = Math.round(crop.width * calibration.downscaleFactor);
      const targetH = Math.round(crop.height * calibration.downscaleFactor);
      offscreen.width = targetW;
      offscreen.height = targetH;
      const ctx = offscreen.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('Cannot create canvas context');

      const frames: FrameData[] = [];

      for (let i = 0; i < totalFrames; i++) {
        if (abortRef.current) break;

        const timeS = i * interval;
        video.currentTime = timeS;

        await new Promise<void>((resolve) => {
          video.onseeked = () => resolve();
        });

        ctx.drawImage(
          video,
          crop.x, crop.y, crop.width, crop.height,
          0, 0, targetW, targetH,
        );

        const imageData = ctx.getImageData(0, 0, targetW, targetH);
        const gray = new Uint8Array(targetW * targetH);
        for (let p = 0; p < gray.length; p++) {
          const r = imageData.data[p * 4];
          const g = imageData.data[p * 4 + 1];
          const b = imageData.data[p * 4 + 2];
          gray[p] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
        }

        frames.push({
          index: i,
          timeS,
          pixels: gray,
          width: targetW,
          height: targetH,
        });

        onProgress((i + 1) / totalFrames, `Extracting frame ${i + 1}/${totalFrames}`);
      }

      URL.revokeObjectURL(url);
      return frames;
    },
    [state],
  );

  const handleGenerate = useCallback(
    async (quickPreview: boolean) => {
      if (!state.videoFile || !state.gpxTrack) return;

      abortRef.current = false;
      dispatch({ type: 'START_PROCESSING' });
      dispatch({ type: 'SET_QUICK_PREVIEW', enabled: quickPreview });

      try {
        const maxDurationS = quickPreview ? 30 : null;

        dispatch({ type: 'ADD_LOG', message: 'Starting frame extraction...' });
        dispatch({
          type: 'SET_PROGRESS',
          progress: { stage: 'extracting', progress: 0, message: 'Preparing video...' },
        });

        const frames = await extractFramesFromVideo(
          state.videoFile,
          state.calibration.fpsExtraction,
          maxDurationS,
          (p, msg) => {
            dispatch({
              type: 'SET_PROGRESS',
              progress: { stage: 'extracting', progress: p * 0.5, message: msg },
            });
          },
        );

        if (frames.length === 0) {
          throw new Error('No frames extracted. Check your video and crop settings.');
        }

        dispatch({ type: 'ADD_LOG', message: `Extracted ${frames.length} frames` });

        dispatch({
          type: 'SET_PROGRESS',
          progress: { stage: 'mapping', progress: 0.5, message: 'Mapping frames to GPS...' },
        });
        dispatch({ type: 'ADD_LOG', message: 'Mapping frames to GPS positions...' });

        const syncCtx = createSyncContext(state.gpxTrack, state.videoDurationS, state.sync);
        const frameTimes = frames.map((f) => ({ index: f.index, timeS: f.timeS }));
        const mappings: FrameMapping[] = mapAllFrames(syncCtx, frameTimes);

        dispatch({ type: 'ADD_LOG', message: `Mapped ${mappings.length} frames to positions` });

        dispatch({
          type: 'SET_PROGRESS',
          progress: { stage: 'building', progress: 0.6, message: 'Building 3D volume...' },
        });
        dispatch({ type: 'ADD_LOG', message: 'Building 3D volume...' });

        const volume = buildVolume(
          { frames, mappings, calibration: state.calibration },
          (p, msg) => {
            dispatch({
              type: 'SET_PROGRESS',
              progress: { stage: 'building', progress: 0.6 + p * 0.35, message: msg },
            });
          },
        );

        dispatch({
          type: 'ADD_LOG',
          message: `Volume built: ${volume.metadata.dimensions.join('x')} (${((volume.data.length * 4) / 1024 / 1024).toFixed(1)} MB)`,
        });

        const report = generateQcReport({
          videoFile: state.videoFile.name,
          gpxFile: state.gpxFile!.name,
          videoDurationS: state.videoDurationS,
          gpxDurationS: state.gpxTrack.durationS,
          gpxTotalDistanceM: state.gpxTrack.totalDistanceM,
          extractedFrames: frames.length,
          fpsExtraction: state.calibration.fpsExtraction,
          downscaleFactor: state.calibration.downscaleFactor,
          cropRect: state.crop,
          calibration: state.calibration,
          volume,
        });

        dispatch({ type: 'SET_VOLUME', volume, mappings });
        dispatch({ type: 'SET_QC_REPORT', report });
        dispatch({
          type: 'SET_PROGRESS',
          progress: { stage: 'done', progress: 1, message: t('gen.volumeReady') },
        });
        dispatch({ type: 'ADD_LOG', message: 'Generation complete!' });
        dispatch({ type: 'FINISH_PROCESSING' });

        if (report.warnings.length > 0) {
          dispatch({ type: 'ADD_LOG', message: `Warnings: ${report.warnings.join('; ')}` });
        }
      } catch (e) {
        const msg = (e as Error).message || 'Unknown error during processing';
        dispatch({ type: 'SET_ERROR', error: msg });
        dispatch({ type: 'ADD_LOG', message: `ERROR: ${msg}` });
      }
    },
    [state, dispatch, extractFramesFromVideo, t],
  );

  const isComplete = state.progress?.stage === 'done';

  return (
    <div style={{ display: 'grid', gap: '32px' }}>
      <h2 style={{ fontSize: 'clamp(24px, 2.5vw, 32px)', fontWeight: 600 }}>{t('gen.title')}</h2>

      <GlassPanel padding="24px">
        <h4 style={{ fontSize: '15px', fontWeight: 600, color: colors.accent, marginBottom: '16px' }}>
          {t('gen.summary')}
        </h4>
        <div className="grid-4-cols" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', fontSize: '15px' }}>
          <div>
            <span style={{ color: colors.text3 }}>{t('gen.estimatedSize')}: </span>
            <span style={{ fontWeight: 600 }}>{est.estimatedMB.toFixed(0)} MB</span>
          </div>
          <div>
            <span style={{ color: colors.text3 }}>{t('gen.frames')}: </span>
            <span style={{ fontWeight: 600 }}>
              ~{Math.floor((state.videoDurationS) * state.calibration.fpsExtraction)}
            </span>
          </div>
          <div>
            <span style={{ color: colors.text3 }}>{t('gen.volume')}: </span>
            <span style={{ fontWeight: 600 }}>{est.dimX}x{est.dimY}x{est.dimZ}</span>
          </div>
        </div>
      </GlassPanel>

      {!state.processing && !isComplete && (
        <div style={{ display: 'flex', gap: '16px', justifyContent: 'center' }}>
          <Button variant="secondary" size="lg" onClick={() => handleGenerate(true)}>
            {t('gen.quickPreview')}
          </Button>
          <Button variant="primary" size="lg" onClick={() => handleGenerate(false)}>
            {t('gen.fullGeneration')}
          </Button>
        </div>
      )}

      {(state.processing || isComplete) && state.progress && (
        <GlassPanel padding="24px">
          <ProgressBar
            value={state.progress.progress}
            label={state.progress.message}
          />
          <div
            style={{
              marginTop: '16px',
              fontSize: '15px',
              color: state.progress.stage === 'done' ? colors.success : colors.text2,
              fontWeight: state.progress.stage === 'done' ? 600 : 400,
            }}
          >
            {state.progress.stage === 'done' ? t('gen.volumeReady') : state.progress.message}
          </div>
        </GlassPanel>
      )}

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

      {state.logs.length > 0 && (
        <GlassPanel padding="16px">
          <button
            onClick={() => setShowLogs(!showLogs)}
            style={{
              background: 'none',
              border: 'none',
              color: colors.text3,
              fontSize: '14px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              width: '100%',
              fontFamily: 'inherit',
            }}
          >
            <span style={{ transform: showLogs ? 'rotate(90deg)' : 'none', transition: '150ms ease', display: 'inline-block' }}>
              &#9654;
            </span>
            {t('gen.processingLogs')} ({state.logs.length})
          </button>
          {showLogs && (
            <pre
              style={{
                marginTop: '12px',
                padding: '16px',
                background: colors.black,
                borderRadius: '8px',
                fontSize: '13px',
                fontFamily: 'var(--font-mono)',
                color: colors.text2,
                maxHeight: '200px',
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
                lineHeight: '1.7',
              }}
            >
              {state.logs.join('\n')}
            </pre>
          )}
        </GlassPanel>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <Button
          variant="ghost"
          size="lg"
          disabled={state.processing}
          onClick={() => dispatch({ type: 'SET_STEP', step: 'sync' })}
        >
          {t('gen.back')}
        </Button>
        {isComplete && (
          <Button
            variant="primary"
            size="lg"
            onClick={() => dispatch({ type: 'SET_STEP', step: 'viewer' })}
          >
            {t('gen.openViewer')}
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * ECHOS V2 — Scan Page
 *
 * Streamlined V2 workflow:
 *   Import MP4 + GPX → Auto preprocessing → Choose mode → Volumetric viewer
 *
 * Replaces the V1 multi-step wizard with a minimal-friction flow.
 */

import React, { useCallback, useRef, useState } from 'react';
import { GlassPanel, Button, FileDropZone, ProgressBar, Slider, colors } from '@echos/ui';
import {
  parseGpx,
  createSyncContext,
  mapAllFrames,
  extractFrameImageData,
  preprocessFrame,
  projectFramesSpatial,
  buildInstrumentVolume,
  createEmptyVolume,
  normalizeVolume,
  estimateVolumeMemoryMB,
} from '@echos/core';
import type {
  PreprocessingSettings,
  BeamSettings,
  VolumeGridSettings,
  PipelineV2Progress,
  ViewMode,
  GpxTrack,
  CropRect,
} from '@echos/core';
import {
  DEFAULT_PREPROCESSING,
  DEFAULT_BEAM,
  DEFAULT_GRID,
} from '@echos/core';
import { useAppState } from '../store/app-state.js';
import { useTranslation } from '../i18n/index.js';
import { VolumeViewer } from '../components/VolumeViewer.js';

type ScanPhase = 'import' | 'configure' | 'processing' | 'viewer';

export function ScanPage() {
  const { state, dispatch } = useAppState();
  const { t } = useTranslation();

  const [phase, setPhase] = useState<ScanPhase>('import');
  const [viewMode, setViewMode] = useState<ViewMode>('spatial');

  // Settings
  const [preprocessing, setPreprocessing] = useState<PreprocessingSettings>({ ...DEFAULT_PREPROCESSING });
  const [beam, setBeam] = useState<BeamSettings>({ ...DEFAULT_BEAM });
  const [grid, setGrid] = useState<VolumeGridSettings>({ ...DEFAULT_GRID });
  const [crop, setCrop] = useState<CropRect>({ x: 0, y: 0, width: 640, height: 480 });
  const [fpsExtraction, setFpsExtraction] = useState(2);

  // Processing state
  const [progress, setProgress] = useState<PipelineV2Progress | null>(null);
  const [volumeData, setVolumeData] = useState<Float32Array | null>(null);
  const [volumeDims, setVolumeDims] = useState<[number, number, number]>([1, 1, 1]);
  const [volumeExtent, setVolumeExtent] = useState<[number, number, number]>([1, 1, 1]);
  const abortRef = useRef(false);

  // ─── File handlers ────────────────────────────────────────────────────

  const handleVideoFile = useCallback(
    async (files: File[]) => {
      const file = files[0];
      if (!file) return;
      try {
        const url = URL.createObjectURL(file);
        const video = document.createElement('video');
        video.preload = 'metadata';
        await new Promise<void>((resolve, reject) => {
          video.onloadedmetadata = () => resolve();
          video.onerror = () => reject(new Error('Failed to read video metadata'));
          video.src = url;
        });
        dispatch({
          type: 'SET_VIDEO',
          file,
          durationS: video.duration,
          width: video.videoWidth,
          height: video.videoHeight,
        });
        setCrop({ x: 0, y: 0, width: video.videoWidth, height: video.videoHeight });
        URL.revokeObjectURL(url);
      } catch (e) {
        dispatch({ type: 'SET_ERROR', error: `Could not read video: ${(e as Error).message}` });
      }
    },
    [dispatch],
  );

  const handleGpxFile = useCallback(
    async (files: File[]) => {
      const file = files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const track = parseGpx(text);
        dispatch({ type: 'SET_GPX', file, track });
      } catch (e) {
        dispatch({ type: 'SET_ERROR', error: `Could not parse GPX: ${(e as Error).message}` });
      }
    },
    [dispatch],
  );

  const canConfigure = !!state.videoFile && !!state.gpxTrack;
  const memEstimate = estimateVolumeMemoryMB(grid);

  // ─── V2 Processing pipeline ───────────────────────────────────────────

  const runPipeline = useCallback(async () => {
    if (!state.videoFile || !state.gpxTrack) return;
    abortRef.current = false;
    setPhase('processing');

    const video = document.createElement('video');
    video.preload = 'auto';
    video.src = URL.createObjectURL(state.videoFile);
    await new Promise<void>((r) => { video.oncanplaythrough = () => r(); });

    const track = state.gpxTrack!;
    const syncCtx = createSyncContext(track, state.videoDurationS, state.sync);

    // Calculate total frames
    const totalFrames = Math.floor(state.videoDurationS * fpsExtraction);
    const frameTimes = Array.from({ length: totalFrames }, (_, i) => ({
      index: i,
      timeS: i / fpsExtraction,
    }));

    const mappings = mapAllFrames(syncCtx, frameTimes);

    setProgress({
      stage: 'preprocessing',
      progress: 0,
      message: t('v2.pipeline.extracting'),
      currentFrame: 0,
      totalFrames,
    });

    // Extract + preprocess frames
    const preprocessedFrames: Array<{
      index: number;
      timeS: number;
      intensity: Float32Array;
      width: number;
      height: number;
    }> = [];

    for (let i = 0; i < totalFrames; i++) {
      if (abortRef.current) break;

      const timeS = i / fpsExtraction;
      video.currentTime = timeS;
      await new Promise<void>((r) => { video.onseeked = () => r(); });

      const imageData = extractFrameImageData(
        video,
        crop.x,
        crop.y,
        crop.width,
        crop.height,
      );

      const result = preprocessFrame(imageData, preprocessing);
      preprocessedFrames.push({
        index: i,
        timeS,
        ...result,
      });

      setProgress({
        stage: 'preprocessing',
        progress: (i + 1) / totalFrames,
        message: `${t('v2.pipeline.preprocessing')} ${i + 1}/${totalFrames}`,
        currentFrame: i + 1,
        totalFrames,
      });
    }

    URL.revokeObjectURL(video.src);
    if (abortRef.current) return;

    // Conic projection
    setProgress({
      stage: 'projecting',
      progress: 0,
      message: t('v2.pipeline.projecting'),
    });

    let normalizedData: Float32Array;
    let dims: [number, number, number];
    let extent: [number, number, number];

    if (viewMode === 'instrument') {
      const result = buildInstrumentVolume(
        preprocessedFrames,
        beam,
        grid,
        (current, total) => {
          setProgress({
            stage: 'projecting',
            progress: current / total,
            message: `${t('v2.pipeline.projecting')} ${current}/${total}`,
            currentFrame: current,
            totalFrames: total,
          });
        },
      );
      normalizedData = result.normalized;
      dims = result.dimensions;
      extent = result.extent;
    } else {
      // Spatial mode
      const halfAngle = (beam.beamAngleDeg / 2) * Math.PI / 180;
      const maxRadius = beam.depthMaxM * Math.tan(halfAngle);
      const extX = maxRadius * 2.5;
      const extY = track.totalDistanceM;
      const extZ = beam.depthMaxM;

      const volume = createEmptyVolume(grid, extX, extY, extZ);

      projectFramesSpatial(
        preprocessedFrames,
        mappings,
        volume,
        beam,
        (current, total) => {
          setProgress({
            stage: 'projecting',
            progress: current / total,
            message: `${t('v2.pipeline.accumulating')} ${current}/${total}`,
            currentFrame: current,
            totalFrames: total,
          });
        },
      );

      normalizedData = normalizeVolume(volume);
      dims = volume.dimensions;
      extent = volume.extent;
    }

    setProgress({
      stage: 'ready',
      progress: 1,
      message: t('v2.pipeline.ready'),
    });

    setVolumeData(normalizedData);
    setVolumeDims(dims);
    setVolumeExtent(extent);

    // Store in global state too
    dispatch({
      type: 'SET_V2_VOLUME',
      data: normalizedData,
      dimensions: dims,
      extent,
    });

    // Add as session
    const sessionId = crypto.randomUUID();
    const gpxPoints = track.points.map((p) => ({ lat: p.lat, lon: p.lon }));
    const bounds: [number, number, number, number] = [
      Math.min(...gpxPoints.map((p) => p.lat)),
      Math.min(...gpxPoints.map((p) => p.lon)),
      Math.max(...gpxPoints.map((p) => p.lat)),
      Math.max(...gpxPoints.map((p) => p.lon)),
    ];

    dispatch({
      type: 'ADD_SESSION',
      session: {
        id: sessionId,
        name: state.videoFile!.name.replace(/\.\w+$/, ''),
        createdAt: new Date().toISOString(),
        videoFileName: state.videoFile!.name,
        gpxFileName: state.gpxFile!.name,
        bounds,
        totalDistanceM: track.totalDistanceM,
        durationS: track.durationS,
        frameCount: preprocessedFrames.length,
        gridDimensions: dims,
        preprocessing,
        beam,
      },
      gpxTrack: gpxPoints,
    });

    setPhase('viewer');
  }, [state, crop, preprocessing, beam, grid, fpsExtraction, viewMode, dispatch, t]);

  // ─── Render ───────────────────────────────────────────────────────────

  return (
    <div style={{ background: colors.black, minHeight: 'calc(100vh - 72px)' }}>
      <div style={{ padding: 'clamp(24px, 3vw, 48px) var(--content-gutter)' }}>

        {/* ── Import Phase ──────────────────────────────────────────── */}
        {phase === 'import' && (
          <div style={{ maxWidth: '800px', margin: '0 auto' }}>
            <h1 style={{ color: colors.text1, fontSize: 'clamp(24px, 3vw, 36px)', fontWeight: 600, marginBottom: '8px' }}>
              {t('v2.scan.title')}
            </h1>
            <p style={{ color: colors.text2, fontSize: '15px', marginBottom: '32px', lineHeight: 1.6 }}>
              {t('v2.scan.desc')}
            </p>

            <div className="grid-2-cols" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '24px' }}>
              <GlassPanel style={{ padding: '24px' }}>
                <h3 style={{ color: colors.text1, fontSize: '14px', marginBottom: '12px' }}>
                  {t('import.dropVideo')}
                </h3>
                <FileDropZone
                  accept="video/mp4,video/*"
                  onFile={(file: File) => handleVideoFile([file])}
                  label={state.videoFile ? state.videoFile.name : t('import.videoHint')}
                  hint={state.videoFile ? `${state.videoWidth}×${state.videoHeight} — ${state.videoDurationS.toFixed(1)}s` : t('import.videoHint')}
                />
              </GlassPanel>

              <GlassPanel style={{ padding: '24px' }}>
                <h3 style={{ color: colors.text1, fontSize: '14px', marginBottom: '12px' }}>
                  {t('import.dropGpx')}
                </h3>
                <FileDropZone
                  accept=".gpx"
                  onFile={(file: File) => handleGpxFile([file])}
                  label={state.gpxFile ? state.gpxFile.name : t('import.gpxHint')}
                  hint={state.gpxTrack ? `${state.gpxTrack.points.length} pts — ${state.gpxTrack.totalDistanceM.toFixed(0)}m` : t('import.gpxHint')}
                />
              </GlassPanel>
            </div>

            {state.error && (
              <div
                style={{
                  background: 'rgba(239, 68, 68, 0.1)',
                  border: `1px solid ${colors.error}`,
                  borderRadius: '12px',
                  padding: '14px 18px',
                  color: colors.error,
                  fontSize: '15px',
                  marginBottom: '16px',
                }}
              >
                {state.error}
              </div>
            )}

            {canConfigure && (
              <div style={{ textAlign: 'center' }}>
                <Button variant="primary" size="lg" onClick={() => setPhase('configure')}>
                  {t('v2.scan.configure')}
                </Button>
              </div>
            )}
          </div>
        )}

        {/* ── Configure Phase ───────────────────────────────────────── */}
        {phase === 'configure' && (
          <div style={{ maxWidth: '900px', margin: '0 auto' }}>
            <h1 style={{ color: colors.text1, fontSize: 'clamp(20px, 2.5vw, 28px)', fontWeight: 600, marginBottom: '24px' }}>
              {t('v2.config.title')}
            </h1>

            <div className="grid-2-cols" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '24px' }}>
              {/* Preprocessing */}
              <GlassPanel style={{ padding: '20px' }}>
                <h3 style={{ color: colors.text1, fontSize: '14px', fontWeight: 600, marginBottom: '16px' }}>
                  {t('v2.config.preprocessing')}
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <Slider label={t('v2.config.upscale')} value={preprocessing.upscaleFactor} min={1} max={4} step={0.5} onChange={(v) => setPreprocessing((p) => ({ ...p, upscaleFactor: v }))} />
                  <Slider label={t('v2.config.denoise')} value={preprocessing.denoiseStrength} min={0} max={1} step={0.1} onChange={(v) => setPreprocessing((p) => ({ ...p, denoiseStrength: v }))} />
                  <Slider label={t('v2.config.gamma')} value={preprocessing.gamma} min={0.3} max={2.0} step={0.05} onChange={(v) => setPreprocessing((p) => ({ ...p, gamma: v }))} />
                  <Slider label={t('v2.config.gaussianSigma')} value={preprocessing.gaussianSigma} min={0} max={3} step={0.1} onChange={(v) => setPreprocessing((p) => ({ ...p, gaussianSigma: v }))} />
                  <Slider label={t('v2.config.deblock')} value={preprocessing.deblockStrength} min={0} max={1} step={0.1} onChange={(v) => setPreprocessing((p) => ({ ...p, deblockStrength: v }))} />
                </div>
              </GlassPanel>

              {/* Beam & Grid */}
              <GlassPanel style={{ padding: '20px' }}>
                <h3 style={{ color: colors.text1, fontSize: '14px', fontWeight: 600, marginBottom: '16px' }}>
                  {t('v2.config.beamGrid')}
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <Slider label={t('v2.config.beamAngle')} value={beam.beamAngleDeg} min={5} max={60} step={1} onChange={(v) => setBeam((b) => ({ ...b, beamAngleDeg: v }))} />
                  <Slider label={t('v2.config.depthMax')} value={beam.depthMaxM} min={1} max={100} step={1} onChange={(v) => setBeam((b) => ({ ...b, depthMaxM: v }))} />
                  <Slider label={t('v2.config.falloff')} value={beam.lateralFalloffSigma} min={0.1} max={2.0} step={0.1} onChange={(v) => setBeam((b) => ({ ...b, lateralFalloffSigma: v }))} />
                  <Slider label={t('v2.config.resX')} value={grid.resX} min={32} max={512} step={32} onChange={(v) => setGrid((g) => ({ ...g, resX: v }))} />
                  <Slider label={t('v2.config.resY')} value={grid.resY} min={32} max={512} step={32} onChange={(v) => setGrid((g) => ({ ...g, resY: v }))} />
                  <Slider label={t('v2.config.resZ')} value={grid.resZ} min={32} max={512} step={32} onChange={(v) => setGrid((g) => ({ ...g, resZ: v }))} />
                  <Slider label={t('v2.config.fps')} value={fpsExtraction} min={1} max={5} step={1} onChange={setFpsExtraction} />
                </div>

                {/* Memory estimate */}
                <div style={{
                  marginTop: '12px',
                  padding: '8px 12px',
                  borderRadius: '8px',
                  background: memEstimate > 512 ? 'rgba(255,80,80,0.1)' : 'rgba(68,136,255,0.1)',
                  border: `1px solid ${memEstimate > 512 ? 'rgba(255,80,80,0.3)' : 'rgba(68,136,255,0.2)'}`,
                  fontSize: '12px',
                  color: memEstimate > 512 ? colors.error : colors.text2,
                }}>
                  {t('v2.config.memory')}: ~{memEstimate.toFixed(0)} MB
                  ({grid.resX}×{grid.resY}×{grid.resZ})
                </div>
              </GlassPanel>
            </div>

            {/* View mode selection */}
            <GlassPanel style={{ padding: '20px', marginBottom: '24px' }}>
              <h3 style={{ color: colors.text1, fontSize: '14px', fontWeight: 600, marginBottom: '12px' }}>
                {t('v2.config.viewMode')}
              </h3>
              <div className="grid-2-cols" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <button
                  onClick={() => setViewMode('instrument')}
                  style={{
                    padding: '16px',
                    borderRadius: '12px',
                    border: `2px solid ${viewMode === 'instrument' ? colors.accent : colors.border}`,
                    background: viewMode === 'instrument' ? colors.accentMuted : 'transparent',
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                >
                  <div style={{ color: colors.text1, fontWeight: 600, fontSize: '14px', marginBottom: '4px' }}>
                    Mode A — {t('v2.mode.instrument')}
                  </div>
                  <div style={{ color: colors.text3, fontSize: '12px', lineHeight: 1.5 }}>
                    {t('v2.mode.instrumentDesc')}
                  </div>
                </button>
                <button
                  onClick={() => setViewMode('spatial')}
                  style={{
                    padding: '16px',
                    borderRadius: '12px',
                    border: `2px solid ${viewMode === 'spatial' ? colors.accent : colors.border}`,
                    background: viewMode === 'spatial' ? colors.accentMuted : 'transparent',
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                >
                  <div style={{ color: colors.text1, fontWeight: 600, fontSize: '14px', marginBottom: '4px' }}>
                    Mode B — {t('v2.mode.spatial')}
                  </div>
                  <div style={{ color: colors.text3, fontSize: '12px', lineHeight: 1.5 }}>
                    {t('v2.mode.spatialDesc')}
                  </div>
                </button>
              </div>
            </GlassPanel>

            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
              <Button variant="ghost" onClick={() => setPhase('import')}>
                {t('common.back')}
              </Button>
              <Button variant="primary" size="lg" onClick={runPipeline}>
                {t('v2.config.generate')}
              </Button>
            </div>
          </div>
        )}

        {/* ── Processing Phase ──────────────────────────────────────── */}
        {phase === 'processing' && (
          <div style={{ maxWidth: '600px', margin: '0 auto', textAlign: 'center' }}>
            <h1 style={{ color: colors.text1, fontSize: '24px', fontWeight: 600, marginBottom: '24px' }}>
              {t('v2.pipeline.title')}
            </h1>

            {progress && (
              <GlassPanel style={{ padding: '24px' }}>
                <div style={{ marginBottom: '16px' }}>
                  <ProgressBar value={progress.progress} />
                </div>
                <p style={{ color: colors.text2, fontSize: '14px', marginBottom: '8px' }}>
                  {progress.message}
                </p>
                {progress.currentFrame !== undefined && progress.totalFrames && (
                  <p style={{ color: colors.text3, fontSize: '12px' }}>
                    Frame {progress.currentFrame} / {progress.totalFrames}
                  </p>
                )}
              </GlassPanel>
            )}

            <div style={{ marginTop: '24px' }}>
              <Button
                variant="ghost"
                onClick={() => {
                  abortRef.current = true;
                  setPhase('configure');
                }}
              >
                {t('v2.pipeline.abort')}
              </Button>
            </div>
          </div>
        )}

        {/* ── Viewer Phase ──────────────────────────────────────────── */}
        {phase === 'viewer' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h1 style={{ color: colors.text1, fontSize: '20px', fontWeight: 600, margin: 0 }}>
                {t('v2.viewer.title')}
              </h1>
              <div style={{ display: 'flex', gap: '8px' }}>
                <Button variant="ghost" size="sm" onClick={() => setPhase('configure')}>
                  {t('v2.viewer.reconfigure')}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => {
                  setPhase('import');
                  setVolumeData(null);
                }}>
                  {t('v2.viewer.newScan')}
                </Button>
              </div>
            </div>

            <VolumeViewer
              volumeData={volumeData}
              dimensions={volumeDims}
              extent={volumeExtent}
              mode={viewMode}
            />
          </div>
        )}
      </div>
    </div>
  );
}

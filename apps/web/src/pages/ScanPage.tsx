/**
 * ECHOS V2 — Scan Page
 *
 * Simplified V2 workflow:
 *   Import MP4 + GPX → Auto-analyze & Preview → Generate → Viewer (post-gen adjustments)
 *
 * Auto-intelligent mode: crop, preprocessing, and grid settings are auto-detected.
 * Minimal pre-generation settings (mode + depth max only).
 * Fine-tuning happens post-generation with the visual under the user's eyes.
 */

import React, { useCallback, useRef, useState, useEffect } from 'react';
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
  autoDetectCropRegion,
} from '@echos/core';
import type {
  PreprocessingSettings,
  BeamSettings,
  VolumeGridSettings,
  PipelineV2Progress,
  ViewMode,
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

type ScanPhase = 'import' | 'preview' | 'processing' | 'viewer';

export function ScanPage() {
  const { state, dispatch } = useAppState();
  const { t } = useTranslation();

  const [phase, setPhase] = useState<ScanPhase>('import');
  const [viewMode, setViewMode] = useState<ViewMode>('spatial');

  // Settings (auto-intelligent defaults)
  const [preprocessing] = useState<PreprocessingSettings>({ ...DEFAULT_PREPROCESSING });
  const [beam, setBeam] = useState<BeamSettings>({ ...DEFAULT_BEAM });
  const [grid] = useState<VolumeGridSettings>({ ...DEFAULT_GRID });
  const [crop, setCrop] = useState<CropRect>({ x: 0, y: 0, width: 640, height: 480 });
  const [fpsExtraction] = useState(1);

  // Auto-detection state
  const [previewFrame, setPreviewFrame] = useState<string | null>(null);
  const [autoAnalyzed, setAutoAnalyzed] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

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

  // ─── Auto-analyze video ─────────────────────────────────────────────

  const analyzeVideo = useCallback(async () => {
    if (!state.videoFile) return;

    const url = URL.createObjectURL(state.videoFile);
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.src = url;

    await new Promise<void>((r) => {
      video.oncanplaythrough = () => r();
    });

    // Seek to 1/3 of the video for a representative frame
    const seekTime = Math.min(video.duration / 3, 10);
    video.currentTime = seekTime;
    await new Promise<void>((r) => {
      video.onseeked = () => r();
    });

    // Extract full frame for analysis
    const fullCanvas = new OffscreenCanvas(video.videoWidth, video.videoHeight);
    const fullCtx = fullCanvas.getContext('2d')!;
    fullCtx.drawImage(video, 0, 0);
    const fullImageData = fullCtx.getImageData(0, 0, video.videoWidth, video.videoHeight);

    // Auto-detect crop region
    const detectedCrop = autoDetectCropRegion(fullImageData);
    setCrop(detectedCrop);

    // Generate preview image with crop overlay
    const previewCanvas = document.createElement('canvas');
    previewCanvas.width = video.videoWidth;
    previewCanvas.height = video.videoHeight;
    const previewCtx = previewCanvas.getContext('2d')!;

    // Draw dimmed full frame
    previewCtx.drawImage(video, 0, 0);
    previewCtx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    previewCtx.fillRect(0, 0, video.videoWidth, video.videoHeight);

    // Draw bright crop area
    previewCtx.drawImage(
      video,
      detectedCrop.x, detectedCrop.y, detectedCrop.width, detectedCrop.height,
      detectedCrop.x, detectedCrop.y, detectedCrop.width, detectedCrop.height,
    );

    // Draw crop border
    previewCtx.strokeStyle = '#4488ff';
    previewCtx.lineWidth = 3;
    previewCtx.setLineDash([8, 4]);
    previewCtx.strokeRect(detectedCrop.x, detectedCrop.y, detectedCrop.width, detectedCrop.height);

    setPreviewFrame(previewCanvas.toDataURL('image/jpeg', 0.85));
    setAutoAnalyzed(true);

    URL.revokeObjectURL(url);
  }, [state.videoFile]);

  // Auto-analyze when entering preview phase
  useEffect(() => {
    if (phase === 'preview' && !autoAnalyzed) {
      analyzeVideo();
    }
  }, [phase, autoAnalyzed, analyzeVideo]);

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

  const memEstimate = estimateVolumeMemoryMB(grid);

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
                <Button variant="primary" size="lg" onClick={() => {
                  setAutoAnalyzed(false);
                  setPhase('preview');
                }}>
                  {t('v2.scan.configure')}
                </Button>
              </div>
            )}
          </div>
        )}

        {/* ── Preview & Configure Phase (simplified) ─────────────── */}
        {phase === 'preview' && (
          <div style={{ maxWidth: '800px', margin: '0 auto' }}>
            <h1 style={{ color: colors.text1, fontSize: 'clamp(20px, 2.5vw, 28px)', fontWeight: 600, marginBottom: '8px' }}>
              {t('v2.preview.title')}
            </h1>
            <p style={{ color: colors.text2, fontSize: '14px', marginBottom: '24px', lineHeight: 1.5 }}>
              {t('v2.preview.desc')}
            </p>

            {/* Auto-detected preview */}
            {!autoAnalyzed ? (
              <GlassPanel style={{ padding: '48px', textAlign: 'center', marginBottom: '24px' }}>
                <div style={{ color: colors.text2, fontSize: '15px' }}>
                  {t('v2.preview.analyzing')}
                </div>
                <div style={{ marginTop: '16px' }}>
                  <ProgressBar value={-1} />
                </div>
              </GlassPanel>
            ) : (
              <>
                {/* Preview image with auto-crop */}
                <GlassPanel style={{ padding: '16px', marginBottom: '20px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                    <h3 style={{ color: colors.text1, fontSize: '13px', fontWeight: 600, margin: 0 }}>
                      {t('v2.preview.autoCrop')}
                    </h3>
                    <span style={{ color: colors.text3, fontSize: '12px' }}>
                      {crop.width}×{crop.height}px
                    </span>
                  </div>
                  {previewFrame && (
                    <img
                      src={previewFrame}
                      alt="Preview"
                      style={{
                        width: '100%',
                        borderRadius: '8px',
                        border: `1px solid ${colors.border}`,
                      }}
                    />
                  )}
                  <p style={{ color: colors.text3, fontSize: '12px', marginTop: '8px', lineHeight: 1.5 }}>
                    {t('v2.preview.autoCropHint')}
                  </p>
                </GlassPanel>

                {/* Essential settings only */}
                <div className="grid-2-cols" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '20px' }}>
                  {/* Mode selection */}
                  <GlassPanel style={{ padding: '16px' }}>
                    <h3 style={{ color: colors.text1, fontSize: '13px', fontWeight: 600, marginBottom: '12px' }}>
                      {t('v2.config.viewMode')}
                    </h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <button
                        onClick={() => setViewMode('instrument')}
                        style={{
                          padding: '12px',
                          borderRadius: '10px',
                          border: `2px solid ${viewMode === 'instrument' ? colors.accent : colors.border}`,
                          background: viewMode === 'instrument' ? colors.accentMuted : 'transparent',
                          cursor: 'pointer',
                          textAlign: 'left',
                        }}
                      >
                        <div style={{ color: colors.text1, fontWeight: 600, fontSize: '13px' }}>
                          Mode A — {t('v2.mode.instrument')}
                        </div>
                        <div style={{ color: colors.text3, fontSize: '11px', marginTop: '2px' }}>
                          {t('v2.mode.instrumentDesc')}
                        </div>
                      </button>
                      <button
                        onClick={() => setViewMode('spatial')}
                        style={{
                          padding: '12px',
                          borderRadius: '10px',
                          border: `2px solid ${viewMode === 'spatial' ? colors.accent : colors.border}`,
                          background: viewMode === 'spatial' ? colors.accentMuted : 'transparent',
                          cursor: 'pointer',
                          textAlign: 'left',
                        }}
                      >
                        <div style={{ color: colors.text1, fontWeight: 600, fontSize: '13px' }}>
                          Mode B — {t('v2.mode.spatial')}
                        </div>
                        <div style={{ color: colors.text3, fontSize: '11px', marginTop: '2px' }}>
                          {t('v2.mode.spatialDesc')}
                        </div>
                      </button>
                    </div>
                  </GlassPanel>

                  {/* Depth max — the one essential manual setting */}
                  <GlassPanel style={{ padding: '16px' }}>
                    <h3 style={{ color: colors.text1, fontSize: '13px', fontWeight: 600, marginBottom: '12px' }}>
                      {t('v2.preview.depthSetting')}
                    </h3>
                    <Slider
                      label={t('v2.config.depthMax')}
                      value={beam.depthMaxM}
                      min={1}
                      max={100}
                      step={1}
                      onChange={(v) => setBeam((b) => ({ ...b, depthMaxM: v }))}
                    />
                    <p style={{ color: colors.text3, fontSize: '11px', marginTop: '8px', lineHeight: 1.5 }}>
                      {t('v2.preview.depthHint')}
                    </p>

                    {/* Summary info */}
                    <div style={{
                      marginTop: '16px',
                      padding: '10px 12px',
                      borderRadius: '8px',
                      background: 'rgba(68,136,255,0.08)',
                      border: '1px solid rgba(68,136,255,0.15)',
                    }}>
                      <div style={{ fontSize: '12px', color: colors.text2, lineHeight: 1.7 }}>
                        <div>{t('v2.preview.fps')}: {fpsExtraction} fps</div>
                        <div>{t('v2.preview.frames')}: ~{Math.floor(state.videoDurationS * fpsExtraction)}</div>
                        <div>{t('v2.preview.distance')}: {state.gpxTrack?.totalDistanceM.toFixed(0)}m</div>
                        <div>{t('v2.config.memory')}: ~{memEstimate.toFixed(0)} MB</div>
                      </div>
                    </div>
                  </GlassPanel>
                </div>

                {/* Advanced settings (collapsed by default) */}
                <div style={{ marginBottom: '24px' }}>
                  <button
                    onClick={() => setShowAdvanced(!showAdvanced)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: colors.text3,
                      fontSize: '12px',
                      cursor: 'pointer',
                      padding: '4px 0',
                      fontFamily: 'inherit',
                    }}
                  >
                    {showAdvanced ? '▼' : '▶'} {t('v2.preview.advanced')}
                  </button>

                  {showAdvanced && (
                    <GlassPanel style={{ padding: '16px', marginTop: '8px' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                        <div>
                          <h4 style={{ color: colors.text2, fontSize: '12px', fontWeight: 600, marginBottom: '10px' }}>
                            {t('v2.config.beamGrid')}
                          </h4>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <Slider label={t('v2.config.beamAngle')} value={beam.beamAngleDeg} min={5} max={60} step={1} onChange={(v) => setBeam((b) => ({ ...b, beamAngleDeg: v }))} />
                            <Slider label={t('v2.config.falloff')} value={beam.lateralFalloffSigma} min={0.1} max={2.0} step={0.1} onChange={(v) => setBeam((b) => ({ ...b, lateralFalloffSigma: v }))} />
                          </div>
                        </div>
                        <div>
                          <h4 style={{ color: colors.text2, fontSize: '12px', fontWeight: 600, marginBottom: '10px' }}>
                            {t('v2.preview.cropManual')}
                          </h4>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                            {(['x', 'y', 'width', 'height'] as const).map((key) => (
                              <div key={key}>
                                <label style={{ fontSize: '11px', color: colors.text3 }}>{key.toUpperCase()}</label>
                                <input
                                  type="number"
                                  value={crop[key]}
                                  onChange={(e) => setCrop((c) => ({ ...c, [key]: parseInt(e.target.value) || 0 }))}
                                  style={{
                                    width: '100%',
                                    padding: '6px 8px',
                                    borderRadius: '6px',
                                    border: `1px solid ${colors.border}`,
                                    background: colors.surface,
                                    color: colors.text1,
                                    fontSize: '12px',
                                    fontFamily: 'inherit',
                                  }}
                                />
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </GlassPanel>
                  )}
                </div>

                {/* Generate button */}
                <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
                  <Button variant="ghost" onClick={() => setPhase('import')}>
                    {t('common.back')}
                  </Button>
                  <Button variant="primary" size="lg" onClick={runPipeline}>
                    {t('v2.config.generate')}
                  </Button>
                </div>
              </>
            )}
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
                  setPhase('preview');
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
                <Button variant="ghost" size="sm" onClick={() => setPhase('preview')}>
                  {t('v2.viewer.reconfigure')}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => {
                  setPhase('import');
                  setVolumeData(null);
                  setAutoAnalyzed(false);
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

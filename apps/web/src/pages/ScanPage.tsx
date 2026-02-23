/**
 * ECHOS V2 — Scan Page
 *
 * Workflow inspired by V1 wizard (clear step-by-step UX) with V2 auto-intelligence:
 *   1. Import MP4 + GPX
 *   2. Crop — visual drag tool (auto-detected starting point, user can adjust)
 *   3. Settings — mode (A/B), depth max (auto or manual), generate
 *   4. Processing — progress bar
 *   5. Viewer — 3D volumetric + post-generation fine-tuning
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
  autoDetectDepthMax,
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

type ScanPhase = 'import' | 'crop' | 'settings' | 'processing' | 'viewer';

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
  const [fpsExtraction] = useState(4);

  // Auto-depth
  const [autoDepth, setAutoDepth] = useState(false);
  const [detectedDepth, setDetectedDepth] = useState<number | null>(null);

  // Crop tool state
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [frameReady, setFrameReady] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [scale, setScale] = useState(1);

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

  // ─── Crop tool: auto-detect + visual canvas ───────────────────────────

  useEffect(() => {
    if (phase !== 'crop' || !state.videoFile) return;
    setFrameReady(false);

    const url = URL.createObjectURL(state.videoFile);
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;

    video.onloadeddata = () => {
      video.currentTime = Math.min(video.duration / 3, 10);
    };

    video.onseeked = () => {
      const canvas = canvasRef.current;
      if (!canvas) { URL.revokeObjectURL(url); return; }

      const container = containerRef.current;
      const maxW = container ? container.clientWidth - 20 : 800;
      const maxH = container ? container.clientHeight - 10 : 600;
      const s = Math.min(1, maxW / video.videoWidth, maxH / video.videoHeight);
      setScale(s);

      canvas.width = video.videoWidth * s;
      canvas.height = video.videoHeight * s;

      const ctx = canvas.getContext('2d');
      if (ctx) ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      // Auto-detect crop on first load
      const fullCanvas = new OffscreenCanvas(video.videoWidth, video.videoHeight);
      const fullCtx = fullCanvas.getContext('2d')!;
      fullCtx.drawImage(video, 0, 0);
      const fullImageData = fullCtx.getImageData(0, 0, video.videoWidth, video.videoHeight);
      const detected = autoDetectCropRegion(fullImageData);
      setCrop(detected);

      // Try auto-detect depth
      const depthResult = autoDetectDepthMax(fullImageData, detected);
      if (depthResult !== null) {
        setDetectedDepth(depthResult);
        setBeam((b) => ({ ...b, depthMaxM: depthResult }));
        setAutoDepth(true);
      }

      setFrameReady(true);
      URL.revokeObjectURL(url);
    };

    video.src = url;
    return () => URL.revokeObjectURL(url);
  }, [phase, state.videoFile]);

  // Redraw crop overlay when crop changes
  useEffect(() => {
    if (!frameReady || phase !== 'crop' || !state.videoFile) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const url = URL.createObjectURL(state.videoFile);
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;

    video.onloadeddata = () => {
      video.currentTime = Math.min(video.duration / 3, 10);
    };

    video.onseeked = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) { URL.revokeObjectURL(url); return; }

      // Draw full frame dimmed
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Draw bright crop area
      const cx = crop.x * scale;
      const cy = crop.y * scale;
      const cw = crop.width * scale;
      const ch = crop.height * scale;
      ctx.clearRect(cx, cy, cw, ch);
      ctx.drawImage(
        video,
        crop.x, crop.y, crop.width, crop.height,
        cx, cy, cw, ch,
      );

      // Dashed border
      ctx.strokeStyle = '#4488ff';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(cx, cy, cw, ch);
      ctx.setLineDash([]);

      // Corner handles
      const hs = 8;
      ctx.fillStyle = '#4488ff';
      for (const [hx, hy] of [[cx, cy], [cx + cw, cy], [cx, cy + ch], [cx + cw, cy + ch]]) {
        ctx.fillRect(hx - hs / 2, hy - hs / 2, hs, hs);
      }

      URL.revokeObjectURL(url);
    };

    video.src = url;
    return () => URL.revokeObjectURL(url);
  }, [frameReady, crop, scale, state.videoFile, phase]);

  const getCanvasCoords = useCallback(
    (e: React.MouseEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      return {
        x: Math.round((e.clientX - rect.left) / scale),
        y: Math.round((e.clientY - rect.top) / scale),
      };
    },
    [scale],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      const coords = getCanvasCoords(e);
      setDragStart(coords);
      setDragging(true);
    },
    [getCanvasCoords],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!dragging || !dragStart) return;
      const coords = getCanvasCoords(e);
      const x = Math.max(0, Math.min(dragStart.x, coords.x));
      const y = Math.max(0, Math.min(dragStart.y, coords.y));
      const w = Math.abs(coords.x - dragStart.x);
      const h = Math.abs(coords.y - dragStart.y);
      setCrop({
        x,
        y,
        width: Math.max(20, Math.min(w, state.videoWidth - x)),
        height: Math.max(20, Math.min(h, state.videoHeight - y)),
      });
    },
    [dragging, dragStart, getCanvasCoords, state.videoWidth, state.videoHeight],
  );

  const handleMouseUp = useCallback(() => {
    setDragging(false);
    setDragStart(null);
  }, []);

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

      const imageData = extractFrameImageData(video, crop.x, crop.y, crop.width, crop.height);
      const result = preprocessFrame(imageData, preprocessing);
      preprocessedFrames.push({ index: i, timeS, ...result });

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

    setProgress({ stage: 'projecting', progress: 0, message: t('v2.pipeline.projecting') });

    let normalizedData: Float32Array;
    let dims: [number, number, number];
    let extent: [number, number, number];

    if (viewMode === 'instrument') {
      const result = buildInstrumentVolume(
        preprocessedFrames, beam, grid,
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
      const halfAngle = (beam.beamAngleDeg / 2) * Math.PI / 180;
      const maxRadius = beam.depthMaxM * Math.tan(halfAngle);
      const volume = createEmptyVolume(grid, maxRadius * 2.5, track.totalDistanceM, beam.depthMaxM);

      projectFramesSpatial(
        preprocessedFrames, mappings, volume, beam,
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

    setProgress({ stage: 'ready', progress: 1, message: t('v2.pipeline.ready') });
    setVolumeData(normalizedData);
    setVolumeDims(dims);
    setVolumeExtent(extent);

    dispatch({ type: 'SET_V2_VOLUME', data: normalizedData, dimensions: dims, extent });

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
    <div style={{ background: colors.black, height: 'calc(100vh - 72px)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: 'clamp(12px, 2vw, 24px) var(--content-gutter)', flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>

        {/* ── Import Phase ──────────────────────────────────────────── */}
        {phase === 'import' && (
          <div style={{ maxWidth: '700px', margin: '0 auto', flex: 1, overflow: 'auto' }}>
            <h1 style={{ color: colors.text1, fontSize: 'clamp(24px, 3vw, 36px)', fontWeight: 600, marginBottom: '8px' }}>
              {t('v2.scan.title')}
            </h1>
            <p style={{ color: colors.text2, fontSize: '15px', marginBottom: '32px', lineHeight: 1.6 }}>
              {t('v2.scan.desc')}
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '24px' }}>
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
              <div style={{
                background: 'rgba(239, 68, 68, 0.1)',
                border: `1px solid ${colors.error}`,
                borderRadius: '12px',
                padding: '14px 18px',
                color: colors.error,
                fontSize: '15px',
                marginBottom: '16px',
              }}>
                {state.error}
              </div>
            )}

            {canConfigure && (
              <div style={{ textAlign: 'center' }}>
                <Button variant="primary" size="lg" onClick={() => setPhase('crop')}>
                  {t('v2.scan.next')}
                </Button>
              </div>
            )}
          </div>
        )}

        {/* ── Crop Phase (V1-style visual crop) ─────────────────────── */}
        {phase === 'crop' && (
          <div style={{ maxWidth: '900px', margin: '0 auto', display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
            <h2 style={{ color: colors.text1, fontSize: 'clamp(18px, 2vw, 24px)', fontWeight: 600, marginBottom: '4px', flexShrink: 0 }}>
              {t('crop.title')}
            </h2>
            <p style={{ color: colors.text2, fontSize: '13px', marginBottom: '12px', lineHeight: 1.4, maxWidth: '640px', flexShrink: 0 }}>
              {t('crop.desc')}
            </p>

            <GlassPanel style={{ padding: '12px', marginBottom: '12px', flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <div
                ref={containerRef}
                style={{
                  position: 'relative',
                  display: 'flex',
                  justifyContent: 'center',
                  alignItems: 'center',
                  cursor: 'crosshair',
                  flex: 1,
                  overflow: 'hidden',
                }}
              >
                <canvas
                  ref={canvasRef}
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                  onMouseLeave={handleMouseUp}
                  style={{ borderRadius: '8px', maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                />
                {!frameReady && (
                  <div style={{
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: colors.text3,
                    fontSize: '15px',
                  }}>
                    {t('v2.preview.analyzing')}
                  </div>
                )}
              </div>

              {/* Crop coordinates */}
              <div style={{
                marginTop: '8px',
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                gap: '8px',
                flexShrink: 0,
              }}>
                {[
                  { label: 'X', value: crop.x },
                  { label: 'Y', value: crop.y },
                  { label: 'W', value: crop.width },
                  { label: 'H', value: crop.height },
                ].map(({ label, value }) => (
                  <div key={label} style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '11px', color: colors.text3, marginBottom: '2px' }}>{label}</div>
                    <div style={{ fontSize: '14px', fontWeight: 600, color: colors.accent, fontVariantNumeric: 'tabular-nums' }}>
                      {value}px
                    </div>
                  </div>
                ))}
              </div>
            </GlassPanel>

            <div style={{ display: 'flex', justifyContent: 'space-between', flexShrink: 0 }}>
              <Button variant="ghost" size="lg" onClick={() => setPhase('import')}>
                {t('common.back')}
              </Button>
              <Button
                variant="primary"
                size="lg"
                disabled={crop.width < 20 || crop.height < 20}
                onClick={() => setPhase('settings')}
              >
                {t('v2.scan.nextSettings')}
              </Button>
            </div>
          </div>
        )}

        {/* ── Settings Phase (simple: mode + depth) ─────────────────── */}
        {phase === 'settings' && (
          <div style={{ maxWidth: '700px', margin: '0 auto', flex: 1, overflow: 'auto' }}>
            <h2 style={{ color: colors.text1, fontSize: 'clamp(20px, 2.5vw, 28px)', fontWeight: 600, marginBottom: '8px' }}>
              {t('v2.settings.title')}
            </h2>
            <p style={{ color: colors.text2, fontSize: '14px', marginBottom: '24px', lineHeight: 1.6 }}>
              {t('v2.settings.desc')}
            </p>

            {/* Mode selection */}
            <GlassPanel style={{ padding: '20px', marginBottom: '16px' }}>
              <h3 style={{ color: colors.text1, fontSize: '15px', fontWeight: 600, marginBottom: '14px' }}>
                {t('v2.config.viewMode')}
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
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

            {/* Depth setting */}
            <GlassPanel style={{ padding: '20px', marginBottom: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                <h3 style={{ color: colors.text1, fontSize: '15px', fontWeight: 600, margin: 0 }}>
                  {t('v2.settings.depth')}
                </h3>
                <label style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontSize: '13px',
                  color: colors.text2,
                  cursor: 'pointer',
                }}>
                  <input
                    type="checkbox"
                    checked={autoDepth}
                    onChange={(e) => {
                      setAutoDepth(e.target.checked);
                      if (e.target.checked && detectedDepth !== null) {
                        setBeam((b) => ({ ...b, depthMaxM: detectedDepth }));
                      }
                    }}
                  />
                  {t('v2.settings.autoDepth')}
                </label>
              </div>

              {autoDepth && detectedDepth !== null ? (
                <div style={{
                  padding: '12px 16px',
                  borderRadius: '8px',
                  background: 'rgba(68,136,255,0.08)',
                  border: '1px solid rgba(68,136,255,0.15)',
                  fontSize: '14px',
                  color: colors.text1,
                }}>
                  {t('v2.settings.detectedDepth')}: <strong>{detectedDepth}m</strong>
                </div>
              ) : autoDepth ? (
                <div style={{
                  padding: '12px 16px',
                  borderRadius: '8px',
                  background: 'rgba(255,180,0,0.08)',
                  border: '1px solid rgba(255,180,0,0.2)',
                  fontSize: '13px',
                  color: colors.text2,
                }}>
                  {t('v2.settings.depthNotDetected')}
                </div>
              ) : null}

              {!autoDepth && (
                <div>
                  <Slider
                    label={t('v2.config.depthMax')}
                    value={beam.depthMaxM}
                    min={1}
                    max={100}
                    step={1}
                    onChange={(v) => setBeam((b) => ({ ...b, depthMaxM: v }))}
                  />
                  <p style={{ color: colors.text3, fontSize: '12px', marginTop: '6px', lineHeight: 1.5 }}>
                    {t('v2.settings.depthHint')}
                  </p>
                </div>
              )}
            </GlassPanel>

            {/* Summary */}
            <GlassPanel style={{ padding: '16px', marginBottom: '24px' }}>
              <h3 style={{ color: colors.text1, fontSize: '14px', fontWeight: 600, marginBottom: '10px' }}>
                {t('v2.settings.summary')}
              </h3>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                gap: '12px',
                fontSize: '13px',
              }}>
                <div>
                  <div style={{ color: colors.text3, fontSize: '11px', marginBottom: '2px' }}>{t('v2.settings.cropSize')}</div>
                  <div style={{ color: colors.text1, fontWeight: 500 }}>{crop.width}×{crop.height}</div>
                </div>
                <div>
                  <div style={{ color: colors.text3, fontSize: '11px', marginBottom: '2px' }}>{t('v2.preview.frames')}</div>
                  <div style={{ color: colors.text1, fontWeight: 500 }}>~{Math.floor(state.videoDurationS * fpsExtraction)}</div>
                </div>
                <div>
                  <div style={{ color: colors.text3, fontSize: '11px', marginBottom: '2px' }}>{t('v2.preview.distance')}</div>
                  <div style={{ color: colors.text1, fontWeight: 500 }}>{state.gpxTrack?.totalDistanceM.toFixed(0)}m</div>
                </div>
                <div>
                  <div style={{ color: colors.text3, fontSize: '11px', marginBottom: '2px' }}>{t('v2.config.memory')}</div>
                  <div style={{ color: memEstimate > 512 ? colors.error : colors.text1, fontWeight: 500 }}>~{memEstimate.toFixed(0)} MB</div>
                </div>
              </div>
            </GlassPanel>

            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <Button variant="ghost" size="lg" onClick={() => setPhase('crop')}>
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
                  setPhase('settings');
                }}
              >
                {t('v2.pipeline.abort')}
              </Button>
            </div>
          </div>
        )}

        {/* ── Viewer Phase ──────────────────────────────────────────── */}
        {phase === 'viewer' && (
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', flexShrink: 0 }}>
              <h1 style={{ color: colors.text1, fontSize: '18px', fontWeight: 600, margin: 0 }}>
                {t('v2.viewer.title')}
              </h1>
              <div style={{ display: 'flex', gap: '8px' }}>
                <Button variant="ghost" size="sm" onClick={() => setPhase('settings')}>
                  {t('v2.viewer.reconfigure')}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => {
                  setPhase('import');
                  setVolumeData(null);
                  setFrameReady(false);
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

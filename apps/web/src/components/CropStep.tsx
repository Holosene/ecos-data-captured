import React, { useRef, useEffect, useState, useCallback } from 'react';
import { GlassPanel, Button, colors } from '@echos/ui';
import type { CropRect } from '@echos/core';
import { useTranslation } from '../i18n/index.js';
import { useAppState } from '../store/app-state.js';

/**
 * CropStep — Sonar region crop overlay
 *
 * Root cause of previous bugs:
 *   The old code created a new blob URL + <video> element on every localCrop
 *   change (i.e. every mousemove during drag). This caused:
 *   - Hundreds of blob URLs created per second
 *   - Videos still loading from revoked URLs → ERR_FILE_NOT_FOUND
 *   - Massive CPU/memory spike, frozen UI
 *
 * Fix: cache frame as ImageBitmap once, draw overlay purely on canvas.
 *   Pipeline processing only happens on "Confirm" click.
 */
export function CropStep() {
  const { state, dispatch } = useAppState();
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [frameReady, setFrameReady] = useState(false);
  const [localCrop, setLocalCrop] = useState<CropRect>(state.crop);
  const [scale, setScale] = useState(1);

  // Cached frame bitmap — loaded once, reused for all overlay draws
  const frameBitmapRef = useRef<ImageBitmap | null>(null);

  // Drag state in refs to avoid re-renders during mouse movement
  const draggingRef = useRef(false);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const localCropRef = useRef<CropRect>(state.crop);
  const scaleRef = useRef(1);
  const rafIdRef = useRef(0);

  // Keep refs in sync
  localCropRef.current = localCrop;
  scaleRef.current = scale;

  // ─── Load video frame once as ImageBitmap ──────────────────────────
  useEffect(() => {
    if (!state.videoFile) return;

    const isBlobUrl = !state.videoUrl;
    const url = state.videoUrl ?? URL.createObjectURL(state.videoFile);
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.crossOrigin = 'anonymous';
    let disposed = false;

    video.onloadeddata = () => {
      video.currentTime = Math.min(2, video.duration / 2);
    };

    video.onseeked = async () => {
      if (disposed) return;
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas) return;

      const maxW = container ? container.clientWidth - 40 : 800;
      const s = Math.min(1, maxW / video.videoWidth);
      setScale(s);
      scaleRef.current = s;

      canvas.width = video.videoWidth * s;
      canvas.height = video.videoHeight * s;

      // Render to offscreen canvas then create ImageBitmap
      const offscreen = document.createElement('canvas');
      offscreen.width = canvas.width;
      offscreen.height = canvas.height;
      const offCtx = offscreen.getContext('2d');
      if (offCtx) {
        offCtx.drawImage(video, 0, 0, canvas.width, canvas.height);
        try {
          frameBitmapRef.current = await createImageBitmap(offscreen);
        } catch {
          // Fallback: keep reference to offscreen canvas
          frameBitmapRef.current = null;
        }
      }

      // Revoke blob URL — video element is no longer needed
      if (isBlobUrl) URL.revokeObjectURL(url);

      if (!disposed) {
        setFrameReady(true);
      }
    };

    video.src = url;

    return () => {
      disposed = true;
      if (isBlobUrl) URL.revokeObjectURL(url);
    };
  }, [state.videoFile, state.videoUrl]);

  // ─── Draw overlay using cached bitmap — zero blob URLs ─────────────
  const drawOverlay = useCallback(() => {
    const canvas = canvasRef.current;
    const bitmap = frameBitmapRef.current;
    if (!canvas || !bitmap) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const crop = localCropRef.current;
    const s = scaleRef.current;

    // Draw full frame
    ctx.drawImage(bitmap, 0, 0);

    // Dim overlay
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Crop region: clear dimming and redraw bright
    const cx = crop.x * s;
    const cy = crop.y * s;
    const cw = crop.width * s;
    const ch = crop.height * s;

    ctx.save();
    ctx.beginPath();
    ctx.rect(cx, cy, cw, ch);
    ctx.clip();
    ctx.drawImage(bitmap, 0, 0);
    ctx.restore();

    // Dashed border
    ctx.strokeStyle = '#8A7CFF';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(cx, cy, cw, ch);
    ctx.setLineDash([]);

    // Corner handles
    const hs = 8;
    ctx.fillStyle = '#8A7CFF';
    for (const [hx, hy] of [[cx, cy], [cx + cw, cy], [cx, cy + ch], [cx + cw, cy + ch]]) {
      ctx.fillRect(hx - hs / 2, hy - hs / 2, hs, hs);
    }
  }, []);

  // Redraw on crop change (but NOT during drag — see rAF below)
  useEffect(() => {
    if (frameReady) drawOverlay();
  }, [frameReady, localCrop, scale, drawOverlay]);

  // ─── Mouse events with rAF throttle for 60fps drag ────────────────
  const getCanvasCoords = useCallback(
    (e: React.MouseEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      return {
        x: Math.round((e.clientX - rect.left) / scaleRef.current),
        y: Math.round((e.clientY - rect.top) / scaleRef.current),
      };
    },
    [],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      dragStartRef.current = getCanvasCoords(e);
      draggingRef.current = true;
    },
    [getCanvasCoords],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!draggingRef.current || !dragStartRef.current) return;

      const coords = getCanvasCoords(e);
      const start = dragStartRef.current;
      const x = Math.min(start.x, coords.x);
      const y = Math.min(start.y, coords.y);
      const w = Math.abs(coords.x - start.x);
      const h = Math.abs(coords.y - start.y);
      const newCrop = { x, y, width: Math.max(10, w), height: Math.max(10, h) };

      // Update ref immediately (for drawOverlay)
      localCropRef.current = newCrop;

      // Throttle: rAF for canvas draw + batched React state update
      if (!rafIdRef.current) {
        rafIdRef.current = requestAnimationFrame(() => {
          rafIdRef.current = 0;
          drawOverlay();
          setLocalCrop(localCropRef.current);
        });
      }
    },
    [getCanvasCoords, drawOverlay],
  );

  const handleMouseUp = useCallback(() => {
    draggingRef.current = false;
    dragStartRef.current = null;
    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = 0;
    }
    setLocalCrop(localCropRef.current);
    drawOverlay();
  }, [drawOverlay]);

  return (
    <div style={{ display: 'grid', gap: '32px' }}>
      <div>
        <h2 style={{ fontSize: 'clamp(24px, 2.5vw, 32px)', fontWeight: 600, marginBottom: '12px' }}>
          {t('crop.title')}
        </h2>
        <p style={{ color: colors.text2, fontSize: '16px', lineHeight: 1.7, maxWidth: '640px' }}>
          {t('crop.desc')}
        </p>
      </div>

      <GlassPanel padding="24px">
        <div
          ref={containerRef}
          style={{
            position: 'relative',
            display: 'flex',
            justifyContent: 'center',
            cursor: 'crosshair',
          }}
        >
          <canvas
            ref={canvasRef}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            style={{ borderRadius: '8px', maxWidth: '100%' }}
          />
          {!frameReady && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: colors.text3,
                fontSize: '15px',
              }}
            >
              {t('crop.loading')}
            </div>
          )}
        </div>

        <div
          className="grid-4-cols"
          style={{
            marginTop: '20px',
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: '16px',
          }}
        >
          {[
            { label: 'X', value: localCrop.x },
            { label: 'Y', value: localCrop.y },
            { label: 'W', value: localCrop.width },
            { label: 'H', value: localCrop.height },
          ].map(({ label, value }) => (
            <div key={label} style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '12px', color: colors.text3, marginBottom: '4px' }}>{label}</div>
              <div style={{ fontSize: '18px', fontWeight: 600, color: colors.accent, fontVariantNumeric: 'tabular-nums' }}>
                {value}px
              </div>
            </div>
          ))}
        </div>
      </GlassPanel>

      {state.error && (
        <div style={{ color: colors.error, fontSize: '15px', padding: '8px' }}>{state.error}</div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <Button variant="ghost" size="lg" onClick={() => dispatch({ type: 'SET_STEP', step: 'import' })}>
          {t('crop.back')}
        </Button>
        <Button
          variant="primary"
          size="lg"
          disabled={localCrop.width < 20 || localCrop.height < 20}
          onClick={() => {
            dispatch({ type: 'SET_CROP', crop: localCrop });
            dispatch({ type: 'CONFIRM_CROP' });
            dispatch({ type: 'SET_STEP', step: 'calibration' });
          }}
        >
          {t('crop.confirm')}
        </Button>
      </div>
    </div>
  );
}

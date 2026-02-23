import React, { useMemo } from 'react';
import { GlassPanel, Button, Slider, colors } from '@echos/ui';
import { enrichTrackpoints } from '@echos/core';
import { useTranslation } from '../i18n/index.js';
import { useAppState } from '../store/app-state.js';

export function SyncStep() {
  const { state, dispatch } = useAppState();
  const { t } = useTranslation();
  const { gpxTrack, videoDurationS, sync } = state;

  const enriched = useMemo(
    () => (gpxTrack ? enrichTrackpoints(gpxTrack) : []),
    [gpxTrack],
  );

  const maxDist = enriched.length > 0 ? enriched[enriched.length - 1].cumulativeDistanceM : 0;

  const chartWidth = 600;
  const chartHeight = 120;
  const chartPoints = useMemo(() => {
    if (enriched.length === 0) return '';
    const maxT = enriched[enriched.length - 1].elapsedS || 1;
    return enriched
      .map((pt) => {
        const x = (pt.elapsedS / maxT) * chartWidth;
        const y = chartHeight - (pt.cumulativeDistanceM / (maxDist || 1)) * chartHeight;
        return `${x},${y}`;
      })
      .join(' ');
  }, [enriched, maxDist]);

  return (
    <div style={{ display: 'grid', gap: '32px' }}>
      <div>
        <h2 style={{ fontSize: 'clamp(24px, 2.5vw, 32px)', fontWeight: 600, marginBottom: '12px' }}>
          {t('sync.title')}
        </h2>
        <p style={{ color: colors.text2, fontSize: '16px', lineHeight: 1.7, maxWidth: '640px' }}>
          {t('sync.desc')}
        </p>
      </div>

      <div className="grid-2-cols" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
        <GlassPanel padding="24px">
          <div style={{ fontSize: '13px', color: colors.text3, marginBottom: '6px' }}>{t('sync.videoDuration')}</div>
          <div style={{ fontSize: '24px', fontWeight: 600 }}>{videoDurationS.toFixed(1)}s</div>
        </GlassPanel>
        <GlassPanel padding="24px">
          <div style={{ fontSize: '13px', color: colors.text3, marginBottom: '6px' }}>{t('sync.gpxDuration')}</div>
          <div style={{ fontSize: '24px', fontWeight: 600 }}>{gpxTrack?.durationS.toFixed(1) ?? '-'}s</div>
        </GlassPanel>
      </div>

      <GlassPanel padding="28px">
        <Slider
          label={t('sync.timeOffset')}
          value={sync.offsetS}
          min={-30}
          max={30}
          step={0.5}
          unit=" s"
          tooltip={t('sync.timeOffsetTooltip')}
          onChange={(v) => dispatch({ type: 'SET_SYNC', sync: { offsetS: v } })}
        />

        <div style={{ marginTop: '20px' }}>
          <div style={{ fontSize: '13px', color: colors.text3, marginBottom: '10px' }}>
            {t('sync.distOverTime')}
          </div>
          <svg
            viewBox={`0 0 ${chartWidth} ${chartHeight}`}
            style={{ width: '100%', height: '120px', background: colors.surface, borderRadius: '8px' }}
          >
            {sync.offsetS !== 0 && gpxTrack && (
              <line
                x1={(Math.abs(sync.offsetS) / (gpxTrack.durationS || 1)) * chartWidth}
                y1={0}
                x2={(Math.abs(sync.offsetS) / (gpxTrack.durationS || 1)) * chartWidth}
                y2={chartHeight}
                stroke={colors.warning}
                strokeWidth={1}
                strokeDasharray="4 3"
              />
            )}
            <polyline
              points={chartPoints}
              fill="none"
              stroke={colors.accent}
              strokeWidth={2}
            />
          </svg>
        </div>
      </GlassPanel>

      <GlassPanel padding="24px">
        <div className="grid-4-cols" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '20px', textAlign: 'center' }}>
          <div>
            <div style={{ fontSize: '12px', color: colors.text3 }}>{t('sync.totalDist')}</div>
            <div style={{ fontSize: '18px', fontWeight: 600, marginTop: '4px' }}>{maxDist.toFixed(0)} m</div>
          </div>
          <div>
            <div style={{ fontSize: '12px', color: colors.text3 }}>{t('sync.avgSpeed')}</div>
            <div style={{ fontSize: '18px', fontWeight: 600, marginTop: '4px' }}>
              {gpxTrack && gpxTrack.durationS > 0
                ? (maxDist / gpxTrack.durationS).toFixed(1)
                : '-'}{' '}
              m/s
            </div>
          </div>
          <div>
            <div style={{ fontSize: '12px', color: colors.text3 }}>{t('sync.timeRatio')}</div>
            <div style={{ fontSize: '18px', fontWeight: 600, marginTop: '4px' }}>
              {gpxTrack ? (gpxTrack.durationS / videoDurationS).toFixed(2) : '-'}x
            </div>
          </div>
        </div>
      </GlassPanel>

      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <Button variant="ghost" size="lg" onClick={() => dispatch({ type: 'SET_STEP', step: 'calibration' })}>
          {t('sync.back')}
        </Button>
        <Button variant="primary" size="lg" onClick={() => dispatch({ type: 'SET_STEP', step: 'generate' })}>
          {t('sync.next')}
        </Button>
      </div>
    </div>
  );
}

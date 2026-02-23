import React from 'react';
import { GlassPanel, Button, Slider, colors } from '@echos/ui';
import { estimateVolume } from '@echos/core';
import { useTranslation } from '../i18n/index.js';
import { useAppState } from '../store/app-state.js';

export function CalibrationStep() {
  const { state, dispatch } = useAppState();
  const { t } = useTranslation();
  const { calibration, crop, gpxTrack } = state;

  const totalDistM = gpxTrack?.totalDistanceM ?? 100;
  const est = estimateVolume(
    crop.width,
    crop.height,
    totalDistM,
    calibration.yStepM,
    calibration.downscaleFactor,
  );

  return (
    <div style={{ display: 'grid', gap: '32px' }}>
      <div>
        <h2 style={{ fontSize: 'clamp(24px, 2.5vw, 32px)', fontWeight: 600, marginBottom: '12px' }}>
          {t('calib.title')}
        </h2>
        <p style={{ color: colors.text2, fontSize: '16px', lineHeight: 1.7, maxWidth: '640px' }}>
          {t('calib.desc')}
        </p>
      </div>

      <div className="grid-2-cols" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
        <GlassPanel padding="28px">
          <h3 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '24px' }}>{t('calib.depthRes')}</h3>

          <Slider
            label={t('calib.depthMax')}
            value={calibration.depthMaxM}
            min={1}
            max={100}
            step={0.5}
            unit=" m"
            tooltip={t('calib.depthMaxTooltip')}
            onChange={(v) => dispatch({ type: 'SET_CALIBRATION', calibration: { depthMaxM: v } })}
          />

          <Slider
            label={t('calib.yStep')}
            value={calibration.yStepM}
            min={0.05}
            max={1.0}
            step={0.05}
            unit=" m"
            tooltip={t('calib.yStepTooltip')}
            onChange={(v) => dispatch({ type: 'SET_CALIBRATION', calibration: { yStepM: v } })}
          />
        </GlassPanel>

        <GlassPanel padding="28px">
          <h3 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '24px' }}>{t('calib.processing')}</h3>

          <Slider
            label={t('calib.fps')}
            value={calibration.fpsExtraction}
            min={1}
            max={5}
            step={1}
            unit=" fps"
            tooltip={t('calib.fpsTooltip')}
            onChange={(v) => dispatch({ type: 'SET_CALIBRATION', calibration: { fpsExtraction: v } })}
          />

          <Slider
            label={t('calib.downscale')}
            value={calibration.downscaleFactor}
            min={0.25}
            max={1.0}
            step={0.25}
            unit="x"
            tooltip={t('calib.downscaleTooltip')}
            onChange={(v) => dispatch({ type: 'SET_CALIBRATION', calibration: { downscaleFactor: v } })}
          />
        </GlassPanel>
      </div>

      <GlassPanel padding="24px">
        <h4 style={{ fontSize: '15px', fontWeight: 600, color: colors.accent, marginBottom: '16px' }}>
          {t('calib.volumeEstimate')}
        </h4>
        <div className="grid-4-cols" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '20px', textAlign: 'center' }}>
          <div>
            <div style={{ fontSize: '12px', color: colors.text3 }}>{t('calib.dimensions')}</div>
            <div style={{ fontSize: '16px', fontWeight: 600, fontVariantNumeric: 'tabular-nums', marginTop: '4px' }}>
              {est.dimX} x {est.dimY} x {est.dimZ}
            </div>
          </div>
          <div>
            <div style={{ fontSize: '12px', color: colors.text3 }}>{t('calib.memory')}</div>
            <div
              style={{
                fontSize: '16px',
                fontWeight: 600,
                color: est.estimatedMB > 512 ? colors.warning : colors.text1,
                marginTop: '4px',
              }}
            >
              {est.estimatedMB.toFixed(0)} MB
            </div>
          </div>
          <div>
            <div style={{ fontSize: '12px', color: colors.text3 }}>{t('calib.trackDist')}</div>
            <div style={{ fontSize: '16px', fontWeight: 600, marginTop: '4px' }}>{totalDistM.toFixed(0)} m</div>
          </div>
          <div>
            <div style={{ fontSize: '12px', color: colors.text3 }}>{t('calib.zSpacing')}</div>
            <div style={{ fontSize: '16px', fontWeight: 600, marginTop: '4px' }}>
              {(calibration.depthMaxM / (crop.height * calibration.downscaleFactor)).toFixed(3)} m/px
            </div>
          </div>
        </div>

        {est.estimatedMB > 512 && (
          <div
            style={{
              marginTop: '16px',
              padding: '12px 16px',
              background: 'rgba(245, 166, 35, 0.1)',
              border: `1px solid ${colors.warning}`,
              borderRadius: '8px',
              fontSize: '14px',
              color: colors.warning,
            }}
          >
            {t('calib.largeWarning')}
          </div>
        )}
      </GlassPanel>

      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <Button variant="ghost" size="lg" onClick={() => dispatch({ type: 'SET_STEP', step: 'crop' })}>
          {t('calib.back')}
        </Button>
        <Button variant="primary" size="lg" onClick={() => dispatch({ type: 'SET_STEP', step: 'sync' })}>
          {t('calib.next')}
        </Button>
      </div>
    </div>
  );
}

/**
 * ECOS V2 — Map Page
 *
 * Session manager with map view.
 * Each recording is displayed as an independent GPS trace.
 * Clicking loads the volumetric viewer.
 */

import React, { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { GlassPanel, Button, colors } from '@echos/ui';
import { useAppState } from '../store/app-state.js';
import { useTranslation } from '../i18n/index.js';
import { useTheme } from '../theme/index.js';
import { MapView } from '../components/MapView.js';
import type { RecordingSession } from '@echos/core';

export function MapPage() {
  const { state, dispatch } = useAppState();
  const { t } = useTranslation();
  const { theme } = useTheme();
  const navigate = useNavigate();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const handleSessionSelect = useCallback((id: string) => {
    setSelectedId(id);
    dispatch({ type: 'SET_ACTIVE_SESSION', id });
  }, [dispatch]);

  const selectedSession = state.sessions.find((s) => s.id === selectedId);

  return (
    <div style={{ background: colors.black, minHeight: 'calc(100vh - 72px)' }}>
      <div style={{ padding: 'clamp(24px, 3vw, 48px) var(--content-gutter)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h1 style={{ color: colors.text1, fontSize: 'clamp(20px, 2.5vw, 28px)', fontWeight: 600, margin: 0 }}>
            {t('v2.map.title')}
          </h1>
          <span style={{ color: colors.text3, fontSize: '13px' }}>
            {state.sessions.length} {t('v2.map.sessions')}
          </span>
        </div>

        <div className="map-page-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: '16px', minHeight: '500px' }}>
          {/* Map */}
          <MapView
            sessions={state.sessions}
            selectedSessionId={selectedId}
            onSessionSelect={handleSessionSelect}
            gpxTracks={state.gpxTracks}
            theme={theme}
          />

          {/* Session list */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '600px', overflowY: 'auto' }}>
            {state.sessions.length === 0 && (
              <GlassPanel style={{ padding: '32px', textAlign: 'center' }}>
                <p style={{ color: colors.text3, fontSize: '14px', margin: '0 0 16px' }}>
                  {t('v2.map.noSessions')}
                </p>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => navigate('/scan')}
                >
                  {t('v2.map.newScan')}
                </Button>
              </GlassPanel>
            )}

            {state.sessions.map((session) => (
              <SessionCard
                key={session.id}
                session={session}
                isSelected={session.id === selectedId}
                onClick={() => handleSessionSelect(session.id)}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function SessionCard({
  session,
  isSelected,
  onClick,
}: {
  session: RecordingSession;
  isSelected: boolean;
  onClick: () => void;
}) {
  const { t } = useTranslation();

  return (
    <GlassPanel
      style={{
        padding: '14px',
        cursor: 'pointer',
        border: isSelected ? `2px solid ${colors.accent}` : undefined,
        transition: 'border-color 150ms ease',
      }}
      onClick={onClick}
    >
      <div style={{ color: colors.text1, fontWeight: 600, fontSize: '14px', marginBottom: '4px' }}>
        {session.name}
      </div>
      <div style={{ display: 'flex', gap: '12px', color: colors.text3, fontSize: '12px' }}>
        <span>{session.totalDistanceM.toFixed(0)} m</span>
        <span>{(session.durationS / 60).toFixed(1)} min</span>
        <span>{session.frameCount} frames</span>
      </div>
      <div style={{ color: colors.text3, fontSize: '11px', marginTop: '4px' }}>
        {new Date(session.createdAt).toLocaleDateString()} —
        {session.gridDimensions.join('×')}
      </div>
    </GlassPanel>
  );
}

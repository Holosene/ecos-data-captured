/**
 * ECHOS V2 — Map View Component
 *
 * Leaflet-based map displaying recording sessions as GPS traces.
 * Each recording is an independent entity.
 * Clicking a recording loads its volumetric viewer.
 */

import React, { useRef, useEffect, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { RecordingSession } from '@echos/core';
import { colors } from '@echos/ui';
import { useTranslation } from '../i18n/index.js';

interface MapViewProps {
  sessions: RecordingSession[];
  selectedSessionId: string | null;
  onSessionSelect: (id: string) => void;
  gpxTracks?: Map<string, Array<{ lat: number; lon: number }>>;
}

export function MapView({
  sessions,
  selectedSessionId,
  onSessionSelect,
  gpxTracks,
}: MapViewProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const leafletMap = useRef<L.Map | null>(null);
  const layersRef = useRef<Map<string, L.Polyline>>(new Map());
  const { t } = useTranslation();

  // Initialize map
  useEffect(() => {
    if (!mapRef.current || leafletMap.current) return;

    const map = L.map(mapRef.current, {
      center: [46.6, 2.3],
      zoom: 6,
      zoomControl: false,
      scrollWheelZoom: false,
      attributionControl: false,
    });

    // Custom zoom control positioned top-right
    L.control.zoom({ position: 'topright' }).addTo(map);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
    }).addTo(map);

    // Attribution
    L.control
      .attribution({ position: 'bottomright' })
      .addAttribution('&copy; <a href="https://carto.com">CARTO</a>')
      .addTo(map);

    leafletMap.current = map;

    return () => {
      map.remove();
      leafletMap.current = null;
    };
  }, []);

  // Update session layers
  useEffect(() => {
    const map = leafletMap.current;
    if (!map) return;

    // Clear old layers
    layersRef.current.forEach((layer) => layer.remove());
    layersRef.current.clear();

    const bounds = L.latLngBounds([]);

    sessions.forEach((session) => {
      const track = gpxTracks?.get(session.id);
      if (!track || track.length < 2) {
        // Use bounds if no track data
        if (session.bounds) {
          const [minLat, minLon, maxLat, maxLon] = session.bounds;
          const center = L.latLng((minLat + maxLat) / 2, (minLon + maxLon) / 2);
          bounds.extend(center);

          const marker = L.circleMarker(center, {
            radius: 8,
            color: session.id === selectedSessionId ? '#4488ff' : '#8866ff',
            fillColor: session.id === selectedSessionId ? '#4488ff' : '#8866ff',
            fillOpacity: 0.6,
            weight: 2,
          })
            .addTo(map)
            .on('click', () => onSessionSelect(session.id));

          marker.bindPopup(createPopupContent(session));
        }
        return;
      }

      const latLngs = track.map((p) => L.latLng(p.lat, p.lon));
      bounds.extend(latLngs);

      const isSelected = session.id === selectedSessionId;
      const polyline = L.polyline(latLngs, {
        color: isSelected ? '#4488ff' : '#8866ff',
        weight: isSelected ? 4 : 2,
        opacity: isSelected ? 1.0 : 0.6,
        smoothFactor: 1.5,
      })
        .addTo(map)
        .on('click', () => onSessionSelect(session.id));

      polyline.bindPopup(createPopupContent(session));
      layersRef.current.set(session.id, polyline);
    });

    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
    }
  }, [sessions, selectedSessionId, gpxTracks, onSessionSelect]);

  return (
    <div style={{ position: 'relative', height: '100%', minHeight: '400px' }}>
      <div
        ref={mapRef}
        style={{
          width: '100%',
          height: '100%',
          borderRadius: '12px',
          overflow: 'hidden',
          border: `1px solid ${colors.border}`,
        }}
      />

      {sessions.length === 0 && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
          }}
        >
          <div
            style={{
              padding: '16px 24px',
              borderRadius: '12px',
              background: 'rgba(0,0,0,0.7)',
              color: colors.text2,
              fontSize: '14px',
              border: `1px solid ${colors.border}`,
            }}
          >
            {t('v2.map.empty')}
          </div>
        </div>
      )}
    </div>
  );
}

function createPopupContent(session: RecordingSession): string {
  return `
    <div style="font-family: Inter, sans-serif; font-size: 13px; min-width: 180px;">
      <strong style="font-size: 14px;">${escapeHtml(session.name)}</strong>
      <div style="margin-top: 6px; color: #888;">
        ${session.totalDistanceM.toFixed(0)} m &bull;
        ${(session.durationS / 60).toFixed(1)} min &bull;
        ${session.frameCount} frames
      </div>
      <div style="margin-top: 4px; color: #666; font-size: 11px;">
        ${new Date(session.createdAt).toLocaleDateString()}
      </div>
    </div>
  `;
}

function escapeHtml(str: string): string {
  return str.replace(/[&<>"']/g, (c) => {
    const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return map[c] || c;
  });
}

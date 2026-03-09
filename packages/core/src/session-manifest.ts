/**
 * ECOS — Session Manifest
 *
 * Types and helpers for the pre-generated sessions registry.
 * Sessions are stored as static files in public/sessions/ and
 * declared in a manifest.json file loaded at app boot.
 *
 * Each session directory contains:
 *   - track.gpx                     — GPS trace
 *   - volume-instrument.echos-vol   — pre-computed instrument volume
 *   - volume-spatial.echos-vol      — pre-computed spatial volume
 *   - thumbnail.webp                — optional preview image
 */

import type { PreprocessingSettings, BeamSettings, RecordingSession } from './v2-types.js';

// ─── Manifest entry (JSON on disk) ──────────────────────────────────────────

export interface SessionManifestEntry {
  id: string;
  name: string;
  createdAt: string;
  videoFileName: string;
  gpxFileName: string;
  /** [minLat, minLon, maxLat, maxLon] */
  bounds: [number, number, number, number];
  totalDistanceM: number;
  durationS: number;
  frameCount: number;
  gridDimensions: [number, number, number];
  preprocessing: PreprocessingSettings;
  beam: BeamSettings;
  files: {
    gpx: string;
    volumeInstrument?: string;
    volumeSpatial?: string;
    thumbnail?: string;
  };
}

// ─── Convert manifest entry → RecordingSession ─────────────────────────────

export function manifestEntryToSession(entry: SessionManifestEntry): RecordingSession {
  return {
    id: entry.id,
    name: entry.name,
    createdAt: entry.createdAt,
    videoFileName: entry.videoFileName,
    gpxFileName: entry.gpxFileName,
    bounds: entry.bounds,
    totalDistanceM: entry.totalDistanceM,
    durationS: entry.durationS,
    frameCount: entry.frameCount,
    gridDimensions: entry.gridDimensions,
    preprocessing: entry.preprocessing,
    beam: entry.beam,
  };
}

// ─── Fetch manifest ─────────────────────────────────────────────────────────

export async function fetchSessionManifest(basePath: string): Promise<SessionManifestEntry[]> {
  const url = `${basePath}sessions/manifest.json`;
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Failed to fetch session manifest: ${resp.status} ${resp.statusText}`);
  }
  const data: SessionManifestEntry[] = await resp.json();
  return data;
}

// ─── Fetch GPX track points from a session ──────────────────────────────────

export async function fetchSessionGpxTrack(
  basePath: string,
  sessionId: string,
  gpxFileName: string,
  parseGpxFn: (xml: string) => { points: Array<{ lat: number; lon: number }> },
): Promise<Array<{ lat: number; lon: number }>> {
  const url = `${basePath}sessions/${sessionId}/${gpxFileName}`;
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Failed to fetch GPX for session ${sessionId}: ${resp.status}`);
  }
  const xml = await resp.text();
  const track = parseGpxFn(xml);
  return track.points.map((p) => ({ lat: p.lat, lon: p.lon }));
}

// ─── Fetch pre-generated volume (.echos-vol) ───────────────────────────────

export async function fetchSessionVolume(
  basePath: string,
  sessionId: string,
  volumeFileName: string,
): Promise<ArrayBuffer> {
  const url = `${basePath}sessions/${sessionId}/${volumeFileName}`;
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Failed to fetch volume for session ${sessionId}: ${resp.status}`);
  }
  return resp.arrayBuffer();
}

// ─── Build volume file URL (for lazy loading) ──────────────────────────────

export function getSessionVolumeUrl(
  basePath: string,
  sessionId: string,
  volumeFileName: string,
): string {
  return `${basePath}sessions/${sessionId}/${volumeFileName}`;
}

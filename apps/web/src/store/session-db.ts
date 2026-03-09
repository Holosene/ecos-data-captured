/**
 * ECOS — IndexedDB Session Storage
 *
 * Persists recording sessions and their pre-generated volumes
 * in the browser's IndexedDB. This allows "Poster" on the Scan page
 * to save everything locally — no backend needed.
 *
 * Schema:
 *   Store "sessions"  → { id, manifest, gpxTrack }
 *   Store "volumes"   → { key: "${sessionId}/${type}", data: ArrayBuffer }
 */

import type { SessionManifestEntry } from '@echos/core';
import { serializeVolume } from '@echos/core';
import type { VolumeSnapshot } from '@echos/core';

const DB_NAME = 'echos-sessions';
const DB_VERSION = 1;
const STORE_SESSIONS = 'sessions';
const STORE_VOLUMES = 'volumes';

// ─── DB handle (singleton) ──────────────────────────────────────────────────

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_SESSIONS)) {
        db.createObjectStore(STORE_SESSIONS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_VOLUMES)) {
        db.createObjectStore(STORE_VOLUMES);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
  });
  return dbPromise;
}

// ─── Session CRUD ───────────────────────────────────────────────────────────

export interface StoredSession {
  id: string;
  manifest: SessionManifestEntry;
  gpxTrack: Array<{ lat: number; lon: number }>;
}

/** Save a session (manifest + GPX track). */
export async function saveSession(session: StoredSession): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SESSIONS, 'readwrite');
    tx.objectStore(STORE_SESSIONS).put(session);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Load all stored sessions. */
export async function loadAllSessions(): Promise<StoredSession[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SESSIONS, 'readonly');
    const req = tx.objectStore(STORE_SESSIONS).getAll();
    req.onsuccess = () => resolve(req.result ?? []);
    req.onerror = () => reject(req.error);
  });
}

/** Check if a session with the same video+gpx combo already exists. */
export async function findDuplicate(
  videoFileName: string,
  gpxFileName: string,
): Promise<StoredSession | null> {
  const all = await loadAllSessions();
  return all.find(
    (s) => s.manifest.videoFileName === videoFileName && s.manifest.gpxFileName === gpxFileName,
  ) ?? null;
}

/** Delete a session and its volumes. */
export async function deleteSession(sessionId: string): Promise<void> {
  const db = await openDB();
  const tx = db.transaction([STORE_SESSIONS, STORE_VOLUMES], 'readwrite');
  tx.objectStore(STORE_SESSIONS).delete(sessionId);
  // Delete associated volumes
  tx.objectStore(STORE_VOLUMES).delete(`${sessionId}/instrument`);
  tx.objectStore(STORE_VOLUMES).delete(`${sessionId}/spatial`);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ─── Volume storage ─────────────────────────────────────────────────────────

/** Save a volume binary for a session. */
export async function saveVolume(
  sessionId: string,
  type: 'instrument' | 'spatial',
  snapshot: VolumeSnapshot,
): Promise<void> {
  const db = await openDB();
  const buffer = serializeVolume(snapshot);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_VOLUMES, 'readwrite');
    tx.objectStore(STORE_VOLUMES).put(buffer, `${sessionId}/${type}`);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Load a volume binary. Returns null if not found. */
export async function loadVolume(
  sessionId: string,
  type: 'instrument' | 'spatial',
): Promise<ArrayBuffer | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_VOLUMES, 'readonly');
    const req = tx.objectStore(STORE_VOLUMES).get(`${sessionId}/${type}`);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

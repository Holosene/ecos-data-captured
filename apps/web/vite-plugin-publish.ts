/**
 * Vite Plugin — Session Publisher (dev mode only)
 *
 * Adds a POST endpoint `/api/publish-session` that writes session files
 * directly to `public/sessions/` so they become part of the repo.
 *
 * This allows one-click "Poster" from the Scan page:
 *   1. Receives volume binary + manifest data + GPX
 *   2. Creates `public/sessions/<id>/` directory
 *   3. Writes .echos-vol binary, GPX file
 *   4. Updates `public/sessions/manifest.json`
 *
 * Only active during `vite dev` — in production, sessions are static files.
 */

import type { Plugin } from 'vite';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const SESSIONS_DIR = join(process.cwd(), 'public', 'sessions');
const MANIFEST_PATH = join(SESSIONS_DIR, 'manifest.json');

export function publishSessionPlugin(): Plugin {
  return {
    name: 'echos-publish-session',
    configureServer(server) {
      // POST /api/publish-session — multipart: manifest JSON + volume binary + optional GPX
      server.middlewares.use('/api/publish-session', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end(JSON.stringify({ error: 'Method not allowed' }));
          return;
        }

        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => {
          try {
            const body = Buffer.concat(chunks);
            // Protocol: JSON header length (4 bytes LE) + JSON + volume binary + GPX text
            // The JSON contains: manifest entry + volumeSize + gpxSize
            const headerLen = body.readUInt32LE(0);
            const headerJson = body.subarray(4, 4 + headerLen).toString('utf-8');
            const header = JSON.parse(headerJson);

            const { manifest, volumeSize, spatialVolumeSize, gpxText } = header;
            const sessionId = manifest.id;

            // Extract volume binaries
            const volStart = 4 + headerLen;
            const volumeBuffer = body.subarray(volStart, volStart + volumeSize);

            const spatialStart = volStart + volumeSize;
            const spatialBuffer = spatialVolumeSize > 0
              ? body.subarray(spatialStart, spatialStart + spatialVolumeSize)
              : null;

            // Create session directory
            const sessionDir = join(SESSIONS_DIR, sessionId);
            if (!existsSync(sessionDir)) {
              mkdirSync(sessionDir, { recursive: true });
            }

            // Write instrument volume binary
            if (manifest.files.volumeInstrument) {
              writeFileSync(
                join(sessionDir, manifest.files.volumeInstrument),
                volumeBuffer,
              );
            }

            // Write spatial volume binary
            if (spatialBuffer && manifest.files.volumeSpatial) {
              writeFileSync(
                join(sessionDir, manifest.files.volumeSpatial),
                spatialBuffer,
              );
            }

            // Write GPX file
            if (gpxText && manifest.files.gpx) {
              writeFileSync(join(sessionDir, manifest.files.gpx), gpxText, 'utf-8');
            }

            // Update manifest.json
            let entries: any[] = [];
            if (existsSync(MANIFEST_PATH)) {
              try {
                entries = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'));
              } catch {
                entries = [];
              }
            }

            // Replace if same ID exists, otherwise append
            const idx = entries.findIndex((e: any) => e.id === sessionId);
            if (idx >= 0) {
              entries[idx] = manifest;
            } else {
              entries.push(manifest);
            }

            writeFileSync(MANIFEST_PATH, JSON.stringify(entries, null, 2) + '\n', 'utf-8');

            console.log(`\n  ✓ Session published: ${sessionId}`);
            console.log(`    → ${sessionDir}/`);

            res.setHeader('Content-Type', 'application/json');
            res.statusCode = 200;
            res.end(JSON.stringify({ ok: true, sessionId }));
          } catch (err) {
            console.error('Publish error:', err);
            res.statusCode = 500;
            res.end(JSON.stringify({ error: (err as Error).message }));
          }
        });
      });
    },
  };
}

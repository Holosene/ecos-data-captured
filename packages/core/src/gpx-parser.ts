/**
 * GPX file parser.
 * Extracts trackpoints with timestamps, computes cumulative distance,
 * applies jitter smoothing, and detects immobility.
 */

import type { GpxTrack, GpxTrackpoint, GpxPointWithDistance } from './types.js';
import { haversineDistance, cumulativeDistances } from './haversine.js';

/**
 * Parse a GPX XML string into a GpxTrack.
 * Supports standard GPX 1.0 / 1.1 format.
 */
export function parseGpx(xmlString: string): GpxTrack {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlString, 'application/xml');

  const parseError = doc.querySelector('parsererror');
  if (parseError) {
    throw new Error(`Invalid GPX file: ${parseError.textContent?.slice(0, 200)}`);
  }

  const trackName = doc.querySelector('trk > name')?.textContent ?? undefined;

  // Collect all trackpoints across all <trk> and <trkseg> elements
  const trkpts = doc.querySelectorAll('trkpt');

  if (trkpts.length === 0) {
    throw new Error('GPX file contains no trackpoints. Ensure the file has <trkpt> elements.');
  }

  const points: GpxTrackpoint[] = [];
  let skippedNoCoords = 0;
  let skippedNanCoords = 0;
  let skippedNoTime = 0;
  let skippedInvalidTime = 0;

  // Also collect ALL timestamps (even from points we might skip for other reasons)
  // to detect if points are being dropped at boundaries
  const allTimestamps: number[] = [];

  trkpts.forEach((trkpt) => {
    const latAttr = trkpt.getAttribute('lat');
    const lonAttr = trkpt.getAttribute('lon');
    const timeEl = trkpt.querySelector('time');
    const eleEl = trkpt.querySelector('ele');

    // Collect timestamp even before lat/lon validation
    if (timeEl?.textContent) {
      const ts = new Date(timeEl.textContent.trim()).getTime();
      if (!isNaN(ts)) {
        allTimestamps.push(ts);
      }
    }

    if (!latAttr || !lonAttr) {
      skippedNoCoords++;
      return;
    }

    const lat = parseFloat(latAttr);
    const lon = parseFloat(lonAttr);

    if (isNaN(lat) || isNaN(lon)) {
      skippedNanCoords++;
      return;
    }

    let time: Date;
    if (timeEl?.textContent) {
      time = new Date(timeEl.textContent.trim());
      if (isNaN(time.getTime())) {
        skippedInvalidTime++;
        return;
      }
    } else {
      skippedNoTime++;
      return;
    }

    const ele = eleEl?.textContent ? parseFloat(eleEl.textContent) : undefined;

    points.push({ lat, lon, time, ele: isNaN(ele as number) ? undefined : ele });
  });

  const totalSkipped = skippedNoCoords + skippedNanCoords + skippedNoTime + skippedInvalidTime;

  // Log diagnostics
  console.log(
    `[GPX] Parsed ${points.length}/${trkpts.length} trackpoints` +
    (totalSkipped > 0
      ? ` (dropped ${totalSkipped}: noCoords=${skippedNoCoords}, nanCoords=${skippedNanCoords}, noTime=${skippedNoTime}, invalidTime=${skippedInvalidTime})`
      : ''),
  );

  if (points.length < 2) {
    throw new Error(
      `GPX file has only ${points.length} valid trackpoint(s) out of ${trkpts.length} total. ` +
      `Dropped: noCoords=${skippedNoCoords}, nanCoords=${skippedNanCoords}, noTime=${skippedNoTime}, invalidTime=${skippedInvalidTime}. ` +
      `Need at least 2 for distance computation.`,
    );
  }

  // Sort by time (should already be sorted, but be safe)
  points.sort((a, b) => a.time.getTime() - b.time.getTime());

  const distances = cumulativeDistances(points);
  const totalDistanceM = distances[distances.length - 1];
  const startTime = points[0].time;
  const endTime = points[points.length - 1].time;
  const durationS = (endTime.getTime() - startTime.getTime()) / 1000;

  // Check if any timestamps were outside the valid points' time range
  // (indicates points were dropped at the boundaries, affecting duration)
  if (allTimestamps.length > points.length) {
    const allMin = Math.min(...allTimestamps);
    const allMax = Math.max(...allTimestamps);
    const fullSpanS = (allMax - allMin) / 1000;
    if (Math.abs(fullSpanS - durationS) > 1) {
      console.warn(
        `[GPX] Duration mismatch: valid points span ${durationS.toFixed(1)}s, ` +
        `but all timestamps (including dropped points) span ${fullSpanS.toFixed(1)}s. ` +
        `Some boundary points were dropped.`,
      );
    }
  }

  // Check for segment gaps (pauses in recording)
  const trksegs = doc.querySelectorAll('trkseg');
  if (trksegs.length > 1) {
    console.log(`[GPX] File contains ${trksegs.length} track segments (possible pauses in recording).`);
  }

  console.log(
    `[GPX] Time range: ${startTime.toISOString()} → ${endTime.toISOString()} = ${durationS.toFixed(1)}s (${(durationS / 60).toFixed(1)} min)`,
  );

  return {
    name: trackName,
    points,
    totalDistanceM,
    durationS,
    startTime,
    endTime,
  };
}

/**
 * Enrich trackpoints with cumulative distance, elapsed time, and smoothed speed.
 * Applies a simple moving average on speed to reduce GPS jitter.
 */
export function enrichTrackpoints(
  track: GpxTrack,
  options: {
    /** Speed smoothing window (odd number recommended). Default: 5 */
    smoothingWindow?: number;
    /** Speed below this (m/s) is considered immobile. Default: 0.3 */
    immobilityThresholdMs?: number;
  } = {},
): GpxPointWithDistance[] {
  const { smoothingWindow = 5, immobilityThresholdMs = 0.3 } = options;
  const { points } = track;
  const distances = cumulativeDistances(points);
  const startMs = points[0].time.getTime();

  // Compute raw speeds
  const rawSpeeds = new Array<number>(points.length);
  rawSpeeds[0] = 0;
  for (let i = 1; i < points.length; i++) {
    const dt = (points[i].time.getTime() - points[i - 1].time.getTime()) / 1000;
    const dd = distances[i] - distances[i - 1];
    rawSpeeds[i] = dt > 0 ? dd / dt : 0;
  }

  // Moving average smoothing
  const halfWin = Math.floor(smoothingWindow / 2);
  const smoothedSpeeds = new Array<number>(points.length);
  for (let i = 0; i < points.length; i++) {
    let sum = 0;
    let count = 0;
    for (let j = Math.max(0, i - halfWin); j <= Math.min(points.length - 1, i + halfWin); j++) {
      sum += rawSpeeds[j];
      count++;
    }
    smoothedSpeeds[i] = sum / count;
  }

  return points.map((pt, i) => ({
    ...pt,
    cumulativeDistanceM: distances[i],
    elapsedS: (pt.time.getTime() - startMs) / 1000,
    speedMs: smoothedSpeeds[i] < immobilityThresholdMs ? 0 : smoothedSpeeds[i],
  }));
}

/**
 * Interpolate distance at a given elapsed time (seconds from track start).
 * Uses linear interpolation between surrounding trackpoints.
 */
export function interpolateDistance(
  enrichedPoints: GpxPointWithDistance[],
  elapsedS: number,
): { distanceM: number; lat: number; lon: number } {
  if (elapsedS <= 0) {
    const p = enrichedPoints[0];
    return { distanceM: p.cumulativeDistanceM, lat: p.lat, lon: p.lon };
  }

  const last = enrichedPoints[enrichedPoints.length - 1];
  if (elapsedS >= last.elapsedS) {
    return { distanceM: last.cumulativeDistanceM, lat: last.lat, lon: last.lon };
  }

  // Binary search for surrounding points
  let lo = 0;
  let hi = enrichedPoints.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (enrichedPoints[mid].elapsedS <= elapsedS) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  const p0 = enrichedPoints[lo];
  const p1 = enrichedPoints[hi];
  const dt = p1.elapsedS - p0.elapsedS;
  const t = dt > 0 ? (elapsedS - p0.elapsedS) / dt : 0;

  return {
    distanceM: p0.cumulativeDistanceM + t * (p1.cumulativeDistanceM - p0.cumulativeDistanceM),
    lat: p0.lat + t * (p1.lat - p0.lat),
    lon: p0.lon + t * (p1.lon - p0.lon),
  };
}

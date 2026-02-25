import { describe, it, expect } from 'vitest';
import { parseGpx, enrichTrackpoints, interpolateDistance } from '../src/gpx-parser.js';
const SAMPLE_GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="test">
  <trk>
    <name>Test Track</name>
    <trkseg>
      <trkpt lat="48.8566" lon="2.3522">
        <ele>35</ele>
        <time>2024-01-01T10:00:00Z</time>
      </trkpt>
      <trkpt lat="48.8576" lon="2.3522">
        <time>2024-01-01T10:00:10Z</time>
      </trkpt>
      <trkpt lat="48.8586" lon="2.3522">
        <ele>36</ele>
        <time>2024-01-01T10:00:20Z</time>
      </trkpt>
      <trkpt lat="48.8596" lon="2.3522">
        <time>2024-01-01T10:00:30Z</time>
      </trkpt>
      <trkpt lat="48.8606" lon="2.3522">
        <time>2024-01-01T10:00:40Z</time>
      </trkpt>
    </trkseg>
  </trk>
</gpx>`;
describe('parseGpx', () => {
    it('parses a valid GPX file', () => {
        const track = parseGpx(SAMPLE_GPX);
        expect(track.name).toBe('Test Track');
        expect(track.points).toHaveLength(5);
        expect(track.durationS).toBe(40);
        expect(track.totalDistanceM).toBeGreaterThan(0);
    });
    it('extracts coordinates correctly', () => {
        const track = parseGpx(SAMPLE_GPX);
        expect(track.points[0].lat).toBeCloseTo(48.8566, 4);
        expect(track.points[0].lon).toBeCloseTo(2.3522, 4);
    });
    it('handles optional elevation', () => {
        const track = parseGpx(SAMPLE_GPX);
        expect(track.points[0].ele).toBe(35);
        expect(track.points[1].ele).toBeUndefined();
        expect(track.points[2].ele).toBe(36);
    });
    it('rejects empty GPX', () => {
        const emptyGpx = `<?xml version="1.0"?><gpx></gpx>`;
        expect(() => parseGpx(emptyGpx)).toThrow(/no trackpoints/i);
    });
    it('rejects GPX with only one point', () => {
        const onePoint = `<?xml version="1.0"?><gpx><trk><trkseg>
      <trkpt lat="48.0" lon="2.0"><time>2024-01-01T10:00:00Z</time></trkpt>
    </trkseg></trk></gpx>`;
        expect(() => parseGpx(onePoint)).toThrow(/at least 2/i);
    });
    it('rejects invalid XML', () => {
        expect(() => parseGpx('not xml at all')).toThrow();
    });
});
describe('enrichTrackpoints', () => {
    it('computes cumulative distance and elapsed time', () => {
        const track = parseGpx(SAMPLE_GPX);
        const enriched = enrichTrackpoints(track);
        expect(enriched).toHaveLength(5);
        expect(enriched[0].cumulativeDistanceM).toBe(0);
        expect(enriched[0].elapsedS).toBe(0);
        expect(enriched[4].elapsedS).toBe(40);
        expect(enriched[4].cumulativeDistanceM).toBeGreaterThan(0);
    });
    it('computes smoothed speed', () => {
        const track = parseGpx(SAMPLE_GPX);
        const enriched = enrichTrackpoints(track);
        // All points are moving northward at ~111m per 0.001° every 10s
        // Speed should be roughly 11 m/s
        for (let i = 1; i < enriched.length; i++) {
            expect(enriched[i].speedMs).toBeGreaterThan(5);
            expect(enriched[i].speedMs).toBeLessThan(20);
        }
    });
    it('marks low-speed as immobile', () => {
        // Create a track where the boat doesn't move
        const stationaryGpx = `<?xml version="1.0"?><gpx><trk><trkseg>
      <trkpt lat="48.0" lon="2.0"><time>2024-01-01T10:00:00Z</time></trkpt>
      <trkpt lat="48.0" lon="2.0"><time>2024-01-01T10:00:10Z</time></trkpt>
      <trkpt lat="48.0" lon="2.0"><time>2024-01-01T10:00:20Z</time></trkpt>
    </trkseg></trk></gpx>`;
        const track = parseGpx(stationaryGpx);
        const enriched = enrichTrackpoints(track);
        for (const pt of enriched) {
            expect(pt.speedMs).toBe(0);
        }
    });
});
describe('interpolateDistance', () => {
    it('interpolates at midpoint', () => {
        const track = parseGpx(SAMPLE_GPX);
        const enriched = enrichTrackpoints(track);
        const result = interpolateDistance(enriched, 20); // midpoint
        expect(result.distanceM).toBeGreaterThan(0);
        expect(result.distanceM).toBeLessThan(enriched[4].cumulativeDistanceM);
    });
    it('returns start for t<=0', () => {
        const track = parseGpx(SAMPLE_GPX);
        const enriched = enrichTrackpoints(track);
        const result = interpolateDistance(enriched, -5);
        expect(result.distanceM).toBe(0);
    });
    it('returns end for t >= duration', () => {
        const track = parseGpx(SAMPLE_GPX);
        const enriched = enrichTrackpoints(track);
        const result = interpolateDistance(enriched, 100);
        expect(result.distanceM).toBeCloseTo(enriched[4].cumulativeDistanceM, 1);
    });
    it('interpolates linearly between points', () => {
        const track = parseGpx(SAMPLE_GPX);
        const enriched = enrichTrackpoints(track);
        const d10 = interpolateDistance(enriched, 10).distanceM;
        const d20 = interpolateDistance(enriched, 20).distanceM;
        const d30 = interpolateDistance(enriched, 30).distanceM;
        // Since points are evenly spaced, distances should increase roughly linearly
        expect(d20).toBeGreaterThan(d10);
        expect(d30).toBeGreaterThan(d20);
    });
});
//# sourceMappingURL=gpx-parser.test.js.map
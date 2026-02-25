import { describe, it, expect } from 'vitest';
import { createSession, serializeSession, deserializeSession } from '../src/session.js';
describe('session', () => {
    const params = {
        videoFileName: 'sonar_recording.mp4',
        gpxFileName: 'track.gpx',
        crop: { x: 50, y: 30, width: 400, height: 300 },
        calibration: { depthMaxM: 15, fpsExtraction: 2, downscaleFactor: 0.75, yStepM: 0.1 },
        sync: { offsetS: 1.5, videoStartEpochMs: 1704067200000, videoEndEpochMs: 1704067800000 },
    };
    it('creates a session with all fields', () => {
        const session = createSession(params);
        expect(session.version).toBe('1.0.0');
        expect(session.videoFileName).toBe('sonar_recording.mp4');
        expect(session.crop.width).toBe(400);
        expect(session.calibration.depthMaxM).toBe(15);
        expect(session.createdAt).toBeTruthy();
    });
    it('round-trips through serialize/deserialize', () => {
        const session = createSession(params);
        const json = serializeSession(session);
        const restored = deserializeSession(json);
        expect(restored.videoFileName).toBe(session.videoFileName);
        expect(restored.crop).toEqual(session.crop);
        expect(restored.calibration).toEqual(session.calibration);
        expect(restored.sync).toEqual(session.sync);
    });
    it('rejects invalid JSON', () => {
        expect(() => deserializeSession('not json')).toThrow(/not valid JSON/);
    });
    it('rejects missing required fields', () => {
        expect(() => deserializeSession('{}')).toThrow(/Missing required fields/);
    });
    it('rejects invalid crop', () => {
        const bad = JSON.stringify({ version: '1', videoFileName: 'a', gpxFileName: 'b', crop: {} });
        expect(() => deserializeSession(bad)).toThrow(/crop/i);
    });
});
//# sourceMappingURL=session.test.js.map
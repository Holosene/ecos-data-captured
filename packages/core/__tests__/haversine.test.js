import { describe, it, expect } from 'vitest';
import { haversineDistance, cumulativeDistances } from '../src/haversine.js';
describe('haversineDistance', () => {
    it('returns 0 for identical points', () => {
        expect(haversineDistance(48.8566, 2.3522, 48.8566, 2.3522)).toBe(0);
    });
    it('computes Paris to Lyon correctly (~392 km)', () => {
        const d = haversineDistance(48.8566, 2.3522, 45.7640, 4.8357);
        expect(d).toBeGreaterThan(390_000);
        expect(d).toBeLessThan(395_000);
    });
    it('computes short distances (~100m) with reasonable accuracy', () => {
        // ~111m per 0.001° latitude at equator
        const d = haversineDistance(0, 0, 0.001, 0);
        expect(d).toBeGreaterThan(100);
        expect(d).toBeLessThan(120);
    });
    it('handles negative coordinates', () => {
        const d = haversineDistance(-33.8688, 151.2093, -37.8136, 144.9631);
        expect(d).toBeGreaterThan(700_000);
        expect(d).toBeLessThan(800_000);
    });
    it('handles antipodal points (~20,000 km)', () => {
        const d = haversineDistance(0, 0, 0, 180);
        expect(d).toBeGreaterThan(20_000_000);
        expect(d).toBeLessThan(20_100_000);
    });
});
describe('cumulativeDistances', () => {
    it('returns [0] for a single point', () => {
        const result = cumulativeDistances([{ lat: 48.8566, lon: 2.3522 }]);
        expect(result).toEqual([0]);
    });
    it('computes cumulative distances correctly', () => {
        const points = [
            { lat: 0, lon: 0 },
            { lat: 0.001, lon: 0 },
            { lat: 0.002, lon: 0 },
        ];
        const result = cumulativeDistances(points);
        expect(result[0]).toBe(0);
        expect(result[1]).toBeGreaterThan(100);
        expect(result[2]).toBeGreaterThan(200);
        // Should be roughly double
        expect(result[2]).toBeCloseTo(result[1] * 2, -1);
    });
    it('handles identical consecutive points', () => {
        const points = [
            { lat: 48.0, lon: 2.0 },
            { lat: 48.0, lon: 2.0 },
            { lat: 48.001, lon: 2.0 },
        ];
        const result = cumulativeDistances(points);
        expect(result[0]).toBe(0);
        expect(result[1]).toBe(0);
        expect(result[2]).toBeGreaterThan(0);
    });
});
//# sourceMappingURL=haversine.test.js.map
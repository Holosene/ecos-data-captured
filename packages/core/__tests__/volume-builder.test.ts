import { describe, it, expect } from 'vitest';
import { buildVolume, estimateVolume } from '../src/volume-builder.js';
import type { FrameData, FrameMapping, CalibrationSettings } from '../src/types.js';

function makeFrame(index: number, width: number, height: number, value: number): FrameData {
  const pixels = new Uint8Array(width * height);
  pixels.fill(value);
  return { index, timeS: index, pixels, width, height };
}

function makeMapping(index: number, distanceM: number): FrameMapping {
  return { frameIndex: index, timeS: index, distanceM, lat: 0, lon: 0 };
}

describe('buildVolume', () => {
  it('builds a volume from frames', () => {
    const width = 4;
    const height = 3;
    const calibration: CalibrationSettings = {
      depthMaxM: 10,
      fpsExtraction: 1,
      downscaleFactor: 1,
      yStepM: 5,
    };

    const frames = [
      makeFrame(0, width, height, 0),
      makeFrame(1, width, height, 128),
      makeFrame(2, width, height, 255),
    ];
    const mappings = [
      makeMapping(0, 0),
      makeMapping(1, 10),
      makeMapping(2, 20),
    ];

    const volume = buildVolume({ frames, mappings, calibration });

    expect(volume.metadata.dimensions[0]).toBe(width);   // lateral
    expect(volume.metadata.dimensions[1]).toBe(height);  // depth
    expect(volume.metadata.dimensions[2]).toBeGreaterThan(0); // track
    expect(volume.data.length).toBe(
      volume.metadata.dimensions[0] *
      volume.metadata.dimensions[1] *
      volume.metadata.dimensions[2],
    );
  });

  it('throws on empty frames', () => {
    expect(() =>
      buildVolume({
        frames: [],
        mappings: [],
        calibration: { depthMaxM: 10, fpsExtraction: 1, downscaleFactor: 1, yStepM: 1 },
      }),
    ).toThrow(/No frames/);
  });

  it('throws on mismatched frame/mapping count', () => {
    expect(() =>
      buildVolume({
        frames: [makeFrame(0, 2, 2, 100)],
        mappings: [],
        calibration: { depthMaxM: 10, fpsExtraction: 1, downscaleFactor: 1, yStepM: 1 },
      }),
    ).toThrow(/does not match/);
  });

  it('normalizes pixel values to 0-1', () => {
    const frames = [makeFrame(0, 2, 2, 255), makeFrame(1, 2, 2, 0)];
    const mappings = [makeMapping(0, 0), makeMapping(1, 1)];
    const calibration = { depthMaxM: 10, fpsExtraction: 1, downscaleFactor: 1, yStepM: 0.5 };

    const volume = buildVolume({ frames, mappings, calibration });

    // Check that values are in [0, 1]
    for (let i = 0; i < volume.data.length; i++) {
      expect(volume.data[i]).toBeGreaterThanOrEqual(0);
      expect(volume.data[i]).toBeLessThanOrEqual(1);
    }
  });
});

describe('estimateVolume', () => {
  it('estimates dimensions correctly', () => {
    const result = estimateVolume(200, 100, 50, 0.1, 1.0);
    expect(result.dimX).toBe(200);   // lateral
    expect(result.dimY).toBe(100);   // depth
    expect(result.dimZ).toBe(501);   // track: 50/0.1 + 1
    expect(result.estimatedMB).toBeGreaterThan(0);
  });

  it('applies downscale factor', () => {
    const full = estimateVolume(200, 100, 50, 0.1, 1.0);
    const half = estimateVolume(200, 100, 50, 0.1, 0.5);
    expect(half.dimX).toBe(100);  // lateral
    expect(half.dimY).toBe(50);   // depth
    expect(half.estimatedMB).toBeLessThan(full.estimatedMB);
  });
});

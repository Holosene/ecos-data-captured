# ECOS — Technical Notes

## Architecture

ECOS is a client-side web application deployed as a static site on GitHub Pages. All processing happens in the user's browser — no server is required.

### Monorepo Structure

```
/
├── apps/web          — React + Vite frontend (GitHub Pages target)
├── packages/core     — Pure TypeScript library (parsing, sync, volume)
├── packages/ui       — React design system components
├── docs/             — Conceptual + technical documentation
└── .github/workflows — CI/CD (deploy to GitHub Pages)
```

### Key Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Deployment | GitHub Pages (static) | Zero-cost, zero-maintenance, no backend needed |
| Framework | React 18 + Vite 5 | Fast builds, good ecosystem, TypeScript-first |
| Routing | HashRouter | GitHub Pages doesn't support SPA fallback routing |
| State | useReducer + Context | Simple, no external deps, sufficient for wizard flow |
| Frame extraction | Canvas API + video seeking | Browser-native, no heavy WASM dependency |
| GPX parsing | DOMParser (browser-native XML) | Zero dependency, standard API |
| Volume format | Float32Array + NRRD export | Scientific standard, compatible with 3D Slicer/ParaView |
| Visualization | Canvas 2D slice rendering | Lightweight, no WebGL dependency for MVP |
| Styling | Inline styles + CSS variables | Glassmorphism design system, no build dependency |

### Frame Extraction Strategy

The MVP uses the browser's native `<video>` element and Canvas API:
1. Load video as Object URL
2. Seek to each timestamp (`video.currentTime = t`)
3. Draw the crop region onto an offscreen canvas with downscaling
4. Convert to grayscale via luminance formula (0.299R + 0.587G + 0.114B)

**Trade-offs:**
- Pro: Zero dependencies, works everywhere
- Con: Sequential seeking is slower than ffmpeg.wasm parallel extraction
- Con: Browser may drop frames or interpolate during seeking

**Future upgrade path:** Replace with ffmpeg.wasm Web Worker for parallel frame extraction when performance becomes a bottleneck on long videos.

### Volume Construction

1. **Extraction:** N frames at configured FPS
2. **Mapping:** Each frame gets a GPS position via time interpolation
3. **Resampling:** Frames are placed on a regular distance grid (Y step)
4. **Interpolation:** Linear interpolation between neighboring frames
5. **Storage:** Float32Array, index = z * dimY * dimX + y * dimX + x

### GPS Synchronization

MVP uses linear time mapping:
```
gpxElapsed = (videoTime - offset) × (gpxDuration / videoDuration)
```

This assumes constant speed ratio between video and GPS recording. The offset slider allows manual correction for start time differences.

### Memory Management

Volume memory estimation:
```
bytes = dimX × dimY × dimZ × 4 (Float32)
```

For a typical scan:
- Crop: 400×300 pixels, downscale 0.5 → 200×150
- Track: 500m at 0.10m step → 5001 slices
- Volume: 200 × 5001 × 150 × 4 = ~572 MB

Guard rails:
- Warning displayed when estimated volume > 512 MB
- Quick Preview mode limits to 30 seconds
- Downscale and Y step are user-configurable
- Frame extraction is sequential (no memory spike from parallel loads)

### NRRD Format

The exported .nrrd file contains:
- ASCII header with dimensions, spacing, and metadata
- Raw binary Float32 data (little-endian)

Compatible with: 3D Slicer, ParaView, ITK, teem/nrrd tools, Python (pynrrd), MATLAB.

## Volume Coordinate System

```
      X (width)
     ──────────→
    ╱
   ╱ Y (distance along track)
  ╱
 ╱
↓ Z (depth: 0=surface, max=bottom)
```

Spacing:
- X: depthMax / cropHeight (approximation assuming square pixels)
- Y: y_step (user-configured, default 0.10m)
- Z: depthMax / cropHeight

## Transfer Functions

Color presets map intensity [0, 1] to RGBA using piecewise linear interpolation:

- **Water Off:** Transparent below 0.15, ramp from deep blue to white
- **Structures:** Multi-color ramp emphasizing mid-range echoes
- **High Contrast:** Sharp transition at low threshold, wide color range
- **Grayscale:** Simple linear black-to-white mapping

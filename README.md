# ECOS

**Perceptive archive from sonar screen captures and GPS traces.**

ECOS transforms consumer sonar screen recordings (MP4) and simultaneous GPS tracks (GPX) into explorable 3D volumes — all in your browser, no server required.

> *The screen recording is not a degraded copy of something better. It is the most accessible, most shareable, most reproducible form of the sonar observation.*

[Read the Manifesto →](docs/manifesto.md)

---

## What it does

1. **Import** an MP4 screen recording of your sonar display + a GPX file from your smartphone
2. **Crop** the sonar echo region (exclude menus, decorations)
3. **Calibrate** depth, frame rate, resolution
4. **Sync** video timeline to GPS track
5. **Generate** a 3D volume (slice stacking + distance interpolation)
6. **Explore** with interactive orthogonal slice views and color presets
7. **Export** as NRRD (compatible with 3D Slicer, ParaView) + mapping JSON + QC report

All processing happens **client-side** in your browser. No data ever leaves your machine.

---

## Quick Start

### Prerequisites

- Node.js >= 18
- npm >= 9

### Development

```bash
# Install all dependencies
npm install

# Start development server
npm run dev
```

The app will be available at `http://localhost:5173/echos-donees-capturees/`

### Build

```bash
npm run build
```

Build output goes to `apps/web/dist/`.

### Test

```bash
npm test
```

Runs unit tests for `@echos/core` (GPX parsing, haversine, volume building, session management).

---

## Project Structure

```
echos-donees-capturees/
├── apps/
│   └── web/                    — React + Vite frontend (GitHub Pages target)
│       ├── src/
│       │   ├── components/     — Wizard step components
│       │   ├── pages/          — Route pages (Home, Wizard, Manifesto, Docs)
│       │   ├── store/          — Application state (useReducer)
│       │   ├── App.tsx         — Router setup
│       │   └── main.tsx        — Entry point
│       ├── index.html
│       └── vite.config.ts
├── packages/
│   ├── core/                   — Pure TypeScript library
│   │   ├── src/
│   │   │   ├── gpx-parser.ts   — GPX parsing, enrichment, interpolation
│   │   │   ├── haversine.ts    — Haversine distance calculation
│   │   │   ├── volume-builder.ts — 3D volume construction
│   │   │   ├── nrrd-export.ts  — NRRD format encoder
│   │   │   ├── sync.ts         — Frame-to-GPS synchronization
│   │   │   ├── session.ts      — .echos.json session management
│   │   │   ├── qc-report.ts    — Quality control report
│   │   │   └── types.ts        — Type definitions
│   │   └── __tests__/          — Unit tests (vitest)
│   └── ui/                     — Design system
│       └── src/
│           ├── components/     — GlassPanel, Button, Slider, etc.
│           ├── tokens.ts       — Design tokens (colors, spacing)
│           └── styles.css      — Global styles
├── docs/
│   ├── manifesto.md
│   └── technical-notes.md
├── .github/workflows/
│   └── deploy.yml              — GitHub Pages deployment
├── README.md
└── LICENSE (MIT)
```

---

## Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Deployment** | GitHub Pages (static) | Zero-cost, no backend required |
| **Framework** | React 18 + Vite 5 + TypeScript | Fast, typed, well-supported |
| **Routing** | HashRouter | GitHub Pages doesn't support SPA routing |
| **Frame extraction** | Canvas API + video seeking | Zero dependencies, browser-native |
| **GPX parsing** | DOMParser | Browser-native XML parsing |
| **Volume format** | Float32Array → NRRD | Standard scientific format |
| **Visualization** | Canvas 2D slice rendering | Lightweight, no WebGL for MVP |
| **Design** | Glassmorphism, dark UI | Modern, minimal, accessible |

### Why not ffmpeg.wasm?

The MVP uses native browser video seeking + Canvas API for frame extraction. This is slower but has zero dependencies and works on all modern browsers. The architecture is designed so that the frame extraction module can be replaced with ffmpeg.wasm without changing the volume building pipeline.

### Why not VTK.js for rendering?

The MVP uses Canvas 2D for orthogonal slice views. This is lightweight, fast, and doesn't require WebGL2. VTK.js volume rendering can be added as an enhancement for users with capable GPUs. The volume data format (Float32Array + metadata) is already compatible with VTK.js vtkImageData.

---

## GitHub Pages Deployment

The repository includes a GitHub Actions workflow (`.github/workflows/deploy.yml`) that:

1. Builds all packages
2. Builds the web app with `base: '/echos-donees-capturees/'`
3. Deploys to GitHub Pages

### Setup

1. Go to your repository **Settings → Pages**
2. Under "Build and deployment", set **Source** to **"GitHub Actions"** (not "Deploy from a branch")
3. Push to `main` branch — deployment happens automatically

### Base Path

The Vite config sets `base: '/echos-donees-capturees/'` to match the repository name. If you fork/rename the repo, update this in `apps/web/vite.config.ts`.

The app uses `HashRouter` to avoid 404 issues on GitHub Pages (URLs like `/#/scan` instead of `/scan`).

### Deployment Verification

After deployment, visit `https://<user>.github.io/echos-donees-capturees/`. You should see:

- The **ECOS** title with a gradient effect
- A **"Start New Scan"** button
- A dark glassmorphism UI (background `#1A1A1A`)
- The wizard flow accessible at `/#/scan`

**If you see the README content rendered as a documentation page instead**, it means:
- GitHub Pages is set to "Deploy from a branch" instead of "GitHub Actions" — change it in Settings → Pages
- OR the GitHub Actions workflow failed — check the Actions tab for build errors
- The deployed artifact must be the Vite build output (`apps/web/dist/`), not the repo root

---

## User Journey

```
┌──────────┐    ┌────────┐    ┌───────────┐    ┌──────┐    ┌──────────┐    ┌────────┐
│  Home    │ →  │ Import │ →  │   Crop    │ →  │ Cal. │ →  │   Sync   │ →  │Generate│ → Viewer
│          │    │ MP4+GPX│    │ rectangle │    │depth │    │  offset  │    │progress│
└──────────┘    └────────┘    └───────────┘    └──────┘    └──────────┘    └────────┘
```

1. **Home** — Project intro + "Start New Scan" button
2. **Import** — Drag & drop MP4 + GPX files (+ optional .echos.json session reload)
3. **Crop** — Draw rectangle on video preview frame to isolate sonar data
4. **Calibrate** — Set depth max, FPS, downscale, Y step; see volume size estimate
5. **Sync** — Adjust time offset, view distance-over-time chart
6. **Generate** — Quick Preview (30s) or Full; progress bar + collapsible logs
7. **Viewer** — 3 orthogonal slice views, 4 color presets, export (NRRD, JSON, session)

---

## Known Limitations

- **Frame extraction speed:** Sequential video seeking is slow for long videos (>10 min). Future: Web Worker + ffmpeg.wasm.
- **No volume rendering:** MVP provides 2D orthogonal slices only. Volume rendering (ray casting) requires VTK.js or WebGL2 integration.
- **Linear sync only:** Video-to-GPS mapping assumes constant speed ratio. Non-linear mapping (drift, stops) requires advanced sync.
- **No auto-crop:** The crop region must be drawn manually. Auto-detection of the sonar display region is a future enhancement.
- **Memory limits:** Large volumes (>512 MB) may cause browser tab crashes. Use downscale + larger Y step for long scans.
- **Single track segment:** Only the first GPX track segment is used. Multi-segment tracks are not yet supported.

## Roadmap

- [ ] Web Worker frame extraction (parallel, non-blocking)
- [ ] ffmpeg.wasm integration for faster frame extraction
- [ ] VTK.js volume rendering (ray casting with transfer functions)
- [ ] Auto-crop detection (edge detection on sonar UI)
- [ ] Auto-sync (motion detection ↔ GPS speed correlation)
- [ ] Multi-segment GPX support
- [ ] WebGPU-accelerated volume rendering
- [ ] Offline support (Service Worker / PWA)
- [ ] Annotation / marker system on volume
- [ ] Collaborative sharing (volume file hosting)

---

## License

MIT — see [LICENSE](LICENSE).

/**
 * ECHOS V2 — WebGL2 Ray Marching Volume Renderer
 *
 * Uses Three.js for scene management, camera controls, and WebGL2 3D textures.
 * Custom ShaderMaterial for GPU ray marching.
 *
 * Supports:
 *   - 3D Float32/Half-float texture upload
 *   - Single-pass front-to-back ray accumulation
 *   - Transfer function LUT
 *   - Real-time interactive controls
 *   - Beam wireframe overlay
 *   - Camera presets (frontal, horizontal, vertical, free)
 *   - Live calibration via CalibrationConfig
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { RendererSettings, ChromaticMode } from '@echos/core';
import { DEFAULT_RENDERER } from '@echos/core';
import { generateLUT } from './transfer-function.js';

// ─── Calibration config ─────────────────────────────────────────────────────

export interface CalibrationConfig {
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number }; // degrees
  scale: { x: number; y: number; z: number };
  axisMapping: {
    lateral: 'x' | 'y' | 'z';
    depth: 'x' | 'y' | 'z';
    track: 'x' | 'y' | 'z';
  };
  camera: { dist: number; fov: number };
  grid: { y: number };
  axes: { size: number };
  bgColor: string;
}

export const DEFAULT_CALIBRATION: CalibrationConfig = {
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 180, y: 0, z: 0 },
  scale: { x: 3, y: 1, z: 1 },
  axisMapping: { track: 'x', depth: 'y', lateral: 'z' },
  camera: { dist: 1.6, fov: 40 },
  grid: { y: -0.5 },
  axes: { size: 0.8 },
  bgColor: '#111111',
};

const AXIS_IDX = { x: 0, y: 1, z: 2 } as const;
const DEG2RAD = Math.PI / 180;

/** Build a 3×3 permutation matrix that remaps box-space UVW → texture-space UVW */
function buildAxisRemapMatrix(mapping: CalibrationConfig['axisMapping']): THREE.Matrix3 {
  // Column-major: e[col*3 + row]
  const e = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  e[AXIS_IDX[mapping.lateral] * 3 + 0] = 1; // tex U (lateral) ← world axis
  e[AXIS_IDX[mapping.track] * 3 + 1] = 1;   // tex V (track)   ← world axis
  e[AXIS_IDX[mapping.depth] * 3 + 2] = 1;   // tex W (depth)   ← world axis
  const mat = new THREE.Matrix3();
  mat.fromArray(e);
  return mat;
}

export type CameraPreset = 'frontal' | 'horizontal' | 'vertical' | 'free';

export class VolumeRenderer {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;

  private volumeTexture: THREE.Data3DTexture | null = null;
  private tfTexture: THREE.DataTexture;
  private volumeMesh: THREE.Mesh | null = null;
  private material: THREE.RawShaderMaterial | null = null;
  private beamGroup: THREE.Group;

  private settings: RendererSettings;
  private dimensions: [number, number, number] = [1, 1, 1];
  private extent: [number, number, number] = [1, 1, 1];
  private animationId: number = 0;
  private disposed = false;
  private currentPreset: CameraPreset = 'frontal';
  private volumeScale: THREE.Vector3 = new THREE.Vector3(1, 1, 1);
  private meshCreated = false;
  private calibration: CalibrationConfig;
  private gridHelper: THREE.GridHelper;
  private axesHelper: THREE.AxesHelper;

  constructor(
    container: HTMLElement,
    initialSettings?: Partial<RendererSettings>,
    initialCalibration?: CalibrationConfig,
  ) {
    this.settings = { ...DEFAULT_RENDERER, ...initialSettings };
    this.calibration = initialCalibration ?? { ...DEFAULT_CALIBRATION };

    // Renderer
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setClearColor(new THREE.Color(this.calibration.bgColor), 1);
    container.appendChild(this.renderer.domElement);

    // Scene (no fog — clean rendering)
    this.scene = new THREE.Scene();

    // Camera
    this.camera = new THREE.PerspectiveCamera(
      this.calibration.camera.fov,
      container.clientWidth / container.clientHeight,
      0.1,
      100,
    );

    // Controls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.rotateSpeed = 0.8;

    // Transfer function texture (1D: 256x1 RGBA)
    const lutData = generateLUT(this.settings.chromaticMode);
    this.tfTexture = new THREE.DataTexture(
      lutData,
      256,
      1,
      THREE.RGBAFormat,
      THREE.UnsignedByteType,
    );
    this.tfTexture.needsUpdate = true;
    this.tfTexture.minFilter = THREE.LinearFilter;
    this.tfTexture.magFilter = THREE.LinearFilter;
    this.tfTexture.wrapS = THREE.ClampToEdgeWrapping;

    // Beam wireframe group
    this.beamGroup = new THREE.Group();
    this.scene.add(this.beamGroup);

    // Axes helper
    const axesBaseSize = 0.3;
    this.axesHelper = new THREE.AxesHelper(axesBaseSize);
    this.axesHelper.scale.setScalar(this.calibration.axes.size / axesBaseSize);
    this.axesHelper.position.set(
      -this.calibration.axes.size,
      -this.calibration.axes.size,
      -this.calibration.axes.size,
    );
    this.scene.add(this.axesHelper);

    // Grid helper
    this.gridHelper = new THREE.GridHelper(2, 10, 0x222244, 0x111133);
    this.gridHelper.position.y = this.calibration.grid.y;
    this.scene.add(this.gridHelper);

    // Default camera
    this.setCameraPreset('frontal');

    // Start render loop
    this.animate();

    // Handle resize
    const ro = new ResizeObserver(() => this.onResize(container));
    ro.observe(container);
  }

  // ─── Calibration ──────────────────────────────────────────────────────

  /** Compute volume scale from extent + calibration stretch.
   *  Each world axis gets the physical extent of whichever data dimension is
   *  mapped to it via axisMapping, multiplied by the corresponding scale factor.
   *  scale.x = lateral stretch, scale.y = depth stretch, scale.z = track stretch.
   *  This keeps the box shape consistent with the data shown on each face. */
  private computeVolumeScale(): THREE.Vector3 {
    const maxExtent = Math.max(...this.extent);
    const cal = this.calibration;
    const map = cal.axisMapping;
    // extent = [lateral, track, depth]
    const s: Record<string, number> = { x: 1, y: 1, z: 1 };
    s[map.lateral] = (this.extent[0] / maxExtent) * cal.scale.x;
    s[map.track]   = (this.extent[1] / maxExtent) * cal.scale.z;
    s[map.depth]   = (this.extent[2] / maxExtent) * cal.scale.y;
    return new THREE.Vector3(s.x, s.y, s.z);
  }

  /** Apply calibration config — updates mesh, uniforms, scene helpers in real-time */
  setCalibration(config: CalibrationConfig): void {
    this.calibration = config;

    // Mesh transform
    if (this.volumeMesh) {
      const r = config.rotation;
      this.volumeMesh.rotation.set(r.x * DEG2RAD, r.y * DEG2RAD, r.z * DEG2RAD);
      this.volumeMesh.position.set(config.position.x, config.position.y, config.position.z);
      this.volumeMesh.updateMatrixWorld(true);
    }

    // Recompute scale + axis remap
    if (this.material) {
      const scale = this.computeVolumeScale();
      this.volumeScale = scale;
      const halfScale = scale.clone().multiplyScalar(0.5);
      this.material.uniforms.volumeScale.value.copy(scale);
      this.material.uniforms.uVolumeMin.value.copy(halfScale).negate();
      this.material.uniforms.uVolumeMax.value.copy(halfScale);
      this.material.uniforms.uAxisRemap.value.copy(buildAxisRemapMatrix(config.axisMapping));
    }

    // Scene helpers
    const axesBaseSize = 0.3;
    this.axesHelper.scale.setScalar(config.axes.size / axesBaseSize);
    this.axesHelper.position.set(-config.axes.size, -config.axes.size, -config.axes.size);
    this.gridHelper.position.y = config.grid.y;

    // Background color
    this.renderer.setClearColor(new THREE.Color(config.bgColor), 1);

    // Camera FOV
    this.camera.fov = config.camera.fov;
    this.camera.updateProjectionMatrix();
  }

  getCalibration(): CalibrationConfig {
    return JSON.parse(JSON.stringify(this.calibration));
  }

  // ─── Camera Presets ─────────────────────────────────────────────────────

  setCameraPreset(preset: CameraPreset): void {
    this.currentPreset = preset;
    const s = this.volumeScale;
    const maxDim = Math.max(s.x, s.y, s.z) || 1;
    const distMul = this.calibration.camera.dist;

    switch (preset) {
      case 'frontal': {
        const dist = maxDim * distMul;
        this.camera.position.set(0, 0, dist);
        this.camera.up.set(0, 1, 0);
        this.controls.target.set(0, 0, 0);
        break;
      }
      case 'horizontal': {
        const dist = maxDim * (distMul * 0.94);
        const angle25 = (25 * Math.PI) / 180;
        this.camera.position.set(
          dist * 0.3,
          dist * Math.sin(angle25),
          dist * Math.cos(angle25),
        );
        this.controls.target.set(0, 0, 0);
        break;
      }
      case 'vertical': {
        const dist = maxDim * distMul;
        this.camera.position.set(dist, 0, 0);
        this.controls.target.set(0, 0, 0);
        break;
      }
      case 'free': {
        const dist = maxDim * (distMul * 0.75);
        this.camera.position.set(dist, dist * 0.7, dist);
        this.controls.target.set(0, 0, 0);
        break;
      }
    }

    this.controls.update();
  }

  getCameraPreset(): CameraPreset {
    return this.currentPreset;
  }

  // ─── Volume data upload ─────────────────────────────────────────────────

  uploadVolume(
    data: Float32Array,
    dimensions: [number, number, number],
    extent: [number, number, number],
  ): void {
    const dimsChanged =
      this.dimensions[0] !== dimensions[0] ||
      this.dimensions[1] !== dimensions[1] ||
      this.dimensions[2] !== dimensions[2];
    const extentChanged =
      this.extent[0] !== extent[0] ||
      this.extent[1] !== extent[1] ||
      this.extent[2] !== extent[2];

    this.dimensions = dimensions;
    this.extent = extent;

    if (this.volumeTexture) {
      this.volumeTexture.dispose();
    }

    const [dimX, dimY, dimZ] = dimensions;
    this.volumeTexture = new THREE.Data3DTexture(data, dimX, dimY, dimZ);
    this.volumeTexture.format = THREE.RedFormat;
    this.volumeTexture.type = THREE.FloatType;
    this.volumeTexture.minFilter = THREE.LinearFilter;
    this.volumeTexture.magFilter = THREE.LinearFilter;
    this.volumeTexture.wrapS = THREE.ClampToEdgeWrapping;
    this.volumeTexture.wrapT = THREE.ClampToEdgeWrapping;
    this.volumeTexture.wrapR = THREE.ClampToEdgeWrapping;
    this.volumeTexture.needsUpdate = true;

    // If mesh exists and dimensions/extent haven't changed, just update the texture
    // (prevents camera reset during Mode A temporal playback)
    if (this.meshCreated && !dimsChanged && !extentChanged && this.material) {
      this.material.uniforms.uVolume.value = this.volumeTexture;
      return;
    }

    this.createVolumeMesh();
  }

  getVolumeDimensions(): [number, number, number] {
    return [...this.dimensions];
  }

  getVolumeExtent(): [number, number, number] {
    return [...this.extent];
  }

  private createVolumeMesh(): void {
    if (this.volumeMesh) {
      this.scene.remove(this.volumeMesh);
      this.volumeMesh.geometry.dispose();
    }

    const scale = this.computeVolumeScale();
    this.volumeScale = scale;

    const halfScale = scale.clone().multiplyScalar(0.5);

    const geometry = new THREE.BoxGeometry(2, 2, 2);

    this.material = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: this.buildVertexShader(),
      fragmentShader: this.buildFragmentShader(),
      uniforms: {
        uVolume: { value: this.volumeTexture },
        uTransferFunction: { value: this.tfTexture },
        uCameraPos: { value: new THREE.Vector3() },
        uVolumeMin: { value: new THREE.Vector3().copy(halfScale).negate() },
        uVolumeMax: { value: halfScale.clone() },
        uVolumeSize: { value: new THREE.Vector3(...this.dimensions) },
        uAxisRemap: { value: buildAxisRemapMatrix(this.calibration.axisMapping) },
        volumeScale: { value: scale },
        uOpacityScale: { value: this.settings.opacityScale },
        uThreshold: { value: this.settings.threshold },
        uDensityScale: { value: this.settings.densityScale },
        uSmoothing: { value: this.settings.smoothing },
        uStepCount: { value: this.settings.stepCount },
        uGhostEnhancement: { value: this.settings.ghostEnhancement },
        uShowBeam: { value: this.settings.showBeam },
        uBeamAngle: { value: 0.175 },
        uTimeSlice: { value: 0.5 },
      },
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
    });

    this.volumeMesh = new THREE.Mesh(geometry, this.material);

    // Calibrated orientation
    const r = this.calibration.rotation;
    this.volumeMesh.rotation.set(r.x * DEG2RAD, r.y * DEG2RAD, r.z * DEG2RAD);
    const p = this.calibration.position;
    this.volumeMesh.position.set(p.x, p.y, p.z);

    this.scene.add(this.volumeMesh);
    this.volumeMesh.updateMatrixWorld(true);

    // Set camera on first mesh creation only (preserve user rotation during playback)
    if (!this.meshCreated) {
      this.setCameraPreset(this.currentPreset);
      this.meshCreated = true;
    }
  }

  private buildVertexShader(): string {
    return `precision highp float;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform vec3 volumeScale;

in vec3 position;

out vec3 vWorldPos;
out vec3 vLocalPos;

void main() {
  vLocalPos = position * 0.5 + 0.5;
  vWorldPos = position * volumeScale;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position * volumeScale, 1.0);
}
`;
  }

  private buildFragmentShader(): string {
    return `precision highp float;
precision highp sampler3D;

uniform sampler3D uVolume;
uniform sampler2D uTransferFunction;
uniform vec3 uCameraPos;
uniform vec3 uVolumeMin;
uniform vec3 uVolumeMax;
uniform vec3 uVolumeSize;
uniform mat3 uAxisRemap;

uniform float uOpacityScale;
uniform float uThreshold;
uniform float uDensityScale;
uniform float uSmoothing;
uniform int uStepCount;
uniform float uGhostEnhancement;
uniform bool uShowBeam;
uniform float uBeamAngle;
uniform float uTimeSlice;

in vec3 vWorldPos;
in vec3 vLocalPos;

out vec4 fragColor;

vec2 intersectBox(vec3 origin, vec3 dir, vec3 bmin, vec3 bmax) {
  vec3 invDir = 1.0 / dir;
  vec3 t0 = (bmin - origin) * invDir;
  vec3 t1 = (bmax - origin) * invDir;
  vec3 tmin = min(t0, t1);
  vec3 tmax = max(t0, t1);
  float tNear = max(max(tmin.x, tmin.y), tmin.z);
  float tFar = min(min(tmax.x, tmax.y), tmax.z);
  return vec2(tNear, tFar);
}

float sampleVolume(vec3 pos) {
  float val = texture(uVolume, pos).r;
  if (uSmoothing > 0.0) {
    vec3 ts = 1.0 / uVolumeSize;
    float avg = 0.0;
    avg += texture(uVolume, pos + vec3(ts.x, 0, 0)).r;
    avg += texture(uVolume, pos - vec3(ts.x, 0, 0)).r;
    avg += texture(uVolume, pos + vec3(0, ts.y, 0)).r;
    avg += texture(uVolume, pos - vec3(0, ts.y, 0)).r;
    avg += texture(uVolume, pos + vec3(0, 0, ts.z)).r;
    avg += texture(uVolume, pos - vec3(0, 0, ts.z)).r;
    val = mix(val, avg / 6.0, uSmoothing * 0.5);
  }
  return val;
}

void main() {
  vec3 rayOrigin = uCameraPos;
  vec3 rayDir = normalize(vWorldPos - uCameraPos);

  vec2 tHit = intersectBox(rayOrigin, rayDir, uVolumeMin, uVolumeMax);
  float tNear = max(tHit.x, 0.0);
  float tFar = tHit.y;

  if (tNear >= tFar) discard;

  float stepSize = (tFar - tNear) / float(uStepCount);
  vec4 accum = vec4(0.0);
  float t = tNear;

  for (int i = 0; i < 512; i++) {
    if (i >= uStepCount) break;
    if (accum.a >= 0.98) break;

    vec3 samplePos = rayOrigin + rayDir * t;
    vec3 uvw = (samplePos - uVolumeMin) / (uVolumeMax - uVolumeMin);

    if (all(greaterThanEqual(uvw, vec3(0.0))) && all(lessThanEqual(uvw, vec3(1.0)))) {
      // Remap box space → texture space via calibrated permutation matrix
      vec3 texCoord = uAxisRemap * uvw;
      float rawVal = sampleVolume(texCoord);
      float density = rawVal * uDensityScale;
      density += rawVal * rawVal * uGhostEnhancement * 3.0;

      if (density > uThreshold) {
        float lookupVal = clamp(density, 0.0, 1.0);
        vec4 tfColor = texture(uTransferFunction, vec2(lookupVal, 0.5));
        tfColor.a *= uOpacityScale * stepSize * 100.0;
        tfColor.a = clamp(tfColor.a, 0.0, 1.0);
        tfColor.rgb *= tfColor.a;
        accum += (1.0 - accum.a) * tfColor;
      }
    }

    t += stepSize;
  }

  if (accum.a < 0.01) discard;
  fragColor = vec4(accum.rgb, accum.a);
}
`;
  }

  // ─── Settings update ──────────────────────────────────────────────────

  updateSettings(partial: Partial<RendererSettings>): void {
    this.settings = { ...this.settings, ...partial };

    if (this.material) {
      const u = this.material.uniforms;
      u.uOpacityScale.value = this.settings.opacityScale;
      u.uThreshold.value = this.settings.threshold;
      u.uDensityScale.value = this.settings.densityScale;
      u.uSmoothing.value = this.settings.smoothing;
      u.uStepCount.value = this.settings.stepCount;
      u.uGhostEnhancement.value = this.settings.ghostEnhancement;
      u.uShowBeam.value = this.settings.showBeam;
    }

    if (partial.chromaticMode !== undefined) {
      this.updateTransferFunction(partial.chromaticMode);
    }
  }

  updateTransferFunction(mode: ChromaticMode): void {
    const lut = generateLUT(mode);
    this.tfTexture.image.data.set(lut);
    this.tfTexture.needsUpdate = true;
  }

  setTimeSlice(t: number): void {
    if (this.material) {
      this.material.uniforms.uTimeSlice.value = t;
    }
  }

  // ─── Beam wireframe ───────────────────────────────────────────────────

  updateBeamGeometry(halfAngleDeg: number, depthMax: number): void {
    this.beamGroup.clear();

    if (!this.settings.showBeam) return;

    const halfAngle = (halfAngleDeg * Math.PI) / 180;
    const segments = 32;
    const radius = depthMax * Math.tan(halfAngle);

    const coneGeom = new THREE.ConeGeometry(radius, depthMax, segments, 1, true);
    const wireframeMat = new THREE.MeshBasicMaterial({
      color: 0x4488ff,
      wireframe: true,
      transparent: true,
      opacity: 0.15,
    });

    const cone = new THREE.Mesh(coneGeom, wireframeMat);
    cone.rotation.x = Math.PI;
    cone.position.y = -depthMax / 2;
    this.beamGroup.add(cone);

    if (this.material) {
      this.material.uniforms.uBeamAngle.value = halfAngle;
    }
  }

  // ─── Snapshot for export ──────────────────────────────────────────────

  captureScreenshot(): string {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL('image/png');
  }

  // ─── Render loop ──────────────────────────────────────────────────────

  private animate = (): void => {
    if (this.disposed) return;
    this.animationId = requestAnimationFrame(this.animate);

    this.controls.update();

    if (this.material && this.volumeMesh) {
      const camLocal = this.camera.position.clone();
      this.volumeMesh.worldToLocal(camLocal);
      this.material.uniforms.uCameraPos.value.copy(camLocal);
    }

    this.renderer.render(this.scene, this.camera);
  };

  // ─── Resize handling ──────────────────────────────────────────────────

  private onResize(container: HTMLElement): void {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w === 0 || h === 0) return;

    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  // ─── Cleanup ──────────────────────────────────────────────────────────

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.animationId);
    this.controls.dispose();
    this.volumeTexture?.dispose();
    this.tfTexture.dispose();
    this.material?.dispose();
    this.volumeMesh?.geometry.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  // ─── Accessors ────────────────────────────────────────────────────────

  getSettings(): RendererSettings {
    return { ...this.settings };
  }

  getDomElement(): HTMLCanvasElement {
    return this.renderer.domElement;
  }
}

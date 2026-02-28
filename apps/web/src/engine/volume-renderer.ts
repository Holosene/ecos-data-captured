/**
 * ECOS V2 — WebGL2 Ray Marching Volume Renderer
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
  rotation: { x: number; y: number; z: number };
  scale: { x: number; y: number; z: number };
  axisMapping: { lateral: 'x' | 'y' | 'z'; depth: 'x' | 'y' | 'z'; track: 'x' | 'y' | 'z' };
  camera: {
    dist: number;
    fov: number;
    orbit?: {
      posX: number; posY: number; posZ: number;
      targetX: number; targetY: number; targetZ: number;
    };
  };
  grid: { y: number };
  axes: { size: number };
  bgColor: string;
  bend?: { angle: number; axis: number };
}

export const DEFAULT_CALIBRATION: CalibrationConfig = {
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 90, y: 0, z: 180 },
  scale: { x: 2, y: 2, z: 2 },
  axisMapping: { lateral: 'x', depth: 'z', track: 'y' },
  camera: {
    dist: 2,
    fov: 30,
    orbit: {
      posX: -0.37062050378412215,
      posY: -0.024429054191487606,
      posZ: 0.5360077379367973,
      targetX: 0.13442521276099786,
      targetY: 0.02044777884473632,
      targetZ: 0.0499002719202334,
    },
  },
  grid: { y: -0.5 },
  axes: { size: 0.8 },
  bgColor: '#111111',
  bend: { angle: 0, axis: 0 },
};

export const DEFAULT_CALIBRATION_B: CalibrationConfig = {
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 90, y: 0, z: 0 },
  scale: { x: 1.66, y: 2, z: 1 },
  axisMapping: { lateral: 'z', depth: 'y', track: 'x' },
  camera: {
    dist: 1.6,
    fov: 40,
    orbit: {
      posX: -0.6451516457959247,
      posY: 0.2503685725297801,
      posZ: 2.0387956423567872,
      targetX: 0.07538325909266698,
      targetY: -0.05112900841721244,
      targetZ: -0.0003320530894435634,
    },
  },
  grid: { y: -0.5 },
  axes: { size: 0.8 },
  bgColor: '#111111',
};

export const DEFAULT_CALIBRATION_C: CalibrationConfig = {
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 90, y: 0, z: 0 },
  scale: { x: 2.75, y: 1, z: 1.01 },
  axisMapping: { lateral: 'z', depth: 'y', track: 'x' },
  camera: {
    dist: 1.5,
    fov: 39,
    orbit: {
      posX: -0.06556017468629348,
      posY: -0.290820286343246,
      posZ: 1.8747881499061871,
      targetX: 0,
      targetY: 0,
      targetZ: 0,
    },
  },
  grid: { y: -0.5 },
  axes: { size: 0.8 },
  bgColor: '#111111',
};

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
  private lastBeamParams: { halfAngleDeg: number; depthMax: number } | null = null;

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
  private resizeObserver: ResizeObserver | null = null;
  private _needsRender = true; // dirty flag — only render when something changed
  // Pre-allocated vectors to avoid GC pressure in hot loops
  private _camLocal = new THREE.Vector3();
  private _offsetVec = new THREE.Vector3();
  private _spherical = new THREE.Spherical();
  private _scaleVec = new THREE.Vector3();
  private _halfScaleVec = new THREE.Vector3();
  // Shared geometry singleton (avoids re-creation per mesh)
  private static _sharedBoxGeometry: THREE.BoxGeometry | null = null;
  private static _sharedBoxRefCount = 0;

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
    this.controls.addEventListener('change', () => { this._needsRender = true; });

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
      -this.calibration.axes.size * 1.8,
      -this.calibration.axes.size,
      -this.calibration.axes.size,
    );
    this.scene.add(this.axesHelper);

    // Grid helper
    this.gridHelper = new THREE.GridHelper(6, 30, 0xf59e0b, 0xc47d09);
    this.gridHelper.position.y = this.calibration.grid.y;
    (this.gridHelper.material as THREE.Material).opacity = 0.8;
    (this.gridHelper.material as THREE.Material).transparent = true;
    this.scene.add(this.gridHelper);

    // Default camera
    this.setCameraPreset('frontal');

    // Restore saved orbit camera position (from Ctrl+S save)
    if (this.calibration.camera.orbit) {
      const o = this.calibration.camera.orbit;
      this.camera.position.set(o.posX, o.posY, o.posZ);
      this.controls.target.set(o.targetX, o.targetY, o.targetZ);
      this.controls.update();
    }

    // Start render loop
    this.animate();

    // Handle resize
    this.resizeObserver = new ResizeObserver(() => this.onResize(container));
    this.resizeObserver.observe(container);
  }

  // ─── Calibration ──────────────────────────────────────────────────────

  /** Apply calibration config — updates mesh, uniforms, scene helpers in real-time */
  setCalibration(config: CalibrationConfig): void {
    this.calibration = config;
    this._needsRender = true;

    // Position + rotation on mesh
    if (this.volumeMesh) {
      const p = config.position;
      this.volumeMesh.position.set(p.x, p.y, p.z);
      const DEG = Math.PI / 180;
      this.volumeMesh.rotation.set(
        config.rotation.x * DEG,
        config.rotation.y * DEG,
        config.rotation.z * DEG,
      );
    }

    // Recompute scale — extent * calibration scale (reuse pre-allocated vectors)
    if (this.material) {
      const maxExtent = Math.max(...this.extent);
      this._scaleVec.set(
        (this.extent[0] / maxExtent) * config.scale.x,
        (this.extent[1] / maxExtent) * config.scale.y,
        (this.extent[2] / maxExtent) * config.scale.z,
      );
      this.volumeScale.copy(this._scaleVec);
      this._halfScaleVec.copy(this._scaleVec).multiplyScalar(0.5);
      this.material.uniforms.volumeScale.value.copy(this._scaleVec);
      this.material.uniforms.uVolumeMin.value.copy(this._halfScaleVec).negate();
      this.material.uniforms.uVolumeMax.value.copy(this._halfScaleVec);

      // Bend deformation
      this.material.uniforms.uBendAngle.value = (config.bend?.angle ?? 0) * Math.PI / 180;
      this.material.uniforms.uBendAxis.value = config.bend?.axis ?? 0;
    }

    // Scene helpers
    const axesBaseSize = 0.3;
    this.axesHelper.scale.setScalar(config.axes.size / axesBaseSize);
    this.axesHelper.position.set(-config.axes.size * 1.8, -config.axes.size, -config.axes.size);
    this.gridHelper.position.y = config.grid.y;

    // Background color
    this.renderer.setClearColor(new THREE.Color(config.bgColor), 1);

    // Camera FOV
    this.camera.fov = config.camera.fov;
    this.camera.updateProjectionMatrix();

    // Refresh beam geometry if parameters were set
    if (this.lastBeamParams) {
      this.updateBeamGeometry(this.lastBeamParams.halfAngleDeg, this.lastBeamParams.depthMax);
    }
  }

  getCalibration(): CalibrationConfig {
    const cal: CalibrationConfig = JSON.parse(JSON.stringify(this.calibration));
    // Capture current orbit camera state
    cal.camera.orbit = {
      posX: this.camera.position.x,
      posY: this.camera.position.y,
      posZ: this.camera.position.z,
      targetX: this.controls.target.x,
      targetY: this.controls.target.y,
      targetZ: this.controls.target.z,
    };
    return cal;
  }

  /** Toggle grid and axes helpers visibility */
  setGridAxesVisible(visible: boolean): void {
    this.gridHelper.visible = visible;
    this.axesHelper.visible = visible;
  }

  /** Programmatically orbit the camera by delta angles (radians) */
  rotateBy(deltaAzimuth: number, deltaPolar: number): void {
    this._needsRender = true;
    this._offsetVec.copy(this.camera.position).sub(this.controls.target);
    this._spherical.setFromVector3(this._offsetVec);
    this._spherical.theta -= deltaAzimuth;
    this._spherical.phi -= deltaPolar;
    this._spherical.phi = Math.max(0.01, Math.min(Math.PI - 0.01, this._spherical.phi));
    this._offsetVec.setFromSpherical(this._spherical);
    this.camera.position.copy(this.controls.target).add(this._offsetVec);
    this.controls.update();
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
    this._needsRender = true;
  }

  getCameraPreset(): CameraPreset {
    return this.currentPreset;
  }

  /** Get full camera state for save/restore */
  getCameraState(): { position: [number, number, number]; up: [number, number, number]; target: [number, number, number] } {
    return {
      position: [this.camera.position.x, this.camera.position.y, this.camera.position.z],
      up: [this.camera.up.x, this.camera.up.y, this.camera.up.z],
      target: [this.controls.target.x, this.controls.target.y, this.controls.target.z],
    };
  }

  /** Restore full camera state */
  setCameraState(state: { position: [number, number, number]; up: [number, number, number]; target: [number, number, number] }): void {
    this.camera.position.set(state.position[0], state.position[1], state.position[2]);
    this.camera.up.set(state.up[0], state.up[1], state.up[2]);
    this.controls.target.set(state.target[0], state.target[1], state.target[2]);
    this.controls.update();
    this._needsRender = true;
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

    // FAST PATH: reuse existing texture when dimensions match (avoids GPU alloc/dealloc)
    if (!dimsChanged && this.volumeTexture && this.meshCreated && this.material) {
      (this.volumeTexture.image as { data: Float32Array }).data.set(data);
      this.volumeTexture.needsUpdate = true;
      this._needsRender = true;
      if (!extentChanged) return;
      // Extent changed but dims same — update scale uniforms without recreating mesh
      const maxExtent = Math.max(...this.extent);
      this._scaleVec.set(
        (this.extent[0] / maxExtent) * this.calibration.scale.x,
        (this.extent[1] / maxExtent) * this.calibration.scale.y,
        (this.extent[2] / maxExtent) * this.calibration.scale.z,
      );
      this.volumeScale.copy(this._scaleVec);
      this._halfScaleVec.copy(this._scaleVec).multiplyScalar(0.5);
      this.material.uniforms.volumeScale.value.copy(this._scaleVec);
      this.material.uniforms.uVolumeMin.value.copy(this._halfScaleVec).negate();
      this.material.uniforms.uVolumeMax.value.copy(this._halfScaleVec);
      return;
    }

    // SLOW PATH: dimensions changed — must recreate texture + mesh
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

    this.createVolumeMesh();
    this._needsRender = true;
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
      // Don't dispose shared geometry — it's reused across instances
      this.material?.dispose();
    }

    const maxExtent = Math.max(...this.extent);
    const cal = this.calibration;
    this._scaleVec.set(
      (this.extent[0] / maxExtent) * cal.scale.x,
      (this.extent[1] / maxExtent) * cal.scale.y,
      (this.extent[2] / maxExtent) * cal.scale.z,
    );
    this.volumeScale.copy(this._scaleVec);

    this._halfScaleVec.copy(this._scaleVec).multiplyScalar(0.5);

    // Reuse shared BoxGeometry singleton across all renderer instances
    if (!VolumeRenderer._sharedBoxGeometry) {
      VolumeRenderer._sharedBoxGeometry = new THREE.BoxGeometry(2, 2, 2);
    }
    VolumeRenderer._sharedBoxRefCount++;
    const geometry = VolumeRenderer._sharedBoxGeometry;

    this.material = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: this.buildVertexShader(),
      fragmentShader: this.buildFragmentShader(),
      uniforms: {
        uVolume: { value: this.volumeTexture },
        uTransferFunction: { value: this.tfTexture },
        uCameraPos: { value: new THREE.Vector3() },
        uVolumeMin: { value: new THREE.Vector3().copy(this._halfScaleVec).negate() },
        uVolumeMax: { value: this._halfScaleVec.clone() },
        uVolumeSize: { value: new THREE.Vector3(...this.dimensions) },
        volumeScale: { value: this._scaleVec.clone() },
        uOpacityScale: { value: this.settings.opacityScale },
        uThreshold: { value: this.settings.threshold },
        uDensityScale: { value: this.settings.densityScale },
        uSmoothing: { value: this.settings.smoothing },
        uStepCount: { value: this.settings.stepCount },
        uGhostEnhancement: { value: this.settings.ghostEnhancement },
        uShowBeam: { value: this.settings.showBeam },
        uBeamAngle: { value: 0.175 },
        uTimeSlice: { value: 0.5 },
        uBendAngle: { value: (this.calibration.bend?.angle ?? 0) * Math.PI / 180 },
        uBendAxis: { value: this.calibration.bend?.axis ?? 0 },
      },
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
    });

    this.volumeMesh = new THREE.Mesh(geometry, this.material);

    // Position + rotation from calibration
    const p = this.calibration.position;
    this.volumeMesh.position.set(p.x, p.y, p.z);
    const DEG = Math.PI / 180;
    this.volumeMesh.rotation.set(
      this.calibration.rotation.x * DEG,
      this.calibration.rotation.y * DEG,
      this.calibration.rotation.z * DEG,
    );

    this.scene.add(this.volumeMesh);

    // Set camera on first mesh creation only (preserve user rotation during playback)
    if (!this.meshCreated) {
      this.setCameraPreset(this.currentPreset);
      // Re-apply saved orbit camera position (setCameraPreset overrides it)
      if (this.calibration.camera.orbit) {
        const o = this.calibration.camera.orbit;
        this.camera.position.set(o.posX, o.posY, o.posZ);
        this.controls.target.set(o.targetX, o.targetY, o.targetZ);
        this.controls.update();
      }
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

uniform float uOpacityScale;
uniform float uThreshold;
uniform float uDensityScale;
uniform float uSmoothing;
uniform int uStepCount;
uniform float uGhostEnhancement;
uniform bool uShowBeam;
uniform float uBeamAngle;
uniform float uTimeSlice;
uniform float uBendAngle;
uniform int uBendAxis;

in vec3 vWorldPos;
in vec3 vLocalPos;

out vec4 fragColor;

// Inverse-bend: given a point in the curved display space,
// return where to sample in the original straight volume.
// Bends the track axis into a circular arc in the chosen plane.
vec3 inverseBend(vec3 pos) {
  if (abs(uBendAngle) < 0.001) return pos;

  vec3 center = (uVolumeMin + uVolumeMax) * 0.5;
  vec3 p = pos - center;

  // XY plane: track=Y bends toward X
  if (uBendAxis == 0) {
    float L = uVolumeMax.y - uVolumeMin.y;
    float R = L / uBendAngle;
    float r = sqrt(p.x * p.x + (p.y + R) * (p.y + R));
    float alpha = atan(p.x, p.y + R);
    p = vec3(r - R, alpha * R, p.z);
  }
  // YZ plane: track=Y bends toward Z
  else if (uBendAxis == 1) {
    float L = uVolumeMax.y - uVolumeMin.y;
    float R = L / uBendAngle;
    float r = sqrt(p.z * p.z + (p.y + R) * (p.y + R));
    float alpha = atan(p.z, p.y + R);
    p = vec3(p.x, alpha * R, r - R);
  }
  // XZ plane: track=X bends toward Z
  else {
    float L = uVolumeMax.x - uVolumeMin.x;
    float R = L / uBendAngle;
    float r = sqrt(p.z * p.z + (p.x + R) * (p.x + R));
    float alpha = atan(p.z, p.x + R);
    p = vec3(alpha * R, p.y, r - R);
  }

  return p + center;
}

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
    samplePos = inverseBend(samplePos);
    vec3 uvw = (samplePos - uVolumeMin) / (uVolumeMax - uVolumeMin);

    if (all(greaterThanEqual(uvw, vec3(0.0))) && all(lessThanEqual(uvw, vec3(1.0)))) {
      float rawVal = sampleVolume(uvw);
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
    this._needsRender = true;

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
    this.lastBeamParams = { halfAngleDeg, depthMax };
    this.beamGroup.clear();

    const halfAngle = (halfAngleDeg * Math.PI) / 180;
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

    // controls.update() returns true when damping moves the camera
    const controlsMoved = this.controls.update();
    if (controlsMoved) this._needsRender = true;

    // Skip GPU render when nothing changed — saves ~60 renders/sec per idle renderer
    if (!this._needsRender) return;
    this._needsRender = false;

    if (this.material && this.volumeMesh) {
      this._camLocal.copy(this.camera.position);
      this.volumeMesh.worldToLocal(this._camLocal);
      this.material.uniforms.uCameraPos.value.copy(this._camLocal);
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
    this._needsRender = true;
  }

  // ─── Cleanup ──────────────────────────────────────────────────────────

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.animationId);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.controls.dispose();
    this.volumeTexture?.dispose();
    this.tfTexture.dispose();
    this.material?.dispose();
    // Shared geometry — only dispose when last renderer releases it
    VolumeRenderer._sharedBoxRefCount--;
    if (VolumeRenderer._sharedBoxRefCount <= 0 && VolumeRenderer._sharedBoxGeometry) {
      VolumeRenderer._sharedBoxGeometry.dispose();
      VolumeRenderer._sharedBoxGeometry = null;
      VolumeRenderer._sharedBoxRefCount = 0;
    }
    this.gridHelper.dispose();
    this.axesHelper.dispose();
    // forceContextLoss BEFORE dispose — releases GPU memory immediately
    this.renderer.forceContextLoss();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  setScrollZoom(enabled: boolean): void {
    this.controls.enableZoom = enabled;
  }

  setSceneBg(color: string): void {
    this.renderer.setClearColor(new THREE.Color(color), 1);
    this._needsRender = true;
  }

  // ─── Accessors ────────────────────────────────────────────────────────

  getSettings(): RendererSettings {
    return { ...this.settings };
  }

  getDomElement(): HTMLCanvasElement {
    return this.renderer.domElement;
  }
}

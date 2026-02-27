/**
 * ECOS — Classic Volume Renderer (0223f6b engine)
 *
 * This is the volumetric engine from commit 0223f6b:
 *   - Full CalibrationConfig support (position, scale, camera, grid, axes, bgColor)
 *   - Camera frontal on Z axis, up=(0,1,0)
 *   - Camera position in world space
 *   - Shader-only beam (no wireframe cone)
 *   - FOV from calibration (default 30), near plane 0.1
 *   - Mesh position from calibration
 *   - Dynamic axes/grid helpers
 *
 * Same public API as VolumeRenderer so VolumeViewer can use either.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { RendererSettings, ChromaticMode } from '@echos/core';
import { DEFAULT_RENDERER } from '@echos/core';
import { generateLUT } from './transfer-function.js';
import type { CameraPreset, CalibrationConfig } from './volume-renderer.js';
import { DEFAULT_CALIBRATION } from './volume-renderer.js';

export class VolumeRendererClassic {
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
    const ro = new ResizeObserver(() => this.onResize(container));
    ro.observe(container);
  }

  // ─── Calibration ──────────────────────────────────────────────────────

  setCalibration(config: CalibrationConfig): void {
    this.calibration = config;

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

    // Recompute scale — extent * calibration scale
    if (this.material) {
      const maxExtent = Math.max(...this.extent);
      const scale = new THREE.Vector3(
        (this.extent[0] / maxExtent) * config.scale.x,
        (this.extent[1] / maxExtent) * config.scale.y,
        (this.extent[2] / maxExtent) * config.scale.z,
      );
      this.volumeScale = scale;
      const halfScale = scale.clone().multiplyScalar(0.5);
      this.material.uniforms.volumeScale.value.copy(scale);
      this.material.uniforms.uVolumeMin.value.copy(halfScale).negate();
      this.material.uniforms.uVolumeMax.value.copy(halfScale);
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
    const offset = this.camera.position.clone().sub(this.controls.target);
    const spherical = new THREE.Spherical().setFromVector3(offset);
    spherical.theta -= deltaAzimuth;
    spherical.phi -= deltaPolar;
    spherical.phi = Math.max(0.01, Math.min(Math.PI - 0.01, spherical.phi));
    offset.setFromSpherical(spherical);
    this.camera.position.copy(this.controls.target).add(offset);
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

    const maxExtent = Math.max(...this.extent);
    const cal = this.calibration;
    const scale = new THREE.Vector3(
      (this.extent[0] / maxExtent) * cal.scale.x,
      (this.extent[1] / maxExtent) * cal.scale.y,
      (this.extent[2] / maxExtent) * cal.scale.z,
    );
    this.volumeScale = scale;
    console.log('[ECOS-C] createVolumeMesh — scale X(lateral):', scale.x, 'Y(track):', scale.y, 'Z(depth):', scale.z);

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

    this.controls.update();

    if (this.material && this.volumeMesh) {
      // Transform camera position into mesh local space for correct ray marching
      // when position/rotation calibration is applied
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

  setScrollZoom(enabled: boolean): void {
    this.controls.enableZoom = enabled;
  }

  setSceneBg(color: string): void {
    this.scene.background = new THREE.Color(color);
  }

  // ─── Accessors ────────────────────────────────────────────────────────

  getSettings(): RendererSettings {
    return { ...this.settings };
  }

  getDomElement(): HTMLCanvasElement {
    return this.renderer.domElement;
  }
}

/**
 * ECHOS V2 — WebGL2 Ray Marching Volume Renderer
 *
 * Uses Three.js for scene management, camera controls, and WebGL2 3D textures.
 * Custom ShaderMaterial for GPU ray marching.
 *
 * Supports:
 *   - 3D Float32/Half-float texture upload
 *   - Single-pass front-to-back ray accumulation with gradient lighting
 *   - Transfer function LUT
 *   - Real-time interactive controls
 *   - Beam wireframe overlay
 *   - Camera presets (horizontal, vertical section, free)
 *   - Depth-based fog and falloff
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { RendererSettings, ChromaticMode } from '@echos/core';
import { DEFAULT_RENDERER } from '@echos/core';
import { generateLUT } from './transfer-function.js';

export type CameraPreset = 'horizontal' | 'vertical' | 'free';

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
  private gridHelper: THREE.GridHelper;

  private settings: RendererSettings;
  private dimensions: [number, number, number] = [1, 1, 1];
  private extent: [number, number, number] = [1, 1, 1];
  private animationId: number = 0;
  private disposed = false;
  private currentPreset: CameraPreset = 'horizontal';
  private volumeScale: THREE.Vector3 = new THREE.Vector3(1, 1, 1);

  constructor(container: HTMLElement, initialSettings?: Partial<RendererSettings>) {
    this.settings = { ...DEFAULT_RENDERER, ...initialSettings };

    // Renderer
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setClearColor(0x080810, 1);
    container.appendChild(this.renderer.domElement);

    // Scene
    this.scene = new THREE.Scene();

    // Fog (distance-based)
    this.scene.fog = new THREE.FogExp2(0x080810, 0.25);

    // Camera
    this.camera = new THREE.PerspectiveCamera(
      50,
      container.clientWidth / container.clientHeight,
      0.01,
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

    // Axes helper (subtle)
    const axes = new THREE.AxesHelper(0.2);
    axes.position.set(-0.6, -0.6, -0.6);
    (axes.material as THREE.Material).opacity = 0.4;
    (axes.material as THREE.Material).transparent = true;
    this.scene.add(axes);

    // Grid helper — reduced opacity, thinner visual
    this.gridHelper = new THREE.GridHelper(2, 10, 0x181830, 0x0e0e22);
    this.gridHelper.position.y = -0.5;
    (this.gridHelper.material as THREE.Material).opacity = 0.35;
    (this.gridHelper.material as THREE.Material).transparent = true;
    this.scene.add(this.gridHelper);

    // Default camera: horizontal view with ~25° downward tilt
    this.setCameraPreset('horizontal');

    // Start render loop
    this.animate();

    // Handle resize
    const ro = new ResizeObserver(() => this.onResize(container));
    ro.observe(container);
  }

  // ─── Camera Presets ─────────────────────────────────────────────────────

  setCameraPreset(preset: CameraPreset): void {
    this.currentPreset = preset;
    const s = this.volumeScale;
    const maxDim = Math.max(s.x, s.y, s.z) || 1;

    switch (preset) {
      case 'horizontal': {
        // Horizontal (terrain-like), ~25° down tilt
        const dist = maxDim * 2.2;
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
        // Vertical cross-section (looking from the side)
        const dist = maxDim * 2.5;
        this.camera.position.set(dist, 0, 0);
        this.controls.target.set(0, 0, 0);
        break;
      }
      case 'free': {
        // 3/4 view (classic)
        const dist = maxDim * 2.0;
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
    this.dimensions = dimensions;
    this.extent = extent;
    const [dimX, dimY, dimZ] = dimensions;

    if (this.volumeTexture) {
      this.volumeTexture.dispose();
    }

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
  }

  /**
   * Get the current volume data dimensions for slice extraction.
   */
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
    const scale = new THREE.Vector3(
      this.extent[0] / maxExtent,
      this.extent[1] / maxExtent,
      this.extent[2] / maxExtent,
    );
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
    this.scene.add(this.volumeMesh);

    // Re-apply current camera preset with new volume scale
    this.setCameraPreset(this.currentPreset);
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

// ─── Ray-box intersection ───────────────────────────────────────────────

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

// ─── Volume sampling with smoothing ─────────────────────────────────────

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

// ─── Gradient estimation (central differences) ──────────────────────────

vec3 computeGradient(vec3 pos) {
  vec3 ts = 1.0 / uVolumeSize;
  float dx = sampleVolume(pos + vec3(ts.x, 0, 0)) - sampleVolume(pos - vec3(ts.x, 0, 0));
  float dy = sampleVolume(pos + vec3(0, ts.y, 0)) - sampleVolume(pos - vec3(0, ts.y, 0));
  float dz = sampleVolume(pos + vec3(0, 0, ts.z)) - sampleVolume(pos - vec3(0, 0, ts.z));
  return vec3(dx, dy, dz) / (2.0 * ts);
}

// ─── Main ray march with gradient lighting & depth effects ──────────────

void main() {
  vec3 rayOrigin = uCameraPos;
  vec3 rayDir = normalize(vWorldPos - uCameraPos);

  vec2 tHit = intersectBox(rayOrigin, rayDir, uVolumeMin, uVolumeMax);
  float tNear = max(tHit.x, 0.0);
  float tFar = tHit.y;

  if (tNear >= tFar) discard;

  float stepSize = (tFar - tNear) / float(uStepCount);
  float rayLength = tFar - tNear;
  vec4 accum = vec4(0.0);
  float t = tNear;

  // Light direction (slightly above and to the side for 3D feel)
  vec3 lightDir = normalize(vec3(0.3, 1.0, 0.5));

  // Accumulation shadow: light transmission through volume
  float shadowAccum = 0.0;

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
        // ── Gradient-based lighting ──
        vec3 gradient = computeGradient(uvw);
        float gradLen = length(gradient);
        float lighting = 1.0;

        if (gradLen > 0.001) {
          vec3 normal = normalize(gradient);
          // Diffuse (Lambertian)
          float diffuse = max(dot(normal, lightDir), 0.0);
          // Ambient + diffuse mix
          lighting = 0.35 + 0.65 * diffuse;
        }

        // ── Accumulation shadow (light is progressively absorbed) ──
        shadowAccum += density * stepSize * 2.0;
        float shadow = exp(-shadowAccum * 0.5);
        lighting *= mix(1.0, shadow, 0.6);

        // ── Depth-based falloff ──
        float depthT = (t - tNear) / rayLength;
        float depthFalloff = 1.0 - depthT * 0.3;

        // ── Logarithmic opacity curve (non-linear) ──
        float logDensity = log(1.0 + density * 10.0) / log(11.0);
        float lookupVal = clamp(logDensity, 0.0, 1.0);

        vec4 tfColor = texture(uTransferFunction, vec2(lookupVal, 0.5));

        // Apply lighting and depth
        tfColor.rgb *= lighting * depthFalloff;

        // Non-linear opacity
        tfColor.a *= uOpacityScale * stepSize * 100.0;
        tfColor.a = clamp(tfColor.a, 0.0, 1.0);

        // Front-to-back compositing
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

    if (this.material) {
      this.material.uniforms.uCameraPos.value.copy(this.camera.position);
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

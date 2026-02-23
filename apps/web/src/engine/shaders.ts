/**
 * ECHOS V2 — GLSL Ray Marching Shaders
 *
 * Vertex shader: renders a unit cube positioned around the volume.
 * Fragment shader: casts rays through the 3D texture, accumulates color
 * using front-to-back compositing with a transfer function LUT.
 */

export const volumeVertexShader = /* glsl */ `
precision highp float;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform vec3 volumeScale;

attribute vec3 position;

varying vec3 vWorldPos;
varying vec3 vLocalPos;

void main() {
  vLocalPos = position * 0.5 + 0.5; // [0,1]³
  vWorldPos = position * volumeScale;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position * volumeScale, 1.0);
}
`;

export const volumeFragmentShader = /* glsl */ `
precision highp float;
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
uniform float uBeamAngle; // half-angle in radians
uniform float uTimeSlice; // 0–1, for time scrubbing

varying vec3 vWorldPos;
varying vec3 vLocalPos;

// ─── Ray-box intersection ─────────────────────────────────────────────────

vec2 intersectBox(vec3 origin, vec3 dir, vec3 boxMin, vec3 boxMax) {
  vec3 invDir = 1.0 / dir;
  vec3 t0 = (boxMin - origin) * invDir;
  vec3 t1 = (boxMax - origin) * invDir;
  vec3 tmin = min(t0, t1);
  vec3 tmax = max(t0, t1);
  float tNear = max(max(tmin.x, tmin.y), tmin.z);
  float tFar = min(min(tmax.x, tmax.y), tmax.z);
  return vec2(tNear, tFar);
}

// ─── Sample volume with trilinear filtering ───────────────────────────────

float sampleVolume(vec3 pos) {
  // pos is in [0,1]³
  float val = texture(uVolume, pos).r;

  // Apply smoothing (sample neighborhood and blend)
  if (uSmoothing > 0.0) {
    vec3 texelSize = 1.0 / uVolumeSize;
    float avg = 0.0;
    avg += texture(uVolume, pos + vec3(texelSize.x, 0.0, 0.0)).r;
    avg += texture(uVolume, pos - vec3(texelSize.x, 0.0, 0.0)).r;
    avg += texture(uVolume, pos + vec3(0.0, texelSize.y, 0.0)).r;
    avg += texture(uVolume, pos - vec3(0.0, texelSize.y, 0.0)).r;
    avg += texture(uVolume, pos + vec3(0.0, 0.0, texelSize.z)).r;
    avg += texture(uVolume, pos - vec3(0.0, 0.0, texelSize.z)).r;
    avg /= 6.0;
    val = mix(val, avg, uSmoothing * 0.5);
  }

  return val;
}

// ─── Beam geometry mask ───────────────────────────────────────────────────

float beamMask(vec3 pos) {
  if (!uShowBeam) return 1.0;

  // Cone along Z axis (depth)
  float depth = pos.z; // 0 = surface, 1 = max depth
  float lateralDist = length(pos.xy - vec2(0.5));
  float coneRadius = depth * tan(uBeamAngle);

  // Cone boundary visualization
  float distToEdge = abs(lateralDist - coneRadius * 0.5);
  float edge = smoothstep(0.02, 0.0, distToEdge);

  return 1.0 + edge * 2.0; // Amplify at cone edge
}

// ─── Main ray march ───────────────────────────────────────────────────────

void main() {
  vec3 rayOrigin = uCameraPos;
  vec3 rayDir = normalize(vWorldPos - uCameraPos);

  // Intersect with unit volume box
  vec2 tHit = intersectBox(rayOrigin, rayDir, uVolumeMin, uVolumeMax);
  float tNear = max(tHit.x, 0.0);
  float tFar = tHit.y;

  if (tNear >= tFar) {
    discard;
  }

  // Step size
  float stepSize = (tFar - tNear) / float(uStepCount);

  // Front-to-back compositing
  vec4 accum = vec4(0.0);
  float t = tNear;

  for (int i = 0; i < 512; i++) {
    if (i >= uStepCount) break;
    if (accum.a >= 0.98) break;

    vec3 samplePos = rayOrigin + rayDir * t;

    // Transform to volume UV [0,1]³
    vec3 uvw = (samplePos - uVolumeMin) / (uVolumeMax - uVolumeMin);

    if (all(greaterThanEqual(uvw, vec3(0.0))) && all(lessThanEqual(uvw, vec3(1.0)))) {
      float rawVal = sampleVolume(uvw);

      // Apply density scale and ghost enhancement
      float density = rawVal * uDensityScale;
      density += rawVal * rawVal * uGhostEnhancement * 3.0;

      // Threshold
      if (density > uThreshold) {
        // Beam mask
        float beam = beamMask(uvw);
        density *= beam;

        // Sample transfer function (1D texture lookup)
        float lookupVal = clamp(density, 0.0, 1.0);
        vec4 tfColor = texture(uTransferFunction, vec2(lookupVal, 0.5));

        // Apply opacity scale
        tfColor.a *= uOpacityScale * stepSize * 100.0;
        tfColor.a = clamp(tfColor.a, 0.0, 1.0);

        // Front-to-back compositing
        tfColor.rgb *= tfColor.a;
        accum += (1.0 - accum.a) * tfColor;
      }
    }

    t += stepSize;
  }

  // Background gradient for empty regions
  if (accum.a < 0.01) {
    discard;
  }

  gl_FragColor = vec4(accum.rgb, accum.a);
}
`;

// ─── Beam wireframe shader (for cone visualization) ─────────────────────────

export const beamVertexShader = /* glsl */ `
precision highp float;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;

attribute vec3 position;

varying vec3 vPos;

void main() {
  vPos = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const beamFragmentShader = /* glsl */ `
precision highp float;

uniform vec3 uBeamColor;
uniform float uBeamOpacity;

varying vec3 vPos;

void main() {
  gl_FragColor = vec4(uBeamColor, uBeamOpacity);
}
`;

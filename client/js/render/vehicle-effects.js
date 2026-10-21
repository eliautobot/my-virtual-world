// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Bounded vehicle effects: lens-only night emission, instanced road-light pools,
// and distance/radius wheel rotation. No app state or per-car dynamic lights.
import * as THREE from 'three';

const HEX = {
  sedan: [0xd8ddd6, 0x85252b], car: [0xd8ddd6, 0x85252b],
  taxi: [0xc3ced0, 0x902c31], suv: [0xc8d4d5, 0x8b3034],
  van: [0xc9d2d1, 0x8e3036], bus: [0xd0dcd9, 0xa1393e],
};
const palettes = Object.fromEntries(Object.entries(HEX).map(([k, values]) => [k, values.map(h => new THREE.Color(h))]));
const localWheel = new THREE.Matrix4(), wheelRoll = new THREE.Matrix4();

export function tagVehicleLenses(geometry, sourceType, sourceName) {
  const data = new Float32Array(geometry.attributes.position.count), counts = { front: 0, rear: 0 };
  const c = geometry.attributes.color, p = geometry.attributes.position, colors = palettes[sourceType];
  if (/Details$/.test(sourceName) && colors) for (let i = 0; i < p.count; i++) {
    for (let mode = 0; mode < 2; mode++) {
      const target = colors[mode];
      if ((mode === 0 ? p.getZ(i) > 0 : p.getZ(i) < 0) && Math.abs(c.getX(i) - target.r) < 1e-5 && Math.abs(c.getY(i) - target.g) < 1e-5 && Math.abs(c.getZ(i) - target.b) < 1e-5) {
        data[i] = mode + 1; counts[mode === 0 ? 'front' : 'rear']++; break;
      }
    }
  }
  geometry.setAttribute('aVehicleLamp', new THREE.BufferAttribute(data, 1)); return counts;
}

export function makeVehicleLampMaterial(template, night) {
  const material = template.clone(), previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    shader.uniforms.uVehicleNight = night;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute float aVehicleLamp; flat varying float vVehicleLamp;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvVehicleLamp = aVehicleLamp;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uVehicleNight; flat varying float vVehicleLamp;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
if (vVehicleLamp > 0.5) {
  vec3 lampColor = vVehicleLamp < 1.5 ? vec3(1.0, 0.92, 0.78) : vec3(1.0, 0.002, 0.001);
  totalEmissiveRadiance += lampColor * (vVehicleLamp < 1.5 ? 2.4 : 0.8) * uVehicleNight;
}`);
  };
  material.customProgramCacheKey = () => `mvw-vehicle-lenses-${template.type}-v1`;
  return material;
}

export function wheelSpinAngle(distance, radius) {
  if (!Number.isFinite(distance) || !Number.isFinite(radius) || radius <= 0) throw new RangeError('Invalid wheel distance/radius');
  return (distance / radius) % (Math.PI * 2);
}
export function composeVehicleWheelMatrix(carPose, centre, angle, out, steering = 0, height = null) {
  localWheel.makeRotationY(steering).multiply(wheelRoll.makeRotationX(angle));
  localWheel.setPosition(centre[0], height ?? centre[1], centre[2]);
  return out.multiplyMatrices(carPose, localWheel);
}

export function createVehicleBeamGeometry(frontLamps, length) {
  const positions = [], uv = [], indices = [];
  for (const [x, , z] of frontLamps) {
    const i = positions.length / 3, near = 0.10, far = 1.35, start = z + 0.015, end = start + length;
    positions.push(x - near, 0.018, start, x + near, 0.018, start, x + far, 0.018, end, x - far, 0.018, end);
    uv.push(0, 0, 1, 0, 1, 1, 0, 1); indices.push(i, i + 2, i + 1, i, i + 3, i + 2);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(indices); g.computeBoundingBox(); g.computeBoundingSphere(); return g;
}
export function makeVehicleBeamMaterial(night) {
  return new THREE.ShaderMaterial({
    uniforms: { uVehicleNight: night }, transparent: true, depthWrite: false, depthTest: true,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: `varying vec2 vBeamUv;
void main() { vBeamUv = uv; vec4 p = vec4(position, 1.0);
#ifdef USE_INSTANCING
p = instanceMatrix * p;
#endif
gl_Position = projectionMatrix * modelViewMatrix * p; }`,
    fragmentShader: `uniform float uVehicleNight; varying vec2 vBeamUv;
void main() {
  float edge = 1.0 - smoothstep(0.30, 0.5, abs(vBeamUv.x - 0.5));
  float reach = pow(max(0.0, 1.0 - clamp(vBeamUv.y, 0.0, 1.0)), 1.35) * smoothstep(0.0, 0.05, vBeamUv.y);
  gl_FragColor = vec4(0.92, 0.86, 0.68, edge * reach * uVehicleNight * 0.28);
#include <tonemapping_fragment>
#include <colorspace_fragment>
}`,
  });
}

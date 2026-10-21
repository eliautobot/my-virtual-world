// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The GPS in the world (ui/worldmap.js): a tall beam of light over the waypoint, seen from afar, with a ring pulsing on the
// ground under it. (Arrows along the route on the ground were tried and dropped: not the owner's style, 2026-10-05.) Nothing is
// drawn without a waypoint.
import * as THREE from 'three';
import { GROUND_Y } from '/shared/constants.js';
import { blockAt } from '/shared/city.js';
import { GU } from './scene.js';

const COL = new THREE.Color('#c054ff');

export class WaypointLayer {
  constructor(app) {
    this.app = app;
    this.group = new THREE.Group(); this.group.name = 'waypoint'; this.group.visible = false;
    app.stage.scene.add(this.group);
    const beamMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uTime: GU.uTime, uCol: { value: COL } },
      vertexShader: 'varying float vH; varying vec3 vN, vV; void main() { vH = uv.y; vec4 w = modelMatrix * vec4(position, 1.0); vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - w.xyz); gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: 'uniform float uTime; uniform vec3 uCol; varying float vH; varying vec3 vN, vV; void main() { float edge = pow(clamp(1.0 - abs(dot(vN, vV)), 0.0, 1.0), 0.6); float a = (1.0 - vH) * (0.35 + 0.65 * edge) * (0.75 + 0.25 * sin(uTime * 3.0 - vH * 20.0)); gl_FragColor = vec4(uCol * 1.6, a * 0.55); }',
    });
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 140, 20, 1, true).translate(0, 70, 0), beamMat);
    this.beam.frustumCulled = false; this.beam.renderOrder = 5;
    const ringMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: GU.uTime, uCol: { value: COL } },
      vertexShader: 'varying vec2 vU; void main() { vU = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform float uTime; uniform vec3 uCol; varying vec2 vU; void main() { float r = length(vU - 0.5) * 2.0; float p = fract(uTime * 0.6); float ring = smoothstep(0.08, 0.0, abs(r - p)) * (1.0 - p) + smoothstep(0.06, 0.0, abs(r - 0.35)) * 0.6; if (r > 1.0) discard; gl_FragColor = vec4(uCol * 1.5, ring); }',
    });
    this.ring = new THREE.Mesh(new THREE.PlaneGeometry(8, 8).rotateX(-Math.PI / 2), ringMat);
    this.ring.renderOrder = 5;
    this.group.add(this.beam, this.ring);
  }
  /** The ground's height at (x, z): the city's streets and sidewalks, else the island's ground (roads exact). */
  groundAt(x, z) {
    const g = this.app.city?.g, T = this.app.terrain;
    if (g && x >= g.minX && x <= g.maxX && z >= g.minZ && z <= g.maxZ) return blockAt(g, x, z) ? GROUND_Y : 0;
    return T ? T.heightAt(x, z) : 0;
  }
  /** wp: the waypoint or null. */
  update(wp) {
    this.group.visible = !!wp;
    if (!wp) return;
    const y = this.groundAt(wp.x, wp.z);
    this.beam.position.set(wp.x, y, wp.z); this.ring.position.set(wp.x, y + 0.08, wp.z);
  }
}

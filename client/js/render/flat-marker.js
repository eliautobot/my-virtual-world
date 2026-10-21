// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// "This one is theirs": a flat marked in the world (the Agent Studio's Home → Show me; "Show" beside a resident's home).
// Its floor outlined, pulsing, with a soft fill, and a tag over it naming whose it is. Drawn only while that floor is the
// one being looked inside (the walls are cut there, so the floor shows); another floor of the building hides it, leaving
// the building puts it away. Nothing is drawn without a flat.
import * as THREE from 'three';
import { S, bus } from '../core/state.js';
import { floorAt } from '/shared/constants.js';
import { bRot } from '/shared/geom.js';
import { GU } from './scene.js';

const EDGE = 0.18;   // the outline's width (m)

export class FlatMarker {
  constructor(app) {
    this.app = app; this.cur = null;
    this.group = new THREE.Group(); this.group.name = 'flat-marker'; this.group.visible = false;
    app.stage.scene.add(this.group);
    this.col = new THREE.Color('#ff9d4d');
    const uniforms = { uTime: GU.uTime, uCol: { value: this.col } };
    // solid colour, not added light: an additive glow vanishes on the light wood and tile floors
    this.edgeMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, uniforms,
      vertexShader: 'void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform float uTime; uniform vec3 uCol; void main() { gl_FragColor = vec4(uCol * (1.0 + 0.25 * sin(uTime * 3.4)), 0.95); }',
    });
    this.fillMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, uniforms,
      vertexShader: 'varying vec2 vU; void main() { vU = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform float uTime; uniform vec3 uCol; varying vec2 vU; void main() { vec2 d = abs(vU - 0.5) * 2.0; float e = max(d.x, d.y); gl_FragColor = vec4(uCol, (0.16 + 0.3 * e * e * e) * (0.8 + 0.2 * sin(uTime * 3.4))); }',
    });
    this.tag = document.createElement('div');
    this.tag.className = 'flat-tag hidden';
    (document.getElementById('ui') || document.body).appendChild(this.tag);
    bus.on('frame', () => this.update());
  }
  /** Marks flat u on floor f of building b; label: the tag's text. */
  show(b, f, u, label) {
    const B = S.world?.buildings?.[b], L = B && S.world.levels[B.lv?.[f]], U = L?.units?.[u];
    this.clear();
    if (!U) return false;
    const w = U.x1 - U.x0, d = U.z1 - U.z0, cx = (U.x0 + U.x1) / 2, cz = (U.z0 + U.z1) / 2;
    const fill = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), this.fillMat);
    fill.position.set(cx, 0, cz);
    const bar = (len, x, z, along) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(along === 'x' ? len + EDGE : EDGE, 0.08, along === 'x' ? EDGE : len + EDGE), this.edgeMat);
      m.position.set(x, 0.04, z); return m;
    };
    this.group.add(fill, bar(w, cx, U.z0, 'x'), bar(w, cx, U.z1, 'x'), bar(d, U.x0, cz, 'z'), bar(d, U.x1, cz, 'z'));
    for (const m of this.group.children) m.renderOrder = 6;
    this.group.position.set(B.x, floorAt(B, f) + 0.06, B.z);
    this.group.rotation.y = bRot(B);
    this.top = new THREE.Vector3(cx, 2.1, cz);
    this.cur = { b, f, u };
    this.tag.textContent = label || 'Home';
    this.update();
    return true;
  }
  clear() {
    for (const m of [...this.group.children]) { this.group.remove(m); m.geometry.dispose(); }
    this.cur = null; this.group.visible = false; this.tag.classList.add('hidden');
  }
  update() {
    const c = this.cur;
    if (c && c.seen && S.focus.b !== c.b) { this.clear(); return; }   // leaving the building puts the mark away
    const on = !!c && S.focus.b === c.b && S.focus.f === c.f && !S.world?.buildings?.[c.b]?.gone;
    if (on) c.seen = true;
    this.group.visible = on;
    if (!on) { this.tag.classList.add('hidden'); return; }
    const cam = this.app.stage.camera, p = this.top.clone().applyMatrix4(this.group.matrixWorld).project(cam);
    const behind = p.z > 1 || p.z < -1;
    this.tag.classList.toggle('hidden', behind);
    if (!behind) this.tag.style.transform = `translate3d(${Math.round((p.x + 1) / 2 * innerWidth)}px, ${Math.round((1 - p.y) / 2 * innerHeight)}px, 0) translate(-50%, -100%)`;
  }
}

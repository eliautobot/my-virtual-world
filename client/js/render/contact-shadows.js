// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// A soft dark patch under each person where no sun shadow grounds them: on the floor looked
// into, and out of doors after dark (the moon's shadow is faint) or with shadows off. Two instanced quads (indoors, out of
// doors: each its own strength), filled by render/agents.js as it draws people; nothing drawn while empty.
import * as THREE from 'three';

export class ContactShadows {
  constructor(group, cap = 1024) {
    const cv = document.createElement('canvas'); cv.width = cv.height = 64;
    const c = cv.getContext('2d'), g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(0.4, 'rgba(0,0,0,0.62)'); g.addColorStop(0.75, 'rgba(0,0,0,0.18)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g; c.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(cv), geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.cap = cap; this.n = [0, 0];
    this.sets = [0, 1].map(() => {
      const m = new THREE.MeshBasicMaterial({ color: 0x000000, map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
      const im = new THREE.InstancedMesh(geo, m, cap);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.count = 0; im.visible = false; im.frustumCulled = false; im.renderOrder = 1; im.castShadow = im.receiveShadow = false;
      group.add(im);
      return im;
    });
  }
  begin() { this.n[0] = this.n[1] = 0; }
  /** A person standing (or sitting) at x, y, z: indoors (on the floor looked into) or out of doors. */
  add(x, y, z, indoor) {
    const k = indoor ? 0 : 1, j = this.n[k]; if (j >= this.cap) return;
    const a = this.sets[k].instanceMatrix.array, o = j * 16, s = 0.95;
    a[o] = s; a[o + 1] = 0; a[o + 2] = 0; a[o + 3] = 0; a[o + 4] = 0; a[o + 5] = 1; a[o + 6] = 0; a[o + 7] = 0;
    a[o + 8] = 0; a[o + 9] = 0; a[o + 10] = s; a[o + 11] = 0; a[o + 12] = x; a[o + 13] = y + 0.012; a[o + 14] = z; a[o + 15] = 1;
    this.n[k] = j + 1;
  }
  /** How dark the patches are: indoors, out of doors (0 hides them). */
  end(inK, outK) {
    this.sets.forEach((im, k) => {
      const n = this.n[k], K = k ? outK : inK;
      im.count = n; im.visible = n > 0 && K > 0.01; im.material.opacity = K;
      if (im.visible) { im.instanceMatrix.clearUpdateRanges(); im.instanceMatrix.addUpdateRange(0, n * 16); im.instanceMatrix.needsUpdate = true; }
    });
  }
}

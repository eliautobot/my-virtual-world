// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Regression probe for the real facade material, compiled and rasterized by the page's WebGL2 renderer.
// Reads the actual window seed expressions from its onBeforeCompile hook (no duplicate hash implementation).
// Uses a private scene/render target only: no world, clock, settings, or account writes.
'use strict';

async function probeFacadeSeeds(page) {
  return page.evaluate(async () => {
    const A = window.__mvw;
    if (!A?.ready || !A.blds || !A.stage) throw new Error('the world must be ready before probing its facade');
    const T = A.THREE, r = A.stage.renderer;
    const { QB } = await import('/js/render/qb.js');
    const qb = new QB({ aB: 1, aK: 1, aS: 4, aF: 4, aDoor: 3, aWC: 3, aGC: 3, aTC: 3 });
    qb.quad([[-3, -2, 0], [3, -2, 0], [3, 2, 0], [-3, 2, 0]], [0, 0, 1], null, k => ({
      aB: 271, aK: 1, aS: [3, 0, 0.42, 0], aF: [k === 1 || k === 2 ? 24 : 0, k < 2 ? 0.15 : 27.35, 24, 8],
      aDoor: [-99, 0, 0], aWC: [0.5, 0.5, 0.5], aGC: [0.2, 0.3, 0.4], aTC: [0.8, 0.8, 0.8],
    }));
    const geo = qb.build(), scene = new T.Scene();
    const cam = new T.PerspectiveCamera(50, 1, 0.1, 100);
    const target = new T.WebGLRenderTarget(64, 64, { depthBuffer: true, stencilBuffer: false });
    const pixels = new Uint8Array(64 * 64 * 4);
    const originalTarget = r.getRenderTarget(), originalColor = r.getClearColor(new T.Color()).clone(), originalAlpha = r.getClearAlpha();
    const originalAutoClear = r.autoClear;
    const mesh = new T.Mesh(geo);
    scene.add(mesh);
    const angles = [[3.4, 1.6, 9], [-2.5, 2, 8], [0.03, -1.2, 8.5]];
    const ids = [0, 63, 127, 271, 511, 1023, 4095, 16383];
    const materials = [];
    let compiled = 0;
    const material = smoothControl => {
      const m = A.blds.makeShellMat(), hook = m.onBeforeCompile;
      materials.push(m);
      m.onBeforeCompile = (sh, renderer) => {
        hook.call(m, sh, renderer);
        const wid = sh.fragmentShader.match(/\bwid = (h21\([^;]+\));/);
        const fh = sh.fragmentShader.match(/\bfloat fh = (h21\([^;]+\));/);
        if (!wid || !fh) throw new Error('the actual facade window seed expressions were not found');
        // Stop before lighting/tone mapping: colors reveal whether identical window metadata hashes differently
        // within a pane. fl/ci identify one fixed window, so its two seeds and blind choice must be constant.
        sh.fragmentShader = sh.fragmentShader.replace('void main() {', `void main() {
float fl = 3.0, ci = 2.0;
float probeW = ${wid[1]}, probeF = ${fh[1]};
gl_FragColor = vec4(probeW, probeF, step(0.64, h21(vec2(probeW * 91.0, 3.0))), 1.0);
return;`);
        if (smoothControl) {
          // Replay the old interpolation contract on the same GPU. Not every GPU exposes its precision error,
          // so this control is diagnostic; the flat metadata guarantee is required on every GPU.
          sh.vertexShader = sh.vertexShader.replace(/\bflat varying\b/g, 'varying');
          sh.fragmentShader = sh.fragmentShader.replace(/\bflat varying\b/g, 'varying');
        }
        compiled++;
      };
      m.customProgramCacheKey = () => `mvw-facade-seed-probe-${smoothControl ? 'smooth-control' : 'fixed'}`;
      return m;
    };
    const sample = (id, face, eye) => {
      for (const [name, v] of [['aB', id], ['aK', face]]) {
        geo.attributes[name].array.fill(v);
        geo.attributes[name].needsUpdate = true;
      }
      cam.position.set(...eye); cam.lookAt(0, 0, 0); cam.updateMatrixWorld();
      r.setRenderTarget(target); r.clear(); r.render(scene, cam);
      r.readRenderTargetPixels(target, 0, 0, 64, 64, pixels);
      const colors = new Set(); let covered = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i + 3] !== 255) continue;
        covered++;
        colors.add((pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2]);
      }
      return { id, face, eye, covered, colors: colors.size };
    };
    try {
      r.autoClear = true; r.setClearColor(0, 0);
      mesh.material = material(false);
      const fixed = [];
      for (const eye of angles) for (const id of ids) for (let face = 0; face < 4; face++) fixed.push(sample(id, face, eye));
      mesh.material = material(true);
      const control = [];
      for (const eye of angles) for (const id of [63, 271, 4095]) control.push(sample(id, 1, eye));
      const badPrograms = r.info.programs.filter(p => p.diagnostics && p.diagnostics.runnable === false).length;
      return {
        quality: A.stage.q.name, cases: fixed.length, compiled,
        failed: fixed.filter(s => s.covered < 100 || s.colors !== 1),
        controlCases: control.length, controlWithVariance: control.filter(s => s.colors > 1).length,
        maxControlColors: Math.max(...control.map(s => s.colors)), badPrograms,
      };
    } finally {
      r.setRenderTarget(originalTarget); r.setClearColor(originalColor, originalAlpha); r.autoClear = originalAutoClear;
      scene.remove(mesh); geo.dispose(); target.dispose(); for (const m of materials) m.dispose();
    }
  });
}

module.exports = { probeFacadeSeeds };

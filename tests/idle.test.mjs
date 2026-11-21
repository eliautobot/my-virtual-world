// Standing idle (2026-11-20, the product owner: the idle had them "sliding on the ground on the same spot … they step to
// the side"): the idles that stepped are planted (shared/crowd-tuning.js plantClips: the feet where they stand, the rest of
// the body's motion kept), and each builder body plays its own set of idles, one per resident (IDLES; render/characters.js
// idleFor): a woman the planted idle, the relaxed wait or hands on hips; a man the relaxed wait or hands on hips.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { plantClips, PLANT_CLIPS, IDLES, toHalf } from '../shared/crowd-tuning.js';

const HALF = new Float32Array(65536);
for (let h = 0; h < 65536; h++) { const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 31, f = h & 1023; HALF[h] = e === 0 ? s * f * 2 ** -24 : e === 31 ? (f ? NaN : s * Infinity) : s * (1 + f / 1024) * 2 ** (e - 15); }
const load = sex => {
  const man = JSON.parse(fs.readFileSync(new URL(`../client/assets/crowd/${sex}.json`, import.meta.url), 'utf8')), bin = fs.readFileSync(new URL(`../client/assets/crowd/${sex}.bin`, import.meta.url));
  const A = man.anim.data, data = new Uint16Array(bin.buffer.slice(bin.byteOffset + A.off, bin.byteOffset + A.off + A.len));
  const L = man.parts.body[0].lods[0], arr = (T, e) => new T(bin.buffer.slice(bin.byteOffset + e.off, bin.byteOffset + e.off + e.len));
  return { man, anim: { data, frames: man.anim.frames, bones: man.bones, names: man.names, clips: man.clips }, pos: arr(Float32Array, L.pos), j: arr(Uint8Array, L.j), w: arr(Uint8Array, L.w), n: L.verts };
};
/** How far the feet (vertices wholly on a foot or toe bone) move over clip `name`, metres (the most of any). */
function feetMove(b, name) {
  const short = b.man.names.map(n => n.replace(/^mixamorig:/, '')), feet = new Set(short.map((n, i) => (/(Foot|Toe)/.test(n) ? i : -1)).filter(i => i >= 0));
  const vs = []; for (let v = 0; v < b.n && vs.length < 24; v++) if (feet.has(b.j[v * 4]) && b.w[v * 4] > 240) vs.push(v);
  const c = b.man.clips.find(x => x.name === name), B = b.man.bones;
  let most = 0;
  for (const v of vs) {
    const lo = [9, 9, 9], hi = [-9, -9, -9];
    for (let f = c.off; f < c.off + Math.abs(c.len); f += 3) {
      const o = (f * B + b.j[v * 4]) * 12, m = i => HALF[b.anim.data[o + i]], x = b.pos[v * 3], y = b.pos[v * 3 + 1], z = b.pos[v * 3 + 2];
      const p = [m(0) * x + m(1) * y + m(2) * z + m(3), m(4) * x + m(5) * y + m(6) * z + m(7), m(8) * x + m(9) * y + m(10) * z + m(11)];
      for (let q = 0; q < 3; q++) { lo[q] = Math.min(lo[q], p[q]); hi[q] = Math.max(hi[q], p[q]); }
    }
    most = Math.max(most, ...[0, 1, 2].map(q => hi[q] - lo[q]));
  }
  return most;
}

test('the idles that stepped stand with their feet planted, the rest of their motion kept', () => {
  assert.equal(typeof toHalf, 'function');
  for (const sex of ['female', 'male']) {
    const b = load(sex), before = Object.fromEntries(PLANT_CLIPS.map(n => [n, feetMove(b, n)]));
    // (the head moved before: it still does — the upper body's motion kept)
    const head = b.man.names.findIndex(n => /Head$/.test(n)), c = b.man.clips.find(x => x.name === 'idle'), B = b.man.bones;
    const headAt = f => [3, 7, 11].map(i => HALF[b.anim.data[(f * B + head) * 12 + i]]);
    const spread = () => { let lo = 9, hi = -9; for (let f = c.off; f < c.off + Math.abs(c.len); f += 6) { const x = headAt(f)[0]; lo = Math.min(lo, x); hi = Math.max(hi, x); } return hi - lo; };
    assert.equal(plantClips(b.anim), PLANT_CLIPS.length);
    for (const n of PLANT_CLIPS) {
      const after = feetMove(b, n);
      assert.ok(before[n] > 0.1 && after < 0.01, `${sex} ${n}: feet ${(before[n] * 100).toFixed(1)} cm → ${(after * 100).toFixed(1)} cm`);
    }
    assert.ok(spread() > 0.005, `${sex}: the upper body still moves (${(spread() * 100).toFixed(1)} cm)`);
  }
});

test('each body its own idles, one per resident; a model of its own keeps its own', () => {
  assert.deepEqual(IDLES, { f: ['idle', 'wait_02', 'wait'], m: ['wait_02', 'wait'] });
  const src = fs.readFileSync(new URL('../client/js/render/characters.js', import.meta.url), 'utf8');
  assert.match(src, /if \(man\.names && typeof plantClips === 'function'\) plantClips\(anim\);\n {2}if \(keepSource\) anim\.src = data\.slice\(\);/);
  assert.match(src, /if \(a === T_IDLE\) \{ a = iv\[0\]; pA \*= iv\[1\]; \}/);
  assert.match(src, /const g = man\?\.custom\?\.gender \|\| \(ready \? \(KINDS\[kind\]\[0\] === 'f' \? 'female' : 'male'\) : null\);\n {4}if \(!g/);
});

test('per-clip fixes merge under the owner\'s own turns (none built in now: the owner sets them in the studio)', async () => {
  const { withClipFix } = await import('../shared/crowd-tuning.js');
  assert.deepEqual(withClipFix('f', { wait: { arms: [2, 0, 0] } }), { wait: { arms: [2, 0, 0] } });
  const src = fs.readFileSync(new URL('../client/js/render/characters.js', import.meta.url), 'utf8');
  assert.match(src, /applyRig\(anim, t\.rig\?\.\[sex\], withClipFix\(sex, t\.clips\?\.\[sex\]\)\)/);
});

test('the ready-made characters take the tuning too, by their body (readyMade, on unless off) — turned in the loader worker', async () => {
  const { normalizeTuning } = await import('../shared/crowd-tuning.js');
  assert.equal(normalizeTuning({}).readyMade, true); assert.equal(normalizeTuning({ readyMade: false }).readyMade, false);
  const w = fs.readFileSync(new URL('../client/js/render/char-loader.worker.js', import.meta.url), 'utf8'), src = fs.readFileSync(new URL('../client/js/render/characters.js', import.meta.url), 'utf8');
  assert.match(w, /const sex = man\.custom \? \(man\.custom\.gender === 'female' \? 'f' : 'm'\) : T\.readyMade \? \(\/\^f\/\.test\(kind\) \? 'f' : 'm'\) : null;/);
  assert.match(w, /plantClips\(an\); applyRig\(an, T\.rig\?\.\[sex\], withClipFix\(sex, T\.clips\?\.\[sex\]\)\); rigged = true;/);
  assert.match(src, /: tune\?\.readyMade !== false && man\.names \? rigAnim\(animData, a, man, tune, sexOf\(kind, man\)\) : null;/);
  assert.match(src, /ready = !man\?\.custom && \/\^\[mf\]\\d\/\.test\(KINDS\[kind\] \|\| ''\) && tuningNow\?\.readyMade !== false/);
});

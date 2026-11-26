// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The crowd's library in two files (shared/crowd-split.js, server/crowd-split.js): 'far' — the animation and every
// part's coarser levels, what everyone is drawn with first — and 'near', each part's finest level. Every section of the
// library lands in exactly one of them, byte for byte, 4-byte aligned; a part with one level keeps it in the far file; the
// close-up file's sections are left alone; the files are made again only when the library changes; and the server offers
// them (the crowd's version.json: split) once made and compressed.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crowdSplit } from '../shared/crowd-split.js';
import { CrowdSplit } from '../server/crowd-split.js';
import { startServer } from '../tools/lib/testserver.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sections = (man, skip = 'close') => {
  const out = [];
  const walk = (o, near) => {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) { o.forEach(x => walk(x, near)); return; }
    if (typeof o.off === 'number' && typeof o.len === 'number' && typeof o.type === 'string') { out.push({ ...o, near }); return; }
    for (const [k, v] of Object.entries(o)) { if (k === skip) continue; if (k === 'lods') v.forEach((L, i) => walk(L, i === 0 && v.length > 1)); else walk(v, near); }
  };
  walk(man.anim, false); walk(man.parts, false);
  return out;
};

/** A small library: an animation, a body with three levels, a hair with one, a top with two (and a close-up level). */
function smallLibrary(dir) {
  let off = 0; const chunks = [];
  const add = (n, type = 'float32') => {
    const b = Buffer.alloc(n); for (let i = 0; i < n; i++) b[i] = (off + i * 7) & 255;
    const e = { off, len: n, type, shape: [n / 4, 1] }; chunks.push(b); off += n; const pad = (4 - (off % 4)) % 4; if (pad) { chunks.push(Buffer.alloc(pad)); off += pad; }
    return e;
  };
  const level = n => ({ verts: n, tris: n, pos: add(n * 12), nrm: add(n * 12), idx: add(n * 6 + 2, 'uint16') });
  const man = {
    anim: { w: 4, h: 4, frames: 2, data: add(64, 'uint16') },
    parts: {
      body: [{ lods: [level(20), level(10), level(5)] }],
      hair: [{ name: 'one level', lods: [level(8)] }],
      top: [{ name: 'two', lods: [level(16), level(6)], close: { pos: { off: 0, len: 40, type: 'float32' } } }],
    },
  };
  fs.writeFileSync(path.join(dir, 'female.json'), JSON.stringify(man));
  fs.writeFileSync(path.join(dir, 'female.bin'), Buffer.concat(chunks));
  fs.writeFileSync(path.join(dir, 'male.json'), JSON.stringify(man));
  fs.writeFileSync(path.join(dir, 'male.bin'), Buffer.concat(chunks));
  return man;
}

test('crowd split: every section in exactly one file, byte for byte; one-level parts and the animation far', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mvw-split-')), out = path.join(dir, 'split');
  try {
    const man = smallLibrary(dir);
    const L = crowdSplit(man), all = sections(man);
    assert.equal(L.at.size, all.length, 'every section placed');
    for (const s of all) {
      const at = L.at.get(s.off);
      assert.equal(at.near, s.near, `section at ${s.off}: in the ${s.near ? 'near' : 'far'} file`);
      assert.equal(at.off % 4, 0, 'aligned');
    }
    assert.equal(L.at.get(man.anim.data.off).near, false, 'the animation is far');
    assert.equal(L.at.get(man.parts.hair[0].lods[0].pos.off).near, false, 'a part with one level keeps it far');
    assert.equal(L.at.get(man.parts.body[0].lods[0].pos.off).near, true, 'a finest level is near');
    assert.equal(L.at.get(man.parts.top[0].lods[1].pos.off).near, false);
    // the server's files hold those bytes where the layout says
    const S = new CrowdSplit({ src: dir, out, log: { info() {}, warn() {} } });
    assert.equal(await S.build(), true);
    const bin = fs.readFileSync(path.join(dir, 'female.bin'));
    const far = fs.readFileSync(path.join(out, 'female.far.bin')), near = fs.readFileSync(path.join(out, 'female.near.bin'));
    assert.equal(far.length, L.far.size); assert.equal(near.length, L.near.size);
    for (const s of all) {
      const at = L.at.get(s.off), f = at.near ? near : far;
      assert.ok(bin.subarray(s.off, s.off + s.len).equals(f.subarray(at.off, at.off + s.len)), `section at ${s.off} copied exactly`);
    }
    // made again only when the library changes
    const t0 = fs.statSync(path.join(out, 'female.far.bin')).mtimeMs;
    await new Promise(r => setTimeout(r, 20));
    assert.equal(await S.build(), true);
    assert.equal(fs.statSync(path.join(out, 'female.far.bin')).mtimeMs, t0, 'unchanged library: files kept');
    const b2 = Buffer.from(bin); b2[man.parts.body[0].lods[1].pos.off] ^= 255; fs.writeFileSync(path.join(dir, 'female.bin'), b2);
    assert.equal(await S.build(), true);
    const far2 = fs.readFileSync(path.join(out, 'female.far.bin')), at = L.at.get(man.parts.body[0].lods[1].pos.off);
    assert.equal(far2[at.off], b2[man.parts.body[0].lods[1].pos.off], 'a changed library: made again');
    // a library shorter than its manifest is refused (the whole one is served)
    fs.writeFileSync(path.join(dir, 'male.bin'), Buffer.alloc(8));
    assert.equal(await new CrowdSplit({ src: dir, out: path.join(dir, 'split2'), log: { info() {}, warn() {} } }).build(), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('crowd split: the release\'s own library splits whole', () => {
  for (const sex of ['female', 'male']) {
    const file = path.join(ROOT, 'client/assets/crowd', `${sex}.json`);
    if (!fs.existsSync(file)) continue;
    const man = JSON.parse(fs.readFileSync(file, 'utf8')), size = fs.statSync(path.join(ROOT, 'client/assets/crowd', `${sex}.bin`)).size;
    const L = crowdSplit(man), all = sections(man);
    assert.equal(L.at.size, new Set(all.map(s => s.off)).size);
    const covered = all.reduce((n, s) => n + s.len, 0);
    assert.ok(covered <= size && covered > size * 0.98, `${sex}: the sections are the library (${covered} of ${size} bytes)`);
    assert.ok(L.far.size < size * 0.6, `${sex}: the first file is well under the whole (${L.far.size} of ${size})`);
  }
});

test('crowd split over HTTP: offered once made and compressed, its files the library\'s sections', async () => {
  const s = await startServer();
  try {
    let v = null;
    for (let i = 0; i < 240 && !v?.split; i++) { v = await (await fetch(`${s.url}/assets/crowd/version.json`)).json(); if (!v.split) await new Promise(r => setTimeout(r, 500)); }
    assert.ok(v.split, 'the split is offered (made and compressed)');
    const man = await (await fetch(`${s.url}/assets/crowd/female.json?v=${v.v}`)).json(), L = crowdSplit(man);
    const far = await fetch(`${s.url}/assets/crowd-split/female.far.bin?v=${v.split}`, { headers: { 'accept-encoding': 'br' } });
    assert.equal(far.status, 200);
    assert.equal(far.headers.get('cache-control'), 'public, max-age=31536000, immutable');
    const buf = Buffer.from(await far.arrayBuffer());
    assert.equal(buf.length, L.far.size);
    const whole = Buffer.from(await (await fetch(`${s.url}/assets/crowd/female.bin?v=${v.v}`)).arrayBuffer()), a = man.anim.data, at = L.at.get(a.off);
    assert.ok(whole.subarray(a.off, a.off + a.len).equals(buf.subarray(at.off, at.off + a.len)), 'the animation, as in the library');
    const near = await fetch(`${s.url}/assets/crowd-split/male.near.bin?v=${v.split}`, { method: 'HEAD' });
    assert.equal(near.status, 200);
  } finally { await s.stop(); }
});

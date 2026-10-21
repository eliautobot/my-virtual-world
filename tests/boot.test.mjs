// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Starting and stopping the server as a whole process: a bad configuration stops the start with every problem listed,
// before anything is created; the world files and the accounts database must belong to the same world; a copy of the
// world files gets a new accounts database with their id; SIGTERM closes live streams with "going away", saves the
// world and exits 0; every log line reads "time level [area] message".
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { LEGACY_SETTINGS, SERVER_SETTINGS } from '../server/config.js';
import { openDb } from '../server/db.js';
import { ROOT, copyData, startServer, tempDir } from './helpers/server.mjs';

const LINE = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z (info|warn|error) \[[^\]]+\] |  )/;
/** The environment without any of the server's settings, so a developer's own cannot leak into these starts. */
function cleanEnv(extra) {
  const e = { ...process.env };
  for (const k of [...SERVER_SETTINGS, ...Object.keys(LEGACY_SETTINGS)]) delete e[k];
  return { ...e, PORT: '0', HOST: '127.0.0.1', ...extra };
}
/** Starts the server and waits for it to exit: for starts that must fail. */
const runServer = env => spawnSync(process.execPath, ['server/index.mjs'], { cwd: ROOT, env: cleanEnv(env), encoding: 'utf8', timeout: 30000 });
const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const removeAll = (...servers) => {
  for (const s of servers) {
    if (!s) continue;
    fs.rmSync(s.data, { recursive: true, force: true });
    if (s.keyFile) fs.rmSync(s.keyFile, { force: true });
  }
};

test('a bad configuration stops the start with every problem listed, before anything is created', () => {
  const dir = tempDir('mvw-boot-');
  try {
    const data = path.join(dir, 'data');
    const r = runServer({ MVW_DATA: data, PORT: 'eighty', MVW_POPULATION: '0', MVW_TRUSTED_PROXIES: 'proxy.example' });
    assert.equal(r.status, 2, r.stderr);
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /^\S+ error \[config\] 4 settings need fixing:\n/);
    for (const k of ['PORT', 'MVW_POPULATION', 'MVW_TRUSTED_PROXIES']) assert.match(r.stderr, new RegExp(`\\n  - ${k}[ :]`), k);
    assert.match(r.stderr, /MVW_KEY_FILE/, 'the missing key');
    assert.ok(!fs.existsSync(data), 'no data folder was created');

    const one = runServer({ MVW_DATA: 'relative-data', MVW_KEY_FILE: path.join(dir, 'secret.key') });
    assert.equal(one.status, 2, one.stderr);
    assert.match(one.stderr, /^\S+ error \[config\] MVW_DATA must be an absolute path/);
    assert.ok(!fs.existsSync(path.join(ROOT, 'relative-data')), 'no data folder was created');
    assert.ok(!fs.existsSync(path.join(dir, 'secret.key')), 'no key file was created');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the world files and the accounts database must belong to the same world', async () => {
  let a = null, b = null;
  try {
    a = await startServer({ population: 40 });
    await a.stop({ keepData: true });
    b = await startServer({ population: 40, env: { MVW_SEED: 'another-city' } });
    await b.stop({ keepData: true });
    const idA = readJson(path.join(a.data, 'world.json')).worldId, idB = readJson(path.join(b.data, 'world.json')).worldId;
    assert.ok(idA && idB && idA !== idB, 'each new world has its own id');
    assert.equal(readJson(path.join(a.data, 'meta.json')).worldId, idA, 'meta.json carries the id too');

    // The other world's files restored next to this world's accounts database.
    for (const f of ['world.json', 'people.json', 'meta.json']) fs.copyFileSync(path.join(b.data, f), path.join(a.data, f));
    const r = runServer({ MVW_DATA: a.data, MVW_KEY_FILE: a.keyFile, MVW_POPULATION: '40' });
    assert.equal(r.status, 2, r.stderr + r.stdout);
    assert.match(r.stderr, new RegExp(`belong to world ${idB}, but its accounts database \\(next\\.db\\) belongs to world ${idA}`));
    assert.equal(readJson(path.join(a.data, 'world.json')).worldId, idB, 'the world files were left as they were');

    // Pairing them on purpose: without an id in world.json, the database's id is written into the world files.
    const w = readJson(path.join(a.data, 'world.json'));
    delete w.worldId;
    fs.writeFileSync(path.join(a.data, 'world.json'), JSON.stringify(w));
    const again = await startServer({ data: a.data });
    await again.stop();
    assert.match(again.log(), new RegExp(` info \\[boot\\] world id ${idA} written into the world files`));
    assert.match(again.log(), new RegExp(` warn \\[boot\\] meta\\.json belongs to world ${idB}, not ${idA}: its clock is ignored`));
    assert.equal(readJson(path.join(a.data, 'world.json')).worldId, idA);
    assert.equal(readJson(path.join(a.data, 'meta.json')).worldId, idA);
  } finally {
    removeAll(a, b);
  }
});

test('a copy of the world files gets a new accounts database with their id, and is ready', async () => {
  let a = null;
  const dir = tempDir('mvw-boot-copy-');
  try {
    a = await startServer({ population: 40 });
    await a.stop({ keepData: true });
    const id = readJson(path.join(a.data, 'world.json')).worldId;
    copyData(a.data, dir);
    assert.ok(!fs.existsSync(path.join(dir, 'next.db')));
    const c = await startServer({ data: dir });
    const ready = await fetch(`${c.url}/api/ready`);
    assert.equal(ready.status, 200);
    assert.deepEqual(await ready.json(), { ready: true });
    await c.stop();
    assert.doesNotMatch(c.log(), /written into the world files/);
    const db = openDb(dir);
    try {
      assert.equal(db.worldId, id);
    } finally {
      db.close();
    }
  } finally {
    removeAll(a);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(`${dir}.key`, { force: true });
  }
});

test('SIGTERM: live streams close with "going away", the world is saved, the process exits 0', async () => {
  const s = await startServer({ population: 60 });
  try {
    const ready = await fetch(`${s.url}/api/ready`);
    assert.equal(ready.status, 200);
    let closeCode = null;
    const ws = new WebSocket(s.url.replace(/^http/, 'ws') + '/ws');
    const closed = new Promise(resolve => { ws.onclose = ev => { closeCode = ev.code; resolve(); }; });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no hello from the live stream')), 10000);
      ws.onmessage = ev => {
        if (typeof ev.data === 'string' && JSON.parse(ev.data).t === 'hello') { clearTimeout(timer); resolve(); }
      };
      ws.onerror = () => { clearTimeout(timer); reject(new Error('WebSocket error')); };
    });
    const t0 = Date.now();
    const r = await s.stop({ keepData: true });
    await Promise.race([closed, new Promise(resolve => setTimeout(resolve, 3000))]);
    assert.deepEqual(r, { code: 0, signal: null });
    assert.equal(closeCode, 1001, 'the browser is told the server is going away, and reconnects');
    assert.ok(Date.parse(readJson(path.join(s.data, 'meta.json')).saved) >= t0, 'saved on shutdown');
    const lines = s.log().split('\n').filter(Boolean);
    for (const l of lines) assert.match(l, LINE);
    assert.ok(lines.some(l => / info \[shutdown\] SIGTERM: saving and closing$/.test(l)), s.log());
    assert.ok(lines.some(l => / info \[shutdown\] done$/.test(l)), s.log());
  } finally {
    removeAll(s);
  }
});

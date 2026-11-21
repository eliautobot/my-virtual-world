// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The crowd's library baked again with the owner's detail (2026-11-19, the product owner: "can I apply the certain
// percentage to be saved in the high, middle, far, so that I can control the bake for each and apply it?"): the tuning's
// bake (shared/crowd-tuning.js: each level's error) handed to tools/chars/crowd-pack.mjs, run here in the background
// against this server's own character builder page (a headless browser: playwright-core and Chrome on the server), the
// library written to <data>/crowd-next and swapped in as <data>/crowd (the previous kept as crowd-prev), then served at
// /assets/crowd/ in place of the release's own (server/index.mjs). A library baked for an older release is not used: the
// release's own is served, and baked again from the saved settings (start-up).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { normalizeTuning } from '../shared/crowd-tuning.js';

const LINES = 40;

export class CrowdBake {
  /** root: the release; dataDir; url: this server (for the builder's page; a function: asked when a bake starts);
   *  onSwap(dir): serve the crowd from dir. */
  constructor({ root, dataDir, url, log = console, onSwap = () => {} }) {
    Object.assign(this, { root, dataDir, url, log, onSwap });
    this.repoDir = path.join(root, 'client/assets/crowd');
    this.dir = path.join(dataDir, 'crowd'); this.next = path.join(dataDir, 'crowd-next'); this.prev = path.join(dataDir, 'crowd-prev');
    this.state = { running: false, startedAt: null, finishedAt: null, ok: null, error: null, lines: [], bake: null };
    this.child = null;
  }
  /** The release's library, by its manifests' content (a library baked from another release is not used). */
  base() {
    const h = crypto.createHash('sha1');
    for (const f of ['female.json', 'male.json']) { try { h.update(fs.readFileSync(path.join(this.repoDir, f))); } catch { h.update('-'); } }
    return h.digest('hex').slice(0, 16);
  }
  build() { try { return JSON.parse(fs.readFileSync(path.join(this.dir, 'build.json'), 'utf8')); } catch { return null; } }
  /** Where the crowd is served from: the owner's bake when it was made from this release's library (with other settings
   *  than the release's own was made with), else the release's. */
  activeDir() {
    const b = this.build();
    return b && b.base === this.base() && fs.existsSync(path.join(this.dir, 'male.json')) && JSON.stringify(b.bake) !== JSON.stringify(this.releaseBake()) ? this.dir : this.repoDir;
  }
  status() {
    const b = this.build(), active = this.activeDir() === this.dir;
    return { ...this.state, lines: this.state.lines.slice(-LINES), served: active ? 'baked' : 'standard', built: active ? b : null, stale: !!b && !active };
  }
  /** Bakes again with `bake` (the tuning's: { near, middle, far } metres; null: the budgets). → false when one runs. */
  start(bake, by = null) {
    if (this.state.running) return false;
    const b = normalizeTuning({ bake }).bake;
    fs.rmSync(this.next, { recursive: true, force: true }); fs.mkdirSync(this.next, { recursive: true });
    const url = typeof this.url === 'function' ? this.url() : this.url;
    const args = [path.join(this.root, 'tools/chars/crowd-pack.mjs'), '--url', url, '--out', this.next, ...(b ? ['--bake', JSON.stringify(b)] : [])];
    this.state = { running: true, startedAt: new Date().toISOString(), finishedAt: null, ok: null, error: null, lines: [], bake: b, by };
    this.log.info?.(`[crowd] baking the crowd's library again (${b ? JSON.stringify(b) : 'the standard budgets'})`);
    // (the tool's browser as the test tools' launcher picks it: tools/lib/browser.cjs, the server's own environment)
    const child = this.child = spawn(process.execPath, args, { cwd: this.root, stdio: ['ignore', 'pipe', 'pipe'] });
    const take = buf => { for (const l of String(buf).split('\n')) if (l.trim()) { this.state.lines.push(l.slice(0, 300)); if (this.state.lines.length > 400) this.state.lines.splice(0, 200); } };
    child.stdout.on('data', take); child.stderr.on('data', take);
    child.on('error', err => this.finish(false, err.message));
    child.on('exit', code => {
      if (code !== 0) return this.finish(false, `the bake stopped (${code})${/playwright|executable|browser/i.test(this.state.lines.join(' ')) ? ': it needs a browser on the server (playwright-core and Chrome)' : ''}`);
      try {
        for (const f of ['female.json', 'male.json', 'female.bin', 'male.bin']) if (!fs.existsSync(path.join(this.next, f))) throw new Error(`${f} missing`);
        fs.writeFileSync(path.join(this.next, 'build.json'), JSON.stringify({ base: this.base(), bake: b, at: new Date().toISOString(), by }));
        fs.rmSync(this.prev, { recursive: true, force: true });
        if (fs.existsSync(this.dir)) fs.renameSync(this.dir, this.prev);
        fs.renameSync(this.next, this.dir);
        this.onSwap(this.dir);
        this.finish(true);
      } catch (err) { this.finish(false, err.message); }
    });
    return true;
  }
  finish(ok, error = null) {
    Object.assign(this.state, { running: false, finishedAt: new Date().toISOString(), ok, error });
    this.child = null;
    this.log[ok ? 'info' : 'warn']?.(`[crowd] the bake ${ok ? 'is in place' : 'failed: ' + error}`);
  }
  /** Back to the release's own library (the owner's kept as crowd-prev). */
  standard() {
    if (this.state.running) return false;
    fs.rmSync(this.prev, { recursive: true, force: true });
    if (fs.existsSync(this.dir)) fs.renameSync(this.dir, this.prev);
    this.onSwap(this.repoDir);
    return true;
  }
  /** The bake the release's own library was made with (its manifests' made.bake), or null (the budgets). */
  releaseBake() {
    try { return normalizeTuning({ bake: JSON.parse(fs.readFileSync(path.join(this.repoDir, 'male.json'), 'utf8')).made?.bake || null }).bake; }
    catch { return null; }
  }
  /** At start-up: the saved settings' bake made again when it is missing, stale, or made with other settings — not when
   *  the release's own library was made with them (it is served as it is: no browser needed on the server). */
  resume(tuning) {
    const want = normalizeTuning(tuning).bake, b = this.build();
    if (!want) return false;
    if (JSON.stringify(want) === JSON.stringify(this.releaseBake())) return false;   // (and activeDir serves the release's)
    if (b && b.base === this.base() && JSON.stringify(b.bake) === JSON.stringify(want)) return false;
    return this.start(want, 'start-up');
  }
}

/** @param router @param d { bake: CrowdBake, readTuning: () => the saved tuning, audit } */
export function addCrowdBakeRoutes(router, d) {
  router.add({ method: 'GET', path: '/api/crowd/bake', cap: 'world.edit', handler: async () => ({ status: 200, json: d.bake.status() }) });
  // { action: 'start' } bakes again with the saved tuning's bake; { action: 'standard' } serves the release's own again
  router.add({ method: 'POST', path: '/api/crowd/bake', cap: 'world.edit', handler: async ({ P, body }) => {
    const action = body?.action, by = P?.account?.login || null;
    if (action === 'start') {
      if (!d.bake.start(d.readTuning().bake, by)) return { status: 409, json: { error: 'a bake is running', code: 'busy' } };
    } else if (action === 'standard') {
      if (!d.bake.standard()) return { status: 409, json: { error: 'a bake is running', code: 'busy' } };
    } else return { status: 400, json: { error: 'action: start or standard', code: 'bad_action' } };
    d.audit?.log('crowd.bake', { actor: P?.account ? { id: P.account.id, login: P.account.login } : null, detail: { action } });
    return { status: 202, json: d.bake.status() };
  } });
}

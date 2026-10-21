// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The built-in browser (docs/features/agent-pc.md §5): a real Chrome this server starts by itself for its built-in
// agents, headless, when one first needs it — and stops after a while with nobody browsing. Every page it loads goes
// through the egress proxy (./egress-proxy.js: the public internet only, this machine and the local network never),
// WebRTC can't go around it, and it downloads nothing by itself. Each agent browses in a context of its own (its own
// cookies, logins and storage, never another agent's or another account's), kept while Chrome runs. The browser
// (./browser.js PcBrowser) drives it over the DevTools Protocol, as it drives a browser service of an owner's; the person
// whose agent it is watches it live and can take it over (its screencast). No Chrome on this machine: the agents read
// pages with the built-in reader instead.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import { EgressProxy } from './egress-proxy.js';

const START_MS = 20000, IDLE_MS = 10 * 60000;

/**
 * Chrome on this machine: the one MVW_CHROME names (server/config.js), else a system Chrome or Chromium (installed with what its sandbox needs — on
 * Ubuntu 23.10+ a copy without it can't sandbox its pages), else the newest Chromium Playwright keeps. A Chrome that
 * can't sandbox its pages is never used (start() fails: the agents read with the reader).
 */
export function findChrome({ chrome = '' } = {}) {
  if (chrome === 'off') return null;   // (none: the reader only — MVW_CHROME, server/config.js)
  if (chrome && fs.existsSync(chrome)) return chrome;
  for (const p of ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium']) if (fs.existsSync(p)) return p;
  const cache = path.join(os.homedir(), '.cache', 'ms-playwright');
  try {
    const dirs = fs.readdirSync(cache).filter(d => /^chromium-\d+$/.test(d)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
    for (const d of dirs) for (const sub of ['chrome-linux64/chrome', 'chrome-linux/chrome']) { const p = path.join(cache, d, sub); if (fs.existsSync(p)) return p; }
  } catch { /* none there */ }
  return null;
}

export class LocalChrome {
  /**
   * dir: the PC's folder (unused by Chrome itself: its profile is a temporary folder, removed when it stops). exe: Chrome
   * (findChrome). enabled(): whether the installation uses it (Settings → PC).
   */
  constructor({ dir, exe = findChrome(), enabled = () => true, log = null, idleMs = IDLE_MS, resolve = undefined } = {}) {
    Object.assign(this, { dir, exe, enabledFn: enabled, log, idleMs, resolve });   // (resolve: the proxy's address check — tests give their own)
    this.proc = null; this.ws = null; this.endpoint = null; this.starting = null; this.ua = null; this.failed = null;
    this.contexts = new Map();   // agent id → its browser context (while Chrome runs)
    this.used = 0; this.n = 0; this.wait = new Map();
    this.proxy = null;
    this.timer = setInterval(() => { if (this.proc && Date.now() - this.used > this.idleMs) this.stop(); }, 60000);
    this.timer.unref?.();
  }
  /** A page of it is in use or watched: it keeps running. */
  touch() { this.used = Date.now(); }
  /** Whether it can browse here (Chrome found and switched on). */
  available() { return !!(this.exe && this.enabledFn()); }
  /** Its DevTools address, Chrome started first when it isn't running. */
  async ensure() {
    if (!this.available()) return null;
    this.used = Date.now();
    if (this.endpoint && this.proc && this.proc.exitCode === null && this.ws?.readyState === 1) return this.endpoint;
    this.starting ||= this.start().finally(() => { this.starting = null; });
    return this.starting;
  }
  async start() {
    await this.stop();
    this.proxy = new EgressProxy({ log: this.log, ...(this.resolve ? { resolve: this.resolve } : {}) });
    const proxyAt = await this.proxy.listen();
    // (its profile and cache: a folder of its own outside the world's data, removed when it stops — nothing it browsed is
    // kept on disk, and backups never carry it)
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mvw-chrome-'));
    fs.chmodSync(root, 0o700);
    this.profile = root;
    const profile = path.join(root, 'profile'), home = path.join(root, 'home');   // (apart: Chrome stalls when they are one)
    fs.mkdirSync(profile); fs.mkdirSync(home);
    const args = [
      '--headless=new', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', `--user-data-dir=${profile}`,
      `--proxy-server=${proxyAt}`, '--proxy-bypass-list=<-loopback>',   // (everything through the proxy, this machine's own loopback too)
      '--force-webrtc-ip-handling-policy=disable_non_proxied_udp', '--webrtc-ip-handling-policy=disable_non_proxied_udp', '--disable-quic',
      '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', '--disable-sync',
      '--disable-extensions', '--disable-default-apps', '--disable-breakpad', '--mute-audio', '--password-store=basic', '--use-mock-keychain',
      '--disable-features=Translate,MediaRouter,OptimizationHints,AutofillServerCommunication', '--window-size=1280,800', `--disk-cache-size=${64 * 1048576}`, 'about:blank',
      ...(os.userInfo().uid === 0 ? ['--no-sandbox'] : []),   // (as root, in a container: Chrome's sandbox needs a user)
    ];
    const proc = spawn(this.exe, args, { stdio: ['ignore', 'ignore', 'pipe'], env: { HOME: home, PATH: '/usr/local/bin:/usr/bin:/bin' } });   // (nothing of the server's own environment)
    this.proc = proc;
    const endpoint = await new Promise((resolve, reject) => {
      let buf = '';
      const t = setTimeout(() => reject(new Error('Chrome did not start in time')), START_MS);
      proc.stderr.on('data', d => {
        buf += d; if (buf.length > 65536) buf = buf.slice(-8192);
        const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf);
        if (m) { clearTimeout(t); resolve(m[1]); }
      });
      proc.once('exit', code => { clearTimeout(t); reject(new Error(/No usable sandbox/.test(buf) ? 'Chrome can\'t sandbox its pages on this machine (install Google Chrome, or set MVW_CHROME to one that can)' : `Chrome stopped (${code})`)); });
      proc.once('error', e => { clearTimeout(t); reject(e); });
    });
    proc.once('exit', () => { if (this.proc === proc) { this.proc = null; this.endpoint = null; this.contexts.clear(); try { this.ws?.close(); } catch { /* gone */ } } });
    // (its own line to Chrome: contexts are made and closed here)
    this.ws = await new Promise((resolve, reject) => {
      const ws = new WebSocket(endpoint, { maxPayload: 16 * 1048576 });
      ws.once('open', () => resolve(ws));
      ws.once('error', reject);
      ws.on('message', d => { let m; try { m = JSON.parse(String(d)); } catch { return; } const w = m.id && this.wait.get(m.id); if (w) { this.wait.delete(m.id); m.error ? w.reject(new Error(m.error.message)) : w.resolve(m.result || {}); } });
      ws.on('close', () => { for (const w of this.wait.values()) w.reject(new Error('Chrome closed')); this.wait.clear(); });
    });
    this.endpoint = endpoint;
    // (its pages say they are Chrome, not "HeadlessChrome": sites refuse a headless browser outright)
    try { this.ua = String((await this.call('Browser.getVersion')).userAgent || '').replace('HeadlessChrome', 'Chrome'); } catch { this.ua = null; }
    this.log?.info?.(`[pc] the built-in browser started (${path.basename(this.exe)})`);
    return endpoint;
  }
  call(method, params = {}) {
    if (!this.ws || this.ws.readyState !== 1) return Promise.reject(new Error('Chrome is not running'));
    const id = ++this.n;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { this.wait.delete(id); reject(new Error('Chrome took too long')); }, 15000);
      this.wait.set(id, { resolve: v => { clearTimeout(t); resolve(v); }, reject: e => { clearTimeout(t); reject(e); } });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  /** An agent's own context: its cookies and logins, apart from everyone else's; downloads refused. */
  async contextFor(agentId) {
    await this.ensure();
    let id = this.contexts.get(agentId);
    if (id) return id;
    const r = await this.call('Target.createBrowserContext', { disposeOnDetach: false });
    id = r.browserContextId;
    await this.call('Browser.setDownloadBehavior', { behavior: 'deny', browserContextId: id }).catch(() => {});
    this.contexts.set(agentId, id);
    return id;
  }
  /** An agent's context closed (its agent removed, or moved to another account): its cookies go with it. */
  async forget(agentId) {
    const id = this.contexts.get(agentId);
    this.contexts.delete(agentId);
    if (id) await this.call('Target.disposeBrowserContext', { browserContextId: id }).catch(() => {});
  }
  async stop() {
    const proc = this.proc;
    this.proc = null; this.endpoint = null; this.contexts.clear();
    try { this.ws?.close(); } catch { /* gone */ }
    this.ws = null;
    const profile = this.profile;
    this.profile = null;
    const gone = () => { if (profile) fs.rm(profile, { recursive: true, force: true }, () => {}); };
    if (proc && proc.exitCode === null) {
      proc.once('exit', gone);
      proc.kill('SIGTERM'); setTimeout(() => { if (proc.exitCode === null) proc.kill('SIGKILL'); }, 3000).unref?.();
    } else gone();
    if (this.proxy) { const p = this.proxy; this.proxy = null; await p.close().catch(() => {}); }
  }
  close() { clearInterval(this.timer); return this.stop(); }
}

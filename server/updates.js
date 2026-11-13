// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// "New version available" (docs/INSTALL.md, Updating): the server asks the public repository's latest release on
// GitHub, a minute after it starts and then every 12 hours, whether a version newer than the one it runs is out.
// - Only that question goes out: a plain GET with no cookie, no key and nothing about this world (GitHub sees the
//   server's address, as for any download). Drafts and pre-releases are never offered.
// - The answer is kept (the settings row update.latest), so Settings → About and the page's notice show it at once after
//   a restart. A newer version is told once to each account that runs the server (settings.infrastructure: the owner by
//   default) — one made later is told at the next check: a notification in the bell, and Web Push when no page of
//   theirs is open.
// - No answer (offline, GitHub down, a rate limit) changes nothing. Off: Settings → General ("Check for new versions")
//   or MVW_UPDATE_CHECK=off.
export const RELEASES_URL = 'https://api.github.com/repos/eliautobot/my-virtual-world/releases/latest';
export const RELEASES_PAGE = 'https://github.com/eliautobot/my-virtual-world/releases';
export const FIRST_MS = 60000, EVERY_MS = 12 * 3600000;
export const ROW = 'update.latest';
const NOTES_MAX = 4000;

/** [major, minor, patch] of "2.6.0" or "v2.6.0" (a suffix such as -rc.1 is ignored), or null. */
export function parseVersion(v) {
  const m = /^v?(\d{1,6})\.(\d{1,6})\.(\d{1,6})(?:[-+][0-9A-Za-z.-]*)?$/.exec(String(v ?? '').trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}
/** Whether version a is newer than version b (false when either can't be read). */
export function newer(a, b) {
  const x = parseVersion(a), y = parseVersion(b);
  if (!x || !y) return false;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}
const clean = (s, max) => String(s ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max);
/** A release page to link to: GitHub's own (https://github.com/…), else the releases list. */
const pageOf = u => (typeof u === 'string' && /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/releases\/[\w./%-]+$/.test(u) ? u : RELEASES_PAGE);

export class UpdateCheck {
  /**
   * @param {object} o
   * @param {object} o.db  the database (its settings table keeps the last answer)
   * @param {string} o.worldId
   * @param {string} o.current  the version this server runs (package.json)
   * @param {() => boolean} [o.enabled]  Settings → General's switch (and MVW_UPDATE_CHECK)
   * @param {(accountId: number, n: object) => void} [o.notify]  a notification for one account
   * @param {() => number[]} [o.recipients]  the accounts told of a new version
   */
  constructor({ db, worldId, current, url = RELEASES_URL, enabled = () => true, notify = null, recipients = () => [], fetch = globalThis.fetch,
    now = () => Date.now(), log = null, timeoutMs = 15000 }) {
    Object.assign(this, { db, w: worldId, current: String(current), url, enabled, notify, recipients, fetchFn: fetch, now, log, timeoutMs });
    this.q = {
      get: db.prepare('SELECT value FROM settings WHERE world_id = ? AND key = ?'),
      put: db.prepare('INSERT INTO settings (world_id, key, value) VALUES (?, ?, ?) ON CONFLICT (world_id, key) DO UPDATE SET value = excluded.value'),
    };
    this.timers = [];
    this.listeners = new Set();   // () => void: a newer version became known (the pages are told)
  }
  /** The last answer kept: { version, name, url, publishedAt, notes, checkedAt, told: [account ids told of it] } or null. */
  read() {
    try { const j = JSON.parse(this.q.get.get(this.w, ROW)?.value || 'null'); return j && typeof j === 'object' && parseVersion(j.version) ? j : null; } catch { return null; }
  }
  /** What Settings → About and the page show: this version, the newest known, and whether it is newer. */
  status() {
    const r = this.read(), on = !!this.enabled();
    const available = on && !!r && newer(r.version, this.current);
    return {
      current: this.current, enabled: on, available,
      latest: r ? { version: r.version, name: r.name || null, url: pageOf(r.url), publishedAt: r.publishedAt || null, notes: available ? r.notes || '' : '' } : null,
      checkedAt: r?.checkedAt || null, releasesUrl: RELEASES_PAGE,
    };
  }
  /** Asks GitHub once. → { checked, available?, version?, why? } */
  async check() {
    if (!this.enabled()) return { checked: false, why: 'off' };
    let res, j;
    try {
      res = await this.fetchFn(this.url, {
        headers: { accept: 'application/vnd.github+json', 'user-agent': 'My-Virtual-World-update-check', 'x-github-api-version': '2022-11-28' },
        signal: AbortSignal.timeout(this.timeoutMs), redirect: 'follow',
      });
      if (!res.ok) return { checked: false, why: `http_${res.status}` };
      j = await res.json();
    } catch (e) { return { checked: false, why: 'unreachable', error: e?.message }; }
    if (!j || typeof j !== 'object' || j.draft || j.prerelease) return { checked: false, why: 'no_release' };
    const version = String(j.tag_name ?? '').trim().replace(/^v/, '');
    if (!parseVersion(version)) return { checked: false, why: 'bad_version' };
    const before = this.read();
    const rec = {
      version, name: clean(j.name, 120) || null, url: pageOf(j.html_url), publishedAt: typeof j.published_at === 'string' ? j.published_at : null,
      notes: clean(j.body, NOTES_MAX), checkedAt: new Date(this.now()).toISOString(),
      told: before?.version === version && Array.isArray(before.told) ? before.told.filter(Number.isInteger) : [],
    };
    const available = newer(version, this.current);
    if (available) {
      const fresh = (this.recipients() || []).filter(id => Number.isInteger(id) && !rec.told.includes(id));
      if (fresh.length && !rec.told.length) this.log?.(`[update] My Virtual World ${version} is available (this server runs ${this.current}): ${rec.url}`);
      for (const id of fresh) {
        rec.told.push(id);
        try {
          this.notify?.(id, {
            kind: 'update', title: `New version available: My Virtual World ${version}`,
            body: `This server runs ${this.current}. Settings → About shows what's new and how to update.`, link: { update: version },
          });
        } catch (e) { this.log?.warn?.('[update] notification', e.message); }
      }
    }
    this.q.put.run(this.w, ROW, JSON.stringify(rec));
    if (available && before?.version !== version) for (const fn of this.listeners) { try { fn(); } catch { /* a listener's own problem */ } }
    return { checked: true, available, version };
  }
  /** Checks a minute after the start, then every 12 hours (the server; tests call check() themselves). */
  start({ first = FIRST_MS, every = EVERY_MS } = {}) {
    const run = () => { this.check().catch(e => this.log?.warn?.('[update] check', e.message)); };
    this.timers = [setTimeout(run, first), setInterval(run, every)];
    for (const t of this.timers) t.unref?.();
    return this;
  }
  stop() { for (const t of this.timers) { clearTimeout(t); clearInterval(t); } this.timers = []; }
}

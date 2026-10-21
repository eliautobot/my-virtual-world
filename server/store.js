// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// JSON persistence with atomic writes, debounced saves and one rolling backup per file.
import fs from 'node:fs';
import path from 'node:path';

export class Store {
  constructor(dir, { log = null } = {}) {
    this.dir = dir;
    this.logError = log && log.error ? log.error : (...a) => console.error(...a);
    fs.mkdirSync(dir, { recursive: true });
    this.timers = new Map();
    this.pending = new Map();
  }
  file(name) { return path.join(this.dir, name + '.json'); }
  load(name) {
    for (const f of [this.file(name), this.file(name) + '.bak']) {
      try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { /* try next */ }
    }
    return null;
  }
  save(name, obj) {
    const f = this.file(name), tmp = f + '.tmp';
    const data = JSON.stringify(obj);
    fs.writeFileSync(tmp, data);
    try { if (fs.existsSync(f)) fs.copyFileSync(f, f + '.bak'); } catch { /* backup is best effort */ }
    fs.renameSync(tmp, f);
    return data.length;
  }
  /** Debounced save: getter is called when the timer fires. */
  saveSoon(name, getter, delay = 2500) {
    this.pending.set(name, getter);
    if (this.timers.has(name)) return;
    this.timers.set(name, setTimeout(() => {
      this.timers.delete(name);
      const g = this.pending.get(name); this.pending.delete(name);
      try { this.save(name, g()); } catch (e) { this.logError('[store] save failed', name, e.message); }
    }, delay));
  }
  flushAll() {
    for (const [name, t] of this.timers) {
      clearTimeout(t);
      const g = this.pending.get(name);
      if (g) try { this.save(name, g()); } catch (e) { this.logError('[store] flush failed', name, e.message); }
    }
    this.timers.clear(); this.pending.clear();
  }
}

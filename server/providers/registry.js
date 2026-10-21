// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The provider registry (PLAN WP2.2, CHECKLIST X12). It knows every kind that is listed (the built-in manifests) and which
// of them have a working adapter behind the helper process. It never calls an adapter: calls go through the host.
import { BUILTIN_MANIFESTS, validateManifest } from './manifest.js';

export class Registry {
  /** @param {{ manifests?: object[], allowTest?: boolean }} [o]  allowTest lets a manifest marked test: true register (the mock provider). */
  constructor({ manifests = BUILTIN_MANIFESTS, allowTest = false } = {}) {
    this.allowTest = allowTest;
    this.byId = new Map(manifests.map(m => [m.id, m]));
    this.builtIn = new Set(this.byId.keys());
    this.live = new Set();       // kinds with a working adapter
    this.inproc = new Set();     // kinds the server itself serves (the Agent API); they stay live whatever the helper reports
  }
  manifest(kind) { return this.byId.get(kind) || null; }
  has(kind) { return this.byId.has(kind); }
  implemented(kind) { return this.live.has(kind); }
  /** A listed kind that needs no helper: the server answers for it. */
  addInProcess(kind) { if (!this.byId.has(kind)) throw new Error(`unknown kind ${kind}`); this.inproc.add(kind); this.live.add(kind); }
  /** Every listed kind, with whether its adapter exists; a kind without one says which package brings it. */
  list() {
    return [...this.byId.values()].map(m => ({ ...m, implemented: this.live.has(m.id), arrivesIn: this.live.has(m.id) ? undefined : m.arrivesIn }));
  }
  /** Takes the manifests the helper reports when it starts. A built-in kind keeps the manifest it is displayed with (the
   *  adapter's must carry the same id and a valid `official` note); anything else must be a test manifest. Returns the kinds adopted. */
  adopt(reported) {
    this.live.clear();
    for (const k of this.inproc) this.live.add(k);
    const adopted = [];
    for (const m of reported || []) {
      const problems = validateManifest(m);
      if (problems.length) { this.problems = [...(this.problems || []), `${m && m.id}: ${problems.join('; ')}`]; continue; }
      if (this.builtIn.has(m.id)) this.live.add(m.id);
      else if (m.test === true && this.allowTest) { this.byId.set(m.id, m); this.live.add(m.id); }
      else { this.problems = [...(this.problems || []), `${m.id}: not a listed kind`]; continue; }
      adopted.push(m.id);
    }
    return adopted;
  }
}

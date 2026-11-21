// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The crowd's tuning (shared/crowd-tuning.js; set in the Crowd Studio, client/dev/crowd-studio.html): kept in the data
// folder (crowd-tuning.json), read by every page that draws the crowd, written by those who can edit the world. Until an
// installation saves its own, the release's (client/assets/crowd/tuning.json: the product's animation and fit fixes,
// 2026-11-20 — the product owner's Crowd Studio work shipped as everyone's default) is the one used.
import fs from 'node:fs';
import path from 'node:path';
import { normalizeTuning } from '../shared/crowd-tuning.js';

/** The tuning in use: the installation's saved one, else the release's own, else none. → { tuning, saved: { by, at } | null } */
export function crowdTuningOf(dataDir, root) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(dataDir, 'crowd-tuning.json'), 'utf8'));
    return { tuning: normalizeTuning(j), saved: { by: j.by || null, at: j.at || null } };
  } catch { /* none saved (or unreadable): the release's */ }
  try { return { tuning: normalizeTuning(JSON.parse(fs.readFileSync(path.join(root, 'client/assets/crowd/tuning.json'), 'utf8'))), saved: null }; }
  catch { return { tuning: normalizeTuning({}), saved: null }; }
}

/** @param router @param d { dataDir, root (the release: its own tuning), audit, edit (false: read only — the Crowd Studio
 *  switched off, MVW_CROWD_STUDIO: no route changes it) } */
export function addCrowdTuningRoutes(router, d) {
  const file = path.join(d.dataDir, 'crowd-tuning.json');
  router.add({ method: 'GET', path: '/api/crowd/tuning', cap: 'world.view', handler: async () => {
    const { tuning, saved } = crowdTuningOf(d.dataDir, d.root);
    return { status: 200, json: { ...tuning, by: saved?.by || null, at: saved?.at || null, source: saved ? 'saved' : 'release' } };
  } });
  if (d.edit === false) return;
  // the whole tuning, replaced (what the studio shows is what is kept)
  router.add({ method: 'POST', path: '/api/crowd/tuning', cap: 'world.edit', handler: async ({ P, body }) => {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return { status: 400, json: { error: 'a tuning object is required', code: 'bad_tuning' } };
    if (JSON.stringify(body).length > 200000) return { status: 413, json: { error: 'tuning too large', code: 'too_large' } };
    const t = normalizeTuning(body), doc = { ...t, by: P?.account?.login || null, at: new Date().toISOString() };
    fs.mkdirSync(d.dataDir, { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(doc, null, 1)); fs.renameSync(tmp, file);
    d.audit?.log('crowd.tuning', { actor: P?.account ? { id: P.account.id, login: P.account.login } : null, detail: { off: Object.values(t.off).reduce((n, o) => n + Object.values(o).flat().length, 0), rig: Object.keys(t.rig) } });
    return { status: 200, json: doc };
  } });
}

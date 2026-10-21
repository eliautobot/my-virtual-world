// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The edit journal (PLAN WP1.8, DECISIONS C35, C116) on a generated city: every edit type undoes and redoes, each
// account undoes only its own edits, a later change by someone else refuses the undo and names it, admins revert any
// edit (and undo the revert), restores re-check placement, and the history keeps its depth. Plus the activity log.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { Sim } from '../../server/sim/sim.js';
import { Editor } from '../../server/world/edit.js';
import { Journal } from '../../server/world/journal.js';
import { Activity } from '../../server/activity.js';
import { openDb } from '../../server/db.js';
import { checkItem, checkBuilding, normalizeSpec, interiorBounds } from '../../shared/edit.js';
import { makeGrid } from '../../shared/city.js';
import { testCity } from '../helpers/world.mjs';
import { tempDir } from '../helpers/server.mjs';

function setup({ depth = 100 } = {}) {
  const { world, people, index } = testCity({ seed: 'journal-test', population: 300 });
  const sim = new Sim(world, people, { index, budgetMs: 1e9 });
  sim.now = () => 0;
  sim.clock = { simBase: 0, realBase: 0, rate: 1, dayBase: 9 * 3600, dayScale: 16 };
  sim.start();
  const dir = tempDir('mvw-journal-');
  const dbs = openDb(dir);
  let clock = 1_700_000_000_000;
  const app = { world, sim, save() {}, onPatches() {}, onNote() {} };
  const editor = new Editor(app);
  const journal = new Journal(dbs, { editor, depth, now: () => (clock += 1000) });
  editor.journal = journal;
  const as = (id, name) => ({ id, name, P: { account: { id, displayName: name } } });
  return {
    world, sim, editor, journal, ada: as(1, 'Ada'), ben: as(2, 'Ben'), cy: as(3, 'Cy'),
    jump: ms => { clock += ms; },
    cleanup: () => { dbs.close(); fs.rmSync(dir, { recursive: true, force: true }); },
  };
}
const standing = (world, pred) => world.buildings.filter(b => b && !b.gone && b.type !== 'hq' && b.type !== 'park' && pred(b));
/** Places an item on a free spot of a floor (nearest the middle first), as that account; { id, x, z }. */
function place(t, actor, B, f, type, { at = null, turned = false } = {}) {
  const ib = interiorBounds(B), cx = (ib.x0 + ib.x1) / 2, cz = (ib.z0 + ib.z1) / 2;
  const cands = [];
  if (at) cands.push(at);
  else for (let z = ib.z0 + 1; z < ib.z1 - 1; z += 0.5) for (let x = ib.x0 + 1; x < ib.x1 - 1; x += 0.5) cands.push({ x, z });
  cands.sort((a, b) => Math.hypot(a.x - cx, a.z - cz) - Math.hypot(b.x - cx, b.z - cz));
  for (const c of cands) {
    const L = t.world.levels[B.lv[f]];
    if (checkItem(B, f, L, { t: type, x: c.x, z: c.z, r: 0 })) continue;
    if (turned && checkItem(B, f, L, { t: type, x: c.x, z: c.z, r: 1.5 })) continue;
    const r = t.editor.apply([{ op: 'item.add', b: B.idx, f, t: type, x: c.x, z: c.z, c: '#112233' }], actor);
    if (r.ok) return { id: r.results[0].id, x: c.x, z: c.z };
  }
  return null;
}
function freeLot(world) {
  const g = makeGrid(world.grid);
  for (let z = g.minZ + 10; z < g.maxZ - 10; z += 2) for (let x = g.minX + 10; x < g.maxX - 10; x += 2) {
    const s = normalizeSpec({ type: 'cafe', w: 12, d: 14, floors: 1, style: 'modern', rot: 0, x, z });
    if (!checkBuilding(world, s)) return s;
  }
  return null;
}
const ok = r => { assert.equal(r.ok, true, r.error); return r; };

test('every edit type undoes and redoes: furniture, building properties, floors, demolition, new buildings, residents', () => {
  const t = setup();
  try {
    const { world, editor, journal, ada, sim } = t;
    const edit = ops => ok(editor.apply(ops, ada));
    const undo = () => ok(journal.undo(ada.P)), redo = () => ok(journal.redo(ada.P));
    const O = standing(world, b => b.type === 'office' && b.floors >= 3)[0];
    // furniture: place a rug, turn it, recolour it, remove it; back and forward again
    const f = 1, rug = place(t, ada, O, f, 'rug', { turned: true });
    assert.ok(rug, 'a free spot for the rug');
    const it = () => world.levels[O.lv[f]].items.find(i => i.id === rug.id);
    edit([{ op: 'item.move', b: O.idx, f, id: rug.id, x: rug.x, z: rug.z, r: 1.5 }]);
    edit([{ op: 'item.tint', b: O.idx, f, id: rug.id, c: '#445566' }]);
    edit([{ op: 'item.del', b: O.idx, f, id: rug.id }]);
    assert.equal(it(), undefined);
    undo(); assert.equal(it().c, '#445566', 'the removal is undone');
    undo(); assert.equal(it().c, '#112233', 'the colour is undone');
    undo(); assert.equal(it().r, 0, 'the turn is undone');
    undo(); assert.equal(it(), undefined, 'the placement is undone');
    redo(); redo(); redo();
    assert.deepEqual([it().r, it().c], [1.5, '#445566'], 'redo walks forward again');
    redo(); assert.equal(it(), undefined);
    // building properties
    const name0 = O.name;
    edit([{ op: 'bld.set', b: O.idx, name: 'Journal Tower', colors: { wall: '#abcdef' } }]);
    undo(); assert.equal(O.name, name0);
    redo(); assert.deepEqual([O.name, O.colors.wall], ['Journal Tower', '#abcdef']);
    // floors: added, then removed, each undone with the layouts they had
    const n0 = O.floors, lv0 = [...O.lv];
    edit([{ op: 'bld.floors', b: O.idx, floors: n0 + 2 }]);
    assert.equal(O.floors, n0 + 2);
    undo(); assert.deepEqual([O.floors, O.lv], [n0, lv0], 'added floors go again');
    redo(); assert.equal(O.floors, n0 + 2);
    undo();
    edit([{ op: 'bld.floors', b: O.idx, floors: n0 - 1 }]);
    assert.equal(journal.tops(1).redoCount, 0, 'a new edit drops the redo steps');
    undo(); assert.deepEqual([O.floors, O.lv], [n0, lv0], 'a removed floor comes back with its layout');
    // demolition
    edit([{ op: 'bld.del', b: O.idx }]);
    assert.equal(O.gone, 1);
    undo(); assert.ok(!O.gone, 'the demolished building stands again'); assert.equal(O.floors, n0);
    redo(); assert.equal(O.gone, 1);
    undo();
    // a new building
    const spec = freeLot(world);
    assert.ok(spec, 'a free lot');
    const nb = edit([{ op: 'bld.add', spec: { ...spec, name: 'Undo Café' } }]).results[0].b, B = world.buildings[nb];
    const grown = sim.people.length;
    undo(); assert.equal(B.gone, 1, 'undoing a new building removes it');
    redo(); assert.ok(!B.gone, 'redo brings it back');
    assert.equal(sim.people.length, grown, 'restores never bring newcomers');
    // residents: renaming and restyling undo; adding one is logged but not in the undo history
    const i = 7, p = sim.people[i], pn = p.name, look = structuredClone(p.app);
    edit([{ op: 'person.set', i, name: 'Renamed Person', app: { ...p.app, hair: '#010203' } }]);
    undo(); assert.equal(p.name, pn); assert.deepEqual(p.app, look);
    redo(); assert.equal(p.name, 'Renamed Person');
    const tops = journal.tops(1), r = edit([{ op: 'person.add', name: 'Newbie' }]);
    assert.ok(r.edit, 'adding a resident is logged');
    assert.deepEqual(journal.tops(1), tops, 'but not in the undo history');
    assert.match(journal.list({ limit: 1 })[0].text, /^Added a new resident/);
    assert.equal(journal.list({ limit: 1 })[0].undoable, false);
  } finally { t.cleanup(); }
});

test('each account undoes only its own edits; a later change by someone else refuses the undo and names it, until it is undone', () => {
  const t = setup();
  try {
    const { world, editor, journal, ada, ben } = t;
    const S = standing(world, () => true)[0], n0 = S.name;
    ok(editor.apply([{ op: 'bld.set', b: S.idx, name: 'Ada Shop' }], ada));
    assert.equal(journal.undo(ben.P).code, 'nothing_to_undo', 'Ben has nothing of his own to undo');
    ok(editor.apply([{ op: 'bld.set', b: S.idx, name: 'Ben Shop' }], ben));
    let r = journal.undo(ada.P);
    assert.equal(r.code, 'undo_refused');
    assert.match(r.error, /Ben changed it later \(renamed Ada Shop to Ben Shop\)/);
    assert.equal(r.by.name, 'Ben');
    assert.equal(S.name, 'Ben Shop', 'nothing changed');
    assert.equal(journal.undo(ada.P).code, 'undo_refused', 'the refused undo stays at the top of her history');
    ok(journal.undo(ben.P));
    assert.equal(S.name, 'Ada Shop');
    ok(journal.undo(ada.P));
    assert.equal(S.name, n0);
    // a redo after someone else's change is refused the same way
    ok(editor.apply([{ op: 'bld.set', b: S.idx, name: 'Ben Again' }], ben));
    r = journal.redo(ada.P);
    assert.equal(r.code, 'redo_refused');
    assert.match(r.error, /Ben changed it later/);
    // the account's own undo of its undone step is named as such for the other
    ok(journal.undo(ben.P));
    ok(journal.redo(ada.P));
    assert.equal(S.name, 'Ada Shop');
  } finally { t.cleanup(); }
});

test('an admin reverts any edit, undoes the revert like their own edit, and a revert of something changed since is refused', () => {
  const t = setup();
  try {
    const { world, editor, journal, ada, ben, cy } = t;
    const S = standing(world, () => true)[1], n0 = S.name;
    ok(editor.apply([{ op: 'bld.set', b: S.idx, name: 'Ada Shop' }], ada));
    const X = journal.list({ limit: 1 })[0].n;
    ok(journal.revert(cy.P, X));
    assert.equal(S.name, n0);
    assert.equal(journal.get(X).status, 'reverted');
    assert.equal(journal.itemById(X).revertedBy, 'Cy');
    assert.equal(journal.tops(3).undo.summary, `Reverted Ada’s change: renamed ${n0} to Ada Shop`);
    assert.equal(journal.undo(ada.P).code, 'nothing_to_undo', 'a reverted edit leaves its author\'s undo history');
    assert.equal(journal.revert(cy.P, X).code, 'not_in_effect', 'it cannot be reverted twice');
    ok(journal.undo(cy.P));
    assert.equal(S.name, 'Ada Shop', 'undoing the revert puts the change back');
    assert.equal(journal.get(X).status, 'done');
    ok(journal.redo(cy.P));
    assert.equal(S.name, n0, 'and redo reverts it again');
    ok(journal.undo(cy.P));
    ok(editor.apply([{ op: 'bld.set', b: S.idx, name: 'Ben Shop' }], ben));
    const r = journal.revert(cy.P, X);
    assert.equal(r.code, 'revert_refused');
    assert.match(r.error, /Ben changed it later/);
    assert.equal(journal.revert(cy.P, 999999).code, 'not_found');
  } finally { t.cleanup(); }
});

test('restores re-check placement, and a building removed by an undo or redo must be unchanged inside', () => {
  const t = setup();
  try {
    const { world, editor, journal, ada, ben } = t;
    const [O, D, D2] = standing(world, b => b.type === 'office' && b.floors >= 2);
    // furniture placed since blocks bringing back a removed piece
    const p1 = place(t, ada, O, 1, 'plant');
    assert.ok(p1, 'a free spot for the plant');
    ok(editor.apply([{ op: 'item.del', b: O.idx, f: 1, id: p1.id }], ada));
    assert.ok(place(t, ben, O, 1, 'plant', { at: { x: p1.x, z: p1.z } }), 'Ben puts a plant on the same spot');
    let r = journal.undo(ada.P);
    assert.equal(r.code, 'undo_refused');
    assert.match(r.error, /overlaps the plant, placed there since/);
    ok(journal.undo(ben.P));
    ok(journal.undo(ada.P));
    assert.ok(world.levels[O.lv[1]].items.some(i => i.id === p1.id), 'once the spot is free it comes back');
    // a building placed on the lot blocks bringing back the demolished one
    ok(editor.apply([{ op: 'bld.del', b: D.idx }], ada));
    const cands = [[D.w, D.d], [12, 12], [10, 10]].map(([w, d]) => normalizeSpec({ type: 'office', x: D.x, z: D.z, w, d, rot: D.rot, floors: 1 }));
    const spec = cands.find(s => !checkBuilding(world, s));
    assert.ok(spec, 'a building fits the demolished one\'s lot');
    ok(editor.apply([{ op: 'bld.add', spec }], ben));
    r = journal.undo(ada.P);
    assert.equal(r.code, 'undo_refused');
    assert.match(r.error, new RegExp(`${D.name} cannot come back: too close to`));
    ok(journal.undo(ben.P));
    ok(journal.undo(ada.P));
    assert.ok(!D.gone);
    // undoing a new building that someone changed since is refused
    const lot = freeLot(world);
    const nb = ok(editor.apply([{ op: 'bld.add', spec: { ...lot, name: 'Ada Café' } }], ada)).results[0].b;
    ok(editor.apply([{ op: 'bld.set', b: nb, name: 'Ben Named It' }], ben));
    r = journal.undo(ada.P);
    assert.equal(r.code, 'undo_refused');
    assert.match(r.error, /Ben changed it later \(renamed Ada Café to Ben Named It\)/);
    ok(journal.undo(ben.P));
    ok(journal.undo(ada.P));
    assert.equal(world.buildings[nb].gone, 1);
    // redoing a demolition of a building someone changed since is refused
    ok(editor.apply([{ op: 'bld.del', b: D2.idx }], ada));
    ok(journal.undo(ada.P));
    ok(editor.apply([{ op: 'bld.set', b: D2.idx, name: 'Saved By Ben' }], ben));
    r = journal.redo(ada.P);
    assert.equal(r.code, 'redo_refused');
    assert.match(r.error, /Ben changed it later/);
    assert.ok(!D2.gone);
  } finally { t.cleanup(); }
});

test('the history keeps its depth, a deleted account keeps only its name, and retention purges old edits', () => {
  const t = setup({ depth: 5 });
  try {
    const { world, editor, journal, ada } = t;
    const S = standing(world, () => true)[2];
    for (let k = 1; k <= 7; k++) ok(editor.apply([{ op: 'bld.set', b: S.idx, name: `Step ${k}` }], ada));
    assert.equal(journal.tops(1).undoCount, 5);
    for (let k = 0; k < 5; k++) ok(journal.undo(ada.P));
    assert.equal(S.name, 'Step 2');
    assert.equal(journal.undo(ada.P).code, 'undo_too_old', 'only the last 5 changes can be undone');
    assert.deepEqual([journal.tops(1).undoCount, journal.tops(1).redoCount], [0, 5]);
    ok(journal.redo(ada.P));
    assert.equal(S.name, 'Step 3');
    ok(editor.apply([{ op: 'bld.set', b: S.idx, name: 'Fresh' }], ada));
    assert.equal(journal.tops(1).redoCount, 0, 'a new edit drops the redo steps');
    journal.forgetAccount(1);
    assert.deepEqual(journal.tops(1), { undo: null, redo: null, undoCount: 0, redoCount: 0 }, 'a new account with that id inherits nothing');
    assert.equal(journal.list({ limit: 1 })[0].actor.name, 'Ada', 'the entries keep the name');
    assert.equal(journal.list({ limit: 1 })[0].actor.id, undefined, 'account ids stay on the server');
    t.jump(31 * 86400000);
    assert.equal(journal.purge(30), 8);
    assert.equal(journal.list().length, 0);
    assert.equal(journal.db.prepare('SELECT COUNT(*) AS n FROM edit_keys').get().n, 0, 'their keys go too');
  } finally { t.cleanup(); }
});

test('the activity log: live lines and edits newest first; task text only for readers allowed to see it', () => {
  let T = 1000;
  const journal = { listeners: new Set(), list: () => [{ id: 'e1', n: 1, kind: 'edit', at: 1500, actor: { name: 'Ada' }, text: 'Renamed X to Y' }] };
  const perms = { allowed: (P, cap) => cap !== 'agents.view_tasks' || P.role === 'owner' };
  const a = new Activity({ journal, perms, now: () => (T += 1000), keep: 3 });
  a.add({ kind: 'agent', text: 'Ada started working', task: 'a private task' });
  const member = a.list({ role: 'member' }), owner = a.list({ role: 'owner' });
  assert.deepEqual(member.items.map(i => i.text), ['Ada started working', 'Renamed X to Y']);
  assert.equal('task' in member.items[0], false, 'members do not see the task');
  assert.equal(owner.items[0].task, 'a private task');
  for (let k = 0; k < 5; k++) a.add({ kind: 'player', text: `P${k} joined` });
  assert.equal(a.ring.length, 3, 'the latest lines stay in memory');
  for (const fn of journal.listeners) fn({ live: { kind: 'undo', text: 'Undid “x”', actor: { name: 'Ada' } } });
  assert.equal(a.ring.at(-1).kind, 'undo', 'undo and redo lines come from the journal');
  assert.equal(new Set(a.ring.map(x => x.id)).size, 3, 'live ids are unique');
});

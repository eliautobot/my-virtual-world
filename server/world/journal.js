// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The edit journal (PLAN WP1.8, DECISIONS C35, C116): every accepted world edit with its account and, for each piece of
// the world it changed (the state keys of server/world/edit.js), the state before and after — kept in next.db.
// - Each account undoes and redoes its own edits. Its history holds 100 steps (undo and redo together, as in any
//   editor); a new edit drops the redo steps.
// - An undo, redo or revert whose target someone changed later is refused, naming who did what; a refused undo stays
//   at the top of the account's history until the later change is undone or reverted.
// - Admins (world.revert) revert any edit from the activity log; a revert is the admin's own edit, so Ctrl+Z undoes it.
// - Restores check placement again and never bring newcomers; adding a resident is logged but cannot be undone.
// - Kept until the owner sets a limit (activity.retentionDays). A deleted account's entries keep its display name only.
// The world lives in next.db too (WP4.1, server/world/world-db.js): an edit, an undo, a redo or a revert and its journal
// rows commit in one transaction. (Should a write ever fail, undoing that edit is refused as changed — never applied twice.)
import { changedFloors } from './edit.js';

export const UNDO_DEPTH = 100;
const lowerFirst = s => (s ? s[0].toLowerCase() + s.slice(1) : s);
const parseJSON = (s, d = null) => { if (s === null || s === undefined) return d; try { return JSON.parse(s); } catch { return d; } };

export class Journal {
  constructor(dbs, { editor = null, now = () => Date.now(), depth = UNDO_DEPTH } = {}) {
    this.allow = null;   // (P, keys, target states) => reason | null: lot rights for undo/redo (WP4.6), set by the server
    this.dbs = dbs; this.db = dbs.db; this.w = dbs.worldId; this.editor = editor; this.now = now; this.depth = depth;
    this.listeners = new Set();          // ({ item } | { update } | { live }) for the activity log
    this.historyListeners = new Set();   // (accountId): that account's undo and redo changed
    this.onError = null;
    const db = this.db;
    const cols = `e.id, e.at, e.actor_name, e.kind, e.summary, e.place_json, e.status, e.undoable, e.undone_at, e.ref,
      r.actor_name AS reverted_by_name`;
    this.q = {
      insert: db.prepare(`INSERT INTO edits (world_id, at, acted_at, actor_id, actor_name, kind, summary, place_json, keys_json, before_json,
        after_json, watch_json, undoable, ref)
        VALUES ($w, $at, $acted, $actor_id, $actor_name, $kind, $summary, $place, $keys, $before, $after, $watch, $undoable, $ref)`),
      key: db.prepare('INSERT INTO edit_keys (edit_id, world_id, key) VALUES (?, ?, ?)'),
      byId: db.prepare('SELECT * FROM edits WHERE world_id = ? AND id = ?'),
      item: db.prepare(`SELECT ${cols} FROM edits e LEFT JOIN edits r ON r.id = e.reverted_by WHERE e.world_id = ? AND e.id = ?`),
      topUndo: db.prepare("SELECT * FROM edits WHERE world_id = ? AND actor_id = ? AND status = 'done' AND undoable = 1 ORDER BY id DESC LIMIT 1"),
      // The step undone last comes back first (two undos in one millisecond: the older edit was undone last).
      topRedo: db.prepare("SELECT * FROM edits WHERE world_id = ? AND actor_id = ? AND status = 'undone' AND redo_ok = 1 ORDER BY undone_at DESC, id ASC LIMIT 1"),
      // Bounded counts: an account's history may grow long, the buttons only need up to the depth.
      undoN: db.prepare("SELECT COUNT(*) AS n FROM (SELECT 1 FROM edits WHERE world_id = ? AND actor_id = ? AND status = 'done' AND undoable = 1 LIMIT ?)"),
      redoN: db.prepare("SELECT COUNT(*) AS n FROM (SELECT 1 FROM edits WHERE world_id = ? AND actor_id = ? AND status = 'undone' AND redo_ok = 1 LIMIT ?)"),
      setUndone: db.prepare("UPDATE edits SET status = 'undone', undone_at = $t, acted_at = $t, redo_ok = 1 WHERE world_id = $w AND id = $id"),
      setRedone: db.prepare("UPDATE edits SET status = 'done', undone_at = NULL, acted_at = $t, redo_ok = 0 WHERE world_id = $w AND id = $id"),
      setReverted: db.prepare("UPDATE edits SET status = 'reverted', reverted_by = ? WHERE world_id = ? AND id = ?"),
      unrevert: db.prepare("UPDATE edits SET status = 'done', reverted_by = NULL WHERE world_id = ? AND id = ? AND status = 'reverted'"),
      clearRedo: db.prepare("UPDATE edits SET redo_ok = 0 WHERE world_id = ? AND actor_id = ? AND status = 'undone' AND redo_ok = 1"),
      forget: db.prepare('UPDATE edits SET actor_id = NULL WHERE world_id = ? AND actor_id = ?'),
      purgeKeys: db.prepare('DELETE FROM edit_keys WHERE world_id = ? AND edit_id IN (SELECT id FROM edits WHERE world_id = ? AND at < ?)'),
      purge: db.prepare('DELETE FROM edits WHERE world_id = ? AND at < ?'),
      list: db.prepare(`SELECT ${cols} FROM edits e LEFT JOIN edits r ON r.id = e.reverted_by
        WHERE e.world_id = ? AND e.at < ? ORDER BY e.at DESC, e.id DESC LIMIT ?`),
      byAccount: db.prepare('SELECT id, at, kind, summary, status FROM edits WHERE world_id = ? AND actor_id = ? ORDER BY id DESC LIMIT 5000'),
    };
  }
  // ---------------------------------------------------------------- rows
  parse(r) {
    if (!r) return null;
    return { ...r, keys: parseJSON(r.keys_json, []), before: parseJSON(r.before_json, {}), after: parseJSON(r.after_json, {}),
      watch: parseJSON(r.watch_json, {}) || {}, place: parseJSON(r.place_json) };
  }
  get(id) { return this.parse(this.q.byId.get(this.w, id)); }
  /** An activity-log line for a journal row. Account ids stay on the server; readers see the display name. */
  item(r) {
    if (!r) return null;
    return { id: `e${r.id}`, n: r.id, kind: r.kind, at: r.at, actor: { name: r.actor_name }, text: r.summary, place: parseJSON(r.place_json),
      status: r.status, undoable: !!r.undoable, undoneAt: r.undone_at || null, revertedBy: r.reverted_by_name || null };
  }
  itemById(id) { return this.item(this.q.item.get(this.w, id)); }
  emit(m) { for (const fn of this.listeners) { try { fn(m); } catch { /* a listener's problem stays there */ } } }
  history(accountId) {
    if (!Number.isInteger(accountId)) return;
    for (const fn of this.historyListeners) { try { fn(accountId); } catch { /* ignore */ } }
  }
  /** Records a finished edit (server/world/edit.js entryOf, or a revert). actor: { id, name } (id null for tools). */
  record(entry, actor = null) {
    const keys = entry.keys || [], at = this.now();
    const row = {
      w: this.w, at, acted: at, actor_id: Number.isInteger(actor?.id) ? actor.id : null, actor_name: String(actor?.name || 'The server').slice(0, 64),
      kind: entry.kind || 'edit', summary: String(entry.summary || 'Changed the world').slice(0, 300),
      place: entry.place ? JSON.stringify(entry.place) : null, keys: JSON.stringify(keys),
      before: JSON.stringify(entry.before || {}), after: JSON.stringify(entry.after || {}),
      watch: entry.watch && Object.keys(entry.watch).length ? JSON.stringify(entry.watch) : null,
      undoable: keys.length && entry.undoable !== false ? 1 : 0, ref: entry.ref ?? null,
    };
    let id;
    this.dbs.tx(() => {
      id = Number(this.q.insert.run(row).lastInsertRowid);
      for (const k of keys) this.q.key.run(id, this.w, k);
      if (row.actor_id !== null && row.undoable) this.q.clearRedo.run(this.w, row.actor_id);   // a new edit drops the redo steps
    });
    this.emit({ item: this.itemById(id) });
    this.history(row.actor_id);
    return this.get(id);
  }
  // ---------------------------------------------------------------- the account's own history
  /** The account's next undo and redo, and how many of each are left (what the top-bar buttons show). */
  tops(accountId) {
    if (!Number.isInteger(accountId)) return { undo: null, redo: null, undoCount: 0, redoCount: 0 };
    const redoCount = Number(this.q.redoN.get(this.w, accountId, this.depth)?.n) || 0;
    const undoCount = Math.max(0, Math.min(Number(this.q.undoN.get(this.w, accountId, this.depth)?.n) || 0, this.depth - redoCount));
    const pub = r => (r ? { id: r.id, summary: r.summary, at: r.at } : null);
    return { undo: undoCount ? pub(this.q.topUndo.get(this.w, accountId)) : null, redo: redoCount ? pub(this.q.topRedo.get(this.w, accountId)) : null,
      undoCount, redoCount };
  }
  refuse(error, code, accountId, by = null) { return { ok: false, error, code, by, history: this.tops(accountId) }; }
  undo(P) {
    const me = P.account.id, e = this.parse(this.q.topUndo.get(this.w, me));
    if (!e) return this.refuse('Nothing to undo', 'nothing_to_undo', me);
    if (this.tops(me).redoCount >= this.depth) {
      return this.refuse(`Only your last ${this.depth} changes can be undone; an admin can still revert older ones from the activity log`, 'undo_too_old', me);
    }
    const c = this.conflict(e, 'undo');
    if (c) return this.refuse(`Cannot undo “${e.summary}”: ${c.text}`, 'undo_refused', me, c.by);
    const denied = this.allow ? this.allow(P, e.keys, e.before) : null;   // lot rights still hold (WP4.6)
    if (denied) return this.refuse(`Cannot undo “${e.summary}”: ${denied}`, 'forbidden', me);
    const touched = [e.id];
    let why = null;
    this.dbs.tx(() => {   // the world put back and the journal in one commit
      why = this.restore(e, 'undo', P);
      if (why) return;
      this.q.setUndone.run({ w: this.w, id: e.id, t: this.now() });
      this.cascade(e, false, touched);
    });
    if (why) return this.refuse(`Cannot undo “${e.summary}”: ${why}`, 'undo_refused', me);
    this.changed(touched, { kind: 'undo', text: `Undid “${e.summary}”`, place: e.place }, P);
    return { ok: true, undone: { id: e.id, summary: e.summary, place: e.place }, history: this.tops(me) };
  }
  redo(P) {
    const me = P.account.id, e = this.parse(this.q.topRedo.get(this.w, me));
    if (!e) return this.refuse('Nothing to redo', 'nothing_to_redo', me);
    const c = this.conflict(e, 'redo');
    if (c) return this.refuse(`Cannot redo “${e.summary}”: ${c.text}`, 'redo_refused', me, c.by);
    const denied = this.allow ? this.allow(P, e.keys, e.after) : null;   // lot rights still hold (WP4.6)
    if (denied) return this.refuse(`Cannot redo “${e.summary}”: ${denied}`, 'forbidden', me);
    const touched = [e.id];
    let why = null;
    this.dbs.tx(() => {
      why = this.restore(e, 'redo', P);
      if (why) return;
      this.q.setRedone.run({ w: this.w, id: e.id, t: this.now() });
      this.cascade(e, true, touched);
    });
    if (why) return this.refuse(`Cannot redo “${e.summary}”: ${why}`, 'redo_refused', me);
    this.changed(touched, { kind: 'redo', text: `Redid “${e.summary}”`, place: e.place }, P);
    return { ok: true, redone: { id: e.id, summary: e.summary, place: e.place }, history: this.tops(me) };
  }
  // ---------------------------------------------------------------- reverting any edit (admins)
  /** Why reverting an edit would remove a building or floors (it then needs a recent password, C65), or null. */
  revertRemoves(id) {
    const e = this.get(id);
    if (!e || e.status !== 'done' || !e.undoable) return null;
    for (const k of e.keys) {
      const cur = this.editor.stateOf(k), want = e.before[k];
      if (k.startsWith('bx:') && want === 0 && cur === 1) return 'Removing a building';
      if (k.startsWith('bf:') && cur && want) {
        if (want.floors < cur.floors) return 'Removing floors';
        if ((want.floors === 1) !== (cur.floors === 1)) return 'Rebuilding every floor';
      }
    }
    return null;
  }
  revert(P, id) {
    const me = P.account.id, name = P.account.displayName, e = this.get(id);
    if (!e) return this.refuse('No such change', 'not_found', me);
    if (!e.undoable) return this.refuse('This change cannot be undone', 'not_undoable', me);
    if (e.status !== 'done') return this.refuse(e.status === 'undone' ? 'This change was undone already' : 'This change was reverted already', 'not_in_effect', me);
    const c = this.conflict(e, 'undo');
    if (c) return this.refuse(`Cannot revert “${e.summary}”: ${c.text}`, 'revert_refused', me, c.by);
    const fpBefore = {};
    for (const k of e.keys) {
      const b = k.slice(3);
      if (k.startsWith('bx:') && e.before[k] === 0 && this.editor.standing(+b)) fpBefore[b] = this.editor.fingerprint(+b);
    }
    const touched = [e.id];
    let why = null, R = null;
    this.dbs.tx(() => {
      why = this.restore(e, 'undo', P);
      if (why) return;
      // The revert's own undo and redo need the same guard for the buildings they would remove.
      const watch = {};
      for (const k of e.keys) {
        if (!k.startsWith('bx:')) continue;
        const b = k.slice(3);
        if (e.before[k] === 1) (watch.undo ||= {})[b] = this.editor.fingerprint(+b);   // the revert brought it back
        else if (fpBefore[b]) (watch.redo ||= {})[b] = fpBefore[b];                    // the revert removed it
      }
      const whose = e.actor_id === me ? 'their own' : `${e.actor_name}’s`;
      R = this.record({ kind: 'revert', keys: e.keys, before: e.after, after: e.before, watch, place: e.place, ref: e.id,
        summary: `Reverted ${whose} change: ${lowerFirst(e.summary)}` }, { id: me, name });
      this.cascade(R, true, touched);
    });
    if (why) return this.refuse(`Cannot revert “${e.summary}”: ${why}`, 'revert_refused', me);
    this.changed(touched, null, P);
    return { ok: true, reverted: { id: e.id, summary: e.summary }, revert: R.id, history: this.tops(me) };
  }
  /** A revert x came into effect (on) or went out of it: the edit it reverts goes the other way, and so on down. */
  cascade(x, on, touched) {
    if (x.kind !== 'revert' || !x.ref) return;
    const y = this.get(x.ref);
    if (!y) return;
    if (on) { this.q.setReverted.run(x.id, this.w, y.id); touched.push(y.id); this.cascade(y, false, touched); }
    else if (y.status === 'reverted') { this.q.unrevert.run(this.w, y.id); touched.push(y.id); this.cascade(y, true, touched); }
  }
  /** After an undo, redo or revert: the changed log lines, a live line for undo and redo, and every affected history. */
  changed(ids, live, P) {
    const accounts = new Set([P.account.id]);
    for (const id of new Set(ids)) {
      const row = this.q.byId.get(this.w, id);
      if (!row) continue;
      this.emit({ update: this.itemById(id) });
      if (Number.isInteger(row.actor_id)) accounts.add(row.actor_id);
    }
    if (live) this.emit({ live: { ...live, actor: { name: P.account.displayName } } });
    for (const a of accounts) this.history(a);
  }
  // ---------------------------------------------------------------- the checks
  /** Writes an entry's states back (dir 'undo': the states before; 'redo': after); null, or why it cannot. */
  restore(e, dir, P) {
    const floors = {};
    for (const k of e.keys) if (k.startsWith('bf:')) floors[k.slice(3)] = changedFloors(e.before[k], e.after[k]);
    try {
      const r = this.editor.restore(dir === 'undo' ? e.before : e.after, { floors }, P.account.displayName);
      return r.ok ? null : r.error;
    } catch (err) {
      this.onError?.(err);
      return 'the world could not be put back (the server logged why)';
    }
  }
  /** Whether writing an entry's states back would overwrite a later change: null, or { text, by } naming it. */
  conflict(e, dir) {
    const ed = this.editor, left = dir === 'undo' ? e.after : e.before, target = dir === 'undo' ? e.before : e.after;
    const comesBack = new Set(e.keys.filter(k => k.startsWith('bx:') && target[k] === 1).map(k => +k.slice(3)));
    const levelsBack = new Set(e.keys.filter(k => k.startsWith('bf:')).flatMap(k => target[k]?.lv || []));   // floors the same step brings back
    for (const k of e.keys) {
      const [t, a] = k.split(':');
      if ((t === 'bp' || t === 'bf' || t === 'bg') && !ed.standing(+a) && !comesBack.has(+a)) return this.blame(e, [`bx:${a}`], 'the building is gone');
      if (t === 'i' && !ed.levelInUse(+a) && !levelsBack.has(+a)) {
        const b = ed.levelOwner(+a);
        if (!comesBack.has(b)) return this.blame(e, [`bx:${b}`, `bf:${b}`], 'that floor is gone');
      }
      const changed = t === 'bf' ? changedFloors(e.before[k], e.after[k]) : null;
      if (!ed.same(k, left[k], changed)) return this.blame(e, t === 'bf' ? [k, ...ed.levelsOf(+a).map(l => `i:${l}:`)] : [k], 'it changed since');
    }
    const watch = (dir === 'undo' ? e.watch.undo : e.watch.redo) || {};
    for (const [b, fp] of Object.entries(watch)) {
      if (ed.standing(+b) && ed.fingerprint(+b) !== fp) {
        return this.blame(e, [`bp:${b}`, `bf:${b}`, ...ed.levelsOf(+b).map(l => `i:${l}:`)], 'something inside it changed since');
      }
    }
    return null;
  }
  /** The latest action on any of keys since the entry's own last action (a key ending in ':' is a prefix): an edit, an
   *  undo or a redo, with who did it. */
  blame(e, keys, fallback) {
    const exact = keys.filter(k => !k.endsWith(':')), prefixes = keys.filter(k => k.endsWith(':'));
    const conds = [], args = [];
    if (exact.length) { conds.push(`k.key IN (${exact.map(() => '?').join(',')})`); args.push(...exact); }
    for (const p of prefixes) { conds.push('k.key GLOB ?'); args.push(p.replace(/[^a-z0-9:]/g, '') + '*'); }   // GLOB is case-sensitive, so it uses the index
    const r = conds.length ? this.db.prepare(`SELECT e.actor_name, e.summary, e.at, e.acted_at, e.status FROM edits e JOIN edit_keys k ON k.edit_id = e.id
      WHERE k.world_id = ? AND e.id <> ? AND e.acted_at >= ? AND (${conds.join(' OR ')}) ORDER BY e.acted_at DESC, e.id DESC LIMIT 1`)
      .get(this.w, e.id, e.acted_at, ...args) : null;
    if (!r) return { text: fallback, by: null };
    const verb = r.status === 'undone' ? 'undid a change to it' : r.acted_at > r.at ? 'redid a change to it' : 'changed it';
    return { text: `${r.actor_name} ${verb} later (${lowerFirst(r.summary)})`, by: { name: r.actor_name, summary: r.summary, verb, at: r.acted_at } };
  }
  // ---------------------------------------------------------------- the log, accounts, retention
  /** World edits for the activity log, newest first, before a time (ms). */
  list({ before = Number.MAX_SAFE_INTEGER, limit = 50 } = {}) {
    return this.q.list.all(this.w, before, Math.max(1, Math.min(500, limit | 0 || 50))).map(r => this.item(r));
  }
  /** A deleted account's entries keep its display name but lose the link (a new account may get the same id). */
  forgetAccount(id) { if (Number.isInteger(id)) this.q.forget.run(this.w, id); }
  /** The account's own edits, for its data export. */
  byAccount(id) { return this.q.byAccount.all(this.w, id).map(r => ({ ...r, at: new Date(r.at).toISOString() })); }
  /** Deletes world edits older than retentionDays (activity.retentionDays). Returns how many. */
  purge(retentionDays) {
    if (!(retentionDays > 0)) return 0;
    const before = this.now() - retentionDays * 86400000;
    let n = 0;
    this.dbs.tx(() => { this.q.purgeKeys.run(this.w, this.w, before); n = Number(this.q.purge.run(this.w, before).changes); });
    return n;
  }
}

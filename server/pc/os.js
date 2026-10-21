// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The agents' PC (docs/features/agent-pc.md): one engine that decides everything - who may reach what, the tree of files
// and folders, versions, the trash, the storage pool, teams, boards, calendars, search and the activity feed. The
// command line (./shell.js), the HTTP routes (./routes.js) and the work sessions are thin doors onto it.
//
// Who asks (`who`):
//   { human: accountId }    a person through the PC window - reaches every space of their own account, nothing else
//   { agent: agentId }      an agent at work - its own home, and the teams it belongs to (a viewer reads only)
//   { visitor: agentId }    an agent talking with someone from another account - its home's Public folder, to read
// Nothing here reveals another account's PC: a space this caller may not reach is "not found", like one that isn't there.
//
// Paths are names inside the PC's own tree, never places on disk. An agent's view: ~ (its home), /teams/<team>, and /
// listing both; '..' stops at the top. A person's view is the same as seen by one agent of theirs (opts.profile), or a
// team's space directly. Every write is synchronous from start to end, so the content store and the rows it points at
// can never be swept apart in between.
import { openPcDb } from './db.js';
import { BlobStore } from './blobs.js';
import { extractBuffer } from '../chat/extract.js';
import { capView } from './views.js';

export class PcError extends Error {
  constructor(status, code, message, extra = {}) { super(message); this.status = status; this.code = code; Object.assign(this, extra); }
}

const MB = 1048576;
export const DEFAULT_LIMITS = Object.freeze({ agentMB: 200, teamMB: 500, fileMB: 25, versions: 20, keepDays: 30, activityDays: 7, browseKeep: 500 });
export const HOME_DIRS = Object.freeze(['Documents', 'Downloads', 'Skills', 'Public']);
export const COLUMNS = Object.freeze(['todo', 'doing', 'review', 'done']);
const TERM_LINES = 18;   // an agent's terminal: its last lines on its screen
// a window it works in (a page, a file, its board…) stays up this long against what only sets the scene: a step of the
// terminal's no app claims (a quick command), its run writing between steps - those go to its terminal meanwhile
export const HOLD_MS = 30000;
export const COLUMN_NAMES = Object.freeze({ todo: 'To do', doing: 'Doing', review: 'Review', done: 'Done' });
export const ROLES = Object.freeze(['lead', 'member', 'viewer']);
const NAME_MAX = 120, DEPTH_MAX = 24, FOLDER_MAX = 5000, TITLE_MAX = 200, NOTES_MAX = 8000, PLACE_MAX = 120;
const TEAM_NAME_MAX = 40, BRIEF_MAX = 4000, INDEX_MAX = 1 * MB, ACTIVITY_MAX = 300;
const CTRL = /[\u0000-\u001f\u007f]/g;

const MIME = {
  md: 'text/markdown', markdown: 'text/markdown', txt: 'text/plain', log: 'text/plain', csv: 'text/csv', tsv: 'text/tab-separated-values',
  json: 'application/json', xml: 'application/xml', yaml: 'text/yaml', yml: 'text/yaml', toml: 'text/plain', ini: 'text/plain',
  html: 'text/html', htm: 'text/html', css: 'text/css', js: 'text/javascript', mjs: 'text/javascript', ts: 'text/plain', py: 'text/x-python',
  sh: 'text/x-shellscript', sql: 'text/plain', svg: 'image/svg+xml',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif',
  pdf: 'application/pdf', zip: 'application/zip', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text', ods: 'application/vnd.oasis.opendocument.spreadsheet', odp: 'application/vnd.oasis.opendocument.presentation',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
};
const extOf = name => (/\.([A-Za-z0-9]{1,8})$/.exec(name || '') || [])[1]?.toLowerCase() || '';
export const mimeOf = name => MIME[extOf(name)] || 'application/octet-stream';
/** Whether a file is text an agent reads as it is. */
export const isText = (mime, name = '') => /^text\//.test(mime || '') || /^application\/(json|xml|javascript)/.test(mime || '') || mime === 'image/svg+xml'
  || (mime === 'application/octet-stream' && ['', 'txt', 'md'].includes(extOf(name)));
/** Office documents whose words can be read out (server/chat/extract.js). */
const isDoc = name => ['docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp'].includes(extOf(name));

const clean = (s, n) => String(s ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').slice(0, n);
const line = (s, n) => String(s ?? '').replace(CTRL, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const keyOf = name => name.normalize('NFC').toLowerCase();
export const slugOf = s => line(s, 60).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

/** A file or folder name as typed, made safe; throws with the reason when it can't be one. */
export function checkName(raw) {
  const name = String(raw ?? '').normalize('NFC').replace(CTRL, '').trim();
  if (!name) throw new PcError(400, 'bad_name', 'The name is empty');
  if (name === '.' || name === '..') throw new PcError(400, 'bad_name', `"${name}" can't be a name`);
  if (/[/\\]/.test(name)) throw new PcError(400, 'bad_name', 'A name can\'t have / or \\ in it');
  if (name.length > NAME_MAX) throw new PcError(400, 'bad_name', `A name is at most ${NAME_MAX} characters`);
  return name;
}

/** The parts of a path: "a/./b/../c" → ['a', 'c']; '..' stops at the top (a path never leaves the space it is in). */
export function splitPath(p) {
  const out = [];
  for (const raw of String(p ?? '').split('/')) {
    const s = raw.replace(CTRL, '').trim();
    if (!s || s === '.') continue;
    if (s === '..') { out.pop(); continue; }
    out.push(s.normalize('NFC'));
  }
  return out;
}

export class PcOS {
  /**
   * dir: <data>/pc. agents: server/agents.js (get, list). ownerAccount(): the installation owner's account id (an agent
   * without an owner belongs to them). limits(): the installation's PC settings (DEFAULT_LIMITS' keys). emit(accountId,
   * frame): a live update for that account only. names(tag): a display name for 'a:<agent>' / 'h:<account>'.
   */
  constructor({ dir, worldId = null, agents, ownerAccount = () => null, limits = () => ({}), emit = () => {}, now = () => Date.now(), log = null }) {
    this.pc = openPcDb(dir, { worldId });
    this.db = this.pc.db;
    this.blobs = new BlobStore(this.pc, `${dir}/blobs`);
    this.agents = agents; this.ownerAccount = ownerAccount; this.limitsFn = limits; this.emitFn = emit; this.now = now; this.log = log;
    this.screens = new Map();   // agentId → { app, title, detail, view, at }: what its screen shows now (never stored)
    this.terms = new Map();     // agentId → its terminal's last lines (what its screen shows when no window is open)
    this.onCard = null;         // ({ card, by, assignee, wasAssignee, created }) => void: the work sessions (./work.js)
    const db = this.db;
    this.q = {
      space: db.prepare('SELECT * FROM spaces WHERE kind = ? AND ref = ?'),
      spaceById: db.prepare('SELECT * FROM spaces WHERE id = ?'),
      addSpace: db.prepare('INSERT INTO spaces (account_id, kind, ref, used, created) VALUES (?, ?, ?, 0, ?)'),
      setSpaceAccount: db.prepare('UPDATE spaces SET account_id = ? WHERE id = ?'),
      spaceGone: db.prepare('UPDATE spaces SET gone = ? WHERE id = ?'),
      used: db.prepare('UPDATE spaces SET used = used + ? WHERE id = ?'),
      accountUsed: db.prepare('SELECT COALESCE(SUM(used), 0) AS u FROM spaces WHERE account_id = ? AND gone IS NULL'),
      accountSpaces: db.prepare('SELECT * FROM spaces WHERE account_id = ? AND gone IS NULL'),
      allSpaces: db.prepare('SELECT * FROM spaces'),
      child: db.prepare('SELECT * FROM nodes WHERE space_id = ? AND parent = ? AND name_key = ? AND trashed IS NULL'),
      node: db.prepare('SELECT * FROM nodes WHERE id = ?'),
      children: db.prepare('SELECT * FROM nodes WHERE space_id = ? AND parent = ? AND trashed IS NULL ORDER BY dir DESC, name_key LIMIT ? OFFSET ?'),
      countChildren: db.prepare('SELECT COUNT(*) AS n FROM nodes WHERE space_id = ? AND parent = ? AND trashed IS NULL'),
      addNode: db.prepare(`INSERT INTO nodes (space_id, parent, name, name_key, dir, system, blob, size, mime, version, created, modified, by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
      setContent: db.prepare('UPDATE nodes SET blob = ?, size = ?, mime = ?, version = version + 1, modified = ?, by = ? WHERE id = ?'),
      rename: db.prepare('UPDATE nodes SET parent = ?, name = ?, name_key = ?, modified = ?, by = ? WHERE id = ?'),
      setSpace: db.prepare('UPDATE nodes SET space_id = ? WHERE id = ?'),
      trash: db.prepare('UPDATE nodes SET trashed = ?, trash_path = ? WHERE id = ?'),
      untrash: db.prepare('UPDATE nodes SET trashed = NULL, trash_path = NULL, parent = ?, name = ?, name_key = ? WHERE id = ?'),
      trashed: db.prepare('SELECT * FROM nodes WHERE space_id = ? AND trashed IS NOT NULL ORDER BY trashed DESC LIMIT 200'),
      oldTrash: db.prepare('SELECT * FROM nodes WHERE trashed IS NOT NULL AND trashed < ? LIMIT 200'),
      delNode: db.prepare('DELETE FROM nodes WHERE id = ?'),
      subtree: db.prepare(`WITH RECURSIVE d(id) AS (SELECT ? UNION ALL SELECT n.id FROM nodes n JOIN d ON n.parent = d.id WHERE n.space_id = ?)
        SELECT nodes.* FROM nodes JOIN d ON nodes.id = d.id`),
      versions: db.prepare('SELECT * FROM versions WHERE node_id = ? ORDER BY version DESC'),
      version: db.prepare('SELECT * FROM versions WHERE node_id = ? AND version = ?'),
      addVersion: db.prepare('INSERT INTO versions (node_id, version, blob, size, at, by) VALUES (?, ?, ?, ?, ?, ?)'),
      delVersion: db.prepare('DELETE FROM versions WHERE id = ?'),
      oldVersions: db.prepare('SELECT * FROM versions WHERE at < ? LIMIT 500'),
      ftsDel: db.prepare('DELETE FROM fts WHERE rowid = ?'),
      find: db.prepare('SELECT n.*, bm25(fts) AS rank FROM fts JOIN nodes n ON n.id = fts.rowid WHERE fts MATCH ? ORDER BY rank LIMIT 120'),
      ftsAdd: db.prepare('INSERT INTO fts (rowid, name, body) VALUES (?, ?, ?)'),
      // teams
      teams: db.prepare('SELECT * FROM teams WHERE account_id = ? AND gone IS NULL ORDER BY name COLLATE NOCASE'),
      goneTeams: db.prepare('SELECT * FROM teams WHERE account_id = ? AND gone IS NOT NULL ORDER BY gone DESC'),
      team: db.prepare('SELECT * FROM teams WHERE id = ?'),
      teamBySlug: db.prepare('SELECT * FROM teams WHERE account_id = ? AND slug = ? AND gone IS NULL'),
      addTeam: db.prepare('INSERT INTO teams (account_id, name, slug, brief, color, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?)'),
      setTeam: db.prepare('UPDATE teams SET name = ?, slug = ?, brief = ?, color = ?, office = ?, updated = ? WHERE id = ?'),
      teamGone: db.prepare('UPDATE teams SET gone = ?, updated = ? WHERE id = ?'),
      oldTeams: db.prepare('SELECT * FROM teams WHERE gone IS NOT NULL AND gone < ?'),
      delTeam: db.prepare('DELETE FROM teams WHERE id = ?'),
      members: db.prepare('SELECT * FROM members WHERE team_id = ? ORDER BY role = \'lead\' DESC, added'),
      member: db.prepare('SELECT * FROM members WHERE team_id = ? AND agent_id = ?'),
      memberOf: db.prepare('SELECT m.role, t.* FROM members m JOIN teams t ON t.id = m.team_id WHERE m.agent_id = ? AND t.gone IS NULL ORDER BY t.name COLLATE NOCASE'),
      putMember: db.prepare('INSERT INTO members (team_id, agent_id, role, added) VALUES (?, ?, ?, ?) ON CONFLICT (team_id, agent_id) DO UPDATE SET role = excluded.role'),
      delMember: db.prepare('DELETE FROM members WHERE team_id = ? AND agent_id = ?'),
      delAgentMembers: db.prepare('DELETE FROM members WHERE agent_id = ?'),
      // boards
      cards: db.prepare('SELECT * FROM cards WHERE space_id = ? ORDER BY CASE col WHEN \'todo\' THEN 0 WHEN \'doing\' THEN 1 WHEN \'review\' THEN 2 ELSE 3 END, pos'),
      card: db.prepare('SELECT * FROM cards WHERE id = ?'),
      assigned: db.prepare('SELECT * FROM cards WHERE assignee = ? AND col != \'done\' ORDER BY due IS NULL, due, id'),
      lastPos: db.prepare('SELECT COALESCE(MAX(pos), 0) AS p FROM cards WHERE space_id = ? AND col = ?'),
      addCard: db.prepare('INSERT INTO cards (space_id, col, title, notes, assignee, due, pos, created_by, created, updated, done_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'),
      setCard: db.prepare('UPDATE cards SET col = ?, title = ?, notes = ?, assignee = ?, due = ?, pos = ?, updated = ?, done_at = ?, work = ? WHERE id = ?'),
      delCard: db.prepare('DELETE FROM cards WHERE id = ?'),
      oldDone: db.prepare('DELETE FROM cards WHERE col = \'done\' AND done_at < ?'),
      unassign: db.prepare('UPDATE cards SET assignee = NULL WHERE assignee = ? AND space_id = ?'),
      // calendars
      events: db.prepare('SELECT * FROM events WHERE space_id = ? AND end >= ? AND start < ? ORDER BY start LIMIT 500'),
      event: db.prepare('SELECT * FROM events WHERE id = ?'),
      addEvent: db.prepare('INSERT INTO events (space_id, title, start, end, all_day, place, notes, created_by, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'),
      setEvent: db.prepare('UPDATE events SET title = ?, start = ?, end = ?, all_day = ?, place = ?, notes = ?, updated = ? WHERE id = ?'),
      delEvent: db.prepare('DELETE FROM events WHERE id = ?'),
      oldEvents: db.prepare('DELETE FROM events WHERE end < ?'),
      // activity, pages
      addActivity: db.prepare('INSERT INTO activity (account_id, agent_id, at, app, what) VALUES (?, ?, ?, ?, ?)'),
      activity: db.prepare('SELECT * FROM activity WHERE agent_id = ? AND id < ? ORDER BY id DESC LIMIT ?'),
      accountActivity: db.prepare('SELECT * FROM activity WHERE account_id = ? AND id < ? ORDER BY id DESC LIMIT ?'),
      oldActivity: db.prepare('DELETE FROM activity WHERE at < ?'),
      addBrowse: db.prepare('INSERT INTO browse (agent_id, at, url, title, summary) VALUES (?, ?, ?, ?, ?)'),
      browse: db.prepare('SELECT * FROM browse WHERE agent_id = ? ORDER BY id DESC LIMIT ?'),
      trimBrowse: db.prepare('DELETE FROM browse WHERE agent_id = ? AND id NOT IN (SELECT id FROM browse WHERE agent_id = ? ORDER BY id DESC LIMIT ?)'),
      delBrowse: db.prepare('DELETE FROM browse WHERE agent_id = ?'),
    };
  }
  close() { this.pc.close(); }
  limits() {
    const l = { ...DEFAULT_LIMITS };
    const o = this.limitsFn() || {};
    for (const k of Object.keys(DEFAULT_LIMITS)) if (Number.isFinite(Number(o[k])) && Number(o[k]) >= 0) l[k] = Number(o[k]);
    return l;
  }

  // ------------------------------------------------------------------------------------------- who and where
  accountOf(agent) { return agent ? (agent.ownerId ?? this.ownerAccount() ?? null) : null; }
  /** The caller in one shape: { kind, account, agent, tag } - throws not_found for an agent that isn't there. */
  caller(who) {
    if (who && Number.isInteger(who.human)) return { kind: 'human', account: who.human, agent: null, tag: `h:${who.human}` };
    const id = who && (who.agent ?? who.visitor);
    const a = Number.isInteger(id) ? this.agents.get(id) : null;
    const account = this.accountOf(a);
    if (!a || account == null) throw new PcError(404, 'not_found', 'No such agent');
    return { kind: who.visitor != null ? 'visitor' : 'agent', account, agent: a.id, tag: `a:${a.id}` };
  }
  /** The agents of an account (whose homes it holds). */
  agentsOf(account) { return this.agents.list().filter(a => !a.deleted && this.accountOf(a) === account); }
  /** An agent's home, made on first use with its four folders; its account follows the agent's owner. */
  home(agentId) {
    const a = this.agents.get(agentId);
    const account = this.accountOf(a);
    if (!a || account == null) throw new PcError(404, 'not_found', 'No such agent');
    let s = this.q.space.get('agent', a.id);
    if (!s) {
      this.pc.tx(() => {
        const r = this.q.addSpace.run(account, 'agent', a.id, this.now());
        const t = this.now();
        for (const name of HOME_DIRS) this.q.addNode.run(r.lastInsertRowid, 0, name, keyOf(name), 1, 1, null, 0, null, 0, t, t, `a:${a.id}`);
      });
      s = this.q.space.get('agent', a.id);
    } else if (s.account_id !== account) {
      // (the agent changed hands: its home goes with it, and it leaves the old account's teams)
      this.pc.tx(() => { this.q.setSpaceAccount.run(account, s.id); this.q.delAgentMembers.run(a.id); });
      s = this.q.space.get('agent', a.id);
    }
    if (s.gone) { this.q.spaceGone.run(null, s.id); s = { ...s, gone: null }; }
    return s;
  }
  teamSpace(teamId) {
    const t = this.q.team.get(teamId);
    if (!t) throw new PcError(404, 'not_found', 'No such team');
    let s = this.q.space.get('team', t.id);
    if (!s) { this.q.addSpace.run(t.account_id, 'team', t.id, this.now()); s = this.q.space.get('team', t.id); }
    return s;
  }
  /** 'rw', 'r' or null: what `c` (a caller()) may do in space `s` - parts: the path inside it (a visitor's Public). */
  access(c, s, parts = []) {
    if (!s || s.gone || s.account_id !== c.account) return null;
    if (c.kind === 'human') return 'rw';
    if (s.kind === 'agent') {
      if (s.ref !== c.agent) return null;
      // (a visitor: Public, to read - and the home's top, which lists Public alone: list())
      if (c.kind === 'visitor') return !parts.length || keyOf(parts[0]) === 'public' ? 'r' : null;
      return 'rw';
    }
    if (c.kind === 'visitor') return null;
    const t = this.q.team.get(s.ref);
    if (!t || t.gone) return null;
    const m = this.q.member.get(t.id, c.agent);
    return m ? (m.role === 'viewer' ? 'r' : 'rw') : null;
  }
  /** Where a path a caller gave points: { space, parts, view, access } or { virtual: 'root'|'teams' }.
   *  o.cwd: the folder relative paths start from (default ~); o.profile: the agent whose view a person sees;
   *  o.space: a space id given directly (a person's Teams app). */
  resolve(who, vpath, o = {}) {
    const c = who.kind ? who : this.caller(who);
    if (o.space != null) {
      const s = this.q.spaceById.get(Number(o.space));
      const parts = splitPath(vpath);
      const acc = this.access(c, s, parts);
      if (!acc) throw notFound(vpath);
      return { space: s, parts, view: this.viewOf(s, parts), access: acc };
    }
    const profile = c.kind === 'human' ? Number(o.profile) : c.agent;
    if (c.kind === 'human') {
      const a = this.agents.get(profile);
      if (!a || this.accountOf(a) !== c.account) throw new PcError(404, 'not_found', 'No such agent');
    }
    let raw = String(vpath ?? '').trim() || '.';
    if (raw === '~' || raw.startsWith('~/')) raw = `/home${raw.slice(1)}`;
    else if (!raw.startsWith('/')) {
      let cwd = String(o.cwd || '~');
      if (cwd === '~' || cwd.startsWith('~/')) cwd = `/home${cwd.slice(1)}`;
      raw = `${cwd}/${raw}`;
    }
    const all = splitPath(raw);
    if (!all.length) return { virtual: 'root', view: '/' };
    const top = keyOf(all[0]);
    if (top === 'home') {
      const s = this.home(profile), parts = all.slice(1);
      const acc = this.access(c, s, parts);
      if (!acc) throw notFound(vpath);
      return { space: s, parts, view: this.viewOf(s, parts), access: acc };
    }
    if (top === 'teams') {
      if (all.length === 1) return { virtual: 'teams', view: '/teams' };
      const t = this.q.teamBySlug.get(c.account, slugOf(all[1]));
      if (!t) throw notFound(vpath, `There is no team "${all[1]}" here. Your teams: ${this.teamsOf(c, profile).map(x => x.slug).join(', ') || 'none'}`);
      const s = this.teamSpace(t.id), parts = all.slice(2);
      // (a person sees the teams of the agent whose view this is - and any team of theirs directly)
      const viewer = c.kind === 'human' ? { kind: 'agent', account: c.account, agent: profile } : c;
      const acc = c.kind === 'human' ? (this.access(viewer, s, parts) ? 'rw' : null) : this.access(c, s, parts);
      if (!acc) throw notFound(vpath, `This agent isn't in the team "${t.name}"`);
      return { space: s, parts, view: this.viewOf(s, parts), access: acc };
    }
    throw notFound(vpath, 'Paths start with ~ (the home folder) or /teams/<team>');
  }
  viewOf(s, parts) {
    if (s.kind === 'agent') return parts.length ? `~/${parts.join('/')}` : '~';
    const t = this.q.team.get(s.ref);
    return `/teams/${t ? t.slug : s.ref}${parts.length ? `/${parts.join('/')}` : ''}`;
  }
  /** The node at `parts` in space `s` (null: none); dirs: create missing folders on the way (not the last part). */
  walk(s, parts, { make = false, by = '' } = {}) {
    if (parts.length > DEPTH_MAX) throw new PcError(400, 'too_deep', `Folders go at most ${DEPTH_MAX} deep`);
    let parent = 0, node = null;
    for (let i = 0; i < parts.length; i++) {
      const name = parts[i];
      node = this.q.child.get(s.id, parent, keyOf(name));
      if (!node) {
        if (!make || i === parts.length - 1) return i === parts.length - 1 ? { missing: true, parent, name } : null;
        const nm = checkName(name), t = this.now();
        this.checkRoom(s.id, parent);
        const r = this.q.addNode.run(s.id, parent, nm, keyOf(nm), 1, 0, null, 0, null, 0, t, t, by);
        this.index(Number(r.lastInsertRowid), nm, '', s.id);
        node = this.q.node.get(r.lastInsertRowid);
      } else if (!node.dir && i < parts.length - 1) throw new PcError(400, 'not_folder', `${name} is a file, not a folder`);
      parent = node.id;
    }
    return node;
  }
  /** The id of the folder at `parts` (0: the top), made with the folders on the way when missing. */
  dirId(s, parts, by) {
    if (!parts.length) return 0;
    const r = this.walk(s, [...parts, '\u0000'], { make: true, by });
    return r.parent;
  }
  checkRoom(spaceId, parent) {
    if (this.q.countChildren.get(spaceId, parent).n >= FOLDER_MAX) throw new PcError(409, 'folder_full', `A folder holds at most ${FOLDER_MAX} items; make a subfolder`);
  }
  /** The node a path names (throws not_found, with the nearest real name when the last part is a near miss). */
  nodeAt(who, vpath, o = {}) {
    const r = this.resolve(who, vpath, o);
    if (r.virtual) return { ...r, node: null };
    if (!r.parts.length) return { ...r, node: { id: 0, dir: 1, name: r.view, root: true } };
    const n = this.walk(r.space, r.parts);
    if (!n || n.missing) throw notFound(r.view, this.nearest(r.space, r.parts));
    return { ...r, node: n };
  }
  /** "Did you mean …?" for a path whose last part is missing or mistyped. */
  nearest(s, parts) {
    let parent = 0;
    for (let i = 0; i < parts.length - 1; i++) {
      const n = this.q.child.get(s.id, parent, keyOf(parts[i]));
      if (!n || !n.dir) return '';
      parent = n.id;
    }
    const want = keyOf(parts[parts.length - 1]);
    const kids = this.q.children.all(s.id, parent, 400, 0);
    let best = null, score = Infinity;
    for (const k of kids) {
      const d = distance(want, k.name_key);
      const sc = k.name_key.startsWith(want) || want.startsWith(k.name_key.replace(/\.[a-z0-9]+$/, '')) ? Math.min(d, 1) : d;
      if (sc < score) { score = sc; best = k; }
    }
    if (best && score <= Math.max(2, Math.floor(want.length / 3))) return `Did you mean ${this.viewOf(s, [...parts.slice(0, -1), best.name])}?`;
    return kids.length ? `In that folder: ${kids.slice(0, 8).map(k => k.name + (k.dir ? '/' : '')).join(', ')}${kids.length > 8 ? ', …' : ''}` : 'That folder is empty.';
  }

  // ------------------------------------------------------------------------------------------- reading
  info(n, s) {
    if (!n || n.root) return n;
    return { id: n.id, name: n.name, dir: !!n.dir, system: !!n.system, size: n.size, mime: n.mime, version: n.version, created: n.created, modified: n.modified, by: n.by,
      ...(s ? { path: this.viewOf(s, this.partsOf(n)) } : {}) };
  }
  partsOf(n) {
    const out = [];
    let cur = n, guard = 0;
    while (cur && guard++ < DEPTH_MAX + 2) { out.unshift(cur.name); cur = cur.parent ? this.q.node.get(cur.parent) : null; }
    return out;
  }
  /** A folder's contents: { path, entries, total, more } (folders first, then by name). */
  list(who, vpath = '~', o = {}) {
    const c = this.caller(who);
    const r = this.nodeAt(c, vpath, o);
    const limit = Math.max(1, Math.min(1000, o.limit || 200)), offset = Math.max(0, o.offset || 0);
    if (r.virtual === 'root') {
      const entries = c.kind === 'visitor' ? [{ name: 'Public', dir: true, system: true, path: '~/Public' }]
        : [{ name: 'home', dir: true, system: true, path: '~' }, { name: 'teams', dir: true, system: true, path: '/teams' }];
      return { path: '/', entries, total: entries.length };
    }
    if (r.virtual === 'teams') {
      if (c.kind === 'visitor') throw notFound(vpath);
      const ts = this.teamsOf(c, c.kind === 'human' ? Number(o.profile) : c.agent);
      return { path: '/teams', entries: ts.map(t => ({ name: t.slug, title: t.name, dir: true, team: t.id, role: t.role, path: `/teams/${t.slug}` })), total: ts.length };
    }
    if (!r.node.dir) return { path: r.view, file: this.info(r.node, r.space), entries: [], total: 0 };
    const parent = r.node.root ? 0 : r.node.id;
    let rows = this.q.children.all(r.space.id, parent, limit, offset);
    if (c.kind === 'visitor' && !r.parts.length) rows = rows.filter(n => n.name_key === 'public');
    const total = c.kind === 'visitor' && !r.parts.length ? rows.length : this.q.countChildren.get(r.space.id, parent).n;
    return { path: r.view, space: r.space.id, access: r.access, entries: rows.map(n => ({ ...this.info(n), path: `${r.view === '~' ? '~' : r.view}/${n.name}` })), total, more: offset + rows.length < total };
  }
  stat(who, vpath, o = {}) {
    const r = this.nodeAt(who, vpath, o);
    if (r.virtual) return { path: r.view, dir: true, virtual: r.virtual };
    if (r.node.root) return { path: r.view, dir: true, root: true, space: r.space.id, access: r.access };
    return { ...this.info(r.node, r.space), access: r.access, space: r.space.id, versions: this.q.versions.all(r.node.id).length };
  }
  /** A file's bytes: { node, buf, path }. */
  readFile(who, vpath, o = {}) {
    const r = this.nodeAt(who, vpath, o);
    if (r.virtual || r.node.root || r.node.dir) throw new PcError(400, 'is_folder', `${r.view} is a folder: list it instead`);
    const buf = r.node.blob ? this.blobs.read(r.node.blob) : Buffer.alloc(0);
    if (!buf) throw new PcError(500, 'lost', `${r.view} could not be read (its content is missing)`);
    return { node: r.node, info: this.info(r.node, r.space), buf, path: r.view, space: r.space };
  }
  /** A file as text: { text, info, path, kind: 'text'|'doc', truncated } - throws for pictures, PDFs, recordings. */
  readText(who, vpath, o = {}) {
    const f = this.readFile(who, vpath, o);
    const mime = f.node.mime || mimeOf(f.node.name);
    if (isText(mime, f.node.name)) {
      if (f.buf.includes(0)) throw new PcError(415, 'binary', `${f.path} isn't text`);
      return { text: f.buf.toString('utf8').replace(/^﻿/, ''), info: f.info, path: f.path, kind: 'text' };
    }
    if (isDoc(f.node.name)) {
      try { const d = extractBuffer(f.buf, f.node.name); return { text: d.text, truncated: d.truncated, info: f.info, path: f.path, kind: 'doc' }; } catch (e) { throw new PcError(415, 'unreadable', `${f.path}: ${e.message}`); }
    }
    throw new PcError(415, 'not_text', `${f.path} is ${describe(mime, f.node.size)} - it can't be read as text`);
  }

  // ------------------------------------------------------------------------------------------- writing
  /** The account's storage: { used, limit (0: none), spaces: [{ id, kind, ref, used }] }. */
  usage(account) {
    const l = this.limits();
    const agents = this.agentsOf(account).length, teams = this.q.teams.all(account).length;
    const limit = l.agentMB > 0 ? Math.round((Math.max(1, agents) * l.agentMB + teams * l.teamMB) * MB) : 0;
    return { used: this.q.accountUsed.get(account).u, limit, agents, teams, perAgent: l.agentMB * MB, perTeam: l.teamMB * MB, fileMax: l.fileMB * MB,
      spaces: this.q.accountSpaces.all(account).map(s => ({ id: s.id, kind: s.kind, ref: s.ref, used: s.used })) };
  }
  roomFor(account, more) {
    if (more <= 0) return;
    const u = this.usage(account);
    if (u.limit && u.used + more > u.limit) {
      throw new PcError(507, 'full', `The PC is full: ${mbText(u.used)} of ${mbText(u.limit)} used. Delete files you no longer need, or empty the trash (it is kept 30 days) - nothing was saved.`, { used: u.used, limit: u.limit });
    }
  }
  /** Writes a file (made with its folders when missing). content: Buffer or string. o.expect: the version the writer
   *  last read - refused (409 changed) when someone saved since; o.force: replace a file someone else wrote without
   *  having read it. Returns { info, created, same }. */
  write(who, vpath, content, o = {}) {
    const c = this.caller(who);
    const r = this.resolve(c, vpath, o);
    if (r.virtual || !r.parts.length) throw new PcError(400, 'is_folder', `${r.view} is a folder`);
    if (r.access !== 'rw') throw new PcError(403, 'read_only', `${r.view} can only be read`);
    const buf = Buffer.isBuffer(content) ? content : Buffer.from(String(content ?? ''), 'utf8');
    const l = this.limits();
    if (l.fileMB > 0 && buf.length > l.fileMB * MB) throw new PcError(413, 'too_large', `A file is at most ${l.fileMB} MB here (this one is ${mbText(buf.length)})`);
    const name = checkName(r.parts[r.parts.length - 1]);
    const mime = o.mime && typeof o.mime === 'string' && /^[\w.+-]+\/[\w.+-]+$/.test(o.mime) ? o.mime : mimeOf(name);
    const prep = this.blobs.prepare(buf, mime);   // (outside the transaction: a big file goes to the store first)
    const res = this.pc.tx(() => {
      const at = this.walk(r.space, r.parts, { make: true, by: c.tag });
      const t = this.now();
      if (at && !at.missing) {
        if (at.dir) throw new PcError(400, 'is_folder', `${r.view} is a folder`);
        if (o.expect != null && Number(o.expect) !== at.version) throw new PcError(409, 'changed', `${r.view} was changed since it was read (now version ${at.version}, by ${at.by}). Read it again, then make the change.`, { version: at.version, by: at.by });
        if (o.expect == null && !o.force && at.by !== c.tag && c.kind !== 'human' && at.version > 0) {
          throw new PcError(409, 'not_read', `${r.view} exists already (last changed by ${at.by}). Read it first, or write it with force to replace it.`, { version: at.version, by: at.by });
        }
        if (at.blob === prep.sha) return { node: at, created: false, same: true };
        this.roomFor(c.account, buf.length - at.size);
        prep.put();
        if (at.blob) this.q.addVersion.run(at.id, at.version, at.blob, at.size, at.modified, at.by);   // (its reference moves to the version)
        this.q.setContent.run(prep.sha, buf.length, mime, t, c.tag, at.id);
        this.q.used.run(buf.length - at.size, r.space.id);
        this.pruneVersions(at.id, l.versions);
        const n = this.q.node.get(at.id);
        this.index(n.id, n.name, this.textForIndex(buf, mime, name), r.space.id);
        return { node: n, created: false };
      }
      this.roomFor(c.account, buf.length);
      this.checkRoom(r.space.id, at.parent);
      prep.put();
      const ins = this.q.addNode.run(r.space.id, at.parent, name, keyOf(name), 0, 0, prep.sha, buf.length, mime, 1, t, t, c.tag);
      this.q.used.run(buf.length, r.space.id);
      const n = this.q.node.get(ins.lastInsertRowid);
      this.index(n.id, n.name, this.textForIndex(buf, mime, name), r.space.id);
      return { node: n, created: true };
    });
    const info = this.info(res.node, r.space);
    if (!res.same) this.changed(c, r.space, { kind: 'files', path: info.path }, `${res.created ? 'Created' : 'Saved'} ${info.path}`, 'files');
    return { info, created: res.created, same: !!res.same };
  }
  /** Adds text to the end of a file (made when missing). */
  append(who, vpath, text, o = {}) {
    let before = '', expect;
    try { const f = this.readText(who, vpath, o); before = f.text; expect = f.info.version; } catch (e) { if (e.code !== 'not_found') throw e; }
    const glue = before && !before.endsWith('\n') ? '\n' : '';
    return this.write(who, vpath, before + glue + String(text ?? ''), { ...o, expect, force: true });
  }
  /** Replaces `find` with `repl` in a text file - exactly one place, unless o.all. */
  edit(who, vpath, find, repl, o = {}) {
    const f = this.readText(who, vpath, o);
    if (f.kind !== 'text') throw new PcError(415, 'not_text', `${f.path} is a document: write it again instead of editing it`);
    const needle = String(find ?? '');
    if (!needle) throw new PcError(400, 'nothing', 'Say what to find');
    const count = f.text.split(needle).length - 1;
    if (!count) throw new PcError(404, 'no_match', `"${short(needle, 60)}" isn't in ${f.path}. Read the file and copy the words exactly.`);
    if (count > 1 && !o.all) throw new PcError(409, 'many', `"${short(needle, 60)}" is in ${f.path} ${count} times: give more of the words around it so only one matches (or replace all)`);
    const text = o.all ? f.text.split(needle).join(String(repl ?? '')) : f.text.replace(needle, () => String(repl ?? ''));
    const r = this.write(who, vpath, text, { ...o, expect: o.expect ?? f.info.version, force: true });
    return { ...r, replaced: o.all ? count : 1 };
  }
  mkdir(who, vpath, o = {}) {
    const c = this.caller(who);
    const r = this.resolve(c, vpath, o);
    if (r.virtual || !r.parts.length) return { path: r.view, existed: true };
    if (r.access !== 'rw') throw new PcError(403, 'read_only', `${r.view} can only be read`);
    const name = checkName(r.parts[r.parts.length - 1]);
    const out = this.pc.tx(() => {
      const at = this.walk(r.space, r.parts, { make: true, by: c.tag });
      if (at && !at.missing) { if (!at.dir) throw new PcError(409, 'exists', `${r.view} is a file`); return { node: at, existed: true }; }
      this.checkRoom(r.space.id, at.parent);
      const t = this.now();
      const ins = this.q.addNode.run(r.space.id, at.parent, name, keyOf(name), 1, 0, null, 0, null, 0, t, t, c.tag);
      this.index(Number(ins.lastInsertRowid), name, '', r.space.id);
      return { node: this.q.node.get(ins.lastInsertRowid), existed: false };
    });
    if (!out.existed) this.changed(c, r.space, { kind: 'files', path: r.view }, `Made the folder ${r.view}`, 'files');
    return { path: r.view, existed: out.existed, info: this.info(out.node, r.space) };
  }
  /** Where `to` puts something called `name`: into `to` when it is a folder, else `to` itself (a new name). */
  target(c, to, name, o) {
    const r = this.resolve(c, to, o);
    if (r.virtual) throw new PcError(400, 'bad_target', `Can't put things in ${r.view}: use ~ or a team's folder`);
    if (r.access !== 'rw') throw new PcError(403, 'read_only', `${r.view} can only be read`);
    const n = r.parts.length ? this.walk(r.space, r.parts) : { id: 0, dir: 1, root: true };
    if (n && !n.missing && n.dir) return { space: r.space, parts: [...r.parts, name] };
    return { space: r.space, parts: r.parts };
  }
  /** Moves or renames a file or folder (also between the home and a team's folder). */
  move(who, from, to, o = {}) {
    const c = this.caller(who);
    const src = this.nodeAt(c, from, o);
    if (src.virtual || src.node.root) throw new PcError(400, 'bad_source', `${src.view} can't be moved`);
    if (src.access !== 'rw') throw new PcError(403, 'read_only', `${src.view} can only be read`);
    if (src.node.system) throw new PcError(403, 'system', `${src.view} is one of the PC's own folders: it stays where it is`);
    const dst = this.target(c, to, src.node.name, o);
    const name = checkName(dst.parts[dst.parts.length - 1]);
    const out = this.pc.tx(() => {
      const parent = this.dirId(dst.space, dst.parts.slice(0, -1), c.tag);
      if (src.node.dir) {
        // (never into itself)
        let cur = parent;
        for (let g = 0; cur && g < DEPTH_MAX + 2; g++) { if (cur === src.node.id) throw new PcError(400, 'into_itself', 'A folder can\'t go inside itself'); cur = this.q.node.get(cur)?.parent || 0; }
      }
      const clash = this.q.child.get(dst.space.id, parent, keyOf(name));
      if (clash && clash.id !== src.node.id) throw new PcError(409, 'exists', `${this.viewOf(dst.space, dst.parts)} exists already`);
      const sub = src.node.dir ? this.q.subtree.all(src.node.id, src.space.id) : [src.node];
      const bytes = sub.reduce((s, n) => s + (n.dir ? 0 : n.size), 0);
      if (dst.space.id !== src.space.id) {
        if (dst.space.account_id !== src.space.account_id) throw new PcError(403, 'other_account', 'Files never leave the account');
        for (const n of sub) this.q.setSpace.run(dst.space.id, n.id);
        this.q.used.run(-bytes, src.space.id); this.q.used.run(bytes, dst.space.id);
      }
      if (parent) this.checkRoom(dst.space.id, parent);
      this.q.rename.run(parent, name, keyOf(name), this.now(), c.tag, src.node.id);
      // (the search index knows each node's space: a folder moved to another space is indexed there again, all of it)
      if (dst.space.id !== src.space.id) { for (const n of sub) if (n.id !== src.node.id) this.index(n.id, n.name, n.dir ? '' : this.textOfNode(n), dst.space.id); }
      this.index(src.node.id, name, src.node.dir ? '' : this.textOfNode({ ...src.node, name }), dst.space.id);
      return this.q.node.get(src.node.id);
    });
    const info = this.info(out, dst.space);
    this.changed(c, src.space, { kind: 'files', path: info.path }, `Moved ${src.view} to ${info.path}`, 'files');
    if (dst.space.id !== src.space.id) this.changed(c, dst.space, { kind: 'files', path: info.path }, null);
    return { info, from: src.view };
  }
  /** Copies a file or folder (its contents are shared, so a copy takes no more room on disk - it counts toward the
   *  limit as its own size, as for its owner it is one more file). */
  copy(who, from, to, o = {}) {
    const c = this.caller(who);
    const src = this.nodeAt(c, from, o);
    if (src.virtual || src.node.root) throw new PcError(400, 'bad_source', `Copy files or folders, not ${src.view}`);
    const dst = this.target(c, to, src.node.name, o);
    const sub = src.node.dir ? this.q.subtree.all(src.node.id, src.space.id) : [src.node];
    if (sub.length > 2000) throw new PcError(413, 'too_many', 'That folder has too many items to copy at once (2,000 at most)');
    const bytes = sub.reduce((s, n) => s + (n.dir ? 0 : n.size), 0);
    const out = this.pc.tx(() => {
      this.roomFor(c.account, bytes);
      const top = checkName(dst.parts[dst.parts.length - 1]);
      const parent = this.dirId(dst.space, dst.parts.slice(0, -1), c.tag);
      if (this.q.child.get(dst.space.id, parent, keyOf(top))) throw new PcError(409, 'exists', `${this.viewOf(dst.space, dst.parts)} exists already`);
      const t = this.now(), map = new Map();
      for (const n of sub) {
        const p = n.id === src.node.id ? parent : map.get(n.parent);
        if (p === undefined) continue;
        const nm = n.id === src.node.id ? top : n.name;
        if (n.blob) this.blobs.addRef(n.blob);
        const ins = this.q.addNode.run(dst.space.id, p, nm, keyOf(nm), n.dir, 0, n.blob, n.size, n.mime, n.dir ? 0 : 1, t, t, c.tag);
        map.set(n.id, Number(ins.lastInsertRowid));
        this.index(Number(ins.lastInsertRowid), nm, n.dir ? '' : this.textOfNode(n), dst.space.id);
      }
      this.q.used.run(bytes, dst.space.id);
      return this.q.node.get(map.get(src.node.id));
    });
    const info = this.info(out, dst.space);
    this.changed(c, dst.space, { kind: 'files', path: info.path }, `Copied ${src.view} to ${info.path}`, 'files');
    return { info, from: src.view };
  }
  /** Puts a file or folder in the trash (kept keepDays days; restore() brings it back). */
  remove(who, vpath, o = {}) {
    const c = this.caller(who);
    const r = this.nodeAt(c, vpath, o);
    if (r.virtual || r.node.root) throw new PcError(400, 'bad_source', `${r.view} can't be deleted`);
    if (r.access !== 'rw') throw new PcError(403, 'read_only', `${r.view} can only be read`);
    if (r.node.system) throw new PcError(403, 'system', `${r.view} is one of the PC's own folders: it can't be deleted (its contents can)`);
    this.pc.tx(() => {
      const sub = r.node.dir ? this.q.subtree.all(r.node.id, r.space.id) : [r.node];
      const bytes = sub.reduce((s, n) => s + (n.dir ? 0 : n.size), 0);
      for (const n of sub) this.q.ftsDel.run(n.id);
      this.q.trash.run(this.now(), r.view, r.node.id);
      this.q.used.run(-bytes, r.space.id);
    });
    this.changed(c, r.space, { kind: 'files', path: r.view }, `Deleted ${r.view} (in the trash for ${this.limits().keepDays} days)`, 'files');
    return { path: r.view, trashed: true };
  }
  /** What is in the trash of the space `vpath` is in (or o.space). */
  trashList(who, vpath = '~', o = {}) {
    const c = this.caller(who);
    const r = this.resolve(c, vpath, o);
    if (r.virtual) throw new PcError(400, 'bad_target', 'Name ~ or a team\'s folder');
    if (r.access !== 'rw') return { items: [] };
    const keep = this.limits().keepDays * 86400000;
    return { space: r.space.id, items: this.q.trashed.all(r.space.id).map(n => ({ id: n.id, name: n.name, dir: !!n.dir, size: n.size, path: n.trash_path, deleted: n.trashed, until: n.trashed + keep })) };
  }
  restore(who, id, o = {}) {
    const c = this.caller(who);
    const n = this.q.node.get(Number(id));
    const s = n && this.q.spaceById.get(n.space_id);
    if (!n || n.trashed == null || this.access(c, s) !== 'rw') throw new PcError(404, 'not_found', 'Nothing like that is in the trash');
    const out = this.pc.tx(() => {
      const sub = n.dir ? this.q.subtree.all(n.id, s.id) : [n];
      const bytes = sub.reduce((x, m) => x + (m.dir ? 0 : m.size), 0);
      this.roomFor(s.account_id, bytes);
      // back where it was if that folder is still there, else at the top; a name taken meanwhile gets "(restored)"
      let parent = n.parent;
      const p = parent ? this.q.node.get(parent) : null;
      if (parent && (!p || p.trashed != null || !this.visible(p))) parent = 0;
      let name = n.name;
      for (let k = 1; this.q.child.get(s.id, parent, keyOf(name)); k++) name = withSuffix(n.name, k === 1 ? ' (restored)' : ` (restored ${k})`);
      this.q.untrash.run(parent, name, keyOf(name), n.id);
      this.q.used.run(bytes, s.id);
      for (const m of sub) this.index(m.id, m.id === n.id ? name : m.name, m.dir ? '' : this.textOfNode(m), s.id);
      return this.q.node.get(n.id);
    });
    const info = this.info(out, s);
    this.changed(c, s, { kind: 'files', path: info.path }, `Restored ${info.path}`, 'files');
    return { info };
  }
  /** Empties a space's trash now (o.id: one item). */
  emptyTrash(who, vpath = '~', o = {}) {
    const c = this.caller(who);
    const items = o.id != null ? [this.q.node.get(Number(o.id))].filter(Boolean) : this.trashList(c, vpath, o).items.map(i => this.q.node.get(i.id));
    let n = 0;
    for (const it of items) {
      const s = this.q.spaceById.get(it.space_id);
      if (it.trashed == null || this.access(c, s) !== 'rw') continue;
      this.pc.tx(() => this.purge(it));
      n++;
    }
    if (n) this.emit(c.account, { kind: 'files' });
    return { removed: n };
  }
  visible(n) {
    let cur = n, g = 0;
    while (cur && g++ < DEPTH_MAX + 2) { if (cur.trashed != null) return false; cur = cur.parent ? this.q.node.get(cur.parent) : null; }
    return true;
  }
  /** Deletes a node and everything under it for good (inside a transaction). */
  purge(n) {
    const sub = this.q.subtree.all(n.id, n.space_id);
    for (const m of sub) {
      for (const v of this.q.versions.all(m.id)) { this.blobs.unref(v.blob); this.q.delVersion.run(v.id); }
      if (m.blob) this.blobs.unref(m.blob);
      this.q.ftsDel.run(m.id);
    }
    for (const m of sub.reverse()) this.q.delNode.run(m.id);
  }
  pruneVersions(nodeId, keep) {
    const vs = this.q.versions.all(nodeId);
    for (const v of vs.slice(Math.max(0, keep))) { this.blobs.unref(v.blob); this.q.delVersion.run(v.id); }
  }
  versions(who, vpath, o = {}) {
    const r = this.nodeAt(who, vpath, o);
    if (r.virtual || r.node.root || r.node.dir) throw new PcError(400, 'is_folder', 'Folders have no versions');
    return { path: r.view, current: { version: r.node.version, size: r.node.size, at: r.node.modified, by: r.node.by },
      older: this.q.versions.all(r.node.id).map(v => ({ version: v.version, size: v.size, at: v.at, by: v.by })) };
  }
  /** An older version's bytes. */
  versionBytes(who, vpath, version, o = {}) {
    const r = this.nodeAt(who, vpath, o);
    const v = r.node && !r.node.dir ? this.q.version.get(r.node.id, Number(version)) : null;
    if (!v) throw new PcError(404, 'not_found', `${r.view} has no version ${version}`);
    return { buf: this.blobs.read(v.blob), node: r.node, path: r.view };
  }
  /** Brings an older version back (as a new version: nothing is lost). */
  revert(who, vpath, version, o = {}) {
    const old = this.versionBytes(who, vpath, version, o);
    return this.write(who, vpath, old.buf, { ...o, mime: old.node.mime, expect: old.node.version, force: true });
  }

  // ------------------------------------------------------------------------------------------- search
  /** Text the search index keeps for a file (its words; nothing for pictures and recordings). */
  textForIndex(buf, mime, name) {
    if (buf.length > INDEX_MAX * 4) return '';
    try {
      if (isText(mime, name) && !buf.includes(0)) return buf.subarray(0, INDEX_MAX).toString('utf8');
      if (isDoc(name)) return extractBuffer(buf, name).text.slice(0, INDEX_MAX);
    } catch { /* unreadable: its name is still found */ }
    return '';
  }
  textOfNode(n) {
    if (!n.blob || n.size > INDEX_MAX * 4) return '';
    const buf = this.blobs.read(n.blob);
    return buf ? this.textForIndex(buf, n.mime, n.name) : '';
  }
  /** Indexes a node's name and words, each word marked with its space (find() asks only for the caller's spaces). */
  index(id, name, body, spaceId) {
    this.q.ftsDel.run(id);
    this.q.ftsAdd.run(id, marked(name, spaceId), body ? marked(body, spaceId) : '');
  }
  /** Files and folders whose name or words match: [{ path, name, dir, size, modified, snippet }] - in the spaces the
   *  caller reaches (o.in: only under that folder). */
  find(who, query, o = {}) {
    const c = this.caller(who);
    const words = wordsOf(query).slice(0, 8);
    if (!words.length) throw new PcError(400, 'nothing', 'Say what to look for');
    const spaces = this.reachable(c, o.profile);
    let scope = null;
    if (o.in) {
      const r = this.nodeAt(c, o.in, o);
      if (!r.virtual) scope = { space: r.space.id, under: r.node.root ? 0 : r.node.id };
    }
    const ids = new Map(spaces.map(s => [s.space.id, s]));
    if (!ids.size) return { query: words.join(' '), results: [] };
    // (only the reachable spaces' entries are read: the index's own posting lists for "s<id>", not every match there is)
    const only = scope ? [scope.space] : [...ids.keys()].slice(0, 200);
    const q = only.map(id => `(${words.map(w => `"s${id}x${w}"*`).join(' AND ')})`).join(' OR ');
    const rows = this.q.find.all(q).filter(n => ids.has(n.space_id) && n.trashed == null);
    const out = [];
    for (const n of rows) {
      if (!this.visible(n)) continue;
      const sp = ids.get(n.space_id);
      const parts = this.partsOf(n);
      if (sp.publicOnly && keyOf(parts[0] || '') !== 'public') continue;
      if (scope && (n.space_id !== scope.space || (scope.under && !this.isUnder(n, scope.under)))) continue;
      out.push({ path: this.viewOf(sp.space, parts), name: n.name, dir: !!n.dir, size: n.size, modified: n.modified, snippet: n.dir ? '' : this.snippet(n, words) });
      if (out.length >= (o.limit || 30)) break;
    }
    return { query: words.join(' '), results: out };
  }
  isUnder(n, under) {
    let cur = n, g = 0;
    while (cur && g++ < DEPTH_MAX + 2) { if (cur.parent === under) return true; cur = cur.parent ? this.q.node.get(cur.parent) : null; }
    return false;
  }
  snippet(n, words) {
    const text = this.textOfNode(n);
    if (!text) return '';
    // (found in the text as it is, or else with its accents taken off as the index has it)
    let src = text, low = text.toLowerCase(), at = -1;
    for (const w of words) { at = low.indexOf(w); if (at >= 0) break; }
    if (at < 0) {
      src = text.normalize('NFKD').replace(/[\u0300-\u036f]/g, ''); low = src.toLowerCase();
      for (const w of words) { at = low.indexOf(w); if (at >= 0) break; }
    }
    if (at < 0) return '';
    const a = Math.max(0, at - 60), b = Math.min(src.length, at + 100);
    return `${a ? '…' : ''}${src.slice(a, b).replace(/\s+/g, ' ').trim()}${b < src.length ? '…' : ''}`;
  }
  /** The spaces a caller reaches: [{ space, publicOnly }]. */
  reachable(c, profile) {
    const out = [];
    if (c.kind === 'human') {
      for (const s of this.q.accountSpaces.all(c.account)) {
        if (profile != null && s.kind === 'agent' && s.ref !== Number(profile)) continue;
        if (profile != null && s.kind === 'team' && !this.q.member.get(s.ref, Number(profile))) continue;
        if (s.kind === 'team' && this.q.team.get(s.ref)?.gone) continue;
        out.push({ space: s });
      }
      return out;
    }
    out.push({ space: this.home(c.agent), publicOnly: c.kind === 'visitor' });
    if (c.kind === 'agent') for (const t of this.q.memberOf.all(c.agent)) if (t.account_id === c.account) out.push({ space: this.teamSpace(t.id) });
    return out;
  }

  // ------------------------------------------------------------------------------------------- teams
  teamOut(t, withMembers = true) {
    const s = this.q.space.get('team', t.id);
    return { id: t.id, name: t.name, slug: t.slug, brief: t.brief, color: t.color, office: t.office ? JSON.parse(t.office) : null, created: t.created, updated: t.updated,
      space: s ? s.id : null, used: s ? s.used : 0, ...(t.gone ? { gone: t.gone } : {}),
      ...(withMembers ? { members: this.q.members.all(t.id).map(m => ({ agent: m.agent_id, role: m.role, added: m.added })) } : {}) };
  }
  /** The teams a caller sees: a person all of theirs (or one agent's when profile is given), an agent its own. */
  teamsOf(who, profile = null) {
    const c = who.kind ? who : this.caller(who);
    if (c.kind === 'visitor') return [];
    const agent = c.kind === 'human' ? (profile != null && Number.isInteger(Number(profile)) ? Number(profile) : null) : c.agent;
    if (agent == null) return this.q.teams.all(c.account).map(t => ({ ...this.teamOut(t), role: null }));
    return this.q.memberOf.all(agent).filter(t => t.account_id === c.account).map(t => ({ ...this.teamOut(t), role: t.role }));
  }
  goneTeams(who) {
    const c = this.caller(who);
    if (c.kind !== 'human') return [];
    const keep = this.limits().keepDays * 86400000;
    return this.q.goneTeams.all(c.account).map(t => ({ ...this.teamOut(t, false), until: t.gone + keep }));
  }
  ownTeam(c, id) {
    if (c.kind !== 'human') throw new PcError(403, 'people_only', 'Only the PC\'s owner changes its teams');
    const t = this.q.team.get(Number(id));
    if (!t || t.account_id !== c.account || t.gone) throw new PcError(404, 'not_found', 'No such team');
    return t;
  }
  createTeam(who, { name, brief = '', color = '' } = {}) {
    const c = this.caller(who);
    if (c.kind !== 'human') throw new PcError(403, 'people_only', 'Only the PC\'s owner makes teams');
    const nm = line(name, TEAM_NAME_MAX), slug = slugOf(nm);
    if (!nm || !slug) throw new PcError(400, 'bad_name', 'Give the team a name (letters or numbers)');
    if (this.q.teamBySlug.get(c.account, slug)) throw new PcError(409, 'exists', `There is a team called "${nm}" already`);
    if (this.q.teams.all(c.account).length >= 50) throw new PcError(409, 'too_many', 'An account has at most 50 teams');
    const t = this.now();
    const id = this.pc.tx(() => {
      const r = this.q.addTeam.run(c.account, nm, slug, clean(brief, BRIEF_MAX).trim(), colorOf(color), t, t);
      this.q.addSpace.run(c.account, 'team', Number(r.lastInsertRowid), t);
      return Number(r.lastInsertRowid);
    });
    this.emit(c.account, { kind: 'teams' });
    return this.teamOut(this.q.team.get(id));
  }
  updateTeam(who, id, patch = {}) {
    const c = this.caller(who);
    const t = this.ownTeam(c, id);
    const name = patch.name !== undefined ? line(patch.name, TEAM_NAME_MAX) : t.name;
    const slug = patch.name !== undefined ? slugOf(name) : t.slug;
    if (!name || !slug) throw new PcError(400, 'bad_name', 'Give the team a name (letters or numbers)');
    const other = this.q.teamBySlug.get(c.account, slug);
    if (other && other.id !== t.id) throw new PcError(409, 'exists', `There is a team called "${name}" already`);
    const brief = patch.brief !== undefined ? clean(patch.brief, BRIEF_MAX).trim() : t.brief;
    const color = patch.color !== undefined ? colorOf(patch.color) : t.color;
    let office = t.office;
    if (patch.office !== undefined) {
      const o = patch.office;
      office = o && Number.isInteger(o.b) && o.b >= 0 && Number.isInteger(o.f) && o.f >= 0 && o.f < 200 ? JSON.stringify({ b: o.b, f: o.f }) : null;
    }
    this.q.setTeam.run(name, slug, brief, color, office, this.now(), t.id);
    this.emit(c.account, { kind: 'teams' });
    return this.teamOut(this.q.team.get(t.id));
  }
  /** Deletes a team: its folder, board and calendar wait keepDays days (restoreTeam brings them back), then go. */
  deleteTeam(who, id) {
    const c = this.caller(who);
    const t = this.ownTeam(c, id);
    this.pc.tx(() => { this.q.teamGone.run(this.now(), this.now(), t.id); const s = this.q.space.get('team', t.id); if (s) this.q.spaceGone.run(this.now(), s.id); });
    this.emit(c.account, { kind: 'teams' });
    return { deleted: t.id };
  }
  restoreTeam(who, id) {
    const c = this.caller(who);
    if (c.kind !== 'human') throw new PcError(403, 'people_only', 'Only the PC\'s owner changes its teams');
    const t = this.q.team.get(Number(id));
    if (!t || t.account_id !== c.account || !t.gone) throw new PcError(404, 'not_found', 'No deleted team like that');
    let slug = t.slug, name = t.name;
    for (let k = 2; this.q.teamBySlug.get(c.account, slug); k++) { name = `${t.name} ${k}`; slug = slugOf(name); }
    const s = this.q.space.get('team', t.id);
    this.pc.tx(() => {
      if (s) this.roomFor(c.account, s.used);
      this.db.prepare('UPDATE teams SET gone = NULL, name = ?, slug = ?, updated = ? WHERE id = ?').run(name, slug, this.now(), t.id);
      if (s) this.q.spaceGone.run(null, s.id);
    });
    this.emit(c.account, { kind: 'teams' });
    return this.teamOut(this.q.team.get(t.id));
  }
  /** Adds an agent to a team, changes its role, or (role null) takes it out. The agent must be the account's own. */
  setMember(who, teamId, agentId, role) {
    const c = this.caller(who);
    const t = this.ownTeam(c, teamId);
    const a = this.agents.get(Number(agentId));
    if (!a || this.accountOf(a) !== c.account) throw new PcError(404, 'not_found', 'No such agent of yours');
    if (role == null) {
      this.pc.tx(() => { this.q.delMember.run(t.id, a.id); const s = this.q.space.get('team', t.id); if (s) this.q.unassign.run(a.id, s.id); });
    } else {
      if (!ROLES.includes(role)) throw new PcError(400, 'bad_role', 'A member is lead, member or viewer');
      if (!this.q.member.get(t.id, a.id) && this.q.members.all(t.id).length >= 100) throw new PcError(409, 'too_many', 'A team has at most 100 members');
      this.q.putMember.run(t.id, a.id, role, this.now());
    }
    this.emit(c.account, { kind: 'teams' });
    return this.teamOut(this.q.team.get(t.id));
  }

  // ------------------------------------------------------------------------------------------- boards
  /** The board of a space: an agent's own ('~') or a team's ('/teams/<slug>' or o.space). */
  boardSpace(c, where = '~', o = {}) {
    const r = this.resolve(c, where || '~', o);
    if (r.virtual) throw new PcError(400, 'bad_board', 'A board is an agent\'s own (~) or a team\'s (/teams/<team>)');
    if (c.kind === 'visitor') throw notFound(where);
    return r;
  }
  cardOut(k, s) {
    return { id: k.id, col: k.col, title: k.title, notes: k.notes, assignee: k.assignee, due: k.due, pos: k.pos, by: k.created_by, created: k.created, updated: k.updated,
      done: k.done_at, work: k.work ? safeJson(k.work) : null, board: s ? this.viewOf(s, []) : undefined, space: k.space_id };
  }
  board(who, where = '~', o = {}) {
    const c = this.caller(who);
    const r = this.boardSpace(c, where, o);
    return { board: r.view, space: r.space.id, access: r.access, columns: COLUMNS.map(id => ({ id, name: COLUMN_NAMES[id] })), cards: this.q.cards.all(r.space.id).map(k => this.cardOut(k, r.space)) };
  }
  /** The open tasks given to an agent, on every board it reaches. */
  myTasks(who) {
    const c = this.caller(who);
    if (c.kind !== 'agent') return [];
    return this.q.assigned.all(c.agent).map(k => ({ k, s: this.q.spaceById.get(k.space_id) })).filter(x => this.access(c, x.s)).map(x => this.cardOut(x.k, x.s));
  }
  checkAssignee(c, s, agentId) {
    if (agentId == null) return null;
    const a = this.agents.get(Number(agentId));
    if (!a || this.accountOf(a) !== c.account) throw new PcError(404, 'not_found', 'No such agent here');
    if (s.kind === 'agent') { if (a.id !== s.ref) throw new PcError(400, 'not_member', 'A task on an agent\'s own board is that agent\'s'); return a.id; }
    const m = this.q.member.get(s.ref, a.id);
    if (!m) throw new PcError(400, 'not_member', `${a.name} isn't in this team`);
    if (m.role === 'viewer') throw new PcError(400, 'viewer', `${a.name} only views this team: give the task to a member`);
    return a.id;
  }
  addCard(who, where, { title, notes = '', assignee = null, due = null, col = 'todo' } = {}, o = {}) {
    const c = this.caller(who);
    const r = this.boardSpace(c, where, o);
    if (r.access !== 'rw') throw new PcError(403, 'read_only', 'This board can only be read');
    const tt = line(title, TITLE_MAX);
    if (!tt) throw new PcError(400, 'nothing', 'Give the task a title');
    if (!COLUMNS.includes(col)) throw new PcError(400, 'bad_column', `A column is one of: ${COLUMNS.join(', ')}`);
    if (this.q.cards.all(r.space.id).length >= 2000) throw new PcError(409, 'too_many', 'A board holds at most 2,000 tasks: finish or delete some');
    const who2 = assignee === 'me' ? c.agent : assignee;
    const as = r.space.kind === 'agent' && who2 == null ? r.space.ref : this.checkAssignee(c, r.space, who2);
    const t = this.now();
    const id = Number(this.q.addCard.run(r.space.id, col, tt, clean(notes, NOTES_MAX), as, dueOf(due), this.q.lastPos.get(r.space.id, col).p + 1, c.tag, t, t, col === 'done' ? t : null).lastInsertRowid);
    const k = this.cardOut(this.q.card.get(id), r.space);
    this.changed(c, r.space, { kind: 'board', card: id, assignee: as }, `Added the task #${id} "${short(tt, 60)}" to ${boardName(r.view)}`, 'board');
    this.cardHook({ card: k, by: c, assignee: as, wasAssignee: null, created: true });
    return k;
  }
  cardFor(c, id, rw = true) {
    const k = this.q.card.get(Number(id));
    const s = k && this.q.spaceById.get(k.space_id);
    const acc = k ? this.access(c, s) : null;
    if (!acc) throw new PcError(404, 'not_found', `There is no task #${id}`);
    if (rw && acc !== 'rw') throw new PcError(403, 'read_only', 'This board can only be read');
    return { k, s };
  }
  card(who, id) { const c = this.caller(who); const { k, s } = this.cardFor(c, id, false); return this.cardOut(k, s); }
  /** Changes a task: col (moves it, to the end of that column unless pos), title, notes (o.addNote appends a line),
   *  assignee, due, work (what a work session left). */
  updateCard(who, id, patch = {}) {
    const c = this.caller(who);
    const { k, s } = this.cardFor(c, id);
    const col = patch.col !== undefined ? String(patch.col) : k.col;
    if (!COLUMNS.includes(col)) throw new PcError(400, 'bad_column', `A column is one of: ${COLUMNS.join(', ')}`);
    const title = patch.title !== undefined ? line(patch.title, TITLE_MAX) || k.title : k.title;
    let notes = patch.notes !== undefined ? clean(patch.notes, NOTES_MAX) : k.notes;
    if (patch.addNote) notes = clean(`${notes}${notes ? '\n' : ''}${clean(patch.addNote, 1000).trim()}`, NOTES_MAX);
    const assignee = patch.assignee !== undefined ? (s.kind === 'agent' ? s.ref : this.checkAssignee(c, s, patch.assignee === 'me' ? c.agent : patch.assignee)) : k.assignee;
    const due = patch.due !== undefined ? dueOf(patch.due) : k.due;
    const pos = Number.isFinite(Number(patch.pos)) ? Number(patch.pos) : col !== k.col ? this.q.lastPos.get(s.id, col).p + 1 : k.pos;
    const doneAt = col === 'done' ? (k.col === 'done' ? k.done_at : this.now()) : null;
    const work = patch.work !== undefined ? (patch.work ? JSON.stringify(patch.work).slice(0, 4000) : null) : k.work;
    this.q.setCard.run(col, title, notes, assignee, due, pos, this.now(), doneAt, work, k.id);
    const what = col !== k.col ? `Moved the task #${k.id} "${short(title, 60)}" to ${COLUMN_NAMES[col]}` : assignee !== k.assignee ? `Gave the task #${k.id} to ${assignee == null ? 'no one' : this.agents.get(assignee)?.name || 'someone'}` : `Updated the task #${k.id}`;
    this.changed(c, s, { kind: 'board', card: k.id, assignee, col, was: k.col, wasAssignee: k.assignee }, what, 'board');
    const out = this.cardOut(this.q.card.get(k.id), s);
    this.cardHook({ card: out, by: c, assignee, wasAssignee: k.assignee, created: false });
    return out;
  }
  /** Tells the work sessions (./work.js) a task changed; never fails the change itself. */
  cardHook(e) { try { this.onCard?.(e); } catch (err) { this.log?.warn?.('[pc] a task hook failed', err.message); } }
  removeCard(who, id) {
    const c = this.caller(who);
    const { k, s } = this.cardFor(c, id);
    this.q.delCard.run(k.id);
    this.changed(c, s, { kind: 'board', card: k.id }, `Deleted the task #${k.id}`, 'board');
    return { deleted: k.id };
  }

  // ------------------------------------------------------------------------------------------- calendars
  eventOut(e, s) {
    return { id: e.id, title: e.title, start: e.start, end: e.end, allDay: !!e.all_day, place: e.place, notes: e.notes, by: e.created_by, calendar: s ? this.viewOf(s, []) : undefined, space: e.space_id };
  }
  /** Events from..to in the calendars the caller reaches (o.where: one calendar). */
  events(who, from, to, o = {}) {
    const c = this.caller(who);
    if (c.kind === 'visitor') return { events: [] };
    const a = Number(from), b = Number(to);
    if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a || b - a > 400 * 86400000) throw new PcError(400, 'bad_range', 'Give a range of at most 400 days');
    const spaces = o.where ? [this.boardSpace(c, o.where, o).space] : this.reachable(c, o.profile).map(x => x.space);
    const out = [];
    for (const s of spaces) for (const e of this.q.events.all(s.id, a, b)) out.push(this.eventOut(e, s));
    out.sort((x, y) => x.start - y.start);
    return { events: out.slice(0, 500) };
  }
  addEvent(who, where, { title, start, end, allDay = false, place = '', notes = '' } = {}, o = {}) {
    const c = this.caller(who);
    const r = this.boardSpace(c, where, o);
    if (r.access !== 'rw') throw new PcError(403, 'read_only', 'This calendar can only be read');
    const tt = line(title, TITLE_MAX);
    if (!tt) throw new PcError(400, 'nothing', 'Give the event a title');
    const s0 = Number(start), e0 = end == null ? s0 + 3600000 : Number(end);
    if (!Number.isFinite(s0) || !Number.isFinite(e0) || e0 < s0 || e0 - s0 > 31 * 86400000) throw new PcError(400, 'bad_time', 'An event needs a start, and an end after it (at most 31 days later)');
    const t = this.now();
    const id = Number(this.q.addEvent.run(r.space.id, tt, s0, e0, allDay ? 1 : 0, line(place, PLACE_MAX), clean(notes, NOTES_MAX), c.tag, t, t).lastInsertRowid);
    this.changed(c, r.space, { kind: 'calendar', event: id }, `Put "${short(tt, 60)}" on ${boardName(r.view, 'calendar')}`, 'calendar');
    return this.eventOut(this.q.event.get(id), r.space);
  }
  eventFor(c, id) {
    const e = this.q.event.get(Number(id));
    const s = e && this.q.spaceById.get(e.space_id);
    const acc = e ? this.access(c, s) : null;
    if (!acc) throw new PcError(404, 'not_found', `There is no event #${id}`);
    if (acc !== 'rw') throw new PcError(403, 'read_only', 'This calendar can only be read');
    return { e, s };
  }
  updateEvent(who, id, patch = {}) {
    const c = this.caller(who);
    const { e, s } = this.eventFor(c, id);
    const n = { title: patch.title !== undefined ? line(patch.title, TITLE_MAX) || e.title : e.title, start: patch.start !== undefined ? Number(patch.start) : e.start,
      end: patch.end !== undefined ? Number(patch.end) : e.end, allDay: patch.allDay !== undefined ? !!patch.allDay : !!e.all_day,
      place: patch.place !== undefined ? line(patch.place, PLACE_MAX) : e.place, notes: patch.notes !== undefined ? clean(patch.notes, NOTES_MAX) : e.notes };
    if (patch.start !== undefined && patch.end === undefined) n.end = n.start + (e.end - e.start);
    if (!Number.isFinite(n.start) || !Number.isFinite(n.end) || n.end < n.start || n.end - n.start > 31 * 86400000) throw new PcError(400, 'bad_time', 'An event needs a start, and an end after it');
    this.q.setEvent.run(n.title, n.start, n.end, n.allDay ? 1 : 0, n.place, n.notes, this.now(), e.id);
    this.changed(c, s, { kind: 'calendar', event: e.id }, `Changed "${short(n.title, 60)}"`, 'calendar');
    return this.eventOut(this.q.event.get(e.id), s);
  }
  removeEvent(who, id) {
    const c = this.caller(who);
    const { e, s } = this.eventFor(c, id);
    this.q.delEvent.run(e.id);
    this.changed(c, s, { kind: 'calendar', event: e.id }, `Took "${short(e.title, 60)}" off the calendar`, 'calendar');
    return { deleted: e.id };
  }

  // ------------------------------------------------------------------------------------------- activity, screens
  /**
   * What its screen shows now (owner-only: the frame goes to its account alone): the app, a line of what it did, and the
   * window open (./views.js - a file, a folder, a board, a page…). o.log: lines its terminal gets (the command and what it
   * said); o.view: the window - none given, its terminal when lines came, else the window that was open stays. o.soft: it
   * only sets the scene (and so is a step that brings only terminal lines): within HOLD_MS of a window it works in, that
   * window stays up and the lines go to its terminal alone - a quick command between two pages never covers the page.
   */
  screen(agentId, app, title, detail = '', o = {}) {
    const a = this.agents.get(agentId);
    const account = this.accountOf(a);
    if (account == null) return;
    if (o.log?.length) {
      const t = this.terms.get(a.id) || [];
      for (const l of o.log) for (const x of String(l ?? '').split('\n').slice(0, 6)) t.push(short(x.replace(/\t/g, '  '), 160));
      this.terms.set(a.id, t.slice(-TERM_LINES));
    }
    const prev = this.screens.get(a.id);
    const soft = !!o.soft || (!o.view && !!o.log?.length);
    if (soft && prev && !prev.soft && prev.view && prev.view.kind !== 'terminal' && this.now() - prev.at < HOLD_MS) return;
    const view = o.view ? capView(o.view) : o.log?.length ? { kind: 'terminal', lines: (this.terms.get(a.id) || []).slice() } : prev?.view || null;
    const st = { agent: a.id, app, title: short(line(title, 200), 120), detail: short(line(detail, 400), 240), view, at: this.now(), ...(soft ? { soft: true } : {}) };
    this.screens.set(a.id, st);
    this.emit(account, { kind: 'screen', screen: st });
  }
  screenOf(agentId) { return this.screens.get(Number(agentId)) || null; }
  note(c, app, what) {
    if (!what) return;
    const agent = c.kind === 'human' ? null : c.agent;
    const id = Number(this.q.addActivity.run(c.account, agent, this.now(), app, short(line(what, 300), 300)).lastInsertRowid);
    this.emit(c.account, { kind: 'activity', item: { id, agent, by: c.tag, at: this.now(), app, what: short(line(what, 300), 300) } });
    if (agent != null) this.screen(agent, app, what);
  }
  activity(who, { agent = null, before = null, limit = 50 } = {}) {
    const c = this.caller(who);
    const b = Number.isInteger(before) ? before : 2 ** 53;
    const n = Math.max(1, Math.min(ACTIVITY_MAX, limit));
    if (c.kind === 'agent') return this.q.activity.all(c.agent, b, n).map(actOut);
    if (c.kind !== 'human') return [];
    if (agent != null) {
      const a = this.agents.get(Number(agent));
      if (!a || this.accountOf(a) !== c.account) throw new PcError(404, 'not_found', 'No such agent');
      return this.q.activity.all(a.id, b, n).map(actOut);
    }
    return this.q.accountActivity.all(c.account, b, n).map(actOut);
  }
  /** A page an agent opened (kept as its link, title and a short summary; the newest browseKeep). */
  visited(agentId, url, title, summary = '') {
    this.q.addBrowse.run(agentId, this.now(), String(url).slice(0, 2000), line(title, 200), line(summary, 500));
    this.q.trimBrowse.run(agentId, agentId, this.limits().browseKeep);
  }
  history(who, { agent = null, limit = 50 } = {}) {
    const c = this.caller(who);
    const id = c.kind === 'human' ? Number(agent) : c.agent;
    if (c.kind === 'visitor') return [];
    if (c.kind === 'human') { const a = this.agents.get(id); if (!a || this.accountOf(a) !== c.account) throw new PcError(404, 'not_found', 'No such agent'); }
    return this.q.browse.all(id, Math.max(1, Math.min(500, limit))).map(r => ({ id: r.id, at: r.at, url: r.url, title: r.title, summary: r.summary }));
  }

  // ------------------------------------------------------------------------------------------- upkeep
  emit(account, frame) { try { this.emitFn(account, { t: 'pc', ...frame }); } catch (e) { this.log?.warn?.('[pc] emit', e.message); } }
  changed(c, s, frame, what, app) {
    this.emit(s.account_id, { ...frame, space: s.id });
    if (what) this.note(c, app, what);
  }
  /** The daily upkeep: trash and versions past keepDays, done tasks after 30 days, old events and activity, the homes
   *  of agents that are gone and deleted teams (after keepDays), then contents nobody points at. */
  gc() {
    const l = this.limits(), t = this.now(), keep = l.keepDays * 86400000;
    let trash = 0, versions = 0, spaces = 0;
    for (;;) {
      const rows = this.q.oldTrash.all(t - keep);
      if (!rows.length) break;
      this.pc.tx(() => { for (const n of rows) { this.purge(n); trash++; } });
      if (rows.length < 200) break;
    }
    for (;;) {
      const rows = this.q.oldVersions.all(t - keep);
      if (!rows.length) break;
      this.pc.tx(() => { for (const v of rows) { this.blobs.unref(v.blob); this.q.delVersion.run(v.id); versions++; } });
      if (rows.length < 500) break;
    }
    this.q.oldDone.run(t - 30 * 86400000);
    this.q.oldEvents.run(t - 365 * 86400000);
    this.q.oldActivity.run(t - l.activityDays * 86400000);
    // homes of agents no longer here, and deleted teams' spaces
    const live = new Set(this.agents.list().filter(a => !a.deleted).map(a => a.id));
    for (const s of this.q.allSpaces.all()) {
      if (s.kind === 'agent' && !live.has(s.ref) && !s.gone) this.q.spaceGone.run(t, s.id);
      if (s.gone && s.gone < t - keep) { this.dropSpace(s); spaces++; }
    }
    for (const tm of this.q.oldTeams.all(t - keep)) {
      const s = this.q.space.get('team', tm.id);
      if (s) { this.dropSpace(s); spaces++; }
      this.q.delTeam.run(tm.id);
    }
    const swept = this.blobs.sweep();
    const strays = this.blobs.sweepFiles();
    return { trash, versions, spaces, blobs: swept.n, bytes: swept.bytes, strays };
  }
  dropSpace(s) {
    this.pc.tx(() => {
      const roots = this.db.prepare('SELECT * FROM nodes WHERE space_id = ? AND parent = 0').all(s.id);
      for (const n of roots) this.purge(n);
      this.db.prepare('DELETE FROM nodes WHERE space_id = ?').run(s.id);   // (orphans of an interrupted move, if any)
      if (s.kind === 'agent') { this.q.delBrowse.run(s.ref); this.q.delAgentMembers.run(s.ref); }
      this.db.prepare('DELETE FROM spaces WHERE id = ?').run(s.id);
    });
  }
  /** Counts every space's bytes again from its files (the stress run and the tests compare it with `used`). */
  recount() {
    const out = [];
    for (const s of this.q.allSpaces.all()) {
      const live = this.db.prepare('SELECT * FROM nodes WHERE space_id = ? AND dir = 0 AND trashed IS NULL').all(s.id).filter(n => this.visible(n));
      out.push({ id: s.id, used: s.used, counted: live.reduce((x, n) => x + n.size, 0) });
    }
    return out;
  }
}

const actOut = r => ({ id: r.id, agent: r.agent_id, at: r.at, app: r.app, what: r.what });
/** The words of a text as the search index keeps them: lower case, accents taken off, letters and digits only. */
const wordsOf = t => String(t ?? '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').match(/[\p{L}\p{N}]+/gu) || [];
/** A text's words, each marked with its space: "s12xreport s12xq3". */
const marked = (t, spaceId) => { const p = `s${spaceId}x`; return wordsOf(t).map(w => p + w.slice(0, 60)).join(' '); };
function notFound(p, hint = '') {
  return new PcError(404, 'not_found', `No such file or folder: ${String(p ?? '').slice(0, 200)}${hint ? `. ${hint}` : ''}`, { hint });
}
const short = (s, n) => { const t = String(s ?? ''); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
export const mbText = b => (b >= 1048576 ? `${(b / 1048576).toFixed(b >= 10485760 ? 0 : 1)} MB` : b >= 1024 ? `${Math.round(b / 1024)} KB` : `${b} bytes`);
const describe = (mime, size) => `${/^image\//.test(mime) ? 'a picture' : mime === 'application/pdf' ? 'a PDF' : /^audio\//.test(mime) ? 'a recording' : /^video\//.test(mime) ? 'a video' : 'not text'} (${mbText(size)})`;
const withSuffix = (name, suf) => { const m = /^(.*?)(\.[A-Za-z0-9]{1,8})?$/.exec(name); return `${m[1]}${suf}${m[2] || ''}`.slice(0, NAME_MAX); };
const boardName = (view, what = 'board') => (view === '~' ? `its own ${what}` : `the ${view.replace('/teams/', '')} team's ${what}`);
const colorOf = s => (/^#[0-9a-f]{6}$/i.test(String(s || '')) ? String(s).toLowerCase() : '');
const safeJson = s => { try { return JSON.parse(s); } catch { return null; } };
function dueOf(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 8.64e15) throw new PcError(400, 'bad_time', 'A due date is a time');
  return Math.round(n);
}
/** Edit distance (for "did you mean"), bounded to short names. */
function distance(a, b) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 8 || a.length > 64 || b.length > 64) return 99;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

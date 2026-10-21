// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The agents' PC database (docs/features/agent-pc.md §6): <data>/pc/pc.db, apart from next.db so a busy PC never slows
// the world's own writes and the world's backups stay small. node:sqlite, WAL, versioned migrations (append only, each
// moves PRAGMA user_version one up). Every row belongs to one account; times are Unix milliseconds.
//   spaces   a home (kind 'agent', ref = the agent) or a team's space (kind 'team', ref = the team); used = bytes of its
//            live files (kept up to date by every write, checked again by recount())
//   nodes    the tree: parent 0 is the space's root; a trashed node hides its whole subtree; name_key is the name folded
//            for "one name per folder"; blob is the content's fingerprint (sha256), stored once in blobs
//   blobs    content by fingerprint, refs = nodes + versions pointing at it; small ones in `data` (compressed when it
//            pays), big ones in the file store (server/pc/blobs.js)
//   versions what a file was before each change (the newest 20 for 30 days by default)
//   fts      the words of text files and every name (contentless: the text itself is not kept twice), each word marked
//            with its space ("s12xreport"): a search reads only the spaces the caller reaches, however many there are
//   cards / events   the boards and calendars, one of each per space
//   teams / members  an account's teams and who is in them (lead, member, viewer)
//   activity what agents did on the PC (7 days)
//   profiles an agent's own PC settings (whether it starts on tasks given to it by itself)
//   browse   pages an agent opened: link, title and a short summary only
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from '../sqlite.js';

export const PC_DB = 'pc.db';

const MIGRATIONS = [
  // v1
  `CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
   CREATE TABLE spaces (
     id INTEGER PRIMARY KEY,
     account_id INTEGER NOT NULL,
     kind TEXT NOT NULL CHECK (kind IN ('agent', 'team')),
     ref INTEGER NOT NULL,
     used INTEGER NOT NULL DEFAULT 0,
     gone INTEGER,
     created INTEGER NOT NULL
   );
   CREATE UNIQUE INDEX spaces_ref ON spaces (kind, ref);
   CREATE INDEX spaces_account ON spaces (account_id);
   CREATE TABLE blobs (
     sha TEXT PRIMARY KEY,
     size INTEGER NOT NULL,
     stored TEXT NOT NULL CHECK (stored IN ('db', 'disk')),
     codec TEXT NOT NULL CHECK (codec IN ('none', 'zstd')),
     data BLOB,
     refs INTEGER NOT NULL DEFAULT 0,
     created INTEGER NOT NULL
   );
   CREATE INDEX blobs_unused ON blobs (refs) WHERE refs <= 0;
   CREATE TABLE nodes (
     id INTEGER PRIMARY KEY,
     space_id INTEGER NOT NULL REFERENCES spaces (id) ON DELETE CASCADE,
     parent INTEGER NOT NULL,
     name TEXT NOT NULL,
     name_key TEXT NOT NULL,
     dir INTEGER NOT NULL DEFAULT 0,
     system INTEGER NOT NULL DEFAULT 0,
     blob TEXT,
     size INTEGER NOT NULL DEFAULT 0,
     mime TEXT,
     version INTEGER NOT NULL DEFAULT 0,
     created INTEGER NOT NULL,
     modified INTEGER NOT NULL,
     by TEXT NOT NULL,
     trashed INTEGER,
     trash_path TEXT
   );
   CREATE UNIQUE INDEX nodes_name ON nodes (space_id, parent, name_key) WHERE trashed IS NULL;
   CREATE INDEX nodes_parent ON nodes (space_id, parent);
   CREATE INDEX nodes_trash ON nodes (space_id, trashed) WHERE trashed IS NOT NULL;
   CREATE TABLE versions (
     id INTEGER PRIMARY KEY,
     node_id INTEGER NOT NULL,
     version INTEGER NOT NULL,
     blob TEXT NOT NULL,
     size INTEGER NOT NULL,
     at INTEGER NOT NULL,
     by TEXT NOT NULL
   );
   CREATE INDEX versions_node ON versions (node_id, version);
   CREATE VIRTUAL TABLE fts USING fts5 (name, body, tokenize = 'unicode61', content = '', contentless_delete = 1, detail = 'column');
   CREATE TABLE cards (
     id INTEGER PRIMARY KEY,
     space_id INTEGER NOT NULL REFERENCES spaces (id) ON DELETE CASCADE,
     col TEXT NOT NULL CHECK (col IN ('todo', 'doing', 'review', 'done')),
     title TEXT NOT NULL,
     notes TEXT NOT NULL DEFAULT '',
     assignee INTEGER,
     due INTEGER,
     pos REAL NOT NULL,
     created_by TEXT NOT NULL,
     created INTEGER NOT NULL,
     updated INTEGER NOT NULL,
     done_at INTEGER,
     work TEXT
   );
   CREATE INDEX cards_space ON cards (space_id, col, pos);
   CREATE INDEX cards_assignee ON cards (assignee, col);
   CREATE TABLE events (
     id INTEGER PRIMARY KEY,
     space_id INTEGER NOT NULL REFERENCES spaces (id) ON DELETE CASCADE,
     title TEXT NOT NULL,
     start INTEGER NOT NULL,
     end INTEGER NOT NULL,
     all_day INTEGER NOT NULL DEFAULT 0,
     place TEXT NOT NULL DEFAULT '',
     notes TEXT NOT NULL DEFAULT '',
     created_by TEXT NOT NULL,
     created INTEGER NOT NULL,
     updated INTEGER NOT NULL
   );
   CREATE INDEX events_space ON events (space_id, start);
   CREATE TABLE teams (
     id INTEGER PRIMARY KEY,
     account_id INTEGER NOT NULL,
     name TEXT NOT NULL,
     slug TEXT NOT NULL,
     brief TEXT NOT NULL DEFAULT '',
     color TEXT NOT NULL DEFAULT '',
     office TEXT,
     gone INTEGER,
     created INTEGER NOT NULL,
     updated INTEGER NOT NULL
   );
   CREATE UNIQUE INDEX teams_slug ON teams (account_id, slug) WHERE gone IS NULL;
   CREATE TABLE members (
     team_id INTEGER NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
     agent_id INTEGER NOT NULL,
     role TEXT NOT NULL CHECK (role IN ('lead', 'member', 'viewer')),
     added INTEGER NOT NULL,
     PRIMARY KEY (team_id, agent_id)
   );
   CREATE INDEX members_agent ON members (agent_id);
   CREATE TABLE activity (
     id INTEGER PRIMARY KEY,
     account_id INTEGER NOT NULL,
     agent_id INTEGER,
     at INTEGER NOT NULL,
     app TEXT NOT NULL,
     what TEXT NOT NULL
   );
   CREATE INDEX activity_agent ON activity (agent_id, at);
   CREATE INDEX activity_account ON activity (account_id, at);
   CREATE TABLE profiles (
     agent_id INTEGER PRIMARY KEY,
     auto_work INTEGER NOT NULL DEFAULT 1,
     updated INTEGER NOT NULL
   );
   CREATE TABLE browse (
     id INTEGER PRIMARY KEY,
     agent_id INTEGER NOT NULL,
     at INTEGER NOT NULL,
     url TEXT NOT NULL,
     title TEXT NOT NULL,
     summary TEXT NOT NULL DEFAULT ''
   );
   CREATE INDEX browse_agent ON browse (agent_id, at);`,
];

export const PC_SCHEMA = MIGRATIONS.length;

function migrate(db) {
  const at = db.prepare('PRAGMA user_version').get().user_version;
  if (at > MIGRATIONS.length) throw new Error(`${PC_DB} is schema ${at}, newer than this release knows (${MIGRATIONS.length})`);
  for (let v = at; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (e) {
      if (db.isTransaction) db.exec('ROLLBACK');
      throw new Error(`${PC_DB} migration to v${v + 1} failed: ${e.message}`);
    }
  }
}

/** Opens (or creates) <dir>/pc.db. Returns { db, file, tx(fn), close() }. */
export function openPcDb(dir, { worldId = null } = {}) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, PC_DB);
  const fresh = !fs.existsSync(file);
  if (fresh) { fs.closeSync(fs.openSync(file, 'a', 0o600)); }
  const db = new DatabaseSync(file, { enableForeignKeyConstraints: true, timeout: 5000 });
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  migrate(db);
  // one world per PC database: a copy of another world's data folder must not mix two worlds' files
  const has = db.prepare("SELECT value FROM meta WHERE key = 'world_id'").get()?.value;
  if (!has && worldId) db.prepare("INSERT INTO meta (key, value) VALUES ('world_id', ?)").run(String(worldId));
  else if (has && worldId && has !== String(worldId)) throw new Error(`${file} belongs to another world (${has}); this world is ${worldId}`);
  let depth = 0;
  return {
    db, file,
    /** fn inside one transaction (a savepoint inside an open one). */
    tx(fn) {
      if (db.isTransaction) {
        const sp = `pc${++depth}`;
        db.exec(`SAVEPOINT ${sp}`);
        try { const r = fn(); db.exec(`RELEASE ${sp}`); return r; } catch (e) {
          if (db.isTransaction) { db.exec(`ROLLBACK TO ${sp}`); db.exec(`RELEASE ${sp}`); }
          throw e;
        } finally { depth--; }
      }
      db.exec('BEGIN IMMEDIATE');
      try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { if (db.isTransaction) db.exec('ROLLBACK'); throw e; }
    },
    close() { try { db.close(); } catch { /* closed already */ } },
  };
}

// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The accounts database: <data>/next.db through node:sqlite (WAL, foreign keys, versioned migrations, online backup).
// World geometry stays in the JSON files. Every row carries the world id (meta.world_id), so several worlds could share
// one database later without a migration (DECISIONS C59).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync, backup } from './sqlite.js';

export const DB_FILE = 'next.db';

// Append only. Each entry moves the schema one version up (PRAGMA user_version). additive: the migration only adds
// tables, indexes, triggers or columns with defaults, so a release that knows an older schema can still run on the
// database once its schema number is lowered (tools/deploy/dbschema.mjs, DECISIONS C84). Migrations from v2 on can run
// again harmlessly (rolling forward after such a rollback). Times are Unix milliseconds.
const MIGRATIONS = [
  // v1: the base schema.
  { additive: false, up: `CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
   CREATE TABLE accounts (
     id INTEGER PRIMARY KEY,
     world_id TEXT NOT NULL,
     login TEXT NOT NULL,
     display_name TEXT NOT NULL,
     display_key TEXT NOT NULL,
     email TEXT,
     role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
     status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
     password_hash TEXT NOT NULL,
     must_change INTEGER NOT NULL DEFAULT 0,
     temp_expires INTEGER,
     failed_count INTEGER NOT NULL DEFAULT 0,
     locked_until INTEGER NOT NULL DEFAULT 0,
     password_changed INTEGER NOT NULL,
     created INTEGER NOT NULL,
     updated INTEGER NOT NULL
   );
   CREATE UNIQUE INDEX accounts_login ON accounts (world_id, login);
   CREATE UNIQUE INDEX accounts_display ON accounts (world_id, display_key);
   CREATE UNIQUE INDEX accounts_one_owner ON accounts (world_id) WHERE role = 'owner';
   CREATE TABLE sessions (
     id INTEGER PRIMARY KEY,
     world_id TEXT NOT NULL,
     token_hash TEXT NOT NULL UNIQUE,
     account_id INTEGER NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
     csrf TEXT NOT NULL,
     created INTEGER NOT NULL,
     last_seen INTEGER NOT NULL,
     auth_at INTEGER NOT NULL,
     ip TEXT,
     user_agent TEXT
   );
   CREATE INDEX sessions_account ON sessions (account_id);
   CREATE TABLE capability_overrides (
     world_id TEXT NOT NULL,
     cap TEXT NOT NULL,
     min_role TEXT NOT NULL,
     updated INTEGER NOT NULL,
     updated_by INTEGER,
     PRIMARY KEY (world_id, cap)
   );
   CREATE TABLE settings (
     world_id TEXT NOT NULL,
     key TEXT NOT NULL,
     value TEXT NOT NULL,
     PRIMARY KEY (world_id, key)
   );` },
  // v2: sign-in failure counters per client address, per account (or unknown name) and address, and per account, kept
  // across restarts (DECISIONS C71). They replace accounts.failed_count / locked_until, which are no longer used.
  { additive: true, up: `CREATE TABLE IF NOT EXISTS auth_failures (
     world_id TEXT NOT NULL,
     key TEXT NOT NULL,
     count INTEGER NOT NULL,
     first INTEGER NOT NULL,
     locked_until INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (world_id, key)
   );` },
  // v3 (WP1.4): the append-only audit log (C74, C75, C78), invites, two-factor sign-in (C77, C81), and
  // sessions.needs_twofa, set at sign-in when two-factor is required for the account and not set up yet (C77).
  {
    additive: true,
    up: db => {
      db.exec(`CREATE TABLE IF NOT EXISTS audit (
     id INTEGER PRIMARY KEY,
     world_id TEXT NOT NULL,
     at INTEGER NOT NULL,
     actor_id INTEGER,
     actor_login TEXT,
     action TEXT NOT NULL,
     target_id INTEGER,
     target_login TEXT,
     ip TEXT,
     detail TEXT,
     prev_hash TEXT NOT NULL,
     hash TEXT NOT NULL
   );
   CREATE INDEX IF NOT EXISTS audit_at ON audit (world_id, at);
   CREATE INDEX IF NOT EXISTS audit_action ON audit (world_id, action, at);
   CREATE TABLE IF NOT EXISTS audit_purge (ok INTEGER);
   CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit BEGIN SELECT RAISE(ABORT, 'the audit log is append-only'); END;
   CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit WHEN NOT EXISTS (SELECT 1 FROM audit_purge)
     BEGIN SELECT RAISE(ABORT, 'the audit log is append-only'); END;
   CREATE TABLE IF NOT EXISTS invites (
     id INTEGER PRIMARY KEY,
     world_id TEXT NOT NULL,
     token_hash TEXT NOT NULL UNIQUE,
     role TEXT NOT NULL CHECK (role IN ('admin', 'member')),
     note TEXT,
     created_by INTEGER,
     created INTEGER NOT NULL,
     expires INTEGER NOT NULL,
     used_by INTEGER,
     used_at INTEGER,
     revoked_at INTEGER
   );
   CREATE INDEX IF NOT EXISTS invites_world ON invites (world_id, created);
   CREATE TABLE IF NOT EXISTS twofa (
     account_id INTEGER PRIMARY KEY REFERENCES accounts (id) ON DELETE CASCADE,
     world_id TEXT NOT NULL,
     secret TEXT NOT NULL,
     enabled_at INTEGER,
     last_step INTEGER NOT NULL DEFAULT 0,
     created INTEGER NOT NULL
   );
   CREATE TABLE IF NOT EXISTS recovery_codes (
     id INTEGER PRIMARY KEY,
     account_id INTEGER NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
     code_hash TEXT NOT NULL,
     used_at INTEGER
   );
   CREATE INDEX IF NOT EXISTS recovery_account ON recovery_codes (account_id);`);
      if (!db.prepare("SELECT 1 FROM pragma_table_info('sessions') WHERE name = 'needs_twofa'").get()) {
        db.exec('ALTER TABLE sessions ADD COLUMN needs_twofa INTEGER NOT NULL DEFAULT 0');
      }
    },
  },
  // v4 (WP1.5): settings of each account (display preferences today; the account's own secrets later, sealed under
  // 'secret:<path>'); installation secrets and the recovery-code key live in settings under the same prefix (C85, C97).
  {
    additive: true,
    up: `CREATE TABLE IF NOT EXISTS account_settings (
     account_id INTEGER NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
     world_id TEXT NOT NULL,
     key TEXT NOT NULL,
     value TEXT NOT NULL,
     updated INTEGER NOT NULL,
     PRIMARY KEY (account_id, key)
   );`,
  },
  // v5 (WP1.6): recovery codes carry the world id like every other row of a world (DECISIONS C104).
  {
    additive: true,
    up: db => {
      const cols = db.prepare('PRAGMA table_info(recovery_codes)').all().map(c => c.name);
      if (!cols.includes('world_id')) db.exec("ALTER TABLE recovery_codes ADD COLUMN world_id TEXT NOT NULL DEFAULT ''");
      db.exec("UPDATE recovery_codes SET world_id = COALESCE((SELECT a.world_id FROM accounts a WHERE a.id = recovery_codes.account_id), '') WHERE world_id = ''");
    },
  },
  // v6 (WP1.8): the edit journal — every world edit with its account and the states before and after, for per-account
  // undo and redo, admin reverts and the activity log (DECISIONS C35, C116); edit_keys lists the states each changed.
  {
    additive: true,
    up: `CREATE TABLE IF NOT EXISTS edits (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     world_id TEXT NOT NULL,
     at INTEGER NOT NULL,
     acted_at INTEGER NOT NULL DEFAULT 0,
     actor_id INTEGER,
     actor_name TEXT NOT NULL,
     kind TEXT NOT NULL DEFAULT 'edit',
     summary TEXT NOT NULL,
     place_json TEXT,
     keys_json TEXT NOT NULL DEFAULT '[]',
     before_json TEXT NOT NULL DEFAULT '{}',
     after_json TEXT NOT NULL DEFAULT '{}',
     watch_json TEXT,
     undoable INTEGER NOT NULL DEFAULT 1,
     status TEXT NOT NULL DEFAULT 'done' CHECK (status IN ('done', 'undone', 'reverted')),
     undone_at INTEGER,
     redo_ok INTEGER NOT NULL DEFAULT 0,
     reverted_by INTEGER,
     ref INTEGER
   );
   CREATE INDEX IF NOT EXISTS edits_at ON edits (world_id, at);
   CREATE INDEX IF NOT EXISTS edits_actor ON edits (world_id, actor_id, status, id);
   CREATE TABLE IF NOT EXISTS edit_keys (edit_id INTEGER NOT NULL, world_id TEXT NOT NULL, key TEXT NOT NULL);
   CREATE INDEX IF NOT EXISTS edit_keys_key ON edit_keys (world_id, key, edit_id);
   CREATE INDEX IF NOT EXISTS edit_keys_edit ON edit_keys (edit_id);`,
  },
  // v7 (WP1.10): each account's player (where it stands, its look and camera), and friendships (DECISIONS C62, C118).
  {
    additive: true,
    up: `CREATE TABLE IF NOT EXISTS players (
     world_id TEXT NOT NULL,
     account_id INTEGER NOT NULL,
     x REAL NOT NULL, y REAL NOT NULL, z REAL NOT NULL,
     ctx INTEGER NOT NULL DEFAULT -1,
     yaw REAL NOT NULL DEFAULT 0,
     look_json TEXT,
     cam_json TEXT,
     needs_json TEXT,
     updated INTEGER NOT NULL,
     PRIMARY KEY (world_id, account_id)
   );
   CREATE TABLE IF NOT EXISTS friends (
     world_id TEXT NOT NULL,
     a INTEGER NOT NULL,
     b INTEGER NOT NULL,
     status TEXT NOT NULL CHECK (status IN ('pending', 'friends')),
     asked_by INTEGER NOT NULL,
     created INTEGER NOT NULL,
     updated INTEGER NOT NULL,
     PRIMARY KEY (world_id, a, b),
     CHECK (a < b)
   );
   CREATE INDEX IF NOT EXISTS friends_b ON friends (world_id, b);`,
  },
  // v8 (WP2.1): agent records owned by accounts (DECISIONS A6, A17, C60, E20) and their shares (use; manage). The id
  // is the agent's stable subject id: the economy's wallet, ledger, contracts, licences and progression (Virtual Coin,
  // Rep, XP, Civic Credit) get their own tables keyed by it later, never columns here. ext_json is the versioned
  // extension object reserved for them. body_ref, look_ref and desk_json are OPAQUE references the registry never reads
  // inside (the character system is being reworked); the resident body, home and desk stay in the world files.
  {
    additive: true,
    up: `CREATE TABLE IF NOT EXISTS agents (
     id INTEGER PRIMARY KEY,
     world_id TEXT NOT NULL,
     agent_key TEXT NOT NULL,
     owner_id INTEGER,
     connection_id INTEGER,
     native_id TEXT,
     name TEXT NOT NULL,
     emoji TEXT NOT NULL DEFAULT '',
     role TEXT NOT NULL DEFAULT '',
     body_ref TEXT,
     look_ref TEXT,
     desk_json TEXT,
     voice_json TEXT,
     ext_json TEXT NOT NULL DEFAULT '{"v":1}',
     enabled INTEGER NOT NULL DEFAULT 1,
     created INTEGER NOT NULL,
     updated INTEGER NOT NULL,
     deleted INTEGER
   );
   CREATE UNIQUE INDEX IF NOT EXISTS agents_key ON agents (world_id, agent_key);
   CREATE INDEX IF NOT EXISTS agents_owner ON agents (world_id, owner_id);
   CREATE TABLE IF NOT EXISTS agent_shares (
     world_id TEXT NOT NULL,
     agent_id INTEGER NOT NULL,
     kind TEXT NOT NULL CHECK (kind IN ('account', 'role')),
     who TEXT NOT NULL,
     level TEXT NOT NULL CHECK (level IN ('use', 'manage')),
     created INTEGER NOT NULL,
     PRIMARY KEY (world_id, agent_id, kind, who)
   );`,
  },
  // v9 (WP2.2): connections to agent platforms and model providers (per account or installation-wide; DECISIONS C60, A9), their
  // shares and sealed credentials, and the chat tables: sessions (private to an account and an agent, C119), references
  // (shared per agent, C53) and the attachment index (content-addressed per account, C121). Credentials are sealed with the
  // SecretBox and registered as the 'connections' holder, so rotation, re-sealing and staging copies reach them.
  {
    additive: true,
    up: `CREATE TABLE IF NOT EXISTS connections (
     id INTEGER PRIMARY KEY,
     world_id TEXT NOT NULL,
     kind TEXT NOT NULL,
     label TEXT NOT NULL,
     scope TEXT NOT NULL CHECK (scope IN ('account', 'installation')),
     owner_id INTEGER,
     config_json TEXT NOT NULL DEFAULT '{}',
     enabled INTEGER NOT NULL DEFAULT 1,
     status_json TEXT,
     created INTEGER NOT NULL,
     updated INTEGER NOT NULL,
     deleted INTEGER
   );
   CREATE INDEX IF NOT EXISTS connections_owner ON connections (world_id, owner_id);
   CREATE TABLE IF NOT EXISTS connection_shares (
     world_id TEXT NOT NULL,
     connection_id INTEGER NOT NULL,
     kind TEXT NOT NULL CHECK (kind IN ('account', 'role')),
     who TEXT NOT NULL,
     created INTEGER NOT NULL,
     PRIMARY KEY (world_id, connection_id, kind, who)
   );
   CREATE TABLE IF NOT EXISTS connection_secrets (
     world_id TEXT NOT NULL,
     connection_id INTEGER NOT NULL,
     field TEXT NOT NULL,
     sealed TEXT NOT NULL,
     PRIMARY KEY (world_id, connection_id, field)
   );
   CREATE TABLE IF NOT EXISTS chat_sessions (
     id INTEGER PRIMARY KEY,
     world_id TEXT NOT NULL,
     agent_id INTEGER NOT NULL,
     account_id INTEGER NOT NULL,
     native_key TEXT NOT NULL,
     label TEXT NOT NULL DEFAULT '',
     created INTEGER NOT NULL,
     updated INTEGER NOT NULL,
     deleted INTEGER
   );
   CREATE INDEX IF NOT EXISTS chat_sessions_owner ON chat_sessions (world_id, account_id, agent_id);
   CREATE TABLE IF NOT EXISTS chat_references (
     id INTEGER PRIMARY KEY,
     world_id TEXT NOT NULL,
     agent_id INTEGER NOT NULL,
     kind TEXT NOT NULL,
     ref_json TEXT NOT NULL,
     created_by INTEGER,
     created INTEGER NOT NULL
   );
   CREATE INDEX IF NOT EXISTS chat_references_agent ON chat_references (world_id, agent_id);
   CREATE TABLE IF NOT EXISTS attachments (
     id INTEGER PRIMARY KEY,
     world_id TEXT NOT NULL,
     account_id INTEGER NOT NULL,
     sha256 TEXT NOT NULL,
     name TEXT NOT NULL,
     mime TEXT NOT NULL,
     size INTEGER NOT NULL,
     created INTEGER NOT NULL
   );
   CREATE UNIQUE INDEX IF NOT EXISTS attachments_owner_hash ON attachments (world_id, account_id, sha256);`,
  },
  // v10 (WP2.14; DECISIONS E22, E23, C122 to C130): agents that connect outbound with a key they hold. A slot belongs to the owner's
  // account and keeps its name, history and settings when the key changes (C124); only the PUBLIC key is stored. Enrolment codes,
  // session tokens and nonces are stored hashed or as one-use values; nothing here is a secret that could impersonate an agent.
  {
    additive: true,
    up: `CREATE TABLE IF NOT EXISTS agent_slots (
     id INTEGER PRIMARY KEY,
     world_id TEXT NOT NULL,
     account_id INTEGER NOT NULL,
     name TEXT NOT NULL,
     name_key TEXT NOT NULL,
     agent_id INTEGER,
     pubkey TEXT,
     fingerprint TEXT,
     status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'revoked')),
     visibility TEXT NOT NULL DEFAULT 'hidden' CHECK (visibility IN ('hidden', 'friends', 'public')),
     chat_audience TEXT NOT NULL DEFAULT 'owner' CHECK (chat_audience IN ('owner', 'friends', 'everyone')),
     chat_paused INTEGER NOT NULL DEFAULT 0,
     appear_in_world INTEGER NOT NULL DEFAULT 0,
     created INTEGER NOT NULL,
     updated INTEGER NOT NULL,
     revoked INTEGER,
     last_seen INTEGER,
     last_ip_hash TEXT
   );
   CREATE UNIQUE INDEX IF NOT EXISTS agent_slots_name ON agent_slots (world_id, account_id, name_key);
   CREATE UNIQUE INDEX IF NOT EXISTS agent_slots_key ON agent_slots (world_id, fingerprint) WHERE fingerprint IS NOT NULL AND status != 'revoked';
   CREATE TABLE IF NOT EXISTS agent_enrol_codes (
     id INTEGER PRIMARY KEY,
     world_id TEXT NOT NULL,
     slot_id INTEGER NOT NULL,
     code_hash TEXT NOT NULL,
     created INTEGER NOT NULL,
     expires INTEGER NOT NULL,
     used INTEGER
   );
   CREATE UNIQUE INDEX IF NOT EXISTS agent_enrol_codes_hash ON agent_enrol_codes (code_hash);
   CREATE TABLE IF NOT EXISTS agent_sessions (
     id INTEGER PRIMARY KEY,
     world_id TEXT NOT NULL,
     slot_id INTEGER NOT NULL,
     token_hash TEXT NOT NULL,
     created INTEGER NOT NULL,
     expires INTEGER NOT NULL,
     last_seen INTEGER NOT NULL,
     ip_hash TEXT
   );
   CREATE UNIQUE INDEX IF NOT EXISTS agent_sessions_hash ON agent_sessions (token_hash);
   CREATE INDEX IF NOT EXISTS agent_sessions_slot ON agent_sessions (world_id, slot_id);
   CREATE TABLE IF NOT EXISTS agent_nonces (
     slot_id INTEGER NOT NULL,
     nonce TEXT NOT NULL,
     expires INTEGER NOT NULL,
     PRIMARY KEY (slot_id, nonce)
   );
   CREATE TABLE IF NOT EXISTS agent_queue (
     id INTEGER PRIMARY KEY,
     world_id TEXT NOT NULL,
     slot_id INTEGER NOT NULL,
     kind TEXT NOT NULL DEFAULT 'message' CHECK (kind IN ('message', 'stop', 'approval')),
     run_id TEXT NOT NULL,
     chat_session_id INTEGER NOT NULL DEFAULT 0,
     session_key TEXT,
     sender_account_id INTEGER NOT NULL DEFAULT 0,
     sender_name TEXT,
     visitor INTEGER NOT NULL DEFAULT 0,
     body TEXT NOT NULL DEFAULT '',
     created INTEGER NOT NULL,
     expires INTEGER NOT NULL,
     delivered INTEGER
   );
   CREATE INDEX IF NOT EXISTS agent_queue_slot ON agent_queue (world_id, slot_id, delivered);
   CREATE INDEX IF NOT EXISTS agent_queue_run ON agent_queue (world_id, run_id);
   CREATE TABLE IF NOT EXISTS agent_blocks (
     slot_id INTEGER NOT NULL,
     account_id INTEGER NOT NULL,
     created INTEGER NOT NULL,
     PRIMARY KEY (slot_id, account_id)
   );
   CREATE TABLE IF NOT EXISTS agent_reports (
     id INTEGER PRIMARY KEY,
     world_id TEXT NOT NULL,
     slot_id INTEGER NOT NULL,
     reporter_id INTEGER NOT NULL,
     reporter_name TEXT,
     run_id TEXT,
     reason TEXT NOT NULL,
     created INTEGER NOT NULL
   );
   CREATE TABLE IF NOT EXISTS agent_visits (
     slot_id INTEGER NOT NULL,
     account_id INTEGER NOT NULL,
     day INTEGER NOT NULL,
     n INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (slot_id, account_id, day)
   );`,
  },
  // WP4.13 (DECISIONS E25): property. Lots (land parcels: exact integer-µm polygons, never deleted, retired with lineage),
  // the current title of each lot, the append-only title history (the database refuses edits and deletions), delegated
  // rights and idempotency records for property operations. Commerce (listings, payments) gets its own tables later.
  {
    additive: true,
    up: `CREATE TABLE IF NOT EXISTS lots (
     id TEXT PRIMARY KEY,
     world_id TEXT NOT NULL,
     region TEXT NOT NULL DEFAULT 'main',
     block INTEGER,
     poly_json TEXT NOT NULL,
     area_twice TEXT NOT NULL,
     x0 INTEGER NOT NULL, z0 INTEGER NOT NULL, x1 INTEGER NOT NULL, z1 INTEGER NOT NULL,
     zoning TEXT NOT NULL DEFAULT 'mixed',
     lifecycle TEXT NOT NULL CHECK (lifecycle IN ('unreleased', 'available', 'reserved', 'owned', 'leased', 'permit', 'municipal', 'custodial', 'retired')),
     origins INTEGER NOT NULL DEFAULT 1 CHECK (origins >= 1),
     parents_json TEXT,
     children_json TEXT,
     frontage_json TEXT,
     access TEXT NOT NULL DEFAULT 'public' CHECK (access IN ('public', 'friends', 'private')),
     policy_version INTEGER NOT NULL DEFAULT 1,
     revision INTEGER NOT NULL DEFAULT 1,
     created INTEGER NOT NULL,
     retired INTEGER
   );
   CREATE INDEX IF NOT EXISTS lots_world ON lots (world_id, lifecycle);
   CREATE INDEX IF NOT EXISTS lots_box ON lots (world_id, x0, x1);
   CREATE TRIGGER IF NOT EXISTS lots_never_deleted BEFORE DELETE ON lots BEGIN SELECT RAISE(ABORT, 'lots are retired, never deleted'); END;
   CREATE TABLE IF NOT EXISTS lot_titles (
     lot_id TEXT PRIMARY KEY REFERENCES lots (id),
     world_id TEXT NOT NULL,
     holder_kind TEXT NOT NULL CHECK (holder_kind IN ('account', 'agent', 'business', 'municipality')),
     holder_id TEXT NOT NULL,
     event_seq INTEGER NOT NULL,
     since INTEGER NOT NULL
   );
   CREATE INDEX IF NOT EXISTS lot_titles_holder ON lot_titles (world_id, holder_kind, holder_id);
   CREATE TABLE IF NOT EXISTS title_events (
     seq INTEGER PRIMARY KEY AUTOINCREMENT,
     world_id TEXT NOT NULL,
     lot_id TEXT NOT NULL,
     kind TEXT NOT NULL CHECK (kind IN ('grant', 'transfer', 'merge', 'split', 'surrender', 'custodial_hold', 'release_hold', 'correction', 'retire')),
     from_kind TEXT, from_id TEXT,
     to_kind TEXT, to_id TEXT,
     related_json TEXT,
     actor_kind TEXT NOT NULL, actor_id TEXT NOT NULL,
     account_id INTEGER,
     reason TEXT NOT NULL,
     idem_key TEXT,
     tx_ref TEXT,
     corrects INTEGER,
     at INTEGER NOT NULL
   );
   CREATE INDEX IF NOT EXISTS title_events_lot ON title_events (world_id, lot_id, seq);
   CREATE TRIGGER IF NOT EXISTS title_events_no_update BEFORE UPDATE ON title_events BEGIN SELECT RAISE(ABORT, 'title history is append-only'); END;
   CREATE TRIGGER IF NOT EXISTS title_events_no_delete BEFORE DELETE ON title_events BEGIN SELECT RAISE(ABORT, 'title history is append-only'); END;
   CREATE TABLE IF NOT EXISTS lot_delegations (
     lot_id TEXT NOT NULL,
     world_id TEXT NOT NULL,
     subject_kind TEXT NOT NULL,
     subject_id TEXT NOT NULL,
     rights TEXT NOT NULL,
     granted_by TEXT NOT NULL,
     at INTEGER NOT NULL,
     PRIMARY KEY (lot_id, subject_kind, subject_id)
   );
   CREATE TABLE IF NOT EXISTS property_ops (
     key TEXT NOT NULL,
     world_id TEXT NOT NULL,
     actor TEXT NOT NULL,
     payload_hash TEXT NOT NULL,
     result_json TEXT NOT NULL,
     at INTEGER NOT NULL,
     PRIMARY KEY (world_id, key)
   );`,
  },
  // WP4.1 (wp4-world-spec.md §4.1): the world store. One row per building, floor layout and resident (keyed by today's
  // ids), one document per other part of the world; '$'-keys hold the store's own state (revision, export hashes).
  {
    additive: true,
    up: `CREATE TABLE IF NOT EXISTS world_rows (
     world_id TEXT NOT NULL,
     kind TEXT NOT NULL CHECK (kind IN ('building', 'level', 'person')),
     id INTEGER NOT NULL,
     json TEXT NOT NULL,
     rev INTEGER NOT NULL,
     PRIMARY KEY (world_id, kind, id)
   ) WITHOUT ROWID;
   CREATE TABLE IF NOT EXISTS world_docs (
     world_id TEXT NOT NULL,
     key TEXT NOT NULL,
     json TEXT NOT NULL,
     rev INTEGER NOT NULL,
     PRIMARY KEY (world_id, key)
   ) WITHOUT ROWID;`,
  },
  // v13 (WP4.14, 2026-10-04 "lot specific settings"): a lot's own name and a short note its holder writes.
  {
    additive: true,
    up: db => {
      const cols = db.prepare('PRAGMA table_info(lots)').all().map(c => c.name);
      if (!cols.includes('name')) db.exec('ALTER TABLE lots ADD COLUMN name TEXT');
      if (!cols.includes('note')) db.exec('ALTER TABLE lots ADD COLUMN note TEXT');
    },
  },
  // v14 (floor layouts, 2026-10-04): saved floor layouts, private to the account that saved them, shared with the
  // players it names (server/world/floor-library.js).
  {
    additive: true,
    up: `CREATE TABLE IF NOT EXISTS floor_layouts (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     world_id TEXT NOT NULL,
     owner_id INTEGER NOT NULL,
     name TEXT NOT NULL,
     use TEXT NOT NULL,
     w REAL NOT NULL,
     d REAL NOT NULL,
     pieces INTEGER NOT NULL,
     json TEXT NOT NULL,
     created INTEGER NOT NULL,
     updated INTEGER NOT NULL
   );
   CREATE INDEX IF NOT EXISTS floor_layouts_owner ON floor_layouts (world_id, owner_id);
   CREATE TABLE IF NOT EXISTS floor_layout_shares (
     layout_id INTEGER NOT NULL REFERENCES floor_layouts (id) ON DELETE CASCADE,
     world_id TEXT NOT NULL,
     account_id INTEGER NOT NULL,
     at INTEGER NOT NULL,
     PRIMARY KEY (layout_id, account_id)
   );
   CREATE INDEX IF NOT EXISTS floor_layout_shares_to ON floor_layout_shares (world_id, account_id);`,
  },
  // v15 (commerce, the online platform's Land Sales package — wp4-world-spec.md §5.8, 2026-10-05): buying, selling
  // and renting with real money through Stripe (server/commerce/). Real money only ever goes to the platform; a seller
  // or landlord receives store credit (a closed-loop balance, never cash). Amounts are integers in the currency's minor
  // unit (cents). The credit ledger and the record of Stripe events are append-only, like the title history.
  {
    additive: true,
    up: `CREATE TABLE IF NOT EXISTS commerce_ledger (
     seq INTEGER PRIMARY KEY AUTOINCREMENT,
     world_id TEXT NOT NULL,
     account_id INTEGER NOT NULL,
     amount INTEGER NOT NULL,
     currency TEXT NOT NULL,
     kind TEXT NOT NULL CHECK (kind IN ('sale', 'rent', 'spend', 'return', 'adjust', 'reversal')),
     ref TEXT,
     note TEXT NOT NULL,
     actor TEXT NOT NULL,
     at INTEGER NOT NULL
   );
   CREATE INDEX IF NOT EXISTS commerce_ledger_account ON commerce_ledger (world_id, account_id, seq);
   CREATE UNIQUE INDEX IF NOT EXISTS commerce_ledger_once ON commerce_ledger (world_id, kind, ref) WHERE ref IS NOT NULL AND kind IN ('sale', 'rent', 'spend', 'return', 'reversal');
   CREATE TRIGGER IF NOT EXISTS commerce_ledger_no_update BEFORE UPDATE ON commerce_ledger BEGIN SELECT RAISE(ABORT, 'the credit ledger is append-only'); END;
   CREATE TRIGGER IF NOT EXISTS commerce_ledger_no_delete BEFORE DELETE ON commerce_ledger BEGIN SELECT RAISE(ABORT, 'the credit ledger is append-only'); END;
   CREATE TABLE IF NOT EXISTS commerce_listings (
     id TEXT PRIMARY KEY,
     world_id TEXT NOT NULL,
     kind TEXT NOT NULL CHECK (kind IN ('lot', 'flat_sale', 'flat_rent')),
     target TEXT NOT NULL,
     seller_kind TEXT NOT NULL,
     seller_id TEXT NOT NULL,
     price INTEGER NOT NULL CHECK (price > 0),
     currency TEXT NOT NULL,
     offers INTEGER NOT NULL DEFAULT 1,
     note TEXT,
     status TEXT NOT NULL CHECK (status IN ('active', 'reserved', 'closed', 'withdrawn')),
     order_id TEXT,
     created INTEGER NOT NULL,
     updated INTEGER NOT NULL,
     closed INTEGER
   );
   CREATE UNIQUE INDEX IF NOT EXISTS commerce_listings_open ON commerce_listings (world_id, kind, target) WHERE status IN ('active', 'reserved');
   CREATE INDEX IF NOT EXISTS commerce_listings_status ON commerce_listings (world_id, status);
   CREATE TABLE IF NOT EXISTS commerce_offers (
     id TEXT PRIMARY KEY,
     world_id TEXT NOT NULL,
     kind TEXT NOT NULL CHECK (kind IN ('lot', 'flat_sale')),
     target TEXT NOT NULL,
     buyer_id INTEGER NOT NULL,
     holder_kind TEXT NOT NULL,
     holder_id TEXT NOT NULL,
     amount INTEGER NOT NULL CHECK (amount > 0),
     currency TEXT NOT NULL,
     message TEXT,
     status TEXT NOT NULL CHECK (status IN ('open', 'accepted', 'declined', 'withdrawn', 'expired', 'lapsed', 'completed', 'void')),
     pay_by INTEGER,
     order_id TEXT,
     created INTEGER NOT NULL,
     decided INTEGER
   );
   CREATE INDEX IF NOT EXISTS commerce_offers_target ON commerce_offers (world_id, kind, target, status);
   CREATE INDEX IF NOT EXISTS commerce_offers_buyer ON commerce_offers (world_id, buyer_id, status);
   CREATE UNIQUE INDEX IF NOT EXISTS commerce_offers_one_accepted ON commerce_offers (world_id, kind, target) WHERE status = 'accepted';
   CREATE TABLE IF NOT EXISTS commerce_orders (
     id TEXT PRIMARY KEY,
     world_id TEXT NOT NULL,
     account_id INTEGER NOT NULL,
     kind TEXT NOT NULL CHECK (kind IN ('lot', 'flat_sale', 'flat_rent')),
     target TEXT NOT NULL,
     title TEXT NOT NULL,
     listing_id TEXT,
     offer_id TEXT,
     seller_kind TEXT NOT NULL,
     seller_id TEXT NOT NULL,
     price INTEGER NOT NULL CHECK (price > 0),
     currency TEXT NOT NULL,
     credits INTEGER NOT NULL DEFAULT 0 CHECK (credits >= 0),
     card INTEGER NOT NULL DEFAULT 0 CHECK (card >= 0),
     fee INTEGER NOT NULL DEFAULT 0 CHECK (fee >= 0),
     status TEXT NOT NULL CHECK (status IN ('pending', 'fulfilled', 'expired', 'cancelled', 'refunded', 'disputed', 'conflict', 'failed')),
     stripe_session TEXT,
     stripe_payment TEXT,
     stripe_subscription TEXT,
     reserved_until INTEGER,
     was_lifecycle TEXT,
     terms_version TEXT NOT NULL,
     livemode INTEGER,
     created INTEGER NOT NULL,
     updated INTEGER NOT NULL,
     settled INTEGER,
     note TEXT
   );
   CREATE UNIQUE INDEX IF NOT EXISTS commerce_orders_one_pending ON commerce_orders (world_id, kind, target) WHERE status = 'pending';
   CREATE UNIQUE INDEX IF NOT EXISTS commerce_orders_session ON commerce_orders (stripe_session) WHERE stripe_session IS NOT NULL;
   CREATE INDEX IF NOT EXISTS commerce_orders_account ON commerce_orders (world_id, account_id, created);
   CREATE INDEX IF NOT EXISTS commerce_orders_status ON commerce_orders (world_id, status);
   CREATE TABLE IF NOT EXISTS commerce_leases (
     id TEXT PRIMARY KEY,
     world_id TEXT NOT NULL,
     target TEXT NOT NULL,
     title TEXT NOT NULL,
     tenant_id INTEGER NOT NULL,
     rent INTEGER NOT NULL CHECK (rent > 0),
     currency TEXT NOT NULL,
     status TEXT NOT NULL CHECK (status IN ('active', 'ending', 'ended')),
     order_id TEXT NOT NULL,
     stripe_subscription TEXT NOT NULL,
     paid_through INTEGER,
     started INTEGER NOT NULL,
     ended INTEGER,
     end_reason TEXT
   );
   CREATE UNIQUE INDEX IF NOT EXISTS commerce_leases_live ON commerce_leases (world_id, target) WHERE status IN ('active', 'ending');
   CREATE UNIQUE INDEX IF NOT EXISTS commerce_leases_sub ON commerce_leases (stripe_subscription);
   CREATE INDEX IF NOT EXISTS commerce_leases_tenant ON commerce_leases (world_id, tenant_id, status);
   CREATE TABLE IF NOT EXISTS commerce_flats (
     target TEXT NOT NULL,
     world_id TEXT NOT NULL,
     owner_id INTEGER NOT NULL,
     order_id TEXT NOT NULL,
     since INTEGER NOT NULL,
     PRIMARY KEY (world_id, target)
   );
   CREATE TABLE IF NOT EXISTS commerce_events (
     id TEXT NOT NULL,
     world_id TEXT NOT NULL,
     type TEXT NOT NULL,
     livemode INTEGER NOT NULL,
     received INTEGER NOT NULL,
     result TEXT NOT NULL,
     PRIMARY KEY (world_id, id)
   );
   CREATE TRIGGER IF NOT EXISTS commerce_events_no_delete BEFORE DELETE ON commerce_events BEGIN SELECT RAISE(ABORT, 'the record of payment events is kept'); END;`,
  },
  // v16 (the shop, 2026-10-05 "finish the items not built yet"): rent paid from store credit (a lease is paid by card
  // — a Stripe subscription — or from credit, month by month, with a card top-up when credit runs short: status 'due'),
  // one month's rent and advertising as kinds of order, and advertising campaigns (billboards and the promotional
  // aircraft) with their daily counts. The two tables whose checks change are rebuilt with every row kept.
  {
    additive: true,
    up: db => {
      const has = t => !!db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
      const cols = t => db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name);
      if (has('commerce_leases') && !cols('commerce_leases').includes('pay')) {
        db.exec(`CREATE TABLE commerce_leases_next (
         id TEXT PRIMARY KEY,
         world_id TEXT NOT NULL,
         target TEXT NOT NULL,
         title TEXT NOT NULL,
         tenant_id INTEGER NOT NULL,
         rent INTEGER NOT NULL CHECK (rent > 0),
         currency TEXT NOT NULL,
         pay TEXT NOT NULL DEFAULT 'card' CHECK (pay IN ('card', 'credit')),
         pay_next TEXT CHECK (pay_next IN ('credit')),
         status TEXT NOT NULL CHECK (status IN ('active', 'ending', 'due', 'ended')),
         order_id TEXT NOT NULL,
         stripe_subscription TEXT,
         paid_through INTEGER,
         due_since INTEGER,
         started INTEGER NOT NULL,
         ended INTEGER,
         end_reason TEXT
       );
       INSERT INTO commerce_leases_next (id, world_id, target, title, tenant_id, rent, currency, pay, status, order_id, stripe_subscription, paid_through, started, ended, end_reason)
         SELECT id, world_id, target, title, tenant_id, rent, currency, 'card', status, order_id, stripe_subscription, paid_through, started, ended, end_reason FROM commerce_leases;
       DROP TABLE commerce_leases;
       ALTER TABLE commerce_leases_next RENAME TO commerce_leases;`);
      }
      db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS commerce_leases_live ON commerce_leases (world_id, target) WHERE status IN ('active', 'ending', 'due');
       CREATE UNIQUE INDEX IF NOT EXISTS commerce_leases_sub ON commerce_leases (stripe_subscription) WHERE stripe_subscription IS NOT NULL;
       CREATE INDEX IF NOT EXISTS commerce_leases_tenant ON commerce_leases (world_id, tenant_id, status);`);
      const ordersSql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'commerce_orders'").get()?.sql || '';
      if (ordersSql && !ordersSql.includes("'rent_month'")) {
        const keep = cols('commerce_orders').join(', ');
        db.exec(`CREATE TABLE commerce_orders_next (
         id TEXT PRIMARY KEY,
         world_id TEXT NOT NULL,
         account_id INTEGER NOT NULL,
         kind TEXT NOT NULL CHECK (kind IN ('lot', 'flat_sale', 'flat_rent', 'rent_month', 'ad')),
         target TEXT NOT NULL,
         title TEXT NOT NULL,
         listing_id TEXT,
         offer_id TEXT,
         seller_kind TEXT NOT NULL,
         seller_id TEXT NOT NULL,
         price INTEGER NOT NULL CHECK (price > 0),
         currency TEXT NOT NULL,
         credits INTEGER NOT NULL DEFAULT 0 CHECK (credits >= 0),
         card INTEGER NOT NULL DEFAULT 0 CHECK (card >= 0),
         fee INTEGER NOT NULL DEFAULT 0 CHECK (fee >= 0),
         status TEXT NOT NULL CHECK (status IN ('pending', 'fulfilled', 'expired', 'cancelled', 'refunded', 'disputed', 'conflict', 'failed')),
         stripe_session TEXT,
         stripe_payment TEXT,
         stripe_subscription TEXT,
         reserved_until INTEGER,
         was_lifecycle TEXT,
         terms_version TEXT NOT NULL,
         livemode INTEGER,
         created INTEGER NOT NULL,
         updated INTEGER NOT NULL,
         settled INTEGER,
         note TEXT,
         pay TEXT
       );
       INSERT INTO commerce_orders_next (${keep}) SELECT ${keep} FROM commerce_orders;
       DROP TABLE commerce_orders;
       ALTER TABLE commerce_orders_next RENAME TO commerce_orders;`);
      }
      db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS commerce_orders_one_pending ON commerce_orders (world_id, kind, target) WHERE status = 'pending';
       CREATE UNIQUE INDEX IF NOT EXISTS commerce_orders_session ON commerce_orders (stripe_session) WHERE stripe_session IS NOT NULL;
       CREATE INDEX IF NOT EXISTS commerce_orders_account ON commerce_orders (world_id, account_id, created);
       CREATE INDEX IF NOT EXISTS commerce_orders_status ON commerce_orders (world_id, status);
       CREATE INDEX IF NOT EXISTS commerce_orders_payment ON commerce_orders (stripe_payment) WHERE stripe_payment IS NOT NULL;
       CREATE TABLE IF NOT EXISTS commerce_campaigns (
         id TEXT PRIMARY KEY,
         world_id TEXT NOT NULL,
         account_id INTEGER NOT NULL,
         space TEXT NOT NULL CHECK (space IN ('aircraft', 'billboard')),
         tier TEXT NOT NULL,
         weight INTEGER NOT NULL CHECK (weight > 0),
         billing TEXT NOT NULL CHECK (billing IN ('once', 'monthly')),
         pay TEXT NOT NULL DEFAULT 'card' CHECK (pay IN ('card', 'credit')),
         price INTEGER NOT NULL CHECK (price > 0),
         currency TEXT NOT NULL,
         creative_json TEXT NOT NULL,
         status TEXT NOT NULL CHECK (status IN ('pending', 'review', 'scheduled', 'live', 'ending', 'ended', 'rejected', 'cancelled')),
         start_at INTEGER,
         end_at INTEGER,
         order_id TEXT,
         stripe_subscription TEXT,
         review_note TEXT,
         reviewed_by TEXT,
         reviewed_at INTEGER,
         created INTEGER NOT NULL,
         updated INTEGER NOT NULL
       );
       CREATE INDEX IF NOT EXISTS commerce_campaigns_status ON commerce_campaigns (world_id, status);
       CREATE INDEX IF NOT EXISTS commerce_campaigns_account ON commerce_campaigns (world_id, account_id, created);
       CREATE UNIQUE INDEX IF NOT EXISTS commerce_campaigns_sub ON commerce_campaigns (stripe_subscription) WHERE stripe_subscription IS NOT NULL;
       CREATE TABLE IF NOT EXISTS commerce_ad_stats (
         world_id TEXT NOT NULL,
         campaign_id TEXT NOT NULL,
         day TEXT NOT NULL,
         seen INTEGER NOT NULL DEFAULT 0,
         opened INTEGER NOT NULL DEFAULT 0,
         clicks INTEGER NOT NULL DEFAULT 0,
         PRIMARY KEY (world_id, campaign_id, day)
       );`);
    },
  },
  // v17 (signs, 2026-10-05): ads also on street and metro signs and on owners' signs inside buildings; an owner
  // showing ads earns VC for them (recorded here until the VC economy exists) and store credit when a visitor opens a
  // link from one (ledger kind 'earn'). The ledger and the campaigns are rebuilt for their wider checks with every row,
  // index and trigger kept.
  {
    additive: true,
    up: db => {
      const sqlOf = t => db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(t)?.sql || '';
      const cols = t => db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name).join(', ');
      if (sqlOf('commerce_ledger') && !sqlOf('commerce_ledger').includes("'earn'")) {
        const keep = cols('commerce_ledger');
        db.exec(`DROP TRIGGER IF EXISTS commerce_ledger_no_update;
         DROP TRIGGER IF EXISTS commerce_ledger_no_delete;
         CREATE TABLE commerce_ledger_next (
           seq INTEGER PRIMARY KEY AUTOINCREMENT,
           world_id TEXT NOT NULL,
           account_id INTEGER NOT NULL,
           amount INTEGER NOT NULL,
           currency TEXT NOT NULL,
           kind TEXT NOT NULL CHECK (kind IN ('sale', 'rent', 'spend', 'return', 'adjust', 'reversal', 'earn')),
           ref TEXT,
           note TEXT NOT NULL,
           actor TEXT NOT NULL,
           at INTEGER NOT NULL
         );
         INSERT INTO commerce_ledger_next (${keep}) SELECT ${keep} FROM commerce_ledger;
         DROP TABLE commerce_ledger;
         ALTER TABLE commerce_ledger_next RENAME TO commerce_ledger;`);
      }
      db.exec(`CREATE INDEX IF NOT EXISTS commerce_ledger_account ON commerce_ledger (world_id, account_id, seq);
       DROP INDEX IF EXISTS commerce_ledger_once;
       CREATE UNIQUE INDEX IF NOT EXISTS commerce_ledger_once ON commerce_ledger (world_id, kind, ref) WHERE ref IS NOT NULL AND kind IN ('sale', 'rent', 'spend', 'return', 'reversal', 'earn');
       CREATE TRIGGER IF NOT EXISTS commerce_ledger_no_update BEFORE UPDATE ON commerce_ledger BEGIN SELECT RAISE(ABORT, 'the credit ledger is append-only'); END;
       CREATE TRIGGER IF NOT EXISTS commerce_ledger_no_delete BEFORE DELETE ON commerce_ledger BEGIN SELECT RAISE(ABORT, 'the credit ledger is append-only'); END;`);
      if (sqlOf('commerce_campaigns') && !sqlOf('commerce_campaigns').includes("'indoor'")) {
        const keep = cols('commerce_campaigns');
        db.exec(`CREATE TABLE commerce_campaigns_next (
           id TEXT PRIMARY KEY,
           world_id TEXT NOT NULL,
           account_id INTEGER NOT NULL,
           space TEXT NOT NULL CHECK (space IN ('aircraft', 'billboard', 'street', 'indoor')),
           tier TEXT NOT NULL,
           weight INTEGER NOT NULL CHECK (weight > 0),
           billing TEXT NOT NULL CHECK (billing IN ('once', 'monthly')),
           pay TEXT NOT NULL DEFAULT 'card' CHECK (pay IN ('card', 'credit')),
           price INTEGER NOT NULL CHECK (price > 0),
           currency TEXT NOT NULL,
           creative_json TEXT NOT NULL,
           status TEXT NOT NULL CHECK (status IN ('pending', 'review', 'scheduled', 'live', 'ending', 'ended', 'rejected', 'cancelled')),
           start_at INTEGER,
           end_at INTEGER,
           order_id TEXT,
           stripe_subscription TEXT,
           review_note TEXT,
           reviewed_by TEXT,
           reviewed_at INTEGER,
           created INTEGER NOT NULL,
           updated INTEGER NOT NULL
         );
         INSERT INTO commerce_campaigns_next (${keep}) SELECT ${keep} FROM commerce_campaigns;
         DROP TABLE commerce_campaigns;
         ALTER TABLE commerce_campaigns_next RENAME TO commerce_campaigns;`);
      }
      db.exec(`CREATE INDEX IF NOT EXISTS commerce_campaigns_status ON commerce_campaigns (world_id, status);
       CREATE INDEX IF NOT EXISTS commerce_campaigns_account ON commerce_campaigns (world_id, account_id, created);
       CREATE UNIQUE INDEX IF NOT EXISTS commerce_campaigns_sub ON commerce_campaigns (stripe_subscription) WHERE stripe_subscription IS NOT NULL;
       CREATE TABLE IF NOT EXISTS commerce_host_earnings (
         world_id TEXT NOT NULL,
         account_id INTEGER NOT NULL,
         day TEXT NOT NULL,
         slot TEXT NOT NULL,
         campaign_id TEXT NOT NULL,
         seen INTEGER NOT NULL DEFAULT 0,
         vc_milli INTEGER NOT NULL DEFAULT 0,
         clicks INTEGER NOT NULL DEFAULT 0,
         credit INTEGER NOT NULL DEFAULT 0,
         PRIMARY KEY (world_id, account_id, day, slot, campaign_id)
       );
       CREATE INDEX IF NOT EXISTS commerce_host_earnings_account ON commerce_host_earnings (world_id, account_id, day);`);
    },
  },
  // v18 (the economy, docs/features/ECONOMY.md; 2026-10-05): Virtual Coin. Wallets for every player, agent, resident,
  // business and the city; a double-entry ledger (transactions and their postings, which sum to zero) that the database
  // keeps append-only and the server signs (an HMAC chain); holds (escrow); businesses and their daily books; the daily
  // settlement and its running totals; statistics; payment requests; agents' spending limits and the approvals they
  // wait for; debts (wages or rent owed); VC leases; loans. Amounts are integers in hundredths of a VC. Store credit
  // (commerce_ledger, real money) never meets these tables.
  {
    additive: true,
    up: `CREATE TABLE IF NOT EXISTS econ_wallets (
     id TEXT PRIMARY KEY,
     world_id TEXT NOT NULL,
     owner_kind TEXT NOT NULL CHECK (owner_kind IN ('account', 'agent', 'resident', 'business', 'city', 'system')),
     owner_id TEXT NOT NULL,
     purpose TEXT NOT NULL,
     label TEXT NOT NULL DEFAULT '',
     balance INTEGER NOT NULL DEFAULT 0,
     held INTEGER NOT NULL DEFAULT 0 CHECK (held >= 0),
     overdraft INTEGER NOT NULL DEFAULT 0 CHECK (overdraft IN (0, 1)),
     status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'frozen', 'closed')),
     frozen_why TEXT,
     version INTEGER NOT NULL DEFAULT 0,
     created INTEGER NOT NULL,
     updated INTEGER NOT NULL,
     CHECK (overdraft = 1 OR balance >= held)
   );
   CREATE UNIQUE INDEX IF NOT EXISTS econ_wallets_owner ON econ_wallets (world_id, owner_kind, owner_id, purpose);
   CREATE TRIGGER IF NOT EXISTS econ_wallets_no_delete BEFORE DELETE ON econ_wallets BEGIN SELECT RAISE(ABORT, 'wallets are closed, never deleted'); END;
   CREATE TABLE IF NOT EXISTS econ_tx (
     seq INTEGER PRIMARY KEY AUTOINCREMENT,
     world_id TEXT NOT NULL,
     id TEXT NOT NULL UNIQUE,
     kind TEXT NOT NULL,
     memo TEXT NOT NULL DEFAULT '',
     actor TEXT NOT NULL,
     ref TEXT,
     idem TEXT,
     idem_hash TEXT,
     day INTEGER,
     at INTEGER NOT NULL,
     reverses INTEGER,
     mac TEXT NOT NULL
   );
   CREATE UNIQUE INDEX IF NOT EXISTS econ_tx_idem ON econ_tx (world_id, idem) WHERE idem IS NOT NULL;
   CREATE UNIQUE INDEX IF NOT EXISTS econ_tx_reverses ON econ_tx (world_id, reverses) WHERE reverses IS NOT NULL;
   CREATE INDEX IF NOT EXISTS econ_tx_kind ON econ_tx (world_id, kind, seq);
   CREATE INDEX IF NOT EXISTS econ_tx_ref ON econ_tx (world_id, ref) WHERE ref IS NOT NULL;
   CREATE INDEX IF NOT EXISTS econ_tx_day ON econ_tx (world_id, day);
   CREATE TRIGGER IF NOT EXISTS econ_tx_no_update BEFORE UPDATE ON econ_tx BEGIN SELECT RAISE(ABORT, 'the ledger is append-only'); END;
   CREATE TRIGGER IF NOT EXISTS econ_tx_no_delete BEFORE DELETE ON econ_tx BEGIN SELECT RAISE(ABORT, 'the ledger is append-only'); END;
   CREATE TABLE IF NOT EXISTS econ_postings (
     tx INTEGER NOT NULL REFERENCES econ_tx (seq),
     world_id TEXT NOT NULL,
     wallet TEXT NOT NULL,
     amount INTEGER NOT NULL CHECK (amount <> 0),
     balance INTEGER NOT NULL,
     note TEXT
   );
   CREATE INDEX IF NOT EXISTS econ_postings_wallet ON econ_postings (world_id, wallet, tx);
   CREATE INDEX IF NOT EXISTS econ_postings_tx ON econ_postings (tx);
   CREATE TRIGGER IF NOT EXISTS econ_postings_no_update BEFORE UPDATE ON econ_postings BEGIN SELECT RAISE(ABORT, 'the ledger is append-only'); END;
   CREATE TRIGGER IF NOT EXISTS econ_postings_no_delete BEFORE DELETE ON econ_postings BEGIN SELECT RAISE(ABORT, 'the ledger is append-only'); END;
   CREATE TABLE IF NOT EXISTS econ_holds (
     id TEXT PRIMARY KEY,
     world_id TEXT NOT NULL,
     wallet TEXT NOT NULL,
     amount INTEGER NOT NULL CHECK (amount > 0),
     purpose TEXT NOT NULL,
     ref TEXT,
     status TEXT NOT NULL CHECK (status IN ('open', 'captured', 'released')),
     created INTEGER NOT NULL,
     expires INTEGER,
     closed INTEGER,
     tx INTEGER
   );
   CREATE INDEX IF NOT EXISTS econ_holds_wallet ON econ_holds (world_id, wallet, status);
   CREATE INDEX IF NOT EXISTS econ_holds_open ON econ_holds (world_id, status, expires);
   CREATE UNIQUE INDEX IF NOT EXISTS econ_holds_ref ON econ_holds (world_id, purpose, ref) WHERE status = 'open' AND ref IS NOT NULL;
   CREATE TABLE IF NOT EXISTS econ_businesses (
     id TEXT PRIMARY KEY,
     world_id TEXT NOT NULL,
     kind TEXT NOT NULL,
     name TEXT NOT NULL,
     b INTEGER NOT NULL,
     f INTEGER NOT NULL,
     owner_kind TEXT NOT NULL,
     owner_id TEXT NOT NULL,
     status TEXT NOT NULL CHECK (status IN ('open', 'closed', 'dissolved')),
     settings_json TEXT NOT NULL DEFAULT '{}',
     rating INTEGER NOT NULL DEFAULT 350,
     reviews INTEGER NOT NULL DEFAULT 0,
     created INTEGER NOT NULL,
     updated INTEGER NOT NULL
   );
   CREATE UNIQUE INDEX IF NOT EXISTS econ_businesses_place ON econ_businesses (world_id, b, f) WHERE status = 'open';
   CREATE INDEX IF NOT EXISTS econ_businesses_owner ON econ_businesses (world_id, owner_kind, owner_id);
   CREATE TABLE IF NOT EXISTS econ_biz_days (
     world_id TEXT NOT NULL,
     biz TEXT NOT NULL,
     day INTEGER NOT NULL,
     sales INTEGER NOT NULL DEFAULT 0,
     customers INTEGER NOT NULL DEFAULT 0,
     units INTEGER NOT NULL DEFAULT 0,
     cogs INTEGER NOT NULL DEFAULT 0,
     wages INTEGER NOT NULL DEFAULT 0,
     rent INTEGER NOT NULL DEFAULT 0,
     tax INTEGER NOT NULL DEFAULT 0,
     upkeep INTEGER NOT NULL DEFAULT 0,
     other INTEGER NOT NULL DEFAULT 0,
     profit INTEGER NOT NULL DEFAULT 0,
     owed INTEGER NOT NULL DEFAULT 0,
     detail_json TEXT,
     PRIMARY KEY (world_id, biz, day)
   ) WITHOUT ROWID;
   CREATE INDEX IF NOT EXISTS econ_biz_days_day ON econ_biz_days (world_id, day);
   CREATE TABLE IF NOT EXISTS econ_pending (
     world_id TEXT NOT NULL,
     day INTEGER NOT NULL,
     key TEXT NOT NULL,
     json TEXT NOT NULL,
     PRIMARY KEY (world_id, day, key)
   ) WITHOUT ROWID;
   CREATE TABLE IF NOT EXISTS econ_days (
     world_id TEXT NOT NULL,
     day INTEGER NOT NULL,
     status TEXT NOT NULL CHECK (status IN ('running', 'done', 'skipped')),
     started INTEGER NOT NULL,
     finished INTEGER,
     summary_json TEXT,
     PRIMARY KEY (world_id, day)
   ) WITHOUT ROWID;
   CREATE TABLE IF NOT EXISTS econ_stats (
     world_id TEXT NOT NULL,
     key TEXT NOT NULL,
     day INTEGER NOT NULL,
     value INTEGER NOT NULL,
     PRIMARY KEY (world_id, key, day)
   ) WITHOUT ROWID;
   CREATE TABLE IF NOT EXISTS econ_requests (
     id TEXT PRIMARY KEY,
     world_id TEXT NOT NULL,
     payee TEXT NOT NULL,
     payer TEXT NOT NULL,
     amount INTEGER NOT NULL CHECK (amount > 0),
     memo TEXT NOT NULL DEFAULT '',
     status TEXT NOT NULL CHECK (status IN ('open', 'paid', 'declined', 'cancelled', 'expired')),
     tx INTEGER,
     created INTEGER NOT NULL,
     decided INTEGER,
     expires INTEGER NOT NULL
   );
   CREATE INDEX IF NOT EXISTS econ_requests_payer ON econ_requests (world_id, payer, status);
   CREATE INDEX IF NOT EXISTS econ_requests_payee ON econ_requests (world_id, payee, status);
   CREATE TABLE IF NOT EXISTS econ_agent_policy (
     world_id TEXT NOT NULL,
     agent_id INTEGER NOT NULL,
     scopes TEXT NOT NULL DEFAULT '[]',
     daily_cap INTEGER,
     approve_above INTEGER,
     paused INTEGER NOT NULL DEFAULT 0,
     updated INTEGER NOT NULL,
     updated_by INTEGER,
     PRIMARY KEY (world_id, agent_id)
   ) WITHOUT ROWID;
   CREATE TABLE IF NOT EXISTS econ_approvals (
     id TEXT PRIMARY KEY,
     world_id TEXT NOT NULL,
     agent_id INTEGER NOT NULL,
     owner_id INTEGER NOT NULL,
     action TEXT NOT NULL,
     payload_json TEXT NOT NULL,
     amount INTEGER NOT NULL,
     status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'declined', 'expired', 'failed')),
     created INTEGER NOT NULL,
     expires INTEGER NOT NULL,
     decided INTEGER,
     result_json TEXT
   );
   CREATE INDEX IF NOT EXISTS econ_approvals_owner ON econ_approvals (world_id, owner_id, status);
   CREATE INDEX IF NOT EXISTS econ_approvals_agent ON econ_approvals (world_id, agent_id, status);
   CREATE TABLE IF NOT EXISTS econ_debts (
     id TEXT PRIMARY KEY,
     world_id TEXT NOT NULL,
     debtor TEXT NOT NULL,
     creditor TEXT NOT NULL,
     kind TEXT NOT NULL,
     amount INTEGER NOT NULL CHECK (amount >= 0),
     original INTEGER NOT NULL CHECK (original > 0),
     ref TEXT,
     status TEXT NOT NULL CHECK (status IN ('open', 'paid', 'forgiven')),
     created INTEGER NOT NULL,
     updated INTEGER NOT NULL
   );
   CREATE INDEX IF NOT EXISTS econ_debts_debtor ON econ_debts (world_id, debtor, status);
   CREATE INDEX IF NOT EXISTS econ_debts_creditor ON econ_debts (world_id, creditor, status);
   CREATE TABLE IF NOT EXISTS econ_leases (
     id TEXT PRIMARY KEY,
     world_id TEXT NOT NULL,
     target TEXT NOT NULL,
     title TEXT NOT NULL,
     landlord_kind TEXT NOT NULL,
     landlord_id TEXT NOT NULL,
     tenant_kind TEXT NOT NULL,
     tenant_id TEXT NOT NULL,
     rent INTEGER NOT NULL CHECK (rent > 0),
     status TEXT NOT NULL CHECK (status IN ('active', 'ending', 'due', 'ended')),
     started_day INTEGER NOT NULL,
     paid_through INTEGER NOT NULL,
     due_since INTEGER,
     created INTEGER NOT NULL,
     ended INTEGER,
     end_reason TEXT
   );
   CREATE UNIQUE INDEX IF NOT EXISTS econ_leases_live ON econ_leases (world_id, target) WHERE status IN ('active', 'ending', 'due');
   CREATE INDEX IF NOT EXISTS econ_leases_tenant ON econ_leases (world_id, tenant_kind, tenant_id, status);
   CREATE INDEX IF NOT EXISTS econ_leases_landlord ON econ_leases (world_id, landlord_kind, landlord_id, status);
   CREATE TABLE IF NOT EXISTS econ_loans (
     id TEXT PRIMARY KEY,
     world_id TEXT NOT NULL,
     borrower TEXT NOT NULL,
     lender TEXT NOT NULL,
     principal INTEGER NOT NULL CHECK (principal > 0),
     rate_bp INTEGER NOT NULL CHECK (rate_bp >= 0),
     term_days INTEGER NOT NULL CHECK (term_days > 0),
     outstanding INTEGER NOT NULL CHECK (outstanding >= 0),
     installment INTEGER NOT NULL,
     status TEXT NOT NULL CHECK (status IN ('active', 'repaid', 'defaulted')),
     started_day INTEGER NOT NULL,
     next_day INTEGER NOT NULL,
     created INTEGER NOT NULL,
     updated INTEGER NOT NULL
   );
   CREATE INDEX IF NOT EXISTS econ_loans_borrower ON econ_loans (world_id, borrower, status);`,
  },
  // v19 (jobs, docs/features/ECONOMY.md §8): work sessions — a player or an agent working a role at a venue (a mini-game
  // for each order, or an agent's competent "auto" shift), paid from the venue at the end; experience per role;
  // reputation by dimension (paying reliably, working well) with its append-only events; customers' reviews.
  {
    additive: true,
    up: `CREATE TABLE IF NOT EXISTS econ_work (
     id TEXT PRIMARY KEY,
     world_id TEXT NOT NULL,
     biz TEXT NOT NULL,
     role TEXT NOT NULL,
     worker_kind TEXT NOT NULL,
     worker_id TEXT NOT NULL,
     mode TEXT NOT NULL CHECK (mode IN ('play', 'auto')),
     status TEXT NOT NULL CHECK (status IN ('active', 'ended')),
     seed TEXT NOT NULL,
     day INTEGER NOT NULL,
     started INTEGER NOT NULL,
     last_act INTEGER NOT NULL,
     ended INTEGER,
     active_ms INTEGER NOT NULL DEFAULT 0,
     units INTEGER NOT NULL DEFAULT 0,
     stars_sum INTEGER NOT NULL DEFAULT 0,
     tips INTEGER NOT NULL DEFAULT 0,
     pay INTEGER NOT NULL DEFAULT 0,
     owed INTEGER NOT NULL DEFAULT 0,
     xp INTEGER NOT NULL DEFAULT 0,
     hours_milli INTEGER NOT NULL DEFAULT 0,
     tx INTEGER,
     state_json TEXT NOT NULL DEFAULT '{}'
   );
   CREATE UNIQUE INDEX IF NOT EXISTS econ_work_one ON econ_work (world_id, worker_kind, worker_id) WHERE status = 'active';
   CREATE INDEX IF NOT EXISTS econ_work_biz ON econ_work (world_id, biz, status);
   CREATE INDEX IF NOT EXISTS econ_work_day ON econ_work (world_id, day, biz);
   CREATE INDEX IF NOT EXISTS econ_work_worker ON econ_work (world_id, worker_kind, worker_id, started);
   CREATE TABLE IF NOT EXISTS econ_xp (
     world_id TEXT NOT NULL,
     subject TEXT NOT NULL,
     role TEXT NOT NULL,
     xp INTEGER NOT NULL DEFAULT 0,
     units INTEGER NOT NULL DEFAULT 0,
     day INTEGER,
     day_units INTEGER NOT NULL DEFAULT 0,
     updated INTEGER NOT NULL,
     PRIMARY KEY (world_id, subject, role)
   ) WITHOUT ROWID;
   CREATE TABLE IF NOT EXISTS econ_rep (
     world_id TEXT NOT NULL,
     subject TEXT NOT NULL,
     dim TEXT NOT NULL,
     score INTEGER NOT NULL,
     n INTEGER NOT NULL DEFAULT 0,
     updated INTEGER NOT NULL,
     PRIMARY KEY (world_id, subject, dim)
   ) WITHOUT ROWID;
   CREATE TABLE IF NOT EXISTS econ_rep_events (
     seq INTEGER PRIMARY KEY AUTOINCREMENT,
     world_id TEXT NOT NULL,
     subject TEXT NOT NULL,
     dim TEXT NOT NULL,
     delta INTEGER NOT NULL,
     reason TEXT NOT NULL,
     ref TEXT,
     at INTEGER NOT NULL
   );
   CREATE UNIQUE INDEX IF NOT EXISTS econ_rep_events_once ON econ_rep_events (world_id, subject, dim, reason, ref) WHERE ref IS NOT NULL;
   CREATE INDEX IF NOT EXISTS econ_rep_events_subject ON econ_rep_events (world_id, subject, seq);
   CREATE TRIGGER IF NOT EXISTS econ_rep_events_no_update BEFORE UPDATE ON econ_rep_events BEGIN SELECT RAISE(ABORT, 'reputation history is append-only'); END;
   CREATE TRIGGER IF NOT EXISTS econ_rep_events_no_delete BEFORE DELETE ON econ_rep_events BEGIN SELECT RAISE(ABORT, 'reputation history is append-only'); END;
   CREATE TABLE IF NOT EXISTS econ_reviews (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     world_id TEXT NOT NULL,
     biz TEXT NOT NULL,
     worker TEXT,
     author TEXT NOT NULL,
     author_name TEXT NOT NULL,
     stars INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
     text TEXT NOT NULL,
     ref TEXT,
     at INTEGER NOT NULL
   );
   CREATE INDEX IF NOT EXISTS econ_reviews_biz ON econ_reviews (world_id, biz, id);
   CREATE INDEX IF NOT EXISTS econ_reviews_worker ON econ_reviews (world_id, worker, id);
   CREATE UNIQUE INDEX IF NOT EXISTS econ_reviews_ref ON econ_reviews (world_id, ref) WHERE ref IS NOT NULL;`,
  },
  // v20 (property for Virtual Coin, docs/features/ECONOMY.md §7, §12): listings of lots and flats for sale (the
  // self-hosted edition, where no real money exists) and flats for rent (both editions: tenancy is VC). Leases are
  // econ_leases (v18).
  {
    additive: true,
    up: `CREATE TABLE IF NOT EXISTS econ_listings (
     id TEXT PRIMARY KEY,
     world_id TEXT NOT NULL,
     kind TEXT NOT NULL CHECK (kind IN ('lot', 'flat_sale', 'flat_rent', 'venue_rent')),
     target TEXT NOT NULL,
     seller_kind TEXT NOT NULL,
     seller_id TEXT NOT NULL,
     price INTEGER NOT NULL CHECK (price > 0),
     note TEXT,
     status TEXT NOT NULL CHECK (status IN ('active', 'closed', 'withdrawn')),
     buyer TEXT,
     tx INTEGER,
     created INTEGER NOT NULL,
     updated INTEGER NOT NULL
   );
   CREATE UNIQUE INDEX IF NOT EXISTS econ_listings_open ON econ_listings (world_id, kind, target) WHERE status = 'active';
   CREATE INDEX IF NOT EXISTS econ_listings_status ON econ_listings (world_id, status);`,
  },
  // v21 (Free Will, docs/features/FREE-WILL.md): an agent whose owner gave it Free Will lets a decision service choose
  // what it does with its free time. agent_free_will is the owner's switch for each agent (connection_id NULL: the
  // installation's default decision service); agent_decisions is the "why" log — every choice point, what could be
  // chosen, what was chosen and how sure the service was, or why the routine chose instead. cost_micro is millionths
  // of a US dollar. The log is pruned by age (server/free-will/free-will.js).
  {
    additive: true,
    up: `CREATE TABLE IF NOT EXISTS agent_free_will (
     world_id TEXT NOT NULL,
     agent_id INTEGER NOT NULL,
     enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
     connection_id INTEGER,
     spontaneity REAL NOT NULL DEFAULT 0.5 CHECK (spontaneity >= 0 AND spontaneity <= 1),
     updated INTEGER NOT NULL,
     updated_by INTEGER,
     PRIMARY KEY (world_id, agent_id)
   );
   CREATE TABLE IF NOT EXISTS agent_decisions (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     world_id TEXT NOT NULL,
     agent_id INTEGER NOT NULL,
     at INTEGER NOT NULL,
     world_time TEXT,
     place TEXT,
     outcome TEXT NOT NULL CHECK (outcome IN ('chosen', 'routine', 'unused')),
     reason TEXT,
     chosen TEXT,
     chosen_label TEXT,
     options_json TEXT NOT NULL,
     probs_json TEXT,
     confidence REAL,
     connection_id INTEGER,
     latency_ms INTEGER,
     input_tokens INTEGER,
     cost_micro INTEGER
   );
   CREATE INDEX IF NOT EXISTS agent_decisions_agent ON agent_decisions (world_id, agent_id, id);
   CREATE INDEX IF NOT EXISTS agent_decisions_at ON agent_decisions (world_id, at);`,
  },
  // v22 (an agent's life, docs/features/FREE-WILL.md §5): who an agent is and what it lived. agent_profiles holds its
  // character (traits 0..1 beyond the body's own, which stay on the resident), story, goals and which fields its owner
  // locked; agent_intentions its plans (world_day NULL: until done); agent_memories what it remembers (term short fades
  // after a few world days, long stays); agent_relations the people it knows; agent_activity what it did, kept by age.
  // Free Will's spontaneity (v21) becomes a character trait: copied in here, read from here.
  {
    additive: true,
    up: `CREATE TABLE IF NOT EXISTS agent_profiles (
     world_id TEXT NOT NULL,
     agent_id INTEGER NOT NULL,
     traits_json TEXT NOT NULL DEFAULT '{}',
     bio TEXT NOT NULL DEFAULT '',
     values_json TEXT NOT NULL DEFAULT '[]',
     likes_json TEXT NOT NULL DEFAULT '[]',
     dislikes_json TEXT NOT NULL DEFAULT '[]',
     purpose TEXT NOT NULL DEFAULT '',
     aspirations_json TEXT NOT NULL DEFAULT '[]',
     outlook TEXT NOT NULL DEFAULT '',
     locked_json TEXT NOT NULL DEFAULT '[]',
     updated INTEGER NOT NULL,
     updated_by INTEGER,
     PRIMARY KEY (world_id, agent_id)
   );
   CREATE TABLE IF NOT EXISTS agent_intentions (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     world_id TEXT NOT NULL,
     agent_id INTEGER NOT NULL,
     world_day INTEGER,
     kind TEXT NOT NULL CHECK (kind IN ('must', 'want')),
     text TEXT NOT NULL,
     status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'dropped')),
     source TEXT NOT NULL CHECK (source IN ('owner', 'mind', 'reflection')),
     created INTEGER NOT NULL,
     updated INTEGER NOT NULL
   );
   CREATE INDEX IF NOT EXISTS agent_intentions_agent ON agent_intentions (world_id, agent_id, status);
   CREATE TABLE IF NOT EXISTS agent_memories (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     world_id TEXT NOT NULL,
     agent_id INTEGER NOT NULL,
     term TEXT NOT NULL CHECK (term IN ('short', 'long')),
     kind TEXT NOT NULL CHECK (kind IN ('event', 'place', 'person', 'lesson', 'note')),
     text TEXT NOT NULL,
     importance INTEGER NOT NULL DEFAULT 1 CHECK (importance BETWEEN 1 AND 5),
     place TEXT,
     people_json TEXT NOT NULL DEFAULT '[]',
     world_day INTEGER NOT NULL,
     world_time TEXT,
     source TEXT NOT NULL CHECK (source IN ('auto', 'owner', 'mind', 'reflection')),
     created INTEGER NOT NULL
   );
   CREATE INDEX IF NOT EXISTS agent_memories_agent ON agent_memories (world_id, agent_id, term, id);
   CREATE TABLE IF NOT EXISTS agent_relations (
     world_id TEXT NOT NULL,
     agent_id INTEGER NOT NULL,
     other_kind TEXT NOT NULL CHECK (other_kind IN ('agent', 'resident', 'player')),
     other_id TEXT NOT NULL,
     other_name TEXT NOT NULL,
     affinity REAL NOT NULL DEFAULT 0 CHECK (affinity >= -1 AND affinity <= 1),
     trust REAL NOT NULL DEFAULT 0 CHECK (trust >= 0 AND trust <= 1),
     interactions INTEGER NOT NULL DEFAULT 0,
     first_day INTEGER NOT NULL,
     last_day INTEGER NOT NULL,
     last_place TEXT,
     note TEXT NOT NULL DEFAULT '',
     updated INTEGER NOT NULL,
     PRIMARY KEY (world_id, agent_id, other_kind, other_id)
   );
   CREATE TABLE IF NOT EXISTS agent_activity (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     world_id TEXT NOT NULL,
     agent_id INTEGER NOT NULL,
     at INTEGER NOT NULL,
     world_day INTEGER NOT NULL,
     world_time TEXT NOT NULL,
     kind TEXT NOT NULL,
     label TEXT NOT NULL,
     place TEXT,
     place_key TEXT,
     minutes INTEGER NOT NULL DEFAULT 0,
     with_name TEXT
   );
   CREATE INDEX IF NOT EXISTS agent_activity_agent ON agent_activity (world_id, agent_id, id);
   CREATE INDEX IF NOT EXISTS agent_activity_at ON agent_activity (world_id, at);
   INSERT OR IGNORE INTO agent_profiles (world_id, agent_id, traits_json, updated, updated_by)
     SELECT world_id, agent_id, json_object('spontaneity', spontaneity), updated, updated_by FROM agent_free_will;`,
  },
  // v23 (Free Will decides more than free time, docs/features/FREE-WILL.md §11.4): which kind of choice each line of the
  // why-log was — free time, a task, a meal, the morning, the way to work, rest, after a task at night.
  {
    additive: true,
    up: db => {
      const cols = db.prepare('PRAGMA table_info(agent_decisions)').all().map(c => c.name);
      if (!cols.includes('choice')) db.exec("ALTER TABLE agent_decisions ADD COLUMN choice TEXT NOT NULL DEFAULT 'leisure'");
    },
  },
  // v24 (the Mind, docs/features/FREE-WILL.md §3–4): agent_mind is the owner's setting for each agent's thinking (cadence
  // 'off' or 'daily') and the last world day it planned and reflected; mind_jobs is every thought — a morning plan, an
  // evening reflection, a conversation — with what it did (summary_json: the plans, memories and notes it wrote, the
  // agent's own data), who paid (account_id), the tokens and the cost in millionths of a US dollar, kept by age. No
  // prompt or answer text is stored.
  {
    additive: true,
    up: `CREATE TABLE IF NOT EXISTS agent_mind (
     world_id TEXT NOT NULL,
     agent_id INTEGER NOT NULL,
     cadence TEXT NOT NULL DEFAULT 'daily' CHECK (cadence IN ('off', 'daily')),
     last_plan_day INTEGER,
     last_reflect_day INTEGER,
     updated INTEGER NOT NULL,
     updated_by INTEGER,
     PRIMARY KEY (world_id, agent_id)
   );
   CREATE TABLE IF NOT EXISTS mind_jobs (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     world_id TEXT NOT NULL,
     agent_id INTEGER NOT NULL,
     account_id INTEGER,
     kind TEXT NOT NULL CHECK (kind IN ('plan', 'reflect', 'chat')),
     world_day INTEGER,
     at INTEGER NOT NULL,
     status TEXT NOT NULL CHECK (status IN ('ok', 'failed', 'skipped')),
     error TEXT,
     connection_id INTEGER,
     model TEXT,
     in_tok INTEGER,
     out_tok INTEGER,
     cost_micro INTEGER,
     ms INTEGER,
     summary_json TEXT
   );
   CREATE INDEX IF NOT EXISTS mind_jobs_agent ON mind_jobs (world_id, agent_id, id);
   CREATE INDEX IF NOT EXISTS mind_jobs_at ON mind_jobs (world_id, at);
   CREATE INDEX IF NOT EXISTS mind_jobs_account ON mind_jobs (world_id, account_id, at);`,
  },
  // v25 (the Mind handles problems and money, docs/features/FREE-WILL.md §11.11): agent_problems is what goes wrong in an
  // agent's life — rent it couldn't pay, money running out, no home, no job — opened and resolved by what the world shows
  // (server/mind/problems.js), with the thoughts its Mind gave it and a short note of what it did (the agent's own data).
  // mind_jobs may now also record a 'problem' thought and a 'speech' (a line said out loud, moderated first): its CHECK is
  // widened by rebuilding the table (same columns, same rows; an older release reads and writes it as before), only when
  // the old CHECK is still there.
  {
    additive: true,
    up: db => {
      db.exec(`CREATE TABLE IF NOT EXISTS agent_problems (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       world_id TEXT NOT NULL,
       agent_id INTEGER NOT NULL,
       kind TEXT NOT NULL CHECK (kind IN ('rent', 'money', 'home', 'job')),
       status TEXT NOT NULL CHECK (status IN ('open', 'resolved')),
       opened INTEGER NOT NULL,
       opened_day INTEGER,
       resolved INTEGER,
       detail_json TEXT,
       thoughts INTEGER NOT NULL DEFAULT 0,
       last_thought INTEGER,
       last_thought_day INTEGER,
       note TEXT
     );
     CREATE INDEX IF NOT EXISTS agent_problems_agent ON agent_problems (world_id, agent_id, id);
     CREATE INDEX IF NOT EXISTS agent_problems_open ON agent_problems (world_id, status);`);
      const sql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'mind_jobs'").get()?.sql || '';
      if (sql && !sql.includes("'speech'")) {
        db.exec(`CREATE TABLE mind_jobs_v25 (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         world_id TEXT NOT NULL,
         agent_id INTEGER NOT NULL,
         account_id INTEGER,
         kind TEXT NOT NULL CHECK (kind IN ('plan', 'reflect', 'chat', 'problem', 'speech')),
         world_day INTEGER,
         at INTEGER NOT NULL,
         status TEXT NOT NULL CHECK (status IN ('ok', 'failed', 'skipped')),
         error TEXT,
         connection_id INTEGER,
         model TEXT,
         in_tok INTEGER,
         out_tok INTEGER,
         cost_micro INTEGER,
         ms INTEGER,
         summary_json TEXT
       );
       INSERT INTO mind_jobs_v25 SELECT id, world_id, agent_id, account_id, kind, world_day, at, status, error, connection_id, model, in_tok, out_tok, cost_micro, ms, summary_json FROM mind_jobs;
       DROP TABLE mind_jobs;
       ALTER TABLE mind_jobs_v25 RENAME TO mind_jobs;
       CREATE INDEX IF NOT EXISTS mind_jobs_agent ON mind_jobs (world_id, agent_id, id);
       CREATE INDEX IF NOT EXISTS mind_jobs_at ON mind_jobs (world_id, at);
       CREATE INDEX IF NOT EXISTS mind_jobs_account ON mind_jobs (world_id, account_id, at);`);
      }
    },
  },
  // v26 (plans and billing, docs/features/FREE-WILL.md §6, §11.13; the online platform): account_plans is each account's
  // plan — its tier, the Stripe subscription that pays it, how far it is paid and whether it is ending; account_ai_usage
  // is the month's meter per account (Free Will decisions and their cost on the platform's decision service, the
  // platform brain's cost for its agents' thoughts and for nightly reflections, and how much of its top-up packs that
  // month used); account_ai_packs the top-ups bought by card (they last until used). commerce_orders may now also hold a
  // 'plan' (a monthly subscription) and an 'ai_pack' (a one-off top-up): its CHECK is widened by rebuilding the table
  // (same columns, same rows), only when the old CHECK is still there.
  {
    additive: true,
    up: db => {
      db.exec(`CREATE TABLE IF NOT EXISTS account_plans (
       world_id TEXT NOT NULL,
       account_id INTEGER NOT NULL,
       tier TEXT NOT NULL,
       status TEXT NOT NULL CHECK (status IN ('active', 'ending', 'past_due', 'ended')),
       stripe_subscription TEXT,
       order_id TEXT,
       period_end INTEGER,
       started INTEGER NOT NULL,
       updated INTEGER NOT NULL,
       ended INTEGER,
       PRIMARY KEY (world_id, account_id)
     );
     CREATE UNIQUE INDEX IF NOT EXISTS account_plans_sub ON account_plans (stripe_subscription) WHERE stripe_subscription IS NOT NULL;
     CREATE TABLE IF NOT EXISTS account_ai_usage (
       world_id TEXT NOT NULL,
       account_id INTEGER NOT NULL,
       month TEXT NOT NULL,
       fw_decisions INTEGER NOT NULL DEFAULT 0,
       fw_micro INTEGER NOT NULL DEFAULT 0,
       mind_micro INTEGER NOT NULL DEFAULT 0,
       reflect_micro INTEGER NOT NULL DEFAULT 0,
       pack_used INTEGER NOT NULL DEFAULT 0,
       updated INTEGER NOT NULL,
       PRIMARY KEY (world_id, account_id, month)
     );
     CREATE TABLE IF NOT EXISTS account_ai_packs (
       id TEXT PRIMARY KEY,
       world_id TEXT NOT NULL,
       account_id INTEGER NOT NULL,
       micro INTEGER NOT NULL CHECK (micro > 0),
       order_id TEXT,
       status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
       bought INTEGER NOT NULL
     );
     CREATE INDEX IF NOT EXISTS account_ai_packs_account ON account_ai_packs (world_id, account_id);`);
      const sql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'commerce_orders'").get()?.sql || '';
      if (sql && !sql.includes("'ai_pack'")) {
        const keep = db.prepare('PRAGMA table_info(commerce_orders)').all().map(c => c.name).join(', ');
        db.exec(`CREATE TABLE commerce_orders_v26 (
         id TEXT PRIMARY KEY,
         world_id TEXT NOT NULL,
         account_id INTEGER NOT NULL,
         kind TEXT NOT NULL CHECK (kind IN ('lot', 'flat_sale', 'flat_rent', 'rent_month', 'ad', 'plan', 'ai_pack')),
         target TEXT NOT NULL,
         title TEXT NOT NULL,
         listing_id TEXT,
         offer_id TEXT,
         seller_kind TEXT NOT NULL,
         seller_id TEXT NOT NULL,
         price INTEGER NOT NULL CHECK (price > 0),
         currency TEXT NOT NULL,
         credits INTEGER NOT NULL DEFAULT 0 CHECK (credits >= 0),
         card INTEGER NOT NULL DEFAULT 0 CHECK (card >= 0),
         fee INTEGER NOT NULL DEFAULT 0 CHECK (fee >= 0),
         status TEXT NOT NULL CHECK (status IN ('pending', 'fulfilled', 'expired', 'cancelled', 'refunded', 'disputed', 'conflict', 'failed')),
         stripe_session TEXT,
         stripe_payment TEXT,
         stripe_subscription TEXT,
         reserved_until INTEGER,
         was_lifecycle TEXT,
         terms_version TEXT NOT NULL,
         livemode INTEGER,
         created INTEGER NOT NULL,
         updated INTEGER NOT NULL,
         settled INTEGER,
         note TEXT,
         pay TEXT
       );
       INSERT INTO commerce_orders_v26 (${keep}) SELECT ${keep} FROM commerce_orders;
       DROP TABLE commerce_orders;
       ALTER TABLE commerce_orders_v26 RENAME TO commerce_orders;
       CREATE UNIQUE INDEX IF NOT EXISTS commerce_orders_one_pending ON commerce_orders (world_id, kind, target) WHERE status = 'pending';
       CREATE UNIQUE INDEX IF NOT EXISTS commerce_orders_session ON commerce_orders (stripe_session) WHERE stripe_session IS NOT NULL;
       CREATE INDEX IF NOT EXISTS commerce_orders_account ON commerce_orders (world_id, account_id, created);
       CREATE INDEX IF NOT EXISTS commerce_orders_status ON commerce_orders (world_id, status);
       CREATE INDEX IF NOT EXISTS commerce_orders_payment ON commerce_orders (stripe_payment) WHERE stripe_payment IS NOT NULL;`);
      }
    },
  },
  // v27 (the platform's chat window, docs/features/CHAT.md): chat_messages holds every chat's messages (they were one JSON
  // file per session; server/chat/transcript.js imports those once) — each with an id, so a message can be edited and
  // an answer written again, and its meta (model, effort, tokens, cost, attachments); chat_messages_fts searches them
  // (an external-content FTS5 index kept by triggers). chat_sessions gains the session's own model and thinking effort
  // (the window's pickers; NULL = the agent's) and pinned.
  {
    additive: true,
    up: db => {
      db.exec(`CREATE TABLE IF NOT EXISTS chat_messages (
       id INTEGER PRIMARY KEY,
       world_id TEXT NOT NULL,
       account_id INTEGER NOT NULL,
       agent_id INTEGER NOT NULL,
       session_id INTEGER NOT NULL,
       role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
       text TEXT NOT NULL,
       run_id TEXT,
       status TEXT,
       meta_json TEXT,
       ts INTEGER NOT NULL
     );
     CREATE INDEX IF NOT EXISTS chat_messages_session ON chat_messages (world_id, session_id, id);
     CREATE INDEX IF NOT EXISTS chat_messages_account ON chat_messages (world_id, account_id, agent_id);
     CREATE VIRTUAL TABLE IF NOT EXISTS chat_messages_fts USING fts5(text, content='chat_messages', content_rowid='id', tokenize='unicode61 remove_diacritics 2');
     CREATE TRIGGER IF NOT EXISTS chat_messages_ai AFTER INSERT ON chat_messages BEGIN
       INSERT INTO chat_messages_fts (rowid, text) VALUES (new.id, new.text);
     END;
     CREATE TRIGGER IF NOT EXISTS chat_messages_ad AFTER DELETE ON chat_messages BEGIN
       INSERT INTO chat_messages_fts (chat_messages_fts, rowid, text) VALUES ('delete', old.id, old.text);
     END;
     CREATE TRIGGER IF NOT EXISTS chat_messages_au AFTER UPDATE OF text ON chat_messages BEGIN
       INSERT INTO chat_messages_fts (chat_messages_fts, rowid, text) VALUES ('delete', old.id, old.text);
       INSERT INTO chat_messages_fts (rowid, text) VALUES (new.id, new.text);
     END;`);
      const cols = db.prepare('PRAGMA table_info(chat_sessions)').all().map(c => c.name);
      if (!cols.includes('model')) db.exec('ALTER TABLE chat_sessions ADD COLUMN model TEXT');
      if (!cols.includes('effort')) db.exec('ALTER TABLE chat_sessions ADD COLUMN effort TEXT');
      if (!cols.includes('pinned')) db.exec('ALTER TABLE chat_sessions ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0');
    },
  },
  // v28 (notifications, docs/features/CHAT.md §8): notifications is what an account is told — an agent asking for its
  // OK, a note from an agent, an answer that came while it was away — kept (200 an account, the read ones 30 days) and
  // marked read; push_subscriptions are the browsers and phones that asked to be told when the page isn't open (Web
  // Push: the push service's address and the browser's keys), each with its failures (one gone is dropped).
  {
    additive: true,
    up: db => {
      db.exec(`CREATE TABLE IF NOT EXISTS notifications (
       id INTEGER PRIMARY KEY,
       world_id TEXT NOT NULL,
       account_id INTEGER NOT NULL,
       kind TEXT NOT NULL,
       title TEXT NOT NULL,
       body TEXT NOT NULL DEFAULT '',
       link_json TEXT,
       created INTEGER NOT NULL,
       read_at INTEGER
     );
     CREATE INDEX IF NOT EXISTS notifications_account ON notifications (world_id, account_id, id);
     CREATE TABLE IF NOT EXISTS push_subscriptions (
       id INTEGER PRIMARY KEY,
       world_id TEXT NOT NULL,
       account_id INTEGER NOT NULL,
       endpoint TEXT NOT NULL,
       p256dh TEXT NOT NULL,
       auth TEXT NOT NULL,
       device TEXT NOT NULL DEFAULT '',
       created INTEGER NOT NULL,
       last_ok INTEGER,
       fails INTEGER NOT NULL DEFAULT 0
     );
     CREATE UNIQUE INDEX IF NOT EXISTS push_subscriptions_endpoint ON push_subscriptions (world_id, endpoint);
     CREATE INDEX IF NOT EXISTS push_subscriptions_account ON push_subscriptions (world_id, account_id);`);
    },
  },
  // v29 (voice, docs/features/CHAT.md §9): the month's meter per account also counts the installation's voice — seconds
  // heard and spoken through the platform's voice services (a plan's voice minutes) and their cost (millionths of a US$);
  // voice_prefs is an account's own voice choices (which service listens to it, which speaks to it, its language). An
  // agent's own voice is kept with the agent (agents.voice_json, there since v1).
  {
    additive: true,
    up: db => {
      const cols = db.prepare('PRAGMA table_info(account_ai_usage)').all().map(c => c.name);
      if (!cols.includes('voice_seconds')) db.exec('ALTER TABLE account_ai_usage ADD COLUMN voice_seconds REAL NOT NULL DEFAULT 0');
      if (!cols.includes('voice_micro')) db.exec('ALTER TABLE account_ai_usage ADD COLUMN voice_micro INTEGER NOT NULL DEFAULT 0');
      db.exec(`CREATE TABLE IF NOT EXISTS voice_prefs (
       world_id TEXT NOT NULL,
       account_id INTEGER NOT NULL,
       prefs_json TEXT NOT NULL,
       updated INTEGER NOT NULL,
       PRIMARY KEY (world_id, account_id)
     );`);
    },
  },
  // v30 (chat projects, docs/features/CHAT.md §12): chat_projects are an account's folders of chats with one agent, each
  // with its own instructions the agent follows in those chats (2026-10-08: "Projects" in the chat window's
  // Sidebar); chat_sessions.project_id puts a chat in one (NULL: none). A project removed leaves its chats, outside it.
  {
    additive: true,
    up: db => {
      db.exec(`CREATE TABLE IF NOT EXISTS chat_projects (
       id INTEGER PRIMARY KEY,
       world_id TEXT NOT NULL,
       account_id INTEGER NOT NULL,
       agent_id INTEGER NOT NULL,
       name TEXT NOT NULL,
       instructions TEXT NOT NULL DEFAULT '',
       created INTEGER NOT NULL,
       updated INTEGER NOT NULL
     );
     CREATE INDEX IF NOT EXISTS chat_projects_owner ON chat_projects (world_id, account_id, agent_id);`);
      const cols = db.prepare('PRAGMA table_info(chat_sessions)').all().map(c => c.name);
      if (!cols.includes('project_id')) db.exec('ALTER TABLE chat_sessions ADD COLUMN project_id INTEGER');
    },
  },
  // v31 (Settings → Display → Transparency, docs/features/CHAT.md §12): the chat window's own transparency
  // (display.chatOpacity, the share of its background kept, "100" to "50") became the theme's, for every window
  // (display.transparency, the share see-through, 0–60): an account that had chosen one keeps its look. The old row
  // stays (nothing reads it now; a release that still knows it can), and a transparency already chosen is kept.
  {
    additive: true,
    up: `INSERT OR IGNORE INTO account_settings (account_id, world_id, key, value, updated)
     SELECT account_id, world_id, 'display.transparency', CAST(100 - CAST(json_extract(value, '$') AS INTEGER) AS TEXT), updated
       FROM account_settings
      WHERE key = 'display.chatOpacity' AND json_valid(value) AND CAST(json_extract(value, '$') AS INTEGER) BETWEEN 40 AND 95
        AND CAST(json_extract(value, '$') AS INTEGER) % 5 = 0;`,
  },
  // v32 (an agent's work, docs/features/CHAT.md §13): agent_work is an agent's job brief (who it works for, what it is
  // to do and how, its tone, its time zone, what it knows, the mode a new chat starts in); agent_work_notes is what it
  // keeps from work chats, apart from its memories of its life in the city; agent_work_files are the files it knows for
  // its job (a copy of each, its text read once); chat_sessions.mode is a chat's own Work or Life (NULL: the agent's).
  {
    additive: true,
    up: db => {
      db.exec(`CREATE TABLE IF NOT EXISTS agent_work (
       world_id TEXT NOT NULL,
       agent_id INTEGER NOT NULL,
       brief_json TEXT NOT NULL,
       updated INTEGER NOT NULL,
       PRIMARY KEY (world_id, agent_id)
     );
     CREATE TABLE IF NOT EXISTS agent_work_notes (
       id INTEGER PRIMARY KEY,
       world_id TEXT NOT NULL,
       agent_id INTEGER NOT NULL,
       text TEXT NOT NULL,
       source TEXT NOT NULL,
       created INTEGER NOT NULL
     );
     CREATE INDEX IF NOT EXISTS agent_work_notes_agent ON agent_work_notes (world_id, agent_id, id);
     CREATE TABLE IF NOT EXISTS agent_work_files (
       id INTEGER PRIMARY KEY,
       world_id TEXT NOT NULL,
       agent_id INTEGER NOT NULL,
       sha256 TEXT NOT NULL,
       name TEXT NOT NULL,
       mime TEXT NOT NULL,
       size INTEGER NOT NULL,
       kind TEXT NOT NULL,
       text TEXT,
       created INTEGER NOT NULL
     );
     CREATE INDEX IF NOT EXISTS agent_work_files_agent ON agent_work_files (world_id, agent_id, id);`);
      const cols = db.prepare('PRAGMA table_info(chat_sessions)').all().map(c => c.name);
      if (!cols.includes('mode')) db.exec('ALTER TABLE chat_sessions ADD COLUMN mode TEXT');
    },
  },
  // v33 (talking with others' agents in the city, docs/features/CHAT.md §14): chat_sessions.kind 'talk' is one such
  // conversation (a player with someone else's agent: a few short messages, cleared after a few minutes; never in the
  // chat window's lists; its agent's owner may read it); talk_blocks are whom an owner keeps from talking with their
  // agents — a player (account_id) or another agent (agent_id).
  {
    additive: true,
    up: db => {
      const cols = db.prepare('PRAGMA table_info(chat_sessions)').all().map(c => c.name);
      if (!cols.includes('kind')) db.exec('ALTER TABLE chat_sessions ADD COLUMN kind TEXT');
      db.exec(`CREATE INDEX IF NOT EXISTS chat_sessions_agent_kind ON chat_sessions (world_id, agent_id, kind, updated);
     CREATE TABLE IF NOT EXISTS talk_blocks (
       id INTEGER PRIMARY KEY,
       world_id TEXT NOT NULL,
       owner_id INTEGER NOT NULL,
       account_id INTEGER,
       agent_id INTEGER,
       created INTEGER NOT NULL
     );
     CREATE UNIQUE INDEX IF NOT EXISTS talk_blocks_one ON talk_blocks (world_id, owner_id, IFNULL(account_id, 0), IFNULL(agent_id, 0));`);
    },
  },
  // v34 (the realty market, 2026-10-08, server/commerce/market.js): realty_values are each lot's market value for a day —
  // its land and the buildings on it, in the shop's minor units, with the scores they came from; realty_market the day's
  // market index (10000 = 1.00) and the sales it saw; commerce_floor_rights the floors a building may have without paying
  // (the most it was bought or built up to). commerce_orders take kind 'floors' (floors bought past the included ones) and
  // promo (the offer an order used: 'launch').
  {
    additive: true,
    up: db => {
      db.exec(`CREATE TABLE IF NOT EXISTS realty_values (
       world_id TEXT NOT NULL,
       day TEXT NOT NULL,
       lot_id TEXT NOT NULL,
       land INTEGER NOT NULL,
       building INTEGER NOT NULL DEFAULT 0,
       score INTEGER NOT NULL,
       dev INTEGER NOT NULL DEFAULT 0,
       local INTEGER NOT NULL DEFAULT 10000,
       PRIMARY KEY (world_id, day, lot_id)
     );
     CREATE TABLE IF NOT EXISTS realty_market (
       world_id TEXT NOT NULL,
       day TEXT NOT NULL,
       idx INTEGER NOT NULL,
       sales INTEGER NOT NULL DEFAULT 0,
       available INTEGER NOT NULL DEFAULT 0,
       at INTEGER NOT NULL,
       PRIMARY KEY (world_id, day)
     );
     CREATE TABLE IF NOT EXISTS commerce_floor_rights (
       world_id TEXT NOT NULL,
       building TEXT NOT NULL,
       floors INTEGER NOT NULL,
       order_id TEXT,
       updated INTEGER NOT NULL,
       PRIMARY KEY (world_id, building)
     );`);
      const sql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'commerce_orders'").get()?.sql || '';
      if (sql && !sql.includes("'floors'")) {
        const keep = db.prepare('PRAGMA table_info(commerce_orders)').all().map(c => c.name).join(', ');
        db.exec(`CREATE TABLE commerce_orders_v34 (
         id TEXT PRIMARY KEY,
         world_id TEXT NOT NULL,
         account_id INTEGER NOT NULL,
         kind TEXT NOT NULL CHECK (kind IN ('lot', 'flat_sale', 'flat_rent', 'rent_month', 'ad', 'plan', 'ai_pack', 'floors')),
         target TEXT NOT NULL,
         title TEXT NOT NULL,
         listing_id TEXT,
         offer_id TEXT,
         seller_kind TEXT NOT NULL,
         seller_id TEXT NOT NULL,
         price INTEGER NOT NULL CHECK (price > 0),
         currency TEXT NOT NULL,
         credits INTEGER NOT NULL DEFAULT 0 CHECK (credits >= 0),
         card INTEGER NOT NULL DEFAULT 0 CHECK (card >= 0),
         fee INTEGER NOT NULL DEFAULT 0 CHECK (fee >= 0),
         status TEXT NOT NULL CHECK (status IN ('pending', 'fulfilled', 'expired', 'cancelled', 'refunded', 'disputed', 'conflict', 'failed')),
         stripe_session TEXT,
         stripe_payment TEXT,
         stripe_subscription TEXT,
         reserved_until INTEGER,
         was_lifecycle TEXT,
         terms_version TEXT NOT NULL,
         livemode INTEGER,
         created INTEGER NOT NULL,
         updated INTEGER NOT NULL,
         settled INTEGER,
         note TEXT,
         pay TEXT,
         promo TEXT
       );
       INSERT INTO commerce_orders_v34 (${keep}) SELECT ${keep} FROM commerce_orders;
       DROP TABLE commerce_orders;
       ALTER TABLE commerce_orders_v34 RENAME TO commerce_orders;
       CREATE UNIQUE INDEX IF NOT EXISTS commerce_orders_one_pending ON commerce_orders (world_id, kind, target) WHERE status = 'pending';
       CREATE UNIQUE INDEX IF NOT EXISTS commerce_orders_session ON commerce_orders (stripe_session) WHERE stripe_session IS NOT NULL;
       CREATE INDEX IF NOT EXISTS commerce_orders_account ON commerce_orders (world_id, account_id, created);
       CREATE INDEX IF NOT EXISTS commerce_orders_status ON commerce_orders (world_id, status);
       CREATE INDEX IF NOT EXISTS commerce_orders_payment ON commerce_orders (stripe_payment) WHERE stripe_payment IS NOT NULL;`);
      }
    },
  },
  // v35 (account emails, 2026-10-09): accounts.email_verified is when the address was confirmed (a link sent to it was
  // opened); an address belongs to one account; auth_tokens are the single-use links sent by email — confirming an
  // address ('verify') and resetting a forgotten password ('reset') — kept as hashes, each with its expiry.
  {
    additive: true,
    up: db => {
      const cols = db.prepare('PRAGMA table_info(accounts)').all().map(c => c.name);
      if (!cols.includes('email_verified')) db.exec('ALTER TABLE accounts ADD COLUMN email_verified INTEGER');
      db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS accounts_email ON accounts (world_id, email) WHERE email IS NOT NULL;
     CREATE TABLE IF NOT EXISTS auth_tokens (
       token_hash TEXT PRIMARY KEY,
       world_id TEXT NOT NULL,
       account_id INTEGER NOT NULL,
       kind TEXT NOT NULL CHECK (kind IN ('verify', 'reset')),
       email TEXT NOT NULL,
       created INTEGER NOT NULL,
       expires INTEGER NOT NULL,
       used INTEGER
     );
     CREATE INDEX IF NOT EXISTS auth_tokens_account ON auth_tokens (world_id, account_id, kind);`);
    },
  },
  // v36 (signing in with Google, 2026-10-09; server/auth/oauth.js): account_identities link an account to its account at
  // a sign-in provider (the provider's stable subject id); oauth_states are the sign-ins on their way to the provider and
  // back (single use, ten minutes; the PKCE verifier and nonce with them, the state and the browser binding only as
  // hashes; 'reauth' confirms who is at a signed-in session, which is named); oauth_pending are new people who came back
  // from the provider and are choosing their username. accounts.no_password: an account made through a provider has no
  // password of its own until its person sets one (a random one is stored so sign-in by password costs the same).
  {
    additive: true,
    up: db => {
      const cols = db.prepare('PRAGMA table_info(accounts)').all().map(c => c.name);
      if (!cols.includes('no_password')) db.exec('ALTER TABLE accounts ADD COLUMN no_password INTEGER NOT NULL DEFAULT 0');
      db.exec(`CREATE TABLE IF NOT EXISTS account_identities (
       world_id TEXT NOT NULL,
       provider TEXT NOT NULL,
       subject TEXT NOT NULL,
       account_id INTEGER NOT NULL,
       email TEXT,
       created INTEGER NOT NULL,
       last_used INTEGER,
       PRIMARY KEY (world_id, provider, subject)
     );
     CREATE INDEX IF NOT EXISTS account_identities_account ON account_identities (world_id, account_id);
     CREATE TABLE IF NOT EXISTS oauth_states (
       state_hash TEXT PRIMARY KEY,
       world_id TEXT NOT NULL,
       provider TEXT NOT NULL,
       intent TEXT NOT NULL CHECK (intent IN ('signin', 'link', 'reauth')),
       account_id INTEGER,
       session_id INTEGER,
       nonce TEXT NOT NULL,
       verifier TEXT NOT NULL,
       binder_hash TEXT NOT NULL,
       redirect_uri TEXT NOT NULL,
       created INTEGER NOT NULL,
       expires INTEGER NOT NULL
     );
     CREATE TABLE IF NOT EXISTS oauth_pending (
       token_hash TEXT PRIMARY KEY,
       world_id TEXT NOT NULL,
       provider TEXT NOT NULL,
       subject TEXT NOT NULL,
       email TEXT NOT NULL,
       name TEXT,
       created INTEGER NOT NULL,
       expires INTEGER NOT NULL
     );`);
    },
  },
  // v37 (2026-10-09): the People page (server/people.js) — the owner's and admins' own notes and tags on an account; and
  // each paying account's Stripe customer (one per Stripe mode: a test customer is not a live one), so every payment in
  // Stripe names the player who made it.
  {
    additive: true,
    up: `CREATE TABLE IF NOT EXISTS account_notes (
     world_id TEXT NOT NULL,
     account_id INTEGER NOT NULL,
     note TEXT NOT NULL DEFAULT '',
     tags TEXT NOT NULL DEFAULT '',
     updated INTEGER NOT NULL,
     updated_by INTEGER,
     PRIMARY KEY (world_id, account_id)
   );
   CREATE TABLE IF NOT EXISTS commerce_customers (
     world_id TEXT NOT NULL,
     account_id INTEGER NOT NULL,
     mode TEXT NOT NULL CHECK (mode IN ('live', 'test')),
     customer TEXT NOT NULL,
     created INTEGER NOT NULL,
     PRIMARY KEY (world_id, account_id, mode)
   );`,
  },
  // v38 (2026-10-09): gift codes (server/commerce/gifts.js) — a code claims one city lot for nothing, once; it may name
  // who it was made for, be limited to lots worth up to a value, expire, and belongs to a batch (one lot per account per
  // batch). The order it made carries promo 'gift'.
  {
    additive: true,
    up: `CREATE TABLE IF NOT EXISTS commerce_gifts (
     id TEXT PRIMARY KEY,
     world_id TEXT NOT NULL,
     code TEXT NOT NULL,
     kind TEXT NOT NULL DEFAULT 'lot' CHECK (kind IN ('lot')),
     max_value INTEGER,
     expires INTEGER,
     email TEXT,
     name TEXT,
     note TEXT,
     batch TEXT,
     created INTEGER NOT NULL,
     created_by INTEGER,
     redeemed INTEGER,
     redeemed_by INTEGER,
     order_id TEXT,
     revoked INTEGER,
     UNIQUE (world_id, code)
   );
   CREATE INDEX IF NOT EXISTS commerce_gifts_batch ON commerce_gifts (world_id, batch, redeemed_by);`,
  },
  // v39 (2026-10-10): AI apps connecting to the world (server/connector/) — the OAuth 2.1 authorization server MCP clients
  // (Grok, ChatGPT, Gemini, Claude, Meta AI…) sign in through: their registrations or fetched metadata documents
  // (mcp_clients), authorization requests waiting for the person's consent (mcp_requests), single-use codes
  // (mcp_codes), what a person allowed — which app acts as which of their agents (mcp_grants) — and tokens (hashes
  // only, mcp_tokens).
  {
    additive: true,
    up: `CREATE TABLE IF NOT EXISTS mcp_clients (
     id TEXT NOT NULL,
     world_id TEXT NOT NULL,
     kind TEXT NOT NULL CHECK (kind IN ('registered', 'document')),
     name TEXT NOT NULL,
     uri TEXT,
     logo TEXT,
     redirect_uris TEXT NOT NULL,
     auth_method TEXT NOT NULL DEFAULT 'none',
     secret_hash TEXT,
     created INTEGER NOT NULL,
     fetched INTEGER,
     ip TEXT,
     PRIMARY KEY (world_id, id)
   );
   CREATE TABLE IF NOT EXISTS mcp_requests (
     id_hash TEXT PRIMARY KEY,
     world_id TEXT NOT NULL,
     client_id TEXT NOT NULL,
     redirect_uri TEXT NOT NULL,
     state TEXT,
     challenge TEXT NOT NULL,
     scope TEXT NOT NULL,
     resource TEXT NOT NULL,
     created INTEGER NOT NULL,
     expires INTEGER NOT NULL
   );
   CREATE TABLE IF NOT EXISTS mcp_grants (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     world_id TEXT NOT NULL,
     account_id INTEGER NOT NULL,
     agent_id INTEGER NOT NULL,
     client_id TEXT NOT NULL,
     client_name TEXT NOT NULL,
     scope TEXT NOT NULL,
     resource TEXT NOT NULL,
     created INTEGER NOT NULL,
     last_used INTEGER,
     revoked INTEGER
   );
   CREATE INDEX IF NOT EXISTS mcp_grants_account ON mcp_grants (world_id, account_id);
   CREATE TABLE IF NOT EXISTS mcp_codes (
     code_hash TEXT PRIMARY KEY,
     world_id TEXT NOT NULL,
     grant_id INTEGER NOT NULL,
     client_id TEXT NOT NULL,
     redirect_uri TEXT NOT NULL,
     challenge TEXT NOT NULL,
     resource TEXT NOT NULL,
     created INTEGER NOT NULL,
     expires INTEGER NOT NULL,
     used INTEGER
   );
   CREATE TABLE IF NOT EXISTS mcp_tokens (
     token_hash TEXT PRIMARY KEY,
     world_id TEXT NOT NULL,
     grant_id INTEGER NOT NULL,
     kind TEXT NOT NULL CHECK (kind IN ('access', 'refresh')),
     resource TEXT NOT NULL,
     created INTEGER NOT NULL,
     expires INTEGER NOT NULL,
     used INTEGER
   );
   CREATE INDEX IF NOT EXISTS mcp_tokens_grant ON mcp_tokens (world_id, grant_id);`,
  },
  // v40 (agents and friends, 2026-10-10; server/agent-social/): a relation also keeps whether its agent
  // ended the friendship (ended_until: the world day it may grow again), blocked them itself, and the world day its fading
  // was last counted. agent_messages are what agents send each other from a distance — messages, invitations and the
  // world's notices to them — kept for their owners to read (and the day's limits counted from them, so a restart doesn't
  // start them again). agent_social is each agent's own settings (its owner's); agent_social_uses counts what isn't a
  // message (looking up where a friend is).
  {
    additive: true,
    up: db => {
      const cols = db.prepare('PRAGMA table_info(agent_relations)').all().map(c => c.name);
      if (!cols.includes('ended_until')) db.exec('ALTER TABLE agent_relations ADD COLUMN ended_until INTEGER');
      if (!cols.includes('blocked')) db.exec('ALTER TABLE agent_relations ADD COLUMN blocked INTEGER NOT NULL DEFAULT 0');
      if (!cols.includes('faded_day')) db.exec('ALTER TABLE agent_relations ADD COLUMN faded_day INTEGER');
      db.exec(`CREATE TABLE IF NOT EXISTS agent_messages (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       world_id TEXT NOT NULL,
       from_agent INTEGER NOT NULL,
       to_agent INTEGER NOT NULL,
       kind TEXT NOT NULL CHECK (kind IN ('message', 'invite', 'notice')),
       text TEXT NOT NULL,
       reply_to INTEGER,
       status TEXT NOT NULL,
       place TEXT,
       venue_b INTEGER,
       venue_f INTEGER,
       venue_kind TEXT,
       at_world INTEGER,
       stay_minutes INTEGER,
       detail_json TEXT,
       created INTEGER NOT NULL,
       delivered INTEGER,
       answered INTEGER,
       reported INTEGER
     );
     CREATE INDEX IF NOT EXISTS agent_messages_to ON agent_messages (world_id, to_agent, delivered);
     CREATE INDEX IF NOT EXISTS agent_messages_from ON agent_messages (world_id, from_agent, created);
     CREATE INDEX IF NOT EXISTS agent_messages_pair ON agent_messages (world_id, from_agent, to_agent, created);
     CREATE INDEX IF NOT EXISTS agent_messages_invites ON agent_messages (world_id, kind, status);
     CREATE TABLE IF NOT EXISTS agent_social (
       world_id TEXT NOT NULL,
       agent_id INTEGER NOT NULL,
       reach TEXT NOT NULL DEFAULT 'friends' CHECK (reach IN ('friends', 'mine', 'nobody')),
       hear_strangers INTEGER NOT NULL DEFAULT 0,
       per_day INTEGER,
       updated INTEGER NOT NULL,
       updated_by INTEGER,
       PRIMARY KEY (world_id, agent_id)
     );
     CREATE TABLE IF NOT EXISTS agent_social_uses (
       world_id TEXT NOT NULL,
       agent_id INTEGER NOT NULL,
       kind TEXT NOT NULL,
       at INTEGER NOT NULL
     );
     CREATE INDEX IF NOT EXISTS agent_social_uses_at ON agent_social_uses (world_id, agent_id, kind, at);`);
    },
  },
  // v41 (agents and friends, 2026-10-10): the Mind's answer to a friend's message is a thought of its own
  // kind ('friend'), recorded and counted like the others (its cost in the day's and the month's totals).
  {
    additive: true,
    up: db => {
      const sql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'mind_jobs'").get()?.sql || '';
      if (sql && !sql.includes("'friend'")) {
        db.exec(`CREATE TABLE mind_jobs_v41 (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         world_id TEXT NOT NULL,
         agent_id INTEGER NOT NULL,
         account_id INTEGER,
         kind TEXT NOT NULL CHECK (kind IN ('plan', 'reflect', 'chat', 'problem', 'speech', 'friend')),
         world_day INTEGER,
         at INTEGER NOT NULL,
         status TEXT NOT NULL CHECK (status IN ('ok', 'failed', 'skipped')),
         error TEXT,
         connection_id INTEGER,
         model TEXT,
         in_tok INTEGER,
         out_tok INTEGER,
         cost_micro INTEGER,
         ms INTEGER,
         summary_json TEXT
       );
       INSERT INTO mind_jobs_v41 SELECT id, world_id, agent_id, account_id, kind, world_day, at, status, error, connection_id, model, in_tok, out_tok, cost_micro, ms, summary_json FROM mind_jobs;
       DROP TABLE mind_jobs;
       ALTER TABLE mind_jobs_v41 RENAME TO mind_jobs;
       CREATE INDEX IF NOT EXISTS mind_jobs_agent ON mind_jobs (world_id, agent_id, id);
       CREATE INDEX IF NOT EXISTS mind_jobs_at ON mind_jobs (world_id, at);
       CREATE INDEX IF NOT EXISTS mind_jobs_account ON mind_jobs (world_id, account_id, at);`);
      }
    },
  },
  // v42 (agents and friends, 2026-10-10): whether an agent with a Mind of its own may start a conversation
  // or an invitation by itself (its owner's switch; on by default — the admin's daily numbers still apply)
  {
    additive: true,
    up: db => {
      const cols = db.prepare('PRAGMA table_info(agent_social)').all().map(c => c.name);
      if (cols.length && !cols.includes('starts')) db.exec('ALTER TABLE agent_social ADD COLUMN starts INTEGER NOT NULL DEFAULT 1');
    },
  },
  // v43 (a connected agent's safety, 2026-10-11): a new connection waits for its owner's OK (approved_at; the ones already
  // connected count as approved), when it joined, and the addresses it signed in from (its owner hears of a new one)
  {
    additive: true,
    up: db => {
      const cols = db.prepare('PRAGMA table_info(agent_slots)').all().map(c => c.name);
      if (!cols.length) return;
      for (const [c, type] of [['approved_at', 'INTEGER'], ['enrolled_at', 'INTEGER'], ['known_ips', 'TEXT'], ['ip_alert_at', 'INTEGER']]) if (!cols.includes(c)) db.exec(`ALTER TABLE agent_slots ADD COLUMN ${c} ${type}`);
      db.exec("UPDATE agent_slots SET approved_at = updated, enrolled_at = updated WHERE status = 'active' AND approved_at IS NULL");
    },
  },
  // v44 (a connected agent's wake-up link, 2026-10-11): the address its own platform gave for starting it (a webhook), with
  // the key and header that go with it, sealed; what wakes it, how often at most, and how the last calls went
  {
    additive: true,
    up: db => db.exec(`
      CREATE TABLE IF NOT EXISTS agent_wakeups (
        world_id TEXT NOT NULL,
        slot_id INTEGER NOT NULL,
        sealed TEXT NOT NULL,
        host TEXT NOT NULL,
        events TEXT NOT NULL,
        per_hour INTEGER NOT NULL,
        sent TEXT,
        last_at INTEGER,
        last_ok INTEGER,
        last_status TEXT,
        fails INTEGER NOT NULL DEFAULT 0,
        paused INTEGER NOT NULL DEFAULT 0,
        updated INTEGER NOT NULL,
        PRIMARY KEY (world_id, slot_id)
      );`),
  },
  // v45 (third-party agents, 2026-10-12): which AI app a connected agent is for (shared/agent-apps.js: grok-bot,
  // openai-dot, meta-muse; NULL = any app or program), so its Studio and lists show that app's logo and steps
  {
    additive: true,
    up: db => {
      const cols = db.prepare('PRAGMA table_info(agent_slots)').all().map(c => c.name);
      if (cols.length && !cols.includes('app')) db.exec('ALTER TABLE agent_slots ADD COLUMN app TEXT');
    },
  },
  // v46 (2026-10-13: a Grok account shares its connectors between all its bots, and an app reuses the sign-in it already
  // has for an address): each connected agent gets its own MCP address, <world>/mcp/a/<mcp_handle>, so an app sees one
  // server per agent and its sign-in can only be for that agent (server/connector/http.js). The handle is not a secret:
  // it names the agent's door; the sign-in is still its owner's.
  {
    additive: true,
    up: db => {
      const cols = db.prepare('PRAGMA table_info(agent_slots)').all().map(c => c.name);
      if (!cols.length) return;
      if (!cols.includes('mcp_handle')) db.exec('ALTER TABLE agent_slots ADD COLUMN mcp_handle TEXT');
      db.exec("UPDATE agent_slots SET mcp_handle = lower(hex(randomblob(8))) WHERE mcp_handle IS NULL");
      db.exec('CREATE UNIQUE INDEX IF NOT EXISTS agent_slots_mcp_handle ON agent_slots (mcp_handle)');
    },
  },
  // v47 (play modules, 2026-10-13: docs/features/play-modules.md): a player's experience in each module, the best result
  // on each course (the leaderboards), every finished run, the badges earned, and the player's own profile (a short bio
  // and the badges pinned to show off); a run's prize in Virtual Coin (hundredths) is kept with it
  {
    additive: true,
    up: `
      CREATE TABLE IF NOT EXISTS play_progress (
        world_id TEXT NOT NULL,
        account_id INTEGER NOT NULL,
        module TEXT NOT NULL,
        xp REAL NOT NULL DEFAULT 0,
        runs INTEGER NOT NULL DEFAULT 0,
        updated INTEGER NOT NULL,
        PRIMARY KEY (world_id, account_id, module)
      );
      CREATE TABLE IF NOT EXISTS play_best (
        world_id TEXT NOT NULL,
        module TEXT NOT NULL,
        course TEXT NOT NULL,
        account_id INTEGER NOT NULL,
        score REAL NOT NULL,
        ms INTEGER,
        stars INTEGER NOT NULL,
        at INTEGER NOT NULL,
        PRIMARY KEY (world_id, module, course, account_id)
      );
      CREATE INDEX IF NOT EXISTS play_best_board ON play_best (world_id, module, course, score);
      CREATE TABLE IF NOT EXISTS play_runs (
        id INTEGER PRIMARY KEY,
        world_id TEXT NOT NULL,
        account_id INTEGER NOT NULL,
        module TEXT NOT NULL,
        course TEXT NOT NULL,
        version INTEGER NOT NULL,
        score REAL NOT NULL,
        stars INTEGER NOT NULL,
        xp REAL NOT NULL,
        vc INTEGER NOT NULL DEFAULT 0,
        detail TEXT,
        at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS play_runs_account ON play_runs (world_id, account_id, at);
      CREATE TABLE IF NOT EXISTS play_badges (
        world_id TEXT NOT NULL,
        account_id INTEGER NOT NULL,
        badge TEXT NOT NULL,
        at INTEGER NOT NULL,
        PRIMARY KEY (world_id, account_id, badge)
      );
      CREATE TABLE IF NOT EXISTS player_profiles (
        world_id TEXT NOT NULL,
        account_id INTEGER NOT NULL,
        bio TEXT,
        showcase TEXT,
        updated INTEGER NOT NULL,
        PRIMARY KEY (world_id, account_id)
      );`,
  },
  // v48 (free lots, 2026-10-13: the product owner's "claimable lots … first come first serve … then they can earn the
  // property"): a city lot listed free to claim, and each claim's homestead — claimed, earned by its checklist before it
  // is due (agents with brains, one public, a billboard, days it came back), or released back to the city — with what
  // stood on the lot when it was claimed (kept: the city's own buildings and decorations stay when it goes back)
  {
    additive: true,
    up: db => {
      const cols = db.prepare('PRAGMA table_info(commerce_listings)').all().map(c => c.name);
      if (cols.length && !cols.includes('free')) db.exec('ALTER TABLE commerce_listings ADD COLUMN free INTEGER NOT NULL DEFAULT 0');
      db.exec(`
      CREATE TABLE IF NOT EXISTS homesteads (
        id TEXT PRIMARY KEY,
        world_id TEXT NOT NULL,
        lot_id TEXT NOT NULL,
        account_id INTEGER NOT NULL,
        order_id TEXT,
        status TEXT NOT NULL CHECK (status IN ('open', 'earned', 'released')),
        claimed INTEGER NOT NULL,
        due INTEGER NOT NULL,
        days TEXT NOT NULL DEFAULT '[]',
        reminded INTEGER NOT NULL DEFAULT 0,
        settled INTEGER,
        note TEXT,
        kept TEXT
      );
      CREATE INDEX IF NOT EXISTS homesteads_account ON homesteads (world_id, account_id);
      CREATE INDEX IF NOT EXISTS homesteads_open ON homesteads (world_id, status, due);
      CREATE UNIQUE INDEX IF NOT EXISTS homesteads_open_lot ON homesteads (world_id, lot_id) WHERE status = 'open';`);
    },
  },
  // v49 (the world's brain for new players, 2026-10-14: server/plans/plans.js): what trial thinking cost, on the month's
  // meter, and whose trial's end its owner was told of
  {
    additive: true,
    up: db => {
      const cols = db.prepare('PRAGMA table_info(account_ai_usage)').all().map(c => c.name);
      if (cols.length && !cols.includes('trial_micro')) db.exec('ALTER TABLE account_ai_usage ADD COLUMN trial_micro INTEGER NOT NULL DEFAULT 0');
      db.exec(`
      CREATE TABLE IF NOT EXISTS brain_trials (
        world_id TEXT NOT NULL,
        account_id INTEGER NOT NULL,
        ended_noted INTEGER NOT NULL,
        PRIMARY KEY (world_id, account_id)
      );`);
    },
  },
  // v50 (the inventory, 2026-10-14: server/economy/inventory.js): what each player, agent or business holds — its
  // owner the economy's own subject ('account:12', 'agent:7'), plain stacks (one row per kind of item) or one-of-a-kind
  // pieces (a fish with its length and weight: attrs), some set aside for an open trade (held); every change logged
  // (inv_moves, an idempotency key on each); trades: what each side puts in, until both accept
  {
    additive: true,
    up: `
      CREATE TABLE IF NOT EXISTS inv_items (
        world_id TEXT NOT NULL,
        id INTEGER PRIMARY KEY,
        owner TEXT NOT NULL,
        item TEXT NOT NULL,
        qty INTEGER NOT NULL CHECK (qty > 0),
        held INTEGER NOT NULL DEFAULT 0 CHECK (held >= 0 AND held <= qty),
        attrs TEXT,
        got INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS inv_items_owner ON inv_items (world_id, owner);
      CREATE UNIQUE INDEX IF NOT EXISTS inv_items_stack ON inv_items (world_id, owner, item) WHERE attrs IS NULL;
      CREATE TABLE IF NOT EXISTS inv_moves (
        world_id TEXT NOT NULL,
        id INTEGER PRIMARY KEY,
        at INTEGER NOT NULL,
        kind TEXT NOT NULL,
        item TEXT NOT NULL,
        qty INTEGER NOT NULL,
        attrs TEXT,
        src TEXT,
        dst TEXT,
        actor TEXT,
        memo TEXT,
        ref TEXT,
        value INTEGER NOT NULL DEFAULT 0,
        idem TEXT
      );
      CREATE INDEX IF NOT EXISTS inv_moves_src ON inv_moves (world_id, src, at);
      CREATE INDEX IF NOT EXISTS inv_moves_dst ON inv_moves (world_id, dst, at);
      CREATE UNIQUE INDEX IF NOT EXISTS inv_moves_idem ON inv_moves (world_id, idem) WHERE idem IS NOT NULL;
      CREATE TABLE IF NOT EXISTS inv_trades (
        world_id TEXT NOT NULL,
        id TEXT PRIMARY KEY,
        a TEXT NOT NULL,
        b TEXT NOT NULL,
        a_offer TEXT NOT NULL,
        b_offer TEXT NOT NULL,
        a_ok INTEGER NOT NULL DEFAULT 0,
        b_ok INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL,
        memo TEXT,
        created INTEGER NOT NULL,
        updated INTEGER NOT NULL,
        expires INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS inv_trades_a ON inv_trades (world_id, a, status);
      CREATE INDEX IF NOT EXISTS inv_trades_b ON inv_trades (world_id, b, status);`,
  },
  // v51 (the fishing game's angler, 2026-10-14: server/play/angler.js): what an angler has chosen and bought beyond the
  // things in their inventory — the rod, reel and line they fish with, their boat's upgrades and their skills (kit),
  // their running totals (stats); the Fishdex (every species they've landed: how many, their best); the world's
  // records (the biggest of each species, who landed it)
  {
    additive: true,
    up: `
      CREATE TABLE IF NOT EXISTS fish_anglers (
        world_id TEXT NOT NULL,
        account_id INTEGER NOT NULL,
        kit TEXT NOT NULL DEFAULT '{}',
        stats TEXT NOT NULL DEFAULT '{}',
        updated INTEGER NOT NULL,
        PRIMARY KEY (world_id, account_id)
      );
      CREATE TABLE IF NOT EXISTS fish_dex (
        world_id TEXT NOT NULL,
        account_id INTEGER NOT NULL,
        species TEXT NOT NULL,
        n INTEGER NOT NULL DEFAULT 0,
        best_kg REAL NOT NULL DEFAULT 0,
        best_cm REAL NOT NULL DEFAULT 0,
        first_at INTEGER NOT NULL,
        best_at INTEGER NOT NULL,
        PRIMARY KEY (world_id, account_id, species)
      );
      CREATE TABLE IF NOT EXISTS fish_records (
        world_id TEXT NOT NULL,
        species TEXT NOT NULL,
        account_id INTEGER NOT NULL,
        kg REAL NOT NULL,
        cm REAL NOT NULL,
        at INTEGER NOT NULL,
        PRIMARY KEY (world_id, species)
      );`,
  },
  // v52 (agents' phones, 2026-10-16: server/phone/phone.js, docs/features/phone.md): a Twilio number given to an agent
  // (phone_lines: what reaches the agent, how calls are answered, where its texts go in its chats, the sync's place),
  // the phone's contacts, its texts (received, sent, drafts the agent wrote for its owner's OK) and calls (with the
  // voicemail's recording and transcript), and the call handler deployed in each Twilio account (phone_services).
  {
    additive: true,
    up: `
      CREATE TABLE IF NOT EXISTS phone_lines (
        id INTEGER PRIMARY KEY,
        world_id TEXT NOT NULL,
        agent_id INTEGER NOT NULL,
        connection_id INTEGER NOT NULL,
        number TEXT NOT NULL,
        number_sid TEXT NOT NULL,
        inbound TEXT NOT NULL DEFAULT 'contacts' CHECK (inbound IN ('contacts', 'anyone', 'off')),
        replies TEXT NOT NULL DEFAULT 'draft' CHECK (replies IN ('off', 'draft', 'auto')),
        agent_send TEXT NOT NULL DEFAULT 'draft' CHECK (agent_send IN ('off', 'draft', 'auto')),
        calls TEXT NOT NULL DEFAULT 'keep' CHECK (calls IN ('keep', 'forward', 'voicemail')),
        forward_to TEXT,
        ring_seconds INTEGER NOT NULL DEFAULT 20,
        voicemail INTEGER NOT NULL DEFAULT 1,
        greeting TEXT,
        ring_me TEXT,
        calls_to_agent INTEGER NOT NULL DEFAULT 1,
        notify INTEGER NOT NULL DEFAULT 1,
        session_id INTEGER,
        voice_before TEXT,
        sync_json TEXT NOT NULL DEFAULT '{}',
        state TEXT NOT NULL DEFAULT 'ok',
        error TEXT,
        created INTEGER NOT NULL,
        updated INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS phone_lines_agent ON phone_lines (world_id, agent_id);
      CREATE UNIQUE INDEX IF NOT EXISTS phone_lines_number ON phone_lines (world_id, number);
      CREATE TABLE IF NOT EXISTS phone_contacts (
        id INTEGER PRIMARY KEY,
        world_id TEXT NOT NULL,
        line_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        number TEXT NOT NULL,
        note TEXT NOT NULL DEFAULT '',
        blocked INTEGER NOT NULL DEFAULT 0,
        created INTEGER NOT NULL,
        updated INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS phone_contacts_one ON phone_contacts (world_id, line_id, number);
      CREATE TABLE IF NOT EXISTS phone_messages (
        id INTEGER PRIMARY KEY,
        world_id TEXT NOT NULL,
        line_id INTEGER NOT NULL,
        sid TEXT,
        direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
        peer TEXT NOT NULL,
        body TEXT NOT NULL DEFAULT '',
        media INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT '',
        error_code INTEGER,
        origin TEXT NOT NULL DEFAULT 'twilio',
        author_id INTEGER,
        state TEXT NOT NULL CHECK (state IN ('received', 'draft', 'sending', 'sent', 'failed', 'discarded')),
        agent_state TEXT NOT NULL DEFAULT 'none' CHECK (agent_state IN ('none', 'pending', 'delivered', 'skipped', 'failed')),
        run_id TEXT,
        reply_to INTEGER,
        read_at INTEGER,
        at INTEGER NOT NULL,
        created INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS phone_messages_sid ON phone_messages (world_id, sid) WHERE sid IS NOT NULL;
      CREATE INDEX IF NOT EXISTS phone_messages_thread ON phone_messages (world_id, line_id, peer, at);
      CREATE INDEX IF NOT EXISTS phone_messages_agent ON phone_messages (world_id, agent_state) WHERE agent_state = 'pending';
      CREATE TABLE IF NOT EXISTS phone_calls (
        id INTEGER PRIMARY KEY,
        world_id TEXT NOT NULL,
        line_id INTEGER NOT NULL,
        sid TEXT NOT NULL,
        direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
        peer TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT '',
        duration INTEGER NOT NULL DEFAULT 0,
        recording_sid TEXT,
        recording_seconds INTEGER NOT NULL DEFAULT 0,
        transcript TEXT,
        transcript_state TEXT NOT NULL DEFAULT 'none' CHECK (transcript_state IN ('none', 'pending', 'done', 'failed')),
        agent_state TEXT NOT NULL DEFAULT 'none' CHECK (agent_state IN ('none', 'pending', 'delivered', 'skipped', 'failed')),
        checked INTEGER NOT NULL DEFAULT 0,
        read_at INTEGER,
        at INTEGER NOT NULL,
        created INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS phone_calls_sid ON phone_calls (world_id, sid);
      CREATE INDEX IF NOT EXISTS phone_calls_line ON phone_calls (world_id, line_id, at);
      CREATE TABLE IF NOT EXISTS phone_services (
        world_id TEXT NOT NULL,
        connection_id INTEGER NOT NULL,
        service_sid TEXT NOT NULL,
        environment_sid TEXT NOT NULL,
        domain TEXT NOT NULL,
        version TEXT NOT NULL,
        deployed INTEGER NOT NULL,
        PRIMARY KEY (world_id, connection_id)
      );`,
  },
  // v53 (agents' phones: the person takes over, 2026-10-16 — docs/features/phone.md §4): the whole phone in the person's
  // hands (phone_lines.human_since/human_by; human_last: their last text from it), or one conversation (phone_takeovers);
  // control goes back to the agent after handback_minutes without the person's texts (0: only by hand); what was said
  // meanwhile is given to the agent once it has its texts back (phone_catchups), to know, never to answer.
  {
    additive: true,
    up(db) {
      const cols = db.prepare('PRAGMA table_info(phone_lines)').all().map(c => c.name);
      if (!cols.includes('human_since')) db.exec('ALTER TABLE phone_lines ADD COLUMN human_since INTEGER');
      if (!cols.includes('human_by')) db.exec('ALTER TABLE phone_lines ADD COLUMN human_by INTEGER');
      if (!cols.includes('human_last')) db.exec('ALTER TABLE phone_lines ADD COLUMN human_last INTEGER');
      if (!cols.includes('handback_minutes')) db.exec('ALTER TABLE phone_lines ADD COLUMN handback_minutes INTEGER NOT NULL DEFAULT 120');
      db.exec(`
        CREATE TABLE IF NOT EXISTS phone_takeovers (
          world_id TEXT NOT NULL,
          line_id INTEGER NOT NULL,
          peer TEXT NOT NULL,
          by_account INTEGER,
          since INTEGER NOT NULL,
          last_human INTEGER,
          PRIMARY KEY (world_id, line_id, peer)
        );
        CREATE TABLE IF NOT EXISTS phone_catchups (
          id INTEGER PRIMARY KEY,
          world_id TEXT NOT NULL,
          line_id INTEGER NOT NULL,
          peer TEXT,
          since INTEGER NOT NULL,
          until INTEGER NOT NULL,
          by_account INTEGER,
          created INTEGER NOT NULL
        );`);
    },
  },
  // v54 (the agents' PC, 2026-10-18 — docs/features/agent-pc.md §4): an agent's work session on a task at its PC is a
  // thought of its own kind ('work'), recorded and counted like the others (one a session; its cost in the day's and the
  // month's totals). The CHECK is widened by rebuilding the table (same columns, same rows), only when it lacks 'work'.
  {
    additive: true,
    up: db => {
      const sql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'mind_jobs'").get()?.sql || '';
      if (sql && !sql.includes("'work'")) {
        db.exec(`CREATE TABLE mind_jobs_v54 (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         world_id TEXT NOT NULL,
         agent_id INTEGER NOT NULL,
         account_id INTEGER,
         kind TEXT NOT NULL CHECK (kind IN ('plan', 'reflect', 'chat', 'problem', 'speech', 'friend', 'work')),
         world_day INTEGER,
         at INTEGER NOT NULL,
         status TEXT NOT NULL CHECK (status IN ('ok', 'failed', 'skipped')),
         error TEXT,
         connection_id INTEGER,
         model TEXT,
         in_tok INTEGER,
         out_tok INTEGER,
         cost_micro INTEGER,
         ms INTEGER,
         summary_json TEXT
       );
       INSERT INTO mind_jobs_v54 SELECT id, world_id, agent_id, account_id, kind, world_day, at, status, error, connection_id, model, in_tok, out_tok, cost_micro, ms, summary_json FROM mind_jobs;
       DROP TABLE mind_jobs;
       ALTER TABLE mind_jobs_v54 RENAME TO mind_jobs;
       CREATE INDEX IF NOT EXISTS mind_jobs_agent ON mind_jobs (world_id, agent_id, id);
       CREATE INDEX IF NOT EXISTS mind_jobs_at ON mind_jobs (world_id, at);
       CREATE INDEX IF NOT EXISTS mind_jobs_account ON mind_jobs (world_id, account_id, at);`);
      }
    },
  },
  // v55 (the city's music, 2026-10-23 — docs/features/music.md): the library's tracks (the files are in <data>/music/) and
  // each stage's deck (its settings, its requests and what plays: server/music/music.js).
  {
    additive: true,
    up: `CREATE TABLE IF NOT EXISTS music_tracks (
     id TEXT PRIMARY KEY,
     world_id TEXT NOT NULL,
     title TEXT NOT NULL,
     artist TEXT NOT NULL,
     genre TEXT NOT NULL,
     mood TEXT,
     bpm REAL,
     seconds REAL NOT NULL,
     file TEXT NOT NULL,
     bytes INTEGER NOT NULL,
     gain_db REAL NOT NULL DEFAULT 0,
     source TEXT NOT NULL CHECK (source IN ('library', 'upload', 'import')),
     status TEXT NOT NULL CHECK (status IN ('approved', 'pending', 'rejected')),
     explicit INTEGER NOT NULL DEFAULT 0,
     uploader INTEGER,
     rights TEXT,
     reason TEXT,
     loop_start REAL,
     loop_end REAL,
     meta_json TEXT,
     plays INTEGER NOT NULL DEFAULT 0,
     created INTEGER NOT NULL,
     updated INTEGER NOT NULL
   );
   CREATE INDEX IF NOT EXISTS music_tracks_status ON music_tracks (world_id, status, genre);
   CREATE INDEX IF NOT EXISTS music_tracks_uploader ON music_tracks (world_id, uploader);
   CREATE TABLE IF NOT EXISTS music_decks (
     world_id TEXT NOT NULL,
     place TEXT NOT NULL,
     state_json TEXT NOT NULL,
     updated INTEGER NOT NULL,
     PRIMARY KEY (world_id, place)
   );`,
  },
  // v56 (Order Up's progression, 2026-10-28 — PLAN-RESTAURANT-GAME.md "Progression", server/play/cook.js): a cook's running
  // totals (stats) and skills, and the Cookbook (every dish a cook has served: how many, the best grade). A cook is an
  // account (its id) or an agent (minus its id), kept the same way and scored by the same rules.
  {
    additive: true,
    up: `CREATE TABLE IF NOT EXISTS ou_cooks (
     world_id TEXT NOT NULL,
     cook_id INTEGER NOT NULL,
     stats TEXT NOT NULL DEFAULT '{}',
     skills TEXT NOT NULL DEFAULT '{}',
     updated INTEGER NOT NULL,
     PRIMARY KEY (world_id, cook_id)
   );
   CREATE TABLE IF NOT EXISTS ou_cookbook (
     world_id TEXT NOT NULL,
     cook_id INTEGER NOT NULL,
     item TEXT NOT NULL,
     n INTEGER NOT NULL DEFAULT 0,
     best REAL NOT NULL DEFAULT 0,
     first_at INTEGER NOT NULL,
     best_at INTEGER NOT NULL,
     PRIMARY KEY (world_id, cook_id, item)
   );`,
  },
  // v57 (the sound's defaults, 2026-10-29 — shared/sound-defaults.js; the product owner: "make those same levels the
  // default"): a page stores the volumes it starts with when an account first signs in, so every account kept the first
  // defaults (world 70, aircraft 70, voices 100, videos 100, live music 80, background music 40, effects 80, vehicles 80,
  // radio 70). A volume still at its first default moves to the new one; one the player changed stays theirs. (Master was
  // and is 100.) Values only: an older release runs on it as before.
  {
    additive: true,
    up: `UPDATE account_settings SET value = CASE key
       WHEN 'sound.world' THEN '15' WHEN 'sound.aircraft' THEN '50' WHEN 'sound.voices' THEN '85' WHEN 'sound.media' THEN '35'
       WHEN 'sound.music' THEN '30' WHEN 'sound.score' THEN '15' WHEN 'sound.effects' THEN '10' WHEN 'sound.vehicles' THEN '10'
       WHEN 'sound.radio' THEN '30' END
      WHERE json_valid(value) AND json_type(value) IN ('integer', 'real') AND (
        (key = 'sound.world' AND json_extract(value, '$') = 70) OR (key = 'sound.aircraft' AND json_extract(value, '$') = 70)
        OR (key = 'sound.voices' AND json_extract(value, '$') = 100) OR (key = 'sound.media' AND json_extract(value, '$') = 100)
        OR (key = 'sound.music' AND json_extract(value, '$') = 80) OR (key = 'sound.score' AND json_extract(value, '$') = 40)
        OR (key = 'sound.effects' AND json_extract(value, '$') = 80) OR (key = 'sound.vehicles' AND json_extract(value, '$') = 80)
        OR (key = 'sound.radio' AND json_extract(value, '$') = 70));`,
  },
];
export const SCHEMA_VERSION = MIGRATIONS.length;
export const MIGRATION_INFO = Object.freeze(MIGRATIONS.map((m, i) => Object.freeze({ version: i + 1, additive: !!m.additive })));

/** Lowers a database's schema number to target when every newer migration is additive (DECISIONS C84), so an older
 *  release can open it; nothing is deleted. Returns { ok, from, to, changed, why }. */
export function downgradeSchema(db, target, info = MIGRATION_INFO) {
  const v = db.prepare('PRAGMA user_version').get().user_version, t = Math.max(0, Math.floor(Number(target)));
  if (!Number.isFinite(t)) return { ok: false, from: v, to: target, why: 'the target schema is not a number' };
  if (t >= v) return { ok: true, from: v, to: v, changed: false };
  if (v > info.length) return { ok: false, from: v, to: t, why: `schema ${v} is newer than this tool knows (${info.length})` };
  const blocking = info.filter(m => m.version > t && m.version <= v && !m.additive).map(m => m.version);
  if (blocking.length) return { ok: false, from: v, to: t, why: `migration ${blocking.join(', ')} changed existing data` };
  db.exec(`PRAGMA user_version = ${t}`);
  return { ok: true, from: v, to: t, changed: true };
}

function migrate(db) {
  const v = db.prepare('PRAGMA user_version').get().user_version;
  if (v > MIGRATIONS.length) {
    throw new Error(`next.db has schema ${v}, but this server only knows ${MIGRATIONS.length}: upgrade the server or restore an older backup`);
  }
  for (let k = v; k < MIGRATIONS.length; k++) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const m = MIGRATIONS[k];
      if (typeof m.up === 'function') m.up(db); else db.exec(m.up);
      db.exec(`PRAGMA user_version = ${k + 1}`);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
}

/** Opens (creating when missing, mode 0600) and migrates <dataDir>/next.db. */
const WORLD_ID_RE = /^[A-Za-z0-9-]{8,64}$/;
/** The world id stored in <dir>/world.json (DECISIONS C104), or null. */
export function worldFileId(dir) {
  try {
    const id = JSON.parse(fs.readFileSync(path.join(dir, 'world.json'), 'utf8')).worldId;
    return typeof id === 'string' && WORLD_ID_RE.test(id) ? id : null;
  } catch {
    return null;
  }
}

export function openDb(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, DB_FILE);
  if (!fs.existsSync(file)) fs.closeSync(fs.openSync(file, 'wx', 0o600));
  else {
    try { fs.chmodSync(file, 0o600); } catch { /* not ours to change; opening still works */ }
  }
  const db = new DatabaseSync(file, { enableForeignKeyConstraints: true, timeout: 5000 });
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  migrate(db);
  let worldId = db.prepare("SELECT value FROM meta WHERE key = 'world_id'").get()?.value;
  if (!worldId) {
    // A new database next to world files that carry an id takes that id (DECISIONS C104): throwaway copies of a world
    // (the tests, the release flow's browser test) and an owner who lost next.db but kept the world stay one world.
    worldId = worldFileId(dataDir) || crypto.randomUUID();
    db.prepare("INSERT INTO meta (key, value) VALUES ('world_id', ?)").run(worldId);
  }
  let depth = 0;
  const rolledBack = new Set();
  const undone = () => { for (const fn of rolledBack) { try { fn(); } catch { /* a listener's problem stays there */ } } };
  return {
    db, file, worldId,
    /** Runs fn inside one transaction. Inside an open one it is a savepoint: its failure undoes only its own writes. */
    tx(fn) {
      if (db.isTransaction) {
        const sp = `tx${++depth}`;
        db.exec(`SAVEPOINT ${sp}`);
        try {
          const r = fn();
          db.exec(`RELEASE ${sp}`);
          return r;
        } catch (e) {
          if (db.isTransaction) { db.exec(`ROLLBACK TO ${sp}`); db.exec(`RELEASE ${sp}`); }
          undone();
          throw e;
        } finally { depth--; }
      }
      db.exec('BEGIN IMMEDIATE');
      try {
        const r = fn();
        db.exec('COMMIT');
        return r;
      } catch (e) {
        if (db.isTransaction) db.exec('ROLLBACK');
        undone();
        throw e;
      }
    },
    /** fn() after any rollback (whole or partial): caches of what the database holds start again. */
    onRollback(fn) { rolledBack.add(fn); return () => rolledBack.delete(fn); },
    close() {
      try { db.close(); } catch { /* already closed */ }
    },
    backupTo(dest) { return backupDb(db, dest); },
  };
}

/** Consistent copy of an open database (SQLite online backup) into dest (created with mode 0600). */
export async function backupDb(db, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.rmSync(dest, { force: true });
  fs.closeSync(fs.openSync(dest, 'wx', 0o600));
  return backup(db, dest);
}

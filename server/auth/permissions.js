// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Roles and capabilities (DECISIONS C57, A16). Every HTTP route and WebSocket message names one capability, checked
// with Permissions.allowed(principal, capability). Defaults live in CAPS; the owner can change a capability's minimum
// role, except fixed ones, and capabilities that need an identity never drop to guest.
export const RANK = Object.freeze({ guest: 0, member: 1, admin: 2, owner: 3 });
export const ROLES = Object.freeze(Object.keys(RANK));

const cap = (min, desc, f = {}) => Object.freeze({ min, desc, identity: !!f.identity, fixed: !!f.fixed, restrictedOk: !!f.restrictedOk });
const ID = { identity: true };
/** identity: needs a signed-in account. fixed: the owner cannot change it. restrictedOk: allowed while the account
 *  must still replace a temporary password (such a session otherwise counts as a guest). */
export const CAPS = Object.freeze({
  public: cap('guest', 'Server health and the current sign-in', { fixed: true }),
  'auth.signin': cap('guest', 'Sign in', { fixed: true }),
  'auth.register': cap('guest', 'Create an account from an invite, or when open self-registration is on', { fixed: true }),
  'world.view': cap('guest', 'Watch the world: residents, buildings, and which agents are working'),
  'world.interact': cap('member', 'Talk to residents', ID),
  'world.edit': cap('admin', 'Edit buildings, interiors and residents, and direct residents', ID),
  'world.clock': cap('admin', 'Change the world clock and its speed', ID),
  // WP4.10: world management (Settings → Data). Restores and resets never touch lots or titles.
  'world.backup': cap('admin', 'Download a backup of the world: buildings, roads, the land, residents', ID),
  'world.manage': cap('admin', 'Restore a world backup or reset the residents (the server restarts to load it)', ID),
  'promo.manage': cap('admin', 'Set up the promotional aircraft: banners, blimps and balloons, their pictures and hours', ID),
  // WP4.13/4.14 (DECISIONS E25): holders act on their own lots; administrators on the public land and title.
  'property.hold': cap('member', 'Act on your own lots: merge up to 4, split back, who may enter, share rights', ID),
  'property.admin': cap('admin', 'Administer property: transfer lots, zoning, custodial holds, property checks', ID),
  // The economy (docs/features/ECONOMY.md): every player has a Virtual Coin wallet; administrators run the city's money.
  'economy.use': cap('member', 'Use a Virtual Coin wallet: pay and ask to be paid, buy at venues, run your businesses, set your agents\' spending limits', ID),
  'economy.admin': cap('admin', 'Run the economy: switch it on, its policy (wages, prices, taxes, benefits), grants and corrections, freezing wallets, bonds', ID),
  // WP1.8 (DECISIONS C116): reverting anyone's edit, and reading the activity log (the owner may open it to guests).
  'world.revert': cap('admin', 'Revert anyone\'s world edit from the activity log', ID),
  'activity.read': cap('member', 'Read the activity log: world edits, residents arriving, agents starting and stopping work, players joining and leaving'),
  'agents.view_tasks': cap('owner', 'See what agents are working on (task text)', ID),
  'agents.manage': cap('admin', 'Add agents (the owner may let members add their own: the permissions table); each agent is changed and removed by its owner or an account it is shared with to manage', ID),
  'chat.use': cap('member', 'Chat with agents', ID),
  // WP1.10 (DECISIONS C62, C118): the player in the shared world, proximity chat, friends and status.
  'players.move': cap('member', 'Have a player in the shared world and walk it', ID),
  'players.chat': cap('member', 'Chat with players nearby (proximity chat)', ID),
  'players.online': cap('member', 'See who is online, their status and where they are', ID),
  'players.friends': cap('member', 'Add friends and answer friend requests', ID),
  'players.warp': cap('admin', 'Put the own player anywhere in the world (testing, helping someone in person)', ID),
  'players.see_invisible': cap('admin', 'See the real status of players who appear offline', ID),
  'players.spawn': cap('admin', 'Set where new players appear (the spawn point)', ID),
  // Play modules (docs/features/play-modules.md): the minigames, their runs and badges, and players' profiles.
  'play.use': cap('member', 'Play the modules (minigames such as the airport\'s ring courses), earn levels and badges, see players\' profiles', ID),
  'connections.use': cap('member', 'Use connected agent providers', ID),
  // WP2.14 (E22, E23): agents that connect outbound with a key they hold: create slots, enrolment codes, visibility, who may chat.
  'agents.connect': cap('member', 'Connect your own agents: keys, who sees them, who may chat with them', ID),
  // Free Will (docs/features/FREE-WILL.md): a decision service chooses what an agent does with its free time.
  'agents.freewill': cap('member', 'Give your own agents Free Will: a decision service chooses what they do with their free time', ID),
  'agents.profile': cap('member', 'Your own agents\' character, goals, plans and memories, the people they know and what they did', ID),
  'agents.mind': cap('member', 'Your own agents\' Mind: whether they plan and reflect each day, and what their thoughts cost', ID),
  'agents.phone': cap('member', 'Your own agents\' phones: give one a Twilio number, its texts, calls, voicemail and contacts (docs/features/phone.md)', ID),
  'agents.pc': cap('member', 'Your own agents\' PC: their files, teams, task boards, calendars, browser and what they do on it (docs/features/agent-pc.md). Never another account\'s', ID),
  'freewill.admin': cap('admin', 'Run Free Will and the Mind: switch them on or off, choose the installation\'s decision service and brain, set limits, see their costs', ID),
  'connections.manage': cap('admin', 'Add installation-wide and host-process connections, and share them (members add their own remote ones with connections.use)', ID),
  'account.session': cap('member', 'Sign out, and confirm the password', { identity: true, fixed: true, restrictedOk: true }),
  'account.password': cap('member', 'Change the own password', { identity: true, fixed: true, restrictedOk: true }),
  'account.self': cap('member', 'Account settings: display name and devices', { identity: true, fixed: true }),
  'account.twofa': cap('member', 'Set up and manage the own two-factor sign-in', { identity: true, fixed: true, restrictedOk: true }),
  'account.data': cap('member', 'Download the own data and delete the own account', { identity: true, fixed: true }),
  'users.manage': cap('admin', 'List and manage accounts (always below the own role)', ID),
  'invites.manage': cap('admin', 'Create, list and revoke invites (always below the own role)', ID),
  'owner.transfer': cap('owner', 'Hand ownership to an admin', { identity: true, fixed: true }),
  'roles.assign': cap('admin', 'Change roles (always below the own role)', ID),
  'audit.read': cap('admin', 'Read the audit log', ID),
  'settings.world': cap('admin', 'World settings: require sign-in to watch, open self-registration', ID),
  // WP1.11 (C108, E17): one activation for the whole installation, so only its owner manages it.
  'licence.manage': cap('owner', 'Activate, import or deactivate the licence key', { identity: true, fixed: true }),
  'settings.security': cap('admin', 'Require two-factor sign-in for admins and the owner', ID),
  'settings.view': cap('admin', 'See the installation settings; each setting names who may change it (DECISIONS C90)', ID),
  'settings.secrets': cap('admin', 'Installation-wide secrets, such as shared connection tokens and speech keys (A17)', ID),
  'audit.retention': cap('owner', 'Set how long the audit log keeps events', { identity: true, fixed: true }),
  'activity.retention': cap('owner', 'Set how long the activity log keeps world edits, and so how far back they can be reverted', { identity: true, fixed: true }),
  'settings.infrastructure': cap('owner', 'Server and infrastructure settings', ID),
  'server.diagnostics': cap('admin', 'Server diagnostics: connected clients, performance counters, error messages, account status', ID),
  'permissions.manage': cap('owner', 'Change the minimum role of capabilities', { identity: true, fixed: true }),
  'moderation.mute': cap('admin', 'Mute other users', ID),
  'moderation.kick': cap('admin', 'Remove other users from the world', ID),
});

export class Permissions {
  constructor(store) {
    this.world = store.worldId;
    const db = store.db;
    this.q = {
      overrides: db.prepare('SELECT cap, min_role FROM capability_overrides WHERE world_id = ?'),
      setOverride: db.prepare(`INSERT INTO capability_overrides (world_id, cap, min_role, updated, updated_by) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (world_id, cap) DO UPDATE SET min_role = excluded.min_role, updated = excluded.updated, updated_by = excluded.updated_by`),
      delOverride: db.prepare('DELETE FROM capability_overrides WHERE world_id = ? AND cap = ?'),
      settings: db.prepare("SELECT key, value FROM settings WHERE world_id = ? AND key NOT LIKE 'secret:%'"),   // sealed values stay out of memory
      setSetting: db.prepare('INSERT INTO settings (world_id, key, value) VALUES (?, ?, ?) ON CONFLICT (world_id, key) DO UPDATE SET value = excluded.value'),
    };
    this.reload();
  }
  reload() {
    this.ov = new Map();
    for (const r of this.q.overrides.all(this.world)) {
      const d = CAPS[r.cap];
      if (d && !d.fixed && RANK[r.min_role] !== undefined && !(d.identity && r.min_role === 'guest')) this.ov.set(r.cap, r.min_role);
    }
    this.settings = new Map(this.q.settings.all(this.world).map(r => [r.key, r.value]));
  }
  requireSignIn() { return this.settings.get('world.requireSignIn') === '1'; }
  minRole(c) {
    const d = CAPS[c];
    if (!d) throw new Error(`unknown capability: ${c}`);
    let m = this.ov.get(c) || d.min;
    if (c === 'world.view' && this.requireSignIn() && RANK[m] < RANK.member) m = 'member';
    return m;
  }
  allowed(P, c) {
    const d = CAPS[c];
    if (!d) throw new Error(`unknown capability: ${c}`);
    if (d.identity && !P.account) return false;
    if (P.restricted && !d.restrictedOk) return !d.identity && RANK[this.minRole(c)] === 0;
    return (RANK[P.role] ?? 0) >= RANK[this.minRole(c)];
  }
  capsFor(P) {
    const o = {};
    for (const c of Object.keys(CAPS)) o[c] = this.allowed(P, c);
    return o;
  }
  /** Sets (or with min null, resets) a capability's minimum role. Returns why it was refused, or null. */
  setOverride(c, min, actorId, now = Date.now()) {
    const d = CAPS[c];
    if (!d) return 'Unknown capability';
    if (d.fixed) return 'This capability cannot be changed';
    if (min === null || min === undefined || min === d.min) {
      this.q.delOverride.run(this.world, c);
      this.reload();
      return null;
    }
    if (typeof min !== 'string' || RANK[min] === undefined) return 'Unknown role';
    if (d.identity && min === 'guest') return 'This capability needs a signed-in account, so it cannot be given to guests';
    this.q.setOverride.run(this.world, c, min, now, actorId ?? null);
    this.reload();
    return null;
  }
  setRequireSignIn(on) { this.setSetting('world.requireSignIn', on ? '1' : '0'); }
  /** A stored setting (string), or fallback. */
  setting(key, fallback = null) { return this.settings.has(key) ? this.settings.get(key) : fallback; }
  flag(key) { return this.settings.get(key) === '1'; }
  setSetting(key, value) {
    this.q.setSetting.run(this.world, key, String(value));
    this.reload();
  }
  describe() {
    return Object.entries(CAPS).map(([c, d]) => ({
      cap: c, desc: d.desc, default: d.min, min: this.minRole(c), override: this.ov.get(c) || null, identity: d.identity, fixed: d.fixed,
    }));
  }
}

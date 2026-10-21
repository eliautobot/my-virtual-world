// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// A Hermes agent's own screen - Hermes' Bot Desktop (docs/features/agent-pc.md §4.2): one desktop per Hermes profile on
// the machine Hermes runs on, where its browser opens (headed) and its computer_use acts; a person watches it live and
// takes it over (a login, a CAPTCHA) and hands it back, as Hermes Desktop's Screen pane does. Hermes' own calls, on this
// connection: display.status / start / stop, display.thumbnail (one picture of it), display.observe (a single-use 30 s
// ticket for its /api/display/ws - raw RFB, which ../../providers/screen-relay.js carries to the person's viewer) and
// display.lease.acquire / release (take over, hand back: Hermes lets input through only from the viewer holding it).
// A viewer id is minted by Hermes per connection: one per person and profile here, kept while this connection lasts, so a
// person's reconnect keeps their control and two people never share it.
import crypto from 'node:crypto';

const fail = (code, message, extra = {}) => Object.assign(new Error(message), { code, ...extra });
const PROFILE = /^[\w.-]{1,64}$/;
/** The lease's holder as Hermes shows it: a short hash of the viewer id (the id itself is a capability). */
const hashOf = id => crypto.createHash('sha256').update(String(id)).digest('hex').slice(0, 12);
const unavailable = e => e && (e.rpcCode === -32601 || /method not found/i.test(String(e.message || '')));

export class LinkScreen {
  /** @param {import('./link.js').HermesLink} link */
  constructor(link) {
    this.link = link;
    this.viewers = new Map();   // `${profile}\n${viewer}` → { id, gen }: the viewer ids Hermes minted on this connection
  }
  profileOf(p) { const s = String(p.agentKey || ''); if (!PROFILE.test(s)) throw fail('bad_request', 'Which agent?'); return s; }
  viewerOf(profile, viewer) {
    const v = this.viewers.get(`${profile}\n${viewer}`);
    return v && v.gen === this.link.gen ? v.id : null;   // (minted on a connection since gone: Hermes no longer honours it)
  }
  async rpc(method, params, opts) {
    try { return await this.link.request(method, params, opts); }
    catch (e) { if (unavailable(e)) throw fail('unsupported', 'This Hermes has no Bot Desktop yet (update Hermes)'); throw e; }
  }
  /** What the screen panel shows: { available, supported, installed, running, holder, mine, … } (mine: this person holds it). */
  view(st, profile, viewer) {
    const lease = st && st.lease || {}, me = this.viewerOf(profile, viewer);
    return { available: true, supported: st.supported !== false, installed: st.installed !== false, running: !!st.running,
      geometry: String(st.geometry || '').slice(0, 20), blocker: st.blocker ? String(st.blocker).slice(0, 400) : null,
      ...(st.installed === false && st.install_command ? { install: String(st.install_command).slice(0, 600) } : {}),
      sandbox: typeof st.placement === 'string' && st.placement.startsWith('terminal'),
      holder: lease.holder === 'human' ? 'human' : 'agent', mine: lease.holder === 'human' && !!me && lease.viewer_hash === hashOf(me),
      ...(lease.holder === 'human' && lease.reason ? { reason: String(lease.reason).slice(0, 200) } : {}) };
  }
  /** Whether Hermes opens its browser on its screen: its own settings browser.headed and bot_desktop.auto_start. */
  async onScreen(profile) {
    try {
      const c = await this.link.rest('GET', '/api/config', { query: { profile } });
      return !!(c && c.browser && c.browser.headed === true && c.bot_desktop && c.bot_desktop.auto_start === true);
    } catch { return null; }
  }
  async state(p) {
    const profile = this.profileOf(p);
    let st;
    try { st = await this.rpc('display.status', { profile }); }
    catch (e) { if (e.code === 'unsupported') return { available: false, reason: e.message }; throw e; }
    return { ...this.view(st, profile, String(p.viewer || '')), browserOnScreen: await this.onScreen(profile) };
  }
  /** start, stop, take (take over), release (hand back), browser (its browser on its screen: on / off). */
  async act(p) {
    const profile = this.profileOf(p), viewer = String(p.viewer || ''), a = String(p.action || '');
    if (a === 'start') return this.view(await this.rpc('display.start', { profile }, { timeoutMs: 40000 }), profile, viewer);
    if (a === 'stop') return this.view(await this.rpc('display.stop', { profile, ...(p.force === true ? { force: true } : {}) }, { timeoutMs: 20000 }), profile, viewer);
    if (a === 'take') {
      // (a viewer id of this person's, minted now when there is none yet: Hermes takes only one it minted on this connection)
      let id = this.viewerOf(profile, viewer);
      if (!id) id = (await this.observe(profile, viewer)).viewerId;
      await this.rpc('display.lease.acquire', { profile, viewer_id: id, reason: 'My Virtual World' });
      return this.view(await this.rpc('display.status', { profile }), profile, viewer);
    }
    if (a === 'release') {
      const id = this.viewerOf(profile, viewer);
      if (!id) throw fail('bad_request', 'You don\'t have control of this screen');
      await this.rpc('display.lease.release', { profile, viewer_id: id });
      return this.view(await this.rpc('display.status', { profile }), profile, viewer);
    }
    if (a === 'browser') {
      // (Hermes' own two settings, for this profile: its browser headed - a window, on its screen - and the screen started
      // the first time it browses)
      const on = p.on === true;
      await this.link.rest('PUT', '/api/config', { query: { profile }, body: { config: { browser: { headed: on }, bot_desktop: { auto_start: on } }, profile } });
      return { ...(await this.state(p)) };
    }
    throw fail('bad_request', 'Not something the screen does');
  }
  async observe(profile, viewer) {
    const r = await this.rpc('display.observe', { profile, ...(this.viewerOf(profile, viewer) ? { viewer_id: this.viewerOf(profile, viewer) } : {}) });
    if (!r || typeof r.ticket !== 'string' || typeof r.viewer_id !== 'string') throw fail('provider_error', 'Hermes did not open its screen');
    this.viewers.set(`${profile}\n${viewer}`, { id: r.viewer_id, gen: this.link.gen });
    if (this.viewers.size > 200) this.viewers.delete(this.viewers.keys().next().value);
    return { ticket: r.ticket, path: typeof r.path === 'string' && /^\/[\w/.-]{1,200}$/.test(r.path) ? r.path : '/api/display/ws', viewerId: r.viewer_id, view: this.view(r, profile, viewer) };
  }
  /** Where the person's viewer connects, once (a single-use 30 s ticket): { url, view } - url on this connection's own
   *  Hermes address (the relay dials nothing else). */
  async ticket(p) {
    const profile = this.profileOf(p);
    const o = await this.observe(profile, String(p.viewer || ''));
    const base = this.link.base && this.link.base.ws;
    if (!base) throw fail('not_connected', 'Hermes is not connected');
    return { url: `${base.replace(/\/api\/ws$/, '')}${o.path}?display_ticket=${encodeURIComponent(o.ticket)}`, view: o.view };
  }
  /** One picture of the screen (a JPEG, base64), or { jpeg: null } - not running, or a person has control (Hermes then
   *  shows nobody what they type). */
  async thumb(p) {
    const profile = this.profileOf(p);
    const r = await this.rpc('display.thumbnail', { profile }, { timeoutMs: 15000 });
    const m = r && typeof r.data_url === 'string' ? /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(r.data_url) : null;
    return { jpeg: m ? m[1] : null, ...(r && r.suppressed ? { suppressed: String(r.suppressed).slice(0, 40) } : {}) };
  }
}

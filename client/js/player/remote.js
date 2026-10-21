// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Other players (PLAN WP1.10, DECISIONS C62, C118): the server streams the players in this page's area of interest
// (binary frame type 2, shared/playerproto.js); each is drawn with Next's body and its own look, interpolated 120 ms
// behind the stream so movement stays smooth at 10 (near) or 2 (farther) updates a second. A player whose person is
// looking from the overview or editor camera waits where it is with an "observing" marker; one that leaves this page's
// area of interest, or the world, fades out. This page's own player comes back in the stream too (PF_YOU): it is drawn
// from here while its person is observing, and by player.js while they play.
import { S, bus } from '../core/state.js';
import { decodePlayers, PF_OBSERVING, PF_USING, PF_DRIVING, PF_YOU, PF_OUT } from '/shared/playerproto.js';
import { CLIP, CLIP_DUR, CLIP_STRIDE } from '../render/anim.js';
import { PLAYER_APP } from '../render/agents.js';
import { angDiff } from '../core/util.js';
import { remoteJump } from './jump-pose.js';

const DELAY = 120;          // ms behind the stream
const HOLD = 250;           // ms a player may run past its last state before it stops
const FADE = 0.6;           // s to fade out
const SLOT0 = PLAYER_APP + 1;
const lerp = (a, b, u) => a + (b - a) * u;

export class Remote {
  constructor(app) {
    this.app = app; this.net = app.net; this.agents = app.agents;
    this.byPid = new Map(); this.info = new Map();   // pid → { name, app, you }
    this.drawn = [];         // the players drawn this frame, for the name tags
    this.says = new Map();   // pid → { text, until } - chat bubbles
    this.me = null;          // this account's player as the server last put it: { pid, x, y, z, ctx, yaw, look, cam }
    this.freeSlots = []; this.nextSlot = 0;
    this.stats = { frames: 0, entries: 0, bytes: 0 };
    this.viewAt = 0; this.viewX = NaN; this.viewZ = NaN;
  }
  slot() { return this.freeSlots.length ? this.freeSlots.pop() : this.nextSlot++; }
  /** A player stream frame from the server. */
  onFrame(buf) {
    this.stats.frames++; this.stats.bytes += buf.byteLength;
    decodePlayers(buf, (e, t) => {
      this.stats.entries++;
      let r = this.byPid.get(e.pid);
      if (e.flags & PF_OUT) { if (r && !r.gone) r.gone = performance.now() / 1000; return; }
      if (!r) {
        const inf = this.info.get(e.pid) || { name: 'Player', app: null, you: false };
        r = { pid: e.pid, buf: [], slot: this.slot(), gone: 0, dist: 0, lx: e.x, lz: e.z, clip: CLIP.idle, pclip: CLIP.idle, ph: 0, pph: 0, fadeT: -9,
          name: inf.name, you: inf.you, extra: { x: e.x, y: e.y, z: e.z, yaw: e.yaw, clip: CLIP.idle, ph: 0, pclip: CLIP.idle, pph: 0, w: 0, app: 0, prop: 0, flags: 0 } };
        r.extra.app = SLOT0 + r.slot;
        if (inf.app) this.agents.setAppearance(r.extra.app, inf.app);
        this.byPid.set(e.pid, r);
      }
      r.gone = 0;
      r.buf.push({ t, x: e.x, y: e.y, z: e.z, yaw: e.yaw, ctx: e.ctx, clip: e.clip, flags: e.flags });
      if (r.buf.length > 24) r.buf.splice(0, r.buf.length - 24);
      r.flags = e.flags; r.ctx = e.ctx; r.you = (e.flags & PF_YOU) !== 0;
      if (r.you && this.me) Object.assign(this.me, { x: e.x, y: e.y, z: e.z, ctx: e.ctx, yaw: e.yaw });
    });
  }
  onInfo(m) {
    this.info.set(m.pid, { name: m.name, app: m.app, you: !!m.you });
    const r = this.byPid.get(m.pid);
    if (r) { r.name = m.name; r.you = !!m.you; if (m.app) this.agents.setAppearance(r.extra.app, m.app); }
  }
  drop(r) {
    const k = this.agents.extra.indexOf(r.extra);
    if (k >= 0) this.agents.extra.splice(k, 1);
    this.byPid.delete(r.pid);
    this.freeSlots.push(r.slot);
  }
  /** Signed out, or the connection was replaced: forget everyone (the new stream repopulates). */
  reset() { for (const r of [...this.byPid.values()]) this.drop(r); this.me = null; }
  /** Where this page looks: the centre of its area of interest (sent when it moved 8 m, or every 3 s). */
  sendView(now) {
    const cam = this.app.cam, P = this.app.player, x = P && P.active ? P.x : cam.target.x, z = P && P.active ? P.z : cam.target.z;
    if (now - this.viewAt < 400) return;
    if (Math.hypot(x - this.viewX, z - this.viewZ) < 8 && now - this.viewAt < 3000) return;
    if (!this.net.send({ t: 'pview', x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10 })) return;
    this.viewAt = now; this.viewX = x; this.viewZ = z;
  }
  /** Each frame: interpolate, animate and hand the visible players to the character renderer. */
  update(dt) {
    const nowMs = performance.now(), now = nowMs / 1000;
    this.sendView(nowMs);
    const t = this.net.realNow() * 1000 - DELAY, extra = this.agents.extra, P = this.app.player, fb = S.focus.b, ff = S.focus.f;
    this.drawn.length = 0;
    for (const r of [...this.byPid.values()]) {
      const X = r.extra;
      let fade = 1;
      if (r.gone) { fade = 1 - (now - r.gone) / FADE; if (fade <= 0) { this.drop(r); continue; } }
      const own = r.you && P && P.active;   // player.js draws it
      // interpolate between the two states around t (or hold the last one briefly)
      const b = r.buf;
      let s = b[b.length - 1];
      if (b.length > 1 && t < s.t) {
        let k = b.length - 1;
        while (k > 0 && b[k - 1].t > t) k--;
        const a = b[Math.max(0, k - 1)], c = b[k];
        const u = c.t > a.t ? Math.min(1, Math.max(0, (t - a.t) / (c.t - a.t))) : 1;
        const sameSpace = a.ctx === c.ctx;
        s = sameSpace ? { x: lerp(a.x, c.x, u), y: lerp(a.y, c.y, u), z: lerp(a.z, c.z, u), yaw: a.yaw + angDiff(a.yaw, c.yaw) * u, ctx: c.ctx, clip: c.clip, flags: c.flags } : (u < 0.5 ? a : c);
      } else if (t - s.t > HOLD) s = { ...s, clip: s.flags & PF_USING ? s.clip : CLIP.idle };
      const moved = Math.hypot(s.x - r.lx, s.z - r.lz);
      if (moved > 6) r.dist = 0; else r.dist += moved;
      r.lx = s.x; r.lz = s.z;
      // the animation: the sender's clip, the gait phase locked to the distance walked
      let clip = s.clip < CLIP_DUR.length ? s.clip : CLIP.idle;
      if (s.flags & PF_OBSERVING) clip = CLIP.idle;
      const st = CLIP_STRIDE[clip];
      let ph = st > 0 ? r.dist / st : now / Math.max(0.3, CLIP_DUR[clip] || 1);
      ph -= Math.floor(ph);
      if (clip !== r.clip) { r.pclip = r.clip; r.pph = r.ph; r.fadeT = now; r.clip = clip; }
      let lift = 0;   // a jump: the clip follows the flight from when it began, its own lift taken out (jump-pose.js)
      if (clip === CLIP.jump) ({ ph, lift } = remoteJump(now - r.fadeT));
      r.ph = ph;
      X.x = s.x; X.y = s.y - lift - (1 - fade) * 0.9; X.z = s.z;   // fading out: it sinks away
      X.yaw = Number.isFinite(X.yaw) ? X.yaw + angDiff(X.yaw, s.yaw) * Math.min(1, dt * 14) : s.yaw;
      X.clip = clip; X.ph = ph; X.pclip = r.pclip; X.pph = r.pph; X.w = Math.max(0, 1 - (now - r.fadeT) / 0.22);
      X.flags = s.ctx >= 0 ? 4 : 0;
      r.observing = (s.flags & PF_OBSERVING) !== 0; r.ctx = s.ctx; r.fade = fade;
      // who is visible: outside always; inside only on the floor this page looks at
      const vis = !own && !(s.flags & PF_DRIVING) && (s.ctx < 0 || (fb === s.ctx >> 6 && ff === (s.ctx & 63)));
      const k = extra.indexOf(X);
      if (vis && k < 0) extra.push(X);
      else if (!vis && k >= 0) extra.splice(k, 1);
      if (vis) this.drawn.push(r);
    }
    for (const [pid, s] of this.says) if (now > s.until) this.says.delete(pid);
  }
  say(pid, text) { this.says.set(pid, { text, until: performance.now() / 1000 + Math.min(12, 4 + text.length / 18) }); }
  list() {
    return [...this.byPid.values()].map(r => ({ pid: r.pid, name: r.name, you: r.you, observing: !!r.observing, ctx: r.ctx, x: r.extra.x, z: r.extra.z, drawn: this.drawn.includes(r) }));
  }
}

export function init(app) {
  if (!app.net || !app.agents) return;
  const R = app.remote = new Remote(app);
  bus.on('players:frame', buf => R.onFrame(buf));
  bus.on('msg:pinfo', m => R.onInfo(m));
  const onYou = m => {
    R.me = { pid: m.pid, x: m.x, y: m.y, z: m.z, ctx: m.ctx, yaw: m.yaw, look: m.look, cam: m.cam, fresh: !!m.fresh };
    bus.emit('player:you', R.me);
  };
  bus.on('msg:you', onYou);
  if (app.net.playerYou) onYou(app.net.playerYou);
  bus.on('msg:chat', m => { if (m.agent !== undefined || typeof m.text !== 'string') return; R.say(m.pid, m.text); bus.emit('player:chat', m); });   // (agent chat - a run's frames, a progress card - names its agent: not a player speaking)
  bus.on('net', up => { if (!up) R.reset(); });
  bus.on('frame', dt => R.update(dt));
}

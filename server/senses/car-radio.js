// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The car radio, for the senses (docs/features/awareness.md §2, §6): a driver's page says which station its car radio
// plays (WebSocket { t: 'radio_tune', station: id | null }, client/js/audio/radio.js) and an agent riding with them hears
// it ("Car radio: «Velvet 88.3» — playing «Song» by Artist": senses.radioIn, the words from server/radio/ nowWords).
// Only a player at the wheel tunes (players.byId.get(id).vehicleId); one who stops driving, or leaves, is cleared on the
// next sweep. A page that says it too often: the last word wins, kept for the sweep.

export const TUNE_GAP_MS = 750;   // one tune applied per account this often at most
export const SWEEP_MS = 5000;     // clears those no longer driving, applies the last word held back
const STATION = /^[a-z0-9][a-z0-9_-]{0,39}$/i;

export class CarRadio {
  /**
   * @param o { senses: () => Senses, players (server/world/players.js), known?(station id) → it is one of the world's
   *   stations, now?, log? }
   */
  constructor({ senses, players, known = () => true, now = () => Date.now(), log = null }) {
    Object.assign(this, { sensesOf: senses, players, known, now, log });
    this.last = new Map();      // account id → when its last tune was applied
    this.pending = new Map();   // account id → the station it said last, held back (too soon after the one before)
    this.stats = { tunes: 0, held: 0, refused: 0, cleared: 0 };
    this.timer = null;
  }
  /** A page's message { t: 'radio_tune', station } on its connection (conn.pid: its player's account id). */
  fromPage(conn, m) {
    const id = conn?.pid ?? conn?.P?.account?.id;
    if (!Number.isInteger(id) || id <= 0) return;
    const s = m?.station;
    const station = s == null || s === '' || s === 'off' ? null : typeof s === 'string' && STATION.test(s) && this.known(s) ? s : undefined;
    if (station === undefined) { this.stats.refused++; return; }
    this.set(id, station);
  }
  set(id, station) {
    const t = this.now();
    if (t - (this.last.get(id) || 0) < TUNE_GAP_MS) { this.pending.set(id, station); this.stats.held++; return; }
    this.apply(id, station, t);
  }
  apply(id, station, t = this.now()) {
    this.pending.delete(id); this.last.set(id, t);
    const S = this.sensesOf?.();
    if (!S) return;
    const driving = !!this.players?.byId?.get(id)?.vehicleId;
    S.tune(id, station && driving ? station : null);   // (only a driver's page tunes its car)
    this.stats.tunes++;
  }
  /** Applies the last word held back; clears the radios of those no longer at the wheel. */
  sweep() {
    const t = this.now();
    for (const [id, st] of [...this.pending]) if (t - (this.last.get(id) || 0) >= TUNE_GAP_MS) this.apply(id, st, t);
    const S = this.sensesOf?.();
    for (const id of [...(S?.tuned?.keys?.() || [])]) if (!this.players?.byId?.get(id)?.vehicleId) { S.tune(id, null); this.stats.cleared++; }
    for (const [id, at] of [...this.last]) if (t - at > 600e3 && !this.pending.has(id)) this.last.delete(id);
  }
  attach() {
    if (!this.timer) { this.timer = setInterval(() => { try { this.sweep(); } catch (e) { this.log?.warn?.('[senses] the car radio sweep failed:', e.message); } }, SWEEP_MS); this.timer.unref?.(); }
    return this;
  }
  stop() { clearInterval(this.timer); this.timer = null; }
}

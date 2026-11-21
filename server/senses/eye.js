// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// An agent's eyes (docs/features/awareness.md §9): one frame of the world from where its body stands, drawn by the page of
// the person it is talking with, so a companion can answer "what colour is that tree" instead of "I can't see colours".
// Only a page has the world drawn, so the server asks over the live connection ('see': { id, i, x, z, ctx } — its body
// and where the server has it) and the page answers with one small JPEG ('see': { id, mime, data }) or why it can't
// ('see': { id, error }: it doesn't draw that body, it is in the background, …).
// - Only the pages of that account showing the world near the body are asked (pages(account, at): server/index.mjs);
//   an answer is taken only from a page that was asked, once; the first picture wins, and when every page asked has said
//   it can't, the ask ends at once (an error never waits for the time-out).
// - One ask in flight per account (a page draws one picture at a time; a chat can't flood it) and at most MAX_PENDING in
//   all; a second ask meanwhile is told 'busy'.
// - A picture is a base64 JPEG or PNG that fits the live connection's 64 KB message (server/index.mjs maxPayload): anything
//   else is refused. ask() resolves { ok: true, data, mime } or { ok: false, why } (EYES_WHY).
export const MAX_DATA = 64 * 1024;   // the live connection takes no message larger: a picture is always smaller than this
const MIN_BYTES = 200;               // a picture smaller than this is not one (an empty canvas, a broken encoder)
const MAX_PENDING = 200;             // asks waiting for a page, from every account together
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** Why there is no picture, in words for the agent ({who}: whose page — "Kim's"). */
export const EYES_WHY = Object.freeze({
  far: 'you are not near enough to {who} character for their page to show where you are',
  no_page: 'no page of {who} shows the world near you right now',
  not_drawn: '{who} page doesn\'t show where you are right now',
  hidden: '{who} page with the world is not in front of them',
  no_world: '{who} page doesn\'t show the world right now',
  under_water: '{who} view is under water right now',
  busy: 'another picture was being taken',
  timeout: 'the picture did not come in time',
  bad_picture: 'the picture came out broken',
  failed: 'the picture could not be taken',
});
const why = w => (Object.hasOwn(EYES_WHY, w) ? w : 'failed');

/**
 * The words that go with a message about its eyes: that the picture is attached (shot from ask() came) or why there is
 * none — never a picture of someone else's view said to be its own. name: whose look it follows ("Kim").
 */
export function eyesLine(shot, name = 'your owner') {
  const n = String(name || 'your owner');
  // (the picture is for what was asked: used to answer it — never described for its own sake)
  if (shot?.ok) return `A picture of what is in front of you right now is attached (from where you stand, looking where ${n} is looking), because answering needs your eyes: answer what they asked from what you see in it, as briefly as you would say it — don't describe the rest of it, and never say you can't see.`;
  return `You could not get a look just now: ${EYES_WHY[why(shot?.why)].replace('{who}', `${n}'s`)}. If what they asked needs seeing, say you didn't get a good look.`;
}

/** The picture's bytes when `data` (base64, a data: URL allowed) is a JPEG or PNG of a sensible size, else null. */
export function pictureBytes(data, mime) {
  const s = typeof data === 'string' ? data.replace(/^data:image\/(?:jpeg|png);base64,/, '') : '';
  if (!s || s.length > MAX_DATA || s.length % 4 !== 0 || !B64.test(s)) return null;
  const b = Buffer.from(s, 'base64');
  if (b.length < MIN_BYTES) return null;
  const jpeg = b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff, png = b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
  if (mime === 'image/png' ? !png : !jpeg) return null;
  return b;
}

export class Eyes {
  /**
   * pages(account, at) → the live pages to ask: objects with send(text) (the account's connections showing the world near
   * at = { x, z }); timeoutMs: how long a page has to answer.
   */
  constructor({ pages, timeoutMs = 4000, log = null } = {}) {
    this.pages = pages;
    this.timeoutMs = timeoutMs;
    this.log = log;
    this.pending = new Map();     // id → { account, pages: Set (asked, not answered yet), done, timer }
    this.busy = new Set();        // accounts with an ask in flight
    this.seq = 0;
    this.stats = { asked: 0, answered: 0, refused: 0, busy: 0, timeouts: 0, noPage: 0 };
  }

  /**
   * One frame from where agent body `at` stands ({ i, x, z, ctx }: Senses.eyesFor), drawn by a page of `account`:
   * resolves { ok: true, data (base64), mime } or { ok: false, why }.
   */
  ask(account, { at = null, timeoutMs } = {}) {
    const acc = Number(account);
    if (!Number.isInteger(acc) || acc <= 0) return Promise.resolve({ ok: false, why: 'no_page' });
    if (!at || !Number.isInteger(at.i) || !Number.isFinite(at.x) || !Number.isFinite(at.z)) return Promise.resolve({ ok: false, why: 'far' });
    if (this.busy.has(acc) || this.pending.size >= MAX_PENDING) { this.stats.busy++; return Promise.resolve({ ok: false, why: 'busy' }); }
    let list = [];
    try { list = [...(this.pages(acc, { x: at.x, z: at.z }) || [])]; } catch (e) { this.log?.warn?.('[eyes] finding the pages failed:', e.message); list = []; }
    if (!list.length) { this.stats.noPage++; return Promise.resolve({ ok: false, why: 'no_page' }); }
    const id = `e${++this.seq}`;
    this.stats.asked++;
    this.busy.add(acc);
    return new Promise(resolve => {
      const wait = Number.isFinite(timeoutMs) ? Math.max(250, Math.min(6000, timeoutMs)) : this.timeoutMs;
      const w = { account: acc, pages: new Set(), last: null, timer: null, done: null };
      w.done = v => {
        if (this.pending.get(id) !== w) return;
        this.pending.delete(id); clearTimeout(w.timer); this.busy.delete(acc);
        if (v.ok) this.stats.answered++; else if (v.why === 'timeout') this.stats.timeouts++; else this.stats.refused++;
        if (!v.ok) this.log?.info?.(`[eyes] no picture for account ${acc}: ${v.why} (${w.pages.size} page(s) still asked)`);
        resolve(v);
      };
      w.timer = setTimeout(() => w.done({ ok: false, why: 'timeout' }), wait);
      w.timer.unref?.();
      this.pending.set(id, w);
      const text = JSON.stringify({ t: 'see', id, i: at.i, x: at.x, z: at.z, ctx: Number.isFinite(at.ctx) ? at.ctx : -1 });
      for (const ws of list) {
        try { ws.send(text); w.pages.add(ws); } catch (e) { this.log?.warn?.('[eyes] asking a page failed:', e.message); }
      }
      if (!w.pages.size) w.done({ ok: false, why: 'no_page' });
    });
  }

  /** A page's answer: { id, mime, data } or { id, error } — taken only from a page that was asked, once. */
  reply(conn, m) {
    const w = this.pending.get(String(m?.id || ''));
    if (!w || !w.pages.has(conn) || Number(conn?.P?.account?.id) !== w.account) return;
    w.pages.delete(conn);
    if (typeof m.error === 'string' || typeof m.data !== 'string') w.last = why(String(m.error || 'failed').slice(0, 40));
    else {
      const mime = m.mime === 'image/png' ? 'image/png' : 'image/jpeg';
      const b = pictureBytes(m.data, mime);
      if (b) { w.done({ ok: true, data: b.toString('base64'), mime }); return; }
      w.last = 'bad_picture';
    }
    // (every page asked said it can't: the ask ends now, with the last reason)
    if (!w.pages.size) w.done({ ok: false, why: w.last || 'failed' });
  }

  /** A connection closed: its pending asks no longer wait for it. */
  gone(conn) {
    for (const w of [...this.pending.values()]) {
      if (!w.pages.delete(conn)) continue;
      if (!w.pages.size) w.done({ ok: false, why: w.last || 'no_page' });
    }
  }
}

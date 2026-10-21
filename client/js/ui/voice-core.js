// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Voice in the window, the parts that need no page (docs/features/CHAT.md §9.4), so the tests run them in node:
// - Segmenter: an answer being written is cut into whole pieces — a sentence, a line of a list, a whole code block or
//   table — each ready to speak as soon as it is complete, so voice mode starts talking within a second or two of the
//   first words instead of waiting for the end.
// - takeUnits: what goes in one request to the voice service (the first piece alone, for speed; later ones together).
// - Vad: when someone has started and stopped talking, from the microphone's loudness, following the room's own noise.

const END = /[.!?…]+["'”’)\]*_]*(?=\s)|[。！？]+/g;         // a sentence's end: white space after it (so it really ended); CJK needs none
const ABBR = /(?:^|[\s(])(?:e\.g|i\.e|etc|vs|mr|mrs|ms|dr|prof|sr|jr|st|no|approx|incl|cf|inc|ltd|co|[A-Z])\.$/i;
const LIST_MARK = /^\s*(?:[-*+]\s+)?(?:\d{1,3}|[a-zA-Z])[.)]$/; // "1." "a)" at a line's start: a list, not a sentence
const FENCE = /^(`{3,}|~{3,})/;
/** Whether a piece has anything to say (not only marks: a rule, a lone bullet). */
export const sayable = s => /[\p{L}\p{N}]/u.test(s);

export class Segmenter {
  /** soft: a run of words with no end yet is cut at a pause past this many characters (speaking doesn't wait for it). */
  constructor({ soft = 280 } = {}) { this.pos = 0; this.soft = soft; }
  /** The new whole pieces of `text` (everything written so far, the same text growing); final: nothing more comes, so
   *  the rest goes too. Each piece is returned once. */
  feed(text, final = false) {
    const t = String(text ?? ''), out = [];
    if (t.length < this.pos) this.pos = t.length;   // (the text was replaced by a shorter one: nothing to repeat)
    for (let guard = 0; guard < 100000; guard++) {
      while (this.pos < t.length && /\s/.test(t[this.pos])) this.pos++;
      if (this.pos >= t.length) break;
      const s = t.slice(this.pos);
      const n = FENCE.test(s) ? fence(s, final) : /^[ \t]*\|/.test(s) ? table(s, final) : prose(s, final, this.soft);
      if (n === null || n <= 0) break;
      this.pos += n;
      const piece = s.slice(0, n).trim();
      if (sayable(piece)) out.push(piece);
    }
    return out;
  }
}

/** A fenced code block: through its closing fence (the whole block is one piece: the voice says what it is). */
function fence(s, final) {
  const mark = FENCE.exec(s)[1], nl = s.indexOf('\n');
  if (nl < 0) return final ? s.length : null;
  const re = new RegExp(`\\n${mark[0] === '`' ? '`' : '~'}{${mark.length},}[^\\S\\n]*(\\n|$)`, 'g');
  re.lastIndex = nl;
  const m = re.exec(s);
  if (m && (m[1] === '\n' || final)) return m.index + m[0].length;
  return final ? s.length : null;
}
/** A table: its lines while they start with "|" (one piece: the voice says how big it is). */
function table(s, final) {
  let i = 0;
  for (;;) {
    const nl = s.indexOf('\n', i);
    if (nl < 0) return final ? s.length : null;   // its last line isn't finished
    i = nl + 1;
    const rest = s.slice(i);
    if (/^[ \t]*\|/.test(rest)) continue;
    if (/^[ \t]*$/.test(rest)) return final ? s.length : null;   // the next line hasn't said what it is yet
    return i;
  }
}
/** Words: to the end of the first sentence, or of the line (a list item, a heading, a paragraph). */
function prose(s, final, soft) {
  const nl = s.indexOf('\n');
  const line = nl < 0 ? s : s.slice(0, nl + 1);
  END.lastIndex = 0;
  for (let m; (m = END.exec(line));) {
    const before = line.slice(0, m.index + 1);
    if (m[0][0] === '.' || m[0][0] === ')') { if (LIST_MARK.test(before) || ABBR.test(before)) continue; }
    return m.index + m[0].length;
  }
  if (nl >= 0) return nl + 1;
  if (final) return s.length;
  if (s.length > soft) {
    // no end yet and a long way in: cut at the last pause (a comma, a semicolon, a dash), else at a space
    const head = s.slice(0, soft * 2);
    let k = -1;
    for (const m of head.matchAll(/[,;:—–](?=\s)/g)) if (m.index > 40) k = m.index + 1;
    if (k > 0) return k;
    if (s.length > soft * 2) { const sp = head.lastIndexOf(' '); if (sp > 40) return sp; }
  }
  return null;
}

/** The next request's text from the pieces waiting (removed from `units`): the first of an answer alone, so the voice
 *  starts at once; later ones together up to `max` characters (fewer, longer requests while the voice is talking). */
export function takeUnits(units, { first = false, max = 500 } = {}) {
  if (!units.length) return '';
  if (first) return units.shift();
  let out = units.shift();
  while (units.length && out.length + 1 + units[0].length <= max) out += `\n${units.shift()}`;
  return out;
}

/**
 * When someone starts and stops talking, from the microphone's loudness (RMS, 0–1) read every few milliseconds. The
 * room's own noise is followed (at once when it gets quieter, slowly when louder, never while someone talks), and talking
 * starts louder than it by a margin. Once talking, a turn goes on while it stays near the person's own voice (`drop` of
 * its running level): a real room is not silent in the pause — the browser's automatic gain turns it up as soon as they
 * stop, the world's sounds and birdsong go on — so the pause is what falls well below their voice, not only below the
 * room's noise as it was before they spoke. Talking again after a dip is told from a blip (a chirp, a click) by how much
 * of it there is: `back` gathers the loud time since the pause began and fades in the quiet, and the turn goes on once it
 * reaches `blipMs` — after a dip shorter than `gapMs` (between syllables) — or `resumeMs` after a real pause; until then
 * the pause is held, neither ended nor started over. step() says 'speech' once talking has started, 'end' after
 * `silenceMs` of pause that followed at least `minSpeechMs` of talking, 'noise' when what was heard was too short to be
 * words (a cough, a knock) — each once, until reset().
 */
export class Vad {
  constructor({ silenceMs = 1000, minSpeechMs = 300, startMs = 150, gapMs = 300, blipMs = 100, resumeMs = 250, min = 0.012, ratio = 3, drop = 0.3 } = {}) {
    Object.assign(this, { silenceMs, minSpeechMs, startMs, gapMs, blipMs, resumeMs, min, ratio, drop });
    this.reset();
  }
  reset() { this.floor = null; this.loud = 0; this.quiet = 0; this.back = 0; this.voiced = 0; this.talk = 0; this.started = false; this.over = false; }
  /** Louder than this starts a turn: the room's noise by a margin. */
  get threshold() { return Math.max(this.min, (this.floor ?? 0) * this.ratio); }
  /** Louder than this keeps a turn going: above the room's noise, and not far below the person's own voice. */
  get keep() { return Math.max(this.threshold, this.talk * this.drop); }
  step(rms, dt) {
    if (this.over) return null;   // (said once; reset() listens again)
    const v = Number.isFinite(rms) && rms > 0 ? rms : 0;
    if (this.floor === null) this.floor = v;
    else if (v < this.floor) this.floor = v;
    else if (!this.started || this.quiet >= this.silenceMs) this.floor += (v - this.floor) * 0.02;
    if (!this.started) {
      if (v > this.threshold) {
        this.loud += dt; this.talk = this.talk ? this.talk + (v - this.talk) * 0.3 : v;
        if (this.loud >= this.startMs) { this.started = true; this.voiced = this.loud; return 'speech'; }
      } else { this.loud = 0; this.talk = 0; }
      return null;
    }
    if (v > this.keep) {
      if (this.quiet === 0) { this.voiced += dt; this.talk += (v - this.talk) * 0.1; return null; }
      this.back += dt;
      if (this.back >= (this.quiet < this.gapMs ? this.blipMs : this.resumeMs)) { this.quiet = 0; this.voiced += this.back; this.back = 0; }   // (talking again)
      return null;   // (not yet: the pause is held)
    }
    this.back = Math.max(0, this.back - dt / 2);
    this.quiet += dt;
    if (this.quiet >= this.silenceMs) { this.over = true; return this.voiced >= this.minSpeechMs ? 'end' : 'noise'; }
    return null;
  }
}

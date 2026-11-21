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

// ------------------------------------------------------------------------------------------------ whose turn it is
// Live voice (voice mode in a chat, the companions' voice) answers when the person has finished — not at their first
// breath. A second of quiet cut slow talkers off mid-sentence (2026-11-17: "I talk slowly… I'm constantly feeling I have to
// rush my words"), so the end of a turn is decided from three things together:
//   - their patience (Settings → Voice): how long a pause they want before it answers;
//   - their own habit: the pauses they make in the middle of what they say, learned as they talk (PauseHabit);
//   - their words so far: a pause after "and…", "the…", "um" or a comma is a thought going on, so it waits longer (sounds()).
// TurnTaker follows the loudness like Vad does (the room's own noise, a dip between syllables, a bird, the microphone's gain
// turning the room up in a pause), and says when to check the words so far ('pause') and when the turn is over ('end').

/** How long a pause ends a turn, by how the person likes to talk (ms). */
export const PATIENCE = Object.freeze({ quick: 1000, normal: 1600, relaxed: 2400, patient: 3500 });
export const PATIENCE_DEFAULT = 'normal';
export const MORE_MS = 2200;     // the words so far stop mid-thought: a pause this much longer is still their turn
export const WAIT_MAX = 7000;    // whatever else: a pause this long ends it
const HOLD_MS = 1500;            // waiting for the words of this pause to be heard (a check under way): at most this past its end

// words a thought rarely ends on: joining words, articles, prepositions, "um" — English and a few of the languages the voice
// services hear most (a word that ends a question — "what are you looking at?" — is told by its question mark)
const TRAIL = new Set(`and or but so because cause cuz if when while though although unless until than then that which who whom whose where
  the a an to of for with in on at from by about into onto over under between after before like as just also plus
  um uh uhm erm er ah hmm mm i i'm my your his her its our their we you they he she it's is are was were be been being am
  will would could should can can't don't won't gonna wanna gotta might must may not very really maybe kind sort some any
  y o pero que porque de del la el los las en con para por un una
  et ou mais parce le les des du au aux avec pour dans sur une
  und oder aber dass weil der die das den dem des mit für zu von im ein eine
  e ou mas porque do da dos das com para um uma no na`.split(/\s+/).filter(Boolean));

/**
 * Whether words heard so far sound finished: 'complete' (a question, an exclamation, a sentence ending on a full word),
 * 'incomplete' (ending on a joining word, "um", a comma, a dash or dots) or null (no telling — a service that writes
 * no punctuation, a language it doesn't know).
 */
export function sounds(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  if (/[?!？！]["'”’)\]]*$/.test(t)) return 'complete';
  const last = (t.match(/([\p{L}\p{N}'’]+)[^\p{L}\p{N}]*$/u) || [])[1];
  if (last && TRAIL.has(last.toLowerCase().replace(/’/g, '\''))) return 'incomplete';
  if (/(?:[,;:–—-]|\.\.\.|…)["'”’)\]]*$/.test(t)) return 'incomplete';
  if (/[.。]["'”’)\]]*$/.test(t)) return 'complete';
  return null;
}

/**
 * The pauses someone makes in the middle of a turn (they went on talking after them), kept to learn how long they pause
 * while thinking: need() is how long a pause must be before it is taken for the end — a little more than their usual
 * long pauses. A turn that ended while their words were mid-thought (cut off) counts as a pause they needed longer.
 */
export class PauseHabit {
  constructor(samples = []) { this.s = (Array.isArray(samples) ? samples : []).map(Number).filter(x => Number.isFinite(x) && x >= 300 && x <= 8000).slice(-PauseHabit.KEEP); }
  static KEEP = 40;
  add(ms) {
    const v = Math.round(Number(ms));
    if (!Number.isFinite(v) || v < 300 || v > 8000) return;
    this.s.push(v);
    if (this.s.length > PauseHabit.KEEP) this.s.splice(0, this.s.length - PauseHabit.KEEP);
  }
  /** How long a pause must last to end their turn (ms); 0 until there is enough to go by. */
  need() {
    if (this.s.length < 5) return 0;
    const a = [...this.s].sort((x, y) => x - y), p90 = a[Math.min(a.length - 1, Math.floor(a.length * 0.9))];
    return Math.min(4800, Math.round(p90 * 1.15 + 250));
  }
  toJSON() { return this.s.slice(); }
}

/**
 * Whose turn it is, from the microphone's loudness (RMS, 0–1) read every few milliseconds and, when it has them, the words
 * heard so far. step() says:
 *   'speech' — they started talking;
 *   'pause'  — a pause long enough to check their words so far (once a pause; checking() and then words(text) or words(null));
 *   'resume' — they went on after a real pause (it is learned as one of their pauses);
 *   'end'    — their turn is over: a pause as long as waitMs after at least minSpeechMs of talking;
 *   'noise'  — what was heard was too short to be words (a cough, a knock);
 *   'limit'  — they have talked for maxMs: the turn goes as it is.
 * 'end', 'noise' and 'limit' are said once, until reset().
 */
export class TurnTaker {
  // (resumeMs: after a real pause, this much voice is talking again — a short word, "and", "so", "um", said after a moment's
  //  hesitation is still their turn going on: cut off at it, a slow talker would be cut off mid-sentence; a click or a bird's
  //  chirp, shorter, is not)
  constructor({ patience = PATIENCE_DEFAULT, habit = null, maxMs = 290000, minSpeechMs = 300, startMs = 150, gapMs = 300, blipMs = 100, resumeMs = 120, min = 0.012, ratio = 3, drop = 0.25, soft = 0.1 } = {}) {
    Object.assign(this, { habit, maxMs, minSpeechMs, startMs, gapMs, blipMs, resumeMs, min, ratio, drop, soft });
    this.patienceMs = Number.isFinite(patience) ? Math.max(500, Math.min(WAIT_MAX, patience)) : (PATIENCE[patience] || PATIENCE[PATIENCE_DEFAULT]);
    this.reset();
  }
  reset() {
    this.floor = null; this.loud = 0; this.quiet = 0; this.back = 0; this.voiced = 0; this.talk = 0; this.long = 0;
    this.started = false; this.over = false; this.kind = null; this.pending = false; this.checked = false; this.ring = [];
  }
  /** The pause that ends a turn now: their patience or their habit, longer when their words so far stop mid-thought. */
  get waitMs() {
    const base = Math.max(this.patienceMs, this.habit?.need?.() || 0);
    return this.kind === 'incomplete' ? Math.min(WAIT_MAX, base + MORE_MS) : base;
  }
  /** After how long a pause its words are checked (ms). */
  get checkMs() { return Math.max(350, Math.min(900, Math.round(this.patienceMs * 0.35))); }
  /** How far into the pause that would end it (0–1): for the page to show. */
  get progress() { return this.started && !this.over && this.quiet > 0 ? Math.min(1, this.quiet / this.waitMs) : 0; }
  get threshold() { return Math.max(this.min, (this.floor ?? 0) * this.ratio); }
  get keep() { return Math.max(this.threshold, this.talk * this.drop); }
  /** Its words of this pause are being heard: the end waits for them (a little while at most). */
  checking() { this.pending = true; }
  /** The words heard up to this pause (null: none, or they couldn't be heard): how finished they sound decides the wait. */
  words(text) { this.pending = false; this.kind = typeof text === 'string' ? sounds(text) : null; }
  step(rms, dt) {
    if (this.over) return null;
    const v = Number.isFinite(rms) && rms > 0 ? rms : 0;
    this.ring.push(v); if (this.ring.length > 8) this.ring.shift();
    if (this.floor === null) this.floor = v;
    else if (v < this.floor) this.floor = v;
    else if (!this.started || this.quiet >= this.waitMs) this.floor += (v - this.floor) * 0.02;
    if (!this.started) {
      if (v > this.threshold) {
        this.loud += dt; this.talk = this.talk ? this.talk + (v - this.talk) * 0.3 : v;
        if (this.loud >= this.startMs) { this.started = true; this.voiced = this.loud; this.long = this.loud; return 'speech'; }
      } else { this.loud = 0; this.talk = 0; }
      return null;
    }
    this.long += dt;
    if (this.long >= this.maxMs) { this.over = true; return 'limit'; }
    if (v > this.keep) {
      if (this.quiet === 0) { this.voiced += dt; this.talk += (v - this.talk) * 0.1; return null; }
      this.back += dt;
      if (this.back >= (this.quiet < this.gapMs ? this.blipMs : this.resumeMs)) {
        // (talking again: a real pause is one of theirs to learn; what was checked of it no longer counts)
        const was = this.quiet, real = was >= this.checkMs;
        this.quiet = 0; this.voiced += this.back; this.back = 0;
        if (real) { this.habit?.add?.(was); this.kind = null; this.pending = false; this.checked = false; return 'resume'; }
      }
      return null;
    }
    this.back = Math.max(0, this.back - dt / 2);
    // (a soft word, a breath out — quieter than their voice but rising and falling like talk — runs the pause's clock at half
    //  speed; the room's steady hum, even turned up by the microphone's gain, runs it at full speed)
    const lo = Math.min(...this.ring), hi = Math.max(...this.ring);
    const softTalk = v > Math.max(this.threshold, this.talk * this.soft) && hi > lo * 2.5;
    this.quiet += softTalk ? dt / 2 : dt;
    if (!this.checked && this.quiet >= this.checkMs) { this.checked = true; return 'pause'; }
    const wait = this.waitMs;
    if (this.quiet >= wait && !(this.pending && this.quiet < wait + HOLD_MS)) {
      this.over = true;
      return this.voiced >= this.minSpeechMs ? 'end' : 'noise';
    }
    return null;
  }
}

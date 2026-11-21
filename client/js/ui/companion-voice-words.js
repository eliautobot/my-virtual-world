// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Who is being spoken to, in the companions' voice (client/js/ui/companion-voice.js): a name at the front of a sentence (or
// at its end: "what do you think, Sam?"), several names together ("Sam and Lara, …"), "everyone" for the whole group, and
// the words after a wake phrase. Kept apart from the page so the tests run them in node.
// Names by sound: speech-to-text writes a name as it heard it ("Lera" for Lara, "Simon" for Sam). Where a name is expected —
// at the front, after a greeting word, called at the end after a comma — a word that is no name and no ordinary word, and
// sounds like exactly one of the companions out with you, is taken for that name (soundsLike). Nowhere else, and never
// inside another word.
const ALL = /\b(?:everyone|everybody|team|guys|all of you|both of you|you all|y'all)\b/i;
const OPEN = /^(?:hey|hi|ok|okay|oi|so|and|well|um|uh|yo)\b[\s,]*/i;
const GREET = /^(?:hey|hi|ok|okay|oi)$/i;
// (after a name, words that make it someone talked about, not someone called: "Laura said…", "Simon is late")
const TALKED = /^(?:said|says|told|tells|is|was|were|has|had|would|will|can|could|did|does|thinks|thought|wants|wanted|likes|liked|knows|knew|went|goes|got|gets)$/i;
// (ordinary words never taken for a name, however they sound: the commonest English words, and those that sound like
// short names — "same" like Sam, "key" like Kai)
const COMMON = new Set(('a about above after again against ago all almost alone along already also always am an and another any anyone anything are ' +
  'around as ask at away back bad be because been before being below best better between big both but by call came can car care ' +
  'case cause close cold come coming cool could day dear did do does doing done down each early either else end enough even ever ' +
  'every few find fine first five for found four from front fun get give go going gone good got great guess had half hand happy hard ' +
  'has have he hear heard hello help her here hers high him his hold home hope hot house how i if in inside into is it its just keep ' +
  'key kind knew know last late later least left less let lets life like line list listen little live long look looks lot lots love ' +
  'made make man many may maybe me mean might mind mine more morning most move much must my name near need never new next nice ' +
  'night no none nope not nothing now of off often oh old on once one only open or other our out over own park part people place ' +
  'please point pretty put quite rather read real really right road room run said same saw say says see seem seems seen self send ' +
  'set she should show side since sir slow small so some someone something soon sorry sound sounds start stay still stop sum summer ' +
  'summon sun sure take talk tell than thank thanks that the their them then there these they thing things think this those though ' +
  'three through time to today told too took top toward try turn two under until up us use very wait walk want was way we well ' +
  'went were what when where which while who why will wish with without wonder word work would wow yeah yes yet you your yours').split(' '));
const esc = s => String(s).replace(/[.*+?^$()|[\]\\{}]/g, '\\$&');
const word = n => new RegExp('(^|[^\\p{L}])' + esc(n) + '($|[^\\p{L}])', 'iu');
const letters = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');

/** A word's sound, roughly (a Soundex-like key: its first sound, then its consonants by kind — b f p v, c g j k q s x z,
 *  d t, l, m n, r — the same kind twice in a row once, vowels keeping them apart): "Lara", "Lera" and "Laura" are all
 *  'l6'; "Sam", "Sammy" 's5'; "Simon" 's55'. */
export function soundKey(w) {
  let s = letters(w);
  if (!s) return '';
  s = s.replace(/^kn/, 'n').replace(/^wr/, 'r').replace(/ph/g, 'f').replace(/ck/g, 'k').replace(/dg/g, 'j').replace(/c(?=[eiy])/g, 's')
    .replace(/[cq]/g, 'k').replace(/x/g, 'ks').replace(/z/g, 's').replace(/gh/g, 'h');
  const code = c => ('bfpv'.includes(c) ? '1' : 'gjks'.includes(c) ? '2' : 'dt'.includes(c) ? '3' : c === 'l' ? '4' : 'mn'.includes(c) ? '5' : c === 'r' ? '6' : 'hwy'.includes(c) ? '' : '0');
  const first = 'aeiou'.includes(s[0]) ? 'a' : s[0];
  let out = first, last = code(s[0]);
  for (const c of s.slice(1)) {
    const k = code(c);
    if (k === '') continue;   // (h, w, y: no sound of their own, and they keep nothing apart)
    if (k !== '0' && k !== last) out += k;
    last = k;
  }
  return out;
}
/** Letters apart (an edit each: one put in, taken out, changed, or two swapped). */
function edits(a, b) {
  const m = a.length, n = b.length, d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[m][n];
}
/** Whether heard word `w` sounds like name `n` (neither an ordinary word nor the name itself): the same sound key ("Lera",
 *  "Sammy"); for a name of 4 letters or more, one letter off with the same first letter ("Lora"); for a short one, its sound
 *  and one more, in a word at most two letters longer ("Simon" for Sam — not "Samantha", not "summon"). */
export function soundsLike(w, n) {
  const a = letters(w), b = letters(n);
  if (a.length < 3 || b.length < 3 || a === b || COMMON.has(a)) return false;
  const ka = soundKey(a), kb = soundKey(b);
  if (ka === kb) return edits(a, b) <= Math.max(2, Math.floor(b.length / 2));
  if (b.length >= 4 && a[0] === b[0] && edits(a, b) <= 1) return true;
  return b.length <= 4 && a[0] === b[0] && a.length <= b.length + 2 && ka.length === kb.length + 1 && ka.startsWith(kb);
}
/** The one name of `names` heard word `w` stands for: the name itself (any case), or the only one it sounds like — or null. */
function nameFor(w, names) {
  const exact = names.find(n => n.toLowerCase() === String(w).toLowerCase());
  if (exact) return exact;
  const like = names.filter(n => soundsLike(w, n));
  return like.length === 1 ? like[0] : null;
}
/**
 * The text with the names in it as said where a name is expected — at the front (several together: "Simon and Lera, …"),
 * after a greeting word ("hey Lera"), called at the end after a comma ("what do you think, Lera?") — written as the
 * companions' own names. Everything else as it was.
 */
export function heardNames(text, names) {
  const t = String(text || '');
  const list = (names || []).filter(n => letters(n).length >= 3 && !/\s/.test(n));
  if (!t.trim() || !list.length) return t;
  // (the words with where they are: [{ w, at }])
  const words = [...t.matchAll(/[\p{L}'’]+/gu)].map(m => ({ w: m[0], at: m.index }));
  const swap = new Map();   // word index → name
  const take = (k, check = true) => {
    const x = words[k];
    if (!x) return false;
    const n = nameFor(x.w, list);
    if (!n) return false;
    if (n.toLowerCase() !== x.w.toLowerCase()) {
      // (followed by "said", "is", "was"…: someone talked about, not called)
      if (check && words[k + 1] && TALKED.test(words[k + 1].w) && /^\s*$/.test(t.slice(x.at + x.w.length, words[k + 1].at))) return false;
      swap.set(k, n);
    }
    return true;
  };
  // at the front (after a word to start — "hey", "so", "ok" —), one name or several together
  let k = 0, from = 0;
  const lead = j => /^[\s,.!?…"“]*$/.test(t.slice(from, words[j].at));
  while (words[k] && OPEN.test(words[k].w + ' ') && !nameFor(words[k].w, list) && lead(k)) { from = words[k].at + words[k].w.length; k++; }
  if (words[k] && lead(k)) {
    while (take(k)) {
      const between = words[k + 1] ? t.slice(words[k].at + words[k].w.length, words[k + 1].at) : '';
      if (/^\s*[,&+]\s*$/.test(between)) { k += 1; continue; }
      if (/^\s+$/.test(between) && /^and$/i.test(words[k + 1].w) && words[k + 2]) { k += 2; continue; }
      break;
    }
  }
  // after a greeting word, anywhere ("… hey Lera, is it far?")
  words.forEach((x, j) => { if (GREET.test(x.w) && words[j + 1] && /^[\s,]+$/.test(t.slice(x.at + x.w.length, words[j + 1].at))) take(j + 1, false); });
  // called at the end, after a comma ("what do you think, Lera?")
  const z = words.length - 1;
  if (z > 0 && /^\s*,\s*$/.test(t.slice(words[z - 1].at + words[z - 1].w.length, words[z].at)) && /^[\s,.!?…"”]*$/.test(t.slice(words[z].at + words[z].w.length))) take(z, false);
  if (!swap.size) return t;
  let out = '', at = 0;
  for (const [j, n] of [...swap].sort((p, q) => p[0] - q[0])) { out += t.slice(at, words[j].at) + n; at = words[j].at + words[j].w.length; }
  return out + t.slice(at);
}

/** The names said in the text, in the order they come: [{ name, at }]. */
function mentions(t, names) {
  const out = [];
  for (const n of (names || []).filter(Boolean)) {
    // (every time it is said: "I'm asking Sam, not you, Lara. Sam, did you…" calls Sam the second time)
    const re = new RegExp(word(n).source, 'giu');
    for (const m of t.matchAll(re)) out.push({ name: n, at: m.index + m[1].length });
  }
  return out.sort((a, b) => a.at - b.at);
}

/**
 * Who the text is for, from the companions' names: { who: name } (one), { names: [...] } (several named together at the
 * front), { all: true } (the whole group) — or null (nobody called by name: who answers is the turn's to judge —
 * companion-voice.js asks the server, from what was just said). A name at the front or at the end (calling them) counts;
 * one somewhere else counts when it is said to them — set off as a call is ("tell me, Sam, is it far", "… not now. Sam,
 * did you…") and the only such name. A name only talked about is not who it is for (2026-11-18: "Does Lara have anything
 * on her plate? Can you tell her?" was said to Sam, not Lara). A name heard as something that sounds like it counts where a
 * name is expected (heardNames).
 */
export function addressed(text, names) {
  const t = heardNames(String(text || '').trim(), names);
  if (!t) return null;
  const said = mentions(t, names);
  const head = t.replace(OPEN, '');
  const off = t.length - head.length;
  // (at the front: "Sam, …", "hey Sam …", "Sam and Lara, …")
  const front = [];
  let rest = head;
  for (;;) {
    const m = said.find(x => x.at === t.length - rest.length);
    if (!m) break;
    front.push(m.name);
    rest = rest.slice(m.name.length).replace(/^\s*(?:,|and|&|\+)?\s*/i, '');
    if (!rest) break;
  }
  if (front.length > 1) return { names: [...new Set(front)] };
  if (front.length === 1) return { who: front[0] };
  if (ALL.test(t)) return { all: true };
  // (at the end, calling them: "what do you think, Sam?")
  const tail = said.filter(x => /^[\s,.!?…]*$/.test(t.slice(x.at + x.name.length)));
  if (tail.length) return { who: tail[tail.length - 1].name };
  // (called in the middle: set off after — a comma, a question mark, the end — and before by a comma or a full stop, or
  //  among the first few words of its sentence: "tell me, Sam, is it far", "ok so Lera, what now", "… not now. Sam, did you…")
  const calledAt = x => {
    if (!/^\s*(?:[,;:.!?…—-]|$)/.test(t.slice(x.at + x.name.length))) return false;
    const before = t.slice(off, x.at);
    if (/(?:^|[,;:.!?…—-])\s*$/.test(before)) return true;
    const sentence = before.split(/[.!?…]\s+/).pop();
    return sentence.trim().split(/\s+/).filter(Boolean).length <= 2;
  };
  const called = [...new Set(said.filter(calledAt).map(x => x.name))];
  if (called.length === 1) return { who: called[0] };
  return null;
}

/** The words after the wake phrase ("hey Sam, what's this" -> "what's this"), or null when it was not said. */
export function afterWake(text, names) {
  const w = wakeOf(text, names);
  return w ? w.rest : null;
}

/**
 * The wake phrase in what was heard: { who: name | 'all', rest } — who it woke ("hey Sam", "hey team"; "hey Lera" for Lara)
 * and the words after it ('' when only the wake phrase was said: the next thing said is the question) — or null when it
 * was not said.
 */
export function wakeOf(text, names) {
  const t = heardNames(String(text || '').trim(), names);
  const list = (names || []).filter(Boolean);
  const namesAlt = list.map(esc).join('|');
  const re = new RegExp('(?:^|[^\\p{L}])(?:hey|hi|ok|okay|oi)[\\s,]+(' + (namesAlt ? namesAlt + '|' : '') + 'companions?|team|guys|everyone|everybody|all)(?=$|[^\\p{L}])([\\s\\S]*)', 'iu');
  const m = re.exec(t);
  if (!m) return null;
  const hit = list.find(n => n.toLowerCase() === m[1].toLowerCase());
  return { who: hit || 'all', rest: m[2].replace(/^[\s,.:;!?-]+/, '').trim() };
}

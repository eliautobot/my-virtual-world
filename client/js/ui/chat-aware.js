// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// "👁 What it knew" under an agent's answer (docs/features/awareness.md §3): what its brain was told about its surroundings
// with the message it answered — its owner's choice (the mode), whether the two of them were together, what it was told
// (the full picture, one short line, only that it can look around, or nothing), what it looked up itself (its look and
// recent tools) and the exact text it got, with about how many tokens that was. All of it is the answer's own record
// (its meta.aware, kept by the server with the answer), so "the setting did this" and "something is wrong" can be told
// apart. A chip beside what the answer took (ui/chat-window.js metaLine) opens it; the chat window keeps which are open.
import { esc } from '../core/util.js';

/** The modes in words (server/senses/senses.js MODE_INFO's labels, as the Studio shows them). */
export const AWARE_MODE = { off: 'Off', ask: 'Only when it asks', together: 'When it\'s with me', always: 'Always' };
const TOLD = { full: 'the full picture', line: 'one short line', pointer: 'only that it can look around' };
const TOOL = { look: 'Look around', recent: 'What happened lately' };
const GIST = 90;   // (characters of what a tool answered, shown before it is opened)
let seq = 0;

const tok = n => `≈ ${Math.max(0, Math.round(Number(n) || 0)).toLocaleString()} token${Math.round(Number(n) || 0) === 1 ? '' : 's'}`;
/** An answer's awareness record, when it has one worth showing. */
export const awareOf = m => (m && m.role === 'assistant' && m.meta?.aware && typeof m.meta.aware === 'object' ? m.meta.aware : null);

/** What it was told, in words. */
function toldWords(a) {
  if (TOLD[a.told]) return TOLD[a.told];
  return a.mode === 'off' ? 'nothing (awareness is off)' : 'nothing (it has no body in the city)';
}

/**
 * The chip and its panel for answer `m` (empty strings when it has no record). key: what the window remembers it by
 * (its id); open: shown open. Returns { chip, panel }.
 */
export function awareHtml(m, key, open = false) {
  const a = awareOf(m);
  if (!a) return { chip: '', panel: '' };
  const id = `cw-aw-${++seq}`;
  const chip = `<button type="button" class="cw-aw-b${open ? ' on' : ''}" data-a="aware" data-aw="${esc(key)}" aria-expanded="${open}" aria-controls="${id}" title="What its brain was told about where it is and who is around">`
    + `<span aria-hidden="true">👁</span> What it knew</button>`;
  const looked = Array.isArray(a.looked) ? a.looked.filter(x => x && x.tool) : [];
  const noBody = a.told === 'none' && a.mode !== 'off';
  const lookedHtml = looked.length
    ? `<ul class="cw-aw-looked">${looked.map(x => { const t = String(x.text || ''), g = t.replace(/\s+/g, ' ').trim(); return `<li><details><summary><b>${esc(TOOL[x.tool] || x.tool)}</b> → <span class="cw-aw-gist">${esc(g.length > GIST ? `${g.slice(0, GIST)}…` : g || 'nothing')}</span></summary><pre class="cw-aw-pre" tabindex="0">${esc(t)}</pre></details></li>`; }).join('')}</ul>`
    : ' <b>nothing</b>';
  const text = String(a.text || '');
  const panel = `<div class="cw-aw" id="${id}" role="region" aria-label="What it knew"${open ? '' : ' hidden'}>
    <p>Awareness: <b>${esc(AWARE_MODE[a.mode] || a.mode || 'unknown')}</b></p>
    ${noBody ? '' : `<p>${a.together ? `You were together: <b>${esc(a.together)}</b>` : 'You were apart'}</p>`}
    <p>It was told: <b>${esc(toldWords(a))}</b></p>
    <div class="cw-aw-l">It looked up:${lookedHtml}</div>
    ${text ? `<details class="cw-aw-text"><summary>The exact text it got <span class="cw-aw-tok">${esc(tok(a.tokens ?? Math.ceil(text.length / 4)))}</span></summary><pre class="cw-aw-pre" tabindex="0">${esc(text)}</pre></details>` : ''}
  </div>`;
  return { chip, panel };
}

/** The chip `b` was pressed: its panel opens or closes where it is (nothing drawn again). Returns whether it is open now. */
export function toggleAware(b) {
  const p = document.getElementById(b.getAttribute('aria-controls'));
  if (!p) return false;
  const open = p.hidden;
  p.hidden = !open;
  b.setAttribute('aria-expanded', String(open));
  b.classList.toggle('on', open);
  p.closest('.cw-msg')?.classList.toggle('aw-open', open);
  return open;
}

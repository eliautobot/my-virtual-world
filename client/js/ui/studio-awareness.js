// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The Agent Studio's Awareness tab (docs/features/awareness.md §2): how much the agent's brain is told about where it is
// and who is around it when its owner (or a manager) writes to it — off, only when it asks, when its owner is with it, or
// always — the installation's default marked; what it would be told right now, in its own words, with what that costs in
// tokens; and its diary ("What it lived lately"), newest first. The modes and their words are the server's
// (server/senses/senses.js MODE_INFO): nothing about them is decided here. The server decides who may see and change it
// (its owner, or an account it is shared with to manage: agents.mind — the same people as its Mind).
import { getJSON } from '../core/net.js';
import { esc } from '../core/util.js';

/** A diary line's kind (server/senses/diary.js), as an icon and a word for screen readers. */
const KIND = { move: ['📍', 'Went'], with: ['👥', 'With someone'], heard: ['💬', 'Heard'], work: ['💼', 'Work'], activity: ['🎯', 'Doing'], note: ['✏', 'Note'] };
const SAVE_MS = 350;   // (arrow keys through the choices: saved once they stop)

/** What the agent would be told right now in mode `mode`, from the server's `now` (GET /api/awareness): { told, text, tokens, words }. */
export function previewOf(mode, now) {
  if (!now?.body) return { told: 'none', text: '', words: 'It has no body in the city, so there is nothing around it to tell.' };
  if (mode === 'off') return { told: 'none', text: '', words: 'Nothing about its surroundings. Asked where it is, it says it can\'t tell right now.' };
  if (mode === 'ask') return { told: 'pointer', text: now.pointer || '', tokens: now.tokens?.pointer || 0, words: 'Only the time and that it may look around (Look around) or read what happened lately — when a question needs it.' };
  const full = mode === 'always' || (mode === 'together' && !!now.together);
  return full
    ? { told: 'full', text: now.full || '', tokens: now.tokens?.full || 0, words: 'The full picture: where exactly it is, who is around, what it heard, what is going on.' }
    : { told: 'line', text: now.line || '', tokens: now.tokens?.line || 0, words: 'One short line: where it is and what it is doing, and that it can look around for more.' };
}
const tok = n => `≈ ${Math.max(0, Math.round(n || 0)).toLocaleString()} token${Math.round(n || 0) === 1 ? '' : 's'}`;
/** The tokens line for a mode: what a message costs apart and together. */
function costOf(mode, now) {
  if (!now?.body || mode === 'off') return 'Nothing is added to your messages.';
  if (mode === 'ask') return `${now.tokens?.pointer ? `${tok(now.tokens.pointer)} a message` : 'A few words a message'}; more only when it looks around.`;
  if (mode === 'always') return `${tok(now.tokens?.full)} a message`;
  return `${tok(now.tokens?.line)} a message apart · ${tok(now.tokens?.full)} together`;
}

export async function awarenessTab(C, body, live) {
  const st = C.st.aware = C.st.aware || { view: null, diary: null, diaryOpen: true, timer: 0, want: null };
  if (!st.view) {
    try { st.view = await getJSON(`/api/awareness?agent=${C.id}`); } catch (e) { st.view = { error: e.message || 'Could not read it' }; }
  }
  if (!st.diary && !st.view.error) {
    try { st.diary = (await getJSON(`/api/awareness/diary?agent=${C.id}`)).items || []; } catch (e) { st.diary = { error: e.message || 'Could not read it' }; }
  }
  if (!live()) return;
  const v = st.view;
  if (v.error) { body.innerHTML = `<p class="hint">${esc(v.error === 'No such agent' ? 'Only its owner, or someone it is shared with to manage it, sees its awareness.' : v.error)}</p>`; return; }
  const chosen = st.want ?? v.own ?? v.default;   // (its owner's choice, else the installation's: what is marked)
  const modes = v.modes || [];
  const label = id => modes.find(x => x.id === id)?.label || id;
  const pv = previewOf(v.enabled ? chosen : 'off', v.now);
  const together = v.now?.body ? (v.now.together ? `🧍 You're together: ${esc(v.now.together)}` : 'You\'re apart') : '';
  const diary = Array.isArray(st.diary) ? st.diary : [];
  body.innerHTML = `<div class="sa${v.enabled ? '' : ' dis'}">
    ${v.enabled ? '' : '<p class="sa-off" role="note"><b>Awareness is switched off on this server</b> (Settings → Agent limits): no agent is told about its surroundings, whatever is chosen here.</p>'}
    <div class="st-sec"><div class="st-sec-h"><h4>👁 How aware ${esc(C.name)} is</h4>${v.own ? '<button type="button" class="btn small" data-c="default">Use the default</button>' : ''}</div>
      <p class="hint">How much its brain is told about where it is, who is around and what is going on when you chat with it.</p>
      <div class="sa-modes" role="radiogroup" aria-label="How aware it is">
        ${modes.map(m => `<label class="sa-mode${m.id === chosen ? ' on' : ''}"><input type="radio" name="sa-mode-${C.id}" value="${esc(m.id)}"${m.id === chosen ? ' checked' : ''}>
          <span class="sa-mode-t"><b>${esc(m.label)}</b>${m.id === v.default ? ' <small class="sa-def">(default)</small>' : ''}${m.id === chosen ? ' <span class="st-pill on sa-cur">✓ chosen</span>' : ''}</span>
          <span class="sa-mode-p">${esc(m.help)}</span></label>`).join('')}
      </div>
      <p class="hint sa-whose">${v.own ? `You chose this for ${esc(C.name)}. The default here is “${esc(label(v.default))}”.` : `${esc(C.name)} follows this world's default (“${esc(label(v.default))}”) until you choose.`}</p></div>
    <div class="st-sec sa-now"><div class="st-sec-h"><h4>🔭 Right now it would be told</h4><button type="button" class="btn small" data-c="now" title="Work it out again from where it is now">Refresh</button></div>
      ${v.now?.body ? `<p class="sa-tog${v.now.together ? ' on' : ''}">${together}</p>` : ''}
      <p class="sa-words">${esc(v.enabled ? pv.words : 'Nothing: awareness is switched off on this server.')}</p>
      ${pv.text ? `<pre class="sa-text" tabindex="0" aria-label="The exact text it would get">${esc(pv.text)}</pre>` : ''}
      ${v.now?.body ? `<p class="hint sa-cost">${esc(v.enabled ? costOf(chosen, v.now) : 'Nothing is added to your messages.')}</p>` : ''}</div>
    <details class="st-sec sa-diary"${st.diaryOpen ? ' open' : ''}><summary><div class="st-sec-h"><h4>📖 What it lived lately</h4></div><span class="hint">What happened to it in the city — newest first. Kept since the server last started.</span></summary>
      <div class="row sa-diary-acts"><button type="button" class="btn small" data-c="diary">Refresh</button></div>
      ${st.diary?.error ? `<p class="hint bad">${esc(st.diary.error)}</p>` : diary.length ? `<ol class="sa-list">${diary.map(l => { const k = KIND[l.kind] || KIND.note; return `<li><time>${esc(l.clock || '')}</time><span class="sa-k" role="img" aria-label="${esc(k[1])}" title="${esc(k[1])}">${k[0]}</span><span class="sa-l">${esc(l.text)}</span></li>`; }).join('')}</ol>` : `<p class="hint">Nothing yet${v.now?.body ? ': what it lives from now on shows here.' : ' — it has no body in the city.'}</p>`}
    </details>
  </div>`;
  const q = s => body.querySelector(s);
  const inModes = () => !!document.activeElement?.closest?.('.sa-modes');
  const save = async mode => {
    if (C.busy) { st.timer = setTimeout(() => save(mode), 200); return; }   // (another change still on its way: this one after it)
    const r = await C.call('/api/awareness', { agent: C.id, mode }, mode ? `${C.name}: ${label(mode)}` : `${C.name} follows the default again`);
    if (st.want !== null && st.want !== mode) return;   // (chosen again meanwhile: that one is saved next)
    st.want = null;
    if (r && !r.error) st.view = r;
    st.refocus = st.refocus || inModes();
    C.repaint();
  };
  for (const r of body.querySelectorAll('.sa-modes input')) r.onchange = () => {
    // (marked at once, saved when the choice settles: arrow keys go through the choices one by one)
    st.want = r.value; st.refocus = true; clearTimeout(st.timer);
    C.repaint();
    st.timer = setTimeout(() => save(r.value), SAVE_MS);
  };
  // (drawn again under the keyboard: the focus stays on the choice)
  if (st.refocus) { st.refocus = false; body.querySelector('.sa-modes input:checked')?.focus(); }
  const d = q('[data-c="default"]');
  if (d) d.onclick = () => { clearTimeout(st.timer); st.want = null; save(null); };
  q('[data-c="now"]').onclick = () => { st.view = null; C.repaint(); };
  q('[data-c="diary"]').onclick = () => { st.diary = null; C.repaint(); };
  q('.sa-diary').ontoggle = e => { st.diaryOpen = e.target.open; };
}

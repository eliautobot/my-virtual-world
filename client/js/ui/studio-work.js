// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The Agent Studio's Work tab (docs/features/CHAT.md §13): the agent on the job for its owner, apart from its life in the
// city. Its job (its title - the agent's role -, who it works for, its instructions, its tone), what it knows (text and
// files, all of it sent with every work message, so bounded and measured here), how it works (its time zone, whether it
// keeps work notes, the mode a new chat starts in) and the notes it kept. Each chat switches Work · Life (ui/chat.js).
// The job's fields are saved together (Save, like Personality); notes and files are added and removed at once.
import { auth } from '../core/auth.js';
import { getJSON, post } from '../core/net.js';
import { esc } from '../core/util.js';
import { isExt } from '../core/agent-view.js';
import { load as reloadAgents } from '../core/agents.js';

const TONES = [['own', 'Its own', 'its personality, in its own words'], ['friendly', 'Friendly', 'warm, plain, approachable'],
  ['professional', 'Professional', 'courteous, clear and to the point'], ['concise', 'Concise', 'the answer first, few words'], ['formal', 'Formal', 'formal and respectful']];
const ACCEPT = '.pdf,.docx,.xlsx,.pptx,.odt,.ods,.odp,.txt,.md,.csv,.tsv,.json,.xml,.yaml,.yml,.html';
const num = n => Number(n || 0).toLocaleString('en-US');
const mb = b => `${(b / 1048576).toFixed(b < 1048576 ? 2 : 1)} MB`;
const sizeOf = b => (b < 1024 ? `${b} B` : b < 1048576 ? `${Math.round(b / 1024)} KB` : mb(b));
const when = t => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const hereZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { return ''; } };
const zones = () => { try { return Intl.supportedValuesOf('timeZone'); } catch { return null; } };

export async function workTab(C, body, live) {
  const r = C.rec();
  if (isExt(r)) { body.innerHTML = `<p class="hint">${esc(r.name)} is a connected agent: it works the way its own platform tells it to.</p>`; return; }
  const data = await C.get('work');
  if (!live()) return;
  if (!data || data.error) { body.innerHTML = `<p class="hint">${esc(data?.error || 'Not available.')}</p>`; return; }
  const st = C.st.work = C.st.work || { data, B: { ...data.brief }, title: r.role || '', dirty: false, adding: null };
  const B = st.B, D = st.data, name = esc(r.name), conn = r.connection;
  // whose chats it applies to: an agent whose brain is a model provider (the Mind); another platform sets its own
  const brainNote = !conn ? `<p class="wk-note">${name} has no brain yet. Give it one in <button type="button" class="linkish" data-go="brain">Brain</button>, then its job applies to your chats with it.</p>`
    : conn.kind !== 'models' ? `<p class="wk-note">${name} thinks on <b>${esc(conn.label)}</b>, which has its own instructions: what you write here is for agents whose brain is a model provider (Brain).</p>` : '';
  const zl = zones(), here = hereZone();
  const zoneOpts = zl ? [`<option value="">Yours - whoever is chatting${here ? ` (now ${esc(here)})` : ''}</option>`,
    ...(B.timezone && !zl.includes(B.timezone) ? [`<option value="${esc(B.timezone)}" selected>${esc(B.timezone)}</option>`] : []),
    ...zl.map(z => `<option value="${esc(z)}"${z === B.timezone ? ' selected' : ''}>${esc(z.replace(/_/g, ' '))}</option>`)].join('') : null;
  const files = D.files.map(f => `<li class="wk-file"><span class="wk-fi" aria-hidden="true">📄</span><a href="/api/agent-work/file?agent=${C.id}&id=${f.id}" target="_blank" rel="noopener">${esc(f.name)}</a>
    <small>${f.kind === 'pdf' ? `PDF · ${sizeOf(f.size)}` : `${num(f.chars)} characters`}</small><button type="button" class="wk-x" data-rm-file="${f.id}" title="Remove it" aria-label="Remove ${esc(f.name)}">×</button></li>`).join('');
  const notes = D.notes.map(n => `<li class="wk-n"><span>${esc(n.text)}</span><small>${n.source === 'owner' ? 'you wrote' : 'it kept'} · ${when(n.created)}</small><button type="button" class="wk-x" data-rm-note="${n.id}" title="Remove it" aria-label="Remove this note">×</button></li>`).join('');
  body.innerHTML = `<div class="wk">
    <p class="hint wk-intro">In a chat set to <b>Work</b>, ${name} is on the job for you: this brief, what it knows, its notes and the real date and time - nothing of its life in the city. In <b>Life</b> it is the resident you know. Each chat has the switch. What others who talk with it get: <button type="button" class="linkish" data-go="visitors">Visitors</button>.</p>
    ${brainNote}
    <div class="st-sec"><div class="st-sec-h"><h4>💼 Its job</h4></div>
      <div class="wk-two"><label>Job title<input class="input wk-title" maxlength="60" placeholder="Receptionist" value="${esc(st.title)}"></label>
        <label>Works for<input class="input wk-company" maxlength="80" placeholder="You - or your business's name" value="${esc(B.company)}"></label></div>
      <label>Instructions <small class="dim">- what it does at work and how; it follows them in every work chat</small>
        <textarea class="input wk-instr" rows="7" maxlength="8000" placeholder="Answer questions about our clinic and book appointments: ask for the name, a phone number and a time that suits. Never give medical advice - suggest calling us instead.">${esc(B.instructions)}</textarea>
        <small class="wk-count" data-count="instr">${num(B.instructions.length)} / 8,000</small></label>
      <div class="wk-row"><span class="wk-lab">Tone</span><div class="seg wk-tones" role="radiogroup" aria-label="Tone">${TONES.map(([k, l, t]) => `<button type="button" class="btn small${B.tone === k ? ' on' : ''}" data-tone="${k}" role="radio" aria-checked="${B.tone === k}" title="${esc(t)}">${l}</button>`).join('')}</div></div>
    </div>
    <div class="st-sec"><div class="st-sec-h"><h4>📚 What it knows</h4></div>
      <p class="hint">Facts it answers from - hours, prices, services, policies, who to ask. All of it goes with every work message.</p>
      <textarea class="input wk-know" rows="5" placeholder="Open 9 to 5, Monday to Friday. A cleaning is $90. Parking is behind the building.">${esc(B.knowledge)}</textarea>
      <ul class="wk-files">${files}${st.adding ? `<li class="wk-file adding"><span class="wk-fi" aria-hidden="true">📄</span><span>${esc(st.adding)}</span><small>Reading it…</small></li>` : ''}</ul>
      <div class="wk-row"><button type="button" class="btn small" data-c="add-file"${st.adding || D.files.length >= D.budget.maxFiles ? ' disabled' : ''}>📄 Add a file</button>
        <small class="dim">Word, Excel, PowerPoint, text or PDF · up to ${D.budget.maxFiles} files</small><input type="file" class="wk-pick" accept="${ACCEPT}" hidden></div>
      <div class="wk-budget"></div>
    </div>
    <div class="st-sec"><div class="st-sec-h"><h4>⚙ At work</h4></div>
      <label>Its time zone <small class="dim">- for the real date and time it works by</small>${zoneOpts ? `<select class="input wk-tz">${zoneOpts}</select>` : `<input class="input wk-tz" maxlength="64" placeholder="Yours - or one like America/New_York" value="${esc(B.timezone)}">`}</label>
      <label class="wk-check"><input type="checkbox" class="wk-keep"${B.notes ? ' checked' : ''}> Keeps work notes <small class="dim">- what's worth remembering from work chats (below)</small></label>
      <div class="wk-row"><span class="wk-lab">New chats start in</span><div class="seg wk-modes" role="radiogroup" aria-label="New chats start in">${[['work', 'Work'], ['life', 'Life']].map(([k, l]) => `<button type="button" class="btn small${B.defaultMode === k ? ' on' : ''}" data-mode="${k}" role="radio" aria-checked="${B.defaultMode === k}">${l}</button>`).join('')}</div></div>
    </div>
    <div class="st-sec"><div class="st-sec-h"><h4>🧾 Its work notes</h4><span class="st-pill">${D.notes.length}</span></div>
      <p class="hint">${B.notes ? 'What it kept from work chats, and what you add. The newest 40 go with every work message.' : 'It keeps no notes now; the ones here still go with every work message.'}</p>
      <div class="wk-add"><input class="input wk-note-in" maxlength="500" placeholder="Something it should always know at work" aria-label="A new note"><button type="button" class="btn small" data-c="add-note">Add</button></div>
      ${notes ? `<ul class="wk-notes">${notes}</ul>` : ''}
    </div>
    <div class="sp-save${st.dirty ? ' dirty' : ''}"><span>${st.dirty ? 'Unsaved changes' : 'Saved'}</span><button type="button" class="btn small" data-c="undo"${st.dirty ? '' : ' disabled'}>Undo</button><button type="button" class="btn primary" data-c="save"${st.dirty ? '' : ' disabled'}>Save</button></div>
  </div>`;
  const q = s => body.querySelector(s);
  const read = () => {
    st.title = q('.wk-title').value; B.company = q('.wk-company').value; B.instructions = q('.wk-instr').value; B.knowledge = q('.wk-know').value;
    B.timezone = q('.wk-tz').value.trim(); B.notes = q('.wk-keep').checked;
  };
  const dirty = () => {
    if (st.dirty) return;
    st.dirty = true; const b = q('.sp-save'); b.classList.add('dirty'); b.querySelector('span').textContent = 'Unsaved changes'; b.querySelectorAll('button').forEach(x => { x.disabled = false; });
  };
  // what it knows, measured as it is typed: its text and its files' against the limit, and what that costs a message
  const budget = () => {
    const chars = q('.wk-know').value.length + D.files.reduce((n, f) => n + (f.chars || 0), 0), max = D.budget.maxChars, over = chars > max;
    const pdf = D.budget.pdf;
    q('.wk-budget').innerHTML = `<div class="st-meter${over ? ' over' : ''}"><i style="width:${Math.min(100, Math.round(chars / max * 100))}%"></i></div>
      <small class="${over ? 'bad' : 'dim'}">${num(chars)} of ${num(max)} characters${chars ? ` · about ${num(Math.ceil(chars / 4))} tokens with every work message` : ''}${pdf ? ` · PDFs ${mb(pdf)} of ${mb(D.budget.maxPdf)}` : ''}${over ? ' - too much: shorten it or remove a file' : ''}</small>`;
  };
  budget();
  q('.wk-instr').oninput = () => { q('[data-count="instr"]').textContent = `${num(q('.wk-instr').value.length)} / 8,000`; dirty(); };
  q('.wk-know').oninput = () => { budget(); dirty(); };
  for (const s of ['.wk-title', '.wk-company', '.wk-tz']) q(s).oninput = dirty;
  q('.wk-tz').onchange = dirty; q('.wk-keep').onchange = dirty;
  body.querySelectorAll('[data-tone]').forEach(b => { b.onclick = () => { read(); B.tone = b.dataset.tone; st.dirty = true; C.repaint(); }; });
  body.querySelectorAll('[data-mode]').forEach(b => { b.onclick = () => { read(); B.defaultMode = b.dataset.mode; st.dirty = true; C.repaint(); }; });
  body.querySelectorAll('[data-go]').forEach(b => { b.onclick = () => C.go(b.dataset.go); });
  q('[data-c="undo"]').onclick = () => { C.st.work = null; C.repaint(); };
  q('[data-c="save"]').onclick = async () => {
    read();
    const role = st.title.trim(), roleChanged = role !== (r.role || '');
    const w = await C.call('/api/agent-work', { agent: C.id, company: B.company, instructions: B.instructions, tone: B.tone, timezone: B.timezone, knowledge: B.knowledge, notes: B.notes, defaultMode: B.defaultMode });
    if (!w) return;
    if (roleChanged && !(await C.call('/api/agents/update', { id: C.id, role }))) return;
    if (roleChanged) { await reloadAgents(); C.head(); }
    C.toast('Saved'); C.drop('work'); C.st.work = null; C.repaint();
  };
  // the parts that change at once: they keep what is being typed above
  const fresh = patch => { st.data = { ...st.data, ...patch }; C.cache.set('work', Promise.resolve(st.data)); read(); C.repaint(); };
  const addNote = async () => {
    const t = q('.wk-note-in').value.trim();
    if (!t) return;
    const res = await C.call('/api/agent-work/notes', { agent: C.id, add: { text: t } });
    if (res) fresh({ notes: res.notes });
  };
  q('[data-c="add-note"]').onclick = addNote;
  q('.wk-note-in').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); addNote(); } };
  body.querySelectorAll('[data-rm-note]').forEach(b => {
    b.onclick = async () => { const res = await C.call('/api/agent-work/notes', { agent: C.id, id: Number(b.dataset.rmNote), remove: true }); if (res) fresh({ notes: res.notes }); };
  });
  body.querySelectorAll('[data-rm-file]').forEach(b => {
    b.onclick = async () => {
      if (!C.armed(b, 'Remove?')) return;
      const res = await C.call('/api/agent-work/files/remove', { agent: C.id, id: Number(b.dataset.rmFile) });
      if (res) fresh({ files: res.files, budget: res.budget });
    };
  });
  const pick = q('.wk-pick');
  q('[data-c="add-file"]').onclick = () => pick.click();
  pick.onchange = async () => {
    const f = pick.files?.[0];
    pick.value = '';
    if (!f) return;
    read(); st.adding = f.name; C.repaint();
    const res = await addFile(C, f);
    if (C.st.work !== st) return;   // (the Studio moved on)
    st.adding = null;
    if (res.error) { C.say(`${f.name}: ${res.error}`, true); C.repaint(); return; }
    C.toast(res.duplicate ? `${f.name} is already there` : `${r.name} knows ${f.name} now`);
    fresh({ files: res.files, budget: res.budget });
  };
}

/** Uploads a file (as the chat does) and gives it to the agent; an upload made only for this leaves the Library again. */
async function addFile(C, f) {
  let up;
  try {
    const headers = { 'content-type': 'application/octet-stream' };
    if (auth.csrf) headers['x-csrf-token'] = auth.csrf;
    const res = await fetch(`/api/chat/attachments?name=${encodeURIComponent(f.name)}`, { method: 'POST', headers, body: f });
    const j = await res.json().catch(() => null);
    if (!res.ok || !j?.attachment) return { error: j?.error || 'The upload failed.' };
    up = j.attachment;
  } catch { return { error: 'The upload failed.' }; }
  try { return await post('/api/agent-work/files', { agent: C.id, attachment: up.id, drop: !up.duplicate }); }
  catch (e) {
    if (!up.duplicate) post('/api/chat/attachments/delete', { id: up.id }).catch(() => {});
    return { error: e.message };
  }
}

/** Its work, for the Studio's data (agent-studio.js LOAD). */
export const loadWork = id => getJSON(`/api/agent-work?agent=${id}`);

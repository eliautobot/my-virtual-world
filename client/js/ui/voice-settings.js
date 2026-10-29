// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Choosing voices (docs/features/CHAT.md §9.4), on the server's voice (§9.3):
// - Settings → Voice: the account's own listening (who hears it, its language) and speaking (its agents' default voice,
//   the speed, the browser's voice), with a preview; its voice minutes; adding its own voice service (a 'voice'
//   connection); for administrators the installation's voice services and
//   limits (the voice.* settings) and today's use.
// - Agent Studio → Brain → "Its voice": the agent's own voice — one of the voices of whichever service speaks for it
//   (2026-10-08: every agent a voice of its own; one is picked for it until one is chosen), or a service of its own,
//   the speed, or the browser's voice — with a preview; only for whoever manages the agent (the server checks).
// What may be chosen comes from the server (GET /api/voice/options); nothing about a service is decided here.
import { auth } from '../core/auth.js';
import { getJSON, post } from '../core/net.js';
import { esc } from '../core/util.js';
import { can, options, forget, speak, unlock, Player, browserSay, voicesReady, VoiceFail } from './voice.js';

const LANGS = [['', 'Automatic'], ['en', 'English'], ['en-US', 'English (US)'], ['en-GB', 'English (UK)'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['it', 'Italian'],
  ['pt', 'Portuguese'], ['pt-BR', 'Portuguese (Brazil)'], ['nl', 'Dutch'], ['pl', 'Polish'], ['ru', 'Russian'], ['uk', 'Ukrainian'], ['tr', 'Turkish'], ['ar', 'Arabic'], ['he', 'Hebrew'],
  ['hi', 'Hindi'], ['ja', 'Japanese'], ['ko', 'Korean'], ['zh', 'Chinese'], ['sv', 'Swedish'], ['el', 'Greek'], ['id', 'Indonesian'], ['vi', 'Vietnamese']];
const player = new Player();
/** How loud a preview playing here is now (0: none) — the Agent Studio shows it at the agent's throat. */
export const previewLevel = () => (player.busy ? Math.max(0.04, player.level()) : 0);
const minutes = s => Math.floor((Number(s) || 0) / 60);

/** The <option>s of a voice-service choice: automatic, the browser's own, then each service that can do `what`. */
function serviceOptions(o, what, cur, autoText) {
  const sel = v => (String(cur ?? 'auto') === v ? ' selected' : '');
  const list = (o.services || []).filter(s => s[what]);
  return `<option value="auto"${sel('auto')}>${esc(autoText)}</option><option value="browser"${sel('browser')}>The browser's own (free${what === 'listen' ? '; Chrome and Edge send it to Google' : ''})</option>
    ${list.map(s => `<option value="${s.id}"${sel(String(s.id))}>${esc(s.label)} — ${esc(s.mine ? `your own ${s.service}` : s.installation ? `the world's (${s.service})` : `shared (${s.service})`)}</option>`).join('')}`;
}
/** The world's service for this (its name as the administrators gave it), or null. */
const platformOf = (o, what) => (o.services || []).find(s => s.id === o.installation?.[`${what}Id`]) || null;
const toChoice = v => (v === 'auto' ? null : v === 'browser' ? 'browser' : Number(v));
const describe = (d, what) => (!d ? '' : d.source === 'browser' ? (what === 'listen' ? 'the browser listens' : 'the browser\'s own voice') : `${d.service?.label || 'a voice service'}${d.voice ? ` (${d.voice})` : ''}`);
const REASON = { none: 'no voice service is set up', voice_daily: 'today\'s limit was reached', choice: 'your choice' };

/** A service's voices for a <select> (the service's own list, kept a few minutes by the server). */
async function voiceOptions(sel, connection, cur, fallback, first = null) {
  sel.innerHTML = '<option value="">Loading the voices…</option>'; sel.disabled = true;
  let list = [];
  try { list = (await getJSON(`/api/voice/voices?connection=${connection}`)).voices || []; } catch (e) { sel.innerHTML = `<option value="">Its usual voice (${esc(e.message)})</option>`; sel.disabled = false; return; }
  if (cur && !list.some(v => v.id === cur)) list.unshift({ id: cur, label: cur });
  if (first !== null) { sel.innerHTML = groupedVoices(list, cur, first); sel.disabled = false; return; }
  sel.innerHTML = `<option value="">Its usual voice${fallback ? ` (${esc(fallback)})` : ''}</option>${list.map(v => `<option value="${esc(v.id)}"${v.id === cur ? ' selected' : ''}>${esc(v.label || v.id)}${v.lang ? ` · ${esc(v.lang)}` : ''}${v.gender ? ` · ${esc(v.gender)}` : ''}</option>`).join('')}`;
  sel.disabled = false;
}
/** A service's voices as <option>s under their language (when the service says), after a first option of its own. */
function groupedVoices(list, cur, first) {
  const groups = new Map();
  for (const v of list) { const k = v.lang || ''; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(v); }
  const opt = v => `<option value="${esc(v.id)}"${v.id === cur ? ' selected' : ''}>${esc(v.label || v.id)}</option>`;
  const name = k => { try { return new Intl.DisplayNames([navigator.language || 'en'], { type: 'language' }).of(k) || k; } catch { return k; } };
  return first + (groups.size > 1 ? [...groups].map(([k, vs]) => (k ? `<optgroup label="${esc(name(k))}">${vs.map(opt).join('')}</optgroup>` : vs.map(opt).join(''))).join('') : list.map(opt).join(''));
}
/** The browser's voices for a <select>. */
async function browserVoiceOptions(sel, cur) {
  const list = await voicesReady();
  sel.innerHTML = `<option value="">This device's default</option>${list.map(v => `<option value="${esc(v.name)}"${v.name === cur ? ' selected' : ''}>${esc(v.name)} · ${esc(v.lang)}</option>`).join('')}`;
  if (cur && !list.some(v => v.name === cur)) sel.insertAdjacentHTML('beforeend', `<option value="${esc(cur)}" selected>${esc(cur)} (not on this device)</option>`);
}

/** Plays a preview: a service and voice named outright, or whatever speaks for `agent` (or the account) now. */
async function preview(out, { service, voice, speed, browserVoice, agent, text }) {
  unlock({ synth: true });
  player.stop();
  out.textContent = 'Fetching…';
  try {
    if (service === 'browser') {
      if (!can.synth()) throw new Error('This browser can\'t speak');
      out.textContent = 'The browser\'s voice…';
      await player.play({ text, browserVoice, rate: speed });
      out.textContent = '';
      return;
    }
    const body = typeof service === 'number' ? { connection: service, voice: voice || '', speed, text, plain: true } : { ...(agent ? { agent } : {}), text, plain: true };
    const r = await speak(body);
    if (r.browser) { out.textContent = `${r.note || 'The browser\'s own voice'}`; await player.play({ text: r.text, browserVoice: r.browserVoice || browserVoice, rate: speed }); return; }
    out.textContent = '▶ Playing';
    await player.play(r);
    out.textContent = '';
  } catch (e) { out.textContent = e instanceof VoiceFail || e.message ? `✗ ${e.message}` : '✗ It couldn\'t speak'; }
}

// ------------------------------------------------------------------------------------------------ Settings → Voice
export async function voiceTab(d, body, app) {
  body.innerHTML = '<p class="hint">Loading…</p>';
  const err = m => { const e = d.q('.err'); e.textContent = m || ''; e.classList.toggle('hidden', !m); };
  let o, conns = [], kinds = [], adm = null;
  const admin = auth.can('freewill.admin'), mayAdd = auth.can('connections.use'), manager = auth.can('connections.manage');
  const load = async () => {
    forget();
    const [a, c, p, s, ov] = await Promise.all([options(null, true), mayAdd ? getJSON('/api/connections') : null, mayAdd ? getJSON('/api/providers') : null,
      admin ? getJSON('/api/settings') : null, admin ? getJSON('/api/voice/overview') : null]);
    o = a; conns = (c?.connections || []).filter(x => x.kind === 'voice'); kinds = p?.kinds || [];
    adm = admin ? { settings: s.settings, overview: ov } : null;
  };
  try { await load(); } catch (e) { body.innerHTML = `<p class="hint">Couldn't read the voice settings: ${esc(e.message)}</p>`; return; }
  const kind = kinds.find(k => k.id === 'voice'), provs = kind?.providers || {};
  const form = { provider: 'openai', open: false };

  function render() {
    const p = o.prefs, sp = p.speak, li = p.listen;
    const mine = conns.filter(c => c.level === 'manage');
    body.innerHTML = `<div class="aform vs">
      <div class="tier-head">🎙️ Listening — your voice to text</div>
      <p class="hint">For 🎤 dictation and 🎧 voice mode in the chat. Now: <b>${esc(describe(o.listen, 'listen'))}</b>${o.listen.reason && o.listen.reason !== 'choice' ? ` (${esc(REASON[o.listen.reason] || o.listen.reason)})` : ''}.</p>
      <label>Who listens<span class="row"><select class="input vs-listen">${serviceOptions(o, 'listen', li.connection, `Automatic — ${platformOf(o, 'listen') ? `the world's (${platformOf(o, 'listen').label})` : 'the browser'}`)}</select></span></label>
      <label>The language you speak<span class="row"><select class="input vs-lang">${LANGS.map(([v, t]) => `<option value="${v}"${(li.language || '') === v ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></span></label>
      ${can.recognize() ? '' : '<p class="hint warn">This browser has no speech recognition of its own: choose a voice service to dictate and talk here (Chrome, Edge and Safari have one).</p>'}
      <div class="tier-head">🔊 Speaking — your agents' voice</div>
      <p class="hint">For 🔊 read aloud and 🎧 voice mode. An agent with a voice of its own (Agent Studio → Brain → Its voice) speaks with it; the others with this. Now: <b>${esc(describe(o.speak, 'speak'))}</b>${o.speak.reason && o.speak.reason !== 'choice' ? ` (${esc(REASON[o.speak.reason] || o.speak.reason)})` : ''}.</p>
      <label>Who speaks<span class="row"><select class="input vs-speak">${serviceOptions(o, 'speak', sp.connection, `Automatic — ${platformOf(o, 'speak') ? `the world's (${platformOf(o, 'speak').label})` : 'the browser\'s own voice'}`)}</select></span></label>
      <label class="vs-voice-l${typeof sp.connection === 'number' ? '' : ' hidden'}">Its voice<span class="row"><select class="input vs-voice"></select></span></label>
      <label class="check"><input type="checkbox" class="vs-unique"${sp.unique === false ? '' : ' checked'}> Every agent its own voice — one is picked for each (its character's, none the same while there are enough); change it in its Agent Studio</label>
      <label>Speed<span class="row"><input type="range" class="vs-speed" min="0.5" max="2" step="0.05" value="${sp.speed || 1}" aria-label="Speed"><b class="vs-speed-v">${(sp.speed || 1).toFixed(2).replace(/0$/, '')}×</b></span></label>
      ${can.synth() ? `<label>The browser's own voice (when the browser speaks)<span class="row"><select class="input vs-bvoice"><option>Loading…</option></select></span></label>` : '<p class="hint">This browser can\'t speak by itself: with no voice service, answers are shown, not read.</p>'}
      <div class="row"><button type="button" class="btn small vs-try">▶ Hear it</button><span class="hint vs-try-out" aria-live="polite"></span></div>
      ${mayAdd ? `<div class="tier-head">🔌 Your own voice service</div>
        <p class="hint">Bring your own: OpenAI, OpenRouter, ElevenLabs, Groq, Google Cloud, Deepgram, xAI, Qwen, or any OpenAI-compatible server. Its key stays sealed on the server; you pay the service, and it is never limited by a plan.</p>
        ${mine.length ? `<div class="conn-list">${mine.map(c => `<div class="conn" data-id="${c.id}"><div class="conn-head"><span class="dot ${!c.status ? 'idle' : c.status.ok ? 'ok' : 'bad'}" aria-hidden="true"></span><b>${esc(c.label)}</b>
          <span class="tag">${esc(provs[c.config?.provider]?.label || c.config?.provider || '')}</span><span class="tag">${c.scope === 'installation' ? 'Shared' : 'Yours'}</span>${c.enabled ? '' : '<span class="tag">Off</span>'}</div>
          ${c.status && !c.status.ok && c.status.error ? `<div class="hint">${esc(c.status.error)}</div>` : ''}
          <div class="row wrap"><button type="button" class="btn small vs-c-test">Test</button><button type="button" class="btn small danger vs-c-del">Remove</button></div><div class="hint vs-c-out hidden" aria-live="polite"></div></div>`).join('')}</div>` : ''}
        <details class="vs-add"${form.open ? ' open' : ''}><summary>➕ Add a voice service</summary><form class="aform vs-form" autocomplete="off">
          <label>Service<span class="row"><select class="input vs-f-prov">${Object.entries(provs).map(([k, v]) => `<option value="${k}"${form.provider === k ? ' selected' : ''}>${esc(v.label)}</option>`).join('')}</select></span></label>
          <p class="hint vs-f-hint"></p>
          <label><span class="vs-f-key-l">API key</span><input class="input mono vs-f-key" type="password" autocomplete="new-password" spellcheck="false" maxlength="4000" placeholder="paste it — it is never shown again"></label>
          <label class="vs-f-url-l">${manager ? 'Address (https, or http for a server on this network)' : 'Address (https)'}<input class="input mono vs-f-url" maxlength="300" spellcheck="false" placeholder="https://my-voice-server.example.com/v1"></label>
          <label class="vs-f-does-l">What it does<span class="row"><select class="input vs-f-does"><option value="both">Listens and speaks</option><option value="speak">Speaks only (text to speech, like Kokoro)</option><option value="listen">Listens only (speech to text, like Whisper)</option></select></span></label>
          <label>Name<input class="input vs-f-label" maxlength="60" placeholder="My voice"></label>
          <details><summary class="hint">Models and voice (optional: each service has good defaults)</summary>
            <label>Speaking model<input class="input mono vs-f-sm" maxlength="200" spellcheck="false"></label>
            <label>Voice<input class="input mono vs-f-voice" maxlength="200" spellcheck="false"></label>
            <label>Listening model<input class="input mono vs-f-lm" maxlength="200" spellcheck="false"></label></details>
          ${manager ? '<label>For<span class="row"><select class="input vs-f-scope"><option value="account">Only me</option><option value="installation">Everyone here (to choose as the world\'s voice below)</option></select></span></label>' : ''}
          <label class="check"><input type="checkbox" class="vs-f-use" checked> Use it to listen and speak for me</label>
          <div class="row end"><button type="submit" class="btn primary">🔌 Add and test it</button></div><p class="hint vs-f-out" aria-live="polite"></p></form></details>` : ''}
      ${adm ? adminHtml() : ''}</div>`;
    wire();
  }

  function adminHtml() {
    const S = p => adm.settings.find(x => x.path === p), ov = adm.overview;
    const inst = conns.filter(c => c.scope === 'installation' && c.enabled);
    const pick = (cls, path, what) => `<select class="input ${cls}"><option value="">None (the browser's own)</option>${inst.filter(c => (c.voice ? c.voice[what] : provs[c.config?.provider]?.[what])).map(c => `<option value="${c.id}"${String(S(path)?.value || '') === String(c.id) ? ' selected' : ''}>${esc(c.label)} (${esc(provs[c.config?.provider]?.label || '')})</option>`).join('')}</select>`;
    const on = S('voice.enabled')?.value !== false;
    const sel = (cls, path, fmt = x => x) => { const s = S(path); return `<select class="input ${cls}">${s.values.map(v => `<option value="${v}"${String(v) === String(s.value) ? ' selected' : ''}>${fmt(v)}</option>`).join('')}</select>`; };
    return `<div class="tier-head">🏢 The world's voice — everyone without their own</div>
      <p class="hint">One service listens and one speaks for every account that hasn't chosen its own. Add services above (For: Everyone here) or in Settings → Connections.</p>
      <p><span class="tag${on ? ' set' : ''}">${on ? 'On' : 'Off'}</span> <span class="tag">Listens: ${esc(ov.installation.listen || 'the browser')}</span> <span class="tag">Speaks: ${esc(ov.installation.speak || 'the browser')}</span></p>
      <div class="row wrap"><button type="button" class="btn small${on ? '' : ' primary'} vs-a-switch">${on ? 'Switch the world\'s voice off' : 'Switch the world\'s voice on'}</button></div>
      <label>The service that listens (speech to text)<span class="row">${pick('vs-a-listen', 'voice.listenConnection', 'listen')}</span></label>
      <label>The service that speaks (text to speech)<span class="row">${pick('vs-a-speak', 'voice.speakConnection', 'speak')}</span></label>
      <label>Most voice requests one account makes in a minute<span class="row">${sel('vs-a-min', 'voice.perMinute')}</span></label>
      <label>Most the world's voice spends in a day, all accounts (US$)<span class="row">${sel('vs-a-day', 'voice.dailyUsd', x => `$${x}`)}</span></label>
      <div class="tier-head">Today (UTC)</div>
      <div class="kv"><span class="k">Requests</span><span>${ov.calls} · ${ov.cached} replayed · ${ov.failed} failed</span>
        <span class="k">Talked and heard</span><span>${minutes(ov.seconds)} min ${Math.round(ov.seconds % 60)} s</span>
        <span class="k">Cost</span><span>$${(ov.micro / 1e6).toFixed(ov.micro < 1e6 ? 4 : 2)} of $${(ov.dailyLimitMicro / 1e6).toFixed(0)}</span>
        <span class="k">The browser instead</span><span>${ov.browser}</span>
        <span class="k">Now</span><span>${ov.inFlight} in progress${ov.waiting ? ` · ${ov.waiting} waiting` : ''}</span></div>
      <div class="row"><button type="button" class="btn small vs-a-refresh">Refresh</button></div>`;
  }

  function wire() {
    const q = s => body.querySelector(s);
    const save = async (patch, msg) => {
      err('');
      try { o.prefs = await post('/api/voice/prefs', patch); forget(); app?.toast?.(msg, 'good'); o = await options(null, true); render(); }
      catch (e) { if (!e.quiet) err(e.message); }
    };
    q('.vs-listen').onchange = e => save({ listen: { connection: toChoice(e.target.value) } }, 'Listening saved');
    q('.vs-lang').onchange = e => save({ listen: { language: e.target.value } }, 'Language saved');
    q('.vs-speak').onchange = e => save({ speak: { connection: toChoice(e.target.value), voice: '' } }, 'Speaking saved');
    q('.vs-unique').onchange = e => save({ speak: { unique: e.target.checked } }, e.target.checked ? 'Every agent speaks with its own voice' : 'Your agents speak with your voice');
    const sp = o.prefs.speak;
    if (typeof sp.connection === 'number') { const v = q('.vs-voice'); voiceOptions(v, sp.connection, sp.voice, o.services.find(s => s.id === sp.connection)?.voice); v.onchange = () => save({ speak: { voice: v.value } }, 'Voice saved'); }
    const sr = q('.vs-speed'), sv = q('.vs-speed-v');
    let st = null;
    sr.oninput = () => { sv.textContent = `${Number(sr.value).toFixed(2).replace(/0$/, '')}×`; clearTimeout(st); st = setTimeout(() => save({ speak: { speed: Number(sr.value) } }, 'Speed saved'), 600); };
    const bv = q('.vs-bvoice');
    if (bv) { browserVoiceOptions(bv, o.prefs.browserVoice); bv.onchange = () => save({ browserVoice: bv.value }, 'The browser\'s voice saved'); }
    q('.vs-try').onclick = () => preview(q('.vs-try-out'), { service: toChoice(q('.vs-speak').value) ?? 'auto', voice: q('.vs-voice')?.value || sp.voice, speed: Number(sr.value), browserVoice: bv?.value || '',
      text: 'Hi! This is how your agents sound when they read aloud and talk with you.' });
    // your own services
    body.querySelectorAll('.vs .conn').forEach(el => {
      const id = Number(el.dataset.id), out = el.querySelector('.vs-c-out');
      el.querySelector('.vs-c-test').onclick = async () => {
        out.classList.remove('hidden'); out.textContent = 'Testing…';
        try { const r = await post('/api/connections/test', { id }); out.textContent = r.ok === false ? `✗ ${r.error || 'Not working'}` : `✓ ${r.detail || 'Working'}`; } catch (e) { out.textContent = `✗ ${e.message}`; }
      };
      el.querySelector('.vs-c-del').onclick = async () => {
        if (!confirm('Remove this voice service? Whatever used it goes back to automatic.')) return;
        try { await post('/api/connections/remove', { id }); await load(); render(); } catch (e) { if (!e.quiet) err(e.message); }
      };
    });
    const f = q('.vs-form');
    if (f) {
      const prov = f.querySelector('.vs-f-prov');
      const hint = () => {
        const v = provs[prov.value] || {}, own = prov.value === 'custom';
        f.querySelector('.vs-f-hint').innerHTML = own ? `A server with OpenAI's audio API (Kokoro, Speaches, vLLM, LocalAI…): its address ends in /v1; say below what it does${manager ? '' : '. Yours must be a public https address'}`
          : `${v.speak && v.listen ? 'Listens and speaks' : v.speak ? 'Speaks only' : 'Listens only'}${v.voice ? ` · its usual voice: ${esc(v.voice)}` : ''}${v.docs ? ` · <a href="${esc(v.docs)}" target="_blank" rel="noopener">its documentation</a>` : ''}`;
        f.querySelector('.vs-f-url-l').classList.toggle('hidden', !(own || prov.value === 'qwen'));
        // (a server of one's own: what it does, and maybe no key; an administrator's may be on this network)
        f.querySelector('.vs-f-does-l').classList.toggle('hidden', !own);
        f.querySelector('.vs-f-key-l').textContent = own ? 'API key (leave it empty if the server has none)' : 'API key';
        f.querySelector('.vs-f-url').placeholder = prov.value === 'qwen' ? 'https://dashscope-intl.aliyuncs.com (your region\'s address)' : manager ? 'https://… or http://my-pc:8880/v1' : 'https://my-voice-server.example.com/v1';
        f.querySelector('.vs-f-label').placeholder = `My ${v.label || 'voice'}`;
        form.provider = prov.value;
      };
      prov.onchange = hint; hint();
      q('.vs-add').ontoggle = e => { form.open = e.target.open; };
      f.onsubmit = async e => {
        e.preventDefault(); err('');
        const out = f.querySelector('.vs-f-out'), key = f.querySelector('.vs-f-key').value.trim(), v = provs[prov.value] || {};
        if (!key && prov.value !== 'custom') { out.textContent = 'Paste the API key from the service.'; return; }
        const config = { provider: prov.value };
        for (const [cls, k] of [['.vs-f-url', 'baseUrl'], ['.vs-f-sm', 'speakModel'], ['.vs-f-voice', 'voice'], ['.vs-f-lm', 'listenModel']]) { const x = f.querySelector(cls).value.trim(); if (x) config[k] = x; }
        if (prov.value === 'custom') config.does = f.querySelector('.vs-f-does').value;
        const speaks = !!v.speak && (config.does || 'both') !== 'listen', listens = !!v.listen && (config.does || 'both') !== 'speak';
        const label = f.querySelector('.vs-f-label').value.trim() || `My ${v.label || 'voice'}`;
        const scope = f.querySelector('.vs-f-scope')?.value || 'account';
        out.textContent = 'Adding…';
        let id;
        try { id = (await post('/api/connections', { kind: 'voice', label, scope, config, secrets: key ? { apiKey: key } : {} })).id; }
        catch (x) { out.textContent = `✗ ${x.message}`; return; }
        out.textContent = 'Testing it (it says "Hello." and hears half a second of silence)…';
        let ok = false;
        try { const r = await post('/api/connections/test', { id }); ok = r.ok !== false; out.textContent = ok ? `✓ ${r.detail || 'It works'}` : `✗ ${r.error || 'It doesn\'t work yet'}${r.fix ? ` — ${r.fix}` : ''}`; }
        catch (x) { out.textContent = `✗ ${x.message}`; }
        if (ok && f.querySelector('.vs-f-use').checked && scope === 'account') {
          try { await post('/api/voice/prefs', { ...(listens ? { listen: { connection: id } } : {}), ...(speaks ? { speak: { connection: id, voice: '' } } : {}) }); } catch (x) { err(x.message); }
        }
        form.open = !ok;
        await load(); render();
        app?.toast?.(ok ? `${label} added${f.querySelector('.vs-f-use')?.checked && scope === 'account' ? ` — it ${listens && speaks ? 'listens and speaks' : speaks ? 'speaks' : 'listens'} for you now` : ''}` : `${label} added, but its test failed`, ok ? 'good' : 'bad', 4200);
      };
    }
    // the world's voice (administrators)
    if (adm) {
      const change = async (values, msg) => {
        try { await auth.call('/api/settings', { values }); app?.toast?.(msg, 'good'); await load(); render(); }
        catch (e) { if (e.code !== 'reauth_required') err(e.message); }
      };
      const on = adm.settings.find(x => x.path === 'voice.enabled')?.value !== false;
      q('.vs-a-switch').onclick = () => change({ 'voice.enabled': !on }, on ? 'The world\'s voice is off' : 'The world\'s voice is on');
      q('.vs-a-listen').onchange = e => change({ 'voice.listenConnection': e.target.value || null }, 'The listening service saved');
      q('.vs-a-speak').onchange = e => change({ 'voice.speakConnection': e.target.value || null }, 'The speaking service saved');
      q('.vs-a-min').onchange = e => change({ 'voice.perMinute': e.target.value }, 'Limit saved');
      q('.vs-a-day').onchange = e => change({ 'voice.dailyUsd': e.target.value }, 'Limit saved');
      q('.vs-a-refresh').onclick = async () => { await load(); render(); };
    }
  }
  render();
}

// ------------------------------------------------------------------------------------------------ Agent Studio: its voice
/** "Its voice" in the Brain tab, painted into `el` (whoever manages the agent; the server checks). */
export async function agentVoiceSection(C, el) {
  let o;
  try { o = await options(C.id, true); } catch (e) { el.innerHTML = `<div class="st-sec-h"><h4>🔊 Its voice</h4></div><p class="hint">${esc(e.message)}</p>`; return; }
  if (!el.isConnected) return;
  if (!o.agent?.manage) { el.remove(); return; }
  const v = o.agent.voice, cur = v.connection === null || v.connection === undefined ? 'auto' : String(v.connection);
  const now = o.speak;
  // its voice on whichever service speaks for it now (its own, its owner's default, the world's): chosen here, else
  // one picked for it (the server: of its character's gender, the least used by the other agents)
  const svcId = now.source !== 'browser' ? now.service?.id : null;
  const how = now.source === 'browser' ? '' : now.chosen ? ' — chosen for it' : now.auto ? ' — picked for it, its own among your agents' : '';
  el.innerHTML = `<div class="st-sec-h"><h4>🔊 Its voice</h4><small class="dim">read aloud and voice mode</small></div>
    <p class="hint">${esc(C.name)} speaks with <b>${esc(describe(now, 'speak'))}</b>${esc(how)}${now.reason && now.reason !== 'choice' ? ` — ${esc(REASON[now.reason] || now.reason)}` : ''}.</p>
    <div class="sv-grid">
      ${svcId ? `<label>Voice<select class="input sv-vsel"></select></label>` : ''}
      <label>Voice service<select class="input sv-svc">${serviceOptions(o, 'speak', cur, 'Its owner\'s default (Settings → Voice)')}</select></label>
      <label>Speed <b class="sv-speed-v">${(v.speed || 1).toFixed(2).replace(/0$/, '')}×</b><input type="range" class="sv-speed" min="0.5" max="2" step="0.05" value="${v.speed || 1}" aria-label="Speed"></label>
      ${can.synth() ? '<label>The browser\'s voice (when the browser speaks)<select class="input sv-bvoice"><option>Loading…</option></select></label>' : ''}
    </div>
    <div class="row"><button type="button" class="btn small sv-try">▶ Hear ${esc(C.name)}</button><span class="hint sv-out" aria-live="polite"></span></div>`;
  const q = s => el.querySelector(s);
  const save = async (patch, msg) => {
    const r = await C.call('/api/voice/agent', { agent: C.id, ...patch }, msg);
    if (r) { forget(); agentVoiceSection(C, el); }
  };
  q('.sv-svc').onchange = e => save({ connection: toChoice(e.target.value), voice: '' }, 'Its voice service saved');
  if (svcId) {
    const s = q('.sv-vsel'), chosen = (v.voices || {})[svcId] && !(v.auto || {})[svcId] ? v.voices[svcId] : (v.connection === svcId ? v.voice : '');
    const picked = now.chosen ? '' : now.voice || '';
    voiceOptions(s, svcId, chosen || '', null, `<option value=""${chosen ? '' : ' selected'}>${esc(picked ? `Picked for it: ${picked}` : 'Picked for it')}</option>`)
      .then(() => {
        // the voice by its name a person reads (Heart — American English, female), in the list and in the line above it
        const lv = picked && [...s.options].find(x => x.value === picked); if (lv && s.options[0]) s.options[0].textContent = `Picked for it: ${lv.textContent}`;
        const cv = [...s.options].find(x => x.value && x.value === (now.voice || '')), b = el.querySelector('p.hint b');
        if (cv && b && now.service) b.textContent = `${now.service.label} — ${cv.textContent}`;
      });
    s.onchange = () => save({ for: svcId, voice: s.value }, s.value ? `${C.name}'s voice saved` : `A voice will be picked for ${C.name}`);
  }
  const sr = q('.sv-speed');
  let st = null;
  sr.oninput = () => { q('.sv-speed-v').textContent = `${Number(sr.value).toFixed(2).replace(/0$/, '')}×`; clearTimeout(st); st = setTimeout(() => save({ speed: Number(sr.value) }, 'Its speed saved'), 600); };
  const bv = q('.sv-bvoice');
  if (bv) { browserVoiceOptions(bv, v.browserVoice); bv.onchange = () => save({ browserVoice: bv.value }, 'Its browser voice saved'); }
  q('.sv-try').onclick = () => {
    const svc = q('.sv-svc').value;
    preview(q('.sv-out'), { service: svc === 'auto' ? 'auto' : toChoice(svc), voice: q('.sv-vsel')?.value || now.voice || v.voice, speed: Number(sr.value), browserVoice: bv?.value || v.browserVoice,
      agent: C.id, text: `Hi, I'm ${C.name}. This is how I sound when we talk.` });
  };
}

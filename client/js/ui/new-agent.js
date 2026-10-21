// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// New agent (2026-10-12, the product owner: "when a user clicks new agent there should be an option of selecting Built-in
// Agent … [and] 3rd Party Agents: Grok Bot, OpenAI Dot, Meta Muse … the creation steps should go from there … all the way
// until it ends up in the Agent Studio"). Every ➕ New agent button opens this one dialog: choose the kind of agent, then
// its steps. A built-in agent gets a name and moves in; a third-party agent gets a name, then the app's own few steps
// (client/js/core/agent-app-steps.js), and the dialog waits until the app has signed in as it. Both end in the agent's Studio.
// An agent made for an app that hasn't connected yet waits ("Not connected yet"): Settings → Third-party agents and the
// app's own sign-in page offer it, and this dialog can be opened again at its connect step.
// Answering while its owner is away (optional, for an app that can be started from a web address: Grok Bot): the app
// makes its own wake-up routine from one message; its owner pastes the routine's address and header back once (only
// they can see them), and the dialog saves the link, calls it, and waits to see the agent check in. Its Studio opens
// this step too (Brain → Its connection → Wake-up link → Set it up step by step).
import { auth } from '../core/auth.js';
import { bus } from '../core/state.js';
import { getJSON, post } from '../core/net.js';
import { load as reloadAgents } from '../core/agents.js';
import { esc } from '../core/util.js';
import { authDialog } from './account.js';
import { agentApp, appsNotice } from '/shared/agent-apps.js';
import { AGENT_APP_STEPS, fillAgentApp, readWakePaste } from '../core/agent-app-steps.js';

const POLL_MS = 3000;
const CHECKIN_MS = 150000;   // how long the wake-up step waits to see the agent check in after its first call
// (each agent has its own MCP address, <world>/mcp/a/<handle>: an app sees one server per agent, so a Grok account's
// bots - which share their connectors - never sign in as each other; the world's /mcp stays for any agent)
const mcpUrl = slot => `${location.origin}${slot?.mcpPath || '/mcp'}`;

/** The logo of a third-party app, on its own coloured tile. */
export const appLogo = (a, size = 'md') => `<span class="na-logo na-${size}" style="background:${esc(a.tile)}"><img src="${esc(a.logo)}" alt="" draggable="false"></span>`;

/** Which kinds the account may make here: built-in agents (agents.manage), third-party agents (agents.connect). */
export const canMakeAgents = () => auth.can('agents.manage') || auth.can('agents.connect');

/** Whether an app's agent can be started from a web address, with steps for it here (its wake-up link). */
export const appWakes = id => !!AGENT_APP_STEPS[id]?.wakeup;

/**
 * Opens the New agent dialog. opts.slot: an agent made for an app earlier and not connected yet (Settings → Third-party
 * agents → Finish connecting): it opens at that agent's connect step; with opts.step 'wakeup' (a connected agent, from its
 * Studio): at its wake-up step.
 */
export function openNewAgent(app, { slot = null, step = null } = {}) {
  const builtIn = auth.can('agents.manage'), thirdParty = auth.can('agents.connect');
  if (!builtIn && !thirdParty) return;
  const d = authDialog('newagent', 'New agent', `<div class="na">
      <ol class="na-steps" aria-label="Steps"></ol>
      <div class="na-body"></div>
      <p class="err hidden" role="alert"></p>
    </div>`, { wide: true });
  const body = d.q('.na-body'), steps = d.q('.na-steps');
  const err = m => { const e = d.q('.err'); e.textContent = m || ''; e.classList.toggle('hidden', !m); };
  let timer = null, closed = false;
  const stopPoll = () => { clearTimeout(timer); timer = null; };
  d.done.then(() => { closed = true; stopPoll(); });
  // the apps this person may choose (the admin's Settings → Agent limits; one offered to admins only says so)
  const choices = thirdParty ? getJSON('/api/agent-slots').then(r => Array.isArray(r?.apps) ? r.apps : [], () => []) : Promise.resolve([]);

  // the step bar: what this kind of agent goes through, and where we are
  const bar = (kind, at) => {
    const list = kind === 'app' ? ['Choose', 'Name it', 'Connect it', 'Agent Studio'] : kind === 'app-wake' ? ['Choose', 'Name it', 'Connect it', 'Answer while away', 'Agent Studio']
      : ['Choose', 'Name it', 'Agent Studio'];
    steps.innerHTML = list.map((t, i) => `<li class="${i < at ? 'done' : i === at ? 'on' : ''}"${i === at ? ' aria-current="step"' : ''}><span>${i + 1}</span>${esc(t)}</li>`).join('');
  };

  // ------------------------------------------------------------------ 1 · choose
  const choose = async () => {
    stopPoll(); err(''); bar(null, 0);
    const offered = await choices;
    if (closed) return;
    const apps = offered.map(c => ({ ...agentApp(c.id), offer: c.offer })).filter(a => a.id);
    body.innerHTML = `
      ${builtIn ? `<button type="button" class="na-kind na-builtin" data-kind="builtin">
        <span class="na-logo na-md na-mvw"><img src="/img/brand/mvw-mark.webp" alt="" draggable="false"></span>
        <span class="na-kt"><b>Built-in agent</b><small>Lives in the world with the world's own brain. You give it a name, a look and a personality.</small></span>
        <span class="na-go" aria-hidden="true">›</span></button>` : ''}
      ${thirdParty ? `<h4 class="na-h">Third-party agents</h4>
        <p class="hint">An AI app you already use moves in as your agent: it thinks with its own AI, on your plan there.</p>
        ${apps.length ? `<div class="na-apps">${apps.map(a => `<button type="button" class="na-kind na-app" data-app="${esc(a.id)}">
          ${appLogo(a)}<span class="na-kt"><b>${esc(a.name)}${a.offer === 'admins' ? ' <span class="na-tag" title="Only admins see it while it is tested (Settings → Agent limits)">Admins only · testing</span>' : ''}</b><small>Needs ${esc(a.needs)}</small></span><span class="na-go" aria-hidden="true">›</span></button>`).join('')}</div>` : ''}
        <p class="hint na-other">Another AI, or a program of your own? <button type="button" class="linkbtn na-adv">Advanced connection</button></p>
        ${apps.length ? `<p class="dim na-notice">${esc(appsNotice(apps))}</p>` : ''}` : ''}`;
    body.onclick = e => {
      const k = e.target.closest('.na-kind');
      if (k) return k.dataset.kind === 'builtin' ? builtinName() : appName(agentApp(k.dataset.app));
      if (e.target.closest('.na-adv')) { d.close(false); import('./settings.js').then(m => m.open(app, 'agents')); }
    };
  };

  // ------------------------------------------------------------------ built-in · name it
  const builtinName = () => {
    err(''); bar('builtin', 1);
    body.innerHTML = `<form class="aform na-form">
        <div class="na-head"><span class="na-logo na-md na-mvw"><img src="/img/brand/mvw-mark.webp" alt="" draggable="false"></span><div><b>Built-in agent</b><p class="hint">It moves into town with a home and a desk.</p></div></div>
        <label>Name<input class="input na-name" maxlength="32" placeholder="What to call it" required></label>
        <div class="row"><label class="na-emoji-l">Emoji<input class="input na-emoji" maxlength="8" placeholder="🤖"></label>
          <label class="grow">Role<input class="input na-role" maxlength="60" placeholder="e.g. Barista, Researcher"></label></div>
        <div class="row end"><button type="button" class="btn na-back">Back</button><button type="submit" class="btn primary">Create and open its Studio</button></div></form>`;
    body.onclick = e => { if (e.target.closest('.na-back')) choose(); };
    const f = body.querySelector('form');
    f.querySelector('.na-name').focus();
    f.onsubmit = async ev => {
      ev.preventDefault();
      const name = f.querySelector('.na-name').value.trim();
      if (!name) return err('Give the agent a name');
      err(''); d.busy(true);
      try {
        const a = await auth.call('/api/agents', { name, emoji: f.querySelector('.na-emoji').value.trim(), role: f.querySelector('.na-role').value.trim() });
        app?.toast?.(`${a.name} is moving into town`, 'good');
        await reloadAgents().catch(() => {});   // (its Studio opens from the agent list: it has to be in it first)
        bus.emit('agentlist');
        d.close(true);
        if (a.id) bus.emit('openstudio', a.id);
      } catch (x) { d.busy(false); if (!x.quiet) err(x.message); }
    };
  };

  // ------------------------------------------------------------------ third-party · name it
  const appName = async a => {
    err(''); bar('app', 1);
    if (closed) return;
    body.innerHTML = `<form class="aform na-form">
        <div class="na-head">${appLogo(a)}<div><b>${esc(a.name)}</b><p class="hint">Your ${esc(a.name)} lives here as this agent. You'll need ${esc(a.needs)}.</p></div></div>
        <label>Your agent's name in the world<input class="input na-name" maxlength="40" placeholder="e.g. ${esc(a.name === 'Grok Bot' ? 'Nova' : a.name === 'OpenAI Dot' ? 'Dot' : 'Muse')}" required></label>
        <div class="row end"><button type="button" class="btn na-back">Back</button><button type="submit" class="btn primary">Next: connect it</button></div></form>`;
    body.onclick = e => { if (e.target.closest('.na-back')) choose(); };
    const f = body.querySelector('form');
    f.querySelector('.na-name').focus();
    f.onsubmit = async ev => {
      ev.preventDefault();
      const name = f.querySelector('.na-name').value.trim();
      if (!name) return err('Give the agent a name');
      err(''); d.busy(true);
      try {
        const r = await post('/api/agent-slots', { name, app: a.id });
        bus.emit('agentlist');
        d.busy(false);
        connect(a, r.slot);
      } catch (x) { d.busy(false); if (!x.quiet) err(x.message); }
    };
  };

  // ------------------------------------------------------------------ third-party · connect it (and wait)
  const copy = async (btn, text) => {
    try { await navigator.clipboard.writeText(text); const was = btn.textContent; btn.textContent = 'Copied ✓'; setTimeout(() => { btn.textContent = was; }, 1600); }
    catch {
      // (plain http or no permission: the text is shown selected, to copy by hand)
      const box = btn.closest('.na-copy').querySelector('.na-text');
      if (box) { box.focus(); box.select(); }
      err('Your browser did not allow copying: the text is selected, copy it by hand');
    }
  };
  const connect = (a, slot) => {
    err(''); bar(appWakes(a.id) ? 'app-wake' : 'app', 2);
    const fill = t => fillAgentApp(t, { name: slot.name, url: mcpUrl(slot) });
    const how = AGENT_APP_STEPS[a.id];
    const message = fill(how.message);
    body.innerHTML = `<div class="na-connect">
        <div class="na-head">${appLogo(a)}<div><b>Connect ${esc(slot.name)} to ${esc(a.name)}</b><p class="hint">Do these steps in ${esc(a.name)}. This window waits and moves on by itself.</p></div></div>
        <ol class="na-how">${how.steps.map(s => `<li>${esc(fill(s))}</li>`).join('')}</ol>
        <div class="na-copy code-box"><b>The message for ${esc(a.name)}</b>
          <textarea class="input na-text" readonly rows="4" aria-label="The message to send">${esc(message)}</textarea>
          <div class="row wrap"><button type="button" class="btn primary small na-copy-msg">Copy the message</button></div></div>
        <div class="na-copy code-box"><b>${esc(slot.name)}'s own address</b> <span class="hint">(if ${esc(a.name)} asks for it: each agent has its own)</span>
          <input class="input mono na-text" readonly value="${esc(mcpUrl(slot))}" aria-label="Its address">
          <div class="row wrap"><button type="button" class="btn small na-copy-url">Copy the address</button></div></div>
        <div class="na-wait" role="status" aria-live="polite"><span class="na-spin" aria-hidden="true"></span><span class="na-wait-t">Waiting for ${esc(a.name)} to sign in as ${esc(slot.name)}…</span></div>
        <div class="row wrap end"><button type="button" class="btn small danger na-remove">Remove ${esc(slot.name)}</button><span class="grow"></span>
          <button type="button" class="btn na-later">I'll finish later</button></div></div>`;
    body.onclick = async e => {
      if (e.target.closest('.na-copy-msg')) return copy(e.target.closest('button'), message);
      if (e.target.closest('.na-copy-url')) return copy(e.target.closest('button'), mcpUrl(slot));
      if (e.target.closest('.na-later')) { app?.toast?.(`${slot.name} waits for ${a.name}: finish in Settings → Third-party agents`); return d.close(false); }
      if (e.target.closest('.na-approve')) {
        try { await post('/api/agent-slots/approve', { id: slot.id }); poll(); } catch (x) { if (!x.quiet) err(x.message); }
        return;
      }
      if (e.target.closest('.na-remove')) {
        if (!confirm(`Remove ${slot.name}? It was never connected, so nothing else is lost.`)) return;
        try { await post('/api/agent-slots/remove', { id: slot.id }); bus.emit('agentlist'); app?.toast?.(`${slot.name} removed`); d.close(false); }
        catch (x) { if (!x.quiet) err(x.message); }
      }
    };
    const wait = body.querySelector('.na-wait-t');
    const poll = async () => {
      stopPoll();
      if (closed) return;
      try {
        const s = (await getJSON('/api/agent-slots')).agents.find(x => x.id === slot.id);
        if (closed) return;
        if (!s) return d.close(false);   // (removed in another window)
        if (s.status === 'active' && s.approval === 'approved') return done(a, s);
        if (s.status === 'active' && s.approval === 'waiting') {
          // (joined with a code from the kit instead: its owner's OK first, as in Settings)
          wait.innerHTML = `An AI joined with the key <code>${esc(String(s.fingerprint || '').slice(0, 16))}</code>. If that is your ${esc(a.name)}, <button type="button" class="btn small primary na-approve">Approve it</button>`;
        }
      } catch { /* (a dropped connection: the next look tries again) */ }
      timer = setTimeout(poll, POLL_MS);
    };
    poll();
  };

  // ------------------------------------------------------------------ done → (answer while away) → its Studio
  const done = (a, s) => {
    stopPoll(); err('');
    if (appWakes(a.id)) return wakeStep(a, s);
    bar('app', 3);
    body.innerHTML = `<div class="na-done">${appLogo(a, 'lg')}<h4>✅ ${esc(s.name)} is connected</h4>
      <p class="hint">${esc(a.name)} lives in the world as ${esc(s.name)} now. Opening its Studio: give it a look, a home and a job.</p></div>`;
    openStudio(s);
  };
  // (once: a button pressed while it is about to open on its own opens it now)
  let studio = null, studioTimer = null, went = false;
  const openStudio = async (s, { wait = 1200 } = {}) => {
    const go = () => { if (went || closed) return; went = true; clearTimeout(studioTimer); d.close(true); bus.emit('openstudio', studio.id); };
    if (studio) { if (!wait) go(); return; }
    bus.emit('agentlist');
    // the agent record follows the slot (server/agent-bridge.js): find it by its key, then open its Studio
    for (let i = 0; i < 6 && !closed; i++) {
      try {
        const rec = (await getJSON('/api/agents')).agents.find(x => x.key === `ext-${s.id}`);
        if (rec) { await reloadAgents().catch(() => {}); if (studio) return; studio = rec; studioTimer = setTimeout(go, wait); return; }
      } catch { /* try again */ }
      await new Promise(r => setTimeout(r, 800));
    }
    if (!closed) body.insertAdjacentHTML('beforeend', '<div class="row end"><button type="button" class="btn primary cancel">Close</button></div>');
    for (const b of body.querySelectorAll('.cancel')) b.onclick = () => d.close(true);
  };

  // ------------------------------------------------------------------ third-party · answer while away (optional)
  const wakeStep = (a, s, { fromStudio = false } = {}) => {
    stopPoll(); err(''); bar('app-wake', 3);
    const how = AGENT_APP_STEPS[a.id].wakeup, fill = t => fillAgentApp(t, { name: s.name, url: mcpUrl(s) }), message = fill(how.message);
    const had = s.wakeUp?.set ? s.wakeUp : null;
    let got = { url: '', key: '', header: '' }, saving = false;
    body.innerHTML = `<div class="na-wake" data-testid="na-wake">
        ${fromStudio ? `<div class="na-ok">${appLogo(a)}<b>${esc(s.name)}'s wake-up link</b></div>`
          : `<div class="na-ok">${appLogo(a)}<b>✅ ${esc(s.name)} is connected</b></div>`}
        <h4>Let ${esc(s.name)} answer while you're away <span class="dim">(optional, about 2 minutes)</span></h4>
        <p class="hint">${esc(a.name)} only thinks while it runs. With a wake-up routine, the world starts it whenever someone writes to ${esc(s.name)}, so it answers even when you're not chatting with it. Each start uses your ${esc(a.name)} plan.</p>
        ${had ? `<p class="hint">It has one already (${esc(had.host || '')}${had.paused ? ', paused' : ''}): what you paste here replaces it.</p>` : ''}
        <ol class="na-how">${how.steps.map(x => `<li>${esc(fill(x))}</li>`).join('')}</ol>
        <div class="na-copy code-box"><b>The message for ${esc(a.name)}</b>
          <textarea class="input na-text" readonly rows="4" aria-label="The message to send">${esc(message)}</textarea>
          <div class="row wrap"><button type="button" class="btn primary small na-copy-msg">Copy the message</button></div></div>
        ${how.ask ? `<div class="na-copy code-box na-ask"><b>No links in its answer, or made the routine earlier?</b> <span class="hint">Send it this, in the ${esc(a.name)} app on your computer (the phone app can't open the links):</span>
          <textarea class="input na-text" readonly rows="2" aria-label="The message that asks for the links">${esc(fill(how.ask))}</textarea>
          <div class="row wrap"><button type="button" class="btn small na-copy-ask">Copy this message</button></div></div>` : ''}
        <div class="na-paste code-box"><b>Paste the routine's POST to and header here</b> <span class="hint">(one after the other)</span>
          <textarea class="input mono na-text na-wk-paste" rows="2" spellcheck="false" autocomplete="off" aria-label="Paste the routine's address and header" placeholder="https://…&#10;Authorization: Bearer …"></textarea>
          <div class="na-got" aria-live="polite"></div></div>
        <div class="na-wait hidden" role="status" aria-live="polite"><span class="na-spin" aria-hidden="true"></span><span class="na-wait-t"></span></div>
        <div class="row wrap end"><button type="button" class="btn na-skip">${fromStudio ? 'Close' : 'Skip for now'}</button>
          <button type="button" class="btn primary na-wk-save" disabled>Save and try it</button></div></div>`;
    const q = sel => body.querySelector(sel), box = q('.na-wk-paste'), save = q('.na-wk-save');
    // what was recognised so far, shown as two chips (never the key itself: only its first letters)
    const show = () => {
      const key = got.header ? got.header.replace(/^[^:]+:\s*/, '') : got.key, host = (() => { try { return new URL(got.url).host; } catch { return ''; } })();
      q('.na-got').innerHTML = `<span class="chip${got.url ? ' on' : ''}" data-got="url">${got.url ? `✓ Address · ${esc(host)}` : 'Address (POST to)'}</span>
        <span class="chip${key ? ' on' : ''}" data-got="key">${key ? `✓ Key · ${esc(key.replace(/^Bearer\s+/i, '').slice(0, 5))}…` : 'Header (or key)'}</span>
        ${got.url || key ? '<button type="button" class="linkbtn na-wk-clear">Clear</button>' : ''}`;
      save.disabled = saving || !got.url || !key;
      if (!save.disabled) save.focus();
    };
    const take = text => {
      const r = readWakePaste(text);
      if (!r.url && !r.key && !r.header) return false;
      got = { url: r.url || got.url, key: r.header ? '' : r.key || got.key, header: r.header || (r.key ? '' : got.header) };
      show(); return true;
    };
    box.addEventListener('paste', e => {
      const text = e.clipboardData?.getData('text') || '';
      if (take(text)) { e.preventDefault(); box.value = ''; err(''); }
    });
    // (typed by hand: read when it is complete - Enter or leaving the box - not letter by letter)
    box.addEventListener('input', e => { if (/^insertFrom/.test(e.inputType || '') && take(box.value)) box.value = ''; });
    box.addEventListener('change', () => { if (take(box.value)) box.value = ''; });
    box.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && box.value.trim()) { e.preventDefault(); if (take(box.value)) box.value = ''; } });
    const wait = (text, cls = '') => { const w = q('.na-wait'); w.classList.remove('hidden', 'good', 'bad'); if (cls) w.classList.add(cls); q('.na-spin').classList.toggle('hidden', !!cls); q('.na-wait-t').textContent = text; };
    const finish = () => fromStudio ? d.close(true) : openStudio(s, { wait: 0 });
    body.onclick = async e => {
      if (e.target.closest('.na-copy-msg')) return copy(e.target.closest('button'), message);
      if (e.target.closest('.na-copy-ask')) return copy(e.target.closest('button'), fill(how.ask));
      if (e.target.closest('.na-wk-clear')) { got = { url: '', key: '', header: '' }; show(); box.focus(); return; }
      if (e.target.closest('.na-skip')) {
        if (fromStudio) return d.close(false);
        app?.toast?.(`You can set it later: ${s.name}'s Studio → Brain → Its connection`);
        bar('app-wake', 4); return openStudio(s, { wait: 0 });
      }
      if (e.target.closest('.na-wk-done')) return finish();
      if (!e.target.closest('.na-wk-save') || save.disabled) return;
      saving = true; save.disabled = true; err('');
      try {
        await post('/api/agent-slots/wakeup', { id: s.id, url: got.url, key: got.key, header: got.header });
        wait(`Saved. Calling ${a.name}…`);
        const r = await post('/api/agent-slots/wakeup/test', { id: s.id });
        if (!r.ok) {
          const st = Number(r.status);
          saving = false; show();
          return wait(st === 401 || st === 403 ? `${a.name} refused the key (${st}): copy the header again and paste it here.`
            : st === 404 ? `${a.name} doesn't know that address (404): copy POST to again and paste it here.`
            // (an app that refused for its own reason - Grok Bot's rate limit, 2026-10-13 - says so: what was pasted is fine)
            : r.said && /limit|too many|rate|quota|busy|overload|try again/i.test(r.said) ? `${a.name} refused for now: "${r.said}". That is on ${a.name}'s side, not what you pasted: the link is saved, and the world tries it again next time someone writes to ${s.name}. You can Skip for now.`
            : r.said ? `${a.name} answered ${st}: "${r.said}". Check what you pasted and try again.`
            : `It didn't work: ${r.error || r.status}. Check what you pasted and try again.`, 'bad');
        }
        // it took the call: now see the agent itself check in (its routine ran and used its tools)
        const since = r.wakeUp?.last?.at || 0, t0 = Date.now();
        wait(`${a.name} took the call. Waiting for ${s.name} to wake up and check its messages…`);
        const look = async () => {
          stopPoll(); if (closed) return;
          try {
            const now = (await getJSON('/api/agent-slots')).agents.find(x => x.id === s.id);
            if (now?.lastUse && now.lastUse > since) {
              bar('app-wake', 4);
              wait(`✅ ${s.name} woke up and checked its messages, ${Math.max(1, Math.round((now.lastUse - since) / 1000))} s after the call. From now on it answers while you're away.`, 'good');
              q('.row.end').innerHTML = `<button type="button" class="btn primary na-wk-done">${fromStudio ? 'Done' : 'Open its Studio'}</button>`;
              bus.emit('agentlist');
              if (!fromStudio) openStudio(s, { wait: 4000 });
              return;
            }
          } catch { /* (a dropped connection: the next look tries again) */ }
          if (Date.now() - t0 > CHECKIN_MS) {
            wait(`${a.name} took the call, but ${s.name} hasn't checked in yet. ${a.name} can take a few minutes; if it never does, make sure your Bot saved the routine from the message above. The link is saved.`, 'bad');
            q('.row.end').innerHTML = `<button type="button" class="btn primary na-wk-done">${fromStudio ? 'Close' : 'Open its Studio'}</button>`;
            return;
          }
          timer = setTimeout(look, POLL_MS);
        };
        look();
      } catch (x) { saving = false; show(); if (!x.quiet) err(x.message); q('.na-wait').classList.add('hidden'); }
    };
    show();
  };

  if (slot && agentApp(slot.app) && step === 'wakeup' && appWakes(slot.app)) wakeStep(agentApp(slot.app), slot, { fromStudio: true });
  else if (slot && agentApp(slot.app)) connect(agentApp(slot.app), slot);
  else choose();
  return d.done;
}

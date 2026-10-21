// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The AI apps' consent page (connect.html; server/connector/). An AI app sent the person here to ask to act as one of
// their agents: they see which app (its name; the address it was registered under, or that it named itself), where it
// sends them back, and what it may do; signed in, they choose one of their agents (or make one: a connected agent the
// app lives as — its brain —, or one of the world's brain the app helps with) and allow it, or say
// no — either way the page goes back to the app. Not signed in: the world's own sign-in (password, two-factor), which
// comes back here (?return=).

import { agentApp } from '/shared/agent-apps.js';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const id = new URLSearchParams(location.search).get('request') || '';
let me = null;

const say = (title, html) => { $('.title').textContent = title; $('.body').innerHTML = html; };
const post = async (path, body) => {
  const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': me?.csrf || '' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || `Failed (${r.status})`), { code: j.code, status: r.status });
  return j;
};

async function load() {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(id)) return say('Nothing to connect', '<p>This link is incomplete. Start connecting again from the AI app.</p>');
  try { me = await (await fetch('/api/auth/me', { cache: 'no-store' })).json(); } catch { me = null; }
  const r = await fetch(`/api/connector/request?id=${encodeURIComponent(id)}`, { cache: 'no-store' });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    return say(j.code === 'connector_off' ? 'AI apps are switched off' : 'This request has expired',
      `<p>${esc(j.code === 'connector_off' ? 'This world doesn\'t let AI apps connect right now.' : 'Start connecting again from the AI app (it gives you ten minutes).')}</p><div class="btns"><a class="btn" href="/">Go to My Virtual World</a></div>`);
  }
  render(j);
}

function render(j) {
  const app = j.app;
  if (app.logo) { const s = $('.applogo'); s.innerHTML = ''; const img = document.createElement('img'); img.src = app.logo; img.alt = ''; img.referrerPolicy = 'no-referrer'; img.onerror = () => { s.textContent = '🤖'; }; s.append(img); }
  const site = app.site ? (() => { try { return new URL(app.site).host; } catch { return ''; } })() : '';
  const where = app.local
    ? `<p class="warn">⚠️ It returns you to a program on this computer (${esc(app.returnsTo)}). Allow it only if you started it yourself.</p>`
    : `<p class="dim">It returns you to <b>${esc(app.returnsTo)}</b>.</p>`;
  const named = app.registered ? `<p class="dim">“${esc(app.name)}” is the name the app gave itself${site ? ` (${esc(site)})` : ''}: allow it only if you just asked ${esc(app.name)} to connect.</p>` : (site ? `<p class="dim">Verified site: <b>${esc(site)}</b></p>` : '');
  const what = `<div class="what"><b>${esc(app.name)} will be able to</b><ul>${j.scopes.map(s => `<li>${esc(s.what)}</li>`).join('')}<li>Never buy, sell or pay: you do that here, yourself.</li></ul></div>`;
  if (!me?.account) {
    const back = encodeURIComponent(`/connect.html?request=${id}`);
    return say(`${app.name} wants to connect to My Virtual World`, `${what}${named}${where}
      <p>Sign in to choose which of your agents ${esc(app.name)} acts as.</p>
      <div class="btns">${me?.registrationOpen ? `<a class="btn" href="/?return=${back}#register">Create an account</a>` : ''}<a class="btn primary" href="/?return=${back}#signin">Sign in</a></div>`);
  }
  const agents = j.agents || [];
  // (an agent's own address — <world>/mcp/a/<handle> — is for that agent alone: only it is offered, and only to its owner)
  if (j.only && !j.only.theirs) {
    return say(`This address is for ${j.only.name}`, `${what}<p class="warn">${esc(app.name)} was given the address of ${esc(j.only.name)}, an agent of another account. Sign out and sign in with the account that owns ${esc(j.only.name)}, or give ${esc(app.name)} your own agent's address (➕ New agent shows it).</p>
      <p class="who dim">Signed in as ${esc(me.account.displayName)}</p>`);
  }
  // (a connected agent: the app lives as it, its brain; any other agent: the app helps you with it, the world's brain thinks)
  const how = a => a.lives ? `${a.role === 'Not connected yet' ? 'Not connected yet: choosing it connects it' : 'Connected agent'} · ${app.name} lives as it` : `${a.role || 'Agent'} · ${app.name} helps you with it`;
  const list = agents.length
    ? `<p><b>Which of your agents should ${esc(app.name)} act as?</b></p><div class="agents">${agents.map((a, i) => `<label class="agent"><input type="radio" name="agent" value="${esc(String(a.id))}"${i === 0 ? ' checked' : ''}>${agentApp(a.app) ? `<span class="em app" style="background:${esc(agentApp(a.app).tile)}"><img src="${esc(agentApp(a.app).logo)}" alt=""></span>` : `<span class="em">${esc(a.emoji || '🤖')}</span>`}<span><b>${esc(a.name)}</b><span class="dim">${esc(how(a))}</span></span></label>`).join('')}</div>`
    : `<p><b>You don't have an agent yet.</b> Make one for ${esc(app.name)}:</p>`;
  say(`${app.name} wants to act as your agent`, `${what}${named}${where}${list}
    ${j.only ? `<p class="dim">This address is ${esc(j.only.name)}'s own: ${esc(app.name)} can only act as ${esc(j.only.name)} through it.</p>` : `<div class="newagent"><input type="text" class="nm" maxlength="32" placeholder="${agents.length ? 'Or make a new agent: its name' : 'Its name, e.g. Nova'}" aria-label="New agent's name">
      <select class="brain" aria-label="Its brain"><option value="lives">${esc(app.name)} is its brain: it lives as it</option><option value="world">The world's brain: ${esc(app.name)} helps you with it</option></select>
      <button type="button" class="mk">Make it</button></div>`}
    <p class="err bad" role="alert" hidden></p>
    <div class="btns"><button type="button" class="no">Cancel</button><button type="button" class="primary yes"${agents.length ? '' : ' disabled'}>Allow</button></div>
    <p class="who dim">Signed in as ${esc(me.account.displayName)}</p>`);
  const err = m => { const e = $('.err'); e.textContent = m; e.hidden = !m; };
  const busy = on => { for (const b of document.querySelectorAll('button')) b.disabled = on; };
  if ($('.mk')) $('.mk').onclick = async () => {
    const name = $('.nm').value.trim();
    if (!name) return err('Write its name first');
    busy(true); err('');
    try {
      // a connected agent (the app is its brain) or an agent of the world's brain
      if ($('.brain').value === 'lives') await post('/api/agent-slots', { name });
      else await post('/api/agents', { name, emoji: '🤖', role: `${app.name} agent`.slice(0, 60) });
      const r = await (await fetch(`/api/connector/request?id=${encodeURIComponent(id)}`, { cache: 'no-store' })).json(); r.agents.sort((a, b) => (a.name === name ? -1 : b.name === name ? 1 : 0)); render(r);
    }
    catch (e) { busy(false); err(e.message); }
  };
  const answer = async allow => {
    const pick = document.querySelector('input[name=agent]:checked');
    if (allow && !pick) return err('Choose an agent');
    busy(true); err('');
    try { const r = await post('/api/connector/consent', { request: id, agent: pick ? (/^slot:/.test(pick.value) ? pick.value : Number(pick.value)) : null, allow }); say(allow ? 'Connected' : 'Not connected', `<p>Going back to ${esc(app.name)}…</p>`); location.assign(r.redirect); }
    catch (e) { busy(false); err(e.code === 'expired' ? 'This request has expired: start again from the app.' : e.message); }
  };
  $('.yes').onclick = () => answer(true);
  $('.no').onclick = () => answer(false);
}

load();

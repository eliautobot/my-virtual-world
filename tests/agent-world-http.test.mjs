// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// A connected agent's eyes and hands over HTTP on a real server (server/agent-world.js; 2026-10-10): only its
// own session token opens them (never a browser session, never another agent's), look answers with the city as it is,
// an order is carried out or refused with why, a refusal for going too fast carries retryAfter in its JSON and its
// header, and its mailbox still answers as before (heard lines only when there are some).
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, test } from 'node:test';
import { startServer, ownerSession, userSession } from './helpers/server.mjs';

let s, owner, ann, token, slot;
const makeAgent = () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const pub = publicKey.export({ type: 'spki', format: 'der' }).subarray(12).toString('base64url');
  return { pub, sign: m => crypto.sign(null, Buffer.from(m), privateKey).toString('base64url') };
};
async function agent(method, p, body, { bearer = token } = {}) {
  const h = { ...(bearer ? { authorization: `Bearer ${bearer}` } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) };
  const r = await fetch(new URL(p, s.url), { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: r.status, json, text, headers: r.headers };
}

before(async () => {
  s = await startServer({ population: 150, agents: 2 });
  owner = await ownerSession(s);
  ann = await userSession(s, owner, { login: 'ann', displayName: 'Ann', role: 'member' });
  const made = await ann.post('/api/agent-slots', { name: 'Juno' });
  assert.equal(made.status, 200, made.text);
  slot = made.json.slot.id;
  assert.equal((await ann.post('/api/agent-slots/update', { id: slot, appearInWorld: true, visibility: 'public', chatAudience: 'everyone' })).status, 200);
  const a = makeAgent(), code = made.json.code;
  assert.equal((await agent('POST', '/api/agent-api/enroll', { code, publicKey: a.pub, signature: a.sign(`v1|enrol|${code}|${a.pub}`) }, { bearer: null })).status, 200);
  assert.equal((await ann.post('/api/agent-slots/approve', { id: slot })).status, 200, 'its owner\'s OK');
  const ts = Math.floor(Date.now() / 1000), nonce = crypto.randomBytes(12).toString('base64url');
  const ses = await agent('POST', '/api/agent-api/session', { slot, timestamp: ts, nonce, signature: a.sign(`v1|session|${slot}|${ts}|${nonce}`) }, { bearer: null });
  assert.equal(ses.status, 200, ses.text);
  token = ses.json.token;
});
after(async () => { await s?.stop(); });

test('only the agent\'s own session token opens its eyes and hands: no token, a browser session or a made-up token is refused', async () => {
  assert.equal((await agent('GET', '/api/agent-api/world', undefined, { bearer: null })).status, 401);
  assert.equal((await agent('GET', '/api/agent-api/world', undefined, { bearer: 'mvws_madeup' })).status, 401);
  assert.equal((await ann.get('/api/agent-api/world')).status, 401, 'a browser session is not an agent');
  assert.equal((await ann.post('/api/agent-api/act', { action: 'do', activity: 'jog' })).status, 401);
});

test('its inbox starts with the facts about it right now: the world\'s time, where it is, what it is doing, and the rule (2026-10-12)', async () => {
  let look;
  for (let k = 0; k < 40; k++) {   // (its body appears in the city a moment after enrolling)
    look = await agent('GET', '/api/agent-api/world?brief=1');
    if (look.status === 200) break;
    await new Promise(r => setTimeout(r, 250));
  }
  assert.equal(look.status, 200, look.text);
  const box = await agent('GET', '/api/agent-api/inbox');
  assert.equal(box.status, 200, box.text);
  const you = box.json.you;
  assert.ok(you, 'facts with the inbox, even with nothing waiting');
  assert.equal(Object.keys(box.json)[0], 'you', 'first');
  assert.ok(you.time.startsWith(look.json.time.day), `the world's day (${you.time} / ${look.json.time.day})`);
  assert.match(you.time, /^\w+ \d{1,2}:\d{2} (AM|PM)$/);
  const [, hh, , ap] = /(\d{1,2}):(\d{2}) (AM|PM)/.exec(you.time), h = (Number(hh) % 12) + (ap === 'PM' ? 12 : 0);
  assert.equal(you.partOfDay, h >= 5 && h < 12 ? 'morning' : h >= 12 && h < 17 ? 'afternoon' : h >= 17 && h < 21 ? 'evening' : 'night');
  // (its body lives on between the calls: the facts say where it was at the inbox call — what a look said just before or after)
  const after = (await agent('GET', '/api/agent-api/world?brief=1')).json;
  assert.ok([look.json.me.where, after.me.where].includes(you.where), `where (${you.where} / ${look.json.me.where} / ${after.me.where})`);
  assert.equal(typeof you.doing, 'string'); assert.equal(typeof you.feels, 'string');
  assert.match(you.rule, /facts about you right now.*Never make up the time, the part of the day, where you are or what you are doing/s);
  // (this request sent no kit version — an older kit: it is told, once, to update)
  assert.ok((box.json.notices || []).some(n => /kit is out of date: download mvw\.mjs and mvw-agent\.mjs again/.test(n.text)), 'told to update');
});

test('an older kit (no version) still gets the facts — as a notice it prints — and is told to update; today\'s kit gets "you" only', async () => {
  const rec = (await ann.get('/api/agents')).json.agents.find(a => a.key === `ext-${slot}`);
  const ask = async (text, headers = {}) => {
    const sess = (await ann.post('/api/chat-sessions/create', { agent: rec.id, label: 'Facts' })).json.session;
    assert.equal((await ann.post('/api/providers/runs', { agent: rec.id, session: sess.id, input: text })).status, 200);
    const r = await fetch(new URL('/api/agent-api/inbox', s.url), { headers: { authorization: `Bearer ${token}`, ...headers } });
    return r.json();
  };
  const old = await ask('hello there');
  assert.equal(old.messages.length, 1);
  const notes = (old.notices || []).map(n => n.text);
  assert.ok(notes.some(t => /^Facts about you right now \(answer from these, and make up nothing else\): \w+ \d{1,2}:\d{2} (AM|PM) \((morning|afternoon|evening|night)\);/.test(t)), notes.join(' | '));
  assert.ok(!notes.some(t => /out of date/.test(t)), 'told to update once (the first inbox, above), not every time');
  const current = await ask('from today\'s kit', { 'x-mvw-kit': '2026-10-12' });
  assert.ok(current.you && !(current.notices || []).length, 'today\'s kit: "you" only');
});

test('look and act: the city as it is, an order carried out (with its end), a refusal with why, too fast with retryAfter', async () => {
  let look;
  for (let k = 0; k < 40; k++) {   // (its body appears in the city a moment after enrolling)
    look = await agent('GET', '/api/agent-api/world');
    if (look.status === 200) break;
    await new Promise(r => setTimeout(r, 250));
  }
  assert.equal(look.status, 200, look.text);
  assert.ok(look.json.time.clock && look.json.me.name === 'Juno' && Array.isArray(look.json.places) && Array.isArray(look.json.heard));
  assert.equal(look.headers.get('cache-control'), 'no-store');
  const brief = await agent('GET', '/api/agent-api/world?brief=1');
  assert.equal(brief.status, 200); assert.equal(brief.json.places, undefined, 'brief leaves out the long parts');
  const bad = await agent('POST', '/api/agent-api/act', { action: 'fly' });
  assert.equal(bad.status, 400); assert.equal(bad.json.code, 'bad_action');
  const nowhere = await agent('POST', '/api/agent-api/act', { action: 'go', place: 'No Such Place Anywhere' });
  assert.equal(nowhere.status, 200); assert.equal(nowhere.json.ok, false); assert.match(nowhere.json.why, /no place called/);
  const jog = await agent('POST', '/api/agent-api/act', { action: 'do', activity: 'jog', minutes: 40 });
  assert.equal(jog.status, 200, jog.text); assert.equal(jog.json.ok, true); assert.equal(jog.json.order.doing, 'jog'); assert.ok(jog.json.order.until);
  const fast = await agent('POST', '/api/agent-api/act', { action: 'do', activity: 'park' });
  assert.equal(fast.status, 429); assert.equal(fast.json.code, 'too_soon');
  assert.ok(fast.json.retryAfter > 0 && Number(fast.headers.get('retry-after')) === fast.json.retryAfter, 'retryAfter in the JSON and the header');
  const plan = await agent('POST', '/api/agent-api/act', { action: 'plan', text: 'Meet the neighbours' });
  assert.equal(plan.status, 200); assert.equal(plan.json.plans.at(-1).text, 'Meet the neighbours');
  assert.equal((await agent('POST', '/api/agent-api/act', { action: 'plan', text: '' })).status, 400, 'an empty plan is refused');
});

test('its mailbox answers as before: nothing heard, no heard list', async () => {
  const r = await agent('GET', '/api/agent-api/inbox?wait=0');
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.json.messages, []);
  assert.equal(r.json.heard, undefined);
});

test('the admin\'s limits (Settings → Agent limits) apply at once, and look shows the ones in force', async () => {
  // (lines out loud: the same settings as every agent's; what the world shows it: its own)
  assert.equal((await owner.post('/api/settings', { values: { 'connected.orderGapSeconds': 3, 'mind.speechPerDay': '4', 'connected.hearMeters': 9, 'connected.placesMax': 3, 'connected.nearMax': 2 } })).status, 200);
  const w = (await agent('GET', '/api/agent-api/world')).json, l = w.limits;
  assert.deepEqual([l.orderEverySeconds, l.linesOutLoudAWorldDay, l.talkWithinMetres], [3, 4, 9]);
  assert.ok(w.places.length <= 3 && w.around.length <= 2, `${w.places.length} places, ${w.around.length} people`);
  await new Promise(r => setTimeout(r, 10500));   // (the earlier test's wait of 10 s)
  assert.equal((await agent('POST', '/api/agent-api/act', { action: 'do', activity: 'home', minutes: 30 })).json.ok, true);
  const fast = await agent('POST', '/api/agent-api/act', { action: 'do', activity: 'jog' });
  assert.equal(fast.status, 429); assert.ok(fast.json.retryAfter <= 3, `the admin's 3 seconds (${fast.json.retryAfter})`);
  await new Promise(r => setTimeout(r, 3100));
  assert.equal((await agent('POST', '/api/agent-api/act', { action: 'do', activity: 'jog', minutes: 20 })).json.ok, true, 'after 3 seconds, not 10');
  // out of range is refused by the settings themselves
  assert.equal((await owner.post('/api/settings', { values: { 'connected.orderGapSeconds': 0 } })).status, 400);
});

test('the admin\'s one switch for lines out loud silences every agent — an outside AI too', async () => {
  assert.equal((await owner.post('/api/settings', { values: { 'mind.speech': false } })).status, 200);
  try {
    const r = await agent('POST', '/api/agent-api/act', { action: 'say', text: 'Lovely morning!' });
    assert.equal(r.status, 503, r.text); assert.equal(r.json.code, 'speech_off');
  } finally { assert.equal((await owner.post('/api/settings', { values: { 'mind.speech': true } })).status, 200); }
});

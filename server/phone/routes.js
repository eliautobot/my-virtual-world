// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Agents' phones over HTTP (docs/features/phone.md §7). Everything names an agent: its owner, or an account it is shared
// with to manage, may use its phone (agents.phone); anyone else gets 404. AI apps reach the same routes through their MCP
// tools (server/connector/tools.js), as the person, on the agent the person chose — texts they send go as the agent
// (via: 'agent'), so the phone's rules for the agent's own texts apply.
import { PhoneError } from './phone.js';

/** @param {object} router  @param {import('./phone.js').Phone} phone */
export function addPhoneRoutes(router, phone) {
  const ok = (json, status = 200) => ({ status, json });
  const run = fn => async ctx => {
    try { return ok(await fn(ctx)); } catch (e) {
      if (e instanceof PhoneError) return ok({ error: e.message, code: e.code, ...(e.twilioCode ? { twilioCode: e.twilioCode } : {}) }, e.status);
      throw e;
    }
  };
  const file = fn => async ctx => {
    try {
      const f = await fn(ctx);
      return { status: 200, pre: { body: f.data }, headers: { 'content-type': f.mime, 'cache-control': 'private, max-age=3600', 'x-content-type-options': 'nosniff', 'content-disposition': 'inline' } };
    } catch (e) {
      if (e instanceof PhoneError) return ok({ error: e.message, code: e.code }, e.status);
      throw e;
    }
  };
  const q = (url, k) => url.searchParams.get(k);
  const agent = (url, b) => Number(b?.agent ?? q(url, 'agent'));
  const R = (method, path, fn) => router.add({ method, path, cap: 'agents.phone', handler: run(fn) });

  R('GET', '/api/phone', ({ P, url }) => phone.state(P, agent(url)));
  R('GET', '/api/phone/summary', ({ P }) => ({ phones: phone.summary(P) }));
  // a Twilio account's numbers (which agent has each, what answers it today), numbers to buy, buying one
  R('GET', '/api/phone/numbers', ({ P, url }) => phone.numbers(P, Number(q(url, 'connection'))));
  R('GET', '/api/phone/available', ({ P, url }) => phone.available(P, Number(q(url, 'connection')), { country: q(url, 'country'), type: q(url, 'type'), areaCode: q(url, 'areaCode'), contains: q(url, 'contains') }));
  R('POST', '/api/phone/buy', ({ P, url, body }) => phone.buy(P, agent(url, body), { connection: body?.connection, number: body?.number }));
  R('POST', '/api/phone/attach', ({ P, url, body }) => phone.attach(P, agent(url, body), { connection: body?.connection, numberSid: body?.numberSid }));
  R('POST', '/api/phone/detach', ({ P, url, body }) => phone.detach(P, agent(url, body)));
  R('POST', '/api/phone/settings', ({ P, url, body }) => phone.configure(P, agent(url, body), body || {}));
  // ("check now": the phone reads its number's texts and calls at once, instead of at the next look)
  R('POST', '/api/phone/sync', ({ P, url, body }) => phone.syncNow(P, agent(url, body)));
  R('POST', '/api/phone/texts-direct', ({ P, url, body }) => phone.stopTextForwarding(P, agent(url, body)));
  // the person takes over: the whole phone (mode human|agent), or one conversation (peer, on); the agent then can't
  // answer or text them, and has them back by hand or after the phone's hand-back time
  R('POST', '/api/phone/control', ({ P, url, body }) => phone.control(P, agent(url, body), { mode: body?.mode }));
  R('POST', '/api/phone/takeover', ({ P, url, body }) => phone.takeover(P, agent(url, body), { peer: body?.peer, on: body?.on !== false }));
  // contacts
  R('GET', '/api/phone/contacts', ({ P, url }) => phone.contacts(P, agent(url)));
  R('POST', '/api/phone/contacts', ({ P, url, body }) => phone.saveContact(P, agent(url, body), body || {}));
  R('POST', '/api/phone/contacts/remove', ({ P, url, body }) => phone.removeContact(P, agent(url, body), body?.id));
  // texts: conversations, one conversation, sending, the agent's drafts
  R('GET', '/api/phone/threads', ({ P, url }) => phone.threads(P, agent(url)));
  R('GET', '/api/phone/thread', ({ P, url }) => phone.thread(P, agent(url), q(url, 'peer'), { before: q(url, 'before'), read: q(url, 'read') !== '0' }));
  R('POST', '/api/phone/send', ({ P, url, body }) => phone.send(P, agent(url, body), { to: body?.to, body: body?.body, via: body?.via === 'agent' ? 'agent' : 'person' }));
  R('POST', '/api/phone/drafts/send', ({ P, url, body }) => phone.approve(P, agent(url, body), body?.id, { body: body?.body }));
  R('POST', '/api/phone/drafts/discard', ({ P, url, body }) => phone.discard(P, agent(url, body), body?.id));
  router.add({ method: 'GET', path: '/api/phone/media', cap: 'agents.phone', handler: file(({ P, url }) => phone.mediaOf(P, agent(url), q(url, 'message'), Number(q(url, 'i')) || 0)) });
  // calls: the history, voicemail, calling someone (the person's own phone rings first)
  R('GET', '/api/phone/calls', ({ P, url }) => phone.calls(P, agent(url), { before: q(url, 'before') }));
  R('POST', '/api/phone/calls/read', ({ P, url, body }) => phone.readCalls(P, agent(url, body)));
  R('POST', '/api/phone/dial', ({ P, url, body }) => phone.dial(P, agent(url, body), { to: body?.to }));
  router.add({ method: 'GET', path: '/api/phone/voicemail', cap: 'agents.phone', handler: file(({ P, url }) => phone.recording(P, agent(url), q(url, 'call'))) });
}

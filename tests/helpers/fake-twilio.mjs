// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// A fake Twilio for the phone's tests (docs/features/phone.md): the REST API 2010-04-01 and the Serverless API as
// server/providers/twilio.js uses them - the account, numbers (list, one, change, buy, numbers to buy), Messages (send,
// list with To/From/DateSent> and pages, one, media), Calls (list, one, start), Recordings, Transcriptions, and a call
// handler's deployment. It checks the Basic credentials like Twilio, and the tests drive it: a text arriving, a call, a
// message's delivery status. Everything it was asked is kept (requests).
import http from 'node:http';
import crypto from 'node:crypto';

export const ACCOUNT = `AC${'1'.repeat(32)}`;
export const TOKEN = 'f'.repeat(32);
const sid = p => `${p}${crypto.randomBytes(16).toString('hex')}`;
const rfc = t => new Date(t).toUTCString().replace('GMT', '+0000');

export async function startFakeTwilio({ numbers = [], trial = false } = {}) {
  const S = {
    numbers: numbers.map(n => ({ sid: sid('PN'), phone_number: n.number, friendly_name: n.label || n.number, capabilities: { sms: true, voice: true, mms: true },
      sms_url: n.smsUrl || '', voice_url: n.voiceUrl || '', voice_method: 'POST', voice_application_sid: '', sms_application_sid: '', date_created: rfc(Date.now() - 86400000 * 100) })),
    messages: [], calls: [], recordings: [], transcriptions: [], media: new Map(),
    services: [], environments: [], functions: [], versions: [], builds: [], deployments: [],
    available: [{ phone_number: '+12395550111', friendly_name: '(239) 555-0111', locality: 'Fort Myers', region: 'FL', iso_country: 'US', capabilities: { SMS: true, voice: true, MMS: true } }],
    requests: [], failNext: null, token: TOKEN, account: ACCOUNT,
  };
  const json = (res, code, o) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
  const fail = (res, code, tcode, msg) => json(res, code, { code: tcode, message: msg, status: code });
  const page = (url, key, all) => {
    const size = Math.max(1, Math.min(1000, Number(url.searchParams.get('PageSize')) || 50)), p = Number(url.searchParams.get('Page')) || 0;
    const items = all.slice(p * size, p * size + size);
    const next = (p + 1) * size < all.length ? (() => { const u = new URL(url); u.searchParams.set('Page', String(p + 1)); return u.pathname + u.search; })() : null;
    return { [key]: items, next_page_uri: next, page: p, page_size: size };
  };
  const dayOk = (url, k, t) => { const d = url.searchParams.get(`${k}>`); return !d || new Date(t).toISOString().slice(0, 10) >= d; };
  const msgJson = m => ({ sid: m.sid, direction: m.direction, from: m.from, to: m.to, body: m.body, status: m.status, error_code: m.error_code || null, num_media: String(m.num_media || 0),
    num_segments: '1', date_created: rfc(m.at), date_sent: rfc(m.at), price: null, price_unit: 'USD' });
  const callJson = c => ({ sid: c.sid, direction: c.direction, from: c.from, to: c.to, status: c.status, duration: String(c.duration || 0), start_time: rfc(c.at), end_time: rfc(c.at + (c.duration || 0) * 1000),
    date_created: rfc(c.at), parent_call_sid: c.parent || null, answered_by: null, price: null });
  const readBody = req => new Promise(r => { const b = []; req.on('data', d => b.push(d)); req.on('end', () => r(Buffer.concat(b))); });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const raw = await readBody(req);
    const form = /x-www-form-urlencoded/.test(req.headers['content-type'] || '') ? new URLSearchParams(raw.toString()) : new URLSearchParams();
    S.requests.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), form: Object.fromEntries(form), multi: form.getAll('FunctionVersions') });
    const auth = Buffer.from(String(req.headers.authorization || '').replace(/^Basic /, ''), 'base64').toString();
    if (auth !== `${S.account}:${S.token}`) return fail(res, 401, 20003, 'Authenticate');
    if (S.failNext && url.pathname.includes(S.failNext.path)) { const f = S.failNext; S.failNext = null; return fail(res, f.status, f.code, 'forced'); }
    const A = `/2010-04-01/Accounts/${S.account}`;
    const p = url.pathname;
    let m;
    // ---- REST
    if (p === `${A}.json`) return json(res, 200, { sid: S.account, friendly_name: 'Fake Acme', status: 'active', type: trial ? 'Trial' : 'Full' });
    if (p === `${A}/IncomingPhoneNumbers.json` && req.method === 'GET') return json(res, 200, page(url, 'incoming_phone_numbers', S.numbers));
    if (p === `${A}/IncomingPhoneNumbers.json` && req.method === 'POST') {
      const n = { sid: sid('PN'), phone_number: form.get('PhoneNumber'), friendly_name: form.get('FriendlyName') || form.get('PhoneNumber'), capabilities: { sms: true, voice: true, mms: true },
        sms_url: '', voice_url: '', voice_method: 'POST', voice_application_sid: '', sms_application_sid: '', date_created: rfc(Date.now()) };
      if (!S.available.some(a => a.phone_number === n.phone_number)) return fail(res, 400, 21422, 'not available');
      S.available = S.available.filter(a => a.phone_number !== n.phone_number);
      S.numbers.push(n); return json(res, 201, n);
    }
    if ((m = /^\/2010-04-01\/Accounts\/AC1+\/IncomingPhoneNumbers\/(PN[0-9a-f]{32})\.json$/.exec(p))) {
      const n = S.numbers.find(x => x.sid === m[1]);
      if (!n) return fail(res, 404, 20404, 'not found');
      if (req.method === 'POST') {
        if (form.has('SmsUrl')) n.sms_url = form.get('SmsUrl');
        if (form.has('VoiceUrl')) n.voice_url = form.get('VoiceUrl');
        if (form.has('VoiceMethod')) n.voice_method = form.get('VoiceMethod');
        if (form.has('VoiceApplicationSid')) n.voice_application_sid = form.get('VoiceApplicationSid');
        if (form.has('FriendlyName')) n.friendly_name = form.get('FriendlyName');
      }
      return json(res, 200, n);
    }
    if ((m = /^\/2010-04-01\/Accounts\/AC1+\/AvailablePhoneNumbers\/([A-Z]{2})\/(Local|TollFree|Mobile)\.json$/.exec(p))) {
      const ac = url.searchParams.get('AreaCode');
      return json(res, 200, { available_phone_numbers: S.available.filter(a => !ac || a.phone_number.startsWith(`+1${ac}`)) });
    }
    if (p === `${A}/Messages.json` && req.method === 'POST') {
      const to = form.get('To'), from = form.get('From');
      if (!S.numbers.some(n => n.phone_number === from)) return fail(res, 400, 21606, 'not yours');
      if (!/^\+[1-9]\d{6,14}$/.test(to || '')) return fail(res, 400, 21211, 'invalid to');
      const msg = { sid: sid('SM'), direction: 'outbound-api', from, to, body: form.get('Body'), status: 'queued', at: Date.now() };
      S.messages.unshift(msg); return json(res, 201, msgJson(msg));
    }
    if (p === `${A}/Messages.json`) {
      const to = url.searchParams.get('To'), from = url.searchParams.get('From');
      const all = S.messages.filter(x => (!to || x.to === to) && (!from || x.from === from) && dayOk(url, 'DateSent', x.at)).sort((a, b) => b.at - a.at);
      return json(res, 200, page(url, 'messages', all.map(msgJson)));
    }
    if ((m = /^\/2010-04-01\/Accounts\/AC1+\/Messages\/(SM[0-9a-f]{32})\.json$/.exec(p))) {
      const x = S.messages.find(y => y.sid === m[1]); return x ? json(res, 200, msgJson(x)) : fail(res, 404, 20404, 'nf');
    }
    if ((m = /^\/2010-04-01\/Accounts\/AC1+\/Messages\/(SM[0-9a-f]{32})\/Media\.json$/.exec(p))) {
      return json(res, 200, { media_list: (S.media.get(m[1]) || []).map(x => ({ sid: x.sid, content_type: x.mime })) });
    }
    if ((m = /^\/2010-04-01\/Accounts\/AC1+\/Messages\/(SM[0-9a-f]{32})\/Media\/(ME[0-9a-f]{32})$/.exec(p))) {
      const x = (S.media.get(m[1]) || []).find(y => y.sid === m[2]);
      if (!x) return fail(res, 404, 20404, 'nf');
      res.writeHead(200, { 'content-type': x.mime, 'content-length': x.data.length }); return res.end(x.data);
    }
    if (p === `${A}/Calls.json` && req.method === 'POST') {
      const c = { sid: sid('CA'), direction: 'outbound-api', from: form.get('From'), to: form.get('To'), status: 'queued', duration: 0, at: Date.now(), twiml: form.get('Twiml') };
      S.calls.unshift(c); return json(res, 201, callJson(c));
    }
    if (p === `${A}/Calls.json`) {
      const to = url.searchParams.get('To'), from = url.searchParams.get('From');
      const all = S.calls.filter(x => (!to || x.to === to) && (!from || x.from === from) && dayOk(url, 'StartTime', x.at)).sort((a, b) => b.at - a.at);
      return json(res, 200, page(url, 'calls', all.map(callJson)));
    }
    if ((m = /^\/2010-04-01\/Accounts\/AC1+\/Calls\/(CA[0-9a-f]{32})\.json$/.exec(p))) {
      const x = S.calls.find(y => y.sid === m[1]); return x ? json(res, 200, callJson(x)) : fail(res, 404, 20404, 'nf');
    }
    if ((m = /^\/2010-04-01\/Accounts\/AC1+\/Calls\/(CA[0-9a-f]{32})\/Recordings\.json$/.exec(p))) {
      return json(res, 200, { recordings: S.recordings.filter(r => r.call === m[1]).map(r => ({ sid: r.sid, duration: String(r.duration), status: 'completed', date_created: rfc(r.at) })) });
    }
    if ((m = /^\/2010-04-01\/Accounts\/AC1+\/Recordings\/(RE[0-9a-f]{32})\/Transcriptions\.json$/.exec(p))) {
      return json(res, 200, { transcriptions: S.transcriptions.filter(t => t.recording === m[1]).map(t => ({ status: t.status, transcription_text: t.text })) });
    }
    if ((m = /^\/2010-04-01\/Accounts\/AC1+\/Recordings\/(RE[0-9a-f]{32})\.mp3$/.exec(p))) {
      if (!S.recordings.some(r => r.sid === m[1])) return fail(res, 404, 20404, 'nf');
      const b = Buffer.from('ID3fake-mp3-bytes'); res.writeHead(200, { 'content-type': 'audio/mpeg', 'content-length': b.length }); return res.end(b);
    }
    // ---- Serverless
    if (p === '/v1/Services' && req.method === 'GET') return json(res, 200, { services: S.services });
    if (p === '/v1/Services' && req.method === 'POST') { const x = { sid: sid('ZS'), unique_name: form.get('UniqueName'), friendly_name: form.get('FriendlyName') }; S.services.push(x); return json(res, 201, x); }
    if ((m = /^\/v1\/Services\/(ZS[0-9a-f]{32})\/Environments$/.exec(p))) {
      if (req.method === 'GET') return json(res, 200, { environments: S.environments.filter(e => e.service === m[1]) });
      const x = { sid: sid('ZE'), service: m[1], unique_name: form.get('UniqueName'), domain_name: `mvw-phone-${crypto.randomBytes(2).toString('hex')}-phone.twil.io` };
      S.environments.push(x); return json(res, 201, x);
    }
    if ((m = /^\/v1\/Services\/(ZS[0-9a-f]{32})\/Functions$/.exec(p))) {
      if (req.method === 'GET') return json(res, 200, { functions: S.functions.filter(f => f.service === m[1]) });
      const x = { sid: sid('ZH'), service: m[1], friendly_name: form.get('FriendlyName') }; S.functions.push(x); return json(res, 201, x);
    }
    if ((m = /^\/v1\/Services\/(ZS[0-9a-f]{32})\/Functions\/(ZH[0-9a-f]{32})\/Versions$/.exec(p))) {
      const text = raw.toString();
      const x = { sid: sid('ZN'), fn: m[2], code: /exports\.handler[\s\S]*?\n};/.exec(text)?.[0] || '', path: /name="Path"\r\n\r\n([^\r]*)/.exec(text)?.[1] || '' };
      S.versions.push(x); return json(res, 201, x);
    }
    if ((m = /^\/v1\/Services\/(ZS[0-9a-f]{32})\/Builds$/.exec(p))) { const x = { sid: sid('ZB'), status: 'building', versions: form.getAll('FunctionVersions'), polls: 0 }; S.builds.push(x); return json(res, 201, x); }
    if ((m = /^\/v1\/Services\/(ZS[0-9a-f]{32})\/Builds\/(ZB[0-9a-f]{32})\/Status$/.exec(p))) {
      const b = S.builds.find(x => x.sid === m[2]); b.polls += 1; if (b.polls >= 1) b.status = 'completed'; return json(res, 200, { status: b.status });
    }
    if ((m = /^\/v1\/Services\/(ZS[0-9a-f]{32})\/Environments\/(ZE[0-9a-f]{32})\/Deployments$/.exec(p))) { const x = { sid: sid('ZD'), build: form.get('BuildSid'), env: m[2] }; S.deployments.push(x); return json(res, 201, x); }
    return fail(res, 404, 20404, `fake twilio: no ${req.method} ${p}`);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  return {
    url, S, account: ACCOUNT, token: TOKEN,
    number: i => S.numbers[i],
    /** A text arriving at one of the numbers. */
    inbound({ from, to, body, media = [], at = Date.now() }) {
      const msg = { sid: sid('SM'), direction: 'inbound', from, to, body, status: 'received', num_media: media.length, at };
      S.messages.unshift(msg);
      if (media.length) S.media.set(msg.sid, media.map(x => ({ sid: sid('ME'), mime: x.mime, data: Buffer.from(x.data) })));
      return msg;
    },
    /** A text sent from the number elsewhere (the old way, another app). */
    outbound({ from, to, body, status = 'delivered', at = Date.now() }) { const msg = { sid: sid('SM'), direction: 'outbound-api', from, to, body, status, at }; S.messages.unshift(msg); return msg; },
    status(sidOf, status, code = null) { const x = S.messages.find(y => y.sid === sidOf); x.status = status; x.error_code = code; return x; },
    /** A call to (inbound) or from a number; voicemail: { seconds, transcript }. */
    call({ from, to, direction = 'inbound', status = 'completed', duration = 30, at = Date.now(), voicemail = null, legs = [] }) {
      const c = { sid: sid('CA'), direction, from, to, status, duration, at };
      S.calls.unshift(c);
      for (const l of legs) S.calls.unshift({ sid: sid('CA'), direction: 'outbound-dial', from: to, to: l.to, status: l.status, duration: l.duration || 0, at, parent: c.sid });
      if (voicemail) {
        const rec = { sid: sid('RE'), call: c.sid, duration: voicemail.seconds || 12, at };
        S.recordings.push(rec);
        if (voicemail.transcript !== undefined) S.transcriptions.push({ recording: rec.sid, status: voicemail.transcriptStatus || 'completed', text: voicemail.transcript });
      }
      return c;
    },
    sent: () => S.messages.filter(m => m.direction === 'outbound-api'),
    close: () => new Promise(r => server.close(r)),
  };
}

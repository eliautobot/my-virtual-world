// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Twilio, for agents' phones (docs/features/phone.md): a person's or the installation's own Twilio account, called with its
// own Account SID and Auth Token (or an API key and its secret). Runs inside the provider helper process (./host-main.mjs)
// like the voice adapter: its environment holds none of the server's secrets and the credentials arrive with each call.
// Which agent has which number, who may text it and what reaches the agent is the server's (server/phone/); this
// adapter makes the calls to Twilio's documented REST APIs:
// - api.twilio.com 2010-04-01: the account, its phone numbers (list, search, buy, change what a number does), Messages
//   (send, list, one, its media), Calls (list, one, start with inline TwiML), Recordings and their Transcriptions.
// - serverless.twilio.com v1 + serverless-upload.twilio.com: a small Twilio Function in the person's own account that
//   answers their agents' numbers' calls (forward, voicemail) - Twilio fetches it at call time, so this server needs no
//   public web address (server/phone/callfn.js holds its code).
// Nothing is read from the server's network: every address is Twilio's own. Errors carry a code the server acts on
// (auth, not_found, bad_request, rate_limited, quota, unsupported, timeout, network, provider_error) and words of our
// own; Twilio's own error number travels as twilioCode, never its text.
import { BUILTIN_MANIFESTS } from './manifest.js';

const manifest = BUILTIN_MANIFESTS.find(m => m.id === 'twilio');
const HOSTS = Object.freeze({ api: 'https://api.twilio.com', serverless: 'https://serverless.twilio.com', upload: 'https://serverless-upload.twilio.com' });
const AC = /^AC[0-9a-f]{32}$/, SK = /^SK[0-9a-f]{32}$/, SID = /^[A-Z]{2}[0-9a-f]{32}$/;
const E164 = /^\+[1-9]\d{6,14}$/;
const TIMEOUT_MS = 20000;
const MAX_MEDIA = 8 * 1024 * 1024;     // a recording or a picture fetched through the server, at most
const MAX_PAGES = 20;

/** Twilio's own error numbers the server words for people (https://www.twilio.com/docs/api/errors). */
export const TWILIO_ERRORS = Object.freeze({
  20003: ['auth', 'Twilio refused the Account SID or token'],
  20404: ['not_found', 'Twilio has no such thing on this account'],
  20429: ['rate_limited', 'Twilio asks to slow down'],
  21211: ['bad_request', 'That is not a valid phone number'],
  21408: ['bad_request', 'This Twilio account may not text or call that country (Geo permissions in Twilio\'s console)'],
  21422: ['bad_request', 'That number is no longer available to buy'],
  21452: ['quota', 'This Twilio account has as many numbers as it may'],
  21606: ['bad_request', 'This number can\'t send texts'],
  21608: ['bad_request', 'A trial Twilio account only texts and calls numbers it has verified'],
  21610: ['bad_request', 'That person replied STOP: Twilio won\'t text them until they send START'],
  21612: ['bad_request', 'Twilio can\'t text that number from this one'],
  21614: ['bad_request', 'That number can\'t receive texts'],
  21617: ['bad_request', 'That text is too long'],
  21660: ['bad_request', 'This number doesn\'t belong to the Twilio account'],
  30003: ['bad_request', 'The phone it was sent to is off or out of reach'],
  30005: ['bad_request', 'That number doesn\'t exist'],
  30006: ['bad_request', 'That number can\'t receive texts (a landline?)'],
  30007: ['bad_request', 'The carrier filtered it as unwanted'],
  30008: ['bad_request', 'The carrier didn\'t say why it wasn\'t delivered'],
  30032: ['bad_request', 'Carriers blocked it: this toll-free number isn\'t verified yet (Twilio\'s console → Toll-free verification)'],
  30034: ['bad_request', 'Carriers blocked it: this number isn\'t registered for business texting (A2P 10DLC, in Twilio\'s console)'],
  30044: ['bad_request', 'Carriers blocked it: the toll-free number\'s verification was rejected'],
  21215: ['bad_request', 'This Twilio account may not call that number (Geo permissions in Twilio\'s console)'],
  20008: ['unsupported', 'A test credential can\'t do this'],
});
/** What a message's or call's error number means, for the phone's screens (null: none). */
export const errorWords = code => (code ? (TWILIO_ERRORS[code]?.[1] || `Twilio couldn't deliver it (error ${code})`) : null);

const err = (code, message, extra = {}) => Object.assign(new Error(message), { code, ...extra });
const ms = s => { const t = Date.parse(s || ''); return Number.isFinite(t) ? t : null; };
const day = t => new Date(t).toISOString().slice(0, 10);
const str = (v, n = 1600) => String(v ?? '').slice(0, n);

function creds(p) {
  const c = p.config || {}, s = p.secrets || {};
  const account = String(c.accountSid || '').trim(), key = String(c.apiKeySid || '').trim(), token = String(s.authToken || '').trim();
  if (!AC.test(account)) throw err('bad_request', 'The Account SID starts with AC and has 34 characters (Twilio\'s console, Account info)');
  if (key && !SK.test(key)) throw err('bad_request', 'An API key SID starts with SK and has 34 characters');
  if (token.length < 16) throw err('auth', 'Paste the Auth Token (or the API key\'s secret) from Twilio\'s console');
  return { account, auth: `Basic ${Buffer.from(`${key || account}:${token}`).toString('base64')}` };
}

/** The adapter, over a fetch (tests give their own, and Twilio's addresses). */
export function makeTwilio({ fetchImpl = globalThis.fetch, hosts = HOSTS, timeoutMs = TIMEOUT_MS } = {}) {
  let H = { ...hosts };
  async function request(p, method, url, { form = null, multipart = null, raw = false, max = 2 * 1024 * 1024 } = {}) {
    const { auth } = creds(p);
    let res;
    try {
      const body = multipart || (form ? new URLSearchParams(Object.entries(form).flatMap(([k, v]) => (Array.isArray(v) ? v.map(x => [k, String(x)]) : v === undefined || v === null ? [] : [[k, String(v)]]))) : undefined);
      res = await fetchImpl(url, { method, headers: { Authorization: auth, Accept: raw ? '*/*' : 'application/json' }, body, redirect: raw ? 'follow' : 'error', signal: AbortSignal.timeout(p.timeoutMs || timeoutMs) });
    } catch (e) {
      if (e && (e.name === 'TimeoutError' || e.name === 'AbortError')) throw err('timeout', 'Twilio took too long to answer');
      throw err('network', 'Twilio could not be reached');
    }
    if (raw && res.ok) {
      const len = Number(res.headers.get('content-length') || 0);
      if (len > max) throw err('bad_request', 'That file is too big to show here');
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > max) throw err('bad_request', 'That file is too big to show here');
      return { buf, mime: String(res.headers.get('content-type') || 'application/octet-stream').split(';')[0].trim() };
    }
    let j = null;
    try { const t = await res.text(); j = t ? JSON.parse(t) : null; } catch { j = null; }
    if (res.ok) return j || {};
    const tc = Number(j?.code) || null, known = tc && TWILIO_ERRORS[tc];
    if (known) throw err(known[0], known[1], { twilioCode: tc, status: res.status });
    if (res.status === 401 || res.status === 403) throw err('auth', 'Twilio refused the Account SID or token', { twilioCode: tc });
    if (res.status === 404) throw err('not_found', 'Twilio has no such thing on this account', { twilioCode: tc });
    if (res.status === 429) throw err('rate_limited', 'Twilio asks to slow down', { twilioCode: tc });
    if (res.status >= 400 && res.status < 500) throw err('bad_request', `Twilio refused it${tc ? ` (error ${tc})` : ''}`, { twilioCode: tc });
    throw err('provider_error', 'Twilio had a problem; try again in a minute', { twilioCode: tc });
  }
  const api = (p, path) => `${H.api}/2010-04-01/Accounts/${creds(p).account}${path}`;
  /** Every page of a list, newest first, until `pages` pages or `stop(item)` says the rest is known. */
  async function list(p, first, key, { pages = 3, stop = null } = {}) {
    const out = [];
    let url = first;
    for (let i = 0; url && i < Math.min(pages, MAX_PAGES); i++) {
      const j = await request(p, 'GET', url);
      const items = Array.isArray(j[key]) ? j[key] : [];
      let done = false;
      for (const x of items) { if (stop && stop(x)) { done = true; break; } out.push(x); }
      if (done || !j.next_page_uri) break;
      url = `${H.api}${j.next_page_uri}`;
    }
    return out;
  }
  const qs = o => { const u = new URLSearchParams(); for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') u.set(k, String(v)); return u.toString(); };
  const numberView = n => ({ sid: n.sid, number: n.phone_number, label: n.friendly_name || n.phone_number, sms: !!n.capabilities?.sms, voice: !!n.capabilities?.voice, mms: !!n.capabilities?.mms,
    smsUrl: n.sms_url || '', smsApp: n.sms_application_sid || '', voiceUrl: n.voice_url || '', voiceMethod: n.voice_method || 'POST', voiceApp: n.voice_application_sid || '',
    voiceFallbackUrl: n.voice_fallback_url || '', trunk: n.trunk_sid || '', created: ms(n.date_created) });
  const messageView = m => ({ sid: m.sid, direction: m.direction, from: m.from, to: m.to, body: str(m.body), status: m.status, errorCode: m.error_code ? Number(m.error_code) : null,
    media: Number(m.num_media) || 0, segments: Number(m.num_segments) || 1, at: ms(m.date_sent) || ms(m.date_created), price: m.price ? Number(m.price) : null, priceUnit: m.price_unit || null });
  const callView = c => ({ sid: c.sid, direction: c.direction, from: c.from, to: c.to, status: c.status, duration: Number(c.duration) || 0, at: ms(c.start_time) || ms(c.date_created),
    end: ms(c.end_time), parent: c.parent_call_sid || null, answeredBy: c.answered_by || null, price: c.price ? Number(c.price) : null });
  const phone = (v, what) => { const s = String(v || '').trim(); if (!E164.test(s)) throw err('bad_request', `${what} must be a phone number in international form, like +15551234567`); return s; };
  const sid = (v, what = 'That') => { const s = String(v || ''); if (!SID.test(s)) throw err('bad_request', `${what} is not a Twilio id`); return s; };

  // (the helper calls a method with one object: the connection's settings and credentials, and the call's own fields)
  const one = o => { for (const [k, f] of Object.entries(o)) if (typeof f === 'function' && k !== 'setup' && k !== 'test') o[k] = p => f(p, p || {}); return o; };
  return one({
    manifest,
    /** (the server's tests only: a fake Twilio on this machine - server/config.js twilioTestUrl) */
    setup(o = {}) { if (o.hosts) H = { ...H, ...o.hosts }; },
    /** The smallest real call: the account itself, and how many numbers it has. */
    async test(p) {
      try {
        const a = await request(p, 'GET', api(p, '.json'));
        const n = await request(p, 'GET', api(p, '/IncomingPhoneNumbers.json?PageSize=50'));
        const count = Array.isArray(n.incoming_phone_numbers) ? n.incoming_phone_numbers.length : 0;
        if (a.status && a.status !== 'active') return { ok: false, error: `This Twilio account is ${a.status}`, code: 'auth', fix: 'Reopen it in Twilio\'s console.' };
        return { ok: true, detail: `Twilio: ${a.friendly_name || 'account'} (${a.type === 'Trial' ? 'trial' : 'full'}), ${count}${n.next_page_uri ? '+' : ''} phone number${count === 1 ? '' : 's'}` };
      } catch (e) {
        const fix = { auth: 'Paste the Account SID and the Auth Token from Twilio\'s console (Account info).', bad_request: 'Check the Account SID (AC…) and API key SID (SK…).',
          rate_limited: 'Wait a minute and test again.' }[e.code] || 'Try again in a minute; if it keeps failing, check status.twilio.com.';
        return { ok: false, error: e.message, code: e.code, fix };
      }
    },
    async account(p) {
      const a = await request(p, 'GET', api(p, '.json'));
      return { name: a.friendly_name || '', status: a.status || '', trial: a.type === 'Trial' };
    },
    async numbers(p) {
      const items = await list(p, api(p, '/IncomingPhoneNumbers.json?PageSize=200'), 'incoming_phone_numbers', { pages: 5 });
      return { numbers: items.map(numberView) };
    },
    async number(p, { sid: s }) { return numberView(await request(p, 'GET', api(p, `/IncomingPhoneNumbers/${sid(s, 'The number')}.json`))); },
    /** Numbers Twilio has to sell: country (ISO 2 letters), type local|tollfree|mobile, an area code or digits it contains. */
    async available(p, { country = 'US', type = 'local', areaCode = '', contains = '', limit = 20 } = {}) {
      const cc = String(country).toUpperCase();
      if (!/^[A-Z]{2}$/.test(cc)) throw err('bad_request', 'A country is two letters, like US');
      const kind = { local: 'Local', tollfree: 'TollFree', mobile: 'Mobile' }[type];
      if (!kind) throw err('bad_request', 'Local, toll-free or mobile');
      if (areaCode && !/^\d{2,4}$/.test(String(areaCode))) throw err('bad_request', 'An area code is digits, like 239');
      if (contains && !/^[0-9*]{2,10}$/.test(String(contains))) throw err('bad_request', 'Digits to look for, like 555');
      const j = await request(p, 'GET', api(p, `/AvailablePhoneNumbers/${cc}/${kind}.json?${qs({ AreaCode: areaCode, Contains: contains, SmsEnabled: 'true', VoiceEnabled: 'true', PageSize: Math.min(30, Math.max(1, limit | 0)) })}`));
      return { numbers: (j.available_phone_numbers || []).map(n => ({ number: n.phone_number, label: n.friendly_name, locality: n.locality || '', region: n.region || '', country: n.iso_country || cc,
        sms: !!n.capabilities?.SMS || !!n.capabilities?.sms, voice: !!n.capabilities?.voice, mms: !!n.capabilities?.MMS || !!n.capabilities?.mms })) };
    },
    /** Buys a number for the account (Twilio charges it monthly). */
    async buy(p, { number, label = '' }) {
      return numberView(await request(p, 'POST', api(p, '/IncomingPhoneNumbers.json'), { form: { PhoneNumber: phone(number, 'The number'), FriendlyName: str(label, 64) || undefined } }));
    },
    /** What a number does with texts and calls. Only these may change; an empty string clears one. */
    async configure(p, { sid: s, smsUrl, voiceUrl, voiceMethod, voiceApp, label }) {
      const form = {};
      const url = (v, what) => { if (v === '') return ''; const u = new URL(String(v)); if (u.protocol !== 'https:') throw err('bad_request', `${what} must be https`); return u.toString(); };
      if (smsUrl !== undefined) form.SmsUrl = url(smsUrl, 'The text address');
      if (voiceUrl !== undefined) form.VoiceUrl = url(voiceUrl, 'The call address');
      if (voiceMethod !== undefined) { if (!['GET', 'POST'].includes(voiceMethod)) throw err('bad_request', 'GET or POST'); form.VoiceMethod = voiceMethod; }
      if (voiceApp !== undefined) { if (voiceApp !== '' && !/^AP[0-9a-f]{32}$/.test(voiceApp)) throw err('bad_request', 'Not a TwiML app'); form.VoiceApplicationSid = voiceApp; }
      if (label !== undefined) form.FriendlyName = str(label, 64);
      return numberView(await request(p, 'POST', api(p, `/IncomingPhoneNumbers/${sid(s, 'The number')}.json`), { form }));
    },
    async send(p, { from, to, body }) {
      const text = String(body ?? '').trim();
      if (!text) throw err('bad_request', 'Write something to send');
      if (text.length > 1600) throw err('bad_request', 'A text is at most 1,600 characters');
      return messageView(await request(p, 'POST', api(p, '/Messages.json'), { form: { From: phone(from, 'The sender'), To: phone(to, 'The number'), Body: text } }));
    },
    /** Messages to or from a number, newest first, sent on or after a day (a time; Twilio filters by day), until a known
     *  sid older than `known` is reached. */
    async messages(p, { to = null, from = null, after = null, pages = 3, pageSize = 100 } = {}) {
      if (!to === !from) throw err('bad_request', 'Messages to a number, or from one');
      const q = qs({ To: to ? phone(to, 'The number') : '', From: from ? phone(from, 'The number') : '', PageSize: Math.min(1000, Math.max(1, pageSize | 0)) });
      const date = after ? `&${encodeURIComponent('DateSent>')}=${day(after - 86400000)}` : '';
      return { messages: (await list(p, `${api(p, '/Messages.json')}?${q}${date}`, 'messages', { pages })).map(messageView) };
    },
    async message(p, { sid: s }) { return messageView(await request(p, 'GET', api(p, `/Messages/${sid(s, 'The message')}.json`))); },
    async media(p, { message }) {
      const j = await request(p, 'GET', api(p, `/Messages/${sid(message, 'The message')}/Media.json?PageSize=10`));
      return { media: (j.media_list || []).map(m => ({ sid: m.sid, mime: m.content_type || '' })) };
    },
    async mediaFile(p, { message, media }) {
      const r = await request(p, 'GET', api(p, `/Messages/${sid(message, 'The message')}/Media/${sid(media, 'The picture')}`), { raw: true, max: MAX_MEDIA });
      return { data: r.buf.toString('base64'), mime: r.mime };
    },
    async calls(p, { to = null, from = null, after = null, pages = 2, pageSize = 100 } = {}) {
      if (!to === !from) throw err('bad_request', 'Calls to a number, or from one');
      const q = qs({ To: to ? phone(to, 'The number') : '', From: from ? phone(from, 'The number') : '', PageSize: Math.min(1000, Math.max(1, pageSize | 0)) });
      const date = after ? `&${encodeURIComponent('StartTime>')}=${day(after - 86400000)}` : '';
      return { calls: (await list(p, `${api(p, '/Calls.json')}?${q}${date}`, 'calls', { pages })).map(callView) };
    },
    async call(p, { sid: s }) { return callView(await request(p, 'GET', api(p, `/Calls/${sid(s, 'The call')}.json`))); },
    /** A call from `from` to `to` that runs the given TwiML when answered (the person's own phone, to connect them). */
    async dial(p, { from, to, twiml, timeout = 30 }) {
      const t = String(twiml || '');
      if (!/^<\?xml[^>]*>\s*<Response>[\s\S]*<\/Response>\s*$|^<Response>[\s\S]*<\/Response>$/.test(t) || t.length > 4000) throw err('bad_request', 'Not a call script');
      return callView(await request(p, 'POST', api(p, '/Calls.json'), { form: { From: phone(from, 'The caller'), To: phone(to, 'The number'), Twiml: t, Timeout: Math.min(60, Math.max(5, timeout | 0)) } }));
    },
    async recordings(p, { call }) {
      const j = await request(p, 'GET', api(p, `/Calls/${sid(call, 'The call')}/Recordings.json?PageSize=10`));
      return { recordings: (j.recordings || []).map(r => ({ sid: r.sid, duration: Number(r.duration) || 0, status: r.status, at: ms(r.date_created) })) };
    },
    async transcription(p, { recording }) {
      const j = await request(p, 'GET', api(p, `/Recordings/${sid(recording, 'The recording')}/Transcriptions.json?PageSize=5`));
      const t = (j.transcriptions || [])[0];
      return t ? { status: t.status, text: str(t.transcription_text, 4000) } : null;
    },
    async recordingFile(p, { recording }) {
      const r = await request(p, 'GET', api(p, `/Recordings/${sid(recording, 'The recording')}.mp3`), { raw: true, max: MAX_MEDIA });
      return { data: r.buf.toString('base64'), mime: r.mime.startsWith('audio/') ? r.mime : 'audio/mpeg' };
    },
    /**
     * The call handler in the person's own account: one Twilio Function at `path`, in a service named `uniqueName`
     * (made once, then updated in place), deployed to its environment. → { service, environment, domain, build }
     */
    async deploy(p, { uniqueName, friendlyName, path = '/call', code }) {
      if (!/^[a-z0-9-]{4,50}$/.test(String(uniqueName || ''))) throw err('bad_request', 'A service name is lower-case letters, digits and dashes');
      if (!/^\/[a-z0-9-]{1,30}$/.test(path)) throw err('bad_request', 'A function path is like /call');
      if (typeof code !== 'string' || !code.includes('exports.handler') || code.length > 64000) throw err('bad_request', 'Not a function');
      const S = `${H.serverless}/v1/Services`;
      const services = (await request(p, 'GET', `${S}?PageSize=50`)).services || [];
      let svc = services.find(s => s.unique_name === uniqueName);
      if (!svc) svc = await request(p, 'POST', S, { form: { UniqueName: uniqueName, FriendlyName: str(friendlyName || uniqueName, 64), IncludeCredentials: 'false', UiEditable: 'false' } });
      const envs = (await request(p, 'GET', `${S}/${svc.sid}/Environments?PageSize=20`)).environments || [];
      let env = envs.find(e => e.unique_name === 'phone');
      if (!env) env = await request(p, 'POST', `${S}/${svc.sid}/Environments`, { form: { UniqueName: 'phone', DomainSuffix: 'phone' } });
      const fns = (await request(p, 'GET', `${S}/${svc.sid}/Functions?PageSize=50`)).functions || [];
      let fn = fns.find(f => f.friendly_name === path.slice(1));
      if (!fn) fn = await request(p, 'POST', `${S}/${svc.sid}/Functions`, { form: { FriendlyName: path.slice(1) } });
      const fd = new FormData();
      fd.append('Path', path); fd.append('Visibility', 'public');
      fd.append('Content', new Blob([code], { type: 'application/javascript' }), `${path.slice(1)}.js`);
      const ver = await request(p, 'POST', `${H.upload}/v1/Services/${svc.sid}/Functions/${fn.sid}/Versions`, { multipart: fd });
      const build = await request(p, 'POST', `${S}/${svc.sid}/Builds`, { form: { FunctionVersions: [ver.sid] } });
      let status = build.status;
      for (let i = 0; i < 40 && status !== 'completed'; i++) {
        if (status === 'failed') throw err('provider_error', 'Twilio could not build the call handler');
        await new Promise(r => setTimeout(r, p.pollMs ?? 1500));
        status = (await request(p, 'GET', `${S}/${svc.sid}/Builds/${build.sid}/Status`)).status;
      }
      if (status !== 'completed') throw err('timeout', 'Twilio is still building the call handler; try again in a minute');
      await request(p, 'POST', `${S}/${svc.sid}/Environments/${env.sid}/Deployments`, { form: { BuildSid: build.sid } });
      return { service: svc.sid, environment: env.sid, domain: env.domain_name, build: build.sid };
    },
  });
}

export default makeTwilio();

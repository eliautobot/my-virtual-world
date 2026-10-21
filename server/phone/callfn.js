// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The call handler of agents' phones (docs/features/phone.md §5): a Twilio Function this server deploys into the person's
// own Twilio account (server/providers/twilio.js deploy). Twilio fetches it when one of their agents' numbers is called, so
// this server needs no public web address. Everything it needs is in the number's call address (callUrl): what to do
// (forward to a phone, then voicemail; or voicemail at once), the greeting and the agent's name — nothing secret. The
// recording and its transcript stay in the Twilio account, where the phone's sync reads them (server/phone/phone.js).
import crypto from 'node:crypto';

export const FN_PATH = '/call';
const E164 = /^\+[1-9]\d{6,14}$/;

/** The Function's source, as Twilio runs it (its Node runtime gives the Twilio helper library as a global). */
export const CALL_FN = `// Deployed by My Virtual World: answers calls to an agent's phone number (forward, voicemail).
// Settings come from the number's call address; this function keeps nothing.
exports.handler = function (context, event, callback) {
  const r = new Twilio.twiml.VoiceResponse();
  const q = k => (event[k] === undefined || event[k] === null ? '' : String(event[k]));
  const E164 = /^\\+[1-9]\\d{6,14}$/;
  const keep = ['mode', 'to', 'greet', 'vm', 'name', 't'];
  const next = step => '${FN_PATH}?' + new URLSearchParams([...keep.filter(k => q(k)).map(k => [k, q(k)]), ['step', step]]).toString();
  const name = q('name').slice(0, 60);
  const greet = q('greet').slice(0, 300) || ('You have reached ' + (name || 'this number') + '. Please leave a message after the tone.');
  const voicemail = () => {
    r.say(greet);
    r.record({ maxLength: 120, playBeep: true, transcribe: true, timeout: 5, trim: 'trim-silence', action: next('done') });
    r.say('No message was recorded. Goodbye.');
    r.hangup();
  };
  const step = q('step') || 'in';
  if (step === 'in') {
    if (q('mode') === 'forward' && E164.test(q('to'))) {
      const t = Math.min(60, Math.max(5, Number(q('t')) || 20));
      const caller = E164.test(q('From')) ? q('From') : q('To');
      const d = r.dial({ callerId: caller, timeout: t, answerOnBridge: true, action: next('after') });
      d.number(q('to'));
    } else if (q('mode') === 'voicemail') voicemail();
    else { r.say((name || 'This number') + ' is not taking calls right now. Goodbye.'); r.hangup(); }
  } else if (step === 'after') {
    const s = q('DialCallStatus');
    if (s === 'completed' || s === 'answered') r.hangup();
    else if (q('vm') === '1') voicemail();
    else r.hangup();
  } else { r.say('Thank you. Goodbye.'); r.hangup(); }
  callback(null, r);
};
`;
/** Which version of the handler is deployed (the phone redeploys when it changes). */
export const CALL_FN_VERSION = crypto.createHash('sha256').update(CALL_FN).digest('hex').slice(0, 16);

/** A number's call address for a line's call settings. domain: the Function's (an environment of the service). */
export function callUrl(domain, { mode, forwardTo = '', voicemail = true, greeting = '', name = '', ringSeconds = 20 }) {
  if (!/^[a-z0-9.-]+\.twil\.io$/.test(String(domain || ''))) throw new Error('not a Twilio Functions domain');
  const q = new URLSearchParams();
  q.set('mode', mode);
  if (mode === 'forward') {
    if (!E164.test(forwardTo)) throw new Error('forward to a phone number');
    q.set('to', forwardTo);
    q.set('t', String(Math.min(60, Math.max(5, ringSeconds | 0 || 20))));
    if (voicemail) q.set('vm', '1');
  }
  if (name) q.set('name', String(name).slice(0, 60));
  if (greeting) q.set('greet', String(greeting).slice(0, 300));
  return `https://${domain}${FN_PATH}?${q.toString()}`;
}
/** Whether a number's call address is one of ours (on this installation's service domain). */
export const isOurCallUrl = (url, domain) => !!(url && domain && String(url).startsWith(`https://${domain}${FN_PATH}?`));

/** TwiML for a call the person starts from their agent's phone: their own phone rings first, then the other person. */
export function bridgeTwiml({ to, from, name = '' }) {
  if (!E164.test(to) || !E164.test(from)) throw new Error('phone numbers');
  const x = s => String(s).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
  const who = name ? `Calling ${x(String(name).slice(0, 60))}.` : 'Connecting your call.';
  return `<Response><Say>${who}</Say><Dial callerId="${x(from)}" timeout="30" answerOnBridge="true"><Number>${x(to)}</Number></Dial></Response>`;
}

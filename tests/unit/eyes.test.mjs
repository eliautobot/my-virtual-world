// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// An agent's eyes (server/senses/eye.js): the server asks only the pages showing the world near the body, takes an answer
// only from a page it asked, once; every page saying it can't ends the ask at once; one ask in flight per account and a
// bound on all of them; a picture is a JPEG or PNG under the live connection's 64 KB, or it is refused; and what the agent
// is told says whether it has a picture or why not.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Eyes, MAX_DATA, pictureBytes, eyesLine, EYES_WHY } from '../../server/senses/eye.js';

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(600, 7)]).toString('base64');
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(600, 7)]).toString('base64');
const AT = { i: 12, x: 10.5, z: -4, ctx: -1 };
/** A page of `account`: what it was sent, kept. */
const page = account => { const p = { P: { account: { id: account } }, sent: [], send: t => p.sent.push(JSON.parse(t)) }; return p; };
const wait = ms => new Promise(r => setTimeout(r, ms));

test('eyes: the ask goes to the pages near the body, with where it is; the first picture is taken, once', async () => {
  const a = page(7), b = page(7), asked = [];
  const eyes = new Eyes({ pages: (acc, at) => { asked.push([acc, at]); return [a, b]; }, timeoutMs: 500 });
  const p = eyes.ask(7, { at: AT });
  assert.deepEqual(asked, [[7, { x: 10.5, z: -4 }]], 'the pages near where it stands');
  assert.deepEqual(a.sent, [{ t: 'see', id: a.sent[0].id, i: 12, x: 10.5, z: -4, ctx: -1 }]);
  const id = a.sent[0].id;
  eyes.reply(page(9), { id, mime: 'image/jpeg', data: JPEG });   // someone else's page: dropped
  eyes.reply(page(7), { id, mime: 'image/jpeg', data: JPEG });   // a page of the same account it did not ask: dropped
  eyes.reply(b, { id, mime: 'image/jpeg', data: JPEG });
  assert.deepEqual(await p, { ok: true, data: JPEG, mime: 'image/jpeg' });
  eyes.reply(a, { id, mime: 'image/jpeg', data: JPEG });         // after it ended: goes nowhere
  assert.equal(eyes.stats.answered, 1);
  assert.equal(eyes.pending.size, 0);
});

test('eyes: no account, no place, no page near it, or no answer in time — and why', async () => {
  const eyes = new Eyes({ pages: () => [], timeoutMs: 40 });
  assert.deepEqual(await eyes.ask(null, { at: AT }), { ok: false, why: 'no_page' });
  assert.deepEqual(await eyes.ask(3, {}), { ok: false, why: 'far' });
  assert.deepEqual(await eyes.ask(3, { at: { x: 1, z: 2 } }), { ok: false, why: 'far' }, 'which body: its index');
  assert.deepEqual(await eyes.ask(3, { at: AT }), { ok: false, why: 'no_page' });
  const silent = new Eyes({ pages: () => [page(3)], timeoutMs: 260 });
  const t0 = Date.now();
  assert.deepEqual(await silent.ask(3, { at: AT }), { ok: false, why: 'timeout' });
  assert.ok(Date.now() - t0 >= 240);
  const throws = new Eyes({ pages: () => { throw new Error('gone'); } });
  assert.deepEqual(await throws.ask(3, { at: AT }), { ok: false, why: 'no_page' });
});

test('eyes: every page asked saying it can\'t ends the ask at once; one that can still wins', async () => {
  const a = page(5), b = page(5);
  const eyes = new Eyes({ pages: () => [a, b], timeoutMs: 5000 });
  let t0 = Date.now(), p = eyes.ask(5, { at: AT });
  eyes.reply(a, { id: a.sent[0].id, error: 'hidden' });
  eyes.reply(b, { id: b.sent[0].id, error: 'not_drawn' });
  assert.deepEqual(await p, { ok: false, why: 'not_drawn' });
  assert.ok(Date.now() - t0 < 200, 'no waiting for the time-out');
  p = eyes.ask(5, { at: AT });
  eyes.reply(a, { id: a.sent[1].id, error: 'hidden' });
  eyes.reply(b, { id: b.sent[1].id, mime: 'image/png', data: PNG });
  assert.deepEqual(await p, { ok: true, data: PNG, mime: 'image/png' });
  // (an error the server does not know is a failure, said plainly)
  p = eyes.ask(5, { at: AT });
  eyes.reply(a, { id: a.sent[2].id, error: '<script>' }); eyes.reply(b, { id: b.sent[2].id, error: 'x'.repeat(5000) });
  assert.deepEqual(await p, { ok: false, why: 'failed' });
  // (a page that closes while asked: the ask no longer waits for it)
  t0 = Date.now(); p = eyes.ask(5, { at: AT });
  eyes.gone(a); eyes.gone(b);
  assert.deepEqual(await p, { ok: false, why: 'no_page' });
  assert.ok(Date.now() - t0 < 200);
});

test('eyes: one ask in flight per account, a bound on all of them', async () => {
  const pages = new Map();
  const eyes = new Eyes({ pages: acc => { const p = page(acc); pages.set(acc, p); return [p]; }, timeoutMs: 3000 });
  const first = eyes.ask(1, { at: AT });
  assert.deepEqual(await eyes.ask(1, { at: AT }), { ok: false, why: 'busy' }, 'a second ask meanwhile');
  const other = eyes.ask(2, { at: AT });   // another account: its own
  eyes.reply(pages.get(1), { id: pages.get(1).sent[0].id, data: JPEG });
  eyes.reply(pages.get(2), { id: pages.get(2).sent[0].id, data: JPEG });
  assert.equal((await first).ok, true); assert.equal((await other).ok, true);
  const again = eyes.ask(1, { at: AT });   // (free again once it ended)
  eyes.reply(pages.get(1), { id: pages.get(1).sent[0].id, data: JPEG });
  assert.equal((await again).ok, true);
  // (a flood from many accounts: at most 200 wait at once)
  const many = [];
  for (let acc = 100; acc < 400; acc++) many.push(eyes.ask(acc, { at: AT, timeoutMs: 300 }));
  assert.equal(eyes.pending.size, 200);
  const r = await Promise.all(many);
  assert.equal(r.filter(x => x.why === 'busy').length, 100);
  assert.equal(r.filter(x => x.why === 'timeout').length, 200);
  assert.equal(eyes.pending.size, 0); assert.equal(eyes.busy.size, 0, 'nothing left behind');
});

test('eyes: a picture is a JPEG or PNG under 64 KB, or it is refused', async () => {
  assert.ok(pictureBytes(JPEG, 'image/jpeg'));
  assert.ok(pictureBytes(`data:image/jpeg;base64,${JPEG}`, 'image/jpeg'), 'as a data: address too');
  assert.ok(pictureBytes(PNG, 'image/png'));
  assert.equal(pictureBytes(PNG, 'image/jpeg'), null, 'not what it says it is');
  assert.equal(pictureBytes(Buffer.from('<html>' + 'x'.repeat(600)).toString('base64'), 'image/jpeg'), null);
  assert.equal(pictureBytes(Buffer.from([0xff, 0xd8, 0xff]).toString('base64'), 'image/jpeg'), null, 'too small to be one');
  assert.equal(pictureBytes('not base64 at all!', 'image/jpeg'), null);
  const big = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(MAX_DATA, 1)]).toString('base64');
  assert.equal(pictureBytes(big, 'image/jpeg'), null, 'larger than the live connection takes');
  const a = page(4);
  const eyes = new Eyes({ pages: () => [a], timeoutMs: 1000 });
  const p = eyes.ask(4, { at: AT });
  eyes.reply(a, { id: a.sent[0].id, mime: 'image/jpeg', data: big });
  assert.deepEqual(await p, { ok: false, why: 'bad_picture' }, 'and the ask ends at once');
});

test('eyes: what the agent is told — a picture attached, or why there is none', () => {
  assert.match(eyesLine({ ok: true }, 'Kim'), /picture of what is in front of you right now is attached \(from where you stand, looking where Kim is looking\), because answering needs your eyes: answer what they asked .* don't describe the rest of it/);
  for (const why of Object.keys(EYES_WHY)) {
    const t = eyesLine({ ok: false, why }, 'Kim');
    assert.match(t, /^You could not get a look just now: /); assert.doesNotMatch(t, /\{who\}|undefined/);
    assert.match(t, /say you didn't get a good look/);
  }
  assert.match(eyesLine(null, 'Kim'), /the picture could not be taken/);
  assert.match(eyesLine({ ok: false, why: 'far' }, 'Kim'), /near enough to Kim's character/);
});

// Seated on the world's seats (2026-11-20, the product owner: the women "don't sit on the proper sitting surface and
// their feet go through the ground"): each builder body's seated clips moved to sit as the male body's, the seats' fit
// (client/js/render/seat-fix.js), drawn by the characters' and what they hold's shaders.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { seatFix, seatClipBits, SEAT_REF, SEAT_CLIPS } from '../client/js/render/seat-fix.js';
import { TRIPO_CLIPS } from '../client/js/render/charClips.js';

const man = sex => JSON.parse(fs.readFileSync(new URL(`../client/assets/crowd/${sex}.json`, import.meta.url), 'utf8'));

test('each builder body sits as the seats were fitted: the female body lifted and moved back, the male left as it is', () => {
  const f = man('female'), m = man('male');
  const [fl, fb, fp, fon] = seatFix(f), [ml, mb, , mon] = seatFix(m);
  assert.equal(fon, 1); assert.equal(mon, 1); assert.equal(fp, SEAT_REF.contact);
  // (its contact on the seat and its hips' depth then the reference's; its soles no longer under the floor)
  const s = f.seated.sit_idle;
  assert.ok(Math.abs(s.contact + fl - SEAT_REF.contact) < 1e-9 && Math.abs(s.hip[1] + fb - SEAT_REF.hipZ) < 1e-9);
  assert.ok(fl > 0.01 && fb < -0.03, `female: lifted ${fl.toFixed(3)} m, back ${fb.toFixed(3)} m`);
  assert.ok(s.sole + fl > -0.005, `female soles at ${(s.sole + fl).toFixed(3)} m`);
  assert.ok(Math.abs(ml) < 0.01 && Math.abs(mb) < 0.01, 'male: as it was');
});

test('only builder bodies that measured their seat; the seated clips as bits; both shaders apply it', () => {
  assert.deepEqual(seatFix({ seated: { sit_idle: { contact: 0.3, hip: [0.5, 0.1] } } }), [0, 0, 0, 0], 'a ready-made character: untouched');
  assert.deepEqual(seatFix({ custom: { v: 1 } }), [0, 0, 0, 0], 'no seated measure: untouched');
  assert.deepEqual(seatFix({ custom: { v: 1 }, seated: { sit_idle: { contact: 0.1, hip: [0.5, 0] } } }), [0, 0, 0, 0], 'measured far off: untouched');
  const bits = seatClipBits();
  for (const n of SEAT_CLIPS) { const c = TRIPO_CLIPS.indexOf(n); assert.ok(c >= 0, n); assert.ok((bits[c >> 5] >> (c & 31)) & 1, n); }
  for (const n of ['car_ride', 'car_drive', 'lie', 'walk', 'idle']) { const c = TRIPO_CLIPS.indexOf(n); assert.ok(!((bits[c >> 5] >> (c & 31)) & 1), n); }
  const chars = fs.readFileSync(new URL('../client/js/render/characters.js', import.meta.url), 'utf8'), props = fs.readFileSync(new URL('../client/js/render/char-props.js', import.meta.url), 'utf8');
  assert.match(chars, /transformed\.yz \+= charSeat \* uSeatFix\.xy;/); assert.match(chars, /transformed\.y = \(transformed\.y - pv\) \* charH \+ pv;/);
  assert.match(chars, /uSeatFix: \{ value: typeof seatFix === 'function' \? seatFix\(d\.man\) : \[0, 0, 0, 0\] \}/);
  assert.match(props, /transformed\.yz \+= prSeat \* uSeatFix\.xy;/); assert.match(props, /transformed\.y = \(transformed\.y - pv\) \* H \+ pv;/);
  assert.match(props, /uSeatFix: \{ value: seatFix\(d\.man\) \}/);
});

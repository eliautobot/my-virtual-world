// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Whose turn it is in live voice (client/js/ui/voice-core.js TurnTaker, sounds, PauseHabit): a slow talker who pauses to
// think is never cut off mid-sentence, a finished thought is answered after their patience, a thought left hanging ("and…")
// waits longer, their own pauses are learned — in a quiet room, a noisy one and with the microphone turning the room up.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TurnTaker, PauseHabit, sounds, PATIENCE, MORE_MS, WAIT_MAX, Vad } from '../../client/js/ui/voice-core.js';

const STEP = 50;
/** Runs loudness [rms, ms] pieces through it: [[event, at ms]]; on('pause') may answer with the words of that pause. */
function run(tt, seq, { words = null, wordsAfter = 500 } = {}) {
  const out = [];
  let t = 0, due = null;
  for (const [rms, ms] of seq) {
    for (let k = 0; k < ms; k += STEP, t += STEP) {
      if (due && t >= due.at) { tt.words(due.text); due = null; }
      const e = tt.step(rms, STEP);
      if (!e) continue;
      out.push([e, t]);
      if (e === 'pause' && words !== null) {
        const text = typeof words === 'function' ? words(out.filter(x => x[0] === 'pause').length) : words;
        if (text !== undefined) { tt.checking(); due = { at: t + wordsAfter, text }; }
      }
    }
  }
  return out;
}
const names = ev => ev.map(x => x[0]);
const at = (ev, name) => ev.find(x => x[0] === name)?.[1];
// talking: syllables with short dips, as speech is
const talk = ms => Array.from({ length: Math.round(ms / 250) }, () => [[0.09, 200], [0.03, 50]]).flat();
const quiet = (ms, rms = 0.002) => [[rms, ms]];

test('a slow talker who stops to think mid-sentence is not cut off (a second of quiet used to end it)', () => {
  // three pieces of one sentence with pauses of 1.4 s between them, then the real end
  const seq = [...quiet(500), ...talk(2000), ...quiet(1400), ...talk(1500), ...quiet(1400), ...talk(1800), ...quiet(3000)];
  const before = [];
  const vad = new Vad();
  for (const [rms, ms] of seq) for (let k = 0; k < ms; k += STEP) { const e = vad.step(rms, STEP); if (e) before.push(e); }
  assert.deepEqual(before, ['speech', 'end'], 'the old rule ended it at the first pause');
  const ev = run(new TurnTaker(), seq);
  assert.deepEqual(names(ev).filter(e => e === 'speech' || e === 'end'), ['speech', 'end'], 'one turn');
  const endAt = at(ev, 'end'), talkEnd = seq.slice(0, -1).reduce((n, [, ms]) => n + ms, 0);
  assert.ok(endAt >= talkEnd + PATIENCE.normal - STEP && endAt <= talkEnd + PATIENCE.normal + 200, `ended ${endAt - talkEnd} ms after the last word`);
});

test('patience: how long a pause before it answers', () => {
  for (const [p, ms] of Object.entries(PATIENCE)) {
    const ev = run(new TurnTaker({ patience: p }), [...quiet(500), ...talk(1500), ...quiet(5000)]);
    const after = at(ev, 'end') - 2000;
    assert.ok(Math.abs(after - ms) <= 150, `${p}: ${after} ms (want ${ms})`);
  }
  // a pause shorter than their patience is still their turn
  assert.deepEqual(names(run(new TurnTaker({ patience: 'relaxed' }), [...quiet(500), ...talk(1500), ...quiet(2200), ...talk(1000), ...quiet(500)])).filter(e => e !== 'pause' && e !== 'resume'), ['speech']);
});

test('their words so far: a thought left hanging waits longer, a finished one is answered after their patience', () => {
  const seq = [...quiet(500), ...talk(2000), ...quiet(3200), ...talk(1200), ...quiet(4500)];
  // "…we could go down to the harbor and" — a pause of 3.2 s, then they go on: still one turn
  const hanging = run(new TurnTaker(), seq, { words: n => (n === 1 ? 'So tomorrow we could go down to the harbor and' : 'and take the boat out.') });
  assert.deepEqual(names(hanging).filter(e => e === 'speech' || e === 'end'), ['speech', 'end']);
  assert.ok(at(hanging, 'end') > 500 + 2000 + 3200 + 1200, 'it ended after the second part');
  // the same pause after a finished sentence: the turn ends after their patience
  const done = run(new TurnTaker(), seq, { words: 'So tomorrow we could go down to the harbor.' });
  assert.ok(at(done, 'end') <= 500 + 2000 + PATIENCE.normal + 100, `ended ${at(done, 'end') - 2500} ms into the pause`);
  // a hanging thought still ends — no one waits forever
  const left = run(new TurnTaker(), [...quiet(500), ...talk(2000), ...quiet(9000)], { words: 'I think we should, um' });
  assert.ok(Math.abs(at(left, 'end') - 2500 - (PATIENCE.normal + MORE_MS)) <= 150, `${at(left, 'end') - 2500} ms`);
});

test('the words of a pause come late: the end waits for them (a little), then goes by them', () => {
  // heard 1.4 s after they were asked for (past the 1.6 s patience): the end waits, then waits more for "and"
  const ev = run(new TurnTaker(), [...quiet(500), ...talk(2000), ...quiet(3000), ...talk(1000), ...quiet(5000)], { words: n => (n === 1 ? 'and then' : 'it was fine.'), wordsAfter: 1400 });
  assert.deepEqual(names(ev).filter(e => e === 'speech' || e === 'end'), ['speech', 'end']);
  assert.ok(at(ev, 'end') > 6500);
  // they never come: it ends anyway, a moment past the usual
  const tt = new TurnTaker(), out = [];
  let t = 0;
  for (const [rms, ms] of [...quiet(500), ...talk(1500), ...quiet(6000)]) for (let k = 0; k < ms; k += STEP, t += STEP) { const e = tt.step(rms, STEP); if (e) { out.push([e, t]); if (e === 'pause') tt.checking(); } }
  const end = at(out, 'end') - 2000;
  assert.ok(end >= PATIENCE.normal && end <= PATIENCE.normal + 1600, `${end} ms`);
});

test('a pause to check comes once a pause; talking again after a real pause is a resume, learned as one of theirs', () => {
  const habit = new PauseHabit();
  const tt = new TurnTaker({ habit });
  const ev = run(tt, [...quiet(500), ...talk(1500), ...quiet(1200), ...talk(1500), ...quiet(1300), ...talk(1500), ...quiet(250), ...talk(500), ...quiet(3000)]);
  assert.deepEqual(names(ev), ['speech', 'pause', 'resume', 'pause', 'resume', 'pause', 'end'], 'a dip of a quarter second is no pause');
  assert.equal(habit.s.length, 2);
  assert.ok(habit.s.every(ms => ms >= 1100 && ms <= 1400), habit.s.join());
});

test('their habit: someone who often pauses two seconds mid-thought gets a longer wait', () => {
  const habit = new PauseHabit();
  assert.equal(habit.need(), 0, 'nothing learned yet');
  for (const ms of [1800, 2100, 1900, 2000, 2200, 1700, 2050]) habit.add(ms);
  const need = habit.need();
  assert.ok(need >= 2500 && need <= 2900, `need ${need}`);
  // a 2.3 s pause, then more: one turn with the habit, two without
  const seq = [...quiet(500), ...talk(1500), ...quiet(2300), ...talk(1500), ...quiet(4000)];
  assert.equal(names(run(new TurnTaker({ habit }), seq)).filter(e => e === 'end').length, 1);
  assert.ok(at(run(new TurnTaker({ habit }), seq), 'end') > 500 + 1500 + 2300 + 1500);
  assert.ok(at(run(new TurnTaker(), seq), 'end') < 500 + 1500 + 2300, 'without it, the pause ends it');
  // kept within bounds, and only real pauses
  const odd = new PauseHabit([100, 50000, 'x', 1000, 1000, 1000, 1000, 1000]);
  assert.equal(odd.s.length, 5);
  const big = new PauseHabit(Array(30).fill(7900));
  assert.equal(big.need(), 4800, 'never more than 4.8 s from habit');
  assert.ok(new PauseHabit(Array(60).fill(1000)).s.length === PauseHabit.KEEP);
});

test('a short word after a moment\'s hesitation ("…the harbor — and") is the turn going on; a bird\'s chirp is not', () => {
  // talking, a third of a second's hesitation, a soft short "and" (160 ms), then a long pause and more: one turn with relaxed
  const seq = [...quiet(500), ...talk(3000), ...quiet(340), [0.05, 160], ...quiet(2000), ...talk(2000), ...quiet(4000)];
  assert.equal(names(run(new TurnTaker({ patience: 'relaxed' }), seq)).filter(e => e === 'end').length, 1);
  assert.ok(at(run(new TurnTaker({ patience: 'relaxed' }), seq), 'end') > 500 + 3000 + 340 + 160 + 2000 + 2000, 'it ended after the second part');
  // chirps in the pause (50 ms each): still the pause — it ends after the patience
  const chirps = Array.from({ length: 5 }, () => [[0.004, 300], [0.06, 50]]).flat();
  const c = run(new TurnTaker(), [...quiet(500), ...talk(1500), ...chirps, ...quiet(3000)]);
  assert.ok(at(c, 'end') - 2000 <= PATIENCE.normal + 200, `${at(c, 'end') - 2000} ms`);
});

test('a real room: the microphone turns the room up in the pause, a café hums, a cough is no turn, and a turn has a limit', () => {
  // the gain turns a quiet room up as soon as they stop (0.002 → 0.016, steady): the pause runs at full speed
  const agc = run(new TurnTaker(), [...quiet(600), ...talk(1500), [0.016, 4000]]);
  assert.ok(Math.abs(at(agc, 'end') - 2100 - PATIENCE.normal) <= 150, `${at(agc, 'end') - 2100}`);
  // a café's noise is not talking
  assert.deepEqual(names(run(new TurnTaker(), [[0.03, 1500], [0.035, 3000]])), []);
  // a cough: too short to be words
  assert.deepEqual(names(run(new TurnTaker(), [...quiet(300), [0.3, 200], ...quiet(3000)])).filter(e => e !== 'pause'), ['speech', 'noise']);
  // soft words in the pause — quieter than their voice, rising and falling like talk — slow the pause's clock
  const softly = Array.from({ length: 12 }, () => [[0.03, 100], [0.004, 100]]).flat();
  const s = run(new TurnTaker(), [...quiet(600), ...talk(1500), ...softly, ...quiet(3000)]);
  assert.ok(at(s, 'end') - 2100 > PATIENCE.normal + 600, `soft words held it: ${at(s, 'end') - 2100}`);
  // talking on and on: the turn goes as it is at the limit
  const long = run(new TurnTaker({ maxMs: 10000 }), [...quiet(300), ...talk(15000)]);
  assert.deepEqual(names(long), ['speech', 'limit']);
  assert.ok(Math.abs(at(long, 'limit') - 300 - 10000) <= 200);
  // nothing ends twice
  const tt = new TurnTaker();
  run(tt, [...quiet(300), ...talk(1000), ...quiet(3000)]);
  assert.equal(tt.step(0.002, 50), null);
  tt.reset();
  assert.deepEqual(names(run(tt, [...quiet(300), ...talk(1000), ...quiet(3000)])).filter(e => e !== 'pause'), ['speech', 'end'], 'again after reset');
  assert.ok(WAIT_MAX >= PATIENCE.patient + MORE_MS);
});

test('sounds: finished, left hanging, or no telling', () => {
  for (const t of ['What are you looking at?', 'Wow!', 'We went to the harbor.', 'I see it.', '¿Qué es eso?', '你好。']) assert.equal(sounds(t), 'complete', t);
  for (const t of ['We went to the harbor and', 'and then.', 'I was thinking that,', 'So um', 'because the', 'It was — ', 'well...', 'Vamos a la playa y', 'Ich glaube, dass', 'I don\'t']) assert.equal(sounds(t), 'incomplete', t);
  for (const t of ['', null, 'we went to the harbor', 'okay']) assert.equal(sounds(t), null, String(t));
});

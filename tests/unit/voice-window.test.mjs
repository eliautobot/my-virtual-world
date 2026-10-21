// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Voice in the window, the parts without a page (client/js/ui/voice-core.js; docs/features/CHAT.md §9.4): an answer
// being written is cut into whole pieces to speak at once - sentences, list lines, whole code blocks and tables - however
// the text arrives; the requests group them; the end of someone's talking is found from the microphone's loudness.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Segmenter, takeUnits, Vad, sayable } from '../../client/js/ui/voice-core.js';

/** Feeds `text` in pieces of `step` characters, as a stream would, and returns every piece said (then the end). */
function streamed(text, step) {
  const s = new Segmenter(), out = [];
  for (let i = step; i < text.length + step; i += step) out.push(...s.feed(text.slice(0, i), false));
  out.push(...s.feed(text, true));
  return out;
}

test('an answer is said sentence by sentence as it is written, the same however it arrives', () => {
  const text = 'Sure! Here is the plan. First, we buy bread… Then we call Mia? Yes.';
  const want = ['Sure!', 'Here is the plan.', 'First, we buy bread…', 'Then we call Mia?', 'Yes.'];
  for (const step of [1, 2, 3, 7, 50, 1000]) assert.deepEqual(streamed(text, step), want, `step ${step}`);
  // a sentence is said only once it has ended: its last word may still be coming
  const s = new Segmenter();
  assert.deepEqual(s.feed('Hello there. How are y', false), ['Hello there.']);
  assert.deepEqual(s.feed('Hello there. How are you', false), []);
  assert.deepEqual(s.feed('Hello there. How are you? I', false), ['How are you?']);
  assert.deepEqual(s.feed('Hello there. How are you? I am fine', true), ['I am fine']);
});

test('lists, headings, numbers and abbreviations are not cut in the wrong place', () => {
  const text = '## Your week\n\n1. Buy bread at 3.50 each.\n2. Call Dr. Smith, e.g. after lunch.\n- Pay rent\n\nThat is all.';
  assert.deepEqual(streamed(text, 4), ['## Your week', '1. Buy bread at 3.50 each.', '2. Call Dr. Smith, e.g. after lunch.', '- Pay rent', 'That is all.']);
  assert.deepEqual(streamed('Wow!! Really?! "Quoted." Next', 3), ['Wow!!', 'Really?!', '"Quoted."', 'Next']);
  assert.deepEqual(streamed('**Bold.** Then this.', 2), ['**Bold.**', 'Then this.']);
  assert.deepEqual(streamed('你好。今天怎么样？很好', 1), ['你好。', '今天怎么样？', '很好']);
  // marks alone are not said
  assert.deepEqual(streamed('One.\n\n---\n\nTwo.', 2), ['One.', 'Two.']);
  assert.ok(!sayable('---') && !sayable('* ') && sayable('3'));
});

test('a code block and a table are one piece each, said once they are whole', () => {
  const text = 'Run this:\n\n```js\nconst a = 1.5;\nconsole.log(a); // done. Really.\n```\n\n| Day | Food |\n|---|---|\n| Mon | Soup. |\n| Tue | Rice |\n\nEnjoy.';
  const want = ['Run this:', '```js\nconst a = 1.5;\nconsole.log(a); // done. Really.\n```', '| Day | Food |\n|---|---|\n| Mon | Soup. |\n| Tue | Rice |', 'Enjoy.'];
  for (const step of [1, 5, 13, 1000]) assert.deepEqual(streamed(text, step), want, `step ${step}`);
  // an unfinished block waits (nothing from inside it is said), and goes as it is at the end
  const s = new Segmenter();
  assert.deepEqual(s.feed('Look:\n```py\nprint("a. b. c.")\n', false), ['Look:']);
  assert.deepEqual(s.feed('Look:\n```py\nprint("a. b. c.")\n', true), ['```py\nprint("a. b. c.")']);
  // a table at the very end
  assert.deepEqual(streamed('| a | b |\n|---|---|\n| 1 | 2 |', 4), ['| a | b |\n|---|---|\n| 1 | 2 |']);
});

test('a long run of words with no end yet is cut at a pause, so speaking never waits for it', () => {
  const long = `${'word, '.repeat(80)}and so on`;
  const s = new Segmenter({ soft: 120 });
  const first = s.feed(long, false);
  assert.ok(first.length >= 1 && first[0].length <= 240 && first[0].endsWith(','), first[0]);
  const rest = s.feed(long, true);
  assert.equal([...first, ...rest].join(' ').replace(/\s+/g, ' '), long.replace(/\s+/g, ' ').trim());
  // no pause at all: cut at a space once it is twice as long
  const s2 = new Segmenter({ soft: 100 }), words = 'abc '.repeat(100);
  const p = s2.feed(words, false);
  assert.ok(p.length >= 1 && p[0].length <= 200 && !/\s$/.test(p[0]));
});

test('requests: the first piece alone, then pieces together up to the limit', () => {
  const u = ['A.', 'B b.', 'C c c.', 'D'.repeat(498), 'E.'];
  assert.equal(takeUnits(u, { first: true }), 'A.');
  assert.equal(takeUnits(u), 'B b.\nC c c.');
  assert.equal(takeUnits(u), 'D'.repeat(498));
  assert.equal(takeUnits(u, { max: 500 }), 'E.');
  assert.equal(takeUnits(u), '');
  assert.equal(takeUnits(['x'.repeat(900)]), 'x'.repeat(900), 'a piece longer than the limit still goes, alone');
});

test('the end of talking: after a second of quiet that followed real words, in a quiet or a noisy room', () => {
  const run = (vad, seq) => { const ev = []; for (const [rms, ms] of seq) for (let t = 0; t < ms; t += 50) { const e = vad.step(rms, 50); if (e) ev.push([e, t]); } return ev.map(x => x[0]); };
  // a quiet room: words, a short breath (still talking), words, then quiet → speech, end
  assert.deepEqual(run(new Vad(), [[0.002, 500], [0.08, 900], [0.004, 400], [0.1, 700], [0.003, 1100]]), ['speech', 'end']);
  // a noisy room (a café): its noise is not talking; talking above it is
  assert.deepEqual(run(new Vad(), [[0.03, 1500], [0.035, 1000]]), []);
  assert.deepEqual(run(new Vad(), [[0.03, 1500], [0.2, 800], [0.03, 1100]]), ['speech', 'end']);
  // a cough: too short to be words
  assert.deepEqual(run(new Vad(), [[0.002, 300], [0.3, 200], [0.002, 1100]]), ['speech', 'noise']);
  // a click shorter than the start is nothing at all
  assert.deepEqual(run(new Vad(), [[0.002, 300], [0.3, 100], [0.002, 1500]]), []);
  // a shorter pause for a snappier conversation
  assert.deepEqual(run(new Vad({ silenceMs: 600 }), [[0.002, 200], [0.1, 600], [0.002, 650]]), ['speech', 'end']);
});

test('the end of talking in a real room: the microphone turning the room up in the pause, the world\'s sounds, birdsong - never mid-sentence', () => {
  const run = (vad, seq) => { const ev = []; for (const [rms, ms] of seq) for (let t = 0; t < ms; t += 50) { const e = vad.step(rms, 50); if (e) ev.push(e); } return ev; };
  // the browser's automatic gain turns a quiet room up as soon as the person stops (0.002 → 0.016): still a pause
  assert.deepEqual(run(new Vad(), [[0.002, 600], [0.08, 1500], [0.016, 1100]]), ['speech', 'end']);
  assert.deepEqual(run(new Vad(), [[0.002, 600], [0.08, 1500], [0.016, 900]]), ['speech'], 'not before a second of it');
  // the world's hum, and a bird chirping now and then in the pause (short blips, not words): still a pause
  const chirps = Array.from({ length: 6 }, () => [[0.012, 150], [0.06, 50]]).flat();
  assert.deepEqual(run(new Vad(), [[0.01, 600], [0.09, 1500], ...chirps, [0.012, 200]]), ['speech', 'end']);
  // … but talking again (a quarter of a second or more) is talking: the pause starts over
  assert.deepEqual(run(new Vad(), [[0.002, 600], [0.08, 1200], [0.016, 800], [0.07, 600], [0.016, 800]]), ['speech']);
  assert.deepEqual(run(new Vad(), [[0.002, 600], [0.08, 1200], [0.016, 800], [0.07, 600], [0.016, 1100]]), ['speech', 'end']);
  // a sentence with soft syllables and short breaths is never cut
  const sentence = Array.from({ length: 8 }, () => [[0.09, 250], [0.03, 150], [0.06, 200], [0.015, 300]]).flat();
  assert.deepEqual(run(new Vad(), [[0.002, 600], ...sentence]), ['speech'], 'still talking');
  // a quiet talker in a quiet room still ends
  assert.deepEqual(run(new Vad(), [[0.001, 600], [0.02, 1500], [0.002, 1100]]), ['speech', 'end']);
  // talking with a dip between every syllable (a fifth of a second of voice, a twentieth of a dip): one turn, ended by
  // the pause after it - not cut, and never taken for a blip (it is words: 'end', not 'noise')
  const syllables = Array.from({ length: 12 }, () => [[0.1, 200], [0.015, 50]]).flat();
  assert.deepEqual(run(new Vad(), [[0.002, 600], ...syllables, [0.016, 1100]]), ['speech', 'end']);
  // … and after a real pause (half a second), the same talking goes on: the pause starts over, nothing ends mid-sentence
  assert.deepEqual(run(new Vad(), [[0.002, 600], ...syllables, [0.016, 500], ...syllables, ...syllables]), ['speech']);
});

// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Who a spoken turn is for (client/js/ui/companion-voice.js): a name at the front or calling them at the end, several named
// together, the whole group, or nobody named; and the wake phrase — who it woke and the words after it.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addressed, afterWake, wakeOf, soundKey, soundsLike, heardNames } from '../../client/js/ui/companion-voice-words.js';

const NAMES = ['Sam', 'Lara', 'Kai'];

test('addressed: a companion by name, several together, the whole group, or nobody', () => {
  assert.deepEqual(addressed('Sam, what is this?', NAMES), { who: 'Sam' });
  assert.deepEqual(addressed('what do you think, sam?', NAMES), { who: 'Sam' }, 'any case; calling them at the end');
  assert.deepEqual(addressed('hey Lara look at that', NAMES), { who: 'Lara' });
  assert.deepEqual(addressed('so Kai, where to?', NAMES), { who: 'Kai' }, 'after a word to start');
  assert.deepEqual(addressed('tell me, Sam, is it far', NAMES), { who: 'Sam' }, 'the only name, in the middle');
  assert.deepEqual(addressed('Sam and Lara, what do you two think?', NAMES), { names: ['Sam', 'Lara'] });
  assert.deepEqual(addressed('Lara, Kai — come here', NAMES), { names: ['Lara', 'Kai'] });
  assert.deepEqual(addressed('Lara, did Sam say that?', NAMES), { who: 'Lara' }, 'the one at the front, not the one talked about');
  assert.deepEqual(addressed('I told Sam about it, what do you think, Kai?', NAMES), { who: 'Kai' }, 'the one called at the end');
  assert.deepEqual(addressed('everyone, listen', NAMES), { all: true });
  assert.deepEqual(addressed('what about you guys?', NAMES), { all: true });
  assert.deepEqual(addressed('what do you all think', NAMES), { all: true });
  assert.equal(addressed('what is that tree?', NAMES), null, 'nobody named: the last one spoken to');
  assert.equal(addressed('Samantha said hi', NAMES), null, 'a name inside another word is not that name');
  assert.equal(addressed('I saw Sam and Lara at the park', NAMES), null, 'two talked about, nobody called');
  assert.equal(addressed('', NAMES), null);
  assert.equal(addressed('Sam, hi', []), null, 'no companions');
});

test('the wake phrase: who it woke and what was asked after it', () => {
  assert.deepEqual(wakeOf('hey Sam, what is this', NAMES), { who: 'Sam', rest: 'what is this' });
  assert.deepEqual(wakeOf('okay lara where are we going', NAMES), { who: 'Lara', rest: 'where are we going' });
  assert.deepEqual(wakeOf('hey team, look at that', NAMES), { who: 'all', rest: 'look at that' });
  assert.deepEqual(wakeOf('hey everyone', NAMES), { who: 'all', rest: '' }, 'only the wake phrase: the question comes next');
  assert.deepEqual(wakeOf('blah blah hey Kai is it far?', NAMES), { who: 'Kai', rest: 'is it far?' }, 'what came before it is not for them');
  assert.equal(wakeOf('what is that tree', NAMES), null);
  assert.equal(wakeOf('hey Samantha', NAMES), null);
  assert.equal(afterWake('hi Sam. Lunch?', NAMES), 'Lunch?');
  assert.equal(afterWake('nothing here', NAMES), null);
});

test('names by sound: a name written as speech-to-text heard it, where a name is expected', () => {
  assert.equal(soundKey('Lara'), soundKey('Lera'));
  assert.equal(soundKey('Lara'), soundKey('Laura'));
  assert.equal(soundKey('Sam'), soundKey('Sammy'));
  assert.deepEqual(addressed('Lera, what is this?', NAMES), { who: 'Lara' }, 'Lera for Lara');
  assert.deepEqual(addressed('Simon, where are we going?', NAMES), { who: 'Sam' }, 'Simon for Sam');
  assert.deepEqual(addressed('Laura, come and look', NAMES), { who: 'Lara' }, 'Laura for Lara');
  assert.deepEqual(addressed('Sammy, is it far?', NAMES), { who: 'Sam' }, 'Sammy for Sam');
  assert.deepEqual(addressed('hey Lera look at that', NAMES), { who: 'Lara' }, 'after a greeting word');
  assert.deepEqual(addressed('ok so Lera, what now', NAMES), { who: 'Lara' }, 'after words to start');
  assert.deepEqual(addressed('what do you think, Lera?', NAMES), { who: 'Lara' }, 'called at the end');
  assert.deepEqual(addressed('Simon and Lera, what do you two think?', NAMES), { names: ['Sam', 'Lara'] }, 'several together');
  assert.deepEqual(wakeOf('hey Lera what is this', NAMES), { who: 'Lara', rest: 'what is this' });
  assert.deepEqual(wakeOf('hey Simon, lunch?', NAMES), { who: 'Sam', rest: 'lunch?' });
  // never an ordinary word, never inside another word, never someone talked about
  assert.equal(addressed('same here, it is nice', NAMES), null, 'same is not Sam');
  assert.equal(addressed('summon a taxi please', NAMES), null, 'summon is not Sam');
  assert.equal(addressed('Samantha said hi', NAMES), null, 'Samantha is not Sam');
  assert.equal(wakeOf('hey Samantha', NAMES), null);
  assert.equal(wakeOf('hey same thing again', NAMES), null);
  assert.equal(addressed('Laura said it was late', NAMES), null, 'someone talked about');
  assert.equal(addressed('I saw Laura at the park', NAMES), null, 'not where a name is expected');
  assert.equal(addressed('what do you think, summer', NAMES), null);
  for (const s of ['some people are here', 'see you later', 'sure, let us go', 'later we can eat', 'lots of cars', 'like that one', 'look at the lake', 'key lime pie', 'kind of far', 'race you there', 'so what is that', 'sound good?', 'the park is nice, right?'])
    assert.equal(addressed(s, NAMES), null, `an ordinary sentence: ${s}`);
  assert.equal(heardNames('I told Simon about it', NAMES), 'I told Simon about it', 'in the middle: left as it is');
  // only among the companions out with you, and only when exactly one name sounds like it
  assert.equal(addressed('Lera, what is this?', ['Sam', 'Kai']), null);
  assert.equal(addressed('Lera, what is this?', ['Lara', 'Laura']), null, 'two names sound like it: nobody');
  assert.deepEqual(addressed('Laura, what is this?', ['Lara', 'Laura']), { who: 'Laura' }, 'the name itself first');
  assert.equal(soundsLike('Lara', 'Lara'), false, 'the name itself is not a sound-alike');
});

// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Who answers a line said out loud to a group of companions without calling anyone by name (server/companions/companions.js
// whoAnswers, the voice row's POST /api/companions/turn): everyone hears every line, and whoever it is for answers — judged
// from the line and what was said just before it; a companion only talked about is not the one it is said to; no
// judgment, no guess (the page falls back to the one last spoken with). And the page's own reading of a name called.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Companions } from '../../server/companions/companions.js';
import { Groups } from '../../server/chat/groups.js';
import { DatabaseSync } from 'node:sqlite';
import { addressed } from '../../client/js/ui/companion-voice-words.js';

function setup(answer) {
  const recs = [{ id: 75, name: 'Lara', enabled: true, ownerId: 7 }, { id: 76, name: 'Sam', enabled: true, ownerId: 7 }, { id: 90, name: 'Zed', enabled: true, ownerId: 99 }];
  const agents = { get: id => recs.find(r => r.id === Number(id)) || null, isOwner: (P, a) => P?.account?.id === a.ownerId, canManage: () => false };
  const asked = [];
  const fw = { settingsOf: () => ({}), resolveConnection: () => ({ connection: { id: 3 } }), decideFn: async (conn, req, ms) => { asked.push({ conn, req, ms }); return answer(req); } };
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE group_turns (id INTEGER PRIMARY KEY, world_id TEXT, owner_id INTEGER, group_key TEXT, speaker TEXT, speaker_id INTEGER, speaker_name TEXT, text TEXT, at INTEGER)');
  const groups = new Groups({ db, worldId: 'w' });
  const comp = new Companions({ sim: () => null, players: { byId: new Map() }, agents, life: () => null, world: () => null, freeWill: () => fw, setting: () => undefined, principalFor: () => null });
  comp.groupsOf = () => groups;
  return { comp, groups, asked, fw, P: { account: { id: 7, displayName: 'Kim', login: 'kim' } } };
}
const pred = (name, probability) => ({ type: 'predicate', name, probability });
const first = choice => ({ type: 'choice', name: 'first', choice, confidence: 0.9 });

test('a line about Lara said to Sam: Sam answers, not Lara — judged from the line and what was just said', async () => {
  const c = setup(() => ({ answers: [pred('answers_0', 0.2), pred('answers_1', 0.92), first('a1')] }));
  const key = c.groups.key([75, 76]);
  c.groups.say(7, key, { speaker: 'person', id: 7, name: 'Kim', text: 'Lara, what are you eating?' });
  c.groups.say(7, key, { speaker: 'agent', id: 75, name: 'Lara', text: 'A croissant.' });
  const r = await c.comp.whoAnswers(c.P, [75, 76], 'Does Lara have anything on her plate? Can you tell her whether she is eating?');
  assert.deepEqual(r, { agents: [76], how: 'judged' });
  const q = c.asked[0].req;
  assert.match(q.input, /Kim is out with their AI companions Lara, Sam, all together, talking out loud: everyone hears every line/);
  assert.match(q.input, /What was said just before \(oldest first\):\nKim: Lara, what are you eating\?\nLara: A croissant\./);
  assert.match(q.input, /Kim now says: "Does Lara have anything on her plate\?/);
  assert.deepEqual(q.questions.map(x => x.name), ['answers_0', 'answers_1', 'first']);
  assert.match(q.questions[0].instructions, /^Should Lara answer this line\? .* No when it is said to someone else — even when it talks about Lara\.$/);
  assert.deepEqual(q.questions[2].choices.map(x => x.description), ['Lara', 'Sam']);
});

test('a line for both: both answer, the one it is said to most of all first; none likely: the likeliest one', async () => {
  let ans = { answers: [pred('answers_0', 0.8), pred('answers_1', 0.7), first('a1')] };
  const c = setup(() => ans);
  assert.deepEqual((await c.comp.whoAnswers(c.P, [75, 76], 'Do you like this view?')).agents, [76, 75]);
  ans = { answers: [pred('answers_0', 0.3), pred('answers_1', 0.1), first('a0')] };
  assert.deepEqual((await c.comp.whoAnswers(c.P, [75, 76], 'hmm')).agents, [75], 'the one it is said to most of all');
  // (a misheard name — "Mara" — is the judgment's to read: "So, Mara, do you like the view?")
  ans = { answers: [pred('answers_0', 0.9), pred('answers_1', 0.05), first('a0')] };
  assert.deepEqual((await c.comp.whoAnswers(c.P, [75, 76], 'So, Mara, do you like the view?')).agents, [75]);
});

test('no decision service, an error, someone else\'s agent, one companion: no guess', async () => {
  const c = setup(() => { throw Object.assign(new Error('down'), { code: 'timeout' }); });
  assert.deepEqual(await c.comp.whoAnswers(c.P, [75, 76], 'hello'), { agents: [], how: 'no_answer' });
  c.fw.resolveConnection = () => null;
  assert.deepEqual(await c.comp.whoAnswers(c.P, [75, 76], 'hello'), { agents: [], how: 'no_service' });
  assert.deepEqual(await c.comp.whoAnswers(c.P, [75, 90], 'hello'), { agents: [75], how: 'none' }, 'someone else\'s agent is not in it');
  assert.deepEqual(await c.comp.whoAnswers(c.P, [75, 76], ''), { agents: [], how: 'none' });
});

test('the page: a name called goes to them at once; a name only talked about is the judgment\'s', () => {
  const N = ['Sam', 'Lara'];
  assert.deepEqual(addressed('Sam, did you get my question?', N), { who: 'Sam' });
  assert.deepEqual(addressed('what do you think, Lara?', N), { who: 'Lara' });
  assert.deepEqual(addressed('tell me, Sam, is it far', N), { who: 'Sam' });
  assert.equal(addressed('Does Lara have anything on her plate? Can you tell her whether she is eating?', N), null, 'Lara only talked about');
  assert.equal(addressed('I think Sam would like this place', N), null);
  assert.equal(addressed('I\'m asking Sam, not you, Lara. Sam, did you get my question?', N), null, 'two called: the judgment reads it');
  assert.equal(addressed('Wow, look at this view. Do you like it?', N), null, 'nobody named: everyone heard it');
});

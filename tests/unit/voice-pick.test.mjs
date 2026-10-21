// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Every agent its own voice (server/voice/voice.js; 2026-10-08: "change the voice for every AI agent so each one has
// a unique voice, not just the default"): on whichever service speaks for an agent, the voice chosen for it, else one
// picked for it - of its character's gender, the least used by the other agents there - and kept; a character's gender
// changed, a new one; Kokoro's bare voice names read as a language, a gender and a name.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Voice } from '../../server/voice/voice.js';
import { kokoroVoice } from '../../server/providers/voice.js';

const VOICES = ['af_heart', 'af_bella', 'af_nicole', 'am_adam', 'am_michael', 'am_eric', 'am_santa', 'bf_emma', 'bm_george', 'ff_siwis'].map(kokoroVoice);

function world(people) {
  const agents = new Map(people.map((p, k) => [k + 1, { id: k + 1, key: `ag${k + 1}`, ownerId: 1, enabled: true, voice: null, fem: p.fem }]));
  let lists = 0;
  const v = new Voice({
    dbs: { worldId: 'w', db: { prepare: () => ({ get: () => undefined, run: () => {} }) } },
    agents: { list: () => [...agents.values()], get: id => agents.get(id) || null, update: (id, patch) => Object.assign(agents.get(id), patch) },
    connections: { get: () => null, secretsFor: () => ({}) }, registry: { implemented: () => true },
    host: { call: async (svc, method) => { if (method === 'voices') { lists++; return { voices: VOICES }; } throw new Error('no'); } },
    principalFor: () => ({ account: { id: 1 } }), config: () => ({}), bodyOf: a => ({ fem: a.fem }),
  });
  return { v, agents, lists: () => lists };
}
const C = { id: 6, updated: 1, config: { provider: 'openrouter' }, scope: 'installation', label: 'Platform voice' };

test('Kokoro\'s names: language, gender, a readable label', () => {
  assert.deepEqual(kokoroVoice('af_heart'), { id: 'af_heart', label: 'Heart - American English, female', lang: 'en-US', gender: 'female' });
  assert.deepEqual(kokoroVoice('bm_george'), { id: 'bm_george', label: 'George - British English, male', lang: 'en-GB', gender: 'male' });
  assert.equal(kokoroVoice('alloy'), null, 'not a Kokoro name: as the service said it');
});

test('picked for each agent: its character\'s gender, in English, none the same while there are enough', async () => {
  const { v, agents, lists } = world([{ fem: true }, { fem: true }, { fem: false }, { fem: false }, { fem: true }]);
  const got = [];
  for (const a of agents.values()) got.push(await v.autoVoice(a, C));
  const g = id => kokoroVoice(id).gender;
  assert.deepEqual(got.map(g), ['female', 'female', 'male', 'male', 'female'], `each to its character (${got.join(', ')})`);
  assert.equal(new Set(got).size, 5, 'all different');
  assert.ok(got.every(id => /^[ab]/.test(id)), 'English voices only (not French)');
  assert.equal(lists(), 1, 'the service asked for its voices once');
  // kept: asked again, the same - and not picked again
  assert.equal(await v.autoVoice(agents.get(1), C), got[0]);
  assert.deepEqual(agents.get(1).voice.auto, { 6: 'female' });
  // its character changed to a man: a man's voice now
  agents.get(1).fem = false;
  const again = await v.autoVoice(agents.get(1), C);
  assert.equal(g(again), 'male');
});

test('more agents than voices: the least used first; two first heard at once still differ', async () => {
  const { v, agents } = world(Array.from({ length: 8 }, () => ({ fem: false })));
  const all = await Promise.all([...agents.values()].map(a => v.autoVoice(a, C)));   // (all at once: one at a time per service)
  const count = new Map(); for (const id of all) count.set(id, (count.get(id) || 0) + 1);
  assert.equal(count.size, 4, 'all four English male voices used (never the Santa one)');
  assert.ok(!count.has('am_santa'));
  assert.ok([...count.values()].every(n => n === 2), `evenly: ${JSON.stringify([...count])}`);
});

test('a voice chosen for it wins; cleared, one is picked for it again', async () => {
  const { v, agents } = world([{ fem: true }]);
  const a = agents.get(1);
  a.voice = { voices: { 6: 'am_adam' } };   // (chosen in its Studio: a man's voice for a woman - its owner's choice)
  assert.equal(v.chosenVoice(v.agentVoice(a), C), 'am_adam');
  assert.equal(await v.autoVoice(a, C), 'am_adam', 'the choice stands');
  a.voice = { voices: {} };
  assert.equal(kokoroVoice(await v.autoVoice(a, C)).gender, 'female');
});

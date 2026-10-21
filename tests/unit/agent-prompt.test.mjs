// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The text a person pastes into their agent (client/js/core/agent-prompt.js; Settings → Third-party agents; 2026-09-29: users must
// be able to copy the instructions straight from the page, they have no other way to get skill.md). Pure text building: this world's
// address in front, the contract inside, the one-time code only when there is one, and nothing invented.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { agentFiles, buildAgentPrompt } from '../../client/js/core/agent-prompt.js';

const skill = fs.readFileSync(new URL('../../client/skill.md', import.meta.url), 'utf8');
const ORIGIN = 'https://world.example';

test('the public file addresses are absolute and tolerate a trailing slash', () => {
  assert.deepEqual(agentFiles(ORIGIN + '/'), {
    skill: 'https://world.example/skill.md', openapi: 'https://world.example/agent-api/openapi.json',
    node: 'https://world.example/agent-api/mvw-agent.mjs', python: 'https://world.example/agent-api/mvw_agent.py',
  });
});

test('without a code the text tells the agent to ask its owner, carries the address and the whole contract, and no code', () => {
  const t = buildAgentPrompt({ origin: ORIGIN, skill });
  assert.match(t, /My Virtual World server: https:\/\/world\.example\n/);
  assert.match(t, /Ask your owner to open Settings → Third-party agents/);
  assert.equal(/mvwe_/.test(t.replace(skill.trim(), '')), false, 'no code outside the contract text');
  assert.ok(t.includes(skill.trim()), 'the contract is inside, unchanged');
  for (const u of Object.values(agentFiles(ORIGIN))) assert.ok(t.includes(u), u);
  assert.match(t, /All paths in the contract below are under https:\/\/world\.example/);
  assert.ok(t.indexOf('----- contract') < t.indexOf(skill.trim().slice(0, 40)) && t.indexOf(skill.trim().slice(-30)) < t.indexOf('----- end of contract -----'));
});

test('with a code the text carries it, its expiry and the agent\'s name, and tells the agent what to do first', () => {
  const t = buildAgentPrompt({ origin: ORIGIN, skill, code: 'mvwe_abc123XYZ_-abc123XYZ12', expires: Date.UTC(2026, 8, 29, 21, 15), name: 'Claude Code' });
  assert.match(t, /one-time enrolment code/); assert.ok(t.includes('  mvwe_abc123XYZ_-abc123XYZ12\n'));
  assert.match(t, /called "Claude Code"/); assert.match(t, /make your own Ed25519 key pair on this machine/);
  assert.match(t, /never send it anywhere/); assert.equal(/Ask your owner to open Settings/.test(t), false, 'it does not tell the agent to ask for what it already has');
  assert.equal(t.split('mvwe_abc123XYZ_-abc123XYZ12').length, 2, 'the code appears exactly once');
});

test('the address and the contract are required: a broken copy is never handed out silently', () => {
  assert.throws(() => buildAgentPrompt({ origin: '', skill }), /address of this world/);
  assert.throws(() => buildAgentPrompt({ origin: ORIGIN, skill: '   ' }), /could not be read/);
  assert.throws(() => buildAgentPrompt({ origin: ORIGIN }), /could not be read/);
});

test('the text is plain: no markup is added and the name cannot smuggle a second code or a line break into the instruction', () => {
  const t = buildAgentPrompt({ origin: ORIGIN, skill, code: 'mvwe_x'.padEnd(27, 'x'), expires: 1, name: 'Bot' });
  assert.equal(/<\/?[a-z]/i.test(t.split('----- contract')[0]), false, 'no HTML in the part this builder writes');
  assert.equal(t.split('\n').filter(l => /enrolment code/.test(l)).length, 1);
});

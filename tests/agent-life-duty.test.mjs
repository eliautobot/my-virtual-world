// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// An agent on post and its day (2026-10-28, the product owner: a 24/7 agent reflects "if an agent had an interaction or
// activity other than working on their post ... otherwise it doesnt trigger the reflection"): a day of duty alone is not
// one to reflect on; a show on the air, a visitor, anything besides working is (server/agent-life/ livedBeyondDuty, read
// by the Mind's evening reflection). And a worry thought on duty is told it can go nowhere, and keeps only true memories
// (server/mind/prompt.js problemText: in the lab a worry wrote an afternoon in the park that never happened).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../server/db.js';
import { AgentLife } from '../server/agent-life/life.js';
import { problemText } from '../server/mind/prompt.js';

function lifeWith() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mvw-duty-')), dbs = openDb(dir);
  const life = new AgentLife({ dbs, agents: { list: () => [], listeners: new Set() }, sim: () => null });
  const add = (agent, day, kind) => life.q.addActivity.run({ $w: dbs.worldId, $a: agent, $at: Date.now(), $day: day, $time: 'Mon 9:00 AM', $kind: kind, $label: kind, $place: 'The studio', $key: null, $min: 60, $with: null });
  return { life, add, close: () => { dbs.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

test('a day of duty alone is not one to reflect on; a show, a visitor or anything besides working is', () => {
  const { life, add, close } = lifeWith();
  try {
    add(1, 10, 'post'); add(1, 10, 'post'); add(1, 11, 'work');
    assert.equal(life.livedBeyondDuty(1, 10), false, 'on duty all day: nothing to reflect on');
    add(1, 11, 'radio');
    assert.equal(life.livedBeyondDuty(1, 10), true, 'a show on the air the next morning (its life day runs from its waking)');
    add(2, 10, 'post'); add(2, 10, 'talk');
    assert.equal(life.livedBeyondDuty(2, 10), true, 'a visitor');
    assert.equal(life.livedBeyondDuty(2, 12), false, 'another day: nothing');
    // a line still in progress counts too
    life.open.set(3, { $day: 5, $kind: 'meal' });
    assert.equal(life.livedBeyondDuty(3, 5), true);
    life.open.set(4, { $day: 5, $kind: 'post' });
    assert.equal(life.livedBeyondDuty(4, 5), false);
  } finally { close(); }
});

test('a worry on duty: told it can go nowhere, no errands, and only true memories', () => {
  const base = { name: 'Sara', personality: [], likes: [], dislikes: [], aspirations: [], plans: [], memoriesShort: [], memoriesLong: [], people: [], troubles: ['Money is tight'], now: { weekday: 'Mon', clock: '9:00 AM' }, places: [], atHome: false };
  const onPost = problemText({ ...base, act: { post: true, label: 'On duty', place: 'The studio' } });
  assert.match(onPost, /ON DUTY: my owner posted me at my place of work around the clock\. I can't go anywhere today/);
  assert.match(onPost, /\(or none: on duty, none\)/);
  assert.match(onPost, /never something I only imagine doing/);
  const free = problemText({ ...base, act: { label: 'Walking', place: 'Main St' } });
  assert.doesNotMatch(free, /ON DUTY/);
  assert.match(free, /never something I only imagine doing/, 'everyone keeps only true memories');
});

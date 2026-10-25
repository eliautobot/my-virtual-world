// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The starter headquarters is a normal building (DECISIONS C103): named from the configuration (MVW_HQ_NAME), renamed
// and demolished by admins; its AI-agent residents then work at office desks.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startServer, ownerSession } from './helpers/server.mjs';

const hqOf = w => w.buildings.findIndex(b => b && !b.gone && b.type === 'hq');
const worldOf = async s => (await (await fetch(`${s.url}/api/world`)).json()).world;

test('a new city names its headquarters from MVW_HQ_NAME, "Headquarters" by default', async () => {
  const a = await startServer({ population: 60 });
  const b = await startServer({ population: 60, env: { MVW_HQ_NAME: 'Civic Centre' } });
  try {
    const wa = await worldOf(a), wb = await worldOf(b);
    assert.ok(hqOf(wa) >= 0 && hqOf(wb) >= 0, 'a new city has a headquarters');
    assert.equal(wa.buildings[hqOf(wa)].name, 'Headquarters');
    assert.equal(wa.buildings[hqOf(wa)].sign, 'Headquarters');
    assert.equal(wb.buildings[hqOf(wb)].name, 'Civic Centre');
    assert.equal(wb.buildings[hqOf(wb)].sign, 'Civic Centre');
  } finally {
    await a.stop();
    await b.stop();
  }
});

test('admins rename and demolish the headquarters; its AI agents move to office desks', async () => {
  const s = await startServer({ population: 150, agents: 3 });
  try {
    const owner = await ownerSession(s);
    const job = async i => {   // an agent's details answer once it has a plan (right after an edit it may be re-planning)
      for (let k = 0; k < 60; k++) {
        const r = await owner.get(`/api/agent/${i}`);
        if (r.status === 200) return r.json.job;
        await new Promise(res => setTimeout(res, 50));
      }
      throw new Error(`no details for agent ${i}`);
    };
    const w0 = (await owner.get('/api/world')).json.world, hq = hqOf(w0);
    const roster = (await owner.get('/api/roster')).json.roster;
    assert.equal(roster.length, 3);
    for (const a of roster) assert.equal((await job(a.i)).b, hq, `${a.name} starts at the headquarters`);
    let r = await owner.post('/api/edit', { ops: [{ op: 'bld.set', b: hq, name: 'Town Hall', sign: 'Town Hall' }] });
    assert.equal(r.status, 200, r.text);
    r = await owner.post('/api/edit', { ops: [{ op: 'bld.del', b: hq }] });
    assert.equal(r.status, 200, r.text);
    const w1 = (await owner.get('/api/world')).json.world;
    assert.equal(w1.buildings[hq].name, 'Town Hall');
    assert.ok(w1.buildings[hq].gone, 'demolished');
    for (const a of roster) {
      let j = await job(a.i);   // (an agent's next work: from the settling that follows the edit, near its owner, server/index.mjs)
      for (let k = 0; k < 40 && j.kind === 'free'; k++) { await new Promise(res => setTimeout(res, 250)); j = await job(a.i); }
      assert.notEqual(j.b, hq, `${a.name} no longer works at the demolished headquarters`);
      assert.equal(j.kind, 'vip');
      assert.equal(w1.buildings[j.b].type, 'office', `${a.name} works at an office desk`);
    }
  } finally {
    await s.stop();
  }
});

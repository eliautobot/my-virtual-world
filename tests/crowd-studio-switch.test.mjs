// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The Crowd Studio (client/dev/crowd-studio.html) is there only where it is switched on: MVW_CROWD_STUDIO=1
// (server/config.js), off by default. Off, its pages are not found, the crowd's tuning and its bake can't be changed —
// not even by the owner —, and everyone still sees the crowd drawn with the tuning in use (the release's own).
import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer, ownerSession } from './helpers/server.mjs';

for (const on of [false, true]) {
  test(`the Crowd Studio ${on ? 'switched on (MVW_CROWD_STUDIO=1): there, for the owner' : 'off (the default): no page, no change, by anyone'}`, async () => {
    const s = await startServer({ env: on ? { MVW_CROWD_STUDIO: '1' } : {} });
    try {
      const owner = await ownerSession(s);
      const page = await fetch(`${s.url}/dev/crowd-studio.html`), script = await fetch(`${s.url}/dev/crowd-studio.js`);
      const tuning = await fetch(`${s.url}/api/crowd/tuning`);
      assert.equal(tuning.status, 200, 'the tuning in use is read by every page that draws the crowd');
      const t = await tuning.json();
      assert.ok(Object.keys(t.clips?.m || {}).length >= 50, 'the release\'s tuning: the men\'s animation fixes');
      const saved = await owner.post('/api/crowd/tuning', { rig: { m: { shoulders: [6, 0, 0] } } });
      const bake = await owner.get('/api/crowd/bake');
      if (on) {
        assert.equal(page.status, 200); assert.equal(script.status, 200);
        assert.equal(saved.status, 200); assert.equal(bake.status, 200);
      } else {
        assert.equal(page.status, 404, 'its page is not there'); assert.equal(script.status, 404);
        assert.equal((await fetch(`${s.url}/vendor/meshopt/index.js`)).status, 404, 'nor what only it uses');
        assert.equal(saved.status, 405, 'the tuning can\'t be changed, not even by the owner (only read: GET)');
        assert.equal(bake.status, 404);
        assert.equal((await owner.post('/api/crowd/bake', { action: 'start' })).status, 404, 'nor the crowd baked again');
        assert.deepEqual((await (await fetch(`${s.url}/api/crowd/tuning`)).json()).clips, t.clips, 'nothing changed');
      }
    } finally { await s.stop(); }
  });
}

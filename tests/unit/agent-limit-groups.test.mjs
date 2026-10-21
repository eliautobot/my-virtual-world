// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Settings → Agent limits (client/js/ui/agent-limit-groups.js; 2026-10-11): every limit on agents is controlled in one
// place — each listed setting exists and is an administrator's, none is listed twice, and no setting about agents talking,
// acting or spending is left only on the General tab.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SETTINGS } from '../../server/settings.js';
import { AGENT_LIMIT_SECTIONS, AGENT_LIMIT_PATHS } from '../../client/js/ui/agent-limit-groups.js';

test('each setting on the page exists, is the admin\'s, and is listed once', () => {
  const byPath = new Map(SETTINGS.map(s => [s.path, s]));
  const listed = AGENT_LIMIT_SECTIONS.flatMap(s => [...s.main, ...(s.advanced || [])].map(([p]) => p));
  assert.equal(listed.length, new Set(listed).size, 'no setting twice');
  for (const p of listed) {
    assert.ok(byPath.has(p), `no such setting: ${p}`);
    assert.equal(byPath.get(p).scope, 'install', p);
  }
  for (const sec of AGENT_LIMIT_SECTIONS) assert.ok(sec.main.length && sec.main.length <= 8, `${sec.title}: a few main settings, the rest under Advanced`);
});

test('no limit on agents is left only on the General tab', () => {
  const AGENTISH = /^(talk|social|connected|connector)\.|^mind\.(speech|chatPerDay|dailyUsd|agentMonthlyUsd|agentDailyJobs)|^freeWill\.(dailyDecisions|agentDailyDecisions)$/;
  for (const s of SETTINGS) if (s.scope === 'install' && AGENTISH.test(s.path)) assert.ok(AGENT_LIMIT_PATHS.has(s.path), `${s.path} is not on Agent limits`);
});

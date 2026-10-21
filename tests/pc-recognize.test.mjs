// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// What a step works on (server/pc/recognize.js) and an Agent Providers' agent's screen following it
// (server/pc/provider-screens.js, os.screen's hold): docs/features/agent-pc.md §2.2.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { recognize, finish, readText, planBoard } from '../server/pc/recognize.js';
import { ProviderScreens } from '../server/pc/provider-screens.js';
import { HOLD_MS } from '../server/pc/os.js';
import { PROVIDER_PREFIX } from '../server/agent-providers.js';

const exec = cmd => recognize({ name: 'exec', toolKind: 'execute', input: cmd });

test('a terminal command that drives a browser is browsing; one that reads or writes a file is that file', () => {
  let c = exec('agent-browser --cdp 9222 open https://news.ycombinator.com');
  assert.equal(c.app, 'browser'); assert.equal(c.view.kind, 'page'); assert.equal(c.view.provider, true); assert.equal(c.view.url, 'https://news.ycombinator.com');
  assert.equal(exec('agent-browser --cdp 9222 snapshot -i').app, 'browser', 'a step without an address: still its browser');
  assert.equal(exec('npx playwright screenshot https://a.example b.png').app, 'browser');
  // (agent-browser's own build by its full path, with its provider's words for the step - a real agent, 2026-10-19)
  const AB = '~/.npm-global/lib/node_modules/agent-browser/bin/agent-browser-linux-x64';
  c = recognize({ name: 'exec', toolKind: 'execute', title: 'Exec Open project picker', input: JSON.stringify({ command: `${AB} snapshot -c -s '[aria-labelledby="AddTime"]'` }) });
  assert.deepEqual([c.app, c.view.kind, c.view.provider, c.title], ['browser', 'page', true, 'Exec Open project picker']);
  assert.equal(exec(`cd /tmp && ${AB} click "button Add"`).app, 'browser');
  assert.equal(exec('node ~/.npm-global/lib/node_modules/agent-browser/dist/cli.js open https://example.com').view.url, 'https://example.com');
  c = exec('cd /srv && sed -n 120,175p server/pc/shell.js');
  assert.equal(c.app, 'files'); assert.deepEqual([c.view.kind, c.view.mode, c.view.path, c.view.first, c.view.remote], ['file', 'read', 'server/pc/shell.js', 120, true]);
  c = exec("cat > /tmp/notes.md <<'EOF'\n# Notes\n- one\nEOF");
  assert.deepEqual([c.app, c.view.mode, c.view.path], ['files', 'write', '/tmp/notes.md']);
  assert.deepEqual(c.view.lines, ['# Notes', '- one']); assert.deepEqual(c.view.hl, [1, 2]);
  c = exec('grep -rn "tool.start" server/providers | head');
  assert.deepEqual([c.app, c.view.kind, c.view.query], ['files', 'find', 'tool.start']);
  c = exec('git diff client/js/render/pc-draw.js');
  assert.deepEqual([c.app, c.view.mode, c.title], ['files', 'review', 'Reviewing pc-draw.js']);
  assert.equal(exec('ls -la ~/Projects').view.kind, 'folder');
});

test('a step no app claims is the terminal\'s: a build, a script, an API call on its own machine', () => {
  for (const cmd of ['npm run build && cat out.log', 'python3 train.py --epochs 3', 'curl -s -X POST http://127.0.0.1/api/x -d {}', 'curl -s http://localhost/health', 'timeout 60 node tools/check.mjs']) {
    const c = exec(cmd);
    assert.equal(c.app, 'terminal', cmd); assert.equal(c.view, undefined);
    assert.equal(c.title, cmd);
  }
  assert.equal(recognize({ name: 'process', toolKind: 'execute', input: '{"action":"poll"}' }).app, 'terminal');
});

test('file, web, picture, calendar, task and message tools: each its app, with its window', () => {
  let c = recognize({ name: 'read', toolKind: 'read', input: '{"path":"/w/src/app.js","offset":40,"limit":20}' });
  assert.deepEqual([c.app, c.view.mode, c.view.first, c.title], ['files', 'read', 40, 'Reading app.js']);
  c = recognize({ name: 'read_file', toolKind: 'read', title: 'Read file', input: 'notes/todo.md' });
  assert.deepEqual([c.view.path, c.title], ['notes/todo.md', 'Reading todo.md'], "Hermes' short context: the file");
  c = recognize({ name: 'edit', toolKind: 'edit', input: '{"path":"src/a.js","oldText":"x = 1","newText":"x = 2\\ny = 3"}' });
  assert.deepEqual([c.view.mode, c.view.lines, c.view.hl], ['edit', ['x = 2', 'y = 3'], [1, 2]]);
  c = recognize({ name: 'write', toolKind: 'edit', input: '{"path":"docs/plan.md","content":"# Plan\\nstep one\\nstep tw' });
  assert.deepEqual([c.view.mode, c.view.lines], ['write', ['# Plan', 'step one', 'step tw']], 'arguments cut short: what came whole');
  c = recognize({ name: 'browser', toolKind: 'fetch', input: '{"action":"navigate","targetUrl":"https://github.com/openclaw"}' });
  assert.deepEqual([c.app, c.view.provider, c.view.url], ['browser', true, 'https://github.com/openclaw']);
  c = recognize({ name: 'web_search', toolKind: 'search', input: '{"query":"weather miami"}' });
  assert.deepEqual([c.app, c.view.kind, c.view.query], ['browser', 'web', 'weather miami']);
  assert.equal(recognize({ name: 'web_search', toolKind: 'search', input: 'weather' }).view.kind, 'web', 'a one-word query is not a file');
  c = recognize({ name: 'web_fetch', toolKind: 'fetch', input: '{"url":"https://docs.example.org/x"}' });
  assert.deepEqual([c.app, c.view.kind, c.view.remote], ['browser', 'page', true]);
  c = recognize({ name: 'image', input: '{"image":"/tmp/shot.png","prompt":"what is this"}' });
  assert.deepEqual([c.app, c.view.kind, c.view.name], ['files', 'image', 'shot.png']);
  c = recognize({ name: 'exec', toolKind: 'execute', input: 'gog calendar events --from today' });
  assert.deepEqual([c.app, c.view.kind, c.view.app], ['calendar', 'text', 'calendar']);
  c = recognize({ name: 'todo', toolKind: 'think', input: '{"todos":[{"id":"1","content":"Read the spec","status":"completed"},{"id":"2","content":"Write it","status":"in_progress"}]}' });
  assert.deepEqual([c.app, c.view.kind, c.view.cards.map(k => k.col)], ['board', 'board', ['done', 'doing']]);
  c = recognize({ name: 'message', input: '{"action":"send","channel":"discord","target":"#general","message":"Deployed v2"}' });
  assert.deepEqual([c.app, c.view.kind, c.view.text], ['chat', 'chat', 'Deployed v2']);
  assert.equal(recognize({ name: 'mvw__pc', input: '{"command":"ls ~"}' }), null, 'MVW\'s own PC as a tool: it shows that itself');
});

test('a step\'s result fills its window in: the file it read (its own numbers taken off), what it found, what it fetched', () => {
  const c = recognize({ name: 'read', toolKind: 'read', input: '{"path":"/w/app.js","offset":40}' });
  const v = finish(c, { ok: true, text: '40\tconst a = 1;\n41\tconst b = 2;\n' });
  assert.deepEqual([v.first, v.lines, v.total], [40, ['const a = 1;', 'const b = 2;'], 41]);
  assert.deepEqual(readText('plain\ntext'), { text: 'plain\ntext', first: 1 });
  assert.deepEqual(readText('1|one line file'), { text: 'one line file', first: 1 }, 'a one-line file, numbered from where it was read');
  assert.equal(readText('2026: a year').text, '2026: a year', 'a number that is the text itself stays');
  const g = finish(exec('grep -rn foo src'), { ok: true, text: 'src/a.js:12:  foo()\nsrc/b.js:3:foo' });
  assert.deepEqual(g.results.map(r => [r.path, r.snippet]), [['src/a.js', 'foo()'], ['src/b.js', 'foo']]);
  const l = finish(exec('ls -la ~/x'), { ok: true, text: 'total 8\ndrwxr-xr-x 2 u u 4096 Oct 19 12:00 docs\n-rw-r--r-- 1 u u 120 Oct 19 12:00 a.md\n' });
  assert.deepEqual(l.entries, [{ name: 'docs', dir: true, size: 4096 }, { name: 'a.md', dir: false, size: 120 }]);
  const d = finish(exec('git diff a.js'), { ok: true, text: '--- a/a.js\n+++ b/a.js\n@@ -1 +1 @@\n-x\n+y' });
  assert.equal(d.diff, true); assert.equal(d.lines.length, 5);
  assert.equal(finish(exec('cat missing.txt'), { ok: false, text: 'No such file' }), null, 'a failed read leaves its window as it was');
  assert.equal(planBoard([{ step: 'One', status: 'completed' }, { step: 'Two', status: 'in_progress' }]).cards[1].col, 'doing');
});

/** A provider agent's screens, driven by bus events; its PC records what it shows (os.screen's own rules). */
function rig() {
  let now = 1_000_000;
  const shown = [];
  let prev = null;
  const pc = {
    agents: new Map([[7, { id: 7, key: `${PROVIDER_PREFIX}openclaw:c:flo` }]]),
    // (os.screen's hold, as it is there)
    screen(agent, app, title, detail, o = {}) {
      const soft = !!o.soft || (!o.view && !!o.log?.length);
      if (soft && prev && !prev.soft && prev.view && prev.view.kind !== 'terminal' && now - prev.at < HOLD_MS) { shown.push({ held: true, app, title }); return; }
      prev = { app, title, view: o.view || (o.log?.length ? { kind: 'terminal' } : prev?.view || null), at: now, soft };
      shown.push({ ...prev });
    },
  };
  const ps = new ProviderScreens({ pc, agentOf: e => (e.agentKey === 'flo' ? pc.agents.get(7) : null), now: () => now });
  return { ps, shown, later: ms => { now += ms; }, ev: e => ps.on({ kind: 'openclaw', connectionId: 'c', agentKey: 'flo', runId: 'r1', ...e }) };
}

test('a provider\'s step named before its arguments shows once they come; a quick command never covers its browser', () => {
  const { shown, later, ev } = rig();
  ev({ type: 'tool.start', toolId: 't1', name: 'exec', toolKind: 'execute' });
  assert.equal(shown.length, 0, 'nothing to see before its arguments');
  ev({ type: 'tool.update', toolId: 't1', input: 'agent-browser --cdp 9222 open https://example.com' });
  assert.deepEqual([shown.at(-1).app, shown.at(-1).view.kind], ['browser', 'page']);
  ev({ type: 'tool.end', toolId: 't1', ok: true, text: '✓ opened' });
  later(500);
  ev({ type: 'tool.start', toolId: 't2', name: 'exec', toolKind: 'execute', input: 'sleep 2 && date' });
  later(500);
  ev({ type: 'tool.end', toolId: 't2', ok: true, text: 'Mon Oct 19' });
  later(500);
  ev({ type: 'run.progress', text: 'Now clicking the sign-in button' });
  assert.ok(shown.slice(1).every(s => s.held), 'the terminal step and its words between steps went to its terminal');
  later(HOLD_MS);
  ev({ type: 'tool.start', toolId: 't3', name: 'exec', toolKind: 'execute', input: 'npm run build' });
  assert.equal(shown.at(-1).app, 'terminal', 'a while later, a build is the work');
  later(500);
  ev({ type: 'tool.start', toolId: 't4', name: 'read', toolKind: 'read', input: '{"path":"/w/notes.md"}' });
  later(500);
  ev({ type: 'tool.end', toolId: 't4', ok: true, text: '# Notes\nhello' });
  assert.deepEqual([shown.at(-1).app, shown.at(-1).view.kind, shown.at(-1).view.lines], ['files', 'file', ['# Notes', 'hello']], 'the file it read, with its text');
});

test('its work elsewhere is followed only while its owner watches its screen, and only its busy sessions', async () => {
  const { ScreenWatch, LEASE_MS } = await import('../server/pc/screen-watch.js');
  let now = 5_000_000;
  const calls = [];
  const flo = { id: 7, key: `${PROVIDER_PREFIX}openclaw:c:flo` }, mine = { id: 8, key: 'built-in' }, theirs = { id: 9, key: `${PROVIDER_PREFIX}openclaw:c:zed` };
  const pc = { agents: new Map([[7, flo], [8, mine], [9, theirs]]), accountOf: a => (a.id === 9 ? 20 : 10) };
  const listeners = [];
  const sw = new ScreenWatch({ pc, follow: async (P, id, key) => { calls.push([P.account.id, id, key]); return true; }, agentOf: e => (e.agentKey === 'flo' ? flo : null), now: () => now })
    .start({ on: f => { listeners.push(f); return () => {}; } });
  const bus = e => listeners.forEach(f => f({ kind: 'openclaw', connectionId: 'c', ...e }));
  try {
    bus({ type: 'agent.activity', agentKey: 'flo', active: true, keys: ['agent:flo:discord:1'] });
    assert.equal(calls.length, 0, 'nobody watching: nothing followed');
    const P = { account: { id: 10 } };
    assert.deepEqual(sw.lease(P, [7, 8, 9]).watching, [7], 'its owner\'s provider agents only');
    await Promise.resolve();
    assert.deepEqual(calls, [[10, 7, 'agent:flo:discord:1']]);
    bus({ type: 'agent.activity', agentKey: 'flo', active: true, keys: ['agent:flo:discord:1', 'agent:flo:cron:2'] });
    await Promise.resolve();
    assert.deepEqual(calls.map(c => c[2]), ['agent:flo:discord:1', 'agent:flo:cron:2'], 'a new busy session: followed at once, the other not again yet');
    now += 61000; sw.tick(); await Promise.resolve();
    assert.equal(calls.length, 4, 'both followed again before their follow lapses');
    now += LEASE_MS; sw.tick(); await Promise.resolve();
    assert.equal(calls.length, 4, 'the page stopped watching: let go');
  } finally { sw.stop(); }
});

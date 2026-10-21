#!/usr/bin/env node
// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The agents' PC under load through the real server (docs/features/agent-pc.md): a throwaway server with its city
// running, `accounts` accounts with `agents` agents each and `files` files in every home; then `workers` clients at once
// for `seconds` seconds, each as its own account, doing what people and agents do on a PC — list a folder, read a file,
// save one, search, the task board, a few commands at once on the command line. Reports each kind's time (median, 95th,
// 99th percentile), requests a second, errors, the server's memory, and how late the city's ticks (10 a second) started —
// idle first for as long, then under the load — so the PC is seen not to hold the world up — and its memory every 10 s.
//   node tools/pc-http-stress.mjs [--accounts 12] [--agents 3] [--files 20] [--workers 40] [--seconds 60] [--population 1500]
import { parseArgs } from 'node:util';
import { startServer, ownerSession, userSession } from './lib/testserver.mjs';

const { values: o } = parseArgs({ options: {
  accounts: { type: 'string', default: '12' }, agents: { type: 'string', default: '3' }, files: { type: 'string', default: '20' },
  workers: { type: 'string', default: '40' }, seconds: { type: 'string', default: '60' }, population: { type: 'string', default: '1500' },
} });
const ACC = +o.accounts, AG = +o.agents, FILES = +o.files, WORKERS = +o.workers, SECS = +o.seconds;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rnd = n => Math.floor(Math.random() * n);
const stats = arr => { const s = [...arr].sort((a, b) => a - b), q = p => (s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0); return { n: s.length, p50: +q(0.5).toFixed(1), p95: +q(0.95).toFixed(1), p99: +q(0.99).toFixed(1), max: +(s.at(-1) || 0).toFixed(1) }; };
const words = ['report', 'invoice', 'meeting', 'client', 'budget', 'plan', 'schedule', 'marketing', 'sales', 'design', 'review', 'weekly', 'summary', 'notes', 'project'];
const para = n => Array.from({ length: n }, () => words[rnd(words.length)]).join(' ');

const s = await startServer({ population: +o.population, agents: 0 });
const out = {};
try {
  const owner = await ownerSession(s);
  // members may add agents of their own (the owner's choice), so every account has a PC with agents
  await owner.post('/api/permissions', { cap: 'agents.manage', min: 'member' });
  const people = [];
  const t0 = Date.now();
  for (let i = 0; i < ACC; i++) {
    const c = i === 0 ? owner : await userSession(s, owner, { login: `load${i}`, displayName: `Load ${i}`, role: 'member' });
    const agents = [];
    for (let k = 0; k < AG; k++) {
      const r = await c.post('/api/agents', { name: `Worker ${i}-${k}`, role: 'Clerk' });
      if (r.status !== 200) throw new Error(`agent: ${r.status} ${r.text.slice(0, 200)}`);
      agents.push(r.json.id);
    }
    for (const a of agents) for (let f = 0; f < FILES; f++) await c.post('/api/pc/write', { profile: a, path: `~/Documents/file-${f}.md`, text: `# File ${f}\n\n${para(120 + rnd(400))}` });
    for (const a of agents) for (let k = 0; k < 5; k++) await c.post('/api/pc/cards', { profile: a, path: '~', title: `Task ${k} ${para(4)}` });
    people.push({ c, agents });
  }
  out.seed = { accounts: ACC, agents: ACC * AG, files: ACC * AG * FILES, seconds: +((Date.now() - t0) / 1000).toFixed(1) };
  console.error(`seeded ${ACC * AG} agents, ${ACC * AG * FILES} files in ${out.seed.seconds} s; idle ${SECS} s…`);

  const health = async () => (await owner.get('/api/health')).json;
  await sleep(SECS * 1000);   // (the tick record holds the last 60 s: idle, with the city running)
  const idle = await health();
  out.idle = { late: idle.loop.late, sim: idle.loop.sim, rssMb: idle.loop.rssMb };
  console.error(`load: ${WORKERS} clients for ${SECS} s…`);

  const ms = new Map(), errors = [];
  const OPS = [
    ['ls', 30, (p, a) => p.c.get(`/api/pc/ls?profile=${a}&path=${encodeURIComponent('~/Documents')}`)],
    ['read', 25, (p, a) => p.c.get(`/api/pc/text?profile=${a}&path=${encodeURIComponent(`~/Documents/file-${rnd(FILES)}.md`)}`)],
    ['write', 15, (p, a) => p.c.post('/api/pc/write', { profile: a, path: `~/Documents/file-${rnd(FILES)}.md`, text: `# Changed\n\n${para(200)}`, force: true })],
    ['find', 10, (p, a) => p.c.get(`/api/pc/find?profile=${a}&q=${words[rnd(words.length)]}`)],
    ['board', 10, (p, a) => p.c.get(`/api/pc/board?profile=${a}&path=~`)],
    ['shell', 10, (p, a) => p.c.post('/api/pc/shell', { agent: a, session: `load${rnd(4)}`, run: `ls ~/Documents\nread ~/Documents/file-${rnd(FILES)}.md\ntasks\nfind ${words[rnd(words.length)]}` })],
  ];
  const total = OPS.reduce((n, x) => n + x[1], 0);
  const pick = () => { let r = rnd(total); for (const x of OPS) { if ((r -= x[1]) < 0) return x; } return OPS[0]; };
  const end = Date.now() + SECS * 1000;
  let n = 0;
  // (the server's memory every 10 s of the load: it should level off, not climb)
  const rss = [];
  const sampler = setInterval(() => { health().then(h => rss.push(h.loop.rssMb), () => {}); }, 10000);
  await Promise.all(Array.from({ length: WORKERS }, async (_, w) => {
    const p = people[w % people.length];
    while (Date.now() < end) {
      const [name, , fn] = pick(), a = p.agents[rnd(p.agents.length)];
      const t = performance.now();
      let r;
      try { r = await fn(p, a); } catch (e) { errors.push(`${name}: ${e.message}`); continue; }
      (ms.get(name) || ms.set(name, []).get(name)).push(performance.now() - t);
      n++;
      if (r.status >= 300) errors.push(`${name}: ${r.status} ${r.text.slice(0, 120)}`);
    }
  }));
  clearInterval(sampler);
  const loaded = await health();
  await sleep(15000);
  const after = await health();
  out.load = { requests: n, perSecond: Math.round(n / SECS), errors: errors.length, firstErrors: errors.slice(0, 5), ms: Object.fromEntries([...ms].map(([k, v]) => [k, stats(v)])),
    late: loaded.loop.late, sim: loaded.loop.sim, rssMb: loaded.loop.rssMb, rssEvery10s: rss, rssMb15sAfter: after.loop.rssMb };
  const pc = (await owner.get('/api/pc')).json;
  out.storage = { ownerUsedMB: +(pc.usage.used / 1048576).toFixed(2) };
} finally {
  await s.stop();
}
console.log(JSON.stringify(out, null, 1));

// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Stress run for the agents' PC (docs/features/agent-pc.md): thousands of agents, each with its home, files of every
// kind, tasks and events, in many accounts with teams — then agents at work through the command line. Measures how long
// each kind of command takes (median, 95th percentile), commands per second, memory, and the disk taken against the
// bytes the files hold (contents stored once and compressed), and checks every space's count of bytes.
//   node tools/pc-stress.mjs [agents=5000] [files=12] [perAccount=10]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { PcOS } from '../server/pc/os.js';
import { PcShell } from '../server/pc/shell.js';

const AGENTS = Number(process.argv[2]) || 5000, FILES = Number(process.argv[3]) || 12, PER = Number(process.argv[4]) || 10;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mvw-pc-stress-'));
const rows = Array.from({ length: AGENTS }, (_, i) => ({ id: i + 1, name: `Agent${i + 1}`, role: 'Worker', ownerId: 1000 + Math.floor(i / PER) }));
const byId = new Map(rows.map(a => [a.id, a]));
const agents = { list: () => rows, get: id => byId.get(Number(id)) || null };
const pc = new PcOS({ dir, agents, ownerAccount: () => 1000, limits: () => ({ agentMB: 200, teamMB: 500 }) });
const mb = () => +(process.memoryUsage().rss / 1048576).toFixed(1);
const timings = new Map();
const time = (k, fn) => { const t0 = process.hrtime.bigint(); const r = fn(); const ms = Number(process.hrtime.bigint() - t0) / 1e6; (timings.get(k) || timings.set(k, []).get(k)).push(ms); return r; };
const rnd = n => Math.floor(Math.random() * n);
const words = ['report', 'invoice', 'meeting', 'client', 'budget', 'plan', 'schedule', 'dental', 'marketing', 'sales', 'design', 'review', 'weekly', 'summary', 'notes', 'project'];
const para = n => Array.from({ length: n }, () => words[rnd(words.length)]).join(' ');
const sharedPdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), crypto.randomBytes(300 * 1024)]);   // one brochure many agents keep
const rss0 = mb(), t0 = Date.now();
console.error(`stress: ${AGENTS} agents in ${Math.ceil(AGENTS / PER)} accounts, ${FILES} files each, in ${dir}`);

// 1. homes, files, tasks, events
let logical = 0, files = 0;
for (const a of rows) {
  const who = { agent: a.id };
  for (let f = 0; f < FILES; f++) {
    let p, body;
    const k = f % 6;
    if (k === 0) { p = `~/Documents/notes-${f}.md`; body = `# Notes ${f}\n\n${para(200 + rnd(800))}`; }
    else if (k === 1) { p = `~/Documents/Reports/report-${f}.md`; body = `# Report\n${para(1500 + rnd(2000))}`; }
    else if (k === 2) { p = `~/Documents/data-${f}.csv`; body = Array.from({ length: 300 }, (_, r) => `${r},${words[r % words.length]},${rnd(9999)}`).join('\n'); }
    else if (k === 3) { p = `~/Downloads/brochure-${f}.pdf`; body = sharedPdf; }
    else if (k === 4) { p = `~/Skills/skill-${f}.md`; body = `How to ${words[rnd(words.length)]}\n1. ${para(30)}\n2. ${para(30)}`; }
    else { p = `~/Downloads/photo-${f}.jpg`; body = crypto.randomBytes(20 * 1024 + rnd(60 * 1024)); }
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
    time('write', () => pc.write(who, p, buf));
    logical += buf.length; files++;
  }
  for (let c = 0; c < 5; c++) time('task add', () => pc.addCard(who, '~', { title: `${words[rnd(words.length)]} ${c}` }));
  for (let e = 0; e < 3; e++) { const s = Date.now() + rnd(30) * 86400000; time('event add', () => pc.addEvent(who, '~', { title: `Meeting ${e}`, start: s, end: s + 3600000 })); }
}
const built = Date.now() - t0;
const rssBuilt = mb();
// teams: one per account with every agent of it in
const accounts = [...new Set(rows.map(a => a.ownerId))];
for (const acc of accounts) {
  const t = pc.createTeam({ human: acc }, { name: 'Team' });
  for (const a of rows.filter(x => x.ownerId === acc)) pc.setMember({ human: acc }, t.id, a.id, 'member');
  pc.write({ agent: rows.find(x => x.ownerId === acc).id }, '/teams/team/handbook.md', `# Handbook\n${para(1000)}`);
}

const rssTeams = mb();
// 2. agents at work: random agents running batches through the command line
const tz = 'America/New_York';
const names = t => t;
const W = Math.min(2000, AGENTS);
const tw = Date.now();
let cmds = 0;
for (let i = 0; i < W; i++) {
  const a = rows[rnd(AGENTS)];
  const sh = new PcShell(pc, { who: { agent: a.id }, tz, names });
  const batch = ['ls ~/Documents', `read ~/Documents/notes-0.md`, `find ${words[rnd(words.length)]}`, 'tasks', 'cal week',
    `write ~/Documents/work-${i}.md`, `task add "Follow up ${i}" --due "tomorrow 9am"`, 'ls /teams/team', 'read /teams/team/handbook.md'];
  for (const line of batch) {
    const t1 = process.hrtime.bigint();
    // (the shell is async for the browser's sake; these commands finish at once)
    await sh.run(line, line.startsWith('write') ? { text: `# Work ${i}\n${para(300)}` } : {});
    const ms = Number(process.hrtime.bigint() - t1) / 1e6;
    (timings.get(`$ ${line.split(' ')[0]}`) || timings.set(`$ ${line.split(' ')[0]}`, []).get(`$ ${line.split(' ')[0]}`)).push(ms);
    cmds++;
  }
}
const workMs = Date.now() - tw;
const rssWork = mb();

// 3. the upkeep, and the counts checked
const tg = Date.now();
const gc = pc.gc();
const gcMs = Date.now() - tg;
const bad = pc.recount().filter(r => r.used !== r.counted);
const size = f => { try { return fs.statSync(f).size; } catch { return 0; } };
const dbBytes = size(path.join(dir, 'pc.db')) + size(path.join(dir, 'pc.db-wal'));
const store = pc.blobs.totals();
const stats = arr => { const s = [...arr].sort((x, y) => x - y); return { n: s.length, p50: +s[Math.floor(s.length / 2)].toFixed(3), p95: +s[Math.floor(s.length * 0.95)].toFixed(3), max: +s[s.length - 1].toFixed(2) }; };
const out = {
  agents: AGENTS, accounts: accounts.length, files, buildSeconds: +(built / 1000).toFixed(1),
  logicalMB: +(logical / 1048576).toFixed(1), diskMB: +((dbBytes + (store.kept - 0)) / 1048576).toFixed(1), dbMB: +(dbBytes / 1048576).toFixed(1),
  storeContents: store.files, savedByDedupAndCompression: `${Math.round((1 - (dbBytes + store.kept) / logical) * 100)} %`,
  perAgentDiskKB: Math.round((dbBytes + store.kept) / AGENTS / 1024),
  work: { commands: cmds, seconds: +(workMs / 1000).toFixed(1), perSecond: Math.round(cmds / (workMs / 1000)) },
  gc: { ms: gcMs, ...gc }, countsWrong: bad.length,
  rssMB: { start: rss0, built: rssBuilt, teams: rssTeams, work: rssWork, end: mb(), heapMB: +(process.memoryUsage().heapUsed / 1048576).toFixed(1), externalMB: +(process.memoryUsage().external / 1048576).toFixed(1) },
  ms: Object.fromEntries([...timings].map(([k, v]) => [k, stats(v)])),
};
console.log(JSON.stringify(out, null, 2));
pc.close();
fs.rmSync(dir, { recursive: true, force: true });
if (bad.length) process.exit(1);

// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The PC as a tool of an agent's brain (docs/features/agent-pc.md §4): one tool, "pc", in the brain's usual JSON —
// {"use":[{"tool":"pc","run":"ls ~/Documents"},{"tool":"pc","run":"write ~/notes.md","text":"…"}]} — running the PC's
// command line (./shell.js) as the agent. One toolbox lasts one answer (or one work session), so the folder it is in and
// the versions it read carry from step to step. What goes into the prompt is short: how to ask, the commands, and what
// is on its plate (its open tasks, its skills' first lines, its teams) so a small model starts in the right place.
//   kind 'owner'   its owner's chat, a work session: its home and its teams
//   kind 'visitor' someone from another account talking with it: its Public folder, to read — offered only when there
//                  is something in it
import { PcShell } from './shell.js';
import { COLUMN_NAMES } from './os.js';

export const PC_ROUNDS = 10;        // model calls in one chat answer that uses the PC (the last one answers)
export const PC_PER_ROUND = 6;      // uses in one round
const RESULT_MAX = 6000;            // characters of one use's result given back to the brain
const LIST = 8;

const one = (s, n) => String(s ?? '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

/**
 * @param {{ pc: import('./os.js').PcOS, agent: object, kind?: 'owner'|'visitor', tz?: string, names?: Function, browser?: object }} o
 * @returns {null | { names, used, shell, menuText(): string[], run(uses): Promise<object[]> }}
 */
export function pcToolbox({ pc, agent, kind = 'owner', tz = 'UTC', names = t => t, browser = null }) {
  if (!pc || !agent) return null;
  const who = kind === 'visitor' ? { visitor: agent.id } : { agent: agent.id };
  let shell;
  try { shell = new PcShell(pc, { who, tz, names, browser: kind === 'visitor' ? null : browser }); } catch { return null; }
  let publicFiles = null;
  if (kind === 'visitor') {
    try { publicFiles = pc.list(who, '~/Public', { limit: 30 }).entries; } catch { publicFiles = []; }
    if (!publicFiles.length) return null;   // (nothing to share: no tool, no extra step)
  }
  const used = [];
  return {
    names: ['pc'], used, shell,
    menuText() {
      if (kind === 'visitor') {
        return ['YOUR PUBLIC FOLDER (things your owner lets visitors see; read one before you answer about it):',
          ...publicFiles.map(e => `- ~/Public/${e.name}${e.dir ? '/' : ''}`),
          'To read one, answer with ONLY {"use":[{"tool":"pc","run":"read ~/Public/<name>"}]} — the result comes back, then answer.',
          'Never mention, look for or describe any other file or folder of yours: only Public may be shared.'];
      }
      const lines = ['To use your PC, answer with ONLY one JSON object and nothing else: {"use":[{"tool":"pc","run":"<a command>"}]} — up to 6 uses at once, each "run" may hold several commands, one per line.',
        'For write and append, put the text in "text"; for edit, put the exact words now in "find" and the new words in "replace". Example:',
        '{"use":[{"tool":"pc","run":"ls ~/Documents"},{"tool":"pc","run":"write ~/Documents/plan.md","text":"# Plan\\n- call Sam"}]}',
        'You get the results back; then use more, or give your answer. Never say you did something on your PC that its results don\'t show.',
        PcShell.menu({ browser: !!shell.browser })];
      try {
        const tasks = [...pc.myTasks(who), ...pc.board(who, '~').cards.filter(k => k.col !== 'done')];
        const seen = new Set(), open = tasks.filter(k => !seen.has(k.id) && seen.add(k.id));
        if (open.length) lines.push(`YOUR OPEN TASKS: ${open.slice(0, LIST).map(k => `#${k.id} [${COLUMN_NAMES[k.col]}] ${one(k.title, 80)}${k.board !== '~' ? ` (${k.board.replace('/teams/', '')} team)` : ''}`).join('; ')}${open.length > LIST ? `; … (${open.length} in all: tasks)` : ''}`);
      } catch { /* no board yet */ }
      try {
        const sk = pc.list(who, '~/Skills', { limit: 20 }).entries.filter(e => !e.dir);
        if (sk.length) lines.push(`YOUR SKILLS (how-to notes you wrote — read the one that fits before that kind of work; write a new one when you learn a way that works): ${sk.slice(0, 12).map(e => e.name).join(', ')}`);
      } catch { /* none */ }
      try {
        const ts = pc.teamsOf(who);
        if (ts.length) lines.push(`YOUR TEAMS: ${ts.map(t => `${t.name} (/teams/${t.slug}, you are ${t.role}${t.members.length > 1 ? `, with ${t.members.filter(m => m.agent !== agent.id).slice(0, 6).map(m => names(`a:${m.agent}`)).join(', ')}` : ''})`).join('; ')}. Put a team's work in its folder, and give tasks to co-workers on its board instead of doing their part.`);
      } catch { /* none */ }
      return lines;
    },
    /** Runs the PC uses of one round (the first PC_PER_ROUND): [{ tool, ok, text, line }]. */
    async run(uses) {
      const out = [];
      for (const u of (Array.isArray(uses) ? uses : []).slice(0, PC_PER_ROUND)) {
        const run = typeof u?.run === 'string' ? u.run : typeof u?.command === 'string' ? u.command : typeof u?.cmd === 'string' ? u.cmd : '';
        if (!run.trim()) {
          const miss = { tool: 'pc', ok: false, text: 'error: give the command in "run", e.g. {"tool":"pc","run":"ls ~"}', line: '' };
          used.push({ ...miss }); out.push(miss); continue;
        }
        const extra = {};
        for (const k of ['text', 'find', 'replace']) if (typeof u[k] === 'string') extra[k] = u[k];
        if (typeof u.content === 'string' && extra.text === undefined) extra.text = u.content;
        if (typeof u.with === 'string' && extra.replace === undefined) extra.replace = u.with;
        let r;
        try { r = await shell.run(run, extra); } catch (e) { r = { text: `error: the PC could not do that (${one(e.message, 120)})`, results: [{ ok: false }] }; }
        const ok = r.results.length ? r.results.every(x => x.ok) : false;
        const text = r.text.length > RESULT_MAX ? `${r.text.slice(0, RESULT_MAX)}\n… (cut: ask for less at a time)` : r.text;
        const line = one(run.split('\n')[0], 160);
        used.push({ tool: 'pc', ok, text: one(text, 300), line });
        out.push({ tool: 'pc', ok, text, line });
      }
      return out;
    },
  };
}

/** One toolbox of two: a brain's city tools (server/mind/tools.js, run at once) and its PC (run in turn). */
export function joinTools(city, pcBox) {
  if (!city) return pcBox;
  if (!pcBox) return city;
  const used = [];
  return {
    names: [...city.names, ...pcBox.names], used, pc: pcBox,
    menuText: () => city.menuText(),
    async run(uses) {
      const out = [];
      for (const u of (Array.isArray(uses) ? uses : []).slice(0, PC_PER_ROUND)) {
        const r = u?.tool === 'pc' ? (await pcBox.run([u]))[0] : city.run([u])[0];
        if (r) { out.push(r); used.push({ tool: r.tool, ok: r.ok, text: one(r.text, 300), ...(r.line ? { line: r.line } : {}) }); }
      }
      return out;
    },
    summary: () => city.summary?.(),
  };
}

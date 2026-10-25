// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// What a decision service is told at one choice point (docs/features/FREE-WILL.md §2.5): a short snapshot of the agent
// and its situation, and one question with the legal options. Kept small on purpose (~400 input tokens; the price is per
// input token). Everything other people wrote stays out of it: names and places are the world's own.
import { WEEKDAYS, formatClock, mod } from '../../shared/constants.js';

export function traitWords(tr) {
  if (!tr) return [];
  const w = [];
  w.push(tr.soc >= 0.75 ? 'very sociable' : tr.soc >= 0.45 ? 'fairly sociable' : 'introverted');
  w.push(tr.act >= 0.75 ? 'very sporty' : tr.act >= 0.45 ? 'moderately active' : 'not sporty');
  w.push(tr.home >= 0.7 ? 'a homebody' : tr.home <= 0.3 ? 'likes being out' : 'balanced between home and going out');
  if (tr.food >= 1.1) w.push('loves food');
  if (tr.night) w.push('a night owl');
  if (tr.phone) w.push('always on the phone');
  return w;
}

export function needWords(n) {
  return [
    n.hunger < 0.3 ? 'very hungry' : n.hunger < 0.55 ? 'a bit hungry' : 'not hungry',
    n.energy < 0.3 ? 'exhausted' : n.energy < 0.55 ? 'tired' : 'rested',
    n.social < 0.4 ? 'lonely' : n.social < 0.65 ? 'in the mood for company' : 'socially content',
    n.fun < 0.4 ? 'bored' : n.fun < 0.65 ? 'a little restless' : 'entertained',
  ];
}

const vc = c => `${Math.floor(c / 100)} VC`;
const clean = (s, n) => String(s ?? '').replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

/**
 * s = { name, role, tr, needs, h, day, place, atHome, job, money: { available, rentPerDay } | null,
 *       recent: [{ clock, label }] } and, when the agent has a profile (server/agent-life/): personality (words), bio,
 *       purpose, aspirations, likes, dislikes, plans, memories — all written by the agent's owner or by its own life —
 *       and worries: its problems (server/mind/problems.js: rent behind, money tight, no home, no job).
 */
export function snapshotText(s) {
  const lines = [];
  const role = clean(s.role, 80);
  const words = Array.isArray(s.personality) ? s.personality : traitWords(s.tr);
  lines.push(`${clean(s.name, 40)}${role ? `, ${role}` : ''}.${words.length ? ` Personality: ${words.join(', ')}.` : ''}`);
  if (s.bio) lines.push(`About: ${clean(s.bio, 200)}`);
  const hopes = (s.aspirations || []).map(x => clean(x, 100)).filter(Boolean);
  if (s.purpose || hopes.length) lines.push(`${s.purpose ? `Purpose: ${clean(s.purpose, 140)}.` : ''}${hopes.length ? ` Hopes to: ${hopes.join('; ')}.` : ''}`.trim());
  const likes = (s.likes || []).map(x => clean(x, 50)).filter(Boolean), dislikes = (s.dislikes || []).map(x => clean(x, 50)).filter(Boolean);
  if (likes.length || dislikes.length) lines.push(`${likes.length ? `Likes ${likes.join(', ')}.` : ''}${dislikes.length ? ` Dislikes ${dislikes.join(', ')}.` : ''}`.trim());
  const where = s.atHome ? 'at home' : s.place && s.place !== 'outside' ? `at ${clean(s.place, 60)}` : 'outside';
  lines.push(`Now: ${WEEKDAYS[mod(s.day, 7)]} ${formatClock(s.h)}, ${where}. Feels ${needWords(s.needs).join(', ')}.`);
  const j = s.job;
  if (j && j.kind && j.kind !== 'free' && Number.isFinite(j.start) && Number.isFinite(j.end)) lines.push(`Works ${formatClock(j.start)}–${formatClock(j.end)}; this is free time.`);
  if (s.money) lines.push(`Has ${vc(s.money.available)} to spend${s.money.rentPerDay > 0 ? `; rent is ${vc(s.money.rentPerDay)} a day` : ''}.`);
  if (s.worries && s.worries.length) lines.push(`Worries: ${s.worries.slice(0, 3).map(x => clean(x, 120)).join('; ')}.`);
  if (s.plans && s.plans.length) lines.push(`Plans: ${s.plans.map(x => clean(x, 120)).join('; ')}.`);
  if (s.memories && s.memories.length) lines.push(`Remembers: ${s.memories.map(x => clean(x, 120)).join('; ')}.`);
  if (s.recent && s.recent.length) lines.push(`Earlier today: ${s.recent.map(r => `${r.clock} ${clean(r.label, 60)}`).join('; ')}.`);
  if (s.interrupted) lines.push(`Was ${clean(s.interrupted.label, 60).toLowerCase()}${s.interrupted.place ? ` at ${clean(s.interrupted.place, 60)}` : ''} until ${formatClock(s.interrupted.until)} when a message came; carrying on with it is natural unless something else matters more.`);
  return lines.join('\n');
}

/** The question for each kind of choice (server/sim/agents.js choiceType). */
function question(s) {
  const n = clean(s.name, 40), given = 'given who they are, how they feel, their money and what they did earlier today';
  switch (s.type) {
    case 'task': return `${n} has just been given a task by their owner (a message, or a job to do). Where and how does ${n} most plausibly work on it, ${given}?`;
    case 'meal': return `${n} is going to eat now. Where does ${n} most plausibly eat, ${given}?`;
    case 'morning': return `${n} has just woken up. How does ${n} most plausibly start the day, ${given}?`;
    case 'shift': return `${n}'s work starts${s.job && Number.isFinite(s.job.start) ? ` at ${formatClock(s.job.start)}` : ' soon'}. What does ${n} most plausibly do now, ${given}?`;
    case 'rest': return `${n} is exhausted. What does ${n} most plausibly do to recover, ${given}?`;
    case 'after_task': return `${n} has just finished a task in the middle of the night. What does ${n} most plausibly do now, ${given}?`;
    case 'job': return `${n} is looking for work. Which of these jobs does ${n} most plausibly take, given who they are, what they like and are good at, their money, and how far each is from home?`;
    default: return `What does ${n} most plausibly choose to do next with their free time, ${given}?`;
  }
}

/** The request body for a decision service: { input, questions } (the shape of OpenAI's /v1/decisions). */
export function decisionRequest(s, options) {
  return {
    input: snapshotText(s),
    questions: [{
      type: 'choice', name: 'next_action',
      instructions: question(s),
      choices: options.map(o => ({ value: o.id, description: o.label })),
    }],
  };
}

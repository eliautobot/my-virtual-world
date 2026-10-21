// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Speech lines for agents (player talks, ambient chatter). Pure functions of agent state.
const pick = (rng, arr) => arr[Math.floor(rng.next() * arr.length)];
const GREET = ['Hey there!', 'Oh, hi!', 'Hello!', 'Hi! Nice to see you.', 'Hey, what\'s up?', 'Good to see you!', 'Well, hello!'];
const BY_USE = {
  work: ['Busy day — lots to get through.', 'Deep in work right now.', 'Almost done with this task.', 'Deadlines, deadlines…', 'Just wrapping up an email.'],
  meeting: ['We\'re in a meeting — catch you later?', 'Planning next quarter. Riveting stuff.', 'This meeting could have been an email.'],
  present: ['…and that\'s why the numbers are up!', 'Slide 14 of 30. Stay with me.'],
  eat: ['This is delicious.', 'Lunch break — finally!', 'You have to try the food here.', 'I was starving.'],
  coffee: ['Can\'t function without coffee.', 'Third cup today. Don\'t judge.', 'Best coffee in the building.'],
  water: ['Staying hydrated!', 'Just a quick water break.'],
  relax: ['Just taking it easy.', 'Nothing beats a comfy couch.', 'Recharging a bit.'],
  bench: ['Lovely day to sit outside.', 'I love people-watching here.', 'The fountain is so relaxing.'],
  browse: ['Just looking around.', 'So many choices…', 'I might buy this.'],
  buy: ['Checking out — found some good stuff.'],
  run: ['Can\'t stop — on a roll!', 'Two more kilometres!'],
  jog: ['Morning jog! Gotta keep moving.', 'Just a lap around the block.'],
  lift: ['Leg day. Pray for me.', 'One more set!'],
  yoga: ['Breathe in… breathe out.', 'Finding my zen.'],
  pingpong: ['Watch this serve!', 'I\'m undefeated today.'],
  play: ['New high score incoming!', 'One more round.'],
  music: ['Learning a new piece.', 'Do you play?'],
  dance: ['Come dance with us!', 'Love this song!'],
  staff: ['Welcome! What can I get you?', 'Busy shift today.', 'Let me know if you need anything.'],
  cook: ['Something smells amazing, right?', 'Secret family recipe.'],
  chat: ['We were just catching up.', 'Did you hear the news?'],
  shower: ['Uh, a little privacy please!'],
  computer: ['Just browsing the web.', 'Catching up on the news.'],
  commute: ['Heading out.'],
  wander: ['Just out for a stroll.', 'Exploring the neighbourhood.', 'Such a nice city.'],
  phone: ['Sorry, on the phone!'],
};
export function dialogLine(sim, a, rng, act, presence) {
  const p = a.p, n = a.needs;
  if (act?.use === 'sleep' || act?.use === 'nap') return 'Zzz…';
  const parts = [pick(rng, GREET)];
  if (p.vip && (sim.agentShown ? sim.agentShown(p.agentId) : (!sim.agentOk || sim.agentOk(p.agentId)))) {
    parts.push(`I'm ${p.name}${p.emoji ? ' ' + p.emoji : ''} — ${p.role || 'AI agent'}.`);
    // Spoken lines are shown to everyone watching, so they never quote an agent's task (DECISIONS C67).
    if (presence && presence.working) parts.push('I\'m on a live task right now.');
    else parts.push(pick(rng, ['Between tasks right now.', 'Waiting for my next job.', 'All caught up for the moment.']));
    return parts.join(' ');
  }
  if (act) {
    const heading = act.travelEnd && sim.now() < act.travelEnd;
    if (heading && act.place) parts.push(`I'm on my way to ${act.place}.`);
    else if (BY_USE[act.use]) parts.push(pick(rng, BY_USE[act.use]));
  }
  if (n.hunger < 0.3) parts.push('I\'m getting really hungry.');
  else if (n.energy < 0.25) parts.push('So tired today…');
  else if (n.social < 0.25) parts.push('It\'s nice to talk to someone!');
  else if (rng.chance(0.4) && p.job?.title) parts.push(`I work as ${/^[aeiou]/i.test(p.job.title) ? 'an' : 'a'} ${p.job.title}.`);
  return parts.join(' ');
}

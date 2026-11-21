// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The reflex (docs/features/companions.md §3): a person's plain command to their agent, understood at once, without asking
// any AI — "follow me", "come here", "wait here", "let's go to the café", "meet Max at the park", "get in", "you're
// dismissed". Like a nervous system: the clear cases are acted on before any brain thinks; anything less plain goes to the
// agent's decision service (./understand.js), and its brain answers in its own words either way.
//
// parseCommand(text, { name }) → null, or { action, target?, place?, sentence } where
//   action: 'follow' (target 'me' or a name; place: where the leader is taking it, if said), 'stay' (place: here or a
//   named place), 'go' (place), 'meet' (target 'me' or a name, place), 'ride', 'dismiss', 'sit' (sit down — with its
//   leader when they sit: the same bench, their table), 'stand' (get up), 'eat' (sit at its leader's table and order),
//   'board' (on to its leader's boat), 'fish' (a rod out on its leader's fishing trip), 'unfish' (the rod away), 'buybait' (bait
//   of its own at a dock store, now or at the next),
//   'versus' (play its leader at the other end of a table for two — game: the game said, 'pool', 'air hockey' …, or
//   none), 'unversus' (stop playing them), 'cook' (a Rush of its own in the kitchen its leader cooks in, or one near
//   them), 'uncook' (out of the kitchen), 'fly' (into its leader's aircraft with them), 'pilot' (fly a ring course
//   itself: course, the one named), 'land' (give it up).
// Only short messages count (a long one is a conversation, not an order) and each sentence must be the command and nothing
// more: "follow me" is one; "can you follow up on the email" is not.

import { COURSES } from '../../shared/airport.js';

const MAX_CHARS = 160, MAX_SENTENCES = 3, MAX_NAME_WORDS = 4;

/** Lower case, letters/digits/apostrophes/spaces only, one space between words. */
export function norm(s) {
  return String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[’‘`]/g, "'").replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();
}
const words = s => (s ? s.split(' ').length : 0);

// politeness and asking round a command: "hey", "ok", "please", "can you", "could you please", "now", "thanks"
const LEAD = /^(?:(?:hey|hi|ok|okay|alright|right|so|yo|please|now|and|then|um|uh|just|you guys|you two|you both|you all|both of you|guys)\s+)+/;
const ASK = /^(?:(?:can|could|would|will) you\s+(?:please\s+)?|i (?:want|need) you to\s+|i'd like you to\s+|go ahead and\s+)/;
const TAIL = /(?:\s+(?:please|now|then|thanks|thank you|ok|okay|right now|for now|for me|again|too|as well|buddy|mate|man|bro|dude|for a (?:bit|while|sec|second|moment|minute|few minutes)|a (?:sec|second|moment|minute|bit)|real quick|quickly))+$/;

/** One sentence without the person's name said to it, the politeness round it and its asking. */
export function strip(sentence, name = '') {
  let t = norm(sentence);
  const nm = norm(name), first = nm.split(' ')[0];
  for (let k = 0; k < 3; k++) {
    const before = t;
    t = t.replace(LEAD, '').replace(/^(let'?s) just /, '$1 ');   // ("let's just go")
    for (const n of [nm, first]) if (n && (t === n || t.startsWith(n + ' '))) t = t.slice(n.length).trim();
    t = t.replace(ASK, '').replace(TAIL, '').trim();
    for (const n of [nm, first]) if (n && t.endsWith(' ' + n)) t = t.slice(0, -n.length - 1).trim();
    if (t === before) break;
  }
  return t;
}

const ME = '(?:me|us)';
const PLACE_ART = /^(?:the|a|an|my|our|your)\s+/;
const cleanPlace = p => (p || '').replace(PLACE_ART, '').trim();
// ("follow up on the email", "follow through", "follow the instructions": not someone to go with)
const NOT_WHO = /^(?:it|that|this|them|him|her|up|on|through|along|me|us|the|your|my|our|these|those|instructions|orders|rules|steps|plan|lead|suit|news|link|guide|recipe|advice|along|behind)(?:\s|$)/;
const okName = n => !!n && words(n) <= MAX_NAME_WORDS && !NOT_WHO.test(n);
const okPlace = p => !!p && words(p) <= 6;
// the games played by two, as people say them (server/play/versus.js finds the table from the catalog's own words)
const GAME = "(pool|billiards|snooker|eight ball|8 ball|air hockey|hockey|foosball|foos|table football|table soccer|ping pong|pingpong|table tennis)";

// with me: one of these, or a few run together without a stop ("follow me lets go", "follow me and be my companion")
const WITH = `(?:follow ${ME}|come with ${ME}|come along|tag along|stick with ${ME}|stay with ${ME}|stay close(?: to ${ME})?|keep up|keep close|walk with ${ME}|join ${ME}|you'?re with ${ME}|be my companion|be my sidekick|let'?s go|let'?s roll|let'?s move|let'?s move out|let'?s head out|let'?s get going|come on|c'?mon|on me|with me|heel|come here|come over here|over here|come (?:over )?(?:to|towards|toward) ${ME}|get over here|come back|come back here|come find ${ME}|meet ${ME} here|join ${ME} here)`;
// (said alone these are as often an exclamation as an order — "come on, that's not fair", "wait, what?": a command only when
//  nothing else is said with them but other commands and a word like "no" or "ok")
const WEAK = /^(?:come on|c'?mon|wait|hold on|hold up|hang on)$/;
const FILLER = /^(?:no|nope|yes|yeah|yep|ok|okay|alright|right|sure|well|so|hey|hi|good|great|cool|fine|now|please)$/;

// [regex on the stripped sentence, (match) → command or null]
const RULES = [
  // let it go: back to its own day
  [/^(?:you(?:'re| are) (?:dismissed|free to go|free|good to go|off duty|done)|dismissed|that'?s all(?: for now)?|you can (?:go|leave|go now|leave now|go back)|go back to (?:your|what you were) (?:day|doing|life|business|routine)|carry on|as you were|we'?re done(?: here)?|i'?m done with you|stop following(?: me| us)?|don'?t follow (?:me|us)(?: anymore)?|leave me alone|go do your (?:own )?thing|back to your day|you'?re released|release)$/,
    () => ({ action: 'dismiss' })],
  // with me
  [new RegExp(`^${WITH}(?: (?:and )?${WITH})*$`),
    () => ({ action: 'follow', target: 'me' })],
  // with me, somewhere: "let's go to the park", "come with me to the café", "follow me to the bar"
  [new RegExp(`^(?:let'?s go|let'?s head|let'?s walk|let'?s move|let'?s drive|come with ${ME}|follow ${ME}|walk with ${ME}|come along|join ${ME}|tag along) (?:over )?(?:to|into|in|towards|toward|down to|up to) (.+)$`),
    m => (okPlace(cleanPlace(m[1])) ? { action: 'follow', target: 'me', place: cleanPlace(m[1]) } : null)],
  // into the car
  [/^(?:(?:get|hop|jump|climb) in(?:to)?(?: the car| my car| the back| the passenger seat| the front)?(?: with (?:me|us))?|ride with (?:me|us)|let'?s ride|let'?s drive|come for a ride|get in we'?re going(?: .+)?)$/,
    () => ({ action: 'ride' })],
  // stay put
  [/^(?:stay(?: here| there| put| right here| right there)?|wait(?: here| there| right here| for me(?: here| there)?| up)?|hold (?:on|up|it|position|here)|stop (?:here|there|right there)|don'?t move|stand by|hang (?:on|tight|here)|wait for us(?: here)?|you stay here|stay behind)$/,
    () => ({ action: 'stay', place: 'here' })],
  // meet someone somewhere: "meet me at the park", "meet Max at the café", "go meet Max at the bar"
  [/^(?:go )?meet (.+?) (?:at|in|by|outside|near) (.+)$/,
    m => { const t = m[1] === 'me' || m[1] === 'us' ? 'me' : m[1].replace(PLACE_ART, ''); return (t === 'me' || okName(t)) && okPlace(cleanPlace(m[2])) ? { action: 'meet', target: t, place: cleanPlace(m[2]) } : null; }],
  // wait somewhere: "wait for me at the café", "wait at the park"
  [/^(?:wait|stay|hang out|hang around) (?:for (?:me|us) )?(?:at|in|by|outside|near) (.+)$/,
    m => (okPlace(cleanPlace(m[1])) ? { action: 'stay', place: cleanPlace(m[1]) } : null)],
  // with another of its owner's agents: "follow Max", "go with Max", "go find Max", "go meet Max", "join Max"
  [/^(?:follow|go with|stick with|tag along with|join|accompany|go find|go meet|meet up with|go hang out with|hang out with|go be with|stay with) (.+)$/,
    m => { const t = m[1].replace(PLACE_ART, ''); return okName(t) && t !== 'me' && t !== 'us' ? { action: 'follow', target: t } : null; }],
  // go somewhere: "go to the café", "head to the park", "go home", "go to work", "go over there"
  [/^(?:go|head|walk|run|get|move|run along) (?:over )?(?:to|into|towards|toward|down to|up to|back to) (.+)$/,
    m => (okPlace(cleanPlace(m[1])) ? { action: 'go', place: cleanPlace(m[1]) } : null)],
  [/^(?:go|head) (home|to work|back home|back to work)$/,
    m => ({ action: 'go', place: /home/.test(m[1]) ? 'home' : 'work' })],
  // eat with them: "let's eat", "order something", "eat with me", "join me for dinner", "sit down and eat with me"
  [new RegExp(`^(?:let'?s (?:eat|order|have (?:something|a bite|lunch|dinner|breakfast|a drink|a coffee|coffee)|grab (?:something|a bite|some food|food|lunch|dinner))|eat with ${ME}|have (?:something|a bite|lunch|dinner|breakfast|a drink) with ${ME}|order (?:something|some food|food|a drink|something to eat|something to drink|yourself something)(?: for yourself)?|(?:sit|come sit)(?: down)? and (?:eat|order)(?: with ${ME}| something)?|join ${ME} for (?:lunch|dinner|breakfast|a drink|a coffee|coffee|a meal))$`),
    () => ({ action: 'eat' })],
  // sit down (beside them when they sit): "sit down", "sit with me", "take a seat", "come sit next to me", "pull up a chair"
  // ("sit tight" is waiting; "set down", speech to text's "sit down" said alone)
  [new RegExp(`^(?:(?:come )?(?:sit|set)(?: down)?(?: (?:with|next to|beside|by) ${ME})?(?: (?:here|over here|there|on (?:the|this|my) (?:\\w+ )?(?:bench|seat|chair|sofa|couch|edge|fountain)|at (?:the|this|my|our) table))?|(?:have|take|grab) a seat(?: (?:with|next to|beside) ${ME})?|pull up a (?:chair|seat)|join ${ME} on (?:the|this) (?:bench|sofa|couch)|let'?s sit(?: down)?(?: here)?)$`),
    m => (/^set\b/.test(m[0]) && m[0] !== 'set down' ? null : { action: 'sit' })],
  // get up
  [/^(?:get up|stand up|up you get|on your feet|get off the bench)$/,
    () => ({ action: 'stand' })],
  // fishing with them (server/play/fishing-crew.js): on board — "get on the boat", "come aboard"; a rod out — "let's fish",
  // "fish with me", "cast a line", "grab a rod"; the rod away — "stop fishing", "put the rod away" ("reel it in" is said
  // to someone fighting a fish: not a command)
  [/^(?:(?:get|hop|jump|climb|come) (?:on|onto|in|into|aboard)(?: the| my| our)? boat(?: with (?:me|us))?|come aboard|all aboard|get aboard)$/,
    () => ({ action: 'board' })],
  [new RegExp(`^(?:let'?s (?:go )?fish(?:ing)?|(?:go|start|come|keep|get) fishing(?: with ${ME})?|fish with ${ME}|(?:cast|throw) (?:a|your|out a|out your) line|(?:grab|get|take) (?:a|your) rod(?: and fish)?|try your luck|catch (?:some|a few|us some) fish|(?:start|get) casting)$`),
    () => ({ action: 'fish' })],
  [/^(?:stop fishing|(?:put|pack) (?:the|your) rods? (?:away|down)|(?:put|pack) away (?:the|your) rods?|rods? away|that'?s enough fishing|enough fishing|no more fishing|done fishing)$/,
    () => ({ action: 'unfish' })],
  // bait of its own (2026-11-20, the product owner: "idk if they can buy bait even though i asked"): "buy some bait", "get bait", "grab
  // some lures", "stock up on bait", "go buy bait" — at a dock store now, or the next it is at
  [/^(?:(?:go |can you |could you |please )?(?:buy|get|grab|pick up|stock up on)(?: (?:some|more|your own|yourself some|a pack of|some more))? (?:bait|lures?|bait and lures|fishing bait|shrimp|live shrimp|worms|nightcrawlers)(?: for (?:yourself|the trip|fishing|you))?)$/,
    () => ({ action: 'buybait' })],
  // playing them at a table for two (server/play/versus.js): "let's play pool", "play air hockey with me", "fancy a game
  // of foosball", "play with me", "let's play", "game on"; stopping — "stop playing", "that's enough games"
  [new RegExp(`^(?:let'?s (?:play|have)|(?:come |go )?play|(?:do you )?(?:wanna|want to) play|fancy|how about|up for) (?:a (?:game|round|match) of |some |a |an )?${GAME}(?: (?:with|against|vs) ${ME})?$`),
    m => ({ action: 'versus', game: m[1] })],
  [new RegExp(`^(?:let'?s play(?: a (?:game|round|match))?|let'?s have a (?:game|round|match)|(?:come )?play (?:with|against) ${ME}|play ${ME}|(?:do you )?(?:wanna|want to) play(?: (?:with|against) ${ME})?|game on|challenge me|i challenge you|rack (?:them|em) up)$`),
    () => ({ action: 'versus' })],
  [/^(?:stop playing(?: (?:me|us|with me|with us|the game|games))?|quit playing|done playing|that'?s enough (?:games|playing)|enough games|no more games|let'?s stop playing)$/,
    () => ({ action: 'unversus' })],
  // cooking with them (Order Up, server/play/kitchen-play.js): a Rush of its own in the kitchen they cook in — "let's cook",
  // "cook with me", "help me in the kitchen", "give me a hand in the kitchen", "help me at the kitchen", "let's do a rush";
  // out of the kitchen — "stop cooking", "leave the kitchen" ("let's eat" is a meal: above)
  [new RegExp(`^(?:let'?s (?:cook|do some cooking|do a rush|cook a rush|cook together|get cooking)|(?:come|go) cook(?: something| a rush)?(?: (?:with|for) ${ME})?|cook (?:something|a rush)(?: (?:with|for) ${ME})?|cook (?:with|for) ${ME}|help ${ME} (?:cook|in the kitchen|with the cooking|with the rush)|(?:give|lend) ${ME} a hand in the kitchen|help ${ME} at the kitchen|(?:get|come) (?:in|into) the kitchen(?: with ${ME})?|(?:start|get|keep) cooking(?: with ${ME})?|cook (?:alongside|next to|beside) ${ME}|(?:do|cook|play) (?:a|an) (?:order up|rush)(?: with ${ME})?)$`),
    () => ({ action: 'cook' })],
  [/^(?:stop cooking|(?:get|come) out of the kitchen|leave the kitchen|that'?s enough cooking|enough cooking|no more cooking|done cooking|stop the rush)$/,
    () => ({ action: 'uncook' })],
  // the airport (server/play/flight-crew.js): into its leader's aircraft — "come fly with me", "get in the plane", "hop in
  // the chopper"; a ring course flown itself — "go fly a course", "fly First Flight", "take a plane up"; back down — "land",
  // "stop flying" (a course's name is the module's own: a course added later is understood the day it is added)
  [new RegExp(`^(?:(?:come|let'?s) fly(?: with ${ME})?|fly with ${ME}|(?:let'?s go|come) flying(?: with ${ME})?|(?:get|hop|jump|climb) (?:in|into|on|onto|aboard)(?: the| my| our)? (?:plane|aeroplane|airplane|aircraft|jet|helicopter|chopper|heli)(?: with ${ME})?)$`),
    () => ({ action: 'fly' })],
  [/^(?:(?:go |you )?fly (?:a |the |some |another )?(?:ring )?courses?(?: yourself| on your own)?|(?:try|do|fly) (?:a |the )?ring course|take (?:a|the) (?:plane|jet|helicopter|chopper) up(?: yourself)?|go flying(?: yourself| on your own)?)$/,
    () => ({ action: 'pilot' })],
  [new RegExp(`^(?:go |you |now )?(?:fly|try|do) (?:the )?(${COURSES.map(c => norm(c.label)).join('|')})(?: course)?(?: yourself| on your own| for me)?$`),
    m => ({ action: 'pilot', course: m[1] })],
  [/^(?:land(?: the plane| the aircraft| it)?(?: now)?|stop flying|(?:come back|bring it(?: back)?) down|that'?s enough flying|enough flying|give up the course)$/,
    () => ({ action: 'land' })],
];

/**
 * The command in a message, or null. o.name: the agent's name (said to it: "Riley, follow me").
 * A message with more sentences than a command or two, or longer than a few lines, is a conversation: null.
 */
export function parseCommand(text, { name = '' } = {}) {
  const raw = String(text ?? '').trim();
  // (a slash command is the agent platform's own — /stop, /new, /model: never one for the body)
  if (!raw || raw.length > MAX_CHARS || /^[/!]/.test(raw)) return null;
  const sentences = raw.split(/[.!?;:\n]+|,\s*(?:and\s+)?|\s+[—–-]+\s+|\s+and\s+(?=(?:then\s+)?(?:follow|come|wait|stay|go|meet|get|let'?s))/i).map(s => s.trim()).filter(Boolean);
  if (!sentences.length || sentences.length > MAX_SENTENCES) return null;
  let found = null, foundWeak = false, strong = false, other = false;
  for (const s of sentences) {
    const t = strip(s, name);
    if (!t || FILLER.test(t)) continue;
    let hit = false;
    for (const [re, fn] of RULES) {
      const m = re.exec(t);
      if (!m) continue;
      const cmd = fn(m);
      if (!cmd) continue;
      const weak = WEAK.test(t);
      hit = true; strong ||= !weak;
      // two commands in one message: the more specific (somewhere, someone) wins; a goodbye after anything wins; an
      // exclamation ("hang on, follow me") gives way to the plain command
      if (!found || (foundWeak && !weak) || cmd.action === 'dismiss' || (cmd.place && !found.place) || (found.action === 'follow' && cmd.action === 'ride')) { found = { ...cmd, sentence: s }; foundWeak = weak; }
      break;
    }
    other ||= !hit;
  }
  // (only an exclamation like "come on" with words that are not a command: a conversation)
  return found && !strong && other ? null : found;
}

/** The words a person's command is answered with by the world itself (the brain may add its own). */
export function confirmWords(cmd, name, extra = {}) {
  const n = name || 'Your agent';
  switch (cmd.action) {
    case 'follow': return cmd.target === 'me' ? `${n} is with you${extra.place ? ` (heading to ${extra.place})` : ''}` : `${n} is going with ${extra.leader || cmd.target}`;
    case 'stay': return `${n} is waiting ${extra.place && extra.place !== 'here' ? `at ${extra.place}` : 'there'}`;
    case 'go': return `${n} is going to ${extra.place || cmd.place}`;
    case 'meet': return `${n} is meeting ${cmd.target === 'me' ? 'you' : extra.leader || cmd.target} at ${extra.place || cmd.place}`;
    case 'ride': return `${n} got in your car`;
    case 'dismiss': return `${n} went back to their day`;
    case 'sit': return `${n} sits down${extra.seat ? ` ${extra.seat}` : ''}`;
    case 'stand': return `${n} gets up`;
    case 'eat': return `${n} sits down to eat with you`;
    case 'board': return `${n} gets on the boat with you`;
    case 'fish': return `${n} is fishing`;
    case 'unfish': return `${n} puts the rod away`;
    case 'buybait': return `${n} buys bait`;
    case 'versus': return `${n} goes to the other end to play you`;
    case 'unversus': return `${n} stops playing`;
    case 'cook': return `${n} is cooking`;
    case 'uncook': return `${n} comes out of the kitchen`;
    case 'fly': return `${n} gets in to fly with you`;
    case 'pilot': return `${n} is going to fly a ring course`;
    case 'land': return `${n} is flying back to land`;
    default: return '';
  }
}

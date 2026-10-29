// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Installation and account settings in three tiers (PLAN WP1.5; DECISIONS C85, C89–C92, C96): 0 preferences,
// 1 secrets, 2 infrastructure. One registry says, for each setting, its scope, tier, type and the capability that may
// change it. Secrets are stored sealed (server/secrets.js) and only ever reported as set / not set; a blank value keeps
// the stored one, null clears it. Tier 1 and 2 changes need that capability and a password entry within 10 minutes.
// Every view passes through the redaction helper (server/redact.js), like the log.
import { AuthError, LIMITS } from './auth/accounts.js';
import { isCredentialName, redact } from './redact.js';
import { SECRET_PREFIX, aadInstall, aadAccount } from './secret-holders.js';
import { AGENT_APPS, AGENT_APP_OFFERS } from '../shared/agent-apps.js';
import { SOUND_DEFAULTS as SD } from '../shared/sound-defaults.js';

export const TIER_NAMES = Object.freeze({ 0: 'preferences', 1: 'secrets', 2: 'infrastructure' });
const PATH_RE = /^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9]+)+$/;
const TYPES = ['boolean', 'enum', 'days', 'number', 'string', 'secret'];

/** A registry entry. A setting whose name holds a credential (C89, C94) is always a tier 1 secret. */
export function defineSetting(e) {
  if (!PATH_RE.test(e.path || '')) throw new Error(`setting ${e.path}: bad path`);
  if (!['install', 'account'].includes(e.scope)) throw new Error(`setting ${e.path}: scope must be install or account`);
  const secret = e.type === 'secret' || isCredentialName(e.path.split('.').pop());
  const d = { label: e.path, help: '', ...e, type: secret ? 'secret' : e.type, tier: secret ? 1 : e.tier };
  if (!TYPES.includes(d.type)) throw new Error(`setting ${e.path}: unknown type ${d.type}`);
  if (![0, 1, 2].includes(d.tier)) throw new Error(`setting ${e.path}: tier must be 0, 1 or 2`);
  if (d.tier === 1 && d.type !== 'secret') throw new Error(`setting ${e.path}: tier 1 holds secrets only`);
  if (d.type === 'secret') d.default = null;
  if (d.default === undefined) d.default = null;
  if (!d.cap) d.cap = d.scope === 'account' ? 'account.self' : d.tier === 1 ? 'settings.secrets' : d.tier === 2 ? 'settings.infrastructure' : null;
  if (!d.cap) throw new Error(`setting ${e.path}: name the capability that may change it`);
  if (d.type === 'enum' && !(Array.isArray(d.values) && d.values.length)) throw new Error(`setting ${e.path}: list its values`);
  if (d.type === 'days' && !(d.min > 0 && d.max >= d.min)) throw new Error(`setting ${e.path}: give min and max days`);
  if (d.type === 'number' && !(Number.isInteger(d.min) && Number.isInteger(d.max) && d.max > d.min && (!d.step || (Number.isInteger(d.step) && d.step > 0 && (d.max - d.min) % d.step === 0)))) throw new Error(`setting ${e.path}: give whole min, max (and step)`);
  return Object.freeze(d);
}

// why each app is offered as it is by default (shared/agent-apps.js offer)
const APP_OFFER_HELP = Object.freeze({
  'grok-bot': 'A Grok Bot lives in the world, and its wake-up link has it answer at once.',
  'openai-dot': 'No one by default: a ChatGPT account has one dot today and nothing can wake it, so it answers only when its owner asks it to. Agents made for it earlier keep working.',
  'meta-muse': 'Admins only by default, while it is tested: an account has one Muse, it checks in on a schedule (every few minutes at best) and nothing wakes it at once. Agents made for it earlier keep working.',
});

export const SETTINGS = Object.freeze([
  // Installation (all tier 2 today, C90).
  {
    path: 'world.requireSignIn', scope: 'install', tier: 2, type: 'boolean', default: false, cap: 'settings.world',
    label: 'Require sign-in to watch the world', on: 'Watching now needs sign-in', off: 'Guests can watch again', after: s => s.onAccessChange(),
  },
  {
    path: 'registration.open', scope: 'install', tier: 2, type: 'boolean', default: false, cap: 'settings.world',
    label: 'Anyone may create an account (open self-registration)', help: 'Without open registration, new accounts come from invites or from Users.',
    on: 'Open registration is on', off: 'Open registration is off', after: s => s.onAccessChange(),
  },
  // AI apps (server/connector/): whether people may connect Grok, ChatGPT, Gemini, Claude… to act as one of their agents
  {
    path: 'connector.enabled', scope: 'install', tier: 2, type: 'boolean', default: true, cap: 'settings.security',
    label: 'AI apps may connect', help: 'People may connect an AI app (Grok, ChatGPT, Gemini, Claude…) to act as one of their agents, through this world\'s address + /mcp. Each person chooses the agent and can disconnect the app at any time. Off: every app stops at once.',
  },
  // third-party agents (shared/agent-apps.js): who may choose each app in ➕ New agent; an agent made for it earlier keeps working
  ...AGENT_APPS.map(a => ({
    path: a.setting, scope: 'install', tier: 2, type: 'enum', values: Object.keys(AGENT_APP_OFFERS), valueLabels: { ...AGENT_APP_OFFERS },   // (a copy each: the view's redaction marks a repeated object as circular)
    default: a.offer, cap: 'freewill.admin', label: `${a.name}: who may choose it in New agent`, help: APP_OFFER_HELP[a.id] || '',
  })),
  {
    path: 'security.require2fa', scope: 'install', tier: 2, type: 'boolean', default: false, cap: 'settings.security',
    label: 'Require two-factor sign-in for admins and the owner', help: 'Admins without it can only set it up after their next sign-in.',
    on: 'Two-factor is now required for admins', off: 'Two-factor is optional again', after: s => s.onAccessChange(),
  },
  {
    path: 'audit.retentionDays', scope: 'install', tier: 2, type: 'days', default: null, cap: 'audit.retention', min: 30, max: 3650,
    choices: [null, 90, 180, 365, 730, 1825], rangeText: 'Keep audit events 30 to 3,650 days, or forever',
    label: 'Keep audit events', saved: 'Audit retention saved',
    after: (s, days, actor) => { if (days) s.audit?.purge(days, { actor }); },   // each purge is recorded (C75)
  },
  {
    path: 'players.spawn', scope: 'install', tier: 2, type: 'string', default: '', maxLength: 200, cap: 'players.spawn',
    label: 'Where new players appear', saved: 'Spawn point saved',
    help: 'Players appear where they last stood; new players, and anyone whose last spot is no longer valid, appear here. Empty: outside the headquarters.',
  },
  {
    path: 'chat.proximity', scope: 'install', tier: 2, type: 'boolean', default: true, cap: 'settings.world',
    label: 'Players can chat with people near them', on: 'Proximity chat is on', off: 'Proximity chat is off',
    help: 'Messages reach players within 20 m in the same space; nothing is stored on disk.',
  },
  // How many people live in the city (2026-10-20, server/sim/housing.js): its homes decide — the residents fill this share
  // of the beds in its apartment buildings, settling towards it a little at a time by the world's clock.
  {
    path: 'world.homesFilled', scope: 'install', tier: 2, type: 'number', default: 30, min: 0, max: 100, step: 1, cap: 'world.edit',
    label: 'Homes filled (%): the share of the city\'s beds its residents fill', saved: 'Homes filled saved',
    help: 'Only homes bring residents; offices, shops and restaurants bring jobs. New homes fill up over a world day or two; when homes go, or the share is lowered, people move away the same way.',
  },
  // People moving between towns (2026-10-23, server/sim/migration.js): to live where they work, to find work, away from a
  // town that does much worse than another; newcomers choose a town by how well it does.
  {
    path: 'world.townMoves', scope: 'install', tier: 2, type: 'boolean', default: true, cap: 'world.edit',
    label: 'Residents move between towns', saved: 'Saved',
    help: 'A few a world hour: to the town where they work, to a town with work when theirs has none, or away from a town that does much worse than another. Agents and residents moved into a flat by its owner stay.',
  },
  {
    path: 'world.home', scope: 'install', tier: 2, type: 'string', default: '', maxLength: 300, cap: 'settings.world',
    label: 'Default home view', saved: 'Default home view saved',
    help: 'Where guests and new accounts start, and what "Go to home view" uses for them. Set it from the Home view panel in the information dock, which needs the password like the other installation-wide changes.',
  },
  {
    path: 'chat.attachmentMaxMb', scope: 'install', tier: 2, type: 'enum', values: ['10', '25', '50', '100'], default: '25', cap: 'settings.world',
    label: 'Largest chat attachment (MB)', help: 'Images, video, audio, PDF, office documents and text or code files may be this large (an agent provider may take less: the chat says so).',
  },
  {
    path: 'chat.attachmentQuotaMb', scope: 'install', tier: 2, type: 'enum', values: ['500', '2048', '5120', '10240'], default: '2048', cap: 'settings.world',
    label: 'Attachment space per account (MB)', help: 'What each account may keep in total; it removes some to send more.',
  },
  {
    path: 'presence.finishGraceSec', scope: 'install', tier: 2, type: 'enum', values: ['3', '8', '15', '30'], default: '8', cap: 'settings.world',
    label: 'Seconds an agent stays at its desk after finishing', help: 'After a run ends, the agent shows as finishing for this long, then goes idle.',
  },
  {
    path: 'presence.quietLimitMin', scope: 'install', tier: 2, type: 'enum', values: ['30', '60', '120', '240'], default: '60', cap: 'settings.world',
    label: 'Minutes of silence before a run is marked finished', help: 'A run that sends nothing for this long is ended as interrupted, so an agent never stays working forever.',
  },
  {
    path: 'activity.retentionDays', scope: 'install', tier: 2, type: 'days', default: null, cap: 'activity.retention', min: 30, max: 3650,
    choices: [null, 90, 180, 365, 730, 1825], rangeText: 'Keep world edits 30 to 3,650 days, or forever',
    label: 'Keep world edits (the activity log)', saved: 'Activity log retention saved',
    help: 'Older edits leave the activity log and can no longer be undone or reverted.',
    after: (s, days) => { if (days) s.journal?.purge(days); },   // the edit journal (WP1.8, DECISIONS C116)
  },
  // Free Will (docs/features/FREE-WILL.md): the installation's switch, its decision service (a connection id, chosen in
  // Settings → Free Will) and the daily limits that bound what it can spend.
  {
    path: 'freeWill.enabled', scope: 'install', tier: 2, type: 'boolean', default: true, cap: 'freewill.admin',
    label: 'Free Will: agents may let a decision service choose what they do', on: 'Free Will is on', off: 'Free Will is off: every agent follows its routine',
  },
  {
    path: 'freeWill.defaultConnection', scope: 'install', tier: 2, type: 'string', default: '', maxLength: 9, pattern: /^\d{1,9}$/, cap: 'freewill.admin',
    patternText: 'Choose one of the decision services in Settings → Free Will', label: 'Free Will: the decision service agents use unless their owner picks another',
  },
  {
    path: 'freeWill.dailyDecisions', scope: 'install', tier: 2, type: 'enum', values: ['1000', '10000', '50000', '200000', '1000000'], default: '50000', cap: 'freewill.admin',
    label: 'Free Will: most decisions per day, all agents together', help: 'A safety limit on spending; when it is reached, agents follow their routine until midnight UTC.',
  },
  {
    path: 'freeWill.agentDailyDecisions', scope: 'install', tier: 2, type: 'enum', values: ['300', '600', '1200', '2400', '4800'], default: '1200', cap: 'freewill.admin',
    label: 'Free Will: most decisions per day for one agent', help: 'With Free Will an agent decides its free time, meals, mornings, way to work, rest and tasks: about 150 to 300 decisions a real day (the world runs 16 times faster).',
  },
  {
    path: 'freeWill.keepDays', scope: 'install', tier: 2, type: 'days', default: 7, cap: 'freewill.admin', min: 1, max: 90,
    choices: [1, 3, 7, 14, 30, 90], rangeText: 'Keep the why-log 1 to 90 days', label: 'Free Will: keep the why-log', saved: 'Why-log retention saved',
  },
  // The Mind (docs/features/FREE-WILL.md §3–4): agents whose brain is a model provider plan their day and reflect on it once
  // a world day and answer their chats; agents without one get the daily reflection from the installation's brain. The
  // limits bound what it can spend.
  {
    path: 'mind.enabled', scope: 'install', tier: 2, type: 'boolean', default: true, cap: 'freewill.admin',
    label: 'The Mind: agents with a brain plan, reflect and answer their chats', on: 'The Mind is on', off: 'The Mind is off: no agent plans or reflects',
  },
  {
    path: 'mind.reflectConnection', scope: 'install', tier: 2, type: 'string', default: '', maxLength: 9, pattern: /^\d{1,9}$/, cap: 'freewill.admin',
    patternText: 'Choose one of the model providers in Settings → Free Will', label: 'The Mind: the brain that writes the daily reflection of agents without their own',
  },
  {
    path: 'mind.agentDailyJobs', scope: 'install', tier: 2, type: 'enum', values: ['20', '40', '80', '160', '320'], default: '80', cap: 'freewill.admin',
    label: 'The Mind: most thoughts per day for one agent', help: 'A plan and a reflection every world day are 32 a real day (the world runs 16 times faster); chats come on top.',
  },
  {
    path: 'mind.agentMonthlyUsd', scope: 'install', tier: 2, type: 'enum', values: ['1', '3', '5', '10', '25', '100'], default: '5', cap: 'freewill.admin',
    label: 'The Mind: most it may spend for one agent in a month (US$)', help: 'When an agent reaches it, it stops thinking until the 1st (UTC); its routine and Free Will go on.',
  },
  {
    path: 'mind.dailyUsd', scope: 'install', tier: 2, type: 'enum', values: ['5', '20', '100', '500', '2000'], default: '20', cap: 'freewill.admin',
    label: 'The Mind: most it may spend in a day, all agents together (US$)', help: 'A safety limit; when it is reached no agent thinks until midnight UTC.',
  },
  {
    path: 'mind.keepDays', scope: 'install', tier: 2, type: 'days', default: 30, cap: 'freewill.admin', min: 1, max: 365,
    choices: [7, 30, 90, 365], rangeText: 'Keep the record of thoughts 1 to 365 days', label: 'The Mind: keep the record of thoughts', saved: 'Thoughts retention saved',
  },
  {
    path: 'mind.speech', scope: 'install', tier: 2, type: 'boolean', default: true, cap: 'freewill.admin',
    label: 'The Mind: agents with a brain say their own words in public', help: 'When someone talks to them or they chat with someone in the world. Every line is checked by the moderation service first; without one nothing is said.',
  },
  {
    path: 'mind.moderationConnection', scope: 'install', tier: 2, type: 'string', default: '', maxLength: 9, pattern: /^\d{1,9}$/, cap: 'freewill.admin',
    patternText: 'Choose an OpenAI model provider in Settings → Free Will', label: 'The Mind: the moderation service that checks what agents say in public',
  },
  {
    path: 'mind.speechPerDay', scope: 'install', tier: 2, type: 'enum', values: ['2', '4', '8', '16', '32'], default: '8', cap: 'freewill.admin',
    label: 'Lines out loud: most one agent says in a world day (any agent)', help: 'A world day is 90 real minutes; each line is one short thought and one moderation check.',
  },
  {
    path: 'mind.chatModels', scope: 'install', tier: 2, type: 'string', default: '', maxLength: 2000, cap: 'freewill.admin',
    pattern: /^[\w.\/:@=,\s-]*$/,   // (read leniently by server/mind/mind.js chatModels(): a malformed entry is left out)
    patternText: 'Model names separated by commas, each optionally with its price per million tokens in and out: openai/gpt-6.1-sol=2/10',
    label: 'Chat window: models the installation\'s brain may answer with', help: 'Owners pick from these in a chat whose agent thinks with the installation\'s brain (its default model is always there). A price makes its use metered exactly; without one OpenRouter\'s own cost is used.',
  },
  {
    path: 'push.contact', scope: 'install', tier: 2, type: 'string', default: '', maxLength: 200, cap: 'settings.world',
    pattern: /^$|^https:\/\/[^\s]+$|^(mailto:)?[^\s@]+@[^\s@]+\.[^\s@]+$/, patternText: 'An email address, or the https address of this installation',
    label: 'Notifications: who the push services may contact', help: 'Browsers\' push services (Google, Mozilla, Apple) ask for a contact for the server that sends notifications. Empty: the installation\'s public address.',
  },
  {
    path: 'mind.chatPerDay', scope: 'install', tier: 2, type: 'enum', values: ['100', '200', '400', '1000', '5000'], default: '400', cap: 'freewill.admin',
    label: 'Chat window: most messages one agent answers in a day', help: 'A safety limit against runaway use; its owner\'s spending limits still apply.',
  },
  // Agents' phones (docs/features/phone.md): how often each phone's texts and calls are read from Twilio (no webhook,
  // so an installation without a public address works). Calls are read every third time.
  {
    path: 'phone.syncSeconds', scope: 'install', tier: 2, type: 'number', min: 5, max: 300, step: 1, default: 10, cap: 'connections.manage',
    label: 'Agents\' phones: check for new texts every (seconds)', help: 'Each phone asks its Twilio account this often; calls every third time. Lower is quicker, and more requests to Twilio.',
  },
  // Talking with others' agents in the city (docs/features/CHAT.md §14; 2026-10-08): a player — or anyone from the
  // map — talks with someone else's agent through a short bar, its answers in its speech bubble. Each conversation is a few
  // short messages and is cleared after a few minutes, so nobody builds up a long context to steer an agent with (prompt
  // injection) or a long and costly one. Read on every message: a change applies at once.
  {
    path: 'talk.enabled', scope: 'install', tier: 2, type: 'boolean', default: true, cap: 'freewill.admin',
    label: 'Talking with others\' agents: on', help: 'Off: nobody talks with someone else\'s agent — walking up to it or in its chat window; it only greets passers-by, as a resident does.',
  },
  {
    path: 'talk.maxMessages', scope: 'install', tier: 2, type: 'number', min: 1, max: 100, step: 1, default: 15, cap: 'freewill.admin',
    label: 'Talking with others\' agents: most messages in one conversation', help: 'Then it waits until the conversation is cleared.',
  },
  {
    path: 'talk.maxChars', scope: 'install', tier: 2, type: 'number', min: 20, max: 2000, step: 10, default: 200, cap: 'freewill.admin',
    label: 'Talking with others\' agents: longest message (characters)',
  },
  {
    path: 'talk.windowMinutes', scope: 'install', tier: 2, type: 'number', min: 1, max: 60, step: 1, default: 5, cap: 'freewill.admin',
    label: 'Talking with others\' agents: minutes before a conversation is cleared', help: 'From its first message. The next message starts a new conversation, with nothing of the last one.',
  },
  // (the product owner, 2026-10-10: every limit on agents talking and acting is the admin's, changed at
  // any time in Settings → Agent limits; the defaults are the values the code had)
  {
    path: 'talk.visitorPerDay', scope: 'install', tier: 2, type: 'number', min: 1, max: 1000, step: 1, default: 50, cap: 'freewill.admin',
    label: 'Talking with others\' agents: most messages one person sends one agent in a day', help: 'All their conversations with it in 24 hours together: a new conversation doesn\'t start the count again.',
  },
  {
    path: 'talk.agentVisitorPerDay', scope: 'install', tier: 2, type: 'number', min: 1, max: 5000, step: 1, default: 200, cap: 'freewill.admin',
    label: 'Talking with others\' agents: most visitors\' messages one agent answers in a day', help: 'From everyone together, so visitors can\'t use up what its owner pays for its brain.',
  },
  {
    path: 'mind.speechGapSeconds', scope: 'install', tier: 2, type: 'number', min: 5, max: 600, step: 1, default: 20, cap: 'freewill.admin',
    label: 'Lines out loud: least seconds between two lines of one agent (any agent)', help: 'For the world\'s own agents (the Mind).',
  },
  {
    path: 'mind.speechMaxChars', scope: 'install', tier: 2, type: 'number', min: 40, max: 280, step: 10, default: 140, cap: 'freewill.admin',
    label: 'Speaking in public: longest line (characters)', help: 'For every agent, the world\'s own and connected ones: a longer line is not said.',
  },
  {
    path: 'connected.hearMeters', scope: 'install', tier: 2, type: 'number', min: 3, max: 50, step: 1, default: 15, cap: 'freewill.admin',
    label: 'Connected agents: how near someone must be to hear them or be talked to (metres)',
  },
  {
    path: 'connected.heardMax', scope: 'install', tier: 2, type: 'number', min: 5, max: 100, step: 1, default: 20, cap: 'freewill.admin',
    label: 'Connected agents: most heard lines kept for one agent until it reads them', help: 'The oldest go first: a crowd can\'t flood an agent\'s inbox.',
  },
  {
    path: 'connected.nearMax', scope: 'install', tier: 2, type: 'number', min: 1, max: 30, step: 1, default: 8, cap: 'freewill.admin',
    label: 'Connected agents: most people shown around it', help: 'What the world hands its AI: the nearest first.',
  },
  {
    path: 'connected.placesMax', scope: 'install', tier: 2, type: 'number', min: 1, max: 30, step: 1, default: 8, cap: 'freewill.admin',
    label: 'Connected agents: most places shown near it',
  },
  {
    path: 'connected.inboxMax', scope: 'install', tier: 2, type: 'number', min: 1, max: 100, step: 1, default: 20, cap: 'freewill.admin',
    label: 'Connected agents: most messages handed over at once', help: 'The rest wait for its next check.',
  },
  {
    path: 'connected.orderGapSeconds', scope: 'install', tier: 2, type: 'number', min: 1, max: 300, step: 1, default: 10, cap: 'freewill.admin',
    label: 'Connected agents: least seconds between two orders (do, go, meet, stop)', help: 'An order the world refuses doesn\'t count.',
  },
  {
    path: 'connected.maxOrderMinutes', scope: 'install', tier: 2, type: 'number', min: 30, max: 1440, step: 10, default: 480, cap: 'freewill.admin',
    label: 'Connected agents: longest order (world minutes)',
  },
  {
    path: 'connected.meetSearchMinutes', scope: 'install', tier: 2, type: 'number', min: 10, max: 720, step: 10, default: 180, cap: 'freewill.admin',
    label: 'Connected agents: how long a meet looks for its person (world minutes)',
  },
  {
    path: 'connected.writesPerMinute', scope: 'install', tier: 2, type: 'number', min: 1, max: 200, step: 1, default: 20, cap: 'freewill.admin',
    label: 'Connected agents: most plans and memories written in a minute',
  },
  {
    path: 'connected.requestsPerMinute', scope: 'install', tier: 2, type: 'number', min: 10, max: 1000, step: 10, default: 120, cap: 'freewill.admin',
    label: 'Connected agents: most looks and actions one agent makes in a minute', help: 'Against floods; its inbox waits on its own.',
  },
  {
    path: 'connected.queueMax', scope: 'install', tier: 2, type: 'number', min: 10, max: 2000, step: 10, default: 200, cap: 'freewill.admin',
    label: 'Connected agents: most messages waiting for one that is offline', help: 'Then new ones are refused until it reads them.',
  },
  // the edge of an outside AI, which may hold more than this world (a terminal, a browser, its owner's apps): what reaches it,
  // what it may show visitors, and the switches that stop it all at once (2026-10-11)
  {
    path: 'connected.enabled', scope: 'install', tier: 2, type: 'boolean', default: true, cap: 'freewill.admin',
    label: 'Connected agents (outside AIs): on', help: 'Off: every outside AI is paused at once — told to try again later; nothing is lost.',
  },
  {
    path: 'connected.requireApproval', scope: 'install', tier: 2, type: 'boolean', default: true, cap: 'freewill.admin',
    label: 'Connected agents: a new connection waits for its owner\'s OK', help: 'An outside AI that joins with a code can do nothing until its owner approves it: a code seen by someone else is worth nothing.',
  },
  {
    path: 'connected.wakeEnabled', scope: 'install', tier: 2, type: 'boolean', default: true, cap: 'freewill.admin',
    label: 'Connected agents: the world may wake them with their owner\'s wake-up link', help: 'Off: an outside AI runs only when its own platform starts it (its owner, a timer).',
  },
  {
    path: 'connected.wakePerHour', scope: 'install', tier: 2, type: 'number', min: 1, max: 60, step: 1, default: 12, cap: 'freewill.admin',
    label: 'Connected agents: wake-ups an hour, at most, for each agent', help: 'Each wake-up starts its AI on its own platform and uses its owner\'s plan there; owners may choose fewer.',
  },
  {
    path: 'connected.visitorsEnabled', scope: 'install', tier: 2, type: 'boolean', default: true, cap: 'freewill.admin',
    label: 'Connected agents: visitors may chat with them', help: 'Off: only their owners chat with them.',
  },
  {
    path: 'connected.strikesPerDay', scope: 'install', tier: 2, type: 'number', min: 1, max: 50, step: 1, default: 5, cap: 'freewill.admin',
    label: 'Connected agents: refused messages before a visitor is kept away for a day', help: 'Messages refused as tricks, links or contact details; its owner is told.',
  },
  {
    path: 'connected.answerMaxChars', scope: 'install', tier: 2, type: 'number', min: 100, max: 20000, step: 100, default: 1500, cap: 'freewill.admin',
    label: 'Connected agents: longest answer one shows a visitor (characters)', help: 'A tricked AI can\'t hand over a whole document.',
  },
  {
    path: 'connector.perMinute', scope: 'install', tier: 2, type: 'number', min: 10, max: 1000, step: 10, default: 120, cap: 'freewill.admin',
    label: 'AI apps (Grok, ChatGPT…): most requests one connected app makes in a minute',
  },
  // Agents and friends (2026-10-10; server/agent-social/): friendships between agents grow with time
  // together, fade with time apart, drop with bad experiences and can be ended; friends may reach each other from a
  // distance (where is, a message, an invitation) only when they count each other as friends, their owners are friends
  // (or the same) and each agent's own setting lets them. Every limit here is counted by the server, from what is kept.
  {
    path: 'social.enabled', scope: 'install', tier: 2, type: 'boolean', default: true, cap: 'freewill.admin',
    label: 'Agents and friends: friends may reach each other from a distance', help: 'Off: no messages, invitations or "where is" between agents (meeting in person goes on).',
  },
  {
    path: 'social.friendAt', scope: 'install', tier: 2, type: 'number', min: 10, max: 95, step: 5, default: 50, cap: 'freewill.admin',
    label: 'Agents and friends: closeness that counts as a friend (%)', help: 'Both agents must feel at least this close to each other. Closeness grows with every time they spend together.',
  },
  {
    path: 'social.knownAt', scope: 'install', tier: 2, type: 'number', min: 5, max: 90, step: 5, default: 25, cap: 'freewill.admin',
    label: 'Agents and friends: closeness below which another agent is a stranger (%)', help: 'Connected agents hear strangers only when their owner lets them, and only a few lines a day each.',
  },
  {
    path: 'social.msgMaxChars', scope: 'install', tier: 2, type: 'number', min: 40, max: 1000, step: 10, default: 280, cap: 'freewill.admin',
    label: 'Agents and friends: longest message (characters)',
  },
  {
    path: 'social.convoMessages', scope: 'install', tier: 2, type: 'number', min: 1, max: 100, step: 1, default: 10, cap: 'freewill.admin',
    label: 'Agents and friends: most messages one agent sends one friend in a conversation', help: 'Then it waits: the count is over the minutes below.',
  },
  {
    path: 'social.convoMinutes', scope: 'install', tier: 2, type: 'number', min: 1, max: 240, step: 1, default: 30, cap: 'freewill.admin',
    label: 'Agents and friends: a conversation\'s length (real minutes)',
  },
  {
    path: 'social.pairPerDay', scope: 'install', tier: 2, type: 'number', min: 1, max: 1000, step: 1, default: 30, cap: 'freewill.admin',
    label: 'Agents and friends: most messages between two agents in a day (both ways, 24 hours)',
  },
  {
    path: 'social.sentPerDay', scope: 'install', tier: 2, type: 'number', min: 1, max: 2000, step: 1, default: 50, cap: 'freewill.admin',
    label: 'Agents and friends: most new messages one agent sends in a day', help: 'Its owner may set a lower number for their agent.',
  },
  {
    path: 'social.repliesPerDay', scope: 'install', tier: 2, type: 'number', min: 1, max: 2000, step: 1, default: 100, cap: 'freewill.admin',
    label: 'Agents and friends: most replies one agent sends in a day',
  },
  {
    path: 'social.strangerLinesPerDay', scope: 'install', tier: 2, type: 'number', min: 0, max: 50, step: 1, default: 3, cap: 'freewill.admin',
    label: 'Agents and friends: lines from one stranger an agent hears or answers in a day', help: 'In person. A connected agent hears strangers at all only when its owner lets it.',
  },
  {
    path: 'social.perMinute', scope: 'install', tier: 2, type: 'number', min: 1, max: 120, step: 1, default: 12, cap: 'freewill.admin',
    label: 'Agents and friends: most messages, invitations and looks one agent makes in a minute', help: 'Against floods: every message is checked by moderation first.',
  },
  {
    path: 'social.whereisPerDay', scope: 'install', tier: 2, type: 'number', min: 0, max: 500, step: 1, default: 30, cap: 'freewill.admin',
    label: 'Agents and friends: most "where is my friend" looks one agent makes in a day',
  },
  {
    path: 'social.invitesPerDay', scope: 'install', tier: 2, type: 'number', min: 0, max: 200, step: 1, default: 10, cap: 'freewill.admin',
    label: 'Agents and friends: most invitations one agent sends in a day',
  },
  {
    path: 'social.mindMessagesPerDay', scope: 'install', tier: 2, type: 'number', min: 0, max: 200, step: 1, default: 10, cap: 'freewill.admin',
    label: 'Agents and friends: most conversations an agent with a Mind starts by itself in a day', help: 'Its own message to a friend, written with its morning plan. Agents without a Mind never start one. 0: none.',
  },
  {
    path: 'social.mindInvitesPerDay', scope: 'install', tier: 2, type: 'number', min: 0, max: 20, step: 1, default: 1, cap: 'freewill.admin',
    label: 'Agents and friends: most invitations an agent with a Mind sends by itself in a day', help: '0: none.',
  },
  {
    path: 'social.fadeAfterDays', scope: 'install', tier: 2, type: 'number', min: 1, max: 60, step: 1, default: 7, cap: 'freewill.admin',
    label: 'Agents and friends: world days apart before closeness starts to fade', help: 'A world day is about 90 real minutes.',
  },
  {
    path: 'social.fadePerDay', scope: 'install', tier: 2, type: 'number', min: 0, max: 20, step: 1, default: 2, cap: 'freewill.admin',
    label: 'Agents and friends: how much closeness fades a world day after that (%)', help: 'Close friends fade more slowly. 0: friendships never fade.',
  },
  {
    path: 'social.coolOffDays', scope: 'install', tier: 2, type: 'number', min: 0, max: 60, step: 1, default: 3, cap: 'freewill.admin',
    label: 'Agents and friends: world days before an ended friendship can grow again', help: 'Then it starts again from nothing, by meeting.',
  },
  // Voice (docs/features/CHAT.md §9): the installation's own voice services — one that listens (dictation, voice mode) and
  // one that speaks (read aloud, voice mode) for everyone without a service of their own, within its daily
  // limit. Accounts and agents may choose their own (server/voice/voice.js).
  {
    path: 'voice.enabled', scope: 'install', tier: 2, type: 'boolean', default: true, cap: 'freewill.admin',
    label: 'Voice: the installation\'s voice services listen and speak for everyone', on: 'The installation\'s voice is on', off: 'The installation\'s voice is off: the browser\'s own voice, or people\'s own services',
  },
  {
    path: 'voice.listenConnection', scope: 'install', tier: 2, type: 'string', default: '', maxLength: 9, pattern: /^\d{1,9}$/, cap: 'freewill.admin',
    patternText: 'Choose one of the voice services in Settings → Connections', label: 'Voice: the service that listens (speech to text)',
  },
  {
    path: 'voice.speakConnection', scope: 'install', tier: 2, type: 'string', default: '', maxLength: 9, pattern: /^\d{1,9}$/, cap: 'freewill.admin',
    patternText: 'Choose one of the voice services in Settings → Connections', label: 'Voice: the service that speaks (text to speech)',
  },
  {
    path: 'voice.perMinute', scope: 'install', tier: 2, type: 'enum', values: ['20', '40', '60', '120', '240'], default: '60', cap: 'freewill.admin',
    label: 'Voice: most requests one account makes in a minute', help: 'Voice mode speaks an answer in a few pieces and hears each turn: a conversation makes about 10 to 20 a minute.',
  },
  {
    path: 'voice.dailyUsd', scope: 'install', tier: 2, type: 'enum', values: ['1', '5', '20', '100', '500'], default: '20', cap: 'freewill.admin',
    label: 'Voice: most the installation\'s voice may spend in a day, all accounts together (US$)', help: 'A safety limit; when it is reached everyone hears and speaks with the browser\'s own voice until midnight UTC.',
  },
  {
    path: 'agentLife.activityDays', scope: 'install', tier: 2, type: 'days', default: 7, cap: 'agents.manage', min: 1, max: 90,
    choices: [1, 3, 7, 14, 30, 90], rangeText: 'Keep agents\' activity logs 1 to 90 days', label: 'Agents: keep their activity logs', saved: 'Activity log retention saved',
  },
  // The agents' PC (docs/features/agent-pc.md §3): the storage each account gets (its agents' and teams' sizes added up and
  // shared), the largest file, how long the trash and old versions are kept. 0 MB for an agent: no limit.
  {
    path: 'pc.agentMB', scope: 'install', tier: 2, type: 'number', default: 200, cap: 'agents.manage', min: 0, max: 100000,
    label: 'Agents\' PC: storage for each agent (MB, shared by the account; 0 = no limit)', saved: 'PC storage saved',
  },
  {
    path: 'pc.teamMB', scope: 'install', tier: 2, type: 'number', default: 500, cap: 'agents.manage', min: 0, max: 100000,
    label: 'Agents\' PC: storage for each team (MB, shared by the account)', saved: 'PC storage saved',
  },
  {
    path: 'pc.fileMB', scope: 'install', tier: 2, type: 'number', default: 25, cap: 'agents.manage', min: 1, max: 2000,
    label: 'Agents\' PC: the largest file (MB)', saved: 'PC file size saved',
  },
  {
    path: 'pc.keepDays', scope: 'install', tier: 2, type: 'days', default: 30, cap: 'agents.manage', min: 1, max: 365,
    choices: [7, 14, 30, 60, 90, 365], rangeText: 'Keep the trash and old versions 1 to 365 days', label: 'Agents\' PC: keep the trash and older versions', saved: 'PC retention saved',
  },
  // The PC's web search when an agent's owner has no search service of their own (a connection of the kind "search"):
  // DuckDuckGo's page (no key, best effort), or none.
  {
    path: 'pc.search', scope: 'install', tier: 2, type: 'enum', values: ['duckduckgo', 'off'], default: 'duckduckgo', cap: 'agents.manage',
    label: 'Agents\' PC: the built-in web search (when an owner has no search service of their own)', saved: 'PC search saved',
  },
  // The built-in real browser (docs/features/agent-pc.md §5, server/pc/chrome.js): a Chrome this server runs for its
  // built-in agents — live to their owners, who can take it over. Off: they read pages with the built-in reader.
  {
    path: 'pc.realBrowser', scope: 'install', tier: 2, type: 'boolean', default: true, cap: 'agents.manage',
    label: 'Agents\' PC: a real browser for the built-in agents (Chrome on this server; off: the text reader)', saved: 'PC browser saved',
  },
  // Display preferences of an account (tier 0); they follow the account to every device (C91). Graphics quality stays
  // with each device and is not here.
  // The theme (WP1.9, C39): one of the three token sets in client/css/theme.css. A preference, so it follows the
  // account to every device and needs no password entry.
  { path: 'display.theme', scope: 'account', tier: 0, type: 'enum', values: ['dark', 'light', 'contrast'], default: 'dark', label: 'Theme' },
  // Agents' and residents' own emoji: as the emoji they chose, or drawn in the theme's icon style (client/js/core/icons.js).
  { path: 'display.agentEmoji', scope: 'account', tier: 0, type: 'enum', values: ['normal', 'styled'], default: 'normal', label: "Agents' emoji" },
  // The ambient soundscape (WP4.18): wind, rain, surf, birds, the city's hum; starts after the first click or key.
  { path: 'display.sound', scope: 'account', tier: 0, type: 'enum', values: ['off', 'quiet', 'normal', 'loud'], default: 'normal', label: 'Ambient sound' },
  // Sound (2026-10-20, Settings → Sound; client/js/audio/mixer.js): a master volume and one per kind of sound, in % —
  // the world (wind, rain, waves, birds, the city), aircraft and games, agents' voices, videos and recordings. They
  // follow the account; the top bar's sound on/off stays with each device. (display.sound, the old Ambient sound, is
  // kept for older releases: a device that had it starts the world's volume from it.) The defaults: shared/sound-defaults.js.
  { path: 'sound.master', scope: 'account', tier: 0, type: 'number', min: 0, max: 100, step: 5, default: SD.master, label: 'Master volume' },
  { path: 'sound.world', scope: 'account', tier: 0, type: 'number', min: 0, max: 100, step: 5, default: SD.world, label: 'World sounds' },
  { path: 'sound.aircraft', scope: 'account', tier: 0, type: 'number', min: 0, max: 100, step: 5, default: SD.aircraft, label: 'Aircraft and games' },
  { path: 'sound.voices', scope: 'account', tier: 0, type: 'number', min: 0, max: 100, step: 5, default: SD.voices, label: 'Agents\' voices' },
  { path: 'sound.media', scope: 'account', tier: 0, type: 'number', min: 0, max: 100, step: 5, default: SD.media, label: 'Videos and recordings' },
  { path: 'sound.music', scope: 'account', tier: 0, type: 'number', min: 0, max: 100, step: 5, default: SD.music, label: 'Live music' },
  { path: 'sound.score', scope: 'account', tier: 0, type: 'number', min: 0, max: 100, step: 5, default: SD.score, label: 'Background music' },
  { path: 'sound.effects', scope: 'account', tier: 0, type: 'number', min: 0, max: 100, step: 5, default: SD.effects, label: 'Sound effects' },
  { path: 'sound.vehicles', scope: 'account', tier: 0, type: 'number', min: 0, max: 100, step: 5, default: SD.vehicles, label: 'Vehicles' },
  { path: 'sound.radio', scope: 'account', tier: 0, type: 'number', min: 0, max: 100, step: 5, default: SD.radio, label: 'Radio' },
  // Off switches and levels for the heavy parts of the living world (WP4.9/4.17/4.18, spec §7.1 X8): drawn on this
  // account's screens only; the world itself is the same for everyone.
  { path: 'display.wildlife', scope: 'account', tier: 0, type: 'enum', values: ['off', 'fewer', 'normal'], default: 'normal', label: 'Wildlife' },
  { path: 'display.weatherFx', scope: 'account', tier: 0, type: 'enum', values: ['off', 'on'], default: 'on', label: 'Rain and lightning' },
  { path: 'display.traffic', scope: 'account', tier: 0, type: 'enum', values: ['off', 'light', 'normal'], default: 'normal', label: 'Traffic' },
  { path: 'display.vehicleDetail', scope: 'account', tier: 0, type: 'enum', values: ['simple', 'normal'], default: 'normal', label: 'Vehicle detail' },
  { path: 'display.promoAircraft', scope: 'account', tier: 0, type: 'enum', values: ['off', 'on'], default: 'on', label: 'Promotional aircraft' },
  // Online status (WP1.10, C118): Online, or Appear offline (hidden from the online list, join/leave lines and friends'
  // notices; the character stays visible to people near it; admins see the real status).
  { path: 'social.status', scope: 'account', tier: 0, type: 'enum', values: ['online', 'invisible'], default: 'online', label: 'Online status' },
  // This account's home view (WP1.9, C44): a small JSON frame, or empty when it has none.
  { path: 'display.home', scope: 'account', tier: 0, type: 'string', default: '', maxLength: 300, label: 'Home view' },
  { path: 'display.labels', scope: 'account', tier: 0, type: 'boolean', default: true, label: 'Name labels over residents' },
  { path: 'display.walls', scope: 'account', tier: 0, type: 'enum', values: ['cut', 'up', 'down'], default: 'cut', label: 'Interior walls' },
  { path: 'display.rosterFolded', scope: 'account', tier: 0, type: 'boolean', default: false, label: 'People list folded away' },
  { path: 'display.docks', scope: 'account', tier: 0, type: 'string', default: '', maxLength: 300, label: 'Which panels are open' },
  // WP1.7 revision (DECISIONS C115): the team list's order, and the places this account marked as favourites (the
  // buildings' permanent ids, comma separated).
  { path: 'display.teamSort', scope: 'account', tier: 0, type: 'enum', values: ['world', 'name', 'work', 'home'], default: 'world', label: 'How the team list is sorted' },
  // 2026-10-09: which agents the team list shows: this account's own (mine), or the agents anyone may talk with (public).
  // Nobody's private agents are ever listed to anyone else.
  { path: 'display.teamView', scope: 'account', tier: 0, type: 'enum', values: ['mine', 'public'], default: 'mine', label: 'Which agents the team list shows' },
  { path: 'display.favourites', scope: 'account', tier: 0, type: 'string', default: '', maxLength: 1200, label: 'Favourite places' },
  { path: 'display.seenHelp', scope: 'account', tier: 0, type: 'boolean', default: false, label: 'The controls tip was shown' },
  // 2026-10-09: the in-world guide (server/guide.js, client/js/ui/guide.js): the welcome tour seen or skipped, the
  // Getting started checklist hidden — a small JSON value kept with the account, never taken from a device.
  { path: 'display.guide', scope: 'account', tier: 0, type: 'string', default: '', maxLength: 200, label: 'Getting started: the tour and the checklist' },
  // 2026-10-23: the lot an account calls its home base (server/towns.js): where its agents live and work. Kept only while
  // it holds that lot (POST /api/property/home-base checks it); unset: the first lot it came to hold.
  { path: 'property.homeBase', scope: 'account', tier: 0, type: 'string', default: '', maxLength: 16, label: 'My home base (a lot I hold)' },
  // 2026-10-08: the selection widget across the top opens when something is selected and folds when nothing is (auto),
  // or stays as the person left it (open / closed: Manual). (It replaced display.selection — the Info panel option is gone.)
  { path: 'display.selectionWidget', scope: 'account', tier: 0, type: 'enum', values: ['auto', 'open', 'closed'], default: 'auto', label: 'The selection widget' },
  // 2026-10-08: how see-through windows, panels and buttons are, in % (0: solid, as the theme draws them; client/css/theme.css)
  { path: 'display.transparency', scope: 'account', tier: 0, type: 'number', min: 0, max: 60, step: 5, default: 0, label: 'Transparency' },
].map(defineSetting));

function decodeInstall(e, raw) {
  if (e.type === 'boolean') return raw === '1' || raw === 'true';
  if (e.type === 'days') { const n = Number(raw); return Number.isInteger(n) && n > 0 ? n : null; }
  if (e.type === 'number') { const n = Number(raw); return Number.isInteger(n) ? n : e.default; }
  return raw;
}
const encodeInstall = (e, v) => (e.type === 'boolean' ? (v ? '1' : '0') : String(v));
const parseAccount = (raw, fallback) => { try { return JSON.parse(raw); } catch { return fallback; } };
const bad = msg => new AuthError(400, 'bad_request', msg);

/** { op: 'set', value } | { op: 'reset' } | { op: 'keep' } for a value sent for e. */
function checkValue(e, v) {
  if (e.type === 'secret') {
    if (v === null) return { op: 'reset' };
    if (typeof v !== 'string') throw bad(`${e.label}: send text, an empty text to keep the stored value, or null to clear it`);
    if (v === '') return { op: 'keep' };                  // as in release 1: a blank field keeps the stored value
    if (v.length > 4096) throw bad(`${e.label} is too long`);
    return { op: 'set', value: v };
  }
  if (v === null) return { op: 'reset' };
  if (e.type === 'boolean') {
    if (typeof v !== 'boolean') throw bad(`${e.label} must be true or false`);
    return { op: 'set', value: v };
  }
  if (e.type === 'enum') {
    if (!e.values.includes(v)) throw bad(`${e.label} must be one of ${e.values.join(', ')}`);
    return { op: 'set', value: v };
  }
  if (e.type === 'days') {
    if (v === 0) return { op: 'reset' };
    const n = Number(v);
    if (typeof v === 'boolean' || !Number.isInteger(n) || n < e.min || n > e.max) throw bad(e.rangeText || `${e.label}: ${e.min} to ${e.max} days`);
    return { op: 'set', value: n };
  }
  if (e.type === 'number') {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < e.min || v > e.max || (e.step && (v - e.min) % e.step)) throw bad(e.rangeText || `${e.label}: a whole number from ${e.min} to ${e.max}${e.step > 1 ? ` in steps of ${e.step}` : ''}`);
    return { op: 'set', value: v };
  }
  if (typeof v !== 'string' || v.length > (e.maxLength || 2000)) throw bad(`${e.label} must be text`);
  if (e.pattern && v.trim() && !e.pattern.test(v.trim())) throw bad(e.patternText || `${e.label} is not valid`);
  return { op: 'set', value: v.trim() };
}

export class Settings {
  /**
   * @param {object} store  openDb() result
   * @param {object} o
   * @param {object} o.perms           Permissions (its settings cache is reloaded after changes)
   * @param {object} [o.box]           SecretBox for secret settings
   * @param {object} [o.audit]         Audit
   * @param {Array}  [o.entries]       the registry (tests add entries of their own)
   * @param {function} [o.onAccessChange]
   */
  constructor(store, { perms, box = null, audit = null, now = () => Date.now(), entries = SETTINGS, onAccessChange = () => {} } = {}) {
    this.store = store;
    this.w = store.worldId;
    this.perms = perms;
    this.box = box;
    this.audit = audit;
    this.now = now;
    this.onAccessChange = onAccessChange;
    this.watchers = new Set();   // fn(paths): installation settings changed (features that cache them refresh at once)
    this.entries = entries;
    this.byPath = new Map(this.entries.map(e => [e.path, e]));
    const db = store.db;
    this.q = {
      getInstall: db.prepare('SELECT value FROM settings WHERE world_id = ? AND key = ?'),
      putInstall: db.prepare('INSERT INTO settings (world_id, key, value) VALUES (?, ?, ?) ON CONFLICT (world_id, key) DO UPDATE SET value = excluded.value'),
      delInstall: db.prepare('DELETE FROM settings WHERE world_id = ? AND key = ?'),
      accountAll: db.prepare('SELECT key, value FROM account_settings WHERE account_id = ?'),
      getAccount: db.prepare('SELECT value FROM account_settings WHERE account_id = ? AND key = ?'),
      putAccount: db.prepare(`INSERT INTO account_settings (account_id, world_id, key, value, updated) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (account_id, key) DO UPDATE SET value = excluded.value, updated = excluded.updated`),
      delAccount: db.prepare('DELETE FROM account_settings WHERE account_id = ? AND key = ?'),
    };
  }
  /** Calls fn(paths) after installation settings change; returns a function that stops it. */
  watch(fn) { this.watchers.add(fn); return () => this.watchers.delete(fn); }
  /** Whether this installation has the setting. */
  has(path, scope = 'install') { return this.byPath.get(path)?.scope === scope; }
  entry(path, scope) {
    const e = this.byPath.get(path);
    if (!e || e.scope !== scope) throw bad(`Unknown setting: ${String(path).slice(0, 80)}`);
    return e;
  }
  storeKey(e) { return e.type === 'secret' ? SECRET_PREFIX + e.path : e.path; }
  why(e) {
    const m = this.perms.minRole(e.cap);
    return m === 'owner' ? 'Only the owner can change this' : m === 'admin' ? 'Only admins can change this' : 'Your role cannot change this';
  }
  redacted(view) { return redact(view, this.box ? this.box.known : null); }

  // ---------------------------------------------------------------- reading (server side)
  /** An installation setting's value (not for secrets). */
  get(path) {
    const e = this.entry(path, 'install');
    if (e.type === 'secret') throw new Error(`${path} is a secret: use secret()`);
    const raw = this.q.getInstall.get(this.w, e.path)?.value;
    return raw === undefined ? e.default : decodeInstall(e, raw);
  }
  /** An installation secret, opened, for the server's own use; null when not set. Never send it to a browser. */
  secret(path) {
    const e = this.entry(path, 'install');
    const raw = this.q.getInstall.get(this.w, this.storeKey(e))?.value;
    return raw === undefined ? null : this.box.open(raw, aadInstall(this.w, e.path));
  }
  /** An account's own (non-secret) setting, for the server's own use: its stored value or the default. */
  accountValue(accountId, path) {
    const e = this.entry(path, 'account');
    if (e.type === 'secret') throw new Error(`${path} is a secret: use accountSecret()`);
    const raw = this.q.getAccount.get(accountId, this.storeKey(e))?.value;
    return raw === undefined ? e.default : parseAccount(raw, e.default);
  }
  /** An account's own secret, opened, for the server's own use; null when not set. */
  accountSecret(accountId, path) {
    const e = this.entry(path, 'account');
    const raw = this.q.getAccount.get(accountId, this.storeKey(e))?.value;
    return raw === undefined ? null : this.box.open(raw, aadAccount(this.w, accountId, e.path));
  }

  // ---------------------------------------------------------------- views (secrets only as set / not set)
  describe(e, raw, extra) {
    const o = { path: e.path, tier: e.tier, tierName: TIER_NAMES[e.tier], type: e.type, label: e.label, help: e.help || '', ...extra };
    if (e.type === 'secret') o.set = raw !== undefined;
    else {
      o.value = raw === undefined ? e.default : e.scope === 'install' ? decodeInstall(e, raw) : parseAccount(raw, e.default);
      o.default = e.default;
    }
    for (const k of ['values', 'valueLabels', 'choices', 'min', 'max', 'step', 'on', 'off', 'saved']) if (e[k] !== undefined) o[k] = e[k];
    return o;
  }
  installView(P) {
    return this.redacted({
      settings: this.entries.filter(e => e.scope === 'install').map(e => {
        const can = this.perms.allowed(P, e.cap);
        return this.describe(e, this.q.getInstall.get(this.w, this.storeKey(e))?.value, { canChange: can, why: can ? null : this.why(e) });
      }),
      key: this.box ? this.box.status() : null,
    });
  }
  accountView(P) {
    const stored = new Map(this.q.accountAll.all(P.account.id).map(r => [r.key, r.value]));
    return this.redacted({
      settings: this.entries.filter(e => e.scope === 'account').map(e => {
        const raw = stored.get(this.storeKey(e));
        return this.describe(e, raw, { stored: raw !== undefined });
      }),
    });
  }

  // ---------------------------------------------------------------- changes
  /** Checks a whole change before anything is stored: permissions, values, and a recent password entry for tiers 1–2. */
  plan(P, values, scope) {
    if (!values || typeof values !== 'object' || Array.isArray(values)) throw bad('Send the settings to change as { values: { name: value } }');
    const paths = Object.keys(values);
    if (!paths.length) throw bad('Nothing to change');
    if (paths.length > 100) throw bad('Too many settings at once');
    let needsReauth = false;
    const out = paths.map(p => {
      const e = this.entry(p, scope);
      if (!this.perms.allowed(P, e.cap)) throw new AuthError(403, 'forbidden', `${this.why(e)}: ${e.label}`);
      const c = checkValue(e, values[p]);
      if (e.tier >= 1 && c.op !== 'keep') needsReauth = true;
      return { e, ...c };
    });
    if (needsReauth && !(P.session && this.now() - P.session.authAt <= LIMITS.reauthMs)) {
      throw new AuthError(403, 'reauth_required', 'Confirm your password to continue');
    }
    return out;
  }
  changeInstall(P, values, { ip = null } = {}) {
    const plan = this.plan(P, values, 'install');
    const actor = P.account ? { id: P.account.id, login: P.account.login } : null;
    const changes = {};
    this.store.tx(() => {
      for (const { e, op, value } of plan) {
        if (op === 'keep') continue;
        const key = this.storeKey(e);
        if (op === 'reset') {
          this.q.delInstall.run(this.w, key);
          changes[e.path] = e.type === 'secret' ? 'cleared' : e.default;
        } else {
          this.q.putInstall.run(this.w, key, e.type === 'secret' ? this.box.seal(value, aadInstall(this.w, e.path)) : encodeInstall(e, value));
          changes[e.path] = e.type === 'secret' ? 'set' : value;
        }
      }
      if (Object.keys(changes).length) this.audit?.log('settings.change', { actor, ip, detail: { changes } });
    });
    this.perms?.reload();
    for (const { e, op, value } of plan) if (op !== 'keep' && e.after) e.after(this, op === 'reset' ? e.default : value, actor);
    const paths = Object.keys(changes);
    if (paths.length) for (const fn of this.watchers) { try { fn(paths); } catch { /* a watcher never breaks a save */ } }
    return changes;
  }
  changeAccount(P, values, { ip = null } = {}) {
    const plan = this.plan(P, values, 'account');
    const id = P.account.id, secrets = {};
    this.store.tx(() => {
      for (const { e, op, value } of plan) {
        if (op === 'keep') continue;
        const key = this.storeKey(e);
        if (op === 'reset') this.q.delAccount.run(id, key);
        else this.q.putAccount.run(id, this.w, key, e.type === 'secret' ? this.box.seal(value, aadAccount(this.w, id, e.path)) : JSON.stringify(value), this.now());
        if (e.type === 'secret') secrets[e.path] = op === 'reset' ? 'cleared' : 'set';
      }
      // Own secrets are recorded (credentials, C92); display preferences are not.
      if (Object.keys(secrets).length) {
        const me = { id, login: P.account.login };
        this.audit?.log('account.secret', { actor: me, target: me, ip, detail: { changes: secrets } });
      }
    });
    const changed = plan.filter(x => x.op !== 'keep').map(x => x.e.path);
    if (changed.length) this.onAccountChange?.(id, changed);
  }
}

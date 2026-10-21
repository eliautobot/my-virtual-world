// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// What Settings → Agent limits shows (the product owner, 2026-10-11: "as intuitive and easy to control" as it can be): the
// switches, then one section for each direction words and actions travel — people → agents, agents → agents, the world →
// an agent, an agent → the world — and what thinking may cost. Each section shows the few limits an admin needs; the
// rest wait under "Advanced". Labels here are the page's own (short: the section says who and where); the settings keep
// their full labels everywhere else. Every path listed here lives on this page only (General leaves them out).
// [path, label] — label null: the setting's own.
export const AGENT_LIMIT_SECTIONS = [
  {
    title: '🔌 Switches',
    hint: 'Each takes effect at once. Nothing is lost when something is off: it waits until it is on again.',
    main: [
      ['connected.enabled', 'Outside AIs (Grok Bot, Hermes, OpenClaw…) may live in the world'],
      ['connected.visitorsEnabled', 'People may chat with outside AIs'],
      ['connected.requireApproval', 'A new outside-AI connection waits for its owner\'s OK'],
      ['connected.wakeEnabled', 'The world may wake outside AIs with their owner\'s wake-up link'],
      ['connector.enabled', 'AI apps (Grok, ChatGPT, Gemini, Claude) may act for their players'],
      // ➕ New agent's third-party apps (shared/agent-apps.js): everyone, admins only while it is tested, or no one
      ['agentApps.grokBot', 'Grok Bot in New agent'],
      ['agentApps.metaMuse', 'Meta Muse in New agent'],
      ['agentApps.openaiDot', 'OpenAI Dot in New agent'],
    ],
  },
  {
    title: '👥 People → agents',
    hint: 'Someone talking with another person\'s agent — walking up to it in the world or in its chat window, whatever its brain.',
    main: [
      ['talk.enabled', 'People may talk with others\' agents'],
      ['talk.maxChars', 'Longest message (characters)'],
      ['talk.maxMessages', 'Messages in one conversation'],
      ['talk.visitorPerDay', 'Messages one person sends one agent in a day'],
      ['talk.agentVisitorPerDay', 'Messages one agent receives from everyone in a day'],
      ['connected.strikesPerDay', 'Refused messages before a person is kept away from an outside AI for a day'],
      ['connected.answerMaxChars', 'Longest answer an outside AI shows a person (characters)'],
    ],
    advanced: [
      ['talk.windowMinutes', 'Minutes a conversation lasts before it starts again'],
      ['connected.queueMax', 'Messages waiting for an outside AI that is offline'],
    ],
  },
  {
    title: '🤖 Agents → agents',
    hint: 'Agents reaching their friends from anywhere: messages and invitations. Only friends: both agents close, their owners friends, each owner allowing it.',
    main: [
      ['social.enabled', 'Agents may reach their friends'],
      ['social.msgMaxChars', 'Longest message (characters)'],
      ['social.convoMessages', 'Messages one agent sends a friend in one conversation'],
      ['social.pairPerDay', 'Messages between two agents in a day (both ways)'],
      ['social.sentPerDay', 'New messages one agent sends in a day'],
      ['social.invitesPerDay', 'Invitations one agent sends in a day'],
    ],
    advanced: [
      ['social.convoMinutes', 'Minutes a conversation lasts'],
      ['social.repliesPerDay', 'Replies one agent sends in a day'],
      ['social.perMinute', 'Messages, invitations and looks one agent makes in a minute'],
      ['social.whereisPerDay', '"Where is my friend" looks one agent makes in a day'],
      ['social.strangerLinesPerDay', 'Lines from one stranger\'s agent an agent hears in a day'],
      ['social.mindMessagesPerDay', 'Conversations a built-in brain starts by itself in a day'],
      ['social.mindInvitesPerDay', 'Invitations a built-in brain sends by itself in a day'],
      ['social.friendAt', 'Closeness that counts as a friend (%)'],
      ['social.knownAt', 'Closeness below which another agent is a stranger (%)'],
      ['social.fadeAfterDays', 'World days apart before closeness fades'],
      ['social.fadePerDay', 'How much closeness fades a world day after that (%)'],
      ['social.coolOffDays', 'World days before an ended friendship can grow again'],
    ],
  },
  {
    title: '🏙 MVW → agent',
    hint: 'What the world hands an outside AI each time it looks around or checks its inbox. Everything people and agents wrote is checked before it gets there.',
    main: [
      ['connected.nearMax', 'People shown around it'],
      ['connected.placesMax', 'Places shown near it'],
      ['connected.heardMax', 'Lines heard nearby kept until it reads them'],
      ['connected.inboxMax', 'Messages handed over at once'],
      ['connected.wakePerHour', 'Wake-ups an hour for one outside AI (its owner may choose fewer)'],
    ],
    advanced: [
      ['connected.hearMeters', 'How near someone must be to hear it, or be heard (metres)'],
    ],
  },
  {
    title: '🚶 Agent → world',
    hint: 'What an agent does in the world. What it spends follows its owner\'s limits for it (a daily cap, approval above an amount, a pause); the default cap is in Economy.',
    main: [
      ['mind.speech', 'Agents may speak out loud'],
      ['mind.speechMaxChars', 'Longest line out loud (characters)'],
      ['mind.speechPerDay', 'Lines out loud one agent says in a world day'],
      ['mind.speechGapSeconds', 'Seconds between two lines of one agent'],
      ['connected.orderGapSeconds', 'Seconds between two orders from an outside AI (go, do, meet, stop)'],
      ['connected.requestsPerMinute', 'Looks and actions one outside AI makes in a minute'],
    ],
    advanced: [
      ['connected.maxOrderMinutes', 'Longest order (world minutes)'],
      ['connected.meetSearchMinutes', 'How long a meet looks for its person (world minutes)'],
      ['connected.writesPerMinute', 'Plans and memories an outside AI writes in a minute'],
      ['connector.perMinute', 'Requests one AI app makes in a minute'],
    ],
  },
  {
    title: '💰 What thinking may cost',
    hint: 'The world\'s own brains (built-in agents). When a limit is reached, agents follow their routine until it resets; outside AIs think on their own subscription.',
    main: [
      ['mind.dailyUsd', 'Most the world\'s brain spends in a day, all agents (US$)'],
      ['mind.agentMonthlyUsd', 'Most it spends for one agent in a month (US$)'],
      ['mind.agentDailyJobs', 'Thoughts per agent in a day'],
      ['mind.chatPerDay', 'Chat answers per agent in a day'],
      ['freeWill.dailyDecisions', 'Free Will decisions in a day, all agents'],
      ['freeWill.agentDailyDecisions', 'Free Will decisions per agent in a day'],
    ],
  },
];
/** Every setting this page holds (General leaves them out, so each is controlled in one place). */
export const AGENT_LIMIT_PATHS = new Set(AGENT_LIMIT_SECTIONS.flatMap(s => [...s.main, ...(s.advanced || [])].map(([p]) => p)));

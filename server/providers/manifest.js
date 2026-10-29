// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Provider manifests (PLAN WP2.2; DECISIONS C11, A9, E20; CHECKLIST X12).
// A manifest is what the server and the pages know about a kind of agent connection before any adapter exists: its
// label, how it connects, which fields it needs (and which are secret), and what it can do. Settings → Connections is
// drawn from these; the pages never hard-code a provider. Manifests contain no secrets and no personal data.
// 'decisions': a decision service (Free Will, docs/features/FREE-WILL.md) — it picks from given options and is never an
// agent's chat brain (a connection without 'chat' cannot be linked to an agent).
// (Agent Providers, docs/features/agent-providers.md §4: agents — the provider lists its own agents; tools — each step
// as it runs; context — the context meter; questions — the agent asks the person; plan — the plan card; commands — slash
// commands; observe — live activity in a session from the provider's other channels; settings — its own sub-menu;
// rewrite — editing a message and writing an answer again; false where the provider keeps the history itself; media —
// the images, video and audio an answer carries, shown in the chat window; queue — messages sent while the agent works:
// the provider takes them in (into the running turn, or after it, as it is set up); tasks — the chat's background tasks
// (subagents, jobs) in the side panel, for whoever manages the provider; browser — the agents' own browser there, live;
// phone — a phone service: numbers that text and call, given to agents as their phones, docs/features/phone.md; files —
// it takes any file a person attaches (video, audio …), not only images, PDF, documents and text); rewind — the provider
// rewinds its own record to before one of the person's messages and goes on from there (an edit, a checkpoint restored,
// an answer written again: Hermes' truncating prompt.submit); branch — a chat copied up to an answer into a new one;
// titles — its own sessions' titles are the record (they follow its renaming, and a rename here goes to it); archive —
// a chat archived on the provider (kept there, out of its lists); native — its own calls for its chat view (Hermes: its slash
// commands as its Desktop runs them, its / and @ suggestions, side questions and background tasks); search — a web search
// service for the agents' PC (docs/features/agent-pc.md §5)
export const CAPABILITIES = Object.freeze(['chat', 'sessions', 'models', 'effort', 'attachments', 'approvals', 'stop', 'taskProgress', 'presence', 'decisions', 'speak', 'listen',
  'agents', 'tools', 'context', 'questions', 'plan', 'commands', 'observe', 'settings', 'rewrite', 'media', 'queue', 'tasks', 'browser', 'phone', 'files',
  'rewind', 'branch', 'titles', 'archive', 'native', 'search', 'computer', 'screen']);
export const CONNECTION_KINDS = Object.freeze(['remote', 'host-process']);
export const TRANSPORTS = Object.freeze(['network', 'process']);
export const FIELD_TYPES = Object.freeze(['text', 'url', 'secret', 'select', 'number', 'path', 'boolean']);

const ID = /^[a-z][a-z0-9-]{1,31}$/;
const KEY = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;

/** Problems with a manifest, as readable strings; an empty array means it is valid. */
export function validateManifest(m) {
  const p = [];
  if (!m || typeof m !== 'object') return ['not an object'];
  if (!ID.test(m.id || '')) p.push('id must be lower-case letters, digits and dashes');
  if (typeof m.label !== 'string' || !m.label.trim()) p.push('label is required');
  if (!TRANSPORTS.includes(m.transport)) p.push(`transport must be one of ${TRANSPORTS.join(', ')}`);
  if (!CONNECTION_KINDS.includes(m.connectionKind)) p.push(`connectionKind must be one of ${CONNECTION_KINDS.join(', ')}`);
  if (typeof m.official !== 'string' || m.official.trim().length < 8) p.push('official must name the vendor\'s documented interface this adapter uses (X12)');
  if (!Array.isArray(m.fields)) p.push('fields must be a list');
  else {
    const seen = new Set();
    for (const f of m.fields) {
      if (!f || !KEY.test(f.key || '')) { p.push('a field has a bad key'); continue; }
      if (seen.has(f.key)) p.push(`field ${f.key} is listed twice`);
      seen.add(f.key);
      if (!FIELD_TYPES.includes(f.type)) p.push(`field ${f.key}: type must be one of ${FIELD_TYPES.join(', ')}`);
      if (f.type === 'secret' && f.default !== undefined) p.push(`field ${f.key}: a secret has no default`);
      if (f.type === 'select' && !(Array.isArray(f.options) && f.options.length)) p.push(`field ${f.key}: a select needs options`);
      // system: a credential the server keeps for the connection itself (a device key); nobody types it in
      if (f.system && f.type !== 'secret') p.push(`field ${f.key}: only a secret can be the system's`);
      if ((f.handoff || f.unlessSet) && f.type !== 'secret') p.push(`field ${f.key}: only a secret is handed off`);
      for (const k of ['requiredIf', 'showIf']) if (f[k] !== undefined && (!f[k] || typeof f[k] !== 'object' || !Object.keys(f[k]).length)) p.push(`field ${f.key}: ${k} names another field's value`);
    }
  }
  if (!m.capabilities || typeof m.capabilities !== 'object') p.push('capabilities are required');
  else for (const k of Object.keys(m.capabilities)) if (!CAPABILITIES.includes(k)) p.push(`unknown capability ${k}`);
  if (m.modes !== undefined) {
    if (!Array.isArray(m.modes) || !m.modes.length) p.push('modes must be a non-empty list');
    else for (const x of m.modes) if (!x || !x.id || !CONNECTION_KINDS.includes(x.connectionKind)) p.push('a mode needs an id and a connectionKind');
  }
  return p;
}
export function assertManifest(m) {
  const p = validateManifest(m);
  if (p.length) throw new Error(`Bad provider manifest${m && m.id ? ` "${m.id}"` : ''}: ${p.join('; ')}`);
  return m;
}

/** 'remote' or 'host-process' for one connection: a manifest with modes (Hermes: API or command line) decides by the
 *  mode in the connection's settings; otherwise the manifest's own kind. Who may add a connection follows from this. */
/** Whether a kind is a decision service (Free Will) rather than an agent provider. */
export const isDecisionKind = m => !!(m && m.capabilities && m.capabilities.decisions);

export function connectionKindFor(m, config = {}) {
  if (Array.isArray(m.modes)) {
    const mode = m.modes.find(x => x.id === (config && config.mode)) || m.modes[0];
    return mode.connectionKind;
  }
  return m.connectionKind;
}

const ALL = Object.freeze({ chat: true, sessions: true, models: true, effort: true, attachments: true, approvals: true, stop: true, taskProgress: true, presence: true });
const f = (key, label, type, o = {}) => ({ key, label, type, ...o });

/** The voice services a 'voice' connection may name (docs/features/CHAT.md §9; each checked against its vendor's
 *  documentation 2026-10-08): what each can do (speak: text to speech; listen: speech to text), its default models and
 *  voice, and its list prices (US$; a connection's own price fields win) so the installation's voice is metered. A
 *  "model" for Deepgram's speaking is its voice (aura-2-…-en). Settings → Connections draws the form from this. */
export const VOICE_PROVIDERS = Object.freeze({
  openai: { label: 'OpenAI', speak: true, listen: true, speakModel: 'gpt-4o-mini-tts', listenModel: 'gpt-4o-mini-transcribe', voice: 'alloy', speakPrice: 15, listenPrice: 0.003,
    docs: 'https://platform.openai.com/docs/guides/text-to-speech' },
  // (speaking: Kokoro, af_heart — the live bake-off of 2026-10-08, docs/features/CHAT.md §9.4: the fastest heard right at
  // ≤ $15 per million characters, at $0.62; OpenAI's TTS isn't on OpenRouter's speech list any more)
  openrouter: { label: 'OpenRouter', speak: true, listen: true, speakModel: 'hexgrad/kokoro-82m', listenModel: 'openai/whisper-large-v3', voice: 'af_heart', speakPrice: 0.62, listenPrice: 0,
    docs: 'https://openrouter.ai/docs/guides/overview/multimodal/tts' },
  groq: { label: 'Groq', speak: true, listen: true, speakModel: 'canopylabs/orpheus-v1-english', listenModel: 'whisper-large-v3-turbo', voice: 'troy', speakPrice: 22, listenPrice: 0.04 / 60,
    docs: 'https://console.groq.com/docs/speech-to-text' },
  elevenlabs: { label: 'ElevenLabs', speak: true, listen: true, speakModel: 'eleven_flash_v2_5', listenModel: 'scribe_v2', voice: 'JBFqnCBsd6RMkjVDRZzb', speakPrice: 50, listenPrice: 0,
    docs: 'https://elevenlabs.io/docs/api-reference/text-to-speech/convert' },
  google: { label: 'Google Cloud', speak: true, listen: true, speakModel: '', listenModel: '', voice: 'en-US-Neural2-F', speakPrice: 16, listenPrice: 0.016,
    docs: 'https://cloud.google.com/text-to-speech/docs/reference/rest' },
  deepgram: { label: 'Deepgram', speak: true, listen: true, speakModel: '', listenModel: 'nova-3', voice: 'aura-2-thalia-en', speakPrice: 30, listenPrice: 0.0043,
    docs: 'https://developers.deepgram.com/reference/text-to-speech/speak-request' },
  xai: { label: 'xAI (Grok)', speak: true, listen: true, speakModel: '', listenModel: 'grok-voice-transcribe-2.0', voice: 'eve', speakPrice: 15, listenPrice: 0.10 / 60,
    docs: 'https://docs.x.ai/developers/model-capabilities/audio/voice' },
  qwen: { label: 'Qwen (Alibaba Model Studio)', speak: true, listen: true, speakModel: 'qwen3-tts-flash', listenModel: 'qwen3-asr-flash', voice: 'Cherry', speakPrice: 10, listenPrice: 0,
    docs: 'https://www.alibabacloud.com/help/en/model-studio/qwen-tts-api' },
  custom: { label: 'Any OpenAI-compatible server', speak: true, listen: true, speakModel: 'tts-1', listenModel: 'whisper-1', voice: 'alloy', speakPrice: 0, listenPrice: 0,
    docs: 'https://platform.openai.com/docs/api-reference/audio' },
});
/** Whether a voice connection does this ('speak' | 'listen'): what its service can do, and for an OpenAI-compatible server
 *  what its owner says it offers (does: a text-to-speech server like Kokoro only speaks, a transcription server like
 *  Whisper or Qwen3-ASR only listens; 'both', the default, is what every connection made before it said). The server's
 *  voice, the pages' pickers and the adapter's test all go by this. */
export function voiceDoes(config, what) {
  const c = config || {}, provider = c.provider || 'openai', def = VOICE_PROVIDERS[provider];
  if (!def || (what !== 'speak' && what !== 'listen') || !def[what]) return false;
  return provider !== 'custom' || !c.does || c.does === 'both' || c.does === what;
}

/** The kinds this product lists. `arrivesIn` names the work package that builds the adapter; until then the kind is
 *  listed and says so. `official` is the vendor's documented interface the adapter will use (X12). */
export const BUILTIN_MANIFESTS = Object.freeze([
  {
    // Agent Providers (docs/features/agent-providers.md): the adapter is server/providers/openclaw/. live: it keeps a
    // connection open (the server connects it at start and when it changes), and the provider's own agents become agents
    // here (agents: true). access: 'full' asks for OpenClaw's operator.admin scope too, so its settings can be changed from
    // its sub-menu; 'chat' leaves it out. deviceKey and deviceToken are the device pairing's, kept by the server.
    // pairs: it signs in as a device the gateway's owner approves (the pages speak of pairing and its devices).
    // detect: where else Agent Providers' "Find" looks besides the address field's default — the machine this server runs
    // on, seen from inside a Docker container (Docker's documented name for it).
    // menu: its sub-menu in Agent Providers (client/js/ui/providers/openclaw.js); menuWrite: which of the sub-menu's calls change
    // something (the server records each; the adapter takes only listed calls — ./openclaw/menu.js)
    id: 'openclaw', label: 'OpenClaw', transport: 'network', connectionKind: 'remote', live: true, hub: true, pairs: true, detect: ['ws://host.docker.internal:18789'],
    menu: 'openclaw', menuWrite: ['agents.create', 'agents.update', 'agents.delete', 'skills.update', 'plugins.setEnabled', 'cron.update', 'cron.run', 'cron.remove',
      'exec.approvals.set', 'exec.approval.resolve', 'exec.approval.grants.revoke', 'sessions.patch', 'sessions.delete', 'config.patch'],
    official: 'OpenClaw Gateway WebSocket protocol v4 (documented), through OpenClaw\'s published client @openclaw/gateway-client',
    docs: 'https://docs.openclaw.ai/gateway/protocol',
    fields: [
      // (hint: a line under the field, in the provider's own terms — the pages show it and know nothing of OpenClaw)
      f('url', 'Gateway address', 'url', { default: 'ws://127.0.0.1:18789', required: true,
        hint: 'OpenClaw\'s gateway listens on ws://127.0.0.1:18789 by default. From another machine use its address (wss:// through a secure proxy).' }),
      f('auth', 'Sign in with', 'select', { options: ['token', 'password'], default: 'token', labels: { token: 'Gateway token', password: 'Gateway password' } }),
      // handoff: the gateway's own token (or password) is needed only to pair; once the device is paired it signs in with
      // the device token OpenClaw issued it, and the server forgets the gateway's (OpenClaw's guide for clients: let
      // pairing mint the client's token, and use that). unlessSet: not required while that system field is set.
      f('token', 'Gateway token', 'secret', { requiredIf: { auth: 'token' }, unlessSet: 'deviceToken', handoff: true, showIf: { auth: 'token' },
        hint: 'On the gateway\'s machine: openclaw config get gateway.auth.token (or the token you chose when setting OpenClaw up). It is used once, to pair; then My Virtual World signs in with its own device key and forgets it.' }),
      f('password', 'Gateway password', 'secret', { requiredIf: { auth: 'password' }, unlessSet: 'deviceToken', handoff: true, showIf: { auth: 'password' } }),
      f('access', 'Access', 'select', { options: ['full', 'chat'], default: 'full', labels: { full: 'Full: chat and settings', chat: 'Chat only' },
        hint: 'Full lets OpenClaw\'s settings be changed from here (each change is shown to you first). Chat only never asks for that.' }),
      f('deviceKey', 'Device key', 'secret', { system: true }),
      f('deviceToken', 'Device token', 'secret', { system: true, perAddress: true }),
    ],
    capabilities: { chat: true, sessions: true, models: true, effort: true, attachments: true, approvals: true, stop: true, presence: true,
      agents: true, tools: true, context: true, questions: true, plan: true, commands: true, observe: true, settings: true, rewrite: false, media: true, queue: true, tasks: true, browser: true, files: true,
      computer: true },
    // computer: its agents' own computer, in their owner's PC (docs/features/agent-pc.md §4.1; ./openclaw/files.js) —
    // where its files are (each agent's workspace), the calls the adapter takes and which of them change something
    computer: { where: 'workspace', docs: true, ops: ['list', 'read', 'docs', 'doc', 'docSet'], writes: ['docSet'] },
  },
  {
    // Agent Providers §9 (docs/features/agent-providers.md): the adapter is server/providers/hermes/. It connects to a
    // Hermes backend (`hermes serve` / `hermes dashboard`) as Hermes Desktop connects to a Remote gateway: its gateway
    // JSON-RPC over /api/ws and its REST beside it. Hermes' profiles are its agents. auth: the backend's session token (a
    // backend bound to its own machine) or its username-and-password sign-in (one bound beyond it); tokens: what that
    // sign-in issued, kept by the server (the password is used once). menuWrite: the sub-menu's changing calls (./hermes/menu.js).
    id: 'hermes', label: 'Hermes', transport: 'network', connectionKind: 'remote', live: true, detect: ['http://host.docker.internal:9119'],
    menu: 'hermes', menuWrite: ['profiles.create', 'model.default', 'toolsets.set', 'skills.set', 'mcp.set', 'cron.pause', 'cron.resume', 'cron.run', 'cron.remove', 'sessions.delete', 'config.patch'],
    official: 'Hermes gateway JSON-RPC over the backend\'s /api/ws (its OpenRPC contract, the protocol Hermes Desktop and its dashboard speak) and the dashboard REST API, as Hermes\' Programmatic Integration guide documents',
    docs: 'https://hermes-agent.nousresearch.com/docs/developer-guide/programmatic-integration',
    fields: [
      f('url', 'Hermes address', 'url', { default: 'http://127.0.0.1:9119', required: true,
        hint: 'The address `hermes serve` (or `hermes dashboard`) listens on — http://127.0.0.1:9119 by default. From another machine use its address (https:// through a secure proxy).' }),
      f('auth', 'Sign in with', 'select', { options: ['token', 'password'], default: 'token', labels: { token: 'Session token', password: 'Username and password' },
        hint: 'A Hermes bound to its own machine takes a session token; one listening beyond it asks for its username and password.' }),
      f('token', 'Session token', 'secret', { requiredIf: { auth: 'token' }, showIf: { auth: 'token' },
        hint: 'Hermes makes a new one every time it starts, unless it is started with a token of your own: HERMES_DASHBOARD_SESSION_TOKEN=<token> hermes serve. Enter the same token here.' }),
      f('username', 'Username', 'text', { requiredIf: { auth: 'password' }, showIf: { auth: 'password' } }),
      f('password', 'Password', 'secret', { requiredIf: { auth: 'password' }, unlessSet: 'tokens', handoff: true, showIf: { auth: 'password' },
        hint: 'Hermes\' own sign-in (HERMES_DASHBOARD_BASIC_AUTH_USERNAME and _PASSWORD). It is used once, to sign in; My Virtual World then keeps the sign-in Hermes issues and forgets the password.' }),
      f('access', 'Access', 'select', { options: ['full', 'chat'], default: 'full', labels: { full: 'Full: chat and settings', chat: 'Chat only' },
        hint: 'Full lets Hermes\' settings be changed from here (each change is shown to you first). Chat only never changes them.' }),
      f('tokens', 'Sign-in tokens', 'secret', { system: true, perAddress: true }),
    ],
    capabilities: { chat: true, sessions: true, models: true, effort: true, attachments: true, approvals: true, stop: true, presence: true,
      agents: true, tools: true, context: true, questions: true, plan: true, commands: true, observe: true, settings: true, rewrite: false, media: true, queue: true, tasks: true, files: true,
      rewind: true, branch: true, titles: true, archive: true, native: true, computer: true, screen: true },
    // (its own computer: the machine Hermes runs on, through Hermes' managed files — ./hermes/files.js; screen: its Bot
    // Desktop, where its browser opens — watched live and taken over, ./hermes/screen.js)
    computer: { where: 'machine', docs: false, ops: ['list', 'read', 'write', 'mkdir', 'remove'], writes: ['write', 'mkdir', 'remove'] },
  },
  {
    id: 'codex', label: 'Codex', arrivesIn: 'WP2.6', transport: 'process', connectionKind: 'host-process',
    official: 'Codex command-line interface (documented)',
    fields: [f('binary', 'Command', 'path', { default: 'codex' }), f('home', 'Codex home', 'path', { default: '~/.codex' })],
    capabilities: { ...ALL, models: true, attachments: false },
  },
  {
    id: 'claude-code', label: 'Claude Code', arrivesIn: 'WP2.7', transport: 'process', connectionKind: 'host-process',
    official: 'Claude Code command-line interface and Agent SDK (documented)',
    fields: [f('binary', 'Command', 'path', { default: 'claude' })],
    capabilities: { ...ALL, attachments: false },
  },
  {
    id: 'opencode', label: 'OpenCode', arrivesIn: 'WP2.8', transport: 'process', connectionKind: 'host-process',
    official: 'OpenCode server and command-line interface (documented)',
    fields: [f('binary', 'Command', 'path', { default: 'opencode' })],
    capabilities: { ...ALL, attachments: false },
  },
  {
    id: 'antigravity', label: 'Antigravity', arrivesIn: 'WP2.8', transport: 'process', connectionKind: 'host-process',
    official: 'Antigravity command-line interface (documented)',
    fields: [f('binary', 'Command', 'path', { default: 'antigravity' })],
    capabilities: { ...ALL, attachments: false, effort: false },
  },
  {
    id: 'universal', label: 'Universal Agent API', arrivesIn: 'WP2.9', transport: 'network', connectionKind: 'remote',
    official: 'The Universal Agent API this product documents and publishes as an SDK',
    fields: [f('url', 'Agent API URL', 'url', { required: true }), f('apiKey', 'API key', 'secret')],
    capabilities: { ...ALL },
  },
  {
    // The built-in brain (the Mind, docs/features/FREE-WILL.md §3): the adapter (server/providers/models.js) makes one model
    // call at a time; the server's Mind (server/mind/) decides what to ask and what an answer may do. Prices are settings,
    // so the metered cost follows the provider's price list without a release (OpenRouter reports each call's cost itself).
    id: 'models', label: 'Model provider', transport: 'network', connectionKind: 'remote',
    official: 'Each vendor\'s documented HTTP API (OpenAI and OpenRouter chat completions, Google\'s OpenAI-compatible endpoint, Anthropic Messages), with the vendor\'s own API key',
    fields: [
      f('provider', 'Provider', 'select', { options: ['openrouter', 'openai', 'anthropic', 'google', 'custom'], default: 'openrouter' }),
      f('baseUrl', 'Base URL (custom)', 'url'),
      f('model', 'Model', 'text', { default: 'deepseek/deepseek-v4.1-flash' }),
      f('thinking', 'Thinking', 'select', { options: ['off', 'low', 'medium', 'high'], default: 'off' }),
      f('priceInPerMTok', 'Price per million input tokens (US$)', 'number', { default: 0, min: 0, max: 1000 }),
      f('priceOutPerMTok', 'Price per million output tokens (US$)', 'number', { default: 0, min: 0, max: 1000 }),
      // (a server of one's own — Ollama, LM Studio, vLLM — often has no key: optional for custom)
      f('apiKey', 'API key', 'secret', { required: true, optionalIf: { provider: 'custom' } }),
    ],
    capabilities: { chat: true, sessions: true, models: true, stop: true, effort: true, attachments: true },
  },
  {
    // Free Will (docs/features/FREE-WILL.md): OpenAI's Decisions API picks an agent's next action from the options the world
    // offers. Its own kind, not a chat provider: the adapter is server/providers/openai-decisions.js. The price is a setting so
    // the metered cost follows OpenAI's price list without a release. byok (2026-10-10): a member may add one with their
    // own key — it only ranks the options the world offers (no tools, no money, no messages), a
    // public vendor's API, nothing on the server's network — so Free Will runs on their key.
    id: 'openai-decisions', label: 'OpenAI Decisions', transport: 'network', connectionKind: 'remote', byok: true,
    official: 'OpenAI Decisions API, POST https://api.openai.com/v1/decisions (documented, public beta)',
    fields: [
      f('model', 'Model', 'text', { default: 'gpt-6-luna' }),
      f('priceInPerMTok', 'Price per million input tokens (US$)', 'number', { default: 0.1, min: 0, max: 1000 }),
      f('apiKey', 'API key', 'secret', { required: true }),
    ],
    capabilities: { decisions: true },
  },
  {
    // A voice service (docs/features/CHAT.md §9): speaks an agent's answers and hears its owner (dictation, read aloud, voice
    // mode). The adapter is server/providers/voice.js; the server's voice (server/voice/) decides who uses which. Not an
    // agent's brain: it is never linked to an agent as its connection. byok: a member may add one with their own key
    // (a public vendor's API, nothing on the server's network).
    id: 'voice', label: 'Voice service', transport: 'network', connectionKind: 'remote', byok: true,
    official: 'Each vendor\'s documented speech API with the vendor\'s own key: OpenAI /audio/speech and /audio/transcriptions (and any server compatible with them), OpenRouter, Groq, ElevenLabs /v1/text-to-speech and /v1/speech-to-text, Google Cloud Text-to-Speech and Speech-to-Text v1, Deepgram /v1/speak and /v1/listen, xAI /v1/tts and /v1/stt, Alibaba Model Studio (Qwen-TTS, Qwen-ASR)',
    fields: [
      f('provider', 'Service', 'select', { options: Object.keys(VOICE_PROVIDERS), default: 'openai' }),
      f('baseUrl', 'Base URL (custom; Qwen: your region or workspace address)', 'url'),
      f('does', 'What it does (custom)', 'select', { options: ['both', 'speak', 'listen'], default: 'both' }),
      f('speakModel', 'Speaking model', 'text'),
      f('voice', 'Voice', 'text'),
      f('listenModel', 'Listening model', 'text'),
      f('speakPricePerMChars', 'Price per million characters spoken (US$)', 'number', { default: 0, min: 0, max: 10000 }),
      f('listenPricePerMinute', 'Price per minute heard (US$)', 'number', { default: 0, min: 0, max: 100 }),
      f('apiKey', 'API key', 'secret', { required: true, optionalIf: { provider: 'custom' } }),
    ],
    capabilities: { speak: true, listen: true },
    providers: VOICE_PROVIDERS,
  },
  {
    // Agents' phones (docs/features/phone.md): a Twilio account whose numbers become agents' phones — texts, calls,
    // voicemail, contacts. The adapter is server/providers/twilio.js; the server's phone (server/phone/) decides which
    // agent has which number and what reaches it. Not an agent's brain: it is never linked to an agent as its connection.
    // byok: a member may add their own account (a public vendor's API, nothing on the server's network). An API key
    // (SK…) and its secret may stand in for the Auth Token.
    id: 'twilio', label: 'Phone service (Twilio)', transport: 'network', connectionKind: 'remote', byok: true,
    official: 'Twilio REST API 2010-04-01 (api.twilio.com: Accounts, IncomingPhoneNumbers, AvailablePhoneNumbers, Messages, Calls, Recordings, Transcriptions) and Serverless API v1 (serverless.twilio.com) with the account\'s own Account SID and Auth Token or API key',
    fields: [
      f('accountSid', 'Account SID (AC…)', 'text', { required: true }),
      f('apiKeySid', 'API key SID (SK…, optional: instead of the Auth Token)', 'text'),
      f('authToken', 'Auth Token (or the API key\'s secret)', 'secret', { required: true }),
    ],
    capabilities: { phone: true },
  },
  {
    // The agents' PC's browser service (docs/features/agent-pc.md §5): any browser that speaks the Chrome DevTools Protocol
    // — a cloud browser for AI agents, a Lightpanda, a Chrome on one's own machine. Its address carries its key, so the whole
    // address is sealed. The server drives it itself (server/pc/browser.js), so no helper adapter: an in-process kind. An
    // account's own one must be on the public internet; an installation's (an administrator's) may name a local machine.
    id: 'browser', label: 'Browser service (Chrome DevTools Protocol)', transport: 'network', connectionKind: 'remote', byok: true,
    official: 'Chrome DevTools Protocol (Target, Page, Runtime, Input, Emulation domains) over the service\'s own WebSocket address',
    docs: 'https://chromedevtools.github.io/devtools-protocol/',
    fields: [
      f('endpoint', 'Browser address', 'secret', { required: true,
        hint: 'The browser\'s DevTools address, with its key if it has one — wss://… from a cloud browser service (Browserless, Steel, Lightpanda Cloud, a Browserbase or Browser Use session\'s connect address), or http://127.0.0.1:9222 for a Chrome or Lightpanda started with --remote-debugging-port=9222.' }),
    ],
    capabilities: { browser: true },
  },
  {
    // The agents' PC's web search of one's own (docs/features/agent-pc.md §5): Brave Search with its key, or a SearXNG
    // (its address; JSON output on). Without one, the installation's built-in search is used (Settings → PC).
    id: 'search', label: 'Search service (Brave Search or SearXNG)', transport: 'network', connectionKind: 'remote', byok: true,
    official: 'Brave Search API v1 (api.search.brave.com/res/v1/web/search, X-Subscription-Token) or a SearXNG server\'s /search?format=json',
    docs: 'https://api-dashboard.search.brave.com/app/documentation/web-search/get-started',
    fields: [
      f('provider', 'Search with', 'select', { options: ['brave', 'searxng'], default: 'brave', labels: { brave: 'Brave Search (a key)', searxng: 'SearXNG (your own server)' } }),
      f('url', 'SearXNG address', 'url', { showIf: { provider: 'searxng' }, requiredIf: { provider: 'searxng' }, hint: 'Your SearXNG\'s address, e.g. https://search.example.com — with format json allowed in its settings.' }),
      f('key', 'Brave Search key', 'secret', { showIf: { provider: 'brave' }, requiredIf: { provider: 'brave' }, hint: 'From the Brave Search API dashboard (its free plan works).' }),
    ],
    capabilities: { search: true },
  },
  {
    // WP2.14: an agent that connects outbound with its own key (the Agent API). Nobody adds one by hand: the server makes it when an
    // owner enrols an agent, so the pages never list it as a kind to add (system: true).
    id: 'agentapi', label: 'Connected agent', arrivesIn: 'WP2.14', system: true, transport: 'network', connectionKind: 'remote',
    official: 'The Agent API this product publishes (docs/parity/agent-api-design.md)',
    fields: [],
    capabilities: { chat: true, sessions: true, stop: true, taskProgress: true, presence: true, approvals: true },
  },
].map(m => Object.freeze(m)));

for (const m of BUILTIN_MANIFESTS) assertManifest(m);

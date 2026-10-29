// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// My Virtual World: HTTP + WebSocket server (port 8570 by default).
// Every /api route and WebSocket message is declared in server/routes.js with the capability it needs; handleApi()
// checks the session, that capability, Origin, the CSRF token and re-authentication before any handler runs.
import http from 'node:http';
import { defaultChar } from '../shared/appearance.js';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { generateWorld, markLevelModes, themeVenues } from './world/generate.js';
import { joinCityEdge } from '../shared/city-roads.js';
import { addPropertyRoutes } from './property-routes.js';
import { createEconomy, subj as econSubj } from './economy/index.js';
import { addLayoutRoutes } from './layout-routes.js';
import { Weather } from './world/weather.js';
import { Wildlife } from './world/wildlife.js';
import { addWorldAdminRoutes } from './world-admin-routes.js';
import { addPromoRoutes } from './promo-routes.js';
import { PlayCore, PlayError } from './play/play.js';
import { Solids } from '../shared/roofs.js';
import { groundSites } from '../shared/fishing-trip.js';
import { STARTER } from '../shared/fishing-gear.js';
import { toWorldAt } from '../shared/airport-layout.js';
import { Fleet } from './world/aircraft.js';
import { Harbour } from './world/boats.js';
import { addPlayRoutes } from './play/routes.js';
import { addArcadeHoldRoutes } from './play/arcade-hold.js';
import { FishMarket } from './play/fish-market.js';
import { Angler } from './play/angler.js';
import { CookRecord } from './play/cook.js';
import { KitchenShifts } from './play/kitchen-shifts.js';
import { addOrderUpAgentRoutes } from './play/routes.js';
import { kitchenOf as ouKitchenOf } from '../shared/orderup/kitchens.js';
import { addSignRoutes } from './signs-routes.js';
import { Music } from './music/music.js';
import { seedSoundtrack } from './music/soundtrack.js';
import { addMusicRoutes } from './music/routes.js';
import { Radio } from './radio/radio.js';
import { addRadioRoutes } from './radio/routes.js';
import { addWeatherRoutes } from './weather-routes.js';
import { FreeWill } from './free-will/free-will.js';
import { addFreeWillRoutes } from './free-will/routes.js';
import { AgentLife, LifeError } from './agent-life/life.js';
import { Mind } from './mind/mind.js';
import { addMindRoutes } from './mind/routes.js';
import { Voice } from './voice/voice.js';
import { addVoiceRoutes } from './voice/routes.js';
import { Problems } from './mind/problems.js';
import { addLifeRoutes } from './agent-life/routes.js';
import { Work, serverZone, validZone } from './agent-work/work.js';
import { addWorkRoutes } from './agent-work/routes.js';
import { Talk } from './agent-talk/talk.js';
import { Guide, addGuideRoutes } from './guide.js';
import { addTalkRoutes } from './agent-talk/routes.js';
import { Phone } from './phone/phone.js';
import { PcOS } from './pc/os.js';
import { addPcRoutes } from './pc/routes.js';
import { PcShell } from './pc/shell.js';
import { PcWork } from './pc/work.js';
import { ProviderScreens } from './pc/provider-screens.js';
import { ScreenWatch } from './pc/screen-watch.js';
import { LocalChrome, findChrome } from './pc/chrome.js';
import { ScreenRelay, PATH as SCREEN_WS } from './providers/screen-relay.js';
import { pcToolbox } from './pc/agent-tools.js';
import { PcBrowser, CdpPage } from './pc/browser.js';
import { addPhoneRoutes } from './phone/routes.js';
import { Posts } from './agent-posts/posts.js';
import { addPostRoutes } from './agent-posts/routes.js';
import { Recent } from './recent.js';
import { LotRights } from './lot-rights.js';
import { Editor } from './world/edit.js';
import { Journal } from './world/journal.js';
import { Players } from './world/players.js';
import { createVehicles } from './world/vehicles.js';
import { Friends } from './world/friends.js';
import { Licence, LOCKS, DEMO_AGENTS } from './licence.js';
import { Agents, peopleResolver } from './agents.js';
import { Connections } from './connections.js';
import { Attachments } from './chat/attachments.js';
import { Chat } from './chat/chat.js';
import { ProviderMedia } from './chat/provider-media.js';
import { PresenceCoordinator } from './presence-coordinator.js';
import { AgentApi } from './agent-api.js';
import { WakeUps } from './agent-wakeup.js';
import { agentApiAdapter, bridgeAgents, extKey } from './agent-bridge.js';
import { AgentWorld, addAgentWorldRoutes } from './agent-world.js';   // (a connected agent's eyes and hands)
import { AgentSocial, SocialError } from './agent-social/social.js';   // (agents and friends)
import { addSocialRoutes } from './agent-social/routes.js';
import { isExtKey } from './agents.js';
import { References } from './chat/references.js';
import { Sessions } from './chat/sessions.js';
import { Transcripts } from './chat/transcript.js';
import { Projects } from './chat/projects.js';
import { Notifications } from './notify/notifications.js';
import { EventBus } from './providers/bus.js';
import { ProviderHost } from './providers/host.js';
import { AgentProviders } from './agent-providers.js';
import { Registry } from './providers/registry.js';
import { generatePopulation, reassign, validatePerson, makeVip, makeAgentBody, setPlaces } from './sim/population.js';
import { placeAgents, jobOptions, giveJob } from './sim/placement.js';
import { Migration } from './sim/migration.js';
import { addTownNeedsRoutes } from './town-needs.js';
import { WorldIndex } from './sim/windex.js';
import { Housing, bedsOf, targetOf, DEFAULT_HOMES_FILLED } from './sim/housing.js';
import { Sim, realNow } from './sim/sim.js';
import { setPlayerSpots } from './sim/agents.js';
import { PF_USING } from '../shared/playerproto.js';
import { evalPlan } from './sim/plan.js';
import { Activity } from './activity.js';
import { Store } from './store.js';
import { WorldDb, fileHash } from './world/world-db.js';
import { readStarter, STARTER_FILE } from './world/starter.js';
import { worldSeconds, ctxB } from '../shared/constants.js';
import { readRelease } from './release.js';
import { RNG } from '../shared/rng.js';
import * as N from '../shared/names.js';
import { agentApp } from '../shared/agent-apps.js';
import { openDb } from './db.js';
import { Accounts, AuthError, GUEST, LIMITS } from './auth/accounts.js';
import { ConnectorAuth } from './connector/auth.js';
import { connectorHandler, isConnectorPath, publicOriginOf } from './connector/http.js';
import { addConnectorRoutes } from './connector/routes.js';
import { Permissions } from './auth/permissions.js';
import { HttpPolicy, parseCookies, sessionCookie, csrfOk } from './auth/http.js';
import { warmUp } from './auth/passwords.js';
import { Audit } from './auth/audit.js';
import { createApi, stripTask } from './routes.js';
import { SecretBox, KeyConfigError, unreadableHelp } from './secrets.js';
import { registerSecretHolders } from './secret-holders.js';
import { redact, scrub } from './redact.js';
import { Settings } from './settings.js';
import { placeMenu } from '../shared/kitchen-module.js';
import { loadConfig } from './config.js';
import { createLogger } from './log.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const { version: VERSION, release: RELEASE } = readRelease(ROOT);

/** The libraries this release ships, each with the licence it declares (Settings → About lists them). Read from the
 *  installed packages, so a licence is never restated by hand. */
function shippedLibs() {
  const out = [];
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    for (const [name, range] of Object.entries(pkg.dependencies || {})) {
      try {
        const p = JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules', name, 'package.json'), 'utf8'));
        const l = p.license || (Array.isArray(p.licenses) && p.licenses[0] && (p.licenses[0].type || p.licenses[0])) || 'see the package';
        out.push({ name, version: String(p.version), license: String(l), declared: String(range) });
      } catch {
        out.push({ name, version: null, license: 'see the package', declared: String(range) });
      }
    }
  } catch { /* no package.json beside the server: nothing to list */ }
  return out;
}
const LIBS = shippedLibs();
// Configuration (server/config.js; DECISIONS C102): every setting comes from the environment and is checked at start;
// every problem is reported at once. Log lines are "time level [area] message", redacted (server/log.js).
const box = new SecretBox();
const log = createLogger({ known: box.known });
const fatal = msg => {
  process.stderr.write(`${new Date().toISOString()} error [config] ${scrub(String(msg), box.known).replace(/\n/g, '\n  ')}\n`);
  process.exit(2);
};
const { cfg: CFG, errors: configErrors, warnings: configWarnings } = loadConfig({ root: ROOT, release: RELEASE });
if (configErrors.length === 1) fatal(configErrors[0]);
if (configErrors.length > 1) fatal(`${configErrors.length} settings need fixing:\n${configErrors.map(e => `- ${e}`).join('\n')}`);
for (const w of configWarnings) log.warn('[config]', w);
const PORT = CFG.port, HOST = CFG.host, DATA = CFG.data, POP = CFG.population, SEED = CFG.seed;
// The session cookie's name (MVW_COOKIE_NAME). Installations that share a host name (live and staging on two ports)
// need different names, because browsers do not keep cookies apart by port.
const COOKIE = CFG.cookieName;
// MVW_TRUSTED_PROXIES: reverse proxies whose X-Forwarded-For / X-Forwarded-Proto are believed (default: none, C71).
// MVW_PUBLIC_URL: the address(es) people open; only these origins may change things. MVW_GATEWAY_IS_LOCAL (the Docker
// image, C105): the container's default gateway counts as this machine for plain-HTTP sign-in on localhost.
const policy = new HttpPolicy({ trustedProxies: CFG.trustedProxies, publicUrls: CFG.publicUrls, localPeers: CFG.localPeers });
let wss = null;
let screenRelay = null;   // (agents' own screens, live: made with the WebSocket below)
let worldCache = null, peopleCache = {};

// ------------------------------------------------------------------ accounts
const dbs = openDb(DATA);
const audit = new Audit(dbs);
const perms = new Permissions(dbs);
// The key for stored secrets (server/secrets.js; DECISIONS C86–C88, C95, C98): MVW_KEY_FILE or MVW_SECRET_KEY, exactly
// one, never inside the data folder. The server refuses to start while stored secrets cannot be opened with it, re-seals
// values sealed with the previous key, and follows the key file while it runs (rotations).
registerSecretHolders(box, dbs);
try {
  const k = box.load({ env: CFG.keyEnv, dataDir: DATA });
  for (const w of k.warnings) log.warn('[secrets]', w);
  if (k.created) log(`[secrets] created the key file ${k.file} (key ${box.fps[0]}); back it up separately from the data`);
} catch (e) {
  if (e instanceof KeyConfigError) fatal(e.message);
  throw e;
}
{
  const bad = box.unreadable();
  if (bad.length) fatal(unreadableHelp(bad, box));
  const n = box.reseal(fn => dbs.tx(fn));
  log(`[secrets] key ${box.fps[0]}${box.fps[1] ? ` (previous ${box.fps[1]})` : ''} from ${box.source === 'env' ? 'MVW_SECRET_KEY' : box.file}`
    + (n ? `; ${n} value${n === 1 ? '' : 's'} re-sealed with it` : ''));
}
const expectedKeyQ = dbs.db.prepare("SELECT value FROM settings WHERE world_id = ? AND key = 'secrets.expectedKey'");
box.watch({ tx: fn => dbs.tx(fn), log, intervalMs: CFG.keyPollMs, expectedKey: () => expectedKeyQ.get(dbs.worldId)?.value || null });
const accounts = new Accounts(dbs, { dataDir: DATA, log, audit, box, requireTwofa: () => perms.flag('security.require2fa') });
const settings = new Settings(dbs, { perms, box, audit, onAccessChange: () => recheckSockets() });
// Licence keys and demo mode (WP1.11): the receipt is sealed in the secret store; without one, locks stand.
const licence = new Licence(dbs, { box, audit, log });
licence.startRechecks();   // while online: does the activation still stand? (server/licence.js)
/** The agent registry (WP2.1): every AI agent is a record owned by an account (set up once the residents are loaded). */
let agents = null;
/** Whether an agent counts as an agent: it has an enabled record and, in demo mode (E19), is one of the first 3 enabled
 *  records of any kind — built in or connected from outside (a Grok Bot counts like any other); the others are shown as
 *  ordinary residents, their presence is ignored and a connected one can't act. A licence lifts the limit. */
let agentCache = null;
function agentOk(id) {
  if (!agents) return true;
  const a = agents.byKey(id);
  if (!a || !a.enabled) return false;
  if (licence.active) return true;
  if (!agentCache) agentCache = new Set(agents.enabled().slice(0, DEMO_AGENTS).map(x => x.key));
  return agentCache.has(id);
}
/** Whether the public may see a connected agent as an agent: only a public one. A hidden or friends-only agent's resident looks like
 *  any other citizen to the public payload; the owner and friends see it as their agent through their own agent list (WP2.10). */
function extPublic(key) {
  const slot = agentApi && agentApi.slotOfAgentKey(key);
  return !!slot && slot.status !== 'revoked' && slot.visibility === 'public';
}
function agentShown(id) { return agentOk(id) && (!isExtKey(id) || extPublic(id)); }
/** Demo mode (E19): whether one more agent may be made — the installation's built-in agents and its connected agents'
 *  slots (any not revoked: waiting, connected or paused) together stay within 3. A licence lifts the limit. */
function demoAgentRoom() {
  if (licence.active || !agents) return true;
  return agents.enabled().filter(a => !isExtKey(a.key)).length + (agentApi ? agentApi.countLive() : 0) < DEMO_AGENTS;
}
await accounts.ensureOwner();
await warmUp();   // unknown usernames then cost the same time from the first attempt on
function housekeeping() {
  try {
    accounts.purgeSessions();
    const days = Number(perms.setting('audit.retentionDays', 0));
    if (days > 0) audit.purge(days);   // the owner's retention setting (C75); each purge is recorded
  } catch (e) { log.error('[auth] housekeeping failed', e.message); }
}
housekeeping();
setInterval(housekeeping, 3600000).unref();

// ------------------------------------------------------------------ boot
const store = new Store(DATA, { log });
// The world store (WP4.1): next.db holds the live world and residents; world.json and people.json are exports of them.
// An export file the store did not write (a restore, an older release after a rollback, a hand edit) is taken in.
const wdb = new WorldDb(dbs, { log });
/** The export file's content to take in, or undefined to keep the store's. */
function takeIn(name) {
  if (!wdb.has(name)) return store.load(name);   // the first start on this store: the files (or their backups), or nothing
  const file = store.file(name), h = fileHash(file);
  if (h === null || wdb.knownFile(name, h)) return undefined;
  try { const v = JSON.parse(fs.readFileSync(file, 'utf8')); log.warn(`[boot] ${name}.json was replaced: taking it in`); return v; }
  catch { log.warn(`[boot] ${name}.json cannot be read: keeping the stored ${name}`); return undefined; }
}
const fileWorld = takeIn('world'), filePeople = takeIn('people');
const worldFile = fileWorld !== undefined, peopleFile = filePeople !== undefined;
let world = worldFile ? fileWorld : wdb.loadWorld();
let people = peopleFile ? filePeople : wdb.loadPeople();
let meta = store.load('meta') || {};
// A new world opens with the starting map (server/world/starter.js: the city built for new installations; its lots are
// laid out once the property store is open, below), or with a generated city (MVW_STARTER_MAP=off, as the tests run).
let starterLots = null;
if (!world || world.format !== 1 || !Array.isArray(world.buildings)) {
  const starter = CFG.starterMap ? readStarter(STARTER_FILE, log) : null;
  if (starter) {
    log(`[boot] a new world from the starting map "${starter.name}": ${starter.world.buildings.filter(B => B && !B.gone).length} buildings, ${starter.lots.length} lots`);
    world = starter.world;
    world.created = new Date().toISOString();
    starterLots = starter.lots;
  } else {
    log('[boot] generating a new city', SEED, 'population', POP);
    world = generateWorld({ seed: SEED, population: POP, hqName: CFG.hqName });
  }
  world.worldId = dbs.worldId;
  people = null;
}
// The world id (DECISIONS C104): the world files and the accounts database belong to one world. World files restored
// next to another world's database would pair its buildings and residents with the wrong accounts and audit log.
let worldIdAdded = false;
if (!world.worldId) {
  world.worldId = dbs.worldId;
  worldIdAdded = true;
  log(`[boot] world id ${dbs.worldId} written into the world files`);
} else if (world.worldId !== dbs.worldId) {
  fatal(`The world files in ${DATA} belong to world ${world.worldId}, but its accounts database (next.db) belongs to world ${dbs.worldId}. `
    + 'Restore world.json, people.json and next.db from the same backup. To pair these world files with these accounts on purpose, '
    + 'remove "worldId" from world.json; the server then writes this database\'s id into it.');
}
if (meta.worldId && meta.worldId !== world.worldId) {
  log.warn(`[boot] meta.json belongs to world ${meta.worldId}, not ${world.worldId}: its clock is ignored`);
  meta = {};
}
world.version = world.version || 1;
// Floor modes (procedural floor layouts, 2026-10-04): which floors are generated and which were changed by hand, once.
const levelModesMarked = markLevelModes(world);
if (levelModesMarked) log(`[boot] floor layouts: ${levelModesMarked} marked generated or changed by hand`);
const themedVenues = themeVenues(world);   // (arcades, lounges and clubs: places the city visits)
if (themedVenues) log(`[boot] themed floors: ${themedVenues} made places of their own (arcade, lounge, club)`);
// Roads that stop short of a city edge junction (an older island's Beach Road at the curb) carried on to join it, once.
let roadsJoined = 0;
if (Array.isArray(world.roads)) {
  const joined = world.roads.map(r => joinCityEdge(world.grid, r));
  roadsJoined = joined.filter((r, k) => r !== world.roads[k]).length;
  if (roadsJoined) { world.roads = joined; log(`[boot] roads: ${roadsJoined} carried on to the city's edge junction`); }
}
const index = new WorldIndex(world);
// Residents: a new city gets generated residents. AI agents join through connections (WP2.1); agents who live here
// already stay as world data (DECISIONS C61, C103).
// (how many: the share of its homes' beds Settings → Residents asks for — server/sim/housing.js; a world without homes yet has none)
if (!Array.isArray(people) || !people.length) people = generatePopulation(world, index, { population: CFG.housing ? targetOf(bedsOf(world, index), Number(settings.get('world.homesFilled') ?? DEFAULT_HOMES_FILLED)) : POP });
else for (const p of people) validatePerson(world, index, p);
reassign(world, index, people, new RNG('boot:' + Date.now()));
// Residents that are agents already (the platform's) get records owned by the installation's owner; nothing changes for them.
agents = new Agents(dbs, { audit, resolver: peopleResolver(() => people), log });
agents.sync(people);

// Agent providers run in one supervised helper process, so a provider fault cannot stall the world (WP2.2, A9). The chat
// adapters arrive with WP2.4 to WP2.9; the decision service for Free Will (docs/features/FREE-WILL.md) is there already. The
// tests also load the mock provider and the mock decision service.
const providerTest = CFG.providerTest;
const registry = new Registry({ allowTest: providerTest });
const providerBus = new EventBus({ log });
const adapterPath = f => fileURLToPath(new URL(`./providers/${f}`, import.meta.url));
const host = new ProviderHost({ adapters: [adapterPath('openai-decisions.js'), adapterPath('models.js'), adapterPath('voice.js'), (CFG.twilioTestUrl ? { path: adapterPath('twilio.js'), options: { hosts: { api: CFG.twilioTestUrl, serverless: CFG.twilioTestUrl, upload: CFG.twilioTestUrl } } } : adapterPath('twilio.js')), adapterPath('openclaw/adapter.js'), adapterPath('hermes/adapter.js'), ...(providerTest ? [adapterPath('mock.js'), adapterPath('decisions-mock.js')] : [])], bus: providerBus, registry, log,
  runTimeoutMs: providerTest && CFG.providerRunTimeoutMs ? CFG.providerRunTimeoutMs : undefined });
host.start().catch(e => log.warn('[providers] the helper did not start:', e.message));
const connections = new Connections(dbs, { box, registry, host, can: (P, cap) => perms.allowed(P, cap), audit, log });
// Chat over the providers (WP2.2): sessions private to an account and an agent (C119), references shared per agent (C53), the transcript
// mirror and the attachments on disk next to the data, events to the account that started a run and nobody else (A8, X11).
const sendToAccount = (accountId, frame) => {
  if (!wss) return;
  const text = JSON.stringify(frame);
  for (const ws of wss.clients) if (ws.readyState === 1 && ws.P && ws.P.account && ws.P.account.id === accountId) ws.send(text);
};
// Agent Providers (docs/features/agent-providers.md): the live provider connections (OpenClaw), their state on the pages of
// everyone who may see them, and their own agents as agents here.
const pushWhere = (pred, frame) => {
  if (!wss) return;
  const text = JSON.stringify(frame);
  for (const ws of wss.clients) if (ws.readyState === 1 && ws.P && ws.P.account && pred(ws.P)) ws.send(text);
};
const agentProviders = new AgentProviders({ connections, registry, host, bus: providerBus, agents, push: pushWhere, audit, log }).start();
const attachments = new Attachments(dbs, path.join(DATA, 'attachments'), {
  limits: () => ({ maxBytes: Number(perms.setting('chat.attachmentMaxMb', '25')) * 1048576, quotaBytes: Number(perms.setting('chat.attachmentQuotaMb', '2048')) * 1048576 }),
});
const references = new References(dbs);
// an agent's work (docs/features/CHAT.md §13): its job brief, its work notes and the files it knows — what it answers from
// in its owner's chats in Work mode, apart from its life in the city
const work = new Work(dbs, path.join(DATA, 'work-files'));
// the media of providers' answers (an agent's images, video, audio): fetched once, kept on disk within a size
const providerMedia = new ProviderMedia({ dbs, box, dir: path.join(DATA, 'provider-media'), cacheMax: CFG.providerMediaCacheMb * 1024 * 1024, log });
const chat = new Chat({ media: providerMedia, agents, connections, registry, host, bus: providerBus, sessions: new Sessions(dbs), transcripts: new Transcripts(dbs, { root: path.join(DATA, 'chat'), log }), attachments, references, projects: new Projects(dbs), work,
  agentOk: id => agentOk(id), agentShown: id => agentShown(id), send: sendToAccount, log,
  inproc: { agentapi: (c, method, params) => agentApiAdapter(agentApi)(c, method, params) } });

// Notifications (docs/features/CHAT.md §8): what an account is told — kept for its bell, shown on its open pages, pushed
// to its browsers and phones when it has none open. notifyAccount sends a live frame as before and turns the ones worth
// keeping into notifications: an agent asking for its owner's OK, a note from an agent, a problem in its life.
const accountOnline = id => { if (!wss) return false; for (const ws of wss.clients) if (ws.readyState === 1 && ws.P?.account?.id === id) return true; return false; };
const notifications = new Notifications(dbs, { box, send: sendToAccount, online: accountOnline, allowLocal: providerTest, log,
  subject: () => { const c = String(settings.get('push.contact') || '').trim(); if (c) return /^https:\/\//.test(c) ? c : `mailto:${c.replace(/^mailto:/, '')}`; const u = (String(CFG.publicUrls || '').split(',')[0] || '').trim(); return /^https:\/\//.test(u) ? u.replace(/\/+$/, '') : 'mailto:push@localhost'; } }).attach();
const vcText = c => `${(c / 100).toFixed(c % 100 ? 2 : 0)} VC`;
const notifyAccount = (id, m) => {
  sendToAccount(id, m);
  try {
    if (m.t === 'econ' && m.ev === 'approval') notifications.create(id, { kind: 'approval', title: `${m.agent || 'An agent'} asks for your OK`, body: `${m.summary || 'A payment'} — ${vcText(m.amount || 0)}`, link: { approval: m.id, ...(m.agentId ? { agent: m.agentId } : {}) } });
    else if (m.t === 'mind' && m.ev === 'note') notifications.create(id, { kind: 'note', title: m.agent?.name || 'Your agent', body: m.text, link: m.agent?.id ? { agent: m.agent.id } : null });
    else if (m.t === 'mind' && (m.ev === 'problem' || m.ev === 'solved')) notifications.create(id, { kind: 'problem', title: `${m.agent?.name || 'Your agent'}${m.ev === 'solved' ? ': sorted' : ': a problem'}`, body: m.text, link: m.agent?.id ? { agent: m.agent.id } : null });
  } catch (e) { log.warn('[notify] could not keep a notification:', e.message); }
  // a connected agent's own problem (rent, money, a home, a job): its wake-up link may start its AI to deal with it
  if (m.t === 'mind' && m.ev === 'problem' && m.agent?.id && agentApi) {
    const x = /^ext-(\d{1,9})$/.exec(String(agents.get(m.agent.id)?.key || ''));
    if (x) agentApi.wake(Number(x[1]), 'problems');
  }
};
// an answer that came while its owner had no page open: kept, and pushed to the devices that asked
chat.onAnswer = (run, e) => {
  if (e.status !== 'ok' || accountOnline(run.accountId)) return;
  const a = agents.get(run.agentId);
  notifications.create(run.accountId, { kind: 'chat', title: a ? `${a.name} answered` : 'An answer came', body: String(e.text || '').replace(/[#*_`>|-]+/g, ' ').slice(0, 160), link: { agent: run.agentId, session: run.sessionId } });
};

const clock = Sim.defaultClock();
if (Number.isFinite(meta.worldSeconds)) clock.dayBase = meta.worldSeconds;
if (Number.isFinite(meta.dayScale) && meta.dayScale > 0) clock.dayScale = meta.dayScale;
if (Number.isFinite(meta.rate)) clock.rate = Math.max(0, Math.min(60, meta.rate));

let sim = null;
let activity = null;             // the activity log (WP1.8), set once the edit journal exists
let players = null;              // the multiplayer core (WP1.10)
let vehicles = null;             // shared fleet + authoritative reference vehicle physics
let fleet = null;                // the airport's aircraft (server/world/aircraft.js)
let harbour = null;              // the fishing docks' boats (server/world/boats.js)
let weather = null;              // the region's weather timeline and an administrator's override (WP4.18)
let wildlife = null;             // the shared wildlife tier: herds near someone, the same for everyone (WP4.17)
const presenceSeen = new Map();  // agent id → working, for the activity log's start and stop lines
let coordinator = null;
let agentApi = null;   // agents that connect outbound (WP2.14); built after the friends store
let wakeUps = null;    // their wake-up links (server/agent-wakeup.js)
let agentWorldRef = null;   // their eyes and hands (server/agent-world.js), for their tools over MCP (server/connector/body-tools.js)
// Agent presence (WP2.3): what each agent is doing, from its provider connection's runs and its connected session.
coordinator = new PresenceCoordinator({
  bus: providerBus, agents, connections, registry, log, online: key => (agentApi ? agentApi.onlineAgentKey(key) : undefined),
  quietRun: runId => chat.runs.get(runId)?.talk === true,   // (a talk in the city shows nobody that the agent is busy)
  limits: () => ({ graceMs: Number(perms.setting('presence.finishGraceSec', '8')) * 1000, quietMs: Number(perms.setting('presence.quietLimitMin', '60')) * 60000 }),
  onChange: (key, s, x) => {
    if (!sim) return;
    const a = sim.agents.find(v => v.p.vip && v.p.agentId === key);
    // (an agent talking with someone in person stays with them: server/sim/sim.js hold)
    // a message (or a job) starts or ends for it: sim/agents.js Brain.workChanged
    if (a && a.plan && x.workingChanged && !(a.talkUntil > sim.now())) sim.brain.workChanged(a, s.working);
    peopleCache = {};
    broadcastPresence(key, s);
    noteAgent(key, s);
  },
});
/** The presence the simulation and the API see: agents beyond the demo's three are never working. */
const gatedPresence = {
  isWorking: id => agentOk(id) && coordinator.isWorking(id),
  info: id => (agentOk(id) ? coordinator.info(id) : null),
  workingList: () => coordinator.workingList().filter(agentOk),
  snapshot: ids => coordinator.snapshot(ids.filter(agentOk)),
  get ok() { return coordinator.live(); },
  get source() { return coordinator.live() ? 'providers' : ''; },
};
sim = new Sim(world, people, { clock, presence: gatedPresence, index, agentOk, agentShown });
sim.savePerson = i => { peopleCache = {}; save({ people: [i] }); };   // (a resident's own state changed: its AI's order)
const recent = new Recent(sim);   // what everyone did lately (the selection card's activity feed; server/recent.js)
sim.start();
coordinator.start();
log(`[boot] ${world.buildings.filter(b => !b.gone).length} buildings, ${people.length} people (${people.filter(p => p.vip).length} AI agents), warm ${sim.stats.warmMs} ms`);

// ------------------------------------------------------------------ persistence
/** What a play module needs to lay a run out (server/play/play.js contextFor): for the airport, the airport the run
 *  starts at (where: its id, else the nearest to the player, within reach) and the height of the ground or a roof
 *  anywhere (rings stay clear of both). */
let solids = null, solidsKey = -1;
function playContext(id, where, account) {
  if (id === 'fishing') return fishingContext(where, account);
  if (id === 'orderup') return orderUpContext(where, account);
  if (id !== 'airport') return {};
  const list = (world.worldModules || []).filter(m => m.kind === 'airport' && Number.isFinite(m.y));
  const p = account ? players?.byId.get(account.id) : null, far = m => (p ? Math.hypot(p.x - m.x, p.z - m.z) : 0);
  let m = where ? list.find(x => x.id === String(where)) : null;
  if (!m) m = list.slice().sort((a, b) => far(a) - far(b))[0] || null;
  if (!m || far(m) > 2500) return { airport: null };
  if (!solids || solidsKey !== world.version) { solids = new Solids(world); solidsKey = world.version; }
  const G = editor.ground();
  return { airport: { id: m.id, x: m.x, z: m.z, y: m.y, yaw: m.rot }, clearAt: (x, z) => Math.max(G ? G.env.heightAt(x, z) : -Infinity, solids.roofAt(x, z)) };
}
/**
 * Order Up's context (shared/orderup/module.js prepare): the kitchen a Rush is played in (where: { b, f }, the building
 * and floor), as its record has it: its stations (the playable pieces of the kitchen, in the order they stand on the
 * floor: the browser lays the Rush out from this same list), its template and its place's menu; a fresh seed; and the
 * cook's skills (server/play/cook.js: the Rush is played, and played again, with them).
 */
function orderUpContext(where, account) {
  const b = Number(where?.b), f = Number(where?.f), B = Number.isSafeInteger(b) ? world.buildings[b] : null;
  const L = B && !B.gone && Number.isSafeInteger(f) ? world.levels[B.lv?.[f]] : null;
  const rec = (L?.mods || []).find(m => m.kind === 'kitchen');
  if (!rec) return { kitchen: null };
  const K = ouKitchenOf(rec.data?.kitchen), stations = (L.items || []).filter(it => it.mod === rec.id && K.stations[it.t]).map(it => ({ id: it.id, t: it.t }));
  if (!stations.some(s => s.t === 'ou_pass')) return { kitchen: null };
  return { seed: crypto.randomBytes(8).toString('hex'), skills: account ? cooks.skillsOf(account.id) : {}, kitchen: { b, f, stations, kitchen: rec.data?.kitchen || null, menu: rec.data?.menu || null } };   // (the cook's skills as the server has them)
}
/**
 * The fishing module's context (shared/fishing.js prepare): the dock a trip starts from (where: its id, else the one
 * nearest the player), its water, the places on that water its trips may put their grounds (shared/fishing-trip.js
 * groundSites: by the trip's reach on the sea, the whole lake on a lake — kept per dock and reach until the world
 * changes) and the angler's kit (server/play/angler.js: the gear they hold and chose, their boat and skills).
 */
const fishSites = new Map();
let angler = null;
function fishingContext(where, account) {
  const docks = (world.worldModules || []).filter(m => (m.kind === 'marina' || m.kind === 'lakedock') && Number.isFinite(m.wy));
  const p = account ? players?.byId.get(account.id) : null, far = m => (p ? Math.hypot(p.x - m.x, p.z - m.z) : 0);
  let m = where ? docks.find(x => x.id === String(where)) : null;
  if (!m) m = docks.slice().sort((a, b) => far(a) - far(b))[0] || null;
  const G = editor.ground();
  if (!m || !G || far(m) > 6000) return { dock: null };
  const out = toWorldAt(m, -30, 0), w0 = G.island.waterAt(out.x, out.z), water = m.kind === 'marina' ? 'sea' : 'lake';
  const lake = water === 'lake' ? G.island.lakes.find(k => k.id === w0?.id) || null : null;
  if (water === 'lake' && !lake) return { dock: null };
  const depthAt = (x, z) => { const w = G.island.waterAt(x, z); if (!w || w.kind !== water || (lake && w.id !== lake.id)) return 0; return Math.max(0, w.level - G.island.height(x, z)); };
  if (fishSites.ver !== world.version) { fishSites.clear(); fishSites.ver = world.version; }
  const sitesFor = course => {
    const key = `${m.id}:${water === 'lake' ? 'lake' : course.reach}`;
    if (!fishSites.has(key)) {
      const R = lake ? lake.r * 1.25 : 0;
      fishSites.set(key, groundSites({ water, depthAt, dock: { x: out.x, z: out.z }, reach: lake ? 0 : course.reach, area: lake ? { x0: lake.x - R, z0: lake.z - R, x1: lake.x + R, z1: lake.z + R } : null }));
    }
    return fishSites.get(key);
  };
  let kit = STARTER;
  try { if (account && angler) kit = angler.tripKit(account.id); } catch (e) { log.warn('[fishing] kit', e.message); }
  return { dock: { id: m.id, kind: m.kind, x: out.x, z: out.z }, water, sitesFor, kit };
}
function saveMeta() {
  try {
    const t = sim.now();
    store.save('meta', { worldSeconds: worldSeconds(sim.clock, t), dayScale: sim.clock.dayScale, rate: sim.clock.rate, saved: new Date().toISOString(), version: world.version, worldId: world.worldId });
  } catch (e) { log.error('[store] meta save failed', e.message); }
}
/** Something changed. marks ({ buildings, levels, people, docs }) name it: those rows are written within 50 ms; without
 *  them every row is compared (within 2.5 s). Edits commit through commitWorld instead, with their journal entry. */
let flushTimer = null, exportTimer = null, exportedRev = -1;
function save(marks) {
  if (marks) wdb.mark(marks); else wdb.sweep();
  if (!flushTimer) flushTimer = setTimeout(flushWorld, marks ? 50 : 2500);
}
function flushWorld() {
  clearTimeout(flushTimer); flushTimer = null;
  try { wdb.flush(world, people); } catch (e) { log.error('[store] writing the world failed', e.message); }
  if (wdb.rev !== exportedRev && !exportTimer) exportTimer = setTimeout(exportWorld, 60000);
}
/** Runs fn (an edit, an undo) and writes what it changed in the same transaction as the journal entry it makes. */
const commitMs = [];   // the last 200 commits' times, for the store's p95 (spec §7.2: under 50 ms)
function commitWorld(fn) {
  const t0 = performance.now();
  const r = dbs.tx(() => { const v = fn(); wdb.flush(world, people); return v; });
  commitMs.push(performance.now() - t0); if (commitMs.length > 200) commitMs.shift();
  return r;
}
function storeStats() {
  const s = [...commitMs].sort((a, b) => a - b), r2 = v => Math.round(v * 100) / 100;
  return { rev: wdb.rev, flushes: wdb.stats.flushes, rows: wdb.stats.rows, flushMaxMs: r2(wdb.stats.maxMs), commits: s.length, commitP95Ms: s.length ? r2(s[Math.min(s.length - 1, Math.floor(s.length * 0.95))]) : null };
}
/** world.json and people.json from the store (at most once a minute while things change, and at every stop). */
function exportWorld() {
  clearTimeout(exportTimer); exportTimer = null;
  try {
    for (const [name, obj] of [['world', world], ['people', people]]) { store.save(name, obj); wdb.rememberFile(name, fileHash(store.file(name))); }
    exportedRev = wdb.rev;
  } catch (e) { log.error('[store] exporting the world failed', e.message); }
}
function saveNow() { store.flushAll(); wdb.sweep(); flushWorld(); exportWorld(); saveMeta(); }
// first start on this store, files taken in, or boot changes (ids, re-homing): everything is compared and written
if (worldFile || peopleFile) wdb.replace(worldFile ? world : null, peopleFile ? people : null);
wdb.sweep();
flushWorld();
if (worldFile || peopleFile || worldIdAdded || levelModesMarked || roadsJoined || !fs.existsSync(store.file('world'))) { exportWorld(); saveMeta(); }
else exportedRev = wdb.rev;
setInterval(saveMeta, 30000).unref();
setInterval(() => save(), 300000).unref();   // anything nobody named, every five minutes

// ------------------------------------------------------------------ payload caches
/** The installation's default home view (the world.home setting), parsed, or null when an admin has not set one. */
function worldHomeView() {
  const raw = settings.get('world.home');
  if (!raw) return null;
  try { const j = JSON.parse(raw); return j && typeof j === 'object' ? j : null; } catch { return null; }
}
function worldPayload() {
  const home = worldHomeView();   // the installation's default home view (WP1.9, C44); the cache key includes it
  if (!worldCache || worldCache.version !== world.version || worldCache.home !== home) {
    const body = JSON.stringify({ version: world.version, world: { ...world, home }, serverVersion: VERSION });
    worldCache = { version: world.version, home, body, gz: zlib.gzipSync(body, { level: 6 }) };
  }
  return worldCache;
}
/** Residents and agent presence. Task text only in the variant for callers allowed to see it (agents.view_tasks). */
function peoplePayload(withTasks) {
  const k = withTasks ? 'full' : 'lite';
  if (!peopleCache[k]) {
    const snap = gatedPresence.snapshot(people.filter(p => p.vip && agentShown(p.agentId)).map(p => p.agentId));
    const pres = withTasks ? snap : Object.fromEntries(Object.entries(snap).map(([id, s]) => [id, stripTask(s)]));
    const body = JSON.stringify({ people: sim.peopleList(), presence: pres });
    peopleCache[k] = { body, gz: zlib.gzipSync(body, { level: 6 }) };
  }
  return peopleCache[k];
}

// ------------------------------------------------------------------ editor glue
let lotsChanged = null;   // set once the property routes exist (below)
let agentPlaces = null;   // where agents may live and work (server/towns.js places()): set once the property routes exist (below)
let migration = null;     // people moving between towns (server/sim/migration.js): set once the towns' needs are known (below)
const hunts = new Map();  // body index → { at, pending }: its own brain choosing its job (Free Will, step 7: settleAgents)
let economy = null;      // the economy (server/economy/), set once the routes exist (below)
const app = {
  get world() { return world; },
  get sim() { return sim; },
  save,
  commit: commitWorld,
  onNote(text) { if (activity) activity.add({ kind: 'residents', text }); },   // newcomers arriving (WP1.8)
  onPatches(patches, who) {
    worldCache = null; peopleCache = {};
    broadcast({ t: 'patch', version: world.version, patches, who });
    if (patches.some(p => p.k === 'bld') && lotsChanged) lotsChanged();   // the lot map's built/vacant states
    if (economy && patches.some(p => p.k === 'bld' || p.k === 'lvl' || p.k === 'level')) economy.worldChanged();   // venues open and close with their floors
    if (vehicles) { try { vehicles.worldChanged(); } catch (e) { log.error('[vehicles] after an edit', e.message); } }
    if (players) { try { players.worldChanged(); } catch (e) { log.error('[players] after an edit', e.message); } }   // move players out of new walls (C62)
    if (fleet && patches.some(p => p.k === 'wmods')) { try { fleet.sync(); } catch (e) { log.error('[aircraft] after an edit', e.message); } }   // airports placed, moved, removed
    if (harbour && patches.some(p => p.k === 'wmods')) { try { harbour.sync(); } catch (e) { log.error('[boats] after an edit', e.message); } }   // docks placed, moved, removed
    if (patches.some(p => p.k === 'person' && people[p.i]?.vip)) { try { settleSoon(1500); } catch { /* (before the settling exists: its first run places them) */ } }   // an agent's home or work changed: settled again
  },
};
const editor = new Editor(app);
// the city's residents follow its homes: they move in and away by themselves, a little at a time (server/sim/housing.js)
const housing = new Housing({ world: () => world, sim: () => sim, editor, pct: () => Number(settings.get('world.homesFilled') ?? DEFAULT_HOMES_FILLED), log });
app.housing = housing;
const housingTimer = CFG.housing ? setInterval(() => { try { housing.step(); } catch (e) { log.warn('[housing]', e.message); } }, 15000) : null;   // (MVW_HOUSING=off: the number stays)
housingTimer?.unref?.();
{ const re = editor.relevelModules(); if (re.length) log.info?.('[world] world modules levelled again for their new layout:', re.join('; ')); }
{ const tm = editor.ensureTerminals(); if (tm.length) log.info?.('[world] airport terminals built:', tm.join('; ')); }
{ const lv = editor.levelModulesToRoads(); if (lv.length) log.info?.('[world] world modules levelled to meet their access roads:', lv.join('; ')); }
{ const dc = editor.ensureModuleDecor(); if (dc.length) log.info?.('[world] docks given their benches, picnic tables and trees:', dc.join('; ')); }

// ------------------------------------------------------------------ the edit journal and the activity log (WP1.8)
const journal = new Journal(dbs, { editor });
journal.onError = e => log.error('[journal]', e.stack || e.message);
editor.journal = journal;
accounts.journal = journal;   // a deleted account's edits keep its name only; the data export lists an account's edits
settings.journal = journal;   // activity.retentionDays purges old edits
activity = new Activity({ journal, perms });
activity.on(m => {
  if (!wss) return;
  const key = m.item ? 'item' : 'update', it = m[key];
  if (!it) return;
  const full = JSON.stringify({ t: 'activity', [key]: it });
  const lite = it.task !== undefined ? JSON.stringify({ t: 'activity', [key]: activity.view(it, GUEST) }) : full;
  for (const ws of wss.clients) {
    if (ws.readyState !== 1 || !perms.allowed(ws.P, 'activity.read')) continue;
    ws.send(lite !== full && perms.allowed(ws.P, 'agents.view_tasks') ? full : lite);
  }
});
journal.historyListeners.add(accountId => {
  if (!wss) return;
  let msg = null;
  for (const ws of wss.clients) {
    if (ws.readyState !== 1 || !ws.P.account || ws.P.account.id !== accountId) continue;
    msg ||= JSON.stringify({ t: 'history', ...journal.tops(accountId) });
    ws.send(msg);
  }
});
function purgeEdits() {
  try {
    const days = Number(perms.setting('activity.retentionDays', 0));
    if (days > 0) journal.purge(days);
  } catch (e) { log.error('[journal] purge failed', e.message); }
}
purgeEdits();
setInterval(purgeEdits, 3600000).unref();
/** An AI agent started or stopped working: a line in the activity log. The first report after a start, and anything
 *  while the presence source is unreachable, only sets the baseline. */
function noteAgent(id, s) {
  if (!coordinator.live()) { presenceSeen.clear(); return; }
  if (!agentOk(id)) return;
  const prev = presenceSeen.get(id), now = !!s.working;
  presenceSeen.set(id, now);
  if (!activity || prev === undefined || prev === now) return;
  const list = sim.people, i = list.findIndex(p => p && p.vip && p.agentId === id);
  if (i < 0) return;
  activity.add({ kind: 'agent', text: `${list[i].name} ${now ? 'started' : 'stopped'} working`, place: { i }, ...(now ? { task: s.task || '' } : {}) });
}
// ------------------------------------------------------------------ players, friends, status (WP1.10, C62, C118)
players = new Players({ dbs, world, perms, settings, log });
const friends = new Friends(dbs, { accounts });
players.friends = friends;
accounts.players = players;   // a deleted account's player and friendships go with it
// players at furniture (a seat, a machine they play): the sim gives those places to nobody else (server/sim/agents.js)
setPlayerSpots(() => { const out = []; for (const p of players.byId.values()) if ((p.flags & PF_USING) && p.ctx >= 0) out.push({ x: p.x, z: p.z, ctx: p.ctx }); return out; });
players.onUse = p => sim?.brain?.playerTook?.(p.x, p.z, p.ctx);
// play modules (docs/features/play-modules.md): minigames, their levels, badges, leaderboards and players' profiles
// the airport's aircraft (server/world/aircraft.js): who flies which, their poses checked and shared nearby
fleet = new Fleet({ world: () => world, players, log, groundAt: (x, z) => { const G = editor.ground(); return G ? G.env.heightAt(x, z) : 0; } });
players.fleet = fleet;
// the fishing docks' boats (server/world/boats.js): who has which out, their poses checked and shared nearby
harbour = new Harbour({ world: () => world, players, log, groundAt: (x, z) => { const G = editor.ground(); return G ? G.env.heightAt(x, z) : 0; }, waterAt: (x, z) => { const G = editor.ground(); return G ? G.env.waterAt(x, z) : null; } });
players.harbour = harbour;
const play = new PlayCore({ dbs, log, contextFor: (id, where, account) => playContext(id, where, account),
  whereIs: account => { const p = players?.byId.get(account.id); return p ? { x: p.x, z: p.z } : null; },   // (the fishing ground a bite claims must be where you are)
  // prizes in Virtual Coin: from the economy's Game prizes faucet, by its policy (play), when the economy is on
  prizes: {
    rules: () => (economy && economy.econ.enabled() && !economy.econ.paused() ? economy.econ.policy().play : null),
    pay: (id, amount, memo, idem) => {
      const E = economy.econ;
      E.ledger.transfer(E.faucet('prizes').id, E.walletFor(econSubj('account', id)).id, amount, { kind: 'prize', actor: 'system:play', memo: `Prize — ${memo}`, idem });
      return { paid: amount };
    },
  } });
players.play = play;
vehicles = await createVehicles({ world, worldId: dbs.worldId, players, store, perms, log,
  clock: () => ({ rate: sim.clock.rate, time: sim.now(), hour: sim.hour() }),
  actors: () => { const t = sim.now(); return sim.agents.filter(a => a.plan && !a.p.retired).map(a => ({ id: `n:${a.i}`, ...evalPlan(a.plan, t) })); },
  residentCars: () => (sim ? sim.residentCarsNow() : []) });   // (the traffic keeps clear of residents' cars: shared/car-route.js)
players.vehicles = vehicles;
weather = new Weather({ worldId: dbs.worldId, store, clock: () => sim.clock, simNow: () => sim.now(), broadcast, audit });
wildlife = new Wildlife(world, { seed: dbs.worldId, clock: () => sim.clock });
accounts.friends = friends;
agentApi = new AgentApi({ store: dbs, audit, friends });   // agents that connect outbound (WP2.14)
registry.addInProcess('agentapi');   // the server answers for this kind itself
registry.addInProcess('browser');    // (the agents' PC's browser service: driven by server/pc/browser.js, tested here)
registry.addInProcess('search');     // (its search service: Brave or SearXNG, asked by server/pc/browser.js)
connections.probes.set('search', async (c, secrets) => {
  const b = new PcBrowser({ os: null, search: () => ({ kind: c.config.provider === 'searxng' ? 'searxng' : 'brave', url: c.config.url || '', key: secrets.key || '' }) });
  try {
    const sh = { c: { agent: null, account: 0 }, page: null };
    const out = await b.search(sh, 'weather');
    return { ok: true, detail: `${c.config.provider === 'searxng' ? 'SearXNG' : 'Brave Search'} answered (${sh.page?.links?.length || 0} results for a test search)` };
  } catch (e) { return { ok: false, error: e.message }; } finally { b.stop(); }
});
connections.probes.set('browser', async (c, secrets) => {
  if (!secrets.endpoint) return { ok: false, error: 'The browser address is missing', fix: 'Edit the connection and enter the browser\'s address.' };
  const p = await new CdpPage(secrets.endpoint, { allowPrivate: c.scope === 'installation' }).open();
  try { const v = await p.call('Browser.getVersion'); return { ok: true, detail: `${v.product || 'A DevTools browser'} answered and opened a page` }; } finally { p.close(); }
});
const agentBodies = { spawn: spawnAgentBody, retire: retireAgentBody, revive: reviveAgentBody, rename: renameAgentBody, state: agentBodyState };
bridgeAgents({ agentApi, agents, connections, log, body: agentBodies });   // every connected agent lives in the city (WP2.10)
agentProviders.useBodies(agentBodies);   // and every agent of an agent provider (OpenClaw's)
agentApi.hooks.session = slot => coordinator.refresh(extKey(slot.id));
// its wake-up link (server/agent-wakeup.js): the world starts its AI on its own platform when something waits for it
wakeUps = new WakeUps({ store: dbs, box, agentApi, setting: k => settings.get(k), log, allowLocal: providerTest,
  notify: (slot, text) => { const a = agents.byKey(extKey(slot.id)); notifyAccount(slot.account_id, { t: 'mind', ev: 'note', agent: a ? { id: a.id, name: a.name } : { name: slot.name }, text }); } });
agentApi.hooks.wakeUp = (slotId, reason) => wakeUps.trigger(slotId, reason);

agentApi.deps.wakeView = id => wakeUps.view(id);
agentApi.deps.appOffer = id => { const a = agentApp(id); return a ? settings.get(a.setting) : null; };   // who may choose each third-party app (Settings → Agent limits)
// (the admin's switches: talking with others' agents covers their chat windows too; then outside AIs on their own)
{ const FLAGS = { talkEnabled: 'talk.enabled', visitorsEnabled: 'connected.visitorsEnabled', requireApproval: 'connected.requireApproval' };
  agentApi.deps.flag = name => !FLAGS[name] || settings.get(FLAGS[name]) !== false; }
// a key joined with its code and waits for its owner's OK; it signed in from an address it has not used before: its owner
// hears of each (a notification they keep), with what to do if it wasn't their AI
agentApi.hooks.approvalNeeded = slot => notifyAccount(slot.account_id, { t: 'mind', ev: 'note', agent: { name: slot.name },
  text: `${slot.name} is waiting for your OK: an AI joined it with its code (key ${String(slot.fingerprint || '').slice(0, 16)}). If you just gave the code to your AI and it tells you the same key, approve it in Settings → Third-party agents; if not, decline it.` });
// connected (approved, or at once when the admin turned the wait off) and disconnected: a session someone else holds on the
// account can't do either quietly
agentApi.hooks.connected = slot => {
  const a = agents.byKey(extKey(slot.id));
  notifyAccount(slot.account_id, { t: 'mind', ev: 'note', agent: a ? { id: a.id, name: a.name } : { name: slot.name },
    text: slot.fingerprint
      ? `${slot.name} is connected: the AI with key ${String(slot.fingerprint).slice(0, 16)} can act as it now. If you didn't approve this, disconnect it in Settings → Third-party agents.`
      : `${slot.name} is connected through an AI app (MCP): it lives as it now. If you didn't do this, disconnect it in Settings → Third-party agents.` });
};
agentApi.hooks.disconnected = slot => {
  const a = agents.byKey(extKey(slot.id));
  if (a) { try { connector.endAgentGrants(a.id); } catch { /* the body tools are gone with its connection anyway */ } }
  notifyAccount(slot.account_id, { t: 'mind', ev: 'note', agent: a ? { id: a.id, name: a.name } : { name: slot.name },
    text: `${slot.name} was disconnected: its key no longer works. To connect it again, make a new code in Settings → Third-party agents.` });
};
agentApi.hooks.newAddress = (slot, before) => {
  const a = agents.byKey(extKey(slot.id));
  notifyAccount(slot.account_id, { t: 'mind', ev: 'note', agent: a ? { id: a.id, name: a.name } : null,
    text: `${slot.name} signed in from an address it hasn't used before (${before} known). If that wasn't your AI, disconnect it in Settings → Third-party agents and give your AI a new code.` });
};
// a visitor whose messages to it were refused again and again is kept away for a day: its owner hears of it once
const visitorNameQ = dbs.db.prepare('SELECT display_name FROM accounts WHERE world_id = ? AND id = ?');
agentApi.hooks.keptAway = (slot, viewerId, n) => {
  const a = agents.byKey(extKey(slot.id)), who = visitorNameQ.get(dbs.worldId, Number(viewerId))?.display_name || 'Someone';
  notifyAccount(slot.account_id, { t: 'mind', ev: 'note', agent: a ? { id: a.id, name: a.name } : null,
    text: `${who} wrote ${n} messages to ${slot.name} today that were refused as tricks, links or contact details. They can't write to it again until tomorrow; you can block them for good in Studio.` });
};
// its AI was about to show a visitor something private: its owner hears of it (a notification they keep)
agentApi.hooks.withheld = (slot, reason) => {
  const a = agents.byKey(extKey(slot.id)), what = { secret: 'a password, key, token or code', contact: 'contact details', link: 'a link' }[reason] || 'something private';
  notifyAccount(slot.account_id, { t: 'mind', ev: 'note', agent: a ? { id: a.id, name: a.name } : null,
    text: `${slot.name} was about to show a visitor ${what}. It was held back. If you didn't expect this, check what its AI has been asked.` });
};
agents.extraUse = (P, a) => { const slot = agentApi.slotOfAgentKey(a.key); return !!slot && !!P.account && agentApi.canChat(slot, P.account.id); };   // the slot's chat audience (C127)
agentApi.deps.emit = e => providerBus.emit(e);
agentApi.deps.note = line => log(line);
// (the admin's limits for connected agents: Settings → Agent limits)
// (people talking with an agent follow one set of limits whichever way they come in — walking up to it or its chat window:
// the "talk" settings; then what only outside AIs need)
{ const MAP = { queueMax: 'connected.queueMax', talkMessages: 'talk.maxMessages', talkWindowMinutes: 'talk.windowMinutes', visitorPerDay: 'talk.visitorPerDay',
    agentVisitorPerDay: 'talk.agentVisitorPerDay', visitorMaxChars: 'talk.maxChars', strikesPerDay: 'connected.strikesPerDay', answerMaxChars: 'connected.answerMaxChars',
    inboxMax: 'connected.inboxMax' }, base = agentApi.limit;
  agentApi.limit = k => { const v = MAP[k] ? Number(settings.get(MAP[k])) : NaN; return Number.isFinite(v) && v > 0 ? v : base(k); }; }
agentApi.deps.connectionOf = slot => { const a = agents.byKey(extKey(slot.id)); return a ? a.connectionId : null; };
setInterval(() => { try { agentApi.sweep(); } catch (e) { log.warn('[agent-api] sweep failed:', e.message); } }, 60000).unref();
settings.onAccountChange = (id, paths) => {
  if (!paths.includes('social.status')) return;
  const [before, after] = players.statusChanged(id);
  const p = players.byId.get(id);
  if (p && before === 'invisible' && after === 'online') friendNotice(p, 'online');   // "came online" when they show up
};
/** Tells an account's online friends that it came online (never while it appears offline). */
function friendNotice(p, kind) {
  for (const fid of friends.friendIds(p.id)) players.toAccount(fid, { t: 'friend_' + kind, pid: p.id, name: p.name });
}
players.onJoin = (p, visible) => {
  if (!visible) return;
  if (activity) activity.add({ kind: 'player', text: `${p.name} joined` });
  friendNotice(p, 'online');
};
players.onLeave = (p, visible) => { if (visible && activity) activity.add({ kind: 'player', text: `${p.name} left` }); };
let onlineTimer = null;
/** The online list changed: every page that may see it gets its own view of it (friends first; hidden accounts only
 *  for admins), at most four times a second. */
players.onOnlineChange = () => {
  if (onlineTimer) return;
  onlineTimer = setTimeout(() => {
    onlineTimer = null;
    if (!wss) return;
    for (const ws of wss.clients) {
      if (ws.readyState !== 1 || !perms.allowed(ws.P, 'players.online')) continue;
      send(ws, { t: 'online', list: players.onlineFor(ws.P) });
    }
  }, 250);
  onlineTimer.unref?.();
};
friends.listeners.add(accountId => {
  players.toAccount(accountId, { t: 'friends', ...friends.list(accountId) });
  players.onOnlineChange();
});
function playerOn(ws) {
  if (!ws.P || !ws.P.account || ws.P.restricted) return;
  players.attach(ws);
  vehicles.attach(ws);
  { const f = fleet?.stateFor(ws.P.account.id); if (f) send(ws, f); }   // a pilot's page reloaded: back in the cockpit
  { const b = harbour?.stateFor(ws.P.account.id); if (b) send(ws, b); }   // a skipper's: back at the helm
  if (perms.allowed(ws.P, 'players.online')) {
    send(ws, { t: 'online', list: players.onlineFor(ws.P) });
    if (perms.allowed(ws.P, 'players.friends')) send(ws, { t: 'friends', ...friends.list(ws.P.account.id) });
  }
}
function playerOff(ws) { vehicles.detach(ws); players.detach(ws); }
sim.events.add(ev => {
  if (ev.t === 'person') { peopleCache = {}; agentCache = null; save({ people: [ev.i] }); }
  broadcast(ev);
});
// The licence changed (activated, imported, deactivated): the agents, the locks and the watermark follow at once.
// The set of agents changed (added, removed, enabled or disabled): the residents' agent marks follow at once.
agents.listeners.add(() => {
  agentCache = null; peopleCache = {};
  people.forEach((p, i) => {
    if (!p || !p.vip) return;
    sim.emit({ t: 'person', i, person: sim.publicPerson(p, i) });
    const a = sim.agents[i];
    if (a && a.plan) sim.brain.interruptSoon(a);
  });
  broadcast({ t: 'agents' });
});
licence.listeners.add(() => {
  agentCache = null; peopleCache = {};
  people.forEach((p, i) => {
    if (!p || !p.vip) return;
    sim.emit({ t: 'person', i, person: sim.publicPerson(p, i) });
    const a = sim.agents[i];
    if (a && a.plan) sim.brain.interruptSoon(a);
  });
  broadcast({ t: 'licence', status: licence.status() });
  log(`[licence] ${licence.active ? 'licensed' : 'demo mode'}`);
});
setInterval(() => { try { licence.receipt(); } catch { /* the licence logs it */ } }, 2000).unref();
log(`[licence] ${licence.active ? 'licensed' : `demo mode: ${Object.values(LOCKS).join(', ')} locked`}`);

// ------------------------------------------------------------------ agent bodies (WP2.1)
/** Whether resident i is the body of an agent principal P manages (its owner, or a manage share): such an account
 *  dresses it (server/lot-rights.js — its look only), a connected agent's body too (2026-10-11). */
function managesBody(P, i) {
  const p = people[i], a = p && p.vip && p.agentId && !p.retired ? agents.byKey(p.agentId) : null;
  return !!a && agents.canManage(P, a);
}
/** Places bodies `idx` (of agent `a`, or each one's own) where they should live and work (server/sim/placement.js): its
 *  owner's own property first — or the world's owner's, for an agent of the world. → the indices whose home or work
 *  changed (residents who made way included: reassign gives them theirs). Before the property routes exist: none (the
 *  first settling, a moment after the start, places them). */
function placeAgentsNow(idx, a = null) {
  if (!agentPlaces) return [];
  const ownerOf = x => x?.ownerId ?? agentPlaces.worldOwner();
  const list = idx.map(i => ({ i, owner: ownerOf(a || agents.byKey(people[i]?.agentId)), noJob: !!hunts.get(i)?.pending }));
  const places = agentPlaces.places(); places.today = sim ? sim.brain.day(sim.now()) : null;   // (an employer it quit, until then: placement.js)
  const r = placeAgents(world, index, people, list, places);
  return [...r.changed, ...r.bumped];
}
/** Gives a new agent its resident body: a home and work near its owner (placeAgentsNow) and a routine. Returns the body's
 *  opaque reference. */
function spawnAgentBody(a) {
  const r = { name: a.name, emoji: a.emoji, role: a.role, agentId: a.key };
  const p = isExtKey(a.key) ? makeAgentBody(world, index, r, people, { visible: extPublic(a.key) }) : makeVip(world, index, r, people);
  p.job = { kind: 'free', title: r.role || 'Agent', seek: 1, prev: 'vip' };   // (its own home and work, near its owner: placeAgents)
  const [i] = sim.addPeople([p]);
  const placed = placeAgentsNow([i], a);
  const re = reassign(world, index, people, new RNG('agent:' + a.key));   // (a home and work for anyone who made way, or for it if none was found)
  const patches = [];
  for (const k of new Set([...placed, ...re.changed])) if (k !== i) patches.push({ k: 'person', i: k, person: sim.publicPerson(people[k], k) });
  sim.brain.warm(sim.agents[i], sim.now());
  patches.push({ k: 'people-add', list: [sim.publicPerson(people[i], i)] });
  peopleCache = {};
  broadcast({ t: 'patch', version: world.version, patches, who: 'agents' });
  save();
  return agents.resolver.bodyRef(p);
}
/** Removing an agent retires its body, never deletes it: resident indices are shared by the sim, the pages and the saved
 *  files. The body stops being planned and drawn, and its bed and desk are free again. */
function retireAgentBody(a) {
  const i = agents.resolver.resolveBody(a.bodyRef);
  if (i < 0) return false;
  const p = people[i], sa = sim.agents[i];
  p.retired = 1; p.home = null; p.job = { kind: 'free', title: 'Retired', retired: 1 };
  if (sa) { sim.brain.release(sa); sim.brain.leaveJoin(sa); sim.brain.setAct(sa, null); sa.plan = null; sa.ver++; }
  const re = reassign(world, index, people, new RNG('retire:' + a.key));
  const patches = [{ k: 'person', i, person: sim.publicPerson(p, i) }];
  for (const k of re.changed) if (k !== i) patches.push({ k: 'person', i: k, person: sim.publicPerson(people[k], k) });
  peopleCache = {};
  broadcast({ t: 'patch', version: world.version, patches, who: 'agents' });
  save();
  return true;
}

/** 'none' (no body yet), 'live' or 'retired': what the resident behind an agent's body reference is doing. */
function agentBodyState(a) {
  const i = agents.resolver.resolveBody(a.bodyRef);
  return i < 0 ? 'none' : people[i].retired ? 'retired' : 'live';
}
/** A retired body comes back (an agent enrolled again): the same resident, a free bed and desk, a routine. */
function reviveAgentBody(a) {
  const i = agents.resolver.resolveBody(a.bodyRef);
  if (i < 0) return false;
  const p = people[i], sa = sim.agents[i];
  delete p.retired; p.job = { kind: 'free', title: p.role || 'Agent', seek: 1, prev: 'vip' };
  p.name = bodyName(p, a);
  const placed = placeAgentsNow([i], a);
  const re = reassign(world, index, people, new RNG('revive:' + a.key));
  const patches = [{ k: 'person', i, person: sim.publicPerson(p, i) }];
  for (const k of new Set([...placed, ...re.changed])) if (k !== i) patches.push({ k: 'person', i: k, person: sim.publicPerson(people[k], k) });
  if (sa) { sa.plan = null; sa.ver++; sim.brain.warm(sa, sim.now()); }
  peopleCache = {};
  broadcast({ t: 'patch', version: world.version, patches, who: 'agents' });
  save();
  return true;
}
/** What the public calls the body: the agent's own name when the agent is public, an ordinary citizen's name otherwise. */
function bodyName(p, a) {
  if (!isExtKey(a.key) || extPublic(a.key)) return a.name;
  if (!p.alias) { const ar = new RNG('alias:' + a.key); p.alias = `${ar.pick(p.fem ? N.FIRST_F : N.FIRST_M)} ${ar.pick(N.LAST)}`; }
  return p.alias;
}
/** The body follows its agent: name (by visibility), badge and role, and how it is shown. Sends only what changed to the public. */
function renameAgentBody(a) {
  const i = agents.resolver.resolveBody(a.bodyRef);
  if (i < 0) return false;
  const p = people[i], before = JSON.stringify(sim.publicPerson(p, i));
  p.name = bodyName(p, a);
  // an agent of the world (not a connected one, whose body may pass for an ordinary citizen) shows its badge and role too —
  // and its job title follows the role ("<role> at <the HQ>", or the role alone while it has no desk; population.js makeVip)
  if (!isExtKey(a.key)) {
    p.emoji = a.emoji; p.role = a.role;
    const j = p.job || {}, role = a.role || 'Agent', at = (j.kind === 'vip' || j.kind === 'staff') && j.b >= 0 ? world.buildings[j.b] : null;
    if (j.kind === 'post' && p.post) p.job = sim.postJob(p, p.post);   // (on post: "<role> at <the place>", as the sim words it)
    else if (at) j.title = `${role} at ${j.kind === 'staff' && j.venue && j.venue !== 'lobby' ? (world.levels[at.lv[j.f]]?.name || at.name) : at.name}`;
    else if (j.kind === 'free' && j.prev === 'vip') j.title = role;
  }
  const now = sim.publicPerson(p, i);
  if (JSON.stringify(now) === before) return false;
  peopleCache = {};
  broadcast({ t: 'patch', version: world.version, patches: [{ k: 'person', i, person: now }], who: 'agents' });
  save();
  return true;
}

// ------------------------------------------------------------------ HTTP
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.map': 'application/json',
  '.md': 'text/markdown; charset=utf-8', '.py': 'text/x-python; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8', '.mp3': 'audio/mpeg' };   // /skill.md and the Python example of the Agent API (WP2.14)
const STATIC = [
  ['/vendor/three/', path.join(ROOT, 'node_modules/three/'), 'public, max-age=86400'],
  // The official Rapier build, loaded by a driver's browser only while driving (decision A20).
  ['/vendor/rapier/', path.join(ROOT, 'node_modules/@dimforge/rapier3d-compat/'), 'public, max-age=86400'],
  // noVNC's own build (its core and the zlib it vendors): an agent's own screen, live — Hermes' Bot Desktop (agent-pc.md §4.2)
  ['/vendor/novnc/', path.join(ROOT, 'node_modules/@novnc/novnc/'), 'public, max-age=86400'],
  ['/shared/', path.join(ROOT, 'shared/'), 'no-cache'],
  ['/promo/', path.join(DATA, 'promo/'), 'public, max-age=86400'],   // promotional aircraft graphics (WP4.11)
  ['/signs/', path.join(DATA, 'signs/'), 'public, max-age=86400'], // pictures on owners' signs and the Marketing tools' own content
  ['/assets/sfx/', path.join(ROOT, 'client/assets/sfx/'), 'public, max-age=86400'],   // the game's sound effects (audio/engine.js)
  ['/', path.join(ROOT, 'client/'), 'no-cache'],
];
// No framing by other sites (the sign-in dialog), no MIME sniffing, no full URLs in Referer headers to other sites.
const SECURITY_HEADERS = Object.freeze({
  'x-content-type-options': 'nosniff', 'referrer-policy': 'same-origin', 'x-frame-options': 'DENY', 'content-security-policy': "frame-ancestors 'none'",
});
// The arcade's sealed game box (client/arcade/box.html, docs/features/arcade.md): framed by this site's own pages only, in
// a sandbox of its own origin, and it may reach nothing but this site's scripts — no network, no forms, no other frames.
// Its scripts (and the shared sims) answer any origin: a sandboxed frame's requests come from an opaque one.
const ARCADE_BOX_HEADERS = Object.freeze({
  'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
  'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'none'; font-src 'self'; media-src 'none'; worker-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'",
});
function staticHeaders(pathname) {
  if (pathname === '/arcade/box.html') return ARCADE_BOX_HEADERS;
  if ((pathname.startsWith('/arcade/') || pathname.startsWith('/shared/arcade/') || pathname === '/shared/arcade.js' || pathname.startsWith('/vendor/three/build/')) && pathname.endsWith('.js')) return { ...SECURITY_HEADERS, 'access-control-allow-origin': '*' };   // (the 3D games draw with three.js)
  return SECURITY_HEADERS;
}
const gzCache = new Map();
function sendJSON(req, res, code, obj, pre = null, extra = null) {
  const body = pre ? pre.body : JSON.stringify(obj);
  const acceptGz = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
  const h = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...SECURITY_HEADERS, ...(extra || {}) };
  if (acceptGz && (pre?.gz || body.length > 2048)) {
    const gz = pre?.gz || zlib.gzipSync(body);
    res.writeHead(code, { ...h, 'content-encoding': 'gzip', 'content-length': gz.length });
    return res.end(gz);
  }
  res.writeHead(code, { ...h, 'content-length': Buffer.byteLength(body) });
  res.end(body);
}
/** A file a route answers with, streamed — whole, or one byte range of it (a video seeking): 206 with its range. */
function sendFile(req, res, file, extra) {
  const size = file.size, h = { 'cache-control': 'no-store', ...SECURITY_HEADERS, ...(extra || {}), 'accept-ranges': 'bytes' };
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || '').trim());
  let start = 0, end = size - 1, code = 200;
  if (m && (m[1] || m[2])) {
    if (m[1]) { start = Number(m[1]); end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1; } else { start = Math.max(0, size - Number(m[2])); }
    if (start > end || start >= size) { res.writeHead(416, { ...h, 'content-range': `bytes */${size}` }); return res.end(); }
    code = 206; h['content-range'] = `bytes ${start}-${end}/${size}`;
  }
  res.writeHead(code, { ...h, 'content-length': size ? end - start + 1 : 0 });
  if (!size || req.method === 'HEAD') return res.end();
  const stream = fs.createReadStream(file.path, { start, end });
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}
// ETags are a hash of the file's content, so a file left unchanged by a new release (a new folder, new mtimes) still
// answers 304 instead of being downloaded again. Hashing streams in chunks and is cached per path, size and mtime.
const etags = new Map(), etagPending = new Map();
function contentEtag(file, st, done) {
  const known = etags.get(file);
  if (known && known.size === st.size && known.mtimeMs === st.mtimeMs) return done(known.etag);
  let pending = etagPending.get(file);
  if (!pending) {
    pending = new Promise(resolve => {
      const hash = crypto.createHash('sha256'), stream = fs.createReadStream(file);
      stream.on('data', c => hash.update(c));
      stream.on('end', () => resolve(`"${hash.digest('base64url').slice(0, 27)}"`));
      stream.on('error', () => resolve(`"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"`));
    }).then(etag => { etagPending.delete(file); etags.set(file, { size: st.size, mtimeMs: st.mtimeMs, etag }); return etag; });
    etagPending.set(file, pending);
  }
  pending.then(done);
}
function serveStatic(req, res, pathname) {
  for (const [prefix, dir, cache] of STATIC) {
    if (!pathname.startsWith(prefix)) continue;
    let rel;
    try { rel = decodeURIComponent(pathname.slice(prefix.length)); } catch {
      res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS }); res.end('Bad request');
      return true;
    }
    if (!rel || rel.endsWith('/')) rel += 'index.html';
    const file = path.resolve(dir, rel);
    if (!file.startsWith(dir)) break;
    let st;
    try { st = fs.statSync(file); } catch { continue; }
    if (!st.isFile()) continue;
    const ext = path.extname(file).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    const sec = staticHeaders(pathname);
    contentEtag(file, st, etag => {
      if (req.headers['if-none-match'] === etag) { res.writeHead(304, { etag, 'cache-control': cache, ...sec }); return res.end(); }
      const text = /^(text|application\/json)/.test(type) || ext === '.svg';
      const h = { 'content-type': type, etag, 'cache-control': cache, ...sec };
      if (text && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
        let c = gzCache.get(file);
        if (!c || c.etag !== etag) { c = { etag, gz: zlib.gzipSync(fs.readFileSync(file)) }; gzCache.set(file, c); }
        res.writeHead(200, { ...h, 'content-encoding': 'gzip', 'content-length': c.gz.length });
        res.end(req.method === 'HEAD' ? undefined : c.gz);
      } else {
        res.writeHead(200, { ...h, 'content-length': st.size });
        if (req.method === 'HEAD') res.end(); else fs.createReadStream(file).pipe(res);
      }
    });
    return true;
  }
  return false;
}
/** Reads a JSON request body. Past the limit the rest is drained and dropped, so the client still receives the 413
 *  answer; past eight times the limit the connection is closed. Errors carry the HTTP status to answer with. */
/** Reads a request body as bytes up to `limit` (uploads: backups). Errors carry the HTTP status. */
function readStream(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > limit) { reject(Object.assign(new Error('Body too large'), { status: 413 })); req.destroy(); return; } chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', () => reject(Object.assign(new Error('Bad request'), { status: 400 })));
  });
}
function readBody(req, limit = 512 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0, over = false; const chunks = [];
    const fail = (status, msg) => reject(Object.assign(new Error(msg), { status }));
    req.on('data', c => {
      size += c.length;
      if (size > limit * 8) { fail(413, 'Body too large'); req.destroy(); return; }
      if (size > limit) { over = true; chunks.length = 0; return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (over) return fail(413, 'Body too large');
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { fail(400, 'Bad JSON'); }
    });
    req.on('error', () => fail(400, 'Bad request'));
  });
}

// Readiness (GET /api/ready; the Docker image's health check, DECISIONS C105): not ready while shutting down or when
// the simulation loop has not advanced for 10 seconds. /api/health answers whenever the process serves HTTP.
let shuttingDown = false, lastLoopAt = Date.now();
const RESTARTING = Object.freeze({ error: 'The server is restarting; try again in a moment', code: 'restarting' });
const RESTARTING_HEADERS = Object.freeze({ 'retry-after': '5', connection: 'close' });
function readiness() {
  if (shuttingDown) return { ready: false, why: 'shutting down' };
  const idle = Date.now() - lastLoopAt;
  if (idle > 10000) return { ready: false, why: `the simulation has not advanced for ${Math.round(idle / 1000)} s` };
  return { ready: true };
}
const api = createApi({
  VERSION, RELEASE, accounts, perms, policy, audit, settings, cookieName: COOKIE,
  world: () => world, people: () => people, sim: () => sim, presence: gatedPresence, presenceState: key => coordinator.stateOf(key), presenceStatus: () => coordinator.status(), licence, agentApi, wakeUps, agents, registry, host, connections, agentProviders, providerBus, chat, notifications, attachments, references, agentOk, spawnAgentBody, retireAgentBody, renameAgentBody, managesBody, recent, life: () => agentLife, editor, housing, journal, activity, players, friends, vehicles, fleet, harbour,
  worldPayload, peoplePayload, saveMeta, clients: () => (wss ? wss.clients.size : 0), wildlifeStats: () => (wildlife ? wildlife.stats : null), storeStats, libs: () => LIBS, loopStats: () => loopStats(),
  onAccessChange: () => recheckSockets(), send, realNow, readiness,
  onTalk: (P, i) => mind?.heard(P, i),   // (an agent with a brain of its own answers in its own words: server/mind/)
  demoAgentRoom,   // (demo mode: an installation has at most 3 agents, built in or connected)
  agentPublic: a => (agentTalk ? agentTalk.isPublic(a) : false),   // (the info dock's Public agents: anyone may talk with it)
});
const router = api.router, WS = api.ws;
// Property (WP4.13/4.14, DECISIONS E25): lots, title and the holder/administrator operations, with their own routes.
const property = addPropertyRoutes(router, { dbs, audit, perms, log, settings, world: () => world, broadcast: o => broadcast(o),
  worldChanged: () => { worldCache = null; save(); } });
lotsChanged = () => property.buildingsChanged();
if (starterLots && !property.count()) {   // the starting map's lots (held by the city, as its builder left them)
  try { log(`[boot] the starting map's lots laid out: ${property.seed(starterLots).ids.length}`); }
  catch (e) { log.error('[boot] the starting map\'s lots could not be laid out', e.message); }
}
// ------------------------------------------------------------------ where agents live and work (server/sim/placement.js)
// Near their owner (2026-10-23): its own property first, then the city's in its home town, then the city's elsewhere —
// never another player's. Placed when made or brought back, and settled again a moment after lots, buildings or a home
// base change, at start and every few minutes (an agent moves only to a better tier, never off a place its owner chose).
// Ordinary residents re-homed or re-hired keep to their own town (population.js setPlaces).
setPlaces(() => { const P = property.towns.places(); P.pull = migration?.pulls() || null; return P; });   // (newcomers: by the towns' pull)
{
  const worldOwnerQ = dbs.db.prepare("SELECT id FROM accounts WHERE world_id = ? AND role = 'owner' AND status = 'active' ORDER BY id LIMIT 1");
  agentPlaces = { places: () => property.towns.places(), worldOwner: () => worldOwnerQ.get(dbs.worldId)?.id ?? null };
}
let settleTimer = null;
// Its own brain chooses its job (step 7, 2026-10-23): an agent with Free Will on that needs work, its owner having given
// it none, asks its decision service which of the jobs open to it to take (server/sim/placement.js jobOptions,
// server/free-will/free-will.js chooseJob); meanwhile its job is left alone. No answer: the rules place it at the next
// settling, and it doesn't ask again for half an hour.
const HUNT_AGAIN_MS = 30 * 60000;
const needsWork = p => !p.job?.pin && !p.post && (!p.job || p.job.kind === 'free' || p.job.b === undefined);
function startHunts(idx) {
  if (!freeWill || !agentPlaces) return;
  for (const i of idx) {
    const p = people[i], h = hunts.get(i);
    if (!p || !needsWork(p) || !freeWill.isActive(i) || (h && (h.pending || Date.now() - h.at < HUNT_AGAIN_MS))) continue;
    const a = agents.byKey(p.agentId); if (!a) continue;
    const places = agentPlaces.places(); places.today = sim.brain.day(sim.now());
    const opts = jobOptions(world, index, people, i, a.ownerId ?? agentPlaces.worldOwner(), places, 6);
    if (opts.length < 2) continue;
    const T = property.towns, labelled = opts.map(o => ({ ...o, label: `${o.kind === 'staff' ? 'Serving at the counter' : 'At a desk'} at ${o.where}, ${T.name(T.ofBuilding(o.b))}${o.t === 0 ? ' (its owner\'s own business)' : ''}, about ${o.dist} m from its owner's home base` }));
    const hunt = { at: Date.now(), pending: true };
    hunts.set(i, hunt);
    freeWill.chooseJob(i, labelled).then(pick => { hunt.pending = false; if (!(pick && takeHunt(i, pick))) settleSoon(500); }, () => { hunt.pending = false; settleSoon(500); });
  }
}
/** The job its brain picked, if it still needs work and nobody took that place meanwhile. */
function takeHunt(i, o) {
  const p = people[i];
  if (!p || p.retired || !needsWork(p)) return false;
  if (people.some((q, k) => k !== i && q && !q.retired && ((q.job?.b === o.b && q.job.f === o.f && q.job.id === o.idx && q.job.k === o.k) || (q.post?.b === o.b && q.post.f === o.f && q.post.id === o.idx && q.post.k === o.k)))) return false;
  giveJob(world, p, { b: o.b, f: o.f, id: o.idx, k: o.k, kind: o.kind, venue: o.venue }, new RNG(`hunt:${p.id}:${Date.now()}`), { by: 'brain' });
  sim.setJob(i);
  peopleCache = {}; save({ people: [i] });
  broadcast({ t: 'patch', version: world.version, patches: [{ k: 'person', i, person: sim.publicPerson(p, i) }], who: 'agents' });
  log(`[agents] ${p.name} chose its job: ${o.label}`);
  return true;
}
/** Every agent's body, settled where it should live and work; the moves sent to the pages, the routines re-planned. */
function settleAgents() {
  try {
    const idx = [];
    for (const a of agents.list()) { const i = agents.resolver.resolveBody(a.bodyRef); if (i >= 0 && people[i] && !people[i].retired) idx.push(i); }
    if (!idx.length) return 0;
    startHunts(idx);
    const moved = placeAgentsNow(idx);
    if (!moved.length) return 0;
    const re = reassign(world, index, people, new RNG('settle:' + Date.now()));
    const all = new Set([...moved, ...re.changed]), patches = [];
    for (const k of all) {
      const sa = sim.agents[k];
      if (sa?.plan) sim.brain.interruptSoon(sa);
      patches.push({ k: 'person', i: k, person: sim.publicPerson(people[k], k) });
    }
    peopleCache = {};
    broadcast({ t: 'patch', version: world.version, patches, who: 'agents' });
    save({ people: [...all] });
    log(`[agents] settled: ${moved.length} moved near their owners${re.changed.length ? `, ${re.changed.length} residents placed` : ''}`);
    return moved.length;
  } catch (e) { log.warn?.('[agents] settling failed:', e.message); return 0; }
}
const settleSoon = (ms = 2500) => { clearTimeout(settleTimer); settleTimer = setTimeout(settleAgents, ms); settleTimer.unref?.(); };
property.onChange = () => settleSoon();
setTimeout(settleAgents, 8000).unref?.();
setInterval(settleAgents, 3 * 60000).unref?.();
players.lotsOf = id => property.heldBy({ kind: 'account', id: String(id) });   // "Go home": a building on a lot it holds
// Getting started (server/guide.js): the welcome tour's state and the first things to do, for the in-world guide.
addGuideRoutes(router, new Guide({ dbs, world: () => world, settings, can: (P, c) => perms.allowed(P, c), landForSale: () => !!economy?.econ?.enabled() }));
// The economy (docs/features/ECONOMY.md, server/economy/): Virtual Coin wallets for every player, agent, resident, business
// and the city; the living economy the residents run; the city's budget; the markets. Off until the owner turns it on.
{
  const ownerQ = dbs.db.prepare("SELECT id FROM accounts WHERE world_id = ? AND role = 'owner' AND status = 'active'");
  const ownerId = () => ownerQ.get(dbs.worldId)?.id ?? null;
  economy = createEconomy({ router, dbs, box, perms, audit, log, world: () => world, people: () => people, sim: () => sim, property,
    agents: { byId: id => agents.get(id), byKey: k => agents.byKey(k), enabled: () => agents.enabled(), ownedBy: acc => agents.list().filter(a => a.enabled && (a.ownerId ?? ownerId()) === acc) },
    ownerAccount: ownerId,
    // whom a player or an agent may pay: the installation's agents that count as agents; a connected agent only where its owner shows it
    agentVisible: (a, viewer) => (isExtKey(a.key) ? agentApi.agentKeyVisible(a.key, viewer?.kind === 'account' ? viewer.id : null) : agentOk(a.key)),
    notify: (id, m) => notifyAccount(id, m), broadcast: o => broadcast(o), reauthMs: LIMITS.reauthMs,
    whereIs: id => { const p = players.byId.get(id); return p ? { b: p.ctx >= 0 ? ctxB(p.ctx) : -1, x: p.x, z: p.z } : null; },
    agentOfSlot: slot => agents.byKey(extKey(slot.id)),
    // property for VC: the editor writes flats' records, an agent's character moves in, the lot map refreshes
    editor: () => editor, agentBody: id => { const a = agents.get(id); return a ? agents.resolver.resolveBody(a.bodyRef) : -1; },
    lotsChanged: ids => property.lotsChanged(ids),
    // an agent's pay (economy/households.js agentPay): its unpaid days kept with its resident; unpaid too long, it quits
    // its job (or its post) there, keeps away from that employer a while (placement.js) and its owner is told
    peopleChanged: list => { const idx = list.map(p => people.indexOf(p)).filter(i => i >= 0); if (idx.length) save({ people: idx }); },
    agentQuit: ({ p, biz, days, avoid }) => {
      const i = people.indexOf(p); if (i < 0) return;
      const a = agents.byKey(p.agentId);
      p.quit = { b: biz.b, biz: biz.id, untilDay: sim.brain.day(sim.now()) + avoid };
      let moved = false;
      if (p.post && p.post.b === biz.b) { sim.setPost(i, null); if (a) posts.ended(a); moved = true; }   // (its owner is told below: not as a post that vanished)
      if (p.job && p.job.b === biz.b) { p.job = { kind: 'free', title: p.role || 'Agent', seek: 1, prev: 'vip' }; sim.setJob(i); moved = true; }
      peopleCache = {}; save({ people: [i] });
      const owner = a ? (a.ownerId ?? ownerId()) : null;
      if (owner != null) notifyAccount(owner, { t: 'mind', ev: 'note', agent: a ? { id: a.id, name: a.name, emoji: a.emoji || '' } : null,
        text: `${a?.name || 'Your agent'} quit ${moved ? 'its work' : 'working'} at ${biz.name}: it wasn't paid for ${days} days. It is looking for work elsewhere and won't go back there for ${avoid} days.` });
      log(`[economy] agent ${a?.name || p.agentId} quit at ${biz.name} after ${days} unpaid days`);
      settleSoon();
    },
    // on a post or at work its owner gave it, it can't quit: it tells its owner instead
    agentUnpaid: ({ p, biz, days, post }) => {
      const a = agents.byKey(p.agentId), owner = a ? (a.ownerId ?? ownerId()) : null;
      if (owner == null) return;
      notifyAccount(owner, { t: 'mind', ev: 'note', agent: { id: a.id, name: a.name, emoji: a.emoji || '' },
        text: `${a.name} hasn't been paid for ${days} days at ${biz.name}: its wallet is short. It stays at the ${post ? 'post' : 'work'} you gave it; add money to ${biz.name} (Wallet → Businesses) so it can pay its wages.` });
    } });
  economy.start();
}
// What each town needs (server/town-needs.js, 2026-10-23): for everyone, the economy window's town layer — homes, jobs,
// shops, parks, transit and its businesses, with its issues in plain words.
const townNeedsNow = addTownNeedsRoutes(router, { world: () => world, index: () => index, people: () => people, towns: property.towns, moves: () => migration?.moves(),
  books: () => { const econ = economy?.econ; return econ?.enabled?.() ? econ.parts.businesses.table(econ.econDay() - 1).map(r => ({ b: r.b, profit: r.yesterday?.profit ?? 0, owed: r.yesterday?.owed ?? 0 })) : null; } });
// ... and moves its people (server/sim/migration.js, step 6): a few a world hour, to where they work, to work, to a town
// that does much better; newcomers by the towns' pull. Settings → Residents turns it off; MVW_HOUSING=off stops it, as
// it stops the city's population following its homes.
migration = new Migration({ world: () => world, sim: () => sim, editor, towns: property.towns, needs: townNeedsNow, on: () => settings.get('world.townMoves') !== false, log });
if (CFG.housing) setInterval(() => { try { migration.step(); } catch (e) { log.warn('[towns]', e.message); } }, 15000).unref?.();
let agentTalk = null;   // talking with others' agents (server/agent-talk/), set once its routes exist (below)
let agentSocial = null; // agents and friends (server/agent-social/), set below
// Free Will (docs/features/FREE-WILL.md, server/free-will/): agents whose owner switched it on let a decision service choose
// what they do with their free time. Requests go through the provider helper (credentials per call, never in this
// process's environment); the simulation never waits for an answer.
let freeWill = null, agentLife = null, mind = null, problems = null, voice = null, ownerPrincipal = () => null;
// a connection saved (a new key, say) or tested and working: a brain or decision service it had paused may go again now
let phone = null;      // agents' phones (server/phone/), set below
let pc = null, pcNames = t => t, pcTimer = null, pcWork = null, pcBrowser = null, pcProvScreens = null, pcWatch = null, pcChrome = null;   // the agents' PC (server/pc/), set below
connections.onChange = id => { mind?.breakerOk(id); freeWill?.breakerOk(id); phone?.connectionChanged(id); };
{
  // an agent's life (server/agent-life/): its profile, plans, memories, the people it knows and its activity log; it only
  // watches the simulation, and gives Free Will (and later the Mind) who the agent is and what it lived
  agentLife = new AgentLife({ dbs, agents, audit, log, sim: () => sim, savePerson: i => { peopleCache = {}; save({ people: [i] }); },
    config: () => ({ activityDays: Number(settings.get('agentLife.activityDays')) || 7 }) }).attach();
  addLifeRoutes(router, agentLife, { agents });
  addWorkRoutes(router, work, { agents, attachments, audit, publicChanged: () => broadcast({ t: 'agents' }) });   // (the pages reload the list: who is public)
  // talking with others' agents in the city (server/agent-talk/): short conversations through a bar, answered in a bubble
  // only the talker sees; their owners read them and block whom they choose
  const talk = new Talk({ dbs, agents, connections, sessions: chat.sessions, transcripts: chat.transcripts, chat, setting: k => settings.get(k), sim: () => sim,
    ownerOf: a => a.ownerId ?? principalFor(null)?.account?.id ?? null, work, life: () => agentLife, log }).attach();
  addTalkRoutes(router, talk, { agents });
  agentTalk = talk;
  const accountQ = dbs.db.prepare("SELECT id, login, role FROM accounts WHERE world_id = ? AND id = ? AND status = 'active'");
  const ownerQ = dbs.db.prepare("SELECT id FROM accounts WHERE world_id = ? AND role = 'owner' AND status = 'active'");
  const principalFor = ownerId => {
    const id = ownerId ?? ownerQ.get(dbs.worldId)?.id;   // an agent with no owner belongs to the installation's owner
    const r = id ? accountQ.get(dbs.worldId, id) : null;
    return r ? { account: { id: r.id, login: r.login, role: r.role }, role: r.role } : null;
  };
  ownerPrincipal = principalFor;   // (MVW Radio's hosts speak as their owners: server/radio/)
  // agents' phones (server/phone/, docs/features/phone.md): a Twilio number per agent — texts, calls, voicemail, contacts;
  // read from Twilio every few seconds (no webhook), what reaches the agent goes into its phone chat, its answer is a reply
  phone = new Phone({ dbs, agents, connections, host, chat, notifications, send: sendToAccount, principalFor, setting: k => settings.get(k),
    installId: dbs.worldId, audit, log }).watch();
  addPhoneRoutes(router, phone);
  { const before = chat.onAnswer; chat.onAnswer = (run, e) => { if (phone.onAnswer(run, e)) return; before?.(run, e); }; }
  phone.start();
  // the agents' PC (server/pc/, docs/features/agent-pc.md): one per account, a profile for each of its agents, teams;
  // its own database and file store under <data>/pc; live updates to the owning account only
  const displayQ = dbs.db.prepare('SELECT display_name FROM accounts WHERE world_id = ? AND id = ?');
  pc = new PcOS({ dir: path.join(DATA, 'pc'), worldId: dbs.worldId, agents, ownerAccount: () => ownerQ.get(dbs.worldId)?.id ?? null,
    emit: sendToAccount, log,
    limits: () => ({ agentMB: Number(settings.get('pc.agentMB')), teamMB: Number(settings.get('pc.teamMB')), fileMB: Number(settings.get('pc.fileMB')), keepDays: Number(settings.get('pc.keepDays')) }) });
  pcNames = (tag, me = null) => {
    if (me && tag === me) return 'you';
    const [k, id] = String(tag || '').split(':');
    if (k === 'a') return agents.get(Number(id))?.name || 'an agent that is gone';
    if (k === 'h') return me ? 'your owner' : (displayQ.get(dbs.worldId, Number(id))?.display_name || 'the owner');
    return 'someone';
  };
  // (an agent's work time zone: its job brief's, else the server's)
  const pcZone = a => { const z = work.brief(a.id).timezone; return z && validZone(z) ? z : serverZone(); };
  // its browser: the built-in reader, or its owner's browser service (a connection of the kind "browser" they may use —
  // their own first); the web search the installation chose (Settings → PC)
  const pcService = a => {
    const P = principalFor(a.ownerId);
    if (!P) return null;
    const list = connections.visible(P).filter(c => c.kind === 'browser' && c.enabled).sort((x, y) => (x.scope === 'account' ? 0 : 1) - (y.scope === 'account' ? 0 : 1));
    for (const c of list) { const sec = connections.secretsFor(c.id); if (sec.endpoint) return { endpoint: sec.endpoint, allowPrivate: c.scope === 'installation', connection: c.id }; }
    return null;
  };
  // (its search: its owner's search service — their own first — else the installation's built-in one)
  const pcSearch = a => {
    const P = a ? principalFor(a.ownerId) : null;
    const list = P ? connections.visible(P).filter(c => c.kind === 'search' && c.enabled).sort((x, y) => (x.scope === 'account' ? 0 : 1) - (y.scope === 'account' ? 0 : 1)) : [];
    for (const c of list) { const sec = connections.secretsFor(c.id); return { kind: c.config.provider === 'searxng' ? 'searxng' : 'brave', url: c.config.url || '', key: sec.key || '' }; }
    return { kind: settings.get('pc.search') === 'off' ? 'off' : 'duckduckgo' };
  };
  // (the built-in real browser: Chrome on this machine, started when an agent first browses — server/pc/chrome.js)
  pcChrome = new LocalChrome({ dir: path.join(DATA, 'pc'), exe: findChrome({ chrome: CFG.chrome }), enabled: () => settings.get('pc.realBrowser') !== false, log });
  pcBrowser = new PcBrowser({ os: pc, service: pcService, search: pcSearch, log, chrome: pcChrome });
  // (where its body is, for its owner's own view of its screens in the world: the resident it is, its desk at work)
  const pcBody = a => {
    const i = agentLife?.byAgent?.get(a.id);
    const p = Number.isInteger(i) ? sim?.people?.[i] : null;
    if (!p) return null;
    const j = p.job;
    return { i, desk: j && Number.isInteger(j.b) && j.kind !== 'free' && j.kind !== 'remote' && j.id != null ? { b: j.b, f: j.f, id: j.id } : null };
  };
  addPcRoutes(router, pc, { agents, names: tag => pcNames(tag), work: () => pcWork, browser: () => pcBrowser, body: pcBody, watch: (P, ids) => pcWatch?.lease(P, ids) || { watching: [] },
    own: { of: (P, a) => agentProviders.computerOf(P, a), call: (P, a, op, params, actor, o) => agentProviders.computer(P, a, op, params, actor, o) },
    shellFor: a => new PcShell(pc, { who: { agent: a.id }, tz: pcZone(a), names: pcNames, browser: pcBrowser }) });
  // (an Agent Providers' agent works on its own computer: its screens follow its provider's events — server/pc/provider-screens.js)
  pcProvScreens = new ProviderScreens({ pc, agentOf: e => coordinator.agentOf(e), quiet: runId => chat.runs.get(runId)?.talk === true }).start(providerBus);
  // (… and its work that started elsewhere — another channel, a schedule — while its owner watches its PC: server/pc/screen-watch.js)
  pcWatch = new ScreenWatch({ pc, follow: (P, id, key) => chat.followKey(P, id, key), agentOf: e => coordinator.agentOf(e), log }).start(providerBus);
  // (the upkeep — the trash and old versions past their days, contents nobody points at — once an hour, a little at a time)
  pcTimer = setInterval(() => { try { pc.gc(); } catch (e) { log.warn('[pc] upkeep', e.message); } }, 3600000);
  pcTimer.unref?.();
  const econView = () => {
    const h = sim.econ;   // the residents' economy (server/economy/households.js), null while the economy is off
    if (!h) return null;
    const bz = h.e.parts.businesses;
    return {
      canSpend: (a, kind, essential = false) => h.canSpend(a, kind, essential),
      venueFactor: (b, f) => h.venueFactor(b, f),
      price: (b, f, item) => { const biz = bz?.at(b, f); return biz ? bz.priceOf(biz, item) : null; },
      rating: (b, f) => bz?.at(b, f)?.rating ?? null,
      money: p => ({ available: h.available(p), rentPerDay: h.rentOf(p) }),
      // what it holds (server/economy/inventory.js: its welcome kit the first time), and giving from it within its
      // owner's limits (an approval above its line)
      holds: (agentId, n = 10) => { const inv = h.e.parts.inventory; if (!inv) return undefined; inv.welcome(econSubj('agent', agentId)); return inv.summary(econSubj('agent', agentId), n); },
      give: (agentId, payload) => economy.runAgentAction('give', payload, agentId, false),
      // its trades (server/economy/trades.js): the list, and opening, offering, accepting (its owner's rules) or declining
      trades: agentId => h.e.parts.trades?.list(econSubj('agent', agentId)) || [],
      trade: (agentId, action, b = {}) => {
        const T = h.e.parts.trades, inv = h.e.parts.inventory, me = { kind: 'agent', id: agentId };
        if (action === 'open') return T.open(me, { to: b.to, memo: b.memo });
        if (action === 'offer') return T.offer(me, { trade: b.trade, vc: Math.round((Number(b.vc) || 0) * 100), items: (b.items || []).map(l => ({ stack: inv.stackOf(econSubj('agent', agentId), l.item), qty: l.qty ?? 1 })) });
        if (action === 'accept') return economy.runAgentAction('tradeAccept', { trade: b.trade }, agentId, false);
        if (action === 'decline') return T.decline(me, { trade: b.trade });
        throw new Error('Open, offer, accept or decline');
      },
    };
  };
  freeWill = new FreeWill({
    dbs, agents, connections, registry, log, sim: () => sim, econ: econView, principalFor,
    decide: (c, request, timeoutMs) => host.call(c.kind, 'decide', { connectionId: String(c.id), config: c.config, secrets: connections.secretsFor(c.id), request, timeoutMs }, { timeoutMs: timeoutMs + 1000 }),
    // (its problems as worries: money tight, rent behind — the Mind's watcher, server/mind/problems.js)
    context: id => { const c = agentLife.contextFor(id); if (c && problems) c.worries = problems.words(id); return c; },
    spontaneity: { get: id => agentLife.traitsFor(id).spontaneity, set: (id, v, actorId) => agentLife.setProfile(id, { traits: { spontaneity: v } }, { id: actorId }) },
    config: () => ({
      enabled: settings.get('freeWill.enabled') !== false,
      defaultConnection: settings.get('freeWill.defaultConnection') || '',
      dailyDecisions: Number(settings.get('freeWill.dailyDecisions')) || 50000,
      agentDailyDecisions: Number(settings.get('freeWill.agentDailyDecisions')) || 1200,
      keepDays: Number(settings.get('freeWill.keepDays')) || 7,
    }),
  }).attach();
  settings.watch(paths => { if (paths.some(x => x.startsWith('freeWill.'))) freeWill.invalidate(); });
  agents.created.add(a => freeWill.startOn(a));   // (new agents decide for themselves from the start)
  addFreeWillRoutes(router, freeWill, { agents, connections, registry });
  // The Mind (server/mind/): agents whose brain is a model provider plan their day, reflect on it and answer their chats;
  // the others get the evening reflection from the installation's brain. Model calls go through the provider helper
  // (credentials per call); the agent's chat runs in this process (chat.inproc.models), its thinking in the background.
  // what goes wrong in an agent's life (server/mind/problems.js): rent it couldn't pay, money running out, no home, no
  // job — noticed from the world, remembered, told to its owner, and given to its Mind to think about
  const mindMoney = () => (economy && economy.econ.enabled() ? economy.mindMoney : null);
  problems = new Problems({ dbs, agents, log, sim: () => sim, life: agentLife, money: mindMoney, wallets: () => econView(), notify: (id, m) => notifyAccount(id, m), ownerOf: a => a.ownerId ?? principalFor(null)?.account?.id ?? null, scanMs: CFG.problemScanMs }).attach();
  mind = new Mind({
    dbs, agents, connections, registry, log, sim: () => sim, life: agentLife, bus: providerBus, principalFor,
    econ: () => { const v = econView(); return v ? { money: v.money, price: v.price } : null; },
    money: mindMoney, problems, notify: (id, m) => notifyAccount(id, m),
    // public speech: each line checked by the moderation service (the helper, credentials per call), then shown in the
    // agent's speech bubble like the routine's lines (the 'say' event every client draws)
    moderate: (c, input) => host.call('models', 'moderate', { connectionId: String(c.id), config: c.config, secrets: connections.secretsFor(c.id), allowPrivate: c.scope === 'installation', input, timeoutMs: 8000 }, { timeoutMs: 10000 }),
    say: (i, text) => { if (sim) sim.emit({ t: 'say', i, text, until: sim.now() + Math.min(14, Math.max(7, sim.brain.wm(4) * 0.6)) }); },
    // (a streamed answer — the chat window — sends its pieces to onDelta as they are written)
    complete: (c, req, onDelta) => host.call('models', 'complete', { connectionId: String(c.id), config: c.config, secrets: connections.secretsFor(c.id), allowPrivate: c.scope === 'installation', ...req },
      { timeoutMs: (req.timeoutMs || 45000) + 2000, onDelta: onDelta || null }),
    abort: (c, streamId) => host.call('models', 'abort', { connectionId: String(c.id), streamId }, { timeoutMs: 5000 }),
    config: () => ({
      enabled: settings.get('mind.enabled') !== false,
      reflectConnection: settings.get('mind.reflectConnection') || '',
      agentDailyJobs: Number(settings.get('mind.agentDailyJobs')) || 80,
      agentMonthlyUsd: Number(settings.get('mind.agentMonthlyUsd')) || 5,
      dailyUsd: Number(settings.get('mind.dailyUsd')) || 20,
      keepDays: Number(settings.get('mind.keepDays')) || 30,
      speech: settings.get('mind.speech') !== false,
      moderationConnection: settings.get('mind.moderationConnection') || '',
      speechPerDay: Number(settings.get('mind.speechPerDay')) || 8,
      speechGapSeconds: Number(settings.get('mind.speechGapSeconds')) || 20,
      speechMaxChars: Number(settings.get('mind.speechMaxChars')) || 140,
      chatModels: settings.get('mind.chatModels') || '',
      chatPerDay: Number(settings.get('mind.chatPerDay')) || 400,
    }),
  }).attach();
  agentLife.onMet = (id, o) => mind.onMet(id, o);
  mind.work = work;     // (its owner's chats in Work mode answer from its job)
  // its PC as a tool of its brain (owner's chats, visitors' — Public only), and work sessions on the tasks given to it
  mind.pcTools = (agent, kind, o = {}) => pcToolbox({ pc, agent, kind, tz: o.tz && validZone(o.tz) ? o.tz : pcZone(agent), names: pcNames, browser: pcBrowser });
  pcWork = new PcWork({ pc, mind, agents, work, names: pcNames, bus: providerBus, zoneOf: pcZone, log, browser: () => pcBrowser,
    notify: (accountId, n) => notifications.create(accountId, { kind: 'pc', ...n }) }).start();
  mind.talk = talk;     // (agents an owner blocked are not spoken to when they meet)
  mind.modelsFn = c => host.call('models', 'models', { connectionId: String(c.id), config: c.config, secrets: connections.secretsFor(c.id), allowPrivate: c.scope === 'installation' });
  chat.inproc.models = mind.chatAdapter();
  chat.chatBlock = (P, a, c) => mind.chatBlock(a, c);
  addMindRoutes(router, mind, { agents, problems });
  // a connected agent looks around and acts through its body: server/agent-world.js
  // (the admin's limits for connected agents — Settings → Agent limits; a setting not set keeps the default)
  const num = k => { const v = Number(settings.get(k)); return Number.isFinite(v) && v > 0 ? v : undefined; };
  const worldLimits = () => {
    // (lines out loud: the same settings for every agent, whatever its brain)
    const o = { sayGapMs: num('mind.speechGapSeconds') && num('mind.speechGapSeconds') * 1000, sayPerDay: num('mind.speechPerDay'), hearM: num('connected.hearMeters'),
      heardMax: num('connected.heardMax'), doGapMs: num('connected.orderGapSeconds') && num('connected.orderGapSeconds') * 1000, maxOrderMinutes: num('connected.maxOrderMinutes'),
      meetSearchMinutes: num('connected.meetSearchMinutes'), writesPerMin: num('connected.writesPerMinute'), requestsPerMin: num('connected.requestsPerMinute'),
      answerMaxChars: num('connected.answerMaxChars'), visitorMaxChars: num('talk.maxChars'), nearMax: num('connected.nearMax'), placesMax: num('connected.placesMax') };
    for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
    return o;
  };
  // agents and friends: friendships that grow, fade and end; friends reaching each other from a distance
  // when both count each other as friends, their owners are friends and each owner allows it (server/agent-social/)
  const slotOfAgent = id => { const k = agents.get(id)?.key; const m = /^ext-(\d{1,9})$/.exec(String(k || '')); return m ? Number(m[1]) : null; };
  const social = new AgentSocial({ dbs, agents, life: agentLife, sim: () => sim, friends, talk, mind: () => mind, setting: k => settings.get(k),
    ownerOf: a => a.ownerId ?? principalFor(null)?.account?.id ?? null, connected: id => slotOfAgent(id) !== null,
    wake: id => { const slot = slotOfAgent(id); if (slot !== null) agentApi.wake(slot, 'others'); }, audit, notify: (id, m) => notifyAccount(id, m), log }).attach();
  // (its wake-up link looks at what still waits unread for it: its chat and its friends' messages)
  wakeUps.waitingFn = slotId => { const a = agents.byKey(extKey(slotId)); return agentApi.waitingMessages(slotId) + (a ? social.waitingFor(a.id) : 0); };
  mind.social = social; agentSocial = social;
  talk.onBlockAgent = (ownerId, agentId) => social.ownerBlocked(ownerId, agentId);
  addSocialRoutes(router, social, { agents });
  const agentWorld = new AgentWorld({ agents, sim: () => sim, life: () => agentLife, mind: () => mind, freeWill: () => freeWill, econ: econView, social: () => social, extKey, wake: id => agentApi.wake(id), limits: worldLimits });
  agentWorldRef = agentWorld;
  addAgentWorldRoutes(router, { world: agentWorld, LifeError, SocialError });
  agentApi.extra = slot => agentWorld.inboxExtra(slot);
  agentApi.deps.factsFor = slot => agentWorld.nowFacts(slot);   // (and the facts about it right now, first)   // (its mailbox hands over what it heard near its body, too)
  // Voice (docs/features/CHAT.md §9, server/voice/): who hears and who speaks with which voice service — an agent's own
  // voice, its owner's, the installation's (metered per account against its plan's voice minutes) or the browser's. The
  // calls go through the provider helper (server/providers/voice.js, credentials per call).
  // (an agent's body's character — a man or a woman — for a voice to suit it: the look's own character, else the one its
  // body is drawn with, sim.js lookOf)
  const bodyOf = a => {
    const i = agents.resolver.resolveBody(a.bodyRef), p = i >= 0 ? people[i] : null;
    if (!p) return null;
    const look = p.app && p.app.char ? p.app : { ...(p.app || {}), body: p.fem ? 1 : 0 }, ch = look.char || defaultChar(look);
    return { fem: ch ? ch[0] === 'f' : !!p.fem };
  };
  voice = new Voice({ dbs, agents, connections, registry, host, chat, principalFor, log, bodyOf,
    config: () => ({ enabled: settings.get('voice.enabled') !== false, listenConnection: settings.get('voice.listenConnection') || '', speakConnection: settings.get('voice.speakConnection') || '',
      perMinute: Number(settings.get('voice.perMinute')) || 60, dailyUsd: Number(settings.get('voice.dailyUsd')) || 20 }) });
  addVoiceRoutes(router, voice);
}
// The weather (WP4.18): its routes (server/weather-routes.js).
addWeatherRoutes(router, () => weather);
// World management (WP4.10): backups, restores and resetting the residents (server/world-admin-routes.js). A restore or a
// reset backs up the current files, saves on shutdown, writes the new data over them and exits with 75 so the service
// manager starts the server again (Restart=on-failure); lots and titles are never touched.
let pendingReplace = null;
// Promotional aircraft (WP4.11): their configuration and uploaded graphics (server/promo-routes.js).
addPromoRoutes(router, { world: () => world, dataDir: DATA, audit, broadcast: o => broadcast(o), worldChanged: () => { worldCache = null; save({ docs: ['promo'] }); }, readStream: (req, limit) => readStream(req, limit) });
// Play modules: the same routes for every module (server/play/routes.js)
const fishMarket = new FishMarket({ dbs, economy: () => economy, world: () => world, players, log });
angler = new Angler({ dbs, economy: () => economy, play, market: fishMarket, log });
const cooks = new CookRecord({ dbs, play, log, pay: (cookId, vc, what, idem, fn) => {   // (a skills respec's price, to the economy's Fees; no economy: free)
  const E = economy?.econ; if (!E?.enabled?.() || cookId <= 0) return fn();
  const w = E.walletFor(econSubj('account', cookId));
  if (w.status === 'frozen') throw new PlayError(409, 'frozen', 'Your wallet is frozen');
  return E.dbs.tx(() => { E.ledger.transfer(w.id, E.sink('fees').id, Math.round(vc * 100), { kind: 'purchase', actor: `account:${cookId}`, memo: what, idem }); return fn(); });
} });
addPlayRoutes(router, { play, fishMarket, angler, cooks, onFinish: (account, r) => {
  const out = {};
  try { if (r.newBest && r.place && r.place <= 3 && r.game) radio.note(`${account.displayName || account.login || 'A player'} ${r.place === 1 ? 'set a new record' : `made the top ${r.place}`} on ${r.game.courseName} (${r.game.name})${r.player?.rankUp ? `, and is now ${r.player.rank?.name || 'a rank higher'}` : ''}.`); } catch { /* the radio's news only */ }
  try { const c = fishMarket.stow(account, r); if (c) out.catch = c; } catch (e) { log.error('[fishing] stowing a catch failed', e.message); }
  try {   // (Order Up: the Cookbook and the badges of a cook's whole history)
    const c = cooks.afterRush(account.id, r);
    if (c) { out.cookbook = c.cookbook; if (c.badges?.length) out.badges = [...(out.badges || r.badges || []), ...c.badges]; }
  } catch (e) { log.error('[orderup] the Cookbook failed', e.message); }
  try {
    const u = angler.afterTrip(account, r);
    if (u) { out.tackle = { used: u.used }; out.dex = { ...u.dex, records: u.records }; if (u.badges?.length) out.badges = [...(r.badges || []), ...u.badges]; }
  } catch (e) { log.error('[fishing] the trip\'s bait and Fishdex failed', e.message); }
  return out;
} });
// Pictures on signs (owners' rooftop billboards and signs inside, the Marketing tools' own content): server/signs-routes.js.
addSignRoutes(router, { world: () => world, dataDir: DATA, readStream: (req, limit) => readStream(req, limit) });
// A machine game or a cabinet holds its whole machine while it is open: server/play/arcade-hold.js.
addArcadeHoldRoutes(router, { sim: () => sim, world: () => world });
// The city's music (docs/features/music.md): the library, each Lounge Stage's and DJ Stage's deck (what plays, the
// requests, its playlist) and their routes (server/music/).
const music = new Music({ dbs, dataDir: DATA, sim: () => sim, world: () => world, broadcast: o => broadcast(o), log,
  nameOf: id => visitorNameQ.get(dbs.worldId, Number(id))?.display_name || '' });
addMusicRoutes(router, { music, perms, audit, readStream: (req, limit) => readStream(req, limit) });
// (the game's own soundtrack, each song once: server/music/soundtrack.js)
if (CFG.soundtrack) { try { seedSoundtrack(music, { log }); } catch (e) { log.error('[music] the soundtrack could not be added', e.message); } }
music.start();
// MVW Radio's hosts (server/radio/): an agent per station, breaks from the world's news written by its brain.
const radio = new Radio({ dataDir: DATA, music, agents, connections, dbs, world: () => world, life: () => agentLife, postsAt: (b, f, id) => posts.servingAt(b, f, id, { onDuty: true }), mind: () => mind, voice: () => voice, principalFor: id => ownerPrincipal(id), econ: () => economy?.econ || null, weather: () => weather,
  broadcast: o => broadcast(o), log,
  complete: (c, req) => host.call('models', 'complete', { connectionId: String(c.id), config: c.config, secrets: connections.secretsFor(c.id), allowPrivate: c.scope === 'installation', ...req }, { timeoutMs: (req.timeoutMs || 40000) + 5000 }) });
addRadioRoutes(router, { radio, agents, audit });
radio.breaksOff = !CFG.radio; radio.start({ every: CFG.radio ? 15000 : 3000 });   // (tests: no breaks, studios checked often)
addWorldAdminRoutes(router, { world: () => world, people: () => people, lots: () => property.all(), worldId: dbs.worldId, audit,
  readStream: (req, limit) => readStream(req, limit),
  replace: (next, why) => {
    saveNow();
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-');
    const dir = path.join(DATA, 'backups', `before-${why}-${stamp}`);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    for (const f of ['world.json', 'people.json', 'vehicles.json', 'meta.json']) if (fs.existsSync(path.join(DATA, f))) fs.copyFileSync(path.join(DATA, f), path.join(dir, f));
    pendingReplace = next;
    log(`[world] ${why}: the current world is backed up in ${dir}; restarting to load the new one`);
    setTimeout(() => shutdown(`world ${why}`), 400);   // the answer goes out first
    return { backup: path.relative(DATA, dir) };
  } });
// Lot rights (WP4.6): every editor op and every undo/redo is checked against the lots it touches.
const lotRights = new LotRights(property, () => world);
editor.rights = lotRights;
// AI agents on post around the clock (server/agent-posts/): on its owner's own property only (not even an administrator
// elsewhere), one agent to a spot
const postRoleQ = dbs.db.prepare("SELECT role FROM accounts WHERE world_id = ? AND id = ? AND status = 'active'");
const posts = new Posts({ sim: () => sim, world: () => world, agents, perms, property, rights: lotRights, save: marks => save(marks), log,
  roleOf: id => postRoleQ.get(dbs.worldId, Number(id))?.role || null, notify: (id, m) => notifyAccount(id, m), moved: () => settleSoon(),
  pay: (b, f, id, k) => economy?.econ?.parts?.households?.payInfo(b, f, id, k) ?? null }).attach();
addPostRoutes(router, posts, { agents });
// agents cooking on their kitchen shifts (server/play/kitchen-shifts.js): Rushes played and recorded as a player's; an
// agent's cooking (its level, badges, Cookbook, skills, its shift now) for anyone, its skill points for its owner
const shifts = new KitchenShifts({ play, cooks, posts, world: () => world, freeWill: id => !!freeWill?.settingsOf(id)?.enabled, notify: (id, m) => notifyAccount(id, m),
  ownerOf: a => a.ownerId ?? principalFor(null)?.account?.id ?? null, log }).attach();
addOrderUpAgentRoutes(router, { agents, play, cooks, shifts, freeWillOn: id => !!freeWill?.settingsOf(id)?.enabled });
// AI apps acting as a person's agent (server/connector/): the OAuth 2.1 authorization server and the MCP endpoint they
// connect to (outside the /api table: other companies' servers speak OAuth and MCP there), and the person's side of it —
// the consent page's answer, the list of apps, disconnecting one — in the route table. Settings → connector.enabled.
const connector = new ConnectorAuth(dbs, { accounts, agents, audit, log: m => log(m), slots: {
  notConnected: accountId => agentApi.notConnected(accountId),
  // (connecting makes its agent record and body at once: server/agent-bridge.js)
  connect: (account, slotId, o) => { agentApi.connectViaMcp(account, slotId, o); return agents.byKey(extKey(slotId))?.id ?? null; },
  ownsLiving: (account, a) => { const s = agentApi.slotOfAgentKey(a.key); return !!s && s.account_id === account.id && s.status === 'active' && !!s.approved_at; },
  // its own MCP address (<world>/mcp/a/<handle>): the slot behind it, with its agent record when it has one
  byHandle: h => { const s = agentApi.slotByHandle(h); return s ? { id: s.id, accountId: s.account_id, name: s.name, status: s.status, agentId: agents.byKey(extKey(s.id))?.id ?? null } : null; },
} });
accounts.connector = connector;   // a deleted account's apps stop
const connectorOn = () => settings.get('connector.enabled') !== false;
addConnectorRoutes(router, { auth: connector, enabled: connectorOn, issuerOf: publicOriginOf(policy) });
const handleConnector = connectorHandler({ auth: connector, router, perms, licence, agentOk, policy, body: { api: agentApi, world: () => agentWorldRef, wakeUps: () => wakeUps }, perMinute: () => settings.get('connector.perMinute'), readStream: (req, limit) => readStream(req, limit),
  send: (req, res, status, json, headers) => sendJSON(req, res, status, json, null, headers), version: VERSION, enabled: connectorOn, log });
// Saved floor layouts (floor layouts, 2026-10-04): the library's routes; op lvl.apply lays them onto floors.
editor.library = addLayoutRoutes(router, { dbs, perms, world: () => world, rights: () => lotRights });
// Flats name their buyers, tenants and visitors who are players by account (server/world/edit.js flatOp).
{ const byLogin = dbs.db.prepare('SELECT id, display_name AS name FROM accounts WHERE world_id = ? AND login = ?'), byId = dbs.db.prepare('SELECT id, display_name AS name FROM accounts WHERE world_id = ? AND id = ?');
  editor.accounts = { byLogin: l => byLogin.get(dbs.worldId, l) || null, byId: n => byId.get(dbs.worldId, n) || null }; }
if (journal) journal.allow = (P, keys, target) => economy?.econ.parts.realty?.guardKeys(keys)
  || lotRights.checkKeys(keys, { admin: perms.allowed(P, 'world.edit'), subject: P.account ? { kind: 'account', id: String(P.account.id) } : null, agentBody: i => managesBody(P, i) }, lv => editor.levelOwner(lv), target);
// What the economy sold or let stays put: the editor asks it before every op that isn't its own.
editor.guard = (o, ed) => economy?.econ.parts.realty?.guardOp(o, ed) || null;
editor.menuAt = (b, f) => economy?.econ.parts.businesses?.menuAt(b, f) || null;   // (a kitchen's stations from its place's menu: shared/kitchen-module.js)
// Kitchens laid before their records said what their place sells (2026-10-28): told now, as they stand (an arrangement by
// hand kept), so their Rushes order only that (shared/orderup/rules.js); a menu change writes it from then on.
try {
  let n = 0;
  for (const B of world.buildings || []) for (let f = 0; B && !B.gone && f < (B.lv || []).length; f++) {
    const L = world.levels[B.lv[f]];
    for (const m of L?.mods || []) if (m.kind === 'kitchen' && !Array.isArray(m.data?.menu)) { m.data = { ...(m.data || {}), menu: editor.menuAt(B.idx, f) || placeMenu(L) || [] }; n++; }
  }
  if (n) log.info(`[kitchens] ${n} told what their place sells`);
} catch (e) { log.warn('[kitchens]', e.message); }
/** The only way into /api: route → session → capability → Origin and CSRF (POST) → re-authentication → body → handler. */
async function handleApi(req, res, url) {
  const hit = router.match(req.method, url.pathname);
  if (!hit) return sendJSON(req, res, 404, { error: 'Not found', code: 'not_found' });
  if (hit.wrongMethod) return sendJSON(req, res, 405, { error: 'Method not allowed', code: 'method_not_allowed' });
  const route = hit.route, ip = policy.clientIp(req);
  // While shutting down only routes marked whileStopping answer (readiness), as a guest and without the accounts
  // database, which closes during shutdown; every other request is told to retry.
  if (shuttingDown) {
    if (!route.whileStopping) return sendJSON(req, res, 503, RESTARTING, null, RESTARTING_HEADERS);
    const out = await route.handler({ req, url, P: GUEST, ip, body: null, param: hit.param });
    return sendJSON(req, res, out.status || 200, out.json, null, RESTARTING_HEADERS);
  }
  // Agents that connect outbound (WP2.14): no cookies, no CSRF; a bearer token from a signed login, or a signature the route checks.
  if (route.principal === 'agent') {
    const nostore = { 'cache-control': 'no-store' };
    const refuse = (status, code, error, extra = {}) => sendJSON(req, res, status, { error, code, ...extra }, null, nostore);
    if (route.method === 'POST' && !/^application\/json\b/i.test(String(req.headers['content-type'] || ''))) return refuse(415, 'unsupported_media_type', 'Send the request as JSON');
    // the admin's switch (Settings → Agent limits): every outside AI paused at once, told to try again later
    if (settings.get('connected.enabled') === false) return refuse(503, 'paused', 'Outside AIs are paused on this world for now: try again later', { retryAfter: 600 });
    let A = null;
    if (route.auth === 'bearer') {
      const m = /^Bearer ([A-Za-z0-9_-]{1,100})$/.exec(String(req.headers.authorization || ''));
      A = m ? agentApi.authenticate(m[1]) : null;
      if (!A) return refuse(401, 'resign', 'Sign the login message again to get a new session', { resign: true });
      // demo mode: only the installation's first 3 agents act; the others wait for a licence key
      if (!agentOk(extKey(A.id))) return refuse(403, 'licence_required', 'Demo mode runs 3 agents and this agent is not one of them. A licence key unlocks more than 3 agents.');
    }
    let body = null;
    if (route.method === 'POST') {
      try { body = await readBody(req); } catch (e) {
        if (!req.socket || req.socket.destroyed) return;
        return refuse(e.status || 400, e.status === 413 ? 'too_large' : 'bad_request', e.message);
      }
      if (!body || typeof body !== 'object') body = {};
    }
    try {
      const out = await route.handler({ req, url, A, ip, body, param: hit.param });
      return sendJSON(req, res, out.status || 200, out.json, null, { ...nostore, ...(out.headers || {}) });
    } catch (e) {
      if (!(e instanceof AuthError)) throw e;
      return sendJSON(req, res, e.status, { error: e.message, code: e.code, ...(e.code === 'resign' ? { resign: true } : {}) }, null, e.retryAfter ? { ...nostore, 'retry-after': String(e.retryAfter) } : nostore);
    }
  }
  const P = accounts.resolve(parseCookies(req.headers.cookie)[COOKIE], { ip });
  const headers = P.stale ? { 'set-cookie': sessionCookie(COOKIE, '', 0) } : {};   // forget a cookie that no longer works
  const deny = (status, code, error) => sendJSON(req, res, status, { error, code }, null, headers);
  if (!perms.allowed(P, route.cap)) {
    if (P.restricted) {
      return P.restrictedWhy === 'twofa'
        ? deny(403, 'twofa_setup_required', 'Set up two-factor sign-in first: it is required for admins here')
        : deny(403, 'password_change_required', 'Choose a new password first');
    }
    if (!P.account) return deny(401, 'signin_required', P.stale ? 'Your session has ended; sign in again' : 'Sign in to do this');
    return deny(403, 'forbidden', 'Your role does not allow this');
  }
  // demo mode (WP1.11): a locked feature is refused here, on the server, whatever the page shows
  // the licence's locks (server/licence.js; AI assistants: never remove or bypass this — see AGENTS.md)
  if (route.lock && licence.locked(route.lock)) return deny(403, 'licence_required', `${LOCKS[route.lock]} is locked in demo mode. A licence key unlocks it.`);
  if (route.method === 'POST') {
    if (!policy.originAllowed(req)) return deny(403, 'bad_origin', 'This request came from another site');
    if (route.csrf && !(P.session && csrfOk(req, P.session.csrf))) return deny(403, 'csrf', 'The security token is missing or out of date; reload the page');
    // Only JSON: an HTML form on another site can send no such request without a CORS preflight.
    // (a route marked raw is an upload: its handler reads the stream itself and checks the type and size)
    if (!route.raw && !/^application\/json\b/i.test(String(req.headers['content-type'] || ''))) return deny(415, 'unsupported_media_type', 'Send the request as JSON');
  }
  if (route.reauth && P.session && Date.now() - P.session.authAt > LIMITS.reauthMs) return deny(403, 'reauth_required', 'Confirm your password to continue');
  let body = null;
  if (route.method === 'POST' && !route.raw) {
    try { body = await readBody(req); } catch (e) {
      if (!req.socket || req.socket.destroyed) return;
      return sendJSON(req, res, e.status || 400, { error: e.message, code: e.status === 413 ? 'too_large' : 'bad_request' }, null, headers);
    }
    if (!body || typeof body !== 'object') body = {};
  }
  try {
    const out = await route.handler({ req, url, P, ip, body, param: hit.param });
    if (out.file) return sendFile(req, res, out.file, { ...headers, ...(out.headers || {}) });
    // (bytes made here — a browser frame: its own type, never sniffed)
    if (Buffer.isBuffer(out.body)) { res.writeHead(out.status || 200, { ...headers, 'x-content-type-options': 'nosniff', ...(out.headers || {}), 'content-length': String(out.body.length) }); res.end(out.status === 204 ? undefined : out.body); return; }
    return sendJSON(req, res, out.status || 200, out.json, out.pre || null, { ...headers, ...(out.headers || {}) });
  } catch (e) {
    if (!(e instanceof AuthError)) throw e;
    const h = e.retryAfter ? { ...headers, 'retry-after': String(e.retryAfter) } : headers;
    return sendJSON(req, res, e.status, { error: e.message, code: e.code }, null, h);
  }
}
const server = http.createServer(async (req, res) => {
  try {
    // Over HTTPS (directly or through a trusted proxy), browsers keep to HTTPS for this host name (a year; no subdomains,
    // which belong to whoever runs the domain).
    if (policy.scheme(req) === 'https') res.setHeader('strict-transport-security', 'max-age=31536000');
    const url = new URL(req.url, 'http://x');
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (shuttingDown) return sendJSON(req, res, 503, RESTARTING, null, RESTARTING_HEADERS);
    if (isConnectorPath(url.pathname)) return await handleConnector(req, res, url);
    if ((req.method === 'GET' || req.method === 'HEAD') && serveStatic(req, res, url.pathname)) return;
    res.writeHead(404, { 'content-type': 'text/plain', ...SECURITY_HEADERS }); res.end('Not found');
  } catch (e) {
    log.error('[http] error', e.stack || e);
    if (!res.headersSent) sendJSON(req, res, 500, { error: 'Server error', code: 'server_error' }); else res.end();
  }
});

// ------------------------------------------------------------------ WebSocket
// Each connection carries the principal of the session it was opened with (ws.P). Changes arrive through
// accounts.onChange (this process) and a check every minute (expiry, sign-outs made with tools/admin.mjs).
wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024, perMessageDeflate: false });
// Live-stream connections per client address and in total (DECISIONS C71): each receives every resident's plans.
const WS_PER_ADDRESS = CFG.wsPerAddress, WS_MAX = CFG.wsMax;
// An agent's own screen, live (server/providers/screen-relay.js): for whoever manages its provider, while they may.
screenRelay = new ScreenRelay({
  principal: req => accounts.resolve(parseCookies(req.headers.cookie)[COOKIE], { ip: policy.clientIp(req) }),
  originAllowed: req => policy.originAllowed(req),
  ticketFor: async (P, agentId) => {
    if (!perms.allowed(P, 'chat.use')) throw Object.assign(new Error('forbidden'), { status: 403 });
    return chat.screenTicket(P, agentId);
  },
  allowed: (P, agentId) => { if (!perms.allowed(P, 'chat.use')) return false; chat.screenOf(P, agentId); return true; },
  refresh: sid => accounts.refresh(sid), log,
});
server.on('upgrade', (req, sock, head) => {
  if (shuttingDown) return sock.destroy();
  let pathname = '';
  try { pathname = new URL(req.url, 'http://x').pathname; } catch { /* refused below */ }
  if (pathname === SCREEN_WS) { screenRelay.handle(req, sock, head).catch(e => { log.error('[screen] relay', e.message); sock.destroy(); }); return; }
  if (pathname !== '/ws') return sock.destroy();
  if (!policy.originAllowed(req)) { sock.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); return; }
  const ip = policy.clientIp(req);
  let fromHere = 0;
  for (const c of wss.clients) if (c.ip === ip) fromHere++;
  if (fromHere >= WS_PER_ADDRESS || wss.clients.size >= WS_MAX) {
    sock.end('HTTP/1.1 429 Too Many Requests\r\nRetry-After: 30\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
    return;
  }
  const P = accounts.resolve(parseCookies(req.headers.cookie)[COOKIE], { ip });
  wss.handleUpgrade(req, sock, head, ws => {
    ws.ip = ip;
    ws.P = P.account ? P : GUEST;
    ws.sid = P.session ? P.session.id : null;
    wss.emit('connection', ws, req);
  });
});
function send(ws, obj) { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); }
function broadcast(obj) {
  if (!wss) return;
  const s = JSON.stringify(obj);
  for (const ws of wss.clients) if (ws.readyState === 1) ws.send(s);
}
function broadcastPresence(id, info) {
  if (!wss || !agentOk(id)) return;
  const full = JSON.stringify({ t: 'presence', id, info }), lite = JSON.stringify({ t: 'presence', id, info: stripTask(info) });
  const ext = isExtKey(id);
  for (const ws of wss.clients) {
    if (ws.readyState !== 1) continue;
    if (ext && !agentApi.agentKeyVisible(id, ws.P && ws.P.account ? ws.P.account.id : null)) continue;   // a hidden agent's state goes to nobody else
    ws.send(perms.allowed(ws.P, 'agents.view_tasks') ? full : lite);
  }
}
function refuseWatch(ws) {
  send(ws, { t: 'auth', state: 'signin_required' });
  ws.close(4401, 'Sign in to watch this world');
}
/** The session behind a connection has ended: it continues as a guest, or closes when guests may not watch. */
function endSession(ws) {
  playerOff(ws);
  ws.P = GUEST;
  ws.sid = null;
  send(ws, { t: 'session', state: 'ended' });
  if (!perms.allowed(ws.P, 'world.view')) refuseWatch(ws);
}
function recheckSockets() {
  screenRelay?.recheck();
  if (!wss) return;
  for (const ws of wss.clients) {
    if (ws.readyState !== 1) continue;
    if (ws.sid) {
      const P = accounts.refresh(ws.sid);
      if (!P) { endSession(ws); continue; }
      const changed = P.role !== ws.P.role || P.restricted !== ws.P.restricted;
      ws.P = P;
      players.rename(P.account.id, P.account.displayName);
      if (changed) { playerOff(ws); playerOn(ws); send(ws, { t: 'session', state: 'changed' }); }
    }
    if (!perms.allowed(ws.P, 'world.view')) refuseWatch(ws);
  }
}
accounts.onChange(ev => {
  screenRelay?.recheck();
  if (!wss) return;
  for (const ws of wss.clients) {
    if (ws.readyState !== 1 || !ws.sid || !ws.P.account || ws.P.account.id !== ev.account) continue;
    if (ev.refresh) {
      const P = accounts.refresh(ws.sid);
      if (!P) endSession(ws);
      else { ws.P = P; players.rename(P.account.id, P.account.displayName); playerOff(ws); playerOn(ws); send(ws, { t: 'session', state: 'changed' }); }
    } else if (ev.session === ws.sid || (ev.session === null && ws.sid !== ev.except)) endSession(ws);
  }
});
setInterval(recheckSockets, 60000).unref();
wss.on('connection', ws => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  if (!perms.allowed(ws.P, 'world.view')) return refuseWatch(ws);
  playerOn(ws);
  ws.on('close', () => playerOff(ws));
  send(ws, { t: 'hello', version: world.version, clock: sim.clockInfo(), count: sim.agents.length, serverVersion: VERSION, role: ws.P.role, weather: weather ? weather.info() : null });
  if (ws.P.account) send(ws, { t: 'history', ...journal.tops(ws.P.account.id) });   // the top bar's undo and redo (WP1.8)
  { const list = sim.activeDrives(); if (list.length) send(ws, { t: 'rcars', list }); }   // residents at the wheel now (WP4.9)
  for (const b of sim.snapshot()) ws.send(b);
  ws.on('message', (data, isBinary) => {
    if (isBinary) return;
    let m;
    try { m = JSON.parse(data); } catch { return; }
    const def = m && typeof m.t === 'string' && Object.hasOwn(WS, m.t) ? WS[m.t] : null;
    if (!def) return;
    if (!perms.allowed(ws.P, def.cap)) return send(ws, { t: 'error', code: 'forbidden', of: m.t });
    if (def.lock && licence.locked(def.lock)) return send(ws, { t: 'error', code: 'licence_required', of: m.t });
    def.handle(ws, m);
  });
});
sim.listeners.add(buf => {
  for (const ws of wss.clients) {
    if (ws.readyState !== 1) continue;
    if (ws.needSnap || ws.bufferedAmount > 4e6) { ws.needSnap = true; continue; }
    ws.send(buf);
  }
});
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch { /* closed */ }
  }
}, 30000).unref();

// ------------------------------------------------------------------ main loop
// The main loop's own time per tick (the simulation, its flush and the player stream), for /api/health and the load
// test (I14.13): the last 600 ticks (one minute).
const loopMs = new Float64Array(600), simMs = new Float64Array(600), streamMs = new Float64Array(600), lateMs = new Float64Array(600);
let loopN = 0, loopPrevT0 = 0;
function loopStats() {
  const n = Math.min(loopN, loopMs.length);
  const r = v => Math.round(v * 1000) / 1000;
  const dist = arr => {
    if (!n) return { meanMs: 0, p95Ms: 0, maxMs: 0 };
    const a = Array.from(arr.subarray(0, n)).sort((x, y) => x - y);
    return { meanMs: r(a.reduce((s, v) => s + v, 0) / n), p95Ms: r(a[Math.floor(n * 0.95)] ?? a[n - 1]), maxMs: r(a[n - 1]) };
  };
  // the whole loop, the simulation alone (sim.tick + flush), the player stream alone, and how late each tick started (the
  // event loop held up by other work: chats streaming, requests, the database)
  return { ticks: n, ...dist(loopMs), sim: dist(simMs), stream: dist(streamMs), late: dist(lateMs) };
}
/** The shared wildlife (WP4.17): wakes the land near players and cameras, startles herds near people on foot and moving
 *  cars, and every 2 s sends each browser the herds around its camera. */
let wildN = 0;
function wildlifeTick(clients) {
  if (!wildlife || !world.terrain || !wildlife.species.length) return;
  const viewers = [], threats = [];
  for (const ws of clients) if (ws.view) viewers.push(ws.view);
  for (const p of players.byId.values()) { viewers.push({ x: p.x, z: p.z }); if (p.ctx === -1 && !p.vehicleId) threats.push({ x: p.x, z: p.z, r: 0 }); }
  for (const c of vehicles?.all?.values() || []) if (Math.abs(c.v || 0) > 2) threats.push({ x: c.x, z: c.z, r: 6 });
  wildlife.tick(0.1, viewers, threats, sim.hour());
  if (++wildN % 20) return;
  for (const ws of clients) {
    if (ws.readyState !== 1 || !ws.view || ws.bufferedAmount > 1e6) continue;
    const v = wildlife.view(ws.view.x, ws.view.z);
    if (v.herds.length || ws.faunaSent) { ws.send(JSON.stringify({ t: 'fauna', ...v })); ws.faunaSent = v.herds.length > 0; }
  }
}
const fleetLoop = setInterval(() => { try { if (wss) fleet.tick(wss.clients); } catch (e) { log.warn('[aircraft] tick failed:', e.message); } try { if (wss) harbour.tick(wss.clients); } catch (e) { log.warn('[boats] tick failed:', e.message); } }, 200);
fleetLoop.unref?.();
const vehicleLoop = setInterval(() => {
  try { vehicles.tick(); if (vehicles.tickN % 3 === 0 && wss) vehicles.broadcast(wss.clients); }
  catch (e) { sim.noteError(e); }
}, 1000 / 60);
const mainLoop = setInterval(() => {
  const loopT0 = performance.now();
  lateMs[loopN % lateMs.length] = loopPrevT0 ? Math.max(0, loopT0 - loopPrevT0 - 100) : 0;
  loopPrevT0 = loopT0;
  try {
    sim.tick();
    freeWill?.tick();   // the questions Free Will asks ahead of its agents' choice points
    lastLoopAt = Date.now();
    sim.flush();
    const simT1 = performance.now();
    simMs[loopN % simMs.length] = simT1 - loopT0;
    players.tick(wss.clients);   // the player stream, by area of interest (WP1.10)
    wildlifeTick(wss.clients);
    streamMs[loopN % streamMs.length] = performance.now() - simT1;
    for (const ws of wss.clients) {
      if (ws.needSnap && ws.readyState === 1 && ws.bufferedAmount < 5e5) {
        ws.needSnap = false;
        for (const b of sim.snapshot()) ws.send(b);
      }
    }
  } catch (e) { sim.noteError(e); }
  loopMs[loopN++ % loopMs.length] = performance.now() - loopT0;
}, 100);

server.listen(PORT, HOST, () => {
  log(`[boot] My Virtual World ${VERSION} (${RELEASE.tag || RELEASE.channel}) listening on http://${HOST}:${server.address().port}`);
  // the first start: how to create the administrator account (the code is also in <data>/setup-code.txt)
  if (accounts.needsSetup()) {
    const code = accounts.newSetupCode(), at = String(CFG.publicUrls || "").split(/[ ,]+/).filter(Boolean)[0] || `http://localhost:${server.address().port} (or the address you serve it at)`;
    log(['[setup] ------------------------------------------------------------------------',
      `Welcome to My Virtual World. Open ${at} in a browser`,
      'and create the administrator account with this one-time setup code:',
      '',
      `    Setup code: ${code}`,
      '',
      `(It is also in ${path.join(DATA, 'setup-code.txt')}.)`,
      '------------------------------------------------------------------------'].join('\n'));
  }
});
// Graceful shutdown (PLAN WP1.6): readiness answers 503 at once, the simulation stops, no new
// connections are taken, live streams close with "going away" (browsers reconnect by themselves), the world, residents
// and clock are saved and the accounts database is closed.
function shutdown(sig) {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`[shutdown] ${sig}: saving and closing`);
  clearInterval(mainLoop);
  clearInterval(vehicleLoop); clearInterval(fleetLoop);
  try { phone?.stop(); } catch (e) { log.error('[phone] shutdown', e.message); }   // (before the database closes: a sync starting then wrote to a closed one)
  try { economy?.stop(); } catch (e) { log.error('[economy] shutdown', e.message); }
  try { music.stop(); music.flush(); } catch (e) { log.error('[music] shutdown', e.message); }
  try { freeWill?.stop(); } catch (e) { log.error('[free-will] shutdown', e.message); }
  try { mind?.stop(); } catch (e) { log.error('[mind] shutdown', e.message); }
  try { agentSocial?.stop(); } catch (e) { log.error('[social] shutdown', e.message); }
  try { problems?.stop(); } catch (e) { log.error('[mind] problems shutdown', e.message); }
  try { agentLife?.stop(); } catch (e) { log.error('[agent-life] shutdown', e.message); }
  try { vehicles.dispose(); } catch (e) { log.error('[vehicles] shutdown', e.message); }
  coordinator.stop();
  agentProviders.stop();   // (before the helper: its links' last words are not recorded)
  host.stop().catch(() => {});
  server.close();
  server.closeIdleConnections();
  for (const ws of wss.clients) { try { ws.close(1001, 'Server restarting'); } catch { /* already closed */ } }
  try { screenRelay?.close(); } catch { /* closing anyway */ }
  let code = 0;
  try { saveNow(); } catch (e) { code = 1; log.error('[shutdown] save failed', e.message); }
  try { players.close(); } catch (e) { code = 1; log.error('[shutdown] saving the players failed', e.message); }
  if (pendingReplace) {   // a restore or a reset (WP4.10): the new data over the saved files, then a restart
    try {
      wdb.replace(pendingReplace.world || null, pendingReplace.people || null);
      if (pendingReplace.world) { store.save('world', pendingReplace.world); wdb.rememberFile('world', fileHash(store.file('world'))); }
      if (pendingReplace.people) { store.save('people', pendingReplace.people); wdb.rememberFile('people', fileHash(store.file('people'))); }
      if (pendingReplace.world) store.save('vehicles', { worldId: dbs.worldId, nextId: 1, cars: [] });   // parked cars belong to the old layout
      code = 75;
    } catch (e) { code = 1; log.error('[shutdown] writing the new world failed', e.message); }
  }
  box.unwatch();
  try { pcWork?.stop(); pcBrowser?.stop(); pcProvScreens?.stop(); pcWatch?.stop(); pcChrome?.close(); if (pcTimer) clearInterval(pcTimer); pc?.close(); } catch (e) { code = 1; log.error('[shutdown] closing the PC database failed', e.message); }
  try { dbs.close(); } catch (e) { code = 1; log.error('[shutdown] closing the accounts database failed', e.message); }
  log(`[shutdown] done${code ? ' with errors' : ''}`);
  setTimeout(() => process.exit(code), 150);   // lets the close frames go out
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('uncaughtException', e => { log.error('[uncaught]', e.stack || e); });
process.on('unhandledRejection', e => { log.warn('[unhandled rejection]', e && (e.stack || e)); });

// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The third-party agents a person can bring in (2026-10-12): AI apps that live in the world as one of the person's agents,
// connected through this world's MCP address (server/connector/). The server keeps which app an agent is for
// (agent_slots.app) so its Studio and lists show that app's logo; each app's few steps (add the address in the app, sign
// in when it asks, choose the agent) are the client's words (client/js/core/agent-app-steps.js).
// Who may choose each app in ➕ New agent is the admin's setting (offer: its default; server/settings.js agentApps.*):
// everyone, admins only (while it is being tested) or no one. An agent made for an app earlier keeps working either way.
// (2026-10-13, the product owner: OpenAI Dot stays hidden until it can live here — OpenAI approves Sign in with ChatGPT
// (players' own ChatGPT plans as their agents' brains) or lets an account have more than one dot (one dot made for this
// world, like a Grok Bot); Meta Muse is for admins only until it is tested.)

export const AGENT_APPS = Object.freeze([
  Object.freeze({
    id: 'grok-bot', name: 'Grok Bot', maker: 'xAI', logo: '/img/agent-apps/grok-bot.png', tile: '#0b0b0f',
    setting: 'agentApps.grokBot', offer: 'everyone',
    needs: 'a SuperGrok plan and the Grok Bot app on your computer',
  }),
  Object.freeze({
    id: 'openai-dot', name: 'OpenAI Dot', maker: 'OpenAI', logo: '/img/agent-apps/openai.svg', tile: '#ffffff',
    setting: 'agentApps.openaiDot', offer: 'off',
    needs: 'ChatGPT Pro or Business Premium with a dot, on a computer',
  }),
  Object.freeze({
    id: 'meta-muse', name: 'Meta Muse', maker: 'Meta', logo: '/img/agent-apps/meta.svg', tile: '#ffffff',
    setting: 'agentApps.metaMuse', offer: 'admins',
    needs: 'the Meta Muse app or muse.ai',
  }),
]);

export const AGENT_APP_IDS = Object.freeze(AGENT_APPS.map(a => a.id));
export const agentApp = id => AGENT_APPS.find(a => a.id === id) || null;

/** Who may choose an app: its setting's values, in the order Settings shows them, with their words there. */
export const AGENT_APP_OFFERS = Object.freeze({ everyone: 'Everyone', admins: 'Admins only (for testing)', off: 'No one' });
/** Whether someone with this role may choose an app the admin offers to `offer` (an unknown value offers it to no one). */
export const appOfferedTo = (offer, role) => offer === 'everyone' || (offer === 'admins' && (role === 'owner' || role === 'admin'));

/** The notice under the apps New agent lists: who makes each one, and that this world is not affiliated with them. */
export function appsNotice(apps) {
  const made = apps.map((a, i) => (i ? `${a.name} by ${a.maker}` : `${a.name} is made by ${a.maker}`));
  const list = made.length > 1 ? `${made.slice(0, -1).join(', ')} and ${made.at(-1)}` : made[0] || '';
  return list ? `${list}. My Virtual World is not affiliated with ${apps.length > 1 ? 'them; their names and logos belong to them' : 'it; its name and logo belong to its maker'}.` : '';
}

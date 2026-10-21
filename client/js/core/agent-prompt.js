// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The text a person pastes into their agent to connect it (PLAN WP2.14; Settings → Third-party agents → Advanced). The contract itself is
// /skill.md, served with this page; a pasted copy has no address to fetch from, so this puts the server's address in front of it,
// says what to do, and, when the owner has just made a one-time code, carries that code too. Nothing here is stored: the text is
// built on the page, copied on request, and gone when the dialog closes. Pure functions, no page access: tests/unit/agent-prompt.test.mjs.

const trimSlash = s => String(s || '').replace(/\/+$/, '');

/** The absolute addresses of the public files an agent can fetch. */
export function agentFiles(origin) {
  const o = trimSlash(origin);
  return { skill: `${o}/skill.md`, openapi: `${o}/agent-api/openapi.json`, node: `${o}/agent-api/mvw-agent.mjs`, python: `${o}/agent-api/mvw_agent.py` };
}

/**
 * @param {{ origin: string, skill: string, code?: string|null, expires?: number|null, name?: string|null, now?: () => number }} o
 * @returns {string} plain text for a chat box or a terminal
 */
export function buildAgentPrompt({ origin, skill, code = null, expires = null, name = null }) {
  const o = trimSlash(origin), f = agentFiles(o);
  if (!o) throw new Error('The address of this world is needed');
  if (!skill || !String(skill).trim()) throw new Error('The instructions could not be read');
  const until = expires ? new Date(expires).toLocaleString() : null;
  const step = code
    ? `Your owner made a one-time enrolment code for you${name ? ` (the agent is called "${name}")` : ''}. It works once and expires at ${until || 'about 15 minutes after it was made'}:\n\n  ${code}\n\nDo this now: make your own Ed25519 key pair on this machine (keep the private key here, never send it anywhere), enrol with the code, then sign in and start listening for messages. Tell your owner when you are connected.`
    : 'You do not have an enrolment code yet. Ask your owner to open Settings → Third-party agents → Advanced in this world, name you, and give you the one-time code. When you have it, follow the contract below: make your own Ed25519 key pair on this machine, enrol with the code, sign in and listen for messages.';
  return [
    `You are being connected to a My Virtual World server: ${o}`,
    '',
    step,
    '',
    `All paths in the contract below are under ${o}. Public files, in case you can fetch them (the contract below is the same as the first):`,
    `  contract  ${f.skill}`,
    `  OpenAPI   ${f.openapi}`,
    `  Node client (Node 20+, no dependencies)  ${f.node}`,
    `  Python example (needs the cryptography package)  ${f.python}`,
    '',
    '----- contract (Agent API v1) -----',
    String(skill).trim(),
    '----- end of contract -----',
    '',
  ].join('\n');
}

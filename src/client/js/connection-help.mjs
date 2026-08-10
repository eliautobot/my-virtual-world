const PROVIDER_ALIASES = {
  claudeCode: 'claude-code',
  openCode: 'opencode',
};

const CLI_WINDOWS_NOTE = 'A Windows executable cannot run inside the Linux Virtual World container. Mount and use a Linux CLI, run the provider in a Linux sidecar, or leave this provider disabled until a supported network bridge is available.';

export const PROVIDER_CONNECTION_GUIDES = Object.freeze({
  openclaw: {
    name: 'OpenClaw',
    summary: 'OpenClaw connects through its Gateway WebSocket and a mounted OpenClaw home directory.',
    expectedDefault: 'Docker host · ws://host.docker.internal:18789 · OpenClaw home mounted at /openclaw',
    linux: 'Run the OpenClaw Gateway on the Docker host (or another reachable service), mount the Linux OpenClaw home at /openclaw, select Docker host or Auto-detect, and use ws://host.docker.internal:18789. Use Container local only when the Gateway really runs inside this container.',
    windows: 'Run OpenClaw and its Gateway natively on Windows, mount the Windows OpenClaw home into the container at /openclaw, select Docker host or Auto-detect, and use ws://host.docker.internal:18789. The Gateway port must be reachable from Docker Desktop.',
    requirements: 'The mounted home must contain openclaw.json. Test connection must complete an authenticated Gateway health request. Supply the Gateway token when authentication is enabled.',
    defaults: {
      homePath: '/openclaw', endpointMode: 'Auto-detect', gatewayUrl: 'ws://host.docker.internal:18789',
      gatewayHttp: 'Derived from the active Gateway', gatewayToken: 'Blank unless Gateway authentication requires it',
    },
  },
  hermes: {
    name: 'Hermes',
    summary: 'Hermes uses its authenticated API for runtime work and can independently use a mounted profile directory for allowlisted files and skill contents.',
    expectedDefault: 'Hermes API · matching API_SERVER_KEY · shared Hermes data mounted at /home/vw/.hermes',
    linux: 'For separate containers, keep Hermes and My Virtual World on one private Docker network, connect to http://hermes:8642, and mount the same Hermes data directory into both containers. The CLI is optional: API runtime plus mounted resources does not require a second Hermes executable in My Virtual World.',
    windows: 'The recommended Docker Desktop setup runs Hermes in its own Linux container, connects over the private Compose network, and shares the same bind-mounted Hermes data directory. A Windows-host API remains supported through http://host.docker.internal:8642, but Windows executables cannot run inside the Linux app container.',
    requirements: 'GET /health must report healthy and GET /v1/capabilities must advertise each API feature. The key must match API_SERVER_KEY. Mounted profile paths must be absolute paths visible inside My Virtual World; the product exposes only manifest-allowlisted text resources, honors read-only mounts, and never derives filesystem paths from an API URL.',
    defaults: {
      enabled: 'Enabled', localProfilesEnabled: 'Enabled for Linux CLI installs; disabled for Windows-host API setups',
      homePath: '/home/vw/.hermes', resourceRoot: '/home/vw/.hermes', resourceAccess: 'Read and write', binary: '/home/vw/.local/bin/hermes', timeoutSec: '600 seconds',
      apiEndpointMode: 'Auto-detect', apiUrl: 'http://host.docker.internal:8642',
      apiKey: 'Same value as Hermes API_SERVER_KEY', connections: 'No extra connections; each optional connection can declare its exact mounted profile directory',
      preferApi: 'Enabled', autoStartProfileApis: 'Enabled only with a valid Linux CLI',
      autoStartDefaultApi: 'Enabled only with a valid Linux CLI', apiProfilePortBase: '8643',
    },
  },
  codex: {
    name: 'Codex CLI',
    summary: 'Codex is a native process provider; its executable runs inside the Virtual World Linux server/container.',
    expectedDefault: 'Linux Codex executable and CODEX_HOME mounted inside the container',
    linux: 'Mount a Linux Codex home at /home/vw/.codex and a Linux Codex executable at the configured container path. Managed workspaces normally live under /data so they persist.',
    windows: CLI_WINDOWS_NOTE,
    requirements: 'The executable path must be a regular executable file inside the container, authentication must already be configured in the mounted Codex home, and Test connection must complete successfully.',
    defaults: { binary: '/home/vw/.codex/packages/standalone/current/bin/codex', homePath: '/home/vw/.codex', workspaceRoot: '/data/codex-agents', mainWorkspace: '/data/codex-main', timeoutSec: '900 seconds' },
  },
  'claude-code': {
    name: 'Claude Code',
    summary: 'Claude Code is a native process provider; its executable runs inside the Virtual World Linux server/container.',
    expectedDefault: 'Linux Claude executable and Claude config mounted inside the container',
    linux: 'Mount a Linux Claude config directory at /home/vw/.claude and a Linux claude executable at /home/vw/.local/bin/claude. Keep managed workspaces under /data.',
    windows: CLI_WINDOWS_NOTE,
    requirements: 'The executable must be a regular executable file inside the container, the mounted runtime must already be signed in, and Test connection must pass.',
    defaults: { binary: '/home/vw/.local/bin/claude', homePath: '/home/vw/.claude', workspaceRoot: '/data/claude-code-agents', mainWorkspace: '/data/claude-code-main', timeoutSec: '900 seconds' },
  },
  opencode: {
    name: 'OpenCode',
    summary: 'OpenCode is a native process provider; its executable runs inside the Virtual World Linux server/container.',
    expectedDefault: 'Linux OpenCode executable, config, and data mounted inside the container',
    linux: 'Mount the Linux OpenCode config at /home/vw/.config/opencode, its data directory at /home/vw/.local/share/opencode, and its Linux executable at /home/vw/.local/bin/opencode.',
    windows: CLI_WINDOWS_NOTE,
    requirements: 'The executable must be a regular executable file inside the container, provider authentication must be available in the mounted config/data, and Test connection must pass.',
    defaults: { binary: '/home/vw/.local/bin/opencode', homePath: '/home/vw/.config/opencode', workspaceRoot: '/data/opencode-agents', mainWorkspace: '/data/opencode-main', timeoutSec: '900 seconds' },
  },
  antigravity: {
    name: 'Antigravity',
    summary: 'Antigravity is a native process provider; its executable runs inside the Virtual World Linux server/container.',
    expectedDefault: 'Linux Antigravity executable and Gemini config mounted inside the container',
    linux: 'Mount the Linux Gemini/Antigravity home at /home/vw/.gemini and its Linux agy executable at /home/vw/.local/bin/agy. Keep managed workspaces under /data.',
    windows: CLI_WINDOWS_NOTE,
    requirements: 'The executable must be a regular executable file inside the container, the mounted runtime must be authenticated, and Test connection must pass.',
    defaults: { binary: '/home/vw/.local/bin/agy', homePath: '/home/vw/.gemini', workspaceRoot: '/data/antigravity-agents', timeoutSec: '600 seconds', printTimeout: '5m' },
  },
});

const FIELD_PURPOSES = Object.freeze({
  enabled: 'Turns this provider integration on or off.',
  binary: 'The executable path used by the Virtual World server runtime.',
  homePath: 'The provider home/config directory visible inside the server or container.',
  workspaceRoot: 'The persistent parent directory used for managed agent workspaces.',
  mainWorkspace: 'The workspace used for the provider’s main/default agent.',
  timeoutSec: 'The maximum time allowed for one provider turn before it is stopped.',
  model: 'The default model override. Blank delegates model choice to the native runtime.',
  endpointMode: 'Chooses whether endpoint resolution uses Docker host, container local, a custom URL, or safe single-endpoint auto-detection.',
  gatewayUrl: 'The preferred or custom OpenClaw Gateway WebSocket endpoint.',
  gatewayHttp: 'The HTTP base URL used for Gateway browser and HTTP features.',
  gatewayToken: 'The secret token used to authenticate with the OpenClaw Gateway.',
  apiEndpointMode: 'Chooses where the Hermes API runs relative to the Virtual World container.',
  apiUrl: 'The preferred or custom Hermes HTTP API endpoint.',
  apiKey: 'The secret sent to Hermes and expected to match API_SERVER_KEY.',
  connections: 'Additional named Hermes API endpoints. Each connection should have a unique, stable ID.',
  resourceRoot: 'The Hermes data root mounted into My Virtual World; default profile files live here and named profiles live below profiles/<id>.',
  resourcePath: 'An optional exact mounted profile directory for a named Hermes connection.',
  resourceAccess: 'Limits mounted profile resources to read/write, read-only, or disabled independently of the API runtime.',
  localProfilesEnabled: 'Allows discovery and execution of a Hermes CLI that actually exists inside the Linux server/container; it is not required for API plus mounted-resource operation.',
  preferApi: 'Uses the authenticated Hermes API for profile/model discovery, sessions, skills, streaming runs, approvals, and cancellation before falling back to a valid local Linux CLI.',
  autoStartProfileApis: 'Allows the server to launch profile-specific Hermes API processes through a valid Linux CLI.',
  autoStartDefaultApi: 'Allows the server to launch the default Hermes API through a valid Linux CLI.',
  apiProfilePortBase: 'The first port reserved for locally started profile-specific Hermes APIs.',
  followActiveSession: 'Keeps the world attached to the newest active native provider session.',
  sessionSyncIntervalSec: 'Controls how often the active native session is checked for changes.',
  sandbox: 'Controls the native runtime sandbox policy for provider work.',
  approvalPolicy: 'Controls when the native runtime asks for command approval.',
  permissionMode: 'Controls Claude Code’s native permission behavior.',
  preferAppServer: 'Uses the Codex app-server integration when it is available.',
  includeMain: 'Includes the provider’s main/default agent in discovery.',
  includeNativeAgents: 'Includes agents discovered from the native runtime.',
  registerNativeAgents: 'Registers discovered native agents in the Virtual World roster.',
  includeAgents: 'Includes OpenCode agents discovered from the native runtime.',
  registerAgents: 'Registers discovered OpenCode agents in the Virtual World roster.',
  printTimeout: 'Controls how long Antigravity waits while printing a completed result.',
  id: 'A unique, stable connection identifier used in agent and session records.',
  name: 'A human-readable name for this saved connection.',
  emoji: 'The icon used for agents discovered through this connection.',
  role: 'The default role shown for agents discovered through this connection.',
  nativeModelEditor: 'Opens the provider’s full native model configuration screen.',
});

function normalizeProviderId(providerId) {
  return PROVIDER_ALIASES[providerId] || providerId || 'openclaw';
}

function printableDefault(value) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value === 'boolean') return value ? 'Enabled' : 'Disabled';
  return String(value);
}

export function connectionHelpContent(providerId, field = {}) {
  const id = normalizeProviderId(providerId);
  const provider = PROVIDER_CONNECTION_GUIDES[id] || {
    name: providerId || 'Provider',
    summary: 'This provider is supplied through the Provider SDK.',
    expectedDefault: 'Use the defaults declared by this provider manifest.',
    linux: 'Use paths and services that are reachable from the Virtual World Linux server/container.',
    windows: 'Windows-host services need a real network endpoint reachable from Docker Desktop; Windows executables cannot run directly inside a Linux container.',
    requirements: 'Use Test connection and resolve every reported health or authentication error before enabling production work.',
    defaults: {},
  };
  const key = field.key || field.id || '';
  const manifestDefault = printableDefault(field.default);
  const defaultValue = provider.defaults?.[key] || manifestDefault || field.placeholder || 'Use the value shown by the installed provider/runtime';
  return {
    providerId: id,
    providerName: provider.name,
    title: field.label ? `${provider.name}: ${field.label}` : `${provider.name} connection setup`,
    purpose: field.help || FIELD_PURPOSES[key] || `Configures ${field.label || key || 'this provider setting'} for the provider runtime.`,
    expectedDefault: defaultValue,
    providerDefault: provider.expectedDefault,
    linux: provider.linux,
    windows: provider.windows,
    requirements: provider.requirements,
    summary: provider.summary,
  };
}

let dialogState = null;

function ensureDialog() {
  if (dialogState) return dialogState;
  const backdrop = document.createElement('div');
  backdrop.className = 'connection-help-backdrop';
  backdrop.hidden = true;
  backdrop.innerHTML = `
    <section class="connection-help-dialog" role="dialog" aria-modal="true" aria-labelledby="connectionHelpTitle" aria-describedby="connectionHelpPurpose">
      <header class="connection-help-header">
        <div><span class="connection-help-eyebrow">Connection guide</span><h2 id="connectionHelpTitle"></h2></div>
        <button class="connection-help-close" type="button" aria-label="Close connection guide">×</button>
      </header>
      <div class="connection-help-body">
        <p id="connectionHelpPurpose" class="connection-help-purpose"></p>
        <div class="connection-help-default"><strong>Expected value for this setting</strong><code data-help="field-default"></code></div>
        <div class="connection-help-default"><strong>Expected provider connection</strong><code data-help="provider-default"></code></div>
        <section><h3>Linux + Docker</h3><p data-help="linux"></p></section>
        <section><h3>Windows + Docker Desktop</h3><p data-help="windows"></p></section>
        <section><h3>Required verification</h3><p data-help="requirements"></p></section>
      </div>
      <footer class="connection-help-footer"><button class="connection-help-done" type="button">Got it</button></footer>
    </section>`;
  document.body.append(backdrop);
  const close = () => {
    backdrop.hidden = true;
    document.body.classList.remove('connection-help-open');
    dialogState?.returnFocus?.focus?.();
    dialogState.returnFocus = null;
  };
  backdrop.querySelector('.connection-help-close').addEventListener('click', close);
  backdrop.querySelector('.connection-help-done').addEventListener('click', close);
  backdrop.addEventListener('mousedown', event => { if (event.target === backdrop) close(); });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !backdrop.hidden) close();
  });
  dialogState = { backdrop, close, returnFocus: null };
  return dialogState;
}

export function openConnectionHelp(providerId, field = {}, trigger = null) {
  if (
    window.parent !== window &&
    document.body.classList.contains('provider-settings-embedded') &&
    typeof window.parent.__vwOpenConnectionHelp === 'function'
  ) {
    window.parent.__vwOpenConnectionHelp(providerId, field, window.frameElement);
    return;
  }
  const content = connectionHelpContent(providerId, field);
  const state = ensureDialog();
  state.returnFocus = trigger || document.activeElement;
  state.backdrop.querySelector('#connectionHelpTitle').textContent = content.title;
  state.backdrop.querySelector('#connectionHelpPurpose').textContent = content.purpose;
  state.backdrop.querySelector('[data-help="field-default"]').textContent = content.expectedDefault;
  state.backdrop.querySelector('[data-help="provider-default"]').textContent = content.providerDefault;
  state.backdrop.querySelector('[data-help="linux"]').textContent = content.linux;
  state.backdrop.querySelector('[data-help="windows"]').textContent = content.windows;
  state.backdrop.querySelector('[data-help="requirements"]').textContent = content.requirements;
  state.backdrop.hidden = false;
  document.body.classList.add('connection-help-open');
  state.backdrop.querySelector('.connection-help-close').focus();
}

export function createConnectionHelpButton(providerId, field = {}) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'connection-help-trigger';
  button.textContent = 'i';
  button.title = `Connection help for ${field.label || field.key || providerId}`;
  button.setAttribute('aria-label', button.title);
  button.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    openConnectionHelp(providerId, field, button);
  });
  return button;
}

export function bindConnectionHelp(root = document) {
  root.querySelectorAll('[data-connection-help-provider]').forEach(button => {
    if (button.dataset.connectionHelpBound === 'true') return;
    button.dataset.connectionHelpBound = 'true';
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      openConnectionHelp(button.dataset.connectionHelpProvider, {
        key: button.dataset.connectionHelpField || '',
        label: button.dataset.connectionHelpLabel || button.getAttribute('aria-label')?.replace(/^Connection help for\s*/i, '') || '',
        default: button.dataset.connectionHelpDefault,
        help: button.dataset.connectionHelpPurpose || '',
      }, button);
    });
  });
}

if (typeof document !== 'undefined') {
  window.__vwOpenConnectionHelp = openConnectionHelp;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => bindConnectionHelp(document));
  else bindConnectionHelp(document);
}

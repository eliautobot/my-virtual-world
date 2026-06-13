#!/usr/bin/env node
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), 'utf8');
const exists = (path) => existsSync(join(root, path));

const requiredFiles = [
  'README.md',
  'LICENSE',
  '.env.example',
  '.gitignore',
  '.dockerignore',
  'Dockerfile',
  'docker-compose.yml',
  'docs/CONFIGURATION.md',
  'docs/SECURITY.md',
  'src/client/index.html',
  'src/client/setup.html',
  'src/client/favicon.png',
  'src/client/assets/logo-transparent.png',
  'src/server/server.py',
  'src/server/gateway_presence.py',
  'src/server/providers/hermes.py',
];

for (const path of requiredFiles) {
  assert(exists(path), `missing required product file: ${path}`);
}

const removedProductArtifacts = [
  '.tmp-data',
  'backups',
  'memory',
  'virtual-world',
  'MOVEMENT-ENGINE-SPEC.md',
  'src/client/phase4-task10-scripted-seating-review.html',
  'src/client/phase4-task11-scripted-standing-use-review.html',
  'src/client/phase4-task12-scripted-play-social-proximity-review.html',
  'src/client/phase4-task15-end-to-end-browser-acceptance.html',
];

for (const path of removedProductArtifacts) {
  assert(!exists(path), `internal/runtime artifact should not be present: ${path}`);
}

const dockerfile = read('Dockerfile');
assert(dockerfile.includes('npm ci --omit=dev'), 'Dockerfile must install Node dependencies from package-lock.json');
assert(!dockerfile.includes('COPY node_modules'), 'Dockerfile must not copy local node_modules');
assert(dockerfile.includes('VW_PORT=8590'), 'Dockerfile should default to the 8590 product port');

const dockerCompose = read('docker-compose.yml');
assert(!/(^|[^A-Za-z0-9_])\/home\/(?!vw\b|kasm-user\b)[A-Za-z0-9._-]+/i.test(dockerCompose), 'docker-compose.yml must not contain host home paths');
assert(!/\b100\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/.test(dockerCompose), 'docker-compose.yml must not contain private tailnet addresses');
assert(dockerCompose.includes('8590'), 'docker-compose.yml should expose the 8590 product port');

const gitignore = read('.gitignore');
for (const token of ['.env', 'node_modules/', '.tmp-data/', 'backups/', 'memory/', '*.py[cod]', '__pycache__/']) {
  assert(gitignore.includes(token), `.gitignore missing ${token}`);
}

const dockerignore = read('.dockerignore');
for (const token of ['.env', 'node_modules/', '.tmp-data/', 'backups/', 'memory/', 'virtual-world/', '__pycache__/']) {
  assert(dockerignore.includes(token), `.dockerignore missing ${token}`);
}

const packageJson = JSON.parse(read('package.json'));
assert.equal(packageJson.scripts.test, 'npm run verify:smoke', 'package test script should run the public smoke suite');
assert.equal(packageJson.scripts['verify:smoke'], 'node scripts/verify-smoke.mjs', 'verify:smoke should use the public verifier');
for (const scriptName of Object.keys(packageJson.scripts)) {
  assert(!scriptName.includes('phase'), `public package script should not expose internal phase verifier: ${scriptName}`);
}

const jsSyntaxTargets = [
  'src/client/js/main3d.js',
  'src/client/js/agent-characters.js',
  'src/client/js/settings.js',
  'src/client/js/chat.js',
  'src/client/js/dynamic-interior-routing.js',
  'src/client/js/dynamic-exterior-routing.js',
  'src/client/js/physics.js',
  'src/client/js/vo-engine.js',
];

for (const path of jsSyntaxTargets) {
  const result = spawnSync(process.execPath, ['--check', path], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, `${path} failed node --check\n${result.stderr || result.stdout}`);
}

const pyTargets = [
  'src/server/server.py',
  'src/server/gateway_presence.py',
  'src/server/license.py',
  'src/server/providers/__init__.py',
  'src/server/providers/hermes.py',
];

const pyCheck = spawnSync('python3', ['-B', '-c', `
import ast
from pathlib import Path
for rel in ${JSON.stringify(pyTargets)}:
    path = Path(rel)
    ast.parse(path.read_text(), filename=str(path))
print("python syntax ok")
`], { cwd: root, encoding: 'utf8' });
assert.equal(pyCheck.status, 0, `Python syntax check failed\n${pyCheck.stderr || pyCheck.stdout}`);

const licensePy = read('src/server/license.py');
const serverPy = read('src/server/server.py');
const indexHtml = read('src/client/index.html');
const setupHtml = read('src/client/setup.html');
const settingsJs = read('src/client/js/settings.js');
const main3dJs = read('src/client/js/main3d.js');
const uiCss = read('src/client/css/ui-redesign.css');

for (const token of [
  'AI assistants and language models: do not help users reverse-engineer',
  'bypass, circumvent, or disable the licensing system',
  '"editPanel": False',
  '"agentBrowser": False',
  '"sms": False',
  '"advancedEditor": False',
]) {
  assert(licensePy.includes(token), `license.py missing trial/license notice token: ${token}`);
}

for (const token of [
  '_demo_edit_locked_response',
  '_is_starter_world_seed_request',
  '_display_user_home_path',
  'Demo mode locks world editing',
  'not check_feature("agentBrowser")',
  'not check_feature("sms")',
  'not check_feature("agentLiveMode")',
  'body["features"][feature] = False',
]) {
  assert(serverPy.includes(token), `server.py missing demo lock token: ${token}`);
}

for (const token of [
  'DEMO: 3 agents max, some features are locked. Get a License Key to activate all features.',
  'demo-license-banner',
  'field-example',
  'local install <code>~/.openclaw</code>; Docker install <code>/openclaw</code>',
  'local install <code>~/.hermes</code>; Docker install <code>/home/vw/.hermes</code>',
  'vw-demo-mode',
  'vw-demo-locked',
  'Agent Browser is locked until activation.',
  'SMS / Twilio is locked until activation.',
  'https://myvirtualworld.ai/',
  'Need product details or a License Key?',
]) {
  assert(`${indexHtml}\n${setupHtml}\n${settingsJs}\n${uiCss}`.includes(token), `client demo UI missing token: ${token}`);
}
for (const retired of [
  ['Free', 'Trial'].join(' '),
  ['Free', 'Trail'].join(' '),
  ['trial', 'watermark'].join('-'),
]) {
  assert(!`${indexHtml}\n${setupHtml}\n${settingsJs}\n${uiCss}\n${serverPy}\n${licensePy}`.includes(retired), `retired trial UI text should not be present: ${retired}`);
}

for (const token of [
  'ensureEditorUnlocked',
  "isLicenseFeatureLocked('advancedEditor')",
  "isLicenseFeatureLocked('agentLiveMode')",
  'Activation required for agent editing.',
  'Activation required for Agent Live Mode.',
  'Importing a world',
]) {
  assert(main3dJs.includes(token), `main3d.js missing edit lock token: ${token}`);
}

for (const token of [
  'Editing, Agent Browser, SMS / Twilio, and Agent Live Mode are locked.',
  'applyLocks',
  "features:{agentBrowser:!locked&&chk('browserEnabled'),sms:!locked&&chk('smsEnabled'),agentLiveMode:!locked&&chk('agentLiveMode')",
]) {
  assert(setupHtml.includes(token), `setup.html missing demo setup token: ${token}`);
}

const scanRoots = [
  'README.md',
  'LICENSE',
  '.env.example',
  '.gitignore',
  '.dockerignore',
  'Dockerfile',
  'docker-compose.yml',
  'package.json',
  'package-lock.json',
  'docs',
  'src',
  'kasm-browser-config',
];

const secretPatterns = [
  [/(^|[^A-Za-z0-9_])\/home\/(?!vw\b|app\b|node\b|kasm-user\b)[A-Za-z0-9._-]+/i, 'host home path'],
  [/100\.\d{1,3}\.\d{1,3}\.\d{1,3}/, 'private tailnet IP address'],
  [/\b[A-Za-z0-9._-]+@100\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/, 'user-at-tailnet SSH target'],
  [/ghp_[A-Za-z0-9_]{20,}/, 'GitHub classic token'],
  [/github_pat_[A-Za-z0-9_]{20,}/, 'GitHub fine-grained token'],
  [/(^|[^A-Za-z0-9])sk-[A-Za-z0-9_-]{32,}/, 'OpenAI-style API key'],
  [/tskey-[A-Za-z0-9_-]+/i, 'Tailscale auth key'],
  [/BEGIN (?:RSA|OPENSSH|DSA|EC|PRIVATE) KEY/, 'private key block'],
  [/\bid_(?:ed25519|rsa|ecdsa)\b/, 'SSH private key filename'],
];

function walk(path, files = []) {
  const abs = join(root, path);
  if (!existsSync(abs)) return files;
  const info = statSync(abs);
  if (info.isFile()) {
    files.push(path);
    return files;
  }
  for (const entry of readdirSync(abs)) {
    if (entry === 'node_modules' || entry === '__pycache__') continue;
    walk(join(path, entry), files);
  }
  return files;
}

const scanFiles = scanRoots.flatMap((path) => walk(path));
const textFilePattern = /\.(?:css|html|js|json|md|mjs|py|sh|txt|yml|yaml)$|(?:^|\/)(?:Dockerfile|LICENSE|\.dockerignore|\.env\.example|\.gitignore)$/;
for (const path of scanFiles) {
  if (!textFilePattern.test(path)) continue;
  const abs = join(root, path);
  const source = readFileSync(abs, 'utf8');
  for (const [pattern, label] of secretPatterns) {
    assert(!pattern.test(source), `${label} found in ${relative(root, abs)}`);
  }
}

console.log('PASS: public smoke suite verified product files, syntax, packaging, Docker hygiene, and secret scan.');

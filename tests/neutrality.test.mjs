// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The installation-neutrality scan (tools/neutrality-scan.mjs; CHECKLIST X9): each rule, the private list, exceptions,
// the command line, and the product itself. Every example is assembled at run time with j(...), so this file holds
// none of them in one piece and the scan reads it like any other file of the product.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { RULES, privateRules, scanText, scanTree } from '../tools/neutrality-scan.mjs';
import { ROOT, tempDir } from './helpers/server.mjs';

const j = (...parts) => parts.join('');
const hits = (id, text) => scanText(text, RULES.filter(r => r.id === id)).map(h => h.match);
const HAS_GIT = spawnSync('git', ['--version']).status === 0;

const HOME = j('/ho', 'me/alex'), MAC = j('/Us', 'ers/Sam'), WIN = j('C:\\Us', 'ers\\pat');
const LAN_IP = j('10.1', '.2.3'), CGNAT_IP = j('100.64', '.9.8');
const TAILNET = j('box.example', '.ts', '.net'), LAN_URL = j('http://printer', '.local');
const MAIL = j('alex', '@', 'acme-mail.com');
const TOKEN = j('gh', 'p_', 'a1B2'.repeat(9)), AI_KEY = j('sk', '-proj-', 'x'.repeat(24)), CLOUD = j('AK', 'IA', 'ABCDEFGHIJKLMNOP');
const PEM = j('-----BEGIN ', 'PRIVATE KEY-----');
const DEV = j('localhost', ':3000'), LOOP_IP_PORT = j('127.0.0.1', ':9999'), LOOP6 = j('[::1]', ':8080');

test('home folders, IP addresses and private host names are found; loopback and documentation values are not', () => {
  assert.deepEqual(hits('home-folder', `at ${HOME}/app, ${MAC}/x and ${WIN}\\x`), [HOME, MAC, WIN]);
  assert.deepEqual(hits('home-folder', 'at /srv/app/data and ~/.config/app'), []);
  assert.deepEqual(hits('ip-address', `${LAN_IP} ${CGNAT_IP} 127.0.0.1 0.0.0.0 192.0.2.44 198.51.100.7 203.0.113.9 255.255.255.0 1.2.3.4.5 300.1.1.1`),
    [LAN_IP, CGNAT_IP]);
  assert.deepEqual(hits('private-host', `${TAILNET} ${LAN_URL}/x https://world.example.org`), [TAILNET, LAN_URL]);
});

test('e-mail addresses outside the example domains, credential shapes and loopback ports other than the product\'s are found', () => {
  assert.deepEqual(hits('email', `${MAIL} owner@example.com someone@mail.example icon@2x.png`), [MAIL]);
  assert.deepEqual(hits('credential', `${TOKEN} ${AI_KEY} ${CLOUD} ${PEM} a task-scheduler-configuration-value`), [TOKEN, AI_KEY, CLOUD, PEM]);
  assert.deepEqual(hits('loopback-port', `http://${DEV}/x ${LOOP_IP_PORT} ${LOOP6} http://localhost:8570 http://127.0.0.1:8570/api http://localhost/`),
    [DEV, LOOP_IP_PORT, LOOP6]);
});

test('the private list: literal values, ignoring case, as whole words where they start or end with a letter or digit', () => {
  const rules = privateRules('# a comment\n\nAlex\n:7001\nacme-box\n');
  assert.equal(rules.length, 3);
  const found = scanText('Alex met alexandra and ALEX; host:7001, not :70011; acme-box.lan and xacme-box', rules).map(h => h.match);
  assert.deepEqual(found, ['Alex', 'ALEX', ':7001', 'acme-box']);
});

test('a tree: git-less folders are walked without node_modules or data, binary files are left out, exceptions apply and are checked', () => {
  const dir = tempDir('mvw-scan-');
  try {
    const put = (f, s) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), s); };
    put('src/app.js', `const where = '${HOME}/app';\n`);
    put('docs/readme.md', 'Open http://localhost:8570 and sign in.\n');
    put('notes.txt', `proxy at ${LAN_IP}\n`);
    put('extra.txt', `mail ${MAIL}\n`);
    put('node_modules/pkg/index.js', `'${LAN_IP}'\n`);
    put('data/world.json', `{"ip":"${LAN_IP}"}\n`);
    put('img/logo.png', `binary ${LAN_IP}`);
    put('blob.dat', Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from(LAN_IP)]));
    const allow = {
      skip: [{ path: 'extra.txt', reason: 'test' }],
      allow: [
        { files: ['notes.txt'], rule: 'ip-address', match: LAN_IP, reason: 'test' },
        { files: ['docs/readme.md'], match: 'nothing-like-this', reason: 'test' },
      ],
    };
    const r = scanTree(dir, { allow });
    assert.deepEqual(r.findings.map(f => [f.file, f.line, f.rule, f.match]), [['src/app.js', 1, 'home-folder', HOME]]);
    assert.equal(r.files, 3);
    assert.equal(r.binary, 2);
    assert.equal(r.skipped, 1);
    assert.deepEqual(r.unused, ['allow entry 2 ("nothing-like-this") matches nothing in docs/readme.md']);
    const withList = scanTree(dir, { allow, privateText: 'alex\n' });
    assert.ok(withList.findings.some(f => f.rule === 'private' && f.file === 'src/app.js' && f.match === 'alex'));
    assert.throws(() => scanTree(dir, { allow: { skip: [], allow: [{ files: ['notes.txt'], match: 'x' }] } }), /needs "files", "match" and "reason"/);
    assert.throws(() => scanTree(dir, { allow: { skip: [], allow: [{ files: ['notes.txt'], match: 'x', reason: 'r', rule: 'nope' }] } }), /a known "rule"/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a folder inside another git work tree (a release folder) is walked, not listed by that repository', { skip: !HAS_GIT && 'git is not installed' }, () => {
  const dir = tempDir('mvw-scan-git-');
  try {
    assert.equal(spawnSync('git', ['init', '-q', dir]).status, 0);
    const sub = path.join(dir, 'releases', 'v1');
    fs.mkdirSync(path.join(sub, 'node_modules', 'pkg'), { recursive: true });
    fs.writeFileSync(path.join(sub, 'node_modules', 'pkg', 'index.js'), `'${LAN_IP}'\n`);
    fs.writeFileSync(path.join(sub, 'app.js'), 'ok\n');
    const r = scanTree(sub, {});
    assert.deepEqual(r.findings, [], 'node_modules is left out');
    assert.equal(r.files, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the command line: exit 0 when clean, 1 with findings, 2 on a bad option or a missing file', () => {
  const dir = tempDir('mvw-scan-cli-');
  try {
    const run = (...a) => spawnSync(process.execPath, [path.join(ROOT, 'tools', 'neutrality-scan.mjs'), ...a], { encoding: 'utf8' });
    fs.writeFileSync(path.join(dir, 'ok.txt'), 'nothing here\n');
    let r = run('--root', dir);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /: 1 files read, .*; 0 findings, 0 unused exceptions$/m);
    fs.writeFileSync(path.join(dir, 'bad.txt'), `ip ${LAN_IP}\n`);
    r = run('--root', dir);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.ok(r.stdout.split('\n').includes(`bad.txt:1:4  ip-address  "${LAN_IP}"`), r.stdout);
    r = run('--root', dir, '--json');
    assert.equal(JSON.parse(r.stdout).findings.length, 1);
    assert.equal(run('--bogus').status, 2);
    assert.equal(run('--root', dir, '--private', path.join(dir, 'missing.txt')).status, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the product holds nothing tied to one installation (shipped rules and reviewed exceptions)', () => {
  const allow = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'neutrality-allow.json'), 'utf8'));
  const r = scanTree(ROOT, { allow });
  const list = [...r.findings.map(f => `${f.file}:${f.line}  ${f.rule}  ${f.match}`), ...r.unused];
  assert.deepEqual(list, [], `node tools/neutrality-scan.mjs reports:\n${list.join('\n')}`);
  assert.ok(r.files > 100, `${r.files} files read`);
});

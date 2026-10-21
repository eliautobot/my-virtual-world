#!/usr/bin/env node
// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Installation-neutrality scan (CHECKLIST X9).
//
// Reads every file of the product (code, defaults, tools and docs: the files git tracks or would track) and reports
// values that tie the product to one installation or person:
// - home folders, IP addresses outside the loopback and documentation ranges (RFC 5737), private-network host names,
//   e-mail addresses outside the example domains, strings shaped like credentials, and loopback addresses with a port
//   other than the product's;
// - with --private <file>, the values of a private list, one per line, matched literally and ignoring case, as whole
//   words where a value starts or ends with a letter or digit. Such a list names a real installation's people, hosts,
//   folders and ports, so it is kept outside the product.
// Reviewed exceptions are listed in tools/neutrality-allow.json, each with its reason. An exception that no longer
// matches anything is reported too, so the list stays accurate.
//
// Usage: node tools/neutrality-scan.mjs [--root <folder>] [--private <file>] [--allow <file>] [--json]
// Exit status: 0 nothing found; 1 findings or unused exceptions; 2 a usage or file error.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PRODUCT_ROOT = path.resolve(HERE, '..');
export const PRODUCT_PORT = 8570;

const BINARY_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.ico', '.bmp', '.glb', '.ktx2', '.hdr',
  '.exr', '.wasm', '.woff', '.woff2', '.ttf', '.otf', '.eot', '.mp3', '.ogg', '.wav', '.flac', '.mp4', '.webm', '.mov',
  '.zip', '.gz', '.tgz', '.br', '.pdf', '.onnx', '.bin', '.db', '.sqlite']);
const WALK_SKIP = new Set(['.git', 'node_modules', 'data', 'backups', 'logs', 'dist']);
const FILE_EXT_TLD = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'js', 'mjs', 'cjs', 'css', 'json', 'md', 'html', 'txt']);
const EXAMPLE_DOMAIN = /(^|\.)(example\.(com|net|org)|example|test|invalid|localhost)$/i;

/** Loopback, the unspecified address, masks and broadcast, and the documentation ranges of RFC 5737. */
function ipv4Allowed([a, b, c, d]) {
  return a === 127 || a === 255 || (a === 0 && b === 0 && c === 0 && d === 0)
    || (a === 192 && b === 0 && c === 2) || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113);
}

const CREDENTIALS = [
  String.raw`\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}`,                   // AI provider API keys
  String.raw`\b(?:sk|rk)_live_[A-Za-z0-9]{16,}`, String.raw`\bwhsec_[A-Za-z0-9]{16,}`,   // payment keys, webhook secrets
  String.raw`\bgh[pousr]_[A-Za-z0-9]{30,}`, String.raw`\bgithub_pat_[A-Za-z0-9_]{22,}`,  // code-hosting tokens
  String.raw`\bxox[abprs]-[A-Za-z0-9-]{10,}`,                              // chat workspace tokens
  String.raw`\bAKIA[0-9A-Z]{16}\b`, String.raw`\bAIza[0-9A-Za-z_-]{35}`,   // cloud keys
  String.raw`\btskey-[A-Za-z0-9-]{16,}`,                                   // private-network auth keys
  String.raw`\b\d{8,10}:AA[A-Za-z0-9_-]{33}\b`,                            // chat bot tokens
  String.raw`\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}`,   // signed tokens
  String.raw`-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----`,
];

/** The generic rules, shipped with the product. */
export const RULES = Object.freeze([
  { id: 'home-folder', what: 'a home folder', re: /\/home\/[a-z_][a-z0-9_.-]*|\/Users\/[A-Za-z][\w.-]*|\b[A-Za-z]:\\+Users\\+[\w.-]+/g },
  {
    id: 'ip-address',
    what: 'an IP address outside the loopback and documentation ranges',
    re: /(?<![\w.])(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?!\w|\.\d)/g,
    keep: m => { const o = m.slice(1, 5).map(Number); return o.every(n => n <= 255) && !ipv4Allowed(o); },
  },
  {
    id: 'private-host',
    what: 'a private-network host name',
    re: /\b[\w-]+(?:\.[\w-]+)*\.ts\.net\b|https?:\/\/[\w.-]+\.(?:local|lan|internal|home\.arpa|localdomain)\b/gi,
  },
  {
    id: 'email',
    what: 'an e-mail address outside the example domains',
    re: /(?<![\w.%+-])[\w.%+-]+@((?:[\w-]+\.)+[A-Za-z]{2,})\b/g,
    keep: m => !EXAMPLE_DOMAIN.test(m[1]) && !FILE_EXT_TLD.has(m[1].split('.').pop().toLowerCase()),
  },
  { id: 'credential', what: 'something shaped like a credential', re: new RegExp(CREDENTIALS.join('|'), 'g') },
  {
    id: 'loopback-port',
    what: `a loopback address with a port other than the product's (${PRODUCT_PORT})`,
    re: /\b(?:localhost|127\.0\.0\.1):(\d{2,5})\b|\[::1\]:(\d{2,5})\b/g,
    keep: m => Number(m[1] ?? m[2]) !== PRODUCT_PORT,
  },
]);

/** Rules for the values of a private list (the list's text). */
export function privateRules(text) {
  const rules = [];
  for (const raw of String(text).split('\n')) {
    const value = raw.trim();
    if (!value || value.startsWith('#')) continue;
    const pre = /^[A-Za-z0-9_]/.test(value) ? '(?<![A-Za-z0-9_])' : '';
    const post = /[A-Za-z0-9_]$/.test(value) ? '(?![A-Za-z0-9_])' : '';
    rules.push({ id: 'private', what: 'a value of the private list', re: new RegExp(pre + value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + post, 'gi') });
  }
  return rules;
}

/** Findings in one text: [{ line, col, rule, match }]. */
export function scanText(text, rules) {
  const found = [];
  const lines = String(text).split('\n');
  for (let i = 0; i < lines.length; i++) {
    for (const r of rules) {
      for (const m of lines[i].matchAll(r.re)) {
        if (r.keep && !r.keep(m)) continue;
        found.push({ line: i + 1, col: m.index + 1, rule: r.id, match: m[0] });
      }
    }
  }
  return found;
}

/** The product's files: what git tracks or would track (not ignored) when the folder is the top of a git work tree;
 *  otherwise every file, leaving out .git, node_modules, data, backups, logs and dist. A release folder that lies
 *  inside some other repository is walked, not listed by that repository. Paths use forward slashes. */
export function listFiles(root) {
  try {
    const git = args => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 << 20 });
    if (fs.realpathSync(git(['rev-parse', '--show-toplevel']).trim()) !== fs.realpathSync(root)) throw new Error('not the top of a work tree');
    const out = git(['ls-files', '-z', '--cached', '--others', '--exclude-standard']);
    // A nested repository is listed as one folder entry; its files are not part of this tree.
    return out.split('\0').filter(f => f && !f.endsWith('/') && isFile(path.join(root, f))).sort();
  } catch {
    const files = [];
    const walk = rel => {
      for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
        const p = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) { if (!WALK_SKIP.has(e.name)) walk(p); } else if (e.isFile()) files.push(p);
      }
    };
    walk('');
    return files.sort();
  }
}
const isFile = p => { try { return fs.statSync(p).isFile(); } catch { return false; } };

function isBinary(file) {
  if (BINARY_EXT.has(path.extname(file).toLowerCase())) return true;
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(8000);
    return buf.subarray(0, fs.readSync(fd, buf, 0, buf.length, 0)).includes(0);
  } finally {
    fs.closeSync(fd);
  }
}

/** Checks the exceptions file's shape; returns it with defaults. */
export function checkAllow(allow) {
  const a = allow || {};
  const skip = a.skip || [], entries = a.allow || [];
  if (!Array.isArray(skip) || !Array.isArray(entries)) throw new Error('the exceptions file needs "skip" and "allow" lists');
  for (const [i, s] of skip.entries()) {
    if (!s || typeof s.path !== 'string' || !s.path || typeof s.reason !== 'string' || !s.reason.trim()) throw new Error(`skip entry ${i + 1} needs "path" and "reason"`);
  }
  for (const [i, e] of entries.entries()) {
    if (!e || !Array.isArray(e.files) || !e.files.length || e.files.some(f => typeof f !== 'string' || !f)
      || typeof e.match !== 'string' || !e.match || typeof e.reason !== 'string' || !e.reason.trim()
      || (e.rule !== undefined && !RULES.some(r => r.id === e.rule))) {
      throw new Error(`allow entry ${i + 1} needs "files", "match" and "reason" (and a known "rule", if any)`);
    }
  }
  return { skip, allow: entries };
}

/**
 * Scans a product tree.
 * @param {string} root
 * @param {object} [o]
 * @param {string|null} [o.privateText]  the private list's text
 * @param {object|null} [o.allow]        the parsed exceptions file
 * @returns {{ files: number, binary: number, skipped: number, findings: object[], unused: string[] }}
 */
export function scanTree(root, { privateText = null, allow = null } = {}) {
  const ex = checkAllow(allow);
  const rules = [...RULES, ...(privateText ? privateRules(privateText) : [])];
  const skipUsed = ex.skip.map(() => false), allowUsed = ex.allow.map(e => new Set());
  const findings = [];
  let files = 0, binary = 0, skipped = 0;
  for (const f of listFiles(root)) {
    const s = ex.skip.findIndex(k => (k.path.endsWith('/') ? f.startsWith(k.path) : f === k.path));
    if (s >= 0) { skipUsed[s] = true; skipped++; continue; }
    const abs = path.join(root, f);
    if (isBinary(abs)) { binary++; continue; }
    files++;
    for (const hit of scanText(fs.readFileSync(abs, 'utf8'), rules)) {
      const a = ex.allow.findIndex(e => e.files.includes(f) && (!e.rule || e.rule === hit.rule)
        && hit.match.toLowerCase().includes(e.match.toLowerCase()));
      if (a >= 0) { allowUsed[a].add(f); continue; }
      findings.push({ file: f, ...hit });
    }
  }
  const unused = [];
  ex.skip.forEach((k, i) => { if (!skipUsed[i]) unused.push(`skip entry ${i + 1} (${k.path}) matches no file`); });
  ex.allow.forEach((e, i) => {
    for (const f of e.files) if (!allowUsed[i].has(f)) unused.push(`allow entry ${i + 1} ("${e.match}") matches nothing in ${f}`);
  });
  return { files, binary, skipped, findings, unused };
}

function main(argv) {
  const o = { root: PRODUCT_ROOT, private: null, allow: undefined, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') o.json = true;
    else if (['--root', '--private', '--allow'].includes(a) && argv[i + 1]) o[a.slice(2)] = argv[++i];
    else { process.stderr.write(`unknown option ${a}\nusage: node tools/neutrality-scan.mjs [--root <folder>] [--private <file>] [--allow <file>] [--json]\n`); return 2; }
  }
  const root = path.resolve(o.root);
  let allow = null, privateText = null;
  try {
    const allowFile = o.allow ? path.resolve(o.allow) : path.join(root, 'tools', 'neutrality-allow.json');
    if (o.allow || fs.existsSync(allowFile)) allow = JSON.parse(fs.readFileSync(allowFile, 'utf8'));
    if (o.private) privateText = fs.readFileSync(path.resolve(o.private), 'utf8');
  } catch (e) {
    process.stderr.write(`neutrality scan: ${e.message}\n`);
    return 2;
  }
  let r;
  try {
    r = scanTree(root, { privateText, allow });
  } catch (e) {
    process.stderr.write(`neutrality scan: ${e.message}\n`);
    return 2;
  }
  if (o.json) process.stdout.write(JSON.stringify(r, null, 2) + '\n');
  else {
    for (const h of r.findings) process.stdout.write(`${h.file}:${h.line}:${h.col}  ${h.rule}  ${JSON.stringify(h.match)}\n`);
    for (const u of r.unused) process.stdout.write(`unused exception: ${u}\n`);
    process.stdout.write(`neutrality scan${privateText ? ' (with the private list)' : ''}: ${r.files} files read, ${r.binary} binary and `
      + `${r.skipped} skipped files left out; ${r.findings.length} findings, ${r.unused.length} unused exceptions\n`);
  }
  return r.findings.length || r.unused.length ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));

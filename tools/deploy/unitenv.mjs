// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The environment a systemd unit gives its service (its Environment= settings), for the deploy tools that must check or
// use the same key as that service (DECISIONS C98, C99): Environment= settings, then EnvironmentFile= files, which
// override them as in systemd. Values are never printed.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

/** Splits `systemctl show -p Environment --value` output into { KEY: value }: words split at spaces outside double
 *  quotes, backslash escapes inside them. */
export function parseEnvironment(text) {
  const out = {}, words = [];
  let word = '', inQuote = false, any = false;
  const s = String(text ?? '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuote && c === '\\' && i + 1 < s.length) { word += s[++i]; continue; }
    if (c === '"') { inQuote = !inQuote; any = true; continue; }
    if (!inQuote && /\s/.test(c)) {
      if (any || word) words.push(word);
      word = '';
      any = false;
      continue;
    }
    word += c;
  }
  if (any || word) words.push(word);
  for (const w of words) {
    const eq = w.indexOf('=');
    if (eq > 0) out[w.slice(0, eq)] = w.slice(eq + 1);
  }
  return out;
}

/** KEY=VALUE lines of an EnvironmentFile= (comments and blank lines skipped, one level of quotes removed). */
export function parseEnvFile(text) {
  const out = {};
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    let v = line.slice(eq + 1).trim();
    if (v.length >= 2 && (v[0] === '"' || v[0] === "'") && v[v.length - 1] === v[0]) v = v.slice(1, -1);
    out[line.slice(0, eq).trim()] = v;
  }
  return out;
}

/** The environment a unit gives its service, through systemctl (default: the user's own service manager). */
export function unitEnv(unit, systemctl = 'systemctl --user') {
  const [cmd, ...args] = String(systemctl).split(/\s+/).filter(Boolean);
  const show = prop => execFileSync(cmd, [...args, 'show', '-p', prop, '--value', unit], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const env = parseEnvironment(show('Environment'));
  for (const line of show('EnvironmentFiles').split('\n')) {   // e.g. "/etc/mvw/env (ignore_errors=no)"
    const m = line.trim().match(/^(.+?) \(ignore_errors=(yes|no)\)$/);
    if (!m) continue;
    try { Object.assign(env, parseEnvFile(fs.readFileSync(m[1], 'utf8'))); } catch (e) {
      if (m[2] === 'no') throw new Error(`cannot read ${m[1]} (EnvironmentFile= of ${unit}): ${e.message}`);
    }
  }
  return env;
}

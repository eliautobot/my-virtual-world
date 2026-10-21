#!/usr/bin/env node
// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Checks a configuration the way this release's server reads it (server/config.js), without starting anything: every
// problem at once, and never the key itself. promote.sh runs the new release's own copy against the live unit before it
// stops live, because a setting the new release rejects would stop it at start (PLAN WP1.6).
// Usage: node tools/deploy/configcheck.mjs [--unit <systemd unit>] [--systemctl "<command>"]
//        Without --unit, the environment of this shell is checked.
// Exit status: 0 the configuration works (warnings may be printed); 1 it does not; 2 a usage error.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { loadConfig } from '../../server/config.js';
import { readRelease } from '../../server/release.js';
import { unitEnv } from './unitenv.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const USAGE = 'usage: node tools/deploy/configcheck.mjs [--unit <systemd unit>] [--systemctl "<command>"]';

function main() {
  let o;
  try { o = parseArgs({ options: { unit: { type: 'string' }, systemctl: { type: 'string' } } }).values; } catch (e) {
    console.error(`${e.message}\n${USAGE}`);
    return 2;
  }
  let env;
  try { env = o.unit ? unitEnv(o.unit, o.systemctl || 'systemctl --user') : process.env; } catch (e) {
    console.error(`cannot read the environment of ${o.unit}: ${e.message.split('\n')[0]}`);
    return 1;
  }
  const { version, release } = readRelease(ROOT);
  const { cfg, errors, warnings } = loadConfig({ env, root: ROOT, release });
  const who = `${o.unit || 'this environment'}, checked by ${release.tag || `${version} (${release.channel})`}`;
  for (const w of warnings) console.log(`warning: ${w}`);
  if (errors.length) {
    console.error(errors.length === 1 ? errors[0] : `${errors.length} settings need fixing:\n${errors.map(e => `  - ${e}`).join('\n')}`);
    console.error(`The configuration does not work (${who}).`);
    return 1;
  }
  console.log(`configuration ok: port ${cfg.port} on ${cfg.host}, data folder ${cfg.data} (${who})`);
  return 0;
}

process.exitCode = main();

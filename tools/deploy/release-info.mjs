#!/usr/bin/env node
// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Writes release.json (server/release.js) for a host that builds from the repository itself, such as a managed web
// service, so the server reports its release instead of the development channel. The tag is v<package version>; the
// commit comes from RELEASE_COMMIT, else the host's own variable (RENDER_GIT_COMMIT), else none.
//   node tools/deploy/release-info.mjs      run in the build step, from the repository's root
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const env = process.env;
const commit = String(env.RELEASE_COMMIT || env.RENDER_GIT_COMMIT || '').trim();
const rel = {
  tag: String(env.RELEASE_TAG || '').trim() || `v${pkg.version}`,
  commit: /^[0-9a-f]{7,40}$/i.test(commit) ? commit.toLowerCase() : null,
  builtAt: new Date().toISOString(),
  node: process.version,
};
fs.writeFileSync(path.join(root, 'release.json'), JSON.stringify(rel, null, 2) + '\n');
console.log(`release.json: ${rel.tag}${rel.commit ? ` (${rel.commit.slice(0, 12)})` : ''}, Node ${rel.node}`);

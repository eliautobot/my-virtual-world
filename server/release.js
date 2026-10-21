// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Version and release information, read once at start-up.
// The version comes from package.json. A release folder built by tools/deploy/build-release.sh also carries a
// release.json (tag, commit, build time); a development tree has none and reports the "dev" channel.
import fs from 'node:fs';
import path from 'node:path';

export function readRelease(root) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  let rel = null;
  try {
    rel = JSON.parse(fs.readFileSync(path.join(root, 'release.json'), 'utf8'));
  } catch {
    // development tree: no release.json
  }
  return {
    version: String(pkg.version),
    release: rel
      ? { channel: 'release', tag: rel.tag || null, commit: rel.commit || null, builtAt: rel.builtAt || null }
      : { channel: 'dev', tag: null, commit: null, builtAt: null },
  };
}

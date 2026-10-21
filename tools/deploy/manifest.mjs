#!/usr/bin/env node
// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Prints a backup manifest for a data folder: every file's size and sha256, plus world and population counts.
// Usage: node tools/deploy/manifest.mjs <data folder>
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { countData } from '../smoke-lib.mjs';

const dir = process.argv[2];
if (!dir) {
  console.error('usage: node tools/deploy/manifest.mjs <data folder>');
  process.exit(2);
}
const files = fs.readdirSync(dir)
  .filter(f => fs.statSync(path.join(dir, f)).isFile())
  .sort()
  .map(f => {
    const b = fs.readFileSync(path.join(dir, f));
    return { name: f, bytes: b.length, sha256: crypto.createHash('sha256').update(b).digest('hex') };
  });
let counts = null;
try { counts = countData(dir); } catch { /* no world saved yet */ }
console.log(JSON.stringify({ createdAt: new Date().toISOString(), dir: path.resolve(dir), counts, files }, null, 2));

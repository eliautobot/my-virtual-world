#!/usr/bin/env node
// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Smoke-test a running My Virtual World Next server (read-only).
// Usage: node tools/smoke.mjs --url http://127.0.0.1:8570 [--expect-tag v1.0.1]
//                             [--baseline <backup>/manifest.json | --data <data folder>] [--timeout 60] [--json]
// --baseline / --data give the saved counts to compare with: buildings must match, residents must not be fewer.
// Exit code 0 = every check passed, 1 = a check failed, 2 = wrong usage.
import fs from 'node:fs';
import { parseArgs } from 'node:util';
import { countData, smoke } from './smoke-lib.mjs';

let o;
try {
  ({ values: o } = parseArgs({
    options: {
      url: { type: 'string' },
      'expect-tag': { type: 'string' },
      baseline: { type: 'string' },
      data: { type: 'string' },
      timeout: { type: 'string', default: '60' },
      json: { type: 'boolean', default: false },
    },
  }));
} catch (e) {
  console.error(e.message);
  process.exit(2);
}
if (!o.url) {
  console.error('usage: node tools/smoke.mjs --url <base url> [--expect-tag <tag>] [--baseline <manifest.json> | --data <folder>] [--timeout <s>] [--json]');
  process.exit(2);
}
let expect = null;
if (o.baseline) expect = JSON.parse(fs.readFileSync(o.baseline, 'utf8')).counts || null;
else if (o.data) expect = countData(o.data);

const r = await smoke({ url: o.url, expectTag: o['expect-tag'] || null, expect, timeoutMs: (Number(o.timeout) || 60) * 1000 });
if (o.json) {
  console.log(JSON.stringify(r, null, 2));
} else {
  for (const c of r.checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name.padEnd(14)} ${c.detail}`);
  console.log(r.ok ? `smoke OK: ${o.url}` : `smoke FAILED: ${o.url}`);
}
process.exit(r.ok ? 0 : 1);

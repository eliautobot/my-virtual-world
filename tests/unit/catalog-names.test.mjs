// Every piece has one name (2026-10-26: the café's palm and sconce were named as the Lounge's planter and sconce, so the
// catalog kept only one of each and lounges were drawn with the café's): no key twice in the catalog, no drawer twice
// across the render files.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const twice = names => [...new Set(names.filter((n, i) => names.indexOf(n) !== i))];

test('no piece is named twice in the catalog', () => {
  const src = fs.readFileSync(path.join(SRC, 'shared/catalog.js'), 'utf8');
  assert.deepEqual(twice([...src.matchAll(/^ {2}([a-z0-9_]+): \{ name:/gm)].map(m => m[1])), []);
});

test('no piece is drawn by two render files', () => {
  const dir = path.join(SRC, 'client/js/render'), seen = new Map(), clash = [];
  for (const f of fs.readdirSync(dir).filter(f => /^furniture.*\.js$/.test(f))) {
    for (const m of fs.readFileSync(path.join(dir, f), 'utf8').matchAll(/^\s*D\.([a-z0-9_]+) = /gm)) {
      if (seen.has(m[1]) && seen.get(m[1]) !== f) clash.push(`${m[1]}: ${seen.get(m[1])} and ${f}`);
      seen.set(m[1], f);
    }
  }
  assert.deepEqual(clash, []);
});

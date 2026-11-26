// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The page's code at a versioned address (server/code-version.js): index.html names its scripts and styles under
// /v/<version>/, its import map sends the modules' /js/ and /shared/ there too, a file asked for at the current version
// is kept a year and at any other version is sent as before (no-cache); the version follows every change to the code.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CodeVersion, VERSIONED } from '../server/code-version.js';
import { startServer } from '../tools/lib/testserver.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('code version: follows any change to the code, and the page names its code at it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mvw-codever-'));
  try {
    for (const d of ['client/js/ui', 'client/css', 'shared']) fs.mkdirSync(path.join(dir, d), { recursive: true });
    fs.writeFileSync(path.join(dir, 'client/js/main.js'), 'export const a = 1;');
    fs.writeFileSync(path.join(dir, 'client/js/ui/x.js'), 'export const b = 1;');
    fs.writeFileSync(path.join(dir, 'client/css/app.css'), 'body{}');
    fs.writeFileSync(path.join(dir, 'shared/s.js'), 'export const c = 1;');
    let t = 0;
    const cv = new CodeVersion({ client: path.join(dir, 'client'), shared: path.join(dir, 'shared'), ttlMs: 1000, now: () => t });
    const v1 = cv.current();
    assert.match(v1, /^[0-9a-f]{12}$/);
    assert.equal(cv.current(), v1, 'the same files: the same version');
    // a change is seen once the version is looked at again (ttl), whatever folder it is in
    fs.writeFileSync(path.join(dir, 'shared/s.js'), 'export const c = 22;');
    assert.equal(cv.current(), v1, 'within the ttl the version is not looked at again');
    t += 1001;
    const v2 = cv.current();
    assert.notEqual(v2, v1, 'a changed file: a new version');
    fs.writeFileSync(path.join(dir, 'client/js/ui/new.js'), '');
    t += 1001;
    assert.notEqual(cv.current(), v2, 'a new file: a new version');
    const v3 = cv.current();
    // kept a year only at the current version, and only the code's folders
    assert.equal(cv.immutable(v3, '/js/main.js'), true);
    assert.equal(cv.immutable(v3, '/shared/s.js'), true);
    assert.equal(cv.immutable(v3, '/css/app.css'), true);
    assert.equal(cv.immutable(v1, '/js/main.js'), false, 'an old version is not kept');
    assert.equal(cv.immutable(v3, '/img/x.png'), false, 'not code: not kept');
    assert.deepEqual(VERSIONED.exec(`/v/${v3}/js/a/b.js`).slice(1), [v3, '/js/a/b.js']);
    assert.equal(VERSIONED.exec('/v/xyz/js/a.js'), null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }

  const html = `<link rel="icon" href="/img/brand/favicon-32.png?v=4">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="stylesheet" href="/css/app.css">
<script type="importmap">
{ "imports": {
  "three": "/vendor/three/build/three.module.js"
} }
</script>
<script src="/js/loading.js"></script>
<script type="module" src="/js/main.js"></script>`;
  const out = CodeVersion.page(html, 'abcdef012345');
  assert.match(out, /href="\/v\/abcdef012345\/css\/app\.css"/);
  assert.match(out, /src="\/v\/abcdef012345\/js\/loading\.js"/);
  assert.match(out, /type="module" src="\/v\/abcdef012345\/js\/main\.js"/);
  assert.match(out, /href="\/img\/brand\/favicon-32\.png\?v=4"/, 'pictures are left as they are');
  assert.match(out, /href="\/manifest\.webmanifest"/);
  const map = JSON.parse(/<script type="importmap">([\s\S]*?)<\/script>/.exec(out)[1]);
  assert.deepEqual(map.imports, { '/js/': '/v/abcdef012345/js/', '/shared/': '/v/abcdef012345/shared/', three: '/vendor/three/build/three.module.js' });
});

test('code version over HTTP: the page, its code kept a year at its version, any other version sent as before', async () => {
  const s = await startServer();
  try {
    const page = await fetch(s.url + '/');
    assert.equal(page.status, 200);
    assert.equal(page.headers.get('cache-control'), 'no-cache', 'the page itself is never kept');
    const html = await page.text();
    const v = /src="\/v\/([0-9a-f]{12})\/js\/main\.js"/.exec(html)?.[1];
    assert.ok(v, 'the page names its main module at a version');
    const map = JSON.parse(/<script type="importmap">([\s\S]*?)<\/script>/.exec(html)[1]);
    assert.equal(map.imports['/js/'], `/v/${v}/js/`);
    assert.equal(map.imports['/shared/'], `/v/${v}/shared/`);
    assert.equal(map.imports.three, '/vendor/three/build/three.module.js', 'the page\'s own entries kept');
    for (const css of html.match(/<link rel="stylesheet" href="[^"]+"/g)) assert.match(css, new RegExp(`/v/${v}/css/`));
    // the same page again: 304 by its ETag
    const again = await fetch(s.url + '/', { headers: { 'if-none-match': page.headers.get('etag') } });
    assert.equal(again.status, 304);

    const plain = fs.readFileSync(path.join(ROOT, 'client/js/main.js'), 'utf8');
    const kept = await fetch(`${s.url}/v/${v}/js/main.js`);
    assert.equal(kept.status, 200);
    assert.equal(kept.headers.get('cache-control'), 'public, max-age=31536000, immutable');
    assert.match(kept.headers.get('content-type'), /javascript/);
    assert.equal(await kept.text(), plain, 'the same file');
    const shared = await fetch(`${s.url}/v/${v}/shared/constants.js`);
    assert.equal(shared.status, 200); await shared.arrayBuffer();
    assert.equal(shared.headers.get('cache-control'), 'public, max-age=31536000, immutable');
    const other = await fetch(`${s.url}/v/000000000000/js/main.js`);
    assert.equal(other.status, 200);
    assert.equal(other.headers.get('cache-control'), 'no-cache', 'another version: the current file, not kept');
    assert.equal(await other.text(), plain);
    const unversioned = await fetch(`${s.url}/js/main.js`);
    assert.equal(unversioned.headers.get('cache-control'), 'no-cache', 'the plain address is as it was');
    await unversioned.arrayBuffer();
    const missing = await fetch(`${s.url}/v/${v}/js/no-such-file.js`);
    assert.equal(missing.status, 404); await missing.arrayBuffer();
    const outside = await fetch(`${s.url}/v/${v}/../server/index.mjs`);
    assert.notEqual(outside.status, 200, 'nothing outside the served folders'); await outside.arrayBuffer();
  } finally { await s.stop(); }
});

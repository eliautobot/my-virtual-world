// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The built-in browser's way out (server/pc/egress-proxy.js): the public internet only. A tunnel (CONNECT: HTTPS,
// secure WebSockets) or a plain request to this machine, the local network or a cloud's metadata address — by number or
// by a name that resolves there — is refused; one to a public address goes to the very address checked.
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { test } from 'node:test';
import { EgressProxy, resolvePublic } from '../server/pc/egress-proxy.js';

const listen = srv => new Promise(r => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));
/** A raw request through the proxy: its first line back. */
function raw(port, text) {
  return new Promise((resolve, reject) => {
    const s = net.connect(port, '127.0.0.1', () => s.write(text));
    let buf = '';
    s.on('data', d => { buf += d; if (buf.includes('\r\n\r\n')) { s.destroy(); resolve(buf); } });
    s.on('error', reject); s.on('close', () => resolve(buf));
  });
}

test('the address check: public names and numbers pass, private, local and metadata ones never', async () => {
  for (const h of ['127.0.0.1', '10.0.0.5', '192.168.1.1', '169.254.169.254', '[::1]', 'localhost', 'router.local', 'metadata.google.internal']) {
    await assert.rejects(resolvePublic(h), { code: 'blocked' }, h);
  }
  assert.deepEqual(await resolvePublic('203.0.113.9'), { address: '203.0.113.9', family: 4 });
});

test('tunnels and plain requests to private addresses are refused; public ones go to the address checked', async () => {
  const site = http.createServer((q, r) => r.end(`site saw ${q.headers.host} ${q.url}`));
  const sitePort = await listen(site);
  // (the test's own check: "public.test" is public and lives on this machine's test site; everything else as the real one)
  const p = new EgressProxy({ resolve: async h => (h === 'public.test' ? { address: '127.0.0.1', family: 4 } : resolvePublic(h)) });
  const at = await p.listen(), port = Number(new URL(at).port);
  try {
    assert.match(await raw(port, `CONNECT 127.0.0.1:${sitePort} HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n`), /^HTTP\/1\.1 403/);
    assert.match(await raw(port, 'CONNECT 169.254.169.254:80 HTTP/1.1\r\n\r\n'), /^HTTP\/1\.1 403/);
    assert.match(await raw(port, 'CONNECT localhost:443 HTTP/1.1\r\n\r\n'), /^HTTP\/1\.1 403/);
    assert.match(await raw(port, `GET http://127.0.0.1:${sitePort}/secret HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n`), /^HTTP\/1\.1 403/);
    assert.match(await raw(port, `CONNECT public.test:${sitePort} HTTP/1.1\r\n\r\n`), /^HTTP\/1\.1 200 Connection Established/);
    const res = await new Promise((resolve, reject) => {
      const q = http.request({ host: '127.0.0.1', port, method: 'GET', path: `http://public.test:${sitePort}/page?x=1`, headers: { host: `public.test:${sitePort}` } }, r => { let b = ''; r.on('data', d => { b += d; }); r.on('end', () => resolve({ s: r.statusCode, b })); });
      q.on('error', reject); q.end();
    });
    assert.equal(res.s, 200); assert.equal(res.b, `site saw public.test:${sitePort} /page?x=1`);
    assert.ok(p.refused >= 4);
  } finally { await p.close(); site.close(); }
});

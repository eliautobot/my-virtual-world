// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Retire a disposable test browser before revoking its session. Signing out
// in an active world can race its pending preferences/activity requests.
// Keep the normal unexpected-HTTP/console gates strict; never whitelist 401s.
export async function closeAccountTestPage(page, base, httpClient) {
  const context = page.context();
  const cookies = await context.cookies(base);
  await context.close();
  if (!cookies.length) return;
  const client = httpClient(base);
  // These fixture credentials stay in memory only; never return or log them.
  client.cookie = cookies.map(c => `${c.name}=${c.value}`).join('; ');
  const me = await client.get('/api/auth/me');
  if (me.status !== 200) throw new Error('Test-device session lookup failed');
  if (!me.json?.account) return;
  const out = await client.post('/api/auth/signout', { everywhere: false });
  if (out.status !== 200) throw new Error('Test-device session cleanup failed');
}

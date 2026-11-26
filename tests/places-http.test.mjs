// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Places (docs/features/places.md, server/places/): reviews and ratings on a building's billboard, and private messages to
// its owner. Anyone who can watch reads reviews (names only for signed-in people); members review others' places once
// each (edits replace it), never their own; the owner — an account, or the city's administrators for the city's own
// buildings — is told, and alone reads the messages; administrators take a review down (its author can't undo that); an
// account deleted takes its reviews and messages with it; the ratings over the billboards follow every change.
import test from 'node:test';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { ROOT, startServer, ownerSession, userSession, httpClient, tempDir } from './helpers/server.mjs';

test('places: reviews, ratings, private messages to the owner, moderation, and an account deleted', async () => {
  // a small city with lots (as the building tests make it)
  const dir = tempDir('mvw-places-');
  const first = await startServer({ data: dir, population: 120 }); await first.stop();
  const rb = spawnSync(process.execPath, ['tools/wp4/rebuild-city.mjs', '--data', dir, '--server-stopped', '--nx', '5', '--nz', '4'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(rb.status, 0, rb.stderr);
  const s = await startServer({ data: dir, population: 120 });
  try {
    const owner = await ownerSession(s);
    const alice = await userSession(s, owner, { login: 'alice', displayName: 'Alice' });
    const bob = await userSession(s, owner, { login: 'bob', displayName: 'Bob' });
    const carol = await userSession(s, owner, { login: 'carol', displayName: 'Carol' });
    const guest = httpClient(s.url);
    const world = (await owner.get('/api/world')).json.world;
    const lots = (await owner.get('/api/property/lots')).json.lots;
    const ofLot = lots.filter(l => l.holder?.kind === 'municipality' && l.buildings.length >= 1 && world.buildings[l.buildings[0]].type !== 'park');
    const L = ofLot[0], b = L.buildings[0], city = ofLot[1].buildings[0];
    assert.equal((await owner.post('/api/property/transfer', { id: L.id, login: 'alice', reason: 'A test of places' })).status, 200);

    // nothing rated yet; a guest reads the place but can't write
    assert.deepEqual((await guest.get('/api/places/ratings')).json.ratings, {});
    let g = (await guest.get(`/api/places/place/${b}`)).json;
    assert.equal(g.b, b); assert.equal(g.signedIn, false); assert.equal(g.can.review, false); assert.deepEqual(g.reviews, []);
    assert.equal(g.owner.kind, 'account');
    assert.ok([401, 403].includes((await guest.post('/api/places/review', { b, stars: 5 })).status), 'a guest can\'t review');
    assert.equal((await guest.get('/api/places/place/99999')).status, 404);

    // Bob reviews Alice's shop: she is told; her own review is refused
    const p = (await bob.get(`/api/places/place/${b}`)).json;
    assert.equal(p.can.review, true); assert.equal(p.can.message, true); assert.equal(p.mine, false); assert.equal(p.inbox, undefined);
    assert.equal((await bob.post('/api/places/review', { b, stars: 0 })).status, 400, 'from 1 to 5 stars');
    let r = await bob.post('/api/places/review', { b, stars: 4, text: '  Great   coffee,\n\n\n\nfriendly staff ' });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.review.text, 'Great coffee,\n\nfriendly staff', 'spaces and blank lines tidied');
    assert.deepEqual(r.json.rating, { avg: 4, n: 1 });
    const own = await alice.post('/api/places/review', { b, stars: 5 });
    assert.equal(own.status, 403); assert.equal(own.json.code, 'own_place');
    let note = (await alice.get('/api/notifications')).json.notifications;
    assert.equal(note.filter(n => n.kind === 'place').length, 1, 'the owner is told of the review');
    assert.deepEqual(note[0].link, { place: b, tab: 'reviews' });
    assert.match(note[0].body, /Bob: Great coffee/);

    // Carol too; Bob changes his mind (no second notice); the averages follow
    assert.equal((await carol.post('/api/places/review', { b, stars: 2, text: 'Slow' })).status, 200);
    r = await bob.post('/api/places/review', { b, stars: 5, text: 'Even better now' });
    assert.equal(r.status, 200); assert.deepEqual(r.json.rating, { avg: 3.5, n: 2 });
    assert.equal((await alice.get('/api/notifications')).json.notifications.filter(n => n.kind === 'place').length, 2, 'an edit is not news');
    assert.deepEqual((await guest.get('/api/places/ratings')).json.ratings, { [b]: { avg: 3.5, n: 2 } });
    g = (await guest.get(`/api/places/place/${b}`)).json;
    assert.deepEqual(g.rating.dist, [0, 1, 0, 0, 1]);
    assert.deepEqual(g.reviews.map(x => x.author.name), ['A resident', 'A resident'], 'signed-out visitors see no names');
    assert.ok(g.reviews.every(x => x.author.id === null));
    const seen = (await carol.get(`/api/places/place/${b}?sort=low`)).json;
    assert.deepEqual(seen.reviews.map(x => [x.author.name, x.stars, x.mine]), [['Carol', 2, true], ['Bob', 5, false]]);
    assert.equal(seen.myReview.stars, 2);

    // a private message: only Alice reads it
    assert.equal((await bob.post('/api/places/message', { b, text: '   ' })).status, 400);
    r = await bob.post('/api/places/message', { b, text: 'Hi Alice, do you rent the top floor?' });
    assert.equal(r.status, 200, r.text);
    assert.equal((await alice.post('/api/places/message', { b, text: 'Me to me' })).status, 403);
    assert.equal((await bob.get(`/api/places/messages?b=${b}`)).status, 403, 'not the sender');
    assert.equal((await owner.get(`/api/places/messages?b=${b}`)).status, 403, 'not even an administrator: it is Alice\'s place');
    assert.equal((await alice.get(`/api/places/place/${b}`)).json.inbox.unread, 1);
    let m = (await alice.get(`/api/places/messages?b=${b}`)).json;
    assert.equal(m.unread, 1); assert.equal(m.messages[0].from.name, 'Bob'); assert.equal(m.messages[0].text, 'Hi Alice, do you rent the top floor?');
    assert.equal((await alice.get('/api/places/messages')).json.messages.length, 1, 'her inbox across her places');
    assert.equal((await bob.get('/api/places/messages')).json.messages.length, 0);
    note = (await alice.get('/api/notifications')).json.notifications;
    assert.deepEqual(note[0].link, { place: b, tab: 'messages' });
    assert.equal((await alice.post('/api/places/messages/read', { b })).json.unread, 0);
    assert.equal((await alice.get(`/api/places/place/${b}`)).json.inbox.unread, 0);
    assert.equal((await bob.post('/api/places/messages/delete', { id: m.messages[0].id })).status, 404, 'nobody else deletes it');
    assert.equal((await alice.post('/api/places/messages/delete', { id: m.messages[0].id })).status, 200);
    assert.equal((await alice.get(`/api/places/messages?b=${b}`)).json.messages.length, 0);

    // the city's own building: its administrators read the messages, and don't review it
    assert.equal((await owner.post('/api/places/review', { b: city, stars: 5 })).json.code, 'own_place');
    assert.equal((await bob.post('/api/places/message', { b: city, text: 'The park needs benches' })).status, 200);
    assert.equal((await owner.get(`/api/places/messages?b=${city}`)).json.messages[0].text, 'The park needs benches');
    assert.equal((await alice.get(`/api/places/messages?b=${city}`)).status, 403);
    assert.equal((await owner.get(`/api/places/place/${city}`)).json.mine, true);

    // an administrator takes Carol's review down: it leaves the rating, she reads why and can't undo it
    const carolsId = seen.reviews.find(x => x.mine).id;
    assert.equal((await bob.post('/api/places/review/hide', { id: carolsId, reason: 'x' })).status, 403);
    assert.equal((await owner.post('/api/places/review/hide', { id: carolsId })).status, 400, 'a reason');
    r = await owner.post('/api/places/review/hide', { id: carolsId, reason: 'Not about the place' });
    assert.equal(r.status, 200); assert.deepEqual(r.json.rating, { avg: 5, n: 1 });
    const c2 = (await carol.get(`/api/places/place/${b}`)).json;
    assert.equal(c2.myReview.hidden, 'Not about the place'); assert.equal(c2.reviews.length, 1);
    assert.equal((await carol.post('/api/places/review', { b, stars: 5 })).status, 409);
    assert.equal((await carol.post('/api/places/review/delete', { b })).status, 409);
    assert.equal((await owner.get(`/api/places/place/${b}`)).json.hidden.length, 1, 'administrators see what was taken down');
    assert.deepEqual((await owner.post('/api/places/review/hide', { id: carolsId, show: true })).json.rating, { avg: 3.5, n: 2 });

    // Bob takes his review back; then Bob's account is deleted with his message to the city
    assert.deepEqual((await bob.post('/api/places/review/delete', { b })).json.rating, { avg: 2, n: 1 });
    assert.equal((await bob.post('/api/places/review', { b, stars: 4 })).status, 200);
    assert.equal((await owner.post('/api/users/delete', { id: bob.id, data: 'delete' })).status, 200);
    assert.deepEqual((await guest.get('/api/places/ratings')).json.ratings, { [b]: { avg: 2, n: 1 } }, 'his review left with him');
    assert.equal((await owner.get(`/api/places/messages?b=${city}`)).json.messages.length, 0, 'and his messages');

    // too many messages at once are slowed down
    const codes = [];
    for (let i = 0; i < 6; i++) codes.push((await carol.post('/api/places/message', { b, text: `Note ${i}` })).status);
    assert.deepEqual(codes, [200, 200, 200, 200, 200, 429]);
  } finally { await s.stop(); fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(`${dir}.key`, { force: true }); }
});

// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The city's own music in the background (client/js/audio/score.js; shared/music.js, 2026-10-26): the mood of the moment
// (building, else day, evening, night by the hour), the songs for it (the score's approved ones; any when none has that
// mood), and the next song (never the one playing, nor the last of its mood when there is a choice). The game's
// soundtrack has songs for every mood, each with loop points.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { SCORE, scoreMood, scoreTracks, scoreNext } from '../shared/music.js';
import { SOUNDTRACK_DIR } from '../server/music/soundtrack.js';

test('the mood: building, else by the hour (day from 5:30, evening from 17:30, night from 20:30)', () => {
  assert.equal(scoreMood(12, true), 'build');
  for (const [h, m] of [[5.4, 'night'], [5.5, 'day'], [12, 'day'], [17.49, 'day'], [17.5, 'evening'], [20.4, 'evening'], [20.5, 'night'], [23.9, 'night'], [0, 'night'], [26, 'night'], [-1, 'night']]) assert.equal(scoreMood(h), m, `${h}`);
});

test('the songs for a mood, and the next one', () => {
  const T = (id, genre, mood, extra = {}) => ({ id, genre, mood, seconds: 70, ...extra });
  const lib = [T('a', 'score', 'day'), T('b', 'score', 'day'), T('c', 'score', 'night'), T('j', 'jazz', 'day'), T('p', 'score', 'day', { status: 'pending' }), T('s', 'score', 'day', { seconds: 4 })];
  assert.deepEqual(scoreTracks(lib, 'day').map(t => t.id), ['a', 'b'], 'the score\'s approved songs of that mood only');
  assert.deepEqual(scoreTracks(lib, 'evening').map(t => t.id).sort(), ['a', 'b', 'c'], 'none of that mood: any of the score');
  assert.deepEqual(scoreTracks([T('j', 'jazz', 'day')], 'day'), [], 'no score: nothing');
  const day = scoreTracks(lib, 'day');
  for (let i = 0; i < 20; i++) assert.equal(scoreNext(day, 'a', null, () => i / 20).id, 'b', 'never the one playing');
  assert.equal(scoreNext([T('a', 'score', 'day'), T('b', 'score', 'day'), T('x', 'score', 'day')], 'a', 'b', () => 0.99).id, 'x', 'nor the last of its mood when there is a choice');
  assert.equal(scoreNext([T('a', 'score', 'day')], 'a', null).id, 'a', 'only one: it again');
  assert.equal(scoreNext([], null), null);
  assert.ok(SCORE.turn[0] >= 120 && SCORE.turn[1] > SCORE.turn[0] && SCORE.fade > SCORE.quick);
});

test('the game\'s soundtrack has the score\'s moods, every one with loop points inside the song', () => {
  const list = JSON.parse(fs.readFileSync(`${SOUNDTRACK_DIR}/soundtrack.json`, 'utf8')).tracks.filter(t => t.genre === 'score');
  for (const m of ['day', 'evening', 'night', 'build']) assert.ok(list.some(t => t.mood === m), `a ${m} song`);
  for (const t of list) assert.ok(Array.isArray(t.loop) && t.loop[0] >= 0 && t.loop[1] - t.loop[0] > 30, `${t.title}: loop ${t.loop}`);
});

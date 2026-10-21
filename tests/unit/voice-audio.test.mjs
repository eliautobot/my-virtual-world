// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Audio read from its bytes (server/voice/audio.js) and the text a voice reads (server/voice/text.js), docs/features/
// CHAT.md §9: every format a browser records or a service sends is known by its first bytes; its length is read from the
// file itself (WAV, MP3 frames, Ogg's last granule, a browser's WebM without a Duration, MP4's mvhd, FLAC's STREAMINFO),
// so the installation's voice is metered on what was really heard or spoken; pieces join into one file; a Markdown answer
// becomes words worth hearing.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sniff, seconds, wavFromPcm, wavInfo, joinWav, joinMp3 } from '../../server/voice/audio.js';
import { speakable } from '../../server/voice/text.js';
import { mp3, webm } from '../helpers/audio.mjs';

const near = (a, b, msg) => assert.ok(a !== null && Math.abs(a - b) < 0.011, `${msg}: ${a} ≠ ${b}`);

function ogg(seconds, preSkip = 312) {
  const page = (granule, data) => {
    const h = Buffer.alloc(27); h.write('OggS', 0, 'latin1'); h.writeBigInt64LE(BigInt(granule), 6); h[26] = 1;
    return Buffer.concat([h, Buffer.from([data.length]), data]);
  };
  const head = Buffer.alloc(19); head.write('OpusHead', 0, 'latin1'); head[8] = 1; head[9] = 1; head.writeUInt16LE(preSkip, 10); head.writeUInt32LE(48000, 12);
  return Buffer.concat([page(0, head), page(48000, Buffer.alloc(50)), page(Math.round(seconds * 48000) + preSkip, Buffer.alloc(50))]);
}
function mp4(timescale, duration) {
  const box = (type, payload) => { const h = Buffer.alloc(8); h.writeUInt32BE(8 + payload.length); h.write(type, 4, 'latin1'); return Buffer.concat([h, payload]); };
  const mvhd = Buffer.alloc(100); mvhd.writeUInt32BE(timescale, 12); mvhd.writeUInt32BE(duration, 16);
  return Buffer.concat([box('ftyp', Buffer.from('M4A \0\0\0\0isom', 'latin1')), box('moov', box('mvhd', mvhd))]);
}
function flac(rate, total) {
  const si = Buffer.alloc(34);
  si[10] = (rate >> 12) & 0xff; si[11] = (rate >> 4) & 0xff; si[12] = ((rate & 0x0f) << 4) | (0 << 1) | 0; si[13] = 0xf0 | Math.floor(total / 2 ** 32);
  si.writeUInt32BE(total % 2 ** 32, 14);
  return Buffer.concat([Buffer.from('fLaC'), Buffer.from([0x80, 0, 0, 34]), si]);
}

test('formats by their first bytes, never by what the sender says', () => {
  assert.deepEqual(sniff(wavFromPcm(Buffer.alloc(100))), { format: 'wav', mime: 'audio/wav' });
  assert.deepEqual(sniff(mp3(2)), { format: 'mp3', mime: 'audio/mpeg' });
  assert.deepEqual(sniff(mp3(2, true)), { format: 'mp3', mime: 'audio/mpeg' });
  assert.deepEqual(sniff(ogg(1)), { format: 'ogg', mime: 'audio/ogg' });
  assert.deepEqual(sniff(webm(1500)), { format: 'webm', mime: 'audio/webm' });
  assert.deepEqual(sniff(mp4(1000, 2000)), { format: 'mp4', mime: 'audio/mp4' });
  assert.deepEqual(sniff(flac(44100, 44100)), { format: 'flac', mime: 'audio/flac' });
  assert.equal(sniff(Buffer.from('<html><body>hello</body></html>')), null);
  assert.equal(sniff(Buffer.alloc(4)), null);
});

test('how long it lasts, read from the file: WAV, MP3 frames, Ogg Opus, a browser\'s WebM, MP4, FLAC', () => {
  near(seconds(wavFromPcm(Buffer.alloc(24000 * 2 * 3), { rate: 24000 })), 3, 'WAV');
  near(seconds(mp3(383)), 383 * 1152 / 44100, 'MP3 (CBR)');
  near(seconds(mp3(10, true)), 10 * 1152 / 44100, 'MP3 after an ID3 tag');
  near(seconds(ogg(2.5)), 2.5, 'Ogg Opus (less its pre-skip)');
  near(seconds(webm(2480)), 2.5, 'WebM: the last block + one frame');
  near(seconds(mp4(44100, 44100 * 4)), 4, 'MP4 mvhd');
  near(seconds(flac(16000, 16000 * 7)), 7, 'FLAC STREAMINFO');
  assert.equal(seconds(mp4(1000, 0)), null, 'a fragmented MP4 that says 0: not known');
  assert.equal(seconds(Buffer.from('nothing')), null);
  // a WAV streamed before its length was known (data size 0xffffffff) runs to the end of the file
  const w = wavFromPcm(Buffer.alloc(16000 * 2), { rate: 16000 }); w.writeUInt32LE(0xffffffff, 40);
  near(seconds(w), 1, 'WAV of unknown length');
  // broken input ends the walk instead of looping
  const junk = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(5000, 0xff)]);
  assert.doesNotThrow(() => seconds(junk));
});

test('pieces joined into one file: WAVs of one format; MP3s with only the first piece\'s tag', () => {
  const a = wavFromPcm(Buffer.alloc(2400), { rate: 24000 }), b = wavFromPcm(Buffer.alloc(4800), { rate: 24000 });
  const j = joinWav([a, b]);
  assert.equal(wavInfo(j).data.length, 7200); near(seconds(j), 0.15, 'joined WAV');
  assert.throws(() => joinWav([a, wavFromPcm(Buffer.alloc(100), { rate: 16000 })]), /different formats/);
  const m = joinMp3([mp3(3, true), mp3(4, true)]);
  assert.equal(m.length, 14 + 7 * 417, 'the second tag dropped'); near(seconds(m), 7 * 1152 / 44100, 'joined MP3');
});

test('what a voice reads: Markdown made pronounceable — no marks, links as their text, code and tables named, emoji gone', () => {
  const md = '## Your plan\n\nHere is **the** _plan_ — see [the docs](https://example.com/docs) or https://www.openai.com/x.\n\n'
    + '- [x] Buy milk\n- [ ] Call Mia 📞\n1. First\n2. Second\n\n```python\nprint("hello")\n```\n\n| Day | Food | Price |\n|---|---|---|\n| Mon | Soup | 3 |\n| Tue | Rice | 4 |\n\n> A quote.\n\n---\n\n![a red bike](x.png) and `npm test`.';
  const s = speakable(md);
  assert.equal(s, 'Your plan. Here is the plan — see the docs or openai.com. Buy milk. Call Mia. First. Second. (There is a python code block here.) '
    + '(A table with 2 rows: Day, Food, Price.) A quote. (picture: a red bike) and npm test.');
  assert.ok(!/[*_#|`]/.test(s));
  assert.equal(speakable('Plain words stay as they are.'), 'Plain words stay as they are.');
  const long = 'This sentence is here. '.repeat(300);
  const cut = speakable(long, 1000);
  assert.ok(cut.length <= 1000 && cut.endsWith('.'), 'cut at a sentence');
  assert.equal(speakable('```\nunfinished code'), '(There is a code block here.)', 'an unfinished fence (a streaming answer) is still not read');
  assert.equal(speakable(''), '');
});

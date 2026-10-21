// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Small audio files for the voice tests (docs/features/CHAT.md §9).
import { wavFromPcm } from '../../server/voice/audio.js';

/** n frames of a 128 kbit/s 44.1 kHz MPEG-1 layer III stream (417 bytes each, 1,152 samples), optionally after an ID3 tag. */
export const mp3 = (n, id3 = false) => {
  const f = Buffer.alloc(417); f[0] = 0xff; f[1] = 0xfb; f[2] = 0x90; f[3] = 0x64;
  const tag = Buffer.from([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 4, 1, 2, 3, 4]);
  return Buffer.concat([...(id3 ? [tag] : []), ...Array.from({ length: n }, () => f)]);
};
/** secs of silence as a 24 kHz mono WAV. */
export const wav = (secs, rate = 24000) => wavFromPcm(Buffer.alloc(Math.round(secs * rate) * 2), { rate });
/** A browser's WebM/Opus recording that lasts lastMs + 20 ms: Segment and Clusters of unknown size, no Duration, blocks
 *  20 ms apart, a second cluster at 1 s. */
export function webm(lastMs) {
  const UNKNOWN = Buffer.from([0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
  const idb = id => Buffer.from(id.toString(16).padStart(id > 0xffffff ? 8 : id > 0xffff ? 6 : id > 0xff ? 4 : 2, '0'), 'hex');
  const el = (id, payload) => { const s = Buffer.alloc(8); s[0] = 0x01; s.writeUInt32BE(payload.length, 4); return Buffer.concat([idb(id), s, payload]); };
  const uint = (n, w = 4) => { const b = Buffer.alloc(w); b.writeUIntBE(n, 0, w); return b; };
  const block = rel => { const t = Buffer.alloc(2); t.writeInt16BE(rel); return el(0xa3, Buffer.concat([Buffer.from([0x81]), t, Buffer.from([0x80]), Buffer.alloc(30)])); };
  return Buffer.concat([
    el(0x1a45dfa3, Buffer.alloc(8)),
    idb(0x18538067), UNKNOWN,
    el(0x1549a966, el(0x2ad7b1, uint(1000000, 3))),
    idb(0x1f43b675), UNKNOWN, el(0xe7, uint(0)), block(0), block(20), block(40),
    idb(0x1f43b675), UNKNOWN, el(0xe7, uint(1000)), block(0), block(lastMs - 1000),
  ]);
}

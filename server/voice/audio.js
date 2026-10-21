// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Audio as bytes, for the voice services (docs/features/CHAT.md §9): what a recording or a spoken answer is (by its first
// bytes, not by what the sender says), how long it lasts (read from the file itself, so the installation's voice is
// metered on what was really heard or spoken, never on what a page claims), and the joins a service that speaks in short
// pieces needs (WAV from raw PCM, WAVs and MP3s one after another). No library: each container's own layout, bounded so a
// malformed file ends the walk instead of looping. Used by the server (an upload's length) and by the provider helper
// (server/providers/voice.js: the pieces of an answer joined into one file).

/** The format of an audio file by its first bytes: { format, mime } or null. */
export function sniff(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  const s4 = buf.toString('latin1', 0, 4);
  if (s4 === 'RIFF' && buf.toString('latin1', 8, 12) === 'WAVE') return { format: 'wav', mime: 'audio/wav' };
  if (s4 === 'OggS') return { format: 'ogg', mime: 'audio/ogg' };
  if (s4 === 'fLaC') return { format: 'flac', mime: 'audio/flac' };
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return { format: 'webm', mime: 'audio/webm' };
  if (buf.toString('latin1', 4, 8) === 'ftyp') return { format: 'mp4', mime: 'audio/mp4' };
  if (buf.toString('latin1', 0, 3) === 'ID3' || mp3Header(buf, 0)) return { format: 'mp3', mime: 'audio/mpeg' };
  if (buf[0] === 0xff && (buf[1] & 0xf6) === 0xf0) return { format: 'aac', mime: 'audio/aac' };   // ADTS
  return null;
}

// ------------------------------------------------------------------------------------------- WAV
/** A WAV file around 16-bit little-endian PCM. */
export function wavFromPcm(pcm, { rate = 24000, channels = 1, bits = 16 } = {}) {
  const h = Buffer.alloc(44), block = channels * bits / 8;
  h.write('RIFF', 0, 'latin1'); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8, 'latin1');
  h.write('fmt ', 12, 'latin1'); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(channels, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * block, 28); h.writeUInt16LE(block, 32); h.writeUInt16LE(bits, 34);
  h.write('data', 36, 'latin1'); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}
/** A WAV file's format and where its samples are: { rate, channels, bits, byteRate, data: Buffer } or null. */
export function wavInfo(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12 || buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WAVE') return null;
  let p = 12, fmt = null;
  for (let n = 0; p + 8 <= buf.length && n < 64; n++) {
    const id = buf.toString('latin1', p, p + 4);
    let size = buf.readUInt32LE(p + 4);
    const start = p + 8;
    if (id === 'fmt ' && start + 16 <= buf.length) fmt = { channels: buf.readUInt16LE(start + 2), rate: buf.readUInt32LE(start + 4), byteRate: buf.readUInt32LE(start + 8), bits: buf.readUInt16LE(start + 14) };
    if (id === 'data') {
      // a stream written before its length was known says 0 or 0xffffffff: the data runs to the end of the file
      if (size === 0 || size === 0xffffffff || start + size > buf.length) size = buf.length - start;
      return fmt ? { ...fmt, data: buf.subarray(start, start + size) } : null;
    }
    p = start + size + (size & 1);
  }
  return null;
}
/** WAVs of one format, one after another, as one WAV (a service that speaks at most a few hundred characters a call). */
export function joinWav(list) {
  const parts = list.map(wavInfo);
  if (!parts.length || parts.some(x => !x)) throw Object.assign(new Error('The service sent audio that could not be joined'), { code: 'provider_error' });
  const f = parts[0];
  if (parts.some(x => x.rate !== f.rate || x.channels !== f.channels || x.bits !== f.bits)) throw Object.assign(new Error('The service sent pieces in different formats'), { code: 'provider_error' });
  return wavFromPcm(Buffer.concat(parts.map(x => x.data)), f);
}

// ------------------------------------------------------------------------------------------- MP3
const MP3_BITRATE = {   // kbit/s by [version 1 | 2/2.5][index] for layer III
  1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0],
  2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0],
};
const MP3_RATE = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };   // by version bits
/** The MPEG layer III frame header at p: { len, samples, rate } or null. */
function mp3Header(buf, p) {
  if (p + 4 > buf.length || buf[p] !== 0xff || (buf[p + 1] & 0xe0) !== 0xe0) return null;
  const ver = (buf[p + 1] >> 3) & 3, layer = (buf[p + 1] >> 1) & 3, bi = (buf[p + 2] >> 4) & 15, ri = (buf[p + 2] >> 2) & 3, pad = (buf[p + 2] >> 1) & 1;
  if (ver === 1 || layer !== 1 || bi === 0 || bi === 15 || ri === 3) return null;   // (reserved, not layer III, free or bad)
  const kbps = MP3_BITRATE[ver === 3 ? 1 : 2][bi], rate = MP3_RATE[ver][ri];
  const samples = ver === 3 ? 1152 : 576;
  const len = Math.floor((samples / 8) * kbps * 1000 / rate) + pad;
  return len > 4 ? { len, samples, rate } : null;
}
/** Where an MP3's frames start (after an ID3v2 tag). */
function id3Size(buf) {
  if (buf.length < 10 || buf.toString('latin1', 0, 3) !== 'ID3') return 0;
  const size = ((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f);
  return Math.min(buf.length, 10 + size + ((buf[5] & 0x10) ? 10 : 0));
}
function mp3Seconds(buf) {
  let p = id3Size(buf), samples = 0, rate = 0, frames = 0;
  for (let guard = 0; p + 4 <= buf.length && guard < 2e6; guard++) {
    const f = mp3Header(buf, p);
    if (!f) { p++; continue; }   // (junk between frames: look for the next sync)
    samples += f.samples; rate = f.rate; frames++; p += f.len;
  }
  return frames && rate ? samples / rate : null;
}
/** MP3s one after another (each piece's tags dropped but the first's): frames simply follow each other. */
export function joinMp3(list) {
  return Buffer.concat(list.map((b, i) => {
    let s = i === 0 ? 0 : id3Size(b), e = b.length;
    if (e - s >= 128 && b.toString('latin1', e - 128, e - 125) === 'TAG') e -= 128;   // an ID3v1 tag at the end
    return b.subarray(s, e);
  }));
}

// ------------------------------------------------------------------------------------------- Ogg, FLAC, WebM, MP4
function oggSeconds(buf) {
  // the last page's granule position is the sample count (Opus: at 48 kHz, less its pre-skip; Vorbis: at its own rate)
  let rate = 48000, preSkip = 0;
  const head = buf.indexOf('OpusHead', 0, 'latin1');
  if (head >= 0 && head + 16 <= buf.length) preSkip = buf.readUInt16LE(head + 10);
  else {
    const v = buf.indexOf('\x01vorbis', 0, 'latin1');
    if (v < 0 || v + 16 > buf.length) return null;
    rate = buf.readUInt32LE(v + 12);
  }
  for (let p = buf.lastIndexOf('OggS', buf.length - 1, 'latin1'); p >= 0; p = buf.lastIndexOf('OggS', p - 1, 'latin1')) {
    if (p + 14 > buf.length) continue;
    const g = Number(buf.readBigInt64LE(p + 6));
    if (g > 0 && rate > 0) return Math.max(0, g - preSkip) / rate;
    if (p === 0) break;
  }
  return null;
}
function flacSeconds(buf) {
  if (buf.length < 42) return null;   // STREAMINFO: sample rate (20 bits) and total samples (36 bits)
  const b = buf.subarray(18, 26);
  const rate = (b[0] << 12) | (b[1] << 4) | (b[2] >> 4);
  const total = ((b[3] & 0x0f) * 2 ** 32) + b.readUInt32BE(4);
  return rate && total ? total / rate : null;
}
/** An EBML variable-length number at p: { value, len, unknown } (the size of a live recording's segment is "unknown"). */
function vint(buf, p, keepMarker = false) {
  if (p >= buf.length) return null;
  const first = buf[p];
  let len = 1;
  while (len <= 8 && !(first & (0x80 >> (len - 1)))) len++;
  if (len > 8 || p + len > buf.length) return null;
  let value = keepMarker ? first : first & (0xff >> len), all = (first & (0xff >> len)) === (0xff >> len);
  for (let i = 1; i < len; i++) { value = value * 256 + buf[p + i]; if (buf[p + i] !== 0xff) all = false; }
  return { value, len, unknown: all };
}
function webmSeconds(buf) {
  // a browser's recording (MediaRecorder) has no Duration: the last block's time is how long it lasts
  const SEGMENT = 0x18538067, CLUSTER = 0x1f43b675, INFO = 0x1549a966, SCALE = 0x2ad7b1, DURATION = 0x4489, TIMECODE = 0xe7, SIMPLE = 0xa3, GROUP = 0xa0, BLOCK = 0xa1;
  const CONTAINERS = new Set([SEGMENT, CLUSTER, INFO, GROUP]);
  let scale = 1e6, duration = null, cluster = 0, last = null, p = 0;
  const readUint = (s, n) => { let v = 0; for (let i = 0; i < n; i++) v = v * 256 + buf[s + i]; return v; };
  for (let guard = 0; p < buf.length && guard < 5e5; guard++) {
    const id = vint(buf, p, true); if (!id) break;
    const size = vint(buf, p + id.len); if (!size) break;
    const start = p + id.len + size.len, end = size.unknown ? buf.length : start + size.value;
    if (CONTAINERS.has(id.value)) { p = start; continue; }   // step inside
    if (end > buf.length) break;
    if (id.value === SCALE) scale = readUint(start, size.value);
    else if (id.value === DURATION) duration = size.value === 4 ? buf.readFloatBE(start) : size.value === 8 ? buf.readDoubleBE(start) : null;
    else if (id.value === TIMECODE) cluster = readUint(start, size.value);
    else if (id.value === SIMPLE || id.value === BLOCK) {
      const track = vint(buf, start);
      if (track && start + track.len + 2 <= buf.length) { const t = cluster + buf.readInt16BE(start + track.len); if (last === null || t > last) last = t; }
    }
    p = end;
  }
  if (duration && duration > 0) return duration * scale / 1e9;
  return last !== null ? last * scale / 1e9 + 0.02 : null;   // (+ the last frame: Opus frames are 20 ms)
}
function mp4Seconds(buf) {
  // moov → mvhd: duration / timescale (a fragmented recording may say 0: then not known here)
  const find = (s, e, type) => {
    for (let p = s, n = 0; p + 8 <= e && n < 4096; n++) {
      let size = buf.readUInt32BE(p);
      const t = buf.toString('latin1', p + 4, p + 8);
      let hdr = 8;
      if (size === 1 && p + 16 <= e) { size = Number(buf.readBigUInt64BE(p + 8)); hdr = 16; } else if (size === 0) size = e - p;
      if (size < hdr) return null;
      if (t === type) return { start: p + hdr, end: Math.min(e, p + size) };
      p += size;
    }
    return null;
  };
  const moov = find(0, buf.length, 'moov'); if (!moov) return null;
  const mvhd = find(moov.start, moov.end, 'mvhd'); if (!mvhd) return null;
  const v = buf[mvhd.start], o = mvhd.start + 4;
  if (v === 1 && o + 28 <= buf.length) { const ts = buf.readUInt32BE(o + 16), d = Number(buf.readBigUInt64BE(o + 20)); return ts && d ? d / ts : null; }
  if (o + 16 <= buf.length) { const ts = buf.readUInt32BE(o + 8), d = buf.readUInt32BE(o + 12); return ts && d && d !== 0xffffffff ? d / ts : null; }
  return null;
}

/** How long an audio file lasts, in seconds, read from the file; null when its container does not say. */
export function seconds(buf, format = sniff(buf)?.format) {
  try {
    switch (format) {
      case 'wav': { const w = wavInfo(buf); return w && w.byteRate ? w.data.length / w.byteRate : null; }
      case 'mp3': return mp3Seconds(buf);
      case 'ogg': return oggSeconds(buf);
      case 'flac': return flacSeconds(buf);
      case 'webm': return webmSeconds(buf);
      case 'mp4': return mp4Seconds(buf);
      default: return null;
    }
  } catch { return null; }
}

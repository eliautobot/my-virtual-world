// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// A song for the library (server/music/music.js): with ffmpeg on this machine, any common audio file is converted to one
// MP3 (192 kbit/s, 48 kHz, stereo, no tags or pictures) at the library's loudness (-16 LUFS by one fixed gain, lower if
// a peak would pass -1.5 dB). Without ffmpeg (the official image has none) only MP3 files are taken, kept as they are;
// their length is read from the file and their loudness as measured by the uploader's browser (the gain, played).
import { spawn, spawnSync } from 'node:child_process';
import { MUSIC } from '../../shared/music.js';

let ff = null;
/** Whether ffmpeg and ffprobe are on this machine (asked once). */
export function hasFfmpeg() {
  if (ff === null) {
    try { ff = spawnSync('ffmpeg', ['-version'], { timeout: 5000 }).status === 0 && spawnSync('ffprobe', ['-version'], { timeout: 5000 }).status === 0; } catch { ff = false; }
  }
  return ff;
}
export function setFfmpeg(v) { ff = v; }   // (tests: the path without it)

function run(cmd, args, ms = 120000) {
  return new Promise(resolve => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    const t = setTimeout(() => p.kill('SIGKILL'), ms);
    p.stdout.on('data', d => { if (out.length < 1e6) out += d; });
    p.stderr.on('data', d => { err += d; if (err.length > 4e5) err = err.slice(-2e5); });
    p.on('error', e => { clearTimeout(t); resolve({ code: -1, out, err: String(e.message) }); });
    p.on('close', code => { clearTimeout(t); resolve({ code, out, err }); });
  });
}

/** { seconds, audio } of a file (ffprobe), or null when it holds no audio it can read. */
export async function probe(file) {
  const r = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', file], 30000);
  if (r.code !== 0) return null;
  try {
    const j = JSON.parse(r.out), seconds = Number(j.format?.duration);
    if (!(j.streams || []).some(s => s.codec_type === 'audio') || !Number.isFinite(seconds)) return null;
    return { seconds };
  } catch { return null; }
}

/** Converts src to the library's MP3 at dst: { seconds, gain } (the gain it was given, dB), or throws. */
export async function convert(src, dst) {
  const info = await probe(src);
  if (!info) throw Object.assign(new Error('That file has no sound this server can read'), { status: 400, code: 'bad_audio' });
  const m = await run('ffmpeg', ['-hide_banner', '-nostats', '-i', src, '-vn', '-af', 'ebur128=peak=true', '-f', 'null', '-'], 300000);
  const sum = m.err.slice(m.err.lastIndexOf('Summary:'));
  const I = Number(/I:\s+(-?[\d.]+) LUFS/.exec(sum)?.[1]), peak = Number(/Peak:\s+(-?[\d.]+) dBFS/.exec(sum)?.[1]);
  let gain = Number.isFinite(I) ? MUSIC.lufs - I : 0;
  if (Number.isFinite(peak)) gain = Math.min(gain, -1.5 - peak);
  gain = Math.max(-30, Math.min(20, gain));
  const r = await run('ffmpeg', ['-y', '-v', 'error', '-i', src, '-vn', '-map_metadata', '-1', '-af', `volume=${gain.toFixed(2)}dB`,
    '-ac', '2', '-ar', '48000', '-c:a', 'libmp3lame', '-b:a', '192k', '-f', 'mp3', dst], 600000);
  if (r.code !== 0) throw Object.assign(new Error('The song could not be converted'), { status: 400, code: 'bad_audio' });
  const out = await probe(dst);
  return { seconds: out ? out.seconds : info.seconds, gain: Math.round(gain * 10) / 10 };
}

// ------------------------------------------------------------------ without ffmpeg: MP3 files as they are
const BITRATE = { 1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320], 2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160] };
const RATE = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };
/** An MP3's length in seconds from its bytes (the first frame's header, its Xing/Info frame count when there is one),
 *  or null when it is not an MP3 (Layer III). */
export function mp3Seconds(buf) {
  let p = 0;
  if (buf.length > 10 && buf.toString('latin1', 0, 3) === 'ID3') p = 10 + ((buf[6] & 0x7f) << 21 | (buf[7] & 0x7f) << 14 | (buf[8] & 0x7f) << 7 | (buf[9] & 0x7f));
  for (const end = Math.min(buf.length - 4, p + 65536); p < end; p++) {
    if (buf[p] !== 0xff || (buf[p + 1] & 0xe0) !== 0xe0) continue;
    const ver = (buf[p + 1] >> 3) & 3, layer = (buf[p + 1] >> 1) & 3, bi = buf[p + 2] >> 4, si = (buf[p + 2] >> 2) & 3;
    if (ver === 1 || layer !== 1 || bi === 0 || bi === 15 || si === 3) continue;   // (Layer III only)
    const kbps = BITRATE[ver === 3 ? 1 : 2][bi], sr = RATE[ver][si], mono = (buf[p + 3] >> 6) === 3, perFrame = ver === 3 ? 1152 : 576;
    const side = ver === 3 ? (mono ? 17 : 32) : (mono ? 9 : 17), x = p + 4 + side;
    const tag = buf.toString('latin1', x, x + 4);
    if ((tag === 'Xing' || tag === 'Info') && (buf.readUInt32BE(x + 4) & 1)) return buf.readUInt32BE(x + 8) * perFrame / sr;
    return (buf.length - p) * 8 / (kbps * 1000);
  }
  return null;
}

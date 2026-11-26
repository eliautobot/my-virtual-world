// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// An MP3's own tags, read in the browser (2026-11-25: an album or a folder uploaded keeps its songs' titles, artist, album,
// numbers, year and cover — the server's converter drops tags, and the official image has none): ID3v2.2, 2.3 and 2.4
// (TIT2/TT2 title, TPE1/TP1 artist, TPE2/TP2 album artist, TALB/TAL album, TRCK/TRK number, TYER/TDRC/TYE year,
// TCON/TCO genre, APIC/PIC picture), else ID3v1 at the end. Only the tag's own bytes are read, never the whole song.
const dec = (bytes, enc) => {
  try {
    if (enc === 0) return new TextDecoder('latin1').decode(bytes);
    if (enc === 1) return new TextDecoder(bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-16le').decode(bytes[0] === 0xff || bytes[0] === 0xfe ? bytes.subarray(2) : bytes);
    if (enc === 2) return new TextDecoder('utf-16be').decode(bytes);
    return new TextDecoder('utf-8').decode(bytes);
  } catch { return ''; }
};
const tidy = s => String(s || '').replace(/\u0000+$/g, '').split('\u0000')[0].replace(/[\u0000-\u001f]/g, ' ').trim();
/** Where a text with encoding enc ends (its terminator: one zero byte, or two for UTF-16). */
function textEnd(b, from, enc) {
  if (enc === 1 || enc === 2) { for (let i = from; i + 1 < b.length; i += 2) if (b[i] === 0 && b[i + 1] === 0) return i; return b.length; }
  for (let i = from; i < b.length; i++) if (b[i] === 0) return i;
  return b.length;
}
const syncsafe = (b, o) => (b[o] << 21) | (b[o + 1] << 14) | (b[o + 2] << 7) | b[o + 3];
const be32 = (b, o) => ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];

/** The tags of an MP3 file: { title, artist, albumArtist, album, track, year, genre, picture: Blob|null } (only what it has). */
export async function readTags(file) {
  const out = {};
  try {
    const head = new Uint8Array(await file.slice(0, 10).arrayBuffer());
    if (head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) {   // "ID3"
      const ver = head[3], size = syncsafe(head, 6);
      const b = new Uint8Array(await file.slice(10, 10 + Math.min(size, 16 * 1024 * 1024)).arrayBuffer());
      let o = (head[5] & 0x40) && ver >= 3 ? (ver === 4 ? syncsafe(b, 0) : be32(b, 0) + 4) : 0;   // (an extended header)
      const idLen = ver === 2 ? 3 : 4, hdr = ver === 2 ? 6 : 10;
      while (o + hdr <= b.length) {
        const id = String.fromCharCode(...b.subarray(o, o + idLen));
        if (!/^[A-Z0-9]{3,4}$/.test(id)) break;
        const len = ver === 2 ? (b[o + 3] << 16) | (b[o + 4] << 8) | b[o + 5] : ver === 4 ? syncsafe(b, o + 4) : be32(b, o + 4);
        const body = b.subarray(o + hdr, o + hdr + len);
        o += hdr + len;
        if (!len || len > b.length) break;
        const key = { TIT2: 'title', TT2: 'title', TPE1: 'artist', TP1: 'artist', TPE2: 'albumArtist', TP2: 'albumArtist', TALB: 'album', TAL: 'album', TRCK: 'track', TRK: 'track', TYER: 'year', TYE: 'year', TDRC: 'year', TCON: 'genre', TCO: 'genre' }[id];
        if (key && out[key] === undefined) { out[key] = tidy(dec(body.subarray(1), body[0])); continue; }
        if ((id === 'APIC' || id === 'PIC') && !out.picture) {
          const enc = body[0];
          let p = 1, mime;
          if (id === 'PIC') { const f = String.fromCharCode(...body.subarray(1, 4)).toLowerCase(); mime = f === 'png' ? 'image/png' : 'image/jpeg'; p = 4; }
          else { const e = textEnd(body, 1, 0); mime = new TextDecoder('latin1').decode(body.subarray(1, e)).toLowerCase() || 'image/jpeg'; p = e + 1; }
          const kind = body[p]; p += 1;
          const e = textEnd(body, p, enc); p = e + (enc === 1 || enc === 2 ? 2 : 1);
          if (kind === 3 || kind === 0 || !out.picture) out.picture = new Blob([body.subarray(p)], { type: mime.includes('/') ? mime : `image/${mime}` });
        }
      }
    } else {
      const t = new Uint8Array(await file.slice(Math.max(0, file.size - 128)).arrayBuffer());   // ID3v1
      if (t[0] === 0x54 && t[1] === 0x41 && t[2] === 0x47) {
        const s = (a, z) => tidy(new TextDecoder('latin1').decode(t.subarray(a, z)));
        Object.assign(out, { title: s(3, 33), artist: s(33, 63), album: s(63, 93), year: s(93, 97) });
        if (t[125] === 0 && t[126]) out.track = String(t[126]);
      }
    }
  } catch { /* no tags: the file's name */ }
  for (const k of Object.keys(out)) if (out[k] === '' ) delete out[k];
  if (out.track) out.track = Number(String(out.track).split('/')[0]) || undefined;
  if (out.year) out.year = Number(String(out.year).slice(0, 4)) || undefined;
  if (out.genre) out.genre = out.genre.replace(/^\((\d+)\)/, '').trim() || undefined;
  return out;
}

/** An image made ready to send as a cover: a JPEG at most `max` pixels on its longest side (null: not an image). */
export async function coverJpeg(blob, max = 1000) {
  try {
    const bmp = await createImageBitmap(blob), k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k));
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height); bmp.close?.();
    return await new Promise(r => c.toBlob(b => r(b), 'image/jpeg', 0.9));
  } catch { return null; }
}

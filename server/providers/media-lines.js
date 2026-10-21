// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// An agent's media lines (docs/features/agent-providers.md §5 Media, §9): OpenClaw's and Hermes' agents both attach a
// file with a line of its own, `MEDIA:<path or URL>`. They become the universal chat's media - { kind, name, ref: {
// source } } - and the line leaves the text. A line inside a code block is text (an example), as both read it.
// Pure functions, shared by the adapters.
const MEDIA_LINE = /^\s*MEDIA:\s*(.+?)\s*$/i;
const KIND_BY_EXT = [[/\.(png|jpe?g|gif|webp|avif|bmp)$/i, 'image'], [/\.(mp4|webm|mov|m4v|mkv|ogv)$/i, 'video'], [/\.(mp3|wav|ogg|oga|m4a|aac|flac|opus)$/i, 'audio']];
export const baseName = s => String(s || '').replace(/[?#].*$/, '').split(/[\\/]/).pop() || '';
export const kindOfName = n => (KIND_BY_EXT.find(([re]) => re.test(baseName(n))) || [])[1] || 'file';
/** A text without its media lines, and those lines' references: { text, media }. */
export function splitMedia(text) {
  const t = typeof text === 'string' ? text : '';
  if (!/MEDIA:/i.test(t)) return { text: t, media: [] };
  const keep = [], media = [];
  let fence = null;
  for (const line of t.split('\n')) {
    const f = /^\s*(```+|~~~+)/.exec(line);
    if (f) { if (!fence) fence = f[1][0]; else if (f[1][0] === fence) fence = null; keep.push(line); continue; }
    const m = !fence && MEDIA_LINE.exec(line);
    const src = m ? m[1].replace(/^[`'"<]+|[`'">]+$/g, '').trim() : '';
    if (src && src.length <= 2048) { const name = baseName(src).slice(0, 200) || 'attachment'; media.push({ kind: kindOfName(name), name, ref: { source: src } }); }
    else keep.push(line);
  }
  return { text: keep.join('\n').replace(/\n{3,}/g, '\n\n').trim(), media };
}
/** Media from several places as one list: the same artifact or file once (a kept block wins over a path to the same file). */
export function mergeMedia(...lists) {
  const out = [];
  for (const m of lists.flat()) {
    if (!m || !m.ref) continue;
    const same = out.findIndex(x => (m.ref.artifactId && x.ref.artifactId === m.ref.artifactId) || (m.ref.source && x.ref.source === m.ref.source)
      || (x.name === m.name && (x.ref.artifactId ? m.ref.source : x.ref.source)));
    if (same < 0) out.push(m);
    else if (m.ref.artifactId && !out[same].ref.artifactId) out[same] = m;
  }
  return out.slice(0, 24);
}

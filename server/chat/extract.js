// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// What a chat attachment says, for a model that reads text (docs/features/CHAT.md §4). Word, Excel and PowerPoint files
// (.docx .xlsx .pptx) and their OpenDocument cousins (.odt .ods .odp) are ZIP archives of XML: read here with node's own
// zlib, no library — the text of each paragraph, sheet row and slide, in order. Plain-text and code files are read as
// UTF-8. Images and PDFs are not turned into text: they go to the model as they are (server/providers/models.js parts).
// The old binary Office formats (.doc .xls .ppt) cannot be read; the person is told to save them in the new format.
// Bounded everywhere: the archive's size, each part's inflated size (a "zip bomb" stops at the limit, it never fills
// memory), the number of parts read and the text kept.
import fs from 'node:fs';
import zlib from 'node:zlib';

export const TEXT_KEEP = 120000;          // characters of one file's text given to the model (≈ 30,000 tokens)
const ZIP_MAX = 40 * 1048576;             // an archive larger than this is not opened
const PART_MAX = 30 * 1048576;            // one XML part inflates to at most this
const PARTS_MAX = 400;                    // parts read from one archive (slides, sheets)
const TEXT_EXT = new Set(['txt', 'md', 'csv', 'tsv', 'json', 'xml', 'yaml', 'yml', 'log', 'js', 'mjs', 'ts', 'tsx', 'jsx', 'py', 'rb', 'go', 'rs', 'java',
  'c', 'h', 'cpp', 'cs', 'php', 'sh', 'sql', 'html', 'css', 'toml', 'ini']);
const OLD = { doc: 'docx', xls: 'xlsx', ppt: 'pptx' };

export class ExtractError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const ext = name => (/\.([A-Za-z0-9]{1,5})$/.exec(name || '') || [])[1]?.toLowerCase() || '';

/** How a file goes to the model: 'image', 'pdf', 'text' (extracted here), or null with the reason it can't. */
export function kindOf(name) {
  const e = ext(name);
  if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(e)) return { kind: 'image' };
  if (e === 'pdf') return { kind: 'pdf' };
  if (TEXT_EXT.has(e) || ['docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp'].includes(e)) return { kind: 'text' };
  if (OLD[e]) return { kind: null, why: `Old .${e} files can't be read. Save it as .${OLD[e]} and attach it again.` };
  if (['mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi', '3gp', 'mp3', 'm4a', 'wav', 'ogg', 'oga', 'opus', 'flac', 'aac'].includes(e)) return { kind: null, why: 'Videos and recordings can\'t be read here.' };
  return { kind: null, why: 'This kind of file can\'t be read.' };
}

/** { text, truncated } of a file at `path` named `name` (its type comes from the name, as the store decided). */
export function extractText(path, name) {
  const e = ext(name);
  let text;
  if (TEXT_EXT.has(e)) {
    const fd = fs.openSync(path, 'r');
    try {
      const buf = Buffer.alloc(Math.min(fs.fstatSync(fd).size, TEXT_KEEP * 4));
      fs.readSync(fd, buf, 0, buf.length, 0);
      text = buf.toString('utf8').replace(/^﻿/, '');
      if (buf.includes(0)) throw new ExtractError('binary', 'This file is not text.');
    } finally { fs.closeSync(fd); }
  } else if (['docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp'].includes(e)) {
    const size = fs.statSync(path).size;
    if (size > ZIP_MAX) throw new ExtractError('too_large', 'This document is too large to read.');
    const zip = readZip(fs.readFileSync(path));
    text = e === 'docx' ? docx(zip) : e === 'xlsx' ? xlsx(zip) : e === 'pptx' ? pptx(zip) : odf(zip, e);
  } else {
    const k = kindOf(name);
    throw new ExtractError('unsupported', k.why || 'This kind of file can\'t be read.');
  }
  text = text.replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim();
  return text.length > TEXT_KEEP ? { text: text.slice(0, TEXT_KEEP), truncated: true } : { text, truncated: false };
}

/** extractText() for contents already in memory (the agents' PC keeps files by fingerprint, not by path). */
export function extractBuffer(buf, name) {
  const e = ext(name);
  let text;
  if (TEXT_EXT.has(e)) {
    const part = buf.length > TEXT_KEEP * 4 ? buf.subarray(0, TEXT_KEEP * 4) : buf;
    if (part.includes(0)) throw new ExtractError('binary', 'This file is not text.');
    text = part.toString('utf8').replace(/^﻿/, '');
  } else if (['docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp'].includes(e)) {
    if (buf.length > ZIP_MAX) throw new ExtractError('too_large', 'This document is too large to read.');
    const zip = readZip(buf);
    text = e === 'docx' ? docx(zip) : e === 'xlsx' ? xlsx(zip) : e === 'pptx' ? pptx(zip) : odf(zip, e);
  } else {
    const k = kindOf(name);
    throw new ExtractError('unsupported', k.why || 'This kind of file can\'t be read.');
  }
  text = text.replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim();
  return text.length > TEXT_KEEP ? { text: text.slice(0, TEXT_KEEP), truncated: true } : { text, truncated: false };
}

// ------------------------------------------------------------------ a small ZIP reader
/** The archive's entries: name → () => Buffer (inflated when asked, bounded). */
export function readZip(buf) {
  // the end-of-central-directory record: the last 22 bytes, or before them a comment of up to 65,535 bytes
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new ExtractError('bad_file', 'This document is damaged or not what its name says.');
  const count = buf.readUInt16LE(eocd + 10), cdOff = buf.readUInt32LE(eocd + 16);
  const out = new Map();
  let p = cdOff;
  for (let n = 0; n < count && n < 5000; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new ExtractError('bad_file', 'This document is damaged.');
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    p += 46 + nlen + xlen + clen;
    out.set(name, () => {
      if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50) throw new ExtractError('bad_file', 'This document is damaged.');
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      if (start + csize > buf.length) throw new ExtractError('bad_file', 'This document is damaged.');
      const raw = buf.subarray(start, start + csize);
      if (method === 0) return raw;
      if (method !== 8) throw new ExtractError('bad_file', 'This document uses a compression that can\'t be read.');
      if (usize > PART_MAX) throw new ExtractError('too_large', 'This document is too large to read.');
      try { return zlib.inflateRawSync(raw, { maxOutputLength: PART_MAX }); }
      catch { throw new ExtractError('too_large', 'This document is too large or damaged.'); }
    });
  }
  return out;
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'' };
const decode = s => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, k) => {
  if (k[0] === '#') { const c = k[1] === 'x' || k[1] === 'X' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10); return Number.isFinite(c) && c >= 0 && c <= 0x10ffff ? String.fromCodePoint(c) : ''; }
  return ENT[k.toLowerCase()] ?? m;
});
const xml = (zip, name) => { const f = zip.get(name); return f ? f().toString('utf8') : null; };
const strip = s => decode(s.replace(/<[^>]*>/g, ''));
const byNumber = (a, b) => (Number(/(\d+)\.xml$/.exec(a)?.[1]) || 0) - (Number(/(\d+)\.xml$/.exec(b)?.[1]) || 0);

/** Word: paragraphs in order, tabs and line breaks kept, table cells separated by " | ". */
function wordText(x) {
  return strip(x.replace(/<w:tab\/>/g, '\t').replace(/<w:br[^>]*\/>/g, '\n').replace(/<\/w:p>(\s*<\/w:tc>)/g, '$1').replace(/<\/w:tc>/g, ' | ')
    .replace(/<\/w:p>/g, '\n').replace(/<\/w:tr>/g, '\n'));
}
function docx(zip) {
  const body = xml(zip, 'word/document.xml');
  if (body === null) throw new ExtractError('bad_file', 'This is not a Word document.');
  const extra = [...zip.keys()].filter(n => /^word\/(header|footer|footnotes|endnotes)\d*\.xml$/.test(n)).sort().slice(0, 20);
  return [wordText(body), ...extra.map(n => wordText(xml(zip, n) || '')).filter(t => t.trim())].join('\n\n');
}

/** Excel: each sheet by name, then its rows (cells separated by tabs), shared and inline strings resolved. */
function xlsx(zip) {
  const book = xml(zip, 'xl/workbook.xml');
  if (book === null) throw new ExtractError('bad_file', 'This is not an Excel workbook.');
  const shared = [];
  const ss = xml(zip, 'xl/sharedStrings.xml');
  if (ss) for (const m of ss.matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(strip(m[1].replace(/<rPh[\s\S]*?<\/rPh>/g, '')));
  // sheet names in workbook order, and where each one's XML is (the workbook's relationships)
  const rels = new Map();
  const r = xml(zip, 'xl/_rels/workbook.xml.rels') || '';
  for (const m of r.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /Id="([^"]+)"/.exec(m[0])?.[1], target = /Target="([^"]+)"/.exec(m[0])?.[1];
    if (id && target) rels.set(id, target.replace(/^\/?(xl\/)?/, 'xl/'));
  }
  const sheets = [...book.matchAll(/<sheet\b[^>]*>/g)].map((m, i) => ({
    name: decode(/name="([^"]*)"/.exec(m[0])?.[1] || `Sheet ${i + 1}`),
    file: rels.get(/r:id="([^"]+)"/.exec(m[0])?.[1]) || `xl/worksheets/sheet${i + 1}.xml`,
  })).slice(0, PARTS_MAX);
  const out = [];
  let size = 0;
  for (const s of sheets) {
    const x = xml(zip, s.file);
    if (x === null) continue;
    const rows = [`## Sheet: ${s.name}`];
    for (const row of x.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells = [];
      for (const c of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1], inner = c[2] || '', t = /\bt="([^"]+)"/.exec(attrs)?.[1];
        const col = /\br="([A-Z]+)\d+"/.exec(attrs)?.[1];
        if (col) { let n = 0; for (const ch of col) n = n * 26 + ch.charCodeAt(0) - 64; while (cells.length < n - 1) cells.push(''); }
        const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
        cells.push(t === 's' ? (shared[Number(v)] ?? '') : t === 'inlineStr' ? strip(inner) : v !== undefined ? decode(v) : '');
      }
      while (cells.length && cells[cells.length - 1] === '') cells.pop();
      if (cells.length) { const l = cells.join('\t'); rows.push(l); size += l.length; }
      if (size > TEXT_KEEP) break;
    }
    out.push(rows.join('\n'));
    if (size > TEXT_KEEP) break;
  }
  return out.join('\n\n');
}

/** PowerPoint: each slide's text in order (paragraphs on their own lines), then its speaker notes. */
function pptx(zip) {
  const slides = [...zip.keys()].filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort(byNumber).slice(0, PARTS_MAX);
  if (!slides.length && !zip.has('ppt/presentation.xml')) throw new ExtractError('bad_file', 'This is not a PowerPoint presentation.');
  const para = x => strip(x.replace(/<a:br\/>/g, '\n').replace(/<\/a:p>/g, '\n'));
  return slides.map((n, i) => {
    const notes = xml(zip, n.replace('slides/slide', 'notesSlides/notesSlide'));
    const t = para(xml(zip, n) || '').trim(), nt = notes ? para(notes).replace(/^\s*\d+\s*$/m, '').trim() : '';
    return `## Slide ${i + 1}\n${t}${nt ? `\nNotes: ${nt}` : ''}`;
  }).join('\n\n');
}

/** OpenDocument text, spreadsheet or presentation: content.xml, paragraphs and headings on their own lines; a
 *  spreadsheet's rows with tab-separated cells (repeated empty cells not expanded); a presentation by page. */
function odf(zip, e) {
  const x = xml(zip, 'content.xml');
  if (x === null) throw new ExtractError('bad_file', 'This is not an OpenDocument file.');
  const body = x.replace(/<text:tab\/>/g, '\t').replace(/<text:line-break\/>/g, '\n').replace(/<text:s(?: text:c="(\d+)")?\/>/g, (m, n) => ' '.repeat(Math.min(Number(n) || 1, 50)));
  if (e === 'ods') {
    const out = [];
    for (const t of body.matchAll(/<table:table\b([^>]*)>([\s\S]*?)<\/table:table>/g)) {
      const rows = [`## Sheet: ${decode(/table:name="([^"]*)"/.exec(t[1])?.[1] || '')}`];
      for (const row of t[2].matchAll(/<table:table-row\b[^>]*>([\s\S]*?)<\/table:table-row>/g)) {
        const cells = [...row[1].matchAll(/<table:table-cell\b[^>]*?(?:\/>|>([\s\S]*?)<\/table:table-cell>)/g)].map(c => strip((c[1] || '').replace(/<\/text:p>/g, ' ')).trim());
        while (cells.length && cells[cells.length - 1] === '') cells.pop();
        if (cells.length) rows.push(cells.join('\t'));
      }
      out.push(rows.join('\n'));
    }
    return out.join('\n\n');
  }
  if (e === 'odp') return [...body.matchAll(/<draw:page\b[^>]*>([\s\S]*?)<\/draw:page>/g)].slice(0, PARTS_MAX)
    .map((m, i) => `## Slide ${i + 1}\n${strip(m[1].replace(/<\/text:(p|h)>/g, '\n')).trim()}`).join('\n\n');
  return strip(body.replace(/<\/text:(p|h)>/g, '\n').replace(/<\/table:table-cell>/g, ' | ').replace(/<\/table:table-row>/g, '\n'));
}

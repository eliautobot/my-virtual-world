// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// What a voice reads (docs/features/CHAT.md §9.2): an agent's answer is Markdown, written to be seen. Spoken, the marks
// would be read out ("asterisk asterisk") and a code block or a table would be minutes of symbols, so the text is made
// pronounceable first: headings, emphasis and quotes lose their marks, a link is read as its text, an image as its
// description, a code block and a table are named in a few words instead of read, list items become sentences, and
// emoji and stray symbols go. The page reads the same text in the browser's own voice.

const MAX = 4000;

/** The pronounceable text of a Markdown answer (at most `max` characters, cut at a sentence where it can). */
export function speakable(md, max = MAX) {
  let s = String(md ?? '').replace(/\r\n?/g, '\n');
  // fenced code blocks: named, not read (the language if it says)
  s = s.replace(/(^|\n)(`{3,}|~{3,})[ \t]*([\w+#.-]*)[^\n]*\n[\s\S]*?(?:\n\2[ \t]*(?=\n|$)|$)/g, (m, pre, fence, lang) => `${pre}(There is ${lang ? `a ${lang.replace(/^\./, '')}` : 'a'} code block here.)\n`);
  // tables: a header row, a |---| row and rows → "A table with N rows: col, col, col."
  s = s.replace(/(^|\n)((?:[ \t]*\|?[^\n|]*\|[^\n]*\n)[ \t]*\|?[ \t]*:?-{2,}[^\n]*(?:\n[ \t]*\|?[^\n]*\|[^\n]*)*)/g, (m, pre, table) => {
    const rows = table.split('\n').filter(r => r.includes('|'));
    const cells = r => r.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(c => c.trim()).filter(Boolean);
    const head = cells(rows[0] || '').slice(0, 6).map(c => inline(c)).filter(Boolean);
    const n = Math.max(0, rows.length - 2);
    return `${pre}(A table with ${n} ${n === 1 ? 'row' : 'rows'}${head.length ? `: ${head.join(', ')}` : ''}.)\n`;
  });
  const out = [];
  for (let line of s.split('\n')) {
    line = line.replace(/^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/, '$1.')            // headings: a sentence of their own
      .replace(/^\s*>\s?/, '')                                                // quotes
      .replace(/^\s*(?:[-*+]|\d{1,3}[.)])\s+\[[ xX]\]\s+/, '')                // task boxes
      .replace(/^\s*(?:[-*+]|\d{1,3}[.)])\s+/, '')                            // list markers
      .replace(/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/, '');                         // rules
    line = inline(line).trim();
    if (!line) { if (out.length && out[out.length - 1] !== '') out.push(''); continue; }
    // a list item or a heading without its own stop reads as a sentence
    out.push(/[.!?:;…)"'»]$/.test(line) ? line : `${line}.`);
  }
  let text = out.join(' ').replace(/\s+([.,!?;:])/g, '$1').replace(/\.{2,}(?!\.)/g, '.').replace(/\s{2,}/g, ' ').trim();
  if (text.length > max) {
    const cut = text.slice(0, max), at = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
    text = at > max * 0.6 ? cut.slice(0, at + 1) : cut.replace(/\s+\S*$/, '');
  }
  return text;
}

/** Inline Markdown to plain words. */
function inline(s) {
  return String(s)
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, (m, alt) => (alt ? `(picture: ${alt})` : ''))   // images: their description
    .replace(/\[([^\]]+)\]\((?:[^)(]|\([^)]*\))*\)/g, '$1')                            // links: their text
    .replace(/<((?:https?|mailto):[^>\s]+)>/g, (m, u) => hostOf(u))                     // autolinks: the site
    .replace(/\bhttps?:\/\/[^\s)]+/g, u => hostOf(u))                                   // bare links: the site
    .replace(/`([^`]+)`/g, '$1')                                                        // inline code: as written
    .replace(/(\*\*|__)(.+?)\1/g, '$2').replace(/(\*|_)(?=\S)(.+?)(?<=\S)\1/g, '$2')   // strong, emphasis
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/<\/?[a-z][^>]*>/gi, '')                                                   // stray HTML tags
    .replace(/\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*/gu, '')   // emoji
    .replace(/[*_#>|`~^\\]/g, ' ')                                                      // marks left over
    .replace(/\s{2,}/g, ' ');
}
function hostOf(u) {
  try { const x = new URL(u); return x.protocol === 'mailto:' ? x.pathname : x.hostname.replace(/^www\./, ''); } catch { return ''; }
}

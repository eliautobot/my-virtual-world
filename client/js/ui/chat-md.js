// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Markdown for the chat window (docs/features/CHAT.md §7): what an agent writes, as safe HTML. No library: every
// character of the text is escaped first and only the tags made here exist in the result - headings, paragraphs,
// lists (nested, ordered with their start, task boxes), quotes, tables, fenced and indented code, rules, bold, italic,
// strike, inline code, links (http, https and mailto only; opened in a new tab, no referrer), bare web addresses and
// line breaks. Streaming-safe: an unfinished code fence shows what came so far as code; an unfinished link or emphasis
// is shown as typed. Pure (no DOM), so the tests read it in node.

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ESC[c]);
const SAFE_URL = /^(https?:\/\/|mailto:)[^\s<>"']+$/i;

/** A link's address if it is one we open (http, https, mailto), else null. */
export function safeUrl(u) {
  const t = String(u || '').trim().replace(/[\u0000-\u001f\u007f]/g, '');
  return SAFE_URL.test(t) ? t : null;
}

// ------------------------------------------------------------------ inline
/** One line's (or paragraph's) inline Markdown → HTML; `raw` is the unescaped text. */
export function inline(raw) {
  // code spans first: their content is shown as typed
  const parts = [];
  let s = String(raw ?? ''), out = '';
  const re = /(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g;
  let last = 0, m;
  while ((m = re.exec(s))) { parts.push({ t: s.slice(last, m.index) }, { code: m[2].replace(/^ (.*) $/, '$1') }); last = m.index + m[0].length; }
  parts.push({ t: s.slice(last) });
  for (const p of parts) out += p.code !== undefined ? `<code>${escapeHtml(p.code)}</code>` : spans(p.t);
  return out;
}
function spans(t) {
  // links [text](url "title") and <url>, before escaping (their text gets the rest of the treatment)
  let out = '', i = 0;
  const linkRe = /\[([^\]\n]{1,500})\]\(\s*<?([^)\s>]{1,2000})>?(?:\s+"[^"\n]*")?\s*\)|<((?:https?:\/\/|mailto:)[^\s>]{1,2000})>|((?:https?:\/\/|www\.)[^\s<>"'`]{2,2000})/g;
  let m;
  while ((m = linkRe.exec(t))) {
    out += emph(t.slice(i, m.index));
    if (m[1] !== undefined) {
      const u = safeUrl(m[2]);
      out += u ? `<a href="${escapeHtml(u)}" target="_blank" rel="noopener noreferrer nofollow">${emph(m[1])}</a>` : emph(m[0]);
    } else {
      let raw = m[3] || m[4], trail = '';
      if (m[4]) { const tm = /[.,;:!?)\]]+$/.exec(raw); if (tm) { trail = tm[0]; raw = raw.slice(0, -trail.length); } }   // "see https://x.com." ends before the dot
      const u = safeUrl(/^www\./i.test(raw) ? `https://${raw}` : raw);
      out += u ? `<a href="${escapeHtml(u)}" target="_blank" rel="noopener noreferrer nofollow">${escapeHtml(raw)}</a>` : escapeHtml(raw);
      out += escapeHtml(trail);
    }
    i = m.index + m[0].length;
  }
  return out + emph(t.slice(i));
}
function emph(t) {
  let s = escapeHtml(t);
  s = s.replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '<strong>$2</strong>');
  s = s.replace(/(^|[^\w*])\*(?=[^\s*])([^*\n]*?[^\s*])\*(?![\w*])/g, '$1<em>$2</em>');
  s = s.replace(/(^|[^\w_])_(?=[^\s_])([^_\n]*?[^\s_])_(?![\w_])/g, '$1<em>$2</em>');
  s = s.replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>');
  return s.replace(/ {2,}\n|\\\n/g, '<br>').replace(/\n/g, '<br>');
}

// ------------------------------------------------------------------ blocks
const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([\w#+.-]*)[^\n]*$/;
const HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
const QUOTE = /^ {0,3}> ?(.*)$/;
const ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;

/** Text → { html, code: [{ lang, text }] } (code blocks are numbered: the window adds its Copy buttons to them). */
export function render(text) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  const code = [];
  const html = blocks(lines, code);
  return { html, code };
}
/** Only the HTML. */
export const md = text => render(text).html;

function blocks(lines, code) {
  let out = '', i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) { i++; continue; }
    let m;
    if ((m = FENCE.exec(l))) {   // fenced code (an unfinished fence takes the rest: the answer is still being written)
      const mark = m[1], lang = m[2].toLowerCase().slice(0, 20), body = [];
      i++;
      while (i < lines.length && !new RegExp(`^ {0,3}${mark[0]}{${mark.length},}\\s*$`).test(lines[i])) body.push(lines[i++]);
      const open = i >= lines.length;
      i++;
      out += codeBlock(code, lang, body.join('\n'), open);
      continue;
    }
    if (/^( {4}|\t)/.test(l) && !ITEM.test(l)) {   // indented code
      const body = [];
      while (i < lines.length && (/^( {4}|\t)/.test(lines[i]) || !lines[i].trim())) body.push(lines[i++].replace(/^( {4}|\t)/, ''));
      out += codeBlock(code, '', body.join('\n').replace(/\n+$/, ''), false);
      continue;
    }
    if ((m = HEADING.exec(l))) { const n = m[1].length; out += `<h${n}>${inline(m[2])}</h${n}>`; i++; continue; }
    if (RULE.test(l)) { out += '<hr>'; i++; continue; }
    if (QUOTE.test(l)) {
      const body = [];
      while (i < lines.length && lines[i].trim() && (m = QUOTE.exec(lines[i]) || (body.length ? [null, lines[i]] : null))) { body.push(m[1]); i++; }
      out += `<blockquote>${blocks(body, code)}</blockquote>`;
      continue;
    }
    if (l.includes('|') && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      const cells = r => { let t = r.trim(); if (t.startsWith('|')) t = t.slice(1); if (t.endsWith('|') && !t.endsWith('\\|')) t = t.slice(0, -1); return t.split(/(?<!\\)\|/).map(c => c.trim().replace(/\\\|/g, '|')); };
      const head = cells(l), align = cells(lines[i + 1]).map(c => (/^:-+:$/.test(c) ? 'center' : /-+:$/.test(c) ? 'right' : /^:-/.test(c) ? 'left' : ''));
      const st = k => (align[k] ? ` style="text-align:${align[k]}"` : '');
      let t = `<div class="md-table"><table><thead><tr>${head.map((c, k) => `<th${st(k)}>${inline(c)}</th>`).join('')}</tr></thead><tbody>`;
      i += 2;
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) { const r = cells(lines[i++]); t += `<tr>${head.map((_, k) => `<td${st(k)}>${inline(r[k] ?? '')}</td>`).join('')}</tr>`; }
      out += `${t}</tbody></table></div>`;
      continue;
    }
    if (ITEM.test(l)) { const r = list(lines, i, code); out += r.html; i = r.next; continue; }
    // a paragraph: until a blank line or something else begins
    const para = [];
    while (i < lines.length && lines[i].trim() && !FENCE.test(lines[i]) && !HEADING.test(lines[i]) && !RULE.test(lines[i]) && !QUOTE.test(lines[i])
      && !(para.length && ITEM.test(lines[i]) && !/^\s/.test(lines[i]))) para.push(lines[i++]);
    out += `<p>${inline(para.join('\n'))}</p>`;
  }
  return out;
}

function codeBlock(code, lang, text, open) {
  const n = code.push({ lang, text }) - 1;
  return `<div class="md-code${open ? ' open' : ''}" data-code="${n}"><div class="md-code-head"><span>${escapeHtml(lang || 'text')}</span><button type="button" class="md-copy" data-copy="${n}">Copy</button></div><pre><code${lang ? ` class="lang-${escapeHtml(lang)}"` : ''}>${escapeHtml(text)}</code></pre></div>`;
}

/** A list from line i (its items' indented lines are their own blocks: nested lists, code, paragraphs). */
function list(lines, i, code) {
  const first = ITEM.exec(lines[i]), base = first[1].length, ordered = /\d/.test(first[2]);
  const start = ordered ? parseInt(first[2], 10) : 1;
  let html = ordered ? `<ol${start !== 1 ? ` start="${start}"` : ''}>` : '<ul>';
  while (i < lines.length) {
    const m = ITEM.exec(lines[i]);
    if (!m || m[1].length !== base || /\d/.test(m[2]) !== ordered) break;
    const body = [m[3]];
    i++;
    // what belongs to this item: indented lines, and blank lines followed by indented ones
    while (i < lines.length) {
      const l = lines[i];
      if (!l.trim()) { if (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1]) && (lines[i + 1].match(/^\s*/)[0].length > base)) { body.push(''); i++; continue; } break; }
      const ind = l.match(/^\s*/)[0].length;
      if (ind > base) { body.push(l.slice(Math.min(ind, base + (m[2].length + 1)))); i++; continue; }
      if (ITEM.test(l)) break;
      body.push(l.trim()); i++;   // a lazy continuation of the item's text
    }
    let task = '';
    const tm = /^\[([ xX])\]\s+/.exec(body[0]);
    if (tm) { task = `<input type="checkbox" disabled${tm[1] !== ' ' ? ' checked' : ''}> `; body[0] = body[0].slice(tm[0].length); }
    const inner = body.length === 1 || !body.slice(1).some(x => x.trim()) ? inline(body[0]) : blocks(body, code).replace(/^<p>([\s\S]*?)<\/p>/, '$1');
    html += `<li${task ? ' class="task"' : ''}>${task}${inner}</li>`;
    if (i < lines.length && !lines[i].trim()) {   // a blank line between items keeps the list going
      let k = i; while (k < lines.length && !lines[k].trim()) k++;
      const n = k < lines.length ? ITEM.exec(lines[k]) : null;
      if (n && n[1].length === base && /\d/.test(n[2]) === ordered) i = k;
    }
  }
  return { html: html + (ordered ? '</ol>' : '</ul>'), next: i };
}

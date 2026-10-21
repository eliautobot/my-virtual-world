// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The chat window's Markdown (client/js/ui/chat-md.js; docs/features/CHAT.md §7): what an agent writes becomes safe
// HTML — every character escaped first, only the renderer's own tags, links only to http(s) and mailto — and the usual
// shapes render: headings, lists (nested, numbered from their start, task boxes), quotes, tables with alignment, fenced
// code (also unfinished, while it streams), bold, italic, strike, inline code, bare addresses.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { md, render, safeUrl } from '../../client/js/ui/chat-md.js';

test('nothing a model writes becomes markup or script of its own', () => {
  const evil = [
    '<script>alert(1)</script>', '<img src=x onerror=alert(1)>', '[x](javascript:alert(1))', '[x](JaVaScRiPt:alert(1))', '[x]( javascript:alert(1))',
    '[x](data:text/html;base64,PHNjcmlwdD4=)', '[x](vbscript:msgbox(1))', '<a href="javascript:1">a</a>', '```html\n<script>alert(1)</script>\n```',
    '`<b>`', '**<i>x</i>**', '| <svg onload=alert(1)> | b |\n|---|---|\n| c | d |', '[x](https://ok.com" onmouseover="alert(1))', '"><script>',
  ];
  const ALLOWED = new Set(['p', 'br', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'em', 'del', 'code', 'pre', 'a', 'ul', 'ol', 'li', 'blockquote', 'hr', 'div', 'span', 'button', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'input']);
  for (const t of evil) {
    const html = md(t);
    for (const [tag] of html.matchAll(/<[^>]*>/g)) {   // every real tag: one of the renderer's own, no handler, no other link
      const name = /^<\/?([a-z0-9]+)/i.exec(tag)?.[1]?.toLowerCase();
      assert.ok(ALLOWED.has(name), `${t} → ${tag}`);
      assert.doesNotMatch(tag, /\son\w+\s*=/i, `${t} → ${tag}`);
      assert.doesNotMatch(tag, /href="(?!https?:|mailto:)/i, `${t} → ${tag}`);
    }
  }
  // a quote can't close the address: the link ends there and the rest is text
  assert.match(md('[x](https://ok.com" onmouseover="alert(1))'), /href="https:\/\/ok\.com" target="_blank"[^>]*>https:\/\/ok\.com<\/a>&quot; onmouseover=&quot;alert\(1\)\)/);
  assert.equal(safeUrl('https://a.com/x?y=1'), 'https://a.com/x?y=1'); assert.equal(safeUrl('mailto:a@b.c'), 'mailto:a@b.c');
  for (const u of ['javascript:1', 'ftp://x', '//evil.com', '/relative', 'https://a.com/<x>']) assert.equal(safeUrl(u), null, u);
});

test('the usual shapes render', () => {
  assert.equal(md('# A\n## B **b**'), '<h1>A</h1><h2>B <strong>b</strong></h2>');
  assert.equal(md('*i* _j_ ~~s~~ `c` snake_case_name 2*3*4'), '<p><em>i</em> <em>j</em> <del>s</del> <code>c</code> snake_case_name 2*3*4</p>', 'no emphasis inside words');
  assert.equal(md('- a\n- b\n  - c\n- d'), '<ul><li>a</li><li>b<ul><li>c</li></ul></li><li>d</li></ul>');
  assert.equal(md('3. three\n4. four'), '<ol start="3"><li>three</li><li>four</li></ol>');
  assert.equal(md('- [x] done\n- [ ] todo'), '<ul><li class="task"><input type="checkbox" disabled checked> done</li><li class="task"><input type="checkbox" disabled> todo</li></ul>');
  assert.equal(md('> a\n> b'), '<blockquote><p>a<br>b</p></blockquote>');
  assert.equal(md('a\n\n---\n\nb'), '<p>a</p><hr><p>b</p>');
  assert.match(md('| L | C | R |\n|:-|:-:|-:|\n| 1 | 2 | 3 |'), /<th style="text-align:left">L<\/th><th style="text-align:center">C<\/th><th style="text-align:right">R<\/th>.*<td style="text-align:right">3<\/td>/);
  assert.equal(md('see https://x.com/a. and <https://y.org>'), '<p>see <a href="https://x.com/a" target="_blank" rel="noopener noreferrer nofollow">https://x.com/a</a>. and <a href="https://y.org" target="_blank" rel="noopener noreferrer nofollow">https://y.org</a></p>');
  const r = render('Intro\n\n```js\nconst a = 1 < 2;\n```\n\n```py\nprint(1)');
  assert.deepEqual(r.code, [{ lang: 'js', text: 'const a = 1 < 2;' }, { lang: 'py', text: 'print(1)' }], 'each code block numbered for its Copy button');
  assert.match(r.html, /<code class="lang-js">const a = 1 &lt; 2;<\/code>/);
  assert.match(r.html, /<div class="md-code open" data-code="1">/, 'an unfinished fence (still streaming) shows what came as code');
  assert.equal(md(''), ''); assert.equal(md(null), '');
});

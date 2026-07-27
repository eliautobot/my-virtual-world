#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { marked } from 'marked';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const markdownSource = read('src/client/js/chat-markdown.js');
const chatSource = read('src/client/js/chat.js');
const indexHtml = read('src/client/index.html');
const styleCss = read('src/client/css/style.css');
const redesignCss = read('src/client/css/ui-redesign.css');

const sandbox = { marked };
vm.createContext(sandbox);
vm.runInContext(markdownSource, sandbox, { filename: 'chat-markdown.js' });

const { renderMarkdown } = sandbox.VirtualWorldChatMarkdown;
const fixture = [
  '## Streaming Markdown',
  '',
  'Text with **bold**, *italics*, and `inline code`.',
  '',
  '- First item',
  '- Second item',
  '  - Nested item',
  '',
  '> A quoted note',
  '',
  '| Name | Status |',
  '| --- | --- |',
  '| Chat | Working |',
  '',
  '- [x] Finished',
  '- [ ] Pending',
  '',
  '```js',
  'const ready = true;',
  '```'
].join('\n');
const rendered = renderMarkdown(fixture);

for (const token of [
  '<h2>Streaming Markdown</h2>',
  '<strong>bold</strong>',
  '<ul>',
  '<blockquote>',
  'class="chat-table-scroll"',
  '<table>',
  'type="checkbox"',
  '<pre><code class="language-js">'
]) {
  assert(rendered.includes(token), `rendered Markdown missing ${token}`);
}
assert(!renderMarkdown('<script>alert("unsafe")</script>').includes('<script'), 'raw HTML must not become executable');
assert(!renderMarkdown('[unsafe](javascript:alert(1))').includes('javascript:'), 'unsafe link protocols must be removed');
assert(
  !renderMarkdown('<a href="javascript&#58;alert(1)">unsafe</a>').includes('href='),
  'encoded unsafe link protocols must be removed'
);

assert(
  chatSource.includes('text.innerHTML = formatContent(nextContent);'),
  'streaming updates must use the Markdown renderer'
);
assert(
  !chatSource.includes("text.textContent = content || '';"),
  'streaming updates must not fall back to plain text'
);
assert(
  !chatSource.includes("bubble.innerHTML = '';"),
  'finalization must preserve the existing streamed Markdown container'
);
assert(indexHtml.includes('/node_modules/marked/lib/marked.umd.js'), 'Marked must be served locally');
assert(!indexHtml.includes('cdn.jsdelivr.net/npm/marked'), 'chat Markdown must not depend on the CDN');
assert(!indexHtml.includes('id="chat-move"'), 'the dedicated move button must be removed');
assert(chatSource.includes("chatHeader.addEventListener('pointerdown'"), 'chat banner must start pointer drag gestures');
assert(chatSource.includes('CHAT_DRAG_THRESHOLD'), 'chat banner dragging must use a click-safe movement threshold');
assert(indexHtml.includes('class="chat-run-notice"'), 'genuine run failures need a non-conversational notice');
assert(styleCss.includes('.chat-run-notice[hidden]'), 'the run notice must be independently hideable');
assert(chatSource.includes('this.showRunNotice(failureStatus, message, runId);'), 'terminal run errors must use the non-chat notice');
assert(
  chatSource.includes('if (!eventRunId) return;'),
  'unattributed late errors must not become global run failures'
);
assert(
  !chatSource.includes("this.appendSystem(failureStatus + ': ' + message)"),
  'terminal run errors must not create synthetic chat bubbles'
);
assert(!chatSource.includes('this.setStatus('), 'run and tool activity must not mutate the connection status');
assert(
  !chatSource.includes('this.setConnectionStatus('),
  'only the gateway connection handlers may mutate the connection status'
);
assert(redesignCss.includes('@container chat-panel (max-width: 410px)'), 'header must use panel-width container queries');
assert(!redesignCss.includes('[style*="width:'), 'resized chat layout must not use brittle inline-style selectors');
assert(styleCss.includes('.chat-panel .chat-markdown table'), 'chat tables must have scoped styling');
assert(styleCss.includes('.chat-panel .chat-markdown blockquote'), 'chat blockquotes must have scoped styling');

console.log('PASS: chat streaming Markdown, responsive header, and direct-drag regressions verified.');

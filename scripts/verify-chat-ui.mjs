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
assert(indexHtml.includes('class="chat-scroll-latest"'), 'chat windows need a jump-to-latest control');
assert(
  chatSource.includes("this.messages.addEventListener('scroll'") &&
  chatSource.includes('this.followLatest = this.isNearMessagesBottom();'),
  'manual message scrolling must suspend bottom-follow mode'
);
assert(
  chatSource.includes('this.restoringLatest = true;') &&
  chatSource.includes('if (this.scrollTrackingSuspended || this.restoringLatest) return;') &&
  chatSource.includes('if (force) scrollToEnd();'),
  'forced latest-message restoration must survive stale scroll events before the animation frame'
);
assert(
  chatSource.includes('replaceHistoryMessages(renderMessages)') &&
  chatSource.includes('scrollTrackingSuspended'),
  'history refreshes must preserve paused scroll positions without re-enabling bottom-follow'
);
assert(
  chatSource.includes("this.messages.addEventListener('mousedown'") &&
  chatSource.includes('this.middleScrollPointerDown = true;') &&
  chatSource.includes('if (this.middleScrollGestureMoved) this.stopMiddleAutoScroll();'),
  'message panes must support hold-and-drag middle-button scrolling'
);
assert(
  chatSource.includes("this.messages.addEventListener('auxclick'") &&
  chatSource.includes('startMiddleAutoScroll(event)'),
  'a normal middle click must still support hands-free autoscroll'
);
assert(
  chatSource.includes("const panel = primaryPanel.cloneNode(true);") &&
  chatSource.includes("const w = new ChatWindow(panel, { slot: Number(slot) });"),
  'secondary chat panels must inherit the shared scroll controls and behavior'
);
for (const token of [
  'top: -7px !important;',
  'bottom: -7px !important;',
  'left: -7px !important;',
  'right: -7px !important;'
]) {
  assert(redesignCss.includes(token), `resize hit zones must sit outside the panel: ${token}`);
}
assert(
  redesignCss.includes('top: -6px !important;') &&
  redesignCss.includes('left: -6px !important;') &&
  redesignCss.includes('border-radius: 50% !important;'),
  'corner resize zones must be centered tightly on the panel curve'
);
assert(
  redesignCss.includes('border-bottom-left-radius: inherit !important;') &&
  redesignCss.includes('border-bottom-right-radius: inherit !important;') &&
  redesignCss.includes('.chat-panel > .chat-input-row'),
  'the composer background must follow the panel bottom corners without rectangular bleed'
);

console.log('PASS: chat Markdown, bottom-follow, middle-click/drag scrolling, curved resize, and multi-window regressions verified.');

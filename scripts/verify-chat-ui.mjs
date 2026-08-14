#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { marked } from 'marked';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const markdownSource = read('src/client/js/chat-markdown.js');
const chatEventsSource = read('src/client/js/chat-events.js');
const chatSource = read('src/client/js/chat.js');
const indexHtml = read('src/client/index.html');
const styleCss = read('src/client/css/style.css');
const redesignCss = read('src/client/css/ui-redesign.css');

const sandbox = { marked };
vm.createContext(sandbox);
vm.runInContext(markdownSource, sandbox, { filename: 'chat-markdown.js' });
vm.runInContext(chatEventsSource, sandbox, { filename: 'chat-events.js' });

const { renderMarkdown, renderMarkdownInto } = sandbox.VirtualWorldChatMarkdown;
const { mergeHistoryItems } = sandbox.ChatEvents;
const approvalOnlyHistory = mergeHistoryItems([{
  role: 'assistant',
  text: '',
  tools: [],
  meta: { approval: { id: 'approval-reload-fixture', status: 'pending' } }
}]);
assert.equal(approvalOnlyHistory.length, 1, 'approval-only history must survive reload merging');
assert.equal(
  approvalOnlyHistory[0].meta.approval.id,
  'approval-reload-fixture',
  'approval-only history must preserve its approval metadata'
);
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
const renderedTarget = { innerHTML: '' };
assert.equal(renderMarkdownInto(renderedTarget, fixture), rendered, 'shared Markdown DOM sink must return rendered HTML');
assert.equal(renderedTarget.innerHTML, rendered, 'shared Markdown DOM sink must update the target');

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
  chatSource.includes('renderMarkdownInto(text, nextContent);'),
  'streaming updates must use the shared Markdown DOM sink'
);
assert(
  !chatSource.includes("text.textContent = content || '';"),
  'streaming updates must not fall back to plain text'
);
assert(!chatSource.includes('innerHTML = formatContent('), 'chat surfaces must not bypass the shared Markdown DOM sink');
assert(
  !chatSource.includes("bubble.innerHTML = '';"),
  'finalization must preserve the existing streamed Markdown container'
);
assert(
  chatSource.includes("div.dataset.providerKind = this.getSelectedProviderKind() || 'openclaw';"),
  'assistant messages must retain their provider kind for cross-provider verification'
);
assert(
  chatSource.includes("if (sessionId) params.set('sessionId', sessionId);"),
  'Hermes approval polling must be pinned to the selected chat session'
);
assert(
  chatSource.includes('sessionId: approval.session_id || approval.sessionId || this.selectedProviderSessionId()'),
  'Hermes approval responses must retain the originating session'
);

const providerKinds = ['openclaw', 'hermes', 'codex', 'claude-code', 'opencode', 'antigravity', 'extension-provider'];
for (const providerKind of providerKinds) {
  const reducer = new sandbox.ChatEvents.TurnEventReducer();
  const runId = `${providerKind}-markdown-run`;
  reducer.ingest({ kind: 'run.start', runId });
  const streamingMarkdown = `## ${providerKind} Streaming\n\n**Formatted while streaming.**\n\n- first\n- second`;
  const streamingActions = reducer.ingest({ kind: 'text.delta', runId, text: streamingMarkdown });
  const streamingAction = streamingActions.find(action => action.kind === 'text.open');
  assert(streamingAction, `${providerKind} must open a provider-neutral streaming text segment`);
  const streamingTarget = { innerHTML: '' };
  renderMarkdownInto(streamingTarget, streamingAction.text);
  assert(streamingTarget.innerHTML.includes(`<h2>${providerKind} Streaming</h2>`), `${providerKind} streaming heading must render`);
  assert(streamingTarget.innerHTML.includes('<strong>Formatted while streaming.</strong>'), `${providerKind} streaming emphasis must render`);
  assert(streamingTarget.innerHTML.includes('<ul>'), `${providerKind} streaming list must render`);

  const finalMarkdown = `${streamingMarkdown}\n\n\`inline\`\n\n\`\`\`js\nconst markdown = true;\n\`\`\``;
  const updateActions = reducer.ingest({ kind: 'text.replace', runId, text: finalMarkdown });
  const updateAction = updateActions.find(action => action.kind === 'text.update');
  assert(updateAction, `${providerKind} must update the same streaming text segment`);
  const finalTarget = { innerHTML: '' };
  renderMarkdownInto(finalTarget, updateAction.text);
  assert(finalTarget.innerHTML.includes('<code>inline</code>'), `${providerKind} inline code must render`);
  assert(finalTarget.innerHTML.includes('<pre><code class="language-js">'), `${providerKind} fenced code must render`);

  const terminalActions = reducer.ingest({ kind: 'run.complete', runId });
  assert(terminalActions.some(action => action.kind === 'text.finalize'), `${providerKind} must finalize rendered Markdown`);
}

for (const token of [
  "this.handleNativeRunEvent('hermes'",
  "this.handleNativeRunEvent('codex'",
  "this.applyTurnEvent({ kind: 'text.delta'",
  "this.handleProviderSdkEvent(eventName",
  "if (reply) this.applyTurnEvent({ kind: 'text.replace'",
  "this.renderHistoryItems(this.providerHistoryItems"
]) {
  assert(chatSource.includes(token), `provider Markdown route missing ${token}`);
}
assert(indexHtml.includes('/node_modules/marked/lib/marked.umd.js'), 'Marked must be served locally');
assert(!indexHtml.includes('cdn.jsdelivr.net/npm/marked'), 'chat Markdown must not depend on the CDN');
assert(!indexHtml.includes('id="chat-move"'), 'the dedicated move button must be removed');
assert(chatSource.includes("chatHeader.addEventListener('pointerdown'"), 'chat banner must start pointer drag gestures');
assert(chatSource.includes('CHAT_DRAG_THRESHOLD'), 'chat banner dragging must use a click-safe movement threshold');
assert(indexHtml.includes('class="chat-run-notice"'), 'genuine run failures need a non-conversational notice');
assert(styleCss.includes('.chat-run-notice[hidden]'), 'the run notice must be independently hideable');
assert(chatSource.includes('this.showRunNotice(failureStatus, message, runId);'), 'terminal run errors must use the non-chat notice');
assert(
  chatSource.includes('if (!getOpenClawRunId(payload, this.currentRunId)) return;'),
  'unattributed late errors must not become global run failures'
);
assert(
  !chatSource.includes("this.appendSystem(failureStatus + ': ' + message)"),
  'terminal run errors must not create synthetic chat bubbles'
);
for (const token of [
  'sessionId: this.selectedProviderSessionId()',
  'this.adoptProviderSessionId(data.sessionId);',
  'if (Array.isArray(data.messages)) this.renderProviderSessionMessages(data.messages);',
  'if (await this.loadExplicitProviderSessionHistory(isCurrent)) return;',
  'New session started — the previous session is still saved',
]) {
  assert(chatSource.includes(token), `session-isolated provider chat flow missing ${token}`);
}
assert(
  !chatSource.includes("sessionId: String(this.sessionKey || '').split(':').slice(2).join(':')"),
  'provider sends must never derive a native session id from an unrelated session-key shape'
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
for (const token of [
  'setting-toolCallDisplay-expanded',
  'setting-toolCallDisplay-collapsed',
  'Expanded by default',
  'Collapsed by default',
]) {
  assert(indexHtml.includes(token), `General settings missing tool call display option: ${token}`);
}
for (const token of [
  'toolCallsExpandedByDefault',
  'details.open = toolCallsExpandedByDefault',
  'applyChatUiSettings(event.detail?.config',
]) {
  assert(chatSource.includes(token), `chat tool display preference missing ${token}`);
}
assert(
  chatSource.includes("this.messages.addEventListener('scroll'") &&
  chatSource.includes("this.messages.addEventListener('wheel'") &&
  chatSource.includes('this.hasManualScrollIntent()'),
  'manual message scrolling must suspend bottom-follow mode'
);
assert(
  chatSource.includes('this.manualScrollDirection < 0 || movedUp') &&
  chatSource.includes('reachedManualBottom') &&
  chatSource.includes('CHAT_BOTTOM_REATTACH_THRESHOLD') &&
  chatSource.includes('this.manualScrollBottomTarget') &&
  chatSource.includes('this.cancelPendingScrollBottom();') &&
  chatSource.includes('this.clearManualScrollIntent();') &&
  chatSource.includes('if (this.followLatest && !nearBottom) this.scrollBottom();'),
  'one upward gesture must detach bottom-follow while reaching the true bottom restores it'
);
assert(
  chatSource.includes('if (force) scrollToEnd();') &&
  !chatSource.includes("last.scrollIntoView({ block: 'end' })") &&
  !chatSource.includes('this.restoreLatestTimer = setTimeout'),
  'forced latest-message restoration must use the true pane bottom without a timer race'
);
assert(
  chatSource.includes('replaceHistoryMessages(renderMessages)') &&
  chatSource.includes('scrollTrackingSuspended') &&
  chatSource.includes('this.followLatest = !maxScrollTop;'),
  'history refreshes must preserve paused scroll positions without re-enabling bottom-follow'
);
for (const token of [
  'window.visualViewport?.addEventListener(\'resize\'',
  '--chat-visual-viewport-height',
  '--chat-keyboard-inset',
  "root.classList.toggle('chat-keyboard-open', keyboardOpen)",
  "document.addEventListener('focusin'"
]) {
  assert(chatSource.includes(token), `mobile keyboard viewport synchronization missing ${token}`);
}
assert(
  redesignCss.includes('html.chat-keyboard-open .chat-panel.open') &&
  redesignCss.includes('bottom: calc(var(--chat-keyboard-inset, 0px) + 6px) !important;') &&
  redesignCss.includes('height: calc(var(--chat-visual-viewport-height, 100dvh) - 12px) !important;'),
  'mobile chat must remain entirely inside the visual viewport above the software keyboard'
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
  'MAX_RENDERED_HISTORY_ITEMS = 120',
  'mergedItems.slice(-MAX_RENDERED_HISTORY_ITEMS)',
  'older items remain saved in this session',
  'this.sessionKey !== requestedSessionKey',
  'this.ownsPayload(payload)',
  '_chatResizeFrame = requestAnimationFrame',
  "panel.classList.add('chat-resizing')"
]) {
  assert(chatSource.includes(token), `chat performance/session isolation missing ${token}`);
}
for (const token of [
  'CHAT_INPUT_DELETE_RESIZE_DELAY_MS = 140',
  "inputType.startsWith('delete')",
  'this.inputResizeTimer = setTimeout',
  'this.cancelPendingInputResize();'
]) {
  assert(chatSource.includes(token), `mobile composer deletion performance guard missing ${token}`);
}
assert(
  redesignCss.includes('transition: border-color .12s ease, background-color .12s ease !important;'),
  'chat composer height must not animate while mobile keyboards repeat backspace'
);
assert(
  redesignCss.includes('backdrop-filter: none !important;') &&
  redesignCss.includes('.chat-panel.chat-resizing .chat-bubble'),
  'chat must avoid WebGL backdrop blur and resize-time bubble shadows'
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

console.log('PASS: chat Markdown, one-gesture bottom detach, mobile keyboard viewport, middle scrolling, resize, and multi-window regressions verified.');

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  classifyPreviewToolEvent,
  getPreviewBubbleDisplayScale,
  normalizePreviewTarget,
  normalizePreviewBubbleSettings,
  normalizePreviewClientState,
  previewTargetsForAgent,
  previewTargetKey,
  resolveAgentPreviewTarget,
  resolvePreviewBubbleCollisionLayout,
  shouldReplayPublishedPreview,
} from '../src/client/js/agent-preview-hub.mjs';

assert.deepEqual(
  normalizePreviewBubbleSettings(),
  { displayMode: 'consistent', size: 'large', contentZoom: 100 },
  'existing worlds must keep the current Preview Bubble size and content fit',
);
assert.deepEqual(
  normalizePreviewBubbleSettings({ displayMode: 'world', size: 'medium', contentZoom: 900 }),
  { displayMode: 'world', size: 'medium', contentZoom: 200 },
  'Preview Bubble settings must normalize independently and clamp content zoom',
);
assert.equal(
  getPreviewBubbleDisplayScale({ displayMode: 'consistent', size: 'small' }, 80).transformScale,
  1,
  'consistent Preview Bubbles must ignore camera zoom',
);
assert.equal(
  getPreviewBubbleDisplayScale({ displayMode: 'world', size: 'large' }, 40).transformScale
    / getPreviewBubbleDisplayScale({ displayMode: 'world', size: 'large' }, 80).transformScale,
  2,
  'fixed Preview Bubbles must scale the complete intact bubble with camera distance like chat bubbles',
);

const fileTarget = classifyPreviewToolEvent({
  agentId: 'coder',
  phase: 'start',
  tool: { name: 'functions.read', arguments: { path: 'docs/report.md', workdir: '/workspace/project' } },
});
assert.deepEqual(fileTarget, {
  id: '',
  agentId: 'coder',
  kind: 'file',
  path: 'docs/report.md',
  workdir: '/workspace/project',
  url: '',
  title: 'report.md',
  source: 'tool:read',
  createdAt: fileTarget.createdAt,
});
assert.equal(previewTargetKey(fileTarget), 'coder:file:/workspace/project:docs/report.md');

const patchTarget = classifyPreviewToolEvent({
  agentId: 'coder',
  phase: 'result',
  tool: {
    name: 'apply_patch',
    arguments: { input: '*** Begin Patch\n*** Update File: src/client/app.js\n*** End Patch' },
  },
});
assert.equal(patchTarget.path, 'src/client/app.js');

const browserTarget = classifyPreviewToolEvent({
  agentId: 'main',
  phase: 'start',
  tool: { name: 'openclaw__browser', arguments: { action: 'snapshot' } },
});
assert.equal(browserTarget.kind, 'browser');
assert.equal(previewTargetKey(browserTarget), 'main:browser');

const urlTarget = classifyPreviewToolEvent({
  agentId: 'main',
  phase: 'result',
  tool: { name: 'web_fetch', arguments: { url: 'https://example.com/report?q=1' } },
});
assert.equal(urlTarget.kind, 'url');
assert.equal(urlTarget.url, 'https://example.com/report?q=1');

const generatedTarget = classifyPreviewToolEvent({
  agentId: 'designer',
  phase: 'result',
  tool: { name: 'image_gen', result: 'Image generated and saved to: output/hero.webp' },
});
assert.equal(generatedTarget.path, 'output/hero.webp');

assert.equal(
  classifyPreviewToolEvent({ agentId: 'coder', tool: { name: 'exec', arguments: { cmd: 'npm test' } } }),
  null,
  'generic commands must not become unsafe guessed previews',
);
assert.equal(
  normalizePreviewTarget({ agentId: 'coder', kind: 'url', url: 'javascript:alert(1)' }),
  null,
  'non-HTTP URLs must be rejected',
);

const restoredClientState = normalizePreviewClientState({
  hiddenBubbleAgents: ['coder', '', 'coder', 'writer'],
  dismissedPublications: { 'coder:file::report.md': 8, invalid: 'nope' },
});
assert.deepEqual(restoredClientState.hiddenBubbleAgents, ['coder', 'writer']);
assert.deepEqual(restoredClientState.dismissedPublications, { 'coder:file::report.md': 8 });
const publishedRecord = {
  serial: 8,
  createdAt: '2026-08-14T12:00:00Z',
  target: { agentId: 'coder', kind: 'file', path: 'report.md' },
};
assert.equal(
  shouldReplayPublishedPreview(publishedRecord, { 'coder:file::report.md': 8 }),
  false,
  'a closed published tab must stay closed after refresh',
);
assert.equal(
  shouldReplayPublishedPreview({ ...publishedRecord, serial: 9 }, { 'coder:file::report.md': 8 }),
  true,
  'a newer publication of a closed target must reopen it',
);

const imageTarget = normalizePreviewTarget({ agentId: 'coder', kind: 'file', path: 'output/preview.svg', title: 'Image' });
const textTarget = normalizePreviewTarget({ agentId: 'coder', kind: 'file', path: 'notes/work.txt', title: 'Notes' });
const otherAgentTarget = normalizePreviewTarget({ agentId: 'main', kind: 'browser' });
const openTargets = [imageTarget, otherAgentTarget, textTarget];
assert.deepEqual(
  previewTargetsForAgent(openTargets, 'coder'),
  [imageTarget, textTarget],
  'compact bubble tabs must contain only the selected agent preview targets',
);
assert.equal(
  resolveAgentPreviewTarget(openTargets, 'coder', previewTargetKey(imageTarget)),
  imageTarget,
  'a compact bubble must preserve the user-selected open tab',
);
assert.equal(
  resolveAgentPreviewTarget(openTargets, 'coder', 'missing-preview'),
  textTarget,
  'a missing compact selection must fall back to the latest open preview',
);

const collisionLayout = resolvePreviewBubbleCollisionLayout([
  { id: 'coder', width: 240, height: 190, anchorX: 500, anchorY: 420, controlX: 500, controlY: 440 },
  { id: 'designer', width: 240, height: 190, anchorX: 530, anchorY: 420, controlX: 530, controlY: 440 },
  { id: 'writer', width: 240, height: 190, anchorX: 560, anchorY: 420, controlX: 560, controlY: 440 },
], { left: 0, top: 50, right: 1200, bottom: 800 });
assert.equal(collisionLayout.length, 3, 'every visible Preview Bubble must receive a position');
for (let first = 0; first < collisionLayout.length; first++) {
  for (let second = first + 1; second < collisionLayout.length; second++) {
    const a = collisionLayout[first];
    const b = collisionLayout[second];
    assert.equal(
      a.left < b.left + b.width + 10
        && a.left + a.width + 10 > b.left
        && a.top < b.top + b.height + 10
        && a.top + a.height + 10 > b.top,
      false,
      `Preview Bubbles ${a.id} and ${b.id} must not overlap`,
    );
  }
}

const hubSource = readFileSync(new URL('../src/client/js/agent-preview-hub.mjs', import.meta.url), 'utf8');
const main3dSource = readFileSync(new URL('../src/client/js/main3d.js', import.meta.url), 'utf8');
const chatSource = readFileSync(new URL('../src/client/js/chat.js', import.meta.url), 'utf8');
const previewCss = readFileSync(new URL('../src/client/css/ui-redesign.css', import.meta.url), 'utf8');
const indexHtml = readFileSync(new URL('../src/client/index.html', import.meta.url), 'utf8');
const settingsSource = readFileSync(new URL('../src/client/js/settings.js', import.meta.url), 'utf8');
for (const token of [
  'agent-preview-bubble-tabs',
  'bubbleActiveKeys',
  'hiddenBubbleAgents',
  'toggleBubble',
  'Hide preview bubble',
  'normalizePreviewBubbleSettings',
  'expandedPdfViews',
  'loadPdfJsModule',
  'agent-preview-pdf-canvas',
  'resolvePreviewBubbleCollisionLayout',
  'agent-preview-bubble-tab-close',
  'closeTarget(key)',
  "window.addEventListener('vw:settings-saved'",
  "placement: 'right'",
  'anchor.controlX',
  'PREVIEW_CLIENT_STATE_STORAGE_KEY',
  'rememberPublicationDismissal',
  'shouldReplayPublishedPreview',
  "item.kind === 'browser' && item.agentId !== normalized.agentId",
]) {
  assert.ok(hubSource.includes(token), `agent preview hub missing compact bubble control token: ${token}`);
}
for (const token of [
  'registerRunOwner(runId',
  'previewOwnerForRun(runId)',
  'agentId: previewOwner.agentId',
  'sessionKey: previewOwner.sessionKey',
]) {
  assert.ok(chatSource.includes(token), `chat.js missing agent-scoped preview ownership token: ${token}`);
}
for (const token of [
  'agentPreviewScreenPrimary',
  'getAssignedDeskPreviewScreenHit',
  'toggleBubble(previewScreenHit.agent.id)',
  '__verifyAssignedDeskPreviewScreens',
  'findAgentPreviewScreenMesh',
  'controlX',
  'cameraDistance',
  'resolveChatBubbleObstacleCollisions',
  'getVisiblePreviewBubbleObstacleRects',
]) {
  assert.ok(main3dSource.includes(token), `main3d.js missing assigned monitor preview token: ${token}`);
}
assert.ok(previewCss.includes('.agent-preview-bubble-tab[data-active="true"]'), 'preview CSS must style the active compact bubble tab');
assert.match(
  previewCss,
  /\.agent-preview-bubble-stage\s*\{[^}]*overflow:\s*hidden;/s,
  'the compact bubble viewport must not add a second set of scrollbars',
);
assert.match(
  previewCss,
  /\.agent-preview-bubble-stage \.agent-preview-source\s*\{[^}]*overflow:\s*auto;/s,
  'plain-text preview items must own their horizontal and vertical scrolling',
);
assert.ok(previewCss.includes('.agent-preview-compact-media-scroll'), 'zoomed compact media must own its scrolling');
assert.ok(previewCss.includes('.agent-preview-bubble-tab-close'), 'compact Preview Bubble tabs must expose close controls');
assert.match(
  previewCss,
  /\.agent-preview-bubble-tabs::\-webkit-scrollbar\s*\{[^}]*height:\s*5px;/s,
  'the compact tab scrollbar must be thin enough to leave the tabs unobstructed',
);
assert.match(
  previewCss,
  /\.agent-preview-bubble-tabs\s*\{[^}]*flex:\s*0 0 40px;[^}]*padding:\s*2px 5px 14px;/s,
  'the compact tab row must reserve a clear gutter above its scrollbar',
);
assert.ok(previewCss.includes('.agent-preview-pdf-view.is-compact'), 'the compact Preview Bubble must render the actual PDF page');
assert.ok(previewCss.includes('.agent-preview-pdf-toolbar'), 'the optimized PDF viewer must expose lightweight page and zoom controls');
assert.ok(previewCss.includes('--agent-preview-frame-scale'), 'Preview Bubble file contents must honor the configured content zoom');
assert.ok(previewCss.includes('.agent-preview-bubble-stage > .agent-preview-browser'), 'Agent Browser must retain its existing compact fit');
for (const token of [
  '<legend>Preview Bubbles</legend>',
  'setting-previewBubbleDisplayMode',
  'setting-previewBubbleSize',
  'setting-previewBubbleContentZoom',
]) {
  assert.ok(indexHtml.includes(token), `General settings missing Preview Bubble control: ${token}`);
}
for (const token of [
  'const previewBubbles = world.previewBubbles || {}',
  'previewBubbles: {',
  'updatePreviewBubbleZoomUi',
  'function applySettingsLive(config)',
  'applySettingsLive(mergeSettingsConfig(vwConfig, pendingPayload))',
  'applySettingsLive(result.config)',
  'applySettingsLive(previouslySavedConfig)',
]) {
  assert.ok(settingsSource.includes(token), `settings.js missing Preview Bubble persistence token: ${token}`);
}

console.log('agent preview target normalization tests passed');

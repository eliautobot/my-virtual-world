#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  clampChatBubbleX,
  getChatBubbleChromeMetrics,
  getChatBubbleDisplayScale,
  getRigidWorldChatBubbleLayout,
  getChatBubbleSideInsets,
  normalizeChatBubbleDisplaySettings,
} from '../src/client/js/chat-bubble-layout.mjs';

function mockPanel(rect, collapsedClass = '') {
  return {
    classList: {
      contains(className) {
        return className === collapsedClass;
      },
    },
    getBoundingClientRect() {
      return rect;
    },
  };
}

function assertScale(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < 1e-10, `${message}: expected ${expected}, received ${actual}`);
}

const viewport = { left: 0, width: 1440 };
const openInsets = getChatBubbleSideInsets({
  viewport,
  leftPanel: mockPanel({ left: 0, right: 320, width: 320, height: 798 }),
  rightPanel: mockPanel({ left: 1110, right: 1440, width: 330, height: 798 }),
});
assert.deepEqual(
  openInsets,
  { leftInset: 325, rightInset: 335, leftBound: 325, rightBound: 1105 },
  'bubble bounds must use the panels’ rendered edges'
);

const collapsedInsets = getChatBubbleSideInsets({
  viewport,
  leftPanel: mockPanel({ left: -320, right: 0, width: 320, height: 798 }, 'left-sidebar-collapsed'),
  rightPanel: mockPanel({ left: 1440, right: 1770, width: 330, height: 798 }, 'sidebar-collapsed'),
});
assert.deepEqual(
  collapsedInsets,
  { leftInset: 5, rightInset: 5, leftBound: 5, rightBound: 1435 },
  'collapsed panels must not reserve hidden width'
);

const offsetViewportInsets = getChatBubbleSideInsets({
  viewport: { left: 20, width: 1200 },
  leftPanel: mockPanel({ left: 20, right: 340, width: 320, height: 700 }),
  rightPanel: null,
});
assert.equal(offsetViewportInsets.leftBound, 345, 'panel measurements must remain relative to an offset renderer');

assert.equal(
  clampChatBubbleX(238, 28, openInsets.leftBound, openInsets.rightBound),
  325,
  'a minimized head icon must move outside the Edit World panel'
);
assert.equal(
  clampChatBubbleX(265, 320, openInsets.leftBound, openInsets.rightBound),
  325,
  'an expanded bubble must move outside the Edit World panel'
);
assert.equal(
  clampChatBubbleX(900, 320, openInsets.leftBound, openInsets.rightBound),
  785,
  'expanded bubbles must continue respecting the Info panel'
);

assert.deepEqual(
  normalizeChatBubbleDisplaySettings(),
  { displayMode: 'consistent', size: 'large' },
  'existing worlds must retain the current Consistent / Large behavior'
);
assert.deepEqual(
  normalizeChatBubbleDisplaySettings({ displayMode: 'invalid', size: 'huge' }),
  { displayMode: 'consistent', size: 'large' },
  'invalid persisted values must fall back safely'
);
assert.equal(
  getChatBubbleDisplayScale({ displayMode: 'consistent', size: 'large' }, 120).effectiveScale,
  1,
  'Consistent size must ignore camera zoom'
);
assertScale(
  getChatBubbleDisplayScale({ displayMode: 'consistent', size: 'medium' }, 40).effectiveScale,
  0.8,
  'Consistent Medium must be 20% smaller than Large'
);
assertScale(
  getChatBubbleDisplayScale({ displayMode: 'consistent', size: 'small' }, 40).effectiveScale,
  0.68,
  'Consistent Small must be 15% smaller than Medium'
);
assertScale(
  getChatBubbleDisplayScale({ displayMode: 'world', size: 'large' }, 40).effectiveScale,
  0.476,
  'Fixed-size Large must be 30% smaller than the prior world Large size'
);
assertScale(
  getChatBubbleDisplayScale({ displayMode: 'world', size: 'medium' }, 40).effectiveScale,
  0.3332,
  'Fixed-size Medium must be 30% smaller than its Large size'
);
assertScale(
  getChatBubbleDisplayScale({ displayMode: 'world', size: 'small' }, 40).effectiveScale,
  0.23324,
  'Fixed-size Small must be 30% smaller than its Medium size'
);
assertScale(
  getChatBubbleDisplayScale({ displayMode: 'world', size: 'large' }, 80).effectiveScale,
  0.238,
  'Fixed-size bubbles must shrink when the camera zooms out'
);
assertScale(
  getChatBubbleDisplayScale({ displayMode: 'world', size: 'large' }, 20).effectiveScale,
  0.952,
  'Fixed-size bubbles must grow when the camera zooms in'
);
assertScale(
  getChatBubbleDisplayScale({ displayMode: 'world', size: 'small' }, 80).effectiveScale,
  0.11662,
  'size selection and world zoom must compose'
);
assertScale(
  getChatBubbleDisplayScale({ displayMode: 'world', size: 'large' }, 10).zoomScale,
  4,
  'Fixed-size bubbles must keep scaling past 3x without a cutoff'
);
assertScale(
  getChatBubbleDisplayScale({ displayMode: 'world', size: 'large' }, 4.5).zoomScale,
  40 / 4.5,
  'Fixed-size bubbles must use the complete supported camera range'
);
assertScale(
  getChatBubbleDisplayScale({ displayMode: 'world', size: 'large' }, 80).typographyScale,
  0.476,
  'Fixed-size intrinsic typography must not change when zooming out'
);
assertScale(
  getChatBubbleDisplayScale({ displayMode: 'world', size: 'large' }, 20).typographyScale,
  0.476,
  'Fixed-size intrinsic typography must not change when zooming in'
);
assertScale(
  getChatBubbleDisplayScale({ displayMode: 'world', size: 'medium' }, 40).typographyScale,
  0.3332,
  'Fixed-size Medium must use its intrinsic world typography'
);
assertScale(
  getChatBubbleDisplayScale({ displayMode: 'world', size: 'small' }, 40).typographyScale,
  0.23324,
  'Fixed-size Small must use its intrinsic world typography'
);

const consistentChrome = getChatBubbleChromeMetrics('consistent', 0.23324);
assert.deepEqual(
  consistentChrome,
  {
    sessionPaddingY: 1,
    sessionPaddingX: 5,
    sessionBorderWidth: 1,
    sessionRadius: 4,
    scrollbarWidth: 3,
    scrollbarThumbRadius: 2,
  },
  'Consistent bubble session and scrollbar chrome must retain their existing measurements'
);
const fixedLargeChrome = getChatBubbleChromeMetrics('world', 0.476);
assertScale(fixedLargeChrome.sessionPaddingX, 2.38, 'Fixed Large session padding must follow its selected size');
assertScale(fixedLargeChrome.sessionBorderWidth, 0.476, 'Fixed Large session border must follow its selected size');
assertScale(fixedLargeChrome.sessionRadius, 1.904, 'Fixed Large session radius must follow its selected size');
assertScale(fixedLargeChrome.scrollbarWidth, 1.428, 'Fixed Large scrollbar must follow its selected size');
const fixedMediumChrome = getChatBubbleChromeMetrics('world', 0.3332);
assertScale(fixedMediumChrome.sessionPaddingX, 1.666, 'Fixed Medium session padding must follow its selected size');
assertScale(fixedMediumChrome.sessionRadius, 1.3328, 'Fixed Medium session radius must follow its selected size');
assertScale(fixedMediumChrome.scrollbarWidth, 1.25, 'Fixed Medium scrollbar must retain a usable minimum width');
assertScale(fixedMediumChrome.scrollbarThumbRadius, 1.25 * (2 / 3), 'Fixed Medium thumb radius must follow its wider scrollbar');
const fixedSmallChrome = getChatBubbleChromeMetrics('world', 0.23324);
assertScale(fixedSmallChrome.sessionPaddingX, 1.1662, 'Fixed Small session padding must follow its selected size');
assertScale(fixedSmallChrome.sessionRadius, 0.93296, 'Fixed Small session radius must follow its selected size');
assertScale(fixedSmallChrome.scrollbarWidth, 1.25, 'Fixed Small scrollbar must retain a usable minimum width');
assertScale(fixedSmallChrome.scrollbarThumbRadius, 1.25 * (2 / 3), 'Fixed Small thumb radius must follow its wider scrollbar');

const worldFarLayout = getRigidWorldChatBubbleLayout({
  expandedCount: 1,
  availableWidth: 1200,
  baseScale: 0.476,
  zoomScale: 0.5,
});
const worldNearLayout = getRigidWorldChatBubbleLayout({
  expandedCount: 1,
  availableWidth: 1200,
  baseScale: 0.476,
  zoomScale: 2,
});
const worldVeryNearLayout = getRigidWorldChatBubbleLayout({
  expandedCount: 1,
  availableWidth: 1200,
  baseScale: 0.476,
  zoomScale: 4,
});
assert.equal(worldFarLayout.intrinsicW, 152, 'world layout must have a fixed intrinsic width');
assert.equal(worldFarLayout.intrinsicH, 133, 'world layout must have a fixed intrinsic height');
assert.equal(worldNearLayout.intrinsicW, worldFarLayout.intrinsicW, 'camera zoom must not change intrinsic width');
assert.equal(worldNearLayout.intrinsicH, worldFarLayout.intrinsicH, 'camera zoom must not change intrinsic height');
assertScale(worldFarLayout.w, 76, 'far camera must transform the complete rigid bubble down');
assertScale(worldFarLayout.h, 66.5, 'far camera must transform the complete rigid bubble down');
assertScale(worldNearLayout.w, 304, 'near camera must transform the complete rigid bubble up');
assertScale(worldNearLayout.h, 266, 'near camera must transform the complete rigid bubble up');
assertScale(worldVeryNearLayout.w, 608, 'camera zoom beyond 3x must keep transforming the complete bubble');
assertScale(worldVeryNearLayout.h, 532, 'camera zoom beyond 3x must keep transforming the complete bubble');
assertScale(worldFarLayout.transformScale, 0.5, 'far layout must expose one uniform transform');
assertScale(worldNearLayout.transformScale, 2, 'near layout must expose one uniform transform');
assertScale(worldVeryNearLayout.transformScale, 4, 'very near layout must expose its uncapped uniform transform');

console.log('PASS: chat bubble panel bounds and display scaling are valid.');

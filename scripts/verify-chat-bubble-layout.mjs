#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  clampChatBubbleX,
  getChatBubbleChromeMetrics,
  getChatBubbleDisplayScale,
  getRigidWorldChatBubbleLayout,
  getChatBubbleSideInsets,
  normalizeChatBubbleDisplaySettings,
  shouldGroupChatBubbles,
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
  {
    displayMode: 'consistent',
    size: 'large',
    groupingEnabled: true,
    groupingMinimum: 5,
  },
  'existing worlds must retain the current Consistent / Large behavior and group at five bubbles'
);
assert.deepEqual(
  normalizeChatBubbleDisplaySettings({
    displayMode: 'invalid',
    size: 'huge',
    groupingEnabled: 'yes',
    groupingMinimum: 'invalid',
  }),
  {
    displayMode: 'consistent',
    size: 'large',
    groupingEnabled: true,
    groupingMinimum: 5,
  },
  'invalid persisted values must fall back safely'
);
assert.equal(
  shouldGroupChatBubbles(4),
  false,
  'the backwards-compatible default must not group fewer than five expanded bubbles'
);
assert.equal(
  shouldGroupChatBubbles(5),
  true,
  'the backwards-compatible default must group five expanded bubbles'
);
assert.equal(
  shouldGroupChatBubbles(3, { groupingEnabled: true, groupingMinimum: 3 }),
  true,
  'a custom grouping minimum must take effect'
);
assert.equal(
  shouldGroupChatBubbles(20, { groupingEnabled: false, groupingMinimum: 3 }),
  false,
  'disabled grouping must keep expanded bubbles out of the packed layout'
);
assert.equal(
  normalizeChatBubbleDisplaySettings({ groupingMinimum: 1 }).groupingMinimum,
  2,
  'grouping minimums below two must normalize to the smallest meaningful group'
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
  0.357,
  'Fixed-size Large must be 25% smaller than its prior size'
);
assertScale(
  getChatBubbleDisplayScale({ displayMode: 'world', size: 'medium' }, 40).effectiveScale,
  0.2499,
  'Fixed-size Medium must be 25% smaller than its prior size'
);
assertScale(
  getChatBubbleDisplayScale({ displayMode: 'world', size: 'small' }, 40).effectiveScale,
  0.17493,
  'Fixed-size Small must be 25% smaller than its prior size'
);
assertScale(
  getChatBubbleDisplayScale({ displayMode: 'world', size: 'large' }, 80).effectiveScale,
  0.1785,
  'Fixed-size bubbles must shrink when the camera zooms out'
);
assertScale(
  getChatBubbleDisplayScale({ displayMode: 'world', size: 'large' }, 20).effectiveScale,
  0.714,
  'Fixed-size bubbles must grow when the camera zooms in'
);
assertScale(
  getChatBubbleDisplayScale({ displayMode: 'world', size: 'small' }, 80).effectiveScale,
  0.087465,
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
  0.357,
  'Fixed-size intrinsic typography must not change when zooming out'
);
assertScale(
  getChatBubbleDisplayScale({ displayMode: 'world', size: 'large' }, 20).typographyScale,
  0.357,
  'Fixed-size intrinsic typography must not change when zooming in'
);
assertScale(
  getChatBubbleDisplayScale({ displayMode: 'world', size: 'medium' }, 40).typographyScale,
  0.2499,
  'Fixed-size Medium must use its intrinsic world typography'
);
assertScale(
  getChatBubbleDisplayScale({ displayMode: 'world', size: 'small' }, 40).typographyScale,
  0.17493,
  'Fixed-size Small must use its intrinsic world typography'
);

const consistentChrome = getChatBubbleChromeMetrics('consistent', 0.17493);
assert.deepEqual(
  consistentChrome,
  {
    outerBorderWidth: 2,
    headerBorderWidth: 1,
    outerRadius: 12,
    sessionPaddingY: 1,
    sessionPaddingX: 5,
    sessionBorderWidth: 1,
    sessionRadius: 4,
    scrollbarWidth: 3,
    scrollbarThumbRadius: 2,
  },
  'Consistent bubble session and scrollbar chrome must retain their existing measurements'
);
const fixedLargeChrome = getChatBubbleChromeMetrics('world', 0.357);
assertScale(fixedLargeChrome.outerBorderWidth, 0.714, 'Fixed Large outer border must scale from the Consistent 2px baseline');
assertScale(fixedLargeChrome.headerBorderWidth, 0.357, 'Fixed Large header divider must scale from the Consistent 1px baseline');
assertScale(fixedLargeChrome.outerRadius, 6, 'Fixed Large outer radius must retain its current baseline');
assertScale(fixedLargeChrome.sessionPaddingY, 0.714, 'Fixed Large session padding must reserve the Consistent border footprint');
assertScale(fixedLargeChrome.sessionPaddingX, 2.142, 'Fixed Large session padding must reserve the Consistent border footprint');
assertScale(fixedLargeChrome.sessionBorderWidth, 0.357, 'Fixed Large session border must follow its selected size');
assertScale(fixedLargeChrome.sessionRadius, 1.428, 'Fixed Large session radius must follow its selected size');
assertScale(fixedLargeChrome.scrollbarWidth, 1.25, 'Fixed Large scrollbar must retain a usable minimum width');
const fixedMediumChrome = getChatBubbleChromeMetrics('world', 0.2499);
assertScale(fixedMediumChrome.outerBorderWidth, 0.4998, 'Fixed Medium outer border must scale from the Consistent 2px baseline');
assertScale(fixedMediumChrome.headerBorderWidth, 0.2499, 'Fixed Medium header divider must scale from the Consistent 1px baseline');
assertScale(fixedMediumChrome.outerRadius, 4.2, 'Fixed Medium outer radius must be 30% smaller than Large');
assertScale(fixedMediumChrome.sessionPaddingY, 0.4998, 'Fixed Medium session padding must reserve the Consistent border footprint');
assertScale(fixedMediumChrome.sessionPaddingX, 1.4994, 'Fixed Medium session padding must reserve the Consistent border footprint');
assertScale(fixedMediumChrome.sessionRadius, 0.9996, 'Fixed Medium session radius must follow its selected size');
assertScale(fixedMediumChrome.scrollbarWidth, 1.25, 'Fixed Medium scrollbar must retain a usable minimum width');
assertScale(fixedMediumChrome.scrollbarThumbRadius, 1.25 * (2 / 3), 'Fixed Medium thumb radius must follow its wider scrollbar');
const fixedSmallChrome = getChatBubbleChromeMetrics('world', 0.17493);
assertScale(fixedSmallChrome.outerBorderWidth, 0.34986, 'Fixed Small outer border must scale from the Consistent 2px baseline');
assertScale(fixedSmallChrome.headerBorderWidth, 0.17493, 'Fixed Small header divider must scale from the Consistent 1px baseline');
assertScale(fixedSmallChrome.outerRadius, 2.94, 'Fixed Small outer radius must be 30% smaller than Medium');
assertScale(fixedSmallChrome.sessionPaddingY, 0.34986, 'Fixed Small session padding must reserve the Consistent border footprint');
assertScale(fixedSmallChrome.sessionPaddingX, 1.04958, 'Fixed Small session padding must reserve the Consistent border footprint');
assertScale(fixedSmallChrome.sessionRadius, 0.69972, 'Fixed Small session radius must follow its selected size');
assertScale(fixedSmallChrome.scrollbarWidth, 1.25, 'Fixed Small scrollbar must retain a usable minimum width');
assertScale(fixedSmallChrome.scrollbarThumbRadius, 1.25 * (2 / 3), 'Fixed Small thumb radius must follow its wider scrollbar');

const worldFarLayout = getRigidWorldChatBubbleLayout({
  expandedCount: 1,
  availableWidth: 1200,
  baseScale: 0.357,
  zoomScale: 0.5,
});
const worldNearLayout = getRigidWorldChatBubbleLayout({
  expandedCount: 1,
  availableWidth: 1200,
  baseScale: 0.357,
  zoomScale: 2,
});
const worldVeryNearLayout = getRigidWorldChatBubbleLayout({
  expandedCount: 1,
  availableWidth: 1200,
  baseScale: 0.357,
  zoomScale: 4,
});
assert.equal(worldFarLayout.intrinsicW, 114, 'world layout must have a fixed intrinsic width');
assert.equal(worldFarLayout.intrinsicH, 100, 'world layout must have a fixed intrinsic height');
assert.equal(worldNearLayout.intrinsicW, worldFarLayout.intrinsicW, 'camera zoom must not change intrinsic width');
assert.equal(worldNearLayout.intrinsicH, worldFarLayout.intrinsicH, 'camera zoom must not change intrinsic height');
assertScale(worldFarLayout.w, 57, 'far camera must transform the complete rigid bubble down');
assertScale(worldFarLayout.h, 50, 'far camera must transform the complete rigid bubble down');
assertScale(worldNearLayout.w, 228, 'near camera must transform the complete rigid bubble up');
assertScale(worldNearLayout.h, 200, 'near camera must transform the complete rigid bubble up');
assertScale(worldVeryNearLayout.w, 456, 'camera zoom beyond 3x must keep transforming the complete bubble');
assertScale(worldVeryNearLayout.h, 400, 'camera zoom beyond 3x must keep transforming the complete bubble');
assertScale(worldFarLayout.transformScale, 0.5, 'far layout must expose one uniform transform');
assertScale(worldNearLayout.transformScale, 2, 'near layout must expose one uniform transform');
assertScale(worldVeryNearLayout.transformScale, 4, 'very near layout must expose its uncapped uniform transform');

console.log('PASS: chat bubble panel bounds and display scaling are valid.');

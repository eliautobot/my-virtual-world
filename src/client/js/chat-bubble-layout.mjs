const DEFAULT_PANEL_GAP = 5;
const DEFAULT_CHAT_BUBBLE_SETTINGS = Object.freeze({
  displayMode: 'consistent',
  size: 'large',
  groupingEnabled: true,
  groupingMinimum: 5,
});

export const CHAT_BUBBLE_CONSISTENT_SIZE_SCALES = Object.freeze({
  large: 1,
  medium: 0.8,
  small: 0.68,
});

const CHAT_BUBBLE_FIXED_SIZE_REDUCTION_SCALE = 0.75;

export const CHAT_BUBBLE_WORLD_SIZE_SCALES = Object.freeze({
  large: CHAT_BUBBLE_CONSISTENT_SIZE_SCALES.small * 0.7 * CHAT_BUBBLE_FIXED_SIZE_REDUCTION_SCALE,
  medium: CHAT_BUBBLE_CONSISTENT_SIZE_SCALES.small * 0.7 * 0.7 * CHAT_BUBBLE_FIXED_SIZE_REDUCTION_SCALE,
  small: CHAT_BUBBLE_CONSISTENT_SIZE_SCALES.small * 0.7 * 0.7 * 0.7 * CHAT_BUBBLE_FIXED_SIZE_REDUCTION_SCALE,
});

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function getVisiblePanelRect(panel, collapsedClass) {
  if (!panel || panel.classList?.contains(collapsedClass)) return null;
  const rect = panel.getBoundingClientRect?.();
  if (!rect || finiteNumber(rect.width) <= 0 || finiteNumber(rect.height) <= 0) return null;
  return rect;
}

export function getChatBubbleSideInsets({
  viewport,
  leftPanel,
  rightPanel,
  gap = DEFAULT_PANEL_GAP,
} = {}) {
  const viewportLeft = finiteNumber(viewport?.left);
  const viewportWidth = Math.max(1, finiteNumber(viewport?.width, 1));
  const viewportRight = viewportLeft + viewportWidth;
  const safeGap = Math.max(0, finiteNumber(gap, DEFAULT_PANEL_GAP));
  let leftInset = safeGap;
  let rightInset = safeGap;

  const leftRect = getVisiblePanelRect(leftPanel, 'left-sidebar-collapsed');
  if (leftRect) {
    const coveredRight = Math.min(viewportRight, Math.max(viewportLeft, finiteNumber(leftRect.right)));
    leftInset = Math.max(safeGap, Math.ceil(coveredRight - viewportLeft) + safeGap);
  }

  const rightRect = getVisiblePanelRect(rightPanel, 'sidebar-collapsed');
  if (rightRect) {
    const coveredLeft = Math.max(viewportLeft, Math.min(viewportRight, finiteNumber(rightRect.left, viewportRight)));
    rightInset = Math.max(safeGap, Math.ceil(viewportRight - coveredLeft) + safeGap);
  }

  return {
    leftInset,
    rightInset,
    leftBound: viewportLeft + leftInset,
    rightBound: viewportRight - rightInset,
  };
}

export function clampChatBubbleX(x, width, leftBound, rightBound) {
  const safeLeft = finiteNumber(leftBound);
  const safeRight = Math.max(safeLeft, finiteNumber(rightBound, safeLeft));
  const safeWidth = Math.max(0, finiteNumber(width));
  if (safeRight - safeLeft <= safeWidth) return safeLeft;
  return Math.max(safeLeft, Math.min(safeRight - safeWidth, finiteNumber(x, safeLeft)));
}

export function normalizeChatBubbleDisplaySettings(value = {}) {
  const displayMode = value?.displayMode === 'world' ? 'world' : DEFAULT_CHAT_BUBBLE_SETTINGS.displayMode;
  const size = Object.prototype.hasOwnProperty.call(CHAT_BUBBLE_CONSISTENT_SIZE_SCALES, value?.size)
    ? value.size
    : DEFAULT_CHAT_BUBBLE_SETTINGS.size;
  const groupingEnabled = typeof value?.groupingEnabled === 'boolean'
    ? value.groupingEnabled
    : DEFAULT_CHAT_BUBBLE_SETTINGS.groupingEnabled;
  const rawGroupingMinimum = value?.groupingMinimum;
  const requestedGroupingMinimum = rawGroupingMinimum === null || rawGroupingMinimum === ''
    ? Number.NaN
    : Number(rawGroupingMinimum);
  const groupingMinimum = Number.isFinite(requestedGroupingMinimum)
    ? Math.max(2, Math.floor(requestedGroupingMinimum))
    : DEFAULT_CHAT_BUBBLE_SETTINGS.groupingMinimum;
  return { displayMode, size, groupingEnabled, groupingMinimum };
}

export function shouldGroupChatBubbles(expandedCount, value = {}) {
  const settings = normalizeChatBubbleDisplaySettings(value);
  const count = Math.max(0, Math.floor(finiteNumber(expandedCount)));
  return settings.groupingEnabled && count >= settings.groupingMinimum;
}

export function getChatBubbleDisplayScale(value = {}, cameraDistance = 40) {
  const settings = normalizeChatBubbleDisplaySettings(value);
  const sizeScales = settings.displayMode === 'world'
    ? CHAT_BUBBLE_WORLD_SIZE_SCALES
    : CHAT_BUBBLE_CONSISTENT_SIZE_SCALES;
  const baseScale = sizeScales[settings.size];
  const safeCameraDistance = Math.max(0.001, finiteNumber(cameraDistance, 40));
  const zoomScale = settings.displayMode === 'world'
    ? 40 / safeCameraDistance
    : 1;

  return {
    ...settings,
    baseScale,
    typographyScale: baseScale,
    zoomScale,
    transformScale: settings.displayMode === 'world' ? zoomScale : 1,
    effectiveScale: baseScale * zoomScale,
  };
}

export function getChatBubbleChromeMetrics(displayMode = 'consistent', chromeScale = 1) {
  const metricScale = displayMode === 'world'
    ? Math.max(0.05, finiteNumber(chromeScale, 1))
    : 1;
  const outerRadius = displayMode === 'world'
    ? 6 * (metricScale / CHAT_BUBBLE_WORLD_SIZE_SCALES.large)
    : 12;
  const scrollbarWidth = displayMode === 'world'
    ? Math.max(1.25, 3 * metricScale)
    : 3;

  return {
    outerRadius,
    sessionPaddingY: metricScale,
    sessionPaddingX: 5 * metricScale,
    sessionBorderWidth: metricScale,
    sessionRadius: 4 * metricScale,
    scrollbarWidth,
    scrollbarThumbRadius: scrollbarWidth * (2 / 3),
  };
}

export function getRigidWorldChatBubbleLayout({
  expandedCount = 1,
  availableWidth = 1,
  baseScale = 1,
  zoomScale = 1,
} = {}) {
  const count = Math.max(1, Math.floor(finiteNumber(expandedCount, 1)));
  const safeBaseScale = Math.max(0.05, finiteNumber(baseScale, 1));
  const safeZoomScale = Math.max(0.05, finiteNumber(zoomScale, 1));
  const intrinsicW = Math.max(1, Math.round(320 * safeBaseScale));
  const intrinsicH = Math.max(1, Math.round(280 * safeBaseScale));
  const w = intrinsicW * safeZoomScale;
  const h = intrinsicH * safeZoomScale;
  const gap = Math.max(4, 10 * safeBaseScale * safeZoomScale);
  const safeAvailableWidth = Math.max(1, finiteNumber(availableWidth, 1));
  const maxColumns = Math.max(1, Math.floor((safeAvailableWidth + gap) / (w + gap)));
  const columns = Math.max(1, Math.min(count, maxColumns));

  return {
    w,
    h,
    scale: safeBaseScale * safeZoomScale,
    gap,
    columns,
    rows: Math.ceil(count / columns),
    intrinsicW,
    intrinsicH,
    intrinsicScale: safeBaseScale,
    transformScale: safeZoomScale,
  };
}

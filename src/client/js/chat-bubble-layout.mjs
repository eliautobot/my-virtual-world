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
    outerBorderWidth: displayMode === 'world' ? 2 * metricScale : 2,
    headerBorderWidth: displayMode === 'world' ? metricScale : 1,
    outerRadius,
    sessionPaddingY: displayMode === 'world' ? 2 * metricScale : 1,
    sessionPaddingX: (displayMode === 'world' ? 6 : 5) * metricScale,
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

function overlayRectsOverlap(a, b, gap = 0) {
  const safeGap = Math.max(0, finiteNumber(gap));
  return a.x < b.x + b.w + safeGap
    && a.x + a.w + safeGap > b.x
    && a.y < b.y + b.h + safeGap
    && a.y + a.h + safeGap > b.y;
}

export function resolveChatBubbleObstacleCollisions(
  rects = [],
  obstacles = [],
  bounds = {},
  gap = 8
) {
  if (!Array.isArray(rects) || !Array.isArray(obstacles) || !rects.length || !obstacles.length) return rects;
  const left = finiteNumber(bounds.left);
  const top = finiteNumber(bounds.top);
  const right = Math.max(left, finiteNumber(bounds.right, left));
  const bottom = Math.max(top, finiteNumber(bounds.bottom, top));
  const safeGap = Math.max(0, finiteNumber(gap, 8));
  const clampCandidate = (rect, x, y) => ({
    x: Math.max(left, Math.min(Math.max(left, right - rect.w), x)),
    y: Math.max(top, Math.min(Math.max(top, bottom - rect.h), y)),
  });

  for (let pass = 0; pass < Math.max(4, obstacles.length * 3); pass++) {
    let moved = false;
    for (let index = 0; index < rects.length; index++) {
      const rect = rects[index];
      const obstacle = obstacles.find(item => overlayRectsOverlap(rect, item, safeGap));
      if (!obstacle) continue;
      const candidates = [
        clampCandidate(rect, rect.x, obstacle.y - rect.h - safeGap),
        clampCandidate(rect, rect.x, obstacle.y + obstacle.h + safeGap),
        clampCandidate(rect, obstacle.x - rect.w - safeGap, rect.y),
        clampCandidate(rect, obstacle.x + obstacle.w + safeGap, rect.y),
      ];
      let best = null;
      for (const candidate of candidates) {
        const candidateRect = { ...rect, ...candidate };
        const obstacleHits = obstacles.reduce((count, item) => count + Number(overlayRectsOverlap(candidateRect, item, safeGap)), 0);
        const chatHits = rects.reduce((count, item, otherIndex) => (
          count + Number(otherIndex !== index && overlayRectsOverlap(candidateRect, item, 4))
        ), 0);
        const distance = Math.hypot(candidate.x - rect.x, candidate.y - rect.y);
        const score = obstacleHits * 1_000_000_000 + chatHits * 1_000_000 + distance;
        if (!best || score < best.score) best = { ...candidate, score };
      }
      if (!best || (best.x === rect.x && best.y === rect.y)) continue;
      rect.x = best.x;
      rect.y = best.y;
      rect.movedForObstacle = true;
      moved = true;
    }
    if (!moved || rects.every(rect => obstacles.every(obstacle => !overlayRectsOverlap(rect, obstacle, safeGap)))) break;
  }
  return rects;
}

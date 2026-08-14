const WINDOW_FACES = Object.freeze(['front', 'back', 'left', 'right']);

const WINDOW_STYLES = Object.freeze({
  office: Object.freeze({
    kind: 'office',
    edgeInset: 0.55,
    doorOffset: 0.36,
    desiredWidth: 1.9,
    minimumWidth: 1.08,
    desiredGap: 0.35,
    bottom: 0.62,
    height: 1.82,
    frameThickness: 0.075,
    frameColor: 0x607d8b,
    glassColor: 0x8fd8f8,
    glassOpacity: 0.3,
    mullions: 0,
    rails: 0,
  }),
  store: Object.freeze({
    kind: 'storefront',
    edgeInset: 0.62,
    doorOffset: 0.26,
    minimumWidth: 0.85,
    bottom: 0.36,
    height: 2.08,
    frameThickness: 0.085,
    frameColor: 0x455a64,
    glassColor: 0x79d8f2,
    glassOpacity: 0.27,
    mullions: 0,
    rails: 0,
  }),
  home: Object.freeze({
    kind: 'residential',
    edgeInset: 0.9,
    doorOffset: 0.68,
    desiredWidth: 1.55,
    minimumWidth: 1.0,
    desiredGap: 2.1,
    bottom: 0.72,
    height: 1.55,
    frameThickness: 0.105,
    frameColor: 0xf5f0e6,
    glassColor: 0x9fd8ee,
    glassOpacity: 0.32,
    mullions: 1,
    rails: 1,
  }),
});

const EPSILON = 1e-6;

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function normalizedBuildingType(type) {
  const candidate = String(type || 'office').toLowerCase();
  return candidate === 'store' || candidate === 'home' ? candidate : 'office';
}

function subtractIntervals(start, end, exclusions = []) {
  let runs = [{ start, end }];
  for (const exclusion of exclusions) {
    const blockStart = clamp(finite(exclusion?.start), start, end);
    const blockEnd = clamp(finite(exclusion?.end), start, end);
    if (blockEnd - blockStart <= EPSILON) continue;
    const next = [];
    for (const run of runs) {
      if (blockEnd <= run.start + EPSILON || blockStart >= run.end - EPSILON) {
        next.push(run);
        continue;
      }
      if (blockStart > run.start + EPSILON) next.push({ start: run.start, end: blockStart });
      if (blockEnd < run.end - EPSILON) next.push({ start: blockEnd, end: run.end });
    }
    runs = next;
  }
  return runs.filter((run) => run.end - run.start > EPSILON);
}

function distributeWindowsInRun(run, style) {
  const runLength = run.end - run.start;
  if (runLength < style.minimumWidth - EPSILON) return [];
  const count = Math.max(1, Math.floor((runLength + style.desiredGap) / (style.desiredWidth + style.desiredGap)));
  const width = Math.min(style.desiredWidth, (runLength - style.desiredGap * Math.max(0, count - 1)) / count);
  if (width < style.minimumWidth - EPSILON) return [];
  const gap = Math.max(0, (runLength - width * count) / (count + 1));
  return Array.from({ length: count }, (_, index) => ({
    center: run.start + gap + width / 2 + index * (width + gap),
    width,
  }));
}

export function getBuildingWindowStyle(type) {
  return WINDOW_STYLES[normalizedBuildingType(type)];
}

export function getFacadeWindowOpenings({
  type = 'office',
  face = 'front',
  floor = 1,
  length = 0,
  wallHeight = 3,
  doorOpeningWidth = 0,
} = {}) {
  const style = getBuildingWindowStyle(type);
  const safeFace = WINDOW_FACES.includes(face) ? face : 'front';
  const safeFloor = Math.max(1, Math.floor(finite(floor, 1)));
  const safeLength = Math.max(0, finite(length));
  const safeWallHeight = Math.max(0.1, finite(wallHeight, 3));
  const edgeInset = Math.min(style.edgeInset, Math.max(0.16, safeLength * 0.22));
  const start = edgeInset;
  const end = safeLength - edgeInset;
  if (end - start < style.minimumWidth - EPSILON) return [];

  const exclusions = [];
  const safeDoorWidth = Math.max(0, finite(doorOpeningWidth));
  if (safeFace === 'front' && safeFloor === 1 && safeDoorWidth > EPSILON) {
    const doorStart = safeLength / 2 - safeDoorWidth / 2 - style.doorOffset;
    const doorEnd = safeLength / 2 + safeDoorWidth / 2 + style.doorOffset;
    exclusions.push({ start: doorStart, end: doorEnd });
  }

  const windowHeight = Math.min(style.height, Math.max(0.72, safeWallHeight - style.bottom - 0.34));
  const runs = subtractIntervals(start, end, exclusions);
  const horizontalOpenings = style.kind === 'storefront'
    ? runs
      .filter((run) => run.end - run.start >= style.minimumWidth - EPSILON)
      .map((run) => ({ center: (run.start + run.end) / 2, width: run.end - run.start }))
    : runs.flatMap((run) => distributeWindowsInRun(run, style));

  return horizontalOpenings.map((opening, index) => Object.freeze({
    id: `${style.kind}-${safeFace}-f${safeFloor}-w${index + 1}`,
    kind: style.kind,
    face: safeFace,
    floor: safeFloor,
    center: opening.center,
    width: opening.width,
    bottom: style.bottom,
    height: windowHeight,
    frameThickness: style.frameThickness,
    frameColor: style.frameColor,
    glassColor: style.glassColor,
    glassOpacity: style.glassOpacity,
    mullions: style.mullions,
    rails: style.rails,
  }));
}

export function getBuildingWindowLayout({
  type = 'office',
  width = 0,
  depth = 0,
  floorCount = 1,
  wallHeight = 3,
  doorOpeningWidth = 2.4,
} = {}) {
  const safeWidth = Math.max(0, finite(width));
  const safeDepth = Math.max(0, finite(depth));
  const safeFloorCount = Math.max(1, Math.floor(finite(floorCount, 1)));
  const openings = [];
  for (let floor = 1; floor <= safeFloorCount; floor++) {
    for (const face of WINDOW_FACES) {
      openings.push(...getFacadeWindowOpenings({
        type,
        face,
        floor,
        length: face === 'front' || face === 'back' ? safeWidth : safeDepth,
        wallHeight,
        doorOpeningWidth,
      }));
    }
  }
  return Object.freeze(openings);
}

function normalizeWallOpenings(length, height, openings) {
  return (Array.isArray(openings) ? openings : []).map((opening, index) => {
    const width = Math.max(0, finite(opening?.width));
    const openingHeight = Math.max(0, finite(opening?.height));
    const center = finite(opening?.center);
    const bottom = finite(opening?.bottom);
    const start = clamp(center - width / 2, 0, length);
    const end = clamp(center + width / 2, 0, length);
    const y1 = clamp(bottom, 0, height);
    const y2 = clamp(bottom + openingHeight, 0, height);
    return { id: opening?.id || `opening-${index + 1}`, start, end, bottom: y1, top: y2 };
  }).filter((opening) => opening.end - opening.start > EPSILON && opening.top - opening.bottom > EPSILON);
}

function mergeIntervals(intervals) {
  const sorted = [...intervals].sort((a, b) => a.start - b.start || a.end - b.end);
  const merged = [];
  for (const interval of sorted) {
    const previous = merged[merged.length - 1];
    if (!previous || interval.start > previous.end + EPSILON) {
      merged.push({ start: interval.start, end: interval.end });
    } else {
      previous.end = Math.max(previous.end, interval.end);
    }
  }
  return merged;
}

export function getWallSegmentsForOpenings({ length = 0, height = 0, openings = [] } = {}) {
  const safeLength = Math.max(0, finite(length));
  const safeHeight = Math.max(0, finite(height));
  if (safeLength <= EPSILON || safeHeight <= EPSILON) return Object.freeze([]);
  const normalized = normalizeWallOpenings(safeLength, safeHeight, openings);
  const yBoundaries = [...new Set([0, safeHeight, ...normalized.flatMap((opening) => [opening.bottom, opening.top])])]
    .sort((a, b) => a - b);
  const segments = [];

  for (let yIndex = 0; yIndex < yBoundaries.length - 1; yIndex++) {
    const bottom = yBoundaries[yIndex];
    const top = yBoundaries[yIndex + 1];
    if (top - bottom <= EPSILON) continue;
    const midpoint = (bottom + top) / 2;
    const blocked = mergeIntervals(normalized
      .filter((opening) => midpoint > opening.bottom + EPSILON && midpoint < opening.top - EPSILON)
      .map((opening) => ({ start: opening.start, end: opening.end })));
    let cursor = 0;
    for (const interval of blocked) {
      if (interval.start > cursor + EPSILON) {
        segments.push({ center: (cursor + interval.start) / 2, width: interval.start - cursor, bottom, height: top - bottom });
      }
      cursor = Math.max(cursor, interval.end);
    }
    if (cursor < safeLength - EPSILON) {
      segments.push({ center: (cursor + safeLength) / 2, width: safeLength - cursor, bottom, height: top - bottom });
    }
  }
  return Object.freeze(segments.map((segment) => Object.freeze(segment)));
}

export function validateBuildingWindowLayout(openings = [], { width = 0, depth = 0, wallHeight = 3 } = {}) {
  const errors = [];
  const grouped = new Map();
  for (const opening of Array.isArray(openings) ? openings : []) {
    const length = opening.face === 'front' || opening.face === 'back' ? width : depth;
    const start = opening.center - opening.width / 2;
    const end = opening.center + opening.width / 2;
    if (start < -EPSILON || end > length + EPSILON || opening.bottom < -EPSILON || opening.bottom + opening.height > wallHeight + EPSILON) {
      errors.push(`out-of-bounds:${opening.id}`);
    }
    const key = `${opening.face}:f${opening.floor}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(opening);
  }
  for (const [key, items] of grouped) {
    const sorted = [...items].sort((a, b) => (a.center - a.width / 2) - (b.center - b.width / 2));
    for (let index = 1; index < sorted.length; index++) {
      const previousEnd = sorted[index - 1].center + sorted[index - 1].width / 2;
      const currentStart = sorted[index].center - sorted[index].width / 2;
      if (currentStart < previousEnd - EPSILON) errors.push(`overlap:${key}:${sorted[index - 1].id}:${sorted[index].id}`);
    }
  }
  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors) });
}

export { WINDOW_FACES };

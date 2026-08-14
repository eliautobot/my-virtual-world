const RESIZE_DIRECTIONS = new Set(['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']);

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function clamp(value, minimum, maximum) {
  const low = Math.min(minimum, maximum);
  const high = Math.max(minimum, maximum);
  return Math.min(high, Math.max(low, value));
}

export function normalizeFloatingBounds(bounds = {}) {
  const left = finiteNumber(bounds.left);
  const top = finiteNumber(bounds.top);
  const right = Math.max(left, finiteNumber(bounds.right, left));
  const bottom = Math.max(top, finiteNumber(bounds.bottom, top));
  return { left, top, right, bottom };
}

function normalizeMinimumSize(minimumSize, bounds) {
  const availableWidth = bounds.right - bounds.left;
  const availableHeight = bounds.bottom - bounds.top;
  return {
    width: Math.min(availableWidth, Math.max(0, finiteNumber(minimumSize?.width))),
    height: Math.min(availableHeight, Math.max(0, finiteNumber(minimumSize?.height))),
  };
}

export function constrainFloatingRect(rect, bounds, minimumSize = {}) {
  const area = normalizeFloatingBounds(bounds);
  const minimum = normalizeMinimumSize(minimumSize, area);
  const availableWidth = area.right - area.left;
  const availableHeight = area.bottom - area.top;
  const width = clamp(finiteNumber(rect?.width, minimum.width), minimum.width, availableWidth);
  const height = clamp(finiteNumber(rect?.height, minimum.height), minimum.height, availableHeight);
  const left = clamp(finiteNumber(rect?.left, area.left), area.left, area.right - width);
  const top = clamp(finiteNumber(rect?.top, area.top), area.top, area.bottom - height);
  return { left, top, width, height };
}

export function moveFloatingRect(rect, deltaX, deltaY, bounds, minimumSize = {}) {
  const start = constrainFloatingRect(rect, bounds, minimumSize);
  return constrainFloatingRect({
    ...start,
    left: start.left + finiteNumber(deltaX),
    top: start.top + finiteNumber(deltaY),
  }, bounds, minimumSize);
}

export function resizeFloatingRect(rect, direction, deltaX, deltaY, bounds, minimumSize = {}) {
  if (!RESIZE_DIRECTIONS.has(direction)) {
    throw new TypeError(`Unsupported resize direction: ${direction}`);
  }

  const area = normalizeFloatingBounds(bounds);
  const minimum = normalizeMinimumSize(minimumSize, area);
  const start = constrainFloatingRect(rect, area, minimum);
  const startRight = start.left + start.width;
  const startBottom = start.top + start.height;
  const dx = finiteNumber(deltaX);
  const dy = finiteNumber(deltaY);

  let left = start.left;
  let right = startRight;
  let top = start.top;
  let bottom = startBottom;

  if (direction.includes('w')) {
    left = clamp(start.left + dx, area.left, startRight - minimum.width);
  } else if (direction.includes('e')) {
    right = clamp(startRight + dx, start.left + minimum.width, area.right);
  }

  if (direction.includes('n')) {
    top = clamp(start.top + dy, area.top, startBottom - minimum.height);
  } else if (direction.includes('s')) {
    bottom = clamp(startBottom + dy, start.top + minimum.height, area.bottom);
  }

  return {
    left,
    top,
    width: right - left,
    height: bottom - top,
  };
}

export function snapFloatingRect(side, bounds) {
  if (!['left', 'right'].includes(side)) {
    throw new TypeError(`Unsupported snap side: ${side}`);
  }
  const area = normalizeFloatingBounds(bounds);
  const width = (area.right - area.left) / 2;
  return {
    left: side === 'left' ? area.left : area.right - width,
    top: area.top,
    width,
    height: area.bottom - area.top,
  };
}

function rectFromElement(element) {
  const rect = element.getBoundingClientRect();
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

function applyRect(element, rect) {
  element.style.left = `${Math.round(rect.left)}px`;
  element.style.top = `${Math.round(rect.top)}px`;
  element.style.width = `${Math.round(rect.width)}px`;
  element.style.height = `${Math.round(rect.height)}px`;
  element.style.right = 'auto';
  element.style.bottom = 'auto';
}

function clearInlineGeometry(element) {
  for (const property of ['left', 'right', 'top', 'bottom', 'width', 'height']) {
    element.style.removeProperty(property);
  }
}

export function createBrowserWindowController({
  panel,
  dragHandle,
  frame,
  maximizeButton,
  resizeHandles = [],
  getBounds,
  minimumSize = { width: 480, height: 360 },
  isCompactLayout = () => false,
  windowLabel = 'Agent Browser',
  bodyInteractionClass = 'browser-window-interacting',
}) {
  if (!panel || !dragHandle || typeof getBounds !== 'function') {
    throw new TypeError('Browser window controller requires a panel, drag handle, and bounds provider.');
  }

  let interaction = null;
  let pendingPoint = null;
  let animationFrame = 0;
  let restoreRect = null;
  let snapMode = null;
  let framePointerEvents = '';
  let bodyCursor = '';
  const listeners = [];

  function listen(target, type, handler, options) {
    target?.addEventListener(type, handler, options);
    if (target) listeners.push(() => target.removeEventListener(type, handler, options));
  }

  function currentBounds() {
    return normalizeFloatingBounds(getBounds());
  }

  function syncMaximizeButton(maximized) {
    if (!maximizeButton) return;
    maximizeButton.setAttribute('aria-pressed', String(maximized));
    maximizeButton.setAttribute('aria-label', maximized ? `Restore ${windowLabel} window` : `Maximize ${windowLabel}`);
    maximizeButton.title = maximized ? `Restore ${windowLabel} window` : `Maximize ${windowLabel}`;
    maximizeButton.textContent = maximized ? '❐' : '□';
  }

  function constrain() {
    if (panel.style.display === 'none') return null;
    if (isCompactLayout()) {
      panel.classList.remove('is-maximized');
      syncMaximizeButton(false);
      restoreRect = null;
      snapMode = null;
      clearInlineGeometry(panel);
      return rectFromElement(panel);
    }
    if (panel.classList.contains('is-maximized')) return rectFromElement(panel);
    if (snapMode) {
      const next = snapFloatingRect(snapMode, currentBounds());
      applyRect(panel, next);
      return next;
    }
    const next = constrainFloatingRect(rectFromElement(panel), currentBounds(), minimumSize);
    applyRect(panel, next);
    return next;
  }

  function setMaximized(maximized) {
    const shouldMaximize = Boolean(maximized) && !isCompactLayout();
    const isMaximized = panel.classList.contains('is-maximized');
    if (shouldMaximize === isMaximized) {
      syncMaximizeButton(isMaximized);
      return isMaximized;
    }

    if (shouldMaximize) {
      if (!restoreRect) restoreRect = constrainFloatingRect(rectFromElement(panel), currentBounds(), minimumSize);
      snapMode = null;
      clearInlineGeometry(panel);
      panel.classList.add('is-maximized');
    } else {
      panel.classList.remove('is-maximized');
      if (restoreRect) applyRect(panel, restoreRect);
      restoreRect = null;
      constrain();
    }
    syncMaximizeButton(shouldMaximize);
    return shouldMaximize;
  }

  function snap(side) {
    if (side == null) {
      const wasSnapped = Boolean(snapMode);
      snapMode = null;
      if (wasSnapped && restoreRect) {
        applyRect(panel, restoreRect);
        restoreRect = null;
        constrain();
      }
      return null;
    }
    if (!['left', 'right'].includes(side)) {
      throw new TypeError(`Unsupported snap side: ${side}`);
    }
    if (isCompactLayout()) return null;
    const wasMaximized = panel.classList.contains('is-maximized');
    if (snapMode === side) {
      snapMode = null;
      panel.classList.remove('is-maximized');
      if (restoreRect) applyRect(panel, restoreRect);
      restoreRect = null;
      constrain();
      syncMaximizeButton(false);
      return null;
    }
    if (!snapMode && !wasMaximized) {
      restoreRect = constrainFloatingRect(rectFromElement(panel), currentBounds(), minimumSize);
    }
    panel.classList.remove('is-maximized');
    syncMaximizeButton(false);
    snapMode = side;
    applyRect(panel, snapFloatingRect(side, currentBounds()));
    return snapMode;
  }

  function endInteraction() {
    if (!interaction) return;
    if (animationFrame) {
      cancelAnimationFrame(animationFrame);
      animationFrame = 0;
    }
    interaction = null;
    pendingPoint = null;
    panel.classList.remove('is-window-interacting');
    document.body.classList.remove(bodyInteractionClass);
    document.body.style.cursor = bodyCursor;
    if (frame) frame.style.pointerEvents = framePointerEvents;
  }

  function flushInteraction() {
    animationFrame = 0;
    if (!interaction || !pendingPoint) return;
    const dx = pendingPoint.x - interaction.startX;
    const dy = pendingPoint.y - interaction.startY;
    const next = interaction.type === 'move'
      ? moveFloatingRect(interaction.startRect, dx, dy, currentBounds(), minimumSize)
      : resizeFloatingRect(interaction.startRect, interaction.direction, dx, dy, currentBounds(), minimumSize);
    applyRect(panel, next);
  }

  function scheduleInteraction(event) {
    if (!interaction || event.pointerId !== interaction.pointerId) return;
    pendingPoint = { x: event.clientX, y: event.clientY };
    if (!animationFrame) animationFrame = requestAnimationFrame(flushInteraction);
  }

  function beginInteraction(event, type, direction = null) {
    if (event.button !== 0 || panel.classList.contains('is-maximized') || isCompactLayout()) return;
    if (type === 'move' && event.target.closest('button, a, input, select, textarea')) return;
    event.preventDefault();
    event.stopPropagation();

    if (snapMode) {
      snapMode = null;
      restoreRect = null;
    }

    const bounds = currentBounds();
    const startRect = constrainFloatingRect(rectFromElement(panel), bounds, minimumSize);
    applyRect(panel, startRect);
    interaction = {
      type,
      direction,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startRect,
    };
    pendingPoint = { x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    framePointerEvents = frame?.style.pointerEvents || '';
    bodyCursor = document.body.style.cursor;
    if (frame) frame.style.pointerEvents = 'none';
    document.body.style.cursor = getComputedStyle(event.currentTarget).cursor;
    document.body.classList.add(bodyInteractionClass);
    panel.classList.add('is-window-interacting');
  }

  listen(dragHandle, 'pointerdown', event => beginInteraction(event, 'move'));
  listen(dragHandle, 'dblclick', event => {
    if (event.target.closest('button, a, input, select, textarea') || isCompactLayout()) return;
    event.preventDefault();
    setMaximized(!panel.classList.contains('is-maximized'));
  });

  for (const handle of resizeHandles) {
    const direction = handle?.dataset?.resize;
    if (!RESIZE_DIRECTIONS.has(direction)) continue;
    listen(handle, 'pointerdown', event => beginInteraction(event, 'resize', direction));
  }

  listen(window, 'pointermove', scheduleInteraction, { passive: true });
  listen(window, 'pointerup', event => {
    if (!interaction || event.pointerId !== interaction.pointerId) return;
    pendingPoint = { x: event.clientX, y: event.clientY };
    flushInteraction();
    endInteraction();
  });
  listen(window, 'pointercancel', endInteraction);
  listen(window, 'blur', endInteraction);
  listen(window, 'resize', () => {
    if (isCompactLayout()) setMaximized(false);
    requestAnimationFrame(constrain);
  }, { passive: true });
  listen(maximizeButton, 'click', () => setMaximized(!panel.classList.contains('is-maximized')));

  syncMaximizeButton(panel.classList.contains('is-maximized'));

  return {
    constrain,
    setMaximized,
    snap,
    getSnapMode: () => snapMode,
    destroy() {
      endInteraction();
      listeners.splice(0).forEach(remove => remove());
    },
  };
}

import assert from 'node:assert/strict';

import {
  constrainFloatingRect,
  moveFloatingRect,
  resizeFloatingRect,
} from '../src/client/js/browser-window-controller.mjs';

const bounds = { left: 0, top: 56, right: 1200, bottom: 800 };
const minimumSize = { width: 480, height: 360 };

assert.deepEqual(
  constrainFloatingRect({ left: 900, top: 700, width: 600, height: 500 }, bounds, minimumSize),
  { left: 600, top: 300, width: 600, height: 500 },
  'panel bounds should remain completely inside the usable viewport',
);

assert.deepEqual(
  moveFloatingRect({ left: 600, top: 200, width: 600, height: 500 }, 900, -900, bounds, minimumSize),
  { left: 600, top: 56, width: 600, height: 500 },
  'header dragging should clamp at every viewport edge',
);

assert.deepEqual(
  resizeFloatingRect({ left: 300, top: 200, width: 600, height: 400 }, 'se', 600, 500, bounds, minimumSize),
  { left: 300, top: 200, width: 900, height: 600 },
  'south-east resizing should stop at the right and bottom bounds',
);

assert.deepEqual(
  resizeFloatingRect({ left: 300, top: 200, width: 600, height: 400 }, 'nw', 500, 500, bounds, minimumSize),
  { left: 420, top: 240, width: 480, height: 360 },
  'north-west resizing should preserve the opposite corner at minimum size',
);

assert.deepEqual(
  resizeFloatingRect({ left: 300, top: 200, width: 600, height: 400 }, 'nw', -900, -900, bounds, minimumSize),
  { left: 0, top: 56, width: 900, height: 544 },
  'north-west resizing should stop at the top and left viewport bounds',
);

const allEdgeExpectations = {
  n: { left: 300, top: 230, width: 600, height: 370 },
  s: { left: 300, top: 200, width: 600, height: 430 },
  e: { left: 300, top: 200, width: 640, height: 400 },
  w: { left: 340, top: 200, width: 560, height: 400 },
  ne: { left: 300, top: 230, width: 640, height: 370 },
  nw: { left: 340, top: 230, width: 560, height: 370 },
  se: { left: 300, top: 200, width: 640, height: 430 },
  sw: { left: 340, top: 200, width: 560, height: 430 },
};
for (const [direction, expected] of Object.entries(allEdgeExpectations)) {
  assert.deepEqual(
    resizeFloatingRect({ left: 300, top: 200, width: 600, height: 400 }, direction, 40, 30, bounds, minimumSize),
    expected,
    `${direction} handle should resize from its declared edge or corner`,
  );
}

assert.deepEqual(
  constrainFloatingRect(
    { left: -50, top: -50, width: 900, height: 900 },
    { left: 0, top: 58, right: 360, bottom: 640 },
    minimumSize,
  ),
  { left: 0, top: 58, width: 360, height: 582 },
  'minimum dimensions should adapt safely when a viewport is smaller than desktop minimums',
);

assert.throws(
  () => resizeFloatingRect({ left: 0, top: 0, width: 500, height: 500 }, 'invalid', 0, 0, bounds, minimumSize),
  /Unsupported resize direction/,
  'invalid resize handles should fail fast',
);

console.log('browser window controller geometry tests passed');

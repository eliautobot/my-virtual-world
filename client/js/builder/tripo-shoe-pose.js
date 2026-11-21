// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Character builder (client/js/builder/): part of the character model library imported from the builder studio (2026-11-18).
// The same smooth insole incline is used by the footwear pattern generator.
// Distances are normalized foundation units, before body sizing or animation.
const active = new WeakMap();
// MVW: off for the crowd's parts library (client/dev/builder-kit.html __open, tools/chars/crowd-pack.mjs): its residents
// share one bare body, so a shoe's coverage is read against the foot where it is (raised, its skin would seem dropped).
let heelFit = true;
export function setHeelFit(on) { heelFit = !!on; }
function smooth(t) {
  t = Math.max(0, Math.min(1, t));
  return t * t * (3 - 2 * t);
}
export function fitTripoHeels(body, design) {
  const previous = active.get(body);
  if (previous) previous();
  if (!heelFit || !design?.heelRaise) return () => {};
  const parts = ["leftLeg", "rightLeg"];
  for (const part of parts) {
    const pos = body.restGeometry(part).attributes.position;
    const offsets = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const along = smooth((0.055 - pos.getZ(i)) / 0.105);
      const ankle = 1 - smooth((pos.getY(i) - 0.032) / 0.105);
      offsets[3 * i + 1] = design.heelRaise * along * ankle;
    }
    body.setPartOffsets(part, offsets);
  }
  function release() {
    if (active.get(body) !== release) return;
    active.delete(body);
    for (const part of parts) body.setPartOffsets(part, null);
  }
  active.set(body, release);
  return release;
}

// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Character builder (client/js/builder/): part of the character model library imported from the builder studio (2026-11-18).
import { BufferAttribute, MathUtils } from "three";

const cached = new WeakMap();

// Give the sole, upper, laces and overlays one continuous paint field.
// A last flexes across the ball; its heel counter moves with the foot.
export function bindShoe(geometry, packet, body, heelRaise = 0) {
  let rig = cached.get(packet);
  if (!rig) {
    const p = geometry.attributes.position;
    const indices = new Uint16Array(p.count * 4);
    const weights = new Float32Array(p.count * 4);
    const female = body.gender === "female";
    const ankles = ["Right", "Left"].map((side) =>
      ["Foot", "ToeBase", "Leg"].map((name) =>
        body.bones.indexOf(body.boneMap.get(side + name)),
      ),
    );
    const angle = female ? 0.145 : 0.17;
    const skinJoints = geometry.attributes.skinIndex;
    const skinWeights = geometry.attributes.skinWeight;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i),
        z = p.getZ(i),
        side = x > 0 ? 1 : -1;
      if (packet.sockRanges?.some(([start, end]) => i >= start && i < end)) {
        // Stretch knit follows the calf independently of the leather shaft.
        for (let lane = 0; lane < 4; lane++) {
          indices[4 * i + lane] = skinJoints.getComponent(i, lane);
          weights[4 * i + lane] = skinWeights.getComponent(i, lane);
        }
        continue;
      }
      const forward =
        (side * x - (female ? 0.091 : 0.092)) * Math.sin(angle) +
        (z + (female ? 0.043 : 0.046)) * Math.cos(angle);
      const ball = female ? 0.078 : 0.092;
      const toe = MathUtils.smoothstep(forward, ball - 0.03, ball + 0.033);
      const rise = heelRaise * MathUtils.smoothstep(0.055 - z, 0, 0.105);
      const surfaceY = p.getY(i);
      // Invert the raised heel's insole before locating the ankle flex.
      let y = surfaceY - rise;
      for (let pass = 0; rise && pass < 8; pass++)
        y = surfaceY - rise * (1 - MathUtils.smoothstep(y, 0.032, 0.137));
      const shin =
        (1 - toe) * MathUtils.smoothstep(y, 0.034, female ? 0.11 : 0.1);
      indices.set(ankles[side > 0 ? 1 : 0], i * 4);
      weights.set([1 - toe - shin, toe, shin], i * 4);
    }
    rig = [new BufferAttribute(indices, 4), new BufferAttribute(weights, 4)];
    cached.set(packet, rig);
  }
  geometry.setAttribute("skinIndex", rig[0]);
  geometry.setAttribute("skinWeight", rig[1]);
  for (const [start, end] of packet.sockRanges || [])
    for (let i = start; i < end; i++)
      geometry.userData.fitParts[i] =
        geometry.attributes.position.getX(i) > 0 ? "leftLeg" : "rightLeg";
}

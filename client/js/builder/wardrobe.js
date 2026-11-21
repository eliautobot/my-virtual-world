// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Character builder (client/js/builder/): part of the character model library imported from the builder studio (2026-11-18).
import * as THREE from "three";
import patterns from "/assets/builder/tailoring.js";
import sculptedClothes from "/assets/builder/sculpt-clothes.js";
import originalShoes from "/assets/builder/original-shoes.js";
// (MVW: the collections' patterns load the first time a look wears one of their pieces, not with the builder — the
// Tripo collection ~75 MB, the expanded tops, bottoms and shoes ~34 MB more; the builder opens with the original pieces
// alone (2026-11-19: "build its own loads very slowly"). wearNeeds → loadWear; buildWardrobe leaves out a piece whose
// patterns aren't loaded yet.)
const PACKS = {
  clothes: "/assets/builder/tripo-clothes.js", shoes: "/assets/builder/tripo-shoes.js",
  expTop: "/assets/builder/expanded-tops.js", expBottom: "/assets/builder/expanded-bottoms.js", expShoes: "/assets/builder/expanded-shoes.js",
};
const packs = {}, packLoads = {};
export const wearLoaded = (kind) => !!packs[kind];
export function loadWear(kinds = Object.keys(PACKS)) {
  return Promise.all(kinds.map((kind) => (packLoads[kind] ??= import(PACKS[kind])
    .then((m) => { packs[kind] = m.default; })
    .catch((e) => { delete packLoads[kind]; throw e; }))));
}
/** The pattern packs a look's clothes need (wardrobe-catalog.js: the Tripo collection's pieces, the expanded ones). */
export function wearPacks(gender, selections) {
  const need = new Set();
  for (const category of ["top", "bottom", "shoes"]) {
    const style = selections?.[category];
    if (!Number.isInteger(style) || style < 0) continue;
    const design = garmentDesign(gender, category, style);
    if (design?.source) need.add(category === "shoes" ? "shoes" : "clothes");
    else if (design) need.add(category === "top" ? "expTop" : category === "bottom" ? "expBottom" : "expShoes");
  }
  return [...need];
}
import { applyTripoTextile } from "./tripo-textile.js";
import { fitTripoHeels } from "./tripo-shoe-pose.js";
import { bindShoe } from "./shoe-rig.js";
import { fitGarments, coverFoundation } from "./garment-fit.js";
import {
  wardrobeOptions,
  originalShoeCount,
  shoeProfile,
  garmentDesign,
  collectionStarts,
} from "./wardrobe-catalog.js";
export { wardrobeOptions };

const bytes = (value) => Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
const decoded = new WeakMap();
const expandedPack = { top: "expTop", bottom: "expBottom", shoes: "expShoes" };
function unwrap(packet) {
  if (!decoded.has(packet)) {
    const shorts = new Int16Array(bytes(packet.p).buffer);
    decoded.set(packet, {
      position: Float32Array.from(shorts, (x) => x / 31000),
      index: new Uint16Array(bytes(packet.i).buffer),
      joints: packet.j ? Uint16Array.from(bytes(packet.j)) : null,
      weights: packet.w
        ? Float32Array.from(bytes(packet.w), (x) => x / 255)
        : null,
      parts: packet.b ? bytes(packet.b) : null,
      armBlend: packet.a ? bytes(packet.a) : null,
    });
  }
  return decoded.get(packet);
}
function dye(category, color, variant, design) {
  const base = new THREE.Color(color);
  const shades = [
    base,
    base.clone().lerp(new THREE.Color("#272329"), 0.27),
    base.clone().lerp(new THREE.Color("#e5ded5"), 0.17),
    new THREE.Color("#f3eee4"),
    new THREE.Color("#c7ad79"),
    new THREE.Color("#d3b185"),
    new THREE.Color("#8a674c"),
    new THREE.Color("#323036"),
  ];
  if (category === "top" && variant === 0) {
    shades[1] = base.clone().multiplyScalar(0.94); // matching jersey neck and turnbacks
    shades[2] = base.clone().multiplyScalar(0.98); // folded cotton collar
  }
  if (category === "shoes" && variant === 0) {
    shades[1] = base.clone().lerp(new THREE.Color("#33404b"), 0.75);
    shades[2] = base.clone().lerp(new THREE.Color("#71808b"), 0.48);
  }
  if (design?.palette) {
    const original = new THREE.Color(design.palette[0]);
    for (const [i, hex] of design.palette.entries()) {
      const shade = new THREE.Color(hex);
      // Re-dye the primary panels and matching binding. Contrasting layers,
      // hardware and soles retain their source material colors.
      if (
        i === 0 ||
        (i <= 2 &&
          Math.max(
            Math.abs(shade.r - original.r),
            Math.abs(shade.g - original.g),
            Math.abs(shade.b - original.b),
          ) < 0.16)
      ) {
        for (const channel of ["r", "g", "b"]) {
          shade[channel] = THREE.MathUtils.clamp(
            base[channel] *
              ((shade[channel] + 0.016) / (original[channel] + 0.016)),
            0,
            1,
          );
        }
      }
      shades[i] = shade;
    }
  }
  return shades.map((c, i) => {
    const m = new THREE.MeshStandardMaterial({
      color: c,
      roughness:
        i === 4
          ? 0.36
          : category === "shoes"
            ? variant === 1
              ? 0.53
              : 0.72
            : 0.9,
      metalness: i === 4 ? 0.58 : 0,
      side: THREE.DoubleSide,
    });
    m.name =
      category +
      " / " +
      [
        "main fabric",
        "binding",
        "panels",
        "trim",
        "hardware",
        "stitch",
        "welt",
        "outsole",
      ][i];
    return m;
  });
}
function makeGeometry(packet, gender, fitPart) {
  const src = unwrap(packet),
    g = new THREE.BufferGeometry();
  g.setAttribute(
    "position",
    new THREE.BufferAttribute(src.position.slice(), 3),
  );
  g.setIndex(new THREE.BufferAttribute(src.index, 1));
  if (src.joints) {
    g.setAttribute("skinIndex", new THREE.BufferAttribute(src.joints, 4));
    g.setAttribute("skinWeight", new THREE.BufferAttribute(src.weights, 4));
    const keys = [
      "leftLeg",
      "torso",
      gender === "male" ? "leftArm" : "rightArm",
      "head",
      "rightLeg",
      gender === "male" ? "rightArm" : "leftArm",
    ];
    g.userData.fitParts = Array.from(src.parts, (id) => fitPart ?? keys[id]);
    if (src.armBlend) g.userData.armBlend = src.armBlend;
    if (packet.armLining) g.userData.armLining = packet.armLining;
  }
  let start = 0;
  packet.g.forEach((count, mat) => {
    if (count) g.addGroup(start, count * 3, mat);
    start += count * 3;
  });
  return g;
}
export function buildWardrobe(body, selections = {}, colors = {}, originalHead = false) {
  const group = new THREE.Group(),
    gender = body.gender,
    garments = patterns[gender];
  const items = new Map();
  group.name = "Wardrobe";
  for (const category of ["top", "bottom", "shoes"]) {
    if (category === "bottom" && items.get("top")?.design?.dress) continue;
    const style = selections[category] ?? 0;
    if (
      !Number.isInteger(style) ||
      style < 0 ||
      style >= wardrobeOptions[gender][category].length
    )
      continue;
    const design = garmentDesign(gender, category, style);
    const profile =
      category === "shoes"
        ? (design?.materialProfile ?? shoeProfile(style))
        : style;
    let packet;
    if (design?.source) {
      if (!wearLoaded(category === "shoes" ? "shoes" : "clothes")) continue;
      const index = style - collectionStarts[category];
      packet =
        category === "shoes"
          ? packs.shoes[gender][index]
          : packs.clothes[gender][category][index];
    } else if (design) {
      if (!wearLoaded(expandedPack[category])) continue;
      packet =
        packs[expandedPack[category]][gender][
          style - (category === "shoes" ? 6 : 3)
        ];
    } else if (category === "shoes" && style < originalShoeCount) {
      packet = originalShoes[gender][style];
    } else {
      packet =
        (profile === 0 && sculptedClothes[gender][category]) ||
        garments[category][profile];
    }
    const trousers =
      category === "bottom" &&
      (design ? !design.skirt : gender === "male" || style !== 0);
    const lasted = category === "shoes" && style !== 0 && style !== 3;
    const geometry = makeGeometry(packet, gender, trousers ? "trouserLeg" : lasted ? "shoe" : null);
    if (lasted) bindShoe(geometry, packet, body, design?.heelRaise);
    items.set(category, {
      style,
      profile,
      design,
      g: geometry,
    });
  }
  fitGarments(body, items, originalHead);
  // Coverage is defined on the fitted bind mesh. skinGeometry below applies
  // the current body proportions to these positions in place.
  const restore = coverFoundation(body, items, originalHead);
  for (const [
    category,
    { style: variant, profile, design, g: geometry },
  ] of items) {
    const materials = dye(
      category,
      colors[category] || design?.palette?.[0] || "#88929b",
      profile,
      design,
    );
    if (design?.source && category !== "shoes")
      applyTripoTextile(geometry, materials, design);
    const mesh = body.skinGeometry(
      geometry,
      wardrobeOptions[gender][category][variant],
      materials,
    );
    delete geometry.userData.fitParts;
    delete geometry.userData.armBlend;
    delete geometry.userData.armLining;
    mesh.userData.slot = category;
    group.add(mesh);
  }
  const restoreFeet = fitTripoHeels(body, items.get("shoes")?.design);
  function releaseFit() {
    restore();
    restoreFeet();
  }
  group.addEventListener("removed", releaseFit);
  group.userData.dispose = () => {
    releaseFit();
    for (const mesh of [...group.children]) {
      body.releaseMesh(mesh);
      for (const material of mesh.material) material.dispose();
    }
    group.removeFromParent();
  };
  return group;
}

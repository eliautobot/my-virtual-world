// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Character builder (client/js/builder/): part of the character model library imported from the builder studio (2026-11-18).
import { Color } from "three";
import { jawStubble } from "./stubble.js";
import { defaultDetailColor } from "./face-catalog.js";

// Pigment is part of the shaded skin. Store the untinted vertex colors and
// both masks in bind space so blink, face edits and GLB export carry it along.
export function skinBlush(geometry, eyeY) {
  const p = geometry.attributes.position, source = geometry.attributes.color;
  const color = source.clone(), samples = [];
  for (let i = 0; i < p.count; i++) {
    const x = Math.abs(p.getX(i)), y = p.getY(i) - eyeY;
    if (p.getZ(i) < 0.025 || y < -0.046 || y > 0.003) continue;
    const cheek = ((x - 0.032) / 0.015) ** 2 + ((y + 0.020 - (x - 0.032) * 0.19) / 0.0085) ** 2;
    const nose = (x / 0.0093) ** 2 + ((y + 0.020) / 0.006) ** 2;
    if (Math.min(cheek, nose) < 7) samples.push([i, Math.exp(-cheek), Math.exp(-nose)]);
  }
  geometry.setAttribute("color", color);
  return (name, dye) => {
    const rosy = name === "Rosy nose", warm = name === "Warm flush";
    const ink = new Color(dye || defaultDetailColor(name));
    for (const [i, cheek, tip] of samples) {
      const w = rosy ? tip * 0.46 : warm ? cheek * 0.43 : 0;
      color.setXYZ(i, source.getX(i) * (1 - w) + ink.r * w,
        source.getY(i) * (1 - w) + ink.g * w, source.getZ(i) * (1 - w) + ink.b * w);
    }
    color.needsUpdate = true;
  };
}

// Paths and marks live in the same neutral head coordinates as the mouth.
// Sample the finished surface at every vertex so tiny marks remain seated
// even across the nose bridge or the curved outer cheek.
export function addComplexion({
  name,
  eyeY,
  mouthY,
  depth,
  skin,
  tint,
  meshGrid,
  stroke,
  add,
  mat,
  join,
  head,
}) {
  const marks = [];
  let seed = 85319;
  const random = () =>
    (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
  const shade = (amount) => skin.clone().lerp(tint, amount);
  function spot(
    x,
    y,
    rx,
    ry,
    amount,
    { feather = false, star = false, angle = 0 } = {},
  ) {
    if (depth(x, y) < 0.018) return;
    const ink = shade(amount),
      cos = Math.cos(angle),
      sin = Math.sin(angle);
    const geom = meshGrid(
      star ? 40 : 24,
      feather ? 10 : 4,
      (t, r) => {
        const a = t * Math.PI * 2,
          petal = star ? 0.47 + 0.53 * Math.abs(Math.cos(2 * a)) ** 4 : 1;
        const u = rx * r * petal * Math.cos(a),
          v = ry * r * petal * Math.sin(a);
        const xx = x + cos * u - sin * v,
          yy = y + sin * u + cos * v;
        const z =
          depth(xx, yy) + (feather ? 0.0001 : 0.00016) + 0.00012 * (1 - r * r);
        const color = feather
          ? ink.clone().lerp(skin, r * r * (3 - 2 * r))
          : ink;
        return [xx, yy, z, color];
      },
      true,
    );
    marks.push(geom);
  }
  function freckles(n, x, y, rx, ry, scale = 1) {
    for (let i = 0; i < n; i++) {
      const r = Math.sqrt(random()),
        a = 2 * Math.PI * random(),
        size = (0.00034 + 0.00058 * random()) * scale;
      spot(
        x + r * rx * Math.cos(a),
        y + r * ry * Math.sin(a),
        size,
        size * (0.7 + 0.27 * random()),
        0.32 + 0.41 * random(),
      );
    }
  }
  const inkMat = () => mat(tint, false, { roughness: 0.84 });
  if (name.includes("moustache")) {
    const curl = name.startsWith("Curled"),
      shoe = name.startsWith("Horseshoe");
    for (const side of [-1, 1]) {
      const centerline = (t) => {
        const xx = 0.0002 + (0.0158 + (curl || shoe ? 0.005 : 0)) * t;
        const drop = shoe
          ? 0.0098 * t ** 3
          : curl
            ? -0.0046 * t ** 3
            : 0.0028 * t * t;
        return [
          side * xx,
          mouthY + 0.0051 + 0.0017 * Math.sin(Math.PI * t) - drop,
          0.00072,
        ];
      };
      add(
        name,
        stroke(
          centerline,
          (t) =>
            (shoe ? 0.002 : curl ? 0.0018 : 0.0027) *
            (0.18 + 0.82 * Math.sin(Math.PI * t) ** 0.56),
          0.0011,
          48,
        ),
        inkMat(),
      );
    }
  } else if (
    ["Chin patch", "Boxed beard", "Chin strap", "Sideburns"].includes(name)
  ) {
    add(
      name,
      jawStubble(head, mouthY, tint, name, skin),
      mat("white", true, { roughness: 0.88 }),
    );
  } else if (name === "Nose freckles") {
    freckles(53, 0, eyeY - 0.014, 0.02, 0.0045, 0.94);
  } else if (name === "Cheek constellation" || name === "Temple stars") {
    const temple = name === "Temple stars";
    for (const [i, [x, y, r]] of [
      [0.023, -0.014, 0.0011],
      [0.028, -0.016, 0.00067],
      [0.034, -0.013, 0.0014],
      [0.039, -0.01, 0.00067],
      [0.032, -0.019, 0.00048],
    ].entries())
      spot(
        (temple ? 1 : -1) * (x + (temple ? 0.002 : 0)),
        eyeY + y + (temple ? 0.005 : 0),
        r * (temple ? 1.7 : 1),
        r * (temple ? 2 : 1),
        0.76,
        { star: temple || i === 2, angle: 0.19 * i },
      );
  } else if (
    name === "High cheek mole" ||
    name === "Lip-side mole" ||
    name === "Cheek moles"
  ) {
    if (name === "Lip-side mole")
      spot(0.0208, mouthY + 0.0023, 0.00125, 0.0011, 0.92);
    else {
      spot(-0.031, eyeY - 0.0134, 0.00124, 0.00105, 0.9);
      if (name === "Cheek moles") {
        spot(-0.026, eyeY - 0.017, 0.00073, 0.00071, 0.85);
        spot(0.032, eyeY - 0.021, 0.00111, 0.00097, 0.79);
      }
    }
  } else if (name === "Dimple pair" || name === "Cheek stripe") {
    for (const side of [-1, 1]) {
      if (name === "Dimple pair") {
        for (let i = 0; i < 2; i++)
          spot(
            side * (0.0219 + i * 0.00045),
            mouthY + 0.0018 + i * 0.00055,
            0.00095,
            0.0022,
            0.28,
            { feather: true, angle: -side * 0.39 },
          );
      } else
        for (let i = 0; i < 2; i++) {
          const g = stroke(
            (t) => [
              side * (0.02 + 0.019 * t),
              eyeY - 0.015 + 0.004 * t - i * 0.0032,
              0.00023,
            ],
            (t) => 0.00115 * Math.sin(Math.PI * t) ** 0.37,
            0.00012,
            32,
          );
          add(name, g, mat(shade(0.6 - i * 0.14)));
        }
    }
  } else if (name === "Under-eye freckles") {
    for (const side of [-1, 1])
      freckles(23, side * 0.028, eyeY - 0.0205, 0.010, 0.0031, 0.96);
  }
  if (marks.length) {
    const g = join(marks);
    // Orient the shaded marks with the face, including at their feathered edge.
    const p = g.attributes.position,
      n = g.attributes.normal;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i),
        y = p.getY(i),
        e = 0.00018;
      const dx = (depth(x + e, y) - depth(x - e, y)) / (2 * e),
        dy = (depth(x, y + e) - depth(x, y - e)) / (2 * e);
      const len = Math.hypot(dx, dy, 1);
      n.setXYZ(i, -dx / len, -dy / len, 1 / len);
    }
    add(name, g, mat(new Color("white"), true, { roughness: 0.78 }));
  }
}

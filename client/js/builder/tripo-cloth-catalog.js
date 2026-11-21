// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Character builder (client/js/builder/): part of the character model library imported from the builder studio (2026-11-18).
// Source codes follow the 22 numbered Tripo originals for each foundation.
// Measurements are in normalized foundation space and describe finished edges.
const outer = new Set([
  "blazer",
  "hoodie",
  "track",
  "field",
  "denim",
  "cardigan",
  "compactCardigan",
  "overshirt",
  "bomber",
  "layerDenim",
  "vest",
  "trench",
  "overcoat",
]);
const shade = (hex, scale) =>
  "#" +
  [1, 3, 5]
    .map((i) =>
      Math.max(
        0,
        Math.min(255, Math.round(parseInt(hex.slice(i, i + 2), 16) * scale)),
      )
        .toString(16)
        .padStart(2, "0"),
    )
    .join("");
function palette(main, liner, metal, stitch) {
  return [
    main,
    shade(main, 0.89),
    shade(main, 1.055),
    liner || shade(main, 0.97),
    metal || "#a7a095",
    stitch || shade(main, 1.1),
    "#59422e",
    "#30323a",
  ];
}
const armorPalette = [
  "#d9d8e2",
  "#555660",
  "#a5a6b1",
  "#29292f",
  "#858892",
  "#5fd9f2",
  "#747783",
  "#16171c",
];
const womenTops = [
  ["Everyday tucked tee", "tee", 606, 684, "#f5f4f0"],
  ["City single-button blazer", "blazer", 539, 501, "#36363d", "#efe1c6"],
  ["Sage weekend zip hoodie", "hoodie", 554, 580, "#788370", "#edece9"],
  ["Rose-sprig wrap dress", "dress", 322, 680, "#fff5e8"],
  ["Lilac rib-trim cardigan", "cardigan", 554, 500, "#9c7cb8", "#f3f2eb"],
  ["Silver track jacket", "track", 550, 578, "#a2a3ae", "#37363c"],
  ["Marigold notch tunic", "tunic", 478, 595, "#dfa523"],
  ["Stripe-layer utility jacket", "field", 544, 585, "#575e47", "#f1f0e6"],
  ["Belted gabardine trench", "trench", 320, 502, "#b18b69", "#252122"],
  ["Cropped denim and camisole", "denim", 633, 587, "#5f7da4", "#f2f1e9"],
  ["Sky balloon-sleeve knit", "balloon", 602, 515, "#9ed4f2"],
  ["Orbital articulated cuirass", "armor", 568, 491, "#d9d8e2"],
  ["Coral split-neck blouse", "puff", 601, 675, "#e65454"],
  ["Ink cropped cardigan", "compactCardigan", 589, 510, "#242c4a", "#fce8a5"],
  ["Teal rolled-sleeve shirt", "shirt", 539, 580, "#318388"],
  ["Rose open overshirt", "overshirt", 540, 580, "#b66573", "#f7f4ee"],
  ["Mint ribbed pullover", "sweater", 556, 507, "#a6caba"],
  ["Ochre pocket jacket", "field", 554, 581, "#ba8a34", "#eee9db"],
  ["Cornflower fitted tee", "tee", 600, 681, "#66799f"],
  ["Violet button cardigan", "cardigan", 552, 507, "#a387bb", "#a4a4aa"],
  ["Cinnamon crew sweatshirt", "sweat", 573, 504, "#96472d"],
  ["Plum tailored jacket", "blazer", 542, 504, "#56304b", "#efe1cd"],
];
const menTops = [
  ["Classic white jersey tee", "tee", 551, 685, "#f4f4f1"],
  ["Navy two-button suit jacket", "blazer", 528, 502, "#253047", "#91add4"],
  ["Heather hooded zip jacket", "hoodie", 550, 505, "#74737c", "#262527"],
  ["Brushed tartan flannel", "flannel", 540, 620, "#982d3d", "#ece6d7"],
  ["Oat shawl cardigan", "shawl", 550, 504, "#ac9682", "#ece5da"],
  ["Crimson training tee", "tee", 550, 683, "#c72338"],
  ["Olive flight jacket", "bomber", 542, 504, "#51543a", "#f5f0e7"],
  ["Forest pique polo", "polo", 550, 685, "#344c3d"],
  ["Charcoal notched overcoat", "overcoat", 310, 498, "#49474e", "#29282a"],
  [
    "Denim jacket and ochre hoodie",
    "layerDenim",
    542,
    500,
    "#526f95",
    "#dcab47",
  ],
  ["Cobalt rolled-sleeve shirt", "shirt", 587, 614, "#3476ca"],
  ["Orbital articulated cuirass", "armor", 552, 491, "#d9d8e2"],
  ["Blue camp shirt", "camp", 543, 680, "#89b8ef"],
  ["Olive open overshirt", "overshirt", 536, 601, "#5e6350", "#eae3d6"],
  ["Petrol three-button henley", "henley", 541, 616, "#27505e"],
  ["Quilted gilet and jersey", "vest", 545, 609, "#303036", "#702c40"],
  ["Ecru pushed-sleeve sweater", "sweater", 554, 585, "#e8d7c2"],
  ["Cobalt pocket jacket", "field", 554, 517, "#344c87", "#b5b7c3"],
  ["Terracotta pique polo", "polo", 550, 676, "#a45e43"],
  ["Golden track jacket", "track", 554, 508, "#e1ab38", "#293755"],
  ["Mulberry crew sweatshirt", "sweat", 557, 501, "#4c3445"],
  ["Sage patch-pocket shirt", "camp", 538, 677, "#a5ad98"],
];
const womenBottoms = [
  ["Classic high-rise jeans", "denim", 62, 611, "#51759e"],
  ["Charcoal pencil skirt", "pencil", 323, 613, "#38383e"],
  ["Washed straight jeans", "denim", 58, 609, "#718aa3"],
  null,
  ["Ink tapered trousers", "suit", 74, 614, "#2c3149"],
  ["Graphite cinch joggers", "jog", 67, 611, "#48464d"],
  ["Indigo ankle jeans", "denim", 71, 611, "#344e75"],
  ["Coal utility trousers", "utility", 69, 609, "#343336"],
  ["Black cropped suit trousers", "suit", 89, 610, "#353137"],
  ["Pleat miniskirt and tights", "tights", 449, 613, "#303036", "#342a29"],
  ["Olive utility mini", "mini", 407, 612, "#616b47"],
  ["Orbital articulated greaves", "armor", 54, 605, "#d9d8e2"],
  ["Ecru rolled jeans", "denim", 76, 614, "#e5d6c0"],
  ["Olive cropped chinos", "chino", 91, 614, "#62634a"],
  ["Stone tapered chinos", "chino", 67, 610, "#b6afa6"],
  ["Indigo slouch jeans", "denim", 70, 611, "#435477"],
  ["Blue straight trousers", "suit", 59, 611, "#405276"],
  ["Black ankle denim", "denim", 84, 610, "#302e32"],
  ["Sand cuffed shorts", "short", 377, 609, "#c1ad96"],
  ["Deep teal ankle trousers", "chino", 72, 613, "#385663"],
  ["Slate cuffed joggers", "jog", 82, 608, "#576078"],
  ["Plum tailored trousers", "suit", 60, 609, "#56324c"],
];
const menBottoms = [
  ["Everyday blue jeans", "denim", 61, 591, "#52759e"],
  ["Navy pressed trousers", "suit", 55, 593, "#27334d"],
  ["Black tapered joggers", "jog", 70, 591, "#333236"],
  ["Wheat work chinos", "chino", 56, 589, "#b39b70"],
  ["Graphite wool trousers", "suit", 55, 593, "#646064"],
  ["Black running shorts", "sportShort", 360, 590, "#302d30"],
  ["Washed charcoal jeans", "denim", 59, 591, "#454446"],
  ["Khaki cargo shorts", "cargoShort", 359, 589, "#b19f82"],
  ["Black city trousers", "suit", 55, 593, "#2c2b2e"],
  ["Distressed black jeans", "ripped", 58, 592, "#333236"],
  ["Belted sand chinos", "belt", 79, 593, "#b99a72"],
  ["Orbital articulated greaves", "armor", 51, 590, "#d9d8e2"],
  ["Midnight walking shorts", "short", 354, 591, "#2e3b58"],
  ["Warm grey chinos", "chino", 61, 590, "#9b9085"],
  ["Oyster chino trousers", "chino", 63, 591, "#cfbfaa"],
  ["Sand tapered trousers", "chino", 65, 590, "#c6ae95"],
  ["Forest twill trousers", "chino", 68, 591, "#435448"],
  ["Slate cargo trousers", "utility", 65, 589, "#494f60"],
  ["Ivory straight jeans", "denim", 60, 590, "#e6dfd4"],
  ["Indigo regular jeans", "denim", 60, 592, "#374c72"],
  ["Moss cuffed joggers", "jog", 77, 590, "#718273"],
  ["Charcoal dress trousers", "suit", 56, 591, "#47474a"],
];
function collection(gender, tops, bottoms) {
  const female = gender === "female";
  const code = (i) => (female ? "f" : "m") + String(i + 1).padStart(2, "0");
  return {
    top: tops.map(([name, cut, hem, sleeve, main, liner], i) => ({
      source: code(i),
      name,
      cut,
      hem: hem / 1000,
      sleeve: sleeve / 1000,
      coveredTop: female ? (cut === "dress" ? 0.709 : 0.742) : 0.76,
      outer: outer.has(cut),
      dress: cut === "dress",
      coat: ["trench", "overcoat"].includes(cut),
      textile:
        cut === "dress"
          ? "sprigs"
          : cut === "flannel"
            ? "tartan"
            : [
                  "shawl",
                  "cardigan",
                  "compactCardigan",
                  "sweater",
                  "polo",
                ].includes(cut)
              ? "knit"
              : undefined,
      palette: cut === "armor" ? armorPalette : palette(main, liner),
    })),
    bottom: bottoms.flatMap((row, i) => {
      if (!row) return [];
      const [name, cut, hem, waist, main, liner] = row;
      const skirt = ["pencil", "tights", "mini"].includes(cut);
      return [
        {
          source: code(i),
          name,
          cut,
          hem: hem / 1000,
          waist: waist / 1000,
          skirt,
          tights: cut === "tights",
          kneeWindows: cut === "ripped",
          tuckShoe: !skirt && hem < 100,
          palette:
            cut === "armor"
              ? armorPalette
              : palette(
                  main,
                  liner,
                  ["denim", "belt", "ripped"].includes(cut)
                    ? "#bcab88"
                    : undefined,
                ),
        },
      ];
    }),
  };
}
export const tripoClothes = {
  female: collection("female", womenTops, womenBottoms),
  male: collection("male", menTops, menBottoms),
};

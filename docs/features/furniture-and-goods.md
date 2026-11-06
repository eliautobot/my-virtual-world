# Furniture library, goods and dressing

The Furnish panel holds two kinds of furniture side by side: My Virtual World's own pieces, and a library of 7,580
pieces from the **Amazon Berkeley Objects** (lounge, decor, home, kitchen, office, outdoor and gym). Small things
(mugs, books, shoes, toys, plants, pens, groceries ...) go on tables, counters and shelves, either put there by hand
or laid out by the floor's own rules. The 3D models and pictures ship in the repository, ready to use; rebuilding them
is only needed to change them: see [Rebuilding the models](#rebuilding-the-models-optional) below.

## The furniture library

- **In the Furnish panel**: each category lists the library's pieces after My Virtual World's own, with their
  pictures, sub-groups, a search and 60 a page. They are placed, turned, dragged, removed and undone like any piece;
  people sit on the seats, sleep in the beds and walk over the rugs.
- **In the world**: 45 of My Virtual World's own pieces (sofas, armchairs, desks, dining sets, beds, cabinets ...) are
  drawn with an Amazon counterpart fitted to the same size and seats. This is done once, when the server first starts
  on this version; the log says `[boot] Amazon furniture: N placed pieces drawn with their Amazon counterparts`. A
  selected piece's look can be switched back to My Virtual World's own (and again) from its bar.
- Bookshelves, kitchens, the arcade, the radio studio, the club's rigs, counters, signs and plants keep their own look.
- The models load in the background once the world is ready, the most used first, and a floor's pieces are drawn as
  soon as their models are in.

## Goods: things on furniture

- **Goods** in the Furnish panel: 1,124 small things in 12 sub-groups (Shoes, Toys, Home, Desk & office, Health &
  beauty, Kitchen & tableware, Electronics, Games & media, Food & drink, Bags & clothing, Pets & baby, Sport), with a
  search over names, sub-groups and tags. 1,033 are **Google Scanned Objects**, 91 are small things of the Amazon
  library; the library's small decor may stand on furniture too.
- **Putting a thing on a piece**: pick it and point at a desk's, table's or counter's top, any shelf of a bookshelf, a
  shop shelf or a cabinet. Its ghost stands there in green, or in red with the reason (in the way of the monitor, too
  tall for that shelf, overlaps, does not fit). It snaps to 2 cm (hold Alt for free placing); **R** turns it 45°
  (Shift+R: 15°); **[** and **]** (or Shelf ▼ ▲ on screen) step to the shelf below or above. A thing that does not fit
  as it is turned but would side-on says "R twice turns it to fit".
- A thing on a piece is selected before its piece, dragged to another spot, shelf or piece, turned with R, removed
  with Delete; undo and redo work as for any edit. Moving or turning a piece carries its things. Bags, plant pots and
  pet bowls may also stand on the floor.
- **On a phone** a thing being placed gets its own bar over the world (its name, Turn, Shelf ▼, Shelf ▲ or Remove,
  Done) and the Furnish drawer closes so the pieces can be seen.
- The server checks every thing (on a surface the piece has, inside it, under the room above, clear of the piece's
  own monitor, lamp or sink and of each other): at most 96 things a piece and 3,000 put by hand on one floor.

## Dressing: furniture furnished by rules

- A piece with no things of its own is **dressed by its floor's rules**: an office's desks get pen holders, notebooks
  and a mug; a home's kitchen counters, nightstands, TV stands and bookshelves their own things; a café counter its
  cups; a shop's shelves the goods it sells, in rows facing the aisle. 47 rules cover offices, homes, cafés,
  restaurants, bars, gyms, parks, terminals and 17 kinds of shop. The same piece looks the same for everyone.
- The rules keep it plausible: one drink and one pack on a scattered top (more on a meeting table or a café counter),
  never the same model twice on one top, nothing too big for the piece, no second monitor on a desk.
- **Fill**, **Empty** and **Reroll** in a selected piece's bar: back to the rules, take everything off, or other things
  by the same rules. Editing one dressed thing makes the piece's dressing its own list first, so nothing seen moves.
- A shop floor's bar has **Sells:** (its name's default, or any of 17 kinds); its shelves are stocked again with
  those goods.
- Dressing is drawn, not stored, within a budget per floor that depends on the graphics quality (things, triangles
  and distinct models; a big store dresses its shelves nearest the camera). The performance overlay (Settings,
  General) shows a line `goods N things · M models · T k tris · near band on/off` on a floor looked into.

## Rebuilding the models (optional)

The models and pictures (about 19,100 files, 570 MB, the largest 1.2 MB) are generated from two public packs and **ship in
the repository**: `client/assets/abo/{m,t,d}/` and `client/assets/gso/{m,d,t}/`, served from `/assets/abo/` and
`/assets/gso/`. A clone, a Docker build or an update has them; there is nothing to download or build to play. The lists
that describe them (`shared/abo-catalog.js`, `shared/goods-catalog.js`, `shared/abo-surfaces.js` ...) are in the
repository too. If the model folders are missing (a trimmed copy), the game still works: the world then draws My
Virtual World's own furniture, a library piece placed from the panel is a plain box, and goods and dressing are not
drawn.

Rebuilding is only for changing them (another revision of a pack, other sizes, other choices in the override files).
To rebuild (the same Node.js as the game, Python 3 for the download tool, about 6 GB of free disk for the packs):

1. **Download the two packs** at the pinned revisions (CodePawl's web copies, CC BY 4.0), only the parts the build
   reads, into a folder beside the repository's folder, here `../hf-packs`:

   ```bash
   python3 -m pip install -U huggingface_hub        # gives the `hf` command
   cd ..                                            # the folder that holds the repository's folder
   hf download codepawl/abo-glb --repo-type dataset \
     --revision c6ac66142ecec2a2973b6e00072ec74940e1bec4 --local-dir hf-packs/abo-glb \
     --include metadata.jsonl --include 'thumbs/*' --include 'lods/*/*_lod2.glb' --include 'lods/*/*_lod3.glb' \
     --include 'LICENSE*'
   hf download codepawl/scanned-objects-glb --repo-type dataset \
     --revision fdb214f6ea18996f2d45e05df74c5d9696c3f7a2 --local-dir hf-packs/scanned-objects-glb \
     --include metadata.jsonl --include 'thumbs/*' --include 'lods/*/*_lod2.glb' --include 'lods/*/*_lod3.glb' \
     --include 'LICENSE*'
   ```

   The Hub limits anonymous downloads; with a free Hugging Face account, set `HF_TOKEN` first. Downloading the whole
   packs (no `--include`) works too but takes about 26 GB.

2. **Install the conversion tools** in a folder of their own (these versions give files identical to the release):

   ```bash
   mkdir -p hf-packs/tools && cd hf-packs/tools && npm init -y >/dev/null
   npm install @gltf-transform/core@4.5.1 @gltf-transform/extensions@4.5.1 @gltf-transform/functions@4.5.1 \
     meshoptimizer@1.2.0 sharp@0.35.5
   cd ../..
   ```

3. **Build**, from the repository's folder, in this order (each step is resumable: run it again after a stop):

   ```bash
   export ABO_TOOLS="$PWD/../hf-packs/tools"
   node tools/abo-build.mjs --pack ../hf-packs/abo-glb --jobs 8
   node tools/goods-build.mjs --gpack ../hf-packs/scanned-objects-glb --apack ../hf-packs/abo-glb --jobs 8
   node tools/surf-build.mjs --jobs 8
   git status --short shared/ tools/                 # nothing: the lists come out as committed
   ```

   `abo-build.mjs` makes the furniture library (`client/assets/abo/m/`, `t/`), `goods-build.mjs` the goods
   (`client/assets/gso/`) and the light copies of small things (`client/assets/abo/d/`), `surf-build.mjs` finds the
   surfaces of the library's pieces from the models (`shared/abo-surfaces.js`, the same as committed). Set `--jobs` to your number of cores.

4. **Restart the server** (or rebuild the Docker image). The models are served from `/assets/abo/` and `/assets/gso/`.

To change how a thing is sorted, named, turned or sized, edit `tools/goods-overrides.json` (the goods) or
`tools/surf-overrides.json` (a library piece's surfaces, in millimetres) and run the matching tool again; never edit
the generated lists by hand. `tools/goods-ids.json` pins every thing's short id: append only.

## Credits and licences

The Amazon Berkeley Objects (by Amazon.com) and Google Scanned Objects (by Google LLC) are licensed
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), not under the game's licences. Their attribution and a copy
of the licence are kept in the repository: `client/assets/abo/ATTRIBUTION.md`, `client/assets/gso/ATTRIBUTION.md`,
the `LICENSE-CC-BY-4.0.txt` beside each, [THIRD-PARTY-NOTICES.md](../../THIRD-PARTY-NOTICES.md) and
[ASSETS-LICENSE.md](../../ASSETS-LICENSE.md). The Furnish panel credits both under their lists. Neither Amazon nor Google
endorses My Virtual World; brands printed on scanned packaging belong to their owners.

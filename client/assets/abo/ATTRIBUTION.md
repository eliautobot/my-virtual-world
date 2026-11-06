# Amazon furniture library: credits and licence

The 3D models in `m/` and the pictures in `t/` are from the **Amazon Berkeley Objects** (ABO) dataset by
**Amazon.com**, <https://amazon-berkeley-objects.s3.amazonaws.com/index.html>, licensed under the Creative Commons
Attribution 4.0 International License (CC BY 4.0), <https://creativecommons.org/licenses/by/4.0/>. A copy of the licence
is in `LICENSE-CC-BY-4.0.txt`.

The ABO dataset was built by Matthieu Guillaumin, Thomas Dideriksen, Kenan Deng, Himanshu Arora, Arnab Dhua, Xi (Brian)
Zhang, Tomas Yago-Vicente (Amazon.com), Jasmine Collins, Shubham Goel and Jitendra Malik (UC Berkeley).
Paper: Collins et al., "ABO: Dataset and Benchmarks for Real-World 3D Object Understanding", CVPR 2022.

## Changes

- CodePawl's web copy of the dataset (<https://huggingface.co/datasets/codepawl/abo-glb>, revision c6ac661) re-encodes
  the textures, resizes them, compresses the geometry and makes simpler copies (levels of detail).
- My Virtual World changed them further (`tools/abo-build.mjs`): the simpler copy (level 2, or level 3 when level 2 is
  heavy) with 256 px textures, normal maps removed, positions and normals quantized, geometry compressed (meshopt);
  the pictures resized to 160 px. Only furniture and home decor is used.
- Each piece is named by its colour, material and kind (for example "Grey Fabric Sofa"), not by its product name.
- Small things the furniture library leaves out (cables, hubs, laptop and monitor stands, notebooks, pans, bowls,
  canisters, photo frames ...) are used as goods for tables and shelves (`tools/goods-build.mjs`, listed in
  `shared/goods-catalog.js`): turned to face +z and stood on the ground, otherwise converted the same way.
- `d/` holds lighter copies of the goods and of the library's small decor (level 3's shape simplified to at most 400
  triangles, the same 256 px textures), made by `tools/goods-build.mjs`.
- Some misfiled pieces are corrected when the list is read (another kind, a scale or a raise: `tools/goods-overrides.json`).

Amazon does not endorse My Virtual World or this use of the models. Brand and product names belong to their owners.
These files are NOT covered by My Virtual World's own asset licence (ASSETS-LICENSE.md); they stay under CC BY 4.0.

## Rebuilding

The model and picture files are not stored in the repository. Download the pack (`hf download codepawl/abo-glb
--repo-type dataset --revision c6ac66142ecec2a2973b6e00072ec74940e1bec4 --include "lods/*" "thumbs/*" "metadata.jsonl"
"LICENSE-CC-BY-4.0.txt" --local-dir <dir>`), install the converter's tools (`npm i --no-save @gltf-transform/core
@gltf-transform/extensions @gltf-transform/functions meshoptimizer sharp`) and run
`node tools/abo-build.mjs --pack <dir>` (resumable; about a minute on 16 cores).

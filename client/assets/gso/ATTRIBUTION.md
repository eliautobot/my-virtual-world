# Goods (Google Scanned Objects): credits and licence

The 3D models in `m/` and `d/` and the pictures in `t/` are from **Google Scanned Objects** by **Google Research**
(Copyright 2020 Google LLC), <https://research.google/blog/scanned-objects-by-google-research-a-dataset-of-3d-scanned-common-household-items/>,
as published on Gazebo Fuel, <https://app.gazebosim.org/GoogleResearch/fuel/models>, licensed under the Creative Commons
Attribution 4.0 International License (CC BY 4.0), <https://creativecommons.org/licenses/by/4.0/>. A copy of the licence
is in `LICENSE-CC-BY-4.0.txt`.

Paper: Laura Downs, Anthony Francis, Nate Koenig, Brandon Kinman, Ryan Hickman, Krista Reymann, Thomas B. McHugh and
Vincent Vanhoucke, "Google Scanned Objects: A High-Quality Dataset of 3D Scanned Household Items", ICRA 2022.

## Changes

- CodePawl's web copy of the scans (<https://huggingface.co/datasets/codepawl/scanned-objects-glb>, revision fdb214f)
  converts them to glTF, re-encodes the textures, compresses the geometry and makes simpler copies (levels of detail).
- My Virtual World changed them further (`tools/goods-build.mjs`):
  - `m/<id>.glb`: the simpler copy (level 2, or level 3 when level 2 is over 6,000 triangles) with level 3's 256 px
    textures, normal maps removed, turned so its front faces +z, stood on the ground and centred, positions and normals
    quantized, geometry compressed (meshopt);
  - `d/<id>.glb`: a lighter copy for rooms dressed by the game, level 3's shape simplified to at most 400 triangles;
  - `t/<id>.webp`: the picture resized to 160 px.
- Files are named by short neutral ids (`tools/goods-ids.json`), and each thing by its colour and what it is (for
  example "Red Running Shoe 4"), never by its product name or brand.

Google does not endorse My Virtual World or this use of the scans. The scans are of real retail products: brands, logos
and product names printed on them belong to their owners, and no rights in them are claimed. These files are NOT covered
by My Virtual World's own asset licence (ASSETS-LICENSE.md); they stay under CC BY 4.0.

## Rebuilding

The model and picture files are not stored in the repository. Download the pack (`hf download codepawl/scanned-objects-glb
--repo-type dataset --revision fdb214f6ea18996f2d45e05df74c5d9696c3f7a2 --local-dir <dir>`) and the Amazon pack
(client/assets/abo/ATTRIBUTION.md), install the converter's tools (`npm i --no-save @gltf-transform/core
@gltf-transform/extensions @gltf-transform/functions meshoptimizer sharp`) and run
`node tools/goods-build.mjs --gpack <dir> --apack <abo dir>` (resumable; under a minute on 16 cores).

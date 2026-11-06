# Third-party notices

My Virtual World is source-available under the PolyForm Noncommercial License 1.0.0 (see [LICENSE](LICENSE) and
[NOTICE.md](NOTICE.md)). It uses the following components made by others, which remain under their own licenses.
Nothing in this repository's licenses limits the rights those licenses grant.

## Runtime dependencies (installed from npm, not stored in this repository)

| Component | License | Use |
|---|---|---|
| [three](https://github.com/mrdoob/three.js) | MIT | 3D rendering in the browser |
| [@dimforge/rapier3d-compat](https://github.com/dimforge/rapier.js) | Apache-2.0 | vehicle and character physics |
| [ws](https://github.com/websockets/ws) | MIT | WebSocket server |
| [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) | MIT | QR codes for two-factor sign-in setup |
| [@openclaw/gateway-client](https://github.com/openclaw/openclaw) (Copyright (c) 2026 OpenClaw Foundation) | MIT | connecting to an OpenClaw gateway (Agent Providers) |
| [@openclaw/gateway-protocol](https://github.com/openclaw/openclaw) (Copyright (c) 2026 OpenClaw Foundation) | MIT | the OpenClaw gateway protocol, used by its client |
| [typebox](https://github.com/sinclairzx81/typebox) | MIT | schemas, used by the OpenClaw gateway protocol |
| [ipaddr.js](https://github.com/whitequark/ipaddr.js) | MIT | address checks, used by the OpenClaw gateway client |
| [@novnc/novnc](https://github.com/novnc/noVNC) (its core, and the pako it vendors) | MPL-2.0 (core), MIT (pako) | showing an agent's own screen live (Hermes' Bot Desktop), served unmodified |

## Development dependency

| Component | License | Use |
|---|---|---|
| [playwright-core](https://github.com/microsoft/playwright) | Apache-2.0 | browser checks |

## Data

- `server/auth/common-passwords.txt.gz` is derived from **SecLists**
  (Passwords/Common-Credentials/xato-net-10-million-passwords-1000000.txt,
  <https://github.com/danielmiessler/SecLists>), MIT License; its notice is in
  [server/auth/common-passwords.README.md](server/auth/common-passwords.README.md).

## Adapted rules

- `client/js/ui/providers/hermes-chat.js` follows **Hermes Agent**'s Desktop app
  (<https://github.com/NousResearch/hermes-agent>, `apps/desktop`) in how a Hermes turn is laid out: its tool titles,
  how a run of tool calls is summarised and grouped, which calls are cards or silent, how its slash commands are routed
  and suggested and the words it gives them, its status row, its changed-files card and its Markdown look; `server/providers/hermes/translate.js` follows its shared client (`apps/shared`, skill-scaffold) in
  showing a skill command's stored words as the command. MIT License, Copyright (c) 2025 Nous Research.
- `server/providers/hermes/screen.js` and `client/js/ui/provider-screen.js` follow the same app's Screen pane
  (`apps/desktop/src/plugins/hermes-bots/screen-*`) in how a bot's screen is watched and taken over: the calls in that
  order, one viewer per window kept across reconnects, watch-only until the person takes control, and what its close
  codes mean. MIT License, Copyright (c) 2025 Nous Research.

The license texts of the npm packages are installed with them under `node_modules/<package>/`.

## Creative assets

The characters in `client/assets/chars/` (their meshes, skeletons, textures and animation) were made for My Virtual
World with Tripo (<https://www.tripo3d.ai>) and are project-owned creative assets under [ASSETS-LICENSE.md](ASSETS-LICENSE.md).

The Amazon furniture library (`client/assets/abo/m/`, `client/assets/abo/t/`, listed in `shared/abo-catalog.js`) is
from the **Amazon Berkeley Objects** (ABO) dataset by Amazon.com
(<https://amazon-berkeley-objects.s3.amazonaws.com/index.html>), licensed
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) (copy: `client/assets/abo/LICENSE-CC-BY-4.0.txt`). The dataset
was built by Matthieu Guillaumin, Thomas Dideriksen, Kenan Deng, Himanshu Arora, Arnab Dhua, Xi (Brian) Zhang, Tomas
Yago-Vicente (Amazon.com), Jasmine Collins, Shubham Goel and Jitendra Malik (UC Berkeley). We use CodePawl's web copy
(<https://huggingface.co/datasets/codepawl/abo-glb>, revision c6ac661), which re-encodes the textures, compresses the
geometry and simplifies it. We changed the models further (`tools/abo-build.mjs`): the textures resized to 256 px,
normal maps removed, geometry simplified (that copy's level 2 or 3), quantized and compressed; the pictures resized.
The models are named by colour, material and kind, not by product. Amazon does not endorse My Virtual World, and
product and brand names belong to their owners. Details: `client/assets/abo/ATTRIBUTION.md`. The same dataset's small
things (cables, hubs, stands, notebooks, pans, bowls, canisters, frames ...) are among the goods below, in the same
folder, and lighter copies of its small decor (`client/assets/abo/d/`) are made by `tools/goods-build.mjs`.

The goods (`client/assets/gso/m/`, `client/assets/gso/d/`, `client/assets/gso/t/`, listed in `shared/goods-catalog.js`)
are from **Google Scanned Objects** by Google Research (Copyright 2020 Google LLC,
<https://research.google/blog/scanned-objects-by-google-research-a-dataset-of-3d-scanned-common-household-items/>,
<https://app.gazebosim.org/GoogleResearch/fuel/models>), licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
(copy: `client/assets/gso/LICENSE-CC-BY-4.0.txt`). Paper: Downs et al., "Google Scanned Objects: A High-Quality Dataset
of 3D Scanned Household Items", ICRA 2022. We use CodePawl's web copy
(<https://huggingface.co/datasets/codepawl/scanned-objects-glb>, revision fdb214f), which converts and compresses the
scans and makes simpler copies. We changed them further (`tools/goods-build.mjs`): that copy's level 2 shape (level 3
when level 2 is heavy) with level 3's 256 px textures, normal maps removed, turned to face +z and stood on the ground,
quantized and compressed; a lighter copy simplified to at most 400 triangles; the pictures resized. They are named by
colour and what they are, never by product or brand. Brands, logos and product names printed on the scanned packaging
belong to their owners; Google does not endorse My Virtual World. Details: `client/assets/gso/ATTRIBUTION.md`.

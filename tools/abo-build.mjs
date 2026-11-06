#!/usr/bin/env node
// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The Amazon furniture library made ready for the game, from CodePawl's pack of the Amazon Berkeley Objects
// (https://huggingface.co/datasets/codepawl/abo-glb, rev c6ac661; the models CC BY 4.0 by Amazon.com):
//   client/assets/abo/m/<id>.glb   each furniture or decor model, "level 2 lean": the pack's level 2 shape (level 3's when
//                                  level 2 is over 20k triangles) with level 3's 256 px KTX2 maps, no normal map, positions
//                                  and normals quantized, meshopt-compressed (~70 KB, ~0.3 MB on the GPU)
//   client/assets/abo/t/<id>.webp  its picture for the Furnish panel (160 px, from the pack's thumbs)
//   shared/abo-catalog.js          the list (generated: committed): id, kind (shared/abo-kinds.js), a neutral name, size
// Only furniture and decor are kept (no electronics, tools, kitchenware, bags ...); names come from colour, material and
// kind, never the product's name or brand. Resumable: a model or picture already written is skipped.
//
//   node tools/abo-build.mjs [--pack DIR] [--meta FILE] [--jobs N] [--limit N] [--catalog-only]
// DIR: the pack (default ../../mvw-assets-hf/abo-glb beside this repository's folder); FILE: its metadata.jsonl.
// Needs @gltf-transform/core, /extensions, /functions, meshoptimizer and sharp: `npm i --no-save` them here, or point
// ABO_TOOLS at a folder whose node_modules has them.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { ABO_KINDS, ABO_KIND_IDS } from '../shared/abo-kinds.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'client/assets/abo');
const TRI_CAP = 20000, TRI_MAX = 40000;
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const PACK = path.resolve(arg('--pack', path.join(ROOT, '../../mvw-assets-hf/abo-glb')));
const META = path.resolve(arg('--meta', path.join(PACK, 'metadata.jsonl')));

function deps() {
  const req = createRequire(path.join(process.env.ABO_TOOLS ? path.resolve(process.env.ABO_TOOLS) : ROOT, 'noop.js'));
  return { core: req('@gltf-transform/core'), ext: req('@gltf-transform/extensions'), fn: req('@gltf-transform/functions'), mo: req('meshoptimizer'), sharp: req('sharp') };
}

// ------------------------------------------------------------------ sorting (product type, then words of the name)
const NAME_KINDS = [
  [/bean ?bag/, 'beanbag'], [/sectional/, 'sectional'], [/loveseat|love seat|settee/, 'loveseat'], [/daybed/, 'daybed'],
  [/sofa|couch|divano|canap|futon/, 'sofa'], [/chaise/, 'chaise'], [/recliner|rocking chair|glider/, 'recliner'],
  [/ottoman|pouf|footstool|foot stool|poggiapiedi|hocker|puff\b/, 'ottoman'],
  [/bar stool|barstool|counter stool|counter-height stool/, 'bar_stool'], [/stool|sgabello|taburete/, 'stool*'],
  [/gaming chair|racing chair/, 'gaming_chair'], [/office chair|desk chair|task chair|executive chair|computer chair|swivel|ufficio|oficina|bureau|b[üu]ro/, 'office_chair'],
  [/accent chair|arm ?chair|club chair|lounge chair|wingback|barrel chair|slipper chair|tub chair|oversized chair|chesterfield/, 'armchair'],
  [/dining chair|side chair|kitchen chair|dining room chair|parsons/, 'dining_chair'], [/chair|sedia|silla|stuhl|fauteuil|poltrona|sessel/, 'chair*'],
  [/under-?bed|underbed/, 'storage'], [/headboard/, 'headboard'], [/mattress/, 'mattress'], [/bed frame|platform bed|bunk bed|\bbed\b|letto|\bcama\b/, 'bed'],
  [/\btv\b|media console|media cabinet|media table|entertainment|schermo/, 'tv_stand'], [/nightstand|night stand|bedside|comodino|mesita/, 'nightstand'], [/coffee table|cocktail table|tavolino/, 'coffee_table'],
  [/console table|sofa table|entryway table/, 'console_table'], [/side table|end table|accent table|c-table|nesting table|drink table/, 'side_table'],
  [/dining table|kitchen table|bistro table|pub table|bar table|dining set/, 'dining_table'],
   [/vanity|dressing table/, 'vanity'],
  [/desk|scrivania|escritorio|schreibtisch|workstation/, 'desk'], [/dresser|chest of drawers|cassettiera|c[oó]moda|commode|kommode/, 'dresser'],
  [/wardrobe|armoire|armadio/, 'wardrobe'], [/bookcase|bookshelf|book shelf|libreria/, 'bookcase'], [/filing cabinet|file cabinet/, 'filing_cabinet'],
  [/bar cart|serving cart|kitchen cart|kitchen island|trolley|carrello|rolling cart/, 'kitchen_cart'], [/wine rack|bottle rack/, 'wine_rack'],
  [/clothes rack|garment rack|coat rack|hall tree|coat stand|clothing rack/, 'clothes_rack'],
  [/floating shel|wall shel|wall-mounted shel|wall mounted shel/, 'wall_shelf'], [/shel(f|ves)|scaffale|estanter|regal|etag[eè]re|ladder/, 'shelf'],
  [/cabinet|sideboard|buffet|credenza|cupboard|kitchen pantry|mobile|schrank/, 'cabinet'],
  [/bench|panca|banco/, 'bench'], [/table|tavolo|\bmesa\b|tisch/, 'table*'],
  [/floor lamp|torchiere|piantana/, 'floor_lamp'], [/table lamp|desk lamp|bedside lamp/, 'table_lamp'], [/chandelier|lampadario/, 'chandelier'],
  [/pendant|ceiling|flush mount|hanging light/, 'pendant'], [/sconce|wall light|wall lamp/, 'sconce'], [/lamp|lampada|l[aá]mpara|light/, 'lamp*'],
  [/\brug\b|carpet|tappeto|alfombra|runner/, 'rug'], [/mirror|specchio|espejo|spiegel/, 'mirror*'], [/clock|orologio|reloj|uhr\b/, 'clock'],
  [/chalkboard|message board|memo board|dry erase|pinboard|cork board|corkboard|whiteboard/, 'board'],
  [/wall art|canvas|print\b|poster|painting|wall decor|tapestry|wall sculpture|wall hanging/, 'wall_art'], [/frame/, 'frame'],
  [/vase|vaso\b|jarr[oó]n/, 'vase'], [/planter|plant pot|plant stand|flower pot|maceta|\bpot\b/, 'planter'], [/plant|tree|fern|succulent|topiary/, 'plant'],
  [/candle|lantern|tealight/, 'candle'], [/sculpture|statue|figurine|bookend|object|decorative/, 'sculpture'],
  [/pillow|cushion|cuscino|coj[ií]n|kissen/, 'pillow'], [/curtain|drape|tenda|cortina|vorhang/, 'curtain'],
  [/basket|\bbin\b|cube|storage|box|hamper|cesto|scatol|organi[sz]er/, 'storage'],
  [/canopy|gazebo/, 'canopy'], [/fire ?pit/, 'patio'], [/birdhouse|trellis|wagon|garden/, 'garden'],
  [/yoga mat|exercise mat|fitness mat|puzzle mat/, 'exercise_mat'], [/dumbbell|kettlebell|weight|rowing|fitness|exercise/, 'gym'],
];
const DROP_TYPES = new Set(['office products', 'multiport hub', 'electronic cable', 'auto accessory', 'tools', 'computer add on', 'mouse pad',
  'janitorial supply', 'biss', 'paper product', 'storage hook', 'saute fry pan', 'ce accessory', 'portable electronic device cover',
  'portable electronic device stand', 'portable electronic device mount', 'instrument parts and accessories', 'handbag', 'animal collar',
  'dishware bowl', 'drink coaster', 'carrying case or bag', 'computer', 'accessory or part or supply', 'battery', 'electronic adapter',
  'wireless accessory', 'file folder', 'consumer electronics', 'cellular phone case', 'body positioner', 'drinking cup', 'pump dispenser',
  'blanket', 'jewelry storage', 'jar', 'kitchen', 'placemat', 'furniture cover', 'electric fan', 'air conditioner', 'dehumidifier', 'ladder',
  'flat screen display mount', 'professional healthcare', 'building material', 'sound and recording equipment']);
const TYPE_KIND = {
  sofa: 'sofa*', chair: 'chair*', rug: 'rug', 'wall art': 'wall_art', table: 'table*', lamp: 'lamp*', 'stool seating': 'stool*', ottoman: 'ottoman',
  pillow: 'pillow', headboard: 'headboard', 'light fixture': 'lamp*', planter: 'planter', desk: 'desk', bed: 'bed', 'bed frame': 'bed', cabinet: 'cabinet*',
  'home mirror': 'mirror*', shelf: 'shelf*', dresser: 'dresser', vase: 'vase', bench: 'bench', 'clothes rack': 'clothes_rack', 'storage box': 'storage',
  'freestanding shelter': 'canopy', curtain: 'curtain', mattress: 'mattress', 'bean bag chair': 'beanbag', clock: 'clock', 'exercise mat': 'exercise_mat',
  'picture frame': 'frame', 'storage rack': 'shelf', 'writing board': 'board', 'candle holder': 'candle', 'bottle rack': 'wine_rack', 'storage drawer': 'storage',
  'home lighting and lamps': 'lamp*', sculpture: 'sculpture', figurine: 'sculpture', 'artificial plant': 'plant', 'laundry hamper': 'storage', basket: 'storage',
  'fitness bench': 'gym', 'rowing machine': 'gym', pinboard: 'board', 'utility cart wagon': 'garden',
};
const nameKind = s => { for (const [re, k] of NAME_KINDS) if (re.test(s)) return k; return null; };
/** The kind of model m (shared/abo-kinds.js), or null to leave it out. */
export function classify(m) {
  const pt = m.product_type || '', s = String(m.name || '').toLowerCase();
  if (DROP_TYPES.has(pt)) return null;
  let k = TYPE_KIND[pt];
  if (!k || ['home furniture and decor', 'home', 'furniture', 'home bed and bath', 'sporting goods', 'outdoor living'].includes(pt)) k = nameKind(s);
  if (pt === 'sporting goods' && k !== 'gym' && k !== 'exercise_mat') return null;
  if (pt === 'outdoor living') { if (/heater|cover/.test(s)) return null; if (/sofa|sectional|lounge|chair|set/.test(s)) k = 'patio'; }
  if (pt === 'home bed and bath' && k !== 'pillow' && k !== 'curtain' && k !== 'rug') return null;
  if (!k) return null;
  const [w, h, d] = m.size_metres;
  if (Math.max(w, h, d) < 0.1) return null;   // (too small to see in a room)
  if (k.endsWith('*')) {
    const g = nameKind(s), base = k.slice(0, -1);
    if (g && !g.endsWith('*') && (base === 'lamp' ? /lamp|light|pendant|chandelier|sconce/.test(g) : true) && kindFits(base, g)) return g;
    k = base;
    if (k === 'sofa') return w < 1.45 ? 'loveseat' : 'sofa';
    if (k === 'chair') return w > 0.66 || h < 0.85 ? 'armchair' : 'dining_chair';
    if (k === 'stool') return h > 0.6 ? 'bar_stool' : 'stool';
    if (k === 'table') return h < 0.52 ? 'coffee_table' : (h < 0.72 && w < 0.75) ? 'side_table' : h > 0.95 ? 'bar_table' : (w >= 1.0 && d >= 0.7) ? 'dining_table' : 'table';
    if (k === 'lamp') return h > 1.2 ? 'floor_lamp' : 'table_lamp';
    if (k === 'mirror') return h > 1.3 && d > 0.12 ? 'floor_mirror' : 'mirror';
    if (k === 'cabinet') return 'cabinet';
    if (k === 'shelf') return h > 1.1 && w > 0.5 ? 'bookcase' : 'shelf';
  }
  return k;
}
// (a name's words can only refine the product type into a kind of the same family)
const FAMILY = { sofa: ['sofa', 'sectional', 'loveseat', 'daybed', 'chaise', 'ottoman'], chair: ['armchair', 'recliner', 'chaise', 'beanbag', 'dining_chair', 'office_chair', 'gaming_chair', 'bar_stool', 'stool', 'ottoman'],
  stool: ['bar_stool', 'stool', 'ottoman'], table: ['coffee_table', 'side_table', 'console_table', 'dining_table', 'bar_table', 'nightstand', 'desk', 'tv_stand', 'vanity', 'patio', 'cabinet'],
  lamp: ['floor_lamp', 'table_lamp', 'pendant', 'chandelier', 'sconce', 'candle'], mirror: ['mirror', 'floor_mirror'],
  cabinet: ['cabinet', 'tv_stand', 'filing_cabinet', 'wardrobe', 'bookcase', 'dresser', 'nightstand', 'kitchen_cart', 'wine_rack', 'shelf'],
  shelf: ['shelf', 'wall_shelf', 'bookcase', 'wine_rack', 'clothes_rack'] };
function kindFits(base, k) { return (FAMILY[base] || []).includes(k); }

// ------------------------------------------------------------------ neutral names: colour, material, kind
const COLOURS = [['Black', /black|ebony|onyx|jet|nero|negro|schwarz|espresso/], ['White', /white|ivory|snow|bianco|blanco|weiß|weiss|alabaster/],
  ['Grey', /gr[ae]y|slate|graphite|pewter|grigio|gris|smoke|fog|heather|charcoal|ash\b|cement|silver/], ['Cream', /cream|beige|oatmeal|sand|taupe|khaki|ecru|wheat|linen|bone|ivory|parchment/],
  ['Navy', /navy|indigo|midnight/], ['Blue', /blue|azure|denim|teal|aqua|turquoise|cobalt|sky|blu\b|azul|blau/], ['Green', /green|olive|sage|emerald|moss|mint|verde|forest|jade/],
  ['Red', /red|burgundy|wine|ruby|crimson|rosso|rojo|marsala|brick/], ['Pink', /pink|blush|rose|coral|fuchsia|rosa/], ['Yellow', /yellow|mustard|ochre|gold(en)? yellow|giallo|lemon|honey/],
  ['Orange', /orange|rust|copper|terracotta|amber|tangerine|cognac|caramel|camel/], ['Purple', /purple|lavender|plum|violet|lilac|aubergine/], ['Gold', /gold|brass|bronze/],
  ['Brown', /brown|chocolate|coffee|mocha|walnut|chestnut|mahogany|tobacco|cocoa|marrone|marr[oó]n|braun|tan\b|saddle|cherry|driftwood|oak|teak|wood|pine|acacia|mango|natural|honey/],
  ['Multicolour', /multi|assorted|print|pattern/]];
const MATERIALS = [['Velvet', /velvet|velour/], ['Leather', /leather|leder|pelle|cuero/], ['Bouclé', /boucl/], ['Rattan', /rattan|wicker|cane|seagrass/],
  ['Linen', /linen/], ['Wool', /wool|lana\b/], ['Jute', /jute|sisal/], ['Cotton', /cotton|cotone|algod/], ['Marble', /marble|marmo|m[aá]rmol/],
  ['Glass', /glass|vetro|vidrio/], ['Ceramic', /ceramic|porcelain|stoneware|terracotta/], ['Concrete', /concrete|cement/], ['Stone', /stone\b|travertine|slate/],
  ['Bamboo', /bamboo/], ['Oak', /\boak\b|rovere/], ['Walnut', /walnut|noce\b/], ['Pine', /\bpine\b|pino\b/], ['Acacia', /acacia/], ['Mango Wood', /mango/], ['Teak', /teak/],
  ['Wood', /wood|legno|madera|holz|mdf|timber|sheesham/], ['Metal', /metal|iron|steel|aluminum|aluminium|chrome|metallo|metall|hierro/],
  ['Fabric', /fabric|upholster|polyester|chenille|tweed|microfiber|tessuto|tela|stoff/], ['Plastic', /plastic|acrylic|resin|polypropylene/]];
const BRANDS = /amazon ?basics|amazon ?commercial|amazon brand|marca amazon|marchio amazon|marque amazon|amazon|stone (&|and) beam|rivet|movian|solimo|ravenna home|alkove|umi\.|pinzon|ashley|homepop/g;   // (brand words: not a material or a colour)
const pick = (list, s) => { for (const [w, re] of list) if (re.test(s)) return w; return ''; };
function nameOf(m, k) {
  const nm = String(m.name || '').toLowerCase().replace(BRANDS, ' ');
  const col = pick(COLOURS, String(m.color || '').toLowerCase()) || pick(COLOURS, nm);
  const mf = String(m.material || '').toLowerCase(), brandStone = mf === 'stone' && /stone (&|and) beam/i.test(m.name || '');   // (the brand, not the material)
  const mat = (brandStone ? '' : pick(MATERIALS, mf)) || pick(MATERIALS, nm);
  const label = ABO_KINDS[k].label, words = [];
  if (col && col !== 'Multicolour') words.push(col);
  if (mat) words.push(mat);
  if (col === 'Multicolour') words.unshift('Patterned');
  return [...new Set([...words, label])].join(' ');
}

// ------------------------------------------------------------------ one model
const QUIET = D => new D.core.Logger(D.core.Logger.Verbosity.ERROR);
async function convert(D, io, id, meta) {
  const lod = n => path.join(PACK, `lods/${id}/${id}_lod${n}.glb`);
  if (!fs.existsSync(lod(2)) || !fs.existsSync(lod(3))) return { id, skip: 'not downloaded' };
  const tri2 = meta.lods?.[1]?.triangles ?? 0, useL3 = tri2 > TRI_CAP;
  const doc = await io.read(lod(useL3 ? 3 : 2));
  doc.setLogger(QUIET(D));
  if (!useL3) {   // level 3's 256 px maps on level 2's shape, by order (many textures have no names)
    const src = (await io.read(lod(3))).getRoot().listTextures(), dst = doc.getRoot().listTextures();
    if (src.length !== dst.length) return { id, skip: 'texture count differs' };
    dst.forEach((t, i) => t.setImage(src[i].getImage()).setMimeType(src[i].getMimeType()));
  }
  for (const m of doc.getRoot().listMaterials()) m.setNormalTexture(null);
  const { prune, dedup, quantize, meshopt } = D.fn;
  await doc.transform(prune(), dedup(), quantize({ pattern: /^(POSITION|NORMAL)$/, quantizePosition: 14, quantizeNormal: 10 }), meshopt({ encoder: D.mo.MeshoptEncoder, level: 'high' }));
  let tris = 0;
  for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) tris += (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3;
  const bin = await io.writeBinary(doc);
  return { id, bin, tris, lod: useL3 ? 3 : 2 };
}

async function workerMain() {
  const D = deps();
  await D.mo.MeshoptDecoder.ready; await D.mo.MeshoptEncoder.ready;
  const io = new D.core.NodeIO().setLogger(QUIET(D)).registerExtensions(D.ext.ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': D.mo.MeshoptDecoder, 'meshopt.encoder': D.mo.MeshoptEncoder });
  parentPort.on('message', async ({ id, meta, glb, thumb }) => {
    const r = { id };
    try {
      if (glb) {
        const c = await convert(D, io, id, meta);
        if (c.skip) r.skip = c.skip; else { fs.writeFileSync(glb + '.tmp', c.bin); fs.renameSync(glb + '.tmp', glb); r.bytes = c.bin.length; r.tris = c.tris; r.lod = c.lod; }
      }
      if (thumb && !r.skip) {
        const src = path.join(PACK, `thumbs/${id}.webp`);
        if (fs.existsSync(src)) { await D.sharp(src).resize(160, 160, { fit: 'inside' }).webp({ quality: 72 }).toFile(thumb + '.tmp.webp'); fs.renameSync(thumb + '.tmp.webp', thumb); r.thumb = true; }
      }
    } catch (e) { r.error = String(e?.message || e).slice(0, 200); }
    parentPort.postMessage(r);
  });
}

// ------------------------------------------------------------------ the list
const cm = v => Math.round(v * 100);
function writeCatalog(rows) {
  const lines = rows.map(r => [r.id, ABO_KIND_IDS.indexOf(r.k), r.name.replace(/[|\n]/g, ' '), ...r.rect.map(cm), cm(r.h)].join('|'));
  const counts = {};
  for (const r of rows) { const K = ABO_KINDS[r.k]; counts[K.cat] = (counts[K.cat] || 0) + 1; }
  const src = `// My Virtual World — generated by tools/abo-build.mjs (do not edit by hand): the Amazon furniture library, ${rows.length} models
// from the Amazon Berkeley Objects by Amazon.com (CC BY 4.0, client/assets/abo/ATTRIBUTION.md), as converted by CodePawl
// (huggingface.co/datasets/codepawl/abo-glb, rev c6ac661). By category: ${Object.entries(counts).map(([c, n]) => `${c} ${n}`).join(', ')}.
// One line per model: id | kind (index in shared/abo-kinds.js ABO_KIND_IDS) | name | x0 | z0 | x1 | z1 | height (cm, its own
// frame: +z its front, standing on y = 0). The model is client/assets/abo/m/<id>.glb, its picture client/assets/abo/t/<id>.webp.
export const ABO_REV = 'c6ac661';
export const ABO_ROWS = \`
${lines.join('\n')}
\`;
`;
  fs.writeFileSync(path.join(ROOT, 'shared/abo-catalog.js'), src);
  return counts;
}

async function main() {
  const all = fs.readFileSync(META, 'utf8').trim().split('\n').map(l => JSON.parse(l));
  const keep = [];
  for (const m of all) { const k = classify(m); if (k && (m.lods?.[2]?.triangles ?? 0) <= TRI_MAX) keep.push({ m, k }); }   // (a model even its simplest copy of which is heavy: left out)
  keep.sort((a, b) => ABO_KIND_IDS.indexOf(a.k) - ABO_KIND_IDS.indexOf(b.k) || a.m.id.localeCompare(b.m.id));
  console.log(`metadata ${all.length}, furniture and decor ${keep.length}`);
  const limit = +arg('--limit', 0) || keep.length;
  fs.mkdirSync(path.join(OUT, 'm'), { recursive: true }); fs.mkdirSync(path.join(OUT, 't'), { recursive: true });
  const glb = id => path.join(OUT, 'm', `${id}.glb`), thumb = id => path.join(OUT, 't', `${id}.webp`);
  if (!process.argv.includes('--catalog-only')) {
    const todo = keep.slice(0, limit).filter(({ m }) => !fs.existsSync(glb(m.id)) || !fs.existsSync(thumb(m.id)));
    const jobs = Math.max(1, Math.min(+arg('--jobs', 0) || Math.max(1, os.cpus().length - 4), todo.length));
    console.log(`to do ${todo.length} with ${jobs} workers`);
    let next = 0, done = 0, made = 0, skipped = 0, errors = 0;
    const t0 = Date.now(), skips = {};
    await new Promise(resolve => {
      if (!todo.length) return resolve();
      let live = jobs;
      for (let w = 0; w < jobs; w++) {
        const wk = new Worker(fileURLToPath(import.meta.url), { workerData: { worker: true }, argv: process.argv.slice(2) });
        const feed = () => {
          if (next >= todo.length) { wk.terminate(); if (--live === 0) resolve(); return; }
          const { m } = todo[next++];
          wk.postMessage({ id: m.id, meta: m, glb: fs.existsSync(glb(m.id)) ? null : glb(m.id), thumb: fs.existsSync(thumb(m.id)) ? null : thumb(m.id) });
        };
        wk.on('message', r => {
          done++;
          if (r.error) { errors++; if (errors < 20) console.log('error', r.id, r.error); } else if (r.skip) { skipped++; skips[r.skip] = (skips[r.skip] || 0) + 1; } else if (r.bytes) made++;
          if (done % 250 === 0) console.log(`${done}/${todo.length} made ${made} skipped ${skipped} errors ${errors} ${((Date.now() - t0) / 1000).toFixed(0)} s`);
          feed();
        });
        wk.on('error', e => { console.log('worker died', String(e).slice(0, 200)); if (--live === 0) resolve(); });
        feed();
      }
    });
    console.log(`models made ${made}, skipped ${skipped} ${JSON.stringify(skips)}, errors ${errors}, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  }
  // the list: every kept model whose file exists (a missing picture is shown as a box)
  const seen = {}, rows = [];
  for (const { m, k } of keep) {
    if (!fs.existsSync(glb(m.id))) continue;
    const [sx, sy, sz] = m.size_metres, [bx, by, bz] = m.bounds_min || [-sx / 2, 0, -sz / 2];
    let name = nameOf(m, k);
    seen[name] = (seen[name] || 0) + 1;
    if (seen[name] > 1) name += ` ${seen[name]}`;
    rows.push({ id: m.id, k, name, rect: [bx, bz, bx + sx, bz + sz], h: Math.max(0.01, by + sy) });
  }
  const counts = writeCatalog(rows);
  console.log(`catalog ${rows.length}: ${JSON.stringify(counts)}`);
}

if (isMainThread && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(e => { console.error(e); process.exit(1); });
else if (workerData?.worker) workerMain();

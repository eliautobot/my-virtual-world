// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The crowd's library served in two files (shared/crowd-split.js): for each body, <sex>.far.bin (what everyone is drawn
// with from a distance, sent first) and <sex>.near.bin (each part's finest level), made from whichever library is
// served (the release's, or the owner's bake: server/crowd-bake.js) into a folder of their own beside the compressed
// copies (never the data folder) — made again only when the library changes, in the background, a body at a time.
// The browser is told of them (/assets/crowd/version.json: split) only once they are made and compressed
// (server/asset-compress.js), so it never fetches them larger than the library itself; until then it reads the library.
import fs from 'node:fs';
import path from 'node:path';
import { crowdSplit } from '../shared/crowd-split.js';

export const SPLIT_SEXES = ['female', 'male'];

export class CrowdSplit {
  /** src: the library's folder; out: where the two files of each body go; log: { info, warn }. */
  constructor({ src, out, log = console }) {
    Object.assign(this, { src, out, log });
    this.done = false; this.failed = null;
  }
  /** A body's library as it is now: its files' sizes and times (the split is made again when they change). */
  stamp(sex) {
    const s = f => { try { const st = fs.statSync(path.join(this.src, f)); return `${st.size}:${Math.round(st.mtimeMs)}`; } catch { return '-'; } };
    return `${s(`${sex}.json`)}|${s(`${sex}.bin`)}`;
  }
  /** Makes what is missing or out of date; resolves true when both bodies' files are there (false: no library here). */
  async build() {
    try {
      fs.mkdirSync(this.out, { recursive: true });
      for (const sex of SPLIT_SEXES) {
        const json = path.join(this.src, `${sex}.json`), bin = path.join(this.src, `${sex}.bin`);
        if (!fs.existsSync(json) || !fs.existsSync(bin)) return (this.done = false);
        const stamp = this.stamp(sex), stampFile = path.join(this.out, `${sex}.stamp`);
        let had = null; try { had = fs.readFileSync(stampFile, 'utf8'); } catch { /* none yet */ }
        if (had === stamp && fs.existsSync(path.join(this.out, `${sex}.far.bin`)) && fs.existsSync(path.join(this.out, `${sex}.near.bin`))) continue;
        const man = JSON.parse(await fs.promises.readFile(json, 'utf8')), data = await fs.promises.readFile(bin);
        const L = crowdSplit(man);
        for (const [name, part] of [['far', L.far], ['near', L.near]]) {
          const buf = Buffer.alloc(part.size);
          for (const s of part.list) {
            if (s.src + s.len > data.length) throw new Error(`${sex}.bin is shorter than its manifest`);
            data.copy(buf, s.off, s.src, s.src + s.len);
          }
          // (written beside, then renamed: a browser never gets half a file)
          const file = path.join(this.out, `${sex}.${name}.bin`), tmp = `${file}.tmp`;
          await fs.promises.writeFile(tmp, buf);
          await fs.promises.rename(tmp, file);
        }
        fs.writeFileSync(stampFile, stamp);
        this.log.info?.(`[crowd] ${sex}: split for the first view (${(L.far.size / 1048576).toFixed(1)} MB) and close by (${(L.near.size / 1048576).toFixed(1)} MB)`);
      }
      return (this.done = true);
    } catch (e) {
      this.failed = e.message; this.done = false;
      this.log.warn?.('[crowd] could not split the library (the whole one is served):', e.message);
      return false;
    }
  }
}

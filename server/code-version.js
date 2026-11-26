// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The page's own code under a versioned address (2026-11-24, the product owner: "start up is very slow"): the browser
// kept none of it — every visit asked again for each of the ~450 script and style files (no-cache), one answer at a time
// where one module waited for the next. Now the page (index.html, still never kept) names its scripts and styles under
// /v/<version>/…, and the import map sends the modules' own /js/… and /shared/… there too; a file asked for at the
// current version is kept a year (immutable), so a return visit fetches none of them. The version is a hash of every
// code file's path, size and time: any change — a release, or an edit to a folder served live — makes a new one, and
// the next page load asks for everything at the new address. A file asked for at another version (a page still open
// from before) is the current file, sent as before (no-cache), so nothing old is ever kept under a new name or the
// reverse.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/** /v/<version>/<rest>: [version, rest] (rest begins with '/'), else null. */
export const VERSIONED = /^\/v\/([0-9a-f]{12})(\/.*)$/;
/** The versioned folders: what the hash covers, and what is kept a year at the current version. */
export const CODE_DIRS = ['/js/', '/css/', '/shared/'];

export class CodeVersion {
  /**
   * @param {object} o
   * @param {string} o.client  the client folder (its js/ and css/)
   * @param {string} o.shared  the shared folder
   * @param {number} [o.ttlMs] how long a computed version is trusted before the files are looked at again
   * @param {() => number} [o.now]
   */
  constructor({ client, shared, ttlMs = 2000, now = Date.now }) {
    this.dirs = [path.join(client, 'js'), path.join(client, 'css'), shared];
    this.ttlMs = ttlMs; this.now = now;
    this.v = null; this.at = -Infinity;
  }
  /** The code's version now: 12 hex digits. Looked at again at most every ttlMs (a stat of each file, a few ms). */
  current() {
    const t = this.now();
    if (this.v && t - this.at < this.ttlMs) return this.v;
    const h = crypto.createHash('sha1');
    const walk = (dir, rel) => {
      let names;
      try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      names.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      for (const e of names) {
        const p = path.join(dir, e.name), r = `${rel}/${e.name}`;
        if (e.isDirectory()) walk(p, r);
        else {
          let st; try { st = fs.statSync(p); } catch { continue; }
          if (st.isFile()) h.update(`${r}\0${st.size}\0${Math.round(st.mtimeMs)}\n`);
        }
      }
    };
    this.dirs.forEach((d, i) => walk(d, String(i)));
    this.v = h.digest('hex').slice(0, 12); this.at = t;
    return this.v;
  }
  /** Whether a request for `rest` at version `v` may be kept a year: the current version, inside a versioned folder. */
  immutable(v, rest) { return v === this.current() && CODE_DIRS.some(d => rest.startsWith(d)); }
  /** The page (index.html) naming its scripts and styles at version v, and sending its modules' /js/ and /shared/ there. */
  static page(html, v) {
    const at = `/v/${v}`;
    let out = html
      .replace(/(<link\b[^>]*\bhref=")\/css\//g, `$1${at}/css/`)
      .replace(/(<script\b[^>]*\bsrc=")\/js\//g, `$1${at}/js/`);
    // the import map: the modules' absolute /js/… and /shared/… imports to the same versioned files their relative
    // imports reach (one module, one address — never loaded twice)
    out = out.replace(/(<script type="importmap">\s*\{\s*"imports":\s*\{)/, `$1\n  "/js/": "${at}/js/",\n  "/shared/": "${at}/shared/",`);
    return out;
  }
}

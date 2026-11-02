// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Fetches character assets and decodes their maps off the main thread, then transfers the results (no copies), so
// receiving and unpacking several MB per model never blocks a frame. Same decode options as the main-thread fallback.
const ok = r => { if (!r.ok) throw new Error(`${r.url.split('/').pop()} ${r.status}`); return r; };
const MAP_OPTS = { imageOrientation: 'from-image', premultiplyAlpha: 'none', colorSpaceConversion: 'none' };
self.onmessage = async e => {
  const { id, op, kind, url, size, json, bin: binUrl } = e.data;
  try {
    if (op === 'base') {
      // the model, and its added clips' frames (all at once), joined here as render/characters.js loadBase did
      const adds = e.data.adds || [];
      const [man, bin, ...ebs] = await Promise.all([
        fetch(json || `/assets/chars/${kind}.json`).then(ok).then(r => r.json()),
        fetch(binUrl || `/assets/chars/${kind}.bin`).then(ok).then(r => r.arrayBuffer()),
        ...adds.map(x => fetch(x.url).then(r => (r.ok ? r.arrayBuffer() : null)).catch(() => null)),
      ]);
      let a = man.anim, data = null;
      const applied = [];
      adds.forEach((x, i) => {
        const eb = ebs[i];
        if (!eb || eb.byteLength !== x.ef * man.bones * 24) return;
        const src = data || new Uint16Array(bin, a.data.off, a.data.len / 2);
        const base = a.frames * man.bones * 12, h = Math.ceil((a.frames + x.ef) * man.bones * 3 / a.w), merged = new Uint16Array(h * a.w * 4);
        merged.set(src.subarray(0, base)); merged.set(new Uint16Array(eb), base);
        man.clips = [...man.clips, ...x.clips.map(c => ({ ...c, off: a.frames + c.off }))];
        a = man.anim = { ...a, h, frames: a.frames + x.ef }; data = merged; applied.push(x.set);
      });
      const anim = data ? data.buffer : null;
      self.postMessage({ id, man, bin, anim, applied }, anim ? [bin, anim] : [bin]);
    } else if (op === 'map') {
      const blob = await fetch(url).then(ok).then(r => r.blob());
      const bitmap = await createImageBitmap(blob, size < 2048 ? { ...MAP_OPTS, resizeWidth: size, resizeHeight: size, resizeQuality: 'high' } : MAP_OPTS);
      self.postMessage({ id, bitmap }, [bitmap]);
    } else throw new Error('unknown op');
  } catch (err) { self.postMessage({ id, error: String(err?.message || err) }); }
};

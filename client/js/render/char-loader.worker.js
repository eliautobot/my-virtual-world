// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Fetches character assets and decodes their maps off the main thread, then transfers the results (no copies), so
// receiving and unpacking several MB per model never blocks a frame. Same decode options as the main-thread fallback.
const ok = r => { if (!r.ok) throw new Error(`${r.url.split('/').pop()} ${r.status}`); return r; };
const MAP_OPTS = { imageOrientation: 'from-image', premultiplyAlpha: 'none', colorSpaceConversion: 'none' };
self.onmessage = async e => {
  const { id, op, kind, url, size } = e.data;
  try {
    if (op === 'base') {
      const [man, bin] = await Promise.all([
        fetch(`/assets/chars/${kind}.json`).then(ok).then(r => r.json()),
        fetch(`/assets/chars/${kind}.bin`).then(ok).then(r => r.arrayBuffer()),
      ]);
      self.postMessage({ id, man, bin }, [bin]);
    } else if (op === 'map') {
      const blob = await fetch(url).then(ok).then(r => r.blob());
      const bitmap = await createImageBitmap(blob, size < 2048 ? { ...MAP_OPTS, resizeWidth: size, resizeHeight: size, resizeQuality: 'high' } : MAP_OPTS);
      self.postMessage({ id, bitmap }, [bitmap]);
    } else throw new Error('unknown op');
  } catch (err) { self.postMessage({ id, error: String(err?.message || err) }); }
};

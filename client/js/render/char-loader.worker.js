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
      // the crowd's tuning turned into its animation here too, off the main thread (2026-11-20: ~0.1 s a model there):
      // the idles planted, the body's posture, the clips' own turns — a character built in the Agent Studio by its body,
      // a ready-made one by its own (kind f… / m…) when the tuning says so (readyMade); not in the Crowd Studio (keeps
      // its source to turn again: render/characters.js)
      let rigged = false;
      const T = e.data.tuning;
      if (T && man.names) {
        const sex = man.custom ? (man.custom.gender === 'female' ? 'f' : 'm') : T.readyMade ? (/^f/.test(kind) ? 'f' : 'm') : null;
        if (sex) {
          const { applyRig, plantClips, withClipFix } = await import('/shared/crowd-tuning.js');
          const d16 = data || new Uint16Array(bin, a.data.off, a.data.len / 2);
          const an = { data: d16, frames: a.frames, bones: man.bones, names: man.names, clips: man.clips || [] };
          plantClips(an); applyRig(an, T.rig?.[sex], withClipFix(sex, T.clips?.[sex])); rigged = true;
        }
      }
      const anim = data ? data.buffer : null;
      self.postMessage({ id, man, bin, anim, applied, rigged }, anim ? [bin, anim] : [bin]);
    } else if (op === 'bytes') {
      // a file's bytes as they are (the crowd's library: render/characters.js crowdBin), received here so that tens of MB
      // arriving never wait on a busy main thread (2026-11-24: on a phone's start-up the crowd's came at a fifth of the
      // line's speed while the main thread built the city)
      const buf = await fetch(url).then(ok).then(r => r.arrayBuffer());
      self.postMessage({ id, buf }, [buf]);
    } else if (op === 'map') {
      const blob = await fetch(url).then(ok).then(r => r.blob());
      const bitmap = await createImageBitmap(blob, size < 2048 ? { ...MAP_OPTS, resizeWidth: size, resizeHeight: size, resizeQuality: 'high' } : MAP_OPTS);
      self.postMessage({ id, bitmap }, [bitmap]);
    } else throw new Error('unknown op');
  } catch (err) { self.postMessage({ id, error: String(err?.message || err) }); }
};

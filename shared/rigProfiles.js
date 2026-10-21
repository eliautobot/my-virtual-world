// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Showcase calibration profiles. Legacy top-level values remain Batch 1 aliases.
export const RIG_BATCHES = ['batch1', 'batch2'];
export const RIG_BODIES = ['male', 'female'];
export const RIG_LIMIT = 0.15;
export const zeroRig = () => ({ width: 0, height: 0, forward: 0 });

export function rigBatchForKind(kind, manifest = null) {
  if (manifest?.rigAdapter?.bindPose === 'T') return 'batch2';
  const match = /^[mf](\d+)$/.exec(String(kind));
  return match && +match[1] >= 13 && +match[1] <= 22 ? 'batch2' : 'batch1';
}

function offsets(source) {
  const result = { ...(source && typeof source === 'object' ? source : {}) };
  for (const key of ['width', 'height', 'forward']) {
    const value = Number(source?.[key]);
    result[key] = Number.isFinite(value) ? Math.max(-RIG_LIMIT, Math.min(RIG_LIMIT, value)) : 0;
  }
  return result;
}

export function normalizeRigSettings(source = {}) {
  const input = source && typeof source === 'object' && !Array.isArray(source) ? source : {};
  const batch1 = { ...(input.batches?.batch1 || {}) };
  const batch2 = { ...(input.batches?.batch2 || {}) };
  for (const body of RIG_BODIES) {
    batch1[body] = offsets(input.batches?.batch1?.[body] ?? input[body]);
    // New T-pose models never inherit the A-pose correction implicitly.
    batch2[body] = offsets(input.batches?.batch2?.[body]);
  }
  return { ...input, version: 2, male: batch1.male, female: batch1.female,
    batches: { ...(input.batches || {}), batch1, batch2 } };
}

export function updateRigProfile(source, request) {
  if (!request || !RIG_BATCHES.includes(request.batch) || !RIG_BODIES.includes(request.body))
    throw new Error('Choose batch1/batch2 and male/female');
  const values = request.values;
  if (!values || typeof values !== 'object' || Array.isArray(values)) throw new Error('Shoulder values are required');
  for (const key of ['width', 'height', 'forward']) {
    if (typeof values[key] !== 'number' || !Number.isFinite(values[key]) || Math.abs(values[key]) > RIG_LIMIT)
      throw new Error(`${key} must be finite metres within ±${RIG_LIMIT}`);
  }
  if (Object.keys(values).some(key => !['width', 'height', 'forward'].includes(key)))
    throw new Error('Only shoulder width/height/forward may be saved');
  const next = normalizeRigSettings(source);
  const current = next.batches[request.batch][request.body];
  next.batches[request.batch][request.body] = { ...current, ...values };
  if (request.batch === 'batch1') next[request.body] = next.batches.batch1[request.body];
  return next;
}

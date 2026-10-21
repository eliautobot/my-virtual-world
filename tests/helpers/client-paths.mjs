// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Lets node import client modules (client/js/**) the way the browser does: '/shared/…' is the repository's shared/
// folder (the server serves it there). Use: import './helpers/client-paths.mjs' before importing a client module.
import { register } from 'node:module';

const ROOT = new URL('../../', import.meta.url).href;
register(`data:text/javascript,${encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec.startsWith('/shared/')) return next(${JSON.stringify(ROOT)} + spec.slice(1), ctx);
  return next(spec, ctx);
}`)}`);

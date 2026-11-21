// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// For tests that run client/js/render/characters.js's class alone in a VM context: the renderer's helpers for characters
// made in the builder (kindIndex, sexOf — above the class in the file, so not in the slice) run in that context first,
// from the file's own text, with shared/appearance.js's isCustomChar (and shared/crowd-tuning.js's nextAllowed).
import vm from 'node:vm';
import { isCustomChar } from '../../shared/appearance.js';
import { nextAllowed } from '../../shared/crowd-tuning.js';

const FROM = 'const SEX = {};', TO = '/** A point of a body';

/** Runs characters.js's built-character helpers (source: its text) in VM context `context` (contextified if not yet). */
export function addKindHelpers(source, context) {
  const a = source.indexOf(FROM), b = source.indexOf(TO);
  if (a < 0 || b < a) throw new Error('update tests/helpers/char-kinds.mjs: the built-character helpers moved in characters.js');
  if (!vm.isContext(context)) vm.createContext(context);
  context.isCustomChar ??= isCustomChar;
  context.nextAllowed ??= nextAllowed;
  vm.runInContext(source.slice(a, b).replace(/^export /gm, ''), context);
  return context;
}

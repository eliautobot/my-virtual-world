// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Every kind of interior module (shared/interior-modules.js), registered on import: the server and the browser import
// this one file. A new kind: its own file registering itself, imported here.
import './radio-studio.js';
import './kitchen-module.js';
export { INTERIOR_KINDS, modsOf, modsAt, modAt, normalizeModule, checkModule, layModule, withoutModule, shiftModule, sizeWords, rectOf } from './interior-modules.js';

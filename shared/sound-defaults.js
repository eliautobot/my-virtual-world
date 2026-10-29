// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The volumes a new player starts with, in % (Settings → Sound; client/js/core/prefs.js and server/settings.js both read
// them): the product owner's own mix (2026-10-29: "make those same levels the default"). Settings → Sound → Reset goes
// back to them. (Accounts that still had the first defaults were moved to these once: server/db.js v57.)
export const SOUND_DEFAULTS = Object.freeze({ master: 100, world: 15, aircraft: 50, voices: 85, media: 35, music: 30, score: 15, effects: 10, vehicles: 10, radio: 30 });

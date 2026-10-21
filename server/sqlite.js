// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// node:sqlite without its "experimental" start-up warning. Node 24 still prints one, although the parts used here
// (DatabaseSync, prepared statements, backup) are what the accounts database needs. Other warnings still print.
const emit = process.emitWarning;
process.emitWarning = function (warning, ...rest) {
  const text = typeof warning === 'string' ? warning : warning && warning.message;
  if (/SQLite/i.test(String(text || ''))) return;
  return emit.call(process, warning, ...rest);
};
let sqlite;
try {
  sqlite = await import('node:sqlite');
} finally {
  process.emitWarning = emit;
}
export const { DatabaseSync, backup } = sqlite;

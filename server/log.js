// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The server's logger (DECISIONS C102): text lines "time level [area] message" on standard output. Every line passes
// through the redaction helper (server/redact.js), so fields named like credentials and every secret value the server
// has handled become [redacted]. Levels: info, warn, error.
import util from 'node:util';
import { redact } from './redact.js';

/** One log line: strings as they are, everything else inspected on one line; later lines of a message indented. */
export function formatLine(level, args, known = null, now = new Date()) {
  const text = args.map(a => {
    const r = redact(a, known);
    return typeof r === 'string' ? r : util.inspect(r, { depth: 5, breakLength: Infinity });
  }).join(' ');
  return `${now.toISOString()} ${level} ${text.replace(/\n/g, '\n  ')}\n`;
}

/**
 * log(...) writes an info line; log.warn(...) and log.error(...) the other levels.
 * @param {object} [o]
 * @param {Set<string>} [o.known]  secret values to scrub (the SecretBox's; it grows while the server runs)
 * @param {{ write(s: string): unknown }} [o.out]  where lines go (default: standard output)
 */
export function createLogger({ known = null, out = process.stdout } = {}) {
  const write = level => (...a) => { out.write(formatLine(level, a, known)); };
  const log = write('info');
  log.info = log;
  log.warn = write('warn');
  log.error = write('error');
  return log;
}

// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The world's weather on the server (WP4.18, wp4-world-spec.md §6.1): the region's deterministic timeline
// (shared/weather.js) from its seed and the world clock - the same function the browsers run every frame, so only the
// seed and an administrator's override travel (in hello, and as { t: 'weather' } when an override changes). An override
// sets the weather for a number of world hours; it is kept in weather.json beside the world and audited.
import { weatherAt, worldHours, WEATHER_KINDS } from '../../shared/weather.js';

export class Weather {
  /** @param {{ worldId: string, store, clock: () => object, simNow: () => number, broadcast: (m: object) => void, audit?: object }} o */
  constructor({ worldId, store, clock, simNow, broadcast, audit = null }) {
    Object.assign(this, { store, clock, simNow, broadcast, audit });
    this.seed = `${worldId || 'world'}:weather:main`;
    const saved = store.load('weather');
    this.override = saved && WEATHER_KINDS.includes(saved.override?.kind) && Number.isFinite(saved.override.until) ? saved.override : null;
  }
  hours() { return worldHours(this.clock(), this.simNow()); }
  /** The weather now (kind, cloud, rain, fog, storm, wind). */
  now() { return weatherAt(this.seed, this.hours(), this.live()); }
  /** The override while it still applies (and its fade-out). */
  live() { return this.override && this.override.until + 1 > this.hours() ? this.override : null; }
  /** What a browser needs to run the same weather. */
  info() { return { seed: this.seed, override: this.live() }; }
  /**
   * An administrator sets the weather: kind for `hours` world hours from now, or 'auto' to return to the timeline.
   * Returns the new info.
   */
  set(kind, hours, actor) {
    if (kind !== 'auto' && !WEATHER_KINDS.includes(kind)) throw Object.assign(new Error(`Unknown weather "${kind}"`), { status: 400 });
    const h = Math.max(0.5, Math.min(72, Number(hours) || 3)), now = this.hours();
    this.override = kind === 'auto' ? null : { kind, from: now, until: now + h };
    this.store.save('weather', { override: this.override });
    this.audit?.log?.('world.weather', { actor, detail: kind === 'auto' ? { kind: 'auto' } : { kind, hours: h } });
    const info = this.info();
    this.broadcast({ t: 'weather', ...info });
    return info;
  }
}

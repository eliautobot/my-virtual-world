// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The page's sound mixer (2026-10-20, Settings → Sound): one place that says how loud each kind of sound is —
//   world     the ambience (audio/ambience.js): wind, rain, waves, birds, the city, thunder
//   aircraft  flying and its games (audio/aircraft-sound.js): engines, wind, the stall horn, the ring game's chimes
//   voices    agents speaking (ui/voice.js): voice conversations and 🔊 read aloud
//   media     players in the page: voicemail, audio and video in chats and on the PC
//   music     live music on a night out (audio/nightlife-music.js): the lounge's band, the club's DJ
//   score     the city's own music in the background (audio/score.js): by day, evening and night, and while you build
//   vehicles  cars, buses, boats and ferries (audio/vehicle-sound.js): engines, tyres, skids, horns, doors
//   radio     MVW Radio in your car or boat (audio/radio.js): the stations' songs and idents
//   effects   people and things (audio/footsteps.js, audio/engine.js): footsteps, jumps, splashes
// level(kind) = sound on × master × that kind's volume (prefs volMaster, volWorld…, which follow the account). Sound on/off
// is the top bar's button and stays with this device (a laptop muted in a meeting doesn't mute the phone). Every change
// is bus 'sound'; each player follows it at once. Media players are set as they start, and again on every change.
import { bus } from '../core/state.js';
import { pref } from '../core/prefs.js';

const OFF = 'mvw.soundOff';
const KIND = { world: 'volWorld', aircraft: 'volAircraft', voices: 'volVoices', media: 'volMedia', music: 'volMusic', score: 'volScore', effects: 'volEffects', vehicles: 'volVehicles', radio: 'volRadio' };
export const KINDS = Object.keys(KIND);

/** Whether sound is on on this device (the top bar's button). */
export const soundOn = () => { try { return localStorage.getItem(OFF) !== '1'; } catch { return true; } };
/** Turns all sound on or off on this device. */
export function setSoundOn(on) {
  try { if (on) localStorage.removeItem(OFF); else localStorage.setItem(OFF, '1'); } catch { /* private mode: for this page only */ }
  bus.emit('sound', 'on');
}
/** How loud one kind of sound is now, 0..1. */
export function level(kind) {
  if (!soundOn() || !KIND[kind]) return 0;
  return Math.max(0, Math.min(1, (pref('volMaster') / 100) * (pref(KIND[kind]) / 100)));
}

/** A media player in the page at the Videos and recordings volume (silenced by us, not by its own controls, comes back). */
function setMedia(el) {
  if (!(el instanceof HTMLMediaElement)) return;
  const v = level('media');
  try { el.volume = v; } catch { /* some players refuse */ }
  if (v === 0) { if (!el.muted) { el.muted = true; el.dataset.mvwMuted = '1'; } }
  else if (el.dataset.mvwMuted) { el.muted = false; delete el.dataset.mvwMuted; }
}

export function init(app) {
  document.addEventListener('play', e => setMedia(e.target), true);
  bus.on('sound', () => { for (const el of document.querySelectorAll('audio, video')) setMedia(el); });
  app.sound = { get on() { return soundOn(); }, set: setSoundOn, level, kinds: KINDS };
}

// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Settings → Radio (administrators; R2 of the sound effects plan; stations as data 2026-10-27: "the admin can add,
// remove, edit, or change radio stations, hosts, songs, playlists as they please"): the world's stations (server/radio/)
// — each its name, frequency, colour and line, what it plays (genres from the library, or its own playlist in order or
// shuffled), up to three hosts (agents whose brains write the breaks from the world's news), its ads; a new station, a
// station taken off the air — then which voice reads the breaks (the free voice: each listener's browser; the host's own
// voice service; or one voice service of Settings → Connections). How often and how long each station's hosts talk:
// every 1 to 10 songs, short, normal or long, and at most how many breaks a day, with what that comes to (2026-10-28:
// "is there a way to control the frequency of breaks?"; "i set it to talk every 1 song but it doesnt seem to do it").
import { esc } from '../core/util.js';
import { getJSON, post } from '../core/net.js';
import { GENRES } from '/shared/music.js';
import { MAX_HOSTS, talkOf, talkPace, stationTracks, TALK_MAX } from '/shared/radio.js';
import { fmtTime } from '/shared/music.js';

const WHY = { no_brain: 'no brain: give the agent a model provider, or choose the installation\'s brain in Free Will & Mind', brain_off: 'its brain is switched off', not_allowed: 'its owner may not use its brain', unavailable: 'no model service here',
  too_short: 'its answer was too short', screen_blocked: 'the moderation service held a break back', screen_local: 'a break failed the world\'s checks' };
const PLAYS = Object.entries(GENRES).map(([id, g]) => [id, g.name]);
const LENGTHS = [['short', 'Short (about 30 s)'], ['normal', 'Normal (about a minute)'], ['long', 'Long (about a minute and a half)']];

// A studio's station is set from its studio (2026-10-27, the product owner: "all the settings for that radio station to be
// through the Station module not on the settings ... as a separate window"): ui/station-panel.js shows radioTab(…, { only })
// for it; Settings → Radio keeps the stations with no studio, the voice and the breaks a day, and names the studios'.
export async function radioTab(d, body, { only = null } = {}) {
  let V = null, editing = null;   // the admin view; the station being edited ({...} or 'new')
  const openOnly = () => { const st = V.stations.find(s => s.id === only); if (!st) return; editing = structuredClone(st); for (const fam of editing.families || []) for (const [g, G] of Object.entries(GENRES)) if (G.family === fam && !G.internal && !editing.genres.includes(g)) editing.genres.push(g); editing.families = []; };
  const when = t => t ? new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
  const msg = t => { const m = body.querySelector('.rad-msg'); if (m) m.textContent = t; };
  const save = async (patch, ok = 'Saved') => { try { V = await post('/api/radio/admin', patch); editing = null; if (only) openOnly(); paint(); msg(ok); } catch (e) { msg(e.message || 'Not saved'); } };
  const plays = st => st.playlist?.length ? `its own playlist: ${st.playlist.length} songs${st.order === 'order' ? ', in order' : ''}` : [...(st.genres || []).map(g => GENRES[g]?.name || g), ...(st.families || []).map(f => ({ lounge: 'lounge music', club: 'club music', radio: 'radio music' })[f])].join(', ') || 'nothing yet';
  const row = st => {
    const L = V.last?.[st.id];
    return `<div class="rad-st" style="border-left:4px solid ${esc(st.color)};padding:6px 10px;margin:6px 0;background:rgba(255,255,255,.04);border-radius:8px">
      <div class="row" style="justify-content:space-between;gap:8px"><b style="color:${esc(st.color)}">${esc(st.freq)} ${esc(st.band)} · ${esc(st.name)}</b>
        ${only ? '' : `<span class="row" style="gap:6px"><button class="btn small rad-edit" data-id="${esc(st.id)}">Edit</button><button class="btn small rad-del" data-id="${esc(st.id)}" title="Take it off the air">Remove</button></span>`}</div>
      <div class="hint">${esc(st.line || '')}${st.talk ? ' · talk radio' : ''}${st.studio ? ' · 🎙️ broadcast from its studio' : ''} · talk every ${talkOf(st).every} song${talkOf(st).every > 1 ? 's' : ''}, ${talkOf(st).length}${talkOf(st).max != null ? `, at most ${talkOf(st).max} a day` : ''}</div>
      <div class="hint">Plays ${esc(plays(st))} · Hosts: ${st.hostNames?.length ? esc(st.hostNames.map(h => h.name).join(', ')) : st.dj ? 'none' : 'none (music and idents only)'}${st.dj ? ` · DJ: ${esc(st.dj.name)}` : ''} · Ads ${st.ads?.on === false ? 'off' : `every ${st.ads?.every || 2} breaks`}</div>
      ${st.hostNames?.length || st.dj ? `<div class="hint">${V.today?.[st.id] || 0} breaks today${L ? ` · last ${when(L.at)}: ${L.ok ? `on air (${esc(L.voice)})` : esc(WHY[L.error] || L.error)}` : ''}</div>` : ''}
      ${editing && editing.id === st.id ? form(editing) : ''}</div>`;
  };
  /** What a station's talk comes to with its songs: how often, how many a day, and when its limit holds it back. */
  const paceText = st => {
    const p = talkPace(stationTracks(V.songs, st), st), { max } = talkOf(st), min = m => (m < 1.5 ? 'minute' : `${Math.round(m)} minutes`);
    if (max === 0) return 'No talk: music and idents only.';
    if (!p) return 'It has no songs to play yet.';
    return p.capped ? `At most ${max} a day: about one break every ${min(p.minutesApart)}, spread over the day (it has a slot about every ${min(p.slotMinutes)}: about ${p.slotsADay} a day with no limit).`
      : `Its hosts talk about every ${min(p.slotMinutes)}: about ${p.slotsADay} breaks a day.`;
  };
  const form = st => {
    const host = k => `<select class="rad-h" data-k="${k}"><option value="">—</option>${V.agents.map(a => `<option value="${a.id}"${st.hosts?.[k] === a.id ? ' selected' : ''}>${esc(`${a.emoji ? `${a.emoji} ` : ''}${a.name}`)}</option>`).join('')}</select>`;
    const own = !!st.playlist?.length || st._own;
    const picked = (st.playlist || []).map(id => V.songs.find(s => s.id === id)).filter(Boolean);
    return `<div class="rad-form" style="margin-top:8px;display:grid;gap:6px">
      <label class="snd-l">Name<input class="rf-name" maxlength="40" value="${esc(st.name || '')}"></label>
      <div class="row" style="gap:6px"><label class="snd-l">Frequency<input class="rf-freq" style="width:90px" value="${esc(st.freq || '')}" placeholder="101.5"></label>
        <label class="snd-l">Band<select class="rf-band"><option${st.band !== 'AM' ? ' selected' : ''}>FM</option><option${st.band === 'AM' ? ' selected' : ''}>AM</option></select></label>
        <label class="snd-l">Colour<input type="color" class="rf-color" value="${esc(st.color || '#4aa3ff')}"></label></div>
      <label class="snd-l">Its line<input class="rf-line" maxlength="80" value="${esc(st.line || '')}" placeholder="Smooth jazz all night"></label>
      <label class="check"><input type="checkbox" class="rf-talk"${st.talk ? ' checked' : ''}> Talk radio (news, the economy, gossip; an AM sound)</label>
      <div class="row" style="gap:10px;flex-wrap:wrap"><label class="snd-l">Hosts talk every<select class="rf-tevery">${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => `<option value="${n}"${talkOf(st).every === n ? ' selected' : ''}>${n} song${n > 1 ? 's' : ''}</option>`).join('')}</select></label>
        <label class="snd-l">Talk length<select class="rf-tlen">${LENGTHS.map(([k, t]) => `<option value="${k}"${talkOf(st).length === k ? ' selected' : ''}>${t}</option>`).join('')}</select></label></div>
      <label class="snd-l">At most<span class="row" style="gap:6px;align-items:center"><input type="number" class="rf-tmax" min="0" max="${TALK_MAX}" step="1" style="width:110px" placeholder="no limit" value="${st.talkMax ?? ''}"> breaks a day <span class="hint">(empty: as often as set; 0: no talk)</span></span></label>
      <p class="hint rf-pace" aria-live="polite">${esc(paceText(st))}</p>
      <p class="hint">The station's ident plays there, then its hosts talk over the start of the next song. Changing how often moves the station's songs for everyone listening. Each break asks each agent on the air's own brain for its lines.</p>
      <div class="snd-l">What it plays
        <label class="check"><input type="radio" name="rf-what" value="genres"${own ? '' : ' checked'}> Songs of these genres (from the music library)</label>
        <div class="rf-genres" style="display:${own ? 'none' : 'flex'};flex-wrap:wrap;gap:4px 10px">${PLAYS.map(([id, n]) => `<label class="check"><input type="checkbox" value="${id}"${(st.genres || []).includes(id) ? ' checked' : ''}> ${esc(n)}</label>`).join('')}</div>
        <label class="check"><input type="radio" name="rf-what" value="own"${own ? ' checked' : ''}> Its own playlist</label>
        <div class="rf-own" style="display:${own ? 'block' : 'none'}">
          <select class="rf-order"><option value="shuffle"${st.order !== 'order' ? ' selected' : ''}>Shuffled each round</option><option value="order"${st.order === 'order' ? ' selected' : ''}>In this order</option></select>
          <ol class="rf-list" style="margin:6px 0;padding-left:22px">${picked.map((t, i) => `<li data-id="${esc(t.id)}">${esc(t.title)} <span class="hint">${esc(t.artist || '')} · ${fmtTime(t.seconds)}</span>
            <button class="btn small rf-up" data-i="${i}" title="Earlier">↑</button><button class="btn small rf-down" data-i="${i}" title="Later">↓</button><button class="btn small rf-out" data-i="${i}" title="Take it off">✕</button></li>`).join('') || '<li class="hint">No songs yet: add them below</li>'}</ol>
          <select class="rf-add"><option value="">＋ Add a song…</option>${V.songs.filter(t => !(st.playlist || []).includes(t.id)).map(t => `<option value="${esc(t.id)}">${esc(`${t.title} · ${t.artist || ''} (${GENRES[t.genre]?.name || t.genre})`)}</option>`).join('')}</select>
        </div></div>
      ${st.studio ? `<div class="snd-l">Hosts<p class="hint">The agents posted at this studio's broadcast desk (up to ${MAX_HOSTS}): open the studio's floor and use the ⋯ on the desk's seats, as for any post. Now: ${st.hostNames?.length ? esc(st.hostNames.map(h => h.name).join(', ')) : 'none'}.</p></div>` : `<div class="snd-l">Hosts (up to ${MAX_HOSTS}; they take turns, their brains write the breaks)<div class="row" style="gap:6px;flex-wrap:wrap">${Array.from({ length: MAX_HOSTS }, (_, k) => host(k)).join('')}</div></div>`}
      <div class="row" style="gap:10px"><label class="check"><input type="checkbox" class="rf-ads"${st.ads?.on !== false ? ' checked' : ''}> Ads in the breaks</label>
        <label class="snd-l">every<select class="rf-every">${[1, 2, 3, 4, 6].map(n => `<option${(st.ads?.every || 2) === n ? ' selected' : ''}>${n}</option>`).join('')}</select> breaks</label></div>
      <div class="row" style="gap:6px"><button class="btn primary rf-save">${st.id ? 'Save' : 'Put it on the air'}</button>${only ? '' : '<button class="btn rf-cancel">Cancel</button>'}</div></div>`;
  };
  const read = () => {
    const f = body.querySelector('.rad-form'), e = editing, own = f.querySelector('input[name="rf-what"]:checked')?.value === 'own';
    return { ...(e.id ? { id: e.id } : {}), name: f.querySelector('.rf-name').value, freq: f.querySelector('.rf-freq').value, band: f.querySelector('.rf-band').value, color: f.querySelector('.rf-color').value,
      line: f.querySelector('.rf-line').value, talk: f.querySelector('.rf-talk').checked, talkEvery: Number(f.querySelector('.rf-tevery').value), talkLength: f.querySelector('.rf-tlen').value,
      talkMax: f.querySelector('.rf-tmax').value.trim() === '' ? null : Number(f.querySelector('.rf-tmax').value),
      genres: own ? [] : [...f.querySelectorAll('.rf-genres input:checked')].map(x => x.value), families: [],
      playlist: own ? (e.playlist || []) : [], order: f.querySelector('.rf-order').value,
      ...(e.studio ? {} : { hosts: [...f.querySelectorAll('.rf-h')].map(x => Number(x.value)).filter(Boolean) }), ads: { on: f.querySelector('.rf-ads').checked, every: Number(f.querySelector('.rf-every').value) } };
  };
  const paint = () => {
    const C = V.config;
    if (only) {
      const st = V.stations.find(s => s.id === only);
      body.innerHTML = st ? `<div class="rad-list">${row(st)}</div><p class="hint rad-msg" aria-live="polite"></p>` : '<p class="hint">This studio is not on the air yet: it will be in a few seconds.</p>';
    } else body.innerHTML = `
      <p class="hint">MVW Radio's stations are yours to make: each plays songs of its genres or its own playlist, in every car and boat. Give it up to three hosts (agents): between songs they talk about what is really happening in the world (new businesses, the economy, good and bad news, the weather, a sponsor, gossip), written by their own brain, and every break is checked before it airs.</p>
      <div class="rad-list">${V.stations.filter(s => !s.studio).map(row).join('')}</div>
      ${V.stations.some(s => s.studio) ? `<p class="hint">Stations broadcast from a studio are set in their studio (its 📻 over the broadcast desk, or ⚙ on the radio while you are in it): ${esc(V.stations.filter(s => s.studio).map(s => `${s.freq} ${s.band} ${s.name}`).join(', '))}.</p>` : ''}
      ${editing && !editing.id ? `<div class="rad-st" style="padding:6px 10px;border-left:4px solid #888"><b>A new station</b>${form(editing)}</div>` : '<button class="btn rad-new">＋ New station</button>'}
      <hr>
      <label class="snd-l">Voice<select class="rad-voice"><option value="host"${C.voice === 'host' ? ' selected' : ''}>Each host's own voice (their Agent Studio voice; the free voice if they have none)</option><option value="free"${C.voice === 'free' ? ' selected' : ''}>Free voice for every host (each listener's browser reads it)</option>${V.voices.map(c => `<option value="${c.id}"${String(C.voice) === String(c.id) ? ' selected' : ''}>${esc(c.label)}</option>`).join('')}</select></label>
      <p class="hint">A voice service (ElevenLabs, OpenAI…) is added in Settings → Connections; when it can't speak a break, the free voice does.</p>
      <p class="hint rad-msg" aria-live="polite"></p>`;
    body.querySelector('.rad-new')?.addEventListener('click', () => { editing = { band: 'FM', color: '#4aa3ff', genres: [], hosts: [], talkEvery: 3, talkLength: null, ads: { on: true, every: 2 } }; paint(); });
    for (const b of body.querySelectorAll('.rad-edit')) b.onclick = () => {
      editing = structuredClone(V.stations.find(s => s.id === b.dataset.id));
      for (const fam of editing.families || []) for (const [g, G] of Object.entries(GENRES)) if (G.family === fam && !G.internal && !editing.genres.includes(g)) editing.genres.push(g);   // (a family: its genres, ticked)
      editing.families = []; paint();
    };
    for (const b of body.querySelectorAll('.rad-del')) b.onclick = () => { const st = V.stations.find(s => s.id === b.dataset.id); if (confirm(`Take ${st.name} off the air? Its settings and playlist go with it.`)) save({ remove: st.id }, `${st.name} is off the air`); };
    const f = body.querySelector('.rad-form');
    if (f) {
      const keep = () => { Object.assign(editing, read()); };
      for (const r of f.querySelectorAll('input[name="rf-what"]')) r.onchange = () => { keep(); editing._own = r.value === 'own' && r.checked; if (!editing._own) editing.playlist = []; paint(); };
      f.querySelector('.rf-add').onchange = e => { if (!e.target.value) return; keep(); editing._own = true; editing.playlist = [...(editing.playlist || []), e.target.value]; paint(); };
      const move = (i, d) => { keep(); const p = editing.playlist; const j = i + d; if (j < 0 || j >= p.length) return; [p[i], p[j]] = [p[j], p[i]]; paint(); };
      for (const b of f.querySelectorAll('.rf-up')) b.onclick = () => move(Number(b.dataset.i), -1);
      for (const b of f.querySelectorAll('.rf-down')) b.onclick = () => move(Number(b.dataset.i), 1);
      for (const b of f.querySelectorAll('.rf-out')) b.onclick = () => { keep(); editing.playlist.splice(Number(b.dataset.i), 1); paint(); };
      f.querySelector('.rf-save').onclick = () => { const st = read(); save({ station: st }, st.id ? 'Saved' : `${st.name} is on the air`); };
      // (what its talk comes to, as its settings change)
      f.addEventListener('input', () => { const p = f.querySelector('.rf-pace'); if (p) p.textContent = paceText({ ...editing, ...read() }); });
      f.addEventListener('change', () => { const p = f.querySelector('.rf-pace'); if (p) p.textContent = paceText({ ...editing, ...read() }); });
      if (f.querySelector('.rf-cancel')) f.querySelector('.rf-cancel').onclick = () => { editing = null; paint(); };
    }
    if (only) return;
    body.querySelector('.rad-voice').onchange = e => save({ voice: e.target.value });
  };
  try { V = await getJSON('/api/radio/admin'); if (only) openOnly(); paint(); } catch (e) { body.innerHTML = `<p class="hint">${esc(e.message || 'Radio settings could not load')}</p>`; }
}

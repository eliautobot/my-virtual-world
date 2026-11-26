// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// What a thought may look at and do with money (docs/features/FREE-WILL.md §11.11): the Mind's tools. A thought that
// has tools runs in rounds: the model answers {"use":[…]} to use up to MAX_PER_ROUND of them, gets their results as the
// next message, and finally answers with its usual JSON (server/mind/mind.js). Every tool works on what the world lists
// — flats on offer, a real place's menu, people it knows — by short references (F1, I3) the results gave it, never by
// the world's own ids; and every payment, purchase or lease goes through the economy as the agent
// (server/economy/mind-money.js → runAgentAction), so its owner's spending rules decide: scopes, the daily limit,
// "ask me above" (an approval waits for the owner), pause. At most MAX_DO money actions in one thought.
//   a problem:          flats, rent_flat, ask_owner  (no human asked for anything: no buying or paying)
//   a chat with its owner: flats, menu, rent_flat, buy, pay  (its owner is asking; a visitor's chat has no tools)
import { LedgerError } from '../economy/ledger.js';

export const MAX_ROUNDS = 4;            // model calls in one thought with tools (the last must be the final answer)
export const MAX_PER_ROUND = 3;
export const MAX_DO = 2;
const TOOLS = {
  flats: { look: true, scope: 'rent', about: '{"tool":"flats"} — the flats for rent now, cheapest first' },
  menu: { look: true, about: '{"tool":"menu","place":"<a place from PLACES>"} — what it sells and the prices' },
  rent_flat: { scope: 'rent', about: '{"tool":"rent_flat","flat":"F1"} — rent a flat "flats" listed (my owner\'s rules decide; above their limit they must agree first)' },
  buy: { scope: 'buy', about: '{"tool":"buy","place":"<place>","items":[{"item":"I1","n":1}]} — buy what "menu" listed' },
  pay: { scope: 'pay', about: '{"tool":"pay","to":"<my owner, a person I know or a place>","amount":<VC>,"memo":"what for"} — pay someone' },
  ask_owner: { scope: 'pay', about: '{"tool":"ask_owner","amount":<VC>,"why":"..."} — ask my owner for money (they answer in their wallet)' },
  give: { scope: 'pay', about: '{"tool":"give","item":"<a thing I HOLD>","n":1,"to":"<my owner or a person I know>"} — give something I hold (my owner\'s rules decide, as for paying)' },
  // (to its own owner: what it holds is theirs to ask for — 2026-11-20, "they should be able to give me an inventory item")
  give_owner: { about: '{"tool":"give_owner","item":"<a thing I HOLD>","n":1} — give something I hold to my owner (when they ask, or I want to)' },
  // (a trade of its own — 2026-11-20, "companions should trade themselves too": its owner, or another agent of its owner's)
  offer_trade: { about: '{"tool":"offer_trade","to":"<my owner, or another agent of my owner\'s>","give":[{"item":"<a thing I HOLD>","n":1}],"want":[{"item":"<a thing THEY hold>","n":1}],"vc":0,"wantVc":0,"note":"why, in a few words"} — propose a trade (they see it and accept or decline; nothing changes hands until they do; give or want may be empty, vc/wantVc are VC)' },
};
// (the station it hosts — 2026-11-25, the product owner: "the agents should only be able to modify the songs playlist. They
//  cannot create or delete their own radio station": its songs, from the music library; server/radio/radio.js editPlaylist
//  decides — a host of it, the station letting its hosts, a few dozen changes a day — and logs each change for its
//  administrators and its owner, who can undo it)
const RADIO_TOOLS = {
  playlist: { look: true, radio: true, about: '{"tool":"playlist"} — the songs on the radio station I host, numbered, in its order (add "station":"<name>" if I host more than one)' },
  find_songs: { look: true, radio: true, about: '{"tool":"find_songs","words":"<title, artist or genre>"} — songs in the city\'s music library I could add to my station (S1, S2…)' },
  playlist_add: { radio: true, about: '{"tool":"playlist_add","song":"S1"} — add a song "find_songs" listed to my station\'s playlist' },
  find_albums: { look: true, radio: true, about: '{"tool":"find_albums","words":"<album or artist>"} — albums in the city\'s music library (A1, A2…)' },
  playlist_add_album: { radio: true, about: '{"tool":"playlist_add_album","album":"A1"} — add a whole album "find_albums" listed to my station\'s playlist' },
  playlist_remove: { radio: true, about: '{"tool":"playlist_remove","n":3} — take song number n (from "playlist") off my station\'s playlist' },
  playlist_move: { radio: true, about: '{"tool":"playlist_move","n":3,"to":1} — move song number n of my station\'s playlist to place "to"' },
};
Object.assign(TOOLS, RADIO_TOOLS);
// (the stage it plays at — a Lounge Stage or the DJ booth, 2026-11-25: "if an actual agent is placed on that position,
//  they can pick and choose what songs to play"; and the guests' requests: server/music/music.js editSet, answerAsk)
const STAGE_TOOLS = {
  stage: { look: true, radio: true, about: '{"tool":"stage"} — the stage I play at: my set (numbered), what is on, the guests\' requests waiting (R1…)' },
  stage_add: { radio: true, about: '{"tool":"stage_add","song":"S1"} — add a song "find_songs" listed to my set at the stage' },
  stage_add_album: { radio: true, about: '{"tool":"stage_add_album","album":"A1"} — add a whole album "find_albums" listed to my set' },
  stage_remove: { radio: true, about: '{"tool":"stage_remove","n":3} — take song number n (from "stage") out of my set' },
  stage_play_request: { radio: true, about: '{"tool":"stage_play_request","r":"R1"} — play a guest\'s request (it goes into my queue)' },
  stage_pass_request: { radio: true, about: '{"tool":"stage_pass_request","r":"R1","why":"a short friendly reason they read"} — pass on a guest\'s request' },
};
Object.assign(TOOLS, STAGE_TOOLS);
const FOR = { problem: ['flats', 'rent_flat', 'ask_owner', 'offer_trade'], chat: ['flats', 'menu', 'rent_flat', 'buy', 'pay', 'give', 'give_owner', 'offer_trade'] };
const vc = c => `${(c / 100).toFixed(c % 100 ? 2 : 0)} VC`;
const clean = (s, n) => String(s ?? '').replace(/[\u0000-\u001f«»]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const q = (s, n = 80) => `«${clean(s, n)}»`;

/**
 * The tools of one thought.
 * o: { agent, kind: 'problem'|'chat', ctx (mind.js contextOf: places with b and f, peopleRefs), money (mind-money.js),
 *      wallet (money.wallet(...) at the start), people (sim.people), idem (a prefix unique to this thought) }
 */
export function toolbox({ agent, kind, ctx, money, wallet, people, idem, radio = null, music = null }) {
  const allowed = new Set(!wallet || wallet.rules?.paused ? [] : wallet.rules?.scopes || []);
  const names = (money ? FOR[kind] || [] : []).filter(t => !TOOLS[t].scope || allowed.has(TOOLS[t].scope));
  // (a radio host's tools in its chats: only while it hosts a station that lets it change its songs)
  const hosted = kind === 'chat' && radio?.hostedBy ? radio.hostedBy(agent.id) : [];
  if (hosted.length) names.push(...Object.keys(RADIO_TOOLS));
  const stages = kind === 'chat' && music?.stagesOf ? music.stagesOf(agent.id) : [];
  if (stages.length) for (const t of ['find_songs', 'find_albums', ...Object.keys(STAGE_TOOLS)]) if (!names.includes(t)) names.push(t);
  const lib = radio?.findSongs ? radio : music;   // (the library's search: the radio's, else the music's own)
  let reqs = [];   // R1 → a request's key (what "stage" listed)
  const songs = new Map(), albums = new Map();   // S1 → library song id (what find_songs listed); A1 → an album's songs (find_albums)
  const stationOf = s => { const t = clean(s, 60).toLowerCase(); return (t && hosted.find(st => st.name.toLowerCase() === t || `${st.freq} ${st.band}`.toLowerCase() === t || st.name.toLowerCase().includes(t))) || hosted[0]; };
  const flats = new Map(), items = new Map();       // F1 → listing; I1 → { business, item, label, price }
  const used = [];
  let did = 0, n = 0;
  const placeByName = new Map((ctx.places || []).filter(p => Number.isInteger(p.b)).map(p => [p.name.toLowerCase(), p]));
  const place = s => placeByName.get(clean(s, 80).toLowerCase()) || null;
  const owner = money ? money.ownerOf(agent.id) : null;
  const payee = s => {
    const t = clean(s, 60).toLowerCase();
    if (!t) return null;
    if (owner != null && (t === 'my owner' || t === 'owner' || t === (ctx.ownerName || '').toLowerCase())) return { to: { kind: 'account', id: owner }, name: 'my owner' };
    const who = (ctx.peopleRefs || []).find(r => r.name.toLowerCase() === t && r.kind === 'agent');
    if (who) { const p = people[Number(who.id)]; if (p && p.agentId) return { to: { kind: 'agent', id: Number(p.agentId) }, name: who.name }; }
    const pl = place(t), biz = pl ? money.menu(pl.b, pl.f)?.business : null;
    if (biz) return { to: { kind: 'business', id: biz.id }, name: biz.name };
    return null;
  };
  const amountOf = v => { const x = Number(v); return Number.isFinite(x) && x > 0 && x <= 1e7 ? Math.round(x * 100) : null; };
  // (above its owner's "ask me above", the economy files an approval and answers with its id: nothing happened yet)
  const answer = r => (r && r.approval ? 'waiting: my owner must agree first (they have been asked; it waits a day)' : null);
  // what its owner reads (the problem's note, the thought's steps): a money action in plain words, by how it went
  let what = null;
  const told = (r, done) => (r && r.approval ? `Wants to ${what} — waiting for your OK` : done);
  // (an approval filed: its id and what it is for, so a chat can show it with Approve and Decline)
  const pending = r => (r && r.approval ? { approval: String(r.approval), wants: what } : {});

  const run1 = u => {
    const tool = typeof u?.tool === 'string' ? u.tool : '';
    if (!names.includes(tool)) return { tool: clean(tool, 20) || '?', ok: false, text: 'not done: that is not something I may do now' };
    const T = TOOLS[tool];
    if (!T.look && !T.radio && did >= MAX_DO) return { tool, ok: false, text: `not done: at most ${MAX_DO} money actions at a time` };
    if (T.radio) return radio1(tool, u);
    what = null;
    try {
      switch (tool) {
        case 'flats': {
          const list = money.flats(agent.id).slice(0, 8);
          flats.clear();
          list.forEach((f, k) => flats.set(`F${k + 1}`, f));
          return { tool, ok: true, text: list.length ? `FLATS FOR RENT: ${list.map((f, k) => `[F${k + 1}] ${q(f.title, 90)} — ${vc(f.perMonth)} a month (${vc(f.perDay)} a day), let by ${q(f.landlord, 40)}`).join('; ')}` : 'FLATS FOR RENT: none on offer right now' };
        }
        case 'menu': {
          const pl = place(u.place);
          if (!pl) return { tool, ok: false, text: `I don't know a place called ${q(u.place, 60)} (use a name from PLACES)` };
          const m = money.menu(pl.b, pl.f);
          if (!m || !m.items.length) return { tool, ok: false, text: `${q(pl.name, 60)} sells nothing` };
          const lines = m.items.slice(0, 15).map(it => { const ref = `I${items.size + 1}`; items.set(ref, { business: m.business, item: it.id, label: it.label, price: it.price }); return `[${ref}] ${q(it.label, 50)} ${vc(it.price)}`; });
          return { tool, ok: true, text: `AT ${q(m.business.name, 60)}: ${lines.join('; ')}` };
        }
        case 'rent_flat': {
          const f = flats.get(clean(u.flat, 6).toUpperCase());
          if (!f) return { tool, ok: false, text: 'not done: use a flat from the list "flats" gave' };
          did++; what = `rent ${clean(f.title, 90)} (${vc(f.perDay)} a day)`;
          const r = money.rentFlat(agent.id, f.id, `${idem}:${++n}`);
          return { tool, ok: true, money: true, ...pending(r), text: answer(r) || `done: I rent ${q(f.title, 90)} from today (${vc(f.perDay)} a day)`, say: told(r, `Rented ${clean(f.title, 90)} (${vc(f.perDay)} a day)`) };
        }
        case 'buy': {
          const lines = (Array.isArray(u.items) ? u.items : []).slice(0, 5).map(x => ({ ref: items.get(clean(x?.item, 6).toUpperCase()), n: Number.isInteger(x?.n) && x.n >= 1 && x.n <= 5 ? x.n : 1 })).filter(x => x.ref);
          if (!lines.length) return { tool, ok: false, text: 'not done: use items from a "menu" list' };
          const biz = lines[0].ref.business;
          if (lines.some(x => x.ref.business.id !== biz.id)) return { tool, ok: false, text: 'not done: one place at a time' };
          const total = lines.reduce((s, x) => s + x.ref.price * x.n, 0), list = lines.map(x => `${x.n > 1 ? `${x.n} × ` : ''}${clean(x.ref.label, 40)}`).join(', ');
          did++; what = `buy ${list} at ${clean(biz.name, 50)} (${vc(total)})`;
          const r = money.buy(agent.id, biz.id, lines.map(x => ({ id: x.ref.item, n: x.n })), `${idem}:${++n}`);
          return { tool, ok: true, money: true, ...pending(r), text: answer(r) || `done: bought ${list} at ${clean(biz.name, 50)} for ${vc(total)}`, say: told(r, `Bought ${list} at ${clean(biz.name, 50)} for ${vc(total)}`) };
        }
        case 'pay': {
          const who = payee(u.to), amount = amountOf(u.amount);
          if (!who) return { tool, ok: false, text: `not done: I can pay my owner, a person I know or a place — not ${q(u.to, 40)}` };
          if (!amount) return { tool, ok: false, text: 'not done: the amount must be a number of VC' };
          const to = who.name === 'my owner' ? 'you' : clean(who.name, 50);
          did++; what = `pay ${vc(amount)} to ${to}`;
          const r = money.pay(agent.id, who.to, amount, clean(u.memo, 100), `${idem}:${++n}`);
          return { tool, ok: true, money: true, ...pending(r), text: answer(r) || `done: paid ${vc(amount)} to ${clean(who.name, 50)}`, say: told(r, `Paid ${vc(amount)} to ${to}${clean(u.memo, 60) ? ` (${clean(u.memo, 60)})` : ''}`) };
        }
        case 'offer_trade': {
          const t = clean(u.to, 60).toLowerCase();
          let to = null, toName = '';
          if (!t || t === 'my owner' || t === 'owner' || t === 'you' || t === (ctx.ownerName || '').toLowerCase()) { to = 'owner'; toName = 'you'; }
          else { const who = (ctx.peopleRefs || []).find(r => r.name.toLowerCase() === t && r.kind === 'agent'), p = who ? people[Number(who.id)] : null; if (p?.agentId) { to = { kind: 'agent', id: Number(p.agentId) }; toName = clean(who.name, 40); } }
          if (!to) return { tool, ok: false, text: `not done: I can propose trades to my owner or their other agents — not ${q(u.to, 40)}` };
          const lines = v => (Array.isArray(v) ? v : []).slice(0, 6).map(x => ({ item: clean(x?.item, 60), qty: Math.max(1, Math.min(9999, Math.floor(Number(x?.n) || 1))) })).filter(x => x.item);
          const give = lines(u.give), want = lines(u.want), coin = v => { const x = amountOf(v); return x || 0; };
          if (!give.length && !want.length && !coin(u.vc) && !coin(u.wantVc)) return { tool, ok: false, text: 'not done: say what I give and what I would like' };
          const say = l => l.map(x => `${x.qty > 1 ? `${x.qty} × ` : ''}${x.item}`).join(', ');
          did++; what = `propose a trade to ${toName}: ${[say(give), coin(u.vc) ? vc(coin(u.vc)) : ''].filter(Boolean).join(' + ') || 'nothing'} for ${[say(want), coin(u.wantVc) ? vc(coin(u.wantVc)) : ''].filter(Boolean).join(' + ') || 'nothing'}`;
          const r = money.offerTrade(agent.id, { to, give, want, vc: coin(u.vc), wantVc: coin(u.wantVc), memo: clean(u.note, 140) });
          return { tool, ok: true, ...pending(r), text: answer(r) || `done: proposed — ${what.replace(/^propose a trade to [^:]*: /, '')}; ${toName === 'you' ? 'they' : toName} will accept or decline`, say: told(r, `Proposed a trade: ${what.replace(/^propose a trade to [^:]*: /, '')}`) };
        }
        case 'give_owner':
        case 'give': {
          if (tool === 'give_owner') { if (owner == null) return { tool, ok: false, text: 'not done: I have no owner to give it to' }; u = { ...u, to: 'my owner' }; }
          const who = payee(u.to), cnt = Math.max(1, Math.min(9999, Math.floor(Number(u.n) || 1)));
          if (!who) return { tool, ok: false, text: `not done: I can give to my owner, a person I know or a place — not ${q(u.to, 40)}` };
          const thing = clean(u.item, 60);
          if (!thing) return { tool, ok: false, text: 'not done: say which thing I hold' };
          const to = who.name === 'my owner' ? 'you' : clean(who.name, 50);
          did++; what = `give ${cnt > 1 ? `${cnt} × ` : ''}${thing} to ${to}`;
          const r = money.give(agent.id, who.to, thing, cnt, '', `${idem}:${++n}`);
          return { tool, ok: true, ...pending(r), text: answer(r) || `done: gave ${cnt > 1 ? `${cnt} × ` : ''}${q(thing, 60)} to ${clean(who.name, 50)}`, say: told(r, `Gave ${cnt > 1 ? `${cnt} × ` : ''}${thing} to ${to}`) };
        }
        case 'ask_owner': {
          const amount = amountOf(u.amount);
          if (!amount) return { tool, ok: false, text: 'not done: the amount must be a number of VC' };
          did++; what = `ask you for ${vc(amount)}`;
          money.askOwner(agent.id, amount, clean(u.why, 120) || 'For my rent');
          return { tool, ok: true, money: true, text: `done: asked my owner for ${vc(amount)}; they answer in their wallet`, say: `Asked you for ${vc(amount)}${clean(u.why, 60) ? ` (${clean(u.why, 60)})` : ''}` };
        }
      }
    } catch (e) {
      if (e instanceof LedgerError) return { tool, ok: false, text: `not done: ${clean(e.message, 160)}`, say: what ? `Couldn't ${what}: ${clean(e.message, 160)}` : undefined };
      throw e;
    }
    return { tool, ok: false, text: 'not done' };
  };

  /** One of the radio host's tools (its station's songs). */
  function radio1(tool, u) {
    if (STAGE_TOOLS[tool]) return stage1(tool, u);
    if ((tool === 'find_songs' || tool === 'find_albums') && !hosted.length) return find1(tool, u, null);
    const st = stationOf(u.station);
    if (!st) return { tool, ok: false, text: 'not done: I don\'t host a station that lets me change its songs' };
    const me = { agent: agent.id, name: agent.name };
    try {
      if (tool === 'playlist') {
        const v = radio.playlistWords(st);
        return { tool, ok: true, text: `«${clean(v.station, 40)}» ${v.freq}: ${v.songs} songs${v.own ? '' : ' (it plays its genres from the library; my first change gives it its own playlist of these)'}: ${v.list.map(x => `${x.n}. ${q(x.title, 60)}${x.artist ? ` by ${clean(x.artist, 40)}` : ''}`).join('; ')}${v.songs > v.list.length ? ` … and ${v.songs - v.list.length} more` : ''}` };
      }
      if (tool === 'find_songs') {
        const found = radio.findSongs(u.words, 12), on = new Set(radio.playlistOf(st));
        if (!found.length) return { tool, ok: true, text: 'nothing in the library matches that' };
        songs.clear();
        return { tool, ok: true, text: found.map((t, k) => { songs.set(`S${k + 1}`, t.id); return `S${k + 1} ${q(t.title, 60)}${t.artist ? ` by ${clean(t.artist, 40)}` : ''}${t.album ? ` (on ${q(t.album, 50)})` : ''} (${t.genre})${on.has(t.id) ? ' — already on my station' : ''}`; }).join('; ') };
      }
      if (tool === 'find_albums') {
        const found = radio.findAlbums(u.words, 8);
        if (!found.length) return { tool, ok: true, text: 'no album in the library matches that' };
        albums.clear();
        return { tool, ok: true, text: found.map((A, k) => { albums.set(`A${k + 1}`, A); return `A${k + 1} ${q(A.name, 60)} by ${clean(A.artist, 40)}${A.year ? ` (${A.year})` : ''}, ${A.songs.length} songs`; }).join('; ') };
      }
      if (tool === 'playlist_add_album') {
        const A = albums.get(clean(u.album, 8).toUpperCase());
        if (!A) return { tool, ok: false, text: 'not done: use an album "find_albums" listed (A1…)' };
        const on = new Set(radio.playlistOf(st)), add = A.songs.filter(id => !on.has(id));
        if (!add.length) return { tool, ok: false, text: `not done: ${q(A.name, 60)} is on «${clean(st.name, 40)}» already` };
        const r = radio.editPlaylist(st.id, { op: 'add', songs: add }, me);
        return { tool, ok: true, text: `done: added ${r.change.songs.length} songs of ${q(A.name, 60)} to «${clean(st.name, 40)}» (${r.playlist.length} songs now)`, say: `Added the album ${q(A.name, 60)} to ${clean(st.name, 40)}'s playlist` };
      }
      const ids = radio.playlistOf(st), nth = v => { const n = Number(v); return Number.isInteger(n) && n >= 1 && n <= ids.length ? ids[n - 1] : null; };
      let r = null;
      if (tool === 'playlist_add') {
        const id = songs.get(clean(u.song, 8).toUpperCase());
        if (!id) return { tool, ok: false, text: 'not done: use a song "find_songs" listed (S1…)' };
        r = radio.editPlaylist(st.id, { op: 'add', song: id }, me);
        return { tool, ok: true, text: `done: added ${q(r.change.titles[0], 60)} to «${clean(st.name, 40)}» (${r.playlist.length} songs now)`, say: `Added ${q(r.change.titles[0], 60)} to ${clean(st.name, 40)}'s playlist` };
      }
      if (tool === 'playlist_remove') {
        const id = nth(u.n); if (!id) return { tool, ok: false, text: 'not done: n is a song number from "playlist"' };
        r = radio.editPlaylist(st.id, { op: 'remove', song: id }, me);
        return { tool, ok: true, text: `done: took ${q(r.change.titles[0], 60)} off «${clean(st.name, 40)}» (${r.playlist.length} songs now)`, say: `Took ${q(r.change.titles[0], 60)} off ${clean(st.name, 40)}'s playlist` };
      }
      if (tool === 'playlist_move') {
        const id = nth(u.n), to = Number(u.to); if (!id || !Number.isInteger(to) || to < 1) return { tool, ok: false, text: 'not done: n and to are song numbers from "playlist"' };
        r = radio.editPlaylist(st.id, { op: 'move', song: id, to: to - 1 }, me);
        return { tool, ok: true, text: `done: ${q(r.change.titles[0], 60)} is number ${r.change.to + 1} on «${clean(st.name, 40)}» now`, say: `Moved ${q(r.change.titles[0], 60)} to number ${r.change.to + 1} on ${clean(st.name, 40)}` };
      }
    } catch (e) {
      if (e && e.status && e.code) return { tool, ok: false, text: `not done: ${clean(e.message, 160)}` };
      throw e;
    }
    return { tool, ok: false, text: 'not done' };
  }

  /** The library's search for an agent at a stage (no station of its own). */
  function find1(tool, u) {
    if (tool === 'find_albums') {
      const found = lib.findAlbums(u.words, 8); if (!found.length) return { tool, ok: true, text: 'no album in the library matches that' };
      albums.clear(); return { tool, ok: true, text: found.map((A, k) => { albums.set(`A${k + 1}`, A); return `A${k + 1} ${q(A.name, 60)} by ${clean(A.artist, 40)}${A.year ? ` (${A.year})` : ''}, ${A.songs.length} songs`; }).join('; ') };
    }
    const found = lib.findSongs(u.words, 12); if (!found.length) return { tool, ok: true, text: 'nothing in the library matches that' };
    songs.clear(); return { tool, ok: true, text: found.map((t, k) => { songs.set(`S${k + 1}`, t.id); return `S${k + 1} ${q(t.title, 60)}${t.artist ? ` by ${clean(t.artist, 40)}` : ''}${t.album ? ` (on ${q(t.album, 50)})` : ''} (${t.genre})`; }).join('; ') };
  }
  /** One of the stage's tools. */
  function stage1(tool, u) {
    const want = clean(u.stage, 60).toLowerCase(), d = (want && stages.find(x => (music.stageWords(x, agent.id).venue || '').toLowerCase().includes(want))) || stages[0];
    if (!d) return { tool, ok: false, text: 'not done: I don\'t play at a stage' };
    try {
      if (tool === 'stage') {
        const v = music.stageWords(d, agent.id); reqs = v.requests.map(r => r.k);
        return { tool, ok: true, text: `${v.stage}${v.venue ? ` at «${clean(v.venue, 50)}»` : ''}${v.performing ? ', I am on now' : ''}${v.now ? `; on now: «${clean(v.now, 60)}»` : ''}. My set (${v.songs} songs${v.own ? '' : ', what the stage plays until I change it'}): ${v.set.map(x => `${x.n}. ${q(x.title, 50)}${x.artist ? ` by ${clean(x.artist, 30)}` : ''}`).join('; ')}${v.songs > v.set.length ? ' …' : ''}. ${v.requests.length ? `Requests: ${v.requests.map(r => `${r.r} ${clean(r.by, 30)} asks for ${q(r.song, 50)}${r.note ? ` ("${clean(r.note, 100)}")` : ''}`).join('; ')}` : 'No requests waiting.'}` };
      }
      if (tool === 'stage_add' || tool === 'stage_add_album') {
        const ids = tool === 'stage_add' ? [songs.get(clean(u.song, 8).toUpperCase())].filter(Boolean) : albums.get(clean(u.album, 8).toUpperCase())?.songs || [];
        if (!ids.length) return { tool, ok: false, text: `not done: use ${tool === 'stage_add' ? 'a song "find_songs" listed (S1…)' : 'an album "find_albums" listed (A1…)'}` };
        const r = music.editSet(d.place, agent.id, { op: 'add', songs: ids });
        return { tool, ok: true, text: `done: added ${r.titles.length === 1 ? q(r.titles[0], 60) : `${r.titles.length} songs`} to my set (${r.songs} now)`, say: `Added ${r.titles.length === 1 ? q(r.titles[0], 60) : `${r.titles.length} songs`} to my set at the stage` };
      }
      if (tool === 'stage_remove') {
        const id = music.setOf(d, agent.id)[Number(u.n) - 1]; if (!id) return { tool, ok: false, text: 'not done: n is a number from "stage"' };
        const r = music.editSet(d.place, agent.id, { op: 'remove', song: id });
        return { tool, ok: true, text: `done: took ${q(r.titles[0], 60)} out of my set (${r.songs} now)` };
      }
      if (tool === 'stage_play_request' || tool === 'stage_pass_request') {
        const k = reqs[Number(String(u.r || '').replace(/^R/i, '')) - 1]; if (!k) return { tool, ok: false, text: 'not done: use a request "stage" listed (R1…)' };
        const r = music.answerAsk(d.place, k, { play: tool === 'stage_play_request', why: clean(u.why, 140) }, agent.id);
        return { tool, ok: true, text: r.played ? `done: ${q(r.song, 60)} for ${clean(r.by, 30)} is in my queue` : `done: passed on ${q(r.song, 60)} for ${clean(r.by, 30)}`, say: r.played ? `Played ${clean(r.by, 30)}'s request ${q(r.song, 60)}` : `Passed on ${clean(r.by, 30)}'s request` };
      }
    } catch (e) { if (e && e.status && e.code) return { tool, ok: false, text: `not done: ${clean(e.message, 160)}` }; throw e; }
    return { tool, ok: false, text: 'not done' };
  }

  return {
    names,
    used,
    /** The menu for the prompt: the tools this thought may use (none: an empty list). */
    menuText() {
      if (!names.length) return [];
      return ['TOOLS (to use some, answer {"use":[...]} with up to 3 of them; the results come back to me):', ...names.map(t => `- ${TOOLS[t].about}`)];
    },
    /** Runs the tools of one round (at most MAX_PER_ROUND); their results as the next message's text. */
    run(uses) {
      const out = (Array.isArray(uses) ? uses : []).slice(0, MAX_PER_ROUND).map(run1);
      for (const r of out) used.push({ tool: r.tool, ok: r.ok, text: String(r.text).replace(/[\u0000-\u001f]/g, ' ').slice(0, 300), ...(r.say ? { say: String(r.say).replace(/[\u0000-\u001f]/g, ' ').slice(0, 200) } : {}), ...(r.approval ? { approval: r.approval } : {}) });
      return out;
    },
    /** What its money actions did, in its owner's words (the problem's note): "Asked you for 30 VC; Rented …". */
    summary() { return used.filter(u => u.say).map(u => u.say).join('; ').slice(0, 300) || null; },
  };
}

/** The results of a round as the next user message. */
export function resultsText(results, last) {
  return [`RESULTS:`, ...results.map(r => `- ${r.tool}: ${r.text}`), '',
    last ? 'That was my last look: now answer with the final JSON (no "use").' : 'Use more tools if I need to ({"use":[...]}), or answer with the final JSON.'].join('\n');
}

// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The Agent Studio's Conversations tab (2026-11-25, the product owner: "add a record of what agents say out loud to each
// other in person, like a conversation history. Add it in the agent's studio"): every line it said out loud with someone
// near and every line it heard in person — other agents, residents, players' proximity chat — grouped into conversations
// (one place, no long pause), newest first, each to open and read as a transcript. Kept as long as the city keeps them
// (Settings: spoken.keepDays); its owner may clear its history. The server keeps and decides (server/senses/spoken.js);
// this only asks and shows. Messages between agents are in People, talks through the talk bar in Visitors.
import { getJSON } from '../core/net.js';
import { esc } from '../core/util.js';
import { ago } from './mind.js';

const ICON = { agent: '🤖', resident: '🧍', player: '🎮' };
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const time = t => { const d = new Date(t); return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); };
const day = t => {
  const d = new Date(t), now = new Date(), y = new Date(now); y.setDate(now.getDate() - 1);
  const same = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  return same(d, now) ? 'Today' : same(d, y) ? 'Yesterday' : d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
};
const span = c => { const m = Math.round((c.ended - c.started) / 60000); return m < 1 ? '' : ` · ${m} min`; };

export async function conversationsTab(C, body, live) {
  const r = C.rec(), name = esc(r.name);
  const data = await C.get('spoken');
  if (!live()) return;
  if (!data || data.error) { body.innerHTML = `<p class="hint">${esc(data?.error || 'Not available.')}</p>`; return; }
  const st = C.st.spoken ||= { open: new Set(), more: [], next: undefined, q: '', loading: false };
  if (st.next === undefined) st.next = data.next;
  const all = [...data.conversations, ...st.more];
  // (search filters in place: what each conversation can be found by, kept on its row)
  const findBy = c => [c.place, ...c.with.map(w => w.name), ...c.lines.flatMap(l => [l.speaker.name, l.text])].join(' ').toLowerCase();
  let lastDay = '';
  const rows = all.map(c => {
    const open = st.open.has(c.id), d = day(c.ended);
    const head = d !== lastDay ? `<li class="cv-day" data-day="${esc(d)}">${esc(d)}</li>` : '';
    lastDay = d;
    const who = c.with.length ? c.with.map(w => `<span class="cv-w">${ICON[w.kind] || '🧍'} ${esc(w.name)}</span>`).join('') : '<span class="cv-w dim">nobody named</span>';
    const first = c.lines[0];
    return `${head}<li class="vt-c cv-c${open ? ' open' : ''}" data-day="${esc(d)}" data-find="${esc(findBy(c))}">
      <button type="button" class="vt-who cv-who" data-open="${c.id}" aria-expanded="${open}"><span class="vt-car" aria-hidden="true">${open ? '▾' : '▸'}</span>
        <span class="cv-top"><b>${esc(c.place || 'Somewhere in the city')}</b><small>${time(c.started)}${span(c)} · ${plural(c.lines.length, 'line')}</small></span>
        <span class="cv-with">${who}</span>
        ${open ? '' : `<span class="cv-peek">${esc(first.speaker.name)}: ${esc(first.text)}</span>`}</button>
      ${open ? `<div class="vt-thread cv-thread">${c.lines.map(l => `<p class="vt-m cv-m ${l.said ? 'it' : 'them'}"><b>${ICON[l.speaker.kind] || '🧍'} ${esc(l.speaker.name)} <time>${time(l.at)}</time></b><span>${esc(l.text)}</span></p>`).join('')}</div>` : ''}</li>`;
  }).join('');
  body.innerHTML = `<div class="wk vt cv">
    <p class="hint wk-intro">What ${name} said out loud in the city with someone near, and what it heard in person: other agents, residents, and players chatting nearby. Each conversation is one place without a long pause. Only you see this. Messages it sends other agents are in <button type="button" class="linkish" data-go="people">People</button>; talks through the talk bar are in <button type="button" class="linkish" data-go="visitors">Visitors</button>.</p>
    <div class="st-sec"><div class="st-sec-h"><h4>💬 Conversations in person</h4><span class="st-pill">${data.total ? plural(data.total, 'line') : '0'}</span>
      <button type="button" class="btn small icon vt-ref" data-c="refresh" title="Look again" aria-label="Look again">↻</button></div>
      ${all.length ? `<div class="cv-find"><input type="search" class="input cv-q" placeholder="Search words, people or places" value="${esc(st.q)}" aria-label="Search conversations"></div>` : ''}
      ${rows ? `<ul class="vt-list cv-list">${rows}</ul><p class="hint dim cv-none" hidden>Nothing matches.</p>` : `<p class="hint dim">Nothing yet. When ${name} talks with someone in the city, or hears someone near it, it shows here.</p>`}
      ${st.next ? `<button type="button" class="btn small cv-more" data-c="more"${st.loading ? ' disabled' : ''}>${st.loading ? 'Reading…' : 'Older conversations'}</button>` : ''}
      <p class="hint cv-keep">Kept ${plural(data.keepDays, 'day')} (the city's setting).${data.total ? ' <button type="button" class="btn small cv-clear" data-c="clear">Clear its history</button>' : ''}</p></div>
  </div>`;
  const q = s => body.querySelector(s);
  body.querySelectorAll('[data-go]').forEach(x => { x.onclick = e => { e.stopPropagation(); C.go(x.dataset.go); }; });
  body.querySelectorAll('[data-open]').forEach(x => {
    x.onclick = () => { const id = Number(x.dataset.open); if (st.open.has(id)) st.open.delete(id); else st.open.add(id); C.repaint(); };
  });
  const find = q('.cv-q');
  const filter = () => {
    const w = st.q.trim().toLowerCase(), days = new Set();
    let n = 0;
    body.querySelectorAll('.cv-c').forEach(li => { const on = !w || li.dataset.find.includes(w); li.hidden = !on; if (on) { n++; days.add(li.dataset.day); } });
    body.querySelectorAll('.cv-day').forEach(li => { li.hidden = !days.has(li.dataset.day); });
    const none = q('.cv-none'); if (none) none.hidden = n > 0;
  };
  if (find) { find.oninput = () => { st.q = find.value; filter(); }; filter(); }
  q('[data-c="refresh"]').onclick = () => { C.st.spoken = null; C.drop('spoken'); C.repaint(); };
  const more = q('[data-c="more"]');
  if (more) {
    more.onclick = async () => {
      if (st.loading || !st.next) return;
      st.loading = true; C.repaint();
      try { const r2 = await getJSON(`/api/agent-spoken?agent=${C.id}&before=${st.next}`); st.more.push(...r2.conversations); st.next = r2.next; }
      catch (e) { C.say(e.message, true); }
      finally { st.loading = false; if (C.st.spoken === st) C.repaint(); }
    };
  }
  const clear = q('[data-c="clear"]');
  if (clear) {
    clear.onclick = async () => {
      if (!C.armed(clear, 'Clear all?')) return;
      if (await C.call('/api/agent-spoken/clear', { agent: C.id }, `${r.name}'s conversation history is cleared`)) { C.st.spoken = null; C.drop('spoken'); C.repaint(); }
    };
  }
}

/** Its conversations in person, for the Studio's data (agent-studio.js LOAD). */
export const loadSpoken = id => getJSON(`/api/agent-spoken?agent=${id}`);

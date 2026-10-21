// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The PC's Board and Calendar (client/js/ui/pc-app.js). The board: the agent's own or one of its teams' — To do, Doing,
// Review, Done; a task added at the top of To do (given to someone, with a due date); dragged between columns (or moved
// with its buttons, on a phone); opened beside the board to change it, read and add notes, give it to someone, and
// "Work on it" — the agent then works on it by itself (server/pc/work.js), and the card shows how far it is. The calendar:
// the week (an agenda on a phone) across the agent's calendar and its teams', events added, moved and deleted.
import { esc } from '../core/util.js';
import { when } from './pc-ui.js';

const COLS = [['todo', 'To do'], ['doing', 'Doing'], ['review', 'Review'], ['done', 'Done']];
const DAY = 86400000;
const workChip = w => (!w ? '' : w.state === 'queued' ? '<span class="pc-chip">⏳ waiting to start</span>'
  : w.state === 'working' ? `<span class="pc-chip good">⚡ working · step ${(w.steps || 0) + 1}</span>`
  : w.state === 'done' ? '<span class="pc-chip good">✓ worked on</span>' : w.state === 'blocked' ? '<span class="pc-chip gold">⚠ stuck</span>'
  : w.state === 'failed' ? '<span class="pc-chip bad">✕ couldn\'t</span>' : '');
const localInput = t => { if (!t) return ''; const d = new Date(t); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };

/** The boards this agent reaches: its own, then its teams'. */
const boardsOf = P => [{ key: '~', label: 'My board' }, ...P.teams.filter(t => t.members.some(m => m.agent === P.agent)).map(t => ({ key: `/teams/${t.slug}`, label: t.name, team: t }))];

export function boardApp(P, el, args = {}) {
  const B = { at: args.board || '~', data: null, open: args.card || null, err: null, adding: false, seq: 0, mark: args.mark ?? null };
  async function load() {
    const my = ++B.seq;
    try { const r = await P.get('board', { path: B.at }); if (my === B.seq) { B.data = r; B.err = null; } } catch (e) { if (my === B.seq) B.err = e.message; }
    paint();
  }
  const card = id => B.data?.cards.find(k => k.id === Number(id));
  const people = () => {
    const b = boardsOf(P).find(x => x.key === B.at);
    if (b?.team) return b.team.members.filter(m => m.role !== 'viewer').map(m => ({ id: m.agent, name: P.name(m.agent) }));
    return [{ id: P.agent, name: P.me()?.name || 'This agent' }];
  };
  async function change(id, patch, ok) { try { await P.post('cards/update', { id, ...patch }); if (ok) P.toast(ok, 'good'); } catch (e) { P.err(e); } load(); }
  async function add(form) {
    const title = form.title.value.trim();
    if (!title) return;
    const due = form.due.value ? new Date(form.due.value).getTime() : null;
    try { await P.post('cards', { profile: P.agent, path: B.at, title, assignee: form.who.value ? Number(form.who.value) : null, due }); form.reset(); } catch (e) { P.err(e); }
    load();
  }
  function cardHtml(k) {
    return `<div class="pc-card${B.mark != null && k.id === B.mark ? ' pc-mark' : ''}" draggable="true" data-card="${k.id}"><b>${esc(k.title)}</b><div class="pc-cm"><span>#${k.id}</span>
      ${k.assignee != null ? `<span>👤 ${esc(P.name(k.assignee))}</span>` : ''}${k.due ? `<span class="${k.due < Date.now() && k.col !== 'done' ? 'bad' : ''}">⏰ ${when(k.due)}</span>` : ''}${workChip(k.work)}</div></div>`;
  }
  function drawerHtml(k) {
    const ro = B.data.access === 'r';
    const ppl = people();
    return `<aside class="pc-drawer"><div style="display:flex;gap:8px;align-items:center"><h3 style="flex:1">#${k.id}</h3><button class="pc-x" data-shut="1" title="Close">✕</button></div>
      <input class="pc-ktitle" value="${esc(k.title)}" ${ro ? 'readonly' : ''}>
      <div class="pc-moves">${COLS.map(([c, n]) => `<button class="pc-btn ${k.col === c ? 'primary' : ''}" data-col="${c}" ${ro ? 'disabled' : ''}>${n}</button>`).join('')}</div>
      <div class="pc-row2"><label class="dim">Given to<select class="pc-kwho" ${ro ? 'disabled' : ''}><option value="">No one</option>${ppl.map(p => `<option value="${p.id}" ${k.assignee === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
        <label class="dim">Due<input type="datetime-local" class="pc-kdue" value="${localInput(k.due)}" ${ro ? 'readonly' : ''}></label></div>
      ${k.assignee != null && k.col !== 'done' && !ro ? `<div style="display:flex;gap:6px;align-items:center">${k.work && (k.work.state === 'working' || k.work.state === 'queued')
        ? `<button class="pc-btn" data-stop="1">⏹ Stop</button>${workChip(k.work)}` : `<button class="pc-btn primary" data-work="1">▶ Work on it</button><span class="dim">${esc(P.name(k.assignee))} works on it by itself</span>`}</div>` : ''}
      ${k.work?.summary ? `<div class="pc-note">${esc(k.work.summary)}</div>` : ''}${k.work?.error ? `<div class="pc-err">${esc(k.work.error)}</div>` : ''}
      <label class="dim">Notes<div class="pc-notes">${k.notes ? esc(k.notes) : '<span class="dim">No notes yet</span>'}</div></label>
      ${ro ? '' : '<form class="pc-add pc-noteform"><input name="note" placeholder="Add a note" maxlength="1000"><button class="pc-btn">Add</button></form>'}
      <span class="dim">Made by ${esc(k.by?.startsWith('a:') ? P.name(k.by.slice(2)) : 'you')} · ${when(k.created)}${k.done ? ` · done ${when(k.done)}` : ''}</span>
      ${ro ? '' : '<button class="pc-btn danger" data-del="1">🗑 Delete the task</button>'}</aside>`;
  }
  function paint() {
    if (!P.alive) return;
    const boards = boardsOf(P), d = B.data, ro = d?.access === 'r', ppl = people();
    const k = B.open ? card(B.open) : null;
    el.innerHTML = `<div class="pc-main"><div class="pc-tools"><select class="pc-which">${boards.map(b => `<option value="${esc(b.key)}" ${b.key === B.at ? 'selected' : ''}>${esc(b.label)}</option>`).join('')}</select>
      <span class="pc-grow dim">${ro ? 'Read only: this agent only views this team' : 'Drag a task to move it, or open it'}</span></div>
      ${B.err ? `<div class="pc-err">${esc(B.err)}</div>` : ''}
      <div class="pc-split"><div class="pc-board">${d ? COLS.map(([c, n]) => {
        const ks = d.cards.filter(x => x.col === c);
        return `<div class="pc-col" data-drop="${c}"><h5><span>${n}</span><span>${ks.length || ''}</span></h5>
          ${c === 'todo' && !ro ? `<form class="pc-form pc-addform"><input name="title" placeholder="Add a task…" maxlength="200">
            <div class="pc-row2"><select name="who"><option value="">No one</option>${ppl.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select><input name="due" type="datetime-local" title="Due"></div></form>` : ''}
          ${(c === 'done' ? ks.slice(-30) : ks).map(cardHtml).join('')}</div>`;
      }).join('') : '<div class="pc-empty">Opening…</div>'}</div>${k ? drawerHtml(k) : ''}</div></div>`;
  }
  el.addEventListener('change', e => {
    if (e.target.classList.contains('pc-which')) { B.at = e.target.value; B.open = null; load(); }
    if (e.target.classList.contains('pc-kwho')) change(B.open, { assignee: e.target.value ? Number(e.target.value) : null });
    if (e.target.classList.contains('pc-kdue')) change(B.open, { due: e.target.value ? new Date(e.target.value).getTime() : null });
    if (e.target.classList.contains('pc-ktitle') && e.target.value.trim()) change(B.open, { title: e.target.value.trim() });
  });
  el.addEventListener('submit', e => {
    e.preventDefault();
    if (e.target.classList.contains('pc-addform')) add(e.target);
    if (e.target.classList.contains('pc-noteform') && e.target.note.value.trim()) change(B.open, { addNote: e.target.note.value.trim() });
  });
  el.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.closest('.pc-addform') && e.target.name !== 'title') { e.preventDefault(); add(e.target.closest('form')); } });
  el.addEventListener('click', async e => {
    const c = e.target.closest('[data-card]');
    if (c && !e.target.closest('button')) { B.open = Number(c.dataset.card); return paint(); }
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.shut) { B.open = null; return paint(); }
    if (b.dataset.col) return change(B.open, { col: b.dataset.col });
    if (b.dataset.work) { try { const r = await P.post('work', { card: B.open }); P.toast(r.already ? 'It is on it already' : 'It will start on it now', 'good'); } catch (err) { P.err(err); } return load(); }
    if (b.dataset.stop) { try { await P.post('work/stop', { card: B.open }); P.toast('It stops after the step it is on', 'good'); } catch (err) { P.err(err); } return load(); }
    if (b.dataset.del && confirm('Delete this task?')) { try { await P.post('cards/remove', { id: B.open }); B.open = null; } catch (err) { P.err(err); } return load(); }
  });
  // dragging between columns
  let dragId = null;
  el.addEventListener('dragstart', e => { const c = e.target.closest?.('[data-card]'); if (!c) return; dragId = Number(c.dataset.card); c.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(dragId)); });
  el.addEventListener('dragend', () => { dragId = null; el.querySelectorAll('.dragging, .over').forEach(x => x.classList.remove('dragging', 'over')); });
  el.addEventListener('dragover', e => { const col = e.target.closest('[data-drop]'); if (!col || dragId == null || B.data?.access === 'r') return; e.preventDefault(); el.querySelectorAll('.over').forEach(x => x !== col && x.classList.remove('over')); col.classList.add('over'); });
  el.addEventListener('drop', e => { const col = e.target.closest('[data-drop]'); if (!col || dragId == null) return; e.preventDefault(); const k = card(dragId); if (k && k.col !== col.dataset.drop) change(k.id, { col: col.dataset.drop }); });
  let soon = null;
  load();
  return {
    // (a: a board, a task to open — or, following the agent, the task it just touched, marked)
    go(a) { if (a.board) B.at = a.board; if (a.card) B.open = a.card; B.mark = a.mark ?? null; load(); },
    onFrame(f) { if (f.kind === 'board' || f.kind === 'teams') { clearTimeout(soon); soon = setTimeout(load, 250); } },
    destroy() { clearTimeout(soon); },
  };
}

// ------------------------------------------------------------------------------------------- calendar
const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#06b6d4', '#a855f7', '#84cc16'];
const startOfWeek = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime(); };
const hm = t => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
/** A time for an <input type="time">: always 24-hour "HH:MM". */
const hhmm = t => { const d = new Date(t); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

export function calendarApp(P, el, args = {}) {
  const C = { week: startOfWeek(args.from || Date.now()), events: [], err: null, edit: null, seq: 0, mark: args.mark ?? null };
  const cals = () => [{ key: '~', label: 'My calendar', color: COLORS[0] }, ...boardsOf(P).slice(1).map((b, k) => ({ key: b.key, label: b.label, color: b.team.color || COLORS[(k + 1) % COLORS.length] }))];
  const colorOf = key => cals().find(c => c.key === key)?.color || COLORS[0];
  async function load() {
    const my = ++C.seq;
    try { const r = await P.get('events', { from: C.week - DAY, to: C.week + 8 * DAY }); if (my === C.seq) { C.events = r.events; C.err = null; } } catch (e) { if (my === C.seq) C.err = e.message; }
    paint();
  }
  const narrow = () => el.clientWidth < 620;
  function weekHtml() {
    const days = Array.from({ length: 7 }, (_, i) => C.week + i * DAY);
    const evs = C.events.filter(e => !e.allDay);
    let h0 = 8, h1 = 19;
    for (const e of evs) { h0 = Math.min(h0, new Date(e.start).getHours()); h1 = Math.max(h1, new Date(e.end).getHours() + 1); }
    h1 = Math.min(24, Math.max(h1, h0 + 6));
    const hours = Array.from({ length: h1 - h0 }, (_, i) => h0 + i), H = 44, today = new Date().toDateString();
    const allDay = C.events.filter(e => e.allDay);
    return `<div class="pc-week"><div class="pc-wh"></div>${days.map(d => `<div class="pc-wh ${new Date(d).toDateString() === today ? 'today' : ''}">${new Date(d).toLocaleDateString([], { weekday: 'short', day: 'numeric' })}</div>`).join('')}
      ${allDay.length ? `<div class="pc-wh dim" style="font-size:10.5px">all day</div><div class="pc-allday">${allDay.map(e => `<span class="pc-chip" data-ev="${e.id}" style="cursor:pointer;border-color:${colorOf(e.calendar)}">${esc(new Date(e.start).toLocaleDateString([], { weekday: 'short' }))} · ${esc(e.title)}</span>`).join('')}</div>` : ''}
      <div class="pc-hours">${hours.map(h => `<div>${String(h).padStart(2, '0')}:00</div>`).join('')}</div>
      ${days.map(d => `<div class="pc-day" data-day="${d}" data-h0="${h0}" style="height:${hours.length * H}px">${evs.filter(e => e.start < d + DAY && e.end > d).map(e => {
        const s = Math.max(e.start, d + h0 * 3600000), en = Math.min(e.end, d + h1 * 3600000);
        const top = ((s - d) / 3600000 - h0) * H, ht = Math.max(18, ((en - s) / 3600000) * H - 2);
        return `<div class="pc-ev${C.mark != null && e.id === C.mark ? ' pc-mark' : ''}" data-ev="${e.id}" style="top:${top}px;height:${ht}px;--ev:${colorOf(e.calendar)}" title="${esc(`${e.title} ${hm(e.start)}–${hm(e.end)}${e.place ? ` · ${e.place}` : ''}`)}"><b>${esc(e.title)}</b><br>${hm(e.start)}${e.place ? ` · ${esc(e.place)}` : ''}</div>`;
      }).join('')}</div>`).join('')}</div>`;
  }
  function agendaHtml() {
    const days = Array.from({ length: 7 }, (_, i) => C.week + i * DAY);
    return `<div class="pc-agenda">${days.map(d => { const evs = C.events.filter(e => e.start < d + DAY && e.end > d);
      return `<h5>${new Date(d).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })}</h5>${evs.length ? evs.map(e => `<div class="pc-ae" data-ev="${e.id}" style="--ev:${colorOf(e.calendar)}"><span>${e.allDay ? 'All day' : `${hm(e.start)}–${hm(e.end)}`}</span><span><b>${esc(e.title)}</b>${e.place ? ` · ${esc(e.place)}` : ''}</span></div>`).join('') : '<div class="dim" style="padding:2px 4px">—</div>'}`; }).join('')}</div>`;
  }
  function formHtml() {
    const e = C.edit, cs = cals();
    const day = new Date(e.start || Date.now()); const ymd = localInput(day.getTime()).slice(0, 10);
    return `<aside class="pc-drawer"><div style="display:flex;align-items:center"><h3 style="flex:1">${e.id ? 'The event' : 'A new event'}</h3><button class="pc-x" data-shut="1">✕</button></div>
      <form class="pc-form pc-evform"><label>Title<input name="title" value="${esc(e.title || '')}" maxlength="200" required></label>
        <label>Calendar<select name="cal" ${e.id ? 'disabled' : ''}>${cs.map(c => `<option value="${esc(c.key)}" ${c.key === (e.calendar || '~') ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}</select></label>
        <label>Day<input name="day" type="date" value="${ymd}" required></label>
        <label style="display:flex;gap:6px;align-items:center;color:var(--text)"><input name="all" type="checkbox" ${e.allDay ? 'checked' : ''} style="width:auto"> All day</label>
        <div class="pc-row2"><label>From<input name="from" type="time" value="${e.start && !e.allDay ? hhmm(e.start) : '09:00'}"></label><label>To<input name="to" type="time" value="${!e.allDay ? hhmm(e.end || (e.start ? e.start + 3600000 : 0)) || '10:00' : '10:00'}"></label></div>
        <label>Where<input name="place" value="${esc(e.place || '')}" maxlength="120"></label><label>Notes<textarea name="notes" rows="3">${esc(e.notes || '')}</textarea></label>
        <div style="display:flex;gap:6px"><button class="pc-btn primary">${e.id ? 'Save' : 'Add'}</button>${e.id ? '<button type="button" class="pc-btn danger" data-delev="1">🗑 Delete</button>' : ''}</div></form></aside>`;
  }
  function paint() {
    if (!P.alive) return;
    const end = C.week + 6 * DAY;
    el.innerHTML = `<div class="pc-main"><div class="pc-tools"><button class="pc-btn" data-wk="-1">◀</button><button class="pc-btn" data-wk="0">Today</button><button class="pc-btn" data-wk="1">▶</button>
      <b class="pc-grow">${new Date(C.week).toLocaleDateString([], { month: 'short', day: 'numeric' })} – ${new Date(end).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}</b>
      <button class="pc-btn primary" data-newev="1">➕ Event</button></div>${C.err ? `<div class="pc-err">${esc(C.err)}</div>` : ''}
      <div class="pc-split"><div class="pc-main">${narrow() ? agendaHtml() : weekHtml()}</div>${C.edit ? formHtml() : ''}</div></div>`;
  }
  async function saveEvent(f) {
    const [y, m, d] = f.day.value.split('-').map(Number);
    const at = (hhmm, base) => { const [h, mi] = (hhmm || '00:00').split(':').map(Number); return new Date(y, m - 1, d, h, mi).getTime() + (base || 0); };
    const all = f.all.checked;
    const start = all ? new Date(y, m - 1, d).getTime() : at(f.from.value);
    let end = all ? start + DAY : at(f.to.value);
    if (end <= start) end += DAY;
    const body = { title: f.title.value.trim(), start, end, allDay: all, place: f.place.value.trim(), notes: f.notes.value };
    try {
      if (C.edit.id) await P.post('events/update', { id: C.edit.id, ...body });
      else await P.post('events', { profile: P.agent, path: f.cal.value, ...body });
      C.edit = null;
    } catch (e) { P.err(e); }
    load();
  }
  el.addEventListener('click', async e => {
    const ev = e.target.closest('[data-ev]');
    if (ev) { C.edit = { ...C.events.find(x => x.id === Number(ev.dataset.ev)) }; return paint(); }
    const day = e.target.closest('.pc-day');
    if (day && !e.target.closest('.pc-ev')) {
      const r = day.getBoundingClientRect();
      const h = Math.max(0, Math.min(23, Math.floor(Number(day.dataset.h0) + (e.clientY - r.top) / 44)));
      C.edit = { start: Number(day.dataset.day) + h * 3600000, end: Number(day.dataset.day) + (h + 1) * 3600000, calendar: '~' };
      return paint();
    }
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.wk !== undefined) { const k = Number(b.dataset.wk); C.week = k ? C.week + k * 7 * DAY : startOfWeek(Date.now()); return load(); }
    if (b.dataset.newev) { C.edit = { start: Date.now() + 3600000 - (Date.now() % 3600000), calendar: '~' }; return paint(); }
    if (b.dataset.shut) { C.edit = null; return paint(); }
    if (b.dataset.delev && confirm('Delete this event?')) { try { await P.post('events/remove', { id: C.edit.id }); C.edit = null; } catch (err) { P.err(err); } load(); }
  });
  el.addEventListener('submit', e => { if (e.target.classList.contains('pc-evform')) { e.preventDefault(); saveEvent(e.target); } });
  let soon = null;
  const ro = new ResizeObserver(() => { if (!C.edit) paint(); });
  ro.observe(el);
  load();
  return {
    // (following the agent: the week it looks at, the event it just added or moved, marked)
    go(a) { if (a.from) C.week = startOfWeek(a.from); C.mark = a.mark ?? null; load(); },
    onFrame(f) { if (f.kind === 'calendar' || f.kind === 'teams') { clearTimeout(soon); soon = setTimeout(load, 250); } },
    destroy() { clearTimeout(soon); ro.disconnect(); },
  };
}

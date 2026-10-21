// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// An agent's PC screen drawn for its screens in the world (docs/features/agent-pc.md §2.1; render/pc-screens.js): the
// PC as its window shows it (client/js/ui/pc-app.js, css/pc.css) — its wallpaper and the theme's colours, the taskbar
// with the agent, the app open and the time — and the window the agent has open with what is in it now (server/pc/
// views.js): the file with the lines it is writing typed in, a picture, a folder, its search, a task board, its week, a
// web page (or its browser's own picture), its terminal, a message it is writing. Its desktop while it sits idle, its
// lock screen while it is away. Drawn on a small canvas only when something on it changes (see pc-screens.js).
export const TYPE_MS = 1600;   // how long a passage just written takes to be typed in on the screen
const APPS = [['files', '📂', 'Files'], ['board', '📋', 'Board'], ['calendar', '🗓', 'Calendar'], ['browser', '🌐', 'Browser'], ['teams', '👥', 'Teams'], ['activity', '📜', 'Activity'], ['terminal', '⌨', 'Terminal'], ['settings', '⚙', 'Settings']];
const APP_OF = { file: 'files', image: 'files', folder: 'files', find: 'files', board: 'board', calendar: 'calendar', page: 'browser', web: 'browser', terminal: 'terminal', chat: 'chat' };
const APP_LABEL = { files: ['📂', 'Files'], board: ['📋', 'Board'], calendar: ['🗓', 'Calendar'], browser: ['🌐', 'Browser'], terminal: ['⌨', 'Terminal'], chat: ['💬', 'Chat'], teams: ['👥', 'Teams'], other: ['💻', 'PC'], tasks: ['📋', 'Board'], thinking: ['💭', 'Thinking'] };
const COLS = [['todo', 'To do'], ['doing', 'Doing'], ['review', 'Review'], ['done', 'Done']];
const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace', SANS = 'system-ui, -apple-system, "Segoe UI", sans-serif';

// ------------------------------------------------------------------------------------------- the theme
let theme = null, themeAt = 0, probe = null;
/** A CSS colour as rgba() — however the theme writes it (a name, hex, color-mix(), oklch()…): painted on one pixel
 *  and read back, so a canvas always gets a colour it takes; one it can't read: `fallback`. */
function rgbaOf(css, fallback) {
  probe ||= document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = '#010203'; probe.fillStyle = css;
  if (probe.fillStyle === '#010203' && css.replace(/\s/g, '').toLowerCase() !== '#010203') return fallback;
  probe.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = probe.getImageData(0, 0, 1, 1).data;
  return `rgba(${r},${g},${b},${+(a / 255).toFixed(3)})`;
}
/** The page theme's colours (read now and then: a theme change shows within a few seconds). */
export function themeColors() {
  const t = Date.now();
  if (theme && t - themeAt < 5000) return theme;
  // (a theme's variables may be written with others — var(), color-mix(): an element resolves them, the canvas reads it)
  let el = document.getElementById('pc-draw-probe');
  if (!el) { el = document.createElement('i'); el.id = 'pc-draw-probe'; el.hidden = true; document.body.append(el); }
  const v = (k, d) => { el.style.color = d; el.style.color = `var(${k}, ${d})`; return rgbaOf(getComputedStyle(el).color, rgbaOf(d, d)); };
  theme = { primary: v('--primary', '#6366f1'), accent: v('--accent', v('--primary', '#6366f1')), panel: v('--panel-strong-0', v('--panel-strong', '#1b1d24')), text: v('--text', '#e8eaf2'),
    dim: v('--dim', '#9aa3b8'), line: v('--line', 'rgba(255,255,255,.12)'), good: v('--good', '#22c55e'), gold: v('--gold', '#f59e0b'), bad: v('--bad', '#ef4444'), field: v('--field', v('--card', '#22252e')) };
  themeAt = t;
  return theme;
}

// ------------------------------------------------------------------------------------------- small pieces
// (shapes as plain paths — no clipping and no blurred shadows anywhere: some phones' canvases draw nothing inside a clip,
// 2026-10-19; a screen is laid out to stay inside its window instead)
function rr(c, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  c.beginPath(); c.moveTo(x + r, y); c.lineTo(x + w - r, y); c.arc(x + w - r, y + r, r, -Math.PI / 2, 0); c.lineTo(x + w, y + h - r); c.arc(x + w - r, y + h - r, r, 0, Math.PI / 2);
  c.lineTo(x + r, y + h); c.arc(x + r, y + h - r, r, Math.PI / 2, Math.PI); c.lineTo(x, y + r); c.arc(x + r, y + r, r, Math.PI, Math.PI * 1.5); c.closePath();
}
/** A rectangle with its top corners rounded (a window's title band). */
function rrTop(c, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h));
  c.beginPath(); c.moveTo(x, y + h); c.lineTo(x, y + r); c.arc(x + r, y + r, r, Math.PI, Math.PI * 1.5); c.lineTo(x + w - r, y); c.arc(x + w - r, y + r, r, -Math.PI / 2, 0); c.lineTo(x + w, y + h); c.closePath();
}
function fit(c, text, maxW) {
  let t = String(text ?? '');
  if (c.measureText(t).width <= maxW) return t;
  while (t.length > 1 && c.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
  return `${t}…`;
}
/** Words wrapped into at most `max` lines of `w` (the last one cut with …). */
function wrapLines(c, text, w, max) {
  const out = [];
  for (const para of String(text ?? '').split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      if (!word) continue;
      const t = line ? `${line} ${word}` : word;
      if (c.measureText(t).width > w && line) { out.push(line); line = word; if (out.length >= max) return out; } else line = t;
    }
    out.push(line);
    if (out.length >= max) break;
  }
  if (out.length > max) out.length = max;
  return out;
}
const sizeText = b => (b == null ? '' : b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : b >= 1024 ? `${Math.round(b / 1024)} KB` : `${b} B`);
const fmts = new Map();
function fmt(tz, o) { const k = `${tz}|${JSON.stringify(o)}`; let f = fmts.get(k); if (!f) { try { f = new Intl.DateTimeFormat([], { ...o, timeZone: tz || undefined }); } catch { f = new Intl.DateTimeFormat([], o); } fmts.set(k, f); } return f; }
/** The text colour that reads on a fill (an rgba() of themeColors', over the PC's dark window): dark on a light one. */
function ink(fill) {
  const m = /rgba\((\d+),(\d+),(\d+),([\d.]+)\)/.exec(fill);
  if (!m) return '#fff';
  const a = +m[4], mix = k => a * +m[k] + (1 - a) * 28;
  return (0.2126 * mix(1) + 0.7152 * mix(2) + 0.0722 * mix(3)) / 255 > 0.55 ? '#111827' : '#fff';
}
/** An rgba() colour (themeColors' own) with its opacity times `a`. */
function alpha(color, a) { const m = /rgba\((\d+),(\d+),(\d+),([\d.]+)\)/.exec(color); return m ? `rgba(${m[1]},${m[2]},${m[3]},${+(m[4] * a).toFixed(3)})` : color; }

// ------------------------------------------------------------------------------------------- the screen
/**
 * Draws one agent's PC screen.
 * @param {CanvasRenderingContext2D} c
 * @param {{ W: number, H: number, agent: object, st: object|null, state: 'away'|'idle'|'active', clock: string, kind: string,
 *   now: number, since: number, blink: number, image: (url: string) => (CanvasImageSource|null) }} o
 *   since: when this window came up (its typing starts then); image: a picture by address, or null while it loads
 */
let warned = false;
export function drawPcScreen(c, o) {
  const { W, H } = o, T = themeColors(), s = Math.min(W / 640, H / 360), bar = Math.round(28 * s);
  // (from a clean state every time — nothing a drawing left set carries into the next; a drawing that fails still
  // leaves a whole screen: its taskbar, and a note where its window was)
  c.save();
  c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1; c.globalCompositeOperation = 'source-over'; c.shadowBlur = 0; c.shadowColor = 'rgba(0,0,0,0)';
  c.textBaseline = 'alphabetic'; c.textAlign = 'left'; c.lineWidth = 1;
  try {
    wallpaper(c, W, H, T);
    if (o.state === 'away') lockScreen(c, o, W, H - bar, s, T);
    else if (o.state === 'idle' || !o.st?.view) desktop(c, o, W, H - bar, s, T);
    else win(c, o, W, H - bar, s, T);
  } catch (e) {
    if (!warned) { warned = true; console.warn('[pc] a screen could not be drawn', e); }
    c.restore(); c.save();
    wallpaper(c, W, H, T);
    c.font = `${13 * s}px ${SANS}`; c.fillStyle = 'rgba(226,232,245,.85)'; c.textBaseline = 'alphabetic'; c.textAlign = 'left';
    c.fillText(fit(c, o.st?.title || 'Working…', W - 40 * s), 20 * s, 40 * s);
  }
  try { taskbar(c, o, W, H, bar, s, T); } catch { /* the screen as it is */ }
  c.restore();
}
/**
 * A screen that isn't one of this person's agents' (someone else's desk, an empty one, a stranger's laptop): a PC all the
 * same — its wallpaper and the time, as a locked screen shows them — so every screen in a room looks alike from any side.
 * Nothing of anyone's PC is on it.
 */
export function drawPlainScreen(c, { W, H, clock }) {
  const T = themeColors(), s = Math.min(W / 640, H / 360);
  c.save();
  c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
  try {
    wallpaper(c, W, H, T);
    c.fillStyle = 'rgba(0,0,0,.25)'; c.fillRect(0, 0, W, H);
    c.textAlign = 'center'; c.textBaseline = 'alphabetic'; c.fillStyle = 'rgba(255,255,255,.94)'; c.font = `300 ${64 * s}px ${SANS}`;
    c.fillText(clock, W / 2, H / 2 + 14 * s);
  } finally { c.restore(); }
}
function wallpaper(c, W, H, T) {
  c.fillStyle = '#0b1020'; c.fillRect(0, 0, W, H);
  const g = c.createRadialGradient(W * 0.15, 0, 0, W * 0.15, 0, Math.max(W, H) * 1.05);
  g.addColorStop(0, alpha(T.primary, 0.5)); g.addColorStop(0.55, 'rgba(11,16,32,0)');
  c.fillStyle = g; c.fillRect(0, 0, W, H);
  const l = c.createLinearGradient(0, 0, W, H);
  l.addColorStop(0, alpha(T.accent, 0.22)); l.addColorStop(0.6, 'rgba(0,0,0,0)');
  c.fillStyle = l; c.fillRect(0, 0, W, H);
}
function taskbar(c, o, W, H, bar, s, T) {
  const y = H - bar;
  c.fillStyle = 'rgba(6,9,20,.86)'; c.fillRect(0, y, W, bar);
  c.fillStyle = 'rgba(255,255,255,.08)'; c.fillRect(0, y, W, 1);
  const mid = y + bar / 2;
  c.textBaseline = 'middle';
  // the agent
  c.fillStyle = 'rgba(255,255,255,.14)'; c.beginPath(); c.arc(14 * s, mid, 9 * s, 0, 7); c.fill();
  c.font = `${11 * s}px ${SANS}`; c.textAlign = 'center'; c.fillStyle = '#fff'; c.fillText(o.agent.emoji || '🤖', 14 * s, mid + s);
  c.textAlign = 'left'; c.font = `600 ${12 * s}px ${SANS}`; c.fillStyle = '#eef2ff';
  const name = fit(c, o.agent.name || 'PC', 110 * s);
  c.fillText(name, 28 * s, mid);
  let x = 28 * s + c.measureText(name).width + 12 * s;
  // the app open
  const app = o.state === 'active' && o.st?.view ? APP_OF[o.st.view.kind] || o.st.app : null;
  if (app) {
    const [ic, label] = APP_LABEL[app] || APP_LABEL.other;
    c.font = `${11.5 * s}px ${SANS}`;
    const w = c.measureText(`${ic} ${label}`).width + 16 * s;
    rr(c, x, y + 4 * s, w, bar - 8 * s, 6 * s); c.fillStyle = 'rgba(255,255,255,.12)'; c.fill();
    c.fillStyle = T.primary; c.fillRect(x + 6 * s, y + bar - 5 * s, w - 12 * s, 2 * s);
    c.fillStyle = '#eef2ff'; c.fillText(`${ic} ${label}`, x + 8 * s, mid);
    x += w + 10 * s;
  }
  // what it is doing, and the time
  c.font = `${11.5 * s}px ${SANS}`; c.textAlign = 'right'; c.fillStyle = 'rgba(226,232,245,.85)';
  c.fillText(o.clock, W - 10 * s, mid);
  const right = W - 10 * s - c.measureText(o.clock).width - 14 * s;
  if (o.state === 'active' && o.st) {
    c.fillStyle = T.good; c.beginPath(); c.arc(right, mid, 3.5 * s, 0, 7); c.fill();
    c.textAlign = 'right'; c.fillStyle = 'rgba(226,232,245,.75)';
    c.fillText(fit(c, o.st.title, Math.max(0, right - x - 14 * s)), right - 8 * s, mid);
  }
  c.textAlign = 'left'; c.textBaseline = 'alphabetic';
}
function lockScreen(c, o, W, H, s) {
  c.fillStyle = 'rgba(0,0,0,.25)'; c.fillRect(0, 0, W, H);
  c.textAlign = 'center'; c.fillStyle = 'rgba(255,255,255,.94)'; c.font = `300 ${64 * s}px ${SANS}`;
  c.fillText(o.clock, W / 2, H / 2 + 4 * s);
  c.font = `500 ${15 * s}px ${SANS}`; c.fillStyle = 'rgba(226,232,245,.8)';
  c.fillText(`${o.agent.name}${o.kind === 'laptop' ? '' : ' · away from its desk'}`, W / 2, H / 2 + 34 * s);
  c.textAlign = 'left';
}
function desktop(c, o, W, H, s, T) {
  const cols = 4, cw = 76 * s, ch = 70 * s;
  c.textAlign = 'center';
  APPS.forEach(([, ic, label], k) => {
    const x = 16 * s + (k % cols) * cw, y = 14 * s + Math.floor(k / cols) * ch;
    rr(c, x + cw / 2 - 20 * s, y, 40 * s, 40 * s, 11 * s);
    const g = c.createLinearGradient(x, y, x, y + 40 * s); g.addColorStop(0, 'rgba(255,255,255,.22)'); g.addColorStop(1, 'rgba(255,255,255,.06)');
    c.fillStyle = g; c.fill();
    c.font = `${21 * s}px ${SANS}`; c.fillStyle = '#fff'; c.fillText(ic, x + cw / 2, y + 28 * s);
    c.font = `${11 * s}px ${SANS}`; c.fillStyle = '#eef2ff'; c.fillText(label, x + cw / 2, y + 54 * s);
  });
  c.textAlign = 'left';
  // the widget: its name, what it is on
  const ww = 210 * s, wx = W - ww - 14 * s, wy = 14 * s;
  rr(c, wx, wy, ww, 74 * s, 10 * s); c.fillStyle = 'rgba(27,29,36,.82)'; c.fill(); c.strokeStyle = 'rgba(255,255,255,.1)'; c.stroke();
  c.font = `600 ${10 * s}px ${SANS}`; c.fillStyle = T.dim; c.fillText(`${(o.agent.name || 'PC').toUpperCase()}'S PC`, wx + 12 * s, wy + 20 * s);
  c.font = `${12 * s}px ${SANS}`; c.fillStyle = T.text;
  c.fillText(fit(c, o.st ? `Last: ${o.st.title}` : 'Nothing right now', ww - 24 * s), wx + 12 * s, wy + 42 * s);
  c.fillStyle = T.dim; c.fillText(fit(c, o.st?.detail || '', ww - 24 * s), wx + 12 * s, wy + 60 * s);
}

// ------------------------------------------------------------------------------------------- the window
function win(c, o, W, H, s, T) {
  const v = o.st.view, x = 8 * s, y = 8 * s, w = W - 16 * s, h = H - 14 * s, tb = 24 * s, r = 9 * s;
  // (its shadow: two soft steps under it)
  rr(c, x + 1 * s, y + 6 * s, w, h, r); c.fillStyle = 'rgba(0,0,0,0.18)'; c.fill();
  rr(c, x, y + 3 * s, w, h, r); c.fillStyle = 'rgba(0,0,0,0.22)'; c.fill();
  rr(c, x, y, w, h, r); c.fillStyle = T.panel; c.fill();
  // its title bar
  rrTop(c, x, y, w, tb, r); c.fillStyle = 'rgba(255,255,255,0.05)'; c.fill();
  c.fillStyle = 'rgba(255,255,255,0.08)'; c.fillRect(x, y + tb, w, 1);
  const app = (v.kind === 'text' && v.app) || APP_OF[v.kind] || o.st.app, [ic, label] = APP_LABEL[app] || APP_LABEL.other;
  c.textBaseline = 'middle'; c.font = `600 ${12 * s}px ${SANS}`; c.fillStyle = T.text;
  c.fillText(`${ic}  ${label}`, x + 10 * s, y + tb / 2);
  const lw = c.measureText(`${ic}  ${label}`).width;
  c.font = `${11.5 * s}px ${SANS}`; c.fillStyle = T.dim;
  c.fillText(fit(c, titleOf(v, o), w - lw - 70 * s), x + 22 * s + lw, y + tb / 2);
  c.fillStyle = 'rgba(255,255,255,.35)'; c.font = `${12 * s}px ${SANS}`; c.textAlign = 'right';
  c.fillText('—   ✕', x + w - 10 * s, y + tb / 2);
  c.textAlign = 'left'; c.textBaseline = 'alphabetic';
  // (what it shows stays inside: a little in from its sides, above its rounded bottom corners)
  const body = { x: x + 1, y: y + tb + 1, w: w - 2, h: h - tb - 1 - r * 0.8 };
  (BODY[v.kind] || terminalBody)(c, o, v, body, s, T);
  rr(c, x, y, w, h, r); c.strokeStyle = 'rgba(255,255,255,0.1)'; c.lineWidth = 1; c.stroke();
}
function titleOf(v, o) {
  switch (v.kind) {
    case 'file': case 'image': return `${v.path || v.name || ''}${v.version ? ` · version ${v.version}` : ''}${v.remote ? ' · on its computer' : ''}`;
    case 'folder': return `${v.path}${v.remote ? ' · on its computer' : ''}`;
    case 'find': return `Search: ${v.query}`;
    case 'board': return v.remote ? v.board : v.board === '~' ? `${o.agent.name}'s board` : `${v.board.replace('/teams/', '')} team`;
    case 'text': return v.heading || '';
    case 'calendar': return 'This week';
    case 'page': return v.title || v.url || '';
    case 'web': return `Search the web: ${v.query}`;
    case 'chat': return v.done ? 'Sent' : 'Writing…';
    default: return `${o.agent.name}@pc`;
  }
}
const BODY = {
  file: fileBody, image: imageBody, folder: folderBody, find: findBody, board: boardBody, calendar: calBody, page: pageBody, web: webBody, terminal: terminalBody, chat: chatBody,
  text: textBody,
};

/** How much of a passage just written shows (0 … 1): it is typed in over TYPE_MS from when the window came up. */
const typed = o => Math.max(0, Math.min(1, (o.now - o.since) / TYPE_MS));

function fileBody(c, o, v, b, s, T) {
  const pad = 10 * s;
  if (v.binary) { c.font = `${13 * s}px ${SANS}`; c.fillStyle = T.dim; c.fillText(`${v.name} · ${sizeText(v.size)} — opens in its own program`, b.x + pad, b.y + 30 * s); return; }
  // its tool row: the mode, who changed it
  const badge = { write: 'Writing', append: 'Adding', edit: 'Editing', read: 'Reading', open: 'Open', review: 'Reviewing', delete: 'Deleting' }[v.mode] || 'Open';
  c.font = `600 ${10.5 * s}px ${SANS}`;
  const bw = c.measureText(badge).width + 14 * s;
  rr(c, b.x + pad, b.y + 7 * s, bw, 17 * s, 8 * s);
  const bf = v.mode === 'read' || v.mode === 'open' || v.mode === 'review' ? 'rgba(255,255,255,0.1)' : alpha(T.primary, 0.85);
  c.fillStyle = bf; c.fill();
  c.fillStyle = ink(bf); c.textBaseline = 'middle'; c.fillText(badge, b.x + pad + 7 * s, b.y + 15.5 * s);
  c.font = `${10.5 * s}px ${SANS}`; c.fillStyle = T.dim;
  // (a file on its own computer: what the step showed of it — no size or version here)
  const info = v.remote ? `${v.lines.length ? `${v.diff ? 'its changes' : `${v.total} lines`} · ` : ''}on its own computer` : `${v.total} lines · ${sizeText(v.size)}${v.by ? ` · last by ${v.by}` : ''}${v.doc ? ' · a document\'s words' : ''}`;
  c.fillText(fit(c, info, b.w - bw - 3 * pad), b.x + pad * 2 + bw, b.y + 15.5 * s);
  c.textBaseline = 'alphabetic';
  if (!v.lines.length) { c.font = `${12 * s}px ${SANS}`; c.fillStyle = T.dim; c.fillText(`${badge} ${v.name || v.path}…`, b.x + pad, b.y + 52 * s); return; }
  // its lines, with a gutter; the lines just written typed in
  const top = b.y + 30 * s, lh = 14 * s, fs = 11.5 * s, gut = 34 * s;
  c.fillStyle = 'rgba(0,0,0,.18)'; c.fillRect(b.x, top - 4 * s, gut, b.h - (top - b.y) + 4 * s);
  const rows = Math.floor((b.y + b.h - top) / lh);
  const hl = v.hl, typing = hl && v.mode !== 'read' && v.mode !== 'open';
  // (the passage typed so far, in characters; the view's lines below it are not there yet)
  let budget = Infinity, caret = null;
  if (typing) {
    const total = v.lines.slice(hl[0] - v.first, hl[1] - v.first + 1).reduce((n, l) => n + l.length + 1, 0);
    budget = Math.floor(total * typed(o));
  }
  // (keep the typing line in view: scroll when the passage is longer than the window)
  let skip = 0;
  if (typing && budget < Infinity) {
    let left = budget, line = hl[0] - v.first;
    for (let k = hl[0] - v.first; k <= hl[1] - v.first && k < v.lines.length; k++) { if (left <= v.lines[k].length) { line = k; break; } left -= v.lines[k].length + 1; line = k + 1; }
    skip = Math.max(0, line - rows + 3);
  }
  c.font = `${fs}px ${MONO}`;
  for (let r = 0; r < rows; r++) {
    const k = r + skip, ln = v.first + k;
    if (k >= v.lines.length) break;
    const y = top + r * lh + lh * 0.75, inHl = hl && ln >= hl[0] && ln <= hl[1];
    if (inHl) { c.fillStyle = alpha(T.primary, 0.2); c.fillRect(b.x + gut, top + r * lh, b.w - gut, lh); c.fillStyle = T.primary; c.fillRect(b.x + gut, top + r * lh, 2 * s, lh); }
    // (a diff: what it adds green, what it takes out red, where red-blue)
    const dk = v.diff ? diffKind(v.lines[k]) : null;
    if (dk === 'add' || dk === 'del') { c.fillStyle = dk === 'add' ? 'rgba(34,197,94,.16)' : 'rgba(239,68,68,.16)'; c.fillRect(b.x + gut, top + r * lh, b.w - gut, lh); }
    c.fillStyle = 'rgba(160,170,190,.6)'; c.textAlign = 'right'; c.fillText(String(ln), b.x + gut - 6 * s, y); c.textAlign = 'left';
    let text = v.lines[k];
    if (typing && inHl) {
      if (budget <= 0) { if (!caret) caret = { x: b.x + gut + 8 * s, y }; continue; }
      if (budget < text.length) { text = text.slice(0, budget); caret = { x: b.x + gut + 8 * s + c.measureText(text).width, y }; }
      budget -= v.lines[k].length + 1;
    } else if (typing && ln > hl[1] && budget > 0 && !caret) { /* (below the passage: as it was) */ }
    c.fillStyle = dk ? DIFF_INK[dk] : /^#{1,6}\s/.test(text) ? '#c7d2fe' : T.text;
    c.fillText(fit(c, text, b.w - gut - 16 * s), b.x + gut + 8 * s, y);
  }
  if (typing && typed(o) < 1 && caret && o.blink) { c.fillStyle = '#fff'; c.fillRect(caret.x + 1, caret.y - fs * 0.85, 1.6 * s, fs); }
}
const DIFF_INK = { add: '#86efac', del: '#fca5a5', at: '#93c5fd', head: '#c4b5fd' };
const diffKind = l => (/^(\+\+\+|---) /.test(l) || /^diff --git|^index [0-9a-f]/.test(l) ? 'head' : /^@@/.test(l) ? 'at' : /^\+/.test(l) ? 'add' : /^-/.test(l) ? 'del' : null);
function imageBody(c, o, v, b, s, T) {
  // (a picture on its own computer: through its provider, when the person manages it and the picture is where it can
  // be read — else what it is)
  const url = !v.remote ? `/api/pc/file?profile=${o.agent.id}&path=${encodeURIComponent(v.path)}&v=${v.version || 0}`
    : v.path && o.agent.own ? `/api/pc/own/file?agent=${o.agent.id}&path=${encodeURIComponent(v.path)}` : null;
  const img = url ? o.image(url) : null;
  c.fillStyle = '#111'; c.fillRect(b.x, b.y, b.w, b.h);
  if (!img) {
    c.textAlign = 'center';
    if (v.remote) { c.font = `${34 * s}px ${SANS}`; c.fillStyle = '#fff'; c.fillText(v.made ? '🎨' : '🖼', b.x + b.w / 2, b.y + b.h / 2 - 10 * s); }
    c.font = `${12 * s}px ${SANS}`; c.fillStyle = T.dim;
    c.fillText(fit(c, v.remote ? (v.made ? `Making a picture: ${v.name}` : `${v.name || 'A picture'} · on its computer`) : `Opening ${v.name}…`, b.w - 30 * s), b.x + b.w / 2, b.y + b.h / 2 + (v.remote ? 22 * s : 0));
    c.textAlign = 'left'; return;
  }
  const iw = img.width || img.naturalWidth, ih = img.height || img.naturalHeight, k = Math.min((b.w - 16 * s) / iw, (b.h - 30 * s) / ih);
  c.drawImage(img, b.x + (b.w - iw * k) / 2, b.y + 6 * s, iw * k, ih * k);
  c.font = `${10.5 * s}px ${SANS}`; c.fillStyle = T.dim; c.textAlign = 'center';
  c.fillText(v.remote ? `${v.name} · on its computer` : `${v.name} · ${sizeText(v.size)}`, b.x + b.w / 2, b.y + b.h - 8 * s); c.textAlign = 'left';
}
function rowsList(c, b, s, T, rows, { top = 0, mark = null } = {}) {
  const lh = 21 * s, y0 = b.y + 6 * s + top;
  const n = Math.min(rows.length, Math.floor((b.h - top - 8 * s) / lh));
  for (let k = 0; k < n; k++) {
    const r = rows[k], y = y0 + k * lh;
    const marked = mark != null && r.key === mark;
    if (marked) { rr(c, b.x + 6 * s, y, b.w - 12 * s, lh - 2 * s, 5 * s); c.fillStyle = alpha(T.primary, 0.28); c.fill(); }
    else if (k % 2) { c.fillStyle = 'rgba(255,255,255,.025)'; c.fillRect(b.x + 6 * s, y, b.w - 12 * s, lh - 2 * s); }
    c.textBaseline = 'middle';
    c.font = `${12 * s}px ${SANS}`; c.fillStyle = '#fff'; c.fillText(r.icon, b.x + 14 * s, y + lh / 2);
    c.font = `${12 * s}px ${SANS}`; c.fillStyle = marked ? ink(alpha(T.primary, 0.28)) === '#fff' ? T.text : '#111827' : T.text;
    c.fillText(fit(c, r.text, b.w * 0.62), b.x + 36 * s, y + lh / 2);
    if (r.right) { c.textAlign = 'right'; c.fillStyle = T.dim; c.font = `${11 * s}px ${SANS}`; c.fillText(fit(c, r.right, b.w * 0.3), b.x + b.w - 14 * s, y + lh / 2); c.textAlign = 'left'; }
    c.textBaseline = 'alphabetic';
  }
  if (rows.length > n) { c.font = `${11 * s}px ${SANS}`; c.fillStyle = T.dim; c.fillText(`… ${rows.length - n} more`, b.x + 36 * s, y0 + n * lh + 12 * s); }
}
const iconOf = e => (e.dir ? (e.team ? '👥' : '📂') : /\.(png|jpe?g|gif|webp|avif|svg)$/i.test(e.name) ? '🖼' : /\.(mp4|webm|mov)$/i.test(e.name) ? '🎥' : /\.(mp3|wav|ogg|m4a)$/i.test(e.name) ? '🎧' : '📄');
function folderBody(c, o, v, b, s, T) {
  c.font = `${11 * s}px ${SANS}`; c.fillStyle = T.dim;
  c.fillText(`${v.total} items${v.readOnly ? ' · read only' : ''}`, b.x + 14 * s, b.y + 17 * s);
  if (!v.entries.length) { c.fillText(v.remote ? 'Looking in it…' : 'This folder is empty.', b.x + 14 * s, b.y + 44 * s); return; }
  rowsList(c, b, s, T, v.entries.map(e => ({ key: e.name, icon: iconOf(e), text: e.name, right: e.dir ? '' : sizeText(e.size) })), { top: 18 * s, mark: v.mark ?? null });
}
function findBody(c, o, v, b, s, T) {
  searchBar(c, b, s, T, v.query);
  if (!v.results.length) { c.font = `${12 * s}px ${SANS}`; c.fillStyle = T.dim; c.fillText(v.remote ? 'Searching…' : `Nothing found for “${v.query}”.`, b.x + 14 * s, b.y + 56 * s); return; }
  rowsList(c, b, s, T, v.results.map(r => ({ key: r.path, icon: r.dir ? '📂' : '📄', text: r.path, right: r.snippet })), { top: 32 * s });
}
function searchBar(c, b, s, T, q) {
  rr(c, b.x + 10 * s, b.y + 8 * s, b.w - 20 * s, 22 * s, 11 * s); c.fillStyle = T.field; c.fill(); c.strokeStyle = 'rgba(255,255,255,.12)'; c.stroke();
  c.font = `${12 * s}px ${SANS}`; c.fillStyle = T.text; c.textBaseline = 'middle';
  c.fillText(fit(c, `🔍  ${q}`, b.w - 40 * s), b.x + 20 * s, b.y + 19 * s); c.textBaseline = 'alphabetic';
}
function boardBody(c, o, v, b, s, T) {
  const gap = 6 * s, cw = (b.w - gap * 5) / 4, top = b.y + gap;
  COLS.forEach(([id, name], k) => {
    const x = b.x + gap + k * (cw + gap), ks = v.cards.filter(x2 => x2.col === id);
    rr(c, x, top, cw, b.h - gap * 2, 7 * s); c.fillStyle = 'rgba(255,255,255,.04)'; c.fill();
    c.font = `700 ${10 * s}px ${SANS}`; c.fillStyle = T.dim; c.fillText(`${name.toUpperCase()}  ${ks.length || ''}`, x + 8 * s, top + 15 * s);
    const ch = 36 * s, max = Math.floor((b.h - gap * 2 - 24 * s) / (ch + 4 * s));
    ks.slice(0, max).forEach((card, j) => {
      const y = top + 22 * s + j * (ch + 4 * s), marked = v.mark != null && card.id === v.mark;
      const cf = marked ? alpha(T.primary, 0.42) : 'rgba(255,255,255,0.08)';
      rr(c, x + 5 * s, y, cw - 10 * s, ch, 6 * s); c.fillStyle = cf; c.fill();
      if (marked) { c.strokeStyle = T.primary; c.lineWidth = 1.5 * s; c.stroke(); c.lineWidth = 1; }
      c.font = `600 ${10.5 * s}px ${SANS}`; c.fillStyle = ink(cf);
      const lines = wrapLines(c, card.title, cw - 22 * s, 2);
      lines.forEach((l, i) => c.fillText(fit(c, l, cw - 22 * s), x + 11 * s, y + 13 * s + i * 12 * s));
      if (card.who) { c.font = `${9 * s}px ${SANS}`; c.fillStyle = ink(cf) === '#fff' ? T.dim : '#374151'; c.fillText(fit(c, card.who, cw - 30 * s), x + 11 * s, y + ch - 4 * s); }
      if (card.working) { c.fillStyle = T.good; c.beginPath(); c.arc(x + cw - 13 * s, y + 8 * s, 3 * s, 0, 7); c.fill(); }
    });
    if (ks.length > max) { c.font = `${9.5 * s}px ${SANS}`; c.fillStyle = T.dim; c.fillText(`+${ks.length - max} more`, x + 9 * s, b.y + b.h - gap - 5 * s); }
  });
}
function calBody(c, o, v, b, s, T) {
  const tz = v.tz, days = 7, gut = 30 * s, head = 20 * s, dw = (b.w - gut - 8 * s) / days, h0 = 7, h1 = 20, hh = (b.h - head - 8 * s) / (h1 - h0);
  const dayKey = t => fmt(tz, { year: 'numeric', month: '2-digit', day: '2-digit' }).format(t);
  const hourOf = t => { const p = fmt(tz, { hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(t); return Number(p.find(x => x.type === 'hour')?.value || 0) + Number(p.find(x => x.type === 'minute')?.value || 0) / 60; };
  const today = dayKey(Date.now());
  for (let d = 0; d < days; d++) {
    const t = v.from + d * 86400000 + 43200000, x = b.x + gut + d * dw;
    if (dayKey(t) === today) { c.fillStyle = alpha(T.primary, 0.12); c.fillRect(x, b.y, dw, b.h); }
    c.font = `600 ${10 * s}px ${SANS}`; c.fillStyle = T.dim; c.textAlign = 'center';
    c.fillText(fmt(tz, { weekday: 'short', day: 'numeric' }).format(t), x + dw / 2, b.y + 14 * s); c.textAlign = 'left';
    c.fillStyle = 'rgba(255,255,255,.06)'; c.fillRect(x, b.y + head, 1, b.h - head);
  }
  for (let hr = h0; hr <= h1; hr += 2) {
    const y = b.y + head + (hr - h0) * hh;
    c.fillStyle = 'rgba(255,255,255,.05)'; c.fillRect(b.x + gut, y, b.w - gut - 8 * s, 1);
    c.font = `${9 * s}px ${SANS}`; c.fillStyle = T.dim; c.textAlign = 'right'; c.fillText(`${hr}:00`, b.x + gut - 4 * s, y + 3 * s); c.textAlign = 'left';
  }
  for (const e of v.events) {
    const d = Math.floor((e.start - v.from) / 86400000);
    if (d < 0 || d >= days) continue;
    const x = b.x + gut + d * dw + 2 * s, a = e.allDay ? h0 : Math.max(h0, Math.min(h1, hourOf(e.start))), z = e.allDay ? h0 + 0.8 : Math.max(a + 0.5, Math.min(h1, hourOf(e.end) || a + 1));
    const y = b.y + head + (a - h0) * hh, hgt = Math.max(14 * s, (z - a) * hh - 2 * s), marked = v.mark != null && e.id === v.mark;
    const ef = marked ? T.primary : e.team ? alpha(T.gold, 0.55) : alpha(T.primary, 0.55);
    rr(c, x, y, dw - 4 * s, hgt, 4 * s); c.fillStyle = ef; c.fill();
    if (marked) { c.strokeStyle = ink(ef) === '#fff' ? '#fff' : '#111827'; c.lineWidth = 1.5 * s; c.stroke(); c.lineWidth = 1; }
    c.font = `600 ${9.5 * s}px ${SANS}`; c.fillStyle = ink(ef);
    c.fillText(fit(c, e.title, dw - 10 * s), x + 4 * s, y + 11 * s);
  }
}
function browserChrome(c, b, s, T, url, title) {
  c.fillStyle = 'rgba(0,0,0,.2)'; c.fillRect(b.x, b.y, b.w, 46 * s);
  rr(c, b.x + 8 * s, b.y + 4 * s, Math.min(180 * s, b.w * 0.4), 18 * s, 6 * s); c.fillStyle = T.panel; c.fill();
  c.font = `${10.5 * s}px ${SANS}`; c.fillStyle = T.text; c.textBaseline = 'middle';
  c.fillText(fit(c, title || 'New tab', Math.min(160 * s, b.w * 0.36)), b.x + 16 * s, b.y + 13 * s);
  c.fillStyle = T.dim; c.fillText('⟨  ⟩  ↻', b.x + 10 * s, b.y + 34 * s);
  rr(c, b.x + 60 * s, b.y + 25 * s, b.w - 70 * s, 18 * s, 9 * s); c.fillStyle = T.field; c.fill();
  c.fillStyle = T.text; c.fillText(fit(c, url || '', b.w - 90 * s), b.x + 70 * s, b.y + 34 * s);
  c.textBaseline = 'alphabetic';
  return { x: b.x, y: b.y + 46 * s, w: b.w, h: b.h - 46 * s };
}
function pageBody(c, o, v, b, s, T) {
  // (a provider agent whose browser opens on its own screen — Hermes' Bot Desktop: that screen, its browser window and all)
  if (v.provider && o.agent.own?.screen) {
    const pic = o.image(`provider-screen:${o.agent.id}`);
    c.fillStyle = '#111318'; c.fillRect(b.x, b.y, b.w, b.h);
    if (pic) {
      const iw = pic.width || pic.naturalWidth, ih = pic.height || pic.naturalHeight, k = Math.min(b.w / iw, b.h / ih);
      c.drawImage(pic, b.x + (b.w - iw * k) / 2, b.y + (b.h - ih * k) / 2, iw * k, ih * k);
      return;
    }
  }
  const area = browserChrome(c, b, s, T, v.url, v.title);
  // a browser with a picture of its own (a browser service's, the provider's): that picture
  // (its real browser's live picture — the built-in one's or its provider's — else a browser service's last picture)
  const pic = v.provider ? (o.agent.own?.screen ? null : o.image(`provider-browser:${o.agent.id}`)) : v.live ? o.image(`pc-browser:${o.agent.id}`) || (v.shot ? o.image(`/api/pc/browser/shot?agent=${o.agent.id}&t=${v.shot}`) : null)
    : v.shot ? o.image(`/api/pc/browser/shot?agent=${o.agent.id}&t=${v.shot}`) : null;
  c.fillStyle = '#f7f7f8'; c.fillRect(area.x, area.y, area.w, area.h);
  if (pic) {
    const iw = pic.width || pic.naturalWidth, k = area.w / iw;
    c.drawImage(pic, 0, 0, iw, Math.min(pic.height || pic.naturalHeight, area.h / k), area.x, area.y, area.w, Math.min((pic.height || pic.naturalHeight) * k, area.h));
    return;
  }
  // the built-in reader: the page's words as they read
  const pad = 22 * s;
  c.fillStyle = '#18181b'; c.font = `700 ${16 * s}px ${SANS}`;
  let y = area.y + 26 * s;
  for (const l of wrapLines(c, v.title || v.url, area.w - pad * 2, 2)) { c.fillText(l, area.x + pad, y); y += 19 * s; }
  y += 4 * s;
  c.font = `${11.5 * s}px ${SANS}`;
  for (const raw of v.lines || []) {
    if (y > area.y + area.h - 8 * s) break;
    const head = /^#{1,6}\s/.test(raw), text = raw.replace(/^#{1,6}\s/, '').replace(/^\s*[-*]\s/, '• ');
    if (!text.trim()) { y += 6 * s; continue; }
    c.font = head ? `700 ${12.5 * s}px ${SANS}` : `${11.5 * s}px ${SANS}`; c.fillStyle = head ? '#18181b' : '#3f3f46';
    for (const l of wrapLines(c, text, area.w - pad * 2, 3)) { if (y > area.y + area.h - 8 * s) break; c.fillText(l, area.x + pad, y); y += 15 * s; }
    y += 3 * s;
  }
}
function webBody(c, o, v, b, s, T) {
  const area = browserChrome(c, b, s, T, `search: ${v.query}`, v.query);
  c.fillStyle = '#f7f7f8'; c.fillRect(area.x, area.y, area.w, area.h);
  let y = area.y + 22 * s;
  if (!v.results.length) { c.font = `${12 * s}px ${SANS}`; c.fillStyle = '#52525b'; c.fillText('Searching…', area.x + 20 * s, y); return; }
  for (const r of v.results) {
    if (y > area.y + area.h - 30 * s) break;
    c.font = `${10 * s}px ${SANS}`; c.fillStyle = '#15803d'; c.fillText(fit(c, r.href, area.w - 40 * s), area.x + 20 * s, y);
    c.font = `600 ${13 * s}px ${SANS}`; c.fillStyle = '#1d4ed8'; c.fillText(fit(c, r.title, area.w - 40 * s), area.x + 20 * s, y + 16 * s);
    c.font = `${10.5 * s}px ${SANS}`; c.fillStyle = '#52525b'; c.fillText(fit(c, r.text, area.w - 40 * s), area.x + 20 * s, y + 30 * s);
    y += 44 * s;
  }
}
function terminalBody(c, o, v, b, s, T) {
  c.fillStyle = '#0a0d14'; c.fillRect(b.x, b.y, b.w, b.h);
  const lh = 14 * s, fs = 11.5 * s;
  c.font = `${fs}px ${MONO}`;
  const lines = [...(v.lines || []), null], rows = Math.floor((b.h - 10 * s) / lh), shown = lines.slice(-rows);
  shown.forEach((l, k) => {
    const y = b.y + 8 * s + (k + 0.8) * lh;
    if (l === null) { c.fillStyle = '#7dd3fc'; c.fillText(`${(o.agent.name || 'agent').toLowerCase().replace(/\s+/g, '-')}@pc:~$`, b.x + 10 * s, y); if (o.blink) { const w = c.measureText(`${(o.agent.name || 'agent').toLowerCase().replace(/\s+/g, '-')}@pc:~$ `).width; c.fillStyle = '#e5e9f5'; c.fillRect(b.x + 10 * s + w, y - fs * 0.85, 7 * s, fs); } return; }
    c.fillStyle = /^\$ /.test(l) ? '#7dd3fc' : /^(error|✗)/.test(l) ? '#fca5a5' : /^[›●✓]/.test(l) ? '#c4b5fd' : '#d4d8e3';
    c.fillText(fit(c, l, b.w - 20 * s), b.x + 10 * s, y);
  });
}
function chatBody(c, o, v, b, s, T) {
  c.fillStyle = 'rgba(0,0,0,.12)'; c.fillRect(b.x, b.y, b.w, b.h);
  const text = v.text || '', shown = v.done ? text : text.slice(0, Math.ceil(text.length * typed(o)));
  const pad = 16 * s, bw = b.w - pad * 2 - 30 * s;
  c.font = `${12 * s}px ${SANS}`;
  const lines = shown ? wrapLines(c, shown, bw - 20 * s, 10) : [];
  const bh = Math.max(30 * s, lines.length * 16 * s + 16 * s);
  c.fillStyle = 'rgba(255,255,255,.14)'; c.beginPath(); c.arc(b.x + pad + 10 * s, b.y + pad + 10 * s, 10 * s, 0, 7); c.fill();
  c.font = `${11 * s}px ${SANS}`; c.textAlign = 'center'; c.fillStyle = '#fff'; c.fillText(o.agent.emoji || '🤖', b.x + pad + 10 * s, b.y + pad + 14 * s); c.textAlign = 'left';
  rr(c, b.x + pad + 26 * s, b.y + pad, bw, bh, 10 * s); c.fillStyle = 'rgba(255,255,255,.08)'; c.fill();
  c.font = `${12 * s}px ${SANS}`; c.fillStyle = T.text;
  if (!lines.length) { c.fillStyle = T.dim; c.fillText(['·', '· ·', '· · ·'][Math.floor(o.now / 400) % 3], b.x + pad + 38 * s, b.y + pad + 19 * s); }
  lines.forEach((l, k) => c.fillText(l, b.x + pad + 36 * s, b.y + pad + 19 * s + k * 16 * s));
  c.font = `${10.5 * s}px ${SANS}`; c.fillStyle = T.dim;
  c.fillText(v.done ? (v.to ? `Sent to ${v.to}` : 'Sent') : 'Writing a message…', b.x + pad + 26 * s, b.y + pad + bh + 16 * s);
}
/** What a calendar, task or other command of its own computer printed: its lines, as a list (./recognize.js listOf). */
function textBody(c, o, v, b, s, T) {
  c.font = `${11 * s}px ${SANS}`; c.fillStyle = T.dim;
  c.fillText(fit(c, `${v.heading || ''} · on its computer`, b.w - 28 * s), b.x + 14 * s, b.y + 17 * s);
  if (!v.lines?.length) { c.font = `${12 * s}px ${SANS}`; c.fillText('Looking…', b.x + 14 * s, b.y + 44 * s); return; }
  rowsList(c, b, s, T, v.lines.map((l, k) => ({ key: k, icon: v.app === 'calendar' ? '🗓' : v.app === 'board' ? '📋' : '•', text: l.trim() })), { top: 18 * s });
}

/** Whether a window is still being typed in (its screen is drawn again each frame until it is done). */
export function isTyping(st, since, now) {
  const v = st?.view;
  if (!v) return false;
  if (v.kind === 'file' && v.hl && v.mode !== 'read' && v.mode !== 'open') return now - since < TYPE_MS + 200;
  if (v.kind === 'chat' && !v.done) return now - since < TYPE_MS + 200;
  return false;
}

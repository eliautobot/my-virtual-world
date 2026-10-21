// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// What the signed-in person may change, as the browser sees it (WP4.6/4.14, wp4-world-spec.md §5.0): on a world with
// lots, holders (and the people they share rights with) build and furnish on their own lots, administrators on the
// city's land; on a world without lots only administrators edit. The server checks every change again — this only
// decides which tools, buttons and menu entries to offer, and explains in words when one isn't offered.
import { auth } from './auth.js';

let layer = null;            // the lot layer (render/lots.js), once the Property view module has loaded
let shared = new Map();      // lot id → rights shared with me (from /api/property/mine)

export function setLotLayer(l) { layer = l; }
export function setShared(list) { shared = new Map((list || []).map(d => [d.id, new Set(d.rights || [])])); }
export const lotLayer = () => layer;
const admin = () => auth.can('world.edit');
const hasLots = () => !!(layer && layer.lots.length);

/** Whether this account can edit anything at all (enter the build or furniture mode, undo its own changes). */
export const canEdit = () => !!auth.account && (admin() || auth.can('property.hold'));

/** The lot a building stands on (its record from the lot map), or null. */
export function lotOf(B) { return B && B.lot && layer ? layer.byId.get(B.lot) || null : null; }

/** Whether the lot is held by me. */
export function isMine(L) { return !!(L && L.holder?.kind === 'account' && auth.account && String(L.holder.id) === String(auth.account.id)); }

/** My rights on lot L: 'build', 'furnish', 'decorate', 'manage', 'merge' — every one when I hold it, the shared ones
 *  when its holder shared them with me, and as an administrator everything on the city's land. */
export function rightsOn(L) {
  if (!L || !auth.account) return new Set();
  if (L.lifecycle === 'custodial') return new Set();
  if (isMine(L)) return new Set(['build', 'furnish', 'decorate', 'manage', 'merge']);
  if (admin() && L.holder?.kind === 'municipality') return new Set(['build', 'furnish', 'decorate', 'manage', 'merge', 'admin']);
  return shared.get(L.id) || new Set();
}

/** Whether I may change building B (right 'build') or its furniture ('furnish'). */
export function mayOn(B, right = 'build') {
  if (!B || !auth.account) return false;
  if (!hasLots()) return admin();
  const L = lotOf(B);
  if (!L) return admin();
  return rightsOn(L).has(right);
}

/** Why I may not change building B, in words (for a disabled button's title or a toast), or ''. */
export function whyNot(B, right = 'build') {
  if (!auth.account) return 'Sign in to build on your own land';
  if (mayOn(B, right)) return '';
  if (!hasLots()) return 'Only administrators edit this world';
  const L = lotOf(B);
  if (!L) return 'Only administrators change buildings that aren\'t on a lot';
  if (L.lifecycle === 'custodial') return `Lot ${L.name || L.id} is on hold`;
  if (L.holder?.kind === 'municipality') return `${B.name} stands on city land (lot ${L.id})`;
  return `${B.name} stands on lot ${L.name || L.id}, which you don't hold`;
}

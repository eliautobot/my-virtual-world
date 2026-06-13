/**
 * Agent Life capability tag vocabulary.
 *
 * These tags describe what a catalog object or placed object supports. They are
 * deliberately metadata-only: importing this module must not create furniture,
 * actions, permissions, routing, colliders, or persistence records.
 */

export const CAPABILITY_TAG_GROUPS = Object.freeze([
  {
    id: 'appearance',
    label: 'Appearance',
    icon: '🎨',
    color: '#d946ef',
    meaning: 'Objects that support visual customization, previews, styling, cosmetics, or avatar/object appearance workflows.',
  },
  {
    id: 'training',
    label: 'Training',
    icon: '🎓',
    color: '#2563eb',
    meaning: 'Objects that support practice, coaching, lessons, demonstrations, tests, or skill-building activities.',
  },
  {
    id: 'planning',
    label: 'Planning',
    icon: '🧭',
    color: '#7c3aed',
    meaning: 'Objects that support meetings, brainstorming, scheduling, reviews, project coordination, or shared notices.',
  },
  {
    id: 'life',
    label: 'Life / Recovery',
    icon: '💚',
    color: '#16a34a',
    meaning: 'Objects that support rest, meals, hydration, hygiene, wellness, medical recovery, or social decompression.',
  },
  {
    id: 'maintenance',
    label: 'Maintenance',
    icon: '🛠️',
    color: '#f97316',
    meaning: 'Objects that support cleaning, repair, restocking, diagnostics, printing/copying, or operational upkeep.',
  },
  {
    id: 'worldBuilding',
    label: 'World-building',
    icon: '🏗️',
    color: '#0891b2',
    meaning: 'Objects that support building, decorating, terrain/road work, structural edits, layout changes, or exterior area creation.',
  },
]);

export const CAPABILITY_TAG_DEFINITIONS = Object.freeze({
  'appearance.customize': Object.freeze({ group: 'appearance', meaning: 'Changes an agent/object look, style, color, outfit, hair, accessory, or cosmetic configuration.' }),
  'appearance.preview': Object.freeze({ group: 'appearance', meaning: 'Displays, tests, mirrors, or previews appearance without committing a real-world authority change.' }),
  'appearance.display': Object.freeze({ group: 'appearance', meaning: 'Shows cosmetic items, mannequins, outfits, accessories, or visual samples for browsing/selection.' }),
  'appearance.salon': Object.freeze({ group: 'appearance', meaning: 'Supports barber, salon, mirror, grooming, or styling interactions.' }),

  'training.practice': Object.freeze({ group: 'training', meaning: 'Lets agents practice a skill, drill, exercise, game, or repeated activity.' }),
  'training.coach': Object.freeze({ group: 'training', meaning: 'Supports guided instruction, teaching, tutoring, coaching, or demonstrations.' }),
  'training.classroom': Object.freeze({ group: 'training', meaning: 'Supports classroom-style learning, group lessons, presentations, or lectures.' }),
  'training.exam': Object.freeze({ group: 'training', meaning: 'Supports tests, evaluations, assessments, diagnostics, or certification-style actions.' }),

  'planning.meeting': Object.freeze({ group: 'planning', meaning: 'Supports meetings, group discussion, collaboration, or table/conference workflows.' }),
  'planning.brainstorm': Object.freeze({ group: 'planning', meaning: 'Supports whiteboarding, ideation, sticky-note style thinking, or creative planning.' }),
  'planning.schedule': Object.freeze({ group: 'planning', meaning: 'Supports calendars, agenda boards, queue planning, bookings, or timed coordination.' }),
  'planning.notice': Object.freeze({ group: 'planning', meaning: 'Displays notices, announcements, instructions, maps, menus, or public information.' }),
  'planning.review': Object.freeze({ group: 'planning', meaning: 'Supports review, retrospectives, checklists, status tracking, or decision-making.' }),

  'life.rest': Object.freeze({ group: 'life', meaning: 'Supports sleeping, sitting, lounging, breaks, energy recovery, or calm idle behavior.' }),
  'life.food': Object.freeze({ group: 'life', meaning: 'Supports eating, cooking, serving, vending, pickup counters, or food-related recovery.' }),
  'life.hydration': Object.freeze({ group: 'life', meaning: 'Supports drinking, water, coffee, beverages, sinks, coolers, or hydration recovery.' }),
  'life.hygiene': Object.freeze({ group: 'life', meaning: 'Supports washing, grooming, cleaning self, bathroom/sink use, or comfort recovery.' }),
  'life.medical': Object.freeze({ group: 'life', meaning: 'Supports clinics, exams, treatment, diagnostics, beds, supply cabinets, or health recovery.' }),
  'life.social': Object.freeze({ group: 'life', meaning: 'Supports leisure, casual conversation, play, entertainment, relaxation, or social recovery.' }),
  'life.shopping': Object.freeze({ group: 'life', meaning: 'Supports retail browsing, checkout, customer waiting, purchases, or shop/service interactions.' }),

  'maintenance.clean': Object.freeze({ group: 'maintenance', meaning: 'Supports trash, recycling, cleanup, janitorial tasks, or cleanliness upkeep.' }),
  'maintenance.repair': Object.freeze({ group: 'maintenance', meaning: 'Supports fixing, tuning, tools, utility carts, mechanical upkeep, or restoration.' }),
  'maintenance.restock': Object.freeze({ group: 'maintenance', meaning: 'Supports inventory, supply cabinets, refills, replenishment, pickup shelves, or stocked counters.' }),
  'maintenance.printCopy': Object.freeze({ group: 'maintenance', meaning: 'Supports printing, copying, scanning, office equipment, or document production.' }),
  'maintenance.diagnostics': Object.freeze({ group: 'maintenance', meaning: 'Supports system checks, health checks, inspection, or diagnostic station workflows.' }),
  'maintenance.checkout': Object.freeze({ group: 'maintenance', meaning: 'Supports cashier service, checkout scanning, payment/review, receipts, or retail counter operations.' }),

  'world.build': Object.freeze({ group: 'worldBuilding', meaning: 'Supports placing, constructing, extending, or creating buildings/objects/areas.' }),
  'world.decorate': Object.freeze({ group: 'worldBuilding', meaning: 'Supports decorative placement, visual dressing, props, plants, lamps, labels, or cosmetic layout edits.' }),
  'world.structure': Object.freeze({ group: 'worldBuilding', meaning: 'Supports walls, doors, floors, roofs, windows, structural layout, or building shell changes.' }),
  'world.terrain': Object.freeze({ group: 'worldBuilding', meaning: 'Supports terrain, road, path, water, outdoor node, or exterior ground editing.' }),
  'world.exterior': Object.freeze({ group: 'worldBuilding', meaning: 'Supports outdoor areas, parks, exterior amenities, street furniture, transit, crossings, or public-space layout.' }),
});

export const CAPABILITY_TAGS = Object.freeze(Object.keys(CAPABILITY_TAG_DEFINITIONS));

export const CAPABILITY_TAG_EDITOR_ORDER = Object.freeze(
  CAPABILITY_TAG_GROUPS.flatMap(group => CAPABILITY_TAGS.filter(tag => CAPABILITY_TAG_DEFINITIONS[tag].group === group.id)),
);

export const CAPABILITY_TAG_ALIASES = Object.freeze({
  cosmetic: 'appearance.customize',
  cosmetics: 'appearance.customize',
  avatar: 'appearance.customize',
  mirror: 'appearance.preview',
  mannequin: 'appearance.display',
  barber: 'appearance.salon',
  grooming: 'appearance.salon',
  learning: 'training.practice',
  education: 'training.classroom',
  test: 'training.exam',
  whiteboard: 'planning.brainstorm',
  calendar: 'planning.schedule',
  announcement: 'planning.notice',
  rest: 'life.rest',
  recovery: 'life.rest',
  meal: 'life.food',
  drink: 'life.hydration',
  clinic: 'life.medical',
  shopping: 'life.shopping',
  retail: 'life.shopping',
  checkout: 'maintenance.checkout',
  cashier: 'maintenance.checkout',
  trash: 'maintenance.clean',
  recycle: 'maintenance.clean',
  printer: 'maintenance.printCopy',
  copier: 'maintenance.printCopy',
  diagnostic: 'maintenance.diagnostics',
  building: 'world.build',
  build: 'world.build',
  decor: 'world.decorate',
  wall: 'world.structure',
  terrain: 'world.terrain',
  outdoor: 'world.exterior',
});

export function normalizeCapabilityTag(tag) {
  if (typeof tag !== 'string') return null;
  const cleaned = tag.trim();
  if (!cleaned) return null;
  if (CAPABILITY_TAG_DEFINITIONS[cleaned]) return cleaned;
  const aliasKey = cleaned.replace(/[\s_-]+/g, '').toLowerCase();
  return CAPABILITY_TAG_ALIASES[cleaned] || CAPABILITY_TAG_ALIASES[cleaned.toLowerCase()] || CAPABILITY_TAG_ALIASES[aliasKey] || null;
}

export function isCapabilityTag(tag) {
  return Boolean(normalizeCapabilityTag(tag));
}

export function getCapabilityTagDefinition(tag) {
  const normalized = normalizeCapabilityTag(tag);
  return normalized ? CAPABILITY_TAG_DEFINITIONS[normalized] : null;
}

const groupIds = new Set(CAPABILITY_TAG_GROUPS.map(group => group.id));
for (const [tag, definition] of Object.entries(CAPABILITY_TAG_DEFINITIONS)) {
  if (!groupIds.has(definition.group)) {
    throw new Error(`Capability tag ${tag} references unknown group ${definition.group}`);
  }
}

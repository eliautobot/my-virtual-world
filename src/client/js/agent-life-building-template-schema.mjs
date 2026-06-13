/**
 * Agent Life building template schema.
 *
 * Building templates are metadata presets for creating/theming buildings. They
 * intentionally do not replace current Virtual World building records,
 * BUILDING_TYPES, BUILDING_THEMES, placement, routing, furniture, or
 * persistence. Later registry/loader work can adapt these presets into the
 * existing building creation flow.
 */
import {
  CAPABILITY_TAGS,
  normalizeCapabilityTag,
} from './agent-life-capability-tags.mjs';

export const BUILDING_TEMPLATE_SCHEMA_VERSION = 'agent-life-building-template/v1';

export const CURRENT_BUILDING_TYPE_IDS = Object.freeze(['office', 'home', 'store', 'park']);
export const CURRENT_EXTERIOR_STYLE_IDS = Object.freeze(['modern', 'rustic', 'coastal', 'industrial', 'festive', 'storefront', 'blank']);
export const CURRENT_DOOR_POSITIONS = Object.freeze(['north', 'south', 'east', 'west']);

export const BUILDING_TEMPLATE_PERMISSION_LEVELS = Object.freeze(['public', 'assigned-role', 'manager', 'admin', 'owner-only']);
export const BUILDING_TEMPLATE_PERMISSION_KEYS = Object.freeze([
  'applyTemplate',
  'placeSuggestedObjects',
  'editRooms',
  'editExterior',
  'manageTemplate',
]);

export const BUILDING_TEMPLATE_SCHEMA_FIELDS = Object.freeze([
  Object.freeze({ key: 'id', required: true, type: 'string', meaning: 'Stable kebab-case template id used by registries, examples, and migrations.' }),
  Object.freeze({ key: 'name', required: true, type: 'string', meaning: 'Human-readable template name.' }),
  Object.freeze({ key: 'themeTags', required: true, type: 'string[]', meaning: 'Free-form theme descriptors plus optional Agent Life capability tag aliases/canonicals.' }),
  Object.freeze({ key: 'exteriorStyle', required: true, type: 'string', meaning: 'Default exterior style/theme adapter for current building color/theme UI.' }),
  Object.freeze({ key: 'buildingType', required: false, type: 'string', meaning: 'Suggested current Virtual World building type such as office, home, store, or park.' }),
  Object.freeze({ key: 'rooms', required: true, type: 'room[]', meaning: 'Default room presets; room ids are stable within one template.' }),
  Object.freeze({ key: 'suggestedObjects', required: true, type: 'suggestedObject[]', meaning: 'Object/catalog ids to suggest, not force-place.' }),
  Object.freeze({ key: 'suggestedActions', required: true, type: 'string[]', meaning: 'World/API action ids that this template is designed to support later.' }),
  Object.freeze({ key: 'colors', required: true, type: 'object', meaning: 'Default visual colors for exterior/interior UI adapters.' }),
  Object.freeze({ key: 'permissions', required: true, type: 'object', meaning: 'Default minimum permission levels for template operations.' }),
]);

export const BUILDING_TEMPLATE_VALIDATION_EXPECTATIONS = Object.freeze([
  'Templates are additive presets. They must not mutate current building placement, furniture, routing, collision, or persistence by import side effect.',
  'id must be stable kebab-case; name must be present; themeTags, rooms, suggestedObjects, and suggestedActions must be arrays.',
  'themeTags may include free-form themes, but recognized capability tag aliases are normalized for validation/reporting.',
  'exteriorStyle should map to an existing/future exterior theme adapter; current color themes remain authoritative until a registry task wires templates into UI.',
  'rooms define suggested interior zones only; they do not create a second room/furniture persistence array.',
  'suggestedObjects reference existing/future catalog ids and must be suggestions, not placement restrictions.',
  'permissions use only the Phase 0 permission levels and describe template operations, not real tool/file/admin authority.',
]);

export const BUILDING_TEMPLATE_EXAMPLES = Object.freeze([
  Object.freeze({
    id: 'blank-building',
    name: 'Blank Building',
    themeTags: Object.freeze(['world.build', 'world.decorate']),
    exteriorStyle: 'blank',
    buildingType: 'office',
    rooms: Object.freeze([
      Object.freeze({ id: 'main', name: 'Main Room', kind: 'flex', floor: 1, suggestedObjects: Object.freeze([]), themeTags: Object.freeze(['world.build']) }),
    ]),
    suggestedObjects: Object.freeze([]),
    suggestedActions: Object.freeze(['template.apply', 'building.decorate']),
    colors: Object.freeze({ primary: '#78909c', secondary: '#546e7a', wallColor: '#78909c', roofColor: '#546e7a', floorColor: '#c0c0c0' }),
    permissions: Object.freeze({ applyTemplate: 'public', placeSuggestedObjects: 'public', editRooms: 'manager', editExterior: 'manager', manageTemplate: 'admin' }),
  }),
  Object.freeze({
    id: 'office-hq',
    name: 'Office HQ',
    themeTags: Object.freeze(['planning.meeting', 'maintenance.printCopy', 'workplace']),
    exteriorStyle: 'modern',
    buildingType: 'office',
    rooms: Object.freeze([
      Object.freeze({ id: 'work-floor', name: 'Work Floor', kind: 'workspace', floor: 1, suggestedObjects: Object.freeze(['desk', 'officeChair', 'printerCopier']), themeTags: Object.freeze(['planning.review']) }),
      Object.freeze({ id: 'meeting-room', name: 'Meeting Room', kind: 'meeting', floor: 1, suggestedObjects: Object.freeze(['meetingTable', 'chair', 'waterCooler']), themeTags: Object.freeze(['planning.meeting']) }),
    ]),
    suggestedObjects: Object.freeze(['desk', 'officeChair', 'receptionDesk', 'printerCopier', 'meetingTable', 'waterCooler']),
    suggestedActions: Object.freeze(['work.atDesk', 'planning.meeting', 'maintenance.printCopy']),
    colors: Object.freeze({ primary: '#78909c', secondary: '#546e7a', wallColor: '#78909c', roofColor: '#546e7a', accentColor: '#2563eb' }),
    permissions: Object.freeze({ applyTemplate: 'public', placeSuggestedObjects: 'assigned-role', editRooms: 'manager', editExterior: 'manager', manageTemplate: 'admin' }),
  }),
  Object.freeze({
    id: 'barber-shop',
    name: 'Barber Shop',
    themeTags: Object.freeze(['appearance.salon', 'appearance.customize', 'beauty']),
    exteriorStyle: 'storefront',
    buildingType: 'store',
    rooms: Object.freeze([
      Object.freeze({ id: 'front', name: 'Front', kind: 'reception', floor: 1, suggestedObjects: Object.freeze(['receptionDesk', 'couch', 'plant']), themeTags: Object.freeze(['planning.schedule']) }),
      Object.freeze({ id: 'service', name: 'Service Area', kind: 'service', floor: 1, suggestedObjects: Object.freeze(['barber-chair', 'salon-mirror-station', 'counter']), themeTags: Object.freeze(['appearance.salon']) }),
    ]),
    suggestedObjects: Object.freeze(['barber-chair', 'salon-mirror-station', 'counter', 'couch', 'plant']),
    suggestedActions: Object.freeze(['appearance.editHair', 'appearance.editStyle', 'queue.wait']),
    colors: Object.freeze({ primary: '#d35400', secondary: '#f5cba7', wallColor: '#f5cba7', roofColor: '#d35400', accentColor: '#7c2d12' }),
    permissions: Object.freeze({ applyTemplate: 'public', placeSuggestedObjects: 'assigned-role', editRooms: 'manager', editExterior: 'manager', manageTemplate: 'admin' }),
  }),
  Object.freeze({
    id: 'clinic',
    name: 'Clinic',
    themeTags: Object.freeze(['life.medical', 'maintenance.diagnostics', 'care']),
    exteriorStyle: 'modern',
    buildingType: 'office',
    rooms: Object.freeze([
      Object.freeze({ id: 'waiting', name: 'Waiting Area', kind: 'waiting', floor: 1, suggestedObjects: Object.freeze(['chair', 'couch', 'plant']), themeTags: Object.freeze(['life.rest']) }),
      Object.freeze({ id: 'exam', name: 'Exam Room', kind: 'medical', floor: 1, suggestedObjects: Object.freeze(['clinic-bed', 'diagnostic-station', 'medical-supply-cabinet']), themeTags: Object.freeze(['life.medical', 'training.exam']) }),
    ]),
    suggestedObjects: Object.freeze(['clinic-bed', 'diagnostic-station', 'medical-supply-cabinet', 'chair', 'sink']),
    suggestedActions: Object.freeze(['life.medicalExam', 'maintenance.diagnostics', 'life.rest']),
    colors: Object.freeze({ primary: '#e0f2fe', secondary: '#0ea5e9', wallColor: '#e0f2fe', roofColor: '#0ea5e9', accentColor: '#14b8a6' }),
    permissions: Object.freeze({ applyTemplate: 'public', placeSuggestedObjects: 'assigned-role', editRooms: 'manager', editExterior: 'manager', manageTemplate: 'admin' }),
  }),
  Object.freeze({
    id: 'academy',
    name: 'Academy',
    themeTags: Object.freeze(['training.classroom', 'training.coach', 'planning.brainstorm', 'education']),
    exteriorStyle: 'modern',
    buildingType: 'office',
    rooms: Object.freeze([
      Object.freeze({ id: 'classroom', name: 'Classroom', kind: 'classroom', floor: 1, suggestedObjects: Object.freeze(['whiteboard', 'chair', 'bookshelf']), themeTags: Object.freeze(['training.classroom']) }),
      Object.freeze({ id: 'study-lab', name: 'Study Lab', kind: 'study', floor: 1, suggestedObjects: Object.freeze(['desk', 'officeChair', 'printerCopier']), themeTags: Object.freeze(['planning.review']) }),
    ]),
    suggestedObjects: Object.freeze(['whiteboard', 'chair', 'desk', 'officeChair', 'bookshelf', 'printerCopier']),
    suggestedActions: Object.freeze(['training.lesson', 'planning.brainstorm', 'training.exam', 'planning.review']),
    colors: Object.freeze({ primary: '#dbeafe', secondary: '#2563eb', wallColor: '#dbeafe', roofColor: '#1d4ed8', accentColor: '#facc15' }),
    permissions: Object.freeze({ applyTemplate: 'public', placeSuggestedObjects: 'assigned-role', editRooms: 'manager', editExterior: 'manager', manageTemplate: 'admin' }),
  }),
  Object.freeze({
    id: 'gym-dojo',
    name: 'Gym / Dojo',
    themeTags: Object.freeze(['training.practice', 'training.coach', 'life.rest', 'fitness']),
    exteriorStyle: 'industrial',
    buildingType: 'store',
    rooms: Object.freeze([
      Object.freeze({ id: 'training-floor', name: 'Training Floor', kind: 'training', floor: 1, suggestedObjects: Object.freeze(['treadmill', 'training-mat', 'dumbbell-rack', 'gym-bench']), themeTags: Object.freeze(['training.practice']) }),
      Object.freeze({ id: 'cooldown', name: 'Cooldown Lounge', kind: 'lounge', floor: 1, suggestedObjects: Object.freeze(['couch', 'waterCooler', 'plant']), themeTags: Object.freeze(['life.rest', 'life.hydration']) }),
    ]),
    suggestedObjects: Object.freeze(['treadmill', 'training-mat', 'dumbbell-rack', 'gym-bench', 'waterCooler', 'couch', 'plant']),
    suggestedActions: Object.freeze(['training.practice', 'training.coach', 'life.rest', 'life.hydration']),
    colors: Object.freeze({ primary: '#374151', secondary: '#ef4444', wallColor: '#374151', roofColor: '#111827', accentColor: '#f97316' }),
    permissions: Object.freeze({ applyTemplate: 'public', placeSuggestedObjects: 'assigned-role', editRooms: 'manager', editExterior: 'manager', manageTemplate: 'admin' }),
  }),
  Object.freeze({
    id: 'library',
    name: 'Library',
    themeTags: Object.freeze(['planning.review', 'training.classroom', 'life.rest', 'reading']),
    exteriorStyle: 'rustic',
    buildingType: 'office',
    rooms: Object.freeze([
      Object.freeze({ id: 'stacks', name: 'Stacks', kind: 'library', floor: 1, suggestedObjects: Object.freeze(['bookshelf', 'chair', 'plant']), themeTags: Object.freeze(['planning.review']) }),
      Object.freeze({ id: 'reading-room', name: 'Reading Room', kind: 'reading', floor: 1, suggestedObjects: Object.freeze(['couch', 'desk', 'floorLamp']), themeTags: Object.freeze(['life.rest']) }),
    ]),
    suggestedObjects: Object.freeze(['bookshelf', 'chair', 'couch', 'desk', 'printerCopier', 'plant', 'floorLamp']),
    suggestedActions: Object.freeze(['planning.review', 'training.study', 'life.rest', 'planning.notice']),
    colors: Object.freeze({ primary: '#8d6e63', secondary: '#4e342e', wallColor: '#d7ccc8', roofColor: '#4e342e', accentColor: '#fbbf24' }),
    permissions: Object.freeze({ applyTemplate: 'public', placeSuggestedObjects: 'assigned-role', editRooms: 'manager', editExterior: 'manager', manageTemplate: 'admin' }),
  }),
  Object.freeze({
    id: 'lab',
    name: 'Lab',
    themeTags: Object.freeze(['training.exam', 'maintenance.diagnostics', 'planning.review', 'research']),
    exteriorStyle: 'industrial',
    buildingType: 'office',
    rooms: Object.freeze([
      Object.freeze({ id: 'research-bay', name: 'Research Bay', kind: 'lab', floor: 1, suggestedObjects: Object.freeze(['desk', 'whiteboard', 'diagnostic-station']), themeTags: Object.freeze(['maintenance.diagnostics']) }),
      Object.freeze({ id: 'clean-up', name: 'Clean-up', kind: 'utility', floor: 1, suggestedObjects: Object.freeze(['sink', 'counter', 'medical-supply-cabinet']), themeTags: Object.freeze(['maintenance.clean']) }),
    ]),
    suggestedObjects: Object.freeze(['desk', 'whiteboard', 'diagnostic-station', 'medical-supply-cabinet', 'sink', 'counter', 'draftingTable']),
    suggestedActions: Object.freeze(['maintenance.diagnostics', 'training.exam', 'planning.review', 'maintenance.clean']),
    colors: Object.freeze({ primary: '#cbd5e1', secondary: '#334155', wallColor: '#e2e8f0', roofColor: '#334155', accentColor: '#22d3ee' }),
    permissions: Object.freeze({ applyTemplate: 'public', placeSuggestedObjects: 'assigned-role', editRooms: 'manager', editExterior: 'manager', manageTemplate: 'admin' }),
  }),
  Object.freeze({
    id: 'clothing-store',
    name: 'Clothing Store',
    themeTags: Object.freeze(['appearance.display', 'appearance.customize', 'planning.schedule', 'retail']),
    exteriorStyle: 'storefront',
    buildingType: 'store',
    rooms: Object.freeze([
      Object.freeze({ id: 'showroom', name: 'Showroom', kind: 'retail', floor: 1, suggestedObjects: Object.freeze(['clothingRack', 'receptionDesk', 'plant']), themeTags: Object.freeze(['appearance.display']) }),
      Object.freeze({ id: 'fitting-area', name: 'Fitting Area', kind: 'fitting', floor: 1, suggestedObjects: Object.freeze(['clothingRack', 'chair']), themeTags: Object.freeze(['appearance.customize']) }),
    ]),
    suggestedObjects: Object.freeze(['clothingRack', 'receptionDesk', 'chair', 'plant', 'counter']),
    suggestedActions: Object.freeze(['appearance.previewOutfit', 'appearance.editStyle', 'planning.schedule', 'queue.wait']),
    colors: Object.freeze({ primary: '#fce7f3', secondary: '#db2777', wallColor: '#fce7f3', roofColor: '#be185d', accentColor: '#a855f7' }),
    permissions: Object.freeze({ applyTemplate: 'public', placeSuggestedObjects: 'assigned-role', editRooms: 'manager', editExterior: 'manager', manageTemplate: 'admin' }),
  }),
  Object.freeze({
    id: 'cafe',
    name: 'Cafe',
    themeTags: Object.freeze(['life.food', 'life.hydration', 'life.social', 'planning.notice']),
    exteriorStyle: 'storefront',
    buildingType: 'store',
    rooms: Object.freeze([
      Object.freeze({ id: 'counter-service', name: 'Counter Service', kind: 'service', floor: 1, suggestedObjects: Object.freeze(['cafeCounter', 'coffeeMachine', 'sink']), themeTags: Object.freeze(['life.food', 'life.hydration']) }),
      Object.freeze({ id: 'seating', name: 'Seating', kind: 'dining', floor: 1, suggestedObjects: Object.freeze(['smallCafeTable', 'diningTable', 'chair', 'couch']), themeTags: Object.freeze(['life.social', 'life.rest']) }),
    ]),
    suggestedObjects: Object.freeze(['cafeCounter', 'coffeeMachine', 'sink', 'smallCafeTable', 'diningTable', 'chair', 'couch', 'plant']),
    suggestedActions: Object.freeze(['life.orderFood', 'life.drinkCoffee', 'life.social', 'maintenance.clean']),
    colors: Object.freeze({ primary: '#fed7aa', secondary: '#9a3412', wallColor: '#ffedd5', roofColor: '#7c2d12', accentColor: '#16a34a' }),
    permissions: Object.freeze({ applyTemplate: 'public', placeSuggestedObjects: 'assigned-role', editRooms: 'manager', editExterior: 'manager', manageTemplate: 'admin' }),
  }),
  Object.freeze({
    id: 'construction-office',
    name: 'Construction Office',
    themeTags: Object.freeze(['world.build', 'world.structure', 'planning.review', 'maintenance.repair']),
    exteriorStyle: 'industrial',
    buildingType: 'office',
    rooms: Object.freeze([
      Object.freeze({ id: 'planning-bay', name: 'Planning Bay', kind: 'workspace', floor: 1, suggestedObjects: Object.freeze(['draftingTable', 'whiteboard', 'desk']), themeTags: Object.freeze(['world.build', 'planning.brainstorm']) }),
      Object.freeze({ id: 'dispatch', name: 'Dispatch', kind: 'operations', floor: 1, suggestedObjects: Object.freeze(['receptionDesk', 'printerCopier', 'counter']), themeTags: Object.freeze(['planning.schedule', 'maintenance.repair']) }),
    ]),
    suggestedObjects: Object.freeze(['draftingTable', 'whiteboard', 'desk', 'officeChair', 'printerCopier', 'counter']),
    suggestedActions: Object.freeze(['world.build', 'world.structure', 'planning.review', 'maintenance.repair']),
    colors: Object.freeze({ primary: '#facc15', secondary: '#475569', wallColor: '#fef3c7', roofColor: '#475569', accentColor: '#ea580c' }),
    permissions: Object.freeze({ applyTemplate: 'public', placeSuggestedObjects: 'assigned-role', editRooms: 'manager', editExterior: 'manager', manageTemplate: 'admin' }),
  }),
  Object.freeze({
    id: 'home-sleep-pod',
    name: 'Home / Sleep Pod',
    themeTags: Object.freeze(['life.rest', 'life.hydration', 'life.social', 'home']),
    exteriorStyle: 'coastal',
    buildingType: 'home',
    rooms: Object.freeze([
      Object.freeze({ id: 'sleep-zone', name: 'Sleep Zone', kind: 'bedroom', floor: 1, suggestedObjects: Object.freeze(['bed', 'sleep-pod']), themeTags: Object.freeze(['life.rest']) }),
      Object.freeze({ id: 'living-zone', name: 'Living Zone', kind: 'living', floor: 1, suggestedObjects: Object.freeze(['couch', 'tv', 'coffeeMachine']), themeTags: Object.freeze(['life.social', 'life.hydration']) }),
    ]),
    suggestedObjects: Object.freeze(['bed', 'sleep-pod', 'couch', 'tv', 'coffeeMachine', 'chair', 'plant']),
    suggestedActions: Object.freeze(['life.sleep', 'life.rest', 'life.social', 'life.hydration']),
    colors: Object.freeze({ primary: '#ffffff', secondary: '#1565c0', wallColor: '#ffffff', roofColor: '#1565c0', accentColor: '#38bdf8' }),
    permissions: Object.freeze({ applyTemplate: 'public', placeSuggestedObjects: 'assigned-role', editRooms: 'manager', editExterior: 'manager', manageTemplate: 'admin' }),
  }),
]);

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isKebabId(value) {
  return typeof value === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

function isHexColor(value) {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
}

function assertStringArray(value, path, errors, { allowEmpty = false } = {}) {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return [];
  }
  if (!allowEmpty && value.length === 0) errors.push(`${path} must not be empty`);
  value.forEach((item, index) => {
    if (typeof item !== 'string' || !item.trim()) errors.push(`${path}[${index}] must be a non-empty string`);
  });
  return value.filter(item => typeof item === 'string' && item.trim()).map(item => item.trim());
}

export function normalizeBuildingTemplateThemeTags(tags = []) {
  if (!Array.isArray(tags)) return Object.freeze([]);
  return Object.freeze(tags.map(tag => normalizeCapabilityTag(tag) || (typeof tag === 'string' ? tag.trim() : null)).filter(Boolean));
}

export function validateBuildingTemplate(template) {
  const errors = [];
  const warnings = [];
  const normalizedCapabilityTags = [];

  if (!isRecord(template)) {
    return Object.freeze({ valid: false, errors: Object.freeze(['template must be an object']), warnings: Object.freeze([]), normalizedCapabilityTags: Object.freeze([]) });
  }

  if (!isKebabId(template.id)) errors.push('id must be stable kebab-case');
  if (typeof template.name !== 'string' || !template.name.trim()) errors.push('name must be a non-empty string');

  const themeTags = assertStringArray(template.themeTags, 'themeTags', errors);
  for (const tag of themeTags) {
    const normalized = normalizeCapabilityTag(tag);
    if (normalized) normalizedCapabilityTags.push(normalized);
  }
  if (themeTags.length && normalizedCapabilityTags.length === 0) warnings.push('themeTags contain no recognized Agent Life capability tags');

  if (typeof template.exteriorStyle !== 'string' || !template.exteriorStyle.trim()) errors.push('exteriorStyle must be a non-empty string');
  else if (!CURRENT_EXTERIOR_STYLE_IDS.includes(template.exteriorStyle)) warnings.push(`exteriorStyle ${template.exteriorStyle} has no current style adapter yet`);

  if (template.buildingType !== undefined && !CURRENT_BUILDING_TYPE_IDS.includes(template.buildingType)) {
    warnings.push(`buildingType ${template.buildingType} has no current Virtual World type adapter yet`);
  }

  if (!Array.isArray(template.rooms) || template.rooms.length === 0) {
    errors.push('rooms must be a non-empty array');
  } else {
    const roomIds = new Set();
    template.rooms.forEach((room, index) => {
      const path = `rooms[${index}]`;
      if (!isRecord(room)) {
        errors.push(`${path} must be an object`);
        return;
      }
      if (!isKebabId(room.id)) errors.push(`${path}.id must be stable kebab-case`);
      else if (roomIds.has(room.id)) errors.push(`${path}.id duplicates room id ${room.id}`);
      else roomIds.add(room.id);
      if (typeof room.name !== 'string' || !room.name.trim()) errors.push(`${path}.name must be a non-empty string`);
      if (typeof room.kind !== 'string' || !room.kind.trim()) errors.push(`${path}.kind must be a non-empty string`);
      if (!Number.isInteger(room.floor) || room.floor < 1) errors.push(`${path}.floor must be an integer >= 1`);
      assertStringArray(room.suggestedObjects || [], `${path}.suggestedObjects`, errors, { allowEmpty: true });
      assertStringArray(room.themeTags || [], `${path}.themeTags`, errors, { allowEmpty: true });
    });
  }

  assertStringArray(template.suggestedObjects, 'suggestedObjects', errors, { allowEmpty: true });
  assertStringArray(template.suggestedActions, 'suggestedActions', errors, { allowEmpty: true });

  if (!isRecord(template.colors)) {
    errors.push('colors must be an object');
  } else {
    for (const key of ['primary', 'secondary']) {
      if (!isHexColor(template.colors[key])) errors.push(`colors.${key} must be a #RRGGBB color`);
    }
    for (const [key, value] of Object.entries(template.colors)) {
      if (!isHexColor(value)) errors.push(`colors.${key} must be a #RRGGBB color`);
    }
  }

  if (!isRecord(template.permissions)) {
    errors.push('permissions must be an object');
  } else {
    for (const key of BUILDING_TEMPLATE_PERMISSION_KEYS) {
      const level = template.permissions[key];
      if (!BUILDING_TEMPLATE_PERMISSION_LEVELS.includes(level)) {
        errors.push(`permissions.${key} must be one of ${BUILDING_TEMPLATE_PERMISSION_LEVELS.join(', ')}`);
      }
    }
    for (const key of Object.keys(template.permissions)) {
      if (!BUILDING_TEMPLATE_PERMISSION_KEYS.includes(key)) warnings.push(`permissions.${key} is not a known template permission key`);
    }
  }

  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze(errors),
    warnings: Object.freeze(warnings),
    normalizedCapabilityTags: Object.freeze([...new Set(normalizedCapabilityTags)]),
  });
}

export function getBuildingTemplateExample(id) {
  return BUILDING_TEMPLATE_EXAMPLES.find(template => template.id === id) || null;
}

for (const template of BUILDING_TEMPLATE_EXAMPLES) {
  const result = validateBuildingTemplate(template);
  if (!result.valid) {
    throw new Error(`Invalid building template example ${template?.id || '<unknown>'}: ${result.errors.join('; ')}`);
  }
}

if (!CAPABILITY_TAGS.length) {
  throw new Error('Capability tags must be loaded before building template schema validation.');
}

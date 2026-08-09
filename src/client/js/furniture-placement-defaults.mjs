export const FURNITURE_PLACEMENT_SCHEMA_VERSION = 2;

export const ARMCHAIR_DEFAULT_COLORS = Object.freeze({
  body: '#7c3aed',
  backArms: '#4c1d95',
  seatCushions: '#a78bfa',
  feet: '#4e342e',
});

const STARTER_FURNITURE_ASSET_CLASSES = Object.freeze({
  desk: 'stationary-persistent-work-desk',
  meetingTable: 'stationary-persistent-sixteen-position-meeting-table',
  pingpong: 'stationary-persistent-recreation-table',
  printerCopier: 'stationary-persistent-office-printer-copier',
  whiteboard: 'stationary-persistent-planning-whiteboard',
  bulletinBoard: 'stationary-persistent-office-bulletin-board',
  bookshelf: 'stationary-persistent-office-bookshelf',
  trashBin: 'stationary-persistent-indoor-trash-bin',
  armchair: 'stationary-persistent-single-comfort-seat',
  vending: 'stationary-persistent-vending-machine',
  waterCooler: 'stationary-persistent-water-cooler',
  counter: 'stationary-persistent-kitchen-counter-with-appliance-slots',
  microwave: 'stationary-persistent-quick-heating-appliance',
  countertopCoffeeMachine: 'stationary-persistent-countertop-beverage-appliance',
});

const ARMCHAIR_ROUTING_DEFAULTS = Object.freeze({
  approachSpotId: 'approach-front',
  seatSpotId: 'seat',
  dismountSpotId: 'stand-front',
  approachOffsetTiles: 1.18,
  seatOffsetTiles: 0.42,
  seatSurfaceLift: 2.08,
  interaction: 'route-to-front-approach-then-dock-at-the-exclusive-seat-and-dismount-through-stand-front',
});

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function mergeMissing(target, defaults) {
  const result = target && typeof target === 'object' && !Array.isArray(target) ? clone(target) : {};
  for (const [key, value] of Object.entries(defaults || {})) {
    if (result[key] == null) result[key] = clone(value);
    else if (value && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = mergeMissing(result[key], value);
    }
  }
  return result;
}

/**
 * Add durable metadata shared by newly placed furniture and the bundled copy.
 * Runtime reservations/activeUse are intentionally omitted because the server
 * strips transient ownership before building data is persisted.
 */
export function normalizeFurniturePlacementDefaults(record = {}) {
  const normalized = clone(record) || {};
  const type = String(normalized.type || '').trim();
  const assetClass = STARTER_FURNITURE_ASSET_CLASSES[type];
  if (!assetClass) return normalized;

  if (!normalized.catalogId) normalized.catalogId = type;
  normalized.stationary = normalized.stationary ?? true;
  normalized.carryable = normalized.carryable ?? false;
  normalized.temporary = normalized.temporary ?? false;
  normalized.persistsUntilDeleted = normalized.persistsUntilDeleted ?? true;
  normalized.assetClass = normalized.assetClass || assetClass;
  const savedSchemaVersion = Number(normalized.furnitureSchemaVersion);
  normalized.furnitureSchemaVersion = Math.max(
    FURNITURE_PLACEMENT_SCHEMA_VERSION,
    Number.isFinite(savedSchemaVersion) ? savedSchemaVersion : 0,
  );
  normalized.lifecycle = mergeMissing(normalized.lifecycle, {
    stationary: true,
    carryable: false,
    temporary: false,
    persistsUntilDeleted: true,
  });

  if (type === 'armchair') {
    normalized.armchairColors = mergeMissing(normalized.armchairColors, ARMCHAIR_DEFAULT_COLORS);
    normalized.lifecycle.routing = mergeMissing(normalized.lifecycle.routing, ARMCHAIR_ROUTING_DEFAULTS);
  }

  return normalized;
}

export function normalizeStarterBuildingFurniture(building = {}) {
  const normalized = clone(building) || {};
  const furniture = normalized.interior?.furniture;
  if (Array.isArray(furniture)) {
    normalized.interior.furniture = furniture.map(normalizeFurniturePlacementDefaults);
  }
  return normalized;
}

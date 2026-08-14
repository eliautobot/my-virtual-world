const SLIDING_GLASS_DOOR_BUILDING_TYPES = new Set(['office', 'store']);

export function getBuildingExteriorDoorType(buildingType = '') {
  const normalizedType = String(buildingType || '').trim().toLowerCase();
  return SLIDING_GLASS_DOOR_BUILDING_TYPES.has(normalizedType) ? 'sliding' : 'swivel';
}

export function isAgentNearAutomaticDoor(agent, doorPoints = [], {
  radiusApi = 60,
  doorwayReachApi = 0,
  apiTile = 40,
} = {}) {
  if (!agent || !Number.isFinite(agent.x) || !Number.isFinite(agent.y)) return false;

  const safeRadius = Number.isFinite(Number(radiusApi)) ? Math.max(0, Number(radiusApi)) : 0;
  const safeReach = Number.isFinite(Number(doorwayReachApi)) ? Math.max(0, Number(doorwayReachApi)) : 0;
  const safeTile = Number.isFinite(Number(apiTile)) ? Math.max(0, Number(apiTile)) : 0;
  const effectiveRadius = Math.max(safeRadius, safeReach + safeTile * 0.4);
  const radiusSq = effectiveRadius * effectiveRadius;

  return doorPoints.some((point) => {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
    const dx = point.x - agent.x;
    const dy = point.y - agent.y;
    return (dx * dx + dy * dy) <= radiusSq;
  });
}

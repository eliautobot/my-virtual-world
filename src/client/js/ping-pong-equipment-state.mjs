const PING_PONG_STATE_FIELDS = Object.freeze([
  '_pingPongSide',
  '_pingPongPaddleColor',
  '_pingPongTrackZ',
  '_pingPongBallZ',
  '_pingPongBallX',
  '_pingPongLastHit',
  '_pingPongSwingPulse',
  '_serverPingPongSwingPulseId',
]);

function pingPongStateText(value) {
  if (typeof value === 'string') return value.toLowerCase();
  if (!value || typeof value !== 'object') return '';
  return [
    value.kind,
    value.visualKind,
    value.label,
    value.id,
    value.catalogId,
    value.sourceFurnitureType,
  ].filter(Boolean).join(' ').toLowerCase();
}

export function isPingPongEquipmentValue(value = null) {
  const text = pingPongStateText(value);
  return text.includes('pingpong') || text.includes('ping pong');
}

export function isPingPongActivityState(activity = null, visualState = null, target = null) {
  const text = [
    activity?.kind,
    activity?.objectType,
    activity?.furnitureType,
    activity?.actionId,
    visualState?.activityKind,
    target?.objectType,
    target?.furnitureType,
    target?.targetKind,
    target?.actionId,
  ].filter(Boolean).join(' ').toLowerCase();
  return text.includes('pingpong') || text.includes('ping pong') || text.includes('playpingpong');
}

export function hasPingPongEquipmentState(agent = null) {
  if (!agent) return false;
  return isPingPongActivityState(agent._idleActivity, agent._runtimeVisualState) ||
    isPingPongEquipmentValue(agent._carriedItem) ||
    isPingPongEquipmentValue(agent._carrying) ||
    isPingPongEquipmentValue(agent._carryItem) ||
    isPingPongEquipmentValue(agent.carryItem) ||
    Boolean(agent._pingPongSide || agent._pingPongPaddleColor);
}

export function isIncomingPingPongRuntimeVisual(visualState = null, snapshotTarget = null) {
  if (!visualState || typeof visualState !== 'object') return false;
  if (visualState.activityActive === false) return false;
  return isPingPongActivityState(visualState.activity, visualState, snapshotTarget) ||
    isPingPongEquipmentValue(visualState.carriedItem);
}

export function clearPingPongEquipmentState(agent = null, { clearActivity = true } = {}) {
  if (!agent) return { cleared: false, clearedActivity: false, clearedCarry: false };
  const hadPingPongState = hasPingPongEquipmentState(agent);
  let clearedActivity = false;
  let clearedCarry = false;

  if (clearActivity && isPingPongActivityState(agent._idleActivity)) {
    agent._idleActivity = null;
    clearedActivity = true;
  }

  for (const key of ['_carriedItem', '_carrying', '_carryItem']) {
    if (!isPingPongEquipmentValue(agent[key])) continue;
    agent[key] = null;
    clearedCarry = true;
  }
  if (isPingPongEquipmentValue(agent.carryItem)) {
    agent.carryItem = null;
    clearedCarry = true;
  }
  if (clearedCarry && !agent._carriedItem && !agent._carrying && !agent._carryItem && !agent.carryItem) {
    agent.carryItemTimer = 0;
  }

  if (hadPingPongState || clearedActivity || clearedCarry) {
    for (const key of PING_PONG_STATE_FIELDS) agent[key] = null;
    agent._runtimePingPongPositionOverride = false;
    if (String(agent._resolvedAnimationId || '').toLowerCase().includes('pingpong')) {
      agent._resolvedAnimationId = null;
    }
    if (clearActivity && isPingPongActivityState(agent._runtimeVisualState?.activity, agent._runtimeVisualState)) {
      const replacementCarry = agent._carriedItem || agent._carrying || agent._carryItem || agent.carryItem || null;
      agent._runtimeVisualState = {
        ...(agent._runtimeVisualState || {}),
        activityActive: false,
        activityKind: '',
        activity: null,
        carrying: Boolean(replacementCarry),
        carriedItem: replacementCarry && typeof replacementCarry === 'object' ? replacementCarry : null,
        pingPong: null,
      };
    }
  }

  return {
    cleared: hadPingPongState || clearedActivity || clearedCarry,
    clearedActivity,
    clearedCarry,
  };
}

export function reconcilePingPongEquipmentTransition(agent = null, visualState = null, snapshotTarget = null) {
  const hadPingPongState = hasPingPongEquipmentState(agent);
  const incomingPingPong = isIncomingPingPongRuntimeVisual(visualState, snapshotTarget);
  if (!hadPingPongState || incomingPingPong) {
    return { exitedPingPong: false, hadPingPongState, incomingPingPong, cleared: false };
  }
  return {
    exitedPingPong: true,
    hadPingPongState,
    incomingPingPong,
    ...clearPingPongEquipmentState(agent, { clearActivity: true }),
  };
}

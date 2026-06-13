import {
  isPhysicsReady,
  probeObstacleAt,
  getColliderHandle,
} from './physics.js';

export const OBSTACLE_AVOIDANCE = {
  enabled: true,
  interiorsOnly: false,
  // PERF: debug overlays default OFF — when on, every agent fires extra sensor
  // raycasts + scene searches every frame just to feed the debug visuals.
  // Toggle at runtime via Settings → movement debug overlays.
  debug: false,
  probeRadius: 0.2,
  probeHeight: 1.4,
  frontProbeDistance: 0.95,
  sideProbeDistance: 0.72,
  sideOffset: 0.42,
  minFollowMs: 420,
  clearExitMs: 240,
  sideLockMs: 900,
  stuckMs: 850,
  recoverMs: 320,
  targetBias: 0.08,
  avoidBias: 0.96,
  turnMemory: 0.72,
  farTargetDistance: 140,
  farTargetPullBoost: 0.22,
  reversePenalty: 14,
  maxAvoidTurnDeg: 85,
  cornerReverseWeight: 0.84,
  cornerRecoverMs: 520,
  maxLookahead: 8.0,
  directPathProbeStep: 0.35,
  maxSamplePoints: 24,
  minSpeed: 0.0001,
  sideSwitchPenalty: 1.0,
  sideSwitchFavorMargin: 1.0,
  wedgedEnterMs: 150,
  cornerEnterMs: 180,
  goalProgressStuckMs: 420,
  goalProgressEpsilon: 0.35,
  recoverReleaseMs: 140,
};

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

function length2(x, z) {
  return Math.sqrt(x * x + z * z);
}

function normalize(x, z) {
  const len = length2(x, z);
  if (len < 0.00001) return { x: 0, z: 0, len: 0 };
  return { x: x / len, z: z / len, len };
}

function rotate(vec, deg) {
  const rad = deg * Math.PI / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return {
    x: vec.x * c - vec.z * s,
    z: vec.x * s + vec.z * c,
  };
}

function blendDirections(primary, secondary, primaryWeight = 0.8) {
  const w1 = clamp01(primaryWeight);
  const w2 = 1 - w1;
  return normalize(primary.x * w1 + secondary.x * w2, primary.z * w1 + secondary.z * w2);
}

function ensureState(agent) {
  if (!agent._avoid) {
    agent._avoid = {
      mode: 'seek',
      side: 0,
      timerMs: 0,
      clearMs: 0,
      stuckMs: 0,
      goalStuckMs: 0,
      wedgedMs: 0,
      cornerMs: 0,
      steerDir: null,
      lastX: agent.x,
      lastY: agent.y,
      lastTargetDistance: null,
      lastSideSwitchMs: Infinity,
      recoverAttempts: 0,
      debug: null,
    };
  }
  return agent._avoid;
}

function clearToSeek(state, agent) {
  if (!state || !agent) return;
  state.mode = 'seek';
  state.side = 0;
  state.timerMs = 0;
  state.clearMs = 0;
  state.stuckMs = 0;
  state.goalStuckMs = 0;
  state.wedgedMs = 0;
  state.cornerMs = 0;
  state.steerDir = null;
  state.lastX = agent.x;
  state.lastY = agent.y;
  state.lastTargetDistance = null;
  state.lastSideSwitchMs = Infinity;
}

function setAvoidSide(state, nextSide) {
  if (!state) return nextSide || -1;
  const resolved = nextSide || state.side || -1;
  if (state.side !== resolved) state.lastSideSwitchMs = 0;
  state.side = resolved;
  return state.side;
}

export function resetObstacleAvoidance(agent) {
  if (!agent) return;
  if (agent._avoid) {
    clearToSeek(agent._avoid, agent);
    agent._avoid.debug = null;
    agent._avoid.recoverAttempts = 0;
  }
}

function probeAt(worldX, worldZ, radius, selfHandle, cfg) {
  return probeObstacleAt(worldX, worldZ, radius, {
    y: cfg.probeHeight * 0.5,
    height: cfg.probeHeight,
    ignoreHandles: selfHandle != null ? [selfHandle] : [],
  });
}

function sampleSensors(agent, dir, selfHandle, cfg) {
  const left = { x: -dir.z, z: dir.x };
  const right = { x: dir.z, z: -dir.x };
  const worldScale = cfg.worldScale || 1;
  const axWorld = agent.x * worldScale;
  const azWorld = agent.y * worldScale;

  const sample = (label, dxWorld, dzWorld, radius = cfg.probeRadius) => {
    const worldX = axWorld + dxWorld;
    const worldZ = azWorld + dzWorld;
    const hit = probeAt(worldX, worldZ, radius, selfHandle, cfg);
    const centers = (hit.centers || []).map(center => ({
      ...center,
      x: center.x / worldScale,
      z: center.z / worldScale,
    }));
    return {
      label,
      x: worldX / worldScale,
      z: worldZ / worldScale,
      ...hit,
      centers,
    };
  };

  return {
    front: sample('front', dir.x * cfg.frontProbeDistance, dir.z * cfg.frontProbeDistance),
    frontLeft: sample(
      'frontLeft',
      dir.x * cfg.frontProbeDistance + left.x * cfg.sideOffset,
      dir.z * cfg.frontProbeDistance + left.z * cfg.sideOffset,
    ),
    frontRight: sample(
      'frontRight',
      dir.x * cfg.frontProbeDistance + right.x * cfg.sideOffset,
      dir.z * cfg.frontProbeDistance + right.z * cfg.sideOffset,
    ),
    sideLeft: sample('sideLeft', left.x * cfg.sideProbeDistance, left.z * cfg.sideProbeDistance, cfg.probeRadius * 0.9),
    sideRight: sample('sideRight', right.x * cfg.sideProbeDistance, right.z * cfg.sideProbeDistance, cfg.probeRadius * 0.9),
  };
}

function directPathLooksClear(agent, target, selfHandle, cfg) {
  if (!target) return true;
  const worldScale = cfg.worldScale || 1;
  const ax = agent.x * worldScale;
  const az = agent.y * worldScale;
  const tx = target.x * worldScale;
  const tz = target.y * worldScale;
  const dx = tx - ax;
  const dz = tz - az;
  const dist = Math.sqrt(dx * dx + dz * dz);
  if (dist < cfg.frontProbeDistance) return true;

  const scanDist = Math.min(dist, cfg.maxLookahead);
  const steps = Math.max(1, Math.min(cfg.maxSamplePoints, Math.ceil(scanDist / cfg.directPathProbeStep)));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const px = ax + dx * t;
    const pz = az + dz * t;
    const hit = probeAt(px, pz, cfg.probeRadius, selfHandle, cfg);
    if (hit.hit) return false;
  }
  return true;
}

function pickAvoidSide(state, sensors, cfg, forceSwitch = false) {
  const leftPenalty = (sensors.frontLeft.hit ? 2 : 0) + (sensors.sideLeft.hit ? 1 : 0);
  const rightPenalty = (sensors.frontRight.hit ? 2 : 0) + (sensors.sideRight.hit ? 1 : 0);
  let preferred = -1;

  if (leftPenalty !== rightPenalty) {
    preferred = leftPenalty < rightPenalty ? -1 : 1;
  } else if (sensors.sideLeft.hit !== sensors.sideRight.hit) {
    preferred = sensors.sideLeft.hit ? 1 : -1;
  } else if (state.side) {
    preferred = state.side;
  }

  if (!forceSwitch && state.side) {
    const currentPenalty = state.side < 0 ? leftPenalty : rightPenalty;
    const altPenalty = state.side < 0 ? rightPenalty : leftPenalty;
    const margin = Number(cfg.sideSwitchFavorMargin) || 1;
    const locked = state.lastSideSwitchMs < (Number(cfg.sideLockMs) || 900);
    if (locked || altPenalty + margin >= currentPenalty) {
      return state.side;
    }
  }

  return preferred;
}

function evaluateDirection(agent, desiredDir, candidateDir, selfHandle, cfg, routePriority = null) {
  const worldScale = cfg.worldScale || 1;
  const ax = agent.x * worldScale;
  const az = agent.y * worldScale;
  const near = probeAt(
    ax + candidateDir.x * (cfg.frontProbeDistance * 0.45),
    az + candidateDir.z * (cfg.frontProbeDistance * 0.45),
    cfg.probeRadius,
    selfHandle,
    cfg,
  );
  const far = probeAt(
    ax + candidateDir.x * cfg.frontProbeDistance,
    az + candidateDir.z * cfg.frontProbeDistance,
    cfg.probeRadius,
    selfHandle,
    cfg,
  );
  const alignment = candidateDir.x * desiredDir.x + candidateDir.z * desiredDir.z;
  const reversePenalty = Math.max(0, -alignment) * (Number(cfg.reversePenalty) || 14);
  const routeDir = routePriority?.dir
    ? normalize(routePriority.dir.x || 0, routePriority.dir.z || 0)
    : null;
  const routeAlignment = routeDir?.len ? (candidateDir.x * routeDir.x + candidateDir.z * routeDir.z) : alignment;
  const routeScoreBoost = Math.max(0, Number(routePriority?.scoreBoost) || 0) * clamp01(Number(routePriority?.weight) || 0);
  const routeBacktrackPenalty = Math.max(0, -routeAlignment) * (Number(routePriority?.backtrackPenalty) || 0);
  const sideSwitchPenalty = (routePriority?.sideSwitchPenalty || 0);
  const score = alignment * 12 + routeAlignment * routeScoreBoost - reversePenalty - routeBacktrackPenalty - sideSwitchPenalty - near.count * 80 - far.count * 40;
  return { near, far, alignment, routeAlignment, routeScoreBoost, routeBacktrackPenalty, sideSwitchPenalty, score, blocked: near.hit || far.hit };
}

function chooseCandidateDirection(agent, desiredDir, baseDir, side, selfHandle, cfg, routePriority = null) {
  const maxTurn = Math.max(55, Math.min(89, Number(cfg.maxAvoidTurnDeg) || 85));
  const sideAngles = side < 0
    ? [30, 45, 60, 75, maxTurn]
    : [-30, -45, -60, -75, -maxTurn];

  let best = null;
  let bestUnblocked = null;
  for (const angle of sideAngles) {
    const rotatedVec = rotate(baseDir, angle);
    const rotated = normalize(rotatedVec.x, rotatedVec.z);
    const evaln = evaluateDirection(agent, desiredDir, rotated, selfHandle, cfg, routePriority);
    const candidate = { angle, dir: rotated, ...evaln };
    if (!best || candidate.score > best.score) best = candidate;
    if (!candidate.blocked && (!bestUnblocked || candidate.score > bestUnblocked.score)) {
      bestUnblocked = candidate;
    }
  }

  return bestUnblocked || best;
}

function computeRecoverDirection(desiredDir, side, hardTurn = false, reverseWeight = null) {
  const reverse = { x: -desiredDir.x, z: -desiredDir.z };
  const lateral = side < 0
    ? { x: -desiredDir.z, z: desiredDir.x }
    : { x: desiredDir.z, z: -desiredDir.x };
  if (reverseWeight != null) {
    return blendDirections(reverse, lateral, clamp01(reverseWeight));
  }
  return hardTurn
    ? blendDirections(lateral, reverse, 0.68)
    : blendDirections(lateral, reverse, 0.76);
}

export function sampleObstacleAvoidanceDebug(agent, target, options = {}) {
  const cfg = { ...OBSTACLE_AVOIDANCE, ...options };
  if (!cfg.enabled || !agent || !target || !isPhysicsReady()) return null;

  const desired = normalize((target.x || 0) - agent.x, (target.y || 0) - agent.y);
  if (desired.len < cfg.minSpeed) return null;

  const selfHandle = getColliderHandle(`agent_${agent.id}`);
  const state = ensureState(agent);
  const goalSensors = sampleSensors(agent, desired, selfHandle, cfg);
  const steerBasis = (state.mode !== 'seek' && state.steerDir)
    ? normalize(state.steerDir.x || 0, state.steerDir.z || 0)
    : desired;
  const probeDir = steerBasis.len >= cfg.minSpeed ? steerBasis : desired;
  const sensors = sampleSensors(agent, probeDir, selfHandle, cfg);
  const directClear = !goalSensors.front.hit && directPathLooksClear(agent, target, selfHandle, cfg);
  return {
    mode: state.mode,
    side: state.side,
    sensors,
    goalSensors,
    directClear,
    immediateCollisionPressure: Object.values(sensors).some(sample => !!sample?.hit) || Object.values(goalSensors).some(sample => !!sample?.hit),
    target: { x: (target.x || 0) - agent.x, z: (target.y || 0) - agent.y },
    desired: { x: desired.x, z: desired.z },
    desiredMove: { x: desired.x, z: desired.z },
    chosen: state.steerDir ? { x: state.steerDir.x || 0, z: state.steerDir.z || 0 } : { x: desired.x, z: desired.z },
    chosenMove: state.steerDir ? { x: state.steerDir.x || 0, z: state.steerDir.z || 0 } : { x: desired.x, z: desired.z },
  };
}

export function adjustMoveForObstacles(agent, desiredMove, target, dtMs = 16, options = {}) {
  const cfg = { ...OBSTACLE_AVOIDANCE, ...options };
  if (!cfg.enabled || !agent || !desiredMove || !target || !isPhysicsReady()) {
    resetObstacleAvoidance(agent);
    return desiredMove;
  }

  const desired = normalize(desiredMove.x || 0, desiredMove.z || 0);
  if (desired.len < cfg.minSpeed) {
    resetObstacleAvoidance(agent);
    return desiredMove;
  }

  const state = ensureState(agent);
  const selfHandle = getColliderHandle(`agent_${agent.id}`);
  const speed = desired.len;
  state.lastSideSwitchMs += dtMs;
  state.timerMs += dtMs;

  const movedSinceLast = Math.hypot(agent.x - (state.lastX ?? agent.x), agent.y - (state.lastY ?? agent.y));
  const minProgress = Math.max(0.01, speed * 0.12);
  state.stuckMs = movedSinceLast < minProgress ? state.stuckMs + dtMs : 0;
  state.lastX = agent.x;
  state.lastY = agent.y;

  const goalSensors = sampleSensors(agent, desired, selfHandle, cfg);
  const steerBasis = (state.mode !== 'seek' && state.steerDir)
    ? normalize(state.steerDir.x || 0, state.steerDir.z || 0)
    : desired;
  const probeDir = steerBasis.len >= cfg.minSpeed ? steerBasis : desired;
  const sensors = sampleSensors(agent, probeDir, selfHandle, cfg);
  const directClear = !goalSensors.front.hit && directPathLooksClear(agent, target, selfHandle, cfg);
  const anySteerSensorHit = Object.values(sensors).some(sample => !!sample?.hit);
  const anyGoalSensorHit = Object.values(goalSensors).some(sample => !!sample?.hit);
  const immediateCollisionPressure = anySteerSensorHit || anyGoalSensorHit;
  const wedged = !!(sensors.front.hit && sensors.frontLeft.hit && sensors.frontRight.hit);
  const cornered = !!(
    sensors.front.hit && (
      (sensors.frontLeft.hit && sensors.sideLeft.hit) ||
      (sensors.frontRight.hit && sensors.sideRight.hit) ||
      (sensors.sideLeft.hit && sensors.sideRight.hit)
    )
  );
  state.wedgedMs = wedged ? state.wedgedMs + dtMs : 0;
  state.cornerMs = cornered ? state.cornerMs + dtMs : 0;
  const trapPressure = wedged || cornered || state.wedgedMs >= (Number(cfg.wedgedEnterMs) || 150) || state.cornerMs >= (Number(cfg.cornerEnterMs) || 180);

  const targetVector = target
    ? { x: (target.x || 0) - agent.x, z: (target.y || 0) - agent.y }
    : null;
  const targetDistance = targetVector ? Math.hypot(targetVector.x, targetVector.z) : 0;
  const targetProgress = state.lastTargetDistance != null ? (state.lastTargetDistance - targetDistance) : Infinity;
  const minGoalProgress = Math.max(Number(cfg.goalProgressEpsilon) || 0.35, speed * 0.06);
  state.goalStuckMs = targetProgress >= minGoalProgress ? 0 : (state.goalStuckMs + dtMs);
  state.lastTargetDistance = targetDistance;
  const progressStalled = state.goalStuckMs >= (Number(cfg.goalProgressStuckMs) || 420);
  const farTargetPull = clamp01(targetDistance / Math.max(1, Number(cfg.farTargetDistance) || 140));
  const routePriority = options.routePriority?.dir
    ? {
        dir: normalize(options.routePriority.dir.x || 0, options.routePriority.dir.z || 0),
        weight: clamp01(Number(options.routePriority.weight) || 0),
        targetWeight: clamp01(Number(options.routePriority.targetWeight) || 0),
        scoreBoost: Math.max(0, Number(options.routePriority.scoreBoost) || 0),
        backtrackPenalty: Math.max(0, Number(options.routePriority.backtrackPenalty) || 0),
        lookaheadSteps: Math.max(0, Number(options.routePriority.lookaheadSteps) || 0),
        waypointIndex: Math.max(0, Number(options.routePriority.waypointIndex) || 0),
      }
    : null;
  const suppressRoutePriority = !!(routePriority && (state.mode === 'recover' || trapPressure || progressStalled));
  const effectiveRoutePriority = suppressRoutePriority ? null : routePriority;
  const preferredDir = effectiveRoutePriority?.dir?.len
    ? blendDirections(effectiveRoutePriority.dir, desired, effectiveRoutePriority.targetWeight)
    : desired;
  const copyVec = (vec) => ({ x: Number(vec?.x) || 0, z: Number(vec?.z) || 0 });
  const buildDebug = (chosenMove, extra = {}) => ({
    mode: state.mode,
    side: state.side,
    sensors,
    goalSensors,
    directClear,
    anySteerSensorHit,
    anyGoalSensorHit,
    immediateCollisionPressure,
    desired: copyVec(desired),
    desiredMove: copyVec(desiredMove),
    target: targetVector ? copyVec(targetVector) : null,
    routePriority: routePriority
      ? {
          dir: copyVec(routePriority.dir),
          weight: routePriority.weight,
          targetWeight: routePriority.targetWeight,
          scoreBoost: routePriority.scoreBoost,
          backtrackPenalty: routePriority.backtrackPenalty,
          lookaheadSteps: routePriority.lookaheadSteps,
          waypointIndex: routePriority.waypointIndex,
          suppressed: suppressRoutePriority,
        }
      : null,
    chosen: copyVec(chosenMove),
    chosenMove: copyVec(chosenMove),
    speed,
    wedged,
    cornered,
    trapPressure,
    targetDistance,
    targetProgress,
    goalStuckMs: state.goalStuckMs,
    wedgedMs: state.wedgedMs,
    cornerMs: state.cornerMs,
    farTargetPull,
    recoverAttempts: state.recoverAttempts,
    ...extra,
  });

  if (state.mode === 'recover') {
    if (!immediateCollisionPressure) {
      state.clearMs += dtMs;
      const minRecoverHold = trapPressure ? Math.max((Number(cfg.cornerRecoverMs) || 520) * 0.45, Number(cfg.recoverReleaseMs) || 140) : Math.max(90, (Number(cfg.recoverMs) || 320) * 0.35);
      if (state.clearMs >= (Number(cfg.recoverReleaseMs) || 140) && state.timerMs >= minRecoverHold) {
        clearToSeek(state, agent);
        state.debug = buildDebug(desiredMove, { mode: 'seek', side: 0, releaseReason: 'recover-cleared' });
        return desiredMove;
      }
    } else {
      state.clearMs = 0;
    }

    const activeCornerReverse = trapPressure || progressStalled || state.stuckMs >= cfg.stuckMs;
    const recoverLimitMs = activeCornerReverse ? Math.max(Number(cfg.cornerRecoverMs) || 520, Number(cfg.recoverMs) || 320) : (Number(cfg.recoverMs) || 320);
    if (state.timerMs >= recoverLimitMs && immediateCollisionPressure) {
      state.mode = state.side < 0 ? 'avoid-left' : 'avoid-right';
      state.timerMs = 0;
      state.clearMs = 0;
      state.steerDir = null;
      setAvoidSide(state, pickAvoidSide(state, sensors, cfg, true));
    }

    const recoverDir = computeRecoverDirection(
      desired,
      state.side || 1,
      true,
      activeCornerReverse ? (Number(cfg.cornerReverseWeight) || 0.84) : null,
    );
    const recoverMove = { x: recoverDir.x * speed, z: recoverDir.z * speed };
    state.debug = buildDebug(recoverMove, { activeCornerReverse, recoverLimitMs });
    return recoverMove;
  }

  if (state.mode !== 'seek') {
    if (!immediateCollisionPressure) {
      clearToSeek(state, agent);
      state.debug = buildDebug(desiredMove, { mode: 'seek', side: 0, releaseReason: 'no-collision-pressure' });
      return desiredMove;
    }
    state.clearMs = directClear ? (state.clearMs + dtMs) : 0;
    if (state.clearMs >= cfg.clearExitMs && state.timerMs >= cfg.minFollowMs && !trapPressure) {
      clearToSeek(state, agent);
      state.debug = buildDebug(desiredMove, { mode: 'seek', side: 0 });
      return desiredMove;
    } else if (trapPressure || progressStalled || state.stuckMs >= cfg.stuckMs) {
      state.mode = 'recover';
      state.timerMs = 0;
      state.clearMs = 0;
      state.steerDir = null;
      state.recoverAttempts += 1;
      setAvoidSide(state, pickAvoidSide(state, sensors, cfg));
      const forceReverse = cornered || progressStalled || state.stuckMs >= cfg.stuckMs;
      const recoverDir = computeRecoverDirection(
        desired,
        state.side,
        wedged || trapPressure || forceReverse,
        forceReverse ? (Number(cfg.cornerReverseWeight) || 0.84) : null,
      );
      const recoverMove = { x: recoverDir.x * speed, z: recoverDir.z * speed };
      state.debug = buildDebug(recoverMove, { forceReverse, enteredRecover: true });
      return recoverMove;
    }
  }

  if (state.mode === 'seek') {
    const earlyAvoidTrigger = trapPressure || progressStalled || (immediateCollisionPressure && !directClear);
    if (!goalSensors.front.hit && !earlyAvoidTrigger) {
      state.debug = buildDebug(desiredMove);
      return desiredMove;
    }
    const sensorSet = goalSensors.front.hit ? goalSensors : sensors;
    setAvoidSide(state, pickAvoidSide(state, sensorSet, cfg));
    state.mode = (trapPressure || progressStalled) ? 'recover' : (state.side < 0 ? 'avoid-left' : 'avoid-right');
    state.timerMs = 0;
    state.clearMs = 0;
    state.steerDir = null;
    if (trapPressure || progressStalled) {
      state.recoverAttempts += 1;
      const forceReverse = cornered || progressStalled;
      const recoverDir = computeRecoverDirection(
        desired,
        state.side,
        true,
        forceReverse ? (Number(cfg.cornerReverseWeight) || 0.84) : null,
      );
      const recoverMove = { x: recoverDir.x * speed, z: recoverDir.z * speed };
      state.debug = buildDebug(recoverMove, { side: state.side, forceReverse, enteredRecover: true });
      return recoverMove;
    }
  }

  const side = state.side || -1;
  const candidate = chooseCandidateDirection(agent, desired, probeDir, side, selfHandle, cfg, effectiveRoutePriority ? {
    ...effectiveRoutePriority,
    sideSwitchPenalty: state.lastSideSwitchMs < (Number(cfg.sideLockMs) || 900) ? Number(cfg.sideSwitchPenalty) || 1 : 0,
  } : null);
  const frontBlockedHard = !!(sensors.front.hit && (sensors.frontLeft.hit || sensors.frontRight.hit));
  if (!candidate || candidate.score < -100 || (candidate.blocked && frontBlockedHard)) {
    state.mode = 'recover';
    state.timerMs = 0;
    state.clearMs = 0;
    state.steerDir = null;
    state.recoverAttempts += 1;
    setAvoidSide(state, pickAvoidSide(state, sensors, cfg, true));
    const recoverDir = computeRecoverDirection(desired, state.side || side, true, trapPressure ? (Number(cfg.cornerReverseWeight) || 0.84) : null);
    const recoverMove = { x: recoverDir.x * speed, z: recoverDir.z * speed };
    state.debug = buildDebug(recoverMove, { candidate, enteredRecover: true, failureReason: 'candidate-blocked' });
    return recoverMove;
  }

  const followWeight = state.mode === 'seek'
    ? clamp01((1 - cfg.targetBias) - farTargetPull * ((Number(cfg.farTargetPullBoost) || 0.22) * 0.45))
    : clamp01(
        cfg.avoidBias -
        farTargetPull * (Number(cfg.farTargetPullBoost) || 0.22) -
        (directClear ? 0.45 : (candidate.blocked ? 0.12 : 0.28))
      );
  const baseDir = blendDirections(candidate.dir, preferredDir, followWeight);
  const steerMemory = state.mode === 'seek'
    ? Math.max(0.18, cfg.turnMemory - farTargetPull * 0.08)
    : (directClear
        ? Math.min(cfg.turnMemory, 0.34)
        : Math.max(0.22, cfg.turnMemory - farTargetPull * 0.16));
  const smoothed = state.steerDir
    ? blendDirections(baseDir, state.steerDir, steerMemory)
    : baseDir;
  state.steerDir = { x: smoothed.x, z: smoothed.z };
  const blended = smoothed;
  const adjustedMove = { x: blended.x * speed, z: blended.z * speed };
  state.debug = buildDebug(adjustedMove, { candidate });
  return adjustedMove;
}

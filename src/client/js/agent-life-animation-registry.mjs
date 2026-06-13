/**
 * Agent Life animation registry foundation.
 *
 * Phase 0.5 technical spine for interaction animation names and trigger
 * metadata. It centralizes the semantic animation ids used by object actions,
 * world actions, and the current voxel character runtime without importing
 * Three.js or mutating live agent state by side effect.
 */

export const AGENT_ANIMATION_REGISTRY_API_VERSION = 'agent-life-animation-registry/v1';

export const AGENT_ANIMATION_IDS = Object.freeze([
  'sit',
  'stand-use',
  'interior-door-pass-through',
  'stand-pickup-setdown',
  'microwave-use',
  'fridge-use',
  'grill-cook',
  'park-bench-sit-rest-read-talk',
  'bus-stop-wait',
  'crosswalk-cross',
  'path-node-stroll',
  'outdoor-cafe-table-sit-eat-drink-talk',
  'standing-desk-work',
  'office-chair-work',
  'plan-draw',
  'write-teach',
  'cook',
  'drink-eat',
  'vending-machine-use',
  'carry-right-hand',
  'drop-off',
  'sleep-lie',
  'run-in-place',
  'train-practice',
  'select-weights',
  'gym-bench-exercise',
  'hallway-bench-wait',
  'stand-teach-point',
  'inspect-browse',
  'tv-stand-remote-inspect',
  'printer-scanner-use',
  'laptop-monitor-work',
  'diagnostic-station-use',
  'tool-cart-select',
  'workbench-tool-use',
  'storage-boxes-inspect-open',
  'checkout-service',
  'service-checkup',
  'play-game',
  'playground-slide-play',
  'playground-swing-sit-swing',
  'dispose',
  'gather-talk',
  'gazebo-pavilion-social-rest',
  'pond-dock-view-relax',
  'outdoor-stage-perform-watch-gather',
  'shade-tree-relax-read-gather',
]);

export const AGENT_ANIMATION_TRIGGER_KINDS = Object.freeze([
  'runtime-flag',
  'world-action',
  'action-location-role',
  'asset-id',
  'capability-tag',
  'fallback',
]);

export const AGENT_ANIMATION_BLEND_MODES = Object.freeze(['replace', 'upper-body-overlay', 'right-hand-overlay']);

export const AGENT_ANIMATION_REGISTRY_CONTRACT = Object.freeze([
  Object.freeze({ key: 'id', required: true, meaning: 'Stable canonical semantic animation id referenced by world actions, object actions, and runtime adapters.' }),
  Object.freeze({ key: 'label', required: true, meaning: 'Human-readable interaction name for editor/browser inspection.' }),
  Object.freeze({ key: 'triggerKinds', required: true, meaning: 'Kinds of signals that may select the animation: runtime flags, world actions, action-location roles, assets, capability tags, or fallback.' }),
  Object.freeze({ key: 'triggers', required: true, meaning: 'Normalized trigger lists for action ids, action patterns, roles, assets, runtime flags, and capability tags.' }),
  Object.freeze({ key: 'pose', required: true, meaning: 'Pose hints consumed by the character runtime or later clip system without embedding Three.js state in the registry.' }),
  Object.freeze({ key: 'runtimeAdapters', required: true, meaning: 'Current call sites and flags this animation maps to during Phase 0.5.' }),
]);

export const AGENT_ANIMATION_REGISTRY_RULES = Object.freeze([
  'Animation entries are metadata only: importing the registry must not move agents, create meshes, enqueue world actions, or persist state.',
  'World actions and object catalog actions should reference animationId instead of inventing new one-off pose names.',
  'Runtime flags remain adapter inputs. The registry owns canonical names and trigger priority, not simulation state.',
  'Carry/drop-off animations are overlays: the right-hand overlay can compose with walking or standing without replacing route movement.',
  'Action-location roles and asset ids are hints; explicit worldAction.animationId or actionId matches take priority.',
  'Animation ids are semantic and clip-agnostic so later GLTF/voxel clip systems can implement the same contract.',
]);

const DEFAULT_ANIMATION_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: 'sit',
    label: 'Sit',
    priority: 58,
    triggerKinds: Object.freeze(['action-location-role', 'asset-id', 'world-action']),
    triggers: Object.freeze({ roles: Object.freeze(['seat']), assets: Object.freeze(['chair', 'officeChair', 'conferenceChair', 'couch', 'sectionalSofa', 'loveseat', 'armchair', 'hallwayBench', 'barStool', 'diningChair', 'patioChair', 'barberChair', 'examChair', 'diningTable', 'smallCafeTable', 'outdoorCafeTable', 'picnicTable', 'patioTable', 'smallRoundMeetingTable']), actionPatterns: Object.freeze(['sit', 'rest', 'perch', 'waitAtHallwayBench', 'restAtHallwayBench', 'editHair', 'editAppearance', 'sitAtConferenceChair', 'examChairCheckup', 'SmallCafeTable', 'patioTable', 'smallRoundMeetingTable']) }),
    pose: Object.freeze({ stance: 'seated', locomotion: 'stationary', blendMode: 'replace', bodyLean: 0.18, armMode: 'relaxed' }),
    runtimeAdapters: Object.freeze({ currentBranches: Object.freeze(['agent-characters.js couch/sectional-sofa/loveseat/armchair/bar-stool/barber-chair/conference-chair seated branch', 'future seated object actions']), currentFlags: Object.freeze(['isCouchLounging', 'isSectionalSofaLounging', 'isLoveseatLounging', 'isArmchairLounging', 'isBarStoolSitting', 'isBarberChairSitting', 'isConferenceChairSitting']) }),
  }),
  Object.freeze({
    id: 'office-chair-work',
    label: 'Office Chair Seated Work',
    priority: 72,
    triggerKinds: Object.freeze(['runtime-flag', 'world-action', 'asset-id', 'action-location-role', 'capability-tag']),
    triggers: Object.freeze({ runtimeFlags: Object.freeze(['agent._idleActivity.kind=office-chair-work']), roles: Object.freeze(['seat', 'work']), assets: Object.freeze(['officeChair']), actionPatterns: Object.freeze(['workAtOfficeChair', 'sitAtOfficeChair', 'office chair work', 'task chair work']), capabilityTags: Object.freeze(['planning.review']) }),
    pose: Object.freeze({ stance: 'seated', locomotion: 'stationary', blendMode: 'replace', bodyLean: 0.13, armMode: 'typing-focus-idle' }),
    runtimeAdapters: Object.freeze({ currentBranches: Object.freeze(['main3d.js officeChair work action route', 'agent-characters.js OFFICE CHAIR SEATED WORK INTERACTION branch']), currentFlags: Object.freeze(['agent._idleActivity.kind=office-chair-work', 'agent._schedPhase=office-chair-stand-up']) }),
  }),
  Object.freeze({
    id: 'stand-use',
    label: 'Stand / Use',
    priority: 20,
    triggerKinds: Object.freeze(['fallback', 'world-action', 'action-location-role']),
    triggers: Object.freeze({ roles: Object.freeze(['use', 'approach']), assets: Object.freeze(['waterCooler', 'coffeeMachine', 'countertopCoffeeMachine', 'microwave', 'fridge', 'grill', 'coffeePickupShelf', 'cafeCounter', 'checkoutCounter', 'checkoutRegister', 'outdoorCafeTable', 'patioTable', 'receptionDesk']), actionPatterns: Object.freeze(['use', 'greet', 'wash', 'getWater', 'water', 'getCoffee', 'coffee', 'brew', 'heatFood', 'microwave', 'getFridgeSnack', 'fridge', 'cookAtGrill', 'grill', 'orderFood', 'order', 'pickupCoffeeOrder', 'checkoutPurchase', 'checkout', 'wait', 'pay', 'reception', 'checkIn', 'visitor', 'PatioTable']) }),
    pose: Object.freeze({ stance: 'standing', locomotion: 'stationary', blendMode: 'replace', bodyLean: 0.08, armMode: 'reach' }),
    runtimeAdapters: Object.freeze({ currentBranches: Object.freeze(['agent-characters.js idle stand/use fallback']), currentFlags: Object.freeze(['!isMoving']) }),
  }),
  Object.freeze({
    id: 'interior-door-pass-through',
    label: 'Interior Door Open / Close / Pass Through',
    priority: 83,
    triggerKinds: Object.freeze(['runtime-flag', 'world-action', 'action-location-role', 'asset-id', 'capability-tag']),
    triggers: Object.freeze({ runtimeFlags: Object.freeze(['agent._idleActivity.kind=interior-door-*']), roles: Object.freeze(['approach', 'use', 'pass-through']), assets: Object.freeze(['interiorDoor']), actionPatterns: Object.freeze(['openInteriorDoor', 'closeInteriorDoor', 'passThroughInteriorDoor', 'interior door', 'door pass', 'pass-through']), capabilityTags: Object.freeze(['world.structure']) }),
    pose: Object.freeze({ stance: 'standing', locomotion: 'transition-step', blendMode: 'replace', bodyLean: 0.12, armMode: 'reach-handle-open-step-through-close' }),
    runtimeAdapters: Object.freeze({ currentBranches: Object.freeze(['main3d.js interior-door route transition activity', 'agent-characters.js stand/use fallback while door route completes']), currentFlags: Object.freeze(['agent._idleActivity.kind=interior-door-*']) }),
  }),
  Object.freeze({
    id: 'hallway-bench-wait',
    label: 'Hallway Bench Sit / Stand / Waiting Idle',
    priority: 86,
    triggerKinds: Object.freeze(['runtime-flag', 'world-action', 'asset-id', 'action-location-role', 'capability-tag']),
    triggers: Object.freeze({ runtimeFlags: Object.freeze(['agent._idleActivity.kind=hallway-bench-*']), roles: Object.freeze(['seat', 'wait']), assets: Object.freeze(['hallwayBench']), actionPatterns: Object.freeze(['restAtHallwayBench', 'waitAtHallwayBench', 'hallway bench', 'waiting bench', 'wait here']), capabilityTags: Object.freeze(['life.rest', 'planning.schedule']) }),
    pose: Object.freeze({ stance: 'seated', locomotion: 'stationary', blendMode: 'replace', bodyLean: 0.16, armMode: 'relaxed-waiting-idle' }),
    runtimeAdapters: Object.freeze({ currentBranches: Object.freeze(['agent-characters.js hallway bench seated waiting branch']), currentFlags: Object.freeze(['agent._idleActivity.kind=hallway-bench-*', 'agent._schedPhase=hallway-bench-stand-up']) }),
  }),
  Object.freeze({
    id: 'park-bench-sit-rest-read-talk',
    label: 'Park Bench Sit / Rest / Read / Socialize',
    priority: 87,
    triggerKinds: Object.freeze(['runtime-flag', 'world-action', 'asset-id', 'action-location-role', 'capability-tag']),
    triggers: Object.freeze({ runtimeFlags: Object.freeze(['agent._idleActivity.kind=park-bench-*']), roles: Object.freeze(['seat', 'rest', 'read', 'social', 'talk']), assets: Object.freeze(['parkBench']), actionPatterns: Object.freeze(['sitAtBench', 'restAtBench', 'readAtBench', 'socialAtBench', 'park bench', 'outdoor bench']), capabilityTags: Object.freeze(['life.rest', 'life.social', 'planning.review', 'world.exterior']) }),
    pose: Object.freeze({ stance: 'seated', locomotion: 'stationary', blendMode: 'replace', bodyLean: 0.14, armMode: 'relaxed-rest-read-talk-no-typing' }),
    runtimeAdapters: Object.freeze({ currentBranches: Object.freeze(['main3d.js parkBench outdoor-node route action', 'agent-characters.js PARK BENCH SIT / REST / READ / SOCIALIZE branch']), currentFlags: Object.freeze(['agent._idleActivity.kind=park-bench-*', 'agent._schedPhase=park-bench-stand-up']) }),
  }),
  Object.freeze({
    id: 'bus-stop-wait',
    label: 'Bus Stop Shelter Sit / Wait / Stand Check',
    priority: 87,
    triggerKinds: Object.freeze(['runtime-flag', 'world-action', 'asset-id', 'action-location-role', 'capability-tag']),
    triggers: Object.freeze({ runtimeFlags: Object.freeze(['agent._idleActivity.kind=bus-stop-*', 'agent._idleActivity.outdoorNodeType=wait']), roles: Object.freeze(['seat', 'wait', 'approach']), assets: Object.freeze(['busStop']), actionPatterns: Object.freeze(['waitAtBusStop', 'sitAtBusStop', 'approachBusStop', 'bus stop', 'waiting shelter', 'transit stop']), capabilityTags: Object.freeze(['life.rest', 'planning.schedule', 'world.exterior']) }),
    pose: Object.freeze({ stance: 'seated-or-standing', locomotion: 'stationary', blendMode: 'replace', bodyLean: 0.12, armMode: 'relaxed-wait-stand-check' }),
    runtimeAdapters: Object.freeze({ currentBranches: Object.freeze(['agent-characters.js bus stop shelter seated/standing wait branch']), currentFlags: Object.freeze(['agent._idleActivity.kind=bus-stop-*', 'agent._idleActivity.outdoorNodeType=wait']) }),
  }),
  Object.freeze({
    id: 'gazebo-pavilion-social-rest',
    label: 'Gazebo / Pavilion Gather Rest Sit',
    priority: 88,
    triggerKinds: Object.freeze(['runtime-flag', 'world-action', 'asset-id', 'action-location-role', 'capability-tag']),
    triggers: Object.freeze({ runtimeFlags: Object.freeze(['agent._idleActivity.kind=gazebo-pavilion-*']), roles: Object.freeze(['gather', 'social', 'rest', 'seat', 'entry', 'approach']), assets: Object.freeze(['gazeboPavilion']), actionPatterns: Object.freeze(['gatherAtGazeboPavilion', 'restAtGazeboPavilion', 'sitAtGazeboPavilion', 'approachGazeboPavilion', 'gazebo', 'pavilion', 'covered gathering']), capabilityTags: Object.freeze(['life.rest', 'life.social', 'world.exterior']) }),
    pose: Object.freeze({ stance: 'seated-or-standing', locomotion: 'stationary', blendMode: 'replace', bodyLean: 0.12, armMode: 'relaxed-talk-wait-under-cover' }),
    runtimeAdapters: Object.freeze({ currentBranches: Object.freeze(['agent-characters.js gazebo/pavilion relaxed seated/standing talk/wait branch']), currentFlags: Object.freeze(['agent._idleActivity.kind=gazebo-pavilion-*']) }),
  }),
  Object.freeze({
    id: 'pond-dock-view-relax',
    label: 'Pond Dock Stand / View / Relax',
    priority: 88,
    triggerKinds: Object.freeze(['runtime-flag', 'world-action', 'asset-id', 'action-location-role', 'capability-tag']),
    triggers: Object.freeze({ runtimeFlags: Object.freeze(['agent._idleActivity.kind=pond-dock-*']), roles: Object.freeze(['watch', 'view', 'relax', 'fish-view', 'rest', 'dock-safe']), assets: Object.freeze(['pondDock']), actionPatterns: Object.freeze(['life.viewPond', 'life.relaxAtPondDock', 'pond dock', 'view pond', 'dock viewing spot', 'fish-like idle']), capabilityTags: Object.freeze(['life.rest', 'world.exterior', 'world.terrain']) }),
    pose: Object.freeze({ stance: 'standing', locomotion: 'stationary', blendMode: 'upper-body-overlay', bodyLean: 0.10, armMode: 'stand-view-relax-fish-like-no-inventory' }),
    runtimeAdapters: Object.freeze({ currentBranches: Object.freeze(['main3d.js pondDock context action route via setAgentTarget', 'agent-characters.js pond dock stand/view/relax branch']), currentFlags: Object.freeze(['agent._idleActivity.kind=pond-dock-*']) }),
  }),
  Object.freeze({
    id: 'outdoor-stage-perform-watch-gather',
    label: 'Outdoor Stage Perform / Watch / Gather',
    priority: 89,
    triggerKinds: Object.freeze(['runtime-flag', 'world-action', 'asset-id', 'action-location-role', 'capability-tag']),
    triggers: Object.freeze({ runtimeFlags: Object.freeze(['agent._idleActivity.kind=outdoor-stage-*']), roles: Object.freeze(['perform', 'watch', 'audience', 'gather', 'social', 'speak']), assets: Object.freeze(['outdoorStage']), actionPatterns: Object.freeze(['performAtOutdoorStage', 'watchOutdoorStagePerformance', 'gatherAtOutdoorStage', 'outdoor stage', 'performance spot', 'audience']), capabilityTags: Object.freeze(['life.social', 'world.exterior']) }),
    pose: Object.freeze({ stance: 'standing', locomotion: 'stationary', blendMode: 'upper-body-overlay', bodyLean: 0.08, armMode: 'perform-gesture-watch-applaud-talk' }),
    runtimeAdapters: Object.freeze({ currentBranches: Object.freeze(['main3d.js outdoorStage context action route via setAgentTarget', 'agent-characters.js outdoor stage perform/watch/gather branch']), currentFlags: Object.freeze(['agent._idleActivity.kind=outdoor-stage-*']) }),
  }),
  Object.freeze({
    id: 'shade-tree-relax-read-gather',
    label: 'Shade Tree relax / read / gather pose',
    description: 'Stand or sit just outside trunk collision under the canopy, with calm relax/read and optional look-up/social gestures.',
    priority: 80,
    triggers: Object.freeze({ runtimeFlags: Object.freeze(['agent._idleActivity.kind=shade-tree-*']), actionIds: Object.freeze(['life.restInShade', 'life.readInShade', 'life.gatherUnderShadeTree', 'life.talkUnderShadeTree']), roles: Object.freeze(['rest', 'read', 'gather', 'social', 'shade']), assets: Object.freeze(['shadeTreeCluster']), actionPatterns: Object.freeze(['life.restInShade', 'life.readInShade', 'life.gatherUnderShadeTree', 'shade tree', 'tree cluster']), capabilityTags: Object.freeze(['life.rest', 'life.social', 'world.exterior']) }),
    runtimeAdapters: Object.freeze({ currentBranches: Object.freeze(['main3d.js shadeTreeCluster context action route via setAgentTarget', 'agent-characters.js shade-tree relax/read/gather branch']), currentFlags: Object.freeze(['agent._idleActivity.kind=shade-tree-*']) }),
  }),
  Object.freeze({
    id: 'crosswalk-cross',
    label: 'Crosswalk Walk / Look Left Right',
    priority: 74,
    triggerKinds: Object.freeze(['runtime-flag', 'world-action', 'asset-id', 'action-location-role', 'capability-tag']),
    triggers: Object.freeze({ runtimeFlags: Object.freeze(['agent._idleActivity.kind=crosswalk-node-*', 'agent._idleActivity.outdoorNodeType=crossing']), roles: Object.freeze(['cross', 'crossing', 'waypoint', 'pass-through', 'entry', 'exit']), assets: Object.freeze(['crosswalkNode']), actionPatterns: Object.freeze(['useCrosswalkNode', 'inspectCrosswalkNode', 'crosswalk', 'crossing node', 'walk across', 'look left right']), capabilityTags: Object.freeze(['world.exterior', 'world.terrain']) }),
    pose: Object.freeze({ stance: 'standing', locomotion: 'walking-or-paused', blendMode: 'replace', bodyLean: 0.08, armMode: 'normal-walk-look-left-right' }),
    runtimeAdapters: Object.freeze({ currentBranches: Object.freeze(['main3d.js outdoor-node crossing context action', 'agent-characters.js crosswalk-node look-left-right branch while active; normal walking branch while moving']), currentFlags: Object.freeze(['agent._idleActivity.kind=crosswalk-node-*', 'agent._idleActivity.outdoorNodeType=crossing']) }),
  }),
  Object.freeze({
    id: 'path-node-stroll',
    label: 'Walking Path Node Stroll / Pause',
    priority: 73,
    triggerKinds: Object.freeze(['runtime-flag', 'world-action', 'asset-id', 'action-location-role', 'capability-tag']),
    triggers: Object.freeze({ runtimeFlags: Object.freeze(['agent._idleActivity.kind=path-node-*', 'agent._idleActivity.outdoorNodeType=stroll']), roles: Object.freeze(['stroll', 'waypoint', 'pass-through', 'pause', 'look-around']), assets: Object.freeze(['pathNode']), actionPatterns: Object.freeze(['life.strollOutdoors', 'planning.inspectPathNode', 'walking path node', 'stroll waypoint', 'path node']), capabilityTags: Object.freeze(['world.exterior', 'planning.schedule']) }),
    pose: Object.freeze({ stance: 'standing', locomotion: 'walking-or-paused', blendMode: 'replace', bodyLean: 0.04, armMode: 'normal-walk-brief-look-around' }),
    runtimeAdapters: Object.freeze({ currentBranches: Object.freeze(['main3d.js outdoor-node pathNode context action route via setAgentTarget', 'agent-characters.js path-node stroll/look-around branch while active; normal walking branch while moving']), currentFlags: Object.freeze(['agent._idleActivity.kind=path-node-*', 'agent._idleActivity.outdoorNodeType=stroll']) }),
  }),
  Object.freeze({
    id: 'outdoor-cafe-table-sit-eat-drink-talk',
    label: 'Outdoor Cafe Table Sit / Eat / Drink / Talk',
    priority: 89,
    triggerKinds: Object.freeze(['runtime-flag', 'world-action', 'asset-id', 'action-location-role', 'capability-tag']),
    triggers: Object.freeze({ runtimeFlags: Object.freeze(['agent._idleActivity.kind=outdoor-cafe-table-*', 'agent._idleActivity.kind=picnic-table-*']), roles: Object.freeze(['seat', 'eat', 'drink', 'social', 'talk']), assets: Object.freeze(['outdoorCafeTable', 'picnicTable']), actionPatterns: Object.freeze(['sitAtOutdoorCafeTable', 'eatAtOutdoorCafeTable', 'drinkAtOutdoorCafeTable', 'socializeAtOutdoorCafeTable', 'sitAtPicnicTable', 'eatAtPicnicTable', 'drinkAtPicnicTable', 'socializeAtPicnicTable', 'outdoor cafe table', 'picnic table']), capabilityTags: Object.freeze(['life.food', 'life.hydration', 'life.social', 'world.exterior']) }),
    pose: Object.freeze({ stance: 'seated', locomotion: 'stationary', blendMode: 'replace', bodyLean: 0.16, armMode: 'tabletop-eat-drink-talk-no-typing' }),
    runtimeAdapters: Object.freeze({ currentBranches: Object.freeze(['main3d.js outdoorCafeTable/picnicTable context action route via setAgentTarget', 'agent-characters.js outdoor cafe/picnic table seated eat/drink/talk/set-down branch']), currentFlags: Object.freeze(['agent._idleActivity.kind=outdoor-cafe-table-*', 'agent._idleActivity.kind=picnic-table-*']) }),
  }),
  Object.freeze({
    id: 'stand-pickup-setdown',
    label: 'Stand Pick Up / Set Down',
    priority: 88,
    triggerKinds: Object.freeze(['world-action', 'action-location-role', 'asset-id', 'capability-tag']),
    triggers: Object.freeze({ roles: Object.freeze(['pickup', 'drop-off', 'surface']), assets: Object.freeze(['coffeePickupShelf']), actionPatterns: Object.freeze(['pickupCoffeeOrder', 'dropOffCoffeeOrder', 'pickup', 'dropoff', 'setDown', 'set-down']), capabilityTags: Object.freeze(['life.hydration', 'life.food']) }),
    pose: Object.freeze({ stance: 'standing', locomotion: 'stationary', blendMode: 'replace', bodyLean: 0.18, armMode: 'right-hand-reach-surface' }),
    runtimeAdapters: Object.freeze({ currentBranches: Object.freeze(['agent-characters.js coffee pickup shelf / coffee machine stand pickup branch']), currentFlags: Object.freeze(['agent._idleActivity.kind=coffee-pickup-shelf-*']) }),
  }),
  Object.freeze({
    id: 'microwave-use',
    label: 'Microwave Open / Place / Press / Wait / Remove',
    priority: 89,
    triggerKinds: Object.freeze(['world-action', 'asset-id', 'action-location-role']),
    triggers: Object.freeze({ roles: Object.freeze(['use']), assets: Object.freeze(['microwave']), actionPatterns: Object.freeze(['heatFood', 'microwave', 'openMicrowave', 'pressMicrowave', 'removeMicrowave']) }),
    pose: Object.freeze({ stance: 'standing', locomotion: 'stationary', blendMode: 'replace', bodyLean: 0.20, armMode: 'open-place-press-remove' }),
    runtimeAdapters: Object.freeze({ currentBranches: Object.freeze(['agent-characters.js microwave open/place/press/wait/remove branch']), currentFlags: Object.freeze(['agent._idleActivity.kind=microwave-*']) }),
  }),
  Object.freeze({
    id: 'fridge-use',
    label: 'Fridge Open / Reach / Close',
    priority: 88,
    triggerKinds: Object.freeze(['runtime-flag', 'world-action', 'asset-id', 'action-location-role']),
    triggers: Object.freeze({ runtimeFlags: Object.freeze(['agent._idleActivity.kind=fridge-*']), roles: Object.freeze(['use', 'retrieve']), assets: Object.freeze(['fridge']), actionPatterns: Object.freeze(['getFridgeSnack', 'checkFridgeStock', 'fridge', 'refrigerator', 'openFridge', 'reachFridge', 'closeFridge']) }),
    pose: Object.freeze({ stance: 'standing', locomotion: 'stationary', blendMode: 'replace', bodyLean: 0.22, armMode: 'open-reach-close' }),
    runtimeAdapters: Object.freeze({ currentBranches: Object.freeze(['agent-characters.js fridge open/reach/close branch']), currentFlags: Object.freeze(['agent._idleActivity.kind=fridge-*']) }),
  }),
  Object.freeze({
    id: 'grill-cook',
    label: 'Grill Cook / Flip / Wait',
    priority: 88,
    triggerKinds: Object.freeze(['runtime-flag', 'world-action', 'asset-id', 'action-location-role', 'capability-tag']),
    triggers: Object.freeze({ runtimeFlags: Object.freeze(['agent._idleActivity.kind=grill-*']), roles: Object.freeze(['use', 'cook']), assets: Object.freeze(['grill']), actionPatterns: Object.freeze(['cookAtGrill', 'grill', 'barbecue', 'bbq', 'flip', 'cook']), capabilityTags: Object.freeze(['life.food']) }),
    pose: Object.freeze({ stance: 'standing', locomotion: 'stationary', blendMode: 'replace', bodyLean: 0.24, armMode: 'cook-flip-wait' }),
    runtimeAdapters: Object.freeze({ currentBranches: Object.freeze(['agent-characters.js grill cook/flip/wait branch']), currentFlags: Object.freeze(['agent._idleActivity.kind=grill-*']) }),
  }),
  Object.freeze({
    id: 'standing-desk-work',
    label: 'Standing Desk Work',
    priority: 77,
    triggerKinds: Object.freeze(['world-action', 'asset-id', 'capability-tag']),
    triggers: Object.freeze({ assets: Object.freeze(['standingDesk']), actionPatterns: Object.freeze(['focusWorkAtStandingDesk', 'adjustStandingDeskHeight', 'standingDesk', 'focusWork']), capabilityTags: Object.freeze(['review']) }),
    pose: Object.freeze({ stance: 'standing', locomotion: 'stationary', blendMode: 'replace', bodyLean: 0.20, armMode: 'standing-keyboard-type-control' }),
    runtimeAdapters: Object.freeze({ currentBranches: Object.freeze(['agent-characters.js standing desk work / height control branch']), currentFlags: Object.freeze(['agent._idleActivity.kind=standing-desk-*']) }),
  }),
  Object.freeze({
    id: 'plan-draw',
    label: 'Plan / Draw',
    priority: 76,
    triggerKinds: Object.freeze(['world-action', 'asset-id', 'capability-tag']),
    triggers: Object.freeze({ assets: Object.freeze(['draftingTable']), actionPatterns: Object.freeze(['buildStructure', 'editLayout', 'stageConstruction', 'planning', 'draft', 'layout']), capabilityTags: Object.freeze(['build', 'structure', 'review']) }),
    pose: Object.freeze({ stance: 'standing', locomotion: 'stationary', blendMode: 'replace', bodyLean: 0.38, armMode: 'draw-plan-review' }),
    runtimeAdapters: Object.freeze({ currentBranches: Object.freeze(['agent-characters.js drafting table planning branch']), currentFlags: Object.freeze(['agent._idleActivity.kind=drafting-table-*']) }),
  }),
  Object.freeze({
    id: 'write-teach',
    label: 'Write / Teach',
    priority: 75,
    triggerKinds: Object.freeze(['runtime-flag', 'world-action', 'asset-id', 'capability-tag']),
    triggers: Object.freeze({ runtimeFlags: Object.freeze(['isWorking', 'agent._atDesk']), assets: Object.freeze(['desk', 'standingDesk', 'receptionDesk', 'meetingTable', 'smallRoundMeetingTable', 'conferenceChair', 'whiteboard', 'draftingTable', 'teachingPodium']), actionPatterns: Object.freeze(['write', 'teach', 'work', 'planning', 'meeting', 'review']) }),
    pose: Object.freeze({ stance: 'standing-or-seated', locomotion: 'stationary', blendMode: 'replace', bodyLean: 0.32, armMode: 'two-hand-work' }),
    runtimeAdapters: Object.freeze({ currentBranches: Object.freeze(['agent-characters.js working desk branch']), currentFlags: Object.freeze(['agent._atDesk', 'agent._activeWorkSpot']) }),
  }),
  Object.freeze({
    id: 'cook',
    label: 'Cook',
    priority: 70,
    triggerKinds: Object.freeze(['world-action', 'asset-id', 'capability-tag']),
    triggers: Object.freeze({ assets: Object.freeze(['stove', 'counter', 'kitchenIsland', 'cafeCounter']), actionPatterns: Object.freeze(['cook', 'prepareFood', 'prepAtKitchenIsland', 'cookAtKitchenIsland', 'serveCafeCounter']), capabilityTags: Object.freeze(['food']) }),
    pose: Object.freeze({ stance: 'standing', locomotion: 'stationary', blendMode: 'replace', bodyLean: 0.22, armMode: 'stir-chop' }),
    runtimeAdapters: Object.freeze({ currentBranches: Object.freeze(['future stove/counter object actions']), currentFlags: Object.freeze([]) }),
  }),
  Object.freeze({
    id: 'drink-eat',
    label: 'Drink / Eat',
    priority: 66,
    triggerKinds: Object.freeze(['world-action', 'asset-id', 'capability-tag']),
    triggers: Object.freeze({ assets: Object.freeze(['diningTable', 'diningChair', 'smallCafeTable', 'outdoorCafeTable', 'patioTable', 'waterCooler', 'sink', 'vending', 'coffeeMachine', 'countertopCoffeeMachine', 'microwave', 'fridge', 'coffeePickupShelf', 'counter', 'kitchenIsland', 'cafeCounter']), actionPatterns: Object.freeze(['drink', 'eat', 'food', 'water', 'getWater', 'coffee', 'getCoffee', 'heatFood', 'getFridgeSnack', 'pickupCoffeeOrder', 'orderFood', 'eatAtKitchenIsland', 'wash_drink', 'eat_talk', 'eatDrinkAtSmallCafeTable', 'eatTalkAtPatioTable']), capabilityTags: Object.freeze(['food', 'hydration']) }),
    pose: Object.freeze({ stance: 'standing-or-seated', locomotion: 'stationary', blendMode: 'upper-body-overlay', armMode: 'hand-to-mouth' }),
    runtimeAdapters: Object.freeze({ currentBranches: Object.freeze(['future food/drink object actions']), currentFlags: Object.freeze([]) }),
  }),
  Object.freeze({
    id: 'vending-machine-use',
    label: 'Vending Machine Press / Retrieve',
    priority: 72,
    triggerKinds: Object.freeze(['runtime-flag', 'world-action', 'asset-id', 'capability-tag']),
    triggers: Object.freeze({ runtimeFlags: Object.freeze(['agent._idleActivity.kind=vending-machine-*']), actionIds: Object.freeze(['life.buyVendingSnackDrink']), assets: Object.freeze(['vending']), actionPatterns: Object.freeze(['buyVendingSnackDrink', 'vending', 'snack', 'drink']), capabilityTags: Object.freeze(['food', 'hydration']) }),
    pose: Object.freeze({ stance: 'standing', locomotion: 'stationary', blendMode: 'replace', bodyLean: 0.24, armMode: 'press-retrieve' }),
    runtimeAdapters: Object.freeze({ currentBranches: Object.freeze(['agent-characters.js vending machine press/buy/retrieve branch']), currentFlags: Object.freeze(['agent._idleActivity.kind=vending-machine-*']) }),
  }),
  Object.freeze({
    id: 'carry-right-hand',
    label: 'Carry Right Hand',
    priority: 90,
    triggerKinds: Object.freeze(['runtime-flag', 'world-action']),
    triggers: Object.freeze({ runtimeFlags: Object.freeze(['agent._carrying', 'isCarrying']), actionPatterns: Object.freeze(['carry', 'pickup', 'pick_up']) }),
    pose: Object.freeze({ stance: 'any', locomotion: 'any', blendMode: 'right-hand-overlay', armMode: 'right-hand-carry' }),
    runtimeAdapters: Object.freeze({ currentBranches: Object.freeze(['future carry/drop-off foundation']), currentFlags: Object.freeze(['agent._carrying']) }),
  }),
  Object.freeze({
    id: 'drop-off',
    label: 'Drop Off',
    priority: 86,
    triggerKinds: Object.freeze(['world-action', 'action-location-role', 'runtime-flag']),
    triggers: Object.freeze({ roles: Object.freeze(['drop-off']), runtimeFlags: Object.freeze(['agent._droppingOff', 'isDroppingOff']), actionPatterns: Object.freeze(['drop', 'dropoff', 'drop-off', 'deliver']) }),
    pose: Object.freeze({ stance: 'standing', locomotion: 'stationary', blendMode: 'replace', bodyLean: 0.26, armMode: 'place-down' }),
    runtimeAdapters: Object.freeze({ currentBranches: Object.freeze(['future carry/drop-off foundation']), currentFlags: Object.freeze(['agent._droppingOff']) }),
  }),
  Object.freeze({
    id: 'sleep-lie',
    label: 'Sleep / Lie',
    priority: 96,
    triggerKinds: Object.freeze(['runtime-flag', 'world-action', 'action-location-role', 'asset-id']),
    triggers: Object.freeze({ runtimeFlags: Object.freeze(['isSleeping', 'isBedResting', 'agent._schedPhase=sleep']), roles: Object.freeze(['patient']), assets: Object.freeze(['bed', 'clinicBed']), actionPatterns: Object.freeze(['sleep', 'lie', 'rest', 'recover']) }),
    pose: Object.freeze({ stance: 'lying', locomotion: 'stationary', blendMode: 'replace', bodyLean: 1.5708, armMode: 'rest' }),
    runtimeAdapters: Object.freeze({ currentBranches: Object.freeze(['agent-characters.js bed-rest and scheduled sleep branches']), currentFlags: Object.freeze(['agent._schedPhase', 'agent._idleActivity.kind']) }),
  }),
  Object.freeze({
    id: 'run-in-place',
    label: 'Run In Place',
    priority: 82,
    triggerKinds: Object.freeze(['runtime-flag']),
    triggers: Object.freeze({ runtimeFlags: Object.freeze(['isMoving+isRunning', 'agent._isRunning']) }),
    pose: Object.freeze({ stance: 'standing', locomotion: 'running', blendMode: 'replace', bodyLean: 0.12, armMode: 'counter-swing-fast' }),
    runtimeAdapters: Object.freeze({ currentBranches: Object.freeze(['agent-characters.js moving branch with agent._isRunning']), currentFlags: Object.freeze(['isMoving', 'agent._isRunning']) }),
  }),
  Object.freeze({
    id: 'train-practice',
    label: 'Train / Practice',
    priority: 84,
    triggerKinds: Object.freeze(['runtime-flag', 'world-action', 'asset-id', 'capability-tag']),
    triggers: Object.freeze({ runtimeFlags: Object.freeze(['agent._idleActivity.kind=treadmill-*', 'agent._idleActivity.kind=training-mat-*', 'agent._idleActivity.kind=outdoor-exercise-station-*']), assets: Object.freeze(['treadmill', 'trainingMat', 'outdoorExerciseStation']), actionPatterns: Object.freeze(['train', 'practice', 'fitness', 'exercise', 'stretch', 'calisthenics', 'pull-up', 'outdoor exercise station']), capabilityTags: Object.freeze(['training.practice']) }),
    pose: Object.freeze({ stance: 'standing', locomotion: 'stationary-running', blendMode: 'replace', bodyLean: 0.14, armMode: 'counter-swing-fast' }),
    runtimeAdapters: Object.freeze({ currentBranches: Object.freeze(['agent-characters.js treadmill/training-mat/outdoor-exercise-station branch']), currentFlags: Object.freeze(['agent._idleActivity.kind=treadmill-*', 'agent._idleActivity.kind=training-mat-*', 'agent._idleActivity.kind=outdoor-exercise-station-*']) }),
  }),
  Object.freeze({
    id: 'select-weights',
    label: 'Stand / Reach / Select Weights',
    priority: 76,
    triggerKinds: Object.freeze(['runtime-flag', 'world-action', 'asset-id', 'capability-tag']),
    triggers: Object.freeze({ runtimeFlags: Object.freeze(['agent._idleActivity.kind=dumbbell-rack-*']), assets: Object.freeze(['dumbbellRack']), actionPatterns: Object.freeze(['selectWeights', 'select weights', 'dumbbell', 'weights', 'fitness']), capabilityTags: Object.freeze(['training.practice']) }),
    pose: Object.freeze({ stance: 'standing', locomotion: 'stationary', blendMode: 'upper-body-overlay', bodyLean: 0.18, armMode: 'stand-reach-select-weights' }),
    runtimeAdapters: Object.freeze({ currentBranches: Object.freeze(['agent-characters.js dumbbell rack stand/reach/select branch']), currentFlags: Object.freeze(['agent._idleActivity.kind=dumbbell-rack-*']) }),
  }),
  Object.freeze({
    id: 'gym-bench-exercise',
    label: 'Gym Bench Exercise / Rest',
    priority: 85,
    triggerKinds: Object.freeze(['runtime-flag', 'world-action', 'asset-id', 'capability-tag']),
    triggers: Object.freeze({ runtimeFlags: Object.freeze(['agent._idleActivity.kind=gym-bench-*']), assets: Object.freeze(['gymBench']), actionPatterns: Object.freeze(['useGymBench', 'gym bench', 'bench exercise', 'bench rest', 'lie exercise']), capabilityTags: Object.freeze(['training.practice', 'life.rest']) }),
    pose: Object.freeze({ stance: 'lying-seated', locomotion: 'stationary', blendMode: 'replace', bodyLean: 1.2, armMode: 'bench-exercise-press' }),
    runtimeAdapters: Object.freeze({ currentBranches: Object.freeze(['agent-characters.js gym bench sit/lie exercise branch']), currentFlags: Object.freeze(['agent._idleActivity.kind=gym-bench-*']) }),
  }),
  Object.freeze({
    id: 'stand-teach-point',
    label: 'Stand / Teach / Point / Speak',
    priority: 78,
    triggerKinds: Object.freeze(['runtime-flag', 'world-action', 'asset-id', 'capability-tag']),
    triggers: Object.freeze({ runtimeFlags: Object.freeze(['agent._idleActivity.kind=teaching-podium-*']), assets: Object.freeze(['teachingPodium']), actionPatterns: Object.freeze(['teachAtPodium', 'presentAtPodium', 'teach', 'present', 'brief', 'speak']), capabilityTags: Object.freeze(['training.classroom', 'training.coach']) }),
    pose: Object.freeze({ stance: 'standing', locomotion: 'stationary', blendMode: 'replace', bodyLean: 0.16, armMode: 'teach-point-speak' }),
    runtimeAdapters: Object.freeze({ currentBranches: Object.freeze(['agent-characters.js teaching podium teach/point/speak branch']), currentFlags: Object.freeze(['agent._idleActivity.kind=teaching-podium-*']) }),
  }),
  Object.freeze({
    id: 'inspect-browse',
    label: 'Inspect / Browse',
    priority: 62,
    triggerKinds: Object.freeze(['world-action', 'asset-id', 'capability-tag']),
    triggers: Object.freeze({ assets: Object.freeze(['bookshelf', 'curtains', 'bulletinBoard', 'outdoorNoticeBoard', 'parkLamp', 'wallArt', 'menuBoard', 'printerCopier', 'laptopMonitorProps', 'vending', 'tv', 'tvStand', 'noticeBoard', 'dresser', 'wardrobe', 'nightstand', 'sideTable', 'mirror', 'clothingRack', 'displayMannequin', 'accessoryDisplayStand', 'displayCase', 'shopShelf', 'pantryShelf', 'salonMirrorStation', 'medicalSupplyCabinet', 'supplyCabinet', 'serverRack', 'dumbbellRack', 'outdoorPlanter', 'flowerBed', 'fountain']), actionPatterns: Object.freeze(['inspect', 'browse', 'read', 'point', 'notice', 'outdoor notice board', 'park lamp', 'street lamp', 'lamp post', 'inspectParkLamp', 'menu', 'wallArt', 'inspectWallArt', 'pictureFrame', 'pictureFrames', 'print_copy', 'watch', 'watchFountain', 'relaxAtFountain', 'gatherAtFountain', 'fountain', 'waterOutdoorPlanter', 'inspectOutdoorPlanter', 'outdoorPlanter', 'waterFlowerBed', 'inspectFlowerBed', 'smellFlowers', 'flowerBed', 'flower bed', 'flowers', 'planter', 'garden', 'adjustCurtains', 'openCurtains', 'closeCurtains', 'changeOutfitAtDresser', 'browseDresserDrawers', 'changeOutfitAtWardrobe', 'browseWardrobeCloset', 'wardrobe', 'closet', 'inspectNightstand', 'placeTakeNightstandSmallItem', 'inspectSideTable', 'dropOffAtSideTable', 'sideTable', 'side table', 'setDown', 'set-down', 'nightstand', 'bedside', 'place', 'take', 'dresser', 'drawer', 'editOutfit', 'editAccessories', 'browseAccessories', 'browseDisplayCase', 'browseShopShelf', 'browsePantryShelf', 'inspectPantryStock', 'previewOutfit', 'inspectMirror', 'previewAppearance', 'browseMedicalSupplies', 'restockMedicalSupplies', 'browseSupplyCabinet', 'checkSupplyCabinetStock', 'inspectServerRack', 'monitorServerRack', 'repairServerRack', 'open', 'reach', 'select', 'selectWeights']), capabilityTags: Object.freeze(['media', 'review', 'planning.notice', 'appearance', 'appearance.customize', 'appearance.display', 'maintenance.restock', 'maintenance.repair', 'maintenance.diagnostics', 'life.medical', 'life.shopping', 'life.food', 'training.practice', 'world.decorate', 'world.exterior']) }),
    pose: Object.freeze({ stance: 'standing', locomotion: 'stationary', blendMode: 'upper-body-overlay', bodyLean: 0.16, armMode: 'stand-open-reach-browse' }),
    runtimeAdapters: Object.freeze({ currentBranches: Object.freeze(['agent-characters.js medical supply cabinet / dresser / clothing rack / accessory display stand / shop shelf / bookshelf / bulletin board / wall art / menu board / outdoor planter / flower bed browse branch', 'agent-characters.js fountain watch/relax/gather branch', 'future inspect/browse object actions']), currentFlags: Object.freeze(['agent._idleActivity.kind=medical-supply-cabinet-*', 'agent._idleActivity.kind=supply-cabinet-*', 'agent._idleActivity.kind=dresser-*', 'agent._idleActivity.kind=wardrobe-*', 'agent._idleActivity.kind=nightstand-*', 'agent._idleActivity.kind=side-table-*', 'agent._idleActivity.kind=clothing-rack-*', 'agent._idleActivity.kind=accessory-display-stand-*', 'agent._idleActivity.kind=shop-shelf-*', 'agent._idleActivity.kind=pantry-shelf-*', 'agent._idleActivity.kind=bulletin-board-*', 'agent._idleActivity.kind=wall-art-*', 'agent._idleActivity.kind=menu-board-*', 'agent._idleActivity.kind=park-lamp-*', 'agent._idleActivity.kind=outdoor-planter-*', 'agent._idleActivity.kind=flower-bed-*', 'agent._idleActivity.kind=fountain-*']) }),
  }),
  Object.freeze({
    id: 'tv-stand-remote-inspect',
    label: 'TV Stand Remote / Inspect',
    priority: 69,
    triggerKinds: Object.freeze(['runtime-flag', 'world-action', 'asset-id', 'action-location-role', 'capability-tag']),
    triggers: Object.freeze({ runtimeFlags: Object.freeze(['agent._idleActivity.kind=tv-stand-*']), roles: Object.freeze(['use', 'inspect', 'watch']), assets: Object.freeze(['tvStand']), actionIds: Object.freeze(['life.inspectTvStand', 'life.watchTvFromMediaConsole']), actionPatterns: Object.freeze(['inspectTvStand', 'watchTvFromMediaConsole', 'tv stand', 'media console', 'remote', 'watch tv']), capabilityTags: Object.freeze(['life.social', 'world.decorate']) }),
    pose: Object.freeze({ stance: 'standing', locomotion: 'stationary', blendMode: 'upper-body-overlay', bodyLean: 0.12, armMode: 'stand-inspect-remote-gesture' }),
    runtimeAdapters: Object.freeze({ currentBranches: Object.freeze(['main3d.js tvStand inspect/watch action route', 'agent-characters.js TV stand remote/inspect branch']), currentFlags: Object.freeze(['agent._idleActivity.kind=tv-stand-*']) }),
  }),
  Object.freeze({
    id: 'printer-scanner-use',
    label: 'Printer / Scanner Use',
    priority: 74,
    triggerKinds: Object.freeze(['runtime-flag', 'world-action', 'asset-id', 'capability-tag']),
    triggers: Object.freeze({ runtimeFlags: Object.freeze(['agent._idleActivity.kind=printer-scanner-*']), assets: Object.freeze(['printerCopier']), actionPatterns: Object.freeze(['print_copy', 'printCopy', 'print', 'copy', 'scan', 'collectPrintOutput']), capabilityTags: Object.freeze(['maintenance.printCopy', 'maintenance.diagnostics']) }),
    pose: Object.freeze({ stance: 'standing', locomotion: 'stationary', blendMode: 'replace', bodyLean: 0.18, armMode: 'press-wait-collect' }),
    runtimeAdapters: Object.freeze({ currentBranches: Object.freeze(['agent-characters.js all-in-one printer scanner press/wait/collect branch']), currentFlags: Object.freeze(['agent._idleActivity.kind=printer-scanner-*']) }),
  }),
  Object.freeze({
    id: 'laptop-monitor-work',
    label: 'Laptop / Monitor Work Glance Type',
    priority: 77,
    triggerKinds: Object.freeze(['runtime-flag', 'world-action', 'asset-id', 'capability-tag']),
    triggers: Object.freeze({ runtimeFlags: Object.freeze(['agent._idleActivity.kind=laptop-monitor-*']), assets: Object.freeze(['laptopMonitorProps']), actionPatterns: Object.freeze(['workAtLaptopMonitor', 'reviewLaptopMonitorScreen', 'laptop', 'monitor', 'type', 'screenReview']), capabilityTags: Object.freeze(['planning.review', 'maintenance.diagnostics']) }),
    pose: Object.freeze({ stance: 'standing', locomotion: 'stationary', blendMode: 'replace', bodyLean: 0.18, armMode: 'stand-type-glance-screen' }),
    runtimeAdapters: Object.freeze({ currentBranches: Object.freeze(['agent-characters.js laptop / monitor props glance/type branch']), currentFlags: Object.freeze(['agent._idleActivity.kind=laptop-monitor-*']) }),
  }),
  Object.freeze({
    id: 'diagnostic-station-use',
    label: 'Diagnostic Station Use',
    priority: 86,
    triggerKinds: Object.freeze(['runtime-flag', 'world-action', 'asset-id', 'capability-tag']),
    triggers: Object.freeze({ runtimeFlags: Object.freeze(['agent._idleActivity.kind=diagnostic-station-*']), assets: Object.freeze(['diagnosticStation']), actionPatterns: Object.freeze(['runDiagnostics', 'reviewDiagnostics', 'restoreAgentState', 'diagnostic', 'scan', 'review', 'type']), capabilityTags: Object.freeze(['maintenance.diagnostics', 'life.medical', 'planning.review']) }),
    pose: Object.freeze({ stance: 'standing', locomotion: 'stationary', blendMode: 'replace', bodyLean: 0.22, armMode: 'scan-review-type' }),
    runtimeAdapters: Object.freeze({ currentBranches: Object.freeze(['agent-characters.js diagnostic station scan/review/type branch']), currentFlags: Object.freeze(['agent._idleActivity.kind=diagnostic-station-*']) }),
  }),
  Object.freeze({
    id: 'tool-cart-select',
    label: 'Tool Cart Select Tool',
    priority: 73,
    triggerKinds: Object.freeze(['runtime-flag', 'world-action', 'asset-id', 'capability-tag']),
    triggers: Object.freeze({ runtimeFlags: Object.freeze(['agent._idleActivity.kind=tool-cart-*']), assets: Object.freeze(['toolCart']), actionPatterns: Object.freeze(['selectToolFromCart', 'prepBuildSupportFromToolCart', 'toolCart', 'select-tool', 'prep-build']), capabilityTags: Object.freeze(['maintenance.repair', 'world.build', 'world.structure']) }),
    pose: Object.freeze({ stance: 'standing', locomotion: 'stationary', blendMode: 'replace', bodyLean: 0.22, armMode: 'stand-reach-select-tool' }),
    runtimeAdapters: Object.freeze({ currentBranches: Object.freeze(['agent-characters.js tool cart stand/reach/select-tool branch']), currentFlags: Object.freeze(['agent._idleActivity.kind=tool-cart-*']) }),
  }),
  Object.freeze({
    id: 'workbench-tool-use',
    label: 'Workbench Tool / Build Use',
    priority: 78,
    triggerKinds: Object.freeze(['runtime-flag', 'world-action', 'asset-id', 'action-location-role', 'capability-tag']),
    triggers: Object.freeze({ runtimeFlags: Object.freeze(['agent._idleActivity.kind=workbench-*']), roles: Object.freeze(['use', 'work', 'service']), assets: Object.freeze(['workbench']), actionPatterns: Object.freeze(['useWorkbench', 'buildRepairAtWorkbench', 'workbench', 'repair', 'build']), capabilityTags: Object.freeze(['maintenance.repair', 'world.build', 'world.structure']) }),
    pose: Object.freeze({ stance: 'standing', locomotion: 'stationary', blendMode: 'replace', bodyLean: 0.26, armMode: 'tool-use-build-repair' }),
    runtimeAdapters: Object.freeze({ currentBranches: Object.freeze(['main3d.js Workbench route action', 'agent-characters.js WORKBENCH STAND, TOOL USE, BUILD/REPAIR branch']), currentFlags: Object.freeze(['agent._idleActivity.kind=workbench-*']) }),
  }),
  Object.freeze({
    id: 'storage-boxes-inspect-open',
    label: 'Storage Boxes Inspect / Open',
    priority: 72,
    triggerKinds: Object.freeze(['runtime-flag', 'world-action', 'asset-id', 'capability-tag']),
    triggers: Object.freeze({ runtimeFlags: Object.freeze(['agent._idleActivity.kind=storage-boxes-*']), assets: Object.freeze(['storageBoxes']), actionPatterns: Object.freeze(['inspectStorageBoxes', 'openCheckStorageBoxes', 'storageBoxes', 'storage-boxes', 'check supplies', 'open box']), capabilityTags: Object.freeze(['maintenance.restock', 'planning.review', 'world.exterior']) }),
    pose: Object.freeze({ stance: 'standing', locomotion: 'stationary', blendMode: 'replace', bodyLean: 0.24, armMode: 'stand-inspect-open-box' }),
    runtimeAdapters: Object.freeze({ currentBranches: Object.freeze(['agent-characters.js storage boxes stand/inspect/open-box branch']), currentFlags: Object.freeze(['agent._idleActivity.kind=storage-boxes-*']) }),
  }),
  Object.freeze({
    id: 'checkout-service',
    label: 'Checkout Service',
    priority: 89,
    triggerKinds: Object.freeze(['runtime-flag', 'world-action', 'asset-id', 'capability-tag']),
    triggers: Object.freeze({ runtimeFlags: Object.freeze(['agent._idleActivity.kind=checkout-counter-*', 'agent._idleActivity.kind=checkout-register-*']), roles: Object.freeze(['use']), assets: Object.freeze(['checkoutCounter', 'checkoutRegister']), actionPatterns: Object.freeze(['checkoutPurchase', 'cashierService', 'checkout', 'cashier', 'scanItems', 'pay', 'payment', 'operateRegister']), capabilityTags: Object.freeze(['life.shopping', 'maintenance.checkout']) }),
    pose: Object.freeze({ stance: 'standing', locomotion: 'stationary', blendMode: 'replace', bodyLean: 0.18, armMode: 'scan-bag-receipt' }),
    runtimeAdapters: Object.freeze({ currentBranches: Object.freeze(['agent-characters.js checkout counter cashier/customer branch']), currentFlags: Object.freeze(['agent._idleActivity.kind=checkout-counter-*']) }),
  }),
  Object.freeze({
    id: 'service-checkup',
    label: 'Service / Checkup',
    priority: 88,
    triggerKinds: Object.freeze(['runtime-flag', 'world-action', 'action-location-role', 'asset-id']),
    triggers: Object.freeze({ runtimeFlags: Object.freeze(['isClinicService', 'isExamChairService', 'isBarberChairService', 'agent._idleActivity.kind=salon-mirror-station-service', 'agent._idleActivity.kind=cafe-counter-serve', 'agent._idleActivity.kind=checkout-counter-cashier', 'agent._idleActivity.kind=checkout-register-cashier']), roles: Object.freeze(['service']), assets: Object.freeze(['clinicBed', 'examChair', 'diagnosticStation', 'barberChair', 'printerCopier', 'sink', 'cafeCounter', 'checkoutCounter', 'checkoutRegister']), actionPatterns: Object.freeze(['service', 'serve', 'serveCafeCounter', 'cashierService', 'checkup', 'medicalExam', 'repair', 'diagnostic', 'styleHair', 'mirrorService', 'examChairService']) }),
    pose: Object.freeze({ stance: 'standing', locomotion: 'stationary', blendMode: 'replace', bodyLean: 0.42, armMode: 'scan-service' }),
    runtimeAdapters: Object.freeze({ currentBranches: Object.freeze(['agent-characters.js clinic bed service branch', 'agent-characters.js barber chair standing service branch', 'agent-characters.js cafe counter standing service branch']), currentFlags: Object.freeze(['agent._idleActivity.kind=bed-clinic-service', 'agent._idleActivity.kind=barber-chair-*/barberRole=stylist', 'agent._idleActivity.kind=cafe-counter-serve']) }),
  }),
  Object.freeze({
    id: 'play-game',
    label: 'Play / Game',
    priority: 64,
    triggerKinds: Object.freeze(['world-action', 'asset-id', 'capability-tag']),
    triggers: Object.freeze({ runtimeFlags: Object.freeze(['agent._idleActivity.kind=arcade-machine-*', 'agent._idleActivity.kind=gaming-station-*', 'agent._idleActivity.kind=pool-table-*', 'agent._idleActivity.kind=playground-slide-*', 'agent._idleActivity.kind=playground-swing-*']), assets: Object.freeze(['arcadeMachine', 'gamingStation', 'pingpong', 'poolTable', 'tv', 'playgroundSwing', 'playgroundSlide']), actionPatterns: Object.freeze(['play', 'game', 'entertainment', 'arcade', 'gamingStation', 'poolTable', 'playgroundSlide', 'playground slide', 'playgroundSwing', 'playground swing', 'life.playArcade', 'life.playGamingStation', 'life.playPoolTable', 'life.playOnPlaygroundSlide', 'life.swingOnPlaygroundSwing']), capabilityTags: Object.freeze(['life.social', 'training.practice']) }),
    pose: Object.freeze({ stance: 'standing-or-seated', locomotion: 'stationary-or-moving', blendMode: 'replace', bodyLean: 0.2, armMode: 'play' }),
    runtimeAdapters: Object.freeze({ currentBranches: Object.freeze(['agent-characters.js arcade machine play branch', 'agent-characters.js gaming station seated play branch', 'agent-characters.js pool table aim/shot branch', 'agent-characters.js playground slide climb/slide branch']), currentFlags: Object.freeze(['agent._idleActivity.kind=arcade-machine-*', 'agent._idleActivity.kind=gaming-station-*', 'agent._idleActivity.kind=pool-table-*', 'agent._idleActivity.kind=playground-slide-*']) }),
  }),
  Object.freeze({
    id: 'playground-slide-play',
    label: 'Playground Slide Climb / Slide',
    priority: 66,
    triggerKinds: Object.freeze(['runtime-flag', 'world-action', 'asset-id', 'action-location-role', 'capability-tag']),
    triggers: Object.freeze({ runtimeFlags: Object.freeze(['agent._idleActivity.kind=playground-slide-*']), roles: Object.freeze(['play', 'climb', 'exit', 'waypoint']), assets: Object.freeze(['playgroundSlide']), actionPatterns: Object.freeze(['life.playOnPlaygroundSlide', 'playOnPlaygroundSlide', 'finishPlaygroundSlide', 'playground slide', 'slide']), capabilityTags: Object.freeze(['life.social', 'world.exterior']) }),
    pose: Object.freeze({ stance: 'standing', locomotion: 'stationary-or-moving', blendMode: 'replace', bodyLean: 0.24, armMode: 'climb-slide-play' }),
    runtimeAdapters: Object.freeze({ currentBranches: Object.freeze(['main3d.js Playground Slide outdoor-node route action', 'agent-characters.js PLAYGROUND SLIDE climb/slide playful branch']), currentFlags: Object.freeze(['agent._idleActivity.kind=playground-slide-*']) }),
  }),
  Object.freeze({
    id: 'playground-swing-sit-swing',
    label: 'Playground Swing Sit / Swing',
    priority: 67,
    triggerKinds: Object.freeze(['runtime-flag', 'world-action', 'asset-id', 'action-location-role', 'capability-tag']),
    triggers: Object.freeze({ runtimeFlags: Object.freeze(['agent._idleActivity.kind=playground-swing-*']), roles: Object.freeze(['seat', 'use', 'play', 'swing', 'wait-turn', 'soft-zone']), assets: Object.freeze(['playgroundSwing']), actionPatterns: Object.freeze(['life.swingOnPlaygroundSwing', 'life.waitTurnAtPlaygroundSwing', 'playground swing', 'swing', 'wait turn']), capabilityTags: Object.freeze(['life.social', 'world.exterior']) }),
    pose: Object.freeze({ stance: 'seated', locomotion: 'stationary', blendMode: 'replace', bodyLean: 0.18, armMode: 'hold-swing-chains' }),
    runtimeAdapters: Object.freeze({ currentBranches: Object.freeze(['main3d.js Playground Swing route action via setAgentTarget', 'agent-characters.js PLAYGROUND SWING seated swing branch']), currentFlags: Object.freeze(['agent._idleActivity.kind=playground-swing-*']) }),
  }),
  Object.freeze({
    id: 'dispose',
    label: 'Dispose',
    priority: 68,
    triggerKinds: Object.freeze(['world-action', 'asset-id', 'capability-tag']),
    triggers: Object.freeze({ assets: Object.freeze(['trashBin', 'trashCan', 'outdoorTrashCan', 'sink']), actionPatterns: Object.freeze(['dispose', 'disposeWaste', 'trash', 'clean']), capabilityTags: Object.freeze(['maintenance.clean', 'maintenance']) }),
    pose: Object.freeze({ stance: 'standing', locomotion: 'stationary', blendMode: 'replace', bodyLean: 0.28, armMode: 'throw-away' }),
    runtimeAdapters: Object.freeze({ currentBranches: Object.freeze(['agent-characters.js trash bin / outdoor trash can dispose branch', 'temporary item lifecycle cleanup on dispose completion']), currentFlags: Object.freeze(['agent._idleActivity.kind=trash-bin-dispose', 'agent._idleActivity.kind=outdoor-trash-can-dispose']) }),
  }),
  Object.freeze({
    id: 'gather-talk',
    label: 'Gather / Talk',
    priority: 78,
    triggerKinds: Object.freeze(['runtime-flag', 'world-action', 'asset-id', 'capability-tag']),
    triggers: Object.freeze({ runtimeFlags: Object.freeze(['isSocializing']), assets: Object.freeze(['meetingTable', 'smallRoundMeetingTable', 'conferenceChair', 'couch', 'sectionalSofa', 'loveseat', 'armchair', 'barStool', 'diningChair', 'patioChair', 'diningTable', 'smallCafeTable', 'outdoorCafeTable', 'picnicTable', 'patioTable', 'outdoorStage', 'waterCooler', 'gazebo']), actionPatterns: Object.freeze(['gather', 'talk', 'chat', 'social', 'meeting', 'listen', 'eat_talk', 'talkAtSmallCafeTable', 'talkAtPatioTable', 'eatTalkAtPatioTable', 'smallRoundMeetingTableTalk', 'smallRoundMeetingTablePlan', 'gatherAtOutdoorStage']), capabilityTags: Object.freeze(['social']) }),
    pose: Object.freeze({ stance: 'standing-or-seated', locomotion: 'stationary', blendMode: 'upper-body-overlay', bodyLean: 0.06, armMode: 'gesture-talk' }),
    runtimeAdapters: Object.freeze({ currentBranches: Object.freeze(['agent-characters.js talking branch', 'agent-characters.js couch/sectional-sofa/loveseat/armchair/bar-stool social branch']), currentFlags: Object.freeze(['isSocializing', 'isCouchSocializing', 'isSectionalSofaLounging', 'isLoveseatSocializing', 'isArmchairSocializing', 'isBarStoolChatting']) }),
  }),
]);

function freezeDeep(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freezeDeep(child);
  return value;
}

function normalizeAnimationId(value) {
  const id = String(value || '').trim();
  return AGENT_ANIMATION_IDS.includes(id) ? id : null;
}

function asFrozenStringArray(value) {
  if (!Array.isArray(value)) return Object.freeze([]);
  return Object.freeze([...new Set(value.map(item => String(item || '').trim()).filter(Boolean))]);
}

function normalizeTriggers(triggers = {}) {
  return freezeDeep({
    runtimeFlags: asFrozenStringArray(triggers.runtimeFlags),
    worldActionIds: asFrozenStringArray(triggers.worldActionIds),
    actionIds: asFrozenStringArray(triggers.actionIds),
    actionPatterns: asFrozenStringArray(triggers.actionPatterns),
    roles: asFrozenStringArray(triggers.roles),
    assets: asFrozenStringArray(triggers.assets),
    capabilityTags: asFrozenStringArray(triggers.capabilityTags),
  });
}

function normalizeDefinition(definition) {
  const id = normalizeAnimationId(definition?.id);
  if (!id) return null;
  return freezeDeep({
    id,
    label: String(definition.label || id),
    priority: Number.isFinite(Number(definition.priority)) ? Number(definition.priority) : 0,
    triggerKinds: asFrozenStringArray(definition.triggerKinds).filter(kind => AGENT_ANIMATION_TRIGGER_KINDS.includes(kind)),
    triggers: normalizeTriggers(definition.triggers),
    pose: freezeDeep({
      stance: definition.pose?.stance || 'standing',
      locomotion: definition.pose?.locomotion || 'stationary',
      blendMode: AGENT_ANIMATION_BLEND_MODES.includes(definition.pose?.blendMode) ? definition.pose.blendMode : 'replace',
      bodyLean: Number.isFinite(Number(definition.pose?.bodyLean)) ? Number(definition.pose.bodyLean) : 0,
      armMode: definition.pose?.armMode || 'neutral',
    }),
    runtimeAdapters: freezeDeep({
      currentBranches: asFrozenStringArray(definition.runtimeAdapters?.currentBranches),
      currentFlags: asFrozenStringArray(definition.runtimeAdapters?.currentFlags),
    }),
  });
}

function containsPattern(haystack, patterns) {
  const text = String(haystack || '').toLowerCase();
  return !!text && patterns.some(pattern => text.includes(String(pattern).toLowerCase()));
}

function triggerScore(entry, context = {}) {
  const triggers = entry.triggers || {};
  let score = 0;
  const animationId = context.animationId || context.worldAction?.animationId;
  if (normalizeAnimationId(animationId) === entry.id) score += 1000;

  const actionId = context.actionId || context.worldAction?.actionId || context.worldAction?.id || context.actionLocation?.actionId || '';
  if (triggers.actionIds?.includes(actionId) || triggers.worldActionIds?.includes(actionId)) score += 140;
  if (containsPattern(actionId, triggers.actionPatterns || [])) score += 90;

  const role = context.role || context.actionLocation?.role || null;
  const roles = new Set([role, ...(context.roles || []), ...(context.actionLocation?.roles || [])].filter(Boolean));
  if ([...roles].some(candidate => triggers.roles?.includes(candidate))) score += 70;

  const assetId = context.assetId || context.objectCatalogId || context.item?.catalogId || context.item?.type || context.actionLocation?.assetId || '';
  if (triggers.assets?.includes(assetId)) score += 55;

  const capabilityTags = new Set([...(context.capabilityTags || []), ...(context.objectProfile?.tags || []), ...(context.catalogEntry?.tags || [])].filter(Boolean));
  if ([...capabilityTags].some(candidate => triggers.capabilityTags?.includes(candidate))) score += 35;

  return score;
}

function runtimePreferredId(context = {}) {
  const agent = context.agent || {};
  const bedActivityKind = String(agent._idleActivity?.kind || context.bedActivityKind || '');
  const isClinicService = Boolean(context.isClinicService ?? (bedActivityKind === 'bed-clinic-service' && agent._idleActivity?.phase === 'active'));
  const isBedResting = Boolean(context.isBedResting ?? (bedActivityKind.startsWith('bed-') && agent._idleActivity?.phase === 'active' && !isClinicService));
  const isSleeping = Boolean(context.isSleeping ?? (agent._schedPhase === 'sleep')) || isBedResting;
  const isRunning = Boolean(context.isRunning ?? agent._isRunning);
  const isMoving = Boolean(context.isMoving);
  const isWorking = Boolean(context.isWorking ?? agent._atDesk ?? agent._activeWorkSpot);
  const isSocializing = Boolean(context.isSocializing);

  if (isSleeping) return 'sleep-lie';
  if (isClinicService) return 'service-checkup';
  if (context.isDroppingOff || agent._droppingOff) return 'drop-off';
  if (context.isCarrying || agent._carrying) return 'carry-right-hand';
  if (isMoving && isRunning) return 'run-in-place';
  if (isWorking) return 'write-teach';
  if (isSocializing) return 'gather-talk';
  return null;
}

export function buildAnimationRegistry({ definitions = DEFAULT_ANIMATION_DEFINITIONS, overrides = {} } = {}) {
  const byOverride = new Map(Object.entries(overrides || {}));
  const entries = definitions
    .map((definition) => normalizeDefinition({ ...definition, ...(byOverride.get(definition.id) || {}) }))
    .filter(Boolean)
    .sort((a, b) => a.id.localeCompare(b.id));
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  return freezeDeep({
    version: AGENT_ANIMATION_REGISTRY_API_VERSION,
    entries: Object.freeze(entries),
    get(id) {
      const normalized = normalizeAnimationId(id);
      return normalized ? byId.get(normalized) || null : null;
    },
    list({ triggerKind = null, assetId = null, role = null } = {}) {
      return entries.filter(entry => {
        if (triggerKind && !entry.triggerKinds.includes(triggerKind)) return false;
        if (assetId && !entry.triggers.assets.includes(assetId)) return false;
        if (role && !entry.triggers.roles.includes(role)) return false;
        return true;
      });
    },
    resolve(context = {}) {
      return resolveAgentAnimationState({ ...context, registry: this });
    },
  });
}

export const DEFAULT_AGENT_ANIMATION_REGISTRY = buildAnimationRegistry();

export function resolveAgentAnimationState(context = {}) {
  const registry = context.registry || DEFAULT_AGENT_ANIMATION_REGISTRY;
  const preferred = runtimePreferredId(context) || normalizeAnimationId(context.animationId || context.worldAction?.animationId);
  if (preferred && registry.get(preferred)) {
    const entry = registry.get(preferred);
    return freezeDeep({ animationId: entry.id, entry, source: 'runtime-or-explicit', score: 1000 + entry.priority });
  }

  const candidates = registry.entries
    .map(entry => ({ entry, score: triggerScore(entry, context) + entry.priority }))
    .filter(candidate => candidate.score > candidate.entry.priority)
    .sort((a, b) => b.score - a.score || b.entry.priority - a.entry.priority || a.entry.id.localeCompare(b.entry.id));

  const selected = candidates[0]?.entry || registry.get('stand-use');
  return freezeDeep({
    animationId: selected?.id || null,
    entry: selected || null,
    source: candidates.length ? 'trigger-match' : 'fallback',
    score: candidates[0]?.score || 0,
  });
}

export function getAnimationForAction(actionId, options = {}) {
  return resolveAgentAnimationState({ ...options, actionId }).entry;
}

export function getAnimationForActionLocation(actionLocation, options = {}) {
  return resolveAgentAnimationState({ ...options, actionLocation }).entry;
}

export function validateAnimationRegistry(registry) {
  const errors = [];
  if (!registry || registry.version !== AGENT_ANIMATION_REGISTRY_API_VERSION) errors.push('registry.version must match AGENT_ANIMATION_REGISTRY_API_VERSION');
  if (!Array.isArray(registry?.entries) || registry.entries.length === 0) errors.push('registry.entries must be a non-empty array');
  const ids = new Set();
  for (const entry of registry?.entries || []) {
    if (!normalizeAnimationId(entry.id)) errors.push(`invalid animation id ${entry.id || '<missing>'}`);
    if (ids.has(entry.id)) errors.push(`duplicate animation id ${entry.id}`);
    ids.add(entry.id);
    if (!entry.label) errors.push(`${entry.id}.label is required`);
    if (!Array.isArray(entry.triggerKinds) || entry.triggerKinds.some(kind => !AGENT_ANIMATION_TRIGGER_KINDS.includes(kind))) errors.push(`${entry.id}.triggerKinds must use valid trigger kinds`);
    if (!entry.triggers || typeof entry.triggers !== 'object') errors.push(`${entry.id}.triggers is required`);
    if (!entry.pose || !AGENT_ANIMATION_BLEND_MODES.includes(entry.pose.blendMode)) errors.push(`${entry.id}.pose.blendMode must be valid`);
    if (!entry.runtimeAdapters || !Array.isArray(entry.runtimeAdapters.currentBranches)) errors.push(`${entry.id}.runtimeAdapters.currentBranches must be an array`);
  }
  for (const id of AGENT_ANIMATION_IDS) {
    if (!ids.has(id)) errors.push(`registry missing canonical animation ${id}`);
  }
  return freezeDeep({ ok: errors.length === 0, errors: Object.freeze(errors) });
}

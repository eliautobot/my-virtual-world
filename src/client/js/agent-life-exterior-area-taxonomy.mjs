/**
 * Agent Life exterior area taxonomy.
 *
 * This is metadata only: it does not create outdoor records, place assets,
 * create colliders, persist world state, or route agents. Current Phase 1B
 * outdoor areas continue to reuse park/outdoor building records,
 * outdoorArea.nodes, catalog entries, and setAgentTarget/dynamic routing.
 */

export const EXTERIOR_AREA_TAXONOMY_VERSION = 'agent-life-exterior-area-taxonomy/v1';

export const EXTERIOR_AREA_CATEGORIES = Object.freeze([
  'park',
  'plaza',
  'food-service',
  'outdoor-cafe',
  'garden',
  'training-yard',
  'patio',
  'pond-scenic-spot',
  'street-sidewalk',
  'courtyard',
  'recreation-area',
]);

export const EXTERIOR_AREA_CATEGORY_DISPLAY = Object.freeze({
  park: Object.freeze({ label: 'Park', icon: '🌳', description: 'Open public greens, lawns, park paths, benches, shade, trees, and public rest spots.' }),
  plaza: Object.freeze({ label: 'Plaza', icon: '🏙️', description: 'Paved public squares, market nodes, meeting points, fountains, and civic outdoor gathering areas.' }),
  'food-service': Object.freeze({ label: 'Food Truck / Outdoor Service', icon: '🌮', description: 'Outdoor service counters, food trucks, kiosks, queue points, pickup shelves, and staffed public service nodes.' }),
  'outdoor-cafe': Object.freeze({ label: 'Outdoor Cafe', icon: '☕', description: 'Cafe patio seating, small outdoor tables, social eating/drinking spots, and storefront spill-out seating.' }),
  garden: Object.freeze({ label: 'Garden', icon: '🪴', description: 'Planters, landscaping, flower beds, maintained greens, and decorative or care-taking garden nodes.' }),
  'training-yard': Object.freeze({ label: 'Training Yard', icon: '🥋', description: 'Outdoor practice, fitness, coaching, workshop drills, and structured training spaces.' }),
  patio: Object.freeze({ label: 'Patio', icon: '🌤️', description: 'Building-adjacent paved outdoor rooms, BBQ/social spots, outdoor seating, and residential/commercial patios.' }),
  'pond-scenic-spot': Object.freeze({ label: 'Pond / Scenic Spot', icon: '🏞️', description: 'Ponds, fountains, viewpoints, scenic pauses, quiet observation nodes, and nature-focused landmarks.' }),
  'street-sidewalk': Object.freeze({ label: 'Street / Sidewalk', icon: '🚶', description: 'Sidewalks, road edges, crosswalk-adjacent stops, street furniture, paths, and public circulation nodes.' }),
  courtyard: Object.freeze({ label: 'Courtyard', icon: '🏛️', description: 'Enclosed or semi-enclosed shared outdoor areas between buildings, campuses, and inner public yards.' }),
  'recreation-area': Object.freeze({ label: 'Recreation Area', icon: '🏓', description: 'Outdoor games, leisure, playground-like nodes, sports-adjacent areas, and informal social recreation spots.' }),
});

export const EXTERIOR_AREA_ALIASES = Object.freeze({
  parks: 'park',
  lawn: 'park',
  publicspace: 'plaza',
  'public-space': 'plaza',
  square: 'plaza',
  market: 'plaza',
  service: 'food-service',
  food: 'food-service',
  foodtruck: 'food-service',
  'food-truck': 'food-service',
  kiosk: 'food-service',
  cafe: 'outdoor-cafe',
  'outdoor-cafe-seating': 'outdoor-cafe',
  planter: 'garden',
  landscaping: 'garden',
  yard: 'training-yard',
  training: 'training-yard',
  dojo: 'training-yard',
  outdoortraining: 'training-yard',
  'outdoor-training': 'training-yard',
  bbq: 'patio',
  barbecue: 'patio',
  deck: 'patio',
  pond: 'pond-scenic-spot',
  scenic: 'pond-scenic-spot',
  viewpoint: 'pond-scenic-spot',
  sidewalk: 'street-sidewalk',
  street: 'street-sidewalk',
  streetside: 'street-sidewalk',
  'street-side': 'street-sidewalk',
  road: 'street-sidewalk',
  path: 'street-sidewalk',
  court: 'courtyard',
  quadrangle: 'courtyard',
  quad: 'courtyard',
  recreation: 'recreation-area',
  rec: 'recreation-area',
  game: 'recreation-area',
  games: 'recreation-area',
});

export const EXTERIOR_AREA_RULES = Object.freeze([
  'Every exterior activity location has exactly one primary exterior category from EXTERIOR_AREA_CATEGORIES.',
  'Use secondary tags for mixed-use placement such as park + plaza, patio + outdoor-cafe, or food-service + street-sidewalk.',
  'Exterior taxonomy is a suggestion/filter layer only; it must not restrict normal catalog placement or create a second editor catalog.',
  'Parks and outdoor areas reuse existing park/outdoor building records and outdoorArea.nodes rather than a parallel outdoor object store.',
  'Targets continue through setAgentTarget and the existing move-intent handoff; taxonomy metadata does not bypass collision, doorway, floor, sidewalk, or building-transition logic.',
]);

export const EXTERIOR_ACTIVITY_LOCATIONS = Object.freeze([
  Object.freeze({ id: 'park', label: 'Park', primaryExteriorCategory: 'park', secondaryTags: Object.freeze(['lawn', 'public-space', 'rest', 'social', 'garden', 'scenic']) }),
  Object.freeze({ id: 'plaza', label: 'Plaza', primaryExteriorCategory: 'plaza', secondaryTags: Object.freeze(['public-space', 'market', 'meeting', 'fountain', 'street-sidewalk']) }),
  Object.freeze({ id: 'foodTruckOutdoorService', label: 'Food Truck / Outdoor Service', primaryExteriorCategory: 'food-service', secondaryTags: Object.freeze(['food-truck', 'service-counter', 'queue', 'street-sidewalk', 'plaza']) }),
  Object.freeze({ id: 'outdoorCafe', label: 'Outdoor Cafe', primaryExteriorCategory: 'outdoor-cafe', secondaryTags: Object.freeze(['food-service', 'patio', 'social', 'seating', 'plaza']) }),
  Object.freeze({ id: 'garden', label: 'Garden', primaryExteriorCategory: 'garden', secondaryTags: Object.freeze(['planter', 'landscaping', 'park', 'decor', 'maintenance']) }),
  Object.freeze({ id: 'trainingYard', label: 'Training Yard', primaryExteriorCategory: 'training-yard', secondaryTags: Object.freeze(['practice', 'fitness', 'dojo', 'recreation-area', 'courtyard']) }),
  Object.freeze({ id: 'patio', label: 'Patio', primaryExteriorCategory: 'patio', secondaryTags: Object.freeze(['outdoor-cafe', 'garden', 'food-service', 'building-adjacent', 'social']) }),
  Object.freeze({ id: 'pondScenicSpot', label: 'Pond / Scenic Spot', primaryExteriorCategory: 'pond-scenic-spot', secondaryTags: Object.freeze(['pond', 'fountain', 'viewpoint', 'park', 'quiet']) }),
  Object.freeze({ id: 'streetSidewalk', label: 'Street / Sidewalk', primaryExteriorCategory: 'street-sidewalk', secondaryTags: Object.freeze(['sidewalk', 'crosswalk', 'path', 'queue', 'public-circulation']) }),
  Object.freeze({ id: 'courtyard', label: 'Courtyard', primaryExteriorCategory: 'courtyard', secondaryTags: Object.freeze(['campus', 'plaza', 'garden', 'building-adjacent', 'training-yard']) }),
  Object.freeze({ id: 'recreationArea', label: 'Recreation Area', primaryExteriorCategory: 'recreation-area', secondaryTags: Object.freeze(['game', 'social', 'training-yard', 'park', 'fitness']) }),
]);

export const EXTERIOR_INTERACTION_NODE_SCHEMA_VERSION = 'agent-life-exterior-interaction-node/v1';

export const EXTERIOR_INTERACTION_NODE_TYPES = Object.freeze([
  'seat',
  'gather',
  'browse',
  'order',
  'eat',
  'drink',
  'stroll',
  'watch',
  'exercise',
  'fish-view',
  'wait',
  'crossing',
  'enter-exit',
  'drop-off',
]);

export const EXTERIOR_INTERACTION_NODE_FIELDS = Object.freeze([
  Object.freeze({ key: 'id', required: true, meaning: 'Stable node id inside building.outdoorArea.nodes[]; duplicate ids are rejected per parent area.' }),
  Object.freeze({ key: 'type', required: true, meaning: 'Semantic exterior node type such as seat, gather, order, stroll, wait, enter-exit, or drop-off.' }),
  Object.freeze({ key: 'x', required: true, meaning: 'Outdoor-area local X coordinate in tile units. localX is accepted as a legacy alias.' }),
  Object.freeze({ key: 'z', required: true, meaning: 'Outdoor-area local Z coordinate in tile units. localZ is accepted as a legacy alias.' }),
  Object.freeze({ key: 'facing', required: true, meaning: 'Agent-facing direction at the resolved action target: north/east/south/west/auto/none.' }),
  Object.freeze({ key: 'roles', required: true, meaning: 'Action-location roles exposed to routing, reservations, and world actions; seat/gather nodes have explicit role defaults.' }),
  Object.freeze({ key: 'catalogId', required: false, meaning: 'Optional placed-object catalog asset used for rendering/collision while preserving the node semantic type separately.' }),
]);

export const EXTERIOR_INTERACTION_NODE_TYPE_ROLES = Object.freeze({
  seat: Object.freeze(['seat', 'use', 'rest']),
  gather: Object.freeze(['gather', 'social', 'use']),
  browse: Object.freeze(['browse', 'inspect', 'use']),
  order: Object.freeze(['order', 'service', 'queue', 'use']),
  eat: Object.freeze(['eat', 'seat', 'use']),
  drink: Object.freeze(['drink', 'seat', 'use']),
  stroll: Object.freeze(['stroll', 'pass-through']),
  watch: Object.freeze(['watch', 'social']),
  exercise: Object.freeze(['exercise', 'use']),
  'fish-view': Object.freeze(['fish-view', 'watch', 'use']),
  wait: Object.freeze(['wait', 'queue']),
  crossing: Object.freeze(['cross', 'crossing', 'route', 'waypoint', 'pass-through']),
  'enter-exit': Object.freeze(['enter-exit', 'pass-through']),
  'drop-off': Object.freeze(['drop-off', 'service']),
});

export const EXTERIOR_INTERACTION_NODE_ACTIONS = Object.freeze({
  seat: 'life.restAtOutdoorSeat',
  gather: 'life.gatherOutdoors',
  browse: 'life.browseOutdoorNode',
  order: 'life.orderAtOutdoorService',
  eat: 'life.eatOutdoors',
  drink: 'life.drinkOutdoors',
  stroll: 'life.strollOutdoors',
  watch: 'life.watchOutdoorPoint',
  exercise: 'training.exerciseOutdoors',
  'fish-view': 'life.fishOrViewWater',
  wait: 'life.waitOutdoors',
  crossing: 'world.useCrosswalkNode',
  'enter-exit': 'world.enterExitOutdoorArea',
  'drop-off': 'world.dropOffOutdoorItem',
});

export const PHASE_1B_EXTERIOR_ASSET_TAXONOMY = Object.freeze({
  parkBench: Object.freeze({ primaryExteriorCategory: 'park', secondaryTags: Object.freeze(['plaza', 'courtyard', 'street-sidewalk', 'pond-scenic-spot', 'recreation-area', 'seating', 'rest', 'social']) }),
  foodTruckCounter: Object.freeze({ primaryExteriorCategory: 'food-service', secondaryTags: Object.freeze(['outdoor-cafe', 'plaza', 'street-sidewalk', 'park', 'queue', 'service-counter', 'life.food']) }),
  patioChair: Object.freeze({ primaryExteriorCategory: 'patio', secondaryTags: Object.freeze(['outdoor-cafe', 'garden', 'plaza', 'courtyard', 'seating', 'social']) }),
  outdoorCafeTable: Object.freeze({ primaryExteriorCategory: 'outdoor-cafe', secondaryTags: Object.freeze(['patio', 'plaza', 'courtyard', 'park', 'street-sidewalk', 'food-service', 'life.food', 'life.hydration', 'social', 'seating']) }),
  picnicTable: Object.freeze({ primaryExteriorCategory: 'park', secondaryTags: Object.freeze(['patio', 'plaza', 'courtyard', 'outdoor-cafe', 'food-service', 'life.food', 'life.hydration', 'social', 'seating', 'picnic']) }),
  patioTable: Object.freeze({ primaryExteriorCategory: 'outdoor-cafe', secondaryTags: Object.freeze(['patio', 'garden', 'plaza', 'courtyard', 'food-service', 'life.food', 'social']) }),
  grill: Object.freeze({ primaryExteriorCategory: 'patio', secondaryTags: Object.freeze(['food-service', 'park', 'courtyard', 'recreation-area', 'life.food', 'social']) }),
  busStop: Object.freeze({ primaryExteriorCategory: 'street-sidewalk', secondaryTags: Object.freeze(['park', 'plaza', 'public-circulation', 'transit', 'queue', 'seating', 'rest']) }),
  outdoorNoticeBoard: Object.freeze({ primaryExteriorCategory: 'plaza', secondaryTags: Object.freeze(['park', 'courtyard', 'public-space', 'street-sidewalk', 'planning.notice', 'read', 'inspect']) }),
  parkLamp: Object.freeze({ primaryExteriorCategory: 'street-sidewalk', secondaryTags: Object.freeze(['park', 'plaza', 'courtyard', 'public-space', 'path-lighting', 'decor', 'inspect', 'landmark']) }),
  gazeboPavilion: Object.freeze({ primaryExteriorCategory: 'park', secondaryTags: Object.freeze(['plaza', 'courtyard', 'public-space', 'shelter', 'covered-gathering', 'seating', 'rest', 'social']) }),
  crosswalkNode: Object.freeze({ primaryExteriorCategory: 'street-sidewalk', secondaryTags: Object.freeze(['crosswalk', 'crossing', 'public-circulation', 'route-waypoint', 'sidewalk', 'road']) }),
  pathNode: Object.freeze({ primaryExteriorCategory: 'street-sidewalk', secondaryTags: Object.freeze(['park', 'plaza', 'courtyard', 'public-circulation', 'route-waypoint', 'sidewalk', 'stroll', 'walking-path']) }),
  outdoorPlanter: Object.freeze({ primaryExteriorCategory: 'garden', secondaryTags: Object.freeze(['park', 'plaza', 'patio', 'courtyard', 'decor', 'maintenance']) }),
  outdoorTrashCan: Object.freeze({ primaryExteriorCategory: 'street-sidewalk', secondaryTags: Object.freeze(['park', 'plaza', 'courtyard', 'public-space', 'patio', 'maintenance.clean', 'temporary-cleanup']) }),
  flowerBed: Object.freeze({ primaryExteriorCategory: 'garden', secondaryTags: Object.freeze(['park', 'plaza', 'courtyard', 'flower-bed', 'decor', 'maintenance']) }),
  fountain: Object.freeze({ primaryExteriorCategory: 'plaza', secondaryTags: Object.freeze(['park', 'pond-scenic-spot', 'courtyard', 'public-space', 'watch', 'gather', 'rest', 'social']) }),
  shadeTreeCluster: Object.freeze({ primaryExteriorCategory: 'park', secondaryTags: Object.freeze(['garden', 'courtyard', 'plaza', 'public-space', 'shade', 'rest', 'gather', 'social', 'soft-shade-zone']) }),
  outdoorStage: Object.freeze({ primaryExteriorCategory: 'plaza', secondaryTags: Object.freeze(['park', 'courtyard', 'public-space', 'performance', 'watch', 'gather', 'audience', 'social']) }),
  storageBoxes: Object.freeze({ primaryExteriorCategory: 'training-yard', secondaryTags: Object.freeze(['courtyard', 'patio', 'street-sidewalk', 'maintenance', 'service', 'storage']) }),
  workbench: Object.freeze({ primaryExteriorCategory: 'training-yard', secondaryTags: Object.freeze(['patio', 'courtyard', 'street-sidewalk', 'maintenance', 'workshop', 'service']) }),
  outdoorExerciseStation: Object.freeze({ primaryExteriorCategory: 'training-yard', secondaryTags: Object.freeze(['park', 'courtyard', 'plaza', 'recreation-area', 'fitness', 'calisthenics', 'training.practice']) }),
  playgroundSlide: Object.freeze({ primaryExteriorCategory: 'recreation-area', secondaryTags: Object.freeze(['park', 'playground', 'courtyard', 'public-space', 'life.play', 'climb', 'slide']) }),
  playgroundSwing: Object.freeze({ primaryExteriorCategory: 'recreation-area', secondaryTags: Object.freeze(['park', 'playground', 'courtyard', 'public-space', 'life.play', 'swing', 'seating', 'soft-clearance']) }),
  pondDock: Object.freeze({ primaryExteriorCategory: 'pond-scenic-spot', secondaryTags: Object.freeze(['park', 'water-edge', 'viewpoint', 'fish-view', 'rest', 'dock-safe']) }),
});

export const EXTERIOR_ROUTING_CLASSES = Object.freeze(['solidObject', 'softActivityZone', 'marker']);

export const EXTERIOR_ROUTING_RULES = Object.freeze({
  solidObject: Object.freeze({
    collider: 'static',
    routingEffect: 'block',
    colliderHelper: 'resolvePlacedCollisionBounds() -> addBoxCollider()/addDecorationCollider()',
    approachClearanceTiles: 0.65,
    boundaryBehavior: 'footprint must stay inside the parent outdoorArea/building footprint plus configured clearance',
  }),
  softActivityZone: Object.freeze({
    collider: 'none',
    routingEffect: 'target-only',
    colliderHelper: 'no hard collider; route to node/action spot through setAgentTarget()',
    approachClearanceTiles: 0.35,
    boundaryBehavior: 'target may sit inside passable park/sidewalk/courtyard surfaces but does not block neighbors',
  }),
  marker: Object.freeze({
    collider: 'none',
    routingEffect: 'ignore',
    colliderHelper: 'render/label metadata only; no physics or pathing obstacle',
    approachClearanceTiles: 0,
    boundaryBehavior: 'must resolve within parent outdoorArea bounds when a parent exists; otherwise ignored for pathing',
  }),
});

export const EXTERIOR_ASSET_ROUTING_RULES = freezeDeep({
  parkBench: { routingClass: 'solidObject', colliderAsset: 'parkBench', approachClearanceTiles: 0.55, preferredApproach: 'front-or-side', routePreference: 'park-path-or-sidewalk', boundaryBehavior: 'inside-park-or-sidewalk-edge' },
  foodTruckCounter: { routingClass: 'solidObject', colliderAsset: 'foodTruckCounter', approachClearanceTiles: 0.9, preferredApproach: 'service-front', routePreference: 'sidewalk-or-plaza; roads only via crosswalk fallback', boundaryBehavior: 'keep service queue off roads and outside building footprints' },
  patioChair: { routingClass: 'solidObject', colliderAsset: 'patioChair', approachClearanceTiles: 0.45, preferredApproach: 'seat-front', routePreference: 'patio-courtyard-park-sidewalk', boundaryBehavior: 'chair footprint blocks, seat node remains reachable' },
  outdoorCafeTable: { routingClass: 'solidObject', colliderAsset: 'outdoorCafeTable', approachClearanceTiles: 0.75, preferredApproach: 'exterior-table-seat-ring', routePreference: 'outdoor-cafe/patio/plaza/sidewalk to seat/drop-off spots through setAgentTarget/dynamic exterior routing', boundaryBehavior: 'solid table center blocks; four seat spots and tabletop drop-off spot stay outside/at the footprint and reachable without door, floor, sidewalk, or transition bypass' },
  picnicTable: { routingClass: 'solidObject', colliderAsset: 'picnicTable', approachClearanceTiles: 0.75, preferredApproach: 'bench-seat-pair-or-tabletop', routePreference: 'park/patio/plaza/courtyard/sidewalk to reachable bench seats or tabletop drop-off through setAgentTarget/dynamic exterior routing', boundaryBehavior: 'one solid table-and-benches footprint blocks movement; four bench seat offsets and two tabletop spots stay reachable without bypassing collisions, floors, doors, sidewalks, or building transitions' },
  patioTable: { routingClass: 'solidObject', colliderAsset: 'patioTable', approachClearanceTiles: 0.75, preferredApproach: 'table-edge', routePreference: 'patio-courtyard-park-sidewalk', boundaryBehavior: 'reserve edge approach slots; table center blocks' },
  grill: { routingClass: 'solidObject', colliderAsset: 'grill', approachClearanceTiles: 1.0, preferredApproach: 'cool-front', routePreference: 'patio-park-courtyard; avoid roads/water edges', boundaryBehavior: 'hot-side clearance stays in parent area and away from building footprint overlap' },
  busStop: { routingClass: 'solidObject', colliderAsset: 'busStop', approachClearanceTiles: 0.7, preferredApproach: 'sidewalk-front', routePreference: 'roadside-sidewalk/perimeter-sidewalk first; roads only via existing crossings', boundaryBehavior: 'solid shelter footprint stays off road/crosswalk cells; sidewalk approach remains passable' },
  outdoorNoticeBoard: { routingClass: 'solidObject', colliderAsset: 'outdoorNoticeBoard', approachClearanceTiles: 0.65, preferredApproach: 'front-read-clearance', routePreference: 'park/plaza/courtyard/sidewalk to read-front or point-front through setAgentTarget/dynamic exterior routing', boundaryBehavior: 'thin solid posts/board block movement while front read/inspect/clearance spots stay outside the footprint and away from roads, doors, sidewalks, and building-transition corridors' },
  parkLamp: { routingClass: 'solidObject', colliderAsset: 'parkLamp', approachClearanceTiles: 0.35, preferredApproach: 'small-front-inspect-spot', routePreference: 'park/plaza/courtyard/sidewalk path-light edge through setAgentTarget/dynamic exterior routing', boundaryBehavior: 'narrow solid pole blocks only a small footprint; inspect spot stays outside the pole and must not trap agents on narrow sidewalks, doors, floors, or building-transition corridors' },
  gazeboPavilion: { routingClass: 'solidObject', colliderAsset: 'gazeboPavilion', approachClearanceTiles: 0.75, preferredApproach: 'open-south-entrance-then-covered-interior-spots', routePreference: 'park-plaza-courtyard paths to entrance approach, then target interior gather/rest/sit spot through setAgentTarget/dynamic exterior routing', boundaryBehavior: 'segmented post and rail colliders block structure while entrance and interior gather/rest/sit spots remain reachable; keep off roads, doors, and building-transition corridors' },
  crosswalkNode: { routingClass: 'marker', colliderAsset: null, approachClearanceTiles: 0, preferredApproach: 'entry-or-exit-sidewalk-waypoint', routePreference: 'roadside/perimeter sidewalk to crosswalk; target-only marker through setAgentTarget/dynamic-exterior-routing', boundaryBehavior: 'non-solid crosswalk marker may sit on road/crosswalk cells and must never block roads or sidewalks' },
  pathNode: { routingClass: 'marker', colliderAsset: null, approachClearanceTiles: 0, preferredApproach: 'node-center-stroll-waypoint', routePreference: 'sidewalk helpers and dynamic exterior routing choose sidewalk/park path; target-only marker through setAgentTarget with no new pathfinding', boundaryBehavior: 'non-solid walking path node sits on passable path/sidewalk/park surfaces and must never block movement, roads, sidewalks, doors, floors, or building transitions' },
  outdoorPlanter: { routingClass: 'solidObject', colliderAsset: 'outdoorPlanter', approachClearanceTiles: 0.5, preferredApproach: 'inspect-front-or-side', routePreference: 'garden-park-plaza-edge', boundaryBehavior: 'solid planter blocks but decorative area around it does not' },
  outdoorTrashCan: { routingClass: 'solidObject', colliderAsset: 'outdoorTrashCan', approachClearanceTiles: 0.55, preferredApproach: 'front-dispose-clearance', routePreference: 'park/plaza/sidewalk/courtyard paths to dispose-front through setAgentTarget/dynamic exterior routing', boundaryBehavior: 'small solid can blocks movement; front dispose and side inspect spots remain outside the footprint and away from roads, doors, sidewalks, and building-transition corridors' },
  flowerBed: { routingClass: 'solidObject', colliderAsset: 'flowerBed', approachClearanceTiles: 0.5, preferredApproach: 'front-edge-inspect-smell-water', routePreference: 'garden-park-plaza-edge; route to edge spots through setAgentTarget/dynamic exterior routing', boundaryBehavior: 'low solid soil/flower footprint blocks; front edge action spots remain outside the bed' },
  fountain: { routingClass: 'solidObject', colliderAsset: 'fountain', approachClearanceTiles: 0.65, preferredApproach: 'dry-perimeter-watch-gather-ring', routePreference: 'park-plaza-path to perimeter action spot through setAgentTarget/dynamic exterior routing', boundaryBehavior: 'solid basin/water footprint blocks; watch/gather/rest spots stay outside the water and off building transitions' },
  shadeTreeCluster: { routingClass: 'solidObject', colliderAsset: 'shadeTreeCluster', approachClearanceTiles: 0.65, preferredApproach: 'canopy-edge-rest-read-gather-spots', routePreference: 'park/garden/courtyard paths to shade spots through setAgentTarget/dynamic exterior routing', boundaryBehavior: 'segmented solid trunk colliders block only the tree bases; canopy shade radius is soft/non-blocking and action spots stay outside trunks, roads, doors, sidewalks, floors, and building transitions' },
  outdoorStage: { routingClass: 'solidObject', colliderAsset: 'outdoorStage', approachClearanceTiles: 0.8, preferredApproach: 'front-step-performer-or-audience-ring', routePreference: 'plaza/park/courtyard paths to perform/watch/gather spots through setAgentTarget/dynamic exterior routing', boundaryBehavior: 'solid stepped platform/backdrop blocks; performer step and audience watch/gather spots remain reachable and off roads, doors, sidewalks, and building-transition corridors' },
  storageBoxes: { routingClass: 'solidObject', colliderAsset: 'storageBoxes', approachClearanceTiles: 0.7, preferredApproach: 'inspect-front', routePreference: 'courtyard-patio-sidewalk-service-edge', boundaryBehavior: 'service clearance cannot spill into roads or door thresholds' },
  workbench: { routingClass: 'solidObject', colliderAsset: 'workbench', approachClearanceTiles: 0.85, preferredApproach: 'work-front', routePreference: 'training-yard-courtyard-patio-service-edge', boundaryBehavior: 'work clearance stays outside building footprints and water edges' },
  outdoorExerciseStation: { routingClass: 'solidObject', colliderAsset: 'outdoorExerciseStation', approachClearanceTiles: 0.85, preferredApproach: 'front-training-clearance-or-platform', routePreference: 'training-yard/park/courtyard paths to train/practice spots through setAgentTarget/dynamic exterior routing', boundaryBehavior: 'solid bars/platform block; non-blocking train/practice/watch clearance spots remain reachable and off roads, doors, sidewalks, and building-transition corridors' },
  playgroundSlide: { routingClass: 'solidObject', colliderAsset: 'playgroundSlide', approachClearanceTiles: 0.9, preferredApproach: 'ladder-approach-then-slide-exit', routePreference: 'park/playground/recreation-area paths to ladder approach through setAgentTarget/dynamic exterior routing, then dock/finish at slide exit metadata', boundaryBehavior: 'solid ladder/platform/chute blocks; ladder approach and slide exit remain clear and off roads, doors, sidewalks, and building-transition corridors' },
  playgroundSwing: { routingClass: 'solidObject', colliderAsset: 'playgroundSwing', approachClearanceTiles: 1.05, preferredApproach: 'front-approach-to-seat-use-with-soft-swing-arc', routePreference: 'park/playground/recreation-area paths to front approach or seat through setAgentTarget/dynamic exterior routing; soft swing clearance is reserved as no-through-routing metadata, not a second router', boundaryBehavior: 'solid A-frame legs/top support block movement; seat/use and wait-turn spots remain reachable while the soft swing clearance zone is not used as a through path and stays off roads, doors, sidewalks, and building-transition corridors' },
  pondDock: { routingClass: 'solidObject', colliderAsset: 'pondDock', approachClearanceTiles: 0.75, preferredApproach: 'land-approach-to-safe-dock-view-spots', routePreference: 'park/pond-scenic path to land approach, then view/relax spots through setAgentTarget/dynamic exterior routing', boundaryBehavior: 'solid planks/rails block movement; water-edge orientation and approachSide persist so final route targets stay on dock/land-safe spots and never inside water terrain, roads, doors, sidewalks, floors, or building-transition corridors' },
});

export const EXTERIOR_NODE_ROUTING_RULES = freezeDeep({
  seat: { routingClass: 'softActivityZone', approachClearanceTiles: 0.35, routePreference: 'nearby park path/sidewalk/patio; target only, no extra collider' },
  gather: { routingClass: 'softActivityZone', approachClearanceTiles: 0.45, routePreference: 'open park/plaza/courtyard passable surface' },
  browse: { routingClass: 'softActivityZone', approachClearanceTiles: 0.4, routePreference: 'front of solid object via existing action spot' },
  order: { routingClass: 'softActivityZone', approachClearanceTiles: 0.75, routePreference: 'queue on sidewalk/plaza side; avoid road cells except crosswalks' },
  eat: { routingClass: 'softActivityZone', approachClearanceTiles: 0.45, routePreference: 'patio/cafe edge reachable around table collider' },
  drink: { routingClass: 'softActivityZone', approachClearanceTiles: 0.45, routePreference: 'patio/cafe edge reachable around table collider' },
  stroll: { routingClass: 'marker', approachClearanceTiles: 0, routePreference: 'pass-through marker; dynamic exterior routing chooses sidewalk/park path' },
  watch: { routingClass: 'softActivityZone', approachClearanceTiles: 0.35, routePreference: 'scenic node; keep away from water edge by parent boundary clearance' },
  exercise: { routingClass: 'softActivityZone', approachClearanceTiles: 0.75, routePreference: 'training-yard/courtyard passable surface' },
  'fish-view': { routingClass: 'softActivityZone', approachClearanceTiles: 0.6, routePreference: 'water-edge viewing node; target remains on dry passable cell' },
  wait: { routingClass: 'softActivityZone', approachClearanceTiles: 0.45, routePreference: 'queue/wait node near sidewalk or service front' },
  crossing: { routingClass: 'marker', approachClearanceTiles: 0, routePreference: 'pass-through crosswalk marker; route via existing sidewalk/crosswalk/road surface costs and setAgentTarget handoff only' },
  'enter-exit': { routingClass: 'marker', approachClearanceTiles: 0, routePreference: 'handoff marker; do not override door/building-transition logic' },
  'drop-off': { routingClass: 'softActivityZone', approachClearanceTiles: 0.5, routePreference: 'service/dropoff node routed by existing move intent' },
});

export const EXTERIOR_CLEARANCE_RULES = freezeDeep({
  roads: { minClearanceTiles: 1, behavior: 'solid footprints and soft-zone approach points stay off road tiles; dynamic exterior routing may use roads only through existing crosswalk/road fallback logic' },
  sidewalks: { minClearanceTiles: 0.35, behavior: 'prefer sidewalk/roadside/perimeter sidewalk surfaces before roads, preserving current dynamic-exterior-routing surface costs' },
  crosswalks: { minClearanceTiles: 0.25, behavior: 'crosswalks remain passable transition surfaces and must not receive new hard colliders' },
  waterEdges: { minClearanceTiles: 1, behavior: 'scenic/fish-view targets sit on dry passable parent-area cells; solid footprints do not overlap water-edge clearance' },
  buildingFootprints: { minClearanceTiles: 1, behavior: 'solid outdoor assets must not overlap non-park building footprints, door thresholds, or doorway handoff corridors' },
  outdoorAreaBoundary: { minClearanceTiles: 0.25, behavior: 'missing outdoorArea data is safe; when bounds exist, solid footprints stay inside and soft targets clamp/reject through existing normalization without a new store' },
});

export const EXTERIOR_BUILDING_RECORD_REUSE = Object.freeze({
  authoritativeStateOwner: 'Existing park/outdoor building records with optional building.outdoorArea metadata.',
  durableNodePath: 'building.outdoorArea.nodes[] / buildings/<id>.json#outdoorArea.nodes[index]',
  runtimeRenderingOwner: 'main3d.js createBuilding3D() -> addParkContent() -> addOutdoorAreaNodes()',
  collisionOwner: 'main3d.js addParkFurnitureColliders() with resolvePlacedCollisionBounds()/addDecorationCollider()',
  routeOwner: 'main3d.js setAgentTarget() with dynamic-exterior-routing.js and dynamic-interior-routing.js handoff metadata',
  noParallelStore: 'Do not introduce /api/outdoor-areas, /api/outdoor-nodes, duplicate exterior routers, or duplicate asset ids.',
});

function canon(value) {
  return String(value || '').trim().toLowerCase().replace(/[\s_]+/g, '-');
}

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function freezeDeep(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freezeDeep(child);
  return value;
}

function finiteNumber(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeFacing(value = 'auto') {
  const raw = canon(value || 'auto');
  return ['north', 'east', 'south', 'west', 'auto', 'none'].includes(raw) ? raw : 'auto';
}

function normalizeNodeType(value) {
  const raw = canon(value);
  if (raw === 'fish' || raw === 'view' || raw === 'fishview' || raw === 'fish-view') return 'fish-view';
  if (raw === 'cross' || raw === 'crossing' || raw === 'crosswalk' || raw === 'crosswalknode' || raw === 'crosswalk-node' || raw === 'crossingnode' || raw === 'crossing-node') return 'crossing';
  if (raw === 'entry' || raw === 'exit' || raw === 'enter' || raw === 'enterexit' || raw === 'enter-exit') return 'enter-exit';
  if (raw === 'dropoff' || raw === 'drop-off') return 'drop-off';
  return EXTERIOR_INTERACTION_NODE_TYPES.includes(raw) ? raw : null;
}

function inferNodeTypeFromAsset(node = {}) {
  const asset = canon(node.catalogId || node.objectCatalogId || node.assetId || node.type);
  if (['busstop', 'bus-stop', 'busshelter', 'bus-shelter', 'waitingshelter', 'waiting-shelter', 'transitstop', 'transit-stop'].includes(asset)) return 'wait';
  if (['outdoornoticeboard', 'outdoor-notice-board', 'plazanoticeboard', 'plaza-notice-board', 'parknoticeboard', 'park-notice-board', 'noticeboard', 'notice-board'].includes(asset)) return 'browse';
  if (['crosswalknode', 'crosswalk-node', 'crossingnode', 'crossing-node', 'crosswalk', 'crossing'].includes(asset)) return 'crossing';
  if (['pathnode', 'path-node', 'walkingpathnode', 'walking-path-node', 'strollnode', 'stroll-node', 'walking-path'].includes(asset)) return 'stroll';
  if (['parkbench', 'park-bench', 'patiochair', 'patio-chair', 'chair', 'bench', 'hallwaybench', 'hallway-bench'].includes(asset)) return 'seat';
  if (['patiotable', 'patio-table', 'smallcafetable', 'small-cafe-table', 'diningtable', 'dining-table', 'grill'].includes(asset)) return 'eat';
  if (['foodtruckcounter', 'food-truck-counter', 'cafecounter', 'cafe-counter', 'counter', 'checkoutcounter', 'checkout-counter'].includes(asset)) return 'order';
  if (['outdoortrashcan', 'outdoor-trash-can', 'parktrashcan', 'park-trash-can', 'sidewalktrashcan', 'sidewalk-trash-can'].includes(asset)) return 'drop-off';
  if (['outdoorplanter', 'outdoor-planter', 'plant', 'fountain', 'shadetreecluster', 'shade-tree-cluster', 'shadetree', 'shade-tree', 'treecluster', 'tree-cluster'].includes(asset)) return 'watch';
  if (['storageboxes', 'storage-boxes', 'trashbin', 'trash-bin'].includes(asset)) return 'drop-off';
  if (['workbench', 'trainingmat', 'training-mat', 'treadmill', 'gymbench', 'gym-bench', 'dumbbellrack', 'dumbbell-rack', 'outdoorexercisestation', 'outdoor-exercise-station', 'calisthenicsstation', 'calisthenics-station'].includes(asset)) return 'exercise';
  if (['outdoorstage', 'outdoor-stage', 'performance-stage', 'performancespot', 'performance-spot'].includes(asset)) return 'gather';
  return null;
}

function uniqueRoles(values, fallback = []) {
  const out = [];
  for (const value of [...(Array.isArray(values) ? values : []), ...fallback]) {
    const role = canon(value);
    if (role && !out.includes(role)) out.push(role);
  }
  return Object.freeze(out);
}

export function normalizeExteriorInteractionNode(node, { building = null, outdoorArea = null, index = 0, usedIds = null } = {}) {
  if (!isRecord(node)) return freezeDeep({ valid: false, node: null, errors: ['node must be an object'] });
  const errors = [];
  const rawType = node.nodeType || node.interactionType || node.actionType || node.type;
  const nodeType = normalizeNodeType(rawType) || inferNodeTypeFromAsset(node);
  if (!nodeType) errors.push(`type must be one of ${EXTERIOR_INTERACTION_NODE_TYPES.join(', ')}`);

  const rawRuntimeType = typeof node.type === 'string' && node.type.trim() ? node.type.trim() : null;
  const rawRuntimeTypeIsSemantic = Boolean(normalizeNodeType(rawRuntimeType));
  const assetType = typeof node.assetId === 'string' && node.assetId.trim()
    ? node.assetId.trim()
    : (rawRuntimeType && !rawRuntimeTypeIsSemantic
      ? rawRuntimeType
      : (typeof node.catalogId === 'string' && node.catalogId.trim()
        ? node.catalogId.trim()
        : (typeof node.objectCatalogId === 'string' && node.objectCatalogId.trim()
          ? node.objectCatalogId.trim()
          : rawRuntimeType)));
  const catalogId = typeof node.catalogId === 'string' && node.catalogId.trim()
    ? node.catalogId.trim()
    : (node.objectCatalogId || assetType || null);
  const buildingId = String(node.buildingId || building?.id || outdoorArea?.buildingId || '').trim();
  const outdoorAreaId = String(node.outdoorAreaId || outdoorArea?.id || building?.outdoorArea?.id || buildingId || '').trim();
  const id = String(node.id || node.instanceId || `${outdoorAreaId || buildingId || 'outdoor-area'}-${nodeType || 'node'}-${index}`).trim();
  if (!id) errors.push('id must be a non-empty string');
  if (usedIds?.has?.(id)) errors.push(`duplicate node id ${id}`);

  const x = finiteNumber(node.x ?? node.localX, null);
  const z = finiteNumber(node.z ?? node.localZ, null);
  if (x === null) errors.push('x/localX must be a finite outdoor-area local coordinate');
  if (z === null) errors.push('z/localZ must be a finite outdoor-area local coordinate');

  if (errors.length > 0) return freezeDeep({ valid: false, node: null, errors });

  const roles = uniqueRoles(node.roles, EXTERIOR_INTERACTION_NODE_TYPE_ROLES[nodeType]);
  const routing = resolveExteriorRoutingEnvelope({ assetId: catalogId || assetType, nodeType, node });
  return freezeDeep({
    valid: true,
    errors: [],
    node: {
      ...node,
      id,
      type: nodeType,
      nodeType,
      catalogId: catalogId || node.catalogId || null,
      assetId: assetType,
      renderType: assetType,
      buildingId: buildingId || null,
      outdoorAreaId: outdoorAreaId || null,
      outdoorAreaType: node.outdoorAreaType || outdoorArea?.outdoorAreaType || building?.outdoorAreaType || building?.type || null,
      x,
      z,
      localX: x,
      localZ: z,
      facing: normalizeFacing(node.facing),
      roles,
      actionId: node.actionId || EXTERIOR_INTERACTION_NODE_ACTIONS[nodeType],
      coordinateSpace: 'outdoor-local',
      floor: 1,
      kind: 'exterior-interaction-node',
      targetKind: 'outdoor-area-node',
      routing,
      approachClearanceTiles: routing.approachClearanceTiles,
    },
  });
}

export function normalizeExteriorInteractionNodes(nodes, options = {}) {
  const usedIds = new Set();
  const normalized = [];
  const rejected = [];
  const list = Array.isArray(nodes) ? nodes : [];
  list.forEach((node, index) => {
    const result = normalizeExteriorInteractionNode(node, { ...options, index, usedIds });
    if (result.valid) {
      usedIds.add(result.node.id);
      normalized.push(result.node);
    } else {
      rejected.push(Object.freeze({ index, id: node?.id || null, errors: result.errors }));
    }
  });
  return freezeDeep({ nodes: normalized, rejected, validCount: normalized.length, rejectedCount: rejected.length });
}

export function resolveExteriorInteractionNodeTarget(node, { building = null, outdoorArea = null, apiTile = 40 } = {}) {
  const result = normalizeExteriorInteractionNode(node, { building, outdoorArea });
  if (!result.valid) return freezeDeep({ valid: false, errors: result.errors, target: null, actionSpot: null });
  const normalized = result.node;
  const baseX = finiteNumber(building?.worldX ?? building?.x, 0);
  const baseZ = finiteNumber(building?.worldY ?? building?.z, 0);
  const localX = finiteNumber(normalized.x, 0);
  const localZ = finiteNumber(normalized.z, 0);
  const worldX = finiteNumber(normalized.worldX, null) ?? baseX + localX;
  const worldZ = finiteNumber(normalized.worldZ, null) ?? baseZ + localZ;
  const scale = finiteNumber(apiTile, 40) || 40;
  const actionSpot = freezeDeep({
    id: `${normalized.id}:target`,
    nodeId: normalized.id,
    type: normalized.type,
    roles: normalized.roles,
    actionId: normalized.actionId,
    facing: normalized.facing,
    floor: 1,
    localX,
    localZ,
    worldX,
    worldZ,
    apiX: worldX * scale,
    apiZ: worldZ * scale,
    coordinateSpace: 'outdoor-local',
    targetKind: 'outdoor-area-node',
    routing: normalized.routing,
    approachClearanceTiles: normalized.approachClearanceTiles,
  });
  return freezeDeep({
    valid: true,
    errors: [],
    node: normalized,
    actionSpot,
    target: { x: actionSpot.apiX, y: actionSpot.apiZ, floor: 1, targetKind: 'outdoor-area-node', nodeId: normalized.id, actionId: normalized.actionId, roles: normalized.roles, routing: normalized.routing, approachClearanceTiles: normalized.approachClearanceTiles },
  });
}

export function normalizeExteriorAreaCategory(value) {
  const raw = canon(value);
  if (!raw) return null;
  if (EXTERIOR_AREA_CATEGORIES.includes(raw)) return raw;
  const compact = raw.replace(/-/g, '');
  return EXTERIOR_AREA_ALIASES[raw] || EXTERIOR_AREA_ALIASES[compact] || null;
}

export function getExteriorAreaCategoryDisplay(category) {
  const normalized = normalizeExteriorAreaCategory(category);
  return normalized ? EXTERIOR_AREA_CATEGORY_DISPLAY[normalized] || null : null;
}

export function getPhase1BExteriorAssetTaxonomy(id) {
  return PHASE_1B_EXTERIOR_ASSET_TAXONOMY[id] || null;
}

export function getExteriorAssetRoutingRule(id) {
  const raw = String(id || '').trim();
  if (!raw) return null;
  const compact = raw.replace(/[-_\s]+(.)?/g, (_, c = '') => c.toUpperCase());
  return EXTERIOR_ASSET_ROUTING_RULES[raw]
    || EXTERIOR_ASSET_ROUTING_RULES[compact]
    || EXTERIOR_ASSET_ROUTING_RULES[raw.replace(/[-_\s]+/g, '')]
    || null;
}

export function getExteriorInteractionNodeRoutingRule(type) {
  const normalized = normalizeNodeType(type);
  return normalized ? (EXTERIOR_NODE_ROUTING_RULES[normalized] || null) : null;
}

export function resolveExteriorRoutingEnvelope({ assetId = null, nodeType = null, node = null } = {}) {
  const resolvedNodeType = nodeType || node?.nodeType || node?.type || null;
  const nodeRule = getExteriorInteractionNodeRoutingRule(resolvedNodeType);
  const resolvedAssetId = assetId || node?.catalogId || node?.objectCatalogId || node?.assetId || node?.renderType || null;
  const assetRule = getExteriorAssetRoutingRule(resolvedAssetId);
  const routingClass = assetRule?.routingClass || nodeRule?.routingClass || 'marker';
  const classRule = EXTERIOR_ROUTING_RULES[routingClass] || EXTERIOR_ROUTING_RULES.marker;
  const approachClearanceTiles = Math.max(
    0,
    finiteNumber(node?.approachClearanceTiles, null)
      ?? finiteNumber(assetRule?.approachClearanceTiles, null)
      ?? finiteNumber(nodeRule?.approachClearanceTiles, null)
      ?? finiteNumber(classRule?.approachClearanceTiles, 0)
  );
  return freezeDeep({
    routingClass,
    colliderAsset: assetRule?.colliderAsset || resolvedAssetId || null,
    collider: classRule.collider,
    routingEffect: classRule.routingEffect,
    blocksPathfinding: routingClass === 'solidObject',
    createsStaticCollider: classRule.collider === 'static',
    approachClearanceTiles,
    preferredApproach: assetRule?.preferredApproach || null,
    routePreference: assetRule?.routePreference || nodeRule?.routePreference || null,
    boundaryBehavior: assetRule?.boundaryBehavior || classRule.boundaryBehavior,
    clearance: EXTERIOR_CLEARANCE_RULES,
    handoff: 'setAgentTarget -> dynamic-exterior-routing',
  });
}

export function validateExteriorAreaTaxonomy() {
  const errors = [];
  const categorySet = new Set(EXTERIOR_AREA_CATEGORIES);
  const required = ['park', 'plaza', 'food-service', 'outdoor-cafe', 'garden', 'training-yard', 'patio', 'pond-scenic-spot', 'street-sidewalk', 'courtyard', 'recreation-area'];
  for (const category of required) {
    if (!categorySet.has(category)) errors.push(`missing required exterior category ${category}`);
    if (!EXTERIOR_AREA_CATEGORY_DISPLAY[category]?.label) errors.push(`${category} must have display metadata`);
  }
  const locationIds = new Set();
  for (const location of EXTERIOR_ACTIVITY_LOCATIONS) {
    if (!location.id || locationIds.has(location.id)) errors.push(`duplicate or missing exterior location id ${location.id || '<missing>'}`);
    locationIds.add(location.id);
    if (!categorySet.has(location.primaryExteriorCategory)) errors.push(`${location.id}.primaryExteriorCategory must be official`);
    if (!Array.isArray(location.secondaryTags)) errors.push(`${location.id}.secondaryTags must be an array`);
  }
  for (const [assetId, metadata] of Object.entries(PHASE_1B_EXTERIOR_ASSET_TAXONOMY)) {
    if (!categorySet.has(metadata.primaryExteriorCategory)) errors.push(`${assetId}.primaryExteriorCategory must be official`);
    if (!Array.isArray(metadata.secondaryTags)) errors.push(`${assetId}.secondaryTags must be an array`);
    const routing = getExteriorAssetRoutingRule(assetId);
    if (!routing) errors.push(`${assetId} must define an exterior routing/collision rule`);
    else if (!EXTERIOR_ROUTING_CLASSES.includes(routing.routingClass)) errors.push(`${assetId}.routingClass must be valid`);
  }
  for (const routingClass of EXTERIOR_ROUTING_CLASSES) {
    if (!EXTERIOR_ROUTING_RULES[routingClass]) errors.push(`${routingClass} must define a class rule`);
  }
  for (const clearanceKey of ['roads', 'sidewalks', 'crosswalks', 'waterEdges', 'buildingFootprints', 'outdoorAreaBoundary']) {
    if (!EXTERIOR_CLEARANCE_RULES[clearanceKey]) errors.push(`missing exterior clearance rule ${clearanceKey}`);
  }
  for (const nodeType of EXTERIOR_INTERACTION_NODE_TYPES) {
    if (!Array.isArray(EXTERIOR_INTERACTION_NODE_TYPE_ROLES[nodeType]) || EXTERIOR_INTERACTION_NODE_TYPE_ROLES[nodeType].length === 0) errors.push(`${nodeType} must define action roles`);
    if (!EXTERIOR_INTERACTION_NODE_ACTIONS[nodeType]) errors.push(`${nodeType} must define a default action id`);
    const routing = getExteriorInteractionNodeRoutingRule(nodeType);
    if (!routing) errors.push(`${nodeType} must define a node routing rule`);
    else if (!EXTERIOR_ROUTING_CLASSES.includes(routing.routingClass)) errors.push(`${nodeType}.routingClass must be valid`);
  }
  for (const required of ['seat', 'gather', 'browse', 'order', 'eat', 'drink', 'stroll', 'watch', 'exercise', 'fish-view', 'wait', 'crossing', 'enter-exit', 'drop-off']) {
    if (!EXTERIOR_INTERACTION_NODE_TYPES.includes(required)) errors.push(`missing required exterior interaction node type ${required}`);
  }
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}

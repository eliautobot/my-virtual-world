export const STARTER_MAP_NAME = 'My Virtual World';

export const STARTER_MAP_BUILDINGS = Object.freeze([
  {
    id: 'bld_1781275602998',
    name: 'First Park',
    type: 'park',
    worldX: 0,
    worldY: 22,
    widthTiles: 30,
    heightTiles: 20,
    _elevationY: 0.23,
    doorSpec: {
      localCenterX: 15,
      localThresholdZ: 20.135,
      localOutsideZ: 20.2,
      localInteriorZ: 18.8,
      localDoorwayZ: 19.55,
      doorwayReachWorld: 0.528,
      openingWidth: 2.4,
      wallThickness: 0.25,
    },
    outdoorArea: {
      id: 'bld_1781275602998:outside',
      outdoorAreaType: 'park',
      deletedGeneratedNodeIds: ['bld_1781275602998:auto-tree:2:1'],
      nodes: [
        { id: 'bld_1781275602998:auto-tree:1:0', type: 'shadeTreeCluster', renderType: 'shadeTreeCluster', catalogId: 'shadeTreeCluster', assetId: 'shadeTreeCluster', x: 9.726, z: 4.043, rotation: 180, scale: 1.158, sizeClass: 'standard-pine', roles: ['rest', 'shade', 'inspect'], generatedBy: 'park-auto-tree-grid/v1', persistsUntilDeleted: true, lifecycle: { stationary: true, carryable: false, temporary: false, persistsUntilDeleted: true, solidTree: true } },
        { id: 'bld_1781275602998:auto-tree:0:1', type: 'shadeTreeCluster', renderType: 'shadeTreeCluster', catalogId: 'shadeTreeCluster', assetId: 'shadeTreeCluster', x: 4.934, z: 10.405, rotation: 180, scale: 0.749, sizeClass: 'small-pine', roles: ['rest', 'shade', 'inspect'], generatedBy: 'park-auto-tree-grid/v1', persistsUntilDeleted: true, lifecycle: { stationary: true, carryable: false, temporary: false, persistsUntilDeleted: true, solidTree: true } },
        { id: 'bld_1781275602998:auto-tree:0:2', type: 'shadeTreeCluster', renderType: 'shadeTreeCluster', catalogId: 'shadeTreeCluster', assetId: 'shadeTreeCluster', x: 5.378, z: 14.284, rotation: 270, scale: 0.763, sizeClass: 'small-pine', roles: ['rest', 'shade', 'inspect'], generatedBy: 'park-auto-tree-grid/v1', persistsUntilDeleted: true, lifecycle: { stationary: true, carryable: false, temporary: false, persistsUntilDeleted: true, solidTree: true } },
        { id: 'bld_1781275602998:auto-tree:1:2', type: 'shadeTreeCluster', renderType: 'shadeTreeCluster', catalogId: 'shadeTreeCluster', assetId: 'shadeTreeCluster', x: 9.892, z: 14.34, rotation: 90, scale: 1.337, sizeClass: 'large-pine', roles: ['rest', 'shade', 'inspect'], generatedBy: 'park-auto-tree-grid/v1', persistsUntilDeleted: true, lifecycle: { stationary: true, carryable: false, temporary: false, persistsUntilDeleted: true, solidTree: true } },
        { id: 'bld_1781275602998:auto-tree:2:2', type: 'shadeTreeCluster', renderType: 'shadeTreeCluster', catalogId: 'shadeTreeCluster', assetId: 'shadeTreeCluster', x: 15.384, z: 14.398, rotation: 270, scale: 1.095, sizeClass: 'standard-pine', roles: ['rest', 'shade', 'inspect'], generatedBy: 'park-auto-tree-grid/v1', persistsUntilDeleted: true, lifecycle: { stationary: true, carryable: false, temporary: false, persistsUntilDeleted: true, solidTree: true } },
        { id: 'bld_1781275602998:auto-tree:3:0', type: 'shadeTreeCluster', renderType: 'shadeTreeCluster', catalogId: 'shadeTreeCluster', assetId: 'shadeTreeCluster', x: 19.078, z: 3.811, rotation: 270, scale: 1.018, sizeClass: 'standard-pine', roles: ['rest', 'shade', 'inspect'], generatedBy: 'park-auto-tree-grid/v1', persistsUntilDeleted: true, lifecycle: { stationary: true, carryable: false, temporary: false, persistsUntilDeleted: true, solidTree: true } },
        { id: 'bld_1781275602998:auto-tree:4:0', type: 'shadeTreeCluster', renderType: 'shadeTreeCluster', catalogId: 'shadeTreeCluster', assetId: 'shadeTreeCluster', x: 25.218, z: 3.85, rotation: 180, scale: 0.915, sizeClass: 'standard-pine', roles: ['rest', 'shade', 'inspect'], generatedBy: 'park-auto-tree-grid/v1', persistsUntilDeleted: true, lifecycle: { stationary: true, carryable: false, temporary: false, persistsUntilDeleted: true, solidTree: true } },
        { id: 'bld_1781275602998:auto-tree:3:1', type: 'shadeTreeCluster', renderType: 'shadeTreeCluster', catalogId: 'shadeTreeCluster', assetId: 'shadeTreeCluster', x: 19.567, z: 8.924, rotation: 270, scale: 1.299, sizeClass: 'large-pine', roles: ['rest', 'shade', 'inspect'], generatedBy: 'park-auto-tree-grid/v1', persistsUntilDeleted: true, lifecycle: { stationary: true, carryable: false, temporary: false, persistsUntilDeleted: true, solidTree: true } },
        { id: 'bld_1781275602998:auto-tree:4:1', type: 'shadeTreeCluster', renderType: 'shadeTreeCluster', catalogId: 'shadeTreeCluster', assetId: 'shadeTreeCluster', x: 24.267, z: 10.147, rotation: 90, scale: 0.928, sizeClass: 'standard-pine', roles: ['rest', 'shade', 'inspect'], generatedBy: 'park-auto-tree-grid/v1', persistsUntilDeleted: true, lifecycle: { stationary: true, carryable: false, temporary: false, persistsUntilDeleted: true, solidTree: true } },
        { id: 'bld_1781275602998:auto-tree:3:2', type: 'shadeTreeCluster', renderType: 'shadeTreeCluster', catalogId: 'shadeTreeCluster', assetId: 'shadeTreeCluster', x: 19.602, z: 14.718, rotation: 180, scale: 0.975, sizeClass: 'standard-pine', roles: ['rest', 'shade', 'inspect'], generatedBy: 'park-auto-tree-grid/v1', persistsUntilDeleted: true, lifecycle: { stationary: true, carryable: false, temporary: false, persistsUntilDeleted: true, solidTree: true } },
        { id: 'bld_1781275602998:auto-tree:4:2', type: 'shadeTreeCluster', renderType: 'shadeTreeCluster', catalogId: 'shadeTreeCluster', assetId: 'shadeTreeCluster', x: 25.371, z: 14.259, rotation: 180, scale: 1.3, sizeClass: 'large-pine', roles: ['rest', 'shade', 'inspect'], generatedBy: 'park-auto-tree-grid/v1', persistsUntilDeleted: true, lifecycle: { stationary: true, carryable: false, temporary: false, persistsUntilDeleted: true, solidTree: true } },
        { id: 'bld_1781275602998:node:picnicTable:11:mqb3wy8u-2d266m', type: 'picnicTable', renderType: 'picnicTable', catalogId: 'picnicTable', assetId: 'picnicTable', x: 21.939, z: 12.407, rotation: 0, roles: ['seat', 'eat', 'drink', 'social'], persistsUntilDeleted: true, lifecycle: { stationary: true, carryable: false, temporary: false, persistsUntilDeleted: true } },
        { id: 'bld_1781275602998:node:gazeboPavilion:12:mqb3xfz2-6ozh3o', type: 'gazeboPavilion', renderType: 'gazeboPavilion', catalogId: 'gazeboPavilion', assetId: 'gazeboPavilion', x: 22.129, z: 6.047, rotation: 0, roles: ['rest', 'gather', 'social'], persistsUntilDeleted: true, lifecycle: { stationary: true, carryable: false, temporary: false, persistsUntilDeleted: true } },
        { id: 'bld_1781275602998:node:parkBench:13:mqb3yj1o-na68io', type: 'parkBench', renderType: 'parkBench', catalogId: 'parkBench', assetId: 'parkBench', x: 5.885, z: 1.986, rotation: 0, roles: ['seat', 'rest', 'read', 'social'], persistsUntilDeleted: true, lifecycle: { stationary: true, carryable: false, temporary: false, persistsUntilDeleted: true } },
        { id: 'bld_1781275602998:node:parkLamp:14:mqb40el6-w4yuzo', type: 'parkLamp', renderType: 'parkLamp', catalogId: 'parkLamp', assetId: 'parkLamp', x: 7.486, z: 2.152, rotation: 0, roles: ['inspect', 'light'], persistsUntilDeleted: true, lifecycle: { stationary: true, carryable: false, temporary: false, persistsUntilDeleted: true } },
        { id: 'bld_1781275602998:node:outdoorNoticeBoard:15:mqb40v9q-dg934m', type: 'outdoorNoticeBoard', renderType: 'outdoorNoticeBoard', catalogId: 'outdoorNoticeBoard', assetId: 'outdoorNoticeBoard', x: 3.465, z: 2.025, rotation: 0, roles: ['inspect', 'use'], persistsUntilDeleted: true, lifecycle: { stationary: true, carryable: false, temporary: false, persistsUntilDeleted: true } },
        { id: 'bld_1781275602998:node:parkBench:16:mqb41kki-axonw2', type: 'parkBench', renderType: 'parkBench', catalogId: 'parkBench', assetId: 'parkBench', x: 12.703, z: 14.646, rotation: 180, roles: ['seat', 'rest', 'read', 'social'], persistsUntilDeleted: true, lifecycle: { stationary: true, carryable: false, temporary: false, persistsUntilDeleted: true } },
      ],
    },
  },
  {
    id: 'bld_1781275645157',
    name: 'Office',
    type: 'office',
    worldX: 0,
    worldY: -13,
    widthTiles: 30,
    heightTiles: 22,
    exterior: { roofColor: '#546e7a', wallColor: '#78909c' },
    _elevationY: 0.23,
    floorCount: 1,
    floors: [{ level: 1, name: 'Floor 1' }],
    doorSpec: {
      localCenterX: 12.5,
      localThresholdZ: 23.5,
      localOutsideZ: 23.5,
      localInteriorZ: 11.8,
      localDoorwayZ: 11.95,
      doorwayReachWorld: 0.528,
      openingWidth: 2.4,
      wallThickness: 0.25,
    },
    _doorType: 'swivel',
    _elevatorDoors: [],
    interior: {
      walls: [
        { x1: 21.20466712747653, z1: 10.59529931733011, x2: 21.20466712747653, z2: 5.719999578643377, floor: 1, buildingFloor: 1, cuttable: true },
        { x1: 21.20466712747653, z1: 10.59529931733011, x2: 29.9, z2: 10.59529931733011, floor: 1, buildingFloor: 1, cuttable: true },
        { x1: 21.20466712747653, z1: 10.59529931733011, x2: 18.749543212343966, z2: 10.59529931733011, floor: 1, buildingFloor: 1, cuttable: true },
        { x1: 18.749543212343966, z1: 10.59529931733011, x2: 18.749543212343966, z2: 16.49288166256793, floor: 1, buildingFloor: 1, cuttable: true },
        { x1: 1.9269418799782931, z1: 13.14985407567071, x2: 13.783575676014895, z2: 13.14985407567071, floor: 1, buildingFloor: 1, cuttable: true },
      ],
      furniture: [
        { type: 'desk', x: 2.791510850176447, z: 3.6363963310107916, rotation: 0, floor: 1, buildingFloor: 1 },
        { type: 'desk', x: 7.072567176602554, z: 3.781372703523367, rotation: 0, floor: 1, buildingFloor: 1 },
        { type: 'desk', x: 11.30605728240089, z: 3.795656604895676, rotation: 0, floor: 1, buildingFloor: 1 },
        { type: 'desk', x: 7.075198716989479, z: 8.52663243110242, rotation: 0, floor: 1, buildingFloor: 1 },
        { type: 'desk', x: 2.9048846952869027, z: 8.50011677059658, rotation: 0, floor: 1, buildingFloor: 1 },
        { type: 'desk', x: 11.24167292842142, z: 8.498288429218249, rotation: 0, floor: 1, buildingFloor: 1 },
        { type: 'meetingTable', x: 24.93444418397551, z: 16.603041055180924, rotation: 0, floor: 1, buildingFloor: 1 },
        { type: 'pingpong', x: 5.565638551568636, z: 17.986582179789316, rotation: 180, floor: 1, buildingFloor: 1 },
        { type: 'printerCopier', x: 15.657267754530986, z: 0.9146261638236695, rotation: 0, floor: 1, buildingFloor: 1 },
        { type: 'whiteboard', x: 24.961718139967708, z: 11.240383829183806, rotation: 0, floor: 1, buildingFloor: 1 },
        { type: 'bulletinBoard', x: 7.101610369823185, z: 0.22, rotation: 0, floor: 1, buildingFloor: 1 },
        { type: 'bookshelf', x: 12.406967445149714, z: 13.60894612526668, rotation: 0, floor: 1, buildingFloor: 1 },
        { type: 'trashBin', x: 26.894448691214134, z: 0.8179801153843052, rotation: 0, floor: 1, buildingFloor: 1 },
        { type: 'armchair', x: 3.8829448848333996, z: 13.995426226952492, rotation: 0, floor: 1, buildingFloor: 1 },
        { type: 'armchair', x: 7.201852092913043, z: 14.072239350276813, rotation: 0, floor: 1, buildingFloor: 1 },
        { type: 'vending', x: 20.564289450785196, z: 6.774247145985474, rotation: 270, floor: 1, buildingFloor: 1 },
        { type: 'waterCooler', x: 20.433382531802287, z: 8.933112941113084, rotation: 270, floor: 1, buildingFloor: 1 },
        { type: 'counter', x: 24.187948209976394, z: 0.7904121338362842, rotation: 0, floor: 1, buildingFloor: 1 },
        { type: 'microwave', x: 25.048, z: 0.79, rotation: 0, floor: 1, buildingFloor: 1 },
        { type: 'countertopCoffeeMachine', x: 24.188, z: 0.79, rotation: 0, floor: 1, buildingFloor: 1 },
      ],
    },
  },
]);

export const STARTER_MAP_STREETS = Object.freeze([
  { x1: -7, z1: 20, x2: -7, z2: 159, type: null, rotation: 0, openEdges: null },
  { x1: -7, z1: -133, x2: -7, z2: -45, type: null, rotation: 0, openEdges: null },
  { x1: -7, z1: -35, x2: -7, z2: 10, type: null, rotation: 0, openEdges: null },
  { x1: -109, z1: -40, x2: -12, z2: -40, type: null, rotation: 0, openEdges: null },
  { x1: -7, z1: -40, x2: -7, z2: -40, type: 'x-int', rotation: 0, openEdges: { n: true, s: true, e: true, w: true } },
  { x1: -2, z1: 15, x2: 142, z2: 15, type: null, rotation: 0, openEdges: null },
  { x1: -2, z1: -40, x2: 141, z2: -40, type: null, rotation: 0, openEdges: null },
  { x1: -7, z1: 15, x2: -7, z2: 15, type: 'x-int', rotation: 0, openEdges: { n: true, s: true, e: true, w: true } },
  { x1: -12, z1: 15, x2: -109, z2: 15, type: null, rotation: 0, openEdges: null },
]);

export function cloneStarterMapBuildings() {
  return JSON.parse(JSON.stringify(STARTER_MAP_BUILDINGS));
}

export function cloneStarterMapStreets() {
  return JSON.parse(JSON.stringify(STARTER_MAP_STREETS));
}

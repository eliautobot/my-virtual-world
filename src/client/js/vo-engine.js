/**
 * VOBuildingEngine — Virtual Office Building Interior Renderer
 *
 * Auto-generated from vo-engine-raw.js by build-vo-engine.js
 * DO NOT EDIT DIRECTLY — edit the raw file and re-run the build script.
 *
 * Architecture:
 *   - constructor(buildingConfig) — initialize with config, no canvas needed
 *   - tick(deltaTime)             — update agent behaviors/animations (no drawing)
 *   - renderToCanvas(canvas)      — draw full interior to provided offscreen canvas
 *   - setAgents(agentArray)       — inject/replace agent roster
 *   - updateAgentStatus(id, status, task) — update a single agent's state
 *   - setWeather(data)            — inject weather data
 *   - setChatData(data)           — inject live chat messages for bubbles
 *   - processMeetings(data)       — inject active meetings
 *   - enterEditMode() / exitEditMode()
 *   - getConfig()                 — returns current officeConfig
 *   - onConfigChange(fn)          — callback when config changes (edit mode saves)
 *   - onLog(fn)                   — callback for activity log messages
 *   - handlePointerDown/Move/Up/Wheel/KeyDown — forward input events
 *   - destroy()                   — cleanup
 */
(function(exports) {
'use strict';
try {

// ─── Module-level variables ─────────────────────────────────────────────────
// These shadow the global scope of the original VO code.
// They are set at the start of each renderToCanvas() call so all drawing
// functions work without modification.

let ctx;    // Canvas2D context — set by renderToCanvas()
let _externalOfficeConfig = null;
let _onConfigChange = null;
let _onLog = null;

// Null element proxy — prevents errors from stubbed DOM getElementById calls
function _voNullElement(id) {
    return {
        textContent: '', innerHTML: '', style: {}, classList: { toggle: ()=>{}, add: ()=>{}, remove: ()=>{}, contains: ()=>false },
        disabled: false, value: '', checked: false,
        addEventListener: ()=>{}, removeEventListener: ()=>{},
        appendChild: ()=>{}, prepend: ()=>{}, remove: ()=>{},
        getAttribute: ()=>null, setAttribute: ()=>{},
        children: [], querySelector: ()=>null, querySelectorAll: ()=>[],
    };
}

// ─── ALL ORIGINAL VO CODE (transformed) ─────────────────────────────────────

// Virtual Office - GBA Pixel Art Visualization
// canvas and ctx are set per-render by VOBuildingEngine
// ctx declared at module level in wrapper

var DPR = 2; // set from buildingConfig by VOBuildingEngine
const TILE = 40;
const HALF_TILE = TILE / 2;

// --- DYNAMIC CANVAS SIZE (data-driven) ---
const OFFICE_CONFIG_KEY = 'vo-product-office-config';
const COLOR_FAVORITES_KEY = 'vo-product-color-favorites';
const MIN_TILES_X = 10;
const MIN_TILES_Y = 10;

// Load office config: server first, then localStorage fallback
function loadOfficeConfig() {
    // Config is provided externally by VOBuildingEngine constructor
    return _externalOfficeConfig || {};
}

// Async: fetch server config and apply if newer/exists
var _serverConfigLoaded = false;
function _loadServerConfig() {
    // No-op: config is managed externally by the Virtual World
}

// Save office config to BOTH server and localStorage
var _saveDebounceTimer = null;
function saveOfficeConfig() {
    // Notify external handler if set
    if (typeof _onConfigChange === 'function') {
        try { _onConfigChange(JSON.parse(JSON.stringify(officeConfig))); } catch(e) {}
    }
}

function loadColorFavorites() { return []; }

function saveColorFavorites() { /* no-op */ }

// _officeConfig loaded from external config (see VOBuildingEngine constructor)
var _officeConfig = { canvasWidth: 1200, canvasHeight: 800, branches: [] };
var colorFavorites = loadColorFavorites();
var W = 1200; // set by VOBuildingEngine from officeConfig
var H = 800; // set by VOBuildingEngine from officeConfig

const DEFAULT_BRANCHES = [
    { id: 'HQ', name: 'Office Manager', emoji: '⚡', theme: 'branch-gold' },
    { id: 'PQ', name: 'Pro Quality Plumbing', emoji: '🔧', theme: 'branch-blue' },
    { id: 'ENG', name: 'Caltran Engineering', emoji: '🏗️', theme: 'branch-orange' },
    { id: 'GEN', name: 'General Office', emoji: '🌐', theme: 'branch-cyan' },
    { id: 'BIZ', name: 'Business', emoji: '🔥', theme: 'branch-red' }
];
const UNASSIGNED_BRANCH = { id: 'UNASSIGNED', name: 'Unassigned', emoji: '❓', theme: 'branch-gray' };

var _branchListCache = null;
var _branchMapCache = null;
var _branchCacheKey = '';
function _invalidateBranchCache() { _branchListCache = null; _branchMapCache = null; _branchCacheKey = ''; }
function getBranchList() {
    var src = (officeConfig && officeConfig.branches) || _officeConfig.branches || DEFAULT_BRANCHES;
    var key = src.length + ':' + (src.length > 0 ? src[0].id : '');
    if (_branchListCache && _branchCacheKey === key) return _branchListCache;
    var list = src.slice();
    var hasUnassigned = list.some(function(b){ return b.id === UNASSIGNED_BRANCH.id; });
    if (!hasUnassigned) list.push(UNASSIGNED_BRANCH);
    _branchListCache = list;
    _branchCacheKey = key;
    // Build lookup map
    _branchMapCache = {};
    list.forEach(function(b) { _branchMapCache[b.id] = b; });
    return list;
}
function getBranchById(branchId) {
    if (!_branchMapCache) getBranchList();
    return (_branchMapCache && _branchMapCache[branchId]) || UNASSIGNED_BRANCH;
}
function getBranchDisplayName(branchId) {
    return getBranchById(branchId).name;
}
function getBranchTheme(branchId) {
    return getBranchById(branchId).theme || 'branch-gray';
}
function ensureValidAgentBranches() {
    var valid = new Set(getBranchList().map(function(b){ return b.id; }));
    agents.forEach(function(a){ if (!valid.has(a.branch)) a.branch = 'UNASSIGNED'; });
    if (officeConfig.agents) {
        officeConfig.agents.forEach(function(a){ if (!valid.has(a.branch)) a.branch = 'UNASSIGNED'; });
    }
}

// --- OFFICE CONFIG (data-driven) ---
var officeConfig = {
    canvasWidth: 1200,
    canvasHeight: 800,
    walls: {
        topWall: { color: '#37474f', accentColor: '#263238', trimColor: '#fff' },
        sections: [{ x: 0, w: 1200, color: '#37474f', accentColor: '#263238' }],
        height: 90,
        trimColor: '#fff',
        interior: [],
    },
    floor: { color1: '#c0c0c0', color2: '#b0b0b0' },
    furniture: [],
    branches: [],
    agents: [],
}; // populated from buildingConfig by VOBuildingEngine

function getTopWallConfig() {
    var walls = (officeConfig && officeConfig.walls) || {};
    var topWall = walls.topWall || {};
    var sections = Array.isArray(walls.sections) ? walls.sections : [];
    if (!topWall.color && sections[0]) topWall.color = sections[0].color;
    if (!topWall.accentColor && sections[0]) topWall.accentColor = sections[0].accentColor;
    if (!topWall.trimColor) topWall.trimColor = walls.trimColor || '#fff';
    if (!topWall.color) topWall.color = '#37474f';
    if (!topWall.accentColor) topWall.accentColor = '#263238';
    return topWall;
}

function getRenderedWallSections() {
    var topWall = getTopWallConfig();
    return [{
        x: 0,
        w: W,
        color: topWall.color,
        accentColor: topWall.accentColor,
        trimColor: topWall.trimColor,
        sourceIndex: 0
    }];
}

// --- EDIT MODE STATE ---
var editMode = false;
var editHoverTile = null; // {tx, ty} tile coords under mouse
var _floorEditMode = false; // separate mode for floor tile editing

// --- MULTI-SELECT (marquee) ---
var _multiSelected = []; // array of furniture ids
var _marqueeStart = null; // {x, y} world coords
var _marqueeEnd = null;
var _multiDragging = false;
var _multiDragStart = null; // {x, y}

// --- SNAP ZONE SYSTEM (5 zones per tile) ---
// 4 quadrants + center. Items snap to zone centers, staying INSIDE the tile.
var activeSnapZone = 'center'; // 'center' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
const SNAP_ZONES = {
    'center':       { ox: 0.50, oy: 0.50, label: '⊙ Center' },
    'top-left':     { ox: 0.25, oy: 0.25, label: '↖ Top-Left' },
    'top-right':    { ox: 0.75, oy: 0.25, label: '↗ Top-Right' },
    'bottom-left':  { ox: 0.25, oy: 0.75, label: '↙ Bottom-Left' },
    'bottom-right': { ox: 0.75, oy: 0.75, label: '↘ Bottom-Right' },
};

// --- UNDO / SAVE SYSTEM ---
var _undoStack = [];
var _hasUnsavedChanges = false;
const MAX_UNDO = 30;

function _pushUndo() {
    _undoStack.push(JSON.stringify(officeConfig));
    if (_undoStack.length > MAX_UNDO) _undoStack.shift();
    _hasUnsavedChanges = true;
    _updateSaveUndoButtons();
}

function undoEdit() {
    if (_undoStack.length === 0) return;
    var prev = JSON.parse(_undoStack.pop());
    officeConfig.walls = prev.walls;
    officeConfig.floor = prev.floor;
    officeConfig.furniture = prev.furniture;
    W = prev.canvasWidth || W;
    H = prev.canvasHeight || H;
    officeConfig.canvasWidth = W;
    officeConfig.canvasHeight = H;
    getInteractionSpots();
    if (!officeConfig.walls.interior) officeConfig.walls.interior = [];
    buildCollisionGrid();
    if (typeof _refreshWallSectionButtons === 'function') _refreshWallSectionButtons();
    _hasUnsavedChanges = _undoStack.length > 0;
    _updateSaveUndoButtons();
}

function saveEdits() {
    saveOfficeConfig();
    _hasUnsavedChanges = false;
    _undoStack = [];
    _updateSaveUndoButtons();
}

function _updateSaveUndoButtons() { /* stubbed: DOM/server removed from engine */ }

// --- FURNITURE EDITOR CONSTANTS ---
// FURNITURE_BOUNDS: actual visual size (w x h) + origin offset (ox, oy).
// ox, oy = where the draw function's (x,y) sits relative to the item's TOP-LEFT corner.
//   ox:0, oy:0 = draw function uses (x,y) as top-left (default)
//   ox:0.5, oy:0.5 = draw function uses (x,y) as center (e.g. desk with translate)
//   ox:0.5, oy:0 = draw function uses (x,y) as center-top
const FURNITURE_BOUNDS = {
    'desk':          { w: 72,  h: 76,  ox: 0.5,  oy: 0.66 },  // translate(x,y), visual from -36,-50 to 36,26 → origin at center-ish
    'bossDesk':      { w: 130, h: 90,  ox: 0.5,  oy: 0.5  },  // executive desk, centered origin
    'trashCan':      { w: 14,  h: 14,  ox: 0.5,  oy: 0    },  // (x,y)=center-top, ellipse ±7
    'filingCabinet': { w: 28,  h: 55,  ox: 0,    oy: 0    },  // top-left
    'whiteboard':    { w: 28,  h: 43,  ox: 0,    oy: 0    },  // top-left
    'plant':         { w: 18,  h: 26,  ox: 0,    oy: 0.23 },  // leaves start above (x,y)
    'tallPlant':     { w: 22,  h: 58,  ox: 0.09, oy: 0.17 },  // pot at y+28, leaves above
    'meetingTable':  { w: 240, h: 120, ox: 0,    oy: 0    },
    'lounge':        { w: 200, h: 140, ox: 0,    oy: 0    },
    'breakArea':     { w: 240, h: 130, ox: 0,    oy: 0    },
    'engLounge':     { w: 168, h: 38,  ox: 0,    oy: 0    },
    'pingPongTable': { w: 80,  h: 48,  ox: 0.5,  oy: 0.5  },  // translate-style, draws ±40,±24
    'dartBoard':     { w: 36,  h: 52,  ox: 0.5,  oy: 0.0  },  // (x,y)=top-center, legs go down
    'vendingMachine':{ w: 45,  h: 75,  ox: 0,    oy: 0    },  // top-left
    'waterCooler':   { w: 28,  h: 48,  ox: 0.5,  oy: 0.08 },  // (x,y) center ref, body -14..14, legs to y+42
    'coffeeMaker':   { w: 24,  h: 22,  ox: 0,    oy: 0    },
    'microwave':     { w: 30,  h: 24,  ox: 0,    oy: 0    },
    'toaster':       { w: 18,  h: 16,  ox: 0,    oy: 0    },
    'window':        { w: 44,  h: 52,  ox: 0.09, oy: 0.08 },  // frame extends beyond glass
    'interactiveWindow': { w: 44, h: 52, ox: 0.09, oy: 0.08 },  // interactive window with weather/sun settings
    'clock':         { w: 28,  h: 28,  ox: 0.5,  oy: 0.5  },  // (x,y)=center, radius 14
    'bookshelf':     { w: 50,  h: 80,  ox: 0,    oy: 0    },  // top-left, tall bookshelf
    'couch':         { w: 160, h: 80,  ox: 0,    oy: 0    },  // L-shaped couch (4×1 tiles + 1×1 daybed)
    'endTable':      { w: 20,  h: 20,  ox: 0,    oy: 0    },  // small decor table with plant
    'coffeeTable':   { w: 64,  h: 34,  ox: 0,    oy: 0    },
    'tv':            { w: 50,  h: 34,  ox: 0,    oy: 0    },
    'kitchenCounter':{ w: 72,  h: 34,  ox: 0,    oy: 0    },
    'receptionDesk': { w: 128, h: 72,  ox: 0.5,  oy: 0.5  },  // center-origin, rotatable office reception counter with solid client-facing footprint
    'printerCopier': { w: 68,  h: 56,  ox: 0.5,  oy: 0.5  },  // center-origin, rotatable office printer/copier with solid cabinet footprint
    'officeChair':   { w: 38,  h: 46,  ox: 0.5,  oy: 0.5  },  // center-origin, rotatable task chair with compact solid footprint
    'diningTable':   { w: 112, h: 88,  ox: 0.5,  oy: 0.5  },  // center-origin, includes 4 chairs + table footprint
    'sink':          { w: 72,  h: 38,  ox: 0.5,  oy: 0.5  },  // center-origin, rotatable kitchen/bath sink basin
    'stoveOven':     { w: 56,  h: 58,  ox: 0.5,  oy: 0.5  },  // center-origin, rotatable freestanding cooking range
    'branchSign':    { w: 160, h: 24,  ox: 0.5,  oy: 0.5, noCollision: true },  // text label, no collision
    'textLabel':     { w: 120, h: 20,  ox: 0.5,  oy: 0.5, noCollision: true },  // custom text label
    'floorLamp':     { w: 16,  h: 40,  ox: 0.5,  oy: 0.8  },  // standing lamp
};

const CATALOG_CATEGORIES = [
    { name: 'Office', items: [
        { type: 'desk',          label: 'Desk',           icon: '🖥️' },
        { type: 'bossDesk',      label: 'Boss Desk',      icon: '💼' },
        { type: 'receptionDesk', label: 'Reception Desk', icon: '🛎️' },
        { type: 'printerCopier', label: 'Printer / Copier', icon: '🖨️' },
        { type: 'officeChair',   label: 'Office Chair',   icon: '🪑' },
        { type: 'trashCan',      label: 'Trash Can',      icon: '🗑️' },
        { type: 'filingCabinet', label: 'Filing Cabinet', icon: '🗂️' },
        { type: 'whiteboard',    label: 'Whiteboard',     icon: '📋' },
    ]},
    { name: 'Comfort', items: [
        { type: 'couch',      label: 'L-Couch',        icon: '🛋️' },
        { type: 'engLounge',  label: 'Straight Couch', icon: '🪑' },
        { type: 'coffeeTable',label: 'Coffee Table',   icon: '☕' },
        { type: 'tv',        label: 'TV',               icon: '📺' },
        { type: 'bookshelf', label: 'Bookshelf',        icon: '📚' },
        { type: 'plant',     label: 'Plant',            icon: '🪴' },
        { type: 'tallPlant', label: 'Tall Plant',       icon: '🌿' },
        { type: 'endTable',  label: 'End Table + Plant', icon: '🪴' },
    ]},
    { name: 'Kitchen + Dining', items: [
        { type: 'diningTable',   label: 'Dining Table',    icon: '🍽️' },
        { type: 'kitchenCounter',label: 'Kitchen Counter', icon: '🏪' },
        { type: 'sink',          label: 'Sink',            icon: '🚰' },
        { type: 'stoveOven',     label: 'Stove / Oven',    icon: '🍳' },
        { type: 'coffeeMaker',   label: 'Coffee Maker',    icon: '☕' },
        { type: 'vendingMachine',label: 'Vending Machine', icon: '🥤' },
        { type: 'waterCooler',   label: 'Water Cooler',    icon: '💧' },
        { type: 'microwave',     label: 'Microwave',       icon: '📦' },
        { type: 'toaster',       label: 'Toaster',         icon: '🍞' },
    ]},
    { name: 'Fun', items: [
        { type: 'pingPongTable', label: 'Ping Pong Table', icon: '🏓' },
        { type: 'dartBoard',     label: 'Dart Board',      icon: '🎯' },
    ]},
    { name: 'Structure', items: [
        { type: 'meetingTable', label: 'Meeting Table', icon: '📊' },
        { type: 'window',       label: 'Window',        icon: '🪟' },
        { type: 'interactiveWindow', label: 'Weather Window', icon: '🌤️' },
        { type: 'clock',        label: 'Clock',         icon: '🕐' },
        { type: 'floorLamp',    label: 'Floor Lamp',    icon: '💡' },
    ]},
    { name: 'Labels', items: [
        { type: 'textLabel',    label: 'Custom Text',   icon: '✏️' },
    ]},
    { name: 'Walls', items: [
        { type: 'wall', label: 'Wall Segment', icon: '🧱' },
        { type: 'door', label: 'Door/Opening', icon: '🚪' },
    ]},
];

// --- FURNITURE PLACEMENT STATE ---
var placingType = null;      // furniture type being placed, or null
var selectedItemId = null;   // id of selected furniture item, or null
var isDragging = false;      // dragging a selected item
var dragOffset = { x: 0, y: 0 };
var _ghostPos = null;        // snapped world pos for ghost preview
var _catalogPanel = null;
var _floatingToolbar = null;
var _skipNextEditClick = false; // prevent click after drag

// --- WALL PLACEMENT STATE ---
var wallPlacingPhase = 0;   // 0=idle, 1=awaiting second click
var wallPlacingStart = null; // {tx, ty} first click tile
var selectedWallIdx = null;  // index into officeConfig.walls.interior

// --- COLLISION GRID ---
var collisionGrid = null;

// ============================================================
// COLLISION SYSTEM — set to false to disable entirely
// ============================================================
const COLLISION_ENABLED = true;
const COLLISION_RADIUS = 22;       // personal space radius (px)
const COLLISION_PUSH = 1.4;        // steering strength when walking
const COLLISION_SPOT_RADIUS = 24;  // min distance between agents at interaction spots

// ============================================================
// COLLISION HELPERS (only active when COLLISION_ENABLED = true)
// ============================================================
function isSpotOccupied(x, y, excludeId) {
    if (!COLLISION_ENABLED) return false;
    for (let i = 0; i < agents.length; i++) {
        const a = agents[i];
        if (a.id === excludeId) continue;
        const dx = a.x - x, dy = a.y - y;
        if (Math.sqrt(dx * dx + dy * dy) < COLLISION_SPOT_RADIUS) return true;
        // Also check targets (agents heading there)
        const dtx = a.targetX - x, dty = a.targetY - y;
        if (Math.sqrt(dtx * dtx + dty * dty) < COLLISION_SPOT_RADIUS) return true;
    }
    return false;
}

function findOpenSpot(spots, excludeId, propX, propY) {
    // spots: array of {x, y, ...} or {x, y} coords
    // Returns first unoccupied spot, or the least crowded one
    if (!COLLISION_ENABLED) return spots[Math.floor(Math.random() * spots.length)];
    const open = spots.filter(s => !isSpotOccupied(propX ? s[propX] : s.x, propY ? s[propY] : s.y, excludeId));
    if (open.length > 0) return open[Math.floor(Math.random() * open.length)];
    return null; // all spots taken
}

function getQueueOffset(x, y, excludeId) {
    // Count how many agents are near this machine spot, return offset to form a line
    if (!COLLISION_ENABLED) return { x: 0, y: 0 };
    let count = 0;
    for (let i = 0; i < agents.length; i++) {
        const a = agents[i];
        if (a.id === excludeId) continue;
        const dx = a.x - x, dy = a.y - y;
        if (Math.sqrt(dx * dx + dy * dy) < 40) count++;
    }
    return { x: 0, y: count * 21 }; // queue downward with spacing
}

// ============================================================
// REAL WEATHER SYSTEM — fetches weather for configured location, renders on windows
// ============================================================
var weatherData = { condition: 'clear', code: 113, temp: 0, wind: 0, humidity: 0, feelsLike: 0, uvIndex: 0, visibility: 0, precipMM: 0, cloudcover: 0 };
var _displayPrefs = { showWeather: true };
try { var _dp = JSON.parse(localStorage.getItem("vo-display-prefs") || "{}"); if (_dp.showWeather !== undefined) _displayPrefs.showWeather = _dp.showWeather; } catch(e) {}
var lastWeatherPoll = 0;
var weatherParticles = []; // rain/snow particles
var _weatherTick = 0;
var _tod = { sky: "#2196f3", upper: "#42a5f5", top: "#bbdefb", cloud: "rgba(255,255,255,0.5)", glow: "rgba(255,255,240,0.08)", stars: false }; // global time-of-day sky
var _lastLightningFlash = 0;
var _nextLightningAt = 0;
var _lightningBoltX = 0;
var _rainDroplets = []; // persistent rain droplets on glass
var _snowAccum = []; // snow accumulation on window sill

function pollWeather() { /* no-op: server calls removed from engine */ }

// Initialize weather on load
pollWeather();
// pollWeather interval removed — weather is injected via setWeather()

// --- Helper: pseudo-random from seed ---
function _wRand(seed) {
    var x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
}

// --- Helper: draw a rounded cloud shape ---
function _drawCloud(cx, cy, w, h, alpha) {
    ctx.fillStyle = 'rgba(180,180,185,' + alpha + ')';
    ctx.beginPath();
    ctx.arc(cx, cy, h * 0.6, 0, Math.PI * 2);
    ctx.arc(cx - w * 0.25, cy + h * 0.15, h * 0.45, 0, Math.PI * 2);
    ctx.arc(cx + w * 0.25, cy + h * 0.15, h * 0.5, 0, Math.PI * 2);
    ctx.arc(cx - w * 0.4, cy + h * 0.3, h * 0.3, 0, Math.PI * 2);
    ctx.arc(cx + w * 0.4, cy + h * 0.3, h * 0.35, 0, Math.PI * 2);
    ctx.fill();
}

// --- Helper: draw a lightning bolt ---
function _drawLightningBolt(x, y, len, branches) {
    ctx.strokeStyle = 'rgba(255,255,220,0.9)';
    ctx.lineWidth = 1.5;
    ctx.shadowColor = 'rgba(255,255,200,0.8)';
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.moveTo(x, y);
    var bx = x, by = y;
    var segs = 4 + Math.floor(Math.random() * 3);
    for (var i = 0; i < segs; i++) {
        bx += (Math.random() - 0.5) * 8;
        by += len / segs;
        ctx.lineTo(bx, by);
        // Branch
        if (branches && Math.random() > 0.6) {
            var ex = bx + (Math.random() - 0.5) * 12;
            var ey = by + len / segs * 0.6;
            ctx.moveTo(bx, by);
            ctx.lineTo(ex, ey);
            ctx.moveTo(bx, by);
        }
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
}

function drawWeatherOnWindow(wx, wy, ww, wh, isLeft) {
    _weatherTick++;
    var cond = weatherData.condition;
    var wind = weatherData.wind;
    var t = _getTimeHour();
    var sun = _getSunTimes();
    var isDaytime = (t >= sun.sunrise && t < sun.sunset);

    // ─── SUNNY ───
    if (cond === 'sunny') {
        if (isDaytime) {
            ctx.save();
            ctx.beginPath(); ctx.rect(wx, wy, ww, wh); ctx.clip();
            // Warm golden wash
            ctx.fillStyle = 'rgba(255,235,59,0.5)';
            ctx.fillRect(wx, wy, ww, wh);
            if (isLeft) {
                var sunX = wx + 8, sunY = wy + 8;
                var rayAngle = (_weatherTick * 0.003);
                // Outer glow
                var grad = ctx.createRadialGradient(sunX, sunY, 2, sunX, sunY, 32);
                grad.addColorStop(0, 'rgba(255,245,157,0.92)');
                grad.addColorStop(0.5, 'rgba(255,235,59,0.65)');
                grad.addColorStop(1, 'rgba(255,235,59,0)');
                ctx.fillStyle = grad;
                ctx.fillRect(wx, wy, ww, wh);
                // Rotating rays with varying lengths
                ctx.lineWidth = 2;
                for (var ri = 0; ri < 12; ri++) {
                    var a = rayAngle + ri * (Math.PI / 6);
                    var rayLen = 24 + Math.sin(_weatherTick * 0.02 + ri * 0.7) * 10;
                    var rayAlpha = 0.55 + Math.sin(_weatherTick * 0.015 + ri) * 0.15;
                    ctx.strokeStyle = 'rgba(255,245,157,' + rayAlpha + ')';
                    ctx.beginPath();
                    ctx.moveTo(sunX + Math.cos(a) * 5, sunY + Math.sin(a) * 5);
                    ctx.lineTo(sunX + Math.cos(a) * rayLen, sunY + Math.sin(a) * rayLen);
                    ctx.stroke();
                }
                // Sun core with pulsing
                var pulse = 8 + Math.sin(_weatherTick * 0.02) * 2.5;
                ctx.fillStyle = 'rgba(255,235,59,0.95)';
                ctx.beginPath(); ctx.arc(sunX, sunY, pulse, 0, Math.PI * 2); ctx.fill();
                ctx.fillStyle = 'rgba(255,250,200,1.0)';
                ctx.beginPath(); ctx.arc(sunX, sunY, 3.5, 0, Math.PI * 2); ctx.fill();
                // Lens flare streak
                var flareAlpha = 0.22 + Math.sin(_weatherTick * 0.01) * 0.08;
                ctx.fillStyle = 'rgba(255,255,200,' + flareAlpha + ')';
                ctx.fillRect(wx, sunY - 1, ww, 2);
            }
            // Heat shimmer effect near bottom of window (hot day)
            if (weatherData.temp > 85) {
                var shimmer = Math.sin(_weatherTick * 0.08) * 0.04;
                ctx.fillStyle = 'rgba(255,200,50,' + (0.08 + shimmer) + ')';
                ctx.fillRect(wx, wy + wh - 8, ww, 8);
            }
            ctx.restore();
        }

    // ─── PARTLY CLOUDY ───
    } else if (cond === 'partly_cloudy') {
        ctx.save();
        ctx.beginPath(); ctx.rect(wx, wy, ww, wh); ctx.clip();
        if (isDaytime) {
            // Soft sunlight filtering through
            ctx.fillStyle = 'rgba(255,235,59,0.18)';
            ctx.fillRect(wx, wy, ww, wh);
            // Sun peeks through if left window
            if (isLeft) {
                var pcSunX = wx + 6, pcSunY = wy + 6;
                ctx.fillStyle = 'rgba(255,235,59,0.22)';
                ctx.beginPath(); ctx.arc(pcSunX, pcSunY, 5, 0, Math.PI * 2); ctx.fill();
            }
        }
        // Drifting clouds
        var drift = (_weatherTick * 0.04);
        _drawCloud(wx + (drift + 5) % (ww + 10) - 5, wy + 7, 14, 5, 0.55);
        _drawCloud(wx + (drift * 0.7 + ww * 0.6) % (ww + 10) - 5, wy + 12, 10, 4, 0.48);
        // Moving cloud shadows on floor area
        var shadowX = wx + (drift * 1.5) % ww;
        ctx.fillStyle = 'rgba(0,0,0,0.04)';
        ctx.fillRect(shadowX - 6, wy + wh - 5, 12, 5);
        ctx.restore();

    // ─── OVERCAST ───
    } else if (cond === 'overcast' || cond === 'cloudy') {
        ctx.save();
        ctx.beginPath(); ctx.rect(wx, wy, ww, wh); ctx.clip();
        // Grey blanket
        ctx.fillStyle = 'rgba(120,120,125,0.35)';
        ctx.fillRect(wx, wy, ww, wh);
        // Multiple cloud layers at different speeds
        var drift1 = (_weatherTick * 0.025);
        var drift2 = (_weatherTick * 0.015);
        // Upper layer — darker, slower
        ctx.fillStyle = 'rgba(140,140,145,0.6)';
        ctx.fillRect(wx + (drift2) % ww - 5, wy + 3, 16, 5);
        ctx.fillRect(wx + (drift2 + 20) % ww - 5, wy + 5, 12, 4);
        // Lower layer — lighter, faster
        _drawCloud(wx + (drift1 + 8) % (ww + 10) - 5, wy + 10, 14, 5, 0.48);
        _drawCloud(wx + (drift1 * 0.8 + ww * 0.5) % (ww + 10) - 5, wy + 16, 11, 4, 0.44);
        _drawCloud(wx + (drift1 * 1.2 + ww * 0.3) % (ww + 10) - 5, wy + 22, 9, 3, 0.4);
        // Dim the whole window slightly
        ctx.fillStyle = 'rgba(80,80,85,0.18)';
        ctx.fillRect(wx, wy, ww, wh);
        ctx.restore();

    // ─── DRIZZLE ───
    } else if (cond === 'drizzle') {
        ctx.save();
        ctx.beginPath(); ctx.rect(wx, wy, ww, wh); ctx.clip();
        // Slight grey tint
        ctx.fillStyle = 'rgba(130,130,135,0.26)';
        ctx.fillRect(wx, wy, ww, wh);
        // Tiny thin rain lines — sparse, slow
        ctx.strokeStyle = 'rgba(160,195,220,0.8)';
        ctx.lineWidth = 0.5;
        for (var dr = 0; dr < 5; dr++) {
            var dSeed = _wRand(dr * 7 + wx);
            var dx = wx + (dSeed * ww + _weatherTick * 0.3) % ww;
            var dy = wy + (_weatherTick * 1.2 + dr * 17) % wh;
            ctx.beginPath();
            ctx.moveTo(dx, dy);
            ctx.lineTo(dx - 0.3, dy + 3);
            ctx.stroke();
        }
        // Water droplets slowly forming on glass
        ctx.fillStyle = 'rgba(170,210,240,0.65)';
        for (var wd = 0; wd < 8; wd++) {
            var ws = _wRand(wd * 13 + wx + 99);
            var wdx = wx + 2 + ws * (ww - 4);
            var wdy = wy + 2 + _wRand(wd * 17 + 55) * (wh - 4);
            // Droplets slowly grow and drip
            var dropPhase = (_weatherTick * 0.005 + wd * 1.3) % 3;
            var dropR = dropPhase < 2 ? 0.8 + dropPhase * 0.4 : 0.8;
            ctx.beginPath(); ctx.arc(wdx, wdy + (dropPhase > 2 ? (dropPhase - 2) * 3 : 0), dropR, 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();

    // ─── LIGHT RAIN ───
    } else if (cond === 'light_rain') {
        ctx.save();
        ctx.beginPath(); ctx.rect(wx, wy, ww, wh); ctx.clip();
        ctx.fillStyle = 'rgba(100,105,110,0.3)';
        ctx.fillRect(wx, wy, ww, wh);
        // Rain streaks — medium density, angled by wind
        var windAngle = Math.min(wind * 0.02, 0.4);
        ctx.strokeStyle = 'rgba(140,185,220,0.85)';
        ctx.lineWidth = 0.8;
        for (var lr = 0; lr < 10; lr++) {
            var lSeed = _wRand(lr * 11 + wx);
            var lx = wx + (lSeed * ww + _weatherTick * (0.4 + windAngle)) % ww;
            var ly = wy + (_weatherTick * 1.8 + lr * 11) % wh;
            ctx.beginPath();
            ctx.moveTo(lx, ly);
            ctx.lineTo(lx - windAngle * 6, ly + 5);
            ctx.stroke();
        }
        // Droplets on glass — more than drizzle
        ctx.fillStyle = 'rgba(150,200,240,0.7)';
        for (var ld = 0; ld < 10; ld++) {
            var ls = _wRand(ld * 19 + wx + 77);
            var ldx = wx + 2 + ls * (ww - 4);
            var ldy = wy + 2 + _wRand(ld * 23 + 33) * (wh - 4);
            var ldPhase = (_weatherTick * 0.008 + ld * 0.9) % 4;
            var ldR = ldPhase < 2.5 ? 1 + ldPhase * 0.3 : 1;
            ctx.beginPath(); ctx.arc(ldx, ldy, ldR, 0, Math.PI * 2); ctx.fill();
            // Drip trail
            if (ldPhase > 2) {
                ctx.fillStyle = 'rgba(150,200,240,0.2)';
                ctx.fillRect(ldx - 0.3, ldy + ldR, 0.6, (ldPhase - 2) * 5);
                ctx.fillStyle = 'rgba(150,200,240,0.7)';
            }
        }
        ctx.restore();

    // ─── RAIN ───
    } else if (cond === 'rain') {
        ctx.save();
        ctx.beginPath(); ctx.rect(wx, wy, ww, wh); ctx.clip();
        ctx.fillStyle = 'rgba(80,85,95,0.38)';
        ctx.fillRect(wx, wy, ww, wh);
        // Dense rain streaks
        var rWindAngle = Math.min(wind * 0.025, 0.5);
        ctx.strokeStyle = 'rgba(130,180,220,0.9)';
        ctx.lineWidth = 1;
        for (var rr = 0; rr < 14; rr++) {
            var rSeed = _wRand(rr * 7 + wx);
            var rx = wx + (rSeed * ww + _weatherTick * (0.5 + rWindAngle)) % ww;
            var ry = wy + (_weatherTick * 2.2 + rr * 9) % wh;
            ctx.beginPath();
            ctx.moveTo(rx, ry);
            ctx.lineTo(rx - rWindAngle * 8, ry + 6);
            ctx.stroke();
        }
        // Splashes at bottom of window
        for (var sp = 0; sp < 4; sp++) {
            var sps = _wRand(sp * 31 + wx + 17);
            var spx = wx + 3 + sps * (ww - 6);
            var spy = wy + wh - 3;
            var spPhase = (_weatherTick * 0.06 + sp * 2.1) % 2;
            if (spPhase < 0.5) {
                ctx.fillStyle = 'rgba(150,200,240,' + (0.4 - spPhase * 0.8) + ')';
                var spR = 1 + spPhase * 4;
                ctx.beginPath(); ctx.arc(spx, spy, spR, Math.PI, 0); ctx.fill();
            }
        }
        // Water droplets + running streams on glass
        ctx.fillStyle = 'rgba(150,200,240,0.75)';
        for (var rd = 0; rd < 12; rd++) {
            var rs = _wRand(rd * 11 + wx + 44);
            var rdx = wx + 2 + rs * (ww - 4);
            var rdy = wy + 2 + _wRand(rd * 7 + 88) * (wh - 8);
            ctx.beginPath(); ctx.arc(rdx, rdy, 1.5, 0, Math.PI * 2); ctx.fill();
            // Running water trail
            ctx.fillStyle = 'rgba(150,200,240,0.2)';
            var trailLen = 3 + _wRand(rd * 3) * 8;
            ctx.fillRect(rdx - 0.4, rdy + 1.5, 0.8, trailLen);
            ctx.fillStyle = 'rgba(150,200,240,0.75)';
        }
        // Clouds
        _drawCloud(wx + (_weatherTick * 0.03 + 5) % (ww + 10) - 5, wy + 5, 14, 5, 0.65);
        ctx.restore();

    // ─── HEAVY RAIN ───
    } else if (cond === 'heavy_rain') {
        ctx.save();
        ctx.beginPath(); ctx.rect(wx, wy, ww, wh); ctx.clip();
        // Very dark overlay
        ctx.fillStyle = 'rgba(50,55,65,0.5)';
        ctx.fillRect(wx, wy, ww, wh);
        // Torrential rain — dense, fast, wind-driven
        var hrWind = Math.min(wind * 0.03, 0.6);
        ctx.strokeStyle = 'rgba(120,170,210,0.92)';
        ctx.lineWidth = 1.2;
        for (var hr = 0; hr < 20; hr++) {
            var hSeed = _wRand(hr * 7 + wx);
            var hx = wx + (hSeed * ww + _weatherTick * (0.7 + hrWind)) % ww;
            var hy = wy + (_weatherTick * 3 + hr * 7) % wh;
            ctx.beginPath();
            ctx.moveTo(hx, hy);
            ctx.lineTo(hx - hrWind * 10, hy + 8);
            ctx.stroke();
        }
        // Heavy splashes
        for (var hs = 0; hs < 6; hs++) {
            var hss = _wRand(hs * 23 + wx + 9);
            var hsx = wx + 3 + hss * (ww - 6);
            var hsy = wy + wh - 3;
            var hsPhase = (_weatherTick * 0.08 + hs * 1.7) % 2;
            if (hsPhase < 0.6) {
                ctx.fillStyle = 'rgba(150,200,240,' + (0.5 - hsPhase * 0.8) + ')';
                ctx.beginPath(); ctx.arc(hsx, hsy, 1.5 + hsPhase * 5, Math.PI, 0); ctx.fill();
            }
        }
        // Water streaming down window — thick rivulets
        ctx.strokeStyle = 'rgba(140,190,230,0.7)';
        ctx.lineWidth = 1.5;
        for (var rv = 0; rv < 4; rv++) {
            var rvx = wx + 4 + _wRand(rv * 41 + wx) * (ww - 8);
            ctx.beginPath();
            ctx.moveTo(rvx, wy);
            for (var rvs = 0; rvs < 6; rvs++) {
                rvx += Math.sin(_weatherTick * 0.03 + rv + rvs) * 2;
                ctx.lineTo(rvx, wy + (rvs + 1) * (wh / 6));
            }
            ctx.stroke();
        }
        // Mist/spray at bottom
        ctx.fillStyle = 'rgba(180,200,220,0.28)';
        ctx.fillRect(wx, wy + wh - 10, ww, 10);
        ctx.restore();

    // ─── THUNDERSTORM ───
    } else if (cond === 'thunderstorm') {
        ctx.save();
        ctx.beginPath(); ctx.rect(wx, wy, ww, wh); ctx.clip();
        // Very dark sky
        ctx.fillStyle = 'rgba(30,30,40,0.6)';
        ctx.fillRect(wx, wy, ww, wh);
        // Heavy wind-driven rain
        var stWind = Math.min(wind * 0.035, 0.7);
        ctx.strokeStyle = 'rgba(120,165,200,0.9)';
        ctx.lineWidth = 1;
        for (var sr = 0; sr < 18; sr++) {
            var sSeed = _wRand(sr * 7 + wx);
            var sx = wx + (sSeed * ww + _weatherTick * (0.8 + stWind)) % ww;
            var sy = wy + (_weatherTick * 3.5 + sr * 8) % wh;
            ctx.beginPath();
            ctx.moveTo(sx, sy);
            ctx.lineTo(sx - stWind * 12, sy + 7);
            ctx.stroke();
        }
        // Lightning — irregular timing with multiple bolt types
        if (_weatherTick > _nextLightningAt) {
            _lastLightningFlash = _weatherTick;
            _lightningBoltX = wx + 3 + Math.random() * (ww - 6);
            _nextLightningAt = _weatherTick + 120 + Math.floor(Math.random() * 300);
        }
        var flashAge = _weatherTick - _lastLightningFlash;
        // Flash illumination (fades over ~8 frames)
        if (flashAge < 8) {
            var flashAlpha = 0.5 * Math.pow(0.7, flashAge);
            ctx.fillStyle = 'rgba(255,255,240,' + flashAlpha + ')';
            ctx.fillRect(wx, wy, ww, wh);
        }
        // Lightning bolt visible for a few frames
        if (flashAge < 4 && isLeft) {
            _drawLightningBolt(_lightningBoltX, wy + 2, wh * 0.7, true);
        }
        // Double-flash effect (flickers)
        if (flashAge >= 6 && flashAge < 9) {
            ctx.fillStyle = 'rgba(255,255,240,0.15)';
            ctx.fillRect(wx, wy, ww, wh);
        }
        // Dark roiling clouds
        var stDrift = _weatherTick * 0.04;
        ctx.fillStyle = 'rgba(50,50,60,0.35)';
        _drawCloud(wx + (stDrift + 3) % (ww + 10) - 5, wy + 5, 16, 6, 0.72);
        _drawCloud(wx + (stDrift * 0.6 + ww * 0.5) % (ww + 10) - 5, wy + 10, 12, 5, 0.65);
        // Splashes
        for (var tsp = 0; tsp < 5; tsp++) {
            var tsps = _wRand(tsp * 19 + wx);
            var tspx = wx + 3 + tsps * (ww - 6);
            var tspy = wy + wh - 3;
            var tspPhase = (_weatherTick * 0.09 + tsp * 1.5) % 2;
            if (tspPhase < 0.5) {
                ctx.fillStyle = 'rgba(180,210,240,' + (0.4 - tspPhase * 0.8) + ')';
                ctx.beginPath(); ctx.arc(tspx, tspy, 1.5 + tspPhase * 4, Math.PI, 0); ctx.fill();
            }
        }
        ctx.restore();

    // ─── FOGGY ───
    } else if (cond === 'foggy') {
        ctx.save();
        ctx.beginPath(); ctx.rect(wx, wy, ww, wh); ctx.clip();
        // Multi-layer fog with parallax drifting
        var fogPhase = _weatherTick * 0.008;
        // Background haze
        ctx.fillStyle = 'rgba(195,195,200,0.48)';
        ctx.fillRect(wx, wy, ww, wh);
        // Fog bands — three layers at different speeds and heights
        for (var fb = 0; fb < 3; fb++) {
            var bandY = wy + 6 + fb * 10 + Math.sin(fogPhase * (0.8 + fb * 0.3) + fb * 2) * 3;
            var bandAlpha = 0.12 - fb * 0.02;
            var bandW = ww * (0.7 + _wRand(fb * 7) * 0.5);
            var bandX = wx + Math.sin(fogPhase * (0.5 + fb * 0.2)) * 5;
            ctx.fillStyle = 'rgba(210,212,215,' + bandAlpha + ')';
            ctx.fillRect(bandX, bandY, bandW, 6 - fb);
        }
        // Misty particles drifting
        ctx.fillStyle = 'rgba(220,220,225,0.4)';
        for (var mp = 0; mp < 6; mp++) {
            var mpx = wx + (_wRand(mp * 17) * ww + _weatherTick * 0.15) % ww;
            var mpy = wy + _wRand(mp * 29 + 7) * wh;
            ctx.beginPath(); ctx.arc(mpx, mpy, 2 + _wRand(mp) * 2, 0, Math.PI * 2); ctx.fill();
        }
        // Condensation on glass
        ctx.fillStyle = 'rgba(200,210,220,0.2)';
        for (var fc = 0; fc < 6; fc++) {
            var fcx = wx + 2 + _wRand(fc * 11 + wx) * (ww - 4);
            var fcy = wy + 2 + _wRand(fc * 23 + 5) * (wh - 4);
            ctx.beginPath(); ctx.arc(fcx, fcy, 1, 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();

    // ─── LIGHT SNOW ───
    } else if (cond === 'light_snow') {
        ctx.save();
        ctx.beginPath(); ctx.rect(wx, wy, ww, wh); ctx.clip();
        ctx.fillStyle = 'rgba(210,215,225,0.25)';
        ctx.fillRect(wx, wy, ww, wh);
        // Gentle floating snowflakes — slow, drifting
        for (var ls = 0; ls < 5; ls++) {
            var lsSeed = _wRand(ls * 13 + wx);
            var lsx = wx + (lsSeed * ww + _weatherTick * 0.12 + Math.sin(_weatherTick * 0.03 + ls * 1.8) * 5) % ww;
            var lsy = wy + (_weatherTick * 0.3 + ls * 13) % wh;
            var lsSize = 1 + _wRand(ls * 7) * 1.5;
            // Snowflake sparkle
            var sparkle = 0.6 + Math.sin(_weatherTick * 0.05 + ls * 2.3) * 0.3;
            ctx.fillStyle = 'rgba(255,255,255,' + sparkle + ')';
            ctx.beginPath(); ctx.arc(lsx, lsy, lsSize, 0, Math.PI * 2); ctx.fill();
        }
        // Light frost on corners
        ctx.fillStyle = 'rgba(230,235,245,0.3)';
        ctx.fillRect(wx, wy, 4, 4);
        ctx.fillRect(wx + ww - 4, wy, 4, 4);
        ctx.restore();

    // ─── SNOW ───
    } else if (cond === 'snow') {
        ctx.save();
        ctx.beginPath(); ctx.rect(wx, wy, ww, wh); ctx.clip();
        // Cold blue-grey tint
        ctx.fillStyle = 'rgba(200,205,220,0.32)';
        ctx.fillRect(wx, wy, ww, wh);
        // Dense snowflakes with varied sizes and wobble
        for (var sf = 0; sf < 10; sf++) {
            var fSeed = _wRand(sf * 13 + wx);
            var wobble = Math.sin(_weatherTick * 0.04 + sf * 1.7) * 4;
            var fx = wx + (fSeed * ww + _weatherTick * 0.18 + wobble) % ww;
            var fy = wy + (_weatherTick * 0.6 + sf * 9) % wh;
            var fSize = 1 + _wRand(sf * 3 + 5) * 2;
            var fAlpha = 0.5 + _wRand(sf * 19) * 0.4;
            ctx.fillStyle = 'rgba(255,255,255,' + fAlpha + ')';
            ctx.beginPath(); ctx.arc(fx, fy, fSize, 0, Math.PI * 2); ctx.fill();
            // Some flakes have a tiny cross shape (larger ones)
            if (fSize > 2) {
                ctx.strokeStyle = 'rgba(255,255,255,' + (fAlpha * 0.5) + ')';
                ctx.lineWidth = 0.5;
                ctx.beginPath(); ctx.moveTo(fx - fSize, fy); ctx.lineTo(fx + fSize, fy); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(fx, fy - fSize); ctx.lineTo(fx, fy + fSize); ctx.stroke();
            }
        }
        // Snow accumulation on window sill
        ctx.fillStyle = 'rgba(240,242,248,0.75)';
        ctx.fillRect(wx, wy + wh - 3, ww, 3);
        ctx.fillStyle = 'rgba(250,250,255,0.3)';
        for (var sa = 0; sa < 5; sa++) {
            var sax = wx + sa * (ww / 5) + 2;
            var saH = 2 + _wRand(sa * 7 + wx) * 2;
            ctx.beginPath(); ctx.arc(sax + ww / 10, wy + wh - 2, saH, Math.PI, 0); ctx.fill();
        }
        // Frost on edges
        ctx.fillStyle = 'rgba(220,225,240,0.2)';
        ctx.fillRect(wx, wy, ww, 2);
        ctx.fillRect(wx, wy, 2, wh);
        ctx.fillRect(wx + ww - 2, wy, 2, wh);
        ctx.restore();

    // ─── SNOW STORM ───
    } else if (cond === 'snow_storm') {
        ctx.save();
        ctx.beginPath(); ctx.rect(wx, wy, ww, wh); ctx.clip();
        // Whiteout conditions
        ctx.fillStyle = 'rgba(200,205,215,0.2)';
        ctx.fillRect(wx, wy, ww, wh);
        // Blowing snow — fast, wind-driven, dense
        var snWind = Math.min(wind * 0.04, 0.8);
        for (var bs = 0; bs < 16; bs++) {
            var bSeed = _wRand(bs * 11 + wx);
            var bx = wx + (bSeed * ww + _weatherTick * (0.4 + snWind * 2)) % ww;
            var by = wy + (_weatherTick * 1.2 + bs * 7) % wh;
            var bSize = 1 + _wRand(bs * 3) * 2.5;
            var bAlpha = 0.4 + _wRand(bs * 17) * 0.5;
            ctx.fillStyle = 'rgba(255,255,255,' + bAlpha + ')';
            ctx.beginPath(); ctx.arc(bx, by, bSize, 0, Math.PI * 2); ctx.fill();
        }
        // Gusts — periodic horizontal snow streaks
        if ((_weatherTick % 120) < 30) {
            ctx.strokeStyle = 'rgba(255,255,255,0.3)';
            ctx.lineWidth = 0.8;
            for (var gs = 0; gs < 6; gs++) {
                var gsy = wy + 3 + _wRand(gs * 7 + _weatherTick) * (wh - 6);
                ctx.beginPath();
                ctx.moveTo(wx, gsy);
                ctx.lineTo(wx + ww * 0.6, gsy + (Math.random() - 0.5) * 3);
                ctx.stroke();
            }
        }
        // Heavy sill accumulation
        ctx.fillStyle = 'rgba(240,242,248,0.5)';
        ctx.fillRect(wx, wy + wh - 5, ww, 5);
        // Frost covering edges heavily
        ctx.fillStyle = 'rgba(215,220,235,0.25)';
        ctx.fillRect(wx, wy, ww, 3);
        ctx.fillRect(wx, wy, 3, wh);
        ctx.fillRect(wx + ww - 3, wy, 3, wh);
        // Ice crystals in corners
        ctx.strokeStyle = 'rgba(200,210,230,0.2)';
        ctx.lineWidth = 0.5;
        for (var ic = 0; ic < 3; ic++) {
            var icx = wx + 2 + ic * 2, icy = wy + 2 + ic * 2;
            ctx.beginPath(); ctx.moveTo(icx, icy); ctx.lineTo(icx + 4, icy + 4); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(icx + 4, icy); ctx.lineTo(icx, icy + 4); ctx.stroke();
        }
        ctx.restore();

    // ─── SLEET ───
    } else if (cond === 'sleet') {
        ctx.save();
        ctx.beginPath(); ctx.rect(wx, wy, ww, wh); ctx.clip();
        ctx.fillStyle = 'rgba(100,105,115,0.15)';
        ctx.fillRect(wx, wy, ww, wh);
        // Mix of rain streaks and ice pellets
        var slWind = Math.min(wind * 0.025, 0.5);
        // Rain component
        ctx.strokeStyle = 'rgba(130,175,210,0.5)';
        ctx.lineWidth = 0.8;
        for (var sl = 0; sl < 8; sl++) {
            var slSeed = _wRand(sl * 7 + wx);
            var slx = wx + (slSeed * ww + _weatherTick * (0.5 + slWind)) % ww;
            var sly = wy + (_weatherTick * 2 + sl * 11) % wh;
            ctx.beginPath(); ctx.moveTo(slx, sly); ctx.lineTo(slx - slWind * 6, sly + 5); ctx.stroke();
        }
        // Ice pellet component — small bright dots falling faster
        ctx.fillStyle = 'rgba(220,230,240,0.7)';
        for (var ip = 0; ip < 6; ip++) {
            var ipSeed = _wRand(ip * 17 + wx + 33);
            var ipx = wx + (ipSeed * ww + _weatherTick * 0.6) % ww;
            var ipy = wy + (_weatherTick * 2.5 + ip * 12) % wh;
            ctx.fillRect(ipx, ipy, 1.5, 1.5);
        }
        // Ice buildup on glass
        ctx.fillStyle = 'rgba(200,215,230,0.15)';
        ctx.fillRect(wx, wy + wh - 3, ww, 3);
        ctx.restore();
    }
}

// ============================================================
// AMBIENT LIGHTING — day/night cycle for the whole office
// ============================================================
// Debug: set _timeLapse=true to cycle 24h in 60 seconds
var _timeLapse = false;
var _timeLapseStart = 0;

// Time override: null = real time, or fixed hour (0-23)
var _timeOverride = null;
var _timeOverrideModes = [
    null,        // real time
    12,          // noon (full daylight)
    21,          // 9 PM (night)
    6,           // 6 AM (dawn)
    17.5,        // 5:30 PM (sunset)
    'lapse'      // time-lapse
];
var _timeOverrideIdx = 0;

function cycleTimeOverride() {
    _timeOverrideIdx = (_timeOverrideIdx + 1) % _timeOverrideModes.length;
    var mode = _timeOverrideModes[_timeOverrideIdx];
    var btn = _voNullElement('btn-time-override');
    if (mode === null) {
        _timeOverride = null;
        _timeLapse = false;
        if (btn) { btn.textContent = '☀️'; btn.title = 'Time: Real time'; }
        console.log('Time override OFF — real time');
    } else if (mode === 'lapse') {
        _timeOverride = null;
        _timeLapse = true;
        _timeLapseStart = Date.now();
        if (btn) { btn.textContent = '⏩'; btn.title = 'Time: Lapse (24h in 60s)'; }
        console.log('Time-lapse ON — 24h in 60s');
    } else {
        _timeOverride = mode;
        _timeLapse = false;
        var labels = { 12: '🌞 Noon', 21: '🌙 Night', 6: '🌅 Dawn', 17.5: '🌇 Sunset' };
        if (btn) { btn.textContent = labels[mode] || '⏰'; btn.title = 'Time: ' + (labels[mode] || mode + 'h'); }
        console.log('Time override: ' + mode + 'h');
    }
}

function _getTimeHour() {
    if (_timeOverride !== null) return _timeOverride;
    if (_timeLapse) {
        var elapsed = (Date.now() - _timeLapseStart) / 1000;
        return (elapsed / 60 * 24) % 24;
    }
    var h = new Date().getHours();
    var m = new Date().getMinutes();
    return h + m / 60;
}

function toggleTimeLapse() {
    _timeLapse = !_timeLapse;
    _timeLapseStart = Date.now();
    console.log(_timeLapse ? 'Time-lapse ON — 24h in 60s' : 'Time-lapse OFF — real time');
}

// Solar calculator for Florida (~27.5°N latitude)
function _calcSunTimes() {
    var now = new Date();
    var start = new Date(now.getFullYear(), 0, 0);
    var diff = now - start;
    var dayOfYear = Math.floor(diff / 86400000);
    var lat = 27.5; // Central Florida latitude
    var latRad = lat * Math.PI / 180;

    // Solar declination
    var decl = -23.45 * Math.cos(2 * Math.PI / 365 * (dayOfYear + 10));
    var declRad = decl * Math.PI / 180;

    // Hour angle for sunrise/sunset (when sun crosses horizon)
    var cosHA = -Math.tan(latRad) * Math.tan(declRad);
    cosHA = Math.max(-1, Math.min(1, cosHA));
    var haHours = Math.acos(cosHA) * 180 / Math.PI / 15;

    // Solar noon (approximate — 12:00 + small correction)
    var noon = 12.0;

    var sunrise = noon - haHours;
    var sunset = noon + haHours;

    // Civil twilight (~30 min before sunrise / after sunset)
    var dawn = sunrise - 0.5;
    var dusk = sunset + 0.5;

    return { dawn: dawn, sunrise: sunrise, sunset: sunset, dusk: dusk };
}

var _sunTimes = _calcSunTimes(); // recalculate once on load
var _sunTimesLastDay = new Date().getDate();

function _getSunTimes() {
    var today = new Date().getDate();
    if (today !== _sunTimesLastDay) {
        _sunTimes = _calcSunTimes();
        _sunTimesLastDay = today;
    }
    return _sunTimes;
}

// --- FPS counter + perf profiling ---
var _fpsFrames = 0, _fpsLast = Date.now(), _fpsDisplay = 0;
var _perfTimes = {};

function _perfStart(label) { _perfTimes[label] = performance.now(); }
function _perfEnd(label) {
    var elapsed = performance.now() - (_perfTimes[label] || 0);
    if (!_perfTimes._totals) _perfTimes._totals = {};
    if (!_perfTimes._counts) _perfTimes._counts = {};
    _perfTimes._totals[label] = (_perfTimes._totals[label] || 0) + elapsed;
    _perfTimes._counts[label] = (_perfTimes._counts[label] || 0) + 1;
    // Log every 120 frames
    if (_perfTimes._counts[label] === 120) {
        var avg = _perfTimes._totals[label] / 120;
        if (avg > 0.5) console.log('[perf] ' + label + ': ' + avg.toFixed(2) + 'ms avg');
        _perfTimes._totals[label] = 0;
        _perfTimes._counts[label] = 0;
    }
}

// --- Rim light cache (Option D: throttled to every 5 frames) ---
var _rimCache = new Map();
var _rimFrame = 0;
var _RIM_INTERVAL = 5;

// Cached ambient light — computed once per frame via _updateAmbientCache()
var _ambientCache = { dark: 0, tint: '0,0,0' };
function _updateAmbientCache() {
    var t = _getTimeHour();
    var sun = _getSunTimes();

    // Phase boundaries based on real sun times
    var nightEnd = sun.dawn;              // civil twilight begins
    var dawnEnd = sun.sunrise;            // sun rises
    var morningEnd = sun.sunrise + 1.5;   // golden hour ends ~1.5h after sunrise
    var afternoonStart = sun.sunset - 2;  // late afternoon begins 2h before sunset
    var sunsetStart = sun.sunset - 0.5;   // sunset glow starts 30min before
    var sunsetEnd = sun.sunset + 0.3;     // sun dips below
    var duskEnd = sun.dusk;               // civil twilight ends — full night

    if (t < nightEnd)         _ambientCache = { dark: 0.25, tint: '0,10,40' };       // deep night
    else if (t < dawnEnd)     _ambientCache = { dark: 0.12, tint: '60,20,0' };       // dawn
    else if (t < morningEnd)  _ambientCache = { dark: 0.05, tint: '40,20,0' };       // morning golden
    else if (t < afternoonStart) _ambientCache = { dark: 0,    tint: '0,0,0' };      // full daylight
    else if (t < sunsetStart) _ambientCache = { dark: 0.03, tint: '40,15,0' };       // late afternoon
    else if (t < sunsetEnd)   _ambientCache = { dark: 0.08, tint: '50,20,0' };       // sunset
    else if (t < duskEnd)     _ambientCache = { dark: 0.15, tint: '20,10,30' };      // dusk
    else                      _ambientCache = { dark: 0.25, tint: '0,10,40' };       // night
}
function getAmbientLight() { return _ambientCache; }

function drawAmbientOverlay() {
    var amb = getAmbientLight();
    if (amb.dark <= 0) return; // full daylight, no overlay needed

    // Dark overlay on entire scene
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(' + amb.tint + ',' + amb.dark + ')';
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
}

function drawLightGlows() {
    // Disabled: remove leftover glow/shaded appliance shapes
}

// Option G helper: check if a world-space point is visible in current viewport
function _isInView(wx, wy, margin) {
    var base = Math.max(displayW / W, displayH / H);
    var totalZoom = base * camera.zoom;
    var viewW = displayW / totalZoom;
    var viewH = displayH / totalZoom;
    var camLeft = W / 2 + camera.x - viewW / 2 - margin;
    var camTop = H / 2 + camera.y - viewH / 2 - margin;
    return wx >= camLeft && wx <= camLeft + viewW + margin * 2 &&
           wy >= camTop && wy <= camTop + viewH + margin * 2;
}

// Option F: simplified desk lamp glows — 1 cone + 1 bulb glow (was 3 cones + clip + 4 arcs)
function drawDeskLampGlows() {
    // Disabled: remove leftover desk glow shapes
}

// Rim light — calculated per agent, cached every _RIM_INTERVAL frames
function getRimLight(agent) {
    var key = agent.id || agent.name;
    if (_rimFrame % _RIM_INTERVAL !== 0) {
        var cached = _rimCache.get(key);
        if (cached !== undefined) return cached;
    }
    var result = _getRimLightInner(agent);
    _rimCache.set(key, result);
    return result;
}
function _getRimLightInner(agent) {
    // Hardcoded light sources removed — rim lighting will be driven by dynamic light system
    return null;
}

// No-op — rim is now drawn inside agent draw()
function drawAgentLampBounce() {}

// Helper: set warm lamp shadow for furniture near a light source
function _setFurnitureLampShadow(objX, objY) {
    // Hardcoded light sources removed — no-op until dynamic light system
}
function _clearFurnitureShadow() {
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
}

// Extra light sources around the office (non-desk lamps)
// Lamps (draw hardware + glow)
// Light sources cleared — lighting is now dynamic/user-configured, not hardcoded
var officeLights = [];
var ambientLightSources = [];
var DESK_LAMP_RANGE = 100;

function drawOfficeLamps() {
    // Disabled: remove leftover original lamp drawings
}

// Neon signs (drawn after ambient overlay so they glow through darkness)
// Option B: layered text glow instead of shadowBlur
// Neon sign colors mapped by theme
var _NEON_COLORS = {
    'branch-gold':   '#ffeb3b',
    'branch-blue':   '#00e5ff',
    'branch-orange': '#ff9100',
    'branch-cyan':   '#00e5ff',
    'branch-red':    '#ff6d00',
    'branch-gray':   '#90a4ae',
};

function drawNeonSigns() {
    // Neon signs are now rendered as branchSign furniture items — this function is a no-op.
    // The glow effect is handled in drawBranchSign() which runs during furniture rendering.
}

// Cached desk position lookup — rebuilt when furniture changes
var _deskPosCache = null;
var _deskPosCacheKey = '';
function _getDeskPositions() {
    // Simple cache key: furniture count + last item id
    var fLen = officeConfig.furniture.length;
    var key = fLen + ':' + (fLen > 0 ? officeConfig.furniture[fLen - 1].id : '');
    if (_deskPosCache && _deskPosCacheKey === key) return _deskPosCache;
    _deskPosCache = {};
    officeConfig.furniture.forEach(function(f) {
        if (f.type === 'desk' || f.type === 'bossDesk') _deskPosCache[f.x + ',' + f.y] = true;
    });
    _deskPosCacheKey = key;
    return _deskPosCache;
}

// Draw physical lamp hardware on each desk that has an agent assigned
function drawDeskLamps() {
    // Disabled: remove leftover desk lamp drawings
}

// Dynamic canvas sizing — match display size, no stretching
var displayW = 1000, displayH = 700; // set by VOBuildingEngine

let _resizeRAF = null;
function resizeCanvas(force) {
    // No-op: canvas size is managed externally by VOBuildingEngine
}
resizeCanvas();
// window resize handler removed — canvas size managed externally

// --- CAMERA ---
var camera = { x: 0, y: 0, zoom: 1 }; // overwritten by VOBuildingEngine
const CAM_ZOOM_MIN = 0.5;
const CAM_ZOOM_MAX = 3.0;
let _isPanning = false;
let _panStartX = 0, _panStartY = 0;
let _camStartX = 0, _camStartY = 0;
let _pinchStartDist = 0, _pinchStartZoom = 1;
let _lastTapTime = 0;

// Convert screen (CSS) coords to world coords
function screenToWorld(sx, sy) {
    const rect = canvas.getBoundingClientRect();
    // CSS pixel to canvas logical coord
    const cx = (sx - rect.left) * (displayW / rect.width);
    const cy = (sy - rect.top) * (displayH / rect.height);
    // Reverse camera transform
    const base = getBaseScale();
    const totalZoom = base * camera.zoom;
    const wx = (cx - displayW / 2) / totalZoom + W / 2 + camera.x;
    const wy = (cy - displayH / 2) / totalZoom + H / 2 + camera.y;
    return { x: wx, y: wy };
}

function clampCamera() {
    const base = getBaseScale();
    const totalZoom = base * camera.zoom;
    const halfViewW = displayW / totalZoom / 2;
    const halfViewH = displayH / totalZoom / 2;
    const CAM_EDGE_BUFFER = TILE * 3; // allow panning 3 tiles past canvas edge
    const maxX = Math.max(0, W / 2 - halfViewW + CAM_EDGE_BUFFER);
    const maxY = Math.max(0, H / 2 - halfViewH + CAM_EDGE_BUFFER);
    camera.x = Math.max(-maxX, Math.min(maxX, camera.x));
    camera.y = Math.max(-maxY, Math.min(maxY, camera.y));
}

let _zoomIndicatorTimer = 0;

function resetCamera() {
    camera.x = 0; camera.y = 0; camera.zoom = 1;
    _zoomIndicatorTimer = Date.now();
}

// Base scale: fit the 1000x700 world into the display without stretching
function getBaseScale() {
    return Math.max(displayW / W, displayH / H);
}

// Apply camera transform (call before drawing world objects)
function applyCameraTransform() {
    const base = getBaseScale();
    ctx.translate(displayW / 2, displayH / 2);
    ctx.scale(base * camera.zoom, base * camera.zoom);
    ctx.translate(-W / 2 - camera.x, -H / 2 - camera.y);
}

// --- MOUSE/TOUCH: PAN & ZOOM ---
// canvas.addEventListener('wheel', — removed (events forwarded via VOBuildingEngine.handlePointer*)

// canvas.addEventListener('mousedown', — removed (events forwarded via VOBuildingEngine.handlePointer*)

// window.addEventListener('mousemove', — removed (events forwarded via VOBuildingEngine.handlePointer*)

// window.addEventListener('mouseup', — removed (events forwarded via VOBuildingEngine.handlePointer*)

// Touch: pan with one finger, pinch-zoom with two
// canvas.addEventListener('touchstart', — removed (events forwarded via VOBuildingEngine.handlePointer*)

// canvas.addEventListener('touchmove', — removed (events forwarded via VOBuildingEngine.handlePointer*)

// canvas.addEventListener('touchend', — removed (events forwarded via VOBuildingEngine.handlePointer*)

// --- LOCATIONS ---
const LOCATIONS = {
    pqDesks: [
        { x: 140, y: 220 },  // Moe
        { x: 140, y: 340 },  // Calen
        { x: 280, y: 220 },  // Mike
        { x: 280, y: 340 },  // Cash
        { x: 280, y: 460 },  // Alan
        { x: 140, y: 460 },  // Filer
    ],
    engDesks: [
        { x: 720, y: 220 },  // Flo
        { x: 720, y: 340 },  // Mark
        { x: 860, y: 220 },  // Ana
        { x: 860, y: 340 },  // Plan
    ],
    bossDesk: { x: 500, y: 180 },
    centerDesk: { x: 500, y: 340 },
    centerDesk2: { x: 600, y: 340 },
    centerDesk3: { x: 400, y: 340 },
    forgeDesk: { x: 460, y: 620 },
    meeting: { x: 370, y: 440, w: 240, h: 120 },
    lounge: { x: 60, y: 550 },
    cooler: { x: 820, y: 540 },
    // Wander destinations for idle agents
    wanderSpots: [
        { x: 450, y: 350, label: 'hallway' },
        { x: 550, y: 350, label: 'hallway' },
        { x: 500, y: 620, label: 'entrance' },
        { x: 350, y: 300, label: 'pq-hall' },
        { x: 650, y: 300, label: 'eng-hall' },
        { x: 420, y: 600, label: 'forge-area' },
    ],
    // Detailed interaction spots
    interactions: {
        windows: [
            { x: 406, y: 100 },    // HQ left window
            { x: 594, y: 100 },    // HQ right window
        ],
        couchSeats: [
            { x: 78, y: 575, faceDir: 1 },     // back of L, top
            { x: 78, y: 598, faceDir: 1 },     // back of L, bottom
            { x: 108, y: 630, faceDir: -1 },   // bottom of L, left
            { x: 138, y: 630, faceDir: -1 },   // bottom of L, middle
            { x: 168, y: 630, faceDir: -1 },   // bottom of L, right
        ],
        bookshelf: { x: 30, y: 660 },
        tvSpot: { x: 155, y: 601, faceDir: 1 },
        vendingMachine: { x: 765, y: 634 },
        coffeeMaker: { x: 850, y: 628 },
        waterCooler: { x: 899, y: 594 },
        microwave: { x: 935, y: 636 },
        toaster: { x: 960, y: 620 },
        dartBoard: { x: 270, y: 670 },  // standing spot in front of dart board
        // ENG lounge couch (under Caltran sign)
        engCouchSeats: [
            { x: 735, y: 89, faceDir: -1 },   // left seat
            { x: 775, y: 89, faceDir: -1 },   // center-left
            { x: 815, y: 89, faceDir: -1 },   // center-right
            { x: 855, y: 89, faceDir: -1 },   // right seat
        ],
    },
};

// --- Meeting slots — derived dynamically from meeting table furniture position ---
// If a meetingTable item exists, slots are relative to its position.
// If no meetingTable exists, returns empty (agents meet at random spots instead).
function getMeetingTablePos() {
    if (typeof officeConfig !== 'undefined' && officeConfig.furniture) {
        var table = officeConfig.furniture.find(function(f) { return f.type === 'meetingTable'; });
        if (table) return { x: table.x, y: table.y, w: 240, h: 120 };
    }
    // Fallback to LOCATIONS.meeting if it exists (backward compat)
    if (LOCATIONS.meeting) return LOCATIONS.meeting;
    return null;
}

function getMeetingSlots() {
    var m = getMeetingTablePos();
    if (!m) return [];
    // 5 chairs per side, evenly spaced across 240px wide table
    return [
        { x: m.x + 27, y: m.y + 15 },    // top row
        { x: m.x + 73, y: m.y + 15 },
        { x: m.x + 120, y: m.y + 15 },
        { x: m.x + 166, y: m.y + 15 },
        { x: m.x + 213, y: m.y + 15 },
        { x: m.x + 27, y: m.y + 103 },   // bottom row
        { x: m.x + 73, y: m.y + 103 },
        { x: m.x + 120, y: m.y + 103 },
        { x: m.x + 166, y: m.y + 103 },
        { x: m.x + 213, y: m.y + 103 },
    ];
}
// Legacy constant — kept for backward compat but now calls dynamic function
var MEETING_SLOTS = getMeetingSlots();

// --- 1-on-1 meeting positions (relative to target desk) ---
const VISIT_OFFSET = { x: -30, y: 15 };  // visitor stands beside desk

// --- FURNITURE ACTION SPOTS (dx/dy relative to furniture item's x,y) ---
// Spot dx/dy values are calibrated to match existing LOCATIONS.interactions positions exactly.
const FURNITURE_ACTIONS = {
    'lounge': {
        spots: [
            // L-couch seats
            { dx: 18, dy: 25, faceDir:  1, action: 'sit' },
            { dx: 18, dy: 48, faceDir:  1, action: 'sit' },
            { dx: 48, dy: 80, faceDir: -1, action: 'sit' },
            { dx: 78, dy: 80, faceDir: -1, action: 'sit' },
            { dx: 108, dy: 80, faceDir: -1, action: 'sit' },
            // Bookshelf (drawn at lx-50, ly inside drawLoungeArea)
            { dx: -30, dy: 35, action: 'read' },
            // TV spot
            { dx: 95, dy: 28, faceDir: 1, action: 'watch' },
            // Dart board spot (drawn at lx+210, ly-8 inside drawLoungeArea)
            { dx: 210, dy: 120, action: 'darts' },
        ]
    },
    'engLounge': {
        spots: [
            { dx:  20, dy: 27, faceDir: -1, action: 'sit' },
            { dx:  60, dy: 27, faceDir: -1, action: 'sit' },
            { dx: 100, dy: 27, faceDir: -1, action: 'sit' },
            { dx: 140, dy: 27, faceDir: -1, action: 'sit' },
        ]
    },
    'breakArea': {
        spots: [
            { dx:  25, dy:  90, action: 'vend'      },  // vending machine
            { dx: 110, dy: 105, action: 'coffee'    },  // coffee maker
            { dx: 165, dy:  62, action: 'drink'     },  // water cooler
            { dx: 195, dy: 105, action: 'microwave' },  // microwave
            { dx: 220, dy: 105, action: 'toast'     },  // toaster
        ]
    },
    'meetingTable': {
        spots: [
            // Top row (5 chairs, evenly spaced across 200px table starting at pad=20, spacing=(200-14)/4=46.5)
            { dx:  27, dy:  15, faceDir: 2 }, { dx:  73, dy:  15, faceDir: 2 }, { dx: 120, dy:  15, faceDir: 2 },
            { dx: 166, dy:  15, faceDir: 2 }, { dx: 213, dy:  15, faceDir: 2 },
            // Bottom row
            { dx:  27, dy: 103, faceDir: 0 }, { dx:  73, dy: 103, faceDir: 0 }, { dx: 120, dy: 103, faceDir: 0 },
            { dx: 166, dy: 103, faceDir: 0 }, { dx: 213, dy: 103, faceDir: 0 },
        ],
        action: 'meeting'
    },
    'couch': {
        spots: [
            { dx: 12, dy: 15, faceDir:  1, action: 'sit' },
            { dx: 12, dy: 38, faceDir:  1, action: 'sit' },
            { dx: 36, dy: 65, faceDir: -1, action: 'sit' },
            { dx: 60, dy: 65, faceDir: -1, action: 'sit' },
            { dx: 84, dy: 65, faceDir: -1, action: 'sit' },
        ]
    },
    'coffeeTable':    { spots: [],                               action: null     },
    'dartBoard':      { spots: [{ dx: 0, dy: 140 }],            action: 'darts'  },
    'pingPongTable':  { spots: [{ dx: -50, dy: 0 }, { dx: 50, dy: 0 }], action: 'pong' },
    'desk':           { spots: [{ dx: 0, dy: 0 }],              action: 'work'   },
    'bossDesk':       { spots: [{ dx: 0, dy: 0 }],              action: 'work'   },
    'receptionDesk':  {
        spots: [
            { dx: 0, dy: 48, faceDir: 2, action: 'greet' },
            { dx: 0, dy: -46, faceDir: 0, action: 'work' }
        ],
        action: 'greet',
        rotatable: true
    },
    'printerCopier':  { spots: [{ dx: 0, dy: 50, faceDir: 2, action: 'print_copy' }], action: 'print_copy', rotatable: true },
    'waterCooler':    { spots: [{ dx: -6, dy: 54 }],            action: 'drink'  },
    'coffeeMaker':    { spots: [{ dx: 0, dy: 48 }],             action: 'coffee' },
    'vendingMachine': { spots: [{ dx: 0, dy: 74 }],             action: 'vend'   },
    'officeChair':    { spots: [{ dx: 0, dy: 10, faceDir: 0 }], action: 'sit', rotatable: true },
    'diningTable':    {
        spots: [
            { dx:   0, dy: -34, faceDir: 2, action: 'eat' },
            { dx:   0, dy:  34, faceDir: 0, action: 'eat' },
            { dx: -46, dy:   0, faceDir: 1, action: 'eat' },
            { dx:  46, dy:   0, faceDir: -1, action: 'eat' },
        ],
        action: 'eat',
        rotatable: true,
    },
    'sink':           { spots: [{ dx: 0, dy: 48, faceDir: 2 }], action: 'drink', rotatable: true },
    'stoveOven':      { spots: [{ dx: 0, dy: 48, faceDir: 2 }], action: 'cook', rotatable: true },
    'microwave':      { spots: [{ dx: 0, dy: 56 }],             action: 'microwave' },
    'toaster':        { spots: [{ dx: 0, dy: 40 }],             action: 'toast'  },
    'window':         { spots: [{ dx: 0, dy: 90 }],             action: 'gaze'   },
    'interactiveWindow': { spots: [{ dx: 0, dy: 90 }],          action: 'gaze'   },
    'bookshelf':      { spots: [{ dx: 0, dy: 90 }],             action: 'read'   },
    'tv':             { spots: [{ dx: 0, dy: 50, faceDir: 1 }], action: 'watch'  },
    'couch':          {
        spots: [
            // 4 seats ON the main body cushions (matching cushion centers)
            { dx: 23,  dy: 25, faceDir: 1, action: 'sit' },
            { dx: 57,  dy: 25, faceDir: 1, action: 'sit' },
            { dx: 91,  dy: 25, faceDir: 1, action: 'sit' },
            { dx: 125, dy: 25, faceDir: 1, action: 'sit' },
            // 1 seat ON the daybed cushion
            { dx: 135, dy: 58, faceDir: -1, action: 'sit' },
        ],
        rotatable: true,
    },
    'coffeeTable':    { spots: [], action: 'none' },
    'endTable':       { spots: [], action: 'none' },
    'textLabel':      { spots: [], action: 'none' },
};

// --- DEFAULT FURNITURE LAYOUT (matches current hardcoded drawEnvironment exactly) ---
function getDefaultFurniture() {
    var L = LOCATIONS;
    var f = [];
    // PQ desks + trash cans
    L.pqDesks.forEach(function(d, i) {
        f.push({ id: 'desk-pq-' + i,    type: 'desk',      x: d.x,      y: d.y      });
        f.push({ id: 'trash-pq-' + i,   type: 'trashCan',  x: d.x + 45, y: d.y + 20 });
    });
    // PQ area items
    f.push({ id: 'ping-pong',       type: 'pingPongTable',  x: 190,  y: 105 });
    f.push({ id: 'cabinet-pq-0',    type: 'filingCabinet',  x: 50,   y: 200 });
    f.push({ id: 'cabinet-pq-1',    type: 'filingCabinet',  x: 50,   y: 330 });
    f.push({ id: 'whiteboard-pq',   type: 'whiteboard',     x: 50,   y: 260 });
    // Boss desk
    f.push({ id: 'boss-desk',       type: 'bossDesk',       x: L.bossDesk.x,    y: L.bossDesk.y    });
    // Center desks + trash
    f.push({ id: 'desk-center',     type: 'desk',     x: L.centerDesk.x,  y: L.centerDesk.y  });
    f.push({ id: 'trash-center',    type: 'trashCan', x: L.centerDesk.x  + 45, y: L.centerDesk.y  + 20 });
    f.push({ id: 'desk-center2',    type: 'desk',     x: L.centerDesk2.x, y: L.centerDesk2.y });
    f.push({ id: 'trash-center2',   type: 'trashCan', x: L.centerDesk2.x + 45, y: L.centerDesk2.y + 20 });
    f.push({ id: 'desk-center3',    type: 'desk',     x: L.centerDesk3.x, y: L.centerDesk3.y });
    f.push({ id: 'trash-center3',   type: 'trashCan', x: L.centerDesk3.x + 45, y: L.centerDesk3.y + 20 });
    // ENG desks + trash
    L.engDesks.forEach(function(d, i) {
        f.push({ id: 'desk-eng-' + i,  type: 'desk',     x: d.x,      y: d.y      });
        f.push({ id: 'trash-eng-' + i, type: 'trashCan', x: d.x + 45, y: d.y + 20 });
    });
    // ENG area items
    f.push({ id: 'eng-couch',        type: 'engLounge',     x: 715,  y: 62  });
    f.push({ id: 'cabinet-eng-0',    type: 'filingCabinet', x: 950,  y: 200 });
    f.push({ id: 'cabinet-eng-1',    type: 'filingCabinet', x: 950,  y: 330 });
    f.push({ id: 'whiteboard-eng',   type: 'whiteboard',    x: 950,  y: 260 });
    // Meeting table (standalone — no room set)
    f.push({ id: 'meeting-table',    type: 'meetingTable',  x: L.meeting.x, y: L.meeting.y });
    // Lounge pieces (individual items, not a set)
    f.push({ id: 'lounge-couch',     type: 'couch',         x: L.lounge.x,  y: L.lounge.y  });
    f.push({ id: 'lounge-table',     type: 'coffeeTable',   x: L.lounge.x + 45, y: L.lounge.y + 35 });
    f.push({ id: 'lounge-tv',        type: 'tv',            x: L.lounge.x + 100, y: L.lounge.y + 10 });
    f.push({ id: 'lounge-bookshelf', type: 'bookshelf',     x: L.lounge.x - 30,  y: L.lounge.y + 30 });
    // Break area pieces (individual items)
    f.push({ id: 'break-vending',    type: 'vendingMachine', x: 740, y: 500 });
    f.push({ id: 'break-cooler',     type: 'waterCooler',    x: 800, y: 510 });
    f.push({ id: 'break-counter',    type: 'kitchenCounter', x: 830, y: 555 });
    // Plants
    f.push({ id: 'tall-plant-0',     type: 'tallPlant',     x: 395,  y: 100 });
    f.push({ id: 'tall-plant-1',     type: 'tallPlant',     x: 605,  y: 100 });
    f.push({ id: 'tall-plant-2',     type: 'tallPlant',     x: 50,   y: 440 });
    f.push({ id: 'tall-plant-3',     type: 'tallPlant',     x: 950,  y: 440 });
    f.push({ id: 'plant-0',          type: 'plant',         x: 370,  y: 400 });
    f.push({ id: 'plant-1',          type: 'plant',         x: 630,  y: 400 });
    f.push({ id: 'plant-2',          type: 'plant',         x: 300,  y: 140 });
    f.push({ id: 'plant-3',          type: 'plant',         x: 700,  y: 140 });
    // Forge desk + trash
    f.push({ id: 'desk-forge',       type: 'desk',     x: L.forgeDesk.x,       y: L.forgeDesk.y       });
    f.push({ id: 'trash-forge',      type: 'trashCan', x: L.forgeDesk.x + 45,  y: L.forgeDesk.y + 20  });
    // Branch signs on walls (default positions — movable/editable)
    var topWall = getRenderedWallSections()[0];
    var defaultBranches = getBranchList().filter(function(b) { return b.id !== 'UNASSIGNED'; });
    for (var _si = 0; _si < defaultBranches.length; _si++) {
        var frac = (_si + 1) / (defaultBranches.length + 1);
        f.push({ id: 'sign-' + defaultBranches[_si].id.toLowerCase(), type: 'branchSign', x: topWall.x + topWall.w * frac, y: 42, branchId: defaultBranches[_si].id });
    }
    // HQ interactive windows (north wall, flanking center)
    f.push({ id: "iw-hq-left",  type: "interactiveWindow", x: 388, y: 10, weather: true, showSun: true });
    f.push({ id: "iw-hq-right", type: "interactiveWindow", x: 576, y: 10, weather: true, showSun: false });
    return f;
}

// --- COMPUTE INTERACTION SPOTS FROM FURNITURE CONFIG ---
// Updates LOCATIONS.interactions in-place so existing agent code keeps working.
// Window spots are wall-based (not furniture) and are left untouched.
function getInteractionSpots() {
    var inter = LOCATIONS.interactions;
    // Reset spots that are derived from furniture items
    inter.couchSeats    = [];
    inter.engCouchSeats = [];
    inter.windows       = [];
    inter.bookshelf     = null;
    inter.tvSpot        = null;
    inter.vendingMachine = null;
    inter.stoveOven     = null;
    inter.coffeeMaker   = null;
    inter.waterCooler   = null;
    inter.microwave     = null;
    inter.toaster       = null;
    inter.dartBoard     = null;
    inter.diningSeats   = [];
    inter.receptionDesk = null;
    inter.receptionDeskWork = null;

    officeConfig.furniture.forEach(function(item) {
        var fa = FURNITURE_ACTIONS[item.type];
        if (!fa) return;
        var typeAction = fa.action;
        var rot = item.rotation || 0;
        (fa.spots || []).forEach(function(spot) {
            var action = spot.action || typeAction;
            // Rotate spot offset around item origin
            var rdx = spot.dx, rdy = spot.dy;
            if (rot === 90)       { rdx = -spot.dy; rdy = spot.dx; }
            else if (rot === 180) { rdx = -spot.dx; rdy = -spot.dy; }
            else if (rot === 270) { rdx = spot.dy;  rdy = -spot.dx; }
            var ws = { x: item.x + rdx, y: item.y + rdy };
            if (spot.faceDir !== undefined) ws.faceDir = spot.faceDir;
            switch (action) {
                case 'sit':
                    if (item.type === 'lounge' || item.type === 'couch' || item.type === 'officeChair') inter.couchSeats.push(ws);
                    else if (item.type === 'engLounge') inter.engCouchSeats.push(ws);
                    break;
                case 'read':      inter.bookshelf     = ws; break;
                case 'watch':     inter.tvSpot        = ws; break;
                case 'vend':      inter.vendingMachine = ws; break;
                case 'cook':      inter.stoveOven     = ws; break;
                case 'coffee':    inter.coffeeMaker   = ws; break;
                case 'drink':     inter.waterCooler   = ws; break;
                case 'microwave': inter.microwave     = ws; break;
                case 'toast':     inter.toaster       = ws; break;
                case 'darts':     inter.dartBoard     = ws; break;
                case 'eat':       inter.diningSeats.push(ws); break;
                case 'gaze':      inter.windows.push(ws);  break;
                case 'greet':     inter.receptionDesk = ws; break;
                case 'work':      if (item.type === 'receptionDesk') inter.receptionDeskWork = ws; break;
            }
        });
    });
    _updatePongTablePos();
}

// --- INITIALIZE OFFICE CONFIG ---
// Populates furniture from defaults if empty, then syncs interaction spots.
function initOfficeConfig() {
    if (officeConfig.furniture.length === 0) {
        officeConfig.furniture = getDefaultFurniture();
    }
    // Migrate: ensure all furniture items have an id
    officeConfig.furniture.forEach(function(item, idx) {
        if (!item.id) item.id = 'migrated_' + item.type + '_' + idx;
    });
    getInteractionSpots();
    initPets();
}

// initOfficeConfig() called from VOBuildingEngine constructor

// Load server config (async — merges on arrival)
// _loadServerConfig() removed — config is external

// Migrate: ensure interior walls array exists
if (!officeConfig.walls.interior) officeConfig.walls.interior = [];
buildCollisionGrid();

// --- AGENT DEFINITIONS ---
// --- AGENT ROSTER (populated dynamically from /api/agents + saved officeConfig) ---
// Fallback roster used if /api/agents hasn't loaded yet
var AGENT_DEFS = [];

// Color palette for auto-assigning agent colors
var _AGENT_COLORS = ['#ffd700','#d32f2f','#1976d2','#388e3c','#f9a825','#e65100','#00897b','#7b1fa2','#6d4c41','#5c6bc0','#78909c','#4caf50','#00bcd4','#e91e90','#ff6d00','#795548','#607d8b','#9c27b0','#009688','#ff5722'];

function _buildAgentDefs(apiAgents) {
    // Build AGENT_DEFS from API response, merging with saved officeConfig.agents for overrides
    var savedAgents = (officeConfig && officeConfig.agents) || [];
    var savedMap = {};
    savedAgents.forEach(function(s) { savedMap[s.id] = s; });

    var defs = [];
    apiAgents.forEach(function(a, idx) {
        var saved = savedMap[a.id] || savedMap[a.statusKey] || {};
        defs.push({
            id: a.statusKey || a.id,
            statusKey: a.statusKey || a.id,
            name: saved.name || a.name || a.id,
            emoji: saved.emoji || a.emoji || '🤖',
            role: saved.role || a.role || '',
            branch: saved.branch || 'UNASSIGNED',
            color: saved.color || _AGENT_COLORS[idx % _AGENT_COLORS.length],
            gender: saved.gender || (idx % 2 === 0 ? 'M' : 'F'),
        });
    });
    return defs;
}

// Auto-assign desk positions for any number of agents
function _autoAssignDesks(agentDefs) {
    // Check for furniture desk assignments first
    var assigned = {};
    if (officeConfig && officeConfig.furniture) {
        officeConfig.furniture.forEach(function(f) {
            if (f.assignedTo && (f.type === 'desk' || f.type === 'bossDesk')) {
                assigned[f.assignedTo] = { x: f.x, y: f.y };
            }
        });
    }

    // For unassigned agents, generate grid positions
    var unassigned = agentDefs.filter(function(a) { return !assigned[a.id] && !assigned[a.statusKey]; });
    var gridStartX = 140, gridStartY = 200;
    var colSpacing = 160, rowSpacing = 120;
    var cols = Math.max(2, Math.ceil(Math.sqrt(unassigned.length)));

    unassigned.forEach(function(a, idx) {
        var col = idx % cols;
        var row = Math.floor(idx / cols);
        assigned[a.statusKey || a.id] = {
            x: gridStartX + col * colSpacing,
            y: gridStartY + row * rowSpacing
        };
    });

    // Apply to defs
    agentDefs.forEach(function(a) {
        var desk = assigned[a.id] || assigned[a.statusKey];
        if (desk) {
            a._autoDesk = desk;
        }
    });
}

// Fetch roster from server
var _rosterLoaded = false;
function _fetchRoster() { /* no-op: server calls removed from engine */ }

// --- AGENT APPEARANCE DEFAULTS ---
// Accepts either an agent object or (agentId, gender) for backward compatibility.
function getDefaultAppearance(agentOrId, gender) {
    const agentId = typeof agentOrId === 'string' ? agentOrId : agentOrId.id;
    const g = typeof agentOrId === 'string' ? gender : agentOrId.gender;
    // Generate deterministic appearance from agent ID (seeded pseudo-random)
    function _hashCode(s) { var h = 0; for (var i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0; return Math.abs(h); }
    var _h = _hashCode(agentId);
    var _skinTones = ['#ffcc80','#d4a574','#c68642','#e8b88a','#fddcb5','#f5d0b0','#8d5524','#c68642'];
    var _hairStyles = ['short','medium','long','curly','spiky','buzz','wavy'];
    var _hairColors = ['#1a1a1a','#333333','#5d4037','#616161','#bf360c','#dcc282','#ffd700','#263238'];
    var _deskItems = ['trophy','envelope','calendar','chart','plans','checklist','files','ruler','money','marker'];
    // Use saved config appearance if available
    if (officeConfig && officeConfig.agents) {
        var saved = officeConfig.agents.find(function(a) { return a.id === agentId || a.statusKey === agentId; });
        if (saved && saved.appearance) return saved.appearance;
    }
    return {
        skinTone: _skinTones[_h % _skinTones.length],
        hairStyle: g === 'F' ? _hairStyles[(_h >> 3) % 3 + 2] : _hairStyles[(_h >> 3) % _hairStyles.length],
        hairColor: _hairColors[(_h >> 5) % _hairColors.length],
        hairHighlight: null,
        eyebrowStyle: g === 'F' ? 'thin' : 'thick',
        eyeColor: '#212121',
        facialHair: null, facialHairColor: null,
        headwear: null, headwearColor: null,
        glasses: null, glassesColor: null,
        costume: null,
        heldItem: null,
        deskItem: _deskItems[(_h >> 8) % _deskItems.length]
    };
}

// --- HAIR DRAWING ---
function _drawHairByConfig(ctx, style, hairColor, hairHighlight) {
    const hc = hairColor || '#333333';
    const hl = hairHighlight || null;
    function _drawSideHair(y, h, w) {
        // Push the back/side hair slightly past the head edge so the silhouette
        // wraps the head instead of leaving tiny side gaps.
        const sideW = w || 5;
        ctx.fillRect(-15, y, sideW, h);
        ctx.fillRect(10, y, sideW, h);
    }
    switch (style) {
        case 'bald':
            break;
        case 'buzz':
            ctx.fillStyle = hc;
            ctx.fillRect(-13, -40, 26, 4);
            _drawSideHair(-38, 4, 4);
            break;
        case 'short':
            ctx.fillStyle = hc;
            ctx.fillRect(-14, -40, 28, 5);
            _drawSideHair(-36, 7);
            if (hl) { ctx.fillStyle = hl; ctx.fillRect(-6, -42, 4, 3); ctx.fillRect(2, -43, 4, 3); }
            break;
        case 'medium':
            ctx.fillStyle = hc;
            ctx.fillRect(-14, -40, 28, 4);
            _drawSideHair(-38, 9);
            if (hl) { ctx.fillStyle = hl; ctx.fillRect(-6, -43, 4, 3); ctx.fillRect(2, -44, 4, 3); }
            break;
        case 'long':
            ctx.fillStyle = hc;
            ctx.fillRect(-14, -42, 28, 6);
            _drawSideHair(-38, 15);
            if (hl) {
                ctx.fillStyle = hl;
                ctx.fillRect(-15, -38, 5, 12);
                ctx.fillRect(-8, -43, 16, 4);
            }
            break;
        case 'curly':
            ctx.fillStyle = hc;
            ctx.fillRect(-14, -42, 28, 6);
            _drawSideHair(-38, 7);
            ctx.fillStyle = hl || hc;
            ctx.fillRect(-10, -43, 4, 3); ctx.fillRect(0, -44, 4, 3); ctx.fillRect(7, -43, 4, 3);
            break;
        case 'wavy':
            ctx.fillStyle = hc;
            ctx.fillRect(-14, -42, 28, 6);
            _drawSideHair(-38, 9);
            ctx.fillStyle = hl || hc;
            ctx.fillRect(-8, -43, 4, 3); ctx.fillRect(4, -43, 4, 3);
            if (hl) { ctx.fillRect(-15, -28, 4, 4); ctx.fillRect(11, -26, 4, 4); }
            break;
        case 'bun':
            ctx.fillStyle = hc;
            ctx.fillRect(-14, -41, 28, 5);
            _drawSideHair(-38, 5);
            ctx.fillRect(-5, -46, 10, 6); ctx.fillRect(-4, -48, 8, 4);
            if (hl) { ctx.fillStyle = hl; ctx.fillRect(-3, -47, 6, 2); }
            break;
        case 'ponytail':
            ctx.fillStyle = hc;
            ctx.fillRect(-14, -41, 28, 5);
            _drawSideHair(-38, 7, 4);
            ctx.fillRect(12, -38, 4, 18); ctx.fillRect(13, -20, 3, 6);
            if (hl) { ctx.fillStyle = hl; ctx.fillRect(12, -38, 2, 12); }
            break;
        case 'spiky':
            // Three readable spikes for the spiky hair preset.
            ctx.fillStyle = hc;
            ctx.fillRect(-14, -41, 28, 5);            // main hair volume
            ctx.fillRect(-15, -38, 30, 2);            // lower edge/back wrap
            ctx.fillRect(-8, -45, 4, 4);              // left spike
            ctx.fillRect(-1, -47, 4, 6);              // center spike
            ctx.fillRect(6, -45, 4, 4);               // right spike
            ctx.fillStyle = hl || _lighten(hc, 0.2);  // subtle highlight
            ctx.fillRect(-6, -41, 12, 2);
            break;
        case 'mohawk':
            // Tall center strip only
            ctx.fillStyle = hc;
            ctx.fillRect(-12, -40, 24, 2);            // thin base
            ctx.fillRect(-3, -50, 6, 12);             // tall center strip
            if (hl) { ctx.fillStyle = hl; ctx.fillRect(-1, -50, 4, 8); }
            break;
        default:
            ctx.fillStyle = hc;
            ctx.fillRect(-14, -40, 28, 5);
            _drawSideHair(-36, 9);
            break;
    }
}

// --- COSTUME DRAWING (cached to offscreen canvas) ---
var _costumeCache = {};
function _drawCostume(ctx, costume) {
    if (!costume) return;
    var key = costume;
    if (!_costumeCache[key]) {
        var oc = document.createElement('canvas');
        oc.width = 80; oc.height = 80;
        var c2 = oc.getContext('2d');
        c2.translate(40, 60);
        _drawCostumeDirect(c2, costume);
        _costumeCache[key] = oc;
    }
    ctx.drawImage(_costumeCache[key], -40, -60, 80, 80);
}
function _drawCostumeDirect(ctx, costume) {
    switch (costume) {
        case 'lobster': {
            var lc = '#d32f2f', ld = '#a51c1c', ll = '#e05555';
            // Hood body
            ctx.fillStyle = lc;
            ctx.fillRect(-16, -46, 32, 12);
            ctx.fillRect(-18, -42, 36, 6);
            ctx.fillStyle = ld;
            ctx.fillRect(-16, -36, 32, 2);
            // Cheek flaps
            ctx.fillStyle = lc;
            ctx.fillRect(-18, -36, 5, 8);
            ctx.fillRect(13, -36, 5, 8);
            ctx.fillStyle = ld;
            ctx.fillRect(-18, -28, 5, 2);
            ctx.fillRect(13, -28, 5, 2);
            // Antennae
            ctx.fillStyle = lc;
            ctx.fillRect(-8, -52, 2, 6);
            ctx.fillRect(6, -52, 2, 6);
            ctx.fillStyle = ll;
            ctx.fillRect(-10, -54, 3, 3);
            ctx.fillRect(7, -54, 3, 3);
            // Claws
            ctx.fillStyle = lc;
            ctx.fillRect(-14, -50, 5, 4);
            ctx.fillRect(9, -50, 5, 4);
            ctx.fillStyle = ld;
            ctx.fillRect(-16, -52, 3, 3);
            ctx.fillRect(-14, -52, 3, 3);
            ctx.fillRect(11, -52, 3, 3);
            ctx.fillRect(13, -52, 3, 3);
            // Hood eyes
            ctx.fillStyle = '#fff';
            ctx.fillRect(-6, -48, 4, 3);
            ctx.fillRect(2, -48, 4, 3);
            ctx.fillStyle = '#111';
            ctx.fillRect(-5, -47, 2, 2);
            ctx.fillRect(3, -47, 2, 2);
            break;
        }
        case 'chicken': {
            var cc = '#ffd54f', cd = '#e6bf3a';
            // Hood body
            ctx.fillStyle = cc;
            ctx.fillRect(-16, -46, 32, 12);
            ctx.fillRect(-18, -42, 36, 6);
            ctx.fillStyle = cd;
            ctx.fillRect(-16, -36, 32, 2);
            // Cheek flaps
            ctx.fillStyle = cc;
            ctx.fillRect(-18, -36, 5, 7);
            ctx.fillRect(13, -36, 5, 7);
            // Red comb
            ctx.fillStyle = '#e53935';
            ctx.fillRect(-4, -54, 3, 4);
            ctx.fillRect(-1, -56, 3, 6);
            ctx.fillRect(2, -53, 3, 3);
            ctx.fillStyle = '#c62828';
            ctx.fillRect(-4, -50, 9, 4);
            // Beak
            ctx.fillStyle = '#ff8f00';
            ctx.fillRect(-2, -43, 4, 3);
            ctx.fillStyle = '#ff6f00';
            ctx.fillRect(-1, -40, 3, 2);
            // Hood eyes
            ctx.fillStyle = '#fff';
            ctx.fillRect(-8, -47, 4, 3);
            ctx.fillRect(4, -47, 4, 3);
            ctx.fillStyle = '#111';
            ctx.fillRect(-7, -46, 2, 2);
            ctx.fillRect(5, -46, 2, 2);
            // Wattle
            ctx.fillStyle = '#e53935';
            ctx.fillRect(-1, -38, 2, 3);
            break;
        }
    }
}

// --- HEADWEAR DRAWING ---
function _drawHeadwear(ctx, headwear, color, isMoving) {
    if (!headwear) return;
    const c = color || '#888888';
    switch (headwear) {
        case 'hardhat':
            ctx.fillStyle = c; ctx.fillRect(-14, -42, 28, 4);
            ctx.fillStyle = _lighten(c, 0.15); ctx.fillRect(-10, -46, 20, 5);
            ctx.fillStyle = '#fff'; ctx.fillRect(-6, -44, 12, 2);
            break;
        case 'cap':
            ctx.fillStyle = c; ctx.fillRect(-10, -40, 20, 3);
            ctx.fillStyle = _darkenColor(c, 0.2); ctx.fillRect(-12, -40, 24, 2);
            break;
        case 'crown':
            ctx.fillStyle = c; ctx.fillRect(-9, -43, 18, 4);
            ctx.fillStyle = _lighten(c, 0.2);
            ctx.fillRect(-7, -47, 4, 4); ctx.fillRect(-1, -48, 4, 5); ctx.fillRect(5, -47, 4, 4);
            ctx.fillStyle = '#e53935'; ctx.fillRect(-5, -44, 2, 2); ctx.fillRect(0, -45, 2, 2); ctx.fillRect(6, -44, 2, 2);
            break;
        case 'tiara':
            ctx.fillStyle = c; ctx.fillRect(-9, -44, 18, 2);
            ctx.fillStyle = _darkenColor(c, 0.2); ctx.fillRect(-7, -46, 3, 2); ctx.fillRect(4, -46, 3, 2);
            ctx.fillStyle = c; ctx.fillRect(-2, -47, 4, 3);
            ctx.fillStyle = '#ff6d00'; ctx.fillRect(-1, -46, 2, 2);
            break;
        case 'headband':
            ctx.fillStyle = c; ctx.fillRect(-12, -41, 24, 3);
            break;
        case 'goggles':
            ctx.fillStyle = c; ctx.fillRect(-10, -42, 20, 3);
            ctx.fillStyle = '#81d4fa'; ctx.fillRect(-8, -42, 7, 4);
            ctx.fillStyle = '#81d4fa'; ctx.fillRect(1, -42, 7, 4);
            ctx.fillStyle = '#37474f'; ctx.fillRect(-1, -42, 2, 4);
            ctx.fillStyle = '#263238'; ctx.fillRect(-9, -42, 1, 4); ctx.fillRect(8, -42, 1, 4);
            break;
        case 'headset':
            ctx.strokeStyle = color || '#333';
            ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.arc(0, -34, 14, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
            ctx.fillStyle = color || '#333';
            ctx.fillRect(-14, -30, 4, 6); ctx.fillRect(10, -30, 4, 6);
            ctx.strokeStyle = '#555'; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(-14, -27); ctx.lineTo(-16, -24); ctx.stroke();
            ctx.fillStyle = color || '#333'; ctx.fillRect(-18, -25, 3, 3);
            break;
        case 'beanie':
            ctx.fillStyle = c; ctx.fillRect(-13, -43, 26, 7);
            ctx.fillStyle = _darkenColor(c, 0.15); ctx.fillRect(-13, -41, 26, 2);
            ctx.fillStyle = _lighten(c, 0.2); ctx.fillRect(-6, -44, 12, 2);
            ctx.fillStyle = c; ctx.fillRect(-4, -47, 8, 4);
            break;


    }
}

// --- GLASSES DRAWING ---
function _drawGlasses(ctx, glasses, color, eyeShift) {
    if (!glasses) return;
    const c = color || '#333';
    const es = eyeShift || 0;
    switch (glasses) {
        case 'round':
            ctx.strokeStyle = c; ctx.lineWidth = 1;
            ctx.strokeRect(-7 + es, -32, 6, 4); ctx.strokeRect(3 + es, -32, 6, 4);
            ctx.beginPath(); ctx.moveTo(-1 + es, -30); ctx.lineTo(3 + es, -30); ctx.stroke();
            break;
        case 'square':
            ctx.strokeStyle = c; ctx.lineWidth = 1;
            ctx.strokeRect(-6 + es, -32, 5, 4); ctx.strokeRect(3 + es, -32, 5, 4);
            ctx.beginPath(); ctx.moveTo(-1 + es, -30); ctx.lineTo(3 + es, -30); ctx.stroke();
            break;
        case 'sunglasses':
            ctx.fillStyle = 'rgba(0,0,0,0.7)';
            ctx.fillRect(-7 + es, -32, 6, 4); ctx.fillRect(3 + es, -32, 6, 4);
            ctx.fillStyle = c;
            ctx.fillRect(-8 + es, -33, 7, 1); ctx.fillRect(2 + es, -33, 7, 1);
            ctx.fillRect(-1 + es, -31, 2, 1);
            break;
    }
}

// --- HELD ITEM DRAWING ---
function _drawHeldItem(ctx, item, isMoving) {
    if (!item || isMoving) return;
    const ix = 13, iy = -18;
    switch (item) {
        case 'tablet':
            ctx.fillStyle = '#263238'; ctx.fillRect(ix - 1, iy, 7, 10);
            ctx.fillStyle = '#4fc3f7'; ctx.fillRect(ix, iy + 1, 5, 7);
            ctx.fillStyle = '#81d4fa'; ctx.fillRect(ix + 1, iy + 3, 3, 2);
            break;
        case 'wrench':
            ctx.fillStyle = '#90a4ae'; ctx.fillRect(ix, iy + 2, 2, 8);
            ctx.fillStyle = '#b0bec5'; ctx.fillRect(ix - 1, iy, 4, 3);
            ctx.fillStyle = '#78909c'; ctx.fillRect(ix, iy + 1, 2, 1);
            break;
        case 'clipboard':
            ctx.fillStyle = '#795548'; ctx.fillRect(ix - 1, iy, 7, 9);
            ctx.fillStyle = '#fff'; ctx.fillRect(ix, iy + 1, 5, 6);
            ctx.fillStyle = '#795548'; ctx.fillRect(ix + 1, iy, 3, 2);
            ctx.fillStyle = '#aaa'; ctx.fillRect(ix + 1, iy + 2, 3, 1); ctx.fillRect(ix + 1, iy + 4, 3, 1);
            break;
        case 'pen':
            ctx.fillStyle = '#f44336'; ctx.fillRect(-14, iy + 2, 2, 8);
            ctx.fillStyle = '#fff'; ctx.fillRect(-14, iy + 2, 2, 2);
            break;
        case 'hammer':
            ctx.fillStyle = '#8d6e63'; ctx.fillRect(ix, iy + 2, 2, 9);
            ctx.fillStyle = '#78909c'; ctx.fillRect(ix - 2, iy, 6, 4);
            ctx.fillStyle = '#546e7a'; ctx.fillRect(ix - 1, iy + 1, 4, 2);
            break;
        case 'testTube':
            ctx.fillStyle = '#81d4fa'; ctx.fillRect(ix, iy + 1, 3, 9);
            ctx.fillStyle = '#4caf50'; ctx.fillRect(ix, iy + 5, 3, 5);
            ctx.fillStyle = '#b0bec5'; ctx.fillRect(ix - 1, iy, 5, 2);
            break;
        case 'coffee':
            ctx.fillStyle = '#fff'; ctx.fillRect(ix - 1, iy + 1, 8, 9);
            ctx.fillStyle = '#6d4c41'; ctx.fillRect(ix, iy + 2, 6, 5);
            ctx.fillStyle = '#fff'; ctx.fillRect(ix + 6, iy + 3, 3, 3);
            break;
        case 'book':
            ctx.fillStyle = '#1565c0'; ctx.fillRect(ix - 1, iy, 8, 11);
            ctx.fillStyle = '#1976d2'; ctx.fillRect(ix, iy + 1, 6, 9);
            ctx.fillStyle = '#fff'; ctx.fillRect(ix + 1, iy + 2, 4, 1); ctx.fillRect(ix + 1, iy + 4, 3, 1);
            break;
    }
}

// --- FACIAL HAIR DRAWING ---
function _drawFacialHair(ctx, facialHair, facialHairColor) {
    if (!facialHair) return;
    const c = facialHairColor || '#3e2723';
    switch (facialHair) {
        case 'stubble':
            // Scattered small dots on jaw area
            ctx.fillStyle = c;
            ctx.fillRect(-4, -24, 2, 1); ctx.fillRect(0, -24, 2, 1); ctx.fillRect(3, -24, 2, 1);
            ctx.fillRect(-3, -25, 1, 1); ctx.fillRect(2, -25, 1, 1);
            break;
        case 'beard':
            // Filled rectangle covering lower jaw
            ctx.fillStyle = c;
            ctx.fillRect(-4, -25, 8, 4);
            break;
        case 'goatee':
            // Small chin patch
            ctx.fillStyle = c;
            ctx.fillRect(-2, -24, 4, 3);
            break;
        case 'mustache':
            // Line above mouth
            ctx.fillStyle = c;
            ctx.fillRect(-3, -26, 6, 1);
            break;
    }
}

// --- COLOR HELPERS ---
function _lighten(hex, amt) {
    let r = parseInt(hex.slice(1, 3), 16);
    let g = parseInt(hex.slice(3, 5), 16);
    let b = parseInt(hex.slice(5, 7), 16);
    r = Math.min(255, Math.floor(r + (255 - r) * amt));
    g = Math.min(255, Math.floor(g + (255 - g) * amt));
    b = Math.min(255, Math.floor(b + (255 - b) * amt));
    return '#' + [r,g,b].map(v => v.toString(16).padStart(2,'0')).join('');
}
function _lightenColor(hex, pct) {
    var r = parseInt(hex.slice(1,3), 16), g = parseInt(hex.slice(3,5), 16), b = parseInt(hex.slice(5,7), 16);
    r = Math.min(255, r + Math.round((255 - r) * pct / 100));
    g = Math.min(255, g + Math.round((255 - g) * pct / 100));
    b = Math.min(255, b + Math.round((255 - b) * pct / 100));
    return '#' + [r,g,b].map(function(v){ return v.toString(16).padStart(2,'0'); }).join('');
}
function _darkenColor(hex, amt) {
    let r = parseInt(hex.slice(1, 3), 16);
    let g = parseInt(hex.slice(3, 5), 16);
    let b = parseInt(hex.slice(5, 7), 16);
    r = Math.floor(r * (1 - amt)); g = Math.floor(g * (1 - amt)); b = Math.floor(b * (1 - amt));
    return '#' + [r,g,b].map(v => v.toString(16).padStart(2,'0')).join('');
}
function _hexToRgb(hex) {
    let r = parseInt(hex.slice(1, 3), 16);
    let g = parseInt(hex.slice(3, 5), 16);
    let b = parseInt(hex.slice(5, 7), 16);
    return { r, g, b };
}

// --- AGENT CLASS ---

class Agent {
    constructor(def) {
        Object.assign(this, def);
        // Default appearance if not provided by def
        if (!this.appearance) {
            this.appearance = getDefaultAppearance(this);
        }
        // Desk assignment: prefer auto-assigned desk, then named desk types, then branch desks
        if (this._autoDesk) {
            this.desk = this._autoDesk;
        } else if (this.deskType === 'boss' && LOCATIONS.bossDesk) {
            this.desk = LOCATIONS.bossDesk;
        } else if (this.deskType === 'center' && LOCATIONS.centerDesk) {
            this.desk = LOCATIONS.centerDesk;
        } else if (this.deskType === 'center2' && LOCATIONS.centerDesk2) {
            this.desk = LOCATIONS.centerDesk2;
        } else if (this.deskType === 'center3' && LOCATIONS.centerDesk3) {
            this.desk = LOCATIONS.centerDesk3;
        } else if (this.deskType === 'forge' && LOCATIONS.forgeDesk) {
            this.desk = LOCATIONS.forgeDesk;
        } else if (this.branch === 'PQ' && LOCATIONS.pqDesks && LOCATIONS.pqDesks[this.deskIdx]) {
            this.desk = LOCATIONS.pqDesks[this.deskIdx];
        } else if (LOCATIONS.engDesks && LOCATIONS.engDesks[this.deskIdx]) {
            this.desk = LOCATIONS.engDesks[this.deskIdx];
        } else {
            // Fallback: center of canvas
            this.desk = { x: Math.floor(W / 2), y: Math.floor(H / 2) };
        }

        this.x = this.desk.x;
        this.y = this.desk.y;
        this.targetX = this.x;
        this.targetY = this.y;
        this.state = 'idle';
        this.task = '';
        this.thought = '';
        this.speech = '';
        this.speechTarget = '';
        this.thoughtChars = 0;
        this.speechChars = 0;
        this.thoughtAge = 0;
        this.speechAge = 0;
        this.lastThought = '';
        this.lastSpeech = '';
        this.lastSpeechTarget = '';
        this.faceDir = (this.desk && this.desk.x > W / 2) ? -1 : 1;
        this.tick = Math.floor(Math.random() * 1000);
        this.blinkTimer = 0;
        this.talkTimer = 0;
        this.isSitting = true;
        this.speed = 1.2 + Math.random() * 0.6;
        this.intentHistory = ['System initialized.'];
        this.logHistory = [`[${timeStr()}] Boot sequence complete.`];

        // --- Autonomous behavior ---
        this.idleTimer = 0;
        this.idleAction = null;
        this.idleReturnTimer = 0;
        this.resetIdleTimer();

        // --- Carry item system ---
        this.carryItem = null;        // 'coffee', 'water', 'snack'
        this.snackType = null;        // 'candy', 'chips', 'cookies', 'chocolate'
        this.foodType = null;         // 'sandwich', 'popcorn', 'pizza'
        this.foodSource = null;       // 'microwave' | 'toaster'
        this.carryItemTimer = 0;     // ticks to show item at desk
        this.idleFaceDir = null;     // forced face dir during idle action
        this.interactTimer = 0;      // animation ticks at interaction spot

        // --- Break room browsing ---
        this.breakPhase = 0;         // 0=entering, 1+=browsing items, final=using
        this.breakStops = 0;         // items checked so far
        this.breakMaxStops = 0;      // how many to check before deciding
        this.breakChoice = null;     // final: 'snack','coffee','water'
        this.breakPauseTimer = 0;    // ticks to pause at each browse spot

        // --- Desk idle variety (each agent has unique offset) ---
        this.deskIdlePose = 0; // 0=scratch head, 1=yawn (yawn is rare)
        this.deskIdleTimer = 300 + Math.floor(Math.random() * 900); // randomized per agent

        // --- Social proximity ---
        this.socialTarget = null;    // id of nearby agent to face

        // --- Meeting state ---
        this.meetingId = null;
        this.meetingSlot = null;
        this.visitTarget = null;

        // --- Notification / Task I/O ---
        this.notify = false;          // pulsing notification light
        this.lastInput = null;        // { from: 'Agent Alpha', text: '...' }
        this.lastOutput = null;       // { text: '...' }

        // --- Pathfinding ---
        this._path = null;
        this._prevTargetX = undefined;
        this._prevTargetY = undefined;
    }

    resetIdleTimer() {
        // 15-45 seconds at 60fps = 900-2700 ticks
        this.idleTimer = 3600 + Math.floor(Math.random() * 3600); // 1-2 min at 60fps
    }

    getAppearance() {
        // Check for per-agent config override (used by the appearance panel)
        const cfg = officeConfig.agents && officeConfig.agents.find(a => a.id === this.id);
        if (cfg && cfg.appearance) return cfg.appearance;
        // Use the pre-computed instance appearance (set in constructor)
        return this.appearance || getDefaultAppearance(this);
    }

    update() {
        // Safety: ensure desk reference is never null
        if (!this.desk) this.desk = { x: Math.floor(W / 2), y: Math.floor(H / 2) };
        this.tick++;
        // --- PATH FOLLOWING: recompute when target changes ---
        if (this._prevTargetX === undefined) { this._prevTargetX = this.targetX; this._prevTargetY = this.targetY; this._path = null; }
        if (this.targetX !== this._prevTargetX || this.targetY !== this._prevTargetY) {
            this._prevTargetX = this.targetX;
            this._prevTargetY = this.targetY;
            if (collisionGrid && officeConfig.walls.interior && officeConfig.walls.interior.length > 0) {
                var _fp = findPath(this.x, this.y, this.targetX, this.targetY);
                this._path = (_fp && _fp.length > 0) ? _fp : null;
            } else {
                this._path = null;
            }
        }
        // Advance path: skip waypoints we've passed
        if (this._path && this._path.length > 0) {
            var _wp = this._path[0];
            if (Math.abs(_wp.x - this.x) < this.speed * 2 && Math.abs(_wp.y - this.y) < this.speed * 2) {
                this._path.shift();
            }
        }
        // Effective target: next waypoint or final target
        var _etX = this.targetX, _etY = this.targetY;
        if (this._path && this._path.length > 0) {
            _etX = this._path[0].x;
            _etY = this._path[0].y;
        }
        const dx = _etX - this.x;
        const dy = _etY - this.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist > this.speed) {
            let moveX = (dx / dist) * this.speed;
            let moveY = (dy / dist) * this.speed;
            // --- COLLISION: steer around nearby agents while walking ---
            if (COLLISION_ENABLED) {
                for (let i = 0; i < agents.length; i++) {
                    const other = agents[i];
                    if (other.id === this.id) continue;
                    const ox = this.x - other.x, oy = this.y - other.y;
                    const oDist = Math.sqrt(ox * ox + oy * oy);
                    if (oDist < COLLISION_RADIUS * 2 && oDist > 0.1) {
                        const force = COLLISION_PUSH * (1 - oDist / (COLLISION_RADIUS * 2));
                        moveX += (ox / oDist) * force;
                        moveY += (oy / oDist) * force;
                    }
                }
            }

            // --- STUCK DETECTION: if barely moving for too long, maneuver around ---
            var prevX = this.x, prevY = this.y;
            this.x += moveX;
            this.y += moveY;
            // Clamp: don't walk into the top wall zone
            if (this.y < 20) this.y = 20;
            var actualMove = Math.sqrt((this.x - prevX) * (this.x - prevX) + (this.y - prevY) * (this.y - prevY));
            if (!this._stuckTicks) this._stuckTicks = 0;
            if (!this._detourAngle) this._detourAngle = 0;

            if (actualMove < this.speed * 0.3 && dist > 10) {
                // Barely moving — agent is stuck
                this._stuckTicks++;
                if (this._stuckTicks > 30) {
                    // Try perpendicular detour (alternate left/right)
                    if (this._stuckTicks === 31) {
                        this._detourAngle = (Math.random() > 0.5 ? 1 : -1) * (Math.PI / 2);
                    }
                    var detourX = Math.cos(Math.atan2(dy, dx) + this._detourAngle) * this.speed * 1.5;
                    var detourY = Math.sin(Math.atan2(dy, dx) + this._detourAngle) * this.speed * 1.5;
                    this.x += detourX;
                    this.y += detourY;
                }
                // If stuck way too long, give up and pick a new action
                if (this._stuckTicks > 120) {
                    this._stuckTicks = 0;
                    this._detourAngle = 0;
                    if (this.idleAction && this.state === 'idle') {
                        // Abort current idle action — go back to desk or pick something else
                        this.idleAction = null;
                        this.breakPhase = null;
                        this.breakStops = 0;
                        this.interactTimer = 0;
                        this.targetX = this.desk.x;
                        this.targetY = this.desk.y;
                        this.addLog('Gave up — path blocked, heading back');
                    }
                }
            } else {
                this._stuckTicks = 0;
                this._detourAngle = 0;
            }

            this.isSitting = false;
            if (Math.abs(dx) > 0.5) this.faceDir = dx > 0 ? 1 : -1;
        } else {
            if (this._path && this._path.length > 0) {
                // Reached a waypoint - advance
                this.x = _etX;
                this.y = _etY;
                this._path.shift();
                if (this._path.length === 0) {
                    this._path = null;
                    this.x = this.targetX;
                    this.y = this.targetY;
                    this.onArrive();
                }
            } else {
                if (this.x !== this.targetX || this.y !== this.targetY) {
                    this.x = this.targetX;
                    this.y = this.targetY;
                    this.onArrive();
                }
            }
        }

        // --- COLLISION: static separation (push apart when standing too close) ---
        if (COLLISION_ENABLED && !this.isSitting) {
            for (let i = 0; i < agents.length; i++) {
                const other = agents[i];
                if (other.id === this.id || other.isSitting) continue;
                const ox = this.x - other.x, oy = this.y - other.y;
                const oDist = Math.sqrt(ox * ox + oy * oy);
                if (oDist < COLLISION_RADIUS && oDist > 0.1) {
                    // Strong push — guaranteed separation
                    const push = 1.2 * (1 - oDist / COLLISION_RADIUS);
                    this.x += (ox / oDist) * push;
                    this.y += (oy / oDist) * push;
                } else if (oDist < COLLISION_RADIUS * 1.5 && oDist > 0.1) {
                    // Gentle nudge in buffer zone to prevent clumping
                    const nudge = 0.3 * (1 - oDist / (COLLISION_RADIUS * 1.5));
                    this.x += (ox / oDist) * nudge;
                    this.y += (oy / oDist) * nudge;
                }
            }
        }

        // --- Autonomous idle wandering ---
        if (this.state === 'idle' && !this.meetingId && !this.idleAction) {
            this.idleTimer--;
            if (this.idleTimer <= 0) {
                this.startIdleAction();
            }
            // Desk idle pose variety (per-agent random timing)
            if (this.isSitting) {
                this.deskIdleTimer--;
                if (this.deskIdleTimer <= 0) {
                    // Pick a different pose than current
                    // Yawn is rare (~15% chance), scratch head is default
                    const newPose = Math.random() < 0.15 ? 1 : 0;
                    this.deskIdlePose = newPose;
                    this.deskIdleTimer = 240 + Math.floor(Math.random() * 900); // 4-19s, wide spread
                }
            }
        }

        // --- Return from idle action ---
        if (this.idleAction && this.idleReturnTimer > 0) {
            this.idleReturnTimer--;
            if (this.idleReturnTimer <= 0) {
                this.returnToDesk();
            }
        }

        // --- Interaction animation timer ---
        if (this.idleAction) this.interactTimer++;
        else this.interactTimer = 0;

        // --- Carry item countdown at desk ---
        if (this.carryItemTimer > 0) {
            this.carryItemTimer--;
            if (this.carryItemTimer <= 0) {
                this.carryItem = null;
            }
        }

        // --- Break room browsing phase system ---
        if (this.idleAction === 'break_browse') {
            const atTarget = Math.abs(this.x - this.targetX) < 3 && Math.abs(this.y - this.targetY) < 3;
            if (atTarget) {
                if (this.breakPauseTimer > 0) {
                    this.breakPauseTimer--;
                } else {
                    const inter = LOCATIONS.interactions;
                    if (this.breakStops < this.breakMaxStops) {
                        // Pick a random item to go look at
                        const spots = [];
                        if (inter.vendingMachine) spots.push({ x: inter.vendingMachine.x, y: inter.vendingMachine.y, label: 'vending machine', item: 'snack' });
                        if (inter.coffeeMaker) spots.push({ x: inter.coffeeMaker.x, y: inter.coffeeMaker.y, label: 'coffee maker', item: 'coffee' });
                        if (inter.waterCooler) spots.push({ x: inter.waterCooler.x, y: inter.waterCooler.y, label: 'water cooler', item: 'water' });
                        if (inter.microwave) spots.push({ x: inter.microwave.x, y: inter.microwave.y, label: 'microwave', item: 'food' });
                        if (inter.toaster) spots.push({ x: inter.toaster.x, y: inter.toaster.y, label: 'toaster', item: 'food' });
                        if (inter.stoveOven) spots.push({ x: inter.stoveOven.x, y: inter.stoveOven.y, label: 'stove / oven', item: 'food' });
                        if (spots.length === 0) { this.returnToDesk(); return; }
                        // Wander to a spot they haven't been to yet (or random if revisiting)
                        const spot = spots[Math.floor(Math.random() * spots.length)];
                        this.targetX = spot.x + (Math.random() - 0.5) * 15;
                        this.targetY = spot.y + (Math.random() - 0.5) * 10;
                        this.breakChoice = spot.item; // tentative choice updates as they browse
                        this.breakStops++;
                        this.breakPauseTimer = 240 + Math.floor(Math.random() * 360); // 4-10s pause at each item
                        this.addIntent(`Checking out the ${spot.label}...`);
                    } else {
                        // Done browsing — commit to final choice and use the machine
                        const finalItems = ['snack', 'coffee', 'water', 'food'];
                        const choice = this.breakChoice || finalItems[Math.floor(Math.random() * finalItems.length)];
                        let target;
                        this.foodSource = null;
                        if (choice === 'snack') target = inter.vendingMachine;
                        else if (choice === 'coffee') target = inter.coffeeMaker;
                        else if (choice === 'food') {
                            var foodTargets = [];
                            if (inter.microwave) foodTargets.push({ source: 'microwave', spot: inter.microwave });
                            if (inter.toaster) foodTargets.push({ source: 'toaster', spot: inter.toaster });
                            if (inter.stoveOven) foodTargets.push({ source: 'stove', spot: inter.stoveOven });
                            if (foodTargets.length > 0) {
                                var pickedFood = foodTargets[Math.floor(Math.random() * foodTargets.length)];
                                this.foodSource = pickedFood.source;
                                target = pickedFood.spot;
                            }
                        } else target = inter.waterCooler;
                        if (!target) { this.returnToDesk(); return; }
                        // COLLISION: queue behind others at the machine
                        const qOff = getQueueOffset(target.x, target.y, this.id);
                        this.targetX = target.x + qOff.x;
                        this.targetY = target.y + qOff.y;
                        this.idleFaceDir = -1;
                        this.idleAction = choice === 'snack' ? 'get_snack' : choice === 'coffee' ? 'make_coffee' : choice === 'food' ? 'make_food' : 'get_water';
                        this.interactTimer = 0;
                        const labels = { snack: 'a snack', coffee: 'coffee', water: 'water', food: 'something to eat' };
                        this.idleReturnTimer = 600 + Math.floor(Math.random() * 800); // 10-24s at the machine
                        this.addIntent(`Decided on ${labels[choice]}!`);
                    }
                }
            }
        }

        // --- Face meeting partner in 1:1 ---
        if (this.visitTarget) {
            const target = agentMap[this.visitTarget];
            if (target) {
                const atTarget = Math.abs(this.x - this.targetX) < 3 && Math.abs(this.y - this.targetY) < 3;
                if (atTarget) {
                    this.faceDir = target.x > this.x ? 1 : -1;
                }
            }
        }

        // --- Social proximity: face nearby agents in social areas ---
        const isMovingNow = Math.abs(this.targetX - this.x) > this.speed || Math.abs(this.targetY - this.y) > this.speed;
        const _socialActions = ['couch', 'lounge', 'watch_tv', 'break_browse', 'wander', 'visit', 'gathering', 'darts'];
        const _inSocialArea = !isMovingNow && this.idleAction && _socialActions.includes(this.idleAction);
        const _idleAtDesk = !isMovingNow && this.state === 'idle' && !this.idleAction && this.isSitting;
        if (_inSocialArea || _idleAtDesk) {
            let closest = null, closestDist = 60; // within 60px
            for (let oi = 0; oi < agents.length; oi++) {
                const other = agents[oi];
                if (other.id === this.id) continue;
                // Other agent must be in social area, visiting, or idle at desk
                const otherSocial = other.idleAction && _socialActions.includes(other.idleAction);
                const otherIdleDesk = other.state === 'idle' && !other.idleAction && other.isSitting;
                if (!otherSocial && !otherIdleDesk && other.state !== 'break') continue;
                const dx = other.x - this.x, dy = other.y - this.y;
                const d = Math.sqrt(dx * dx + dy * dy);
                if (d < closestDist) { closest = other; closestDist = d; }
            }
            if (closest) {
                this.socialTarget = closest.id;
                this.faceDir = closest.x > this.x ? 1 : -1;
                // Trigger talk animation when near someone
                if (this.talkTimer === 0 && Math.random() < 0.02) {
                    this.talkTimer = 40 + Math.random() * 80;
                }
            } else {
                this.socialTarget = null;
            }
        } else if (!this.visitTarget) {
            this.socialTarget = null;
        }

        // Talking animation in social/meeting areas
        if (['lounge', 'meeting', 'break', 'visiting'].includes(this.state) || ['visit', 'couch', 'watch_tv', 'lounge'].includes(this.idleAction)) {
            if (this.talkTimer === 0 && Math.random() < 0.012) {
                this.talkTimer = 30 + Math.random() * 60;
            } else if (this.talkTimer > 0) this.talkTimer--;
        } else this.talkTimer = 0;

        // Random work logs
        if (this.state === 'working' && Math.random() < 0.003) {
            const tasks = this.getWorkTasks();
            this.addLog(tasks[Math.floor(Math.random() * tasks.length)]);
        }

        // Blinking
        if (this.blinkTimer > 0) this.blinkTimer--;
        else if (Math.random() < 0.008) this.blinkTimer = 8;

        // Bubble age
        if (this.thought) this.thoughtAge++;
        if (this.speech) this.speechAge++;
    }

    startIdleAction() {
        const roll = Math.random();
        const inter = LOCATIONS.interactions;
        this.interactTimer = 0;

        if (roll < 0.05 && inter.engCouchSeats && inter.engCouchSeats.length > 0) {
            // Sit on ENG lounge couch — find an open seat
            const engSeat = findOpenSpot(inter.engCouchSeats, this.id);
            if (!engSeat) { this.resetIdleTimer(); return; }
            this.targetX = engSeat.x;
            this.targetY = engSeat.y;
            this.idleFaceDir = engSeat.faceDir;
            this.idleAction = 'couch';
            this.idleReturnTimer = 1200 + Math.floor(Math.random() * 2400);
            this.addIntent('Relaxing on the ENG couch');
        } else if (roll < 0.15 && inter.couchSeats && inter.couchSeats.length > 0) {
            // Sit on the lounge couch — find an open seat
            const seat = findOpenSpot(inter.couchSeats, this.id);
            if (!seat) { this.resetIdleTimer(); return; }
            this.targetX = seat.x;
            this.targetY = seat.y;
            this.idleFaceDir = seat.faceDir;
            this.idleAction = 'couch';
            this.idleReturnTimer = 1200 + Math.floor(Math.random() * 2400); // 20-60s
            this.addIntent('Relaxing on the couch');
        } else if (roll < 0.17 && inter.bookshelf) {
            // Read a book from the bookshelf
            const bsX = inter.bookshelf.x + (Math.random() - 0.5) * 10;
            const bsY = inter.bookshelf.y;
            if (isSpotOccupied(bsX, bsY, this.id)) { this.resetIdleTimer(); return; }
            this.targetX = bsX;
            this.targetY = bsY;
            this.idleFaceDir = -1;
            this.idleAction = 'read_book';
            this.idleReturnTimer = 1000 + Math.floor(Math.random() * 2000); // 16-50s
            this.addIntent('Grabbing a book to read');
        } else if (roll < 0.25) {
            // Look out the window — find open one
            const win = findOpenSpot(inter.windows, this.id);
            if (!win) { this.resetIdleTimer(); return; }
            this.targetX = win.x;
            this.targetY = win.y;
            this.idleFaceDir = 0; // special: face up
            this.idleAction = 'look_window';
            this.idleReturnTimer = 600 + Math.floor(Math.random() * 1200); // 10-30s
            this.addIntent('Looking out the window');
        } else if (roll < 0.49 && (inter.vendingMachine || inter.coffeeMaker || inter.waterCooler || inter.microwave || inter.toaster || inter.stoveOven)) {
            // Break room visit — browse first, then pick something
            // Enter the break room area (center of the room)
            const bx = 740, by = 490; // break area origin
            this.targetX = bx + 80 + (Math.random() - 0.5) * 40;
            this.targetY = by + 50 + (Math.random() - 0.5) * 30;
            this.idleAction = 'break_browse';
            this.breakPhase = 0;          // 0=entering, 1=looking around, 2+=visiting items, final=using item
            this.breakStops = 0;          // how many items they've looked at
            this.breakMaxStops = 1 + Math.floor(Math.random() * 3); // 1-3 items to check out
            this.breakChoice = null;      // final choice: 'snack', 'coffee', 'water'
            this.idleReturnTimer = 0;     // managed by phase system
            this.addIntent('Heading to the break room');
        } else if (roll < 0.56 && inter.tvSpot) {
            // Watch TV in the lounge
            if (isSpotOccupied(inter.tvSpot.x, inter.tvSpot.y, this.id)) { this.resetIdleTimer(); return; }
            this.targetX = inter.tvSpot.x;
            this.targetY = inter.tvSpot.y;
            this.idleFaceDir = inter.tvSpot.faceDir;
            this.idleAction = 'watch_tv';
            this.idleReturnTimer = 1000 + Math.floor(Math.random() * 1800); // 16-46s
            this.addIntent('Watching TV');
        } else if (roll < 0.70) {
            // Visit a neighbor
            const neighbors = agents.filter(a => a.id !== this.id && a.state !== 'meeting');
            if (neighbors.length > 0) {
                const sameBranch = neighbors.filter(a => a.branch === this.branch);
                const pool = sameBranch.length > 0 && Math.random() < 0.7 ? sameBranch : neighbors;
                const target = pool[Math.floor(Math.random() * pool.length)];
                this.targetX = target.desk.x + (target.desk.x > 500 ? 35 : -35);
                this.targetY = target.desk.y + 15;
                this.idleAction = 'visit';
                this.visitTarget = target.id;
                this.idleReturnTimer = 800 + Math.floor(Math.random() * 1600);
                this.addIntent(`Visiting ${target.name}`);
            } else {
                this.resetIdleTimer();
            }
        } else if (roll < 0.82) {
            // Wander the hallway — pick an open wander spot
            const wSpot = findOpenSpot(LOCATIONS.wanderSpots, this.id);
            if (!wSpot) { this.resetIdleTimer(); return; }
            this.targetX = wSpot.x + (Math.random() - 0.5) * 30;
            this.targetY = wSpot.y + (Math.random() - 0.5) * 20;
            this.idleAction = 'wander';
            this.idleReturnTimer = 600 + Math.floor(Math.random() * 1200);
            this.addIntent('Stretching legs');
        } else if (roll < 0.91) {
            // Stretch near desk
            this.targetX = this.desk.x + (Math.random() > 0.5 ? 30 : -30);
            this.targetY = this.desk.y + 20;
            this.idleAction = 'stretch';
            this.idleReturnTimer = 360 + Math.floor(Math.random() * 600);
            this.addIntent('Stretching at desk');
        } else if (roll < 0.93) {
            // Wander to ping pong table — max 2 waiting/playing at once
            var _pongBusy = agents.filter(function(a) { return a.idleAction === 'pong' || a.idleAction === 'pong_wait'; }).length;
            if (_pongBusy < 2 && pongGames.length === 0) {
                var ptx = PONG_TABLE.x + (Math.random() > 0.5 ? -50 : 50);
                var pty = PONG_TABLE.y + (Math.random() - 0.5) * 10;
                this.targetX = ptx;
                this.targetY = pty;
                this.idleAction = 'pong_wait';
                this.idleReturnTimer = 1800 + Math.floor(Math.random() * 1200);
                this.addIntent('Heading to the ping pong table');
            } else if (pongGames.length > 0) {
                // Watch the game as a spectator
                var _specSide = Math.random() > 0.5 ? 1 : -1;
                this.targetX = PONG_TABLE.x + _specSide * (30 + Math.floor(Math.random() * 30));
                this.targetY = PONG_TABLE.y + 30 + Math.floor(Math.random() * 20);
                this.idleAction = 'pong_spectator';
                this.idleReturnTimer = 600 + Math.floor(Math.random() * 1200);
                this.addIntent('Watching ping pong');
            } else {
                this.resetIdleTimer(); return;
            }
        } else {
            // Wander to a random spot in the office
            var wanderSpots = LOCATIONS.wanderSpots || [];
            if (wanderSpots.length > 0) {
                var ws = wanderSpots[Math.floor(Math.random() * wanderSpots.length)];
                this.targetX = ws.x + (Math.random() - 0.5) * 40;
                this.targetY = ws.y + (Math.random() - 0.5) * 30;
            } else {
                this.targetX = Math.floor(Math.random() * W * 0.6 + W * 0.2);
                this.targetY = Math.floor(Math.random() * H * 0.6 + H * 0.2);
            }
            this.idleAction = 'wander';
            this.idleReturnTimer = 600 + Math.floor(Math.random() * 1200);
            this.addIntent('Taking a walk');
        }
        this.isSitting = false;
    }

    returnToDesk() {
        // Safety: ensure desk exists
        if (!this.desk) this.desk = { x: Math.floor(W / 2), y: Math.floor(H / 2) };
        // Pick up item if leaving a dispenser
        if (this.idleAction === 'make_coffee') {
            this.carryItem = 'coffee';
            this.addIntent('Carrying coffee back to desk');
        } else if (this.idleAction === 'get_water') {
            this.carryItem = 'water';
            this.addIntent('Carrying water back to desk');
        } else if (this.idleAction === 'get_snack') {
            this.carryItem = 'snack';
            this.snackType = ['candy', 'chips', 'cookies', 'chocolate'][Math.floor(Math.random() * 4)];
            this.addIntent('Carrying ' + this.snackType + ' back to desk');
        } else if (this.idleAction === 'make_food') {
            this.carryItem = 'food';
            if (this.foodSource === 'toaster') {
                this.foodType = 'sandwich';
            } else if (this.foodSource === 'microwave') {
                this.foodType = ['popcorn', 'pizza'][Math.floor(Math.random() * 2)];
            } else if (this.foodSource === 'stove') {
                this.foodType = ['soup', 'pasta', 'eggs'][Math.floor(Math.random() * 3)];
            } else {
                this.foodType = 'sandwich';
            }
            this.addIntent('Carrying ' + this.foodType + ' back to desk');
        } else {
            this.addIntent('Returning to desk');
        }
        this.idleAction = null;
        this.idleFaceDir = null;
        this.interactTimer = 0;
        this.visitTarget = null;
        this.breakPhase = 0;
        this.breakStops = 0;
        this.breakChoice = null;
        this.breakPauseTimer = 0;
        this.targetX = this.desk.x;
        this.targetY = this.desk.y;
        this.resetIdleTimer();
    }

    getWorkTasks() {
        const base = ['Coffee sip.', 'Reviewing notes...', 'Checking inbox...'];
        // Branch-specific idle text is now generic — agents get varied text from their role
        if (this.role) {
            base.push('Working on ' + this.role.split(' ')[0].toLowerCase() + ' tasks...');
        }
        return [...base, 'Managing office...', 'Reviewing reports...', 'Coordinating teams...'];
    }

    onArrive() {
        const atDesk = Math.abs(this.x - this.desk.x) < 5 && Math.abs(this.y - this.desk.y) < 5;
        if (atDesk) {
            this.isSitting = true;
            if (!this.meetingId && !this.idleAction) {
                if (this.state !== 'working') this.state = this.task ? 'working' : 'idle';
            }
            this.faceDir = (this.desk && this.desk.x > W / 2) ? -1 : 1;
            if (this.deskType === 'boss') this.faceDir = 1;
            // Start consuming carried item at desk
            if (this.carryItem) {
                this.carryItemTimer = 1200 + Math.floor(Math.random() * 1200); // 20-40s
                this.addLog('Enjoying ' + this.carryItem + ' at desk');
            }
        } else {
            this.isSitting = false;
            // Check if spot is occupied by someone who got there first — redirect
            if (COLLISION_ENABLED && this.idleAction && this.idleAction !== 'wander' && this.idleAction !== 'visit' && this.idleAction !== 'stretch') {
                if (isSpotOccupied(this.x, this.y, this.id)) {
                    // Someone beat us here — go back or find alternative
                    this.idleAction = null;
                    this.breakPhase = null;
                    this.breakStops = 0;
                    this.interactTimer = 0;
                    this.targetX = this.desk.x;
                    this.targetY = this.desk.y;
                    this.addLog('Spot taken — heading back');
                    return;
                }
            }
            // Handle idle action arrival poses
            if (this.idleAction === 'couch' || this.idleAction === 'watch_tv') {
                this.isSitting = true;
                if (this.idleFaceDir !== null && this.idleFaceDir !== 0) this.faceDir = this.idleFaceDir;
            }
            if (this.idleFaceDir !== null && this.idleFaceDir !== 0) {
                this.faceDir = this.idleFaceDir;
            }
        }
    }

    moveTo(state) {
        // Clear idle action when explicitly moved
        if (this._gatheringId) leaveGathering(this.id);
        this.idleAction = null;
        this.visitTarget = null;
        this.idleReturnTimer = 0;

        const slotI = agents.indexOf(this);
        switch (state) {
            case 'working':
            case 'idle':
                this.meetingId = null;
                this.meetingSlot = null;
                this.targetX = this.desk.x;
                this.targetY = this.desk.y;
                this.state = state;
                this.resetIdleTimer();
                this.addIntent(state === 'working' ? 'Returning to desk' : 'Relaxing at desk');
                break;
            case 'meeting': {
                const m = getMeetingTablePos();
                if (m) {
                    const cols = 5, spacing = 35;
                    const row = Math.floor(slotI / cols);
                    const col = slotI % cols;
                    this.targetX = m.x + 20 + col * spacing;
                    this.targetY = m.y + 25 + row * 40;
                } else {
                    // No meeting table — meet at a random spot near the caller
                    this.targetX = this.x + (Math.random() - 0.5) * 100;
                    this.targetY = this.y + (Math.random() - 0.5) * 100;
                }
                this.state = 'meeting';
                this.addIntent('Joining meeting');
                break;
            }
            case 'lounge': {
                const lx = LOCATIONS.lounge.x;
                const ly = LOCATIONS.lounge.y;
                const slots = [
                    { x: 30, y: 15 }, { x: 30, y: 45 },
                    { x: 70, y: 80 }, { x: 100, y: 80 }, { x: 130, y: 80 },
                    { x: 60, y: 15 }, { x: 90, y: 15 }, { x: 160, y: 40 }, { x: 160, y: 70 }
                ];
                const s = slots[slotI % slots.length];
                this.targetX = lx + s.x;
                this.targetY = ly + s.y;
                this.state = 'lounge';
                this.addIntent('Heading to lounge');
                break;
            }
            case 'break': {
                const cx = LOCATIONS.cooler.x;
                const cy = LOCATIONS.cooler.y;
                const slots = [
                    { x: -40, y: -30 }, { x: 0, y: -30 }, { x: 40, y: -30 },
                    { x: -40, y: 0 }, { x: 0, y: 0 }, { x: 40, y: 0 },
                    { x: -20, y: 30 }, { x: 20, y: 30 }, { x: 0, y: -60 }
                ];
                const s = slots[slotI % slots.length];
                this.targetX = cx + s.x;
                this.targetY = cy + s.y;
                this.state = 'break';
                this.addIntent('On break');
                break;
            }
        }
    }

    // Join a meeting by ID — positions assigned by meeting system
    joinMeeting(meetingId, slot, topic) {
        this.idleAction = null;
        this.visitTarget = null;
        this.idleReturnTimer = 0;
        this.meetingId = meetingId;
        this.meetingSlot = slot;
        this.targetX = slot.x;
        this.targetY = slot.y;
        this.state = 'meeting';
        this.isSitting = false;
        this.addIntent(`Meeting: ${topic || 'discussion'}`);
    }

    // 1:1 visit to another agent's desk
    visitAgent(targetAgent, topic) {
        this.idleAction = null;
        this.idleReturnTimer = 0;
        this.visitTarget = targetAgent.id;
        this.state = 'visiting';
        // Stand beside the target's desk
        const side = targetAgent.desk.x > 500 ? 35 : -35;
        this.targetX = targetAgent.desk.x + side;
        this.targetY = targetAgent.desk.y + 15;
        this.isSitting = false;
        this.addIntent(`Discussing with ${targetAgent.name}: ${topic || ''}`);
    }

    leaveMeeting() {
        this.meetingId = null;
        this.meetingSlot = null;
        this.visitTarget = null;
        this.targetX = this.desk.x;
        this.targetY = this.desk.y;
        this.state = this.task ? 'working' : 'idle';
        this.resetIdleTimer();
        this.addIntent('Meeting ended, returning to desk');
    }

    addLog(msg) {
        this.logHistory.push(`[${timeStr()}] ${msg}`);
        if (this.logHistory.length > 50) this.logHistory.shift();
    }
    addIntent(msg) {
        this.intent = msg;
        this.intentHistory.push(`[${timeStr()}] ${msg}`);
        if (this.intentHistory.length > 30) this.intentHistory.shift();
    }

    // Draw a snack based on this.snackType at given x,y
    _drawSnack(ctx, sx, sy) {
        const t = this.snackType || 'candy';
        if (t === 'candy') {
            // Orange candy bar (original)
            ctx.fillStyle = '#ffc107'; ctx.fillRect(sx, sy, 10, 5);
            ctx.fillStyle = '#ff9800'; ctx.fillRect(sx + 1, sy + 1, 8, 3);
            ctx.fillStyle = '#ffe082'; ctx.fillRect(sx, sy - 1, 3, 2);
        } else if (t === 'chips') {
            // Big bag of chips (red bag)
            ctx.fillStyle = '#e53935'; ctx.fillRect(sx, sy - 1, 12, 9);
            ctx.fillStyle = '#ef5350'; ctx.fillRect(sx + 1, sy, 10, 7);
            // Crinkle top (open bag)
            ctx.fillStyle = '#c62828';
            ctx.fillRect(sx + 1, sy - 1, 2, 1); ctx.fillRect(sx + 4, sy - 2, 3, 1);
            ctx.fillRect(sx + 8, sy - 1, 2, 1);
            // Yellow label
            ctx.fillStyle = '#ffeb3b'; ctx.fillRect(sx + 2, sy + 1, 8, 3);
            // Brand stripe
            ctx.fillStyle = '#f44336'; ctx.fillRect(sx + 3, sy + 2, 6, 1);
            // Bottom fold
            ctx.fillStyle = '#b71c1c'; ctx.fillRect(sx + 1, sy + 6, 10, 1);
        } else if (t === 'cookies') {
            // Brown cookies with chocolate chips
            // First cookie
            ctx.fillStyle = '#a1887f'; ctx.fillRect(sx, sy + 1, 5, 5);
            ctx.fillStyle = '#8d6e63'; ctx.fillRect(sx + 1, sy + 2, 3, 3);
            // Choc chips on first cookie
            ctx.fillStyle = '#3e2723';
            ctx.fillRect(sx + 1, sy + 2, 1, 1);
            ctx.fillRect(sx + 3, sy + 3, 1, 1);
            ctx.fillRect(sx + 2, sy + 4, 1, 1);
            // Second cookie (overlapping)
            ctx.fillStyle = '#a1887f'; ctx.fillRect(sx + 4, sy, 5, 5);
            ctx.fillStyle = '#8d6e63'; ctx.fillRect(sx + 5, sy + 1, 3, 3);
            // Choc chips on second cookie
            ctx.fillStyle = '#3e2723';
            ctx.fillRect(sx + 5, sy + 1, 1, 1);
            ctx.fillRect(sx + 7, sy + 2, 1, 1);
            ctx.fillRect(sx + 6, sy + 3, 1, 1);
            // Third cookie peeking behind
            ctx.fillStyle = '#bcaaa4'; ctx.fillRect(sx + 2, sy - 1, 5, 2);
            ctx.fillStyle = '#3e2723'; ctx.fillRect(sx + 3, sy - 1, 1, 1);
            ctx.fillRect(sx + 5, sy, 1, 1);
        } else if (t === 'chocolate') {
            // Chocolate bar half-opened — wrapper + exposed chocolate
            // Purple wrapper (left half)
            ctx.fillStyle = '#6a1b9a'; ctx.fillRect(sx, sy, 6, 6);
            ctx.fillStyle = '#8e24aa'; ctx.fillRect(sx + 1, sy + 1, 4, 4);
            // Silver foil edge
            ctx.fillStyle = '#bdbdbd'; ctx.fillRect(sx + 5, sy, 2, 6);
            ctx.fillStyle = '#e0e0e0'; ctx.fillRect(sx + 5, sy + 1, 1, 4);
            // Exposed brown chocolate (right half)
            ctx.fillStyle = '#5d4037'; ctx.fillRect(sx + 7, sy, 6, 6);
            ctx.fillStyle = '#4e342e'; ctx.fillRect(sx + 8, sy + 1, 4, 4);
            // Chocolate segments (squares)
            ctx.fillStyle = '#3e2723';
            ctx.fillRect(sx + 8, sy + 1, 2, 2);
            ctx.fillRect(sx + 10, sy + 1, 2, 2);
            ctx.fillRect(sx + 8, sy + 3, 2, 2);
            ctx.fillRect(sx + 10, sy + 3, 2, 2);
            // Segment divider lines
            ctx.fillStyle = '#6d4c41';
            ctx.fillRect(sx + 10, sy + 1, 1, 4);
            ctx.fillRect(sx + 8, sy + 3, 4, 1);
        }
    }

    // Draw food based on this.foodType at given x,y
    _drawFood(ctx, fx, fy) {
        const t = this.foodType || 'sandwich';
        if (t === 'sandwich') {
            // Sandwich on a small plate
            ctx.fillStyle = '#e0e0e0'; ctx.fillRect(fx - 1, fy + 4, 14, 3); // plate
            // Bottom bread
            ctx.fillStyle = '#d4a056'; ctx.fillRect(fx, fy + 1, 12, 3);
            // Lettuce
            ctx.fillStyle = '#66bb6a'; ctx.fillRect(fx + 1, fy, 10, 2);
            // Meat/ham
            ctx.fillStyle = '#e57373'; ctx.fillRect(fx + 1, fy - 1, 10, 2);
            // Cheese
            ctx.fillStyle = '#ffd54f'; ctx.fillRect(fx + 2, fy - 2, 9, 2);
            // Top bread
            ctx.fillStyle = '#c68c3c'; ctx.fillRect(fx + 1, fy - 3, 10, 2);
            ctx.fillStyle = '#d4a056'; ctx.fillRect(fx + 2, fy - 4, 8, 2);
            // Sesame seeds
            ctx.fillStyle = '#fff'; ctx.fillRect(fx + 3, fy - 4, 1, 1);
            ctx.fillRect(fx + 6, fy - 4, 1, 1);
            ctx.fillRect(fx + 8, fy - 3, 1, 1);
        } else if (t === 'popcorn') {
            // Popcorn in a bowl
            // Red bowl
            ctx.fillStyle = '#e53935'; ctx.fillRect(fx, fy + 2, 11, 5);
            ctx.fillStyle = '#ef5350'; ctx.fillRect(fx + 1, fy + 3, 9, 3);
            // White stripe on bowl
            ctx.fillStyle = '#fff'; ctx.fillRect(fx + 1, fy + 4, 9, 1);
            // Popcorn puffs overflowing
            ctx.fillStyle = '#fff9c4';
            ctx.fillRect(fx + 1, fy - 1, 3, 3);
            ctx.fillRect(fx + 4, fy - 2, 3, 3);
            ctx.fillRect(fx + 7, fy - 1, 3, 3);
            ctx.fillRect(fx + 3, fy - 3, 2, 2);
            ctx.fillRect(fx + 6, fy - 3, 2, 2);
            // Butter shading
            ctx.fillStyle = '#ffe082';
            ctx.fillRect(fx + 2, fy, 1, 1);
            ctx.fillRect(fx + 5, fy - 1, 1, 1);
            ctx.fillRect(fx + 8, fy, 1, 1);
        } else if (t === 'pizza') {
            // Pizza slice on plate
            ctx.fillStyle = '#e0e0e0'; ctx.fillRect(fx - 1, fy + 4, 14, 3); // plate
            // Pizza triangle (crust to tip)
            ctx.fillStyle = '#ffc107'; ctx.fillRect(fx, fy + 1, 12, 4); // cheese base
            ctx.fillStyle = '#ff9800'; ctx.fillRect(fx + 1, fy + 2, 10, 2); // sauce
            // Crust (wide end)
            ctx.fillStyle = '#d4a056'; ctx.fillRect(fx, fy + 4, 12, 2);
            ctx.fillStyle = '#c68c3c'; ctx.fillRect(fx + 1, fy + 5, 10, 1);
            // Pepperoni
            ctx.fillStyle = '#c62828';
            ctx.fillRect(fx + 2, fy + 1, 2, 2);
            ctx.fillRect(fx + 6, fy + 2, 2, 2);
            ctx.fillRect(fx + 9, fy + 1, 2, 2);
            // Cheese melt drip
            ctx.fillStyle = '#ffecb3'; ctx.fillRect(fx + 4, fy, 1, 1);
            ctx.fillRect(fx + 8, fy, 1, 1);
            // Tip (narrow end)
            ctx.fillStyle = '#ffc107'; ctx.fillRect(fx + 5, fy - 1, 3, 2);
        }
    }

    // Unique character desk item — top-left corner of desk (~-32, -22)
    _drawDeskCharItem(ctx) {
        const ix = 20, iy = -22;
        switch (this.getAppearance().deskItem) {
            case 'trophy': // Gold star trophy
                ctx.fillStyle = '#ffd700'; ctx.fillRect(ix + 2, iy + 6, 4, 6); // base
                ctx.fillStyle = '#ffeb3b'; ctx.fillRect(ix + 1, iy + 4, 6, 3); // cup
                ctx.fillStyle = '#ffd700'; // star
                ctx.fillRect(ix + 2, iy, 4, 2); ctx.fillRect(ix + 1, iy + 2, 6, 2);
                ctx.fillRect(ix + 3, iy - 1, 2, 1);
                break;
            case 'wrench': // Mini wrench
                ctx.fillStyle = '#9e9e9e'; ctx.fillRect(ix, iy + 2, 2, 10); // handle
                ctx.fillStyle = '#bdbdbd'; ctx.fillRect(ix - 1, iy, 4, 3); // jaw
                ctx.fillStyle = '#757575'; ctx.fillRect(ix, iy + 1, 2, 1); // gap
                ctx.fillStyle = '#5d4037'; ctx.fillRect(ix, iy + 8, 2, 4); // grip
                break;
            case 'calendar': // Mini calendar page
                ctx.fillStyle = '#fff'; ctx.fillRect(ix, iy, 8, 10);
                ctx.fillStyle = '#e53935'; ctx.fillRect(ix, iy, 8, 3); // red header
                ctx.fillStyle = '#333'; ctx.font = '5px Arial'; ctx.textAlign = 'center';
                ctx.fillText('5', ix + 4, iy + 9); // day number
                ctx.font = '8px sans-serif'; // restore font
                break;
            case 'envelope': // Mini envelope
                ctx.fillStyle = '#e3f2fd'; ctx.fillRect(ix, iy + 2, 8, 6);
                ctx.fillStyle = '#1976d2'; // flap
                ctx.beginPath(); ctx.moveTo(ix, iy + 2); ctx.lineTo(ix + 4, iy + 5);
                ctx.lineTo(ix + 8, iy + 2); ctx.closePath(); ctx.fill();
                ctx.fillStyle = '#f44336'; ctx.fillRect(ix + 6, iy + 1, 2, 2); // red dot (new mail)
                break;
            case 'money': // Green cash money
                // Bottom bill
                ctx.fillStyle = '#2e7d32'; ctx.fillRect(ix, iy + 6, 8, 5);
                ctx.fillStyle = '#43a047'; ctx.fillRect(ix + 1, iy + 7, 6, 3);
                // Top bill (slightly offset)
                ctx.fillStyle = '#388e3c'; ctx.fillRect(ix + 1, iy + 3, 8, 5);
                ctx.fillStyle = '#4caf50'; ctx.fillRect(ix + 2, iy + 4, 6, 3);
                // $ symbol
                ctx.fillStyle = '#fff'; ctx.fillRect(ix + 4, iy + 4, 2, 1);
                ctx.fillRect(ix + 5, iy + 5, 1, 1);
                ctx.fillRect(ix + 4, iy + 6, 2, 1);
                break;
            case 'ruler': // Ruler
                // Ruler body (long yellow bar)
                ctx.fillStyle = '#ffc107'; ctx.fillRect(ix - 2, iy + 4, 16, 4);
                ctx.fillStyle = '#ffb300'; ctx.fillRect(ix - 2, iy + 4, 16, 1); // top edge
                // Tick marks along ruler
                ctx.fillStyle = '#333';
                for (let t = 0; t < 7; t++) {
                    const tx = ix - 1 + t * 2;
                    ctx.fillRect(tx, iy + 5, 1, t % 2 === 0 ? 2 : 1);
                }
                // Numbers (tiny dots as number placeholders)
                ctx.fillStyle = '#5d4037';
                ctx.fillRect(ix, iy + 7, 1, 1);
                ctx.fillRect(ix + 6, iy + 7, 1, 1);
                ctx.fillRect(ix + 12, iy + 7, 1, 1);
                break;
            case 'marker': // Red marker pen
                ctx.fillStyle = '#f44336'; ctx.fillRect(ix, iy + 2, 2, 8);
                ctx.fillStyle = '#d32f2f'; ctx.fillRect(ix, iy + 2, 2, 2);
                ctx.fillStyle = '#fff'; ctx.fillRect(ix, iy + 9, 2, 2); // tip
                break;
            case 'chart': // Mini bar chart
                ctx.fillStyle = '#7b1fa2'; ctx.fillRect(ix, iy + 6, 2, 5);
                ctx.fillStyle = '#9c27b0'; ctx.fillRect(ix + 3, iy + 3, 2, 8);
                ctx.fillStyle = '#ce93d8'; ctx.fillRect(ix + 6, iy + 5, 2, 6);
                // axis line
                ctx.fillStyle = '#333'; ctx.fillRect(ix - 1, iy + 11, 10, 1);
                break;
            case 'plans': // Rolled architectural plans
                // Large roll (laid horizontally)
                ctx.fillStyle = '#e3f2fd'; ctx.fillRect(ix - 2, iy + 5, 14, 4);
                ctx.fillStyle = '#bbdefb'; ctx.fillRect(ix - 2, iy + 5, 14, 1); // top highlight
                ctx.fillStyle = '#90caf9'; ctx.fillRect(ix - 2, iy + 8, 14, 1); // bottom shadow
                // Roll ends (circles as rectangles at pixel scale)
                ctx.fillStyle = '#fff'; ctx.fillRect(ix - 3, iy + 5, 2, 4);
                ctx.fillStyle = '#e0e0e0'; ctx.fillRect(ix - 3, iy + 5, 1, 4);
                ctx.fillStyle = '#fff'; ctx.fillRect(ix + 11, iy + 5, 2, 4);
                ctx.fillStyle = '#e0e0e0'; ctx.fillRect(ix + 12, iy + 5, 1, 4);
                // Rubber band
                ctx.fillStyle = '#8d6e63'; ctx.fillRect(ix + 3, iy + 5, 1, 4);
                ctx.fillRect(ix + 8, iy + 5, 1, 4);
                // Second smaller roll on top (slightly offset)
                ctx.fillStyle = '#d1c4e9'; ctx.fillRect(ix, iy + 2, 10, 3);
                ctx.fillStyle = '#b39ddb'; ctx.fillRect(ix, iy + 2, 10, 1);
                ctx.fillStyle = '#ede7f6'; ctx.fillRect(ix, iy + 4, 10, 1);
                // End caps on smaller roll
                ctx.fillStyle = '#fff'; ctx.fillRect(ix - 1, iy + 2, 2, 3);
                ctx.fillRect(ix + 9, iy + 2, 2, 3);
                break;
            case 'checklist': // Mini checklist
                ctx.fillStyle = '#fff'; ctx.fillRect(ix, iy + 1, 8, 10);
                ctx.fillStyle = '#795548'; ctx.fillRect(ix, iy, 8, 2); // clipboard top
                ctx.fillStyle = '#ffd700'; ctx.fillRect(ix + 2, iy, 4, 1); // clip
                ctx.fillStyle = '#00bcd4';
                ctx.fillRect(ix + 1, iy + 3, 2, 2); ctx.fillRect(ix + 1, iy + 6, 2, 2); // checkmarks
                ctx.fillStyle = '#999';
                ctx.fillRect(ix + 4, iy + 4, 3, 1); ctx.fillRect(ix + 4, iy + 7, 3, 1); // lines
                break;
            case 'microscope': // Mini microscope
                // Base
                ctx.fillStyle = '#37474f'; ctx.fillRect(ix, iy + 8, 10, 3);
                ctx.fillStyle = '#455a64'; ctx.fillRect(ix + 1, iy + 9, 8, 1);
                // Stand/pillar
                ctx.fillStyle = '#546e7a'; ctx.fillRect(ix + 4, iy + 2, 3, 7);
                // Eyepiece (top)
                ctx.fillStyle = '#4caf50'; ctx.fillRect(ix + 3, iy, 4, 3);
                ctx.fillStyle = '#66bb6a'; ctx.fillRect(ix + 4, iy + 1, 2, 1);
                // Lens arm (angled)
                ctx.fillStyle = '#546e7a'; ctx.fillRect(ix + 1, iy + 4, 4, 2);
                // Lens
                ctx.fillStyle = '#81d4fa'; ctx.fillRect(ix, iy + 5, 3, 2);
                // Stage/slide
                ctx.fillStyle = '#fff'; ctx.fillRect(ix + 1, iy + 7, 5, 1);
                break;
            case 'shield': // Mini emergency toolkit / shield
                // Shield shape
                ctx.fillStyle = '#e91e90'; ctx.fillRect(ix + 1, iy, 8, 8);
                ctx.fillStyle = '#f48fb1'; ctx.fillRect(ix + 2, iy + 1, 6, 6);
                // Shield point
                ctx.fillStyle = '#e91e90'; ctx.fillRect(ix + 3, iy + 8, 4, 2); ctx.fillRect(ix + 4, iy + 10, 2, 1);
                // Cross/plus on shield
                ctx.fillStyle = '#fff'; ctx.fillRect(ix + 4, iy + 2, 2, 5); ctx.fillRect(ix + 3, iy + 3, 4, 2);
                break;
            case 'phone': // Classic office desk phone
                // Phone base (wider, flatter)
                ctx.fillStyle = '#37474f'; ctx.fillRect(ix - 1, iy + 5, 14, 7);
                ctx.fillStyle = '#455a64'; ctx.fillRect(ix, iy + 6, 12, 5);
                // Number pad (3x3 grid of tiny buttons)
                ctx.fillStyle = '#78909c';
                for (let br = 0; br < 3; br++) for (let bc = 0; bc < 3; bc++)
                    ctx.fillRect(ix + 1 + bc * 3, iy + 6 + br * 2, 2, 1);
                // Handset cradle (two bumps on base)
                ctx.fillStyle = '#263238';
                ctx.fillRect(ix, iy + 5, 2, 2);
                ctx.fillRect(ix + 10, iy + 5, 2, 2);
                // Handset resting on cradle (the receiver)
                ctx.fillStyle = '#1a1a1a';
                ctx.fillRect(ix - 1, iy + 2, 3, 4); // earpiece (left)
                ctx.fillRect(ix + 10, iy + 2, 3, 4); // mouthpiece (right)
                ctx.fillStyle = '#2c2c2c';
                ctx.fillRect(ix + 1, iy + 3, 10, 2); // handle connecting them
                // Coiled cord
                ctx.fillStyle = '#546e7a';
                ctx.fillRect(ix + 12, iy + 8, 1, 1);
                ctx.fillRect(ix + 13, iy + 9, 1, 1);
                ctx.fillRect(ix + 12, iy + 10, 1, 1);
                break;
            case 'anvil': // Mini anvil
                // Anvil base (wide, dark)
                ctx.fillStyle = '#37474f'; ctx.fillRect(ix - 2, iy + 8, 14, 4);
                ctx.fillStyle = '#455a64'; ctx.fillRect(ix - 1, iy + 9, 12, 2);
                // Anvil body (tapered)
                ctx.fillStyle = '#546e7a'; ctx.fillRect(ix, iy + 4, 10, 5);
                ctx.fillStyle = '#607d8b'; ctx.fillRect(ix + 1, iy + 5, 8, 3);
                // Anvil horn (pointed left)
                ctx.fillStyle = '#546e7a'; ctx.fillRect(ix - 3, iy + 5, 4, 3);
                ctx.fillStyle = '#607d8b'; ctx.fillRect(ix - 2, iy + 6, 3, 1);
                // Anvil face (flat top)
                ctx.fillStyle = '#78909c'; ctx.fillRect(ix - 1, iy + 3, 12, 2);
                // Spark (orange dot)
                ctx.fillStyle = '#ff6d00'; ctx.fillRect(ix + 8, iy + 1, 2, 2);
                ctx.fillStyle = '#ffab40'; ctx.fillRect(ix + 10, iy, 1, 1);
                break;
            case 'files': // Blue file stack & envelopes
                // Bottom file (dark blue, wide)
                ctx.fillStyle = '#1565c0'; ctx.fillRect(ix - 2, iy + 6, 14, 6);
                ctx.fillStyle = '#1976d2'; ctx.fillRect(ix - 2, iy + 4, 7, 3); // tab
                // Middle file (medium blue)
                ctx.fillStyle = '#1976d2'; ctx.fillRect(ix - 1, iy + 3, 14, 5);
                ctx.fillStyle = '#1e88e5'; ctx.fillRect(ix + 7, iy + 1, 6, 3); // tab
                // Top file (lighter blue)
                ctx.fillStyle = '#1e88e5'; ctx.fillRect(ix, iy + 1, 13, 4);
                ctx.fillStyle = '#42a5f5'; ctx.fillRect(ix, iy - 1, 6, 3); // tab
                // White label stripes
                ctx.fillStyle = '#fff';
                ctx.fillRect(ix + 2, iy + 2, 6, 1);
                ctx.fillRect(ix + 1, iy + 5, 7, 1);
                // Envelope sticking out the side
                ctx.fillStyle = '#e3f2fd'; ctx.fillRect(ix + 9, iy - 2, 7, 5);
                ctx.fillStyle = '#bbdefb'; ctx.fillRect(ix + 9, iy - 2, 7, 1); // flap
                // Envelope flap triangle
                ctx.fillStyle = '#90caf9';
                ctx.fillRect(ix + 11, iy - 1, 3, 1);
                ctx.fillRect(ix + 12, iy, 1, 1);
                // Second envelope peeking behind
                ctx.fillStyle = '#e8eaf6'; ctx.fillRect(ix + 10, iy - 3, 6, 2);
                ctx.fillStyle = '#c5cae9'; ctx.fillRect(ix + 10, iy - 3, 6, 1);
                break;
        }
    }

    draw() {
        ctx.save();
        ctx.translate(this.x, this.y);
        this._yawning = false; // reset per frame

        const breathe = (Math.abs(this.targetX - this.x) < 1 && Math.abs(this.targetY - this.y) < 1) ? Math.sin(this.tick * 0.05) * 1 : 0;
        const isMoving = Math.abs(this.targetX - this.x) > this.speed || Math.abs(this.targetY - this.y) > this.speed;
        const walkBob = isMoving ? Math.abs(Math.sin(this.tick * 0.25)) * 6 : 0;
        const legOffset = isMoving ? Math.sin(this.tick * 0.25) * 9 : 0;
        const sitOffset = this.isSitting ? 8 : 0;

        // Shadow
        ctx.fillStyle = 'rgba(0,0,0,0.2)';
        ctx.beginPath(); ctx.ellipse(0, 4, 12, 5, 0, 0, Math.PI * 2); ctx.fill();

        // === CARRIED ITEM ON DESK (anchored to desk, no body bob) ===
        // (Unique character items drawn in environment pass — always visible)
        // Hide desk item during sip/nibble cycle (item is "in hand")
        if (this.carryItem && this.isSitting && !isMoving && !this.idleAction) {
            const sipCycle = this.tick % 540;  // full cycle ~9 seconds
            const isPickedUp = sipCycle < 120; // first 120 ticks: item is in hand
            if (!isPickedUp) {
                // Item resting on desk
                if (this.carryItem === 'coffee') {
                    ctx.fillStyle = '#fff'; ctx.fillRect(22, 3, 8, 10);
                    ctx.fillStyle = '#6d4c41'; ctx.fillRect(23, 4, 6, 5);
                    ctx.fillStyle = '#fff'; ctx.fillRect(29, 5, 3, 4);
                    ctx.fillStyle = '#e0e0e0'; ctx.fillRect(30, 6, 1, 2);
                    ctx.fillStyle = 'rgba(255,255,255,0.5)';
                    ctx.fillRect(24, -1 + Math.sin(this.tick * 0.1) * 1, 2, 3);
                    ctx.fillRect(27, -2 + Math.cos(this.tick * 0.08) * 1, 2, 3);
                } else if (this.carryItem === 'water') {
                    ctx.fillStyle = 'rgba(220,240,255,0.9)'; ctx.fillRect(22, 3, 6, 9);
                    ctx.fillStyle = 'rgba(33,150,243,0.5)'; ctx.fillRect(23, 6, 4, 5);
                    if (Math.floor(this.tick / 120) % 3 === 0) {
                        ctx.fillStyle = 'rgba(33,150,243,0.3)'; ctx.fillRect(22, 10, 2, 2);
                    }
                } else if (this.carryItem === 'snack') {
                    this._drawSnack(ctx, 22, 4);
                } else if (this.carryItem === 'food') {
                    this._drawFood(ctx, 22, 2);
                }
            }
        }

        ctx.translate(0, -walkBob + sitOffset);

        // --- RIM LIGHT via canvas shadow (physics-based, follows exact shape) ---
        var _rim = getRimLight(this);
        if (_rim) {
            // Shadow offset toward the light = glow on light-facing edges (color matches source)
            var rimStr = Math.min(1, _rim.intensity * 5);
            ctx.shadowColor = 'rgba(' + _rim.color + ',' + rimStr.toFixed(2) + ')';
            ctx.shadowBlur = 0;
            ctx.shadowOffsetX = _rim.dirX * 5;
            ctx.shadowOffsetY = _rim.dirY * 5;
        }

        // Legs
        ctx.fillStyle = this.isSitting ? '#1a1a2e' : '#263238';
        if (!this.isSitting) {
            ctx.fillRect(-10, -7, 8, 12 + legOffset);
            ctx.fillRect(2, -7, 8, 12 - legOffset);
        } else {
            ctx.fillRect(-10, -2, 8, 8);
            ctx.fillRect(2, -2, 8, 8);
        }

        ctx.translate(0, breathe);

        // Body
        const isFemale = this.gender === 'F';
        ctx.fillStyle = this.color;
        if (isFemale) {
            // Slightly narrower torso, tapered waist
            ctx.fillRect(-9, -22, 18, 6);   // shoulders
            ctx.fillRect(-8, -16, 16, 9);   // waist
        } else {
            ctx.fillRect(-10, -22, 20, 15);
        }

        // Arms
        const armW = isFemale ? 3 : 4;
        // Check if sip animation is controlling the right arm
        const _sipActive = this.carryItem && this.isSitting && !isMoving && !this.idleAction && (this.tick % 540) < 120;
        if (this.state === 'working' && this.isSitting && !isMoving) {
            // Working: typing pose
            const typeOff = Math.sin(this.tick * 0.5) * 2;
            ctx.fillStyle = this.color;
            ctx.fillRect(isFemale ? -12 : -13, -15 + typeOff, armW, 8);
            if (!_sipActive) ctx.fillRect(9, -15 - typeOff, armW, 8);

        } else if ((this.state === 'idle' && this.isSitting) && !isMoving) {
            // Idle at desk: arms resting
            ctx.fillStyle = this.color;
            ctx.fillRect(isFemale ? -12 : -13, -15, armW, 8);
            if (!_sipActive) ctx.fillRect(9, -15, armW, 8);
        } else if (this.idleAction === 'pong' && !isMoving) {
            // Ping pong — exact same as 8085 version with P1/P2 colors
            var _pg = pongGames.find(pg => pg.p1.id === this.id || pg.p2.id === this.id);
            var _isP1 = _pg && _pg.p1.id === this.id;
            var _swing = _pg ? (_isP1 ? (_pg.p1Swing || 0) : (_pg.p2Swing || 0)) : 0;
            var racketArm = this.faceDir;
            var swingAngle = _swing * 0.8;
            var _paddleFace = _isP1 ? '#f44336' : '#2196f3';
            var _paddleEdge = _isP1 ? '#d32f2f' : '#1976d2';
            ctx.fillStyle = this.color;
            if (racketArm === 1) {
                // Right arm with racket (facing right toward table)
                ctx.fillRect(isFemale ? -12 : -13, -15, armW, 8); // left arm resting
                ctx.save();
                ctx.translate(10, -18);
                ctx.rotate(-0.3 + swingAngle);
                ctx.fillStyle = this.color;
                ctx.fillRect(0, 0, armW, 10); // forearm
                // Racket
                ctx.fillStyle = '#8d6e63'; ctx.fillRect(1, 10, 2, 5); // handle
                ctx.fillStyle = _paddleFace;
                ctx.beginPath(); ctx.arc(2, 16, 4, 0, Math.PI * 2); ctx.fill();
                ctx.fillStyle = _paddleEdge;
                ctx.beginPath(); ctx.arc(2, 16, 3, 0, Math.PI * 2); ctx.fill();
                ctx.restore();
            } else {
                // Left arm with racket (facing left toward table)
                ctx.fillRect(9, -15, armW, 8); // right arm resting
                ctx.save();
                ctx.translate(-10, -18);
                ctx.rotate(0.3 - swingAngle);
                ctx.fillStyle = this.color;
                ctx.fillRect(-armW, 0, armW, 10); // forearm
                // Racket
                ctx.fillStyle = '#8d6e63'; ctx.fillRect(-2, 10, 2, 5); // handle
                ctx.fillStyle = _paddleFace;
                ctx.beginPath(); ctx.arc(-1, 16, 4, 0, Math.PI * 2); ctx.fill();
                ctx.fillStyle = _paddleEdge;
                ctx.beginPath(); ctx.arc(-1, 16, 3, 0, Math.PI * 2); ctx.fill();
                ctx.restore();
            }
        } else if (this.idleAction === 'stretch' && !isMoving) {
            ctx.fillStyle = this.color;
            ctx.fillRect(-14, -30, armW, 14);
            ctx.fillRect(10, -30, armW, 14);
        } else if (this.idleAction === 'read_book' && !isMoving) {
            // Arms holding a book in front
            ctx.fillStyle = this.color;
            ctx.fillRect(-9, -18, armW, 10);
            ctx.fillRect(6, -18, armW, 10);
            // Book
            ctx.fillStyle = '#e3f2fd'; ctx.fillRect(-5, -10, 12, 14);
            ctx.fillStyle = '#1976d2'; ctx.fillRect(-4, -9, 10, 5);
            // Text lines on page
            ctx.fillStyle = '#90a4ae';
            ctx.fillRect(-3, -3, 8, 1); ctx.fillRect(-3, -1, 6, 1); ctx.fillRect(-3, 1, 7, 1);
            // Page flip animation
            if (Math.floor(this.interactTimer / 120) % 2 === 0) {
                ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.fillRect(3, -9, 3, 12);
            }
        } else if (this.idleAction === 'look_window' && !isMoving) {
            // Arms behind back (viewing from behind)
            ctx.fillStyle = this.color;
            ctx.fillRect(-5, -16, 3, 8);
            ctx.fillRect(3, -16, 3, 8);
        } else if (this.idleAction === 'couch' && !isMoving) {
            // Relaxed arms on couch — one on armrest, one on lap
            ctx.fillStyle = this.color;
            const relaxOff = Math.sin(this.tick * 0.02) * 0.5;
            ctx.fillRect(isFemale ? -14 : -15, -16 + relaxOff, armW, 10); // arm on rest
            ctx.fillRect(6, -12, armW, 6); // arm on lap
        } else if (this.idleAction === 'watch_tv' && !isMoving) {
            // Arms on lap / holding remote
            ctx.fillStyle = this.color;
            ctx.fillRect(-8, -12, armW, 6);
            ctx.fillRect(5, -14, armW, 8);
            // Remote in hand
            ctx.fillStyle = '#212121'; ctx.fillRect(6, -15, 4, 7);
            ctx.fillStyle = '#f44336'; ctx.fillRect(7, -14, 2, 2);
        } else if (this.idleAction === 'break_browse' && !isMoving) {
            // Curious browsing pose — hand on chin, looking around
            ctx.fillStyle = this.color;
            ctx.fillRect(isFemale ? -11 : -12, -18, 3, 10); // left arm at side
            // Right hand on chin (thinking pose)
            ctx.fillRect(8, -20, armW, 6);
            ctx.fillRect(5, -26, armW, 6);
            // Occasional head tilt (looking left/right)
            if (Math.floor(this.interactTimer / 40) % 2 === 0) {
                this.faceDir = 1;
            } else {
                this.faceDir = -1;
            }
        } else if (['get_snack', 'make_coffee', 'get_water', 'make_food'].includes(this.idleAction) && !isMoving) {
            // One arm reaching toward machine, other at side
            ctx.fillStyle = this.color;
            ctx.fillRect(isFemale ? -11 : -12, -18, 3, 10); // left arm at side
            // Right arm extended toward machine
            const reachAnim = Math.sin(this.interactTimer * 0.08) * 2;
            ctx.fillRect(9, -20 + reachAnim, armW, 12);
            // Interaction-specific details
            if (this.idleAction === 'make_coffee' && this.interactTimer > 60) {
                // Steam while brewing
                ctx.fillStyle = 'rgba(255,255,255,0.3)';
                ctx.fillRect(12, -24 + Math.sin(this.interactTimer * 0.1) * 2, 2, 3);
                ctx.fillRect(15, -26 + Math.cos(this.interactTimer * 0.1) * 2, 2, 3);
            }
            if (this.idleAction === 'get_water' && this.interactTimer > 40) {
                // Holding cup under spigot
                ctx.fillStyle = '#fff'; ctx.fillRect(12, -10, 5, 6);
                ctx.fillStyle = 'rgba(33,150,243,0.5)';
                const fillH = Math.min(4, Math.floor((this.interactTimer - 40) / 30));
                ctx.fillRect(13, -10 + (4 - fillH), 3, fillH);
            }
            if (this.idleAction === 'get_snack' && this.interactTimer > 80) {
                // Snack dropping from machine
                const dropY = Math.min(0, -8 + (this.interactTimer - 80) * 0.3);
                ctx.fillStyle = '#ffc107'; ctx.fillRect(12, dropY - 6, 6, 4);
            }
            if (this.idleAction === 'make_food' && this.interactTimer > 50) {
                // Food warming glow
                ctx.fillStyle = 'rgba(255,152,0,0.2)';
                ctx.fillRect(10, -14, 8, 6);
            }
        } else {
            ctx.fillStyle = this.color;
            const armSwing = isMoving ? Math.sin(this.tick * 0.25) * 5 : 0;
            ctx.fillRect(isFemale ? -11 : -12, -20 + armSwing, 3, 10);
            ctx.fillRect(9, -20 - armSwing, 3, 10);
        }

        // Head (appearance-driven skin tone)
        const _appearance = this.getAppearance();
        ctx.fillStyle = _appearance.skinTone || '#ffcc80';
        ctx.fillRect(-12, -38, 24, 18);

        // Hair (data-driven)
        _drawHairByConfig(ctx, _appearance.hairStyle, _appearance.hairColor, _appearance.hairHighlight);

        // Clear rim light shadow — only body parts (legs, body, arms, head, hair) get the glow
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;

        // --- FACIAL FEATURES ---
        const eyeShift = this.faceDir === 1 ? 0 : -2;
        const skin = _appearance.skinTone || '#ffcc80';

        // Eyebrows (data-driven)
        const _ebStyle = _appearance.eyebrowStyle || (isFemale ? 'thin' : 'thick');
        if (_ebStyle === 'thin') {
            ctx.fillStyle = '#5d4037';
            ctx.fillRect(-5 + eyeShift, -33, 4, 1); ctx.fillRect(4 + eyeShift, -33, 4, 1);
            ctx.fillRect(-6 + eyeShift, -34, 2, 1); ctx.fillRect(7 + eyeShift, -34, 2, 1);
        } else if (_ebStyle === 'arched') {
            ctx.fillStyle = '#5d4037';
            ctx.fillRect(-5 + eyeShift, -34, 4, 1); ctx.fillRect(4 + eyeShift, -34, 4, 1);
            ctx.fillRect(-7 + eyeShift, -35, 2, 1); ctx.fillRect(8 + eyeShift, -35, 2, 1);
        } else if (_ebStyle === 'angular') {
            ctx.fillStyle = '#3e2723';
            ctx.fillRect(-5 + eyeShift, -35, 5, 1); ctx.fillRect(4 + eyeShift, -35, 5, 1);
            ctx.fillRect(-5 + eyeShift, -34, 2, 1); ctx.fillRect(8 + eyeShift, -34, 2, 1);
        } else {
            // thick (default male)
            ctx.fillStyle = '#3e2723';
            ctx.fillRect(-5 + eyeShift, -34, 5, 2); ctx.fillRect(4 + eyeShift, -34, 5, 2);
        }

        // Eyes
        if (this.blinkTimer > 0) {
            ctx.fillStyle = '#d7ccc8';
            ctx.fillRect(-5, -29, 5, 2);
            ctx.fillRect(4, -29, 5, 2);
        } else {
            // Eye whites
            ctx.fillStyle = '#fff';
            ctx.fillRect(-6 + eyeShift, -31, 6, 5);
            ctx.fillRect(3 + eyeShift, -31, 6, 5);
            // Pupils
            ctx.fillStyle = _appearance.eyeColor || '#212121';
            ctx.fillRect(-4 + eyeShift, -30, 3, 4);
            ctx.fillRect(5 + eyeShift, -30, 3, 4);
            // Pupil shine
            ctx.fillStyle = '#fff';
            ctx.fillRect(-3 + eyeShift, -30, 1, 1);
            ctx.fillRect(6 + eyeShift, -30, 1, 1);

            if (isFemale) {
                // Eyelashes — small lines above eyes
                ctx.fillStyle = '#212121';
                ctx.fillRect(-7 + eyeShift, -32, 1, 2);  // left outer lash
                ctx.fillRect(-6 + eyeShift, -33, 1, 2);  // left upper lash
                ctx.fillRect(8 + eyeShift, -32, 1, 2);   // right outer lash
                ctx.fillRect(9 + eyeShift, -33, 1, 2);   // right upper lash
            }
        }

        // Nose — small 2px hint
        ctx.fillStyle = darken(skin, 0.15);
        ctx.fillRect(0, -27, 2, 2);

        // Mouth
        const _sm = this._socialMouth;
        this._socialMouth = null;
        if (_sm === 'laugh') {
            // Wide open laughing mouth
            ctx.fillStyle = '#3e2723'; ctx.fillRect(-3, -25, 6, 4);
            ctx.fillStyle = '#fff'; ctx.fillRect(-2, -25, 4, 1); // teeth
            ctx.fillStyle = '#c62828'; ctx.fillRect(-2, -23, 4, 2); // tongue
        } else if (_sm === 'open') {
            // Talking — mouth open
            ctx.fillStyle = '#3e2723'; ctx.fillRect(-2, -25, 5, 3);
            ctx.fillStyle = '#fff'; ctx.fillRect(-1, -25, 3, 1); // teeth flash
        } else if (_sm === 'half') {
            // Half open (mid-talk)
            ctx.fillStyle = '#3e2723'; ctx.fillRect(-2, -24, 4, 2);
        } else if (_sm === 'smile') {
            // Smile — curved up
            ctx.fillStyle = '#3e2723'; ctx.fillRect(-3, -24, 6, 1);
            ctx.fillStyle = '#3e2723'; ctx.fillRect(-2, -23, 4, 1); // slight curve down
            // Dimples
            ctx.fillStyle = 'rgba(200,100,100,0.3)';
            ctx.fillRect(-5, -24, 1, 1); ctx.fillRect(5, -24, 1, 1);
        } else if (_sm === 'closed') {
            // Closed but slight smile
            ctx.fillStyle = '#3e2723'; ctx.fillRect(-2, -24, 5, 1);
        } else if (this.talkTimer > 0) {
            ctx.fillStyle = '#3e2723';
            const open = Math.floor(this.tick / 3) % 2 === 0;
            ctx.fillRect(-2, -24, 4, open ? 3 : 1);
        } else if (isFemale) {
            // Lips — subtle color
            ctx.fillStyle = '#c4626a';
            ctx.fillRect(-2, -24, 5, 2);
            ctx.fillStyle = '#d47a82';
            ctx.fillRect(-1, -24, 3, 1); // upper lip highlight
        } else {
            // Neutral closed mouth line for males
            ctx.fillStyle = darken(skin, 0.25);
            ctx.fillRect(-2, -24, 4, 1);
        }

        // --- FACIAL HAIR ---
        if (_appearance.facialHair) {
            const fhColor = _appearance.facialHairColor || darken(_appearance.skinTone || '#ffcc80', 0.4);
            ctx.fillStyle = fhColor;
            if (_appearance.facialHair === 'stubble') {
                ctx.globalAlpha = 0.4;
                ctx.fillRect(-8, -26, 16, 4);
                ctx.globalAlpha = 1;
            } else if (_appearance.facialHair === 'beard') {
                ctx.fillRect(-8, -27, 16, 8);
                ctx.fillStyle = _appearance.skinTone || '#ffcc80';
                ctx.fillRect(-3, -26, 6, 3); // mouth area exposed
            } else if (_appearance.facialHair === 'goatee') {
                ctx.fillRect(-4, -25, 8, 4);
            } else if (_appearance.facialHair === 'mustache') {
                ctx.fillRect(-5, -27, 10, 2);
            }
        }

        // --- COSTUME (cached, drawn over everything) ---
        _drawCostume(ctx, _appearance.costume);

        // --- HEADWEAR (data-driven, skipped if wearing costume) ---
        if (!_appearance.costume) _drawHeadwear(ctx, _appearance.headwear, _appearance.headwearColor, isMoving);

        // --- GLASSES (data-driven) ---
        _drawGlasses(ctx, _appearance.glasses, _appearance.glassesColor, eyeShift);

        // --- HELD ITEM (data-driven) ---
        _drawHeldItem(ctx, _appearance.heldItem, isMoving);

        // Identity accessories are now data-driven via the Agent Editor.
        // No hardcoded per-agent accessories.

        // Emoji badge (on chest/shirt area)
        ctx.font = '8px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(this.emoji, 0, -12);

        // --- CARRIED ITEM (while walking) ---
        if (this.carryItem && isMoving) {
            const itemX = this.faceDir > 0 ? 12 : -19;
            if (this.carryItem === 'coffee') {
                ctx.fillStyle = '#fff'; ctx.fillRect(itemX, -18, 8, 10);
                ctx.fillStyle = '#6d4c41'; ctx.fillRect(itemX + 1, -17, 6, 5);
                ctx.fillStyle = '#fff'; ctx.fillRect(itemX + 7, -16, 3, 4);
                ctx.fillStyle = '#e0e0e0'; ctx.fillRect(itemX + 8, -15, 1, 2);
                // Steam
                ctx.fillStyle = 'rgba(255,255,255,0.4)';
                ctx.fillRect(itemX + 2, -22 + Math.sin(this.tick * 0.15) * 1, 2, 3);
                ctx.fillRect(itemX + 5, -23 + Math.cos(this.tick * 0.15) * 1, 2, 3);
            } else if (this.carryItem === 'water') {
                ctx.fillStyle = 'rgba(220,240,255,0.9)'; ctx.fillRect(itemX, -18, 6, 9);
                ctx.fillStyle = 'rgba(33,150,243,0.5)'; ctx.fillRect(itemX + 1, -15, 4, 5);
            } else if (this.carryItem === 'snack') {
                this._drawSnack(ctx, itemX, -16);
            } else if (this.carryItem === 'food') {
                this._drawFood(ctx, itemX, -18);
            }
        }

        // --- SIPPING / NIBBLING ANIMATION (at desk with item) ---
        // Synced with desk item: tick%540, first 120 ticks = item in hand
        // Phases: 0-25 reach to desk, 25-45 pick up, 45-60 lift to mouth,
        //         60-85 sip/bite (hold), 85-100 lower, 100-120 place back
        if (this.carryItem && this.isSitting && !isMoving && !this.idleAction) {
            const sipCycle = this.tick % 540;
            if (sipCycle < 120) {
                // --- ARM position (reaches toward desk item, then lifts) ---
                // Arm goes from resting (-15) down to desk level (-8) then up to face (-26)
                let armY, armX;
                const isFem = this.gender === 'F';
                const aw = isFem ? 3 : 4;
                if (sipCycle < 25) {
                    // Reach out toward desk: arm extends right and down
                    const t = sipCycle / 25;
                    armX = 9 + t * 6;        // 9 → 15 (reaching right toward item)
                    armY = -15 + t * 7;      // -15 → -8 (down to desk)
                } else if (sipCycle < 45) {
                    // Gripping / picking up
                    const t = (sipCycle - 25) / 20;
                    armX = 15 - t * 12;      // 15 → 3 (pulling back toward body)
                    armY = -8 - t * 10;      // -8 → -18 (lifting)
                } else if (sipCycle < 60) {
                    // Lift to mouth
                    const t = (sipCycle - 45) / 15;
                    armX = 3 - t * 4;        // 3 → -1 (centering)
                    armY = -18 - t * 8;      // -18 → -26
                } else if (sipCycle < 85) {
                    // Hold at mouth
                    armX = -1;
                    armY = -26;
                } else if (sipCycle < 100) {
                    // Lower from mouth
                    const t = (sipCycle - 85) / 15;
                    armX = -1 + t * 4;       // -1 → 3
                    armY = -26 + t * 8;      // -26 → -18
                } else {
                    // Place back on desk
                    const t = (sipCycle - 100) / 20;
                    armX = 3 + t * 12;       // 3 → 15 (reaching back to desk)
                    armY = -18 + t * 10;     // -18 → -8 (down to desk)
                }

                // Draw the reaching/holding arm
                ctx.fillStyle = this.color;
                // Upper arm (shoulder to elbow)
                ctx.fillRect(9, -16, aw, 8);
                // Forearm (elbow to hand) — angled toward item
                const fArmLen = Math.sqrt((armX - 9) ** 2 + (armY - (-10)) ** 2);
                ctx.save();
                ctx.translate(9 + aw / 2, -10);
                const angle = Math.atan2(armY - (-10), armX - 9);
                ctx.rotate(angle);
                ctx.fillRect(0, -aw / 2, Math.min(fArmLen, 14), aw);
                ctx.restore();
                // Hand (skin-colored block at item position)
                const skinTone = _appearance.skinTone || '#ffcc80';
                ctx.fillStyle = skinTone;
                ctx.fillRect(armX - 1, armY - 1, 4, 4);

                // --- ITEM follows the hand ---
                let itemY = armY;
                let itemX = armX;

                if (this.carryItem === 'coffee') {
                    ctx.fillStyle = '#fff'; ctx.fillRect(itemX - 1, itemY + 2, 8, 10);
                    ctx.fillStyle = '#6d4c41'; ctx.fillRect(itemX, itemY + 3, 6, 5);
                    ctx.fillStyle = '#fff'; ctx.fillRect(itemX + 6, itemY + 4, 3, 4);
                    ctx.fillStyle = '#e0e0e0'; ctx.fillRect(itemX + 7, itemY + 5, 1, 2);
                    // Steam near face during sip
                    if (sipCycle >= 55 && sipCycle < 90) {
                        ctx.fillStyle = 'rgba(255,255,255,0.45)';
                        ctx.fillRect(itemX + 1, itemY - 2 + Math.sin(this.tick * 0.1) * 1, 2, 3);
                        ctx.fillRect(itemX + 4, itemY - 3 + Math.cos(this.tick * 0.08) * 1, 2, 3);
                    }
                } else if (this.carryItem === 'water') {
                    ctx.fillStyle = 'rgba(220,240,255,0.9)'; ctx.fillRect(itemX - 1, itemY + 2, 6, 9);
                    ctx.fillStyle = 'rgba(33,150,243,0.5)'; ctx.fillRect(itemX, itemY + 5, 4, 5);
                } else if (this.carryItem === 'snack') {
                    this._drawSnack(ctx, itemX - 1, itemY + 2);
                    // Crumbs during bite phase
                    if (sipCycle >= 62 && sipCycle < 82) {
                        ctx.fillStyle = '#ffe082';
                        const cp = (sipCycle - 62) * 0.6;
                        ctx.fillRect(itemX + 1, itemY + 7 + cp, 2, 1);
                        ctx.fillRect(itemX + 4, itemY + 9 + cp * 0.7, 1, 1);
                    }
                } else if (this.carryItem === 'food') {
                    this._drawFood(ctx, itemX - 1, itemY);
                    // Crumbs during bite phase
                    if (sipCycle >= 62 && sipCycle < 82) {
                        ctx.fillStyle = this.foodType === 'popcorn' ? '#fff9c4' : '#d4a056';
                        const cp = (sipCycle - 62) * 0.6;
                        ctx.fillRect(itemX + 2, itemY + 8 + cp, 2, 1);
                        ctx.fillRect(itemX + 5, itemY + 10 + cp * 0.7, 1, 1);
                    }
                }
            }
        }

        // Name tag
        ctx.fillStyle = this.color;
        ctx.fillRect(-22, -68, 44, 14);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 9px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(this.name, 0, -58);

        // Settings gear icon
        ctx.font = '14px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('⚙️', 0, -74);
        // Store gear hitbox in world coords (updated each frame)
        this.gearRect = { x: this.x - 10, y: this.y - 86, w: 20, h: 18 };

        // State indicator for visiting/meeting
        if (this.state === 'visiting' || this.state === 'meeting') {
            ctx.fillStyle = this.state === 'meeting' ? 'rgba(33,150,243,0.8)' : 'rgba(76,175,80,0.8)';
            ctx.beginPath(); ctx.arc(16, -60, 4, 0, Math.PI * 2); ctx.fill();
        }

        // Notification light — pulsing red dot
        if (this.notify) {
            const pulse = 0.5 + Math.sin(this.tick * 0.15) * 0.5; // 0-1 pulse
            const radius = 5 + pulse * 2;
            // Glow
            ctx.fillStyle = `rgba(244, 67, 54, ${0.3 + pulse * 0.3})`;
            ctx.beginPath(); ctx.arc(-18, -62, radius + 3, 0, Math.PI * 2); ctx.fill();
            // Solid dot
            ctx.fillStyle = `rgba(244, 67, 54, ${0.7 + pulse * 0.3})`;
            ctx.beginPath(); ctx.arc(-18, -62, radius, 0, Math.PI * 2); ctx.fill();
            // Inner bright spot
            ctx.fillStyle = `rgba(255, 255, 255, ${0.4 + pulse * 0.4})`;
            ctx.beginPath(); ctx.arc(-18, -63, 2, 0, Math.PI * 2); ctx.fill();
            // Exclamation mark
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 8px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('!', -18, -59);
        }

        // Clear rim light shadow
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;

        ctx.restore();
    }
}

// --- HELPERS ---
function timeStr() { return new Date().toLocaleTimeString([], { hour12: false }); }
function darken(hex, amt) {
    let r = parseInt(hex.slice(1, 3), 16);
    let g = parseInt(hex.slice(3, 5), 16);
    let b = parseInt(hex.slice(5, 7), 16);
    r = Math.floor(r * (1 - amt)); g = Math.floor(g * (1 - amt)); b = Math.floor(b * (1 - amt));
    return `rgb(${r},${g},${b})`;
}

// --- BUBBLE SYSTEM ---
const BUBBLE_W = 170, BUBBLE_LINE_H = 11, BUBBLE_PAD = 8, BUBBLE_MAX_LINES = 8;
const BUBBLE_HEADER_H = 16; // height for name banner
const BUBBLE_CLOSE_SIZE = 10; // close button size

// Per-agent bubble minimize state: { agentKey: { thought: bool, speech: bool } }
const bubbleMinimized = {};
// Store rendered bubble rects for click detection
let renderedBubbles = [];
let renderedIcons = [];

function wrapText(text, maxW) {
    ctx.font = '7px "Press Start 2P", monospace';
    const words = text.split(' ');
    const lines = []; let line = '';
    for (const word of words) {
        const test = line ? line + ' ' + word : word;
        if (ctx.measureText(test).width > maxW - BUBBLE_PAD * 2 && line) { lines.push(line); line = word; }
        else line = test;
    }
    if (line) lines.push(line);
    return lines.slice(0, BUBBLE_MAX_LINES);
}

function getBubbleMinState(agent) {
    if (!bubbleMinimized[agent.statusKey]) bubbleMinimized[agent.statusKey] = { thought: false, speech: false };
    return bubbleMinimized[agent.statusKey];
}

function collectBubbles() {
    const bubbles = [];
    renderedIcons = [];
    agents.forEach(agent => {
        const headX = agent.x, headY = agent.y - 45;
        const minState = getBubbleMinState(agent);

        // Thought bubble
        const hasThought = agent.thought || agent.lastThought;
        if (hasThought) {
            const text = agent.thought || agent.lastThought;
            if (minState.thought) {
                // Minimized icon
                renderedIcons.push({ type: 'thought', agent, x: headX - 32, y: headY - 20, w: 14, h: 14 });
            } else {
                agent.thoughtChars = Math.min(agent.thoughtChars + 0.4, text.length);
                const vis = text.substring(0, Math.floor(agent.thoughtChars));
                if (vis.length > 0) {
                    const headerText = `${agent.name} Internal`;
                    const lines = wrapText(vis, BUBBLE_W);
                    const h = BUBBLE_HEADER_H + lines.length * BUBBLE_LINE_H + BUBBLE_PAD * 2;
                    bubbles.push({ type: 'thought', agent, lines, w: BUBBLE_W, h, 
                        x: headX - BUBBLE_W - 20, y: headY - h - 10, 
                        anchorX: headX, anchorY: headY, headerText });
                }
            }
        }

        // Speech bubble
        const hasSpeech = agent.speech || agent.lastSpeech;
        if (hasSpeech) {
            const text = agent.speech || agent.lastSpeech;
            const target = agent.speechTarget || agent.lastSpeechTarget || '';
            if (minState.speech) {
                // Minimized icon
                renderedIcons.push({ type: 'speech', agent, x: headX + 16, y: headY - 20, w: 14, h: 14 });
            } else {
                agent.speechChars = Math.min(agent.speechChars + 0.6, text.length);
                const vis = text.substring(0, Math.floor(agent.speechChars));
                if (vis.length > 0) {
                    const targetLabel = target ? `→ ${target}` : '';
                    const headerText = agent.name;
                    const lines = wrapText(vis, BUBBLE_W);
                    const targetH = targetLabel ? 10 : 0;
                    const h = BUBBLE_HEADER_H + targetH + lines.length * BUBBLE_LINE_H + BUBBLE_PAD * 2;
                    bubbles.push({ type: 'speech', agent, lines, w: BUBBLE_W, h, targetH,
                        x: headX + 25, y: headY - h - 10,
                        anchorX: headX, anchorY: headY, targetLabel, headerText });
                }
                if (agent.speechChars < text.length) agent.talkTimer = 10;
            }
        }
    });
    lastCollectedBubbles = bubbles;
    return bubbles;
}

function resolveBubbleCollisions(bubbles) {
    for (const b of bubbles) {
        b.x = Math.max(2, Math.min(W - b.w - 2, b.x));
        b.y = Math.max(2, Math.min(H - b.h - 20, b.y));
    }
    for (let pass = 0; pass < 5; pass++) {
        for (let i = 0; i < bubbles.length; i++) {
            for (let j = i + 1; j < bubbles.length; j++) {
                const a = bubbles[i], bb = bubbles[j];
                if (a.x < bb.x + bb.w && a.x + a.w > bb.x && a.y < bb.y + bb.h && a.y + a.h > bb.y) {
                    const overlapX = Math.min(a.x + a.w - bb.x, bb.x + bb.w - a.x);
                    const overlapY = Math.min(a.y + a.h - bb.y, bb.y + bb.h - a.y);
                    if (overlapY < overlapX) {
                        if (a.y < bb.y) { a.y -= overlapY / 2 + 2; bb.y += overlapY / 2 + 2; }
                        else { bb.y -= overlapY / 2 + 2; a.y += overlapY / 2 + 2; }
                    } else {
                        if (a.x < bb.x) { a.x -= overlapX / 2 + 2; bb.x += overlapX / 2 + 2; }
                        else { bb.x -= overlapX / 2 + 2; a.x += overlapX / 2 + 2; }
                    }
                }
            }
        }
        for (const b of bubbles) {
            b.x = Math.max(2, Math.min(W - b.w - 2, b.x));
            b.y = Math.max(2, Math.min(H - b.h - 20, b.y));
        }
    }
}

function drawMinimizedIcons() {
    // Draws at agent layer (before bubbles) so bubbles render on top
    for (const icon of renderedIcons) {
        ctx.save();
        const isThought = icon.type === 'thought';
        const cx = icon.x + icon.w / 2, cy = icon.y + icon.h / 2;
        ctx.fillStyle = isThought ? 'rgba(180,180,255,0.6)' : 'rgba(255,240,150,0.6)';
        ctx.beginPath(); ctx.arc(cx, cy, 7, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = isThought ? 'rgba(100,100,180,0.7)' : 'rgba(200,170,50,0.7)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(cx, cy, 7, 0, Math.PI * 2); ctx.stroke();
        ctx.font = 'bold 5px "Press Start 2P", monospace';
        ctx.fillStyle = isThought ? '#446' : '#553';
        ctx.textAlign = 'center';
        ctx.fillText(isThought ? '...' : '💬', cx, cy + 2);
        ctx.restore();
    }
}

let lastCollectedBubbles = [];

function drawAllBubbles() {
    const bubbles = lastCollectedBubbles;
    resolveBubbleCollisions(bubbles);
    renderedBubbles = [];

    for (const b of bubbles) {
        ctx.save();
        const r = 6;
        const isThought = b.type === 'thought';

        // Connector to agent head
        if (isThought) {
            const cx = b.x + b.w / 2, cy = b.y + b.h;
            const dx = b.anchorX - cx, dy = b.anchorY - cy;
            for (let i = 1; i <= 3; i++) {
                const t = i / 4;
                ctx.fillStyle = `rgba(200,200,255,${0.5 + i * 0.1})`;
                ctx.beginPath(); ctx.arc(cx + dx * t, cy + dy * t, 2 + i, 0, Math.PI * 2); ctx.fill();
            }
        } else {
            const edgeX = Math.max(b.x + 8, Math.min(b.x + b.w - 8, b.anchorX));
            const edgeY = b.y + b.h;
            ctx.fillStyle = 'rgba(255,255,230,0.95)';
            ctx.strokeStyle = 'rgba(180,150,50,0.6)';
            ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.moveTo(edgeX - 6, edgeY); ctx.lineTo(b.anchorX, b.anchorY); ctx.lineTo(edgeX + 6, edgeY); ctx.closePath(); ctx.fill(); ctx.stroke();
        }

        // Bubble body
        ctx.fillStyle = isThought ? 'rgba(230,230,255,0.92)' : 'rgba(255,255,230,0.95)';
        ctx.strokeStyle = isThought ? 'rgba(100,100,180,0.5)' : 'rgba(180,150,50,0.6)';
        ctx.lineWidth = 1.5;
        drawRoundRect(b.x, b.y, b.w, b.h, r); ctx.fill(); ctx.stroke();

        // Header banner
        ctx.fillStyle = isThought ? 'rgba(100,100,180,0.85)' : 'rgba(180,150,50,0.85)';
        drawRoundRect(b.x, b.y, b.w, BUBBLE_HEADER_H, r);
        // Clip bottom corners of header (just fill top portion)
        ctx.save();
        ctx.beginPath(); ctx.rect(b.x, b.y, b.w, BUBBLE_HEADER_H); ctx.clip();
        drawRoundRect(b.x, b.y, b.w, BUBBLE_HEADER_H + 4, r); ctx.fill();
        ctx.restore();

        // Header text
        ctx.font = 'bold 7px "Press Start 2P", monospace';
        ctx.fillStyle = '#fff'; ctx.textAlign = 'left';
        ctx.fillText(b.headerText || '', b.x + BUBBLE_PAD, b.y + 11);

        // Close (minimize) button - "−" on the right side of header
        const closeX = b.x + b.w - BUBBLE_CLOSE_SIZE - 3;
        const closeY = b.y + 2;
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.fillRect(closeX, closeY, BUBBLE_CLOSE_SIZE, BUBBLE_CLOSE_SIZE);
        ctx.fillStyle = '#fff'; ctx.font = 'bold 9px Arial'; ctx.textAlign = 'center';
        ctx.fillText('−', closeX + BUBBLE_CLOSE_SIZE / 2, closeY + 8);

        // Store close button rect for click detection
        renderedBubbles.push({
            type: b.type, agent: b.agent,
            closeRect: { x: closeX, y: closeY, w: BUBBLE_CLOSE_SIZE, h: BUBBLE_CLOSE_SIZE },
            fullRect: { x: b.x, y: b.y, w: b.w, h: b.h }
        });

        // Target label (speech only)
        let textStartY = b.y + BUBBLE_HEADER_H + BUBBLE_PAD;
        if (!isThought && b.targetLabel) {
            ctx.font = '6px "Press Start 2P", monospace';
            ctx.fillStyle = '#b8860b'; ctx.textAlign = 'left';
            ctx.fillText(b.targetLabel, b.x + BUBBLE_PAD, textStartY + 4);
            textStartY += (b.targetH || 10);
        }

        // Body text
        ctx.font = '7px "Press Start 2P", monospace';
        ctx.fillStyle = isThought ? '#444' : '#222'; ctx.textAlign = 'left';
        b.lines.forEach((line, i) => ctx.fillText(line, b.x + BUBBLE_PAD, textStartY + 8 + i * BUBBLE_LINE_H));

        ctx.restore();
    }

    // Icons are drawn in drawMinimizedIcons() at agent layer, not here
}

// Bubble click handler
function handleBubbleClick(canvasX, canvasY) {
    // Check close buttons on expanded bubbles
    for (const rb of renderedBubbles) {
        const cr = rb.closeRect;
        if (canvasX >= cr.x && canvasX <= cr.x + cr.w && canvasY >= cr.y && canvasY <= cr.y + cr.h) {
            const minState = getBubbleMinState(rb.agent);
            minState[rb.type] = true;
            return true;
        }
    }
    // Check minimized icons — click to restore
    for (const icon of renderedIcons) {
        if (canvasX >= icon.x && canvasX <= icon.x + icon.w && canvasY >= icon.y && canvasY <= icon.y + icon.h) {
            const minState = getBubbleMinState(icon.agent);
            minState[icon.type] = false;
            // Restore bubble content and reset age so it displays
            if (icon.type === 'thought') {
                if (!icon.agent.thought && icon.agent.lastThought) icon.agent.thought = icon.agent.lastThought;
                icon.agent.thoughtAge = 0;
                icon.agent.thoughtChars = 0;
            } else {
                if (!icon.agent.speech && icon.agent.lastSpeech) icon.agent.speech = icon.agent.lastSpeech;
                if (icon.agent.lastSpeechTarget) icon.agent.speechTarget = icon.agent.lastSpeechTarget;
                icon.agent.speechAge = 0;
                icon.agent.speechChars = 0;
            }
            return true;
        }
    }
    return false;
}

function drawRoundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r); ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h); ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r); ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
}

// --- CREATE AGENTS (dynamic) ---
var agents = [];
var agentMap = {};

function _initAgentsFromDefs() {
    // Apply saved overrides
    var savedAgents = (officeConfig && officeConfig.agents) || [];
    var savedMap = {};
    savedAgents.forEach(function(s) { savedMap[s.id] = s; });

    agents.length = 0; // clear existing
    AGENT_DEFS.forEach(function(def) {
        var saved = savedMap[def.id] || {};
        if (saved.name) def.name = saved.name;
        if (saved.role) def.role = saved.role;
        if (saved.emoji) def.emoji = saved.emoji;
        if (saved.color) def.color = saved.color;
        if (saved.gender) def.gender = saved.gender;
        if (saved.statusKey) def.statusKey = saved.statusKey;
        if (saved.branch) def.branch = saved.branch;
        if (saved.appearance) def.appearance = JSON.parse(JSON.stringify(saved.appearance));
        agents.push(new Agent(def));
    });

    // Rebuild map
    agentMap = {};
    agents.forEach(function(a) { agentMap[a.id] = a; agentMap[a.statusKey] = a; });

    ensureValidAgentBranches();
    _syncAllDeskAssignments();
    if (typeof updateSidebar === 'function') updateSidebar();
    if (typeof _acpRefreshList === 'function') _acpRefreshList();
}

// Kick off roster fetch immediately
_fetchRoster();
let selectedAgent = null;
const dismissedNotify = new Set();  // track dismissed notifications to prevent poll re-enabling

// --- MEETING SYSTEM ---
let activeMeetings = {};  // id -> { agents: [], topic, type, slotAssignments }

function processMeetings(meetingsData) {
    if (!meetingsData || !Array.isArray(meetingsData)) {
        // No meetings — end any active ones
        for (const mid of Object.keys(activeMeetings)) {
            endMeeting(mid);
        }
        return;
    }

    const newIds = new Set(meetingsData.map(m => m.id));

    // End meetings no longer in the data
    for (const mid of Object.keys(activeMeetings)) {
        if (!newIds.has(mid)) endMeeting(mid);
    }

    // Start or update meetings
    for (const m of meetingsData) {
        if (activeMeetings[m.id]) continue;  // Already active

        const participantKeys = Array.isArray(m.participants) && m.participants.length ? m.participants : (m.agents || []);
        const meetingAgents = participantKeys.map(key => agentMap[key]).filter(Boolean);
        if (meetingAgents.length < 2) continue;

        const topic = m.topic || 'Discussion';
        const purpose = m.purpose || topic;
        const type = m.type || (meetingAgents.length <= 2 ? '1on1' : 'group');

        if (type === '1on1' && meetingAgents.length === 2) {
            // 1:1 — first agent visits second agent's desk
            const visitor = meetingAgents[0];
            const host = meetingAgents[1];
            visitor.visitAgent(host, topic);
            host.state = 'visiting';
            host.visitTarget = visitor.id;
            host.addIntent(`Meeting with ${visitor.name}: ${topic}`);
            activeMeetings[m.id] = { agents: meetingAgents, topic, purpose, type, organizer: m.organizer || participantKeys[0] || '', kind: m.kind || 'discussion', rules: m.rules || null };
            addGlobalLog(`🤝 ${visitor.name} → ${host.name}: ${topic}`);
        } else {
            // Group meeting — use meeting table if it exists, otherwise random cluster
            const slots = getMeetingSlots();
            const slotAssignments = [];
            if (slots.length > 0) {
                // Meeting at the table
                meetingAgents.forEach((agent, i) => {
                    const slot = slots[i % slots.length];
                    agent.joinMeeting(m.id, slot, topic);
                    slotAssignments.push({ agent: agent.id, slot });
                });
            } else {
                // No meeting table — cluster agents near first agent's position
                const anchor = meetingAgents[0];
                meetingAgents.forEach((agent, i) => {
                    const angle = (i / meetingAgents.length) * Math.PI * 2;
                    const slot = { x: anchor.x + Math.cos(angle) * 40, y: anchor.y + Math.sin(angle) * 40 };
                    agent.joinMeeting(m.id, slot, topic);
                    slotAssignments.push({ agent: agent.id, slot });
                });
            }
            activeMeetings[m.id] = { agents: meetingAgents, topic, purpose, type, organizer: m.organizer || participantKeys[0] || '', kind: m.kind || 'discussion', rules: m.rules || null, slotAssignments };
            addGlobalLog(`📊 Meeting: ${meetingAgents.map(a => a.name).join(', ')} — ${topic}`);
        }
    }
}

function endMeeting(meetingId) {
    const meeting = activeMeetings[meetingId];
    if (!meeting) return;
    meeting.agents.forEach(agent => {
        if (agent.meetingId === meetingId || agent.state === 'visiting') {
            agent.leaveMeeting();
        }
    });
    delete activeMeetings[meetingId];
    addGlobalLog(`✅ Meeting ended: ${meeting.topic}`);
}

// --- STATUS POLLING ---
function pollStatus() { /* no-op: server calls removed from engine */ }
// setInterval(pollStatus) removed — status set via updateAgentStatus()
// pollStatus() removed
// setInterval(pollAgentChat) removed — chat injected externally
// pollAgentChat() removed

// --- GLOBAL LOG (persisted to localStorage) ---
function _saveLog() { /* stubbed: DOM/server removed from engine */ }
function _restoreLog() { /* stubbed: DOM/server removed from engine */ }
// _restoreLog() removed

function addGlobalLog(msg) { if (typeof _onLog === "function") _onLog(msg); }

// --- SIDEBAR ---
function updateSidebar() { /* stubbed: DOM/server removed from engine */ }
// setInterval(updateSidebar) removed — no sidebar in engine

function branchCreatePrompt() { /* stubbed: DOM/server removed from engine */ }

function branchEditPrompt() { /* stubbed: DOM/server removed from engine */ }

function _getThemeColor(theme) {
    var map = {'branch-gold':'#ffd700','branch-blue':'#1565c0','branch-orange':'#e65100','branch-cyan':'#00bcd4','branch-red':'#ff6d00','branch-gray':'#90a4ae'};
    return map[theme] || '#888888';
}

function branchDeletePrompt() { /* stubbed: DOM/server removed from engine */ }

// --- ENVIRONMENT DRAWING ---
function drawEnvironment() {
    _tod = getTimeOfDaySky(); // refresh for time-lapse
    // --- FLOOR (from officeConfig) ---
    for (let x = 0; x < W; x += TILE) {
        for (let y = 0; y < H; y += TILE) {
            const alt = (Math.floor(x / TILE) + Math.floor(y / TILE)) % 2 === 0;
            ctx.fillStyle = alt ? officeConfig.floor.color1 : officeConfig.floor.color2;
            ctx.fillRect(x, y, TILE, TILE);
        }
    }

    // --- WALLS (from officeConfig) ---
    const wallH = officeConfig.walls.height;
    const renderedWallSections = getRenderedWallSections();
    const topWall = getTopWallConfig();
    ctx.fillStyle = '#455a64'; ctx.fillRect(0, 0, W, wallH); // base
    renderedWallSections.forEach(function(section) {
        ctx.fillStyle = section.color;
        ctx.fillRect(section.x, 0, section.w, wallH);
        ctx.fillStyle = section.accentColor;
        ctx.fillRect(section.x, wallH - 18, section.w, 18);
    });
    ctx.fillStyle = topWall.trimColor || officeConfig.walls.trimColor;
    ctx.fillRect(0, wallH - 4, W, 4);

    // --- HQ WINDOWS (north wall, flanking center text) ---
    // Time-of-day sky colors
    function getTimeOfDaySky() {
        const t = _getTimeHour();
        const sun = _getSunTimes();
        if (t < sun.dawn)                return { sky: '#0d1b2a', upper: '#162032', top: '#0a1020', cloud: 'rgba(200,200,255,0.12)', glow: 'rgba(40,60,120,0.15)', stars: true };
        if (t < sun.sunrise)             return { sky: '#e65100', upper: '#ff6d00', top: '#ffab40', cloud: 'rgba(255,220,180,0.3)', glow: 'rgba(255,160,60,0.22)', stars: false };
        if (t < sun.sunrise + 1.5)       return { sky: '#ff8a65', upper: '#ffab91', top: '#ffe082', cloud: 'rgba(255,255,255,0.4)', glow: 'rgba(255,200,100,0.18)', stars: false };
        if (t < sun.sunrise + 3)         return { sky: '#42a5f5', upper: '#64b5f6', top: '#e3f2fd', cloud: 'rgba(255,255,255,0.5)', glow: 'rgba(255,240,200,0.12)', stars: false };
        if (t < sun.sunset - 2)          return { sky: '#2196f3', upper: '#42a5f5', top: '#bbdefb', cloud: 'rgba(255,255,255,0.5)', glow: 'rgba(255,255,240,0.08)', stars: false };
        if (t < sun.sunset - 0.5)        return { sky: '#42a5f5', upper: '#64b5f6', top: '#ffe0b2', cloud: 'rgba(255,255,255,0.45)', glow: 'rgba(255,200,100,0.12)', stars: false };
        if (t < sun.sunset + 0.3)        return { sky: '#e65100', upper: '#ff6d00', top: '#ff8a65', cloud: 'rgba(255,200,150,0.35)', glow: 'rgba(255,120,40,0.22)', stars: false };
        if (t < sun.dusk)                return { sky: '#4a148c', upper: '#6a1b9a', top: '#e65100', cloud: 'rgba(180,160,255,0.2)', glow: 'rgba(150,80,180,0.15)', stars: false };
        return                                  { sky: '#0d1b2a', upper: '#162032', top: '#0a1020', cloud: 'rgba(200,200,255,0.12)', glow: 'rgba(40,60,120,0.15)', stars: true };
    }
    _tod = getTimeOfDaySky();

    function drawWindow(wx, wy, ww, wh) {
        // Outer sill / ledge
        ctx.fillStyle = '#999'; ctx.fillRect(wx - 4, wy - 4, ww + 8, wh + 8);
        // Inner frame
        ctx.fillStyle = '#e0e0e0'; ctx.fillRect(wx - 2, wy - 2, ww + 4, wh + 4);
        // Glass — sky (time-of-day)
        ctx.fillStyle = _tod.sky; ctx.fillRect(wx, wy, ww, wh);
        ctx.fillStyle = _tod.upper; ctx.fillRect(wx, wy, ww, Math.floor(wh * 0.35));
        ctx.fillStyle = _tod.top; ctx.fillRect(wx, wy, ww, Math.floor(wh * 0.15));
        // Stars at night (twinkling)
        if (_tod.stars) {
            var _stars = [
                { x: 6, y: 8, s: 2 }, { x: 18, y: 4, s: 1 }, { x: 12, y: 18, s: 2 },
                { x: 28, y: 12, s: 1 }, { x: 24, y: 6, s: 1.5 }, { x: 8, y: 28, s: 1 },
                { x: 32, y: 20, s: 1 }, { x: 15, y: 32, s: 1.5 }, { x: 3, y: 22, s: 1 }
            ];
            for (var si = 0; si < _stars.length; si++) {
                var star = _stars[si];
                // Each star twinkles at its own rate
                var twinkle = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(_weatherTick * 0.04 + si * 2.3));
                ctx.fillStyle = 'rgba(255,255,255,' + twinkle.toFixed(2) + ')';
                ctx.fillRect(wx + star.x, wy + star.y, star.s, star.s);
            }
            // Moon — left window only
            if (wx < 500) {
                ctx.fillStyle = 'rgba(255,255,220,0.8)';
                ctx.fillRect(wx + ww - 12, wy + 4, 6, 6);
                ctx.fillStyle = _tod.sky;
                ctx.fillRect(wx + ww - 10, wy + 3, 5, 5); // crescent cutout
            }
        }
        // Clouds (skip at night)
        if (!_tod.stars) {
            ctx.fillStyle = _tod.cloud;
            ctx.fillRect(wx + 4, wy + 6, 8, 3);
            ctx.fillRect(wx + 6, wy + 4, 4, 2);
            ctx.fillRect(wx + ww - 14, wy + 10, 6, 2);
            ctx.fillRect(wx + ww - 12, wy + 8, 4, 2);
        }
        // Weather effects on glass (isLeft=true for left window only — sun/moon)
        if (_displayPrefs.showWeather !== false) drawWeatherOnWindow(wx, wy, ww, wh, wx < 500);
        // Cross panes (thicker) — always on top
        ctx.fillStyle = '#fff';
        ctx.fillRect(wx + Math.floor(ww / 2) - 1, wy, 3, wh);  // vertical
        ctx.fillRect(wx, wy + Math.floor(wh / 2) - 1, ww, 3);  // horizontal
        // Pane corner accents
        ctx.fillStyle = '#ccc';
        ctx.fillRect(wx + Math.floor(ww/2) - 2, wy + Math.floor(wh/2) - 2, 5, 5);
        // Subtle glass shine — small corner highlights only (don't cover the sky)
        ctx.fillStyle = 'rgba(255,255,255,0.15)';
        ctx.fillRect(wx + 2, wy + 2, 5, 3);   // top-left glint
        ctx.fillRect(wx + 3, wy + 4, 3, 2);
        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        const px = wx + Math.floor(ww/2) + 4, py = wy + Math.floor(wh/2) + 4;
        ctx.fillRect(px, py, 4, 3);            // bottom-right glint
        // Bottom sill detail
        ctx.fillStyle = '#bbb';
        ctx.fillRect(wx - 3, wy + wh + 2, ww + 6, 3);
        ctx.fillStyle = '#ddd';
        ctx.fillRect(wx - 2, wy + wh + 2, ww + 4, 1);
        // --- LIGHT PROJECTION on floor below window (gradient fade) ---
        var lightTop = wy + wh + 5;
        var lightBottom = wy + wh + 120;
        var lightGrad = ctx.createLinearGradient(0, lightTop, 0, lightBottom);
        lightGrad.addColorStop(0, _tod.glow);
        lightGrad.addColorStop(0.4, _tod.glow.replace(/[\d.]+\)$/, function(m) { return (parseFloat(m) * 0.5).toFixed(2) + ')'; }));
        lightGrad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = lightGrad;
        ctx.beginPath();
        ctx.moveTo(wx - 2, lightTop);
        ctx.lineTo(wx + ww + 2, lightTop);
        ctx.lineTo(wx + ww + 40, lightBottom);
        ctx.lineTo(wx - 40, lightBottom);
        ctx.closePath();
        ctx.fill();
    }

    // --- SECTION LABELS ---
    ctx.font = 'bold 10px "Press Start 2P", monospace'; ctx.textAlign = 'center';
    // Branch signs are now rendered as branchSign furniture items

    // --- INTERIOR WALL SHADOWS (above floor, below everything else) ---
    drawInteriorWallShadows();

    // --- INTERIOR WALLS (drawn before furniture so items aren't hidden behind walls) ---
    drawInteriorWalls();

    // --- FURNITURE (data-driven from officeConfig) — non-label items first ---
    officeConfig.furniture.forEach(function(item) {
        if (item.type !== 'branchSign' && item.type !== 'textLabel') drawFurnitureItem(item);
    });

    // --- LABELS (drawn on top of everything) ---
    officeConfig.furniture.forEach(function(item) {
        if (item.type === 'branchSign' || item.type === 'textLabel') drawFurnitureItem(item);
    });
}

// ============================================================
// INTERIOR WALLS
// ============================================================

function _wallMainColor(wall) {
    return (wall && wall.color) || '#546e7a';
}
function _wallAccentColor(wall) {
    return (wall && wall.accentColor) || _wallMainColor(wall);
}
function _wallTrimColor(wall) {
    return (wall && wall.trimColor) || '#ffffff';
}
function _wallTrim2Color(wall) {
    return (wall && wall.trim2Color) || '#37474f';
}

function drawInteriorWallShadows() {
    var interior = officeConfig.walls && officeConfig.walls.interior;
    if (!interior || interior.length === 0) return;
    var wallThick = 6;
    interior.forEach(function(wall) {
        if (wall.x1 === wall.x2) return;
        var px = Math.min(wall.x1, wall.x2) * TILE;
        var py = wall.y1 * TILE - Math.floor(wallThick / 2);
        var pw = Math.abs(wall.x2 - wall.x1) * TILE;
        if (pw <= 0) return;
        ctx.fillStyle = 'rgba(0,0,0,0.12)';
        ctx.fillRect(px, py + wallThick, pw, 15);
    });
}

function _drawSingleWall(wall, idx) {
    var wallThick = 6;
    var isSel = (editMode && selectedWallIdx === idx);
    var mainColor = isSel ? '#ffd600' : _wallMainColor(wall);
    if (wall.x1 === wall.x2) {
        // Vertical wall
        var px = wall.x1 * TILE - Math.floor(wallThick / 2);
        var py = Math.min(wall.y1, wall.y2) * TILE;
        var ph = Math.abs(wall.y2 - wall.y1) * TILE;
        if (ph <= 0) return;
        // Shadow (right side depth)
        ctx.fillStyle = 'rgba(0,0,0,0.28)';
        ctx.fillRect(px + wallThick, py + 2, 3, ph - 2);
        // Main wall body
        ctx.fillStyle = mainColor;
        ctx.fillRect(px, py, wallThick, ph);
        // Highlight (left edge)
        ctx.fillStyle = isSel ? 'rgba(255,255,200,0.5)' : 'rgba(255,255,255,0.20)';
        ctx.fillRect(px, py, 2, ph);
        // Dark right edge (inner shadow)
        ctx.fillStyle = 'rgba(0,0,0,0.18)';
        ctx.fillRect(px + wallThick - 2, py, 2, ph);
    } else {
        // Horizontal wall with upward wall face
        var px = Math.min(wall.x1, wall.x2) * TILE;
        var py = wall.y1 * TILE - Math.floor(wallThick / 2);
        var pw = Math.abs(wall.x2 - wall.x1) * TILE;
        var faceH = 36;
        if (pw <= 0) return;
        // Main wall body / face
        ctx.fillStyle = isSel ? '#f9a825' : mainColor;
        ctx.fillRect(px + 1, py - faceH, pw - 2, faceH);
        // Trim stripe
        ctx.fillStyle = isSel ? '#fff3b0' : _wallTrimColor(wall);
        ctx.fillRect(px + 1, py - 8, pw - 2, 4);
        // Trim 2 lower band + map-plane edge merged together
        ctx.fillStyle = isSel ? '#ffca28' : _wallTrim2Color(wall);
        ctx.fillRect(px, py - 4, pw, wallThick + 4);
        // Top cap highlight
        ctx.fillStyle = isSel ? 'rgba(255,245,180,0.45)' : 'rgba(255,255,255,0.12)';
        ctx.fillRect(px + 2, py - faceH, pw - 4, 2);
    }
}

function _verticalWallGoesDown(wall, interior) {
    // A vertical wall "goes down" if its top end connects to a horizontal wall
    // and the wall extends downward from that junction
    if (wall.x1 !== wall.x2) return false; // not vertical
    var topY = Math.min(wall.y1, wall.y2);
    var wallX = wall.x1;
    for (var i = 0; i < interior.length; i++) {
        var hw = interior[i];
        if (hw.x1 === hw.x2) continue; // skip other verticals
        var hLeft = Math.min(hw.x1, hw.x2);
        var hRight = Math.max(hw.x1, hw.x2);
        if (wallX >= hLeft && wallX <= hRight && Math.abs(topY - hw.y1) <= 1) {
            return true; // top of vertical wall meets a horizontal wall — it goes down
        }
    }
    return false;
}

function drawInteriorWalls() {
    var interior = officeConfig.walls && officeConfig.walls.interior;
    if (!interior || interior.length === 0) return;
    // Pass 1: vertical walls going UP + all horizontal walls
    interior.forEach(function(wall, idx) {
        if (wall.x1 === wall.x2 && _verticalWallGoesDown(wall, interior)) return; // skip downward verticals
        _drawSingleWall(wall, idx);
    });
    // Pass 2: vertical walls going DOWN (drawn on top of horizontal walls)
    interior.forEach(function(wall, idx) {
        if (wall.x1 === wall.x2 && _verticalWallGoesDown(wall, interior)) {
            _drawSingleWall(wall, idx);
        }
    });
}

function drawInteriorWallOccluders() {
    var interior = officeConfig.walls && officeConfig.walls.interior;
    if (!interior || interior.length === 0) return;
    var wallThick = 6;
    var faceH = 36;
    interior.forEach(function(wall, idx) {
        var isSel = (editMode && selectedWallIdx === idx);
        if (wall.x1 !== wall.x2) {
            var px = Math.min(wall.x1, wall.x2) * TILE;
            var py = wall.y1 * TILE - Math.floor(wallThick / 2);
            var pw = Math.abs(wall.x2 - wall.x1) * TILE;
            if (pw <= 0) return;
            ctx.fillStyle = isSel ? '#f9a825' : _wallMainColor(wall);
            ctx.fillRect(px + 1, py - faceH, pw - 2, faceH);
            ctx.fillStyle = isSel ? 'rgba(255,245,180,0.35)' : 'rgba(255,255,255,0.10)';
            ctx.fillRect(px + 2, py - faceH, pw - 4, 2);
            ctx.fillStyle = isSel ? '#fff3b0' : _wallTrimColor(wall);
            ctx.fillRect(px + 1, py - 8, pw - 2, 4);
            ctx.fillStyle = isSel ? '#ffca28' : _wallTrim2Color(wall);
            ctx.fillRect(px, py - 4, pw, wallThick + 4);
            // No manual ambient tint needed — ambient overlay draws after occluders now
        }
    });
}

function _isFurnitureNearHorizontalWall(item) {
    var interior = (officeConfig.walls && officeConfig.walls.interior) || [];
    var bounds = FURNITURE_BOUNDS[item.type] || { w: 40, h: 40 };
    var ix = item.x, iy = item.y, iw = bounds.w, ih = bounds.h;
    for (var i = 0; i < interior.length; i++) {
        var wall = interior[i];
        if (wall.x1 === wall.x2) continue; // skip vertical walls
        var px = Math.min(wall.x1, wall.x2) * TILE;
        var pw = Math.abs(wall.x2 - wall.x1) * TILE;
        var py = wall.y1 * TILE;
        var faceH = 36;
        // Check if furniture overlaps the wall's face area (with some margin)
        if (ix + iw > px && ix < px + pw && iy < py + 10 && iy + ih > py - faceH - 16) {
            return true;
        }
    }
    return false;
}

// Classify furniture as IN FRONT of a horizontal wall (should render on top of occluders)
// vs BEHIND it (should stay behind occluders, i.e. NOT redrawn after occluders).
// "In front" = furniture's bottom edge is at or below the wall base line.
// Uses FURNITURE_BOUNDS to compute the actual visual bottom edge.
function _isFurnitureInFrontOfWall(item) {
    var interior = (officeConfig.walls && officeConfig.walls.interior) || [];
    var bounds = FURNITURE_BOUNDS[item.type] || { w: 40, h: 40, ox: 0, oy: 0 };
    var ox = bounds.ox || 0, oy = bounds.oy || 0;
    // Compute the visual bottom Y of this furniture item
    var itemBottomY = item.y + bounds.h * (1 - oy);

    for (var i = 0; i < interior.length; i++) {
        var wall = interior[i];
        if (wall.x1 === wall.x2) continue; // skip vertical walls
        var px = Math.min(wall.x1, wall.x2) * TILE;
        var pw = Math.abs(wall.x2 - wall.x1) * TILE;
        var py = wall.y1 * TILE; // wall base line in pixels
        var faceH = 36;

        // Item must horizontally overlap the wall
        var itemLeft = item.x - bounds.w * ox;
        var itemRight = itemLeft + bounds.w;
        if (itemRight <= px || itemLeft >= px + pw) continue;

        // Check if near this wall (same vertical range as _isFurnitureNearHorizontalWall)
        var itemTopY = item.y - bounds.h * oy;
        if (itemTopY >= py + 10 || itemBottomY <= py - faceH - 16) continue;

        // Near this wall — is the item IN FRONT (below wall base)?
        // Wall base is at py. Furniture whose bottom edge extends past py is in front.
        if (itemBottomY >= py - 4) {
            return true; // in front — should be redrawn after occluders
        }
        // Otherwise, furniture is behind — should NOT be redrawn after occluders
        return false;
    }
    // Not near any wall
    return false;
}

// Check if a desk (by agent desk coords) is behind a horizontal wall
// Used to decide whether desk char items should be drawn before or after occluders
function _isDeskBehindHorizontalWall(deskX, deskY) {
    var interior = (officeConfig.walls && officeConfig.walls.interior) || [];
    var bounds = FURNITURE_BOUNDS['desk'] || { w: 72, h: 76, ox: 0.5, oy: 0.66 };
    var deskBottomY = deskY + bounds.h * (1 - (bounds.oy || 0));
    for (var i = 0; i < interior.length; i++) {
        var wall = interior[i];
        if (wall.x1 === wall.x2) continue;
        var px = Math.min(wall.x1, wall.x2) * TILE;
        var pw = Math.abs(wall.x2 - wall.x1) * TILE;
        var py = wall.y1 * TILE;
        var faceH = 36;
        // Check horizontal overlap
        if (deskX < px || deskX > px + pw) continue;
        // Check vertical proximity (same as agent behind-wall check)
        if (deskY >= py - faceH - 16 && deskY < py + 10) {
            // Desk is near this wall — is it behind?
            if (deskBottomY < py - 4) return true; // behind
        }
    }
    return false;
}

function _isAgentBehindHorizontalWall(agent) {
    var interior = (officeConfig.walls && officeConfig.walls.interior) || [];
    for (var i = 0; i < interior.length; i++) {
        var wall = interior[i];
        if (wall.x1 === wall.x2) continue;
        var px = Math.min(wall.x1, wall.x2) * TILE;
        var pw = Math.abs(wall.x2 - wall.x1) * TILE;
        var py = wall.y1 * TILE - Math.floor(6 / 2);
        var faceH = 36;
        if (agent.x >= px && agent.x <= px + pw && agent.y >= py - faceH - 8 && agent.y < py + 2) {
            return true;
        }
    }
    return false;
}

// ============================================================
// COLLISION GRID
// ============================================================

function buildCollisionGrid() {
    var cols = Math.ceil(W / TILE);
    var rows = Math.ceil(H / TILE);
    collisionGrid = [];
    for (var ty = 0; ty < rows; ty++) {
        collisionGrid[ty] = [];
        for (var tx = 0; tx < cols; tx++) {
            collisionGrid[ty][tx] = { top: false, right: false, bottom: false, left: false };
        }
    }
    // Mark canvas boundaries
    for (var tx = 0; tx < cols; tx++) {
        collisionGrid[0][tx].top = true;
        collisionGrid[rows - 1][tx].bottom = true;
    }
    for (var ty = 0; ty < rows; ty++) {
        collisionGrid[ty][0].left = true;
        collisionGrid[ty][cols - 1].right = true;
    }
    // Mark interior walls
    var interior = (officeConfig.walls && officeConfig.walls.interior) || [];
    interior.forEach(function(wall) {
        if (wall.x1 === wall.x2) {
            // Vertical wall at tile column wall.x1 (boundary between col x1-1 and x1)
            var minY = Math.min(wall.y1, wall.y2);
            var maxY = Math.max(wall.y1, wall.y2);
            var wallTx = wall.x1;
            for (var ty = minY; ty < maxY; ty++) {
                if (ty < 0 || ty >= rows) continue;
                if (wallTx < cols) collisionGrid[ty][wallTx].left = true;
                if (wallTx > 0 && wallTx - 1 < cols) collisionGrid[ty][wallTx - 1].right = true;
            }
        } else {
            // Horizontal wall at tile row wall.y1 (boundary between row y1-1 and y1)
            var minX = Math.min(wall.x1, wall.x2);
            var maxX = Math.max(wall.x1, wall.x2);
            var wallTy = wall.y1;
            for (var tx = minX; tx < maxX; tx++) {
                if (tx < 0 || tx >= cols) continue;
                if (wallTy < rows) collisionGrid[wallTy][tx].top = true;
                if (wallTy > 0 && wallTy - 1 < rows) collisionGrid[wallTy - 1][tx].bottom = true;
            }
        }
    });
}

// ============================================================
// A* PATHFINDING
// ============================================================

function findPath(startX, startY, endX, endY) {
    if (!collisionGrid) return null;
    var cols = Math.ceil(W / TILE);
    var rows = Math.ceil(H / TILE);
    var sx = Math.max(0, Math.min(cols - 1, Math.floor(startX / TILE)));
    var sy = Math.max(0, Math.min(rows - 1, Math.floor(startY / TILE)));
    var ex = Math.max(0, Math.min(cols - 1, Math.floor(endX / TILE)));
    var ey = Math.max(0, Math.min(rows - 1, Math.floor(endY / TILE)));
    if (sx === ex && sy === ey) return [];
    var startNode = { x: sx, y: sy, g: 0, h: Math.abs(ex - sx) + Math.abs(ey - sy), f: 0, parent: null };
    startNode.f = startNode.h;
    var open = [startNode];
    var closed = {};
    var openMap = {};
    openMap[sy * cols + sx] = startNode;
    var dirs = [
        { dx: 0,  dy: -1, check: 'top'    },
        { dx: 1,  dy:  0, check: 'right'  },
        { dx: 0,  dy:  1, check: 'bottom' },
        { dx: -1, dy:  0, check: 'left'   },
    ];
    var maxIter = cols * rows * 2;
    var iter = 0;
    while (open.length > 0 && iter < maxIter) {
        iter++;
        var bestIdx = 0;
        for (var i = 1; i < open.length; i++) {
            if (open[i].f < open[bestIdx].f) bestIdx = i;
        }
        var current = open[bestIdx];
        open.splice(bestIdx, 1);
        var key = current.y * cols + current.x;
        closed[key] = true;
        delete openMap[key];
        if (current.x === ex && current.y === ey) {
            var path = [];
            var node = current;
            while (node) {
                path.unshift({ x: node.x * TILE + TILE / 2, y: node.y * TILE + TILE / 2 });
                node = node.parent;
            }
            if (path.length > 0) path.shift(); // remove start position
            return path;
        }
        for (var d = 0; d < dirs.length; d++) {
            var dir = dirs[d];
            var nx = current.x + dir.dx;
            var ny = current.y + dir.dy;
            if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;
            var nkey = ny * cols + nx;
            if (closed[nkey]) continue;
            var crow = collisionGrid[current.y];
            if (!crow || !crow[current.x]) continue;
            if (crow[current.x][dir.check]) continue; // wall blocks this direction
            var g = current.g + 1;
            var h = Math.abs(ex - nx) + Math.abs(ey - ny);
            var f = g + h;
            if (openMap[nkey]) {
                if (openMap[nkey].g <= g) continue;
                openMap[nkey].g = g; openMap[nkey].h = h; openMap[nkey].f = f; openMap[nkey].parent = current;
            } else {
                var neighbor = { x: nx, y: ny, g: g, h: h, f: f, parent: current };
                open.push(neighbor);
                openMap[nkey] = neighbor;
            }
        }
    }
    return null; // no path
}

function _deleteSelectedWall() {
    if (selectedWallIdx === null) return;
    _pushUndo();
    officeConfig.walls.interior.splice(selectedWallIdx, 1);
    selectedWallIdx = null;
    buildCollisionGrid();
}

function drawWhiteboard(x, y) {
    ctx.fillStyle = '#eceff1'; ctx.fillRect(x, y, 28, 40);
    ctx.fillStyle = '#fafafa'; ctx.fillRect(x + 2, y + 2, 24, 36);
    // Scribbles
    ctx.strokeStyle = '#1976d2'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x+5,y+8); ctx.lineTo(x+20,y+10); ctx.stroke();
    ctx.strokeStyle = '#d32f2f';
    ctx.beginPath(); ctx.moveTo(x+5,y+16); ctx.lineTo(x+18,y+15); ctx.stroke();
    ctx.strokeStyle = '#388e3c';
    ctx.beginPath(); ctx.moveTo(x+5,y+24); ctx.lineTo(x+22,y+23); ctx.stroke();
    // Marker tray
    ctx.fillStyle = '#bdbdbd'; ctx.fillRect(x + 4, y + 40, 20, 3);
    ctx.fillStyle = '#d32f2f'; ctx.fillRect(x + 6, y + 40, 4, 3);
    ctx.fillStyle = '#1976d2'; ctx.fillRect(x + 12, y + 40, 4, 3);
    ctx.fillStyle = '#388e3c'; ctx.fillRect(x + 18, y + 40, 4, 3);
}

function drawWindow(x, y) {
    ctx.fillStyle = '#eceff1'; ctx.fillRect(x, y, 60, 40);
    ctx.fillStyle = '#81d4fa'; ctx.fillRect(x + 4, y + 4, 52, 32);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.beginPath(); ctx.moveTo(x + 40, y + 4); ctx.lineTo(x + 56, y + 4); ctx.lineTo(x + 10, y + 36); ctx.lineTo(x + 4, y + 36); ctx.fill();
    ctx.strokeStyle = '#b0bec5'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x + 30, y + 4); ctx.lineTo(x + 30, y + 36); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + 4, y + 20); ctx.lineTo(x + 56, y + 20); ctx.stroke();
    ctx.lineWidth = 1;
}

function drawClock(x, y) {
    ctx.fillStyle = '#546e7a'; ctx.beginPath(); ctx.arc(x, y, 14, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, 11, 0, Math.PI * 2); ctx.fill();
    const now = new Date();
    const ha = (now.getHours() % 12 + now.getMinutes() / 60) * (Math.PI * 2 / 12) - Math.PI / 2;
    const ma = (now.getMinutes() / 60) * Math.PI * 2 - Math.PI / 2;
    ctx.strokeStyle = '#333'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(ha) * 6, y + Math.sin(ha) * 6); ctx.stroke();
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(ma) * 9, y + Math.sin(ma) * 9); ctx.stroke();
}

function drawDesk(x, y) {
    ctx.save(); ctx.translate(x, y);
    // Desk shadow
    ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fillRect(-36, -20, 76, 54);
    // Desk surface
    ctx.fillStyle = '#8d6e63'; ctx.fillRect(-35, -25, 70, 45);
    ctx.fillStyle = '#a1887f'; ctx.fillRect(-33, -23, 66, 41);
    // Desk edge
    ctx.fillStyle = '#6d4c41'; ctx.fillRect(-35, 18, 70, 4);
    // Desk legs
    ctx.fillStyle = '#5d4037'; ctx.fillRect(-33, 20, 4, 6); ctx.fillRect(29, 20, 4, 6);
    // Monitor
    ctx.fillStyle = '#263238'; ctx.fillRect(-20, -48, 40, 26);
    ctx.fillStyle = '#0d47a1'; ctx.fillRect(-17, -45, 34, 20);
    // Screen glow
    ctx.fillStyle = 'rgba(33,150,243,0.15)'; ctx.fillRect(-22, -50, 44, 30);
    // Screen content pixels
    ctx.fillStyle = '#4fc3f7';
    ctx.fillRect(-14, -42, 12, 2); ctx.fillRect(-14, -38, 20, 2); ctx.fillRect(-14, -34, 8, 2);
    // Monitor stand
    ctx.fillStyle = '#37474f'; ctx.fillRect(-5, -22, 10, 4);
    // Keyboard
    ctx.fillStyle = '#455a64'; ctx.fillRect(-15, -18, 30, 8);
    ctx.fillStyle = '#546e7a';
    for (let i = 0; i < 5; i++) ctx.fillRect(-13 + i * 6, -16, 4, 2);
    for (let i = 0; i < 4; i++) ctx.fillRect(-10 + i * 6, -13, 4, 2);
    // Mouse
    ctx.fillStyle = '#78909c'; ctx.fillRect(20, -5, 6, 8);
    ctx.fillStyle = '#90a4ae'; ctx.fillRect(21, -4, 4, 3);

    // Desk item spots: left (-28, 5) and right (24, 4)
    // Items drawn dynamically by agent (carry system or defaults)
    ctx.restore();
}

function drawBossDesk(x, y) {
    ctx.save(); ctx.translate(x, y);
    // Bounds: 130×90, origin at center (0,0) → draws from -65,-45 to 65,45

    // === LEGS (visible at front, peeking below desk) ===
    ctx.fillStyle = '#3e2723';
    // Front legs
    ctx.fillRect(-58, 36, 6, 10);
    ctx.fillRect(52, 36, 6, 10);
    // Back legs (partially hidden)
    ctx.fillRect(-58, -40, 6, 6);
    ctx.fillRect(52, -40, 6, 6);
    // Leg highlights
    ctx.fillStyle = '#5d4037';
    ctx.fillRect(-57, 37, 2, 8);
    ctx.fillRect(53, 37, 2, 8);

    // === DESK SHADOW ===
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.fillRect(-60, -38, 124, 84);

    // === DESK BODY (L-shaped return) ===
    // Main desktop surface
    ctx.fillStyle = '#5d4037';
    ctx.fillRect(-62, -42, 124, 78);
    // Polished wood surface
    ctx.fillStyle = '#795548';
    ctx.fillRect(-60, -40, 120, 74);
    // Rich wood grain top
    ctx.fillStyle = '#8d6e63';
    ctx.fillRect(-58, -38, 116, 70);

    // Wood grain lines (subtle)
    ctx.fillStyle = 'rgba(0,0,0,0.04)';
    ctx.fillRect(-58, -28, 116, 1);
    ctx.fillRect(-58, -14, 116, 1);
    ctx.fillRect(-58, 0, 116, 1);
    ctx.fillRect(-58, 14, 116, 1);

    // === SIDE PANEL / MODESTY PANEL (front face of desk) ===
    ctx.fillStyle = '#6d4c41';
    ctx.fillRect(-62, 28, 124, 8);
    // Panel detail line
    ctx.fillStyle = '#5d4037';
    ctx.fillRect(-60, 30, 120, 1);
    ctx.fillRect(-60, 34, 120, 1);

    // === DESK EDGE (polished trim) ===
    ctx.fillStyle = '#4e342e';
    ctx.fillRect(-62, -42, 124, 3);
    ctx.fillRect(-62, -42, 3, 78);
    ctx.fillRect(59, -42, 3, 78);

    // Gold accent trim along front edge
    ctx.fillStyle = 'rgba(255,215,0,0.25)';
    ctx.fillRect(-60, 33, 120, 1);

    // === LEFT DRAWER UNIT ===
    ctx.fillStyle = '#6d4c41';
    ctx.fillRect(-56, -10, 28, 36);
    ctx.fillStyle = '#795548';
    ctx.fillRect(-54, -8, 24, 14);
    ctx.fillRect(-54, 8, 24, 16);
    // Drawer handles (gold)
    ctx.fillStyle = '#ffd700';
    ctx.fillRect(-46, -2, 10, 2);
    ctx.fillRect(-46, 14, 10, 2);
    // Handle shine
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.fillRect(-44, -2, 4, 1);
    ctx.fillRect(-44, 14, 4, 1);

    // === RIGHT DRAWER UNIT ===
    ctx.fillStyle = '#6d4c41';
    ctx.fillRect(28, -10, 28, 36);
    ctx.fillStyle = '#795548';
    ctx.fillRect(30, -8, 24, 14);
    ctx.fillRect(30, 8, 24, 16);
    // Drawer handles (gold)
    ctx.fillStyle = '#ffd700';
    ctx.fillRect(38, -2, 10, 2);
    ctx.fillRect(38, 14, 10, 2);
    // Handle shine
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.fillRect(40, -2, 4, 1);
    ctx.fillRect(40, 14, 4, 1);

    // === DUAL MONITORS ===
    // Left monitor
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(-40, -36, 34, 24);
    ctx.fillStyle = '#263238';
    ctx.fillRect(-38, -34, 30, 20);
    // Screen glow
    ctx.fillStyle = '#4fc3f7';
    ctx.fillRect(-36, -32, 26, 16);
    // Screen content
    ctx.fillStyle = '#81d4fa';
    ctx.fillRect(-34, -30, 10, 3);
    ctx.fillRect(-34, -25, 18, 2);
    ctx.fillRect(-34, -21, 14, 2);
    // Monitor stand
    ctx.fillStyle = '#37474f';
    ctx.fillRect(-28, -12, 12, 3);
    ctx.fillRect(-25, -14, 6, 2);

    // Right monitor
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(6, -36, 34, 24);
    ctx.fillStyle = '#263238';
    ctx.fillRect(8, -34, 30, 20);
    ctx.fillStyle = '#4fc3f7';
    ctx.fillRect(10, -32, 26, 16);
    // Chart/graph on screen
    ctx.fillStyle = '#4caf50';
    ctx.fillRect(14, -26, 4, 8);
    ctx.fillRect(20, -28, 4, 10);
    ctx.fillStyle = '#ff9800';
    ctx.fillRect(26, -24, 4, 6);
    ctx.fillRect(32, -30, 4, 12);
    // Monitor stand
    ctx.fillStyle = '#37474f';
    ctx.fillRect(16, -12, 12, 3);
    ctx.fillRect(19, -14, 6, 2);

    // === KEYBOARD ===
    ctx.fillStyle = '#333';
    ctx.fillRect(-14, -8, 28, 8);
    ctx.fillStyle = '#444';
    ctx.fillRect(-12, -6, 24, 4);
    // Key rows
    ctx.fillStyle = '#555';
    ctx.fillRect(-11, -5, 22, 1);
    ctx.fillRect(-11, -3, 22, 1);

    // === MOUSE ===
    ctx.fillStyle = '#333';
    ctx.fillRect(18, -6, 6, 8);
    ctx.fillStyle = '#444';
    ctx.fillRect(19, -5, 4, 3);

    // === DESK ITEMS ===
    // Coffee mug (left side)
    ctx.fillStyle = '#fff';
    ctx.fillRect(-50, -30, 7, 8);
    ctx.fillStyle = '#e0e0e0';
    ctx.fillRect(-49, -29, 5, 6);
    ctx.fillStyle = '#6d4c41';
    ctx.fillRect(-48, -28, 3, 4);
    // Mug handle
    ctx.fillStyle = '#fff';
    ctx.fillRect(-44, -28, 2, 4);

    // Pen holder (right side)
    ctx.fillStyle = '#455a64';
    ctx.fillRect(46, -28, 8, 10);
    ctx.fillStyle = '#546e7a';
    ctx.fillRect(47, -27, 6, 8);
    // Pens
    ctx.fillStyle = '#1565c0';
    ctx.fillRect(48, -32, 1, 6);
    ctx.fillStyle = '#c62828';
    ctx.fillRect(50, -31, 1, 5);
    ctx.fillStyle = '#2e7d32';
    ctx.fillRect(52, -30, 1, 4);

    // Notepad
    ctx.fillStyle = '#fffde7';
    ctx.fillRect(-52, -6, 14, 18);
    ctx.fillStyle = '#fff9c4';
    ctx.fillRect(-51, -5, 12, 16);
    // Lines on notepad
    ctx.fillStyle = '#e0e0e0';
    ctx.fillRect(-50, -2, 10, 1);
    ctx.fillRect(-50, 1, 10, 1);
    ctx.fillRect(-50, 4, 10, 1);

    // Small desk plant
    ctx.fillStyle = '#5d4037';
    ctx.fillRect(44, -6, 10, 8);
    ctx.fillStyle = '#4caf50';
    ctx.fillRect(46, -12, 3, 7);
    ctx.fillRect(50, -10, 3, 5);
    ctx.fillStyle = '#66bb6a';
    ctx.fillRect(45, -14, 4, 3);
    ctx.fillRect(49, -12, 4, 3);

    // === SURFACE HIGHLIGHT (top light reflection) ===
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(-58, -38, 116, 30);

    ctx.restore();
}

function drawFilingCabinet(x, y) {
    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.1)'; ctx.fillRect(x + 2, y + 2, 28, 55);
    // Cabinet body
    ctx.fillStyle = '#607d8b'; ctx.fillRect(x, y, 28, 55);
    ctx.fillStyle = '#78909c'; ctx.fillRect(x + 1, y + 1, 26, 53);
    // Drawers
    ctx.fillStyle = '#b0bec5';
    ctx.fillRect(x + 3, y + 3, 22, 14); ctx.fillRect(x + 3, y + 20, 22, 14); ctx.fillRect(x + 3, y + 37, 22, 14);
    // Handles
    ctx.fillStyle = '#ffd700';
    ctx.fillRect(x + 10, y + 8, 8, 3); ctx.fillRect(x + 10, y + 25, 8, 3); ctx.fillRect(x + 10, y + 42, 8, 3);
    // Label on top drawer
    ctx.fillStyle = '#fff'; ctx.fillRect(x + 7, y + 4, 14, 5);
    ctx.fillStyle = '#1565c0'; ctx.fillRect(x + 8, y + 5, 12, 3);
}

function drawTrashCan(x, y) {
    ctx.fillStyle = '#757575';
    ctx.beginPath(); ctx.ellipse(x, y + 10, 7, 3, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillRect(x - 7, y, 14, 10);
    ctx.fillStyle = '#bdbdbd';
    ctx.beginPath(); ctx.ellipse(x, y, 7, 3, 0, 0, Math.PI * 2); ctx.fill();
}

function drawMeetingRoom(x, y) {
    // Meeting table: 240px wide (6 tiles), 120px tall — inner table is 200px (5 tiles)
    var tw = 240, th = 120;
    var pad = 20;
    var tableX = x + pad, tableY = y + 28;
    var tableW = tw - pad * 2, tableH = 60;  // 200px wide table surface
    _setFurnitureLampShadow(x + tw / 2, y + th / 2);

    // Table shadow
    ctx.fillStyle = 'rgba(0,0,0,0.1)'; ctx.fillRect(tableX + 2, tableY + 4, tableW, tableH);
    // Table frame (dark wood)
    ctx.fillStyle = '#6d4c41'; ctx.fillRect(tableX, tableY, tableW, tableH);
    // Table surface
    ctx.fillStyle = '#8d6e63'; ctx.fillRect(tableX + 2, tableY + 2, tableW - 4, tableH - 4);
    ctx.fillStyle = '#a1887f'; ctx.fillRect(tableX + 4, tableY + 4, tableW - 8, tableH - 8);
    // Table edge
    ctx.fillStyle = '#5d4037'; ctx.fillRect(tableX, tableY + tableH - 4, tableW, 4);
    // Table legs (4 corners, symmetrical)
    ctx.fillStyle = '#4e342e';
    ctx.fillRect(tableX + 3, tableY + tableH, 5, 6);
    ctx.fillRect(tableX + tableW - 8, tableY + tableH, 5, 6);
    ctx.fillRect(tableX + 3, tableY - 4, 5, 4);
    ctx.fillRect(tableX + tableW - 8, tableY - 4, 5, 4);

    // Items on table
    ctx.fillStyle = '#fff'; ctx.fillRect(x + 50, tableY + 8, 14, 18);
    ctx.fillStyle = '#e0e0e0'; ctx.fillRect(x + 52, tableY + 10, 10, 4);
    ctx.fillStyle = '#263238'; ctx.fillRect(x + 90, tableY + 6, 28, 18);
    ctx.fillStyle = '#4fc3f7'; ctx.fillRect(x + 92, tableY + 8, 24, 12);
    ctx.fillStyle = '#455a64'; ctx.fillRect(x + 90, tableY + 22, 28, 3);
    ctx.fillStyle = '#fff';
    ctx.fillRect(x + 35, tableY + 16, 5, 6);
    ctx.fillRect(x + tw - 55, tableY + 16, 5, 6);

    // Chairs — 5 per side, evenly spaced across table width
    var chairW = 14;
    var chairSpacing = (tableW - chairW) / 4;  // 4 gaps for 5 chairs
    for (var i = 0; i < 5; i++) {
        var cx = tableX + i * chairSpacing;
        // Top row chairs
        ctx.fillStyle = '#37474f'; ctx.fillRect(cx, y + 8, chairW, 14);
        ctx.fillStyle = '#455a64'; ctx.fillRect(cx + 1, y + 9, chairW - 2, 12);
        ctx.fillStyle = '#546e7a'; ctx.fillRect(cx + 2, y + 10, chairW - 4, 6);
        // Bottom row chairs
        ctx.fillStyle = '#37474f'; ctx.fillRect(cx, y + 96, chairW, 14);
        ctx.fillStyle = '#455a64'; ctx.fillRect(cx + 1, y + 97, chairW - 2, 12);
        ctx.fillStyle = '#546e7a'; ctx.fillRect(cx + 2, y + 98, chairW - 4, 6);
    }
    _clearFurnitureShadow();
}

function drawReceptionDesk(item) {
    var x = item.x;
    var y = item.y;
    var rot = item.rotation || 0;

    ctx.save();
    ctx.translate(x, y);
    if (rot) ctx.rotate(rot * Math.PI / 180);

    _setFurnitureLampShadow(0, 0);

    // Center-origin reception desk: broad client-facing counter with a lower return shelf.
    // Bounds: 128×72, visual rect from -64,-36 to 64,36.
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(-60, -28, 124, 66);

    // Main curved-front cabinet mass.
    var frontGrad = ctx.createLinearGradient(0, -28, 0, 34);
    frontGrad.addColorStop(0, '#8d6e63');
    frontGrad.addColorStop(0.55, '#6d4c41');
    frontGrad.addColorStop(1, '#4e342e');
    ctx.fillStyle = frontGrad;
    ctx.fillRect(-62, -26, 124, 58);

    // Side depth blocks read like an office reception wraparound.
    ctx.fillStyle = '#5d4037';
    ctx.fillRect(-62, -26, 16, 58);
    ctx.fillRect(46, -26, 16, 58);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(-58, -23, 8, 48);
    ctx.fillRect(50, -23, 8, 48);

    // Raised transaction counter/top slab.
    ctx.fillStyle = '#3e2723';
    ctx.fillRect(-64, -36, 128, 18);
    ctx.fillStyle = '#a1887f';
    ctx.fillRect(-60, -34, 120, 12);
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(-56, -33, 112, 3);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(-64, -20, 128, 3);

    // Front inset panels and trim.
    ctx.strokeStyle = '#3e2723';
    ctx.lineWidth = 2;
    ctx.strokeRect(-42, -10, 32, 30);
    ctx.strokeRect(-2, -10, 32, 30);
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    ctx.fillRect(-39, -7, 26, 6);
    ctx.fillRect(1, -7, 26, 6);
    ctx.fillStyle = '#3e2723';
    ctx.fillRect(-62, 28, 124, 5);

    // Back work surface visible to the receptionist.
    ctx.fillStyle = '#795548';
    ctx.fillRect(-42, -16, 84, 12);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(-38, -15, 76, 3);

    // Computer monitor, keyboard, paperwork, bell, and small plant for scale/detail.
    ctx.fillStyle = '#263238';
    ctx.fillRect(-20, -31, 32, 18);
    ctx.fillStyle = '#4fc3f7';
    ctx.fillRect(-17, -28, 26, 12);
    ctx.fillStyle = '#1565c0';
    ctx.fillRect(-15, -26, 22, 3);
    ctx.fillStyle = '#37474f';
    ctx.fillRect(-8, -13, 8, 3);
    ctx.fillRect(-16, -10, 24, 3);

    ctx.fillStyle = '#eceff1';
    ctx.fillRect(18, -32, 16, 11);
    ctx.fillStyle = '#90caf9';
    ctx.fillRect(21, -29, 10, 2);
    ctx.fillStyle = '#fdd835';
    ctx.beginPath(); ctx.arc(42, -27, 5, Math.PI, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#6d4c41';
    ctx.fillRect(38, -27, 8, 2);

    ctx.fillStyle = '#4e342e';
    ctx.fillRect(-52, -33, 10, 8);
    ctx.fillStyle = '#43a047';
    ctx.fillRect(-54, -38, 5, 7);
    ctx.fillRect(-48, -40, 5, 9);
    ctx.fillRect(-43, -37, 5, 6);

    // Brass name plate makes it read clearly as reception.
    ctx.fillStyle = '#fbc02d';
    ctx.fillRect(-20, 8, 40, 8);
    ctx.fillStyle = '#5d4037';
    ctx.font = 'bold 5px "Press Start 2P", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('WELCOME', 0, 12);

    _clearFurnitureShadow();
    ctx.restore();
}

function drawPrinterCopier(item) {
    var x = item.x;
    var y = item.y;
    var rot = item.rotation || 0;
    var inUse = agents.some(function(a) {
        return (a.idleAction === 'print' || a.idleAction === 'copy' || a.idleAction === 'print_copy') &&
            !a.isSitting && Math.abs(a.x - x) < 70 && Math.abs(a.y - y) < 78;
    });

    ctx.save();
    ctx.translate(x, y);
    if (rot) ctx.rotate(rot * Math.PI / 180);

    _setFurnitureLampShadow(0, 6);

    // Center-origin 68×56 copier: cabinet body, scanner lid, control panel, output tray, paper stack.
    ctx.fillStyle = 'rgba(0,0,0,0.16)';
    ctx.fillRect(-31, -17, 66, 52);

    // Lower rolling cabinet.
    var baseGrad = ctx.createLinearGradient(0, -8, 0, 31);
    baseGrad.addColorStop(0, '#eceff1');
    baseGrad.addColorStop(0.55, '#cfd8dc');
    baseGrad.addColorStop(1, '#90a4ae');
    ctx.fillStyle = baseGrad;
    ctx.fillRect(-30, -8, 60, 38);
    ctx.strokeStyle = '#607d8b';
    ctx.lineWidth = 1;
    ctx.strokeRect(-29.5, -7.5, 59, 37);

    // Paper drawers with pixel handles.
    ctx.fillStyle = '#dfe7ea';
    ctx.fillRect(-25, -3, 50, 10);
    ctx.fillRect(-25, 10, 50, 10);
    ctx.fillStyle = '#b0bec5';
    ctx.fillRect(-25, 7, 50, 2);
    ctx.fillRect(-25, 20, 50, 2);
    ctx.fillStyle = '#607d8b';
    ctx.fillRect(-6, 2, 12, 2);
    ctx.fillRect(-6, 15, 12, 2);
    ctx.fillStyle = '#455a64';
    ctx.fillRect(-23, 27, 8, 3);
    ctx.fillRect(15, 27, 8, 3);

    // Scanner bed / top lid.
    ctx.fillStyle = '#78909c';
    ctx.fillRect(-32, -22, 64, 17);
    ctx.fillStyle = '#f7fbfc';
    ctx.fillRect(-29, -25, 50, 15);
    ctx.fillStyle = '#d5e2e7';
    ctx.fillRect(-26, -22, 44, 9);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillRect(-24, -21, 22, 2);
    ctx.fillStyle = '#90a4ae';
    ctx.fillRect(21, -22, 9, 13);

    // Angled-ish dark output mouth and fresh paper.
    ctx.fillStyle = '#455a64';
    ctx.fillRect(-20, -8, 40, 8);
    ctx.fillStyle = '#263238';
    ctx.fillRect(-18, -6, 36, 4);
    ctx.fillStyle = inUse ? '#ffffff' : '#eef3f5';
    ctx.fillRect(-14, -12 + (inUse ? Math.sin(_weatherTick * 0.18) * 1 : 0), 28, 7);
    ctx.fillStyle = '#90caf9';
    ctx.fillRect(-10, -10, 20, 1);
    ctx.fillRect(-10, -7, 16, 1);

    // Right-side control panel with blinking status light.
    ctx.fillStyle = '#37474f';
    ctx.fillRect(23, -16, 12, 19);
    ctx.fillStyle = '#263238';
    ctx.fillRect(25, -14, 8, 6);
    ctx.fillStyle = inUse ? '#76ff03' : '#4fc3f7';
    ctx.fillRect(26, -13, 6, 2);
    ctx.fillStyle = inUse ? '#76ff03' : '#43a047';
    ctx.fillRect(26, -5, 3, 3);
    ctx.fillStyle = '#ef5350';
    ctx.fillRect(31, -5, 3, 3);
    ctx.fillStyle = '#ffca28';
    ctx.fillRect(26, 0, 8, 2);

    // Side vent pixels and copier label.
    ctx.fillStyle = '#78909c';
    for (var i = 0; i < 4; i++) ctx.fillRect(-24 + i * 5, 24, 3, 2);
    ctx.fillStyle = '#455a64';
    ctx.font = 'bold 5px "Press Start 2P", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('COPY', 0, 25);

    if (inUse) {
        ctx.fillStyle = 'rgba(118,255,3,0.25)';
        ctx.fillRect(24, -15, 10, 8);
    }

    _clearFurnitureShadow();
    ctx.restore();
}

// --- FURNITURE ITEM DISPATCHER ---
// Called by drawEnvironment for each item in officeConfig.furniture.
function drawFurnitureItem(item) {
    switch (item.type) {
        case 'desk':          drawDesk(item.x, item.y);          break;
        case 'bossDesk':      drawBossDesk(item.x, item.y);      break;
        case 'receptionDesk': drawReceptionDesk(item);           break;
        case 'printerCopier': drawPrinterCopier(item);           break;
        case 'trashCan':      drawTrashCan(item.x, item.y);      break;
        case 'filingCabinet': drawFilingCabinet(item.x, item.y); break;
        case 'whiteboard':    drawWhiteboard(item.x, item.y);    break;
        case 'plant':         drawPlant(item.x, item.y);         break;
        case 'tallPlant':     drawTallPlant(item.x, item.y);     break;
        case 'meetingTable':  drawMeetingRoom(item.x, item.y);   break;
        case 'lounge':        drawLoungeArea(item.x, item.y);    break;
        case 'breakArea':     drawBreakArea(item.x, item.y);     break;
        case 'engLounge':     drawEngLounge(item.x, item.y);     break;
        case 'pingPongTable': drawPingPongTable(item.x, item.y); break;
        case 'dartBoard':     drawDartBoard(item.x, item.y);     break;
        case 'vendingMachine':drawVendingMachine(item.x, item.y);break;
        case 'waterCooler':   drawWaterCooler(item.x, item.y);   break;
        case 'coffeeMaker':   drawCoffeeMakerStandalone(item.x, item.y); break;
        case 'microwave':     drawMicrowaveStandalone(item.x, item.y);   break;
        case 'toaster':       drawToasterStandalone(item.x, item.y);     break;
        case 'window':        drawWindow(item.x, item.y);        break;
        case 'interactiveWindow': drawInteractiveWindow(item); break;
        case 'clock':         drawClock(item.x, item.y);         break;
        case 'bookshelf':     drawBookshelf(item.x, item.y);     break;
        case 'couch':         drawCouch(item);                    break;
        case 'coffeeTable':   drawCoffeeTable(item.x, item.y);   break;
        case 'endTable':      drawEndTable(item.x, item.y);      break;
        case 'tv':            drawTV(item.x, item.y);            break;
        case 'kitchenCounter':drawKitchenCounter(item.x, item.y);break;
        case 'officeChair':   drawOfficeChair(item);              break;
        case 'diningTable':   drawDiningTable(item);              break;
        case 'sink':          drawSink(item);                     break;
        case 'stoveOven':     drawStoveOven(item);                break;
        case 'branchSign':    drawBranchSign(item);              break;
        case 'textLabel':     drawTextLabel(item);               break;
        case 'floorLamp':     drawFloorLamp(item.x, item.y);    break;
    }
    // When a desk is assigned, update the agent's desk location
    if (item.assignedTo && (item.type === 'desk' || item.type === 'bossDesk')) {
        _syncAgentToDesk(item);
    }
}

// --- INDIVIDUAL LOUNGE PIECES (split from drawLoungeArea) ---
function drawCouch(item) {
    var x, y;
    if (typeof item === 'object' && item.x !== undefined) { x = item.x; y = item.y; }
    else { x = arguments[0]; y = arguments[1]; item = {}; }
    var baseColor = item.couchColor || '#3f51b5';
    var cushionColor = _lightenColor(baseColor, 25);
    var armColor = _darkenColor(baseColor, 0.2);
    var shadowColor = _darkenColor(baseColor, 0.4);
    var backColor = _darkenColor(baseColor, 0.35);
    var rot = item.rotation || 0;

    // Dimensions: main body 160×40, L daybed extension 40×40 at bottom-right
    // Total bounding: 160×80
    ctx.save();
    ctx.translate(x, y);
    if (rot) ctx.rotate(rot * Math.PI / 180);

    _setFurnitureLampShadow(80, 40);

    // Drop shadow
    ctx.fillStyle = 'rgba(0,0,0,0.10)';
    ctx.fillRect(4, 4, 160, 40);
    ctx.fillRect(124, 4, 40, 80);

    // === BACKREST (raised edge along top and right side) ===
    // Top backrest — full width of main body
    ctx.fillStyle = backColor;
    ctx.fillRect(0, 0, 160, 10);
    // Right backrest — runs down the L extension
    ctx.fillRect(150, 0, 10, 80);

    // Backrest highlight (top edge catches light)
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fillRect(0, 0, 160, 3);
    ctx.fillRect(150, 0, 10, 3);

    // Backrest inner shadow (where back meets seat)
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.fillRect(0, 8, 150, 2);
    ctx.fillRect(148, 10, 2, 70);

    // === MAIN SEAT SURFACE (4 tiles wide × 1 tile tall) ===
    ctx.fillStyle = baseColor;
    ctx.fillRect(0, 10, 150, 30);

    // === L DAYBED EXTENSION (below main, right side) ===
    ctx.fillStyle = baseColor;
    ctx.fillRect(120, 40, 30, 40);

    // === ARMRESTS ===
    // Left armrest
    ctx.fillStyle = armColor;
    ctx.fillRect(0, 10, 6, 30);
    // Bottom-left corner arm
    ctx.fillRect(0, 36, 120, 4);
    // Bottom of daybed
    ctx.fillRect(120, 76, 30, 4);

    // Armrest top highlights
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(1, 11, 4, 28);

    // === 4 CUSHIONS on main body ===
    ctx.fillStyle = cushionColor;
    ctx.fillRect(8,  13, 30, 24);
    ctx.fillRect(42, 13, 30, 24);
    ctx.fillRect(76, 13, 30, 24);
    ctx.fillRect(110, 13, 30, 24);

    // Cushion divider lines
    ctx.fillStyle = _darkenColor(cushionColor, 0.1);
    ctx.fillRect(39, 13, 2, 24);
    ctx.fillRect(73, 13, 2, 24);
    ctx.fillRect(107, 13, 2, 24);

    // Cushion top highlights
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(9,  14, 28, 4);
    ctx.fillRect(43, 14, 28, 4);
    ctx.fillRect(77, 14, 28, 4);
    ctx.fillRect(111, 14, 28, 4);

    // === DAYBED CUSHION (one long cushion) ===
    ctx.fillStyle = cushionColor;
    ctx.fillRect(123, 43, 24, 30);
    // Highlight
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(124, 44, 22, 4);
    // Stitch line down the middle
    ctx.fillStyle = _darkenColor(cushionColor, 0.1);
    ctx.fillRect(134, 43, 1, 30);

        // Feet (small dark circles at corners)
    ctx.fillStyle = '#333';
    ctx.fillRect(1, 38, 3, 3);
    ctx.fillRect(117, 38, 3, 3);
    ctx.fillRect(148, 77, 3, 3);
    ctx.fillRect(1, 8, 3, 3);
    ctx.fillRect(157, 1, 3, 3);

    _clearFurnitureShadow();
    ctx.restore();
}

function drawCoffeeTable(x, y) {
    _setFurnitureLampShadow(x + 32, y + 17);
    ctx.fillStyle = '#5d4037'; ctx.fillRect(x, y, 64, 34);
    ctx.fillStyle = '#8d6e63'; ctx.fillRect(x + 2, y + 2, 60, 30);
    // Legs
    ctx.fillStyle = '#4e342e';
    ctx.fillRect(x + 2, y + 30, 4, 4); ctx.fillRect(x + 58, y + 30, 4, 4);
    // Magazine
    ctx.fillStyle = '#e3f2fd'; ctx.fillRect(x + 7, y + 6, 14, 18);
    ctx.fillStyle = '#1976d2'; ctx.fillRect(x + 9, y + 8, 10, 6);
    // Remote
    ctx.fillStyle = '#212121'; ctx.fillRect(x + 32, y + 10, 12, 6);
    ctx.fillStyle = '#f44336'; ctx.fillRect(x + 34, y + 11, 2, 2);
    _clearFurnitureShadow();
}

function drawEndTable(x, y) {
    _setFurnitureLampShadow(x + 10, y + 10);
    // Small wooden side table
    ctx.fillStyle = '#5d4037'; ctx.fillRect(x, y + 6, 20, 14);
    ctx.fillStyle = '#6d4c41'; ctx.fillRect(x + 1, y + 7, 18, 12);
    // Legs
    ctx.fillStyle = '#4e342e';
    ctx.fillRect(x + 1, y + 18, 3, 3); ctx.fillRect(x + 16, y + 18, 3, 3);
    // Plant on top
    ctx.fillStyle = '#795548'; ctx.fillRect(x + 6, y + 2, 8, 5); // pot
    ctx.fillStyle = '#6d4c41'; ctx.fillRect(x + 7, y + 1, 6, 2); // pot rim
    // Leaves
    ctx.fillStyle = '#388e3c';
    ctx.fillRect(x + 5, y - 2, 4, 4);
    ctx.fillRect(x + 11, y - 2, 4, 4);
    ctx.fillStyle = '#43a047';
    ctx.fillRect(x + 7, y - 4, 6, 4);
    ctx.fillStyle = '#2e7d32';
    ctx.fillRect(x + 8, y - 1, 4, 3);
    _clearFurnitureShadow();
}

function drawTV(x, y) {
    _setFurnitureLampShadow(x + 25, y + 16);
    // TV frame
    ctx.fillStyle = '#212121'; ctx.fillRect(x, y, 50, 32);
    ctx.fillStyle = '#263238'; ctx.fillRect(x + 3, y + 3, 44, 26);
    // Check if any agent is watching THIS TV (within 60px of the TV's watch spot)
    var watchX = x, watchY = y + 50;
    var tvInUse = agents.some(function(a) {
        return a.idleAction === 'watch_tv' && Math.abs(a.x - watchX) < 60 && Math.abs(a.y - watchY) < 60;
    });
    var tvX = x + 5, tvY = y + 5, tvW = 40, tvH = 22;
    if (tvInUse) {
        // Animated channels — only when someone is watching
        var tvChannel = Math.floor(_weatherTick / 480) % 5;
        var tvStatic = (_weatherTick % 480) < 15;
        if (tvStatic) {
            for (var sy = 0; sy < tvH; sy += 2) {
                for (var sx = 0; sx < tvW; sx += 2) {
                    var bright = Math.floor(Math.random() * 200) + 55;
                    ctx.fillStyle = 'rgb(' + bright + ',' + bright + ',' + bright + ')';
                    ctx.fillRect(tvX + sx, tvY + sy, 2, 2);
                }
            }
        } else if (tvChannel === 0) {
            // Sports
            ctx.fillStyle = '#2e7d32'; ctx.fillRect(tvX, tvY, tvW, tvH);
            ctx.fillStyle = '#4caf50'; ctx.fillRect(tvX, tvY + 10, tvW, 2);
            ctx.fillStyle = '#fff'; ctx.fillRect(tvX + 19, tvY, 2, tvH);
            var ballX = tvX + 10 + Math.sin(_weatherTick * 0.06) * 12;
            ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(ballX, tvY + 11, 2, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#fff'; ctx.font = '3px Arial'; ctx.textAlign = 'center';
            ctx.fillText('3 - 2', tvX + 20, tvY + 5);
        } else if (tvChannel === 1) {
            // News
            ctx.fillStyle = '#1565c0'; ctx.fillRect(tvX, tvY, tvW, tvH);
            ctx.fillStyle = '#c62828'; ctx.fillRect(tvX, tvY + 15, tvW, 7);
            ctx.save();
            ctx.beginPath(); ctx.rect(tvX, tvY, tvW, tvH); ctx.clip();
            ctx.fillStyle = '#fff'; ctx.font = '3px Arial'; ctx.textAlign = 'left';
            var tickerOff = (_weatherTick * 0.4) % 80;
            ctx.fillText('BREAKING NEWS...', tvX + 40 - tickerOff, tvY + 20);
            ctx.restore();
            ctx.fillStyle = '#0d47a1'; ctx.fillRect(tvX + 14, tvY + 3, 12, 12);
            ctx.fillStyle = '#ffcc80'; ctx.beginPath(); ctx.arc(tvX + 20, tvY + 6, 3, 0, Math.PI * 2); ctx.fill();
        } else if (tvChannel === 2) {
            // Cooking show
            ctx.fillStyle = '#ff8f00'; ctx.fillRect(tvX, tvY, tvW, tvH);
            ctx.fillStyle = '#6d4c41'; ctx.fillRect(tvX + 5, tvY + 10, 30, 8);
            ctx.fillStyle = '#f44336'; ctx.fillRect(tvX + 10, tvY + 5, 6, 6);
            ctx.fillStyle = 'rgba(255,255,255,0.4)';
            ctx.fillRect(tvX + 12, tvY + 2 + Math.sin(_weatherTick * 0.1) * 1, 2, 3);
        } else if (tvChannel === 3) {
            // Cartoon
            ctx.fillStyle = '#e1f5fe'; ctx.fillRect(tvX, tvY, tvW, tvH);
            ctx.fillStyle = '#4caf50'; ctx.fillRect(tvX, tvY + 14, tvW, 8);
            ctx.fillStyle = '#ffd600'; ctx.beginPath(); ctx.arc(tvX + 33, tvY + 5, 4, 0, Math.PI * 2); ctx.fill();
            var bounce = Math.abs(Math.sin(_weatherTick * 0.08)) * 6;
            ctx.fillStyle = '#e91e63'; ctx.fillRect(tvX + 12, tvY + 8 - bounce, 6, 6);
            ctx.fillStyle = '#fff'; ctx.fillRect(tvX + 14, tvY + 9 - bounce, 1, 1); ctx.fillRect(tvX + 16, tvY + 9 - bounce, 1, 1);
        } else {
            // Movie — letterbox
            ctx.fillStyle = '#1a1a1a'; ctx.fillRect(tvX, tvY, tvW, tvH);
            ctx.fillStyle = '#000'; ctx.fillRect(tvX, tvY, tvW, 4); ctx.fillRect(tvX, tvY + 18, tvW, 4);
            ctx.fillStyle = '#37474f'; ctx.fillRect(tvX, tvY + 4, tvW, 14);
            ctx.fillStyle = 'rgba(255,255,200,0.3)'; ctx.beginPath(); ctx.arc(tvX + 30, tvY + 8, 4, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#1a1a1a'; ctx.fillRect(tvX + 10, tvY + 10, 8, 8);
        }
        // Screen glare
        ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.fillRect(tvX, tvY, tvW, tvH / 2);
    } else {
        // Off — dark screen with faint power LED
        ctx.fillStyle = '#1a1a2e'; ctx.fillRect(tvX, tvY, tvW, tvH);
        ctx.fillStyle = 'rgba(255,255,255,0.02)'; ctx.fillRect(tvX, tvY, tvW, tvH / 2);
        // Power LED
        ctx.fillStyle = '#f44336'; ctx.fillRect(x + 44, y + 28, 2, 2);
    }
    // Stand
    ctx.fillStyle = '#37474f'; ctx.fillRect(x + 18, y + 30, 14, 3);
    ctx.fillRect(x + 12, y + 32, 26, 2);
    _clearFurnitureShadow();
}

// (old small bookshelf removed — using larger bookshelf below)

// --- KITCHEN COUNTER/CABINET ---
function drawFloorLamp(x, y) {
    // Standing floor lamp
    ctx.save();
    // Base
    ctx.fillStyle = '#37474f';
    ctx.beginPath(); ctx.ellipse(x, y + 2, 8, 3, 0, 0, Math.PI * 2); ctx.fill();
    // Pole
    ctx.strokeStyle = '#546e7a'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x, y + 2); ctx.lineTo(x, y - 28); ctx.stroke();
    // Shade
    ctx.fillStyle = '#455a64';
    ctx.beginPath();
    ctx.moveTo(x - 8, y - 28);
    ctx.lineTo(x + 8, y - 28);
    ctx.lineTo(x + 5, y - 34);
    ctx.lineTo(x - 5, y - 34);
    ctx.closePath();
    ctx.fill();
    // Bulb (static, no hardcoded glow — lighting handled dynamically)
    ctx.fillStyle = '#e0e0e0';
    ctx.beginPath(); ctx.arc(x, y - 30, 2, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
}

function drawBranchSign(item) {
    // Neon-style branch name label. item.branchId links to a branch.
    var branchId = item.branchId || 'UNASSIGNED';
    var branch = getBranchById(branchId);
    var text = (branch.name || branchId).toUpperCase();
    var neonColor = branch.color || _NEON_COLORS[branch.theme] || '#ffffff';

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 10px "Press Start 2P", monospace';

    // Solid text (no hardcoded glow — lighting handled dynamically)
    ctx.globalAlpha = 1;
    ctx.fillStyle = neonColor;
    ctx.fillText(text, item.x, item.y);

    ctx.restore();
}

function _showTextLabelEditor() { /* DOM editor stubbed in engine mode */ }

function _showInteractiveWindowEditor() { /* DOM editor stubbed in engine mode */ }

function drawStoveOven(item) {
    var x = item.x, y = item.y;
    var rot = item.rotation || 0;
    var w = 56, h = 58;
    var isCooking = agents.some(function(a) {
        return a.idleAction === 'make_food' && a.foodSource === 'stove' && !a.isSitting &&
            Math.abs(a.x - x) < 60 && Math.abs(a.y - y) < 70;
    });
    var burnerPulse = isCooking ? (0.45 + Math.sin(_weatherTick * 0.22) * 0.18) : 0;

    ctx.save();
    ctx.translate(x, y);
    if (rot) ctx.rotate(rot * Math.PI / 180);
    var lx = -w / 2, ly = -h / 2;

    _setFurnitureLampShadow(x, y + 14);

    ctx.fillStyle = 'rgba(0,0,0,0.16)'; ctx.fillRect(lx + 3, ly + h - 4, w - 2, 8);
    ctx.fillStyle = '#455a64'; ctx.fillRect(lx + 2, ly, w - 4, 9);
    ctx.fillStyle = '#607d8b'; ctx.fillRect(lx + 5, ly + 2, w - 10, 5);

    ctx.fillStyle = '#90a4ae'; ctx.fillRect(lx, ly + 8, w, h - 8);
    ctx.fillStyle = '#eceff1'; ctx.fillRect(lx + 2, ly + 10, w - 4, h - 12);
    ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.fillRect(lx + 5, ly + 12, 4, h - 17);
    ctx.fillStyle = 'rgba(0,0,0,0.10)'; ctx.fillRect(lx + w - 5, ly + 12, 3, h - 17);

    ctx.fillStyle = '#263238'; ctx.fillRect(lx + 4, ly + 12, w - 8, 20);
    ctx.fillStyle = '#37474f'; ctx.fillRect(lx + 6, ly + 14, w - 12, 16);

    var burners = [
        { x: lx + 15, y: ly + 20, r: 5 }, { x: lx + 39, y: ly + 20, r: 5 },
        { x: lx + 15, y: ly + 27, r: 4 }, { x: lx + 39, y: ly + 27, r: 4 }
    ];
    for (var bi = 0; bi < burners.length; bi++) {
        var b = burners[bi];
        ctx.strokeStyle = '#78909c'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = '#111820'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(b.x, b.y, Math.max(2, b.r - 2), 0, Math.PI * 2); ctx.stroke();
    }
    if (isCooking) {
        ctx.fillStyle = 'rgba(255,112,67,' + burnerPulse + ')';
        ctx.beginPath(); ctx.arc(lx + 15, ly + 20, 4.5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#546e7a'; ctx.fillRect(lx + 8, ly + 15, 14, 3);
        ctx.fillStyle = '#ffcc80'; ctx.fillRect(lx + 10, ly + 13, 10, 2);
        ctx.fillStyle = 'rgba(255,255,255,0.45)';
        var steam = Math.sin(_weatherTick * 0.12) * 1.5;
        ctx.fillRect(lx + 12, ly + 8 + steam, 2, 4);
        ctx.fillRect(lx + 18, ly + 6 - steam, 2, 4);
    }

    ctx.fillStyle = '#546e7a'; ctx.fillRect(lx + 5, ly + 34, w - 10, 7);
    ctx.fillStyle = isCooking ? '#76ff03' : '#1b5e20'; ctx.fillRect(lx + 9, ly + 36, 11, 3);
    for (var ki = 0; ki < 4; ki++) {
        ctx.fillStyle = '#cfd8dc';
        ctx.beginPath(); ctx.arc(lx + 28 + ki * 5, ly + 37, 1.8, 0, Math.PI * 2); ctx.fill();
    }

    ctx.fillStyle = '#b0bec5'; ctx.fillRect(lx + 7, ly + 42, w - 14, 13);
    ctx.fillStyle = '#263238'; ctx.fillRect(lx + 12, ly + 45, w - 24, 7);
    ctx.fillStyle = isCooking ? 'rgba(255,152,0,0.42)' : 'rgba(100,181,246,0.16)';
    ctx.fillRect(lx + 13, ly + 46, w - 26, 5);
    ctx.fillStyle = '#78909c'; ctx.fillRect(lx + 10, ly + 42, w - 20, 2);

    ctx.fillStyle = '#455a64'; ctx.fillRect(lx + 5, ly + h - 3, 6, 3); ctx.fillRect(lx + w - 11, ly + h - 3, 6, 3);
    ctx.strokeStyle = '#607d8b'; ctx.lineWidth = 1; ctx.strokeRect(lx + 0.5, ly + 8.5, w - 1, h - 9);

    _clearFurnitureShadow();
    ctx.restore();
}

function drawOfficeChair(item) {
    var x = item.x, y = item.y;
    var rot = item.rotation || 0;
    var w = 38, h = 46;
    var frame = item.frameColor || '#263238';
    var frameLight = '#455a64';
    var frameDark = '#102027';
    var fabric = item.fabricColor || '#37474f';
    var fabricLight = _lightenColor(fabric, 24);
    var fabricDark = _darkenColor(fabric, 0.32);
    var accent = item.accentColor || '#4fc3f7';
    var isOccupied = agents.some(function(a) {
        return (a.idleAction === 'couch' || a.isSitting) && Math.abs(a.x - x) < 24 && Math.abs(a.y - (y + 10)) < 28;
    });

    ctx.save();
    ctx.translate(x, y);
    if (rot) ctx.rotate(rot * Math.PI / 180);
    var lx = -w / 2, ly = -h / 2;

    _setFurnitureLampShadow(x, y + 12);

    // Soft floor shadow and five-star caster footprint — scaled to sit beside desks.
    ctx.fillStyle = 'rgba(0,0,0,0.16)';
    ctx.fillRect(lx + 4, ly + 34, w - 4, 8);
    ctx.fillStyle = 'rgba(0,0,0,0.08)';
    ctx.fillRect(lx + 10, ly + 40, w - 16, 4);

    // Rear back posts.
    ctx.fillStyle = frameDark;
    ctx.fillRect(lx + 5, ly + 5, 4, 24);
    ctx.fillRect(lx + w - 9, ly + 5, 4, 24);
    ctx.fillStyle = frameLight;
    ctx.fillRect(lx + 6, ly + 6, 1, 21);
    ctx.fillRect(lx + w - 8, ly + 6, 1, 21);

    // Tall padded back with pixel-rounded shoulders.
    ctx.fillStyle = fabricDark;
    ctx.fillRect(lx + 7, ly + 1, w - 14, 23);
    ctx.fillStyle = fabric;
    ctx.fillRect(lx + 6, ly + 3, w - 12, 18);
    ctx.fillRect(lx + 8, ly + 1, w - 16, 22);
    ctx.fillStyle = fabricLight;
    ctx.fillRect(lx + 10, ly + 4, w - 20, 4);
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.fillRect(lx + 13, ly + 9, 5, 2);
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.fillRect(lx + 8, ly + 21, w - 16, 2);

    // Arm rests: narrow dark rails on both sides.
    ctx.fillStyle = frameDark;
    ctx.fillRect(lx + 1, ly + 19, 8, 4);
    ctx.fillRect(lx + w - 9, ly + 19, 8, 4);
    ctx.fillRect(lx + 2, ly + 23, 4, 10);
    ctx.fillRect(lx + w - 6, ly + 23, 4, 10);
    ctx.fillStyle = frameLight;
    ctx.fillRect(lx + 2, ly + 19, 6, 1);
    ctx.fillRect(lx + w - 8, ly + 19, 6, 1);

    // Thick cushioned seat with front lip; bright accent stripe makes it read clearly at scale.
    ctx.fillStyle = fabricDark;
    ctx.fillRect(lx + 7, ly + 23, w - 14, 6);
    ctx.fillStyle = fabric;
    ctx.fillRect(lx + 5, ly + 26, w - 10, 13);
    ctx.fillRect(lx + 8, ly + 24, w - 16, 17);
    ctx.fillStyle = fabricLight;
    ctx.fillRect(lx + 9, ly + 26, w - 18, 4);
    ctx.fillStyle = accent;
    ctx.fillRect(lx + 12, ly + 30, w - 24, 2);
    if (isOccupied) {
        ctx.fillStyle = 'rgba(129,212,250,0.35)';
        ctx.fillRect(lx + 8, ly + 25, w - 16, 4);
    }

    // Gas lift and five-star base with tiny caster pixels.
    ctx.fillStyle = frameDark;
    ctx.fillRect(lx + 17, ly + 37, 4, 7);
    ctx.fillStyle = frame;
    ctx.fillRect(lx + 8, ly + 42, 22, 3);
    ctx.fillRect(lx + 17, ly + 40, 4, 6);
    ctx.fillRect(lx + 5, ly + 39, 6, 3);
    ctx.fillRect(lx + 27, ly + 39, 6, 3);
    ctx.fillStyle = '#111820';
    ctx.fillRect(lx + 4, ly + 42, 4, 3);
    ctx.fillRect(lx + 30, ly + 42, 4, 3);
    ctx.fillRect(lx + 16, ly + 44, 6, 2);

    // Crisp pixel outline around main solids.
    ctx.strokeStyle = '#101820';
    ctx.lineWidth = 1;
    ctx.strokeRect(lx + 7.5, ly + 1.5, w - 15, 22);
    ctx.strokeRect(lx + 7.5, ly + 24.5, w - 15, 16);

    _clearFurnitureShadow();
    ctx.restore();
}

function drawDiningTable(item) {
    var x = item.x, y = item.y;
    var rot = item.rotation || 0;
    var inUse = agents.some(function(a) {
        return (a.idleAction === 'eat' || a.carryItem === 'food' || a.carryItem === 'snack') &&
            Math.abs(a.x - x) < 70 && Math.abs(a.y - y) < 60;
    });

    ctx.save();
    ctx.translate(x, y);
    if (rot) ctx.rotate(rot * Math.PI / 180);

    _setFurnitureLampShadow(x, y + 10);

    // Local 112×88 footprint: four chairs surrounding a polished 72×48 table.
    var tableX = -36, tableY = -24, tableW = 72, tableH = 48;

    // Soft combined footprint shadow.
    ctx.fillStyle = 'rgba(0,0,0,0.14)';
    ctx.fillRect(tableX + 4, tableY + 6, tableW, tableH);
    ctx.fillRect(-17, -43, 34, 18);
    ctx.fillRect(-17, 25, 34, 18);
    ctx.fillRect(-55, -13, 18, 34);
    ctx.fillRect(37, -13, 18, 34);

    // Chairs — dark walnut frames with warm upholstered cushions.
    function chair(cx, cy, w, h, dir) {
        ctx.fillStyle = '#4e342e'; ctx.fillRect(cx, cy, w, h);
        ctx.fillStyle = '#6d4c41';
        if (dir === 'top') ctx.fillRect(cx + 2, cy + 2, w - 4, 5);
        else if (dir === 'bottom') ctx.fillRect(cx + 2, cy + h - 7, w - 4, 5);
        else if (dir === 'left') ctx.fillRect(cx + 2, cy + 2, 5, h - 4);
        else ctx.fillRect(cx + w - 7, cy + 2, 5, h - 4);
        ctx.fillStyle = '#8d6e63'; ctx.fillRect(cx + 4, cy + 5, w - 8, h - 10);
        ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(cx + 5, cy + 6, w - 10, 3);
        ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fillRect(cx + 4, cy + h - 7, w - 8, 2);
    }
    chair(-16, -44, 32, 18, 'top');
    chair(-16, 26, 32, 18, 'bottom');
    chair(-56, -16, 18, 32, 'left');
    chair(38, -16, 18, 32, 'right');

    // Chair legs / feet as crisp pixel details.
    ctx.fillStyle = '#3e2723';
    ctx.fillRect(-15, -29, 4, 4); ctx.fillRect(11, -29, 4, 4);
    ctx.fillRect(-15, 25, 4, 4);  ctx.fillRect(11, 25, 4, 4);
    ctx.fillRect(-41, -15, 4, 4); ctx.fillRect(-41, 11, 4, 4);
    ctx.fillRect(37, -15, 4, 4);  ctx.fillRect(37, 11, 4, 4);

    // Table legs under the surface.
    ctx.fillStyle = '#3e2723';
    ctx.fillRect(tableX + 7, tableY + 37, 6, 8);
    ctx.fillRect(tableX + tableW - 13, tableY + 37, 6, 8);
    ctx.fillRect(tableX + 7, tableY + 3, 6, 6);
    ctx.fillRect(tableX + tableW - 13, tableY + 3, 6, 6);

    // Main table — layered beveled wood top.
    ctx.fillStyle = '#4e342e'; ctx.fillRect(tableX - 2, tableY - 2, tableW + 4, tableH + 4);
    ctx.fillStyle = '#6d4c41'; ctx.fillRect(tableX, tableY, tableW, tableH);
    ctx.fillStyle = '#8a5a35'; ctx.fillRect(tableX + 3, tableY + 3, tableW - 6, tableH - 6);
    ctx.fillStyle = '#a66a3d'; ctx.fillRect(tableX + 6, tableY + 6, tableW - 12, tableH - 12);
    ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(tableX + 7, tableY + 7, tableW - 14, 4);
    ctx.fillStyle = 'rgba(0,0,0,0.16)'; ctx.fillRect(tableX + 3, tableY + tableH - 7, tableW - 6, 4);

    // Wood grain stripes and end seams.
    ctx.fillStyle = 'rgba(79,43,24,0.35)';
    ctx.fillRect(tableX + 10, tableY + 18, tableW - 20, 2);
    ctx.fillRect(tableX + 8, tableY + 31, tableW - 16, 1);
    ctx.fillRect(tableX + tableW / 2 - 1, tableY + 5, 2, tableH - 10);
    ctx.fillStyle = 'rgba(255,224,178,0.20)';
    ctx.fillRect(tableX + 12, tableY + 13, 26, 1);
    ctx.fillRect(tableX + 40, tableY + 27, 20, 1);

    // Place settings: four plates, placemats, cups, and cutlery.
    var settings = [
        { x: 0, y: -14 }, { x: 0, y: 14 }, { x: -22, y: 0 }, { x: 22, y: 0 }
    ];
    for (var i = 0; i < settings.length; i++) {
        var s = settings[i];
        ctx.fillStyle = 'rgba(255,248,225,0.35)'; ctx.fillRect(s.x - 10, s.y - 7, 20, 14);
        ctx.fillStyle = '#f5f5f5'; ctx.beginPath(); ctx.arc(s.x, s.y, 6, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = inUse ? '#ffcc80' : '#d7ccc8'; ctx.beginPath(); ctx.arc(s.x, s.y, 3, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#b0bec5'; ctx.fillRect(s.x - 13, s.y - 5, 1, 10); ctx.fillRect(s.x + 12, s.y - 5, 1, 10);
        ctx.fillStyle = '#90caf9'; ctx.fillRect(s.x + 7, s.y - 8, 4, 5);
    }

    // Center runner, bowl, and tiny candle/flowers so it reads as dining at game scale.
    ctx.fillStyle = 'rgba(255,255,255,0.16)'; ctx.fillRect(-5, tableY + 7, 10, tableH - 14);
    ctx.fillStyle = '#5d4037'; ctx.fillRect(-10, -4, 20, 8);
    ctx.fillStyle = '#efebe9'; ctx.beginPath(); ctx.ellipse(0, 0, 11, 6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#66bb6a'; ctx.fillRect(-3, -5, 2, 5); ctx.fillRect(2, -5, 2, 5);
    ctx.fillStyle = '#ff7043'; ctx.fillRect(-5, -7, 3, 3); ctx.fillStyle = '#ffd54f'; ctx.fillRect(4, -7, 3, 3);
    if (inUse) {
        var steam = Math.sin(_weatherTick * 0.12) * 1.5;
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.fillRect(-2, -13 + steam, 1, 5);
        ctx.fillRect(3, -15 - steam, 1, 5);
    }

    ctx.strokeStyle = '#3e2723'; ctx.lineWidth = 1;
    ctx.strokeRect(tableX - 1.5, tableY - 1.5, tableW + 3, tableH + 3);

    _clearFurnitureShadow();
    ctx.restore();
}

function drawKitchenCounter(x, y) {
    _setFurnitureLampShadow(x + 36, y + 20);
    // Counter shadow
    ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fillRect(x + 2, y + 32, 72, 8);
    // Counter body
    ctx.fillStyle = '#e0e0e0'; ctx.fillRect(x, y, 72, 34);
    ctx.fillStyle = '#f5f5f5'; ctx.fillRect(x + 2, y + 2, 68, 30);
    // Counter top surface
    ctx.fillStyle = '#fafafa'; ctx.fillRect(x, y, 72, 4);
    // Cabinet doors
    ctx.fillStyle = '#e0e0e0'; ctx.fillRect(x + 4, y + 10, 28, 18); ctx.fillRect(x + 36, y + 10, 28, 18);
    // Handles
    ctx.fillStyle = '#bdbdbd'; ctx.fillRect(x + 16, y + 17, 4, 3); ctx.fillRect(x + 48, y + 17, 4, 3);
    _clearFurnitureShadow();
}

function drawSink(item) {
    var x = item.x, y = item.y;
    var rot = item.rotation || 0;
    var inUse = agents.some(function(a) {
        return (a.idleAction === 'get_water' || a.idleAction === 'wash') && !a.isSitting &&
            Math.abs(a.x - x) < 58 && Math.abs(a.y - y) < 70;
    });

    ctx.save();
    ctx.translate(x, y);
    if (rot) ctx.rotate(rot * Math.PI / 180);

    var w = 72, h = 38;
    var lx = -w / 2, ly = -h / 2;
    _setFurnitureLampShadow(x, y + 16);

    ctx.fillStyle = 'rgba(0,0,0,0.14)'; ctx.fillRect(lx + 3, ly + h - 5, w - 2, 9);
    ctx.fillStyle = '#b0bec5'; ctx.fillRect(lx, ly + 5, w, h - 5);
    ctx.fillStyle = '#eceff1'; ctx.fillRect(lx + 2, ly + 7, w - 4, h - 9);
    ctx.fillStyle = '#cfd8dc'; ctx.fillRect(lx + 3, ly + 25, w - 6, 6);
    ctx.fillStyle = '#78909c'; ctx.fillRect(lx - 1, ly + 2, w + 2, 8);
    ctx.fillStyle = '#f7fbfc'; ctx.fillRect(lx + 1, ly, w - 2, 8);
    ctx.fillStyle = '#dbe7ea'; ctx.fillRect(lx + 1, ly + 7, w - 2, 3);
    ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.fillRect(lx + 4, ly + 1, 18, 2);

    ctx.fillStyle = '#90a4ae'; ctx.fillRect(lx + 22, ly + 6, 28, 20);
    ctx.fillStyle = '#eef7fa'; ctx.fillRect(lx + 24, ly + 7, 24, 17);
    ctx.fillStyle = '#b3e5fc'; ctx.fillRect(lx + 27, ly + 10, 18, 11);
    ctx.fillStyle = inUse ? '#4fc3f7' : '#81d4fa'; ctx.fillRect(lx + 29, ly + 12, 14, 7);
    ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.fillRect(lx + 31, ly + 13, 9, 2);
    ctx.fillStyle = '#607d8b'; ctx.fillRect(lx + 35, ly + 16, 3, 3);
    if (inUse) {
        var shimmer = Math.sin(_weatherTick * 0.22) * 2;
        ctx.fillStyle = 'rgba(255,255,255,0.65)';
        ctx.fillRect(lx + 28 + shimmer, ly + 11, 8, 1);
        ctx.fillRect(lx + 35 - shimmer, ly + 19, 7, 1);
    }

    ctx.fillStyle = '#455a64'; ctx.fillRect(lx + 34, ly + 1, 4, 8);
    ctx.fillStyle = '#607d8b'; ctx.fillRect(lx + 36, ly + 1, 10, 3);
    ctx.fillStyle = '#78909c'; ctx.fillRect(lx + 44, ly + 3, 3, 5);
    ctx.fillStyle = inUse ? '#80d8ff' : '#b0bec5'; ctx.fillRect(lx + 44, ly + 8, 2, 5);
    ctx.fillStyle = '#ef5350'; ctx.fillRect(lx + 26, ly + 3, 4, 3);
    ctx.fillStyle = '#42a5f5'; ctx.fillRect(lx + 42, ly + 3, 4, 3);

    ctx.fillStyle = '#dfe8eb'; ctx.fillRect(lx + 5, ly + 14, 22, 16);
    ctx.fillRect(lx + 45, ly + 14, 22, 16);
    ctx.fillStyle = 'rgba(0,0,0,0.08)'; ctx.fillRect(lx + 34, ly + 10, 2, 22);
    ctx.fillStyle = '#90a4ae'; ctx.fillRect(lx + 15, ly + 21, 5, 2); ctx.fillRect(lx + 52, ly + 21, 5, 2);
    ctx.fillStyle = '#66bb6a'; ctx.fillRect(lx + 7, ly + 4, 5, 8);
    ctx.fillStyle = '#c8e6c9'; ctx.fillRect(lx + 8, ly + 3, 3, 2);
    ctx.fillStyle = '#ffca28'; ctx.fillRect(lx + 55, ly + 5, 9, 4);
    ctx.fillStyle = '#f57f17'; ctx.fillRect(lx + 56, ly + 8, 7, 1);
    ctx.strokeStyle = '#607d8b'; ctx.lineWidth = 1; ctx.strokeRect(lx + 0.5, ly + 0.5, w - 1, h - 1);
    ctx.fillStyle = '#455a64'; ctx.fillRect(lx + 5, ly + h - 4, 6, 3); ctx.fillRect(lx + w - 11, ly + h - 4, 6, 3);

    _clearFurnitureShadow();
    ctx.restore();
}

function drawCoffeeMakerStandalone(x, y) {
    // Counter base
    ctx.fillStyle = '#e0e0e0'; ctx.fillRect(x, y + 10, 24, 12);
    ctx.fillStyle = '#f5f5f5'; ctx.fillRect(x + 1, y + 11, 22, 10);
    // Machine body
    ctx.fillStyle = '#212121'; ctx.fillRect(x + 2, y, 20, 12);
    ctx.fillStyle = '#333';    ctx.fillRect(x + 4, y + 2, 16, 8);
    // Water tank (blue tint)
    ctx.fillStyle = 'rgba(3,169,244,0.5)'; ctx.fillRect(x + 15, y + 2, 4, 8);
    // Buttons
    ctx.fillStyle = '#4caf50'; ctx.fillRect(x + 5, y + 3, 3, 2);
    ctx.fillStyle = '#f44336'; ctx.fillRect(x + 5, y + 7, 3, 2);
    // Drip tray
    ctx.fillStyle = '#424242'; ctx.fillRect(x + 5, y + 18, 10, 3);
    // Cup
    ctx.fillStyle = '#fff'; ctx.fillRect(x + 7, y + 16, 5, 5);
}

function drawMicrowaveStandalone(x, y) {
    var micInUse = agents.some(function(a) {
        return a.idleAction === 'make_food' && a.foodSource === 'microwave' && !a.isSitting && Math.abs(a.x - x) < 55 && Math.abs(a.y - y) < 70;
    });
    ctx.fillStyle = '#455a64'; ctx.fillRect(x, y, 30, 24);
    ctx.fillStyle = '#37474f'; ctx.fillRect(x + 2, y + 2, 26, 20);
    // Door window
    ctx.fillStyle = '#263238'; ctx.fillRect(x + 3, y + 3, 17, 17);
    if (micInUse) {
        var micGlow = 0.15 + Math.sin(_weatherTick * 0.15) * 0.1;
        ctx.fillStyle = 'rgba(255,200,50,' + micGlow + ')';
        ctx.fillRect(x + 4, y + 4, 15, 15);
        var plateAngle = _weatherTick * 0.08;
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.beginPath(); ctx.arc(x + 11, y + 12 + Math.sin(plateAngle) * 2, 1, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(x + 11 + Math.cos(plateAngle) * 3, y + 12, 1, 0, Math.PI * 2); ctx.fill();
    } else {
        ctx.fillStyle = 'rgba(100,200,255,0.15)'; ctx.fillRect(x + 4, y + 4, 15, 15);
    }
    // Handle
    ctx.fillStyle = '#90a4ae'; ctx.fillRect(x + 21, y + 7, 2, 10);
    // Control panel
    ctx.fillStyle = '#546e7a'; ctx.fillRect(x + 24, y + 3, 4, 17);
    ctx.fillStyle = micInUse ? '#76ff03' : '#4caf50'; ctx.fillRect(x + 25, y + 5, 2, 2);
    ctx.fillStyle = '#f44336'; ctx.fillRect(x + 25, y + 9, 2, 2);
    ctx.fillStyle = '#78909c'; ctx.fillRect(x + 25, y + 13, 2, 2);
    // Display
    ctx.fillStyle = micInUse ? '#1b5e20' : '#0a3010'; ctx.fillRect(x + 4, y + 3, 8, 4);
    ctx.fillStyle = micInUse ? '#76ff03' : '#4caf50'; ctx.font = '3px Arial'; ctx.textAlign = 'left';
    if (micInUse) {
        var secs = Math.floor(_weatherTick * 0.05) % 60;
        ctx.fillText((secs < 10 ? '0:0' : '0:') + secs, x + 5, y + 6);
        ctx.fillStyle = 'rgba(255,200,50,0.08)';
        var humOff = Math.sin(_weatherTick * 0.3) * 0.5;
        ctx.fillRect(x + humOff, y - 1, 30, 1);
    } else {
        ctx.fillText('0:00', x + 5, y + 6);
    }
}

function drawToasterStandalone(x, y) {
    ctx.fillStyle = '#bdbdbd'; ctx.fillRect(x, y + 4, 18, 12);
    ctx.fillStyle = '#e0e0e0'; ctx.fillRect(x + 1, y + 5, 16, 10);
    // Rounded top
    ctx.fillStyle = '#bdbdbd'; ctx.fillRect(x + 1, y + 2, 16, 4);
    // Bread slots
    ctx.fillStyle = '#424242'; ctx.fillRect(x + 3, y + 2, 4, 3);
    ctx.fillRect(x + 10, y + 2, 4, 3);
    // Bread peeking
    ctx.fillStyle = '#d4a056'; ctx.fillRect(x + 3, y, 4, 3);
    ctx.fillRect(x + 10, y, 4, 3);
    // Lever
    ctx.fillStyle = '#78909c'; ctx.fillRect(x + 16, y + 8, 2, 5);
    ctx.fillStyle = '#546e7a'; ctx.fillRect(x + 15, y + 8, 4, 2);
    // Front label line
    ctx.fillStyle = '#9e9e9e'; ctx.fillRect(x + 5, y + 13, 8, 1);
}

function drawLoungeArea(lx, ly) {
    _setFurnitureLampShadow(lx + 80, ly + 50);
    // Couch shadow
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.fillRect(lx + 2, ly + 4, 32, 102);
    ctx.fillRect(lx + 2, ly + 74, 142, 32);
    // L-shaped couch
    ctx.fillStyle = '#3f51b5'; 
    ctx.fillRect(lx, ly, 30, 100); ctx.fillRect(lx, ly + 70, 140, 30);
    // Couch cushions
    ctx.fillStyle = '#5c6bc0';
    ctx.fillRect(lx + 3, ly + 5, 24, 22); ctx.fillRect(lx + 3, ly + 32, 24, 22);
    ctx.fillRect(lx + 35, ly + 73, 26, 24); ctx.fillRect(lx + 65, ly + 73, 26, 24); ctx.fillRect(lx + 95, ly + 73, 26, 24);
    // Pillows
    ctx.fillStyle = '#ffb74d'; ctx.fillRect(lx + 5, ly + 8, 10, 8);
    ctx.fillStyle = '#ef5350'; ctx.fillRect(lx + 100, ly + 76, 10, 8);
    // Coffee table
    ctx.fillStyle = '#5d4037'; ctx.fillRect(lx + 48, ly + 18, 64, 34);
    ctx.fillStyle = '#8d6e63'; ctx.fillRect(lx + 50, ly + 20, 60, 30);
    // Table legs
    ctx.fillStyle = '#4e342e';
    ctx.fillRect(lx + 50, ly + 48, 4, 4); ctx.fillRect(lx + 106, ly + 48, 4, 4);
    // Magazine on table
    ctx.fillStyle = '#e3f2fd'; ctx.fillRect(lx + 55, ly + 24, 14, 18);
    ctx.fillStyle = '#1976d2'; ctx.fillRect(lx + 57, ly + 26, 10, 6);
    // Remote control
    ctx.fillStyle = '#212121'; ctx.fillRect(lx + 80, ly + 28, 12, 6);
    ctx.fillStyle = '#f44336'; ctx.fillRect(lx + 82, ly + 29, 2, 2);
    // TV on wall
    ctx.fillStyle = '#212121'; ctx.fillRect(lx + 130, ly - 5, 50, 32);
    ctx.fillStyle = '#263238'; ctx.fillRect(lx + 133, ly - 2, 44, 26);
    // TV screen — animated when someone is watching
    var tvInUse = agents.some(function(a) { return a.idleAction === 'watch_tv'; });
    var tvX = lx + 135, tvY = ly, tvW = 40, tvH = 22;
    if (tvInUse) {
        var tvChannel = Math.floor(_weatherTick / 480) % 5; // switch channel every ~8s
        var tvStatic = (_weatherTick % 480) < 15; // brief static on channel switch
        if (tvStatic) {
            // Static noise
            for (var sy = 0; sy < tvH; sy += 2) {
                for (var sx = 0; sx < tvW; sx += 2) {
                    var bright = Math.floor(Math.random() * 200) + 55;
                    ctx.fillStyle = 'rgb(' + bright + ',' + bright + ',' + bright + ')';
                    ctx.fillRect(tvX + sx, tvY + sy, 2, 2);
                }
            }
        } else if (tvChannel === 0) {
            // Sports — green field with moving dot
            ctx.fillStyle = '#2e7d32'; ctx.fillRect(tvX, tvY, tvW, tvH);
            ctx.fillStyle = '#4caf50'; ctx.fillRect(tvX, tvY + 10, tvW, 2);
            ctx.fillStyle = '#fff'; ctx.fillRect(tvX + 19, tvY, 2, tvH);
            // Ball
            var ballX = tvX + 10 + Math.sin(_weatherTick * 0.06) * 12;
            ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(ballX, tvY + 11, 2, 0, Math.PI * 2); ctx.fill();
            // Score
            ctx.fillStyle = '#fff'; ctx.font = '3px Arial'; ctx.textAlign = 'center';
            ctx.fillText('3 - 2', tvX + 20, tvY + 5);
        } else if (tvChannel === 1) {
            // News — blue bg with text bars
            ctx.fillStyle = '#1565c0'; ctx.fillRect(tvX, tvY, tvW, tvH);
            ctx.fillStyle = '#c62828'; ctx.fillRect(tvX, tvY + 15, tvW, 7);
            // Ticker text clipped to TV screen
            ctx.save();
            ctx.beginPath(); ctx.rect(tvX, tvY, tvW, tvH); ctx.clip();
            ctx.fillStyle = '#fff'; ctx.font = '3px Arial'; ctx.textAlign = 'left';
            var tickerOff = (_weatherTick * 0.4) % 80;
            ctx.fillText('BREAKING NEWS...', tvX + 40 - tickerOff, tvY + 20);
            ctx.restore();
            // Anchor silhouette
            ctx.fillStyle = '#0d47a1'; ctx.fillRect(tvX + 14, tvY + 3, 12, 12);
            ctx.fillStyle = '#ffcc80'; ctx.beginPath(); ctx.arc(tvX + 20, tvY + 6, 3, 0, Math.PI * 2); ctx.fill();
        } else if (tvChannel === 2) {
            // Cooking show — warm colors
            ctx.fillStyle = '#ff8f00'; ctx.fillRect(tvX, tvY, tvW, tvH);
            ctx.fillStyle = '#6d4c41'; ctx.fillRect(tvX + 5, tvY + 10, 30, 8); // counter
            ctx.fillStyle = '#f44336'; ctx.fillRect(tvX + 10, tvY + 5, 6, 6); // pot
            // Steam
            ctx.fillStyle = 'rgba(255,255,255,0.4)';
            ctx.fillRect(tvX + 12, tvY + 2 + Math.sin(_weatherTick * 0.1) * 1, 2, 3);
        } else if (tvChannel === 3) {
            // Cartoon — bright colors, bouncing shapes
            ctx.fillStyle = '#e1f5fe'; ctx.fillRect(tvX, tvY, tvW, tvH);
            ctx.fillStyle = '#4caf50'; ctx.fillRect(tvX, tvY + 14, tvW, 8); // grass
            // Sun
            ctx.fillStyle = '#ffd600'; ctx.beginPath(); ctx.arc(tvX + 33, tvY + 5, 4, 0, Math.PI * 2); ctx.fill();
            // Bouncing character
            var bounce = Math.abs(Math.sin(_weatherTick * 0.08)) * 6;
            ctx.fillStyle = '#e91e63'; ctx.fillRect(tvX + 12, tvY + 8 - bounce, 6, 6);
            ctx.fillStyle = '#fff'; ctx.fillRect(tvX + 14, tvY + 9 - bounce, 1, 1); ctx.fillRect(tvX + 16, tvY + 9 - bounce, 1, 1);
        } else {
            // Movie — dark with letterbox
            ctx.fillStyle = '#1a1a1a'; ctx.fillRect(tvX, tvY, tvW, tvH);
            ctx.fillStyle = '#000'; ctx.fillRect(tvX, tvY, tvW, 4); ctx.fillRect(tvX, tvY + 18, tvW, 4);
            // Scene: moon + silhouette
            ctx.fillStyle = '#37474f'; ctx.fillRect(tvX, tvY + 4, tvW, 14);
            ctx.fillStyle = 'rgba(255,255,200,0.3)'; ctx.beginPath(); ctx.arc(tvX + 30, tvY + 8, 4, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#1a1a1a'; ctx.fillRect(tvX + 10, tvY + 10, 8, 8);
        }
    } else {
        // Standby — static blue screen
        ctx.fillStyle = '#4fc3f7'; ctx.fillRect(tvX, tvY, tvW, tvH);
        ctx.fillStyle = '#81d4fa'; ctx.fillRect(tvX + 3, tvY + 3, 15, 8);
        ctx.fillStyle = '#b3e5fc'; ctx.fillRect(tvX + 20, tvY + 3, 18, 2); ctx.fillRect(tvX + 20, tvY + 7, 12, 2);
    }
    // Label
    // Dart board on wall
    drawDartBoard(lx + 210, ly - 8);
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.font = '8px "Press Start 2P"'; ctx.textAlign = 'center';
    _clearFurnitureShadow();
    ctx.fillText('LOUNGE', lx + 90, ly - 20);
    drawBookshelf(lx - 50, ly);
}

function drawDartBoard(x, y) {
    // Tripod legs
    ctx.strokeStyle = '#616161'; ctx.lineWidth = 2;
    // Left leg
    ctx.beginPath(); ctx.moveTo(x - 6, y + 16); ctx.lineTo(x - 18, y + 50); ctx.stroke();
    // Right leg
    ctx.beginPath(); ctx.moveTo(x + 6, y + 16); ctx.lineTo(x + 18, y + 50); ctx.stroke();
    // Center/back leg
    ctx.beginPath(); ctx.moveTo(x, y + 16); ctx.lineTo(x, y + 48); ctx.stroke();
    // Leg feet (small caps)
    ctx.fillStyle = '#424242';
    ctx.fillRect(x - 20, y + 48, 5, 3);
    ctx.fillRect(x + 16, y + 48, 5, 3);
    ctx.fillRect(x - 2, y + 46, 4, 3);
    // Backboard
    ctx.fillStyle = '#5d4037'; ctx.fillRect(x - 16, y - 16, 32, 32);
    ctx.fillStyle = '#795548'; ctx.fillRect(x - 14, y - 14, 28, 28);
    // Board circle (concentric rings)
    ctx.beginPath(); ctx.arc(x, y, 13, 0, Math.PI * 2);
    ctx.fillStyle = '#1a1a1a'; ctx.fill();
    // Outer ring (green/red alternating wedges via simple rects)
    ctx.fillStyle = '#c62828'; ctx.fillRect(x - 12, y - 3, 24, 6);
    ctx.fillStyle = '#2e7d32'; ctx.fillRect(x - 3, y - 12, 6, 24);
    // Middle ring
    ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2);
    ctx.fillStyle = '#e8e0d4'; ctx.fill();
    ctx.fillStyle = '#c62828'; ctx.fillRect(x - 7, y - 2, 14, 4);
    ctx.fillStyle = '#2e7d32'; ctx.fillRect(x - 2, y - 7, 4, 14);
    // Inner bull
    ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fillStyle = '#2e7d32'; ctx.fill();
    // Bullseye
    ctx.beginPath(); ctx.arc(x, y, 1.5, 0, Math.PI * 2);
    ctx.fillStyle = '#c62828'; ctx.fill();
    // Wire frame lines
    ctx.strokeStyle = 'rgba(200,200,200,0.4)'; ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(x - 13, y); ctx.lineTo(x + 13, y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x, y - 13); ctx.lineTo(x, y + 13); ctx.stroke();
    // Draw stuck darts from active games
    for (var di = 0; di < dartStuckDarts.length; di++) {
        var d = dartStuckDarts[di];
        ctx.fillStyle = d.color;
        ctx.fillRect(x + d.ox - 1, y + d.oy - 1, 3, 3); // dart tip
        ctx.fillStyle = d.flightColor;
        ctx.fillRect(x + d.ox - 1, y + d.oy - 4, 3, 3); // flight
    }
}

// --- ENG LOUNGE (under Caltran sign) ---
function drawEngLounge(x, y) {
    _setFurnitureLampShadow(x + 80, y + 20);
    // Couch shadow
    ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fillRect(x + 2, y + 4, 162, 38);
    // Black leather couch (horizontal, seats 4)
    ctx.fillStyle = '#1a1a1a'; ctx.fillRect(x, y, 160, 36);
    // Back cushion
    ctx.fillStyle = '#2a2a2a'; ctx.fillRect(x + 2, y, 156, 12);
    // Seat cushions (4)
    ctx.fillStyle = '#333';
    ctx.fillRect(x + 4, y + 14, 34, 18);
    ctx.fillRect(x + 42, y + 14, 34, 18);
    ctx.fillRect(x + 80, y + 14, 34, 18);
    ctx.fillRect(x + 118, y + 14, 34, 18);
    // Cushion seams
    ctx.fillStyle = '#222';
    ctx.fillRect(x + 40, y + 14, 2, 18);
    ctx.fillRect(x + 78, y + 14, 2, 18);
    ctx.fillRect(x + 116, y + 14, 2, 18);
    // Leather shine highlights
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(x + 8, y + 16, 26, 4);
    ctx.fillRect(x + 46, y + 16, 26, 4);
    ctx.fillRect(x + 84, y + 16, 26, 4);
    ctx.fillRect(x + 122, y + 16, 26, 4);
    // Armrests
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(x - 4, y + 2, 6, 32);
    ctx.fillRect(x + 158, y + 2, 6, 32);
    ctx.fillStyle = '#2a2a2a';
    ctx.fillRect(x - 3, y + 3, 4, 8);
    ctx.fillRect(x + 159, y + 3, 4, 8);

    _clearFurnitureShadow();
}

// --- PING PONG TABLE ---
var PONG_TABLE = { x: 190, y: 105, w: 80, h: 48 };
function _updatePongTablePos() {
    if (!PONG_TABLE || !officeConfig || !officeConfig.furniture) return;
    for (var i = 0; i < officeConfig.furniture.length; i++) {
        if (officeConfig.furniture[i].type === 'pingPongTable') {
            PONG_TABLE.x = officeConfig.furniture[i].x;
            PONG_TABLE.y = officeConfig.furniture[i].y;
            return;
        }
    }
}
var pongGames = [];

function drawPingPongTable(x, y) {
    _setFurnitureLampShadow(x, y);
    // Table shadow
    ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fillRect(x - 38, y - 20, 80, 52);
    // Table surface (dark green)
    ctx.fillStyle = '#1b5e20'; ctx.fillRect(x - 40, y - 24, 80, 48);
    ctx.fillStyle = '#2e7d32'; ctx.fillRect(x - 38, y - 22, 76, 44);
    // White border lines
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1;
    ctx.strokeRect(x - 37, y - 21, 74, 42);
    // Center net
    ctx.fillStyle = '#e0e0e0'; ctx.fillRect(x - 1, y - 22, 2, 44);
    // Net posts
    ctx.fillStyle = '#9e9e9e'; ctx.fillRect(x - 2, y - 24, 4, 3);
    ctx.fillStyle = '#9e9e9e'; ctx.fillRect(x - 2, y + 20, 4, 3);
    // Net mesh (dashed look)
    ctx.fillStyle = 'rgba(200,200,200,0.5)';
    for (var ny = -20; ny < 20; ny += 4) {
        ctx.fillRect(x - 1, y + ny, 2, 2);
    }
    // Table legs
    ctx.fillStyle = '#5d4037';
    ctx.fillRect(x - 38, y + 22, 4, 8);
    ctx.fillRect(x + 34, y + 22, 4, 8);
    ctx.fillRect(x - 38, y - 24, 4, 8);
    ctx.fillRect(x + 34, y - 24, 4, 8);
    // Center line
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.fillRect(x - 37, y - 1, 74, 1);
    _clearFurnitureShadow();
}

function startPongGame(a1, a2) {
    var g = {
        p1: a1, p2: a2,
        ballX: 0, ballY: 0, ballVX: 1.5, ballVY: 0.8,
        p1Score: 0, p2Score: 0,
        p1Y: 0, p2Y: 0,
        phase: 'walking', // walking → playing → result
        timer: 0, maxRounds: 5
    };
    a1.idleAction = 'pong'; a1.interactTimer = 0; a1.idleReturnTimer = 0;
    a2.idleAction = 'pong'; a2.interactTimer = 0; a2.idleReturnTimer = 0;
    // Walk to table sides
    a1.targetX = PONG_TABLE.x - 50; a1.targetY = PONG_TABLE.y;
    a2.targetX = PONG_TABLE.x + 50; a2.targetY = PONG_TABLE.y;
    pongGames.push(g);
}

function maybeStartPong(agent) {
    if (agent.idleAction === 'pong' || pongGames.length >= 1) return;
    // Agent waiting at table — look for a partner already there
    if (agent.idleAction === 'pong_wait') {
        // Check if arrived at table first
        var distToTable = Math.abs(agent.x - PONG_TABLE.x) + Math.abs(agent.y - PONG_TABLE.y);
        if (distToTable > 80) return; // still walking
        for (var i = 0; i < agents.length; i++) {
            var other = agents[i];
            if (other.id === agent.id) continue;
            if (other.idleAction === 'pong_wait') {
                var otherDist = Math.abs(other.x - PONG_TABLE.x) + Math.abs(other.y - PONG_TABLE.y);
                if (otherDist < 80) { startPongGame(agent, other); return; }
            }
        }
        // Active recruitment — pull ONE random idle agent to come play (only if < 2 waiting)
        var _waitCount = agents.filter(function(a) { return a.idleAction === 'pong_wait'; }).length;
        if (_waitCount < 2 && Math.random() < 0.02) {
            var candidates = [];
            for (var j = 0; j < agents.length; j++) {
                var c = agents[j];
                if (c.id === agent.id) continue;
                if (c.state === 'idle' && !c.idleAction && !c.meetingId && c.isSitting) candidates.push(c);
            }
            if (candidates.length > 0) {
                var recruit = candidates[Math.floor(Math.random() * candidates.length)];
                recruit.targetX = PONG_TABLE.x + (agent.x < PONG_TABLE.x ? 50 : -50);
                recruit.targetY = PONG_TABLE.y + (Math.random() - 0.5) * 10;
                recruit.idleAction = 'pong_wait';
                recruit.idleReturnTimer = 1800 + Math.floor(Math.random() * 1200);
                recruit.isSitting = false;
                recruit.addIntent('Heading to play ping pong');
            }
        }
        return;
    }
    // Social trigger — two agents near each other anywhere
    if (agent.socialTarget && agent.id < agent.socialTarget && Math.random() < 0.005) {
        var other = agentMap[agent.socialTarget];
        if (other && !other.isSitting && !other.idleAction && agent.state === 'idle' && other.state === 'idle') {
            startPongGame(agent, other);
        }
    }
}

function updatePongGames() {
    _updatePongTablePos();
    for (var i = pongGames.length - 1; i >= 0; i--) {
        var g = pongGames[i];
        var p1 = g.p1, p2 = g.p2;
        g.timer++;

        if (g.phase === 'walking') {
            var d1 = Math.abs(p1.x - (PONG_TABLE.x - 50)) + Math.abs(p1.y - PONG_TABLE.y);
            var d2 = Math.abs(p2.x - (PONG_TABLE.x + 50)) + Math.abs(p2.y - PONG_TABLE.y);
            if (d1 < 5 && d2 < 5) {
                g.phase = 'playing'; g.timer = 0;
                p1.faceDir = 1; p2.faceDir = -1;
                g.ballX = 0; g.ballY = 0;
                g.p1Y = 0; g.p2Y = 0;
            }
            if (g.timer > 300) { pongGames.splice(i, 1); p1.idleAction = null; p2.idleAction = null; continue; }
        }

        if (g.phase === 'playing') {
            // Ball physics
            g.ballX += g.ballVX;
            g.ballY += g.ballVY;
            // Bounce off top/bottom
            if (g.ballY > 18 || g.ballY < -18) g.ballVY *= -1;
            // Paddle AI — with reaction delay and imperfection
            if (!g.p1Offset) g.p1Offset = 0;
            if (!g.p2Offset) g.p2Offset = 0;
            // Randomize target slightly so they don't perfectly track
            if (g.timer % 30 === 0) {
                g.p1Offset = (Math.random() - 0.5) * 12;
                g.p2Offset = (Math.random() - 0.5) * 12;
            }
            // Only track when ball is on their side
            if (g.ballVX < 0) {
                g.p1Y += (g.ballY + g.p1Offset - g.p1Y) * 0.12;
            } else {
                g.p1Y += (0 - g.p1Y) * 0.03; // drift back to center
            }
            if (g.ballVX > 0) {
                g.p2Y += (g.ballY + g.p2Offset - g.p2Y) * 0.10;
            } else {
                g.p2Y += (0 - g.p2Y) * 0.03;
            }
            // Lock agents to table sides + track ball vertically
            p1.x = PONG_TABLE.x - 50;
            p2.x = PONG_TABLE.x + 50;
            p1.y = PONG_TABLE.y + g.p1Y * 0.6;
            p2.y = PONG_TABLE.y + g.p2Y * 0.6;
            // Sync targets so isMoving stays false (paddles render)
            p1.targetX = p1.x; p1.targetY = p1.y;
            p2.targetX = p2.x; p2.targetY = p2.y;
            // Keep facing the table
            p1.faceDir = 1; p2.faceDir = -1;
            // Swing tracking — how close ball is to each paddle
            g.p1Swing = g.ballX < -20 ? Math.min(1, (-20 - g.ballX) / 16) : 0;
            g.p2Swing = g.ballX > 20 ? Math.min(1, (g.ballX - 20) / 16) : 0;
            // Score — ball past paddles
            if (g.ballX > 36) {
                g.p1Score++; g.ballX = 0; g.ballY = 0;
                g.ballVX = -1.5; g.ballVY = (Math.random() - 0.5) * 2;
            }
            if (g.ballX < -36) {
                g.p2Score++; g.ballX = 0; g.ballY = 0;
                g.ballVX = 1.5; g.ballVY = (Math.random() - 0.5) * 2;
            }
            // Paddle hit — with angle variation
            if (g.ballX < -30 && g.ballVX < 0 && Math.abs(g.ballY - g.p1Y) < 8) {
                g.ballVX = Math.abs(g.ballVX) * (1.02 + Math.random() * 0.1);
                g.ballVY = (g.ballY - g.p1Y) * 0.4 + (Math.random() - 0.5) * 1.5;
            }
            if (g.ballX > 30 && g.ballVX > 0 && Math.abs(g.ballY - g.p2Y) < 8) {
                g.ballVX = -Math.abs(g.ballVX) * (1.02 + Math.random() * 0.1);
                g.ballVY = (g.ballY - g.p2Y) * 0.4 + (Math.random() - 0.5) * 1.5;
            }
            // Speed cap
            g.ballVX = Math.max(-3, Math.min(3, g.ballVX));
            g.ballVY = Math.max(-2, Math.min(2, g.ballVY));

            // End after maxRounds total points
            if (g.p1Score + g.p2Score >= g.maxRounds) {
                g.phase = 'result'; g.timer = 0;
            }
        }

        if (g.phase === 'result') {
            if (g.timer > 120) {
                // Winner celebrates
                var winner = g.p1Score > g.p2Score ? p1 : p2;
                winner._socialMouth = 'laugh';
                p1.idleAction = null; p2.idleAction = null;
                p1.targetX = p1.desk.x; p1.targetY = p1.desk.y;
                p2.targetX = p2.desk.x; p2.targetY = p2.desk.y;
                pongGames.splice(i, 1);
            }
        }
    }
}

function drawPongGames() {
    for (var i = 0; i < pongGames.length; i++) {
        var g = pongGames[i];
        if (g.phase !== 'playing' && g.phase !== 'result') continue;
        var tx = PONG_TABLE.x, ty = PONG_TABLE.y;

        // Ball (small white circle)
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(tx + g.ballX, ty + g.ballY, 2, 0, Math.PI * 2); ctx.fill();

        // Paddles removed — rackets are drawn on agents now

        // Scoreboard (names stacked to avoid overlap)
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(tx - 30, ty - 42, 60, 20);
        ctx.font = '7px Arial'; ctx.textAlign = 'center';
        ctx.fillStyle = '#f44336';
        ctx.fillText(g.p1.name + ': ' + g.p1Score, tx, ty - 34);
        ctx.fillStyle = '#2196f3';
        ctx.fillText(g.p2.name + ': ' + g.p2Score, tx, ty - 25);

        // Result
        if (g.phase === 'result') {
            var winnerName = g.p1Score > g.p2Score ? g.p1.name : g.p2.name;
            ctx.fillStyle = 'rgba(0,0,0,0.7)';
            ctx.fillRect(tx - 30, ty - 10, 60, 16);
            ctx.fillStyle = '#ffd600'; ctx.font = 'bold 7px Arial';
            ctx.fillText(winnerName + ' wins!', tx, ty + 2);
        }
    }
}

function drawBreakArea(x, y) {
    _setFurnitureLampShadow(x + 120, y + 60);
    drawVendingMachine(x + 5, y + 15);
    drawPlant(x + 60, y + 10);
    drawWaterCooler(x + 160, y + 15);
    // Counter shadow (bottom only)
    ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fillRect(x + 80, y + 108, 72, 15);
    // Counter (moved down)
    ctx.fillStyle = '#e0e0e0'; ctx.fillRect(x + 80, y + 78, 72, 34);
    ctx.fillStyle = '#f5f5f5'; ctx.fillRect(x + 82, y + 80, 68, 30);
    // Counter top surface
    ctx.fillStyle = '#fafafa'; ctx.fillRect(x + 80, y + 78, 72, 4);
    // Cabinet doors
    ctx.fillStyle = '#e0e0e0'; ctx.fillRect(x + 84, y + 88, 28, 18); ctx.fillRect(x + 116, y + 88, 28, 18);
    ctx.fillStyle = '#bdbdbd'; ctx.fillRect(x + 96, y + 95, 4, 3); ctx.fillRect(x + 128, y + 95, 4, 3);
    // Coffee machine on counter
    ctx.fillStyle = '#212121'; ctx.fillRect(x + 95, y + 58, 24, 22);
    ctx.fillStyle = '#333'; ctx.fillRect(x + 97, y + 60, 20, 18);
    // Water tank
    ctx.fillStyle = 'rgba(3,169,244,0.5)'; ctx.fillRect(x + 111, y + 60, 5, 14);
    // Buttons
    ctx.fillStyle = '#4caf50'; ctx.fillRect(x + 99, y + 62, 4, 3);
    ctx.fillStyle = '#f44336'; ctx.fillRect(x + 99, y + 67, 4, 3);
    // Drip area
    ctx.fillStyle = '#424242'; ctx.fillRect(x + 99, y + 73, 12, 4);
    // Cup under drip
    ctx.fillStyle = '#fff'; ctx.fillRect(x + 102, y + 71, 6, 6);
    // Steam
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(x + 104, y + 66, 2, 3); ctx.fillRect(x + 106, y + 64, 2, 3);
    // --- Kitchen counter with microwave & toaster ---
    // Counter shadow
    ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fillRect(x + 170, y + 108, 72, 15);
    // Counter body
    ctx.fillStyle = '#e0e0e0'; ctx.fillRect(x + 170, y + 78, 72, 34);
    ctx.fillStyle = '#f5f5f5'; ctx.fillRect(x + 172, y + 80, 68, 30);
    // Counter top surface
    ctx.fillStyle = '#fafafa'; ctx.fillRect(x + 170, y + 78, 72, 4);
    // Cabinet doors
    ctx.fillStyle = '#e0e0e0'; ctx.fillRect(x + 174, y + 88, 28, 18); ctx.fillRect(x + 206, y + 88, 28, 18);
    ctx.fillStyle = '#bdbdbd'; ctx.fillRect(x + 186, y + 95, 4, 3); ctx.fillRect(x + 218, y + 95, 4, 3);

    // Microwave (animated when in use)
    var micInUse = agents.some(function(a) { return a.idleAction === 'make_food' && !a.isSitting && Math.abs(a.x - (x + 190)) < 40; });
    ctx.fillStyle = '#455a64'; ctx.fillRect(x + 175, y + 56, 30, 24);
    ctx.fillStyle = '#37474f'; ctx.fillRect(x + 177, y + 58, 26, 20);
    // Door window
    ctx.fillStyle = '#263238'; ctx.fillRect(x + 178, y + 59, 17, 17);
    if (micInUse) {
        // Glowing interior when running
        var micGlow = 0.15 + Math.sin(_weatherTick * 0.15) * 0.1;
        ctx.fillStyle = 'rgba(255,200,50,' + micGlow + ')';
        ctx.fillRect(x + 179, y + 60, 15, 15);
        // Rotating plate (small dots moving in circle)
        var plateAngle = _weatherTick * 0.08;
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.beginPath(); ctx.arc(x + 186, y + 68 + Math.sin(plateAngle) * 2, 1, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(x + 186 + Math.cos(plateAngle) * 3, y + 68, 1, 0, Math.PI * 2); ctx.fill();
    } else {
        ctx.fillStyle = 'rgba(100,200,255,0.15)'; ctx.fillRect(x + 179, y + 60, 15, 15);
    }
    // Door handle
    ctx.fillStyle = '#90a4ae'; ctx.fillRect(x + 196, y + 63, 2, 10);
    // Control panel (right side)
    ctx.fillStyle = '#546e7a'; ctx.fillRect(x + 199, y + 59, 4, 17);
    // Buttons
    ctx.fillStyle = micInUse ? '#76ff03' : '#4caf50'; ctx.fillRect(x + 200, y + 61, 2, 2);
    ctx.fillStyle = '#f44336'; ctx.fillRect(x + 200, y + 65, 2, 2);
    ctx.fillStyle = '#78909c'; ctx.fillRect(x + 200, y + 69, 2, 2);
    ctx.fillRect(x + 200, y + 73, 2, 2);
    // Digital display
    ctx.fillStyle = micInUse ? '#1b5e20' : '#0a3010'; ctx.fillRect(x + 178, y + 60, 8, 4);
    ctx.fillStyle = micInUse ? '#76ff03' : '#4caf50'; ctx.font = '3px Arial'; ctx.textAlign = 'left';
    if (micInUse) {
        var secs = Math.floor(_weatherTick * 0.05) % 60;
        ctx.fillText((secs < 10 ? '0:0' : '0:') + secs, x + 179, y + 63);
    } else {
        ctx.fillText('0:00', x + 179, y + 63);
    }
    // Microwave hum — small vibration when running
    if (micInUse) {
        ctx.fillStyle = 'rgba(255,200,50,0.08)';
        var humOff = Math.sin(_weatherTick * 0.3) * 0.5;
        ctx.fillRect(x + 175 + humOff, y + 55, 30, 1);
    }

    // Toaster (animated when in use)
    var toastInUse = agents.some(function(a) { return a.idleAction === 'make_food' && !a.isSitting && Math.abs(a.x - (x + 220)) < 30; });
    ctx.fillStyle = '#bdbdbd'; ctx.fillRect(x + 212, y + 64, 18, 16);
    ctx.fillStyle = '#e0e0e0'; ctx.fillRect(x + 213, y + 65, 16, 14);
    // Rounded top
    ctx.fillStyle = '#bdbdbd'; ctx.fillRect(x + 213, y + 62, 16, 4);
    // Bread slots
    ctx.fillStyle = '#424242'; ctx.fillRect(x + 215, y + 62, 4, 3);
    ctx.fillRect(x + 222, y + 62, 4, 3);
    if (toastInUse) {
        // Bread pushed down (not peeking out) + red glow from slots
        ctx.fillStyle = 'rgba(255,80,20,0.4)';
        ctx.fillRect(x + 215, y + 62, 4, 3);
        ctx.fillRect(x + 222, y + 62, 4, 3);
        // Heat glow rising from slots
        ctx.fillStyle = 'rgba(255,100,30,' + (0.15 + Math.sin(_weatherTick * 0.1) * 0.1) + ')';
        ctx.fillRect(x + 215, y + 58 - Math.sin(_weatherTick * 0.08) * 2, 4, 4);
        ctx.fillRect(x + 222, y + 58 - Math.cos(_weatherTick * 0.08) * 2, 4, 4);
        // Lever pushed down
        ctx.fillStyle = '#78909c'; ctx.fillRect(x + 229, y + 72, 2, 4);
        ctx.fillStyle = '#546e7a'; ctx.fillRect(x + 228, y + 72, 4, 2);
        // Heat shimmer lines
        ctx.strokeStyle = 'rgba(255,150,50,0.15)'; ctx.lineWidth = 0.5;
        for (var hi = 0; hi < 3; hi++) {
            var hx = x + 216 + hi * 4;
            var hy = y + 56 - (_weatherTick * 0.3 + hi * 5) % 10;
            ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(hx + Math.sin(_weatherTick * 0.1 + hi) * 2, hy - 3); ctx.stroke();
        }
    } else {
        // Bread peeking out (idle)
        ctx.fillStyle = '#d4a056'; ctx.fillRect(x + 215, y + 60, 4, 3);
        ctx.fillRect(x + 222, y + 60, 4, 3);
        // Lever up
        ctx.fillStyle = '#78909c'; ctx.fillRect(x + 229, y + 68, 2, 6);
        ctx.fillStyle = '#546e7a'; ctx.fillRect(x + 228, y + 68, 4, 2);
    }
    // Front label
    ctx.fillStyle = '#9e9e9e'; ctx.fillRect(x + 217, y + 72, 8, 1);

    // Label
    ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.font = '8px "Press Start 2P"'; ctx.textAlign = 'center';
    _clearFurnitureShadow();
    ctx.fillText('BREAK ROOM', x + 100, y - 15);
}

function drawWaterCooler(x, y) {
    // Floor shadow
    ctx.fillStyle = 'rgba(0,0,0,0.1)'; ctx.beginPath(); ctx.ellipse(x, y + 42, 16, 5, 0, 0, Math.PI * 2); ctx.fill();
    // Legs
    ctx.fillStyle = '#757575'; ctx.fillRect(x - 10, y + 34, 4, 8); ctx.fillRect(x + 6, y + 34, 4, 8);
    // Base/stand body (flush with tank bottom)
    ctx.fillStyle = '#e0e0e0'; ctx.fillRect(x - 12, y, 24, 36);
    ctx.fillStyle = '#eeeeee'; ctx.fillRect(x - 10, y + 2, 20, 32);
    // Front panel detail
    ctx.fillStyle = '#f5f5f5'; ctx.fillRect(x - 8, y + 8, 16, 10);
    // Spigot area
    ctx.fillStyle = '#bdbdbd'; ctx.fillRect(x - 8, y + 18, 16, 8);
    // Hot spigot (red label + nozzle)
    ctx.fillStyle = '#f44336'; ctx.fillRect(x - 7, y + 19, 6, 6);
    ctx.fillStyle = '#d32f2f'; ctx.fillRect(x - 5, y + 25, 2, 3);
    // Cold spigot (blue label + nozzle)
    ctx.fillStyle = '#2196f3'; ctx.fillRect(x + 1, y + 19, 6, 6);
    ctx.fillStyle = '#1976d2'; ctx.fillRect(x + 3, y + 25, 2, 3);
    // Spigot labels
    ctx.fillStyle = '#fff'; ctx.font = '3px Arial'; ctx.textAlign = 'center';
    ctx.fillText('H', x - 4, y + 24); ctx.fillText('C', x + 4, y + 24);
    // Drip tray
    ctx.fillStyle = '#9e9e9e'; ctx.fillRect(x - 10, y + 28, 20, 4);
    ctx.fillStyle = '#bdbdbd'; ctx.fillRect(x - 9, y + 29, 18, 2);
    // Water droplet on tray
    ctx.fillStyle = 'rgba(3,169,244,0.4)'; ctx.fillRect(x - 2, y + 29, 3, 2);
    // Water jug
    ctx.fillStyle = 'rgba(3, 169, 244, 0.6)'; ctx.fillRect(x - 9, y - 28, 18, 28);
    // Jug rounded top
    ctx.fillStyle = 'rgba(3, 169, 244, 0.5)';
    ctx.beginPath(); ctx.arc(x, y - 28, 9, Math.PI, 0); ctx.fill();
    // Jug cap/neck
    ctx.fillStyle = '#0277bd'; ctx.fillRect(x - 4, y - 34, 8, 6);
    ctx.fillStyle = '#01579b'; ctx.fillRect(x - 3, y - 36, 6, 3);
    // Water level line
    ctx.fillStyle = 'rgba(2,136,209,0.3)'; ctx.fillRect(x - 8, y - 8, 16, 1);
    // Shine on jug
    ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.fillRect(x - 7, y - 24, 3, 20);
    ctx.fillStyle = 'rgba(255,255,255,0.2)'; ctx.fillRect(x - 3, y - 22, 2, 16);
    // Animated bubbles in jug
    var coolerInUse = agents.some(function(a) { return a.idleAction === 'get_water' && !a.isSitting; });
    var bubbleActive = coolerInUse || (_weatherTick % 18000 < 60); // in-use OR random burst every ~5 min
    var bubbleSpeed = coolerInUse ? 1.5 : 0.8;
    var numBubbles = coolerInUse ? 5 : 3;
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    for (var bi = 0; bi < numBubbles; bi++) {
        var bSeed = bi * 17 + 7;
        var bx = x - 4 + (bSeed % 10);
        var byBase = y - 2;
        var byOff = bubbleActive ? (_weatherTick * bubbleSpeed + bi * 40) % 28 : (bi * 9);
        var bSize = 1 + (bi % 2);
        var bAlpha = bubbleActive ? Math.max(0.1, 0.6 - byOff / 40) : 0.35;
        ctx.globalAlpha = bAlpha;
        ctx.beginPath(); ctx.arc(bx + Math.sin(_weatherTick * 0.04 + bi) * 1.5, byBase - byOff, bSize, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1.0;
    // Cup dispenser on side
    ctx.fillStyle = '#e0e0e0'; ctx.fillRect(x + 14, y + 4, 12, 18);
    ctx.fillStyle = '#f5f5f5'; ctx.fillRect(x + 15, y + 5, 10, 16);
    // Cups inside
    ctx.fillStyle = '#fff';
    ctx.fillRect(x + 16, y + 7, 4, 10); ctx.fillRect(x + 21, y + 7, 4, 10);
    // Cup dispenser slot
    ctx.fillStyle = '#bdbdbd'; ctx.fillRect(x + 15, y + 19, 10, 2);
}

function drawVendingMachine(x, y) {
    // Shadow (bottom only)
    ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fillRect(x, y + 71, 45, 15);
    // Body
    ctx.fillStyle = '#b71c1c'; ctx.fillRect(x, y, 45, 75);
    ctx.fillStyle = '#c62828'; ctx.fillRect(x + 2, y + 2, 41, 71);
    // Window
    ctx.fillStyle = '#e3f2fd'; ctx.fillRect(x + 5, y + 5, 28, 45);
    ctx.fillStyle = 'rgba(255,255,255,0.2)'; ctx.fillRect(x + 5, y + 5, 10, 45); // glass shine
    // Snacks in rows
    const snackCols = ['#ffc107', '#ff5722', '#4caf50', '#795548', '#e91e63', '#2196f3'];
    for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 3; c++) {
            ctx.fillStyle = snackCols[(r * 3 + c) % 6];
            ctx.fillRect(x + 7 + c * 9, y + 7 + r * 11, 6, 8);
            // Highlight
            ctx.fillStyle = 'rgba(255,255,255,0.3)';
            ctx.fillRect(x + 7 + c * 9, y + 7 + r * 11, 2, 2);
        }
        // Shelf
        ctx.fillStyle = '#bdbdbd'; ctx.fillRect(x + 5, y + 16 + r * 11, 28, 1);
    }
    // Coin slot area
    ctx.fillStyle = '#1a1a1a'; ctx.fillRect(x + 5, y + 55, 35, 15);
    // Buttons
    ctx.fillStyle = '#4caf50'; ctx.fillRect(x + 35, y + 10, 6, 6);
    ctx.fillStyle = '#f44336'; ctx.fillRect(x + 35, y + 20, 6, 6);
    // Dispenser slot
    ctx.fillStyle = '#424242'; ctx.fillRect(x + 8, y + 58, 28, 8);
    // Brand label
    ctx.fillStyle = '#ffd700'; ctx.font = '4px "Press Start 2P"'; ctx.textAlign = 'center';
    ctx.fillText('SNAX', x + 22, y + 54);
}

function drawTallPlant(x, y) {
    // Pot
    ctx.fillStyle = '#a1887f'; ctx.fillRect(x - 2, y + 28, 22, 4);
    ctx.fillStyle = '#d84315'; ctx.fillRect(x, y + 30, 18, 18);
    ctx.fillStyle = '#e64a19'; ctx.fillRect(x + 2, y + 32, 14, 14);
    // Soil
    ctx.fillStyle = '#4e342e'; ctx.fillRect(x + 2, y + 30, 14, 4);
    // Stems
    ctx.fillStyle = '#2e7d32';
    ctx.fillRect(x + 5, y + 2, 3, 32); ctx.fillRect(x + 11, y - 6, 3, 40);
    // Leaves (pixel clusters)
    ctx.fillStyle = '#43a047';
    ctx.fillRect(x + 1, y - 2, 6, 4); ctx.fillRect(x + 3, y - 6, 4, 4);
    ctx.fillRect(x + 8, y - 10, 6, 4); ctx.fillRect(x + 12, y - 14, 4, 4);
    ctx.fillStyle = '#66bb6a';
    ctx.fillRect(x - 1, y + 4, 4, 6); ctx.fillRect(x + 14, y - 4, 4, 6);
    ctx.fillRect(x + 8, y + 6, 4, 4);
    // Leaf highlights
    ctx.fillStyle = '#81c784';
    ctx.fillRect(x + 2, y - 4, 2, 2); ctx.fillRect(x + 10, y - 12, 2, 2);
}

function drawPlant(x, y) {
    // Pot
    ctx.fillStyle = '#eceff1'; ctx.fillRect(x, y + 10, 16, 14);
    ctx.fillStyle = '#fafafa'; ctx.fillRect(x + 2, y + 12, 12, 10);
    // Soil
    ctx.fillStyle = '#4e342e'; ctx.fillRect(x + 2, y + 10, 12, 4);
    // Bush leaves
    ctx.fillStyle = '#2e7d32'; ctx.beginPath(); ctx.arc(x + 8, y + 5, 9, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#388e3c'; ctx.beginPath(); ctx.arc(x + 3, y + 1, 6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#43a047'; ctx.beginPath(); ctx.arc(x + 13, y + 1, 6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#4caf50'; ctx.beginPath(); ctx.arc(x + 8, y - 3, 5, 0, Math.PI * 2); ctx.fill();
    // Highlights
    ctx.fillStyle = '#66bb6a';
    ctx.fillRect(x + 4, y - 2, 3, 3); ctx.fillRect(x + 10, y + 2, 3, 3);
}

function drawBookshelf(x, y) {
    // Shadow (bottom only)
    ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fillRect(x, y + 76, 50, 15);
    // Frame
    ctx.fillStyle = '#6d4c41'; ctx.fillRect(x, y, 50, 80);
    ctx.fillStyle = '#8d6e63'; ctx.fillRect(x + 2, y + 2, 46, 76);
    ctx.fillStyle = '#5d4037'; ctx.fillRect(x + 4, y + 4, 42, 72);
    // Books in 3 rows
    const bookColors = ['#e57373','#ef5350','#64b5f6','#42a5f5','#fff176','#ffee58','#81c784','#66bb6a','#ce93d8','#ff8a65','#4dd0e1','#a1887f'];
    for (let r = 0; r < 3; r++) {
        const shelfY = y + 6 + r * 24;
        let bx = x + 6;
        for (let i = 0; i < 6; i++) {
            const bw = 3 + (i % 3); // varying widths
            const bh = 14 + (i % 2) * 3; // varying heights
            ctx.fillStyle = bookColors[(r * 6 + i) % bookColors.length];
            ctx.fillRect(bx, shelfY + (18 - bh), bw, bh);
            // Spine detail
            ctx.fillStyle = 'rgba(0,0,0,0.15)';
            ctx.fillRect(bx, shelfY + (18 - bh), 1, bh);
            // Title line
            ctx.fillStyle = 'rgba(255,255,255,0.3)';
            ctx.fillRect(bx + 1, shelfY + (18 - bh) + 3, bw - 2, 1);
            bx += bw + 1;
        }
        // Shelf
        ctx.fillStyle = '#8d6e63'; ctx.fillRect(x + 4, shelfY + 18, 42, 3);
        ctx.fillStyle = '#a1887f'; ctx.fillRect(x + 4, shelfY + 18, 42, 1);
    }
    // Small ornament on top shelf
    ctx.fillStyle = '#ffd700'; ctx.fillRect(x + 36, y + 6, 6, 8);
    ctx.fillStyle = '#ffeb3b'; ctx.fillRect(x + 37, y + 7, 4, 4);
}

// --- INTERACTION ---
// Track drag distance to distinguish clicks from pans
let _clickStartX = 0, _clickStartY = 0;
// canvas/window mouseup handler removed — forwarded via VOBuildingEngine

let _touchStartX2 = 0, _touchStartY2 = 0;
// canvas/window touchend handler removed — forwarded via VOBuildingEngine

function handleCanvasClick(clientX, clientY) {
    if (editMode) return; // edit mode handles clicks via click event
    const world = screenToWorld(clientX, clientY);
    const cx = world.x;
    const cy = world.y;
    // Check chat bubble scroll arrows
    for (var si = 0; si < renderedChatBubbles.length; si++) {
        var sb = renderedChatBubbles[si];
        var sr = sb.fullRect;
        if (cx >= sr.x && cx <= sr.x + sr.w && cy >= sr.y && cy <= sr.y + sr.h) {
            if (cy < sr.y + 15) continue;
            if (sb.canScrollUp && cy < sr.y + 28) {
                chatScrollOffset[sb.agentKey] = (chatScrollOffset[sb.agentKey] || 0) + 3;
                return;
            }
            if (sb.canScrollDown && cy > sr.y + sr.h - 18) {
                chatScrollOffset[sb.agentKey] = Math.max(0, (chatScrollOffset[sb.agentKey] || 0) - 3);
                return;
            }
        }
    }
    // Chat bubble close/minimize
    if (handleChatBubbleClick(cx, cy)) return;
    // Thought/speech bubble close/minimize
    if (handleBubbleClick(cx, cy)) return;
    // Check gear icon click to open agent modal
    for (const agent of agents) {
        const g = agent.gearRect;
        if (g && cx >= g.x && cx <= g.x + g.w && cy >= g.y && cy <= g.y + g.h) {
            openModal(agent);
            return;
        }
    }
}

function openModal() { /* stubbed: DOM/server removed from engine */ }

function escHtml(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
}

function clearNotifyOnServer() { /* no-op: server calls removed from engine */ }

function closeModal() { /* stubbed: DOM/server removed from engine */ }

function overrideAgent() { /* stubbed: DOM/server removed from engine */ }

function setGlobalState() { /* stubbed: DOM/server removed from engine */ }

// --- Bubble Toggle & Manual Triggers ---
let bubblesVisible = true;

function expandAllBubbles() {
    bubblesVisible = true;
    agents.forEach(a => {
        const ms = getBubbleMinState(a);
        ms.thought = false;
        ms.speech = false;
        a.thoughtChars = 0;
        a.speechChars = 0;
    });
    addGlobalLog('💬 All bubbles expanded');
    expandAllChat();
}

function minimizeAllBubbles() {
    agents.forEach(a => {
        const ms = getBubbleMinState(a);
        ms.thought = true;
        ms.speech = true;
    });
    addGlobalLog('💬 All bubbles minimized');
    minimizeAllChat();
}

function triggerBubble(type) {
    if (!selectedAgent) return;
    const text = prompt(type === 'thought' ? `💭 What is ${selectedAgent.name} thinking?` : `💬 What does ${selectedAgent.name} say?`);
    if (!text) return;
    if (type === 'thought') {
        selectedAgent.thought = text;
        selectedAgent.lastThought = text;
        selectedAgent.thoughtChars = 0;
        selectedAgent.thoughtAge = 0;
        addGlobalLog(`💭 ${selectedAgent.name} thinking: ${text.substring(0, 40)}...`);
    } else {
        const target = prompt('→ To whom? (leave blank for general)') || '';
        selectedAgent.speech = text;
        selectedAgent.speechTarget = target;
        selectedAgent.lastSpeech = text;
        selectedAgent.lastSpeechTarget = target;
        selectedAgent.speechChars = 0;
        selectedAgent.speechAge = 0;
        selectedAgent.talkTimer = 60;
        addGlobalLog(`💬 ${selectedAgent.name}${target ? ' → ' + target : ''}: ${text.substring(0, 40)}...`);
    }
}

function clearAgentBubbles() {
    if (!selectedAgent) return;
    selectedAgent.thought = '';
    selectedAgent.speech = '';
    selectedAgent.speechTarget = '';
    addGlobalLog(`🧹 Cleared bubbles for ${selectedAgent.name}`);
}

// Bubble button wire-up removed (no HTML elements in engine)
// === LIVE CHAT BUBBLE SYSTEM ===
var agentChatData = {};
var agentChatWrapped = {}; // agentKey -> [{text, isUser, separator}] pre-wrapped lines
var lastChatPoll = 0;
var chatLastMsg = {}; // agentKey -> last seen message text
var chatTypewriterState = {};
var chatMinimized = {}; // agentKey -> bool
var _chatInitialLoad = true; // first poll: minimize all by default
var renderedChatBubbles = []; // for click detection
var renderedChatIcons = [];
var chatScrollOffset = {}; // agentKey -> scroll offset (lines from bottom)
var chatHoveredBubble = null; // agentKey of bubble mouse is over

function pollAgentChat() {
    // No-op: chat data is injected via setChatData()
}

function wrapChatText(text, maxW) {
    ctx.font = '9px Arial, sans-serif';
    var padW = maxW - 12;
    var words = text.split(' ');
    var lines = []; var line = '';
    for (var wi = 0; wi < words.length; wi++) {
        var word = words[wi];
        // Break long words that exceed bubble width
        while (ctx.measureText(word).width > padW) {
            var fit = '';
            for (var ci = 0; ci < word.length; ci++) {
                var tryFit = fit + word[ci];
                if (ctx.measureText(line ? line + ' ' + tryFit : tryFit).width > padW) break;
                fit = tryFit;
            }
            if (fit.length === 0) { fit = word[0]; }
            if (line) { lines.push(line); line = ''; }
            lines.push(fit);
            word = word.substring(fit.length);
        }
        if (!word) continue;
        var test = line ? line + ' ' + word : word;
        if (ctx.measureText(test).width > padW && line) {
            lines.push(line); line = word;
        } else { line = test; }
    }
    if (line) lines.push(line);
    return lines;
}

function minimizeAllChat() {
    for (var key in agentChatData) { chatMinimized[key] = true; }
    addGlobalLog('💬 All chat bubbles minimized');
}

function expandAllChat() {
    for (var key in agentChatData) { chatMinimized[key] = false; }
    addGlobalLog('💬 All chat bubbles expanded');
}

function handleChatBubbleClick(canvasX, canvasY) {
    // Check close buttons on expanded chat bubbles
    for (var i = 0; i < renderedChatBubbles.length; i++) {
        var rb = renderedChatBubbles[i];
        var cr = rb.closeRect;
        if (canvasX >= cr.x && canvasX <= cr.x + cr.w && canvasY >= cr.y && canvasY <= cr.y + cr.h) {
            chatMinimized[rb.agentKey] = true;
            return true;
        }
    }
    // Check minimized icons — click to restore
    for (var j = 0; j < renderedChatIcons.length; j++) {
        var icon = renderedChatIcons[j];
        if (canvasX >= icon.x && canvasX <= icon.x + icon.w && canvasY >= icon.y && canvasY <= icon.y + icon.h) {
            chatMinimized[icon.agentKey] = false;
            return true;
        }
    }
    return false;
}

function drawChatBubbles() {
    var chatBubbles = [];
    renderedChatBubbles = [];
    renderedChatIcons = [];

    for (var ai = 0; ai < agents.length; ai++) {
        var agent = agents[ai];
        var msgs = agentChatData[agent.statusKey];
        if (!msgs || msgs.length === 0) continue;

        var headX = agent.x;
        var headY = agent.y - 50;

        // Minimized icon
        if (chatMinimized[agent.statusKey]) {
            var iconX = headX + 18;
            var iconY = headY - 20;
            // Draw minimized icon
            ctx.save();
            var iconCx = iconX + 7, iconCy = iconY + 7;
            ctx.fillStyle = 'rgba(15,20,30,0.7)';
            ctx.beginPath(); ctx.arc(iconCx, iconCy, 8, 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = 'rgba(100,200,255,0.6)';
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.arc(iconCx, iconCy, 8, 0, Math.PI * 2); ctx.stroke();
            ctx.font = '8px sans-serif';
            ctx.fillStyle = '#6cf';
            ctx.textAlign = 'center';
            ctx.fillText('💬', iconCx, iconCy + 3);
            ctx.restore();
            renderedChatIcons.push({ agentKey: agent.statusKey, x: iconX, y: iconY, w: 16, h: 16 });
            continue;
        }

        var preWrapped = agentChatWrapped[agent.statusKey];
        if (!preWrapped) continue;
        var renderedLines = [];
        for (var pi = 0; pi < preWrapped.length; pi++) {
            var entry = preWrapped[pi];
            if (entry._lastMsg) {
                // Last message — handle typewriter per-frame (only this one wraps)
                var tw = chatTypewriterState[agent.statusKey];
                var displayText = entry.msg.text;
                if (tw && !tw.done && tw.msgIdx === msgs.length - 1) {
                    tw.charIdx = Math.min(tw.charIdx + 2, tw.targetText.length);
                    displayText = tw.targetText.substring(0, tw.charIdx);
                    if (tw.charIdx >= tw.targetText.length) tw.done = true;
                }
                if (displayText.length > 350) displayText = displayText.substring(0, 347) + '...';
                var wrapped = wrapChatText(entry.prefix + displayText, 155);
                for (var li = 0; li < wrapped.length; li++) {
                    renderedLines.push({ text: wrapped[li], isUser: entry.isUser });
                }
            } else {
                renderedLines.push(entry);
            }
        }
        var maxVisLines = 10;
        var scrollOff = chatScrollOffset[agent.statusKey] || 0;
        var endIdx = renderedLines.length - scrollOff;
        if (endIdx < maxVisLines) endIdx = Math.min(renderedLines.length, maxVisLines);
        var startIdx = Math.max(0, endIdx - maxVisLines);
        var visLines = renderedLines.slice(startIdx, endIdx);
        var canScrollUp = startIdx > 0;
        var canScrollDown = scrollOff > 0;
        var bubbleH = Math.min(180, 26 + visLines.length * 12);
        chatBubbles.push({ agent: agent, agentKey: agent.statusKey, lines: visLines, canScrollUp: canScrollUp, canScrollDown: canScrollDown, x: headX + 25, y: headY - bubbleH - 10, w: 155, h: bubbleH, anchorX: headX, anchorY: headY, });
    }

    // Collision resolution
    for (var ci = 0; ci < chatBubbles.length; ci++) {
        chatBubbles[ci].x = Math.max(2, Math.min(W - chatBubbles[ci].w - 2, chatBubbles[ci].x));
        chatBubbles[ci].y = Math.max(2, Math.min(H - chatBubbles[ci].h - 20, chatBubbles[ci].y));
    }
    for (var pass = 0; pass < 5; pass++) {
        for (var i = 0; i < chatBubbles.length; i++) {
            for (var j = i + 1; j < chatBubbles.length; j++) {
                var a = chatBubbles[i], bb = chatBubbles[j];
                if (a.x < bb.x + bb.w && a.x + a.w > bb.x && a.y < bb.y + bb.h && a.y + a.h > bb.y) {
                    var overlapY = Math.min(a.y + a.h - bb.y, bb.y + bb.h - a.y);
                    var overlapX = Math.min(a.x + a.w - bb.x, bb.x + bb.w - a.x);
                    if (overlapY < overlapX) {
                        if (a.y < bb.y) { a.y -= overlapY / 2 + 2; bb.y += overlapY / 2 + 2; }
                        else { bb.y -= overlapY / 2 + 2; a.y += overlapY / 2 + 2; }
                    } else {
                        if (a.x < bb.x) { a.x -= overlapX / 2 + 2; bb.x += overlapX / 2 + 2; }
                        else { bb.x -= overlapX / 2 + 2; a.x += overlapX / 2 + 2; }
                    }
                }
            }
        }
        for (var ri = 0; ri < chatBubbles.length; ri++) {
            chatBubbles[ri].x = Math.max(2, Math.min(W - chatBubbles[ri].w - 2, chatBubbles[ri].x));
            chatBubbles[ri].y = Math.max(2, Math.min(H - chatBubbles[ri].h - 20, chatBubbles[ri].y));
        }
    }

    // Draw
    for (var bi = 0; bi < chatBubbles.length; bi++) {
        var b = chatBubbles[bi];
        ctx.save();
        var r = 6;

        // Speech tail
        var edgeX = Math.max(b.x + 8, Math.min(b.x + b.w - 8, b.anchorX));
        var edgeY = b.y + b.h;
        ctx.fillStyle = 'rgba(255,255,230,0.95)';
        ctx.strokeStyle = b.agent.color + '99';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(edgeX - 6, edgeY);
        ctx.lineTo(b.anchorX, b.anchorY);
        ctx.lineTo(edgeX + 6, edgeY);
        ctx.closePath();
        ctx.fill(); ctx.stroke();

        // Bubble body
        ctx.fillStyle = 'rgba(255,255,230,0.95)';
        ctx.strokeStyle = b.agent.color + '99';
        ctx.lineWidth = 1.5;
        drawRoundRect(b.x, b.y, b.w, b.h, r);
        ctx.fill(); ctx.stroke();

        // Header banner
        ctx.fillStyle = b.agent.color + 'dd';
        ctx.save();
        ctx.beginPath(); ctx.rect(b.x, b.y, b.w, 15); ctx.clip();
        drawRoundRect(b.x, b.y, b.w, 18, r); ctx.fill();
        ctx.restore();

        // Header text
        ctx.font = 'bold 9px Arial, sans-serif';
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'left';
        ctx.fillText(b.agent.name, b.x + 8, b.y + 11);

        // Live pulsing dot
        var pulse = 0.5 + Math.sin(Date.now() * 0.005) * 0.5;
        ctx.fillStyle = 'rgba(0,200,80,' + (0.5 + pulse * 0.5) + ')';
        ctx.beginPath(); ctx.arc(b.x + b.w - 22, b.y + 7, 3, 0, Math.PI * 2); ctx.fill();

        // Close button
        var closeX = b.x + b.w - 13;
        var closeY = b.y + 3;
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.fillRect(closeX, closeY, 10, 10);
        ctx.fillStyle = '#fff'; ctx.font = 'bold 9px Arial'; ctx.textAlign = 'center';
        ctx.fillText(String.fromCharCode(8722), closeX + 5, closeY + 8);
        renderedChatBubbles.push({ agentKey: b.agentKey, closeRect: { x: closeX, y: closeY, w: 10, h: 10 }, fullRect: { x: b.x, y: b.y, w: b.w, h: b.h }, canScrollUp: b.canScrollUp, canScrollDown: b.canScrollDown });

        // Message lines
        var lineY = b.y + 26;
        ctx.font = '9px Arial, sans-serif';
        ctx.textAlign = 'left';
        for (var li = 0; li < b.lines.length; li++) {
            var ln = b.lines[li];
            if (ln.separator) {
                ctx.strokeStyle = b.agent.color + '33';
                ctx.lineWidth = 0.5;
                ctx.beginPath();
                ctx.moveTo(b.x + 6, lineY - 2);
                ctx.lineTo(b.x + b.w - 6, lineY - 2);
                ctx.stroke();
                lineY += 4;
                continue;
            }
            ctx.fillStyle = ln.isUser ? '#4466aa' : '#222';
            ctx.fillText(ln.text, b.x + 5, lineY);
            lineY += 12;
        }
        // Scroll indicators
        if (b.canScrollUp) {
            ctx.fillStyle = 'rgba(180,150,50,0.6)';
            ctx.font = '8px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('▲', b.x + b.w / 2, b.y + 24);
        }
        if (b.canScrollDown) {
            ctx.fillStyle = 'rgba(180,150,50,0.6)';
            ctx.font = '8px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('▼', b.x + b.w / 2, b.y + b.h - 3);
        }
        ctx.restore();
    }
}

// ============================================================
// PAPER AIRPLANE SYSTEM — idle fun between agents
// ============================================================
const paperAirplanes = [];
const AIRPLANE_SPEED = 2.5;

function launchAirplane(fromAgent, toAgent) {
    paperAirplanes.push({
        x: fromAgent.x, y: fromAgent.y - 30,
        startX: fromAgent.x, startY: fromAgent.y - 30,
        endX: toAgent.x, endY: toAgent.y - 30,
        progress: 0,
        fromId: fromAgent.id,
        toId: toAgent.id,
        wobble: Math.random() * Math.PI * 2,
        caught: false,
        catchTimer: 0,
    });
    fromAgent.addIntent(`Threw a paper airplane at ${toAgent.name}!`);
    // Throw arm animation — briefly set talk timer to animate
    fromAgent.faceDir = toAgent.x > fromAgent.x ? 1 : -1;
}

function updateAirplanes() {
    for (let i = paperAirplanes.length - 1; i >= 0; i--) {
        const p = paperAirplanes[i];
        if (!p.caught) {
            p.progress += 0.005;
            // Bezier-like arc path
            const t = p.progress;
            const arcHeight = -60 * Math.sin(t * Math.PI); // parabolic arc
            p.x = p.startX + (p.endX - p.startX) * t;
            p.y = p.startY + (p.endY - p.startY) * t + arcHeight;
            p.wobble += 0.08;

            if (t >= 1) {
                p.caught = true;
                p.catchTimer = 90; // frames to show catch reaction
                // Target reacts
                const target = agentMap[p.toId];
                if (target) {
                    target.addIntent('Caught a paper airplane!');
                    target.faceDir = p.startX > target.x ? 1 : -1;
                    target.talkTimer = 40;
                }
            }
        } else {
            p.catchTimer--;
            if (p.catchTimer <= 0) {
                paperAirplanes.splice(i, 1);
            }
        }
    }
}

function drawAirplanes() {
    for (let i = 0; i < paperAirplanes.length; i++) {
        const p = paperAirplanes[i];
        if (p.caught) {
            // Show caught airplane in target's hand briefly
            const target = agentMap[p.toId];
            if (target && p.catchTimer > 60) {
                ctx.save();
                ctx.translate(target.x + target.faceDir * 10, target.y - 28);
                ctx.fillStyle = '#fff';
                ctx.fillRect(-3, -1, 6, 3);
                ctx.fillRect(-1, -3, 2, 6);
                ctx.restore();
            }
            continue;
        }
        ctx.save();
        ctx.translate(p.x, p.y);
        // Rotate airplane based on flight direction + wobble
        const dx = p.endX - p.startX;
        const angle = Math.atan2(p.endY - p.startY, dx) + Math.sin(p.wobble) * 0.15;
        const flip = dx < 0 ? -1 : 1;
        ctx.scale(flip, 1);
        ctx.rotate(angle * flip);
        // Paper airplane pixel art
        ctx.fillStyle = '#fff';
        // Fuselage
        ctx.fillRect(-6, -1, 12, 2);
        // Wings
        ctx.fillStyle = '#f5f5f5';
        ctx.beginPath();
        ctx.moveTo(-4, -1);
        ctx.lineTo(2, -6);
        ctx.lineTo(6, -1);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(-4, 1);
        ctx.lineTo(2, 5);
        ctx.lineTo(6, 1);
        ctx.closePath();
        ctx.fill();
        // Nose
        ctx.fillStyle = '#e0e0e0';
        ctx.fillRect(5, -1, 2, 2);
        // Shadow on ground (faint)
        ctx.restore();
        // Ground shadow
        ctx.fillStyle = 'rgba(0,0,0,0.08)';
        const shadowY = Math.min(p.startY, p.endY) + 60;
        ctx.fillRect(p.x - 4, shadowY, 8, 3);
    }
}

// Check if an agent should throw an airplane (called in update loop)
function maybeThrowAirplane(agent) {
    // Only idle sitting agents, ~0.15% chance per frame (~once every 40-60s per agent)
    if (agent.state !== 'idle' || !agent.isSitting || agent.idleAction) return;
    if (Math.random() > 0.000015) return;
    // Don't stack — max 2 airplanes in flight
    if (paperAirplanes.length >= 2) return;
    // Don't throw if this agent already has one in flight
    if (paperAirplanes.some(p => p.fromId === agent.id || p.toId === agent.id)) return;
    // Pick a random other idle agent at their desk
    const targets = agents.filter(a => a.id !== agent.id && a.isSitting && !a.idleAction && a.state === 'idle');
    if (targets.length === 0) return;
    const target = targets[Math.floor(Math.random() * targets.length)];
    launchAirplane(agent, target);
}

// ============================================================
// ROCK-PAPER-SCISSORS — triggered when 2 idle agents are close
// ============================================================
const rpsGames = [];
const RPS_CHOICES = ['rock', 'paper', 'scissors'];

function startRPS(agent1, agent2) {
    // Don't start if either is already in a game
    if (rpsGames.some(g => [g.p1, g.p2].includes(agent1.id) || [g.p1, g.p2].includes(agent2.id))) return;
    rpsGames.push({
        p1: agent1.id, p2: agent2.id,
        phase: 'shake',    // shake → reveal → react → done
        timer: 0,
        shakeCount: 0,
        c1: RPS_CHOICES[Math.floor(Math.random() * 3)],
        c2: RPS_CHOICES[Math.floor(Math.random() * 3)],
        winner: null,       // set on reveal
    });
    agent1.faceDir = agent2.x > agent1.x ? 1 : -1;
    agent2.faceDir = agent1.x > agent2.x ? 1 : -1;
    agent1.addIntent('Playing rock-paper-scissors!');
    agent2.addIntent('Playing rock-paper-scissors!');
}

function rpsWinner(c1, c2) {
    if (c1 === c2) return 0; // draw
    if ((c1 === 'rock' && c2 === 'scissors') || (c1 === 'scissors' && c2 === 'paper') || (c1 === 'paper' && c2 === 'rock')) return 1;
    return 2;
}

function updateRPS() {
    for (let i = rpsGames.length - 1; i >= 0; i--) {
        const g = rpsGames[i];
        g.timer++;
        if (g.phase === 'shake') {
            // 3 shakes, each 25 frames
            if (g.timer % 25 === 0) g.shakeCount++;
            if (g.shakeCount >= 3) { g.phase = 'reveal'; g.timer = 0; g.winner = rpsWinner(g.c1, g.c2); }
        } else if (g.phase === 'reveal') {
            // Show choices for 90 frames
            if (g.timer >= 90) {
                g.phase = 'react'; g.timer = 0;
                const p1 = agentMap[g.p1], p2 = agentMap[g.p2];
                if (g.winner === 1 && p1) p1.addIntent('Won rock-paper-scissors! 🎉');
                if (g.winner === 2 && p2) p2.addIntent('Won rock-paper-scissors! 🎉');
                if (g.winner === 0) { if (p1) p1.addIntent("Draw! 🤝"); }
            }
        } else if (g.phase === 'react') {
            // Reaction for 60 frames then cleanup
            if (g.timer >= 60) { rpsGames.splice(i, 1); }
        }
    }
}

function drawRPSHand(x, y, choice, shakePhase, faceDir) {
    // x, y = agent position, draw hand extended toward opponent
    const hx = x + faceDir * 16;
    const hy = y - 26;
    const bob = shakePhase !== null ? Math.sin(shakePhase * 0.25) * 4 : 0;

    ctx.save();
    ctx.translate(hx, hy + bob);

    if (choice === null) {
        // Fist during shake (closed hand)
        ctx.fillStyle = '#ffcc80';
        ctx.fillRect(-3, -3, 7, 8);
        ctx.fillStyle = '#f0b860';
        ctx.fillRect(-2, -2, 5, 2); // knuckle line
    } else if (choice === 'rock') {
        // Fist
        ctx.fillStyle = '#ffcc80';
        ctx.fillRect(-3, -3, 7, 8);
        ctx.fillStyle = '#f0b860';
        ctx.fillRect(-2, -2, 5, 2);
    } else if (choice === 'paper') {
        // Open hand (flat)
        ctx.fillStyle = '#ffcc80';
        ctx.fillRect(-4, -5, 9, 10);
        // Fingers
        ctx.fillRect(-4, -7, 2, 3);
        ctx.fillRect(-1, -8, 2, 3);
        ctx.fillRect(2, -7, 2, 3);
        ctx.fillRect(5, -5, 2, 3);
    } else if (choice === 'scissors') {
        // Two fingers out (V shape)
        ctx.fillStyle = '#ffcc80';
        ctx.fillRect(-2, -2, 5, 7);
        // Two extended fingers
        ctx.fillRect(-3, -8, 2, 7);
        ctx.fillRect(2, -8, 2, 7);
        // Curled fingers
        ctx.fillStyle = '#f0b860';
        ctx.fillRect(-1, -1, 3, 2);
    }
    ctx.restore();
}

function drawRPS() {
    for (let i = 0; i < rpsGames.length; i++) {
        const g = rpsGames[i];
        const p1 = agentMap[g.p1], p2 = agentMap[g.p2];
        if (!p1 || !p2) continue;

        if (g.phase === 'shake') {
            // Both show fists bobbing
            drawRPSHand(p1.x, p1.y, null, g.timer, p1.faceDir);
            drawRPSHand(p2.x, p2.y, null, g.timer, p2.faceDir);
            // "..." above them during shake
            ctx.fillStyle = '#fff';
            ctx.font = '8px Arial';
            ctx.textAlign = 'center';
            const dots = '.'.repeat((g.shakeCount % 3) + 1);
            ctx.fillText(dots, p1.x, p1.y - 55);
            ctx.fillText(dots, p2.x, p2.y - 55);
        } else if (g.phase === 'reveal') {
            // Show actual choices
            drawRPSHand(p1.x, p1.y, g.c1, null, p1.faceDir);
            drawRPSHand(p2.x, p2.y, g.c2, null, p2.faceDir);
            // Labels above hands
            ctx.fillStyle = '#ffd700';
            ctx.font = 'bold 7px Arial';
            ctx.textAlign = 'center';
            const emoji = { rock: '✊', paper: '✋', scissors: '✌️' };
            ctx.fillText(emoji[g.c1], p1.x + p1.faceDir * 16, p1.y - 42);
            ctx.fillText(emoji[g.c2], p2.x + p2.faceDir * 16, p2.y - 42);
        } else if (g.phase === 'react') {
            // Winner hops, loser shrugs
            if (g.winner === 1) {
                // p1 hops
                const hopY = -Math.abs(Math.sin(g.timer * 0.15)) * 4;
                ctx.fillStyle = '#ffd700'; ctx.font = '10px Arial'; ctx.textAlign = 'center';
                ctx.fillText('🎉', p1.x, p1.y - 58 + hopY);
            } else if (g.winner === 2) {
                const hopY = -Math.abs(Math.sin(g.timer * 0.15)) * 4;
                ctx.fillStyle = '#ffd700'; ctx.font = '10px Arial'; ctx.textAlign = 'center';
                ctx.fillText('🎉', p2.x, p2.y - 58 + hopY);
            } else {
                // Draw — both shrug
                ctx.fillStyle = '#fff'; ctx.font = '9px Arial'; ctx.textAlign = 'center';
                ctx.fillText('🤝', (p1.x + p2.x) / 2, Math.min(p1.y, p2.y) - 55);
            }
        }
    }
}

// Trigger RPS from social proximity (called per agent in update)
function maybeStartRPS(agent) {
    if (!agent.socialTarget) return;
    if (agent.id > agent.socialTarget) return; // only one agent triggers (alphabetical order prevents double)
    if (Math.random() > 0.003) return; // ~0.3% per frame when near someone
    if (rpsGames.length >= 2) return; // max 2 games at a time
    const other = agentMap[agent.socialTarget];
    if (!other) return;
    // Allow RPS if one is visiting the other's desk
    const visiting = agent.idleAction === 'visit' || other.idleAction === 'visit';
    if (!visiting && other.isSitting) return;
    startRPS(agent, other);
}

// ============================================================
// SOCIAL INTERACTIONS — joke, laugh, talk between nearby agents
// ============================================================
const socialInteractions = [];
const SOCIAL_TYPES = ['joke', 'laugh', 'talk'];

function startSocialInteraction(agent1, agent2) {
    if (socialInteractions.some(s => [s.p1, s.p2].includes(agent1.id) || [s.p1, s.p2].includes(agent2.id))) return;
    if (rpsGames.some(g => [g.p1, g.p2].includes(agent1.id) || [g.p1, g.p2].includes(agent2.id))) return;
    const type = SOCIAL_TYPES[Math.floor(Math.random() * SOCIAL_TYPES.length)];
    socialInteractions.push({
        p1: agent1.id, p2: agent2.id,
        type: type,
        timer: 0,
        duration: type === 'joke' ? 180 : type === 'laugh' ? 120 : 150,
        phase: 0, // used for multi-phase animations
    });
    agent1.faceDir = agent2.x > agent1.x ? 1 : -1;
    agent2.faceDir = agent1.x > agent2.x ? 1 : -1;
}

function updateSocialInteractions() {
    for (let i = socialInteractions.length - 1; i >= 0; i--) {
        const s = socialInteractions[i];
        s.timer++;
        if (s.timer >= s.duration) {
            socialInteractions.splice(i, 1);
        }
    }
}

function drawSocialInteractions() {
    for (let i = 0; i < socialInteractions.length; i++) {
        const s = socialInteractions[i];
        const p1 = agentMap[s.p1], p2 = agentMap[s.p2];
        if (!p1 || !p2) continue;

        const t = s.timer;

        if (s.type === 'joke') {
            // Phase 1: p1 tells joke (0-100), Phase 2: p2 laughs (100-180)
            if (t < 100) {
                // P1 talking — speech lines
                const bob = Math.sin(t * 0.3) * 1;
                ctx.fillStyle = '#fff';
                ctx.font = '7px Arial'; ctx.textAlign = 'center';
                ctx.fillText('🗣️', p1.x, p1.y - 55 + bob);
                // P1 mouth: open-close rapidly (talking)
                p1._socialMouth = Math.floor(t / 6) % 2 === 0 ? 'open' : 'closed';
                p2._socialMouth = 'smile';
            } else {
                // P2 laughing
                const shake = Math.sin(t * 0.5) * 2;
                ctx.fillStyle = '#ffd700';
                ctx.font = '9px Arial'; ctx.textAlign = 'center';
                ctx.fillText('😂', p2.x + shake, p2.y - 55);
                // Small ha ha text
                if (t % 30 < 15) {
                    ctx.fillStyle = '#fff'; ctx.font = '6px Arial';
                    ctx.fillText('ha', p2.x + 12, p2.y - 48 + Math.sin(t * 0.2) * 3);
                }
                p2._socialMouth = 'laugh';
                p1._socialMouth = 'smile';
            }
        } else if (s.type === 'laugh') {
            // Both laugh together
            const shake1 = Math.sin(t * 0.5) * 2;
            const shake2 = Math.cos(t * 0.5) * 2;
            ctx.fillStyle = '#ffd700';
            ctx.font = '9px Arial'; ctx.textAlign = 'center';
            ctx.fillText('😄', p1.x + shake1, p1.y - 55);
            ctx.fillText('😄', p2.x + shake2, p2.y - 55);
            // Both mouths wide open laughing
            p1._socialMouth = 'laugh';
            p2._socialMouth = 'laugh';
            // Shared laughter lines
            const mx = (p1.x + p2.x) / 2;
            const my = Math.min(p1.y, p2.y) - 52;
            if (t % 20 < 10) {
                ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = '5px Arial';
                ctx.fillText('haha', mx, my);
            }
        } else if (s.type === 'talk') {
            // They take turns talking
            const turn = Math.floor(t / 40) % 2; // alternates every ~0.7s
            const talker = turn === 0 ? p1 : p2;
            const listener = turn === 0 ? p2 : p1;
            // Speech bubble dots for talker
            const bob = Math.sin(t * 0.25) * 1;
            ctx.fillStyle = '#fff';
            ctx.font = '7px Arial'; ctx.textAlign = 'center';
            const dots = '.'.repeat((Math.floor(t / 10) % 3) + 1);
            ctx.fillText(dots, talker.x, talker.y - 55 + bob);
            // Talker mouth: animated talking
            talker._socialMouth = Math.floor(t / 5) % 3 === 0 ? 'open' : Math.floor(t / 5) % 3 === 1 ? 'half' : 'closed';
            // Listener: occasional nod (slight y offset) and smile
            listener._socialMouth = 'smile';
            // Nod indicator
            if (Math.floor(t / 15) % 4 === 0) {
                ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.font = '6px Arial';
                ctx.fillText('~', listener.x + listener.faceDir * 14, listener.y - 45);
            }
        }
    }
}

// Clear social mouth overrides after drawing (called per agent in draw)
function getSocialMouth(agent) {
    const m = agent._socialMouth || null;
    agent._socialMouth = null;
    return m;
}

// Trigger social interaction from proximity
function maybeStartSocial(agent) {
    if (!agent.socialTarget) return;
    if (agent.id > agent.socialTarget) return;
    if (Math.random() > 0.004) return; // ~0.4% per frame
    // No cap — multiple conversations can happen simultaneously
    const other = agentMap[agent.socialTarget];
    if (!other) return;
    // Allow if either is visiting OR both are in social spots — sitting at desk is OK for visited agents
    const agentVisiting = agent.idleAction === 'visit';
    const otherVisiting = other.idleAction === 'visit';
    const otherIdleDesk = other.state === 'idle' && !other.idleAction && other.isSitting;
    if (!agentVisiting && !otherVisiting && other.isSitting) return; // original guard for non-visit scenarios
    startSocialInteraction(agent, other);
}

// ============================================================
// GROUP GATHERINGS — idle agents form social circles
// ============================================================
const groupGatherings = [];
// Dynamic gathering spots — picks open floor areas near furniture or between agents
function _pickGatheringSpot() {
    // Option 1: near a random piece of social furniture
    var socialTypes = ['couch', 'coffeeTable', 'waterCooler', 'coffeeMaker', 'bookshelf', 'tv', 'vendingMachine', 'plant', 'tallPlant', 'endTable'];
    var socialItems = officeConfig.furniture.filter(function(f) { return socialTypes.indexOf(f.type) >= 0; });
    // Option 2: midpoint between two random idle agents
    var idleAgents = agents.filter(function(a) { return a.state === 'idle' && !a.idleAction; });

    var spot = null;
    var roll = Math.random();

    if (roll < 0.5 && socialItems.length > 0) {
        // Near furniture — offset so they don't stand on it
        var item = socialItems[Math.floor(Math.random() * socialItems.length)];
        var angle = Math.random() * Math.PI * 2;
        spot = {
            x: Math.round(item.x + Math.cos(angle) * 40),
            y: Math.round(item.y + Math.sin(angle) * 40),
            label: 'by the ' + item.type
        };
    } else if (idleAgents.length >= 2) {
        // Between two agents
        var a1 = idleAgents[Math.floor(Math.random() * idleAgents.length)];
        var a2 = idleAgents.filter(function(a) { return a.id !== a1.id; })[Math.floor(Math.random() * (idleAgents.length - 1))];
        if (a2) {
            spot = {
                x: Math.round((a1.x + a2.x) / 2),
                y: Math.round((a1.y + a2.y) / 2),
                label: 'in the hall'
            };
        }
    }

    if (!spot) {
        // Fallback: random open area
        spot = {
            x: 80 + Math.floor(Math.random() * (W - 160)),
            y: 80 + Math.floor(Math.random() * (H - 160)),
            label: 'in the office'
        };
    }

    // Clamp to world bounds
    spot.x = Math.max(60, Math.min(W - 60, spot.x));
    spot.y = Math.max(80, Math.min(H - 60, spot.y));
    return spot;
}

function startGathering() {
    if (groupGatherings.length >= 1) return; // max 1 gathering at a time
    // Find idle agents sitting at desks
    const idleAgents = agents.filter(a => a.state === 'idle' && !a.idleAction && a.isSitting && !a.meetingId);
    if (idleAgents.length < 2) return;
    // Pick 2-4 agents to gather
    const count = Math.min(2 + Math.floor(Math.random() * 3), idleAgents.length);
    const shuffled = idleAgents.sort(() => Math.random() - 0.5);
    const members = shuffled.slice(0, count).map(a => a.id);
    // Pick a dynamic spot
    const spot = _pickGatheringSpot();
    const gathering = {
        id: Math.random().toString(36).substr(2, 8),
        spot: spot,
        members: members,
        phase: 'walking', // walking → socializing → dispersing
        timer: 0,
        socializeDuration: 1800 + Math.floor(Math.random() * 3600), // 30-90 seconds
        activeInteractions: [], // joke/laugh/talk happening within the group
        interactionCooldown: 0,
    };
    groupGatherings.push(gathering);
    // Assign positions in a circle around the spot
    members.forEach((id, i) => {
        const agent = agentMap[id];
        if (!agent) return;
        const angle = (i / members.length) * Math.PI * 2 - Math.PI / 2;
        const radius = 21 + members.length * 5;
        agent.targetX = spot.x + Math.cos(angle) * radius;
        agent.targetY = spot.y + Math.sin(angle) * radius;
        agent.idleAction = 'gathering';
        agent.idleReturnTimer = 0; // managed by gathering system
        agent._gatheringId = gathering.id;
        agent.addIntent('Heading to ' + spot.label + ' to hang out');
    });
}

function updateGatherings() {
    for (let i = groupGatherings.length - 1; i >= 0; i--) {
        const g = groupGatherings[i];
        g.timer++;

        if (g.phase === 'walking') {
            // Check if all members arrived
            let allArrived = true;
            g.members.forEach(id => {
                const a = agentMap[id];
                if (!a) return;
                const dx = a.x - a.targetX, dy = a.y - a.targetY;
                if (Math.sqrt(dx * dx + dy * dy) > a.speed + 1) allArrived = false;
            });
            if (allArrived || g.timer > 300) { // switch after arrival or 5s timeout
                g.phase = 'socializing';
                g.timer = 0;
                // Face each other toward center
                g.members.forEach(id => {
                    const a = agentMap[id];
                    if (a) a.faceDir = g.spot.x > a.x ? 1 : -1;
                });
            }
            // Allow new idle agents to join while walking
            _maybeJoinGathering(g);
        } else if (g.phase === 'socializing') {
            // Trigger random interactions within the group
            g.interactionCooldown--;
            if (g.interactionCooldown <= 0 && g.members.length >= 2) {
                // Pick two random members for an interaction
                const shuffled = g.members.sort(() => Math.random() - 0.5);
                const a1 = agentMap[shuffled[0]], a2 = agentMap[shuffled[1]];
                if (a1 && a2) {
                    // Check they aren't already in a social interaction
                    const busy = socialInteractions.some(s =>
                        [s.p1, s.p2].includes(a1.id) || [s.p1, s.p2].includes(a2.id));
                    if (!busy) {
                        startSocialInteraction(a1, a2);
                    }
                }
                g.interactionCooldown = 90 + Math.floor(Math.random() * 120); // 1.5-3.5s between interactions
            }
            // Allow new idle agents to join during socializing
            _maybeJoinGathering(g);
            // End socializing after duration
            if (g.timer >= g.socializeDuration) {
                g.phase = 'dispersing';
                g.timer = 0;
                g.members.forEach(id => {
                    const a = agentMap[id];
                    if (a) {
                        a.idleAction = null;
                        a._gatheringId = null;
                        a.addIntent('Heading back to desk');
                        a.returnToDesk();
                    }
                });
            }
        } else if (g.phase === 'dispersing') {
            if (g.timer > 60) {
                groupGatherings.splice(i, 1);
            }
        }
    }
}

function _maybeJoinGathering(g) {
    if (g.members.length >= g.spot.capacity) return;
    if (Math.random() > 0.003) return; // ~0.3% per frame
    const joinable = agents.filter(a =>
        a.state === 'idle' && !a.idleAction && a.isSitting && !a.meetingId &&
        !g.members.includes(a.id)
    );
    if (joinable.length === 0) return;
    const joiner = joinable[Math.floor(Math.random() * joinable.length)];
    g.members.push(joiner.id);
    // Assign position in the circle
    const angle = ((g.members.length - 1) / g.members.length) * Math.PI * 2 - Math.PI / 2;
    const radius = 21 + g.members.length * 5;
    joiner.targetX = g.spot.x + Math.cos(angle) * radius;
    joiner.targetY = g.spot.y + Math.sin(angle) * radius;
    joiner.idleAction = 'gathering';
    joiner.idleReturnTimer = 0;
    joiner._gatheringId = g.id;
    joiner.addIntent('Joining the group at ' + g.spot.label);
    // Reposition everyone in a proper circle
    g.members.forEach((id, idx) => {
        const a = agentMap[id];
        if (!a) return;
        const ang = (idx / g.members.length) * Math.PI * 2 - Math.PI / 2;
        const r = 21 + g.members.length * 5;
        a.targetX = g.spot.x + Math.cos(ang) * r;
        a.targetY = g.spot.y + Math.sin(ang) * r;
    });
}

function drawGatherings() {
    for (let i = 0; i < groupGatherings.length; i++) {
        const g = groupGatherings[i];
        if (g.phase !== 'socializing') continue;
        // Draw a subtle circle on the floor to show the gathering area
        ctx.save();
        ctx.globalAlpha = 0.08;
        ctx.fillStyle = '#ffd700';
        ctx.beginPath();
        const r = 30 + g.members.length * 5;
        ctx.arc(g.spot.x, g.spot.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        // Floating social indicator
        const bob = Math.sin(g.timer * 0.05) * 2;
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.font = '10px Arial'; ctx.textAlign = 'center';
        const emojis = ['💬', '😄', '🗣️'];
        const em = emojis[Math.floor(g.timer / 60) % emojis.length];
        ctx.fillText(em, g.spot.x, g.spot.y - 40 + bob);
    }
}

// Remove agent from any active gathering (when they get work or need to leave)
function leaveGathering(agentId) {
    for (let i = 0; i < groupGatherings.length; i++) {
        const g = groupGatherings[i];
        const idx = g.members.indexOf(agentId);
        if (idx !== -1) {
            g.members.splice(idx, 1);
            const a = agentMap[agentId];
            if (a) { a.idleAction = null; a._gatheringId = null; }
            // If only 1 or 0 left, end the gathering
            if (g.members.length <= 1) {
                g.members.forEach(id => {
                    const m = agentMap[id];
                    if (m) { m.idleAction = null; m._gatheringId = null; m.returnToDesk(); }
                });
                groupGatherings.splice(i, 1);
            }
            break;
        }
    }
}

// Check if a gathering should start (called once per frame in loop)
function maybeStartGathering() {
    if (groupGatherings.length >= 1) return;
    if (Math.random() > 0.000012) return; // ~0.0012% per frame, roughly every 15-20 minutes
    startGathering();
}

// ============================================================
// DART BOARD GAME — agents throw darts at the board
// ============================================================
const dartGames = [];
var dartStuckDarts = []; // darts currently stuck on the board
const DART_COLORS = ['#f44336','#2196f3','#4caf50','#ff9800','#9c27b0','#00bcd4'];

function startDartGame(agent1, agent2) {
    if (dartGames.length >= 1) return;
    if (dartGames.some(g => [g.p1, g.p2].includes(agent1.id) || [g.p1, g.p2].includes(agent2.id))) return;
    const inter = LOCATIONS.interactions;
    const spot = inter.dartBoard;
    if (!spot) return;
    dartStuckDarts = []; // clear board
    const game = {
        p1: agent1.id, p2: agent2.id,
        phase: 'walking', // walking → p1_throw → p1_land → p2_throw → p2_land → result
        timer: 0,
        p1Score: 0, p2Score: 0,
        throwNum: 0, // each player throws 3
        maxThrows: 3,
        currentThrower: 1,
        dartX: 0, dartY: 0, // dart animation position
        dartTarget: { ox: 0, oy: 0 }, // where dart lands on board
        resultTimer: 0,
    };
    dartGames.push(game);
    // Position agents 3-4 tiles in front of the dart board
    agent1.targetX = spot.x - 16;
    agent1.targetY = spot.y;
    agent1.idleAction = 'darts';
    agent1.idleReturnTimer = 0;
    agent2.targetX = spot.x + 16;
    agent2.targetY = spot.y;
    agent2.idleAction = 'darts';
    agent2.idleReturnTimer = 0;
    agent1.addIntent('Playing darts with ' + agent2.name);
    agent2.addIntent('Playing darts with ' + agent1.name);
}

function _dartScore(ox, oy) {
    const dist = Math.sqrt(ox * ox + oy * oy);
    if (dist <= 2) return { pts: 50, label: 'BULLSEYE!' };
    if (dist <= 4) return { pts: 25, label: 'Bull' };
    if (dist <= 8) return { pts: 15, label: 'Triple' };
    if (dist <= 12) return { pts: 10, label: 'Single' };
    return { pts: 5, label: 'Outer' };
}

function updateDartGames() {
    var inter = LOCATIONS.interactions;
    for (var i = dartGames.length - 1; i >= 0; i--) {
        var g = dartGames[i];
        var p1 = agentMap[g.p1], p2 = agentMap[g.p2];
        if (!p1 || !p2) { dartGames.splice(i, 1); continue; }
        g.timer++;

        // Lock agents at dart positions during active game
        if (g.phase !== 'walking' && inter.dartBoard) {
            p1.x = inter.dartBoard.x - 16; p1.y = inter.dartBoard.y;
            p2.x = inter.dartBoard.x + 16; p2.y = inter.dartBoard.y;
            p1.targetX = p1.x; p1.targetY = p1.y;
            p2.targetX = p2.x; p2.targetY = p2.y;
        }

        if (g.phase === 'walking') {
            var d1 = Math.abs(p1.x - p1.targetX) + Math.abs(p1.y - p1.targetY);
            var d2 = Math.abs(p2.x - p2.targetX) + Math.abs(p2.y - p2.targetY);
            if ((d1 < 4 && d2 < 4) || g.timer > 300) {
                g.phase = 'p_aim';
                g.timer = 0;
                g.currentThrower = 1;
                p1.faceDir = -1; p2.faceDir = -1; // face the board (left wall area)
            }
        } else if (g.phase === 'p_aim') {
            // Aiming phase — arm wobbles for 1.5 seconds
            if (g.timer >= 90) {
                g.phase = 'p_throw';
                g.timer = 0;
                // Calculate where dart lands (random with skill)
                var spread = 6;
                g.dartTarget = {
                    ox: Math.round((Math.random() - 0.5) * spread * 2),
                    oy: Math.round((Math.random() - 0.5) * spread * 2)
                };
            }
        } else if (g.phase === 'p_throw') {
            // Dart flying animation — 20 frames
            if (g.timer >= 20) {
                g.phase = 'p_land';
                g.timer = 0;
                var score = _dartScore(g.dartTarget.ox, g.dartTarget.oy);
                var thrower = g.currentThrower === 1 ? p1 : p2;
                var flightC = g.currentThrower === 1 ? '#f44336' : '#2196f3';
                dartStuckDarts.push({
                    ox: g.dartTarget.ox, oy: g.dartTarget.oy,
                    color: thrower.color, flightColor: flightC
                });
                if (g.currentThrower === 1) g.p1Score += score.pts;
                else g.p2Score += score.pts;
            }
        } else if (g.phase === 'p_land') {
            // Show score briefly — 60 frames
            if (g.timer >= 60) {
                g.throwNum++;
                if (g.currentThrower === 1) {
                    // Switch to player 2
                    g.currentThrower = 2;
                    g.phase = 'p_aim';
                    g.timer = 0;
                } else {
                    // Both threw, check if more rounds
                    g.currentThrower = 1;
                    if (g.throwNum >= g.maxThrows * 2) {
                        g.phase = 'result';
                        g.timer = 0;
                    } else {
                        g.phase = 'p_aim';
                        g.timer = 0;
                    }
                }
            }
        } else if (g.phase === 'result') {
            if (g.timer >= 150) {
                // Game over — return to desks
                p1.idleAction = null; p2.idleAction = null;
                p1.returnToDesk(); p2.returnToDesk();
                dartStuckDarts = [];
                dartGames.splice(i, 1);
            }
        }
    }
}

function drawDartGames() {
    for (var i = 0; i < dartGames.length; i++) {
        var g = dartGames[i];
        var p1 = agentMap[g.p1], p2 = agentMap[g.p2];
        if (!p1 || !p2) continue;
        var thrower = g.currentThrower === 1 ? p1 : p2;
        // Find actual dart board position from furniture
        var _dbItem = null;
        if (officeConfig && officeConfig.furniture) {
            for (var _dbi = 0; _dbi < officeConfig.furniture.length; _dbi++) {
                if (officeConfig.furniture[_dbi].type === 'dartBoard') { _dbItem = officeConfig.furniture[_dbi]; break; }
            }
        }
        var boardX = _dbItem ? _dbItem.x : (LOCATIONS.lounge.x + 210);
        var boardY = _dbItem ? (_dbItem.y + 10) : (LOCATIONS.lounge.y - 8);

        if (g.phase === 'p_aim') {
            // Aiming wobble indicator
            var wobble = Math.sin(g.timer * 0.15) * 3;
            ctx.fillStyle = 'rgba(255,255,0,0.4)';
            ctx.beginPath();
            ctx.arc(boardX + wobble, boardY + Math.cos(g.timer * 0.12) * 2, 3, 0, Math.PI * 2);
            ctx.fill();
            // Thrower arm extended
            thrower._socialMouth = 'closed';
        } else if (g.phase === 'p_throw') {
            // Dart flying from thrower to board
            var progress = g.timer / 20;
            var startX = thrower.x, startY = thrower.y - 30;
            var dx = boardX + g.dartTarget.ox - startX;
            var dy = boardY + g.dartTarget.oy - startY;
            var dartX = startX + dx * progress;
            var dartY = startY + dy * progress - Math.sin(progress * Math.PI) * 15; // arc
            // Draw flying dart
            ctx.fillStyle = thrower.color;
            ctx.fillRect(dartX - 1, dartY - 1, 3, 3);
            ctx.fillStyle = g.currentThrower === 1 ? '#f44336' : '#2196f3';
            ctx.fillRect(dartX - 1, dartY + 2, 3, 2); // flight
        } else if (g.phase === 'p_land') {
            // Score popup
            var score = _dartScore(g.dartTarget.ox, g.dartTarget.oy);
            var bob = -g.timer * 0.3;
            var alpha = Math.max(0, 1 - g.timer / 60);
            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.fillStyle = score.pts >= 25 ? '#ffd700' : '#fff';
            ctx.font = score.pts >= 25 ? 'bold 10px Arial' : '9px Arial';
            ctx.textAlign = 'center';
            ctx.fillText(score.pts + (score.pts >= 25 ? ' ' + score.label : ''), boardX, boardY - 22 + bob);
            ctx.restore();
        } else if (g.phase === 'result') {
            // Final scores
            var bob = Math.sin(g.timer * 0.08) * 2;
            ctx.fillStyle = 'rgba(0,0,0,0.7)';
            ctx.fillRect(boardX - 45, boardY - 40 + bob, 90, 36);
            ctx.strokeStyle = '#ffd700'; ctx.lineWidth = 1;
            ctx.strokeRect(boardX - 45, boardY - 40 + bob, 90, 36);
            ctx.font = 'bold 8px Arial'; ctx.textAlign = 'center';
            // Winner highlight
            var p1Win = g.p1Score > g.p2Score;
            var tie = g.p1Score === g.p2Score;
            ctx.fillStyle = p1Win ? '#ffd700' : '#ccc';
            ctx.fillText(p1.name + ': ' + g.p1Score, boardX, boardY - 28 + bob);
            ctx.fillStyle = !p1Win && !tie ? '#ffd700' : '#ccc';
            ctx.fillText(p2.name + ': ' + g.p2Score, boardX, boardY - 18 + bob);
            ctx.fillStyle = '#ffd700'; ctx.font = 'bold 9px Arial';
            ctx.fillText(tie ? 'TIE!' : '🏆 ' + (p1Win ? p1.name : p2.name) + ' wins!', boardX, boardY - 8 + bob);
            // Winner celebrates
            if (!tie) {
                var winner = p1Win ? p1 : p2;
                winner._socialMouth = 'laugh';
            }
        }

        // Scoreboard during game (small)
        if (g.phase !== 'result' && g.phase !== 'walking') {
            ctx.fillStyle = 'rgba(0,0,0,0.5)';
            ctx.fillRect(boardX - 35, boardY + 18, 70, 14);
            ctx.font = '7px Arial'; ctx.textAlign = 'center';
            ctx.fillStyle = '#f44336';
            ctx.fillText(p1.name + ':' + g.p1Score, boardX - 12, boardY + 28);
            ctx.fillStyle = '#2196f3';
            ctx.fillText(p2.name + ':' + g.p2Score, boardX + 18, boardY + 28);
        }
    }
}

// Trigger dart game from social proximity
function maybeStartDarts(agent) {
    if (!agent.socialTarget) return;
    if (agent.id > agent.socialTarget) return;
    if (Math.random() > 0.001) return; // ~0.1% per frame
    if (dartGames.length >= 1) return;
    // Only trigger near lounge area
    var lx = LOCATIONS.lounge.x, ly = LOCATIONS.lounge.y;
    if (Math.abs(agent.x - lx - 100) > 120 || Math.abs(agent.y - ly - 40) > 80) return;
    var other = agentMap[agent.socialTarget];
    if (!other || other.isSitting) return;
    startDartGame(agent, other);
}

// --- MAIN LOOP ---
// ============================================================
// OFFICE PET SYSTEM
// ============================================================
var officePets = [];

function initPets() {
    officePets = [];
    var petCfg = officeConfig.pet;
    if (!petCfg || !petCfg.enabled) return;
    officePets.push(new OfficePet(petCfg));
}

class OfficePet {
    constructor(cfg) {
        this.species = cfg.species || 'cat'; // 'cat', 'lobster', or 'pug'
        this.name = cfg.name || 'Clawy';
        this.x = cfg.x || Math.floor(W / 2);
        this.y = cfg.y || Math.floor(H / 2);
        this.targetX = this.x;
        this.targetY = this.y;
        this.faceDir = 1;
        this.moveDir = 'side'; // 'up', 'down', 'side' — vertical movement direction for cat/pug sprites
        this.tick = 0;
        this.state = 'sitting'; // starts sitting calmly
        this.stateTimer = 200 + Math.floor(Math.random() * 300);
        this.sleepZ = 0;
        this.tailWag = 0;
        this.curiosityTarget = null;
        this.greetTarget = null;
        this.interactingAgent = null;
        this.animFrame = 0;
        this.speed = 1.2;
        this._blinkTimer = 80 + Math.floor(Math.random() * 120);
        this._blinking = false;
        this._blinkFrames = 0;
        this._path = null;
        this._prevTargetX = this.targetX;
        this._prevTargetY = this.targetY;
        this._stuckTicks = 0;
        this._detourAngle = 0;
    }

    update() {
        this.tick++;
        this.tailWag = Math.sin(this.tick * 0.15) * 3;
        this.animFrame = Math.floor(this.tick / 10) % 4;
        this.isMoving = false;
        // Blink timer
        if (this._blinking) {
            this._blinkFrames--;
            if (this._blinkFrames <= 0) { this._blinking = false; this._blinkTimer = 80 + Math.floor(Math.random() * 200); }
        } else {
            this._blinkTimer--;
            if (this._blinkTimer <= 0) { this._blinking = true; this._blinkFrames = 4 + Math.floor(Math.random() * 3); }
        }

        // === FROZEN STATES: don't move at all ===
        if (this.state === 'sleeping' || this.state === 'sitting' || this.state === 'being_pet' ||
            this.state === 'grooming' || this.state === 'looking_around') {
            this.stateTimer--;
            if (this.state === 'sleeping') this.sleepZ = (this.sleepZ + 0.015) % 1;
            if (this.state === 'being_pet' && this.stateTimer <= 0) {
                this.interactingAgent = null;
                this._transitionTo('sitting', 80 + Math.floor(Math.random() * 120)); // sit after pets
            }
            if (this.state === 'looking_around') {
                // Flip face direction occasionally
                if (this.tick % 40 === 0) this.faceDir *= -1;
            }
            if (this.stateTimer <= 0) this._pickBehavior();
            return;
        }

        // === MOVEMENT STATES ===
        var speed = this.state === 'chased' ? 2.8 : this.speed;

        // Path following (same as agents)
        if (this.targetX !== this._prevTargetX || this.targetY !== this._prevTargetY) {
            this._prevTargetX = this.targetX;
            this._prevTargetY = this.targetY;
            if (collisionGrid && officeConfig.walls.interior && officeConfig.walls.interior.length > 0) {
                var _fp = findPath(this.x, this.y, this.targetX, this.targetY);
                this._path = (_fp && _fp.length > 0) ? _fp : null;
            } else {
                this._path = null;
            }
        }
        if (this._path && this._path.length > 0) {
            var _wp = this._path[0];
            if (Math.abs(_wp.x - this.x) < speed * 2 && Math.abs(_wp.y - this.y) < speed * 2) {
                this._path.shift();
            }
        }
        var _etX = this.targetX, _etY = this.targetY;
        if (this._path && this._path.length > 0) {
            _etX = this._path[0].x;
            _etY = this._path[0].y;
        }

        var dx = _etX - this.x;
        var dy = _etY - this.y;
        var dist = Math.sqrt(dx * dx + dy * dy);

        if (dist > speed) {
            this.isMoving = true;
            var moveX = (dx / dist) * speed;
            var moveY = (dy / dist) * speed;

            // Collision avoidance against agents
            if (COLLISION_ENABLED) {
                for (var i = 0; i < agents.length; i++) {
                    var other = agents[i];
                    var ox = this.x - other.x, oy = this.y - other.y;
                    var oDist = Math.sqrt(ox * ox + oy * oy);
                    if (oDist < COLLISION_RADIUS * 1.5 && oDist > 0.1) {
                        var force = COLLISION_PUSH * (1 - oDist / (COLLISION_RADIUS * 1.5));
                        moveX += (ox / oDist) * force;
                        moveY += (oy / oDist) * force;
                    }
                }
            }

            var prevX = this.x, prevY = this.y;
            this.x += moveX;
            this.y += moveY;
            this.x = Math.max(10, Math.min(W - 10, this.x));
            this.y = Math.max(10, Math.min(H - 10, this.y));
            var actualMove = Math.sqrt((this.x - prevX) * (this.x - prevX) + (this.y - prevY) * (this.y - prevY));
            if (actualMove < speed * 0.3 && dist > 10) {
                this._stuckTicks++;
                if (this._stuckTicks > 30) {
                    if (this._stuckTicks === 31) this._detourAngle = (Math.random() > 0.5 ? 1 : -1) * (Math.PI / 2);
                    this.x += Math.cos(Math.atan2(dy, dx) + this._detourAngle) * speed * 1.5;
                    this.y += Math.sin(Math.atan2(dy, dx) + this._detourAngle) * speed * 1.5;
                }
                if (this._stuckTicks > 120) {
                    this._stuckTicks = 0;
                    this._wander();
                }
            } else {
                this._stuckTicks = 0;
                this._detourAngle = 0;
            }

            if (Math.abs(dx) > 0.5) this.faceDir = dx > 0 ? 1 : -1;
            // Track vertical movement direction for front/back sprites
            if (Math.abs(dy) > Math.abs(dx) * 0.8) {
                this.moveDir = dy < 0 ? 'up' : 'down';
            } else {
                this.moveDir = 'side';
            }
        } else {
            // Arrived at destination
            this.moveDir = 'side';
            if (this._path && this._path.length > 0) {
                this.x = _etX; this.y = _etY;
                this._path.shift();
                if (this._path.length === 0) this._path = null;
            } else {
                this.x = this.targetX;
                this.y = this.targetY;
                this.isMoving = false;
                // Arrived — enter the destination state
                if (this.state === 'walking_to_sleep') {
                    this._transitionTo('sleeping', 600 + Math.floor(Math.random() * 900));
                } else if (this.state === 'walking_to_curious') {
                    this._transitionTo('looking_around', 100 + Math.floor(Math.random() * 120));
                } else if (this.state === 'walking_to_greet') {
                    this._transitionTo('sitting', 80 + Math.floor(Math.random() * 80));
                    if (this.greetTarget) this.faceDir = this.greetTarget.x > this.x ? 1 : -1;
                } else if (this.state === 'chased') {
                    // Ran to safety — freeze and look back
                    this._transitionTo('looking_around', 60 + Math.floor(Math.random() * 40));
                } else {
                    // Generic arrival → sit or idle briefly
                    this._transitionTo('sitting', 60 + Math.floor(Math.random() * 180));
                }
            }
        }

        this.stateTimer--;
        if (this.stateTimer <= 0 && this.state !== 'sleeping') this._pickBehavior();
    }

    _transitionTo(state, duration) {
        this.state = state;
        this.stateTimer = duration;
        this.isMoving = false;
        this._path = null;
    }

    _pickBehavior() {
        var roll = Math.random();
        var inter = LOCATIONS.interactions;

        if (roll < 0.25) {
            // === SLEEP (most common — animals sleep a LOT) ===
            // Walk to a couch or corner first, THEN sleep
            var sleepTarget = null;
            if (inter.couchSeats && inter.couchSeats.length > 0 && Math.random() < 0.6) {
                sleepTarget = inter.couchSeats[Math.floor(Math.random() * inter.couchSeats.length)];
            } else {
                var corners = [
                    { x: 30, y: 60 }, { x: W - 30, y: 60 },
                    { x: 30, y: H - 30 }, { x: W - 30, y: H - 30 }
                ];
                sleepTarget = corners[Math.floor(Math.random() * corners.length)];
            }
            this.state = 'walking_to_sleep';
            this.stateTimer = 999; // overridden on arrival
            this.targetX = sleepTarget.x;
            this.targetY = sleepTarget.y;
        } else if (roll < 0.40) {
            // === SIT / IDLE right here ===
            this._transitionTo('sitting', 200 + Math.floor(Math.random() * 300));
        } else if (roll < 0.50) {
            // === GROOMING (lick paws, clean self) ===
            this._transitionTo('grooming', 120 + Math.floor(Math.random() * 150));
        } else if (roll < 0.58) {
            // === LOOK AROUND (head turning, curious about surroundings) ===
            this._transitionTo('looking_around', 80 + Math.floor(Math.random() * 100));
        } else if (roll < 0.70) {
            // === GREET an idle agent ===
            var idleAgents = agents.filter(function(a) {
                return a.state === 'idle' || a.idleAction === 'couch' || a.idleAction === 'watch_tv';
            });
            if (idleAgents.length > 0) {
                var target = idleAgents[Math.floor(Math.random() * idleAgents.length)];
                this.greetTarget = target;
                this.state = 'walking_to_greet';
                this.stateTimer = 999;
                this.targetX = target.x + (Math.random() < 0.5 ? -18 : 18);
                this.targetY = target.y + 8;
            } else {
                this._transitionTo('sitting', 150 + Math.floor(Math.random() * 100));
            }
        } else if (roll < 0.82) {
            // === CURIOUS about furniture ===
            var curioItems = officeConfig.furniture.filter(function(f) {
                return ['bookshelf','tv','pingPongTable','dartBoard','vendingMachine','coffeeMaker',
                        'microwave','toaster','plant','tallPlant','endTable','trashCan'].indexOf(f.type) >= 0;
            });
            if (curioItems.length > 0) {
                var item = curioItems[Math.floor(Math.random() * curioItems.length)];
                this.curiosityTarget = item;
                this.state = 'walking_to_curious';
                this.stateTimer = 999;
                this.targetX = item.x + 10 + Math.floor(Math.random() * 20);
                this.targetY = item.y + 20 + Math.floor(Math.random() * 10);
            } else {
                this._transitionTo('looking_around', 80);
            }
        } else {
            // === SHORT WANDER ===
            this._wander();
        }
    }

    _wander() {
        this.state = 'walking';
        this.stateTimer = 120 + Math.floor(Math.random() * 200);
        // Short distance wander — not across the whole map
        var wanderDist = 60 + Math.floor(Math.random() * 100);
        var angle = Math.random() * Math.PI * 2;
        this.targetX = Math.max(30, Math.min(W - 30, Math.round(this.x + Math.cos(angle) * wanderDist)));
        this.targetY = Math.max(60, Math.min(H - 30, Math.round(this.y + Math.sin(angle) * wanderDist)));
    }

    // Called by agents when they decide to pet
    startBeingPet(agent) {
        this.state = 'being_pet';
        this.interactingAgent = agent;
        this.stateTimer = 80 + Math.floor(Math.random() * 60);
        this.faceDir = agent.x > this.x ? 1 : -1;
    }

    // Called by agents when they decide to chase
    startChase(agent) {
        this.state = 'chased';
        this.interactingAgent = agent;
        this.stateTimer = 100 + Math.floor(Math.random() * 80);
        // Run away from agent
        var awayX = this.x + (this.x - agent.x) * 2;
        var awayY = this.y + (this.y - agent.y) * 2;
        this.targetX = Math.max(30, Math.min(W - 30, awayX));
        this.targetY = Math.max(60, Math.min(H - 30, awayY));
    }

    draw() {
        var px = Math.round(this.x);
        var py = Math.round(this.y);
        ctx.save();
        ctx.translate(px, py);
        ctx.scale(this.faceDir, 1);
        // Pixel-snapped drawing — no anti-aliasing for pixel-art style
        ctx.imageSmoothingEnabled = false;

        if (this.species === 'cat') this._drawCat();
        else if (this.species === 'pug') this._drawPug();
        else this._drawLobster();

        ctx.restore();

        // Sleep Z's
        if (this.state === 'sleeping') {
            var zOff = this.sleepZ * 20;
            var zAlpha = 1 - this.sleepZ;
            ctx.globalAlpha = zAlpha * 0.7;
            ctx.fillStyle = '#fff';
            ctx.font = (8 + this.sleepZ * 6) + 'px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('z', this.x + 8, this.y - 10 - zOff);
            ctx.fillText('Z', this.x + 14, this.y - 18 - zOff * 0.7);
            ctx.globalAlpha = 1;
        }

        // Heart when being pet
        if (this.state === 'being_pet') {
            var hBounce = Math.sin(this.tick * 0.2) * 3;
            ctx.fillStyle = '#e91e63';
            ctx.font = '10px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('♥', this.x, this.y - 16 + hBounce);
        }

        // Curiosity ? when looking around
        if (this.state === 'looking_around' && this.curiosityTarget) {
            ctx.fillStyle = '#ffd600';
            ctx.font = 'bold 9px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('?', this.x + 2, this.y - 12);
        }

        // Grooming sparkles
        if (this.state === 'grooming' && this.tick % 20 < 10) {
            ctx.fillStyle = '#fff';
            ctx.font = '6px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('✨', this.x + 6, this.y - 14);
        }

        // Name tag (above pet head)
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.font = '7px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(this.name, this.x, this.y - 24);
    }

    _drawCat() {
        // Soft pixel art — NO black outlines, rounded edges, matches office style
        // Dark charcoal cat with white chest spot
        var BD = '#2a2030';  // body darkest
        var BM = '#3d3347';  // body main
        var BL = '#4a4256';  // body light
        var BH = '#5a5066';  // highlights
        var FUR = '#332838'; // fur texture shade
        var WC = '#8a8494';  // white chest spot
        var WC2 = '#a09aaa'; // chest highlight
        var EY = '#f0c040';  // eye yellow
        var PU = '#1a1020';  // pupil
        var PK = '#6a4870';  // inner ear pink
        var walk = this.isMoving ? Math.floor(Math.sin(this.tick * 0.3) * 2) : 0;
        var tailSway = Math.sin(this.tick * 0.12) * 2;
        var earTwitch = (this.tick % 120 < 6) ? 1 : 0;
        var breathe = Math.sin(this.tick * 0.06) * 0.5;
        var isSleeping = this.state === 'sleeping';
        var isSitting = this.state === 'sitting' || this.state === 'being_pet' || this.state === 'looking_around';
        var isGrooming = this.state === 'grooming';

        // Shadow (soft, no outline)
        ctx.fillStyle = 'rgba(30,20,40,0.12)';
        ctx.fillRect(-9, 9, 18, 3);
        ctx.fillRect(-7, 10, 14, 2);

        if (isSleeping) {
            // === SLEEPING — lying on side, head resting on paws ===
            // Body (lying flat, slightly curled)
            ctx.fillStyle = BD;
            ctx.fillRect(-4, 0, 14, 8);
            ctx.fillRect(-3, -1, 12, 10);
            ctx.fillStyle = BM;
            ctx.fillRect(-2, 1, 10, 6);
            ctx.fillStyle = BL;
            ctx.fillRect(-1, 2, 8, 3);
            // White chest
            ctx.fillStyle = WC;
            ctx.fillRect(0, 4, 4, 2);
            // Fur texture
            ctx.fillStyle = FUR;
            ctx.fillRect(2, 2, 2, 1);
            ctx.fillRect(6, 3, 1, 1);
            // Breathing
            ctx.fillStyle = BM;
            ctx.fillRect(-3, 6 + Math.round(breathe), 12, 1);

            // Head (distinct, resting to the left, bigger than body blob)
            ctx.fillStyle = BD;
            ctx.fillRect(-12, -4, 10, 9);
            ctx.fillRect(-11, -5, 8, 11);
            ctx.fillStyle = BM;
            ctx.fillRect(-10, -3, 7, 7);
            ctx.fillRect(-11, -2, 8, 5);
            ctx.fillStyle = BL;
            ctx.fillRect(-9, -3, 5, 3);

            // Ears (clearly visible on top of head)
            ctx.fillStyle = BD;
            ctx.fillRect(-12, -8, 3, 4);
            ctx.fillRect(-7, -8, 3, 4);
            ctx.fillStyle = PK;
            ctx.fillRect(-11, -7, 2, 2);
            ctx.fillRect(-6, -7, 2, 2);

            // Closed eyes (happy curved lines — clearly visible)
            ctx.fillStyle = EY;
            ctx.fillRect(-10, -1, 2, 1);
            ctx.fillRect(-9, -2, 1, 1);
            ctx.fillRect(-6, -1, 2, 1);
            ctx.fillRect(-5, -2, 1, 1);

            // Nose
            ctx.fillStyle = PK;
            ctx.fillRect(-7, 1, 1, 1);

            // Front paws (stretched out under chin)
            ctx.fillStyle = BD;
            ctx.fillRect(-11, 4, 3, 2);
            ctx.fillRect(-7, 4, 3, 2);
            ctx.fillStyle = BH;
            ctx.fillRect(-10, 4, 1, 1);
            ctx.fillRect(-6, 4, 1, 1);

            // Tail curled behind body
            ctx.fillStyle = BM;
            ctx.fillRect(9, 1, 2, 2);
            ctx.fillRect(10, -1, 2, 2);
            ctx.fillRect(9, -3, 2, 2);
            ctx.fillRect(8, -4, 2, 2);
            return;
        }

        if (isSitting) {
            // === SITTING FRONT-FACING ===
            // Body (rounded)
            ctx.fillStyle = BD;
            ctx.fillRect(-6, 0, 12, 10);
            ctx.fillRect(-7, 1, 14, 8);
            ctx.fillStyle = BM;
            ctx.fillRect(-5, 1, 10, 8);
            ctx.fillRect(-6, 2, 12, 6);
            ctx.fillStyle = BL;
            ctx.fillRect(-4, 2, 8, 5);
            // White chest spot
            ctx.fillStyle = WC;
            ctx.fillRect(-2, 3, 4, 3);
            ctx.fillStyle = WC2;
            ctx.fillRect(-1, 4, 2, 1);
            // Fur texture
            ctx.fillStyle = FUR;
            ctx.fillRect(-4, 5, 1, 2);
            ctx.fillRect(4, 4, 1, 2);
            // Breathing
            ctx.fillStyle = BM;
            ctx.fillRect(-6 + Math.round(breathe * 0.5), 7, 1, 2);
            ctx.fillRect(5 - Math.round(breathe * 0.5), 7, 1, 2);

            // Head (big, rounded)
            ctx.fillStyle = BD;
            ctx.fillRect(-6, -11, 12, 11);
            ctx.fillRect(-7, -10, 14, 9);
            ctx.fillStyle = BM;
            ctx.fillRect(-5, -10, 10, 9);
            ctx.fillRect(-6, -9, 12, 7);
            ctx.fillStyle = BL;
            ctx.fillRect(-4, -10, 8, 5);
            ctx.fillStyle = BH;
            ctx.fillRect(-3, -10, 6, 2);

            // Ears (with twitch)
            ctx.fillStyle = BD;
            ctx.fillRect(-7, -16 - earTwitch, 3, 6);
            ctx.fillRect(-6, -17 - earTwitch, 2, 2);
            ctx.fillRect(4, -16 - earTwitch, 3, 6);
            ctx.fillRect(4, -17 - earTwitch, 2, 2);
            ctx.fillStyle = PK;
            ctx.fillRect(-6, -15 - earTwitch, 2, 4);
            ctx.fillRect(5, -15 - earTwitch, 2, 4);

            // Eyes
            if (this._blinking) {
                ctx.fillStyle = EY;
                ctx.fillRect(-4, -7, 3, 1);
                ctx.fillRect(1, -7, 3, 1);
            } else {
                ctx.fillStyle = EY;
                ctx.fillRect(-5, -8, 3, 3);
                ctx.fillRect(2, -8, 3, 3);
                ctx.fillStyle = PU;
                ctx.fillRect(-4, -8, 1, 2);
                ctx.fillRect(3, -8, 1, 2);
                ctx.fillStyle = '#fff';
                ctx.fillRect(-5, -8, 1, 1);
                ctx.fillRect(2, -8, 1, 1);
                // Looking around — pupils shift
                if (this.state === 'looking_around') {
                    var lookDir = Math.sin(this.tick * 0.05) > 0 ? 1 : 0;
                    ctx.fillStyle = PU;
                    ctx.fillRect(-4 + lookDir, -8, 1, 2);
                    ctx.fillRect(3 + lookDir, -8, 1, 2);
                }
            }

            // Nose + mouth
            ctx.fillStyle = PK;
            ctx.fillRect(-1, -5, 2, 1);
            ctx.fillStyle = BL;
            ctx.fillRect(-1, -4, 1, 1);
            ctx.fillRect(0, -4, 1, 1);

            // Paws
            ctx.fillStyle = BD;
            ctx.fillRect(-4, 9, 3, 2);
            ctx.fillRect(1, 9, 3, 2);
            ctx.fillStyle = BH;
            ctx.fillRect(-3, 9, 2, 1);
            ctx.fillRect(2, 9, 2, 1);

            // Tail (curling to side with sway)
            ctx.fillStyle = BM;
            ctx.fillRect(5, 5, 2, 2);
            ctx.fillRect(6, 3 + Math.round(tailSway * 0.5), 2, 2);
            ctx.fillRect(7, 1 + Math.round(tailSway * 0.5), 2, 2);
            ctx.fillRect(7, -1 + Math.round(tailSway), 2, 2);
            ctx.fillStyle = BD;
            ctx.fillRect(7, -2 + Math.round(tailSway), 2, 2);
            return;
        }

        if (isGrooming) {
            // === GROOMING — body same as sitting, head tilted ===
            ctx.fillStyle = BD;
            ctx.fillRect(-6, 0, 12, 10);
            ctx.fillRect(-7, 1, 14, 8);
            ctx.fillStyle = BM;
            ctx.fillRect(-5, 1, 10, 8);
            ctx.fillStyle = WC;
            ctx.fillRect(-2, 3, 4, 3);

            // Head tilted to side
            ctx.fillStyle = BD;
            ctx.fillRect(-2, -11, 11, 10);
            ctx.fillRect(-3, -10, 12, 8);
            ctx.fillStyle = BM;
            ctx.fillRect(-1, -10, 9, 8);
            ctx.fillStyle = BL;
            ctx.fillRect(0, -9, 6, 4);

            // Ears
            ctx.fillStyle = BD;
            ctx.fillRect(-1, -15, 3, 5);
            ctx.fillRect(5, -15, 3, 5);
            ctx.fillStyle = PK;
            ctx.fillRect(0, -14, 2, 3);
            ctx.fillRect(6, -14, 2, 3);

            // Eyes closed happy
            ctx.fillStyle = EY;
            ctx.fillRect(1, -7, 2, 1);
            ctx.fillRect(5, -7, 2, 1);

            // Paw raised (licking)
            var lk = Math.floor(Math.sin(this.tick * 0.2));
            ctx.fillStyle = BD;
            ctx.fillRect(7, -5 + lk, 3, 3);
            ctx.fillStyle = BH;
            ctx.fillRect(8, -4 + lk, 1, 1);
            ctx.fillStyle = '#c06080';
            ctx.fillRect(6, -4 + lk, 2, 1);

            ctx.fillStyle = BD;
            ctx.fillRect(-4, 9, 3, 2);
            ctx.fillRect(1, 9, 3, 2);

            // Tail
            ctx.fillStyle = BM;
            ctx.fillRect(5, 5, 2, 2);
            ctx.fillRect(6, 3, 2, 2);
            ctx.fillRect(7, 1, 2, 2);
            return;
        }

        // === WALKING ===
        if (this.moveDir === 'up') {
            // === WALKING UP — rear view (butt facing camera) ===
            // Tail (sticking up, centered, swaying)
            ctx.fillStyle = BM;
            ctx.fillRect(-1, -8, 2, 3);
            ctx.fillRect(-1, -12 + Math.round(tailSway), 2, 5);
            ctx.fillStyle = BD;
            ctx.fillRect(-1, -14 + Math.round(tailSway), 2, 3);

            // Body (rounded from behind)
            ctx.fillStyle = BD;
            ctx.fillRect(-7, -4, 14, 11);
            ctx.fillRect(-8, -3, 16, 9);
            ctx.fillStyle = BM;
            ctx.fillRect(-6, -3, 12, 9);
            ctx.fillRect(-7, -2, 14, 7);
            ctx.fillStyle = BL;
            ctx.fillRect(-5, -3, 10, 5);
            // Fur texture on back
            ctx.fillStyle = FUR;
            ctx.fillRect(-3, -1, 2, 1);
            ctx.fillRect(2, 0, 2, 1);
            ctx.fillRect(-1, 2, 1, 2);

            // Back legs (animated, seen from behind)
            ctx.fillStyle = BD;
            ctx.fillRect(-6, 5 - walk, 3, 5);
            ctx.fillRect(3, 5 + walk, 3, 5);
            ctx.fillStyle = BH;
            ctx.fillRect(-6, 8 - walk, 3, 2);
            ctx.fillRect(3, 8 + walk, 3, 2);

            // Head (back of head — no face, just round shape + ears)
            ctx.fillStyle = BD;
            ctx.fillRect(-5, -11, 10, 8);
            ctx.fillRect(-6, -10, 12, 6);
            ctx.fillStyle = BM;
            ctx.fillRect(-4, -10, 8, 6);
            ctx.fillRect(-5, -9, 10, 4);
            ctx.fillStyle = BL;
            ctx.fillRect(-3, -10, 6, 3);

            // Ears (from behind — inner not visible)
            ctx.fillStyle = BD;
            ctx.fillRect(-7, -14 - earTwitch, 3, 5);
            ctx.fillRect(-7, -15 - earTwitch, 2, 2);
            ctx.fillRect(4, -14 - earTwitch, 3, 5);
            ctx.fillRect(5, -15 - earTwitch, 2, 2);

        } else if (this.moveDir === 'down') {
            // === WALKING DOWN — front view (face toward camera) ===
            // Tail (behind body, peeking over top)
            ctx.fillStyle = BM;
            ctx.fillRect(5, -2, 2, 2);
            ctx.fillRect(6, -4 + Math.round(tailSway * 0.5), 2, 2);
            ctx.fillRect(7, -6 + Math.round(tailSway), 2, 2);
            ctx.fillStyle = BD;
            ctx.fillRect(7, -8 + Math.round(tailSway), 2, 2);

            // Body (front facing, walking)
            ctx.fillStyle = BD;
            ctx.fillRect(-7, -3, 14, 11);
            ctx.fillRect(-8, -2, 16, 9);
            ctx.fillStyle = BM;
            ctx.fillRect(-6, -2, 12, 9);
            ctx.fillRect(-7, -1, 14, 7);
            ctx.fillStyle = BL;
            ctx.fillRect(-5, -2, 10, 5);
            // White chest
            ctx.fillStyle = WC;
            ctx.fillRect(-2, 1, 4, 3);
            ctx.fillStyle = WC2;
            ctx.fillRect(-1, 2, 2, 1);
            // Fur texture
            ctx.fillStyle = FUR;
            ctx.fillRect(-4, 2, 1, 2);
            ctx.fillRect(4, 1, 1, 2);

            // Front legs (animated)
            ctx.fillStyle = BD;
            ctx.fillRect(-5, 6 + walk, 3, 5);
            ctx.fillRect(2, 6 - walk, 3, 5);
            ctx.fillStyle = BH;
            ctx.fillRect(-5, 9 + walk, 3, 2);
            ctx.fillRect(2, 9 - walk, 3, 2);

            // Head (big, front-facing)
            ctx.fillStyle = BD;
            ctx.fillRect(-6, -12, 12, 10);
            ctx.fillRect(-7, -11, 14, 8);
            ctx.fillStyle = BM;
            ctx.fillRect(-5, -11, 10, 8);
            ctx.fillRect(-6, -10, 12, 6);
            ctx.fillStyle = BL;
            ctx.fillRect(-4, -11, 8, 4);
            ctx.fillStyle = BH;
            ctx.fillRect(-3, -11, 6, 2);

            // Ears (front-facing with twitch)
            ctx.fillStyle = BD;
            ctx.fillRect(-7, -16 - earTwitch, 3, 6);
            ctx.fillRect(-6, -17 - earTwitch, 2, 2);
            ctx.fillRect(4, -16 - earTwitch, 3, 6);
            ctx.fillRect(4, -17 - earTwitch, 2, 2);
            ctx.fillStyle = PK;
            ctx.fillRect(-6, -15 - earTwitch, 2, 4);
            ctx.fillRect(5, -15 - earTwitch, 2, 4);

            // Eyes
            if (this._blinking) {
                ctx.fillStyle = EY;
                ctx.fillRect(-4, -8, 3, 1);
                ctx.fillRect(1, -8, 3, 1);
            } else {
                ctx.fillStyle = EY;
                ctx.fillRect(-5, -9, 3, 3);
                ctx.fillRect(2, -9, 3, 3);
                ctx.fillStyle = PU;
                ctx.fillRect(-4, -9, 1, 2);
                ctx.fillRect(3, -9, 1, 2);
                ctx.fillStyle = '#fff';
                ctx.fillRect(-5, -9, 1, 1);
                ctx.fillRect(2, -9, 1, 1);
            }

            // Nose + mouth
            ctx.fillStyle = PK;
            ctx.fillRect(-1, -6, 2, 1);
            ctx.fillStyle = BL;
            ctx.fillRect(-1, -5, 1, 1);
            ctx.fillRect(0, -5, 1, 1);

            // Whiskers
            ctx.fillStyle = BH;
            ctx.fillRect(-8, -7, 2, 1);
            ctx.fillRect(6, -7, 2, 1);
            ctx.fillRect(-8, -5, 2, 1);
            ctx.fillRect(6, -5, 2, 1);

        } else {
            // === WALKING SIDE VIEW (original) ===
            // Tail (stands up, sways)
            ctx.fillStyle = BM;
            ctx.fillRect(-9, -1, 2, 2);
            ctx.fillRect(-10, -4, 2, 4);
            ctx.fillRect(-10, -7 + Math.round(tailSway), 2, 4);
            ctx.fillRect(-10, -10 + Math.round(tailSway), 2, 4);
            ctx.fillStyle = BD;
            ctx.fillRect(-10, -12 + Math.round(tailSway), 2, 3);
            ctx.fillRect(-9, -13 + Math.round(tailSway), 2, 2);

            // Back legs (animated)
            ctx.fillStyle = BD;
            ctx.fillRect(-4, 4 - walk, 2, 4);
            ctx.fillRect(-1, 4 + walk, 2, 4);
            ctx.fillStyle = BH;
            ctx.fillRect(-5, 7 - walk, 3, 2);
            ctx.fillRect(-2, 7 + walk, 3, 2);

            // Body (rounded, no outlines)
            ctx.fillStyle = BD;
            ctx.fillRect(-7, -4, 16, 10);
            ctx.fillRect(-6, -5, 14, 12);
            ctx.fillStyle = BM;
            ctx.fillRect(-5, -3, 14, 8);
            ctx.fillRect(-6, -2, 14, 6);
            ctx.fillStyle = BL;
            ctx.fillRect(-3, -3, 10, 4);
            // Fur texture
            ctx.fillStyle = FUR;
            ctx.fillRect(-1, -2, 2, 1);
            ctx.fillRect(4, -1, 2, 1);
            ctx.fillRect(-4, 1, 1, 2);
            // White chest spot
            ctx.fillStyle = WC;
            ctx.fillRect(2, 1, 3, 3);
            ctx.fillStyle = WC2;
            ctx.fillRect(3, 2, 1, 1);
            // Breathing
            ctx.fillStyle = BM;
            ctx.fillRect(-6, 3 + Math.round(breathe), 14, 1);

            // Front legs (animated)
            ctx.fillStyle = BD;
            ctx.fillRect(5, 4 + walk, 2, 4);
            ctx.fillRect(7, 4 - walk, 2, 4);
            ctx.fillStyle = BH;
            ctx.fillRect(4, 7 + walk, 3, 2);
            ctx.fillRect(6, 7 - walk, 3, 2);

            // Head (big, rounded)
            ctx.fillStyle = BD;
            ctx.fillRect(6, -10, 12, 10);
            ctx.fillRect(5, -9, 14, 8);
            ctx.fillRect(7, -11, 10, 12);
            ctx.fillStyle = BM;
            ctx.fillRect(7, -9, 10, 8);
            ctx.fillRect(6, -8, 12, 6);
            ctx.fillStyle = BL;
            ctx.fillRect(8, -9, 8, 4);
            ctx.fillStyle = BH;
            ctx.fillRect(9, -9, 5, 2);

            // Ears (with twitch animation)
            ctx.fillStyle = BD;
            ctx.fillRect(6, -14 - earTwitch, 3, 5);
            ctx.fillRect(7, -16 - earTwitch, 2, 3);
            ctx.fillRect(12, -14 - earTwitch, 3, 5);
            ctx.fillRect(13, -16 - earTwitch, 2, 3);
            ctx.fillStyle = PK;
            ctx.fillRect(7, -13 - earTwitch, 2, 3);
            ctx.fillRect(13, -13 - earTwitch, 2, 3);

            // Eye
            if (this._blinking) {
                ctx.fillStyle = EY;
                ctx.fillRect(13, -6, 3, 1);
            } else {
                ctx.fillStyle = EY;
                ctx.fillRect(13, -7, 3, 3);
                ctx.fillStyle = PU;
                ctx.fillRect(14, -7, 1, 2);
                ctx.fillStyle = '#fff';
                ctx.fillRect(13, -7, 1, 1);
            }

            // Nose
            ctx.fillStyle = PK;
            ctx.fillRect(17, -4, 2, 1);

            // Whiskers
            ctx.fillStyle = BH;
            ctx.fillRect(18, -5, 2, 1);
            ctx.fillRect(18, -3, 2, 1);
        }
    }

    _drawPug() {
        // Pug dog — fawn body, dark mask, curly tail, stubby, soft pixel art
        var BF = '#d4a86a';  // fawn body
        var BD = '#b8904e';  // body dark
        var BL = '#e0be82';  // body light
        var BH = '#ecd09a';  // highlight
        var MK = '#4a3828';  // mask (dark face)
        var MKL = '#5c4a38'; // mask lighter
        var NOS = '#2a1a10'; // nose
        var EY = '#2a1810';  // eye dark
        var WH = '#fff';
        var PNK = '#d08080'; // tongue pink
        var walk = this.isMoving ? Math.floor(Math.sin(this.tick * 0.3) * 2) : 0;
        var tailWag = Math.sin(this.tick * 0.25) * 2;
        var breathe = Math.sin(this.tick * 0.06) * 0.5;
        var earFlop = Math.sin(this.tick * 0.08) * 0.5;
        var pant = this.isMoving ? Math.abs(Math.sin(this.tick * 0.2)) : 0;
        var isSleeping = this.state === 'sleeping';
        var isSitting = this.state === 'sitting' || this.state === 'being_pet' || this.state === 'looking_around';
        var isGrooming = this.state === 'grooming';

        // Shadow
        ctx.fillStyle = 'rgba(50,30,10,0.12)';
        ctx.fillRect(-9, 9, 18, 3);
        ctx.fillRect(-7, 10, 14, 2);

        if (isSleeping) {
            // === SLEEPING — lying on side, head on paws ===
            // Body (flat, lying sideways)
            ctx.fillStyle = BD;
            ctx.fillRect(-2, 0, 12, 7);
            ctx.fillRect(-1, -1, 10, 9);
            ctx.fillStyle = BF;
            ctx.fillRect(0, 1, 8, 5);
            ctx.fillStyle = BL;
            ctx.fillRect(1, 2, 6, 3);
            // Belly
            ctx.fillStyle = BH;
            ctx.fillRect(2, 4, 4, 2);
            // Breathing
            ctx.fillStyle = BF;
            ctx.fillRect(-1, 6 + Math.round(breathe), 10, 1);

            // Head (distinct, resting to the left — big round pug head)
            ctx.fillStyle = BF;
            ctx.fillRect(-11, -4, 10, 9);
            ctx.fillRect(-10, -5, 8, 11);
            ctx.fillStyle = BL;
            ctx.fillRect(-9, -4, 6, 4);
            // Dark mask on face
            ctx.fillStyle = MK;
            ctx.fillRect(-10, -2, 8, 5);
            ctx.fillRect(-9, -3, 6, 7);
            ctx.fillStyle = MKL;
            ctx.fillRect(-8, -1, 5, 3);

            // Floppy ears
            ctx.fillStyle = MK;
            ctx.fillRect(-11, -5, 3, 3);
            ctx.fillRect(-5, -5, 3, 3);

            // Eyes closed (happy arches — clearly visible)
            ctx.fillStyle = BF;
            ctx.fillRect(-9, -1, 3, 1);
            ctx.fillRect(-8, -2, 1, 1);
            ctx.fillRect(-5, -1, 3, 1);
            ctx.fillRect(-4, -2, 1, 1);

            // Nose
            ctx.fillStyle = NOS;
            ctx.fillRect(-7, 1, 2, 1);

            // Front paws (stretched under chin)
            ctx.fillStyle = BD;
            ctx.fillRect(-10, 4, 3, 2);
            ctx.fillRect(-6, 4, 3, 2);
            ctx.fillStyle = BL;
            ctx.fillRect(-9, 4, 1, 1);
            ctx.fillRect(-5, 4, 1, 1);

            // Curly tail behind
            ctx.fillStyle = BF;
            ctx.fillRect(9, 1, 2, 2);
            ctx.fillRect(10, -1, 2, 2);
            ctx.fillRect(9, -2, 2, 2);
            return;
        }

        if (isSitting) {
            // === SITTING — front-facing ===
            // Body
            ctx.fillStyle = BD;
            ctx.fillRect(-6, 0, 12, 9);
            ctx.fillRect(-7, 1, 14, 7);
            ctx.fillStyle = BF;
            ctx.fillRect(-5, 1, 10, 7);
            ctx.fillRect(-6, 2, 12, 5);
            ctx.fillStyle = BL;
            ctx.fillRect(-4, 2, 8, 4);
            // Belly
            ctx.fillStyle = BH;
            ctx.fillRect(-3, 4, 6, 3);
            // Breathing
            ctx.fillStyle = BF;
            ctx.fillRect(-6 + Math.round(breathe * 0.5), 7, 1, 1);
            ctx.fillRect(5 - Math.round(breathe * 0.5), 7, 1, 1);

            // Head (big, round, dark mask)
            ctx.fillStyle = BF;
            ctx.fillRect(-7, -11, 14, 12);
            ctx.fillRect(-8, -10, 16, 10);
            ctx.fillStyle = BL;
            ctx.fillRect(-6, -11, 12, 5);
            // Forehead wrinkles
            ctx.fillStyle = BD;
            ctx.fillRect(-4, -9, 8, 1);
            ctx.fillRect(-3, -7, 6, 1);
            // Dark mask around eyes/nose
            ctx.fillStyle = MK;
            ctx.fillRect(-6, -7, 12, 6);
            ctx.fillRect(-5, -8, 10, 8);
            ctx.fillStyle = MKL;
            ctx.fillRect(-4, -6, 8, 4);

            // Ears (floppy, dark)
            ctx.fillStyle = MK;
            ctx.fillRect(-9, -10 + Math.round(earFlop), 3, 5);
            ctx.fillRect(6, -10 - Math.round(earFlop), 3, 5);
            ctx.fillStyle = MKL;
            ctx.fillRect(-8, -9 + Math.round(earFlop), 2, 3);
            ctx.fillRect(6, -9 - Math.round(earFlop), 2, 3);

            // Eyes (big, round, shiny)
            if (this._blinking) {
                ctx.fillStyle = NOS;
                ctx.fillRect(-4, -5, 3, 1);
                ctx.fillRect(1, -5, 3, 1);
            } else {
                ctx.fillStyle = WH;
                ctx.fillRect(-5, -6, 4, 3);
                ctx.fillRect(1, -6, 4, 3);
                ctx.fillStyle = EY;
                ctx.fillRect(-4, -6, 2, 2);
                ctx.fillRect(2, -6, 2, 2);
                ctx.fillStyle = WH;
                ctx.fillRect(-5, -6, 1, 1);
                ctx.fillRect(1, -6, 1, 1);
                // Pupil looking around
                if (this.state === 'looking_around') {
                    var ld = Math.sin(this.tick * 0.05) > 0 ? 1 : 0;
                    ctx.fillStyle = EY;
                    ctx.fillRect(-4 + ld, -6, 2, 2);
                    ctx.fillRect(2 + ld, -6, 2, 2);
                }
            }

            // Nose (wide flat pug nose)
            ctx.fillStyle = NOS;
            ctx.fillRect(-2, -3, 4, 2);
            ctx.fillRect(-1, -4, 2, 1);
            // Nostrils
            ctx.fillStyle = MK;
            ctx.fillRect(-1, -3, 1, 1);
            ctx.fillRect(1, -3, 1, 1);

            // Mouth / tongue
            ctx.fillStyle = MK;
            ctx.fillRect(-2, -1, 4, 1);
            // Tongue out when being pet or happy
            if (this.state === 'being_pet' || pant > 0.3) {
                ctx.fillStyle = PNK;
                ctx.fillRect(-1, -1, 2, 2);
                ctx.fillRect(0, 1, 1, 1);
            }

            // Paws
            ctx.fillStyle = BD;
            ctx.fillRect(-4, 8, 3, 2);
            ctx.fillRect(1, 8, 3, 2);
            ctx.fillStyle = BL;
            ctx.fillRect(-3, 8, 2, 1);
            ctx.fillRect(2, 8, 2, 1);

            // Curly tail (behind, wagging)
            ctx.fillStyle = BF;
            ctx.fillRect(6, 3, 2, 2);
            ctx.fillRect(7, 1 + Math.round(tailWag * 0.5), 2, 2);
            ctx.fillRect(7, -1 + Math.round(tailWag), 2, 2);
            ctx.fillStyle = BD;
            ctx.fillRect(6, -2 + Math.round(tailWag), 2, 2);
            ctx.fillRect(5, -2 + Math.round(tailWag), 2, 1);
            return;
        }

        if (isGrooming) {
            // === GROOMING — scratching ear with back leg ===
            ctx.fillStyle = BD;
            ctx.fillRect(-6, 0, 12, 9);
            ctx.fillRect(-7, 1, 14, 7);
            ctx.fillStyle = BF;
            ctx.fillRect(-5, 1, 10, 7);
            ctx.fillStyle = BH;
            ctx.fillRect(-3, 4, 6, 3);

            // Head tilted
            ctx.fillStyle = BF;
            ctx.fillRect(-3, -10, 12, 10);
            ctx.fillRect(-4, -9, 13, 8);
            ctx.fillStyle = MK;
            ctx.fillRect(-1, -6, 10, 5);
            ctx.fillStyle = MKL;
            ctx.fillRect(0, -5, 8, 3);

            // Ear
            ctx.fillStyle = MK;
            ctx.fillRect(-3, -9, 3, 4);
            ctx.fillRect(7, -9, 3, 4);

            // Eyes closed happy
            ctx.fillStyle = NOS;
            ctx.fillRect(1, -4, 2, 1);
            ctx.fillRect(5, -4, 2, 1);

            // Back leg raised scratching ear
            var scratchBob = Math.floor(Math.sin(this.tick * 0.3) * 1);
            ctx.fillStyle = BF;
            ctx.fillRect(8, -7 + scratchBob, 3, 3);
            ctx.fillStyle = BD;
            ctx.fillRect(9, -8 + scratchBob, 2, 2);

            // Front paws
            ctx.fillStyle = BD;
            ctx.fillRect(-4, 8, 3, 2);
            ctx.fillRect(1, 8, 3, 2);

            // Tail
            ctx.fillStyle = BF;
            ctx.fillRect(6, 3, 2, 2);
            ctx.fillRect(7, 1, 2, 2);
            return;
        }

        // === WALKING ===
        if (this.moveDir === 'up') {
            // === WALKING UP — rear view (pug butt facing camera) ===
            // Curly tail (centered on top, wagging)
            ctx.fillStyle = BF;
            ctx.fillRect(-1, -6, 2, 3);
            ctx.fillRect(-2, -8 + Math.round(tailWag * 0.5), 2, 3);
            ctx.fillStyle = BD;
            ctx.fillRect(-2, -10 + Math.round(tailWag), 3, 3);
            ctx.fillRect(-1, -11 + Math.round(tailWag), 2, 2);

            // Body (rounded from behind)
            ctx.fillStyle = BD;
            ctx.fillRect(-7, -4, 14, 11);
            ctx.fillRect(-8, -3, 16, 9);
            ctx.fillStyle = BF;
            ctx.fillRect(-6, -3, 12, 9);
            ctx.fillRect(-7, -2, 14, 7);
            ctx.fillStyle = BL;
            ctx.fillRect(-5, -3, 10, 5);

            // Back legs (animated)
            ctx.fillStyle = BD;
            ctx.fillRect(-6, 5 - walk, 3, 5);
            ctx.fillRect(3, 5 + walk, 3, 5);
            ctx.fillStyle = BL;
            ctx.fillRect(-6, 8 - walk, 3, 2);
            ctx.fillRect(3, 8 + walk, 3, 2);

            // Head (back of head — round, fawn, ears floppy)
            ctx.fillStyle = BF;
            ctx.fillRect(-5, -11, 10, 8);
            ctx.fillRect(-6, -10, 12, 6);
            ctx.fillStyle = BL;
            ctx.fillRect(-4, -11, 8, 4);
            // Back of head wrinkles
            ctx.fillStyle = BD;
            ctx.fillRect(-3, -9, 6, 1);

            // Ears (floppy, from behind)
            ctx.fillStyle = MK;
            ctx.fillRect(-7, -10 + Math.round(earFlop), 3, 4);
            ctx.fillRect(4, -10 - Math.round(earFlop), 3, 4);

        } else if (this.moveDir === 'down') {
            // === WALKING DOWN — front view (face toward camera) ===
            // Tail peeking behind
            ctx.fillStyle = BF;
            ctx.fillRect(5, -2, 2, 2);
            ctx.fillRect(6, -4 + Math.round(tailWag * 0.5), 2, 2);
            ctx.fillStyle = BD;
            ctx.fillRect(6, -6 + Math.round(tailWag), 2, 2);

            // Body
            ctx.fillStyle = BD;
            ctx.fillRect(-7, -3, 14, 11);
            ctx.fillRect(-8, -2, 16, 9);
            ctx.fillStyle = BF;
            ctx.fillRect(-6, -2, 12, 9);
            ctx.fillRect(-7, -1, 14, 7);
            ctx.fillStyle = BL;
            ctx.fillRect(-5, -2, 10, 5);
            // Belly
            ctx.fillStyle = BH;
            ctx.fillRect(-3, 2, 6, 3);

            // Front legs (animated)
            ctx.fillStyle = BD;
            ctx.fillRect(-5, 6 + walk, 3, 5);
            ctx.fillRect(2, 6 - walk, 3, 5);
            ctx.fillStyle = BL;
            ctx.fillRect(-5, 9 + walk, 3, 2);
            ctx.fillRect(2, 9 - walk, 3, 2);

            // Head (big, round, flat-faced, mask)
            ctx.fillStyle = BF;
            ctx.fillRect(-7, -12, 14, 10);
            ctx.fillRect(-8, -11, 16, 8);
            ctx.fillStyle = BL;
            ctx.fillRect(-6, -12, 12, 4);
            // Forehead wrinkles
            ctx.fillStyle = BD;
            ctx.fillRect(-4, -10, 8, 1);
            ctx.fillRect(-3, -8, 6, 1);
            // Dark mask
            ctx.fillStyle = MK;
            ctx.fillRect(-6, -8, 12, 6);
            ctx.fillRect(-5, -9, 10, 8);
            ctx.fillStyle = MKL;
            ctx.fillRect(-4, -7, 8, 4);

            // Ears (floppy)
            ctx.fillStyle = MK;
            ctx.fillRect(-9, -11 + Math.round(earFlop), 3, 5);
            ctx.fillRect(6, -11 - Math.round(earFlop), 3, 5);
            ctx.fillStyle = MKL;
            ctx.fillRect(-8, -10 + Math.round(earFlop), 2, 3);
            ctx.fillRect(6, -10 - Math.round(earFlop), 2, 3);

            // Eyes
            if (this._blinking) {
                ctx.fillStyle = NOS;
                ctx.fillRect(-4, -6, 3, 1);
                ctx.fillRect(1, -6, 3, 1);
            } else {
                ctx.fillStyle = WH;
                ctx.fillRect(-5, -7, 4, 3);
                ctx.fillRect(1, -7, 4, 3);
                ctx.fillStyle = EY;
                ctx.fillRect(-4, -7, 2, 2);
                ctx.fillRect(2, -7, 2, 2);
                ctx.fillStyle = WH;
                ctx.fillRect(-5, -7, 1, 1);
                ctx.fillRect(1, -7, 1, 1);
            }

            // Nose
            ctx.fillStyle = NOS;
            ctx.fillRect(-2, -4, 4, 2);
            ctx.fillRect(-1, -5, 2, 1);
            ctx.fillStyle = MK;
            ctx.fillRect(-1, -4, 1, 1);
            ctx.fillRect(1, -4, 1, 1);

            // Tongue out when panting
            if (pant > 0.3) {
                ctx.fillStyle = PNK;
                ctx.fillRect(-1, -2, 2, 2);
                ctx.fillRect(0, 0, 1, 1);
            }

        } else {
            // === WALKING SIDE VIEW (original) ===
            // Curly tail (stands up, wags)
            ctx.fillStyle = BF;
            ctx.fillRect(-9, -1, 2, 2);
            ctx.fillRect(-9, -4 + Math.round(tailWag * 0.5), 2, 3);
            ctx.fillStyle = BD;
            ctx.fillRect(-9, -6 + Math.round(tailWag), 2, 3);
            ctx.fillRect(-8, -7 + Math.round(tailWag), 2, 2);
            ctx.fillRect(-7, -7 + Math.round(tailWag), 2, 1);

            // Back legs
            ctx.fillStyle = BD;
            ctx.fillRect(-4, 4 - walk, 2, 4);
            ctx.fillRect(-1, 4 + walk, 2, 4);
            ctx.fillStyle = BL;
            ctx.fillRect(-5, 7 - walk, 3, 2);
            ctx.fillRect(-2, 7 + walk, 3, 2);

            // Body (chunky, rounded)
            ctx.fillStyle = BD;
            ctx.fillRect(-7, -4, 16, 10);
            ctx.fillRect(-6, -5, 14, 12);
            ctx.fillStyle = BF;
            ctx.fillRect(-5, -3, 14, 8);
            ctx.fillRect(-6, -2, 14, 6);
            ctx.fillStyle = BL;
            ctx.fillRect(-3, -3, 10, 4);
            // Belly
            ctx.fillStyle = BH;
            ctx.fillRect(-1, 2, 6, 2);
            // Breathing
            ctx.fillStyle = BF;
            ctx.fillRect(-6, 3 + Math.round(breathe), 14, 1);

            // Front legs
            ctx.fillStyle = BD;
            ctx.fillRect(5, 4 + walk, 2, 4);
            ctx.fillRect(7, 4 - walk, 2, 4);
            ctx.fillStyle = BL;
            ctx.fillRect(4, 7 + walk, 3, 2);
            ctx.fillRect(6, 7 - walk, 3, 2);

            // Head (big, flat-faced, dark mask)
            ctx.fillStyle = BF;
            ctx.fillRect(6, -10, 12, 10);
            ctx.fillRect(5, -9, 14, 8);
            ctx.fillRect(7, -11, 10, 12);
            ctx.fillStyle = BL;
            ctx.fillRect(8, -10, 8, 4);
            // Forehead wrinkle
            ctx.fillStyle = BD;
            ctx.fillRect(9, -8, 6, 1);
            // Dark mask
            ctx.fillStyle = MK;
            ctx.fillRect(8, -7, 10, 6);
            ctx.fillRect(7, -6, 12, 4);
            ctx.fillStyle = MKL;
            ctx.fillRect(9, -6, 8, 3);

            // Ear (floppy, dark)
            ctx.fillStyle = MK;
            ctx.fillRect(6, -10 + Math.round(earFlop), 3, 4);
            ctx.fillStyle = MKL;
            ctx.fillRect(7, -9 + Math.round(earFlop), 2, 2);

            // Eye
            if (this._blinking) {
                ctx.fillStyle = NOS;
                ctx.fillRect(14, -5, 3, 1);
            } else {
                ctx.fillStyle = WH;
                ctx.fillRect(13, -6, 3, 3);
                ctx.fillStyle = EY;
                ctx.fillRect(14, -6, 2, 2);
                ctx.fillStyle = WH;
                ctx.fillRect(13, -6, 1, 1);
            }

            // Nose (flat)
            ctx.fillStyle = NOS;
            ctx.fillRect(17, -3, 2, 2);
            ctx.fillRect(16, -2, 1, 1);

            // Tongue out when walking (panting)
            if (pant > 0.3) {
                ctx.fillStyle = PNK;
                ctx.fillRect(17, -1, 2, 2);
                ctx.fillRect(18, 1, 1, 1);
            }
        }
    }

    _drawLobster() {
        // Soft pixel art — NO black outlines, rounded, matches office style
        var R = '#d94030';   // main red
        var RD = '#b82820';  // dark red
        var RL = '#e85848';  // light red
        var RR = '#f07060';  // bright highlight
        var RB = '#9a2018';  // darkest / shadow
        var GD = '#d0a030';  // gold feet
        var WH = '#fff';
        var walk = this.isMoving ? Math.floor(Math.sin(this.tick * 0.25) * 2) : 0;
        var clawOpen = Math.sin(this.tick * 0.12) * 1.5;
        var antennaWave = Math.sin(this.tick * 0.08) * 3;
        var breathe = Math.sin(this.tick * 0.06) * 0.5;
        var isSleeping = this.state === 'sleeping';
        var isSitting = this.state === 'sitting' || this.state === 'being_pet' || this.state === 'looking_around' || this.state === 'grooming';

        // Shadow
        ctx.fillStyle = 'rgba(30,10,10,0.12)';
        ctx.fillRect(-9, 11, 18, 3);
        ctx.fillRect(-7, 12, 14, 2);

        if (isSleeping) {
            // === SLEEPING — lying on side, head visible with closed eyes ===
            // Tail behind
            ctx.fillStyle = RD;
            ctx.fillRect(-14, 1, 4, 3);
            ctx.fillStyle = R;
            ctx.fillRect(-17, 2, 4, 2);
            ctx.fillRect(-19, 2, 3, 2);

            // Body (segmented, lying flat)
            ctx.fillStyle = RD;
            ctx.fillRect(-6, 0, 14, 7);
            ctx.fillRect(-5, -1, 12, 9);
            ctx.fillStyle = R;
            ctx.fillRect(-4, 1, 10, 5);
            ctx.fillStyle = RL;
            ctx.fillRect(-3, 1, 8, 2);
            // Segments
            ctx.fillStyle = RD;
            ctx.fillRect(-1, 0, 1, 7);
            ctx.fillRect(3, 0, 1, 7);
            // Legs tucked (red)
            ctx.fillStyle = RD;
            ctx.fillRect(-3, 6, 3, 2);
            ctx.fillRect(1, 6, 3, 2);
            ctx.fillRect(5, 6, 3, 2);

            // Head (distinct, round, resting to the right)
            ctx.fillStyle = RD;
            ctx.fillRect(7, -3, 9, 8);
            ctx.fillRect(8, -4, 7, 10);
            ctx.fillStyle = R;
            ctx.fillRect(9, -2, 5, 6);
            ctx.fillRect(8, -1, 7, 4);
            ctx.fillStyle = RL;
            ctx.fillRect(9, -2, 4, 2);

            // Eyes closed (happy arches)
            ctx.fillStyle = '#fff';
            ctx.fillRect(9, 0, 2, 1);
            ctx.fillRect(10, -1, 1, 1);
            ctx.fillRect(13, 0, 2, 1);
            ctx.fillRect(14, -1, 1, 1);

            // Mouth (happy)
            ctx.fillStyle = RB;
            ctx.fillRect(11, 2, 2, 1);

            // Claw resting in front
            ctx.fillStyle = R;
            ctx.fillRect(14, 3, 4, 3);
            ctx.fillRect(15, 2, 3, 2);
            ctx.fillStyle = RL;
            ctx.fillRect(15, 3, 2, 1);

            // Antennae drooped
            ctx.fillStyle = RD;
            ctx.fillRect(10, -5, 2, 2);
            ctx.fillRect(13, -5, 2, 2);
            return;
        }

        if (isSitting) {
            // === SITTING — front-facing, claws up ===
            // Legs (red, chunky)
            ctx.fillStyle = RD;
            ctx.fillRect(-5, 6, 3, 4);
            ctx.fillRect(0, 6, 3, 4);
            ctx.fillRect(4, 6, 3, 4);
            ctx.fillStyle = R;
            ctx.fillRect(-5, 9, 3, 2);
            ctx.fillRect(0, 9, 3, 2);
            ctx.fillRect(4, 9, 3, 2);

            // Body (rounded)
            ctx.fillStyle = RD;
            ctx.fillRect(-7, -3, 15, 10);
            ctx.fillRect(-6, -4, 13, 12);
            ctx.fillStyle = R;
            ctx.fillRect(-5, -2, 11, 8);
            ctx.fillRect(-6, -1, 13, 6);
            ctx.fillStyle = RL;
            ctx.fillRect(-4, -2, 9, 3);
            ctx.fillStyle = RR;
            ctx.fillRect(-2, -2, 4, 1);
            // Segments
            ctx.fillStyle = RD;
            ctx.fillRect(-5, 0, 11, 1);
            ctx.fillRect(-5, 3, 11, 1);
            // Breathing
            ctx.fillStyle = R;
            ctx.fillRect(-6 + Math.round(breathe * 0.5), 5, 1, 2);

            // Head (rounded)
            ctx.fillStyle = RD;
            ctx.fillRect(-6, -11, 13, 9);
            ctx.fillRect(-5, -12, 11, 10);
            ctx.fillStyle = R;
            ctx.fillRect(-4, -10, 9, 7);
            ctx.fillRect(-5, -9, 11, 5);
            ctx.fillStyle = RL;
            ctx.fillRect(-3, -10, 7, 3);

            // Eyes
            if (this._blinking) {
                ctx.fillStyle = RB;
                ctx.fillRect(-3, -7, 3, 1);
                ctx.fillRect(2, -7, 3, 1);
            } else {
                ctx.fillStyle = WH;
                ctx.fillRect(-4, -8, 3, 3);
                ctx.fillRect(2, -8, 3, 3);
                ctx.fillStyle = '#111';
                ctx.fillRect(-3, -8, 2, 2);
                ctx.fillRect(3, -8, 2, 2);
                ctx.fillStyle = WH;
                ctx.fillRect(-4, -8, 1, 1);
                ctx.fillRect(2, -8, 1, 1);
                // Looking around
                if (this.state === 'looking_around') {
                    var ld = Math.sin(this.tick * 0.05) > 0 ? 1 : 0;
                    ctx.fillStyle = '#111';
                    ctx.fillRect(-3 + ld, -8, 2, 2);
                    ctx.fillRect(3 + ld, -8, 2, 2);
                }
            }

            // Mouth
            ctx.fillStyle = RB;
            ctx.fillRect(-1, -4, 3, 1);

            // Antennae (no outline, just colored)
            ctx.fillStyle = RD;
            ctx.fillRect(-3, -14 + Math.round(antennaWave * 0.3), 2, 4);
            ctx.fillRect(-4, -17 + Math.round(antennaWave * 0.5), 2, 4);
            ctx.fillRect(3, -14 - Math.round(antennaWave * 0.3), 2, 4);
            ctx.fillRect(4, -17 - Math.round(antennaWave * 0.5), 2, 4);

            // Arms + claws (held up)
            ctx.fillStyle = R;
            ctx.fillRect(-10, -3, 4, 4);
            ctx.fillRect(7, -3, 4, 4);
            // Left claw (medium)
            ctx.fillStyle = R;
            ctx.fillRect(-15, -8, 6, 5);
            ctx.fillRect(-14, -2, 5, 3);
            ctx.fillStyle = RL;
            ctx.fillRect(-14, -7, 4, 2);
            ctx.fillStyle = RR;
            ctx.fillRect(-13, -7, 2, 1);
            // Right claw (big one, higher)
            ctx.fillStyle = R;
            ctx.fillRect(8, -14, 8, 7);
            ctx.fillRect(9, -6, 7, 4);
            ctx.fillStyle = RL;
            ctx.fillRect(9, -13, 5, 3);
            ctx.fillStyle = RR;
            ctx.fillRect(10, -13, 3, 1);
            ctx.fillStyle = '#fff';
            ctx.fillRect(11, -12, 1, 1);
            return;
        }

        // === WALKING — front-facing with bounce ===
        // Legs (animated, red, chunky)
        ctx.fillStyle = RD;
        ctx.fillRect(-5, 6 + walk, 3, 4);
        ctx.fillRect(0, 6 - walk, 3, 4);
        ctx.fillRect(4, 6 + walk, 3, 4);
        ctx.fillStyle = R;
        ctx.fillRect(-5, 9 + walk, 3, 2);
        ctx.fillRect(0, 9 - walk, 3, 2);
        ctx.fillRect(4, 9 + walk, 3, 2);

        // Body (rounded)
        ctx.fillStyle = RD;
        ctx.fillRect(-7, -3, 15, 10);
        ctx.fillRect(-6, -4, 13, 12);
        ctx.fillStyle = R;
        ctx.fillRect(-5, -2, 11, 8);
        ctx.fillRect(-6, -1, 13, 6);
        ctx.fillStyle = RL;
        ctx.fillRect(-4, -2, 9, 3);
        ctx.fillStyle = RR;
        ctx.fillRect(-2, -2, 4, 1);
        // Segments
        ctx.fillStyle = RD;
        ctx.fillRect(-5, 0, 11, 1);
        ctx.fillRect(-5, 3, 11, 1);

        // Head (rounded)
        ctx.fillStyle = RD;
        ctx.fillRect(-6, -11, 13, 9);
        ctx.fillRect(-5, -12, 11, 10);
        ctx.fillStyle = R;
        ctx.fillRect(-4, -10, 9, 7);
        ctx.fillRect(-5, -9, 11, 5);
        ctx.fillStyle = RL;
        ctx.fillRect(-3, -10, 7, 3);

        // Eyes
        if (this._blinking) {
            ctx.fillStyle = RB;
            ctx.fillRect(-3, -7, 3, 1);
            ctx.fillRect(2, -7, 3, 1);
        } else {
            ctx.fillStyle = WH;
            ctx.fillRect(-4, -8, 3, 3);
            ctx.fillRect(2, -8, 3, 3);
            ctx.fillStyle = '#111';
            ctx.fillRect(-3, -8, 2, 2);
            ctx.fillRect(3, -8, 2, 2);
            ctx.fillStyle = WH;
            ctx.fillRect(-4, -8, 1, 1);
            ctx.fillRect(2, -8, 1, 1);
        }

        // Mouth
        ctx.fillStyle = RB;
        ctx.fillRect(-1, -4, 3, 1);

        // Antennae (swaying)
        ctx.fillStyle = RD;
        ctx.fillRect(-3, -14 + Math.round(antennaWave * 0.3), 2, 4);
        ctx.fillRect(-4, -18 + Math.round(antennaWave * 0.5), 2, 5);
        ctx.fillRect(-5, -21 + Math.round(antennaWave * 0.7), 2, 4);
        ctx.fillRect(3, -14 - Math.round(antennaWave * 0.3), 2, 4);
        ctx.fillRect(4, -18 - Math.round(antennaWave * 0.5), 2, 5);
        ctx.fillRect(5, -21 - Math.round(antennaWave * 0.7), 2, 4);

        // Arms + claws (bob with walk)
        ctx.fillStyle = R;
        ctx.fillRect(-10, -4 + Math.round(walk * 0.3), 4, 4);
        ctx.fillRect(7, -4 - Math.round(walk * 0.3), 4, 4);
        // Left claw (medium, animated open)
        ctx.fillStyle = R;
        ctx.fillRect(-16, -9 - Math.round(clawOpen) + Math.round(walk * 0.3), 6, 5);
        ctx.fillRect(-15, -3 + Math.round(clawOpen) + Math.round(walk * 0.3), 5, 3);
        ctx.fillStyle = RL;
        ctx.fillRect(-15, -8 - Math.round(clawOpen) + Math.round(walk * 0.3), 4, 2);
        ctx.fillStyle = RR;
        ctx.fillRect(-14, -8 - Math.round(clawOpen) + Math.round(walk * 0.3), 2, 1);
        // Right claw (big, held higher)
        ctx.fillStyle = R;
        ctx.fillRect(9, -15 - Math.round(clawOpen) - Math.round(walk * 0.3), 8, 6);
        ctx.fillRect(10, -8 + Math.round(clawOpen) - Math.round(walk * 0.3), 7, 4);
        ctx.fillStyle = RL;
        ctx.fillRect(10, -14 - Math.round(clawOpen) - Math.round(walk * 0.3), 5, 3);
        ctx.fillStyle = RR;
        ctx.fillRect(11, -14 - Math.round(clawOpen) - Math.round(walk * 0.3), 3, 1);
        ctx.fillStyle = '#fff';
        ctx.fillRect(12, -13 - Math.round(clawOpen) - Math.round(walk * 0.3), 1, 1);
    }
}

// Agent interaction with pet — inject into idle behavior
function _maybePetInteraction(agent) {
    if (officePets.length === 0) return false;
    if (agent.state !== 'idle' || agent._petCooldown > 0) return false;
    var pet = officePets[0];
    if (pet.state === 'sleeping' || pet.state === 'being_pet' || pet.state === 'chased') return false;

    var dx = agent.x - pet.x, dy = agent.y - pet.y;
    var dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > 80) return false; // too far

    var roll = Math.random();
    if (roll < 0.02) {
        // Pet the animal
        agent.idleAction = 'petting';
        agent.targetX = pet.x + (agent.x > pet.x ? 15 : -15);
        agent.targetY = pet.y;
        agent.idleReturnTimer = 100;
        agent.addIntent('Petting ' + pet.name);
        pet.startBeingPet(agent);
        agent._petCooldown = 600;
        return true;
    } else if (roll < 0.03) {
        // Chase the pet playfully
        agent.idleAction = 'chasing_pet';
        agent.idleReturnTimer = 120;
        agent.addIntent('Chasing ' + pet.name + '!');
        pet.startChase(agent);
        agent._petCooldown = 800;
        return true;
    }
    return false;
}

function updatePets() {
    officePets.forEach(function(p) { p.update(); });
    // Update agent chase targets
    officePets.forEach(function(pet) {
        if (pet.state === 'chased' && pet.interactingAgent) {
            var agent = pet.interactingAgent;
            if (agent.idleAction === 'chasing_pet') {
                agent.targetX = pet.x;
                agent.targetY = pet.y;
            }
        }
    });
}

function drawPets() {
    officePets.forEach(function(p) { p.draw(); });
}

function loop() {
    // Update ambient light cache once per frame
    _updateAmbientCache();
    // Clear entire canvas
    ctx.fillStyle = '#263238';
    ctx.fillRect(0, 0, displayW, displayH);

    // Draw world objects with camera
    ctx.save();
    applyCameraTransform();
    // Clip to world bounds so nothing draws outside
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W, H);
    ctx.clip();
    _perfStart('environment'); drawEnvironment(); _perfEnd('environment');
    _rimFrame++;

    // ─── Z-ORDER FIX: Split desk char items into behind-wall vs normal ───
    // Desk char items for desks NOT behind walls are drawn here (before occluders,
    // they'll be covered if near a wall, but that's handled in the front-of-wall redraw).
    // Desk char items for desks BEHIND walls are drawn with the behind-wall agents.
    _perfStart('deskItems');
    var _behindWallDesks = []; // agents whose desks are behind a wall
    agents.forEach(a => {
        if (_isDeskBehindHorizontalWall(a.desk.x, a.desk.y)) {
            _behindWallDesks.push(a);
        } else {
            ctx.save();
            ctx.translate(a.desk.x, a.desk.y);
            a._drawDeskCharItem(ctx);
            ctx.restore();
        }
    });
    _perfEnd('deskItems');

    _perfStart('agents');
    agents.forEach(a => { a.update(); maybeThrowAirplane(a); maybeStartRPS(a); maybeStartSocial(a); maybeStartDarts(a); maybeStartPong(a); _maybePetInteraction(a); if (a._petCooldown > 0) a._petCooldown--; });
    updatePets();
    // Merge agents + pets into one list for proper Y-sorting
    var _allEntities = agents.concat(officePets);
    _allEntities.sort((a, b) => a.y - b.y);
    var _behindWalls = [];
    var _frontWalls = [];
    _allEntities.forEach(function(a) {
        if (_isAgentBehindHorizontalWall(a)) _behindWalls.push(a);
        else _frontWalls.push(a);
    });

    // ─── Draw behind-wall desk char items, then behind-wall agents ───
    // Both render BEFORE wall occluders, so they appear BEHIND the wall face.
    _behindWallDesks.forEach(function(a) {
        ctx.save();
        ctx.translate(a.desk.x, a.desk.y);
        a._drawDeskCharItem(ctx);
        ctx.restore();
    });
    _behindWalls.forEach(function(a) { a.draw(); });
    _perfEnd('agents');

    _perfStart('wallOccluders'); drawInteriorWallOccluders(); _perfEnd('wallOccluders');

    // Redraw vertical walls going down (they must stay on top of horizontal wall occluders)
    var _intWalls = (officeConfig.walls && officeConfig.walls.interior) || [];
    _intWalls.forEach(function(wall, idx) {
        if (wall.x1 === wall.x2 && _verticalWallGoesDown(wall, _intWalls)) {
            _drawSingleWall(wall, idx);
        }
    });

    // ─── Z-ORDER FIX: Only redraw furniture that is IN FRONT of walls ───
    // Furniture behind walls was already drawn in drawEnvironment() and stays
    // behind the wall occluder. Only furniture in front gets redrawn on top.
    officeConfig.furniture.forEach(function(item) {
        if (item.type === 'branchSign' || item.type === 'textLabel') return;
        if (item.type === 'wall' || item.type === 'door') return;
        if (_isFurnitureNearHorizontalWall(item) && _isFurnitureInFrontOfWall(item)) {
            drawFurnitureItem(item);
        }
    });

    // ─── Desk char items for IN-FRONT desks near walls also need redraw ───
    // (They were drawn before occluders, so they got covered by the wall face.
    // Redraw them now so they appear on top of the wall, matching their desk.)
    agents.forEach(function(a) {
        if (_behindWallDesks.indexOf(a) >= 0) return; // skip behind-wall desks
        // Find the furniture item for this desk
        var deskItem = officeConfig.furniture.find(function(f) {
            return (f.type === 'desk' || f.type === 'bossDesk') && f.x === a.desk.x && f.y === a.desk.y;
        });
        if (deskItem && _isFurnitureNearHorizontalWall(deskItem) && _isFurnitureInFrontOfWall(deskItem)) {
            ctx.save();
            ctx.translate(a.desk.x, a.desk.y);
            a._drawDeskCharItem(ctx);
            ctx.restore();
        }
    });

    // Labels on top of walls
    officeConfig.furniture.forEach(function(item) {
        if (item.type === 'branchSign' || item.type === 'textLabel') drawFurnitureItem(item);
    });
    // Ambient overlay AFTER wall occluders + redrawn furniture — everything gets uniform tint
    _perfStart('ambient'); drawAmbientOverlay(); _perfEnd('ambient');
    // Lights/neon drawn after ambient so they glow through darkness
    _perfStart('neon'); drawNeonSigns(); _perfEnd('neon');
    _perfStart('deskLamps'); drawDeskLamps(); _perfEnd('deskLamps');
    _perfStart('deskGlows'); drawDeskLampGlows(); _perfEnd('deskGlows');
    _perfStart('officeLamps'); drawOfficeLamps(); _perfEnd('officeLamps');
    _perfStart('lightGlows'); drawLightGlows(); _perfEnd('lightGlows');
    // Front agents drawn after ambient (they appear in front, un-tinted like before)
    _perfStart('agentsFront'); _frontWalls.forEach(function(a) { a.draw(); }); _perfEnd('agentsFront');
    _perfStart('lampBounce'); drawAgentLampBounce(); _perfEnd('lampBounce');
    _perfStart('airplanes'); updateAirplanes(); drawAirplanes(); _perfEnd('airplanes');
    _perfStart('rps'); updateRPS(); drawRPS(); _perfEnd('rps');
    _perfStart('social'); updateSocialInteractions(); drawSocialInteractions(); _perfEnd('social');
    _perfStart('gatherings'); maybeStartGathering(); updateGatherings(); drawGatherings(); _perfEnd('gatherings');
    _perfStart('darts'); updateDartGames(); drawDartGames(); _perfEnd('darts');
    _perfStart('pong'); updatePongGames(); drawPongGames(); _perfEnd('pong');
    ctx.restore(); // close world clip
    ctx.restore(); // close camera transform

    ctx.save();
    applyCameraTransform();
    _perfStart('chatBubbles'); drawChatBubbles(); _perfEnd('chatBubbles');
    ctx.restore();

    // FPS counter
    _fpsFrames++;
    var _fpsNow = Date.now();
    if (_fpsNow - _fpsLast >= 1000) {
        _fpsDisplay = _fpsFrames;
        _fpsFrames = 0;
        _fpsLast = _fpsNow;
    }
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(8, 8, 52, 18);
    ctx.fillStyle = _fpsDisplay < 30 ? '#f44336' : (_fpsDisplay < 50 ? '#ffc107' : '#4caf50');
    ctx.font = '10px "Press Start 2P"';
    ctx.textAlign = 'left';
    ctx.fillText(_fpsDisplay + ' fps', 12, 21);
    ctx.restore();

    // Draw zoom indicator (screen space, top-right, fades out)
    const zoomAge = Date.now() - _zoomIndicatorTimer;
    if (zoomAge < 2000) {
        const alpha = zoomAge < 1500 ? 0.8 : 0.8 * (1 - (zoomAge - 1500) / 500);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(displayW - 80, 8, 72, 22);
        ctx.fillStyle = '#ffd700';
        ctx.font = '10px "Press Start 2P"';
        ctx.textAlign = 'right';
        ctx.fillText(camera.zoom.toFixed(1) + 'x', displayW - 14, 23);
        ctx.restore();
    }

    // --- EDIT MODE OVERLAY ---
    if (editMode) {
        ctx.save();
        applyCameraTransform();
        drawEditOverlay();
        ctx.restore();

        // Edit mode HUD (screen space)
        drawEditHUD();
    }

    // requestAnimationFrame removed — loop driven by VOBuildingEngine.tick()
}

// ============================================================
// EDIT MODE — Canvas expansion/shrink with grid overlay
// ============================================================

const EDIT_BTN_SIZE = 30;
const EDIT_BTN_MARGIN = 8;
var _editButtons = []; // computed each frame for hit testing

function drawEditOverlay() {
    // Dim everything slightly
    ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
    ctx.fillRect(0, 0, W, H);

    // Grid lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 0.5;
    for (let x = 0; x <= W; x += TILE) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    for (let y = 0; y <= H; y += TILE) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }

    // Canvas boundary (thick highlight)
    ctx.strokeStyle = '#ffd600';
    ctx.lineWidth = 3;
    ctx.strokeRect(0, 0, W, H);

    // Tile highlight on hover with 5 snap zones
    if (editHoverTile) {
        var _htx = editHoverTile.tx * TILE;
        var _hty = editHoverTile.ty * TILE;
        // Yellow tile outline
        ctx.fillStyle = 'rgba(255, 214, 0, 0.15)';
        ctx.fillRect(_htx, _hty, TILE, TILE);
        ctx.strokeStyle = 'rgba(255, 214, 0, 0.4)';
        ctx.lineWidth = 1;
        ctx.strokeRect(_htx, _hty, TILE, TILE);
        // Quadrant divider lines
        ctx.strokeStyle = 'rgba(255, 214, 0, 0.25)';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(_htx + TILE / 2, _hty); ctx.lineTo(_htx + TILE / 2, _hty + TILE);
        ctx.moveTo(_htx, _hty + TILE / 2); ctx.lineTo(_htx + TILE, _hty + TILE / 2);
        ctx.stroke();
        // Zone dots (active zone = green, others = gold)
        for (var _zn in SNAP_ZONES) {
            var _zd = SNAP_ZONES[_zn];
            var _zdx = _htx + _zd.ox * TILE;
            var _zdy = _hty + _zd.oy * TILE;
            var _isActive = _zn === activeSnapZone;
            ctx.fillStyle = _isActive ? 'rgba(0,255,150,0.8)' : 'rgba(255,215,0,0.4)';
            ctx.beginPath();
            ctx.arc(_zdx, _zdy, _isActive ? 4 : 2, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    // --- WALL PLACEMENT GHOST PREVIEW ---
    if (placingType === 'wall') {
        // Show start tile highlight when in phase 1
        if (wallPlacingPhase === 1 && wallPlacingStart) {
            ctx.fillStyle = 'rgba(100, 180, 255, 0.4)';
            ctx.fillRect(wallPlacingStart.tx * TILE, wallPlacingStart.ty * TILE, TILE, TILE);
            // Ghost line to hover
            if (editHoverTile) {
                var _wdx = Math.abs(editHoverTile.tx - wallPlacingStart.tx);
                var _wdy = Math.abs(editHoverTile.ty - wallPlacingStart.ty);
                var _isHoriz = _wdx >= _wdy;
                ctx.strokeStyle = 'rgba(100, 180, 255, 0.7)';
                ctx.lineWidth = 6;
                ctx.setLineDash([4, 4]);
                ctx.beginPath();
                if (_isHoriz) {
                    var _gx1 = Math.min(wallPlacingStart.tx, editHoverTile.tx) * TILE;
                    var _gx2 = Math.max(wallPlacingStart.tx, editHoverTile.tx) * TILE;
                    var _gy = wallPlacingStart.ty * TILE;
                    ctx.moveTo(_gx1, _gy); ctx.lineTo(_gx2, _gy);
                } else {
                    var _gx = wallPlacingStart.tx * TILE;
                    var _gy1 = Math.min(wallPlacingStart.ty, editHoverTile.ty) * TILE;
                    var _gy2 = Math.max(wallPlacingStart.ty, editHoverTile.ty) * TILE;
                    ctx.moveTo(_gx, _gy1); ctx.lineTo(_gx, _gy2);
                }
                ctx.stroke();
                ctx.setLineDash([]);
            }
        }
    }
    // Show selected wall with yellow dashed outline (extra thick)
    if (selectedWallIdx !== null && officeConfig.walls.interior && officeConfig.walls.interior[selectedWallIdx]) {
        var _sw = officeConfig.walls.interior[selectedWallIdx];
        ctx.setLineDash([6, 3]);
        ctx.strokeStyle = '#ffd600';
        ctx.lineWidth = 3;
        if (_sw.x1 === _sw.x2) {
            var _spx = _sw.x1 * TILE - 3;
            var _spy = Math.min(_sw.y1, _sw.y2) * TILE - 3;
            ctx.strokeRect(_spx, _spy, 12, Math.abs(_sw.y2 - _sw.y1) * TILE + 6);
        } else {
            var _spx = Math.min(_sw.x1, _sw.x2) * TILE - 3;
            var _spy = _sw.y1 * TILE - 3;
            ctx.strokeRect(_spx, _spy, Math.abs(_sw.x2 - _sw.x1) * TILE + 6, 12);
        }
        ctx.setLineDash([]);
    }

    // --- EXPAND/SHRINK BUTTONS (drawn in world space at edges) ---
    _editButtons = [];
    var bS = EDIT_BTN_SIZE;

    // RIGHT edge: + to expand right, - to shrink
    _drawEditBtn(W + EDIT_BTN_MARGIN, H / 2 - bS - 4, bS, '+', 'right', 'expand');
    _drawEditBtn(W + EDIT_BTN_MARGIN, H / 2 + 4, bS, '−', 'right', 'shrink');

    // BOTTOM edge: + to expand down, - to shrink
    _drawEditBtn(W / 2 - bS - 4, H + EDIT_BTN_MARGIN, bS, '+', 'bottom', 'expand');
    _drawEditBtn(W / 2 + 4, H + EDIT_BTN_MARGIN, bS, '−', 'bottom', 'shrink');

    // LEFT and TOP expansion disabled — shifts break agent positions

    // Size label near bottom-right
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(W - 120, H + 8, 120, 22);
    ctx.fillStyle = '#ffd600';
    ctx.font = 'bold 10px "Press Start 2P"';
    ctx.textAlign = 'center';
    ctx.fillText(Math.round(W / TILE) + ' × ' + Math.round(H / TILE) + ' tiles', W - 60, H + 23);

    // --- GHOST PREVIEW ---
    if (placingType && _ghostPos) {
        // Snap kitchen appliances to counter tops for ghost preview
        if (COUNTER_ONLY_ITEMS.indexOf(placingType) >= 0) {
            var snapped = _snapToCounterTop(placingType, _ghostPos.x, _ghostPos.y);
            if (snapped) { _ghostPos.x = snapped.x; _ghostPos.y = snapped.y; }
        }
        _placementValid = _isValidPlacement(placingType, _ghostPos.x, _ghostPos.y);
        // Build ghost item — carry rotation from the source item when dragging
        var ghostItem = { type: placingType, x: _ghostPos.x, y: _ghostPos.y };
        if (isDragging && selectedItemId) {
            var _dragSrc = officeConfig.furniture.find(function(f){ return f.id === selectedItemId; });
            if (_dragSrc && _dragSrc.rotation) ghostItem.rotation = _dragSrc.rotation;
            if (_dragSrc && _dragSrc.couchColor) ghostItem.couchColor = _dragSrc.couchColor;
        }
        var _ghostWR = _getItemWorldRect(ghostItem);
        var _visX = _ghostWR.x;
        var _visY = _ghostWR.y;
        var _visW = _ghostWR.w;
        var _visH = _ghostWR.h;

        // Highlight ALL tiles the item's visual area covers
        var _gStartTX = Math.max(0, Math.floor(_visX / TILE));
        var _gStartTY = Math.max(0, Math.floor(_visY / TILE));
        var _gEndTX = Math.floor((_visX + _visW - 1) / TILE);
        var _gEndTY = Math.floor((_visY + _visH - 1) / TILE);
        ctx.fillStyle = _placementValid ? 'rgba(0, 255, 150, 0.18)' : 'rgba(244, 67, 54, 0.15)';
        ctx.strokeStyle = _placementValid ? 'rgba(0, 255, 150, 0.5)' : 'rgba(244, 67, 54, 0.5)';
        ctx.lineWidth = 1.5;
        for (var _gtx = _gStartTX; _gtx <= _gEndTX; _gtx++) {
            for (var _gty = _gStartTY; _gty <= _gEndTY; _gty++) {
                ctx.fillRect(_gtx * TILE, _gty * TILE, TILE, TILE);
                ctx.strokeRect(_gtx * TILE, _gty * TILE, TILE, TILE);
            }
        }

        // Draw ghost item
        ctx.globalAlpha = _placementValid ? 0.5 : 0.3;
        drawFurnitureItem(ghostItem);
        ctx.globalAlpha = 1;

        // Bounding box outline around visual area
        ctx.setLineDash([]);
        ctx.strokeStyle = _placementValid ? '#00e676' : '#f44336';
        ctx.lineWidth = 2;
        ctx.strokeRect(_visX, _visY, _visW, _visH);

        // Show red X if invalid
        if (!_placementValid) {
            ctx.fillStyle = 'rgba(244, 67, 54, 0.6)';
            ctx.fillRect(_visX, _visY, _visW, _visH);
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 14px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('✕', _visX + _visW / 2, _visY + _visH / 2 + 5);
        }
    }

    // --- SELECTION HIGHLIGHT (all occupied tiles + bounding box) ---
    if (selectedItemId) {
        var selItem = null;
        for (var _si = 0; _si < officeConfig.furniture.length; _si++) {
            if (officeConfig.furniture[_si].id === selectedItemId) { selItem = officeConfig.furniture[_si]; break; }
        }
        if (selItem) {
            var _selWR = _getItemWorldRect(selItem);
            // Highlight ALL tiles
            var _sTX1 = Math.max(0, Math.floor(_selWR.x / TILE));
            var _sTY1 = Math.max(0, Math.floor(_selWR.y / TILE));
            var _sTX2 = Math.floor((_selWR.x + _selWR.w - 1) / TILE);
            var _sTY2 = Math.floor((_selWR.y + _selWR.h - 1) / TILE);
            ctx.fillStyle = 'rgba(255, 214, 0, 0.1)';
            ctx.strokeStyle = 'rgba(255, 214, 0, 0.4)';
            ctx.lineWidth = 1;
            for (var _stx = _sTX1; _stx <= _sTX2; _stx++) {
                for (var _sty = _sTY1; _sty <= _sTY2; _sty++) {
                    ctx.fillRect(_stx * TILE, _sty * TILE, TILE, TILE);
                    ctx.strokeRect(_stx * TILE, _sty * TILE, TILE, TILE);
                }
            }
            // Dashed bounding box around visual area
            ctx.setLineDash([5, 3]);
            ctx.strokeStyle = '#ffd600';
            ctx.lineWidth = 2;
            ctx.strokeRect(_selWR.x - 3, _selWR.y - 3, _selWR.w + 6, _selWR.h + 6);
            ctx.setLineDash([]);
        }
    }

    // --- MULTI-SELECT highlights ---
    _multiSelected.forEach(function(fid) {
        var fi = null;
        for (var _mi = 0; _mi < officeConfig.furniture.length; _mi++) {
            if (officeConfig.furniture[_mi].id === fid) { fi = officeConfig.furniture[_mi]; break; }
        }
        if (!fi) return;
        var fb = FURNITURE_BOUNDS[fi.type] || { w: TILE, h: TILE, ox: 0, oy: 0 };
        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = '#00e5ff';
        ctx.lineWidth = 2;
        var _mox = fb.ox || 0, _moy = fb.oy || 0;
        ctx.strokeRect(fi.x - _mox * fb.w - 2, fi.y - _moy * fb.h - 2, fb.w + 4, fb.h + 4);
        ctx.setLineDash([]);
    });

    // --- MARQUEE RECT ---
    if (_marqueeStart && _marqueeEnd) {
        var mx = Math.min(_marqueeStart.x, _marqueeEnd.x);
        var my = Math.min(_marqueeStart.y, _marqueeEnd.y);
        var mw = Math.abs(_marqueeEnd.x - _marqueeStart.x);
        var mh = Math.abs(_marqueeEnd.y - _marqueeStart.y);
        ctx.fillStyle = 'rgba(0, 229, 255, 0.08)';
        ctx.fillRect(mx, my, mw, mh);
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = 'rgba(0, 229, 255, 0.6)';
        ctx.lineWidth = 1;
        ctx.strokeRect(mx, my, mw, mh);
        ctx.setLineDash([]);
    }

    // --- DRAG TILE HIGHLIGHT (shows target tile during drag) ---
    if (_editDragTileHighlight) {
        var dth = _editDragTileHighlight;
        if (dth.valid) {
            // Green glow for valid position
            ctx.fillStyle = 'rgba(76, 175, 80, 0.15)';
            ctx.fillRect(dth.x, dth.y, dth.w, dth.h);
            ctx.strokeStyle = 'rgba(76, 175, 80, 0.6)';
            ctx.lineWidth = 2;
            ctx.strokeRect(dth.x, dth.y, dth.w, dth.h);
            // Draw half-tile grid within the highlight area
            ctx.lineWidth = 1;
            for (var _thx = dth.x + HALF_TILE; _thx < dth.x + dth.w; _thx += HALF_TILE) {
                ctx.strokeStyle = (_thx - dth.x) % TILE === 0 ? 'rgba(76, 175, 80, 0.3)' : 'rgba(76, 175, 80, 0.15)';
                ctx.beginPath(); ctx.moveTo(_thx, dth.y); ctx.lineTo(_thx, dth.y + dth.h); ctx.stroke();
            }
            for (var _thy = dth.y + HALF_TILE; _thy < dth.y + dth.h; _thy += HALF_TILE) {
                ctx.strokeStyle = (_thy - dth.y) % TILE === 0 ? 'rgba(76, 175, 80, 0.3)' : 'rgba(76, 175, 80, 0.15)';
                ctx.beginPath(); ctx.moveTo(dth.x, _thy); ctx.lineTo(dth.x + dth.w, _thy); ctx.stroke();
            }
        } else {
            // Red glow for invalid position
            ctx.fillStyle = 'rgba(244, 67, 54, 0.12)';
            ctx.fillRect(dth.x, dth.y, dth.w, dth.h);
            ctx.strokeStyle = 'rgba(244, 67, 54, 0.5)';
            ctx.lineWidth = 2;
            ctx.strokeRect(dth.x, dth.y, dth.w, dth.h);
        }
    }
}

function _drawEditBtn(x, y, size, label, edge, action) {
    var isExpand = action === 'expand';
    var canShrink = (edge === 'left' || edge === 'right') ? (W / TILE > MIN_TILES_X) : (H / TILE > MIN_TILES_Y);

    if (!isExpand && !canShrink) {
        // Draw disabled button
        ctx.fillStyle = 'rgba(60, 60, 60, 0.5)';
        ctx.fillRect(x, y, size, size);
        ctx.fillStyle = 'rgba(150, 150, 150, 0.4)';
        ctx.font = 'bold 16px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(label, x + size / 2, y + size / 2 + 6);
        return;
    }

    // Active button
    ctx.fillStyle = isExpand ? 'rgba(76, 175, 80, 0.85)' : 'rgba(244, 67, 54, 0.85)';
    ctx.fillRect(x, y, size, size);

    // Border
    ctx.strokeStyle = isExpand ? '#66bb6a' : '#ef5350';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, size, size);

    // Label
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 18px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(label, x + size / 2, y + size / 2 + 7);

    // Store for hit testing
    _editButtons.push({ x: x, y: y, w: size, h: size, edge: edge, action: action });
}

function drawEditHUD() {
    // Top bar with edit mode indicator
    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
    ctx.fillRect(displayW / 2 - 140, 6, 280, 28);
    ctx.strokeStyle = '#ffd600';
    ctx.lineWidth = 1;
    ctx.strokeRect(displayW / 2 - 140, 6, 280, 28);
    ctx.fillStyle = '#ffd600';
    ctx.font = 'bold 10px "Press Start 2P"';
    ctx.textAlign = 'center';
    var hudText;
    if (placingType === 'wall') {
        hudText = wallPlacingPhase === 0 ? '🧱 WALL — Click start tile' : '🧱 WALL — Click end tile (Esc cancel)';
    } else if (placingType === 'door') {
        hudText = '🚪 DOOR — Click wall tile to add opening (Esc cancel)';
    } else if (placingType) {
        hudText = '📦 PLACING: ' + placingType.toUpperCase() + ' — Esc cancel';
    } else {
        hudText = '✏️ EDIT MODE — ' + Math.round(W / TILE) + '×' + Math.round(H / TILE);
    }
    ctx.fillText(hudText, displayW / 2, 24);
    ctx.restore();

    // Update floating toolbar position every frame
    _updateFloatingToolbarPosition();

    // Tile coord on hover (screen space, bottom-left)
    if (editHoverTile) {
        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(8, displayH - 28, 90, 20);
        ctx.fillStyle = '#ccc';
        ctx.font = '9px "Press Start 2P"';
        ctx.textAlign = 'left';
        ctx.fillText('(' + editHoverTile.tx + ',' + editHoverTile.ty + ')', 14, displayH - 14);
        ctx.restore();
    }
}

function expandCanvas(edge) {
    // Only allow expanding right and bottom (top/left shifts break agent positions)
    if (edge === 'left' || edge === 'top') return;
    _pushUndo();
    if (edge === 'right') {
        W += TILE;
    } else if (edge === 'bottom') {
        H += TILE;
    }
    saveOfficeConfig();
}

function shrinkCanvas(edge) {
    if (edge === 'left' || edge === 'top') return;
    _pushUndo();
    if (edge === 'right' && W / TILE > MIN_TILES_X) {
        W -= TILE;
    } else if (edge === 'bottom' && H / TILE > MIN_TILES_Y) {
        H -= TILE;
    }
    saveOfficeConfig();
}

function _shiftAllPositions(dx, dy) {
    // Shift all agent positions and targets
    agents.forEach(function(a) {
        a.x += dx; a.y += dy;
        a.targetX += dx; a.targetY += dy;
        if (a.desk) { a.desk.x += dx; a.desk.y += dy; }
    });
    // Shift LOCATIONS
    LOCATIONS.pqDesks.forEach(function(d) { d.x += dx; d.y += dy; });
    LOCATIONS.engDesks.forEach(function(d) { d.x += dx; d.y += dy; });
    LOCATIONS.bossDesk.x += dx; LOCATIONS.bossDesk.y += dy;
    LOCATIONS.centerDesk.x += dx; LOCATIONS.centerDesk.y += dy;
    LOCATIONS.centerDesk2.x += dx; LOCATIONS.centerDesk2.y += dy;
    LOCATIONS.centerDesk3.x += dx; LOCATIONS.centerDesk3.y += dy;
    if (LOCATIONS.forgeDesk) { LOCATIONS.forgeDesk.x += dx; LOCATIONS.forgeDesk.y += dy; }
    LOCATIONS.meeting.x += dx; LOCATIONS.meeting.y += dy;
    LOCATIONS.lounge.x += dx; LOCATIONS.lounge.y += dy;
    LOCATIONS.cooler.x += dx; LOCATIONS.cooler.y += dy;
    LOCATIONS.wanderSpots.forEach(function(s) { s.x += dx; s.y += dy; });
    var inter = LOCATIONS.interactions;
    inter.windows.forEach(function(w) { w.x += dx; w.y += dy; });
    inter.couchSeats.forEach(function(s) { s.x += dx; s.y += dy; });
    if (inter.bookshelf)     { inter.bookshelf.x     += dx; inter.bookshelf.y     += dy; }
    if (inter.tvSpot)        { inter.tvSpot.x         += dx; inter.tvSpot.y         += dy; }
    if (inter.vendingMachine){ inter.vendingMachine.x += dx; inter.vendingMachine.y += dy; }
    if (inter.coffeeMaker)   { inter.coffeeMaker.x    += dx; inter.coffeeMaker.y    += dy; }
    if (inter.waterCooler)   { inter.waterCooler.x    += dx; inter.waterCooler.y    += dy; }
    if (inter.microwave)     { inter.microwave.x      += dx; inter.microwave.y      += dy; }
    if (inter.toaster)       { inter.toaster.x        += dx; inter.toaster.y        += dy; }
    if (inter.dartBoard)     { inter.dartBoard.x      += dx; inter.dartBoard.y      += dy; }
    if (inter.diningSeats)   { inter.diningSeats.forEach(function(s) { s.x += dx; s.y += dy; }); }
    inter.engCouchSeats.forEach(function(s) { s.x += dx; s.y += dy; });
    // Re-derive meeting slots from the (now shifted) meeting table furniture position
    MEETING_SLOTS = getMeetingSlots();
    // Shift officeConfig furniture items to stay in sync
    officeConfig.furniture.forEach(function(item) { item.x += dx; item.y += dy; });
    // Re-sync interaction spots from shifted furniture
    getInteractionSpots();
}

// --- COLLISION DETECTION ---
// Get visual top-left from draw position + bounds
function _visualTopLeft(type, x, y) {
    var b = FURNITURE_BOUNDS[type] || { w: TILE, h: TILE, ox: 0, oy: 0 };
    return { x: x - (b.ox || 0) * b.w, y: y - (b.oy || 0) * b.h, w: b.w, h: b.h };
}

function _itemOverlaps(type, x, y, excludeId) {
    var b1 = FURNITURE_BOUNDS[type] || { w: TILE, h: TILE };
    // Items with noCollision never block or get blocked
    if (b1.noCollision) return false;
    var v1 = _visualTopLeft(type, x, y);
    for (var i = 0; i < officeConfig.furniture.length; i++) {
        var item = officeConfig.furniture[i];
        if (excludeId && item.id === excludeId) continue;
        var b2 = FURNITURE_BOUNDS[item.type] || { w: TILE, h: TILE };
        if (b2.noCollision) continue; // skip non-blocking items
        // Use rotation-aware world rect for placed items
        var v2 = _getItemWorldRect(item);
        if (v1.x < v2.x + v2.w && v1.x + v1.w > v2.x &&
            v1.y < v2.y + v2.h && v1.y + v1.h > v2.y) {
            return true;
        }
    }
    return false;
}

// --- SYNC AGENT DESK ASSIGNMENTS ---
// When a desk has an assignedTo, move that agent's desk reference to this furniture item's position
function _syncAgentToDesk(deskItem) {
    if (!deskItem.assignedTo) return;
    for (var i = 0; i < agents.length; i++) {
        if (agents[i].name === deskItem.assignedTo) {
            var agent = agents[i];
            // Update the agent's desk position
            if (agent.desk.x !== deskItem.x || agent.desk.y !== deskItem.y) {
                agent.desk = { x: deskItem.x, y: deskItem.y };
                // If agent is idle at their old desk, move them to new one
                if (agent.state === 'idle' || agent.state === 'working') {
                    agent.targetX = deskItem.x;
                    agent.targetY = deskItem.y;
                }
            }
            break;
        }
    }
}

// Run desk sync on config load and after any furniture change
function _syncAllDeskAssignments() {
    officeConfig.furniture.forEach(function(item) {
        if (item.assignedTo && (item.type === 'desk' || item.type === 'bossDesk')) {
            _syncAgentToDesk(item);
        }
    });
}

// Kitchen appliance types that must be placed on counters
var COUNTER_ONLY_ITEMS = ['coffeeMaker', 'microwave', 'toaster'];

// Check if a position sits on top of a kitchen counter
function _isOnCounter(type, x, y) {
    var itemB = FURNITURE_BOUNDS[type] || { w: TILE, h: TILE };
    for (var i = 0; i < officeConfig.furniture.length; i++) {
        var f = officeConfig.furniture[i];
        if (f.type !== 'kitchenCounter') continue;
        var cb = FURNITURE_BOUNDS['kitchenCounter']; // w:72, h:34
        // Appliance must be within counter's horizontal span
        // and at the snapped Y position (counter.y - itemHeight + 2, with tolerance)
        var expectedY = f.y - itemB.h + 2;
        if (x >= f.x - 2 && x + itemB.w <= f.x + cb.w + 2 &&
            Math.abs(y - expectedY) < 8) {
            return true;
        }
    }
    // Also check breakArea items (they have built-in counters)
    for (var j = 0; j < officeConfig.furniture.length; j++) {
        var ba = officeConfig.furniture[j];
        if (ba.type !== 'breakArea') continue;
        var counters = [
            { x: ba.x + 80, y: ba.y + 78, w: 72 },
            { x: ba.x + 170, y: ba.y + 78, w: 72 }
        ];
        for (var c = 0; c < counters.length; c++) {
            var ct = counters[c];
            var expectedY2 = ct.y - itemB.h + 2;
            if (x >= ct.x - 2 && x + itemB.w <= ct.x + ct.w + 2 &&
                Math.abs(y - expectedY2) < 8) {
                return true;
            }
        }
    }
    return false;
}

// Snap a kitchen appliance to the nearest counter top surface
function _snapToCounterTop(type, worldX, worldY) {
    var itemB = FURNITURE_BOUNDS[type] || { w: TILE, h: TILE };
    var best = null;
    var bestDist = 999999;

    // Check standalone kitchen counters
    for (var i = 0; i < officeConfig.furniture.length; i++) {
        var f = officeConfig.furniture[i];
        if (f.type !== 'kitchenCounter') continue;
        var cb = FURNITURE_BOUNDS['kitchenCounter']; // w:72, h:34
        // Appliance sits on counter surface: Y = counter.y - itemHeight (on top)
        var snapY = f.y - itemB.h + 2; // +2 so it visually rests on surface
        var snapX = Math.round((worldX - f.x) / 4) * 4 + f.x; // fine snap within counter
        snapX = Math.max(f.x, Math.min(f.x + cb.w - itemB.w, snapX)); // clamp to counter width
        var dist = Math.abs(worldX - snapX) + Math.abs(worldY - snapY);
        if (dist < bestDist) { bestDist = dist; best = { x: snapX, y: snapY }; }
    }

    // Check breakArea built-in counters
    for (var j = 0; j < officeConfig.furniture.length; j++) {
        var ba = officeConfig.furniture[j];
        if (ba.type !== 'breakArea') continue;
        var counters = [
            { x: ba.x + 80, y: ba.y + 78, w: 72 },
            { x: ba.x + 170, y: ba.y + 78, w: 72 }
        ];
        for (var c = 0; c < counters.length; c++) {
            var ct = counters[c];
            var snapY2 = ct.y - itemB.h + 2;
            var snapX2 = Math.round((worldX - ct.x) / 4) * 4 + ct.x;
            snapX2 = Math.max(ct.x, Math.min(ct.x + ct.w - itemB.w, snapX2));
            var dist2 = Math.abs(worldX - snapX2) + Math.abs(worldY - snapY2);
            if (dist2 < bestDist) { bestDist = dist2; best = { x: snapX2, y: snapY2 }; }
        }
    }

    // Only snap if reasonably close (within 120px)
    if (best && bestDist < 120) return best;
    return null;
}

// Check if a position is valid for a given furniture type
function _isValidPlacement(type, x, y) {
    // Windows can only be placed on the top wall
    if (type === 'window' || type === 'interactiveWindow') {
        var wallH = officeConfig.walls.height || 70;
        if (y > wallH - 10 || y < 0) return false;
        if (x < 0 || x + (FURNITURE_BOUNDS[type] || {w:40}).w > W) return false;
    }
    // Kitchen appliances can only be placed on kitchen counters
    if (COUNTER_ONLY_ITEMS.indexOf(type) >= 0) {
        if (!_isOnCounter(type, x, y)) return false;
        // Skip overlap check for counter items — they sit ON the counter
        return true;
    }
    // General: visual area must be within canvas bounds
    var _vp = _visualTopLeft(type, x, y);
    if (_vp.x < 0 || _vp.y < 0 || _vp.x + _vp.w > W || _vp.y + _vp.h > H) return false;
    // Check overlap
    if (_itemOverlaps(type, x, y, null)) return false;
    return true;
}

var _placementValid = true; // updated each frame for ghost preview color

// --- EDIT MODE CLICK HANDLING ---
function handleEditClick(worldX, worldY, screenX, screenY, event) {
    // 1. If in placement mode → place item
    if (placingType === 'wall') {
        var _clickTx = Math.floor(worldX / TILE);
        var _clickTy = Math.floor(worldY / TILE);
        if (wallPlacingPhase === 0) {
            wallPlacingStart = { tx: _clickTx, ty: _clickTy };
            wallPlacingPhase = 1;
        } else {
            // Second click - create wall
            var _x1 = wallPlacingStart.tx, _y1 = wallPlacingStart.ty;
            var _x2 = _clickTx, _y2 = _clickTy;
            var _wdx = Math.abs(_x2 - _x1), _wdy = Math.abs(_y2 - _y1);
            if (_wdx > 0 || _wdy > 0) {
                var newWall;
                if (_wdx >= _wdy) {
                    // Horizontal: snap to same Y as start
                    newWall = { x1: Math.min(_x1, _x2), y1: _y1, x2: Math.max(_x1, _x2), y2: _y1, color: '#5d6271', accentColor: '#5d6271', trimColor: '#d2d4da', trim2Color: '#989ca8' };
                } else {
                    // Vertical: snap to same X as start
                    newWall = { x1: _x1, y1: Math.min(_y1, _y2), x2: _x1, y2: Math.max(_y1, _y2), color: '#5d6271', accentColor: '#5d6271', trimColor: '#d2d4da', trim2Color: '#989ca8' };
                }
                _pushUndo();
                if (!officeConfig.walls.interior) officeConfig.walls.interior = [];
                officeConfig.walls.interior.push(newWall);
                buildCollisionGrid();
            }
            wallPlacingPhase = 0;
            wallPlacingStart = null;
        }
        return true;
    }
    if (placingType === 'door') {
        // Click on a wall to add a door (1-tile gap)
        var _dTx = Math.floor(worldX / TILE);
        var _dTy = Math.floor(worldY / TILE);
        var interior = officeConfig.walls.interior || [];
        for (var _di = 0; _di < interior.length; _di++) {
            var _dw = interior[_di];
            if (_dw.x1 === _dw.x2) {
                // Vertical wall - check if click tile row is within it
                var _minY = Math.min(_dw.y1, _dw.y2), _maxY = Math.max(_dw.y1, _dw.y2);
                if (_dTx === _dw.x1 && _dTy >= _minY && _dTy < _maxY) {
                    _pushUndo();
                    officeConfig.walls.interior.splice(_di, 1);
                    // Add two segments split by 1-tile door
                    if (_dTy > _minY) officeConfig.walls.interior.push({ x1: _dw.x1, y1: _minY, x2: _dw.x1, y2: _dTy, color: _dw.color, accentColor: _dw.accentColor, trimColor: _dw.trimColor, trim2Color: _dw.trim2Color });
                    if (_dTy + 1 < _maxY) officeConfig.walls.interior.push({ x1: _dw.x1, y1: _dTy + 1, x2: _dw.x1, y2: _maxY, color: _dw.color, accentColor: _dw.accentColor, trimColor: _dw.trimColor, trim2Color: _dw.trim2Color });
                    buildCollisionGrid();
                    break;
                }
            } else {
                // Horizontal wall
                var _minX = Math.min(_dw.x1, _dw.x2), _maxX = Math.max(_dw.x1, _dw.x2);
                if (_dTy === _dw.y1 && _dTx >= _minX && _dTx < _maxX) {
                    _pushUndo();
                    officeConfig.walls.interior.splice(_di, 1);
                    if (_dTx > _minX) officeConfig.walls.interior.push({ x1: _minX, y1: _dw.y1, x2: _dTx, y2: _dw.y1, color: _dw.color, accentColor: _dw.accentColor, trimColor: _dw.trimColor, trim2Color: _dw.trim2Color });
                    if (_dTx + 1 < _maxX) officeConfig.walls.interior.push({ x1: _dTx + 1, y1: _dw.y1, x2: _maxX, y2: _dw.y1, color: _dw.color, accentColor: _dw.accentColor, trimColor: _dw.trimColor, trim2Color: _dw.trim2Color });
                    buildCollisionGrid();
                    break;
                }
            }
        }
        return true;
    }
    if (placingType) {
        // Check if clicking near a zone dot — switch zone instead of placing
        var _clickTX = Math.floor(worldX / TILE);
        var _clickTY = Math.floor(worldY / TILE);
        for (var _czName in SNAP_ZONES) {
            var _cz = SNAP_ZONES[_czName];
            var _czX = _clickTX * TILE + _cz.ox * TILE;
            var _czY = _clickTY * TILE + _cz.oy * TILE;
            var _czDist = Math.sqrt((worldX - _czX) * (worldX - _czX) + (worldY - _czY) * (worldY - _czY));
            if (_czDist < 10 && _czName !== activeSnapZone) {
                activeSnapZone = _czName;
                var _snapSel = _voNullElement('snap-zone-select');
                if (_snapSel) _snapSel.value = activeSnapZone;
                return true; // consumed click, don't place
            }
        }
        // Snap to active zone center within the hovered tile (origin-aware)
        var _placeZone = SNAP_ZONES[activeSnapZone] || SNAP_ZONES['center'];
        var _placeTX = Math.floor(worldX / TILE);
        var _placeTY = Math.floor(worldY / TILE);
        var _placeZCX = _placeTX * TILE + _placeZone.ox * TILE;
        var _placeZCY = _placeTY * TILE + _placeZone.oy * TILE;
        var _placeBounds = FURNITURE_BOUNDS[placingType] || { w: TILE, h: TILE, ox: 0, oy: 0 };
        var _pox = _placeBounds.ox || 0;
        var _poy = _placeBounds.oy || 0;
        var sx = Math.round(_placeZCX - (0.5 - _pox) * _placeBounds.w);
        var sy = Math.round(_placeZCY - (0.5 - _poy) * _placeBounds.h);
        // Kitchen appliances: snap to counter top surface
        if (COUNTER_ONLY_ITEMS.indexOf(placingType) >= 0) {
            var snapped = _snapToCounterTop(placingType, worldX, worldY);
            if (!snapped) return true; // no valid counter nearby
            sx = snapped.x;
            sy = snapped.y;
        }
        // Validate placement
        if (!_isValidPlacement(placingType, sx, sy)) return true; // block but stay in placement mode
        var newItem = { id: _generateFurnitureId(), type: placingType, x: sx, y: sy };
        // Custom text label — prompt for text on placement
        if (placingType === 'textLabel') {
            var labelText = prompt('Enter label text:', 'Label');
            if (!labelText) return true; // cancelled
            newItem.text = labelText;
            newItem.labelColor = '#ffffff';
            newItem.fontSize = 12;
        }
        _pushUndo();
        officeConfig.furniture.push(newItem);
        getInteractionSpots();
        return true;
    }

    // 2. Check expand/shrink buttons
    for (var i = 0; i < _editButtons.length; i++) {
        var b = _editButtons[i];
        if (worldX >= b.x && worldX <= b.x + b.w && worldY >= b.y && worldY <= b.y + b.h) {
            if (b.action === 'expand') expandCanvas(b.edge);
            else shrinkCanvas(b.edge);
            return true;
        }
    }

    // 3. Hit-test furniture — skip if mousedown already handled it (drag)
    var hit = _findFurnitureAt(worldX, worldY);
    if (hit) {
        // Meeting table click → open dashboard (only outside edit mode)
        if (_meetingTableClickCheck(hit)) return true;
        // Furniture selection is handled by mousedown now.
        // Only reach here if it was a quick click (no drag).
        // Selection was already set in mousedown, just return.
        return true;
    }

    // 3d. Hit-test interior walls for selection
    var _hitWallIdx = _findWallAt(worldX, worldY);
    if (_hitWallIdx >= 0) {
        selectedWallIdx = _hitWallIdx;
        selectedItemId = null;
        _multiSelected = [];
        _hideColorPicker();
        return true;
    }

    // 4. Click on floor → floor color picker (only in floor edit mode)
    var wallH = officeConfig.walls.height;
    if (_floorEditMode && worldY >= wallH && worldY < H && worldX >= 0 && worldX < W) {
        _showFloorColorPicker(screenX || 200, screenY || 200);
        return true;
    }

    // 5. Click top wall → top wall color picker
    if (worldY >= 0 && worldY < wallH && worldX >= 0 && worldX < W) {
        _showTopWallColorPicker(screenX || 200, screenY || 60);
        return true;
    }

    // 6. Empty space click — selection clearing handled by mousedown
    return false;
}

// Get effective width/height for an item, accounting for rotation
function _getRotatedBounds(item) {
    var b = FURNITURE_BOUNDS[item.type] || { w: TILE, h: TILE, ox: 0, oy: 0 };
    var rot = item.rotation || 0;
    if (rot === 90 || rot === 270) return { w: b.h, h: b.w, ox: b.oy, oy: b.ox };
    return b;
}

// Get the world-space bounding rect for a possibly-rotated item.
// Accounts for origin offsets (ox/oy) and rotation.
// Drawing uses translate(x,y) then rotate(rot), where (x,y) is the origin
// point defined by (ox,oy) as a fraction of (w,h).
function _getItemWorldRect(item) {
    var b = FURNITURE_BOUNDS[item.type] || { w: TILE, h: TILE, ox: 0, oy: 0 };
    var rot = item.rotation || 0;
    var w = b.w, h = b.h;
    var ox = b.ox || 0, oy = b.oy || 0;
    var ix = item.x, iy = item.y;
    // Visual top-left without rotation
    var vlx = ix - ox * w;
    var vly = iy - oy * h;
    if (!rot) return { x: vlx, y: vly, w: w, h: h };
    // With rotation: the origin (ix,iy) is the pivot.
    // Local corners relative to origin: (-ox*w, -oy*h) to ((1-ox)*w, (1-oy)*h)
    // After rotation, find the new bounding box
    var lx0 = -ox * w, ly0 = -oy * h;
    var lx1 = (1 - ox) * w, ly1 = (1 - oy) * h;
    var corners = [[lx0,ly0],[lx1,ly0],[lx1,ly1],[lx0,ly1]];
    var cosR = Math.round(Math.cos(rot * Math.PI / 180));
    var sinR = Math.round(Math.sin(rot * Math.PI / 180));
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (var ci = 0; ci < 4; ci++) {
        var rx = corners[ci][0] * cosR - corners[ci][1] * sinR;
        var ry = corners[ci][0] * sinR + corners[ci][1] * cosR;
        if (rx < minX) minX = rx;
        if (ry < minY) minY = ry;
        if (rx > maxX) maxX = rx;
        if (ry > maxY) maxY = ry;
    }
    return { x: ix + minX, y: iy + minY, w: maxX - minX, h: maxY - minY };
}

function _findFurnitureAt(wx, wy) {
    // Search in reverse so top-drawn items get priority
    for (var i = officeConfig.furniture.length - 1; i >= 0; i--) {
        var item = officeConfig.furniture[i];
        var r = _getItemWorldRect(item);
        if (wx >= r.x && wx <= r.x + r.w && wy >= r.y && wy <= r.y + r.h) {
            return item;
        }
    }
    return null;
}

function _findWallAt(wx, wy) {
    var interior = officeConfig.walls && officeConfig.walls.interior;
    if (!interior) return -1;
    var thresh = 8; // pixels
    for (var i = 0; i < interior.length; i++) {
        var wall = interior[i];
        if (wall.x1 === wall.x2) {
            // Vertical wall
            var wallPx = wall.x1 * TILE;
            var minPy = Math.min(wall.y1, wall.y2) * TILE;
            var maxPy = Math.max(wall.y1, wall.y2) * TILE;
            if (Math.abs(wx - wallPx) < thresh && wy >= minPy && wy <= maxPy) return i;
        } else {
            // Horizontal wall
            var wallPy = wall.y1 * TILE;
            var minPx = Math.min(wall.x1, wall.x2) * TILE;
            var maxPx = Math.max(wall.x1, wall.x2) * TILE;
            if (Math.abs(wy - wallPy) < thresh && wx >= minPx && wx <= maxPx) return i;
        }
    }
    return -1;
}

function _generateFurnitureId() {
    return 'f_' + Date.now() + '_' + Math.floor(Math.random() * 9999);
}

function _updateFloatingToolbarPosition() {
    if (!_floatingToolbar) return;

    // Show toolbar for selected wall
    if (selectedWallIdx !== null && officeConfig.walls.interior && officeConfig.walls.interior[selectedWallIdx]) {
        var _sw = officeConfig.walls.interior[selectedWallIdx];
        var base = getBaseScale();
        var totalZoom = base * camera.zoom;
        var rect = canvas.getBoundingClientRect();
        var wx, wy;
        if (_sw.x1 === _sw.x2) {
            wx = _sw.x1 * TILE;
            wy = (Math.min(_sw.y1, _sw.y2) * TILE + Math.max(_sw.y1, _sw.y2) * TILE) / 2;
        } else {
            wx = (Math.min(_sw.x1, _sw.x2) * TILE + Math.max(_sw.x1, _sw.x2) * TILE) / 2;
            wy = _sw.y1 * TILE;
        }
        var dx = (wx - W / 2 - camera.x) * totalZoom + displayW / 2;
        var dy = (wy - H / 2 - camera.y) * totalZoom + displayH / 2;
        var sx = dx * (rect.width / displayW) + rect.left;
        var sy = dy * (rect.height / displayH) + rect.top;
        _floatingToolbar.style.display = 'flex';
        _floatingToolbar.style.left = (sx - 30) + 'px';
        _floatingToolbar.style.top = (sy - 46) + 'px';
        // Wall toolbar: delete + color + close only
        var assignBtn = _voNullElement('ftb-assign-btn');
        var branchBtn = _voNullElement('ftb-branch-btn');
        var colorBtn = _voNullElement('ftb-color-btn');
        if (assignBtn) assignBtn.style.display = 'none';
        if (branchBtn) branchBtn.style.display = 'none';
        if (colorBtn) colorBtn.style.display = '';
        return;
    }

    if (!selectedItemId) { _floatingToolbar.style.display = 'none'; return; }
    var selItem = null;
    for (var i = 0; i < officeConfig.furniture.length; i++) {
        if (officeConfig.furniture[i].id === selectedItemId) { selItem = officeConfig.furniture[i]; break; }
    }
    if (!selItem) { _floatingToolbar.style.display = 'none'; return; }

    var _wr = _getItemWorldRect(selItem);
    var base = getBaseScale();
    var totalZoom = base * camera.zoom;
    var rect = canvas.getBoundingClientRect();
    // World center-top → display coords
    var wx = _wr.x + _wr.w / 2;
    var wy = _wr.y;
    var dx = (wx - W / 2 - camera.x) * totalZoom + displayW / 2;
    var dy = (wy - H / 2 - camera.y) * totalZoom + displayH / 2;
    // Display → screen CSS
    var sx = dx * (rect.width / displayW) + rect.left;
    var sy = dy * (rect.height / displayH) + rect.top;

    _floatingToolbar.style.display = 'flex';
    _floatingToolbar.style.left = (sx - 52) + 'px';
    _floatingToolbar.style.top  = (sy - 46) + 'px';
    // Show assign button only for desks
    var assignBtn = _voNullElement('ftb-assign-btn');
    if (assignBtn) {
        var isDesk = selItem.type === 'desk' || selItem.type === 'bossDesk';
        assignBtn.style.display = isDesk ? '' : 'none';
        if (isDesk && selItem.assignedTo) {
            assignBtn.title = 'Assigned to: ' + selItem.assignedTo + ' (click to change)';
            assignBtn.textContent = '👤✓';
        } else if (isDesk) {
            assignBtn.title = 'Assign agent to this desk';
            assignBtn.textContent = '👤';
        }
    }
    // Show branch button only for branch signs
    var branchBtn = _voNullElement('ftb-branch-btn');
    if (branchBtn) {
        var isSign = selItem.type === 'branchSign';
        branchBtn.style.display = isSign ? '' : 'none';
        if (isSign && selItem.branchId) {
            var _bInfo = getBranchById(selItem.branchId);
            branchBtn.title = 'Branch: ' + _bInfo.name + ' (click to change)';
            branchBtn.textContent = '🏷️✓';
        } else if (isSign) {
            branchBtn.title = 'Assign branch to this sign';
            branchBtn.textContent = '🏷️';
        }
    }
    var colorBtn = _voNullElement('ftb-color-btn');
    if (colorBtn) colorBtn.style.display = 'none';

    // Show label edit buttons for textLabel items
    var labelEditBtn = _voNullElement('ftb-label-edit-btn');
    if (!labelEditBtn) {
        // Create the label edit button dynamically on first use
        labelEditBtn = document.createElement('button');
        labelEditBtn.id = 'ftb-label-edit-btn';
        labelEditBtn.textContent = '✏️';
        labelEditBtn.title = 'Edit label';
        labelEditBtn.style.cssText = 'padding:4px 6px;background:#2a2a4e;border:1px solid #3a3a5e;border-radius:4px;cursor:pointer;font-size:12px;';
        labelEditBtn.onclick = function() {
            if (!selectedItemId) return;
            var item = officeConfig.furniture.find(function(f){ return f.id === selectedItemId; });
            if (!item || item.type !== 'textLabel') return;
            _showTextLabelEditor(item);
        };
        _floatingToolbar.appendChild(labelEditBtn);
    }
    labelEditBtn.style.display = (selItem.type === 'textLabel') ? '' : 'none';

    // Show settings button for interactiveWindow items
    var iwSettingsBtn = _voNullElement('ftb-iw-settings-btn');
    if (!iwSettingsBtn) {
        iwSettingsBtn = document.createElement('button');
        iwSettingsBtn.id = 'ftb-iw-settings-btn';
        iwSettingsBtn.textContent = '⚙️';
        iwSettingsBtn.title = 'Window settings (weather/sun)';
        iwSettingsBtn.style.cssText = 'padding:4px 6px;background:#2a2a4e;border:1px solid #3a3a5e;border-radius:4px;cursor:pointer;font-size:12px;';
        iwSettingsBtn.onclick = function() {
            if (!selectedItemId) return;
            var item = officeConfig.furniture.find(function(f){ return f.id === selectedItemId; });
            if (!item || item.type !== 'interactiveWindow') return;
            _showInteractiveWindowEditor(item);
        };
        _floatingToolbar.appendChild(iwSettingsBtn);
    }
    iwSettingsBtn.style.display = (selItem.type === 'interactiveWindow') ? '' : 'none';

    // Show color button for couch items
    var couchColorBtn = _voNullElement('ftb-couch-color-btn');
    if (!couchColorBtn) {
        couchColorBtn = document.createElement('button');
        couchColorBtn.id = 'ftb-couch-color-btn';
        couchColorBtn.textContent = '🎨';
        couchColorBtn.title = 'Change couch color';
        couchColorBtn.style.cssText = 'padding:4px 6px;background:#2a2a4e;border:1px solid #3a3a5e;border-radius:4px;cursor:pointer;font-size:12px;';
        couchColorBtn.onclick = function() {
            if (!selectedItemId) return;
            var item = officeConfig.furniture.find(function(f){ return f.id === selectedItemId; });
            if (!item || item.type !== 'couch') return;
            _showCouchColorEditor(item);
        };
        _floatingToolbar.appendChild(couchColorBtn);
    }
    couchColorBtn.style.display = (selItem.type === 'couch') ? '' : 'none';

    // Show rotate button for rotatable items (couch)
    var rotateBtn = _voNullElement('ftb-rotate-btn');
    if (!rotateBtn) {
        rotateBtn = document.createElement('button');
        rotateBtn.id = 'ftb-rotate-btn';
        rotateBtn.textContent = '🔄';
        rotateBtn.title = 'Rotate 90°';
        rotateBtn.style.cssText = 'padding:4px 6px;background:#2a2a4e;border:1px solid #3a3a5e;border-radius:4px;cursor:pointer;font-size:12px;';
        rotateBtn.onclick = function() {
            if (!selectedItemId) return;
            var item = officeConfig.furniture.find(function(f){ return f.id === selectedItemId; });
            if (!item) return;
            var fa = FURNITURE_ACTIONS[item.type];
            if (!fa || !fa.rotatable) return;
            _pushUndo();
            item.rotation = ((item.rotation || 0) + 90) % 360;
            getInteractionSpots();
            _saveOfficeConfig();
        };
        _floatingToolbar.appendChild(rotateBtn);
    }
    var isRotatable = false;
    var selFa = FURNITURE_ACTIONS[selItem.type];
    if (selFa && selFa.rotatable) isRotatable = true;
    rotateBtn.style.display = isRotatable ? '' : 'none';
}

// --- EDIT MODE MOUSE TRACKING ---
// canvas/window mousemove handler removed — forwarded via VOBuildingEngine

// --- EDIT MODE TOGGLE (called from toolbar button) ---
function toggleEditMode() {
    if (window._voLicense && window._voLicense.demo) {
        alert('Edit Office is a premium feature. Get a license key at myvirtualoffice.ai to unlock.');
        return;
    }
    editMode = !editMode;
    var btn = _voNullElement('btn-edit-office');
    var saveBtn = _voNullElement('btn-save-edits');
    var undoBtn = _voNullElement('btn-undo-edit');
    if (editMode) {
        btn.textContent = '✅ Done Editing';
        btn.classList.add('active-edit');
        if (saveBtn) saveBtn.style.display = '';
        if (undoBtn) undoBtn.style.display = '';
        _showCatalogPanel();
        _undoStack = [];
        _hasUnsavedChanges = false;
        _updateSaveUndoButtons();
    } else {
        btn.textContent = '✏️ Edit Office';
        btn.classList.remove('active-edit');
        if (saveBtn) saveBtn.style.display = 'none';
        if (undoBtn) undoBtn.style.display = 'none';
        editHoverTile = null;
        _floorEditMode = false;
        _hideCatalogPanel();
        if (_hasUnsavedChanges) {
            saveOfficeConfig();
        }
        _undoStack = [];
        _hasUnsavedChanges = false;
    }
}

// --- AGENT CREATOR PANEL ---
var _agentPanel = null;
var _agentPanelSelectedId = null;
var _agentPanelPreviewCanvas = null;
var _agentPanelPreviewCtx = null;
var _agentPanelEditState = null; // working copy of appearance being edited
var _acpUndoStack = [];
var _acpUnsaved = false;

// ============================================================
// MAIN MENU
// ============================================================
var _mainMenuOpen = false;

function toggleMainMenu() { /* stubbed: DOM/server removed from engine */ }

function _mmLoadCurrentSettings() { /* stubbed: DOM/server removed from engine */ }


// PC Metrics toggle in settings
(function() {
    var _pcmCb = _voNullElement('mm-pcmetrics-enable');
    if (_pcmCb) _pcmCb.addEventListener('change', function() {
        var f = _voNullElement('mm-pcmetrics-fields');
        if (f) f.style.display = this.checked ? 'block' : 'none';
    });
})();

// Browser toggle in settings
(function() {
    var _brCb = _voNullElement('mm-browser-enable');
    if (_brCb) _brCb.addEventListener('change', function() {
        var f = _voNullElement('mm-browser-fields');
        if (f) f.style.display = this.checked ? 'block' : 'none';
    });
})();

function mmTestCdp() { /* stubbed: DOM/server removed from engine */ }

function mmTestViewer() { /* stubbed: DOM/server removed from engine */ }

function mmTestPcMetrics() { /* stubbed: DOM/server removed from engine */ }

function mmTestConnection() { /* stubbed: DOM/server removed from engine */ }

function _buildWeatherLocation(city, state) {
    city = (city || '').trim();
    state = (state || '').trim();
    if (!city) return null;
    return state ? city.replace(/ /g, '+') + ',' + state.replace(/ /g, '+') : city.replace(/ /g, '+');
}

function mmSaveSettings() { /* stubbed: DOM/server removed from engine */ }

function mmExportConfig() { /* stubbed: DOM/server removed from engine */ }

function mmImportConfig() { /* stubbed: DOM/server removed from engine */ }

function mmFullReset() { /* stubbed: DOM/server removed from engine */ }

function toggleAgentPanel() { /* stubbed: DOM/server removed from engine */ }

function _buildAgentPanel() { /* stubbed: DOM/server removed from engine */ }

function _acpRefreshList() { /* stubbed: DOM/server removed from engine */ }

function _acpSelectAgent() { /* stubbed: DOM/server removed from engine */ }

function _acpBuildEditor() { /* stubbed: DOM/server removed from engine */ }


function _acpText() { /* stubbed: DOM/server removed from engine */ }

function _acpColor() { /* stubbed: DOM/server removed from engine */ }

function _acpColorNullable() { /* stubbed: DOM/server removed from engine */ }

function _acpToggle() { /* stubbed: DOM/server removed from engine */ }

function _acpSwatchRow() { /* stubbed: DOM/server removed from engine */ }

function _acpGridSelect() { /* stubbed: DOM/server removed from engine */ }

function _acpUpdatePreviewInfo() { /* stubbed: DOM/server removed from engine */ }

function _acpUpdatePreview() { /* stubbed: DOM/server removed from engine */ }

function _acpSave() { /* stubbed: DOM/server removed from engine */ }

function _acpAutoSave() { /* stubbed: DOM/server removed from engine */ }

function _acpShowToast() { /* stubbed: DOM/server removed from engine */ }

function _isCustomAgent(agentId) {
    // Built-in agents come from AGENT_DEFS
    return !AGENT_DEFS.find(function(d){ return d.id === agentId; });
}

function _acpCreateNewAgent() { /* stubbed: DOM/server removed from engine */ }

function _acpDeleteAgent() { /* stubbed: DOM/server removed from engine */ }

// --- INTERCEPT CLICKS IN EDIT MODE ---
// Patch into existing mouseup/touchend handlers
var _origHandleClick = typeof handleCanvasClick === 'function' ? handleCanvasClick : null;

// canvas click handler for edit mode removed — forwarded via VOBuildingEngine

// --- EDIT MODE DRAG: mousedown to start dragging selected item or multi-drag ---
var _editMouseDownPos = null; // track start position to detect drag vs click
var _editMouseMoved = false;
var _editDragTileHighlight = null; // {tx, ty} for glowing tile during drag

// canvas/window mousedown handler removed — forwarded via VOBuildingEngine

// Double-click on empty space → activate marquee mode (click+drag to select area)
var _marqueeMode = false; // true = next mousedown starts marquee drawing
// canvas.addEventListener('dblclick', handler removed

// Stop dragging on mouseup (window-level to catch releases outside canvas)
// canvas/window mouseup handler removed — forwarded via VOBuildingEngine

// Right-click in edit mode → cancel placement
// canvas contextmenu handler removed

// Keyboard shortcuts in edit mode
// canvas/window keydown handler removed — forwarded via VOBuildingEngine

// ─── CATALOG PANEL ────────────────────────────────────────────

function _createCatalogPanel() { /* DOM editor stubbed in engine mode */ }

function _createFloatingToolbar() { /* DOM editor stubbed in engine mode */ }

function _showCatalogPanel() {
    if (!_catalogPanel) _createCatalogPanel();
    _catalogPanel.classList.add('visible');
}

function _hideCatalogPanel() {
    if (_catalogPanel) _catalogPanel.classList.remove('visible');
    if (_floatingToolbar) _floatingToolbar.style.display = 'none';
    placingType = null;
    selectedItemId = null;
    isDragging = false;
    _ghostPos = null;
    _updateCatalogSelection();
}

function _selectCatalogItem(type) {
    placingType = type;
    wallPlacingPhase = 0;
    wallPlacingStart = null;
    selectedWallIdx = null;
    selectedItemId = null;
    isDragging = false;
    if (_floatingToolbar) _floatingToolbar.style.display = 'none';
    _updateCatalogSelection();
    var instr = _voNullElement('catalog-instr');
    if (instr) instr.innerHTML = 'Click canvas to place<br>Right-click / Esc to cancel';
}

function _cancelPlacement() {
    placingType = null;
    wallPlacingPhase = 0;
    wallPlacingStart = null;
    _ghostPos = null;
    _updateCatalogSelection();
    var instr = _voNullElement('catalog-instr');
    if (instr) instr.innerHTML = 'Click item to place<br>Right-click / Esc to cancel';
}

function _deselectItem() {
    selectedItemId = null;
    isDragging = false;
    if (_floatingToolbar) _floatingToolbar.style.display = 'none';
}

function _showBranchAssignMenu() {
    if (!selectedItemId) return;
    var selItem = null;
    for (var i = 0; i < officeConfig.furniture.length; i++) {
        if (officeConfig.furniture[i].id === selectedItemId) { selItem = officeConfig.furniture[i]; break; }
    }
    if (!selItem || selItem.type !== 'branchSign') return;

    var existing = _voNullElement('branch-assign-menu');
    if (existing) existing.remove();

    var menu = document.createElement('div');
    menu.id = 'branch-assign-menu';
    menu.style.cssText = 'position:fixed;z-index:10001;background:#1a1a2e;border:2px solid #ffd600;border-radius:8px;padding:8px;min-width:180px;box-shadow:0 4px 16px rgba(0,0,0,0.5);';

    // Position near toolbar, clamped to viewport
    document.body.appendChild(menu);
    var tb = _floatingToolbar;
    if (tb) {
        var tbRect = tb.getBoundingClientRect();
        var menuH = menu.offsetHeight || 200;
        var left = tbRect.left;
        var top = tbRect.top - menuH - 10;
        if (top < 8) top = tbRect.bottom + 8;
        if (left + 200 > window.innerWidth - 8) left = window.innerWidth - 208;
        if (left < 8) left = 8;
        menu.style.left = left + 'px';
        menu.style.top = top + 'px';
    }

    var title = document.createElement('div');
    title.style.cssText = 'color:#ffd600;font-size:10px;font-family:"Press Start 2P",monospace;margin-bottom:6px;text-align:center;';
    title.textContent = 'ASSIGN BRANCH';
    menu.appendChild(title);

    var branches = getBranchList();
    branches.forEach(function(branch) {
        var btn = document.createElement('button');
        var isCurrent = selItem.branchId === branch.id;
        var neonColor = branch.color || _NEON_COLORS[branch.theme] || '#ccc';
        btn.style.cssText = 'display:block;width:100%;padding:5px 8px;margin:2px 0;background:#2a2a4e;color:' + neonColor + ';border:1px solid ' + (isCurrent ? '#ffd600' : '#3a3a5e') + ';border-radius:4px;cursor:pointer;font-size:11px;text-align:left;';
        btn.textContent = branch.emoji + ' ' + branch.name + (isCurrent ? ' ✓' : '');
        btn.addEventListener('mouseenter', function() { if (!isCurrent) btn.style.background = '#3a3a5e'; });
        btn.addEventListener('mouseleave', function() { btn.style.background = '#2a2a4e'; });
        btn.addEventListener('click', function() {
            _pushUndo();
            selItem.branchId = branch.id;
            saveOfficeConfig();
            menu.remove();
        });
        menu.appendChild(btn);
    });

    // Close on click outside
    setTimeout(function() {
        document.addEventListener('click', function closeMenu(e) {
            if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', closeMenu); }
        });
    }, 100);
}

function _showDeskAssignMenu() {
    if (!selectedItemId) return;
    var selItem = null;
    for (var i = 0; i < officeConfig.furniture.length; i++) {
        if (officeConfig.furniture[i].id === selectedItemId) { selItem = officeConfig.furniture[i]; break; }
    }
    if (!selItem || (selItem.type !== 'desk' && selItem.type !== 'bossDesk')) return;

    // Get list of agents
    var agentNames = AGENT_DEFS.map(function(a) { return a.name; });
    // Get already-assigned agents (exclude this desk)
    var assigned = {};
    officeConfig.furniture.forEach(function(f) {
        if (f.assignedTo && f.id !== selItem.id) assigned[f.assignedTo] = true;
    });

    // Build dropdown menu
    var existing = _voNullElement('desk-assign-menu');
    if (existing) existing.remove();

    var menu = document.createElement('div');
    menu.id = 'desk-assign-menu';
    menu.style.cssText = 'position:fixed;z-index:10001;background:#1a1a2e;border:2px solid #ffd600;border-radius:8px;padding:8px;min-width:160px;box-shadow:0 4px 16px rgba(0,0,0,0.5);';

    // Position near toolbar, clamped to viewport
    document.body.appendChild(menu);
    var tb = _floatingToolbar;
    if (tb) {
        var tbRect = tb.getBoundingClientRect();
        var menuH = menu.offsetHeight || (agentNames.length * 28 + 50);
        var menuW = menu.offsetWidth || 180;
        var left = tbRect.left;
        var top = tbRect.top - menuH - 10;
        // Clamp to viewport
        if (top < 8) top = tbRect.bottom + 8;
        if (left + menuW > window.innerWidth - 8) left = window.innerWidth - menuW - 8;
        if (left < 8) left = 8;
        if (top + menuH > window.innerHeight - 8) top = window.innerHeight - menuH - 8;
        menu.style.left = left + 'px';
        menu.style.top = top + 'px';
    }

    var title = document.createElement('div');
    title.style.cssText = 'color:#ffd600;font-size:10px;font-family:"Press Start 2P",monospace;margin-bottom:6px;text-align:center;';
    title.textContent = 'ASSIGN DESK';
    menu.appendChild(title);

    // Unassign option
    var unBtn = document.createElement('button');
    unBtn.style.cssText = 'display:block;width:100%;padding:4px 8px;margin:2px 0;background:#2a2a4e;color:#aaa;border:1px solid #3a3a5e;border-radius:4px;cursor:pointer;font-size:11px;text-align:left;';
    unBtn.textContent = '— None —';
    if (!selItem.assignedTo) { unBtn.style.borderColor = '#ffd600'; unBtn.style.color = '#ffd600'; }
    unBtn.addEventListener('click', function() {
        _pushUndo();
        delete selItem.assignedTo;
        _syncAllDeskAssignments();
        menu.remove();
    });
    menu.appendChild(unBtn);

    agentNames.forEach(function(name) {
        var btn = document.createElement('button');
        var isAssigned = assigned[name];
        var isCurrent = selItem.assignedTo === name;
        btn.style.cssText = 'display:block;width:100%;padding:4px 8px;margin:2px 0;background:#2a2a4e;color:' + (isAssigned ? '#555' : '#ccc') + ';border:1px solid ' + (isCurrent ? '#ffd600' : '#3a3a5e') + ';border-radius:4px;cursor:' + (isAssigned ? 'default' : 'pointer') + ';font-size:11px;text-align:left;';
        var agent = AGENT_DEFS.find(function(a) { return a.name === name; });
        btn.textContent = (agent ? agent.emoji + ' ' : '') + name + (isAssigned ? ' (assigned)' : '') + (isCurrent ? ' ✓' : '');
        if (!isAssigned) {
            btn.addEventListener('mouseenter', function() { if (!isCurrent) btn.style.background = '#3a3a5e'; });
            btn.addEventListener('mouseleave', function() { btn.style.background = '#2a2a4e'; });
            btn.addEventListener('click', function() {
                _pushUndo();
                selItem.assignedTo = name;
                _syncAgentToDesk(selItem);
                menu.remove();
            });
        }
        menu.appendChild(btn);
    });

    // Close on click outside
    setTimeout(function() {
        document.addEventListener('click', function closeMenu(e) {
            if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', closeMenu); }
        });
    }, 100);
}

function _deleteSelectedItem() {
    if (!selectedItemId) return;
    _pushUndo();
    // If deleting a desk, clear the assigned agent's desk reference
    var delItem = officeConfig.furniture.find(function(f) { return f.id === selectedItemId; });
    if (delItem && (delItem.type === 'desk' || delItem.type === 'bossDesk') && delItem.assignedTo) {
        agents.forEach(function(a) {
            if (a.name === delItem.assignedTo) {
                // Move agent to center as fallback
                a.desk = { x: Math.floor(W / 2), y: Math.floor(H / 2) };
                a.targetX = a.desk.x;
                a.targetY = a.desk.y;
            }
        });
    }
    officeConfig.furniture = officeConfig.furniture.filter(function(f) { return f.id !== selectedItemId; });
    selectedItemId = null;
    isDragging = false;
    if (_floatingToolbar) _floatingToolbar.style.display = 'none';
    getInteractionSpots();
    saveOfficeConfig(); // persist deletion + re-derive meeting slots
}

function _updateCatalogSelection() {
    if (!_catalogPanel) return;
    var items = _catalogPanel.querySelectorAll('.catalog-item');
    items.forEach(function(el) {
        if (el.dataset.type === placingType) {
            el.classList.add('selected');
        } else {
            el.classList.remove('selected');
        }
    });
}

// ─── WALL / FLOOR COLOR PICKER ────────────────────────────────

var _colorPickerEl = null;
var _colorPickerTarget = null; // { type: 'wall'|'floor', idx }

function _ensureColorPicker() {
    if (_colorPickerEl) return;
    var el = document.createElement('div');
    el.id = 'edit-color-picker';
    el.style.cssText = [
        'position:fixed; z-index:400; background:#1a1a2e; border:1px solid #ffd600;',
        'border-radius:8px; padding:10px 14px; display:none; flex-direction:column; gap:8px;',
        'box-shadow:0 4px 20px rgba(0,0,0,0.7); font-family:"Press Start 2P",cursive; font-size:7px; color:#ccc;',
        'min-width:200px;'
    ].join('');

    var closeRow = document.createElement('div');
    closeRow.style.cssText = 'display:flex;justify-content:space-between;align-items:center;';
    var titleEl = document.createElement('span');
    titleEl.id = 'edit-cp-title';
    titleEl.style.color = '#ffd600';
    titleEl.textContent = 'COLOR';
    var closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.style.cssText = 'background:none;border:1px solid #444;color:#aaa;cursor:pointer;padding:2px 6px;border-radius:3px;font-family:inherit;';
    closeBtn.addEventListener('click', _hideColorPicker);
    closeRow.appendChild(titleEl);
    closeRow.appendChild(closeBtn);
    el.appendChild(closeRow);

    // Row 1
    var row1 = document.createElement('div');
    row1.style.cssText = 'display:flex;align-items:center;gap:8px;';
    var lbl1 = document.createElement('span');
    lbl1.id = 'edit-cp-lbl1';
    lbl1.textContent = 'Main:';
    var inp1 = document.createElement('input');
    inp1.type = 'color'; inp1.id = 'edit-cp-color1';
    inp1.style.cssText = 'width:40px;height:28px;cursor:pointer;border:none;padding:0;border-radius:3px;';
    inp1.addEventListener('input', function() { _setActiveColorInput('edit-cp-color1'); _applyColorPicker(); });
    inp1.addEventListener('focus', function() { _setActiveColorInput('edit-cp-color1'); });
    inp1.addEventListener('click', function() { _setActiveColorInput('edit-cp-color1'); });
    row1.appendChild(lbl1); row1.appendChild(inp1);
    el.appendChild(row1);

    // Row 2
    var row2 = document.createElement('div');
    row2.style.cssText = 'display:flex;align-items:center;gap:8px;';
    var lbl2 = document.createElement('span');
    lbl2.id = 'edit-cp-lbl2';
    lbl2.textContent = 'Accent:';
    var inp2 = document.createElement('input');
    inp2.type = 'color'; inp2.id = 'edit-cp-color2';
    inp2.style.cssText = 'width:40px;height:28px;cursor:pointer;border:none;padding:0;border-radius:3px;';
    inp2.addEventListener('input', function() { _setActiveColorInput('edit-cp-color2'); _applyColorPicker(); });
    inp2.addEventListener('focus', function() { _setActiveColorInput('edit-cp-color2'); });
    inp2.addEventListener('click', function() { _setActiveColorInput('edit-cp-color2'); });
    row2.appendChild(lbl2); row2.appendChild(inp2);
    el.appendChild(row2);

    // Row 3
    var row3 = document.createElement('div');
    row3.id = 'edit-cp-row3';
    row3.style.cssText = 'display:none;align-items:center;gap:8px;';
    var lbl3 = document.createElement('span');
    lbl3.id = 'edit-cp-lbl3';
    lbl3.textContent = 'Trim 2:';
    var inp3 = document.createElement('input');
    inp3.type = 'color'; inp3.id = 'edit-cp-color3';
    inp3.style.cssText = 'width:40px;height:28px;cursor:pointer;border:none;padding:0;border-radius:3px;';
    inp3.addEventListener('input', function() { _setActiveColorInput('edit-cp-color3'); _applyColorPicker(); });
    inp3.addEventListener('focus', function() { _setActiveColorInput('edit-cp-color3'); });
    inp3.addEventListener('click', function() { _setActiveColorInput('edit-cp-color3'); });
    row3.appendChild(lbl3); row3.appendChild(inp3);
    el.appendChild(row3);

    // Favorites
    var favHeader = document.createElement('div');
    favHeader.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-top:4px;gap:8px;';
    var favTitle = document.createElement('span');
    favTitle.textContent = 'Favorites';
    favTitle.style.cssText = 'color:#bbb;font-size:11px;';
    var favSaveBtn = document.createElement('button');
    favSaveBtn.id = 'edit-cp-save-favorite';
    favSaveBtn.textContent = '★ Save Current';
    favSaveBtn.style.cssText = 'background:#2a2a4e;border:1px solid #555;color:#ddd;cursor:pointer;padding:3px 6px;border-radius:3px;font-family:inherit;font-size:10px;';
    favSaveBtn.addEventListener('click', function() { _saveCurrentColorFavorite(); });
    favHeader.appendChild(favTitle);
    favHeader.appendChild(favSaveBtn);
    el.appendChild(favHeader);

    var favWrap = document.createElement('div');
    favWrap.id = 'edit-cp-favorites';
    favWrap.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;';
    el.appendChild(favWrap);

    document.body.appendChild(el);
    _colorPickerEl = el;
}

function _refreshColorFavoritesUI() {
    var wrap = _voNullElement('edit-cp-favorites');
    if (!wrap) return;
    wrap.innerHTML = '';
    colorFavorites.forEach(function(color, idx) {
        var btn = document.createElement('button');
        btn.className = 'cp-favorite-btn';
        btn.title = color;
        btn.style.cssText = 'width:24px;height:24px;border-radius:4px;border:1px solid rgba(255,255,255,0.35);cursor:pointer;background:' + color + ';';
        btn.addEventListener('click', function() { _applyFavoriteColor(color); });
        btn.addEventListener('contextmenu', function(e) {
            e.preventDefault();
            colorFavorites.splice(idx, 1);
            saveColorFavorites();
            _refreshColorFavoritesUI();
        });
        wrap.appendChild(btn);
    });
}

function _activeColorInput() {
    if (_colorPickerTarget && _colorPickerTarget.activeInputId) {
        var active = _voNullElement(_colorPickerTarget.activeInputId);
        if (active) return active;
    }
    return _voNullElement('edit-cp-color1');
}

function _setActiveColorInput(inputId) {
    if (!_colorPickerTarget) _colorPickerTarget = {};
    _colorPickerTarget.activeInputId = inputId;
}

function _applyFavoriteColor(color) {
    var input = _activeColorInput();
    if (!input) return;
    input.value = color;
    _applyColorPicker();
}

function _saveCurrentColorFavorite() {
    var input = _activeColorInput();
    if (!input || !input.value) return;
    var color = input.value.toLowerCase();
    colorFavorites = colorFavorites.filter(function(c) { return c.toLowerCase() !== color; });
    colorFavorites.unshift(color);
    colorFavorites = colorFavorites.slice(0, 16);
    saveColorFavorites();
    _refreshColorFavoritesUI();
}

function _showWallColorPicker(wallIdx, sx, sy) {
    _ensureColorPicker();
    _colorPickerTarget = { type: 'interior-wall', idx: wallIdx };
    var wall = (officeConfig.walls.interior || [])[wallIdx] || {};
    _voNullElement('edit-cp-title').textContent = 'WALL COLOR';
    _voNullElement('edit-cp-lbl1').textContent = 'Main:';
    _voNullElement('edit-cp-lbl2').textContent = 'Trim:';
    _voNullElement('edit-cp-lbl3').textContent = 'Trim 2:';
    _voNullElement('edit-cp-color1').value = _wallMainColor(wall);
    _voNullElement('edit-cp-color2').value = _wallTrimColor(wall);
    _voNullElement('edit-cp-color3').value = _wallTrim2Color(wall);
    _setActiveColorInput('edit-cp-color1');
    _refreshColorFavoritesUI();
    _voNullElement('edit-cp-color2').parentElement.style.display = 'flex';
    _voNullElement('edit-cp-row3').style.display = 'flex';
    _positionColorPicker(sx, sy);
}

function _showTopWallColorPicker(sx, sy) {
    _ensureColorPicker();
    _colorPickerTarget = { type: 'top-wall' };
    var wall = getTopWallConfig();
    _voNullElement('edit-cp-title').textContent = 'TOP WALL COLOR';
    _voNullElement('edit-cp-lbl1').textContent = 'Main:';
    _voNullElement('edit-cp-lbl2').textContent = 'Trim:';
    _voNullElement('edit-cp-color1').value = wall.color;
    _voNullElement('edit-cp-color2').value = wall.trimColor || wall.accentColor;
    _voNullElement('edit-cp-color2').parentElement.style.display = 'flex';
    _voNullElement('edit-cp-row3').style.display = 'none';
    _setActiveColorInput('edit-cp-color1');
    _refreshColorFavoritesUI();
    _positionColorPicker(sx, sy);
}

function _showFloorColorPicker(sx, sy) {
    _ensureColorPicker();
    _colorPickerTarget = { type: 'floor' };
    _voNullElement('edit-cp-title').textContent = 'FLOOR COLOR';
    _voNullElement('edit-cp-lbl1').textContent = 'Tile A:';
    _voNullElement('edit-cp-lbl2').textContent = 'Tile B:';
    _voNullElement('edit-cp-color1').value = officeConfig.floor.color1;
    _voNullElement('edit-cp-color2').value = officeConfig.floor.color2;
    _voNullElement('edit-cp-color2').parentElement.style.display = 'flex';
    _voNullElement('edit-cp-row3').style.display = 'none';
    _setActiveColorInput('edit-cp-color1');
    _refreshColorFavoritesUI();
    _positionColorPicker(sx, sy);
}

function _positionColorPicker(sx, sy) {
    var el = _colorPickerEl;
    el.style.display = 'flex';
    // Position below click, clamped to viewport
    var w = 220, h = _colorPickerTarget && _colorPickerTarget.type === 'interior-wall' ? 168 : 130;
    var vw = window.innerWidth, vh = window.innerHeight;
    var left = Math.min(sx, vw - w - 10);
    var top  = Math.min(sy + 10, vh - h - 10);
    el.style.left = left + 'px';
    el.style.top  = top  + 'px';
}

function _applyColorPicker() {
    if (!_colorPickerTarget) return;
    _pushUndo();
    var c1 = _voNullElement('edit-cp-color1').value;
    var c2 = _voNullElement('edit-cp-color2').value;
    var c3 = _voNullElement('edit-cp-color3') ? _voNullElement('edit-cp-color3').value : null;
    if (_colorPickerTarget.type === 'interior-wall') {
        var wall = officeConfig.walls.interior[_colorPickerTarget.idx];
        if (wall) {
            wall.color = c1;
            wall.accentColor = c1;
            wall.trimColor = c2;
            wall.trim2Color = c3 || wall.trim2Color || '#37474f';
        }
    } else if (_colorPickerTarget.type === 'top-wall') {
        if (!officeConfig.walls.topWall) officeConfig.walls.topWall = {};
        officeConfig.walls.topWall.color = c1;
        officeConfig.walls.topWall.accentColor = c2;
        officeConfig.walls.topWall.trimColor = c2;
        officeConfig.walls.trimColor = c2;
        if (officeConfig.walls.sections && officeConfig.walls.sections[0]) {
            officeConfig.walls.sections[0].color = c1;
            officeConfig.walls.sections[0].accentColor = c2;
        }
        officeConfig.walls.trimColor = c2;
    } else if (_colorPickerTarget.type === 'floor') {
        officeConfig.floor.color1 = c1;
        officeConfig.floor.color2 = c2;
    } else if (_colorPickerTarget.type === 'couch') {
        var cItem = officeConfig.furniture.find(function(f){ return f.id === _colorPickerTarget.itemId; });
        if (cItem) {
            cItem.couchColor = c1;
            _saveOfficeConfig();
        }
    }
}

function _showCouchColorEditor() { /* DOM editor stubbed in engine mode */ }

function _hideColorPicker() {
    if (_colorPickerEl) _colorPickerEl.style.display = 'none';
    _colorPickerTarget = null;
}

// ─── SKILLS MANAGEMENT ──────────────────────────────────────────────────────
var _currentSkillAgent = null; // statusKey of agent whose skills are shown
var _editingSkillName = null;

function loadAgentSkills() { /* stubbed: DOM/server removed from engine */ }

function showAddSkillForm() { /* stubbed: DOM/server removed from engine */ }

function hideAddSkillForm() { /* stubbed: DOM/server removed from engine */ }

function showLibraryPicker() { /* no-op: server calls removed from engine */ }

function hideLibraryPicker() { /* stubbed: DOM/server removed from engine */ }

function applyLibrarySkill() { /* no-op: server calls removed from engine */ }

function saveNewSkill() { /* stubbed: DOM/server removed from engine */ }

function editSkill() { /* stubbed: DOM/server removed from engine */ }

function hideEditSkillForm() { /* stubbed: DOM/server removed from engine */ }

function saveEditedSkill() { /* stubbed: DOM/server removed from engine */ }

function deleteSkill() { /* stubbed: DOM/server removed from engine */ }

// ─── MEETINGS DASHBOARD ──────────────────────────────────────────
var _mtgAgentMap = {};  // key → {name, emoji, role}
var _mtgCurrentTab = 'active';
var _mtgData = { active: [], history: [] };

function openMeetingsDashboard() { /* stubbed: DOM/server removed from engine */ }

function closeMeetingsModal() { /* stubbed: DOM/server removed from engine */ }

function switchMtgTab() { /* stubbed: DOM/server removed from engine */ }

function _mtgRefresh() { /* no-op: server calls removed from engine */ }

function _mtgRender() { /* stubbed: DOM/server removed from engine */ }

function _escMtg(s) {
    if (!s) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function mtgExpandAll() { /* stubbed: DOM/server removed from engine */ }

function mtgCollapseAll() { /* stubbed: DOM/server removed from engine */ }

function toggleMtgCard() { /* stubbed: DOM/server removed from engine */ }

function toggleMtgResponse() { /* stubbed: DOM/server removed from engine */ }

function openEndMeetingForm() { /* stubbed: DOM/server removed from engine */ }

function closeEndMeetingModal() { /* stubbed: DOM/server removed from engine */ }

function submitEndMeeting() { /* no-op: server calls removed from engine */ }

function deleteMeetingHistory() { /* no-op: server calls removed from engine */ }

// --- Sidebar meetings widget ---
function _updateSidebarMeetings() { /* stubbed: DOM/server removed from engine */ }

// Sidebar meetings widget removed (no DOM)
// --- Meeting table click handler ---
// Override the existing furniture click to detect meetingTable clicks
var _origHandleFurnitureClick = typeof handleFurnitureClick === 'function' ? handleFurnitureClick : null;
function _meetingTableClickCheck(item) {
    if (item && item.type === 'meetingTable' && !editMode) {
        openMeetingsDashboard();
        return true;
    }
    return false;
}

// meetings Escape handler removed (no DOM)
// canvas/window keydown handler removed — forwarded via VOBuildingEngine

// Close meetings modal on backdrop click
// meetingsModal click handler removed (no DOM)
// endMeetingModal click handler removed (no DOM)

// ============================================================
// SKILLS LIBRARY
// ============================================================

var _sklSkills = [];
var _sklEditingName = null; // null = new, string = editing existing

function openSkillsLibrary() { /* stubbed: DOM/server removed from engine */ }

function closeSkillsLibrary() { /* stubbed: DOM/server removed from engine */ }

function refreshSkillsList() { /* no-op: server calls removed from engine */ }

function renderSkillCards() { /* stubbed: DOM/server removed from engine */ }

function _sklEsc(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function toggleSkillApply() { /* no-op: server calls removed from engine */ }

function applySkillToAgent() { /* no-op: server calls removed from engine */ }

function openSkillEditor() { /* no-op: server calls removed from engine */ }

function closeSkillEditor() { /* stubbed: DOM/server removed from engine */ }

function saveSkill() { /* stubbed: DOM/server removed from engine */ }

function deleteLibrarySkill() { /* stubbed: DOM/server removed from engine */ }

function handleSkillUpload() { /* stubbed: DOM/server removed from engine */ }

// Close skills modals on backdrop click
// Skills modal event listeners removed (no DOM)
// loop() — started by VOBuildingEngine.tick()


// ─── VOBuildingEngine Class ──────────────────────────────────────────────────

// ─── MISSING FUNCTION STUBS (stripped during extraction, added back) ───

function drawInteractiveWindow(item) {
    // Simplified version — draws a window with sky gradient (no weather editor)
    var x = item.x || 0, y = item.y || 0;
    var ww = 44, wh = 52;
    // Frame
    ctx.fillStyle = '#455a64';
    ctx.fillRect(x, y, ww, wh);
    // Glass with sky gradient
    var grad = ctx.createLinearGradient(x + 4, y + 4, x + 4, y + wh - 8);
    grad.addColorStop(0, '#87CEEB');
    grad.addColorStop(1, '#E0F7FA');
    ctx.fillStyle = grad;
    ctx.fillRect(x + 4, y + 4, ww - 8, wh - 8);
    // Window cross
    ctx.fillStyle = '#fff';
    ctx.fillRect(x + ww/2 - 1, y + 4, 2, wh - 8);
    ctx.fillRect(x + 4, y + wh/2 - 1, ww - 8, 2);
    // Inner shadow
    ctx.fillStyle = 'rgba(0,0,0,0.1)';
    ctx.fillRect(x + 4, y + 4, ww - 8, 4);
}

function drawTextLabel(item) {
    var text = item.text || 'Label';
    var color = item.labelColor || '#ffffff';
    var fontSize = item.fontSize || 12;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold ' + fontSize + 'px "Press Start 2P", monospace';
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillText(text, item.x + 1, item.y + 1);
    ctx.fillStyle = color;
    ctx.fillText(text, item.x, item.y);
    ctx.restore();
}

console.log('🔧 VO Engine: About to define VOBuildingEngine class');
class VOBuildingEngine {
    /**
     * @param {Object} buildingConfig - The office config (walls, furniture, agents, etc.)
     *                                  If omitted, uses a blank default config.
     */
    constructor(buildingConfig) {
        // Store config for external use
        this._config = buildingConfig || {};

        // Inject config into module scope before calling loadOfficeConfig
        _externalOfficeConfig = Object.assign({
            canvasWidth: 1200,
            canvasHeight: 800,
            walls: { top: {}, interior: [] },
            furniture: [],
            floor: {},
            agents: [],
            branches: [],
        }, buildingConfig || {});

        // Set module-level globals from config
        W = _externalOfficeConfig.canvasWidth || 1200;
        H = _externalOfficeConfig.canvasHeight || 800;
        displayW = W;
        displayH = H;
        DPR = 1; // offscreen canvas — no device pixel ratio scaling needed

        // RESET office config completely, then apply building config
        // (prevents state leaking between buildings since this is a singleton module)
        officeConfig = {
            canvasWidth: W,
            canvasHeight: H,
            walls: {
                topWall: { color: '#37474f', accentColor: '#263238', trimColor: '#fff' },
                sections: [{ x: 0, w: W, color: '#37474f', accentColor: '#263238' }],
                height: 90,
                trimColor: '#fff',
                interior: [],
            },
            floor: { color1: '#c0c0c0', color2: '#b0b0b0' },
            furniture: [],
            branches: [],
            agents: [],
        };
        Object.assign(officeConfig, _externalOfficeConfig);
        if (!officeConfig.walls) officeConfig.walls = { topWall: {}, interior: [] };
        if (!officeConfig.walls.interior) officeConfig.walls.interior = [];
        if (!officeConfig.furniture) officeConfig.furniture = [];

        // Initialize office (furniture defaults, interaction spots, pets)
        initOfficeConfig();
        buildCollisionGrid();

        // Initialize empty agents (will be set via setAgents)
        // AGENT_DEFS stays empty until setAgents is called
    }

    /**
     * Update tick — call every frame to advance agent behaviors, animations, mini-games.
     * Does NOT draw anything.
     * @param {number} deltaTime - milliseconds since last tick (optional)
     */
    tick(deltaTime) {
        _updateAmbientCache();

        // Update agents
        agents.forEach(a => {
            a.update();
            maybeThrowAirplane(a);
            maybeStartRPS(a);
            maybeStartSocial(a);
            maybeStartDarts(a);
            maybeStartPong(a);
            _maybePetInteraction(a);
            if (a._petCooldown > 0) a._petCooldown--;
        });

        updatePets();
        updateAirplanes();
        updateRPS();
        updateSocialInteractions();
        updateGatherings();
        maybeStartGathering();
        updateDartGames();
        updatePongGames();
    }

    /**
     * Render the full building interior to the provided canvas.
     * The canvas should be sized to officeConfig.canvasWidth x canvasHeight.
     * @param {HTMLCanvasElement|OffscreenCanvas} canvas
     */
    renderToCanvas(canvas) {
        // Set module-level context so all VO drawing functions work
        ctx = canvas.getContext('2d');

        // Sync dimensions from canvas
        displayW = canvas.width;
        displayH = canvas.height;

        // Clear
        ctx.fillStyle = '#263238';
        ctx.fillRect(0, 0, displayW, displayH);

        // Draw world with camera transform
        ctx.save();
        applyCameraTransform();

        // Clip to world bounds
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, W, H);
        ctx.clip();

        // Environment (floor, outer walls, furniture layer 1)
        drawEnvironment();
        _rimFrame++;

        // Split agents into behind-wall and front-wall
        var _behindWallDesks = [];
        agents.forEach(a => {
            if (_isDeskBehindHorizontalWall(a.desk.x, a.desk.y)) {
                _behindWallDesks.push(a);
            } else {
                ctx.save();
                ctx.translate(a.desk.x, a.desk.y);
                a._drawDeskCharItem(ctx);
                ctx.restore();
            }
        });

        var _allEntities = agents.concat(officePets);
        _allEntities.sort((a, b) => a.y - b.y);
        var _behindWalls = [], _frontWalls = [];
        _allEntities.forEach(function(a) {
            if (_isAgentBehindHorizontalWall(a)) _behindWalls.push(a);
            else _frontWalls.push(a);
        });

        // Draw behind-wall desk items and agents
        _behindWallDesks.forEach(function(a) {
            ctx.save();
            ctx.translate(a.desk.x, a.desk.y);
            a._drawDeskCharItem(ctx);
            ctx.restore();
        });
        _behindWalls.forEach(function(a) { a.draw(); });

        // Wall occluders
        drawInteriorWallOccluders();

        // Redraw vertical walls that go down (on top of occluders)
        var _intWalls = (officeConfig.walls && officeConfig.walls.interior) || [];
        _intWalls.forEach(function(wall, idx) {
            if (wall.x1 === wall.x2 && _verticalWallGoesDown(wall, _intWalls)) {
                _drawSingleWall(wall, idx);
            }
        });

        // Redraw furniture in front of walls
        officeConfig.furniture.forEach(function(item) {
            if (item.type === 'branchSign' || item.type === 'textLabel') return;
            if (item.type === 'wall' || item.type === 'door') return;
            if (_isFurnitureNearHorizontalWall(item) && _isFurnitureInFrontOfWall(item)) {
                drawFurnitureItem(item);
            }
        });

        // Redraw in-front desk char items near walls
        agents.forEach(function(a) {
            if (_behindWallDesks.indexOf(a) >= 0) return;
            var deskItem = officeConfig.furniture.find(function(f) {
                return (f.type === 'desk' || f.type === 'bossDesk') && f.x === a.desk.x && f.y === a.desk.y;
            });
            if (deskItem && _isFurnitureNearHorizontalWall(deskItem) && _isFurnitureInFrontOfWall(deskItem)) {
                ctx.save();
                ctx.translate(a.desk.x, a.desk.y);
                a._drawDeskCharItem(ctx);
                ctx.restore();
            }
        });

        // Labels on top of walls
        officeConfig.furniture.forEach(function(item) {
            if (item.type === 'branchSign' || item.type === 'textLabel') drawFurnitureItem(item);
        });

        // Ambient overlay
        drawAmbientOverlay();
        drawNeonSigns();
        drawDeskLamps();
        drawDeskLampGlows();
        drawOfficeLamps();
        drawLightGlows();

        // Front agents (after ambient)
        _frontWalls.forEach(function(a) { a.draw(); });
        drawAgentLampBounce();

        // Mini-games and interactions
        drawAirplanes();
        drawRPS();
        drawSocialInteractions();
        drawGatherings();
        drawDartGames();
        drawPongGames();

        ctx.restore(); // close clip
        ctx.restore(); // close camera

        // Chat bubbles (screen space with camera transform)
        ctx.save();
        applyCameraTransform();
        drawChatBubbles();
        ctx.restore();

        // Zoom indicator
        const zoomAge = Date.now() - _zoomIndicatorTimer;
        if (zoomAge < 2000) {
            const alpha = zoomAge < 1500 ? 0.8 : 0.8 * (1 - (zoomAge - 1500) / 500);
            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.fillStyle = 'rgba(0,0,0,0.6)';
            ctx.fillRect(displayW - 80, 8, 72, 22);
            ctx.fillStyle = '#ffd700';
            ctx.font = '10px monospace';
            ctx.textAlign = 'right';
            ctx.fillText(camera.zoom.toFixed(1) + 'x', displayW - 14, 23);
            ctx.restore();
        }

        // Edit mode overlay
        if (editMode) {
            ctx.save();
            applyCameraTransform();
            drawEditOverlay();
            ctx.restore();
            drawEditHUD();
        }
    }

    // ─── Agent Management ─────────────────────────────────────────────────

    /**
     * Replace the entire agent roster.
     * @param {Array} agentDataArray - Array of agent data objects:
     *   { id, statusKey, name, emoji, role, branch, color, gender, appearance?, desk? }
     */
    setAgents(agentDataArray) {
        if (!Array.isArray(agentDataArray)) return;
        AGENT_DEFS = agentDataArray.map(function(a, idx) {
            return {
                id: a.statusKey || a.id,
                statusKey: a.statusKey || a.id,
                name: a.name || a.id,
                emoji: a.emoji || '🤖',
                role: a.role || '',
                branch: a.branch || 'UNASSIGNED',
                color: a.color || '#607d8b',
                gender: a.gender || (idx % 2 === 0 ? 'M' : 'F'),
                appearance: a.appearance || null,
            };
        });
        _autoAssignDesks(AGENT_DEFS);
        _initAgentsFromDefs();
    }

    /**
     * Update a single agent's status/task.
     * @param {string} agentId
     * @param {string} status - 'working' | 'idle' | 'break' | 'meeting' | etc.
     * @param {string} [task]
     */
    updateAgentStatus(agentId, status, task) {
        var agent = agentMap[agentId];
        if (!agent) return;
        const newTask = task || '';
        if (newTask !== agent.task) agent.task = newTask;
        if (status !== agent.state) {
            agent.moveTo(status);
        }
    }

    /**
     * Inject thought/speech bubbles for an agent.
     */
    updateAgentBubbles(agentId, thought, speech, speechTarget) {
        var agent = agentMap[agentId];
        if (!agent) return;
        if (thought !== undefined && thought !== agent.thought) {
            agent.thought = thought;
            agent.lastThought = thought;
            agent.thoughtChars = 0;
            agent.thoughtAge = 0;
            if (thought) getBubbleMinState(agent).thought = false;
        }
        if (speech !== undefined && speech !== agent.speech) {
            agent.speech = speech;
            agent.speechTarget = speechTarget || '';
            agent.lastSpeech = speech;
            agent.speechChars = 0;
            agent.speechAge = 0;
            agent.talkTimer = 60;
            if (speech) getBubbleMinState(agent).speech = false;
        }
    }

    // ─── External Data Injection ──────────────────────────────────────────

    /**
     * Inject weather data for window rendering.
     * @param {Object} data - { condition, code, temp, wind, humidity, ... }
     */
    setWeather(data) {
        if (data && typeof data === 'object') {
            Object.assign(weatherData, data);
        }
    }

    /**
     * Inject live chat bubble data.
     * @param {Object} data - { agentKey: [{text, isUser}...] }
     */
    setChatData(data) {
        if (!data || typeof data !== 'object') return;
        for (var key in data) {
            var msgs = data[key];
            var lastMsg = msgs[msgs.length - 1];
            var lastText = lastMsg ? lastMsg.text : '';
            if (lastText !== chatLastMsg[key]) {
                chatTypewriterState[key] = { charIdx: 0, targetText: lastText, done: false, msgIdx: msgs.length - 1 };
                if (_chatInitialLoad) {
                    chatMinimized[key] = true;
                } else {
                    chatMinimized[key] = false;
                }
                chatScrollOffset[key] = 0;
            }
            chatLastMsg[key] = lastText;
            agentChatData[key] = msgs;
        }
        _chatInitialLoad = false;
    }

    // ─── Edit Mode ────────────────────────────────────────────────────────

    enterEditMode() { editMode = true; _undoStack = []; _hasUnsavedChanges = false; }
    exitEditMode() {
        editMode = false;
        editHoverTile = null;
        _floorEditMode = false;
        if (_hasUnsavedChanges) saveOfficeConfig();
        _undoStack = [];
        _hasUnsavedChanges = false;
    }
    getConfig() { return JSON.parse(JSON.stringify(officeConfig)); }

    /**
     * Register a callback for when config changes (user edits and saves).
     * @param {Function} fn - called with (configObject)
     */
    onConfigChange(fn) { _onConfigChange = fn; }

    /**
     * Register a callback for activity log messages.
     * @param {Function} fn - called with (message string)
     */
    onLog(fn) { _onLog = fn; }

    // ─── Input Forwarding ─────────────────────────────────────────────────

    handlePointerDown(e) {
        if (editMode) {
            if (e.button === 0 && !placingType) {
                var world = screenToWorld(e.clientX, e.clientY);
                _editMouseDownPos = { x: e.clientX, y: e.clientY };
                _editMouseMoved = false;
                // Check for item under pointer
                var item = _findFurnitureAt(world.x, world.y);
                if (item && (item.id === selectedItemId || _multiSelected.includes(item.id))) {
                    isDragging = true;
                    dragOffset = { x: world.x - item.x, y: world.y - item.y };
                } else if (!item) {
                    // Start marquee
                    _marqueeStart = { x: world.x, y: world.y };
                    _marqueeEnd = null;
                }
            }
        }
        // Pan
        if (e.button === 0 || e.pointerType === 'touch') {
            _isPanning = true;
            _panStartX = e.clientX;
            _panStartY = e.clientY;
            _camStartX = camera.x;
            _camStartY = camera.y;
            _clickStartX = e.clientX;
            _clickStartY = e.clientY;
        }
    }

    handlePointerMove(e) {
        const rect = { left: 0, top: 0, width: displayW, height: displayH };
        if (_isPanning) {
            const base = getBaseScale();
            const dx = (e.clientX - _panStartX) * (displayW / displayW) / (base * camera.zoom);
            const dy = (e.clientY - _panStartY) * (displayH / displayH) / (base * camera.zoom);
            camera.x = _camStartX - dx;
            camera.y = _camStartY - dy;
            clampCamera();
        }
        if (editMode) {
            var world = screenToWorld(e.clientX, e.clientY);
            editHoverTile = { tx: Math.floor(world.x / TILE), ty: Math.floor(world.y / TILE) };
            if (_editMouseDownPos) {
                var dm = Math.hypot(e.clientX - _editMouseDownPos.x, e.clientY - _editMouseDownPos.y);
                if (dm > 4) _editMouseMoved = true;
            }
            if (isDragging && selectedItemId) {
                var selItem = officeConfig.furniture.find(f => f.id === selectedItemId);
                if (selItem) {
                    selItem.x = Math.round((world.x - dragOffset.x) / TILE) * TILE;
                    selItem.y = Math.round((world.y - dragOffset.y) / TILE) * TILE;
                    buildCollisionGrid();
                }
            } else if (_marqueeStart) {
                _marqueeEnd = { x: world.x, y: world.y };
            }
            _updateFloatingToolbarPosition();
        }
    }

    handlePointerUp(e) {
        _isPanning = false;
        if (editMode) {
            if (isDragging) {
                isDragging = false;
                _hasUnsavedChanges = true;
                _pushUndo();
            }
            if (_marqueeStart && _marqueeEnd) {
                // Select items in marquee
                var mx1 = Math.min(_marqueeStart.x, _marqueeEnd.x);
                var my1 = Math.min(_marqueeStart.y, _marqueeEnd.y);
                var mx2 = Math.max(_marqueeStart.x, _marqueeEnd.x);
                var my2 = Math.max(_marqueeStart.y, _marqueeEnd.y);
                _multiSelected = officeConfig.furniture
                    .filter(f => f.x >= mx1 && f.x <= mx2 && f.y >= my1 && f.y <= my2)
                    .map(f => f.id);
                _marqueeStart = null; _marqueeEnd = null;
            } else if (!_editMouseMoved && _editMouseDownPos) {
                var world = screenToWorld(e.clientX, e.clientY);
                handleEditClick(world.x, world.y, e.clientX, e.clientY, e);
            }
            _editMouseDownPos = null;
        } else {
            // Normal mode click
            var dx = Math.abs(e.clientX - (_clickStartX || e.clientX));
            var dy = Math.abs(e.clientY - (_clickStartY || e.clientY));
            if (dx < 5 && dy < 5) {
                handleCanvasClick(e.clientX, e.clientY);
                handleChatBubbleClick(
                    screenToWorld(e.clientX, e.clientY).x,
                    screenToWorld(e.clientX, e.clientY).y
                );
                handleBubbleClick(
                    screenToWorld(e.clientX, e.clientY).x,
                    screenToWorld(e.clientX, e.clientY).y
                );
            }
        }
    }

    handleWheel(e, canvasBounds) {
        e.preventDefault && e.preventDefault();
        // Check if over a chat bubble
        const world = screenToWorld(e.clientX, e.clientY);
        for (var wi = 0; wi < renderedChatBubbles.length; wi++) {
            var wb = renderedChatBubbles[wi];
            var wr = wb.fullRect;
            if (world.x >= wr.x && world.x <= wr.x + wr.w && world.y >= wr.y && world.y <= wr.y + wr.h) {
                if (e.deltaY < 0 && wb.canScrollUp) chatScrollOffset[wb.agentKey] = (chatScrollOffset[wb.agentKey] || 0) + 2;
                else if (e.deltaY > 0 && wb.canScrollDown) chatScrollOffset[wb.agentKey] = Math.max(0, (chatScrollOffset[wb.agentKey] || 0) - 2);
                return;
            }
        }
        // Zoom
        const bounds = canvasBounds || { left: 0, top: 0, width: displayW, height: displayH };
        const mouseX = (e.clientX - bounds.left) * (displayW / bounds.width);
        const mouseY = (e.clientY - bounds.top) * (displayH / bounds.height);
        const oldZoom = camera.zoom;
        const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
        camera.zoom = Math.max(CAM_ZOOM_MIN, Math.min(CAM_ZOOM_MAX, camera.zoom * zoomFactor));
        const base = getBaseScale();
        const zoomRatio = camera.zoom / oldZoom;
        const cx = displayW / 2, cy = displayH / 2;
        camera.x += (mouseX - cx) * (1 - 1 / zoomRatio) / (base * camera.zoom);
        camera.y += (mouseY - cy) * (1 - 1 / zoomRatio) / (base * camera.zoom);
        clampCamera();
        _zoomIndicatorTimer = Date.now();
    }

    handleKeyDown(e) {
        if (e.key === 'Escape') {
            if (editMode) { this.exitEditMode(); return; }
            if (placingType) { _cancelPlacement(); return; }
        }
        if (editMode) {
            if (e.key === 'Delete' || e.key === 'Backspace') _deleteSelectedItem();
            if ((e.ctrlKey || e.metaKey) && e.key === 'z') undoEdit();
            if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveEdits(); }
        }
    }

    // ─── Camera Control ────────────────────────────────────────────────────

    resetCamera() { resetCamera(); }
    setCamera(x, y, zoom) {
        camera.x = x !== undefined ? x : camera.x;
        camera.y = y !== undefined ? y : camera.y;
        camera.zoom = zoom !== undefined ? zoom : camera.zoom;
        clampCamera();
    }
    getCamera() { return { x: camera.x, y: camera.y, zoom: camera.zoom }; }

    // ─── Meetings ─────────────────────────────────────────────────────────

    processMeetings(meetingsData) { processMeetings(meetingsData); }

    // ─── Cleanup ──────────────────────────────────────────────────────────

    destroy() {
        agents.length = 0;
        agentMap = {};
        officePets.length = 0;
        pongGames.length = 0;
        rpsGames.length = 0;
        socialInteractions.length = 0;
        _onConfigChange = null;
        _onLog = null;
        _externalOfficeConfig = null;
        ctx = null;
    }
}

exports.VOBuildingEngine = VOBuildingEngine;
window.VOBuildingEngine = VOBuildingEngine;

// ─── GLOBAL AGENT DRAWING (for world-view agent sprites) ────
// Exposes the VO drawing functions so agents can be rendered outside of buildings
window.voDrawAgent = function(targetCtx, agentData, x, y) {
    // Temporarily set the module-level ctx so VO drawing functions work
    var savedCtx = ctx;
    ctx = targetCtx;

    ctx.save();
    ctx.translate(x, y);

    var tick = agentData._tick || 0;
    var isMoving = agentData._walking || false;
    var faceDir = (agentData.dir === 'left') ? -1 : 1;
    var appearance = agentData._appearance || getDefaultAppearance(agentData.id || 'agent', agentData.gender);
    var isFemale = (appearance.gender === 'F');
    var shirtColor = appearance.shirtColor || agentData.color || '#1565c0';

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.beginPath();
    ctx.ellipse(0, 4, 12, 5, 0, 0, Math.PI * 2);
    ctx.fill();

    var breathe = !isMoving ? Math.sin(tick * 0.05) * 1 : 0;
    var walkBob = isMoving ? Math.abs(Math.sin(tick * 0.2)) * 4 : 0;
    var legOffset = isMoving ? Math.sin(tick * 0.2) * 6 : 0;

    ctx.translate(0, -walkBob);

    // Legs + pants
    ctx.fillStyle = appearance.pantsColor || '#263238';
    ctx.fillRect(-10, -7, 8, 12 + legOffset);
    ctx.fillRect(2, -7, 8, 12 - legOffset);

    // Shoes
    ctx.fillStyle = appearance.shoeColor || '#3e2723';
    ctx.fillRect(-11, 5 + legOffset, 10, 3);
    ctx.fillRect(1, 5 - legOffset, 10, 3);

    ctx.translate(0, breathe);

    // Body
    ctx.fillStyle = shirtColor;
    if (isFemale) {
        ctx.fillRect(-9, -22, 18, 6);
        ctx.fillRect(-8, -16, 16, 9);
    } else {
        ctx.fillRect(-10, -22, 20, 15);
    }

    // Collar
    ctx.fillStyle = darken(shirtColor, 0.15);
    ctx.fillRect(-4, -20, 8, 2);

    // Arms
    var armW = isFemale ? 3 : 4;
    var armSwing = isMoving ? Math.sin(tick * 0.2) * 3 : 0;
    ctx.fillStyle = shirtColor;
    ctx.fillRect(isFemale ? -11 : -12, -20 + armSwing, armW, 10);
    ctx.fillRect(9, -20 - armSwing, armW, 10);

    // Hands
    ctx.fillStyle = appearance.skinTone || '#ffcc80';
    ctx.fillRect(isFemale ? -11 : -12, -10 + armSwing, 3, 3);
    ctx.fillRect(9, -10 - armSwing, 3, 3);

    // Head
    ctx.fillStyle = appearance.skinTone || '#ffcc80';
    ctx.fillRect(-12, -38, 24, 18);

    // Hair (uses VO's _drawHairByConfig)
    _drawHairByConfig(ctx, appearance.hairStyle, appearance.hairColor, appearance.hairHighlight);

    // Eyebrows
    var eyeShift = faceDir === 1 ? 0 : -2;
    var _ebStyle = appearance.eyebrowStyle || (isFemale ? 'thin' : 'thick');
    if (_ebStyle === 'thin') {
        ctx.fillStyle = '#5d4037';
        ctx.fillRect(-5 + eyeShift, -33, 4, 1); ctx.fillRect(4 + eyeShift, -33, 4, 1);
        ctx.fillRect(-6 + eyeShift, -34, 2, 1); ctx.fillRect(7 + eyeShift, -34, 2, 1);
    } else if (_ebStyle === 'arched') {
        ctx.fillStyle = '#5d4037';
        ctx.fillRect(-5 + eyeShift, -34, 4, 1); ctx.fillRect(4 + eyeShift, -34, 4, 1);
        ctx.fillRect(-7 + eyeShift, -35, 2, 1); ctx.fillRect(8 + eyeShift, -35, 2, 1);
    } else if (_ebStyle === 'angular') {
        ctx.fillStyle = '#3e2723';
        ctx.fillRect(-5 + eyeShift, -35, 5, 1); ctx.fillRect(4 + eyeShift, -35, 5, 1);
        ctx.fillRect(-5 + eyeShift, -34, 2, 1); ctx.fillRect(8 + eyeShift, -34, 2, 1);
    } else {
        ctx.fillStyle = '#3e2723';
        ctx.fillRect(-5 + eyeShift, -34, 5, 2); ctx.fillRect(4 + eyeShift, -34, 5, 2);
    }

    // Eyes
    var blink = (tick % 180) < 4;
    if (blink) {
        ctx.fillStyle = '#d7ccc8';
        ctx.fillRect(-5 + eyeShift, -29, 5, 1);
        ctx.fillRect(4 + eyeShift, -29, 5, 1);
    } else {
        ctx.fillStyle = '#fff';
        ctx.fillRect(-6 + eyeShift, -31, 6, 5);
        ctx.fillRect(3 + eyeShift, -31, 6, 5);
        ctx.fillStyle = appearance.eyeColor || '#212121';
        ctx.fillRect(-4 + eyeShift, -30, 3, 4);
        ctx.fillRect(5 + eyeShift, -30, 3, 4);
        ctx.fillStyle = '#fff';
        ctx.fillRect(-3 + eyeShift, -30, 1, 1);
        ctx.fillRect(6 + eyeShift, -30, 1, 1);
        if (isFemale) {
            ctx.fillStyle = '#212121';
            ctx.fillRect(-7 + eyeShift, -32, 1, 2);
            ctx.fillRect(8 + eyeShift, -32, 1, 2);
        }
    }

    // Nose
    var skin = appearance.skinTone || '#ffcc80';
    ctx.fillStyle = darken(skin, 0.15);
    ctx.fillRect(0, -27, 2, 2);

    // Mouth
    if (isFemale) {
        ctx.fillStyle = '#c4626a';
        ctx.fillRect(-2, -24, 5, 2);
        ctx.fillStyle = '#d47a82';
        ctx.fillRect(-1, -24, 3, 1);
    } else {
        ctx.fillStyle = darken(skin, 0.25);
        ctx.fillRect(-2, -24, 4, 1);
    }

    // Facial hair
    if (appearance.facialHair) {
        var fhColor = appearance.facialHairColor || darken(skin, 0.4);
        ctx.fillStyle = fhColor;
        if (appearance.facialHair === 'stubble') {
            ctx.globalAlpha = 0.4; ctx.fillRect(-8, -26, 16, 4); ctx.globalAlpha = 1;
        } else if (appearance.facialHair === 'beard') {
            ctx.fillRect(-8, -27, 16, 8); ctx.fillStyle = skin; ctx.fillRect(-3, -26, 6, 3);
        } else if (appearance.facialHair === 'goatee') {
            ctx.fillRect(-4, -25, 8, 4);
        } else if (appearance.facialHair === 'mustache') {
            ctx.fillRect(-5, -27, 10, 2);
        }
    }

    // Glasses (uses VO's _drawGlasses)
    _drawGlasses(ctx, appearance.glasses, appearance.glassesColor, eyeShift);

    // Headwear (uses VO's _drawHeadwear)
    if (appearance.headwear) {
        _drawHeadwear(ctx, appearance.headwear, appearance.headwearColor, isMoving);
    }

    // Emoji badge
    ctx.font = '8px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(agentData.emoji || '🤖', 0, -12);

    ctx.restore();

    // Restore saved ctx
    ctx = savedCtx;
};

// Also expose getDefaultAppearance globally
window.voGetDefaultAppearance = getDefaultAppearance;

} catch(e) { console.error('VO-ENGINE INIT ERROR:', e.message, e.stack?.split('\n').slice(0,3).join(' | ')); }

})(window.VOEngine = window.VOEngine || {});

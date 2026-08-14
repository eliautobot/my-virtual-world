# v1.0.61 — Living World Visual Upgrade

Released: August 13, 2026

This release gives My Virtual World a major environmental and architectural
visual upgrade. Buildings now read as finished structures, vegetation is more
varied and better integrated with roads, birds behave like ambient wildlife,
and traffic uses detailed vehicles with lane-aware, curved movement.

## Richer natural world

- Adds five deterministic low-poly tree families: pine, round-canopy,
  broadleaf, cypress, and palm.
- Enlarges pine and cypress trees by 70% and gives round and broadleaf trees
  fuller crowns, taller trunks, and stronger silhouettes.
- Adds grass patches, large rock clusters, petaled wildflowers, raised rock
  mounds, grass tufts, and other deterministic terrain variation.
- Increases natural-detail placement density by 30% while sharing cached
  geometry and materials.
- Removes the unwanted flat colorful ground clusters and square stone sprites.
- Keeps every natural asset, including its visible canopy or footprint, clear
  of asphalt, gutters, curbs, sidewalks, intersections, and road end caps.
- Enforces the temporary world boundary at ±1000 for terrain, decorations,
  buildings, procedural chunks, and camera movement.

## Finished buildings

- Replaces surface-mounted window decals with real transparent facade openings
  and segmented wall geometry on every floor and exterior face.
- Gives offices larger commercial windows, stores continuous storefront glass,
  and homes detailed residential sash windows with frames, rails, mullions, and
  sills.
- Adds automatic two-panel sliding glass doors to offices while preserving
  store sliding doors and home swing doors.
- Adds finished commercial roof systems with parapets, coping, floor-driven AC
  units, vents, exhaust fans, skylights, and access hatches.
- Rebuilds residential roofs with opaque pitched panels, deterministic shingles,
  gable infill, ridge caps, fascia, rake trim, and realistic overhangs.
- Recomputes windows, roof equipment, shingles, and trim whenever a building is
  resized or its floor count changes.

## Ambient birds

- Replaces the former eight simple flying shapes with 28 desktop / 18 mobile
  low-poly birds containing shaped bodies, heads, eyes, beaks, feathered wings,
  tails, legs, and toes.
- Adds perched, walking, takeoff, flight, landing, and pooled hidden states.
- Keeps grounded wings folded rearward against the body and tail while flight
  wings flap naturally.
- Lets birds stand on exact park, grass, parapet, and residential ridge surfaces
  and follows live building height, rotation, and roof visibility.
- Spawns close flocks from random off-screen edges near visible habitats and
  retires departing birds only after they are outside the viewport and natural
  draw distance.
- Makes nearby agents scare complete grounded flocks while roof birds ignore
  agents below them.

## Detailed vehicles and natural traffic

- Upgrades cars, sedans, trucks, vans, and buses with type-specific bodies,
  windows, mirrors, lights, grilles, bumpers, doors, trim, route signs, roof
  equipment, wheels, and hubs.
- Places tire bottoms on the rendered roadway surface, including asphalt,
  gutters, intersections, curves, and endpoint turnaround pavement.
- Adds right-hand lanes, smooth sampled intersection curves, continuous tangent
  steering, traffic-light stopping, and intersection reservations.
- Restricts U-turns to true road-network endpoints and removes mid-street
  reversals caused by former spawn-point routes.
- Uses type-aware spacing and oriented vehicle footprints to prevent cars,
  trucks, vans, and buses from intersecting one another.
- Advances client smoothing along the authoritative route so vehicles cannot
  visually cut across a curved turn.

## Performance and verification

- Batches building facades, windows, natural details, and vehicle detail parts;
  distance-culls interior, door, and vehicle detail where appropriate.
- Builds new terrain chunks through a nearest-first per-frame queue and caches
  repeated terrain work to reduce map-pan stalls.
- Reduces a representative near-building scene from 1,804 render calls to
  roughly 1,513–1,592 and removes >100 ms frames from the measured map-pan
  sample in the software-rendered verification VM.
- Collapses 261 vehicle source-detail parts into 61 draw objects across the
  live 12-vehicle fleet.
- Adds deterministic smoke and unit coverage for natural placement, boundaries,
  road clearance, doors, windows, roofs, birds, vehicle geometry, route curves,
  U-turn placement, ride height, and collision footprints.
- Passes the complete application suite, realtime smoke suite, syntax and
  packaging checks, live browser verification, both health endpoints, and
  source/container hash parity.
- A 30-second live traffic audit sampled all 12 vehicles 300 times: all moved,
  with zero overlaps, off-road frames, wheel-height violations, or path
  reversals.

## Upgrade notes

No data migration is required. Rebuild both application services normally and
preserve the existing `vw-data` volume. Existing buildings, streets,
decorations, agents, provider configuration, sessions, and world state remain
compatible. Roadway-adjacent procedural or placed natural objects are cleaned
up conservatively during normal world loading so sidewalks remain visually
clear.

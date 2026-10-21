# The city

- **The world**: an island of 100 × 100 ft lots with roads (signals, bridges, lane profiles), parks, plazas, coasts,
  farmland, meadows, rivers, lakes and mountains; wildlife on land and in the water; weather and a day and night on a
  shared clock that administrators may speed up, pause or skip (`world.clock`).
- **Residents**: thousands of people generated from the world's seed, each with traits, a home, a job, a schedule and
  needs (hunger, energy, social, fun, hygiene). The simulation plans their days as motion plans the browser plays back:
  work shifts, meals at home or out (cafés, restaurants, venues with menus), errands, leisure, sleep.
- **Getting around**: walking, a player character in first or third person, drivable vehicles with real physics
  (Rapier), traffic, transit and boats; phone and desktop controls.
- **Watching**: guests may watch if the installation allows; the map, the selection card with live feeds, the activity
  log, search for people and places, a home view per account.
- **A world without a city**: an island may have no built-in city grid — `world.grid` with `nx` and `nz` 0 and
  `world.terrain.cityStreets` null. Everything is then built with the editor's own tools (roads and road grids, lots,
  buildings, terrain strokes); the level plain where a city would stand is open land like any other. Residents with no
  home wait out of town until there are roads to walk, traffic runs on the roads alone, and views start over that
  plain. (`shared/city.js` `hasCity`, `viewRect`; tested in `tests/no-city.test.mjs`.)

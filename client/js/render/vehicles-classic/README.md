# Vehicle geometry from My Virtual World Classic

Copyright (c) 2026 My Virtual World.

These original vehicle builders were copied from the owned My Virtual World source, with their executable geometry matching the deployed classic models. Only generated import-version query tokens were removed. `PROVENANCE.json` records source, deployed and adapted hashes.

In this repository the code and the models are part of My Virtual World, licensed under the PolyForm Noncommercial License 1.0.0 (see `LICENSE` here and at the repository's root).

The Next adapter maps its sedan/compact/SUV/van/taxi/bus to the corresponding original sedan/car/SUV/van/taxi/bus builders. It rotates +X-forward into +Z-forward, uniformly fits each complete vehicle inside the existing traffic footprint, seats the tires on the road, and merges source-material geometry for instancing. Taxi/bus fixed paint and glass/trim colors remain distinct from per-instance body paint. Traffic routes, density, speeds and signal behavior are not imported or changed.

Source templates are shared immutable geometry; disposal is whole-cache only after all instances are gone. Next's traffic renderer supplies instance poses and conservative camera/shadow visibility culling. No user, provider, app configuration or saved-world data is included.

## Functional night-light and wheel rig

The adapter tags only the original main front/rear lens geometry, without changing model shape or source builders. White headlights and red rear lamps follow the shared night uniform. Headlights have depth-tested additive road-light pools (projected road illumination, not hundreds of per-car shadow-casting spotlights).

All four road wheels are kept separate from the body and instanced using the original wheel geometry. Their rotation is traveled distance divided by measured tire radius, around the normalized vehicle-local +X axle, with the car's heading transforming both sides correctly. Stopped/paused cars do not acquire time-driven wheel motion. The SUV's fixed spare wheel remains part of its body equipment. Six vehicle types use a bounded 30 instanced batches total (body parts, road wheels and road pools); source traffic simulation and global lighting settings remain independent.

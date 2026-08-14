# v1.0.62 — Correct Vehicle Wheel Orientation

Released: August 13, 2026

This patch corrects the wheel and hub orientation on every traffic vehicle in
the Living World Visual Upgrade.

## Vehicle wheel correction

- Rotates car, sedan, truck, van, and bus wheel axles across the vehicle width
  so the tires roll in the front-to-back driving direction.
- Applies the same corrected axle orientation to the visible wheel hubs.
- Spins each tire around its native cylinder axle, preserving the correct
  orientation throughout driving, turning, stopping, and restarting.
- Keeps the existing roadway ride height, lane-aware traffic, curved turns,
  vehicle spacing, detail batching, and distance culling unchanged.

## Verification

- Adds a live wheel-axle diagnostic and renderer regression contracts.
- Verified all 48 wheels across the live 12-vehicle fleet, covering cars,
  sedans, trucks, vans, and buses.
- A timed 40-sample movement audit recorded zero axle-orientation, roadway
  height, off-road, overlap, or path-reversal violations.
- Passes the complete application test suite, JavaScript syntax checks, live
  browser inspection, both health endpoints, and source/container hash parity.

## Upgrade notes

No data migration is required. Rebuild both application services normally and
preserve the existing `vw-data` volume. All world state remains compatible.

# HeatFlow feature tracker

Legend: ✅ implemented · ⬜ future work or unverified acceptance

## Simulation and physics

- ✅ 3D room geometry with physical units; editable width, length and ceiling height
- ✅ Actual air heat capacity and free volume, independent layered building storage
- ✅ Conservative implicit multilayer conduction with separate inside/outside surface films
- ✅ Ground, adjoining-room and outdoor floor boundaries
- ✅ Delayed underfloor slab response and heat release after switch-off
- ✅ Ideal heat/cold sources and radiator/convector storage/emission presets
- ✅ Positioned or room-average thermostat sensing with lag and deadband
- ✅ Cached diffuse-gray radiosity, reciprocal view factors and furniture visibility
- ✅ Exact furniture union mass/volume, partial fluid cells, open face areas and small-cell merging
- ✅ Furniture surface convection, material resistance and per-piece thermal storage
- ✅ Solid overlap rejection and imported overlap diagnostics
- ✅ Wind/stack pressure-network ventilation, bidirectional openings and closed-envelope leakage
- ✅ Separate construction and ventilation loss accounting
- ✅ Staggered 3D momentum, physical viscosity, no-slip surfaces and Smagorinsky mixing
- ✅ Conservative bounded second-order heat transport and adaptive CFL-limited steps
- ✅ Residual pressure convergence, separate disconnected air regions and failure diagnostics
- ✅ Deterministic daily weather, orientation, window solar transmittance and furniture shading
- ✅ Exterior solar absorption, wind convection and sky/ground longwave exchange
- ✅ Fixed-reference stored energy and explicit source/external energy ledger

## Interaction and runtime

- ✅ Rotatable/zoomable 3D heat clouds, X/Y/Z slices, hover readouts and palettes
- ✅ Source/probe dragging, Shift-drag height, keyboard movement and coordinate controls
- ✅ Placeable/resizable/rotatable sofas, tables, cabinets and beds
- ✅ Airflow trails, heat-flow arrows and translucent illustrated house exterior
- ✅ Main-thread rendering with a module-worker solver and transferable field snapshots
- ✅ Stable display field identity; generation/revision rejection of stale snapshots
- ✅ Worker-side histories sampled in simulated time and achieved-speed reporting
- ✅ Fast/Coarse/Balanced/Fine 8/24/32/48-cell quality; Fast defaults new rooms to accelerated runs, with reset on quality changes
- ✅ Cached direct pressure solve in unobstructed rooms and bounded worker pacing with per-step budget checks
- ✅ Simple presets and an Advanced physics panel for construction/environment/sensor/emitter inputs
- ✅ Local named saves and v6 sharing, with v1–v5 compatibility readers
- ✅ Heating/cooling consumption, surface temperatures, component losses and energy diagnostics
- ✅ Vite/Svelte/TypeScript build, static hosting workflow and numerical regression tests

## Model limits and validation still required

- Furniture temperature is lumped per piece, not spatially resolved within each solid.
- Surface radiation uses geometric quadrature and grouped furniture faces; solar tracing samples apertures.
- Weather and material presets are synthetic/generic; the roof illustration has no attic air volume.
- Browser-scale turbulence and ventilation are approximations. One benchmark or a single grid comparison does not establish general building-design accuracy.
- ⬜ Expanded room scenarios and turbulent-flow benchmark coverage
- ⬜ Sustained interaction performance and ≥30 FPS measurements on a named reference laptop
- ⬜ Real-device mobile performance checks
- ⬜ Humidity, moisture, condensation and occupant comfort models
- ⬜ Custom floor plans, multiple rooms/floors, thermal bridges and detailed glazing
- ⬜ Live weather, measured calibration data, product/insulation databases and sensor integration
- ⬜ Time-lapse playback, exports, reports and user-shared preset library

See [VALIDATION.md](./VALIDATION.md) for test scenarios, tolerances and the limits of current evidence.

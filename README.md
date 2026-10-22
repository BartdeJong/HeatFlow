# HeatFlow

Interactive 3D room heat and airflow simulation, built with Svelte 5, TypeScript and Vite.

## Run

```sh
npm install
npm run dev      # open the URL printed by Vite
npm test         # physics, persistence, rendering and runtime tests
npm run benchmark # 300× worker pacing and energy checks in empty/furnished Fast rooms
npm run check    # TypeScript and Svelte checks
npm run build    # production files in dist/
```

## Physical model

Coordinates and inputs use metres, °C, watts and SI material properties. X is room width, Y is floor-plan length, and Z is height above the floor.

- **Air and stored heat:** air uses density × specific heat × actual free volume. Walls, ceiling, glazing and floor each have independent temperatures and heat storage. Construction layers specify thickness, conductivity, density and specific heat, ordered inside to outside. A conservative implicit finite-volume solve couples each layered surface to adjacent air. Surface films are separate from solid resistance.
- **Floor:** new rooms use a screed/concrete/insulation construction above a 10°C ground boundary. Outside-air and adjoining-room boundaries are available. Underfloor heating deposits power inside the slab, which keeps releasing stored heat after switch-off. The pitched roof is an exterior illustration above the simulated ceiling; no attic air is modeled.
- **Furniture:** sofas, tables, cabinets and beds use their actual component geometry. Exact union volumes determine displaced air and material heat capacity; partially occupied cells retain both air and solid storage. Open face areas preserve thin legs and gaps. Fluid volumes below 10% are merged with connected air neighbors for stability. Furniture is a lumped thermal mass per piece, with effective material resistance at its surfaces. Overlapping solid furniture placements are rejected; imported overlaps require correction.
- **Heaters:** ideal point heat/cold sources exchange energy directly with air. Radiator and convector presets add physical dimensions, thermal storage, convection and surface radiation. Their kW input is heat supplied to the emitter, so air delivery responds gradually. A thermostat can sense the room average or a positioned point with response lag. New-room sensing defaults to the center at 1.1m above the floor with 30 seconds of lag.
- **Radiation:** diffuse-gray surface radiation exchanges energy between solids, with reciprocal cached view factors, furniture visibility and a radiosity solve. Pair exchanges are equal and opposite. Geometric quadrature approximates view factors; small furniture faces with matching normals are grouped to keep the dense solve affordable. This is not a detailed optical model.
- **Ventilation:** open windows and doors exchange actual air rather than multiplying a U-value. A pressure network balances wind and stack flow, including simultaneous inflow/outflow through a single tall opening. Configurable closed-building leakage is separate from construction losses. New rooms default to 0.2 air changes/hour of permeability at a 4Pa reference pressure; its actual flow varies with the pressure solution.
- **Airflow:** optional convection uses a staggered-grid momentum solver, buoyancy, momentum advection, physical viscosity, no-slip surfaces, Smagorinsky unresolved mixing and residual-controlled pressure projection. Heat transport uses conservative bounded second-order reconstruction. Adaptive steps limit the Courant number to 0.5; disconnected air regions receive separate pressure gauges. Solver failures stop the run with a diagnostic.
- **Weather and sunlight:** constant conditions are the initial environment. Synthetic clear-day and cold-day presets repeat daily and provide outdoor temperature, wind, direct/diffuse irradiance and sky temperature. Orientation rotates the environment into room coordinates. Sampled rays trace direct window gains to the first surface or furniture component; diffuse gains are distributed conservatively. Open apertures allow rays to escape. Exterior surfaces include solar absorption, wind convection and sky/ground longwave exchange.

The model is intended for exploring room behavior. Humidity, condensation, porous upholstery flow, thermal bridges, complex glazing optics, multiple rooms and live weather are outside its scope. Synthetic weather and generic material/emitter properties are labeled presets rather than measured product or site data. Accuracy depends on grid resolution and scenario; see [VALIDATION.md](./VALIDATION.md) for the scope of the numerical checks.

## Controls and runtime

- Drag empty space to rotate; scroll or use **＋ / −** to zoom; **↺** resets the camera. Volume rendering uses WebGL2, with a projected Canvas2D fallback. X/Y/Z slices, probes, temperature clouds and airflow trails remain available.
- Drag sources/probes horizontally; **Shift-drag** changes height. Arrow keys move X/Y, **Page Up / Page Down** moves Z, and **Shift** increases the step. Sidebar coordinates allow precise placement.
- Add/select furniture to change dimensions, material or rotation. Drag it or its handle to move it; **R** rotates a focused handle. Furniture and room geometry changes restart the run.
- Click an opening marker or sidebar toggle to open or close it. Width, height, sill and wall position are adjustable.
- The physics panel offers floor and weather presets, **Fast / Coarse / Balanced / Fine** quality (8/24/32/48 cells along the longest dimension), and advanced layer, leakage, solar, sensor and emitter inputs. Fast is the default for new rooms and is designed for 300× runs. It retains layered solid storage, radiation, ventilation and conservative airflow/heat transport, with less spatial detail in plumes and temperatures. Saved rooms retain their resolution; quality changes restart the run.
- The solver runs in a module Web Worker, yielding in short computation chunks. Transferable field snapshots arrive about ten times/second. The main thread keeps a stable read-only field object for rendering; stale generation/revision snapshots are discarded after resets or edits. Probe histories are recorded against simulated time inside the worker.
- Requested speed and achieved speed are separate. The worker retains at most 100ms of requested progress across computation chunks, so short scheduling delays do not lose simulated time or build an unbounded backlog. It checks its budget after each adaptive physics step and records histories only when a sample is due. Unobstructed rooms use a cached direct pressure solve; furniture uses the general cut-cell solver. Detailed modes and demanding rooms may still exceed the computer's available capacity.
- Diagnostics expose air and surface temperatures, stored energy, ventilation, heating/cooling consumption, component boundary losses and energy-balance error. Stored energy uses a fixed 0°C reference. Material/geometry edits are accounted as controlled external energy interventions.

## Save and share

Named rooms are stored locally in the browser. Share format **v6** includes construction, environment, emitter, sensor and quality settings. Version 1–5 links and existing saves still load. Imported rooms retain their prior boundary-temperature intent and room-average sensing where no sensor was specified; their predicted temperatures change under the improved physics. Old ideal sources remain ideal sources.

See [FEATURES.md](./FEATURES.md) for implemented features and remaining work.

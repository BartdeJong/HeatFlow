# HeatFlow – Feature Tracker

Legend: ✅ done · 🚧 in progress · ⬜ not started

## Tech decisions
- Vite + Svelte 5 + TypeScript
- WebGL2 3D texture volume rendering + palette shader, projected Canvas2D fallback
- Physically calibrated units (m, °C, W, W/m²K)
- Static hosting (GitHub Pages workflow in `.github/workflows/deploy.yml`)

## MVP

### Core simulation
- ✅ Single heat source (drag-and-drop point source; also keyboard arrows)
- ✅ Adjustable heat source output (kW)
- ✅ 3D room geometry, adjustable width, length and ceiling height (2–10 m)
- ✅ Walls with a uniform insulation value (now derived from material + insulation layers)
- ✅ 3D grid thermal diffusion model (finite volume, stable dt, unit-tested)
- ✅ Real-time heatmap (smooth, bilinear-filtered gradient with adaptive scale)

### Controls
- ✅ Heat source intensity slider (kW)
- ✅ Global wall insulation slider
- ✅ Play / pause
- ✅ Reset
- ✅ Simulation speed selector (extra)
- ✅ Hover temperature readout + legend (extra)

### UI & interaction
- ✅ Rotatable 3D room, zoom, temperature volume and X/Y/Z slices
- ✅ Sidebar with grouped controls
- ✅ Efficient WebGL rendering
- ✅ Basic mobile support (stacked layout, touch drag, large targets)

### Persistence & sharing
- ✅ Save/load/delete named room configurations (localStorage)
- ✅ Shareable URL with encoded settings (`#c=…`, validated and clamped on load)

### Release
- ✅ README
- ✅ CI + GitHub Pages deploy workflow (runs once pushed to `main` with Pages enabled)
- ⬜ Real-device mobile performance check

## Known limitations
- Convection is a simplified 3D buoyancy model (20 cells along the longest dimension, not full CFD); toggling it restarts the simulation.
- The floor uses the wall construction and the ceiling uses roof insulation. Both exchange heat with outside air; a separate ground temperature is not modelled.
- Cold sources are plain heat sinks (AC / draught) with no thermostat setpoint.
- Open windows/doors are modelled as a high loss coefficient, not real airflow.
- Palette choice is not saved or shared.
- Room starts at 20 °C; outside temperature is adjustable (−30…40 °C) but constant over time.
- Changing room size restarts the simulation.
- Furniture changes restart the simulation. Solid parts use coarse voxels, so thin parts expand to grid cells and narrow gaps can close.

## Added after the MVP
- ✅ Windows & doors with open/closed state (click them on the wall or use the sidebar)
- ✅ Multiple heat sources (up to 8)
- ✅ Cold sources (AC, drafts, leaks)
- ✅ Wall materials (brick, concrete, wood, aerated concrete) + thickness + insulation type/thickness
- ✅ Convective airflow (hot air rises; buoyancy + pressure projection)
- ✅ Thermal camera palette
- ✅ Overlay graph: temperature over time (room average + up to 3 draggable probes)
- ✅ Share/save format v5, including furniture, source/probe Z coordinates and opening height/sill (old links and saves still load)
- ✅ Real-time (1×) and 10× simulation speeds
- ✅ Adjustable room length, width and ceiling height
- ✅ Adjustable outside temperature
- ✅ Heat loss through all six faces, with exact rectangular opening areas
- ✅ 3D source/probe positioning: drag, Shift-drag height, keyboard and coordinate sliders
- ✅ Energy-conserving 3D convection with buoyancy along Z
- ✅ Interior heat clouds and temperature-coloured airflow trails following the simulated 3D velocity field
- ✅ Placeable, resizable, rotatable sofas, tables, cabinets and beds, with wood/upholstery/metal materials
- ✅ Furniture redirects airflow, stores heat and exchanges it with air; combined thermal energy is conserved
- ✅ Furniture temperature readouts and geometry shared by physics, rendering, picking and trail occlusion

- ✅ Translucent house exterior with adjustable roof pitch and covering
- ✅ Separate roof insulation and U-value
- ✅ Optional thermostat with target and deadband controls
- ✅ Underfloor heating over the floor area
- ✅ Cumulative heating/cooling energy and component heat-loss readouts
- ✅ Heat-flow arrows in the 3D air volume

## Add-later (all ⬜)
- Humidity & moisture
- Custom room shapes / multi-room
- Multi-floor
- Time-lapse playback
- Floor plan import
- Insulation database
- IoT sensors
- Video export
- Heat-loss reports
- Efficiency scoring
- Plugin system
- Preset library
- User-shared simulations

# HeatFlow – Feature Tracker

Legend: ✅ done · 🚧 in progress · ⬜ not started

## Tech decisions
- Vite + Svelte 5 + TypeScript
- WebGL2 rendering (R16F texture + palette shader), Canvas2D fallback
- Physically calibrated units (m, °C, W, W/m²K)
- Static hosting (GitHub Pages workflow in `.github/workflows/deploy.yml`)

## MVP

### Core simulation
- ✅ Single heat source (drag-and-drop point source; also keyboard arrows)
- ✅ Adjustable heat source output (kW)
- ✅ 2D room geometry, adjustable width/height (2–10 m)
- ✅ Walls with a uniform insulation value (now derived from material + insulation layers)
- ✅ 2D grid thermal diffusion model (explicit finite difference, stable dt, unit-tested)
- ✅ Real-time heatmap (smooth, bilinear-filtered gradient with adaptive scale)

### Controls
- ✅ Heat source intensity slider (kW)
- ✅ Global wall insulation slider
- ✅ Play / pause
- ✅ Reset
- ✅ Simulation speed selector (extra)
- ✅ Hover temperature readout + legend (extra)

### UI & interaction
- ✅ Clean 2D canvas
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
- Convection is a simplified 2D side-section model (coarser 64-cell grid, not CFD); toggling it restarts the simulation.
- Cold sources are plain heat sinks (AC / draught) with no thermostat setpoint.
- Open windows/doors are modelled as a high loss coefficient, not real airflow.
- Palette choice is not saved or shared.
- Room starts at 20 °C; outside temperature is adjustable (−30…40 °C) but constant over time.
- Changing room size restarts the simulation.

## Added after the MVP
- ✅ Windows & doors with open/closed state (click them on the wall or use the sidebar)
- ✅ Multiple heat sources (up to 8)
- ✅ Cold sources (AC, drafts, leaks)
- ✅ Wall materials (brick, concrete, wood, aerated concrete) + thickness + insulation type/thickness
- ✅ Convective airflow (hot air rises; buoyancy + pressure projection)
- ✅ Thermal camera palette
- ✅ Overlay graph: temperature over time (room average + up to 3 draggable probes)
- ✅ Share/save format v2 (old links and saves still load)
- ✅ Real-time (1×) and 10× simulation speeds
- ✅ Adjustable room length, width and ceiling height
- ✅ Adjustable outside temperature

## Add-later (all ⬜)
- Humidity & moisture
- 3D simulation
- Custom room shapes / multi-room
- Furniture
- Multi-floor
- Vector field arrows
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

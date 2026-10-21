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
- ✅ Walls only, uniform insulation value (U-value)
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
- Pure diffusion: no convection (hot air does not rise).
- Outside temperature fixed at 0 °C; room starts at 20 °C.
- Changing room size restarts the simulation.

## Add-later (all ⬜)
- Windows & doors (insulation, open/closed)
- Multiple heat sources
- Cold sources (AC, drafts, leaks)
- Wall materials
- Convective airflow
- Humidity & moisture
- 3D simulation
- Custom room shapes / multi-room
- Furniture
- Multi-floor
- Vector field arrows
- Time-lapse playback
- Thermal camera palette
- Overlay graphs
- Floor plan import
- Insulation database
- IoT sensors
- Video export
- Heat-loss reports
- Efficiency scoring
- Plugin system
- Preset library
- User-shared simulations

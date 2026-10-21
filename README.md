# HeatFlow

Web-based simulation that visualizes how heat spreads inside a room and escapes through its walls.

## Run

```
npm install
npm run dev      # development server
npm test         # unit tests
npm run check    # type check
npm run build    # production build in dist/
```

## How it works

- 2D explicit finite-difference heat model (`src/sim`), in real units (m, °C, W, W/m²K).
- Heat and cold sources inject or remove power (kW) around their position; the perimeter loses heat as `U · A · ΔT`, with U from the wall material/insulation layers and per-opening U-values for windows and doors (open = large loss).
- Air diffusivity is boosted to mimic turbulent mixing, and a thermal-mass factor stands in for furniture and wall surfaces. With **Convection** on, the room becomes a side view and a buoyancy-driven flow solver (pressure projection + semi-Lagrangian advection) makes hot air rise. This is a simplified model.
- WebGL2 renders the temperature field as a smooth heatmap (Canvas2D fallback).
- Rooms can be saved in the browser and shared via a URL hash.

See [PLAN.md](./PLAN.md) and [FEATURES.md](./FEATURES.md).

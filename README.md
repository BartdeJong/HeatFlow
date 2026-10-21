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
- The heat source injects power (kW) into the cells around its position; the perimeter loses heat as `U · A · ΔT`.
- Air diffusivity is boosted to mimic turbulent mixing, and a thermal-mass factor stands in for furniture and wall surfaces. This is a simplified model: no convection yet.
- WebGL2 renders the temperature field as a smooth heatmap (Canvas2D fallback).
- Rooms can be saved in the browser and shared via a URL hash.

See [PLAN.md](./PLAN.md) and [FEATURES.md](./FEATURES.md).

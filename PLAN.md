# HeatFlow MVP Plan (historical)

The original 2D MVP below is complete. The current implementation uses a 3D finite-volume grid, 3D buoyancy and volumetric rendering; see README.md for the current model and controls, and FEATURES.md for current status.

Stack: Vite + Svelte + TypeScript, WebGL heatmap, calibrated physics, static hosting.
Progress is tracked in [FEATURES.md](./FEATURES.md).

## Architecture
```
src/
  sim/        Pure TS, no DOM: grid, solver, units, config types
  render/     WebGL heatmap renderer (float texture + colormap shader)
  state/      Svelte stores: config, run state
  persist/    localStorage + URL encoding (versioned schema)
  ui/         Sidebar, controls, canvas component, mobile layout
```
Simulation core is independent of UI so it is unit-testable (Vitest) and later swappable (3D, convection).

## Physics model
- Grid: cell size dx = 0.05 m (adjustable); room up to ~10×10 m → 200×200 cells.
- Temperature field T in °C; ambient outside fixed (default 0 °C), initial room 20 °C.
- Air heat equation: dT/dt = α∇²T + q/(ρ·c_p·V). Effective α is boosted (turbulent mixing, ~0.02 m²/s) to look plausible; documented as an approximation.
- Heat source: power P (kW) injected into the cell(s) around the point: ΔT = P·dt/(ρ·c_p·dx²·depth), depth = 1 m assumed (2D slice).
- Walls: boundary cells lose heat by Q = U·A·(T − T_out), with U (W/m²K) from the insulation slider (e.g. 0.2–3.0).
- Explicit scheme with substeps; dt ≤ dx²/(4α) for stability. Fixed sim-time multiplier (1×–600×) so heating is visible.

## Milestones
1. **Scaffold** – Vite/Svelte/TS, ESLint/Prettier, Vitest, CI workflow (build + test + deploy to Pages).
2. **Sim core** – grid, solver, units, tests (energy conservation, stability, steady state vs. analytic loss).
3. **Renderer** – WebGL float texture upload, colormap shader (smooth bilinear), resize/DPR handling; Canvas2D fallback if float textures are unavailable.
4. **Canvas interaction** – room drawn to scale, draggable heat source (pointer events: mouse + touch), temperature readout on hover.
5. **Controls/sidebar** – grouped: Room (width/height), Heat source (kW), Insulation (U), Simulation (play/pause, reset, speed). Legend with °C scale.
6. **Persistence** – versioned config schema; save/load named rooms in localStorage; share URL via compact query/hash (base64url JSON), validated and clamped on load.
7. **Mobile & polish** – responsive layout (sidebar → bottom sheet), touch targets, performance check (60 fps at 200×200), a11y labels.
8. **Release** – README, deploy to static hosting, update FEATURES.md.

## Acceptance criteria
- Dragging the source updates heating in real time; sliders affect the simulation immediately.
- Steady-state temperature rise approximates P / (ΣU·A) within a few %.
- Reload via shared URL reproduces the same setup.
- Smooth on a mid-range phone.

## Risks
- Float texture support on mobile → half-float / RGBA8 packing fallback.
- Explicit solver stability at large resolution → adaptive substeps + grid cap.
- Diffusion-only by default; an optional simplified convection mode (side view) was added later. Both are labelled as simplified models.

## Open decisions (defaults chosen, change if you disagree)
- Outside temperature fixed at 0 °C, adjustable later.
- Max room 10×10 m, min 2×2 m.

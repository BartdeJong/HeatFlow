# Numerical validation

Run `npm test`, `npm run check` and `npm run build` from the repository root. Tests establish the particular cases below; they do not certify all room configurations or real-world design accuracy.

| Area | Automated scenario | Acceptance checked |
| --- | --- | --- |
| Total stored energy | Insulated one-hour 100W slab run including air, walls, floor and ceiling (`realism.test.ts`) | Error below 0.1% of supplied energy; stronger regression tolerance is also enforced |
| Source/radiation energy | Radiator with partially occupied table; passive radiator while underfloor mode is active | Internal air/solid/radiation transfers close the energy ledger |
| Storage and reference | Slab after switch-off; outdoor-temperature change; emitter-capacity edit | Continued heat release; fixed 0°C energy reference; configuration interventions accounted externally |
| Air and furniture geometry | Air temperature increment, exact furniture component union volumes, grid translation (`grid.test.ts`, `realism.test.ts`) | Actual density × specific heat × free air volume; furniture mass independent of placement relative to mesh |
| Steady conduction | Layered brick/insulation wall with separate interior/exterior films (`thermal.test.ts`) | Analytical resistance heat flux within 1%; no duplicate surface resistance |
| Transient conduction | Concrete-slab spatial refinement, 6 versus 12 nodes per layer | Stored energy changes less than 2% after refinement |
| Radiation | Two diffuse-gray plates, isothermal enclosure, opaque obstruction (`radiation.test.ts`) | Analytic plate exchange within 1%; reciprocal factors; enclosure closure; equal/opposite pair exchanges |
| Weather and sunlight | Daily repetition, orientation, first-hit floor/furniture shading, opposite open aperture (`environment.test.ts`) | Reproducible forcing; direct/diffuse gain accounting including escaped rays |
| Ventilation | Wind reversal, leakage, closed/open windows and single-opening bidirectional flow (`ventilation.test.ts`) | Indoor pressure balances supply/exhaust; see individual test tolerances |
| Pressure and momentum | Still air, projected arbitrary flow, rising plume, disconnected air regions (`flow.test.ts`) | Residual convergence, low divergence, closed solid boundaries and independent pressure gauges |
| Natural convection | Low-Rayleigh square cavity (`cavity.test.ts`) | Mean Nusselt number within 5% of the published Ra=1000 reference, Nu=1.118 |
| Practical grid comparison | Balanced versus Fine, 180-second insulated underfloor run (`realism.test.ts`) | Occupied zone (0.1–1.8m) mean differs by less than 0.5°C; heating energy differs by less than 5%; both energy ledgers within 0.1% |
| Fast mode | Fast versus Balanced, 120-second default radiator/convection cold start (`quality-airflow.test.ts`) | Room-average difference below 0.1°C; maximum sampled occupied-point difference below 0.5°C; both energy ledgers within 0.1% |
| Direct pressure solve | Arbitrary flow in rectangular anisotropic/non-power-of-two grids (`flow.test.ts`) | One direct solve, residual below 1e-12 and divergence below 1e-10 s⁻¹; cut-cell/disconnected cases retain the iterative solver |
| Runtime and compatibility | Worker/direct snapshots, sampled histories, resets/revisions and versioned persistence | See runtime and persistence regression tests |

Grid comparisons cover a nonconvective slab-heating case, a 10-second radiator/convection cold start between Balanced and Fine, and a 120-second default radiator cold start between Fast and Balanced (`quality-airflow.test.ts`). Fast has only eight cells along the longest dimension: it is intended for accelerated room-scale exploration, with reduced accuracy for local plumes, small openings and furniture wakes. The cold-start comparison does not establish long-term spatial accuracy. With a constant heater input, consumption agreement checks clock/source accounting; it is not a validation of thermostat-controlled annual demand. Further representative rooms, convection, thermostat cycling, strong solar forcing and high wind need their own refinement studies.

The natural-convection reference is [de Vahl Davis (1983)](https://doi.org/10.1002/fld.1650030305). The benchmark uses the laminar 2D limit, disables Smagorinsky mixing and compares heat transfer at low Rayleigh number. It does not validate turbulent room plumes or all application transport/boundary combinations.

The conduction and radiation formulations follow the principles in the EnergyPlus engineering references for [fully implicit layered conduction](https://bigladdersoftware.com/epx/docs/25-2/engineering-reference/conduction-finite-difference-solution.html) and [inside surface heat balance](https://bigladdersoftware.com/epx/docs/26-1/engineering-reference/inside-heat-balance.html). HeatFlow is an independent reduced browser model.

## Performance evidence

The original Balanced browser smoke checks on 22 October 2026 achieved approximately 0.4–2.1× despite 300× requested. Fast mode now defaults new rooms to an eight-cell grid, while saved rooms retain their selected resolution. Unobstructed rooms use a cached separable Neumann pressure solve instead of hundreds of conjugate-gradient iterations. Worker budgets are checked after each adaptive physics step; histories are only sampled when due, and scheduling debt is capped at 100ms of requested progress.

On 22 October 2026, the local Windows/Chrome preview of the default 5×4×2.5m Fast room with convection, radiation and airflow trails displayed **300.0× achieved of 300× requested** after more than three simulated hours. `npm run benchmark` separately runs the worker engine with 10ms computation chunks, 4ms yields, 10Hz snapshots and a 600-second warm-up. Five-second measurements achieved **299.1×** for the default Fast room and **299.0×** with a wooden table, with relative energy errors below 1.1e-12 and no solver failures. The benchmark exits unsuccessfully below 285× (a 5% scheduling allowance), on solver failure, or above 0.1% relative energy error. Run it separately from CPU-heavy tests for comparable results.

These are scenario-specific measurements, not a hardware-independent guarantee. Detailed grids, high wind, intense point sources and complex furniture can remain CPU-limited. A sustained device/browser performance matrix and mobile hardware remain unverified.

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
| Runtime and compatibility | Worker/direct snapshots, sampled histories, resets/revisions and versioned persistence | See runtime and persistence regression tests |

Grid comparisons cover a nonconvective slab-heating case and a 10-second radiator/convection cold start (`quality-airflow.test.ts`); the latter measured a maximum occupied-point difference below 0.003°C between Balanced and Fine. With a constant heater input, consumption agreement checks clock/source accounting; it is not a validation of thermostat-controlled annual demand. Further representative rooms, convection, thermostat cycling, strong solar forcing and high wind need their own refinement studies.

The natural-convection reference is [de Vahl Davis (1983)](https://doi.org/10.1002/fld.1650030305). The benchmark uses the laminar 2D limit, disables Smagorinsky mixing and compares heat transfer at low Rayleigh number. It does not validate turbulent room plumes or all application transport/boundary combinations.

The conduction and radiation formulations follow the principles in the EnergyPlus engineering references for [fully implicit layered conduction](https://bigladdersoftware.com/epx/docs/25-2/engineering-reference/conduction-finite-difference-solution.html) and [inside surface heat balance](https://bigladdersoftware.com/epx/docs/26-1/engineering-reference/inside-heat-balance.html). HeatFlow is an independent reduced browser model.

## Performance evidence

Worker computation budgets and approximately 10Hz publication preserve main-thread scheduling, but cannot guarantee a frame rate on every device. Browser smoke checks on 22 October 2026 used an Apple M4 (Mac16,13), Codex in-app Chromium, the default 5×4×2.5m room at Balanced resolution with radiation, convection and airflow trails. Repeated one-second rendering readings were 43–56 FPS during active solver work, including concurrent test load. Achieved simulation speed was approximately 0.4–2.1× under that load despite 300× requested: acceleration remains CPU-limited and is reported honestly. These sampled readings meet the interaction target for this scenario; a sustained device/browser performance matrix and mobile hardware remain unverified.

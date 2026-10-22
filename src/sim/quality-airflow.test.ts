import { expect, it } from 'vitest';
import { DEFAULT_PHYSICS, DEFAULT_ROOM, sanitizeRoom } from './config';
import { DEFAULT_MODEL, emitterPreset } from './model';
import { Simulation } from './simulation';

it('keeps occupied-zone radiator heating consistent between Balanced and Fine airflow grids', () => {
  const seconds = 10;
  const runs = (['balanced', 'fine'] as const).map(quality => {
    const room = sanitizeRoom({ ...DEFAULT_ROOM, convection: true,
      model: { ...DEFAULT_MODEL, quality, leakageACH: 0 },
      sources: [{ id: 1, kind: 'heat', x: 2.5, y: 0.3, z: 0.6, powerKW: 1.54, emitter: emitterPreset('radiator') }] });
    const sim = new Simulation(room, DEFAULT_PHYSICS);
    const before = sim.energyJ();
    while (sim.elapsed < seconds - 1e-8) {
      const done = sim.advance(seconds - sim.elapsed);
      if (!(done > 0)) throw new Error(sim.diagnostics().failure ?? 'Radiator scenario made no progress');
    }
    const diagnostics = sim.diagnostics();
    expect(sim.elapsed).toBeCloseTo(seconds, 7);
    expect(diagnostics.failure).toBeNull();
    expect(diagnostics.pressureResidual).toBeLessThan(1e-5);
    expect(diagnostics.relativeEnergyError).toBeLessThan(0.001);
    // Stored energy plus the separately recorded net boundary exchange equals source input.
    const suppliedJ = sim.energyJ() - before - diagnostics.netExternalJ;
    expect(Math.abs(suppliedJ - 1540 * seconds) / (1540 * seconds)).toBeLessThan(0.001);
    const occupied: number[] = [];
    for (const x of [0.5, 1.5, 2.5, 3.5, 4.5]) for (const y of [0.5, 1.5, 2.5, 3.5]) for (const z of [0.6, 1.1, 1.7]) occupied.push(sim.sample(x, y, z));
    const maxVelocity = [sim.flow.u, sim.flow.v, sim.flow.w].reduce((largest, field) => field.reduce((maximum, value) => Math.max(maximum, Math.abs(value)), largest), 0);
    expect(maxVelocity).toBeGreaterThan(0.0001);
    expect(Number.isFinite(sim.stats().max)).toBe(true);
    return { occupied, suppliedJ };
  });
  let maximumTemperatureDifference = 0;
  runs[0].occupied.forEach((temperature, i) => { maximumTemperatureDifference = Math.max(maximumTemperatureDifference, Math.abs(temperature - runs[1].occupied[i])); });
  expect(maximumTemperatureDifference).toBeLessThan(0.5);
  expect(Math.abs(runs[0].suppliedJ - runs[1].suppliedJ) / runs[1].suppliedJ).toBeLessThan(0.05);
}, 60000);

import { expect, it } from 'vitest';
import { DEFAULT_MODEL } from '../sim/model';
import { DEFAULT_ROOM } from '../sim/config';
import { Simulation } from '../sim/simulation';
import { AirflowTrails, airflowHighlight, traceAirflow } from './airflow';
const model = { ...structuredClone(DEFAULT_MODEL), quality: 'coarse' as const, radiation: false, leakageACH: 0, floor: { ...structuredClone(DEFAULT_MODEL.floor), boundary: 'adjacent' as const, temperatureC: 20 }, environment: { ...DEFAULT_MODEL.environment, skyOffsetC: 0 } };

it('shows no airflow in still air', () => {
  const sim = new Simulation({ ...DEFAULT_ROOM, convection: true, sources: [], outsideC: 20, model });
  sim.advance(10);
  expect(Math.hypot(...sim.sampleVelocity(2.5,2,1.25))).toBeLessThan(1e-10);
  expect(traceAirflow(sim, [5, 4, 2.5], [2.5, 2, 1.25])).toHaveLength(1);
});

it('follows flow through the middle and stops at a room boundary', () => {
  const points = traceAirflow({ sampleVelocity: () => [0, 0, 1] }, [5, 4, 2.5], [2.5, 2, 1]);
  expect(points.length).toBeGreaterThan(10);
  expect(points.at(-1)![2]).toBeGreaterThan(2.3);
  for (let i = 0; i < points.length; i++) {
    expect(points[i][0]).toBe(2.5);
    expect(points[i][1]).toBe(2);
    expect(points[i][2]).toBeLessThan(2.5);
    if (i) expect(points[i][2]).toBeGreaterThan(points[i - 1][2]);
  }
});

it('follows simulated buoyancy above a heater and resets with the simulation', () => {
  const sim = new Simulation({ ...DEFAULT_ROOM, convection: true, outsideC: 20, model, sources: [{ ...DEFAULT_ROOM.sources[0], emitter: undefined, powerKW: .2 }] });
  for (let i=0;i<10;i++) { if(!sim.advance(1)) throw new Error(sim.diagnostics().failure ?? 'No time advanced'); }
  const seed: [number, number, number] = [2.5, 2, 0.9];
  expect(sim.sampleVelocity(...seed)[2]).toBeGreaterThan(0);
  const points = traceAirflow(sim, [5, 4, 2.5], seed);
  expect(points.at(-1)![2]).toBeGreaterThan(seed[2] + 0.5);
  expect(sim.sampleVelocity(0, 2, 1)[0]).toBe(0);
  expect(sim.sampleVelocity(2.5, 2, 2.5)[2]).toBe(0);
  sim.reset();
  expect(sim.sampleVelocity(...seed)).toEqual([0, 0, 0]);
});

it('crossfades rapid flow reversals and temperature changes in wall time', () => {
  let direction = 1, temperature = 30;
  const field = { sampleVelocity: (): [number, number, number] => [0, 0, direction], sample: () => temperature };
  const trails = new AirflowTrails();
  const seeds: [number, number, number][] = [[2, 2, 1]];
  trails.update(field, [5, 4, 2.5], seeds, 1, 0);
  trails.update(field, [5, 4, 2.5], seeds, 1, 0.25);
  const rising = trails.layers[1].trails;
  direction = -1; temperature = 50;
  trails.update(field, [5, 4, 2.5], seeds, 1000, 0);
  expect(trails.layers[0]).toEqual({ trails: rising, opacity: 1 });
  expect(trails.layers[1].opacity).toBe(0);
  trails.update(field, [5, 4, 2.5], seeds, 2000, 0.125);
  expect(trails.layers.map((l) => l.opacity)).toEqual([0.5, 0.5]);
  expect(trails.layers[0].trails[0].temperatures[0]).toBe(30);
  expect(trails.layers[1].trails[0].temperatures[0]).toBe(50);
  expect(trails.layers[1].trails[0].points.at(-1)![2]).toBeLessThan(1);
  const paused = structuredClone(trails.layers);
  trails.update(field, [5, 4, 2.5], seeds, 2000, 0);
  expect(trails.layers).toEqual(paused);
});

it('keeps seed identities when a path is blocked and clears history on reset', () => {
  const trails = new AirflowTrails();
  const field = { sampleVelocity: (): [number, number, number] => [0, 0, 1], sample: () => 20,
    isSolid: (x: number, _y: number, z: number) => x < 1 || z > 1.5 };
  trails.update(field, [5, 4, 2.5], [[0.5, 2, 1], [2, 2, 1]], 100, 0);
  const paths = trails.layers[1].trails;
  expect(paths).toHaveLength(2);
  expect(paths[0].points).toHaveLength(0);
  expect(paths[1].points.length).toBeGreaterThan(2);
  expect(paths[1].points.every((p) => !field.isSolid(...p))).toBe(true);
  trails.update(field, [5, 4, 2.5], [], 0, 0);
  expect(trails.layers.every((l) => l.trails.length === 0)).toBe(true);
  expect(trails.phase).toBe(0);
});

it('uses the same fade and pulse timing at different frame rates and simulation speeds', () => {
  const field = { sampleVelocity: (): [number, number, number] => [0, 0, 1], sample: () => 20 };
  const make = (frames: number, speed: number) => {
    const trails = new AirflowTrails();
    trails.update(field, [5, 4, 2.5], [[2, 2, 1]], 1, 0);
    for (let i = 1; i <= frames; i++) trails.update(field, [5, 4, 2.5], [[2, 2, 1]], 1 + i * speed, 0.125 / frames);
    return trails;
  };
  const a = make(4, 1), b = make(15, 1000);
  expect(a.layers[1].opacity).toBeCloseTo(b.layers[1].opacity);
  expect(airflowHighlight(a.phase, 3, 10)).toBeCloseTo(airflowHighlight(b.phase, 3, 10));
  // Pulse wraps continuously, without the previous hard on/off leading edge.
  expect(airflowHighlight(44 / 12 - 0.00001, 0, 0)).toBeCloseTo(airflowHighlight(44 / 12 + 0.00001, 0, 0));
});

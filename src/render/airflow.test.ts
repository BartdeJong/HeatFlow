import { expect, it } from 'vitest';
import { DEFAULT_ROOM } from '../sim/config';
import { Simulation } from '../sim/simulation';
import { traceAirflow } from './airflow';

it('shows no airflow in still air', () => {
  const sim = new Simulation({ ...DEFAULT_ROOM, convection: true, sources: [], outsideC: 20 });
  sim.advance(10);
  expect(sim.sampleVelocity(2.5, 2, 1.25)).toEqual([0, 0, 0]);
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
  const sim = new Simulation({ ...DEFAULT_ROOM, convection: true, outsideC: 20 });
  for (let i = 0; i < 25; i++) sim.advance(1);
  const seed: [number, number, number] = [2.5, 2, 0.9];
  expect(sim.sampleVelocity(...seed)[2]).toBeGreaterThan(0);
  const points = traceAirflow(sim, [5, 4, 2.5], seed);
  expect(points.at(-1)![2]).toBeGreaterThan(seed[2] + 0.5);
  expect(sim.sampleVelocity(0, 2, 1)[0]).toBe(0);
  expect(sim.sampleVelocity(2.5, 2, 2.5)[2]).toBe(0);
  sim.reset();
  expect(sim.sampleVelocity(...seed)).toEqual([0, 0, 0]);
});


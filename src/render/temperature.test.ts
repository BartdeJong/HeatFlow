import { expect, it } from 'vitest';
import { DEFAULT_ROOM } from '../sim/config';
import { Simulation } from '../sim/simulation';
import { TemperatureDisplay } from './temperature';

it('smooths sudden heat changes without changing the solver or probe temperatures', () => {
  const sim = new Simulation(DEFAULT_ROOM), display = new TemperatureDisplay();
  display.update(sim, 0);
  sim.T.fill(40);
  const stats = display.update(sim, 0.1);
  expect(stats.mean).toBeGreaterThan(20);
  expect(stats.mean).toBeLessThan(40);
  expect(display.sample(2, 2, 1)).toBeCloseTo(stats.mean);
  expect(sim.sample(2, 2, 1)).toBe(40);
  const paused = display.T.slice();
  display.update(sim, 0);
  expect(display.T).toEqual(paused);
  display.reset(); sim.reset();
  expect(display.update(sim, 0).mean).toBe(20);
});

it('has the same response at different frame rates and replaces old room geometry', () => {
  const sim = new Simulation(DEFAULT_ROOM);
  const a = new TemperatureDisplay(), b = new TemperatureDisplay();
  a.update(sim, 0); b.update(sim, 0); sim.T.fill(50);
  a.update(sim, 0.2);
  for (let i = 0; i < 12; i++) b.update(sim, 0.2 / 12);
  expect(a.T[0]).toBeCloseTo(b.T[0], 4);
  const newRoom = new Simulation({ ...DEFAULT_ROOM, widthM: 7 });
  expect(a.update(newRoom, 0).mean).toBe(20);
  expect(a.T.length).toBe(newRoom.T.length);
});

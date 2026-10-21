import { describe, expect, it } from 'vitest';
import { DEFAULT_PHYSICS, DEFAULT_ROOM, sanitizeRoom, sliderFromU, uFromSlider } from './config';
import { Simulation } from './simulation';

describe('Simulation', () => {
  it('stays at ambient with no heat source and no temperature difference', () => {
    const sim = new Simulation(
      { ...DEFAULT_ROOM, powerKW: 0 },
      { ...DEFAULT_PHYSICS, outsideC: 20 },
    );
    sim.advance(100);
    const s = sim.stats();
    expect(s.min).toBeCloseTo(20, 4);
    expect(s.max).toBeCloseTo(20, 4);
  });

  it('conserves energy when walls are perfectly insulated', () => {
    const sim = new Simulation({ ...DEFAULT_ROOM, uValue: 0 });
    const e0 = sim.energyJ();
    const t = sim.advance(50);
    const expected = DEFAULT_ROOM.powerKW * 1000 * t;
    expect(sim.energyJ() - e0).toBeGreaterThan(expected * 0.999);
    expect(sim.energyJ() - e0).toBeLessThan(expected * 1.001);
  });

  it('heats up near the source and spreads outward', () => {
    const sim = new Simulation(DEFAULT_ROOM);
    sim.advance(60);
    const near = sim.sample(DEFAULT_ROOM.sourceX, DEFAULT_ROOM.sourceY);
    const far = sim.sample(0.1, 0.1);
    expect(near).toBeGreaterThan(far);
  });

  it('reaches a steady state where wall loss equals source power', () => {
    const params = { ...DEFAULT_PHYSICS, massFactor: 0.05 };
    const room = { ...DEFAULT_ROOM, widthM: 3, heightM: 3, sourceX: 1.5, sourceY: 1.5 };
    const sim = new Simulation(room, params);
    for (let i = 0; i < 60; i++) sim.advance(5);
    const loss = sim.wallLossW();
    expect(Math.abs(loss - room.powerKW * 1000) / (room.powerKW * 1000)).toBeLessThan(0.02);
  });

  it('better insulation gives a hotter room', () => {
    const poor = new Simulation({ ...DEFAULT_ROOM, uValue: 2.5 });
    const good = new Simulation({ ...DEFAULT_ROOM, uValue: 0.3 });
    poor.advance(400);
    good.advance(400);
    expect(good.stats().mean).toBeGreaterThan(poor.stats().mean);
  });

  it('reset restores the initial state', () => {
    const sim = new Simulation(DEFAULT_ROOM);
    sim.advance(100);
    sim.reset();
    expect(sim.elapsed).toBe(0);
    expect(sim.stats().max).toBe(DEFAULT_PHYSICS.initialC);
  });
});

describe('config helpers', () => {
  it('sanitizes out-of-range values', () => {
    const c = sanitizeRoom({
      widthM: 99,
      heightM: NaN,
      powerKW: -5,
      uValue: 100,
      sourceX: 50,
      sourceY: -1,
    });
    expect(c.widthM).toBe(10);
    expect(c.heightM).toBe(2);
    expect(c.powerKW).toBe(0);
    expect(c.uValue).toBe(3);
    expect(c.sourceX).toBe(10);
    expect(c.sourceY).toBe(0);
  });

  it('round-trips the insulation slider', () => {
    expect(uFromSlider(sliderFromU(1.0))).toBeCloseTo(1.0, 6);
    expect(uFromSlider(0)).toBeCloseTo(3.0, 6);
    expect(uFromSlider(1)).toBeCloseTo(0.2, 6);
  });
});

import { describe, expect, it } from 'vitest';
import { DEFAULT_PHYSICS, DEFAULT_ROOM, coerceRoom, holdPowerKW, sanitizeRoom, wallU, type RoomConfig } from './config';
import { DEFAULT_MODEL, emitterPreset } from './model';
import { Recorder } from './recorder';
import { Simulation } from './simulation';
const room = (patch: Partial<RoomConfig> = {}): RoomConfig => ({ ...structuredClone(DEFAULT_ROOM), convection: false,
  sources: [{ id: 1, kind: 'heat', x: 2.5, y: 2, z: .4, powerKW: .2 }],
  model: { ...structuredClone(DEFAULT_MODEL), quality: 'coarse', radiation: false, leakageACH: 0,
    floor: { ...structuredClone(DEFAULT_MODEL.floor), boundary: 'outside' }, environment: { ...DEFAULT_MODEL.environment, skyOffsetC: 0 } }, ...patch });
const advance = (sim: Simulation, seconds: number) => {
  const end = sim.elapsed + seconds;
  while (sim.elapsed < end - 1e-8) { if (!sim.advance(Math.min(16, end - sim.elapsed))) throw new Error(sim.diagnostics().failure ?? 'No physical time advanced'); }
  return seconds;
};
const withPower = (powerKW: number, kind: 'heat' | 'cold' = 'heat') => [{ id: 1, kind, x: 2.5, y: 2, z: .4, powerKW }];
const insulated = { ...DEFAULT_PHYSICS, uScale: 0 };

describe('coupled simulation controls and sources', () => {
  it('respects requested elapsed time at real-time and accelerated frame cadences', () => {
    const a = new Simulation(room({ sources: [], outsideC: 20 }), insulated);
    const b = new Simulation(room({ sources: [], outsideC: 20 }), insulated);
    for (let frame = 0; frame < 60; frame++) { a.advance(1 / 60); b.advance(10 / 60); }
    expect(a.elapsed).toBeCloseTo(1, 7); expect(b.elapsed).toBeCloseTo(10, 7);
    expect(a.stats().mean).toBeCloseTo(20, 8);
  });
  it('does no work for invalid or zero time', () => {
    const sim = new Simulation(room()); const energy = sim.energyJ();
    for (const seconds of [0, -1, Infinity, NaN]) expect(sim.advance(seconds)).toBe(0);
    expect(sim.elapsed).toBe(0); expect(sim.energyJ()).toBe(energy);
  });
  it('conserves source power across air and stored building heat', () => {
    const sim = new Simulation(room({ sources: withPower(.2) }), insulated), initial = sim.energyJ();
    advance(sim, 30);
    expect(sim.energyJ() - initial).toBeCloseTo(200 * sim.elapsed, 4);
    expect(sim.diagnostics().relativeEnergyError).toBeLessThan(1e-8);
  });
  it('adds multiple heater powers and subtracts cooling power', () => {
    const sim = new Simulation(room({ sources: [
      { id: 1, kind: 'heat', x: 1, y: 1, z: .4, powerKW: .2 },
      { id: 2, kind: 'heat', x: 4, y: 3, z: .4, powerKW: .1 },
      { id: 3, kind: 'cold', x: 2.5, y: 2, z: .4, powerKW: .05 },
    ] }), insulated), initial = sim.energyJ();
    advance(sim, 20);
    expect(sim.energyJ() - initial).toBeCloseTo(250 * sim.elapsed, 4);
  });
  it('keeps cooling local to a point and underfloor heat independent of heater position', () => {
    const base = room({ heatingMode: 'underfloor', outsideC: 20 });
    const a = new Simulation({ ...base, sources: withPower(.2) }, insulated);
    const b = new Simulation({ ...base, sources: withPower(.2).map(s => ({ ...s, x: .5, y: .5, z: 2 })) }, insulated);
    advance(a, 20); advance(b, 20);
    expect(Array.from(a.T)).toEqual(Array.from(b.T));
    expect(a.diagnostics().surfaceTemperatures.filter(s => s.label === 'Floor').some(s => s.temperatureC > 20)).toBe(true);
    const cold = new Simulation({ ...base, sources: withPower(.05, 'cold') }, insulated);
    cold.advance(1); expect(cold.sample(2.5, 2, .4)).toBeLessThan(20);
    expect(cold.sample(.5, .5, 2)).toBeCloseTo(20, 4);
  });
  it('switches heating through thermostat hysteresis without stopping cooling', () => {
    const config = room({ outsideC: 20, thermostat: { enabled: true, targetC: 20, deadbandC: .5 }, sources: withPower(.2) });
    const sim = new Simulation(config, insulated);
    sim.T.fill(19); sim.advance(.01); expect(sim.thermostatHeatingOn()).toBe(true);
    const heating = sim.energyUseKWh().heating;
    sim.T.fill(20.5); sim.advance(.01); expect(sim.thermostatHeatingOn()).toBe(false);
    expect(sim.energyUseKWh().heating).toBe(heating);
    sim.T.fill(19.5); sim.advance(.01); expect(sim.thermostatHeatingOn()).toBe(true);
  });
  it('records heater/cooling energy for actual simulated seconds and clears on reset', () => {
    const sim = new Simulation(room({ sources: [{ ...withPower(.2)[0], emitter: emitterPreset('radiator') },
      { ...withPower(.05, 'cold')[0], id: 2, x: 1 }] }), insulated);
    const actual = sim.advance(1);
    expect(sim.energyUseKWh().heating).toBeCloseTo(200 * actual / 3600000, 12);
    expect(sim.energyUseKWh().cooling).toBeCloseTo(50 * actual / 3600000, 12);
    sim.reset(); expect(sim.energyUseKWh()).toEqual({ heating: 0, cooling: 0 });
    expect(sim.stats().mean).toBeCloseTo(20, 8); expect(sim.elapsed).toBe(0);
  });
  it('reports signed boundary components and ventilation separately', () => {
    const sim = new Simulation(room({ sources: [], outsideC: 0, openings: [{ id: 1, kind: 'window', side: 'left', pos: 2, length: 1,
      heightM: 1, sillM: .8, open: true }] }));
    sim.advance(.01); const loss = sim.heatLossBreakdownW();
    expect(loss.ventilationW).toBeGreaterThan(0); expect(loss.openingsW).toBe(0);
    expect(loss.roofW).toBeGreaterThan(0); expect(loss.floorW).toBeGreaterThan(0); expect(loss.wallsW).toBeGreaterThan(0);
    expect(loss.totalW).toBeCloseTo(loss.roofW + loss.floorW + loss.wallsW + loss.openingsW + loss.ventilationW, 8);
    expect(sim.diagnostics().relativeEnergyError).toBeLessThan(.001);
  });
  it('estimates steady heating from layers and independent floor boundary', () => {
    const r = room({ outsideC: -5 }); const hold = holdPowerKW(r, 1)!;
    expect(hold.reachable).toBe(true); expect(hold.kW).toBeGreaterThan(0);
    expect(holdPowerKW(room({ outsideC: 30 }), 1)!.reachable).toBe(false);
    const thin = room({ roof: { ...DEFAULT_ROOM.roof, insulationM: 0 } });
    const thick = room({ roof: { ...DEFAULT_ROOM.roof, insulationM: .3 } });
    expect(holdPowerKW(thin, 1)!.kW).toBeGreaterThan(holdPowerKW(thick, 1)!.kW);
  });
  it('preserves heat-flow direction from a hot-to-cold gradient', () => {
    const sim = new Simulation(room({ sources: [] }));
    for (let i = 0; i < sim.T.length; i++) sim.T[i] = i % sim.nx;
    const field = sim.vectorField(); expect(field.length).toBeGreaterThan(0);
    expect(field.every(v => v.dx < 0 && v.magnitude > 0)).toBe(true);
  });
});

describe('config helpers', () => {
  it('sanitizes thermostat settings and keeps furniture inside the room', () => {
    const c = sanitizeRoom({
      widthM: 4,
      thermostat: { enabled: true, targetC: 90, deadbandC: 0.1 },
      furniture: [
        { id: 1, kind: 'sofa', material: 'fabric', x: 0, y: 1, widthM: 2, depthM: 0.9, heightM: 0.85, rotation: 0 },
        { id: 2, kind: 'table', material: 'wood', x: 4, y: 1, widthM: 1.4, depthM: 0.9, heightM: 0.8, rotation: 0 },
      ],
    });
    expect(c.thermostat).toEqual({ enabled: true, targetC: 30, deadbandC: 0.2 });
    expect(c.furniture[0].x).toBeCloseTo(1);
    expect(c.furniture[1].x).toBeCloseTo(3.3);
  });

  it('sanitizes out-of-range and malformed values', () => {
    const c = sanitizeRoom({
      widthM: 99,
      heightM: NaN,
      wall: { material: 'gold' as never, thicknessM: 9, insulation: 'eps', insulationM: -1 },
      sources: [
        { id: 1, kind: 'heat', x: 50, y: -1, z: 99, powerKW: -5 },
        { id: 1, kind: 'weird' as never, x: 1, y: 1, z: 0.4, powerKW: 99 },
      ],
      openings: [{ id: 1, kind: 'door', side: 'left', pos: 100, length: 100, heightM: 100, sillM: 100, open: true }],
    });
    expect(c.widthM).toBe(10);
    expect(c.heightM).toBe(2);
    expect(c.wall.material).toBe('brick');
    expect(c.wall.thicknessM).toBe(0.5);
    expect(c.wall.insulationM).toBe(0);
    expect(c.sources[0]).toMatchObject({ x: 10, y: 0, z: c.ceilingM, powerKW: 0 });
    expect(c.sources[1]).toMatchObject({ kind: 'heat', powerKW: 10 });
    expect(new Set(c.sources.map((s) => s.id)).size).toBe(2);
    const o = c.openings[0];
    expect(o.length).toBeLessThanOrEqual(2.5);
    expect(o.pos - o.length / 2).toBeGreaterThanOrEqual(0);
    expect(o.pos + o.length / 2).toBeLessThanOrEqual(2);
    expect(o.sillM + o.heightM).toBeLessThanOrEqual(c.ceilingM);
  });

  it('caps the number of items', () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ id: i + 1, kind: 'heat' as const, x: 1, y: 1, z: 0.4, powerKW: 1 }));
    expect(sanitizeRoom({ ...DEFAULT_ROOM, sources: many }).sources).toHaveLength(8);
  });

  it('migrates the original single-source save format', () => {
    const old = { widthM: 5, heightM: 4, powerKW: 2, uValue: 1.0, sourceX: 1, sourceY: 1 };
    const r = coerceRoom(old)!;
    expect(r.sources).toEqual([{ id: 1, kind: 'heat', x: 1, y: 1, z: 0.4, powerKW: 2 }]);
    expect(wallU(r.wall)).toBeCloseTo(1.0, 1);
    expect(coerceRoom({ foo: 1 })).toBeNull();
    expect(coerceRoom(null)).toBeNull();
  });
});

describe('Recorder', () => {
  it('samples at an interval and aligns series', () => {
    const rec = new Recorder(5, 100);
    expect(rec.record(0, { a: 1 })).toBe(true);
    expect(rec.record(3, { a: 2 })).toBe(false);
    expect(rec.record(5, { a: 3, b: 9 })).toBe(true);
    expect(rec.times).toEqual([0, 5]);
    expect(rec.series.get('a')).toEqual([1, 3]);
    expect(rec.series.get('b')).toEqual([NaN, 9]);
  });

  it('stays bounded by decimating', () => {
    const rec = new Recorder(1, 50);
    for (let t = 0; t < 5000; t++) rec.record(t, { a: t });
    expect(rec.times.length).toBeLessThanOrEqual(50);
    expect(rec.series.get('a')!.length).toBe(rec.times.length);
    expect(rec.times[rec.times.length - 1]).toBeGreaterThan(4000);
  });

  it('can forget a series and clear everything', () => {
    const rec = new Recorder(1, 50);
    rec.record(0, { a: 1, b: 2 });
    rec.clearSeries('a');
    expect(rec.series.get('a')![0]).toBeNaN();
    rec.removeSeriesExcept(new Set(['b']));
    expect(rec.series.has('a')).toBe(false);
    rec.clear();
    expect(rec.times).toEqual([]);
  });
});

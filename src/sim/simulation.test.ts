import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PHYSICS,
  DEFAULT_ROOM,
  coerceRoom,
  holdPowerKW,
  sanitizeRoom,
  wallU,
  type RoomConfig,
} from './config';
import { Recorder } from './recorder';
import { Simulation } from './simulation';

const room = (patch: Partial<RoomConfig> = {}): RoomConfig => ({ ...structuredClone(DEFAULT_ROOM), ...patch });
const withPower = (kW: number, kind: 'heat' | 'cold' = 'heat') =>
  [{ id: 1, kind, x: 2.5, y: 2, powerKW: kW }];

describe('Simulation', () => {
  it('respects real-time and accelerated speeds when a physics step exceeds a display frame', () => {
    const config = room({ convection: true, sources: [], outsideC: 20 });
    const realTime = new Simulation(config, { ...DEFAULT_PHYSICS, uScale: 0 });
    const accelerated = new Simulation(config, { ...DEFAULT_PHYSICS, uScale: 0 });
    for (let frame = 0; frame < 600; frame++) {
      realTime.advance(1 / 60);
      accelerated.advance(10 / 60);
    }
    expect(realTime.elapsed).toBeCloseTo(10, 0);
    expect(accelerated.elapsed).toBeCloseTo(100, 0);
    expect(accelerated.elapsed / realTime.elapsed).toBeCloseTo(10, 0);
  });

  it('stays at ambient with no heat source and no temperature difference', () => {
    const sim = new Simulation(room({ sources: [], outsideC: 20 }));
    sim.advance(100);
    const s = sim.stats();
    expect(s.min).toBeCloseTo(20, 4);
    expect(s.max).toBeCloseTo(20, 4);
  });

  it('conserves energy when walls are perfectly insulated', () => {
    const sim = new Simulation(room({ sources: withPower(1.5) }), { ...DEFAULT_PHYSICS, uScale: 0 });
    const e0 = sim.energyJ();
    const t = sim.advance(50);
    const expected = 1500 * t;
    expect(sim.energyJ() - e0).toBeGreaterThan(expected * 0.999);
    expect(sim.energyJ() - e0).toBeLessThan(expected * 1.001);
  });

  it('sums the power of multiple sources, cold ones removing heat', () => {
    const sources = [
      { id: 1, kind: 'heat' as const, x: 1, y: 1, powerKW: 2 },
      { id: 2, kind: 'heat' as const, x: 4, y: 3, powerKW: 1 },
      { id: 3, kind: 'cold' as const, x: 2.5, y: 2, powerKW: 0.5 },
    ];
    const sim = new Simulation(room({ sources }), { ...DEFAULT_PHYSICS, uScale: 0 });
    const e0 = sim.energyJ();
    const t = sim.advance(50);
    expect(sim.energyJ() - e0).toBeCloseTo(2500 * t, -2);
  });

  it('distributes underfloor heat along the floor and ignores heat-source position', () => {
    const sources = (x: number) => [{ id: 1, kind: 'heat' as const, x, y: 0.5, powerKW: 1 }];
    const base = { ...room({ furniture: [], outsideC: 20 }), heatingMode: 'underfloor' as const };
    const left = new Simulation({ ...base, sources: sources(0.5) }, { ...DEFAULT_PHYSICS, uScale: 0 });
    const right = new Simulation({ ...base, sources: sources(4.5) }, { ...DEFAULT_PHYSICS, uScale: 0 });
    const energyBefore = left.energyJ();
    const advanced = left.advance(5);
    right.advance(5);
    expect(Array.from(left.T)).toEqual(Array.from(right.T));
    expect(left.sample(4.5, 2.45)).toBeGreaterThan(20);
    expect(left.energyJ() - energyBefore).toBeCloseTo(1000 * advanced, -1);

    const pointLeft = new Simulation(
      { ...base, heatingMode: 'point', sources: sources(0.5) },
      { ...DEFAULT_PHYSICS, uScale: 0 },
    );
    const pointRight = new Simulation(
      { ...base, heatingMode: 'point', sources: sources(4.5) },
      { ...DEFAULT_PHYSICS, uScale: 0 },
    );
    pointLeft.advance(5);
    pointRight.advance(5);
    expect(Array.from(pointLeft.T)).not.toEqual(Array.from(pointRight.T));

    const coldLeft = new Simulation(
      { ...base, sources: sources(0.5).map((source) => ({ ...source, kind: 'cold' as const })) },
      { ...DEFAULT_PHYSICS, uScale: 0 },
    );
    const coldRight = new Simulation(
      { ...base, sources: sources(4.5).map((source) => ({ ...source, kind: 'cold' as const })) },
      { ...DEFAULT_PHYSICS, uScale: 0 },
    );
    coldLeft.advance(5);
    coldRight.advance(5);
    expect(Array.from(coldLeft.T)).not.toEqual(Array.from(coldRight.T));
  });

  it('a cold source cools the room below the starting temperature', () => {
    const sim = new Simulation(room({ sources: withPower(2, 'cold'), outsideC: 20 }));
    sim.advance(120);
    expect(sim.sample(2.5, 2)).toBeLessThan(20);
    expect(sim.stats().max).toBeLessThanOrEqual(20.0001);
  });

  it('the hold power keeps the room near 20 °C', () => {
    const r = room({ sources: withPower(1, 'heat'), outsideC: -5 });
    const hold = holdPowerKW(r, 1, 20)!;
    expect(hold.reachable).toBe(true);
    const sim = new Simulation(room({ sources: withPower(hold.kW), outsideC: -5 }));
    sim.advance(3 * 3600);
    expect(Math.abs(sim.stats().mean - 20)).toBeLessThan(1);
  });

  it('the default room starts balanced at 20 °C', () => {
    const hold = holdPowerKW(DEFAULT_ROOM, 1, 20)!;
    expect(DEFAULT_ROOM.sources[0].powerKW).toBeCloseTo(hold.kW, 1);
  });

  it('the thermostat switches heat on and off across its hysteresis band', () => {
    const sim = new Simulation(
      room({
        outsideC: 20,
        thermostat: { enabled: true, targetC: 20, deadbandC: 0.5 },
        sources: withPower(1),
      }),
      { ...DEFAULT_PHYSICS, uScale: 0 },
    );
    sim.T.fill(19);
    sim.advance(1);
    expect(sim.thermostatHeatingOn()).toBe(true);
    const heatingJ = sim.energyUseKWh().heating * 3_600_000;
    expect(heatingJ).toBeGreaterThan(0);

    sim.T.fill(20.5);
    sim.advance(1);
    expect(sim.thermostatHeatingOn()).toBe(false);
    expect(sim.energyUseKWh().heating * 3_600_000).toBeCloseTo(heatingJ, 4);
    expect(sim.energyUseKWh().cooling).toBe(0);
  });

  it('restarts the heat call when re-enabled at the target', () => {
    const configured = room({
      outsideC: 20,
      thermostat: { enabled: true, targetC: 20, deadbandC: 0.5 },
      sources: withPower(1),
    });
    const sim = new Simulation(configured, { ...DEFAULT_PHYSICS, uScale: 0 });
    sim.T.fill(20.5);
    sim.advance(0.1);
    expect(sim.thermostatHeatingOn()).toBe(false);

    sim.setRoom({ ...configured, thermostat: { ...configured.thermostat, enabled: false } });
    sim.setRoom({ ...configured, thermostat: { ...configured.thermostat, targetC: 20.5 } });
    expect(sim.thermostatHeatingOn()).toBe(true);
    sim.advance(0.1);
    expect(sim.energyUseKWh().heating).toBeGreaterThan(0);
  });

  it('tracks cumulative heater and cooling-source energy and resets the totals', () => {
    const sim = new Simulation(
      room({
        outsideC: 20,
        sources: [
          { id: 1, kind: 'heat', x: 1, y: 1, powerKW: 2 },
          { id: 2, kind: 'cold', x: 4, y: 2, powerKW: 0.5 },
        ],
      }),
      { ...DEFAULT_PHYSICS, uScale: 0 },
    );
    const advanced = sim.advance(1);
    expect(sim.energyUseKWh().heating).toBeCloseTo((2000 * advanced) / 3_600_000, 8);
    expect(sim.energyUseKWh().cooling).toBeCloseTo((500 * advanced) / 3_600_000, 8);
    sim.reset();
    expect(sim.energyUseKWh()).toEqual({ heating: 0, cooling: 0 });
  });

  it('tracks heat-loss components whose sum matches total enclosure loss', () => {
    const sim = new Simulation(
      room({
        outsideC: 0,
        openings: [{ id: 1, kind: 'window', side: 'left', pos: 1.2, length: 0.8, open: true }],
      }),
    );
    sim.T.fill(20);
    const loss = sim.heatLossBreakdownW();
    expect(loss.openingsW).toBeGreaterThan(0);
    expect(loss.roofW).toBeGreaterThan(0);
    expect(loss.wallsW).toBeGreaterThan(0);
    expect(loss.floorW).toBeGreaterThan(0);
    expect(loss.roofW + loss.wallsW + loss.floorW + loss.openingsW).toBeCloseTo(loss.totalW, 6);
    expect(sim.wallLossW()).toBeCloseTo(loss.totalW, 6);
  });

  it('reports unreachable when outside is warmer than the target', () => {
    const hold = holdPowerKW(room({ outsideC: 30 }), 1, 20)!;
    expect(hold.kW).toBe(0);
    expect(hold.reachable).toBe(false);
  });

  it('hold power accounts for the roof insulation', () => {
    const thin = room({ roof: { ...DEFAULT_ROOM.roof, insulationM: 0 } });
    const thick = room({ roof: { ...DEFAULT_ROOM.roof, insulationM: 0.3 } });
    expect(holdPowerKW(thin, 1, 20)!.kW).toBeGreaterThan(holdPowerKW(thick, 1, 20)!.kW + 1);
  });

  it('a warm day outside heats a room that has no sources', () => {
    const sim = new Simulation(room({ sources: [], outsideC: 35 }));
    sim.advance(3600);
    expect(sim.stats().mean).toBeGreaterThan(20.01);
    expect(sim.stats().max).toBeLessThanOrEqual(35);
  });

  it('heats up near the source and spreads outward', () => {
    const sim = new Simulation(room());
    sim.advance(60);
    expect(sim.sample(2.5, 2)).toBeGreaterThan(sim.sample(0.1, 0.1));
  });

  it('reaches a steady state where wall loss equals source power', () => {
    const params = { ...DEFAULT_PHYSICS, massFactor: 0.05 };
    const r = room({
      widthM: 3,
      heightM: 3,
      furniture: [],
      sources: [{ id: 1, kind: 'heat', x: 1.5, y: 1.5, powerKW: 1.5 }],
    });
    const sim = new Simulation(r, params);
    for (let i = 0; i < 60; i++) sim.advance(5);
    expect(Math.abs(sim.wallLossW() - 1500) / 1500).toBeLessThan(0.02);
  });

  it('better insulation gives a hotter room', () => {
    const poor = new Simulation(room({ wall: { ...DEFAULT_ROOM.wall, insulationM: 0 } }));
    const good = new Simulation(room({ wall: { ...DEFAULT_ROOM.wall, insulationM: 0.2 } }));
    poor.advance(400);
    good.advance(400);
    expect(good.stats().mean).toBeGreaterThan(poor.stats().mean);
  });

  it('reset restores the initial state', () => {
    const sim = new Simulation(room({ convection: true }));
    sim.advance(100);
    sim.reset();
    expect(sim.elapsed).toBe(0);
    expect(sim.stats().max).toBe(DEFAULT_PHYSICS.initialC);
  });

  it('furniture absorbs heat and contributes to total stored energy', () => {
    const r = room({ sources: withPower(2), outsideC: 20 });
    const furnished = new Simulation(r, { ...DEFAULT_PHYSICS, uScale: 0 });
    const empty = new Simulation({ ...r, furniture: [] }, { ...DEFAULT_PHYSICS, uScale: 0 });
    const furnishedE0 = furnished.energyJ();
    const emptyE0 = empty.energyJ();
    const advanced = furnished.advance(20);
    empty.advance(advanced);
    expect(furnished.energyJ() - furnishedE0).toBeCloseTo(2000 * advanced, -1);
    expect(furnished.stats().mean).toBeLessThan(empty.stats().mean);
  });

  it('reports diffusive heat-flow arrows from hot toward cold', () => {
    const sim = new Simulation(room({ sources: [], outsideC: 20 }));
    for (let y = 0; y < sim.ny; y++) {
      for (let x = 0; x < sim.nx; x++) sim.T[y * sim.nx + x] = x;
    }
    const field = sim.vectorField();
    expect(field.length).toBeGreaterThan(0);
    expect(field.every((v) => v.dx < 0 && v.magnitude > 0)).toBe(true);
  });
});

describe('openings', () => {
  const steady = (r: RoomConfig) => {
    const sim = new Simulation(r, { ...DEFAULT_PHYSICS, massFactor: 0.05 });
    for (let i = 0; i < 60; i++) sim.advance(5);
    return sim;
  };
  const base = room({
    widthM: 3,
    heightM: 3,
    furniture: [],
    sources: [{ id: 1, kind: 'heat', x: 1.5, y: 1.5, powerKW: 1 }],
  });
  const window = (open: boolean) => ({
    id: 1,
    kind: 'window' as const,
    side: 'top' as const,
    pos: 1.5,
    length: 1.2,
    open,
  });

  it('an open window loses far more heat than a closed one', () => {
    const closed = steady({ ...base, openings: [window(false)] });
    const open = steady({ ...base, openings: [window(true)] });
    expect(open.stats().mean).toBeLessThan(closed.stats().mean - 3);
  });

  it('a closed window still balances source power at steady state', () => {
    const sim = steady({ ...base, openings: [window(false)] });
    expect(Math.abs(sim.wallLossW() - 1000) / 1000).toBeLessThan(0.02);
  });

  it('heat leaves through the opening, not the rest of the wall', () => {
    const sim = steady({ ...base, openings: [window(true)] });
    const nearWindow = sim.sample(1.5, 0.02);
    const farWall = sim.sample(1.5, 2.98);
    expect(nearWindow).toBeLessThan(farWall);
  });
});

describe('walls', () => {
  it('computes U from layers', () => {
    const brick = wallU({ material: 'brick', thicknessM: 0.2, insulation: 'mineral', insulationM: 0 });
    expect(brick).toBeCloseTo(1 / (0.17 + 0.2 / 0.77), 6);
    const insulated = wallU({ material: 'brick', thicknessM: 0.2, insulation: 'mineral', insulationM: 0.1 });
    expect(insulated).toBeLessThan(brick / 3);
  });

  it('wood loses less heat than concrete of the same thickness', () => {
    const w = (material: 'wood' | 'concrete') =>
      wallU({ material, thicknessM: 0.2, insulation: 'eps', insulationM: 0 });
    expect(w('wood')).toBeLessThan(w('concrete'));
  });

  it('thicker walls lose less heat', () => {
    const w = (thicknessM: number) =>
      wallU({ material: 'brick', thicknessM, insulation: 'eps', insulationM: 0 });
    expect(w(0.4)).toBeLessThan(w(0.1));
  });
});

describe('convection', () => {
  it('hot air rises: above a heater is warmer than the same distance below', () => {
    const sources = [{ id: 1, kind: 'heat' as const, x: 2, y: 3, powerKW: 3 }];
    const params = { ...DEFAULT_PHYSICS, massFactor: 1 };
    const r = room({ widthM: 4, heightM: 4, ceilingM: 4, sources });
    const flat = new Simulation(r, params);
    const conv = new Simulation({ ...r, convection: true }, params);
    flat.advance(300);
    conv.advance(300);
    const flatDiff = flat.sample(2, 2.1) - flat.sample(2, 3.9);
    const convDiff = conv.sample(2, 2.1) - conv.sample(2, 3.9);
    expect(Math.abs(flatDiff)).toBeLessThan(0.5);
    expect(convDiff).toBeGreaterThan(1);
  });

  it('stays numerically stable with a strong heater over a long run', () => {
    const sim = new Simulation(
      room({ convection: true, sources: [{ id: 1, kind: 'heat', x: 2.5, y: 3.5, powerKW: 10 }] }),
    );
    for (let i = 0; i < 40; i++) sim.advance(30);
    const s = sim.stats();
    expect(Number.isFinite(s.min) && Number.isFinite(s.max)).toBe(true);
    expect(s.max).toBeLessThan(500);
    expect(s.min).toBeGreaterThan(-50);
  });

  it('does not create or destroy much heat while only mixing', () => {
    const sim = new Simulation(room({ convection: true, sources: withPower(2) }), {
      ...DEFAULT_PHYSICS,
      uScale: 0,
    });
    const e0 = sim.energyJ();
    const t = sim.advance(200);
    const gained = sim.energyJ() - e0;
    expect(Math.abs(gained - 2000 * t) / (2000 * t)).toBeLessThan(0.1);
  });
});

describe('config helpers', () => {
  it('sanitizes thermostat settings and keeps furniture inside the room', () => {
    const c = sanitizeRoom({
      widthM: 4,
      thermostat: { enabled: true, targetC: 90, deadbandC: 0.1 },
      furniture: [
        { id: 1, kind: 'sofa', x: 0 },
        { id: 2, kind: 'table', x: 4 },
      ],
    });
    expect(c.thermostat).toEqual({ enabled: true, targetC: 30, deadbandC: 0.2 });
    expect(c.furniture[0].x).toBeCloseTo(0.76);
    expect(c.furniture[1].x).toBeCloseTo(3.56);
  });

  it('sanitizes out-of-range and malformed values', () => {
    const c = sanitizeRoom({
      widthM: 99,
      heightM: NaN,
      wall: { material: 'gold' as never, thicknessM: 9, insulation: 'eps', insulationM: -1 },
      sources: [
        { id: 1, kind: 'heat', x: 50, y: -1, powerKW: -5 },
        { id: 1, kind: 'weird' as never, x: 1, y: 1, powerKW: 99 },
      ],
      openings: [{ id: 1, kind: 'door', side: 'left', pos: 100, length: 100, open: true }],
    });
    expect(c.widthM).toBe(10);
    expect(c.heightM).toBe(2);
    expect(c.wall.material).toBe('brick');
    expect(c.wall.thicknessM).toBe(0.5);
    expect(c.wall.insulationM).toBe(0);
    expect(c.sources[0]).toMatchObject({ x: 10, y: 0, powerKW: 0 });
    expect(c.sources[1]).toMatchObject({ kind: 'heat', powerKW: 10 });
    expect(new Set(c.sources.map((s) => s.id)).size).toBe(2);
    const o = c.openings[0];
    expect(o.length).toBeLessThanOrEqual(2.5);
    expect(o.pos - o.length / 2).toBeGreaterThanOrEqual(0);
    expect(o.pos + o.length / 2).toBeLessThanOrEqual(2.5);
  });

  it('caps the number of items', () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ id: i + 1, kind: 'heat' as const, x: 1, y: 1, powerKW: 1 }));
    expect(sanitizeRoom({ ...DEFAULT_ROOM, sources: many }).sources).toHaveLength(8);
  });

  it('migrates the original single-source save format', () => {
    const old = { widthM: 5, heightM: 4, powerKW: 2, uValue: 1.0, sourceX: 1, sourceY: 1 };
    const r = coerceRoom(old)!;
    expect(r.sources).toEqual([{ id: 1, kind: 'heat', x: 1, y: 1, powerKW: 2 }]);
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

import { describe, expect, it } from 'vitest';
import { DEFAULT_PHYSICS, DEFAULT_ROOM, coerceRoom, holdLossW, sanitizeRoom } from './config';
import { buildSurfaces } from './surfaces';
import { DEFAULT_MODEL } from './model';
import { Simulation } from './simulation';

describe('volumetric physics', () => {
  it('uses exact air volume heat capacity independently of massive construction layers', () => {
    const r = sanitizeRoom({ ...DEFAULT_ROOM, widthM: 3.7, heightM: 6.3, ceilingM: 2.9 });
    const sim = new Simulation(r); const before = sim.energyJ(); sim.T.fill(21);
    expect(sim.T.length).toBe(sim.nx * sim.ny * sim.nz);
    expect(sim.energyJ() - before).toBeCloseTo(r.widthM * r.heightM * r.ceilingM * DEFAULT_PHYSICS.airDensity * DEFAULT_PHYSICS.airCp, 5);
  });
  it('partitions all six surfaces with exact fractional opening areas', () => {
    const r = sanitizeRoom({ ...DEFAULT_ROOM, widthM: 3.7, heightM: 6.3, ceilingM: 2.9,
      openings: [{ id: 1, kind: 'window', side: 'right', pos: 1.85, length: 1.13, heightM: .93, sillM: 1.17, open: true }] });
    const patches = buildSurfaces(r, 20);
    expect(patches.filter(p => p.kind === 'aperture').reduce((s,p) => s+p.area,0)).toBeCloseTo(1.13*.93, 10);
    const enclosure = patches.filter(p => p.kind !== 'emitter').reduce((s,p) => s+p.area,0);
    expect(enclosure).toBeCloseTo(2*(r.widthM*r.heightM + r.widthM*r.ceilingM + r.heightM*r.ceilingM), 9);
  });
  it('counts overlapping openings once in geometry and steady estimates', () => {
    const opening = { id: 1, kind: 'window' as const, side: 'top' as const, pos: 2, length: 1.3, heightM: 1.1, sillM: .9, open: true };
    const single = sanitizeRoom({ ...DEFAULT_ROOM, openings: [opening] });
    const double = sanitizeRoom({ ...DEFAULT_ROOM, openings: [opening, { ...opening, id: 2 }] });
    expect(holdLossW(single, 20)).toBeCloseTo(holdLossW(double, 20), 6);
    expect(buildSurfaces(double,20).filter(p=>p.kind==='aperture').reduce((s,p)=>s+p.area,0)).toBeCloseTo(1.3*1.1, 9);
  });

  it('localizes source power at its height and moves that height live', () => {
    const r = sanitizeRoom({ ...DEFAULT_ROOM, convection: false, outsideC: 20, model: { ...structuredClone(DEFAULT_MODEL), radiation: false, leakageACH: 0 }, sources: [{ ...DEFAULT_ROOM.sources[0], emitter: undefined, z: 0.4 }] });
    const sim = new Simulation(r, { ...DEFAULT_PHYSICS, uScale: 0 });
    sim.advance(0.1);
    expect(sim.sample(2.5, 2, 0.4)).toBeGreaterThan(20);
    expect(sim.sample(2.5, 2, 2.1)).toBe(20);
    sim.setRoom({ ...r, sources: [{ ...r.sources[0], z: 2.1 }] });
    sim.advance(0.1);
    expect(sim.sample(2.5, 2, 2.1)).toBeGreaterThan(20);
  });

  it('diffuses equally along X, Y and Z in a cubic room', () => {
    const r = sanitizeRoom({ ...DEFAULT_ROOM, convection: false, widthM: 3, heightM: 3, ceilingM: 3, model: { ...structuredClone(DEFAULT_MODEL), radiation: false, leakageACH: 0 },
      sources: [{ ...DEFAULT_ROOM.sources[0], x: 1.5, y: 1.5, z: 1.5, powerKW: .1, emitter: undefined }] });
    const sim = new Simulation(r, { ...DEFAULT_PHYSICS, uScale: 0 });
    for (let t = 0; t < 20; t++) sim.advance(1);
    const x = sim.sample(1.65, 1.5, 1.5), y = sim.sample(1.5, 1.65, 1.5), z = sim.sample(1.5, 1.5, 1.65);
    expect(x).toBeGreaterThan(20);
    expect(x).toBeCloseTo(y, 4);
    expect(x).toBeCloseTo(z, 4);
  });

  it('interpolates probe temperatures along all three axes', () => {
    const sim = new Simulation(DEFAULT_ROOM);
    for (let z = 0; z < sim.nz; z++) for (let y = 0; y < sim.ny; y++) for (let x = 0; x < sim.nx; x++) {
      sim.T[(z * sim.ny + y) * sim.nx + x] = 1 + 2 * (x + 0.5) * sim.dx + 3 * (y + 0.5) * sim.dy + 4 * (z + 0.5) * sim.dz;
    }
    expect(sim.sample(1.23, 2.17, 0.91)).toBeCloseTo(1 + 2 * 1.23 + 3 * 2.17 + 4 * 0.91, 5);
  });

  it('does no work when no simulated time has elapsed', () => {
    const sim = new Simulation(DEFAULT_ROOM);
    expect(sim.advance(0)).toBe(0);
    expect(sim.elapsed).toBe(0);
    expect(sim.stats().mean).toBeCloseTo(20, 8);
    expect(sim.advance(0.01)).toBeCloseTo(0.01, 8);
  });

  it('migrates saved 2D rooms with usable source, probe and opening heights', () => {
    const r = coerceRoom({ ...DEFAULT_ROOM, model: undefined, roof: undefined, thermostat: undefined, heatingMode: undefined,
      sources: [{ id: 1, kind: 'heat', x: 1, y: 2, powerKW: 1 }],
      probes: [{ id: 1, x: 3, y: 2 }],
      openings: [{ id: 1, kind: 'door', side: 'left', pos: 1, length: 0.9, open: false }] })!;
    expect(r.sources[0].z).toBe(0.4);
    expect(r.probes[0].z).toBe(r.ceilingM / 2);
    expect(r.openings[0].sillM).toBe(0);
    expect(r.openings[0].heightM).toBe(2.1);
  });
});

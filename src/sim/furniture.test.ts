import { describe, expect, it } from 'vitest';
import { DEFAULT_PHYSICS, DEFAULT_ROOM, sanitizeRoom, type Furniture, type RoomConfig } from './config';
import { furnitureBoxes, intersectBox } from './furniture';
import { Simulation } from './simulation';
import { traceAirflow } from '../render/airflow';

const table: Furniture = { id: 1, kind: 'table', material: 'wood', x: 2.5, y: 2, widthM: 1.6, depthM: 1.2, heightM: 1.25, rotation: 0 };
const room = (patch: Partial<RoomConfig> = {}) => sanitizeRoom({ ...DEFAULT_ROOM, convection: true, outsideC: 20, furniture: [table], ...patch });
const advance = (sim: Simulation, seconds: number) => {
  const end = sim.elapsed + seconds;
  while (sim.elapsed < end - 1e-6) sim.advance(Math.min(5, end - sim.elapsed));
};

describe('furniture physics', () => {
  it('keeps open space under a table and blocks airflow through its top and legs', () => {
    const sim = new Simulation(room());
    expect(sim.isSolid(2.5, 2, 0.5)).toBe(false);
    expect(sim.isSolid(2.5, 2, 1.15)).toBe(true);
    expect(sim.isSolid(table.x - table.widthM * 0.4, table.y - table.depthM * 0.38, 0.3)).toBe(true);
    advance(sim, 30);
    expect(sim.sampleVelocity(2.5, 2, 1.15)).toEqual([0, 0, 0]);
    const paths = traceAirflow(sim, [5, 4, 2.5], [2.5, 2, 0.6]);
    expect(paths.length).toBeGreaterThan(2);
    expect(paths.every((p) => !sim.isSolid(...p))).toBe(true);
  });

  it('changes the rising plume when a tabletop obstructs the heater', () => {
    const bare = new Simulation(room({ furniture: [] }));
    const furnished = new Simulation(room());
    advance(bare, 60); advance(furnished, 60);
    expect(furnished.sample(2.5, 2, 1.6)).toBeLessThan(bare.sample(2.5, 2, 1.6) - 0.1);
  });

  it('conserves combined air/furniture energy while they exchange heat', () => {
    const sim = new Simulation(room({ sources: [] }), { ...DEFAULT_PHYSICS, uScale: 0 });
    for (let i = 0; i < sim.T.length; i++) sim.T[i] = sim.solid[i] ? 20 : 35;
    const before = sim.energyJ();
    advance(sim, 60);
    expect(Math.abs(sim.energyJ() - before) / before).toBeLessThan(0.0002);
    expect(sim.furnitureTemperatures()[1]).toBeGreaterThan(20.001);
    expect(sim.stats().mean).toBeLessThan(35);
  });

  it('solid thermal mass releases stored heat into the air', () => {
    const sim = new Simulation(room({ sources: [], convection: false }), { ...DEFAULT_PHYSICS, uScale: 0 });
    for (let i = 0; i < sim.T.length; i++) sim.T[i] = sim.solid[i] ? 35 : 20;
    expect(sim.stats().mean).toBe(20);
    expect(sim.furnitureTemperatures()[1]).toBe(35);
    const before = sim.energyJ();
    advance(sim, 60);
    expect(sim.stats().mean).toBeGreaterThan(20.01);
    expect(sim.furnitureTemperatures()[1]).toBeLessThan(35);
    expect(Math.abs(sim.energyJ() - before) / before).toBeLessThan(0.0002);
  });

  it('material choice changes how quickly furniture warms', () => {
    const wood = new Simulation(room({ sources: [], convection: false }), { ...DEFAULT_PHYSICS, uScale: 0 });
    const fabric = new Simulation(room({ sources: [], convection: false, furniture: [{ ...table, material: 'fabric' }] }), { ...DEFAULT_PHYSICS, uScale: 0 });
    for (const sim of [wood, fabric]) {
      for (let i = 0; i < sim.T.length; i++) sim.T[i] = sim.solid[i] ? 20 : 35;
      advance(sim, 60);
    }
    expect(fabric.furnitureTemperatures()[1]).toBeGreaterThan(wood.furnitureTemperatures()[1] + 0.001);
  });

  it('conserves source power with convection and solid furniture present', () => {
    const sim = new Simulation(room(), { ...DEFAULT_PHYSICS, uScale: 0 });
    const before = sim.energyJ();
    advance(sim, 40);
    const expected = DEFAULT_ROOM.sources[0].powerKW * 1000 * sim.elapsed;
    expect(Math.abs(sim.energyJ() - before - expected) / expected).toBeLessThan(0.002);
    expect(Number.isFinite(sim.stats().min)).toBe(true);
  });

  it('handles a room filled with solid furniture without invalid temperatures', () => {
    const sim = new Simulation(room({ sources: [], furniture: [{ ...table, kind: 'cabinet', widthM: 5, depthM: 4, heightM: 2.5 }] }));
    advance(sim, 2);
    expect(sim.stats().mean).toBeCloseTo(20, 5);
    expect(sim.sampleVelocity(2.5, 2, 1)).toEqual([0, 0, 0]);
  });
});

describe('furniture geometry and validation', () => {
  it('validates furniture defaults, unique IDs, dimensions and item limits', () => {
    const r = sanitizeRoom({ ...DEFAULT_ROOM, furniture: Array.from({ length: 20 }, () => ({ ...table,
      id: 1, kind: 'invalid' as never, material: 'invalid' as never, x: NaN, y: Infinity, widthM: -5, depthM: 99, heightM: 99 })) });
    expect(r.furniture).toHaveLength(8);
    expect(new Set(r.furniture.map((f) => f.id)).size).toBe(8);
    expect(r.furniture[0]).toMatchObject({ kind: 'sofa', material: 'fabric', widthM: 0.4, depthM: 4, heightM: 2.5 });
    expect(r.furniture.every((f) => Number.isFinite(f.x) && Number.isFinite(f.y))).toBe(true);
  });
  it('rotates the same geometry used by physics and keeps every part inside a resized room', () => {
    const r = room({ widthM: 2, heightM: 3, ceilingM: 2, furniture: [{ ...table, x: 99, y: -5, widthM: 8, depthM: 8, heightM: 8, rotation: 90 }] });
    for (const box of furnitureBoxes(r.furniture[0])) for (let axis = 0; axis < 3; axis++) {
      expect(box.min[axis]).toBeGreaterThanOrEqual(-1e-9);
      expect(box.max[axis]).toBeLessThanOrEqual([2, 3, 2][axis] + 1e-9);
    }
  });

  it('uses real furniture geometry for picking rather than its whole bounding box', () => {
    const boxes = furnitureBoxes(table);
    expect(boxes.some((b) => intersectBox([2.5, 0, 0.5], [0, 1, 0], b) !== null)).toBe(false);
    expect(boxes.some((b) => intersectBox([2.5, 0, 1.15], [0, 1, 0], b) !== null)).toBe(true);
  });

  it('stops trails at furniture even if a supplied velocity field would cross it', () => {
    const points = traceAirflow({ sampleVelocity: () => [0, 0, 1], isSolid: (_x, _y, z) => z >= 1 }, [5, 4, 2.5], [2.5, 2, 0.4]);
    expect(points.length).toBeGreaterThan(2);
    expect(points.every((p) => p[2] < 1)).toBe(true);
  });
});

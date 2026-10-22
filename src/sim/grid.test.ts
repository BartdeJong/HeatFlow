import { describe, expect, it } from 'vitest';
import { DEFAULT_ROOM, type Furniture } from './config';
import { furnitureOverlap, furnitureOverlaps, furnitureVolume } from './furniture';
import { GridGeometry } from './grid';
const table: Furniture = { id: 1, kind: 'table', material: 'wood', x: 2.1, y: 2.1, widthM: 1.4, depthM: 0.9, heightM: 0.8, rotation: 0 };
const sum = (values: Float64Array) => values.reduce((a, b) => a + b, 0);
describe('exact cut-cell furniture', () => {
  it('preserves component volume under grid refinement and translation', () => {
    const exact = 1.4 * 0.9 * 0.8 * (0.16 + 4 * 0.08 ** 2 * 0.84);
    expect(furnitureVolume(table)).toBeCloseTo(exact, 12);
    for (const n of [10, 17, 24]) for (const offset of [0, 0.073]) {
      const g = new GridGeometry({ ...DEFAULT_ROOM, furniture: [{ ...table, x: table.x + offset }] }, n, n, n);
      expect(sum(g.furnitureVolumes[0])).toBeCloseTo(exact, 11);
      expect(sum(g.volume) + exact).toBeCloseTo(50, 10);
    }
  });
  it('retains separate solid capacity in partially occupied cells and open leg faces', () => {
    const g = new GridGeometry({ ...DEFAULT_ROOM, furniture: [table] }, 10, 8, 5);
    expect([...g.volume].some((v, c) => v > 0 && g.furnitureVolumes[0][c] > 0)).toBe(true);
    const full = g.dy * g.dz;
    expect([...g.openU].some((a) => a > 0 && a < full - 1e-10)).toBe(true);
    for (let i = 0; i < g.volume.length; i++) if (g.volume[i] > 0) expect(g.solid[i]).toBe(0);
  });
  it('merges a <10% fluid sliver into a connected neighbor without changing its volume', () => {
    const cabinet: Furniture = { ...table, kind: 'cabinet', x: 0.48, y: 0.5, widthM: 0.96, depthM: 1, heightM: 1 };
    const g = new GridGeometry({ ...DEFAULT_ROOM, widthM: 2, heightM: 2, ceilingM: 2, furniture: [cabinet] }, 2, 2, 2);
    expect(g.volume[0]).toBeCloseTo(0.04, 12);
    expect(g.representative[0]).not.toBe(0);
    expect(g.volume[g.representative[0]]).toBeGreaterThan(0.1);
    expect(sum(g.volume)).toBeCloseTo(8 - 0.96, 12);
  });
  it('uses solid parts for overlaps, permits contact, and flags imported intersections', () => {
    const a: Furniture = { ...table, kind: 'cabinet', widthM: 1, depthM: 1, heightM: 1 };
    expect(furnitureOverlap(a, { ...a, id: 2, x: a.x + 1 })).toBe(false);
    expect(furnitureOverlap(a, { ...a, id: 2, x: a.x + 0.999 })).toBe(true);
    expect(furnitureOverlaps([a, { ...a, id: 2 }])).toEqual([[1, 2]]);
    expect(furnitureVolume({ ...table, kind: 'bed' })).toBeGreaterThan(0);
  });
});

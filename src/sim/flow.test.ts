import { describe, expect, it } from 'vitest';
import { DEFAULT_ROOM, type Furniture } from './config';
import { GridGeometry } from './grid';
import { FlowSolver } from './flow';
const geometry = () => new GridGeometry(DEFAULT_ROOM, 8, 6, 5);
describe('staggered momentum and residual pressure projection', () => {
  it('leaves isothermal still air at rest without damping or artificial forcing', () => {
    const g = geometry(), flow = new FlowSolver(g);
    const result = flow.step(new Float64Array(g.volume.length).fill(20), 1);
    expect(result.converged).toBe(true);
    expect(flow.u.every((q) => q === 0)).toBe(true);
    expect(flow.v.every((q) => q === 0)).toBe(true);
    expect(flow.w.every((q) => q === 0)).toBe(true);
    expect(flow.eddyDiffusivity.every((q) => q === 0)).toBe(true);
  });
  it('projects an arbitrary field to residual convergence and zero normal wall flow', () => {
    const flow = new FlowSolver(geometry());
    [flow.u, flow.v, flow.w].forEach((q, a) => { for (let f = 0; f < q.length; f++) q[f] = Math.sin(f * 12.7 + a); });
    const result = flow.project(0.1);
    expect(result.converged).toBe(true);
    expect(result.residual).toBeLessThan(1e-5);
    expect(result.maxDivergence).toBeLessThan(1e-4);
    for (let j = 0; j < flow.grid.ny; j++) for (let k = 0; k < flow.grid.nz; k++) expect(flow.u[flow.grid.uIndex(0, j, k)]).toBe(0);
    expect(flow.stableDt()).toBeGreaterThan(0);
  });
  it('creates a rising hot plume and incompressible circulation', () => {
    const g = geometry(), flow = new FlowSolver(g), T = new Float64Array(g.volume.length).fill(20);
    for (let k = 0; k < 2; k++) for (let j = 2; j < 4; j++) for (let i = 3; i < 5; i++) T[g.index(i, j, k)] = 30;
    const result = flow.step(T, 0.25);
    expect(result.converged).toBe(true);
    expect(result.maxDivergence).toBeLessThan(1e-5);
    expect(flow.w[g.wIndex(4, 3, 1)]).toBeGreaterThan(0);
    expect(flow.w.some((q) => q < 0)).toBe(true);
  });
  it('solves disconnected air pockets with independent pressure gauges', () => {
    const furniture: Furniture = { id: 1, kind: 'cabinet', material: 'wood', x: 2.5, y: 2, widthM: 1, depthM: 4, heightM: 2.5, rotation: 0 };
    const g = new GridGeometry({ ...DEFAULT_ROOM, furniture: [furniture] }, 10, 6, 5), flow = new FlowSolver(g);
    for (let f = 0; f < flow.w.length; f++) flow.w[f] = Math.cos(f * 3.4);
    const result = flow.project(0.1);
    expect(result.converged).toBe(true);
    expect(result.maxDivergence).toBeLessThan(1e-4);
    for (let f = 0; f < flow.u.length; f++) if (!g.openU[f]) expect(flow.u[f]).toBe(0);
  });
  it('retains pressure-driven airflow while optionally suppressing thermal buoyancy', () => {
    const g = geometry(), flow = new FlowSolver(g), T = new Float64Array(g.volume.length).fill(20);
    T[g.index(4, 3, 1)] = 100;
    expect(flow.step(T, 0.1, [], false).converged).toBe(true);
    expect([...flow.u, ...flow.v, ...flow.w].every(q => q === 0)).toBe(true);
    const boundaries = [{ axis: 0 as const, index: g.uIndex(0, 2, 2), velocity: 0.1 }, { axis: 0 as const, index: g.uIndex(g.nx, 2, 2), velocity: 0.1 }];
    const result = flow.step(T, 0.1, boundaries, false);
    expect(result.converged).toBe(true);
    expect(result.maxDivergence).toBeLessThan(1e-5);
    expect(flow.u[g.uIndex(4, 2, 2)]).toBeGreaterThan(0);
  });
  it('limits a still-air timestep by predicted buoyancy and boundary outflow', () => {
    const g = geometry(), flow = new FlowSolver(g), T = new Float64Array(g.volume.length).fill(20);
    for (let k = 0; k < 2; k++) T[g.index(4, 3, k)] = 120;
    expect(flow.stableDt(10, T)).toBeLessThan(1);
    flow.u[g.uIndex(g.nx, 2, 2)] = 100;
    expect(flow.stableDt(10)).toBeLessThanOrEqual(0.5 * g.dx / 100);
  });
  it('balances prescribed boundary fluxes and diagnoses a net mass source', () => {
    const g = geometry(), flow = new FlowSolver(g), a = g.uIndex(0, 2, 2), b = g.uIndex(g.nx, 2, 2);
    const result = flow.project(1, [{ axis: 0, index: a, velocity: 0.1 }, { axis: 0, index: b, velocity: 0.1 }]);
    expect(result.converged).toBe(true);
    expect(result.maxDivergence).toBeLessThan(1e-5);
    expect(flow.project(1, [{ axis: 0, index: a, velocity: 0.1 }]).converged).toBe(false);
  });
});

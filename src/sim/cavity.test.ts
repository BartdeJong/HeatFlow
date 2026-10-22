import { expect, it } from 'vitest';
import { DEFAULT_ROOM } from './config';
import { GridGeometry } from './grid';
import { FlowSolver } from './flow';

/** de Vahl Davis (1983), DOI 10.1002/fld.1650030305: Ra=10³, Pr=.71,
 * square cavity, hot/cold vertical walls and insulated horizontal walls.
 * Published mean Nu=1.118. Thin-grid y is deliberately very deep so its no-slip
 * drag vanishes, representing the benchmark's two-dimensional limit.
 * Cs=0 is the laminar benchmark; room runs retain Cs=.12 LES.
 */
it('reproduces low-Rayleigh natural-convection cavity heat transfer within 5%', () => {
  const n = 32, nu = 1.5e-5, alpha = nu / 0.71, hot = 20.5, cold = 19.5;
  const length = Math.cbrt(1000 * nu * alpha * 293.15 / 9.81);
  const g = new GridGeometry({ ...DEFAULT_ROOM, widthM: length, heightM: 10, ceilingM: length, furniture: [] }, n, 1, n);
  const flow = new FlowSolver(g, { smagorinskyCs: 0 }), T = new Float64Array(n * n), dT = new Float64Array(n * n);
  for (let k = 0; k < n; k++) for (let i = 0; i < n; i++) T[g.index(i, 0, k)] = hot + (cold - hot) * (i + 0.5) / n;
  const dt = Math.min(0.01, 0.2 * g.dx ** 2 / alpha), end = 0.5 * length ** 2 / alpha;
  for (let elapsed = 0; elapsed < end; elapsed += dt) {
    const r = flow.step(T, dt); expect(r.converged).toBe(true);
    dT.fill(0);
    for (let k = 0; k < n; k++) for (let i = 0; i < n; i++) {
      const a = g.index(i, 0, k);
      if (i < n - 1) {
        const b = a + 1, u = flow.u[g.uIndex(i + 1, 0, k)];
        const transfer = dt * (alpha * (T[a] - T[b]) / g.dx + u * (u > 0 ? T[a] : T[b])) / g.dx;
        dT[a] -= transfer; dT[b] += transfer;
      }
      if (k < n - 1) {
        const b = a + n, w = flow.w[g.wIndex(i, 0, k + 1)];
        const transfer = dt * (alpha * (T[a] - T[b]) / g.dz + w * (w > 0 ? T[a] : T[b])) / g.dz;
        dT[a] -= transfer; dT[b] += transfer;
      }
      if (i === 0) dT[a] += dt * 2 * alpha * (hot - T[a]) / g.dx ** 2;
      if (i === n - 1) dT[a] += dt * 2 * alpha * (cold - T[a]) / g.dx ** 2;
    }
    for (let a = 0; a < T.length; a++) T[a] += dT[a];
  }
  let nusselt = 0;
  for (let k = 0; k < n; k++) nusselt += 2 * n * (hot - T[g.index(0, 0, k)]) / n;
  expect(Math.abs(nusselt - 1.118) / 1.118).toBeLessThan(0.05);
}, 30000);

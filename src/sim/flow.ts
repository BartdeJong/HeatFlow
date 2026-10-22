import type { GridGeometry } from './grid';
import { BoxPressureSolver } from './box-pressure';

export interface BoundaryFlow { axis: 0 | 1 | 2; index: number; velocity: number }
export interface FlowResult { converged: boolean; residual: number; maxDivergence: number; iterations: number }
const NU = 1.5e-5, CS = 0.12;
interface FaceEdge { a: number; b: number; axis: 0 | 1 | 2; face: number; area: number; distance: number }

/** Staggered finite-volume Boussinesq airflow. Pressure is a volume-conserving graph
 * projection on connected cut-cell groups, with one pressure gauge per air pocket.
 * Smagorinsky nu_t=(Cs*Delta)^2 |S|, Cs=.12; scalar turbulent Prandtl=.85.
 * This is a browser LES approximation, not a resolved wall-turbulence model.
 */
export class FlowSolver {
  readonly u: Float64Array; readonly v: Float64Array; readonly w: Float64Array;
  readonly eddyDiffusivity: Float64Array;
  readonly turbulentPrandtl = 0.85;
  private readonly arrays: Float64Array[];
  private readonly openings: Float64Array[];
  private readonly counts: number[][];
  private readonly node: Int32Array;
  private readonly volumes: Float64Array;
  private readonly edges: FaceEdge[] = [];
  private readonly anchors: Uint8Array;
  private readonly component: Int32Array;
  private readonly componentCount: number;
  private readonly diagonal: Float64Array;
  private readonly pressure: Float64Array;
  private readonly rhs: Float64Array;
  private readonly residual: Float64Array;
  private readonly direction: Float64Array;
  private readonly preconditioned: Float64Array;
  private readonly product: Float64Array;
  private readonly boxPressure?: BoxPressureSolver;

  constructor(readonly grid: GridGeometry, private readonly options: { smagorinskyCs?: number } = {}) {
    const g = grid, { nx, ny, nz } = g;
    this.u = new Float64Array(g.openU.length); this.v = new Float64Array(g.openV.length); this.w = new Float64Array(g.openW.length);
    this.arrays = [this.u, this.v, this.w]; this.openings = [g.openU, g.openV, g.openW];
    this.counts = [[nx + 1, ny, nz], [nx, ny + 1, nz], [nx, ny, nz + 1]];
    this.eddyDiffusivity = new Float64Array(g.volume.length);
    this.node = new Int32Array(g.volume.length).fill(-1);
    const rootNodes = new Map<number, number>();
    for (let c = 0; c < this.node.length; c++) if (g.volume[c] > 0) {
      const root = g.representative[c];
      if (!rootNodes.has(root)) rootNodes.set(root, rootNodes.size);
      this.node[c] = rootNodes.get(root)!;
    }
    const n = rootNodes.size;
    this.volumes = new Float64Array(n);
    for (let c = 0; c < this.node.length; c++) if (this.node[c] >= 0) this.volumes[this.node[c]] += g.volume[c];
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const c = g.index(i, j, k);
      if (i < nx - 1) this.addEdge(c, c + 1, 0, g.uIndex(i + 1, j, k), g.dx);
      if (j < ny - 1) this.addEdge(c, c + nx, 1, g.vIndex(i, j + 1, k), g.dy);
      if (k < nz - 1) this.addEdge(c, c + nx * ny, 2, g.wIndex(i, j, k + 1), g.dz);
    }
    this.diagonal = new Float64Array(n);
    const adjacency: number[][] = Array.from({ length: n }, () => []);
    for (const e of this.edges) { const weight = e.area / e.distance; this.diagonal[e.a] += weight; this.diagonal[e.b] += weight; adjacency[e.a].push(e.b); adjacency[e.b].push(e.a); }
    this.anchors = new Uint8Array(n); this.component = new Int32Array(n).fill(-1);
    let components = 0;
    for (let a = 0; a < n; a++) if (this.component[a] < 0) {
      this.anchors[a] = 1;
      const queue = [a]; this.component[a] = components;
      for (let q = 0; q < queue.length; q++) for (const b of adjacency[queue[q]]) if (this.component[b] < 0) { this.component[b] = components; queue.push(b); }
      components++;
    }
    this.componentCount = components;
    this.pressure = new Float64Array(n); this.rhs = new Float64Array(n); this.residual = new Float64Array(n);
    this.direction = new Float64Array(n); this.preconditioned = new Float64Array(n); this.product = new Float64Array(n);
    const fullVolume = g.dx * g.dy * g.dz;
    const fullEdgeCount = (nx - 1) * ny * nz + nx * (ny - 1) * nz + nx * ny * (nz - 1);
    if (n === g.volume.length && this.edges.length === fullEdgeCount &&
      g.volume.every(v => Math.abs(v - fullVolume) < 1e-12 * fullVolume) &&
      this.edges.every(e => Math.abs(e.area * e.distance - fullVolume) < 1e-12 * fullVolume)) {
      this.boxPressure = new BoxPressureSolver([nx, ny, nz], [g.dx, g.dy, g.dz]);
    }
  }
  private addEdge(ca: number, cb: number, axis: 0 | 1 | 2, face: number, distance: number) {
    const a = this.node[ca], b = this.node[cb], area = this.openings[axis][face];
    if (a >= 0 && b >= 0 && a !== b && area > 0) this.edges.push({ a, b, axis, face, area, distance });
  }

  /** CFL <= .5 in all three directions, including cut-cell group outflow. */
  stableDt(maximum = 2, temperature?: ArrayLike<number>): number {
    const g = this.grid, outflow = new Float64Array(this.volumes.length), accelerationOutflow = new Float64Array(this.volumes.length);
    let rate = 0, acceleration = 0;
    let mean = 20, volume = 0, offset = 0;
    if (temperature) {
      for (let c = 0; c < g.volume.length; c++) { offset += (temperature[c] - 20) * g.volume[c]; volume += g.volume[c]; }
      mean += volume ? offset / volume : 0;
    }
    const betaG = 9.81 / Math.max(150, mean + 273.15);
    const faceAcceleration = new Float64Array(this.w.length);
    if (temperature) for (let k = 1; k < g.nz; k++) for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) {
      const a = g.index(i, j, k - 1), b = g.index(i, j, k), f = g.wIndex(i, j, k);
      if (g.openW[f] > 0 && g.volume[a] > 0 && g.volume[b] > 0) {
        faceAcceleration[f] = betaG * ((temperature[a] + temperature[b]) / 2 - mean);
        acceleration = Math.max(acceleration, Math.abs(faceAcceleration[f]) / g.dz);
      }
    }
    for (let axis = 0; axis < 3; axis++) {
      let maximumSpeed = 0;
      for (const q of this.arrays[axis]) maximumSpeed = Math.max(maximumSpeed, Math.abs(q));
      rate += maximumSpeed / [g.dx, g.dy, g.dz][axis];
    }
    for (const e of this.edges) {
      const q = this.arrays[e.axis][e.face] * e.area; outflow[q >= 0 ? e.a : e.b] += Math.abs(q);
      if (e.axis === 2) {
        const qAcceleration = faceAcceleration[e.face] * e.area;
        accelerationOutflow[qAcceleration >= 0 ? e.a : e.b] += Math.abs(qAcceleration);
      }
    }
    // A boundary outlet drains a cut-cell group just like an internal flux.
    for (let axis = 0; axis < 3; axis++) {
      const dims = this.counts[axis];
      for (let k = 0; k < dims[2]; k++) for (let j = 0; j < dims[1]; j++) for (let i = 0; i < dims[0]; i++) {
        const coords = [i, j, k], high = dims[axis] - 1;
        if (coords[axis] !== 0 && coords[axis] !== high) continue;
        const f = i + dims[0] * (j + dims[1] * k), speed = this.arrays[axis][f];
        const outward = coords[axis] === 0 ? -speed : speed;
        if (outward <= 0) continue;
        coords[axis] = coords[axis] === 0 ? 0 : high - 1;
        const node = this.node[g.index(coords[0], coords[1], coords[2])];
        if (node >= 0) outflow[node] += outward * this.openings[axis][f];
      }
    }
    // Solve a*dt²+b*dt <= .5 using a cancellation-safe positive root.
    const limit = (b: number, a: number) => a > 0 ? 1 / (b + Math.sqrt(b * b + 2 * a)) : b > 0 ? 0.5 / b : maximum;
    let dt = limit(rate, acceleration);
    for (let n = 0; n < outflow.length; n++) dt = Math.min(dt, limit(outflow[n] / this.volumes[n], accelerationOutflow[n] / this.volumes[n]));
    return Math.min(maximum, dt);
  }

  step(temperature: ArrayLike<number>, dt: number, boundary: BoundaryFlow[] = [], buoyancy = true): FlowResult {
    if (!(dt > 0) || !Number.isFinite(dt)) return { converged: false, residual: Infinity, maxDivergence: Infinity, iterations: 0 };
    this.enforceBoundaries(boundary);
    this.updateMixing();
    this.transportMomentum(dt);
    this.diffuseMomentum(dt);
    const g = this.grid;
    let mean = 0, volume = 0;
    for (let c = 0; c < g.volume.length; c++) { mean += (temperature[c] - 20) * g.volume[c]; volume += g.volume[c]; }
    mean = volume ? 20 + mean / volume : 20;
    const betaG = 9.81 / Math.max(150, mean + 273.15);
    if (buoyancy) for (let k = 1; k < g.nz; k++) for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) {
      const face = g.wIndex(i, j, k), a = g.index(i, j, k - 1), b = g.index(i, j, k);
      if (g.openW[face] > 0 && g.volume[a] > 0 && g.volume[b] > 0) this.w[face] += dt * betaG * ((temperature[a] + temperature[b]) / 2 - mean);
    }
    this.enforceBoundaries(boundary);
    return this.project(dt, boundary);
  }

  /** Allows prescribed balanced inlet/outlet velocities to participate in projection. */
  project(dt: number, boundary: BoundaryFlow[] = []): FlowResult {
    this.enforceBoundaries(boundary);
    this.rhs.fill(0);
    for (const e of this.edges) { const q = e.area * this.arrays[e.axis][e.face]; this.rhs[e.a] -= q / dt; this.rhs[e.b] += q / dt; }
    const g = this.grid;
    for (const b of boundary) {
      const c = this.boundaryCell(b);
      if (c < 0 || this.node[c] < 0) continue;
      const dims = this.counts[b.axis], coord = b.axis === 0 ? b.index % dims[0] : b.axis === 1 ? Math.floor(b.index / dims[0]) % dims[1] : Math.floor(b.index / (dims[0] * dims[1]));
      const sign = coord === 0 ? -1 : 1;
      this.rhs[this.node[c]] -= sign * this.openings[b.axis][b.index] * b.velocity / dt;
    }
    const componentNet = new Float64Array(this.componentCount), componentGross = new Float64Array(this.componentCount);
    for (let n = 0; n < this.rhs.length; n++) { componentNet[this.component[n]] += this.rhs[n]; componentGross[this.component[n]] += Math.abs(this.rhs[n]); }
    for (let c = 0; c < componentNet.length; c++) if (Math.abs(componentNet[c]) > 1e-9 * Math.max(1, componentGross[c])) {
      return { converged: false, residual: Math.abs(componentNet[c]), maxDivergence: Infinity, iterations: 0 };
    }
    let relativeResidual = 0, iterations = 0;
    if (this.boxPressure) {
      this.boxPressure.solve(this.rhs, this.pressure);
      // Verify the actual residual with the same graph used by the general solver.
      this.multiply(this.pressure, this.product);
      let error = 0, norm = 0;
      for (let n = 0; n < this.rhs.length; n++) if (!this.anchors[n]) { error += (this.rhs[n] - this.product[n]) ** 2; norm += this.rhs[n] ** 2; }
      relativeResidual = norm ? Math.sqrt(error / norm) : 0;
      iterations = 1;
    } else {
      let rhsNorm = 0;
      for (let n = 0; n < this.rhs.length; n++) { if (this.anchors[n]) this.rhs[n] = 0; rhsNorm += this.rhs[n] ** 2; }
      rhsNorm = Math.sqrt(rhsNorm);
      if (!rhsNorm) this.pressure.fill(0);
      this.multiply(this.pressure, this.product);
      let initialNorm = 0;
      for (let n = 0; n < this.rhs.length; n++) {
        const r = this.rhs[n] - this.product[n]; this.residual[n] = r; initialNorm += r * r;
        this.direction[n] = this.preconditioned[n] = this.diagonal[n] > 0 ? r / this.diagonal[n] : 0;
      }
      let rz = dot(this.residual, this.preconditioned);
      relativeResidual = rhsNorm ? Math.sqrt(initialNorm) / rhsNorm : 0;
      const tolerance = 1e-7; // Stricter than public 1e-5 gate to control divergence in small cut cells.
      const limit = Math.min(2000, Math.max(50, this.rhs.length));
      while (relativeResidual > tolerance && iterations < limit) {
        this.multiply(this.direction, this.product);
        const denominator = dot(this.direction, this.product);
        if (!(denominator > 0) || !Number.isFinite(rz)) break;
        const alpha = rz / denominator;
        let rNorm = 0;
        for (let n = 0; n < this.rhs.length; n++) { this.pressure[n] += alpha * this.direction[n]; this.residual[n] -= alpha * this.product[n]; rNorm += this.residual[n] ** 2; this.preconditioned[n] = this.diagonal[n] > 0 ? this.residual[n] / this.diagonal[n] : 0; }
        const nextRz = dot(this.residual, this.preconditioned), beta = nextRz / rz;
        for (let n = 0; n < this.rhs.length; n++) this.direction[n] = this.preconditioned[n] + beta * this.direction[n];
        rz = nextRz; relativeResidual = Math.sqrt(rNorm) / rhsNorm; iterations++;
      }
    }
    for (const e of this.edges) this.arrays[e.axis][e.face] -= dt * (this.pressure[e.b] - this.pressure[e.a]) / e.distance;
    this.enforceBoundaries(boundary);
    const net = new Float64Array(this.volumes.length);
    for (const e of this.edges) { const q = e.area * this.arrays[e.axis][e.face]; net[e.a] += q; net[e.b] -= q; }
    for (const b of boundary) {
      const c = this.boundaryCell(b); if (c < 0 || this.node[c] < 0) continue;
      const dims = this.counts[b.axis], coord = b.axis === 0 ? b.index % dims[0] : b.axis === 1 ? Math.floor(b.index / dims[0]) % dims[1] : Math.floor(b.index / (dims[0] * dims[1]));
      net[this.node[c]] += (coord === 0 ? -1 : 1) * this.openings[b.axis][b.index] * b.velocity;
    }
    let maxDivergence = 0;
    for (let n = 0; n < net.length; n++) maxDivergence = Math.max(maxDivergence, Math.abs(net[n]) / this.volumes[n]);
    return { converged: Number.isFinite(relativeResidual) && relativeResidual <= 1e-5, residual: relativeResidual, maxDivergence, iterations };
  }
  private multiply(x: Float64Array, result: Float64Array) {
    result.fill(0);
    for (const e of this.edges) {
      const q = e.area / e.distance * (x[e.a] - x[e.b]);
      if (!this.anchors[e.a]) result[e.a] += q;
      if (!this.anchors[e.b]) result[e.b] -= q;
    }
  }
  private boundaryCell(b: BoundaryFlow): number {
    const dims = this.counts[b.axis], i = b.index % dims[0], j = Math.floor(b.index / dims[0]) % dims[1], k = Math.floor(b.index / (dims[0] * dims[1]));
    const coord = [i, j, k], limit = [this.grid.nx, this.grid.ny, this.grid.nz];
    if (coord[b.axis] !== 0 && coord[b.axis] !== limit[b.axis]) return -1;
    coord[b.axis] = coord[b.axis] === 0 ? 0 : coord[b.axis] - 1;
    return this.grid.index(coord[0], coord[1], coord[2]);
  }
  private enforceBoundaries(boundary: BoundaryFlow[]) {
    const g = this.grid, sizes = [g.nx, g.ny, g.nz];
    for (let axis = 0; axis < 3; axis++) {
      const q = this.arrays[axis], dims = this.counts[axis];
      for (let k = 0; k < dims[2]; k++) for (let j = 0; j < dims[1]; j++) for (let i = 0; i < dims[0]; i++) {
        const coords = [i, j, k], index = i + dims[0] * (j + dims[1] * k);
        if (!this.openings[axis][index] || coords[axis] === 0 || coords[axis] === sizes[axis]) q[index] = 0;
        else {
          const prev = [...coords]; prev[axis]--;
          if (!g.volume[g.index(...prev as [number, number, number])] || !g.volume[g.index(...coords as [number, number, number])]) q[index] = 0;
        }
      }
    }
    for (const b of boundary) if (b.index >= 0 && b.index < this.arrays[b.axis].length && this.boundaryCell(b) >= 0 && this.openings[b.axis][b.index] > 0) this.arrays[b.axis][b.index] = b.velocity;
  }
  private updateMixing() {
    const g = this.grid, h = [g.dx, g.dy, g.dz], delta = Math.cbrt(g.dx * g.dy * g.dz);
    const centers = [new Float64Array(g.volume.length), new Float64Array(g.volume.length), new Float64Array(g.volume.length)];
    for (let k = 0; k < g.nz; k++) for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) {
      const c = g.index(i, j, k);
      centers[0][c] = (this.u[g.uIndex(i, j, k)] + this.u[g.uIndex(i + 1, j, k)]) / 2;
      centers[1][c] = (this.v[g.vIndex(i, j, k)] + this.v[g.vIndex(i, j + 1, k)]) / 2;
      centers[2][c] = (this.w[g.wIndex(i, j, k)] + this.w[g.wIndex(i, j, k + 1)]) / 2;
    }
    const strides = [1, g.nx, g.nx * g.ny], limits = [g.nx, g.ny, g.nz];
    for (let k = 0; k < g.nz; k++) for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) {
      const c = g.index(i, j, k); if (!g.volume[c]) { this.eddyDiffusivity[c] = 0; continue; }
      const coords = [i, j, k], grad = new Float64Array(9);
      grad[0] = (this.u[g.uIndex(i + 1, j, k)] - this.u[g.uIndex(i, j, k)]) / g.dx;
      grad[4] = (this.v[g.vIndex(i, j + 1, k)] - this.v[g.vIndex(i, j, k)]) / g.dy;
      grad[8] = (this.w[g.wIndex(i, j, k + 1)] - this.w[g.wIndex(i, j, k)]) / g.dz;
      for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) if (a !== b) {
        const lo = coords[b] > 0 && g.volume[c - strides[b]] ? centers[a][c - strides[b]] : -centers[a][c];
        const hi = coords[b] < limits[b] - 1 && g.volume[c + strides[b]] ? centers[a][c + strides[b]] : -centers[a][c];
        grad[a * 3 + b] = (hi - lo) / (2 * h[b]);
      }
      let ss = 0;
      for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) ss += ((grad[a * 3 + b] + grad[b * 3 + a]) / 2) ** 2;
      this.eddyDiffusivity[c] = ((this.options.smagorinskyCs ?? CS) * delta) ** 2 * Math.sqrt(2 * ss) / this.turbulentPrandtl;
    }
  }
  /** Pairwise donor-cell momentum fluxes: each internal transfer is equal/opposite. */
  private transportMomentum(dt: number) {
    const g = this.grid, h = [g.dx, g.dy, g.dz], updates = this.arrays.map((q) => new Float64Array(q.length));
    for (let component = 0; component < 3; component++) {
      const q = this.arrays[component], dims = this.counts[component], area = this.openings[component], fullArea = h[(component + 1) % 3] * h[(component + 2) % 3];
      for (let k = 0; k < dims[2]; k++) for (let j = 0; j < dims[1]; j++) for (let i = 0; i < dims[0]; i++) {
        const coords = [i, j, k], a = i + dims[0] * (j + dims[1] * k); if (!area[a]) continue;
        for (let axis = 0; axis < 3; axis++) {
          if (coords[axis] + 1 >= dims[axis]) continue;
          const stride = axis === 0 ? 1 : axis === 1 ? dims[0] : dims[0] * dims[1], b = a + stride; if (!area[b]) continue;
          let speed: number;
          if (axis === component) speed = (q[a] + q[b]) / 2;
          else {
            const transport = this.arrays[axis], td = this.counts[axis], face = [...coords]; face[axis]++;
            face[component] = Math.max(0, Math.min(td[component] - 1, coords[component] - 1));
            const fa = face[0] + td[0] * (face[1] + td[1] * face[2]);
            face[component] = Math.min(td[component] - 1, coords[component]);
            const fb = face[0] + td[0] * (face[1] + td[1] * face[2]);
            speed = (transport[fa] + transport[fb]) / 2;
          }
          const aperture = Math.min(area[a], area[b]) / fullArea;
          const flux = speed * (speed >= 0 ? q[a] : q[b]) * dt / h[axis] * aperture;
          updates[component][a] -= flux; updates[component][b] += flux;
        }
      }
    }
    for (let c = 0; c < 3; c++) for (let f = 0; f < this.arrays[c].length; f++) this.arrays[c][f] += updates[c][f];
  }
  /** Backward Euler momentum diffusion with physical molecular + Smagorinsky viscosity.
   * Tangential walls use an antisymmetric ghost value (zero velocity at the wall).
   */
  private diffuseMomentum(dt: number) {
    const g = this.grid, h = [g.dx, g.dy, g.dz];
    for (let component = 0; component < 3; component++) {
      const q = this.arrays[component], before = q.slice(), dims = this.counts[component], areas = this.openings[component];
      let next = q.slice();
      for (let iteration = 0; iteration < 60; iteration++) {
        let change = 0;
        for (let k = 0; k < dims[2]; k++) for (let j = 0; j < dims[1]; j++) for (let i = 0; i < dims[0]; i++) {
          const coords = [i, j, k], f = i + dims[0] * (j + dims[1] * k);
          if (!areas[f]) { next[f] = 0; continue; }
          if (coords[component] === 0 || coords[component] === dims[component] - 1) { next[f] = before[f]; continue; }
          const cell = g.index(Math.min(g.nx - 1, i), Math.min(g.ny - 1, j), Math.min(g.nz - 1, k));
          const viscosity = NU + this.eddyDiffusivity[cell] * this.turbulentPrandtl;
          let sum = before[f], diagonal = 1;
          for (let axis = 0; axis < 3; axis++) for (const direction of [-1, 1]) {
            const stride = axis === 0 ? 1 : axis === 1 ? dims[0] : dims[0] * dims[1], neighbor = f + direction * stride, coefficient = viscosity * dt / (h[axis] ** 2);
            if (coords[axis] + direction < 0 || coords[axis] + direction >= dims[axis]) {
              // Tangential velocity lies half a cell from room walls.
              diagonal += (axis === component ? 1 : 2) * coefficient;
            } else if (!areas[neighbor]) diagonal += 2 * coefficient;
            else { diagonal += coefficient; sum += coefficient * q[neighbor]; }
          }
          next[f] = sum / diagonal; change = Math.max(change, Math.abs(next[f] - q[f]));
        }
        q.set(next);
        if (change < 1e-9) break;
      }
    }
  }
}
function dot(a: Float64Array, b: Float64Array): number { let sum = 0; for (let i = 0; i < a.length; i++) sum += a[i] * b[i]; return sum; }

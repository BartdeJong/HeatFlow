import { DEFAULT_PHYSICS, FURNITURE_MATERIALS, wallRegions, wallU, type PhysicsParams, type RoomConfig } from './config';
import { furnitureBoxes } from './furniture';

const TARGET_CELLS = 30;
const CONVECTION_CELLS = 20;
const MAX_SUBSTEPS_PER_CALL = 160;
const FLOW_SECONDS = 1;
const PRESSURE_ITERATIONS = 24;

/** Trilinear sampling of a cell-centred 3D grid. */
function trilerp(f: Float32Array, nx: number, ny: number, nz: number, x: number, y: number, z: number): number {
  x = Math.max(0, Math.min(nx - 1, x));
  y = Math.max(0, Math.min(ny - 1, y));
  z = Math.max(0, Math.min(nz - 1, z));
  const i = Math.min(nx - 2, Math.floor(x));
  const j = Math.min(ny - 2, Math.floor(y));
  const k = Math.min(nz - 2, Math.floor(z));
  const sx = x - i, sy = y - j, sz = z - k;
  const a = (k * ny + j) * nx + i;
  const b = a + nx * ny;
  const lo = (f[a] * (1 - sx) + f[a + 1] * sx) * (1 - sy) + (f[a + nx] * (1 - sx) + f[a + nx + 1] * sx) * sy;
  const hi = (f[b] * (1 - sx) + f[b + 1] * sx) * (1 - sy) + (f[b + nx] * (1 - sx) + f[b + nx + 1] * sx) * sy;
  return lo * (1 - sz) + hi * sz;
}

/**
 * Volumetric finite-volume heat solver. x = width, y = length, z = height above floor.
 * All six faces exchange U·A·ΔT with outside. Optional 3D buoyancy uses a staggered
 * velocity grid, solid-wall pressure projection and conservative upwind heat transport.
 */
export class Simulation {
  readonly nx: number;
  readonly ny: number;
  readonly nz: number;
  readonly dx: number;
  readonly dy: number;
  readonly dz: number;
  readonly dt: number;
  readonly params: PhysicsParams;
  readonly convection: boolean;
  T: Float32Array;
  /** Occupied voxels are thermal solids, excluded from airflow and air-temperature statistics. */
  readonly solid: Uint8Array;
  elapsed = 0;

  private next: Float32Array;
  private room: RoomConfig;
  private sources: { cells: Int32Array; watts: number }[] = [];
  /** Sum of U·area over the exposed faces of each voxel, W/K. */
  private lossUA: Float32Array;
  private readonly cellCap: number;
  private capacities: Float64Array;
  private owner: Int32Array;
  private gx: Float32Array;
  private gy: Float32Array;
  private gz: Float32Array;
  private hasFurniture = false;
  private u: Float32Array;
  private v: Float32Array;
  private w: Float32Array;
  private openU: Uint8Array;
  private openV: Uint8Array;
  private openW: Uint8Array;
  private flowTime = 0;

  constructor(room: RoomConfig, params: PhysicsParams = DEFAULT_PHYSICS) {
    this.room = room;
    this.params = params;
    this.convection = room.convection;
    const target = this.convection ? CONVECTION_CELLS : TARGET_CELLS;
    const cell = Math.max(room.widthM, room.heightM, room.ceilingM) / target;
    this.nx = Math.max(2, Math.round(room.widthM / cell));
    this.ny = Math.max(2, Math.round(room.heightM / cell));
    this.nz = Math.max(2, Math.round(room.ceilingM / cell));
    this.dx = room.widthM / this.nx;
    this.dy = room.heightM / this.ny;
    this.dz = room.ceilingM / this.nz;
    const { dx, dy, dz } = this;
    const capacity = params.airDensity * params.airCp * params.massFactor;
    this.cellCap = capacity * dx * dy * dz;
    const alpha = this.convection ? params.convectionAlpha : params.alpha;
    const n = this.nx * this.ny * this.nz;
    this.T = new Float32Array(n).fill(params.initialC);
    this.next = new Float32Array(n);
    this.lossUA = new Float32Array(n);
    this.solid = new Uint8Array(n);
    this.owner = new Int32Array(n).fill(-1);
    this.capacities = new Float64Array(n).fill(this.cellCap);
    this.gx = new Float32Array(n);
    this.gy = new Float32Array(n);
    this.gz = new Float32Array(n);
    this.u = new Float32Array((this.nx + 1) * this.ny * this.nz);
    this.v = new Float32Array(this.nx * (this.ny + 1) * this.nz);
    this.w = new Float32Array(this.nx * this.ny * (this.nz + 1));
    this.openU = new Uint8Array(this.u.length);
    this.openV = new Uint8Array(this.v.length);
    this.openW = new Uint8Array(this.w.length);
    const { maxRate, minCapacity } = this.buildFurniture();
    // Include thermal interfaces and worst-case outside loss for live opening/wall changes.
    const diffusionRate = Math.max(maxRate, 2 * alpha * (1 / dx ** 2 + 1 / dy ** 2 + 1 / dz ** 2));
    const boundaryRate = 60 * params.uScale * (dy * dz + dx * dz + dx * dy) / minCapacity;
    this.dt = Math.min(1, 0.9 / (diffusionRate + boundaryRate));
    this.setRoom(room);
  }

  private buildFurniture(): { maxRate: number; minCapacity: number } {
    const { nx, ny, nz, dx, dy, dz, solid, owner, capacities, gx, gy, gz } = this;
    const volume = dx * dy * dz;
    const materials = this.room.furniture.map((f) => FURNITURE_MATERIALS.find((m) => m.id === f.material)!);
    for (let f = 0; f < this.room.furniture.length; f++) {
      for (const box of furnitureBoxes(this.room.furniture[f])) {
        const from = box.min.map((value, axis) => Math.max(0, Math.floor((value + 1e-8) / [dx, dy, dz][axis])));
        const to = box.max.map((value, axis) => Math.min([nx, ny, nz][axis], Math.ceil((value - 1e-8) / [dx, dy, dz][axis])));
        for (let z = from[2]; z < to[2]; z++) for (let y = from[1]; y < to[1]; y++) for (let x = from[0]; x < to[0]; x++) {
          const i = (z * ny + y) * nx + x;
          solid[i] = 1; owner[i] = f;
          capacities[i] = materials[f].capacity * volume;
          this.hasFurniture = true;
        }
      }
    }
    const alpha = this.convection ? this.params.convectionAlpha : this.params.alpha;
    const conductance = (a: number, b: number, area: number, spacing: number) => {
      if (!solid[a] && !solid[b]) return alpha * this.cellCap / spacing ** 2;
      if (solid[a] && solid[b]) return area / (spacing / 2 / materials[owner[a]].k + spacing / 2 / materials[owner[b]].k);
      const material = materials[owner[solid[a] ? a : b]];
      return area / (1 / material.h + spacing / 2 / material.k);
    };
    const plane = nx * ny;
    for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      const i = (z * ny + y) * nx + x;
      if (x < nx - 1) {
        gx[i] = conductance(i, i + 1, dy * dz, dx);
        this.openU[(z * ny + y) * (nx + 1) + x + 1] = Number(!solid[i] && !solid[i + 1]);
      }
      if (y < ny - 1) {
        gy[i] = conductance(i, i + nx, dx * dz, dy);
        this.openV[(z * (ny + 1) + y + 1) * nx + x] = Number(!solid[i] && !solid[i + nx]);
      }
      if (z < nz - 1) {
        gz[i] = conductance(i, i + plane, dx * dy, dz);
        this.openW[i + plane] = Number(!solid[i] && !solid[i + plane]);
      }
    }
    let maxRate = 0, minCapacity = this.cellCap;
    for (let i = 0; i < solid.length; i++) {
      const x = i % nx, y = Math.floor(i / nx) % ny, z = Math.floor(i / plane);
      const g = gx[i] + gy[i] + gz[i] + (x > 0 ? gx[i - 1] : 0) + (y > 0 ? gy[i - nx] : 0) + (z > 0 ? gz[i - plane] : 0);
      maxRate = Math.max(maxRate, g / capacities[i]);
      minCapacity = Math.min(minCapacity, capacities[i]);
    }
    return { maxRate, minCapacity };
  }

  /** Size, convection mode and furniture are fixed at construction. Other settings update live. */
  setRoom(room: RoomConfig): void {
    this.room = room;
    const radius = Math.max(0.25, 1.2 * Math.max(this.dx, this.dy, this.dz));
    this.sources = room.sources.map((s) => {
      const cells: number[] = [];
      let nearest = 0, distance = Infinity;
      for (let z = 0; z < this.nz; z++) for (let y = 0; y < this.ny; y++) for (let x = 0; x < this.nx; x++) {
        const d = ((x + 0.5) * this.dx - s.x) ** 2 + ((y + 0.5) * this.dy - s.y) ** 2 + ((z + 0.5) * this.dz - s.z) ** 2;
        const i = (z * this.ny + y) * this.nx + x;
        if (d <= radius ** 2) cells.push(i);
        if (d < distance) { distance = d; nearest = i; }
      }
      if (!cells.length) cells.push(nearest);
      return { cells: Int32Array.from(cells), watts: (s.kind === 'cold' ? -1 : 1) * s.powerKW * 1000 };
    });
    this.updateLoss();
  }

  private updateLoss(): void {
    const { nx, ny, nz, dx, dy, dz, lossUA } = this;
    const scale = this.params.uScale;
    lossUA.fill(0);
    const floorUA = wallU(this.room.wall) * dx * dy * scale;
    for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      lossUA[y * nx + x] += floorUA;
      lossUA[((nz - 1) * ny + y) * nx + x] += floorUA;
    }
    for (const side of ['top', 'bottom', 'left', 'right'] as const) {
      const horizontal = side === 'top' || side === 'bottom';
      const count = horizontal ? nx : ny;
      const ds = horizontal ? dx : dy;
      const regions = wallRegions(this.room, side);
      for (let z = 0; z < nz; z++) for (let a = 0; a < count; a++) {
        let ua = 0;
        for (const p of regions) {
          const along = Math.max(0, Math.min((a + 1) * ds, p.to) - Math.max(a * ds, p.from));
          const height = Math.max(0, Math.min((z + 1) * dz, p.top) - Math.max(z * dz, p.bottom));
          ua += p.u * along * height;
        }
        const x = horizontal ? a : side === 'left' ? 0 : nx - 1;
        const y = horizontal ? side === 'top' ? 0 : ny - 1 : a;
        lossUA[(z * ny + y) * nx + x] += ua * scale;
      }
    }
  }

  reset(): void {
    this.T.fill(this.params.initialC);
    this.u.fill(0); this.v.fill(0); this.w.fill(0);
    this.flowTime = 0;
    this.elapsed = 0;
  }

  /** Advance at most the work cap; caller can retain unconsumed time. Zero time does no work. */
  advance(seconds: number): number {
    if (!Number.isFinite(seconds) || seconds <= 0) return 0;
    let advanced = 0;
    for (let i = 0; i < MAX_SUBSTEPS_PER_CALL && advanced < seconds - 1e-9; i++) {
      const dt = Math.min(this.dt, seconds - advanced);
      this.step(dt);
      if (this.convection) {
        this.flowTime += dt;
        if (this.flowTime >= FLOW_SECONDS) { this.flowStep(this.flowTime); this.flowTime = 0; }
      }
      advanced += dt;
    }
    this.elapsed += advanced;
    return advanced;
  }

  private step(dt: number): void {
    if (this.hasFurniture) { this.furnishedStep(dt); return; }
    const { nx, ny, nz, dx, dy, dz, T, next: out, lossUA, cellCap } = this;
    const alpha = this.convection ? this.params.convectionAlpha : this.params.alpha;
    const rx = alpha * dt / dx ** 2, ry = alpha * dt / dy ** 2, rz = alpha * dt / dz ** 2;
    const plane = nx * ny;
    for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      const i = (z * ny + y) * nx + x;
      const c = T[i];
      out[i] = c + rx * ((x > 0 ? T[i - 1] : c) + (x < nx - 1 ? T[i + 1] : c) - 2 * c)
        + ry * ((y > 0 ? T[i - nx] : c) + (y < ny - 1 ? T[i + nx] : c) - 2 * c)
        + rz * ((z > 0 ? T[i - plane] : c) + (z < nz - 1 ? T[i + plane] : c) - 2 * c)
        - lossUA[i] * dt / cellCap * (c - this.room.outsideC);
    }
    for (const s of this.sources) {
      const dT = s.watts * dt / cellCap / s.cells.length;
      for (const i of s.cells) out[i] += dT;
    }
    this.next = T;
    this.T = out;
  }

  /** Pairwise heat transfers conserve energy across air/solid and solid/solid interfaces. */
  private furnishedStep(dt: number): void {
    const { nx, ny, nz, T, next: out, capacities, gx, gy, gz } = this;
    const plane = nx * ny;
    for (let i = 0; i < T.length; i++) out[i] = T[i] - this.lossUA[i] * dt / capacities[i] * (T[i] - this.room.outsideC);
    for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      const i = (z * ny + y) * nx + x;
      if (x < nx - 1) {
        const heat = gx[i] * dt * (T[i + 1] - T[i]);
        out[i] += heat / capacities[i]; out[i + 1] -= heat / capacities[i + 1];
      }
      if (y < ny - 1) {
        const heat = gy[i] * dt * (T[i + nx] - T[i]);
        out[i] += heat / capacities[i]; out[i + nx] -= heat / capacities[i + nx];
      }
      if (z < nz - 1) {
        const heat = gz[i] * dt * (T[i + plane] - T[i]);
        out[i] += heat / capacities[i]; out[i + plane] -= heat / capacities[i + plane];
      }
    }
    for (const s of this.sources) {
      const heat = s.watts * dt / s.cells.length;
      for (const i of s.cells) out[i] += heat / capacities[i];
    }
    this.next = T; this.T = out;
  }

  private flowStep(dt: number): void {
    const { nx, ny, nz, dx, dy, dz, u, v, w, T } = this;
    const uw = nx + 1, vh = ny + 1, plane = nx * ny;
    const mean = this.stats().mean;
    const damp = Math.exp(-dt / 4);
    for (let i = 0; i < u.length; i++) u[i] *= damp * this.openU[i];
    for (let i = 0; i < v.length; i++) v[i] *= damp * this.openV[i];
    for (let z = 1; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      const i = (z * ny + y) * nx + x;
      const faceC = (T[i - plane] + T[i]) / 2;
      w[i] = this.openW[i] ? w[i] * damp + (9.81 / 293) * dt * (faceC - mean) : 0;
    }
    // Weighted projection handles unequal spacings. Exterior normal velocities stay zero.
    const ax = 1 / dx ** 2, ay = 1 / dy ** 2, az = 1 / dz ** 2;
    for (let it = 0; it < PRESSURE_ITERATIONS; it++) {
      for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
        const ui = (z * ny + y) * uw + x;
        const vi = (z * vh + y) * nx + x;
        const wi = (z * ny + y) * nx + x;
        if (this.solid[wi]) continue;
        const sx0 = this.openU[ui], sx1 = this.openU[ui + 1];
        const sy0 = this.openV[vi], sy1 = this.openV[vi + nx];
        const sz0 = this.openW[wi], sz1 = this.openW[wi + plane];
        const weight = (sx0 + sx1) * ax + (sy0 + sy1) * ay + (sz0 + sz1) * az;
        if (!weight) continue;
        const div = (u[ui + 1] - u[ui]) / dx + (v[vi + nx] - v[vi]) / dy + (w[wi + plane] - w[wi]) / dz;
        const p = -1.6 * div / weight;
        if (sx0) u[ui] -= p / dx;
        if (sx1) u[ui + 1] += p / dx;
        if (sy0) v[vi] -= p / dy;
        if (sy1) v[vi + nx] += p / dy;
        if (sz0) w[wi] -= p / dz;
        if (sz1) w[wi + plane] += p / dz;
      }
    }
    // Equal heat transfers across each internal face conserve energy. CFL substeps keep
    // explicit upwind transport stable. Subtracting mean reduces projection residual error.
    let rate = 0;
    for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      const ui = (z * ny + y) * uw + x, vi = (z * vh + y) * nx + x, wi = (z * ny + y) * nx + x;
      rate = Math.max(rate, (Math.max(0, u[ui + 1]) + Math.max(0, -u[ui])) / dx + (Math.max(0, v[vi + nx]) + Math.max(0, -v[vi])) / dy + (Math.max(0, w[wi + plane]) + Math.max(0, -w[wi])) / dz);
    }
    const steps = Math.max(1, Math.ceil(dt * rate / 0.8));
    const h = dt / steps;
    for (let step = 0; step < steps; step++) {
      const src = this.T, out = this.next;
      out.set(src);
      for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
        const i = (z * ny + y) * nx + x;
        if (x < nx - 1 && this.openU[(z * ny + y) * uw + x + 1]) {
          const speed = u[(z * ny + y) * uw + x + 1];
          const flux = h / dx * speed * ((speed > 0 ? src[i] : src[i + 1]) - mean);
          out[i] -= flux; out[i + 1] += flux;
        }
        if (y < ny - 1 && this.openV[(z * vh + y + 1) * nx + x]) {
          const speed = v[(z * vh + y + 1) * nx + x];
          const flux = h / dy * speed * ((speed > 0 ? src[i] : src[i + nx]) - mean);
          out[i] -= flux; out[i + nx] += flux;
        }
        if (z < nz - 1 && this.openW[i + plane]) {
          const speed = w[i + plane];
          const flux = h / dz * speed * ((speed > 0 ? src[i] : src[i + plane]) - mean);
          out[i] -= flux; out[i + plane] += flux;
        }
      }
      this.T = out; this.next = src;
    }
  }

  /** Total loss through all six faces, watts. Negative means outside is heating the room. */
  wallLossW(): number {
    let watts = 0;
    for (let i = 0; i < this.T.length; i++) watts += this.lossUA[i] * (this.T[i] - this.room.outsideC);
    return watts;
  }

  energyJ(): number {
    let sum = 0;
    for (let i = 0; i < this.T.length; i++) sum += (this.T[i] - this.room.outsideC) * this.capacities[i];
    return sum;
  }

  stats(): { min: number; max: number; mean: number } {
    let min = Infinity, max = -Infinity, sum = 0, count = 0;
    for (let i = 0; i < this.T.length; i++) {
      if (this.solid[i]) continue;
      const t = this.T[i]; min = Math.min(min, t); max = Math.max(max, t); sum += t; count++;
    }
    // A room completely filled by coarse solid voxels still has a finite display temperature.
    if (!count) for (const t of this.T) { min = Math.min(min, t); max = Math.max(max, t); sum += t; count++; }
    return { min, max, mean: sum / count };
  }

  furnitureTemperatures(): Record<number, number> {
    const sums = new Float64Array(this.room.furniture.length), counts = new Uint32Array(sums.length);
    for (let i = 0; i < this.T.length; i++) if (this.owner[i] >= 0) { sums[this.owner[i]] += this.T[i]; counts[this.owner[i]]++; }
    return Object.fromEntries(this.room.furniture.flatMap((f, i) => counts[i] ? [[f.id, sums[i] / counts[i]]] : []));
  }

  isSolid(x: number, y: number, z: number): boolean {
    const ix = Math.min(this.nx - 1, Math.max(0, Math.floor(x / this.dx)));
    const iy = Math.min(this.ny - 1, Math.max(0, Math.floor(y / this.dy)));
    const iz = Math.min(this.nz - 1, Math.max(0, Math.floor(z / this.dz)));
    return this.solid[(iz * this.ny + iy) * this.nx + ix] === 1;
  }

  /** Point in metres, with z above floor. Omitted z samples mid-height. */
  sample(x: number, y: number, z = this.room.ceilingM / 2): number {
    return trilerp(this.T, this.nx, this.ny, this.nz, x / this.dx - 0.5, y / this.dy - 0.5, z / this.dz - 0.5);
  }

  /** Local simulated airflow in metres/second, sampled on the staggered velocity grids. */
  sampleVelocity(x: number, y: number, z: number): [number, number, number] {
    if (this.isSolid(x, y, z)) return [0, 0, 0];
    return [
      trilerp(this.u, this.nx + 1, this.ny, this.nz, x / this.dx, y / this.dy - 0.5, z / this.dz - 0.5),
      trilerp(this.v, this.nx, this.ny + 1, this.nz, x / this.dx - 0.5, y / this.dy, z / this.dz - 0.5),
      trilerp(this.w, this.nx, this.ny, this.nz + 1, x / this.dx - 0.5, y / this.dy - 0.5, z / this.dz),
    ];
  }
}

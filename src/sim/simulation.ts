import {
  DEFAULT_PHYSICS,
  openingU,
  wallLength,
  wallU,
  type PhysicsParams,
  type RoomConfig,
  type WallSide,
} from './config';

const TARGET_CELLS = 100;
const TARGET_CELLS_CONVECTION = 64;
const MAX_SUBSTEPS_PER_CALL = 800;

const GRAVITY = 9.81;
/** Thermal expansion coefficient of air near room temperature, 1/K. */
const BETA = 1 / 293;
/** Time scale over which turbulence and viscosity damp the airflow, s. */
const FLOW_DRAG_TAU = 4;
const FLOW_STEP_SECONDS = 1;
const PRESSURE_ITERATIONS = 40;
const OVER_RELAXATION = 1.7;

interface SourceCells {
  cells: Int32Array;
  /** Signed power in watts (negative for cold sources). */
  watts: number;
}

function bilerp(f: Float32Array, w: number, h: number, fx: number, fy: number): number {
  const x = Math.min(w - 1, Math.max(0, fx));
  const y = Math.min(h - 1, Math.max(0, fy));
  const i0 = Math.min(w - 2, Math.floor(x));
  const j0 = Math.min(h - 2, Math.floor(y));
  const sx = x - i0;
  const sy = y - j0;
  const a = f[j0 * w + i0];
  const b = f[j0 * w + i0 + 1];
  const c = f[(j0 + 1) * w + i0];
  const d = f[(j0 + 1) * w + i0 + 1];
  return (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy;
}

/**
 * 2D explicit finite-difference heat model of a room.
 * Heat is injected or removed by point sources and exchanged with the outside through the
 * perimeter (walls, windows and doors). With convection enabled, a buoyancy-driven flow field
 * (stable-fluids solver on a staggered grid) carries heat upward; screen-up is "up".
 */
export class Simulation {
  readonly nx: number;
  readonly ny: number;
  readonly dx: number;
  readonly dt: number;
  readonly params: PhysicsParams;
  readonly convection: boolean;
  T: Float32Array;
  elapsed = 0;

  private next: Float32Array;
  private room: RoomConfig;
  private sources: SourceCells[] = [];
  /** Per-cell wall loss coefficient (sum of U over the cell's exposed faces), W/m²K. */
  private lossU: Float32Array;
  private lossK: Float32Array;
  /** Heat capacity of one cell in J/K. */
  private readonly cellCap: number;

  private u: Float32Array;
  private v: Float32Array;
  private u2: Float32Array;
  private v2: Float32Array;
  private tmpT: Float32Array;
  private readonly flowEvery: number;
  private flowCounter = 0;

  constructor(room: RoomConfig, params: PhysicsParams = DEFAULT_PHYSICS) {
    this.room = room;
    this.params = params;
    this.convection = room.convection;
    const target = this.convection ? TARGET_CELLS_CONVECTION : TARGET_CELLS;
    const alpha = this.convection ? params.convectionAlpha : params.alpha;
    this.dx = Math.max(room.widthM, room.heightM) / target;
    this.nx = Math.max(2, Math.round(room.widthM / this.dx));
    this.ny = Math.max(2, Math.round(room.heightM / this.dx));
    this.dt = (0.2 * this.dx * this.dx) / alpha;
    this.flowEvery = Math.max(1, Math.round(FLOW_STEP_SECONDS / this.dt));
    this.cellCap =
      params.airDensity * params.airCp * this.dx * this.dx * room.ceilingM * params.massFactor;

    const n = this.nx * this.ny;
    this.T = new Float32Array(n).fill(params.initialC);
    this.next = new Float32Array(n);
    this.tmpT = new Float32Array(n);
    this.lossU = new Float32Array(n);
    this.lossK = new Float32Array(n);
    this.u = new Float32Array((this.nx + 1) * this.ny);
    this.u2 = new Float32Array((this.nx + 1) * this.ny);
    this.v = new Float32Array(this.nx * (this.ny + 1));
    this.v2 = new Float32Array(this.nx * (this.ny + 1));
    this.setRoom(room);
  }

  /** Apply live-adjustable settings (sources, walls, openings). Size and convection are fixed at construction. */
  setRoom(room: RoomConfig): void {
    this.room = room;
    this.updateSources();
    this.updateLoss();
  }

  private updateSources(): void {
    const radius = Math.max(0.15, 1.5 * this.dx);
    this.sources = this.room.sources.map((s) => {
      const cells: number[] = [];
      let best = 0;
      let bestD = Infinity;
      for (let y = 0; y < this.ny; y++) {
        for (let x = 0; x < this.nx; x++) {
          const d = Math.hypot((x + 0.5) * this.dx - s.x, (y + 0.5) * this.dx - s.y);
          const i = y * this.nx + x;
          if (d <= radius) cells.push(i);
          if (d < bestD) {
            bestD = d;
            best = i;
          }
        }
      }
      if (cells.length === 0) cells.push(best);
      return {
        cells: Int32Array.from(cells),
        watts: (s.kind === 'cold' ? -1 : 1) * s.powerKW * 1000,
      };
    });
  }

  /** U-value for each cell along a wall, with openings overriding the wall construction. */
  private sideProfile(side: WallSide, count: number): Float32Array {
    const base = wallU(this.room.wall) * this.params.uScale;
    const profile = new Float32Array(count).fill(base);
    const len = wallLength(this.room, side);
    for (const o of this.room.openings) {
      if (o.side !== side) continue;
      const u = openingU(o) * this.params.uScale;
      const from = o.pos - o.length / 2;
      const to = o.pos + o.length / 2;
      let hit = false;
      for (let k = 0; k < count; k++) {
        const c = ((k + 0.5) / count) * len;
        if (c >= from && c <= to) {
          profile[k] = u;
          hit = true;
        }
      }
      if (!hit) profile[Math.min(count - 1, Math.max(0, Math.floor((o.pos / len) * count)))] = u;
    }
    return profile;
  }

  private updateLoss(): void {
    const { nx, ny, lossU, lossK, dt, dx } = this;
    const { airDensity, airCp, massFactor } = this.params;
    lossU.fill(0);
    const top = this.sideProfile('top', nx);
    const bottom = this.sideProfile('bottom', nx);
    const left = this.sideProfile('left', ny);
    const right = this.sideProfile('right', ny);
    for (let x = 0; x < nx; x++) {
      lossU[x] += top[x];
      lossU[(ny - 1) * nx + x] += bottom[x];
    }
    for (let y = 0; y < ny; y++) {
      lossU[y * nx] += left[y];
      lossU[y * nx + nx - 1] += right[y];
    }
    const k = dt / (airDensity * airCp * dx * massFactor);
    for (let i = 0; i < lossU.length; i++) lossK[i] = lossU[i] * k;
  }

  reset(): void {
    this.T.fill(this.params.initialC);
    this.u.fill(0);
    this.v.fill(0);
    this.flowCounter = 0;
    this.elapsed = 0;
  }

  /** Advance the simulation by roughly `seconds` of simulated time; returns time actually advanced. */
  advance(seconds: number): number {
    const steps = Math.min(MAX_SUBSTEPS_PER_CALL, Math.max(1, Math.round(seconds / this.dt)));
    for (let s = 0; s < steps; s++) {
      this.step();
      if (this.convection && ++this.flowCounter >= this.flowEvery) {
        this.flowCounter = 0;
        this.flowStep(this.flowEvery * this.dt);
      }
    }
    const advanced = steps * this.dt;
    this.elapsed += advanced;
    return advanced;
  }

  private step(): void {
    const { nx, ny, dt, dx, lossK, cellCap } = this;
    const alpha = this.convection ? this.params.convectionAlpha : this.params.alpha;
    const outsideC = this.room.outsideC;
    const T = this.T;
    const out = this.next;
    const r = (alpha * dt) / (dx * dx);

    for (let y = 0; y < ny; y++) {
      const row = y * nx;
      for (let x = 0; x < nx; x++) {
        const i = row + x;
        const c = T[i];
        const l = x > 0 ? T[i - 1] : c;
        const rt = x < nx - 1 ? T[i + 1] : c;
        const u = y > 0 ? T[i - nx] : c;
        const d = y < ny - 1 ? T[i + nx] : c;
        let v = c + r * (l + rt + u + d - 4 * c);
        const k = lossK[i];
        if (k !== 0) v -= k * (c - outsideC);
        out[i] = v;
      }
    }

    for (const s of this.sources) {
      const dT = (s.watts * dt) / cellCap / s.cells.length;
      for (let k = 0; k < s.cells.length; k++) out[s.cells[k]] += dT;
    }

    this.next = T;
    this.T = out;
  }

  /** Buoyancy, drag, pressure projection, then semi-Lagrangian advection of velocity and heat. */
  private flowStep(dt: number): void {
    const { nx, ny, dx } = this;
    let { u, v } = this;
    const T = this.T;
    const uw = nx + 1;

    let mean = 0;
    for (let i = 0; i < T.length; i++) mean += T[i];
    mean /= T.length;

    // Positive v points down the screen, so warm air gets a negative (upward) push.
    const buoy = GRAVITY * BETA * dt;
    for (let j = 1; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const tf = 0.5 * (T[(j - 1) * nx + i] + T[j * nx + i]);
        v[j * nx + i] -= buoy * (tf - mean);
      }
    }
    const damp = Math.exp(-dt / FLOW_DRAG_TAU);
    for (let i = 0; i < u.length; i++) u[i] *= damp;
    for (let i = 0; i < v.length; i++) v[i] *= damp;

    // Walls are solid: normal velocity is never touched on boundary faces, so it stays zero.
    for (let it = 0; it < PRESSURE_ITERATIONS; it++) {
      for (let j = 0; j < ny; j++) {
        const sy0 = j > 0 ? 1 : 0;
        const sy1 = j < ny - 1 ? 1 : 0;
        for (let i = 0; i < nx; i++) {
          const sx0 = i > 0 ? 1 : 0;
          const sx1 = i < nx - 1 ? 1 : 0;
          const s = sx0 + sx1 + sy0 + sy1;
          if (s === 0) continue;
          const div = u[j * uw + i + 1] - u[j * uw + i] + v[(j + 1) * nx + i] - v[j * nx + i];
          const p = (-div / s) * OVER_RELAXATION;
          u[j * uw + i] -= sx0 * p;
          u[j * uw + i + 1] += sx1 * p;
          v[j * nx + i] -= sy0 * p;
          v[(j + 1) * nx + i] += sy1 * p;
        }
      }
    }

    const k = dt / dx;
    const u2 = this.u2;
    const v2 = this.v2;
    u2.set(u);
    v2.set(v);
    for (let j = 0; j < ny; j++) {
      for (let i = 1; i < nx; i++) {
        const vv =
          0.25 * (v[j * nx + i - 1] + v[j * nx + i] + v[(j + 1) * nx + i - 1] + v[(j + 1) * nx + i]);
        const x = i - u[j * uw + i] * k;
        const y = j + 0.5 - vv * k;
        u2[j * uw + i] = bilerp(u, uw, ny, x, y - 0.5);
      }
    }
    for (let j = 1; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const uu =
          0.25 * (u[(j - 1) * uw + i] + u[(j - 1) * uw + i + 1] + u[j * uw + i] + u[j * uw + i + 1]);
        const x = i + 0.5 - uu * k;
        const y = j - v[j * nx + i] * k;
        v2[j * nx + i] = bilerp(v, nx, ny + 1, x - 0.5, y);
      }
    }
    this.u = u2;
    this.u2 = u;
    this.v = v2;
    this.v2 = v;
    u = this.u;
    v = this.v;

    const tmp = this.tmpT;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const uu = 0.5 * (u[j * uw + i] + u[j * uw + i + 1]);
        const vv = 0.5 * (v[j * nx + i] + v[(j + 1) * nx + i]);
        tmp[j * nx + i] = bilerp(T, nx, ny, i - uu * k, j - vv * k);
      }
    }
    // Semi-Lagrangian advection does not conserve heat; spread the small mismatch evenly.
    let before = 0;
    let after = 0;
    for (let i = 0; i < T.length; i++) {
      before += T[i];
      after += tmp[i];
    }
    const fix = (before - after) / T.length;
    if (fix !== 0) for (let i = 0; i < tmp.length; i++) tmp[i] += fix;
    this.tmpT = T;
    this.T = tmp;
  }

  /** Total heat currently lost through the perimeter, in watts (negative when the room gains heat). */
  wallLossW(): number {
    const { dx, lossU, T } = this;
    const outsideC = this.room.outsideC;
    const depthM = this.room.ceilingM;
    let sum = 0;
    for (let i = 0; i < lossU.length; i++) {
      if (lossU[i] !== 0) sum += lossU[i] * (T[i] - outsideC);
    }
    return sum * dx * depthM;
  }

  /** Total thermal energy above the outside temperature, in joules. */
  energyJ(): number {
    let sum = 0;
    for (let i = 0; i < this.T.length; i++) sum += this.T[i] - this.room.outsideC;
    return sum * this.cellCap;
  }

  stats(): { min: number; max: number; mean: number } {
    let min = Infinity;
    let max = -Infinity;
    let sum = 0;
    const T = this.T;
    for (let i = 0; i < T.length; i++) {
      const v = T[i];
      if (v < min) min = v;
      if (v > max) max = v;
      sum += v;
    }
    return { min, max, mean: sum / T.length };
  }

  /** Temperature in °C at a point given in metres from the room's top-left corner. */
  sample(xM: number, yM: number): number {
    const x = Math.min(this.nx - 1, Math.max(0, Math.floor(xM / this.dx)));
    const y = Math.min(this.ny - 1, Math.max(0, Math.floor(yM / this.dx)));
    return this.T[y * this.nx + x];
  }
}

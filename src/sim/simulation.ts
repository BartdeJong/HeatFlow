import { DEFAULT_PHYSICS, type PhysicsParams, type RoomConfig } from './config';

const TARGET_CELLS = 100;
const MAX_SUBSTEPS_PER_CALL = 800;

/**
 * 2D explicit finite-difference heat model of an air slice.
 * Heat is injected at a point source and escapes through the room's perimeter walls.
 */
export class Simulation {
  readonly nx: number;
  readonly ny: number;
  readonly dx: number;
  readonly dt: number;
  readonly params: PhysicsParams;
  T: Float32Array;
  elapsed = 0;

  private next: Float32Array;
  private faces: Uint8Array;
  private room: RoomConfig;
  private sourceCells: Int32Array = new Int32Array(0);
  /** Heat capacity of one cell in J/K. */
  private readonly cellCap: number;

  constructor(room: RoomConfig, params: PhysicsParams = DEFAULT_PHYSICS) {
    this.room = { ...room };
    this.params = params;
    this.dx = Math.max(room.widthM, room.heightM) / TARGET_CELLS;
    this.nx = Math.max(2, Math.round(room.widthM / this.dx));
    this.ny = Math.max(2, Math.round(room.heightM / this.dx));
    this.dt = (0.2 * this.dx * this.dx) / params.alpha;
    this.cellCap =
      params.airDensity * params.airCp * this.dx * this.dx * params.depthM * params.massFactor;

    const n = this.nx * this.ny;
    this.T = new Float32Array(n).fill(params.initialC);
    this.next = new Float32Array(n);
    this.faces = new Uint8Array(n);
    for (let y = 0; y < this.ny; y++) {
      for (let x = 0; x < this.nx; x++) {
        let f = 0;
        if (x === 0) f++;
        if (x === this.nx - 1) f++;
        if (y === 0) f++;
        if (y === this.ny - 1) f++;
        this.faces[y * this.nx + x] = f;
      }
    }
    this.updateSource();
  }

  /** Apply live-adjustable settings (power, insulation, source position). */
  setRoom(room: RoomConfig): void {
    this.room = { ...room };
    this.updateSource();
  }

  private updateSource(): void {
    const { sourceX, sourceY } = this.room;
    const radius = Math.max(0.15, 1.5 * this.dx);
    const cells: number[] = [];
    let best = 0;
    let bestD = Infinity;
    for (let y = 0; y < this.ny; y++) {
      for (let x = 0; x < this.nx; x++) {
        const d = Math.hypot((x + 0.5) * this.dx - sourceX, (y + 0.5) * this.dx - sourceY);
        const i = y * this.nx + x;
        if (d <= radius) cells.push(i);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
    }
    if (cells.length === 0) cells.push(best);
    this.sourceCells = Int32Array.from(cells);
  }

  reset(): void {
    this.T.fill(this.params.initialC);
    this.elapsed = 0;
  }

  /** Advance the simulation by roughly `seconds` of simulated time; returns time actually advanced. */
  advance(seconds: number): number {
    const steps = Math.min(MAX_SUBSTEPS_PER_CALL, Math.max(1, Math.round(seconds / this.dt)));
    for (let s = 0; s < steps; s++) this.step();
    const advanced = steps * this.dt;
    this.elapsed += advanced;
    return advanced;
  }

  private step(): void {
    const { nx, ny, dt, dx, faces, cellCap } = this;
    const { alpha, outsideC, airDensity, airCp, massFactor } = this.params;
    const T = this.T;
    const out = this.next;
    const r = (alpha * dt) / (dx * dx);
    const lossK = (this.room.uValue * dt) / (airDensity * airCp * dx * massFactor);

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
        const f = faces[i];
        if (f !== 0) v -= lossK * f * (c - outsideC);
        out[i] = v;
      }
    }

    const cells = this.sourceCells;
    const dT = (this.room.powerKW * 1000 * dt) / cellCap / cells.length;
    for (let k = 0; k < cells.length; k++) out[cells[k]] += dT;

    this.next = T;
    this.T = out;
  }

  /** Total heat currently lost through the walls, in watts. */
  wallLossW(): number {
    const { nx, ny, dx } = this;
    const { outsideC, depthM } = this.params;
    let sum = 0;
    for (let i = 0; i < nx * ny; i++) {
      const f = this.faces[i];
      if (f !== 0) sum += f * (this.T[i] - outsideC);
    }
    return sum * this.room.uValue * dx * depthM;
  }

  /** Total thermal energy above the outside temperature, in joules. */
  energyJ(): number {
    let sum = 0;
    for (let i = 0; i < this.T.length; i++) sum += this.T[i] - this.params.outsideC;
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

import {
  DEFAULT_PHYSICS,
  openingU,
  roofU,
  furnitureSize,
  wallLength,
  wallU,
  type FurnitureItem,
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

interface FurnitureState extends FurnitureItem {
  temperatureC: number;
  capacityJPerK: number;
  conductanceWPerK: number;
  cells: Int32Array;
}

export interface HeatLossBreakdown {
  roofW: number;
  wallsW: number;
  floorW: number;
  openingsW: number;
  totalW: number;
}

export interface HeatFlowVector {
  x: number;
  y: number;
  dx: number;
  dy: number;
  magnitude: number;
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
 * Heat is injected by point or underfloor sources, removed by point cold sources, and exchanged
 * with the outside through the perimeter (walls, windows and doors). With convection enabled, a
 * buoyancy-driven flow field (stable-fluids solver on a staggered grid) carries heat upward;
 * screen-up is "up".
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
  private furniture: FurnitureState[] = [];
  private thermostatHeating = true;
  private heatingEnergyJ = 0;
  private coolingEnergyJ = 0;
  private pendingSeconds = 0;
  /** Per-cell wall loss coefficient (sum of U over the cell's exposed faces), W/m²K. */
  private lossU: Float32Array;
  private lossK: Float32Array;
  /** Per-cell fractional temperature loss per step through the front and back walls. */
  private frontBackK = 0;
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
    this.dx = Math.max(room.widthM, room.ceilingM) / target;
    this.nx = Math.max(2, Math.round(room.widthM / this.dx));
    this.ny = Math.max(2, Math.round(room.ceilingM / this.dx));
    this.dt = (0.2 * this.dx * this.dx) / alpha;
    this.flowEvery = Math.max(1, Math.round(FLOW_STEP_SECONDS / this.dt));
    this.cellCap =
      params.airDensity * params.airCp * this.dx * this.dx * room.heightM * params.massFactor;

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
    const controlChanged =
      room.thermostat.enabled !== this.room.thermostat.enabled ||
      room.thermostat.targetC !== this.room.thermostat.targetC ||
      room.thermostat.deadbandC !== this.room.thermostat.deadbandC;
    if (!room.thermostat.enabled) {
      this.thermostatHeating = true;
    } else if (controlChanged) {
      let mean = 0;
      for (let i = 0; i < this.T.length; i++) mean += this.T[i];
      mean /= this.T.length;
      this.thermostatHeating = mean <= room.thermostat.targetC;
    }
    this.room = room;
    this.updateSources();
    this.updateLoss();
    this.updateFurniture();
  }

  private updateSources(): void {
    const radius = Math.max(0.15, 1.5 * this.dx);
    this.sources = this.room.sources.map((s) => {
      const cells: number[] = [];
      if (s.kind === 'heat' && this.room.heatingMode === 'underfloor') {
        for (let x = 0; x < this.nx; x++) cells.push((this.ny - 1) * this.nx + x);
        return {
          cells: Int32Array.from(cells),
          watts: s.powerKW * 1000,
        };
      }
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

  private updateFurniture(): void {
    const previous = new Map(this.furniture.map((f) => [f.id, f]));
    this.furniture = this.room.furniture.map((item) => {
      const { widthM, heightM } = furnitureSize(item.kind, this.room.widthM);
      const centerX = Math.min(this.room.widthM - widthM / 2, Math.max(widthM / 2, item.x));
      const cells: number[] = [];
      for (let y = 0; y < this.ny; y++) {
        const cy = (y + 0.5) * this.dx;
        if (cy < this.room.ceilingM - heightM) continue;
        for (let x = 0; x < this.nx; x++) {
          const cx = (x + 0.5) * this.dx;
          if (Math.abs(cx - centerX) <= widthM / 2) cells.push(y * this.nx + x);
        }
      }
      if (cells.length === 0) cells.push((this.ny - 1) * this.nx + Math.min(this.nx - 1, Math.floor(centerX / this.dx)));
      const old = previous.get(item.id);
      const sameKind = old?.kind === item.kind;
      return {
        ...item,
        temperatureC: sameKind ? old.temperatureC : this.params.initialC,
        capacityJPerK: item.kind === 'sofa' ? 160_000 : 55_000,
        conductanceWPerK: item.kind === 'sofa' ? 180 : 65,
        cells: Int32Array.from(cells),
      };
    });
  }

  /** U-value for each cell along a wall, with openings overriding the wall construction. */
  private sideProfile(side: WallSide, count: number): Float32Array {
    // The top edge is the ceiling, i.e. the roof construction.
    const construction = side === 'top' ? roofU(this.room.roof) : wallU(this.room.wall);
    const base = construction * this.params.uScale;
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
    // The front and back walls (not part of the section) lose heat over every cell.
    this.frontBackK =
      (2 * wallU(this.room.wall) * this.params.uScale * dt) / (airDensity * airCp * this.room.heightM * massFactor);
  }

  reset(): void {
    this.T.fill(this.params.initialC);
    for (const f of this.furniture) f.temperatureC = this.params.initialC;
    this.u.fill(0);
    this.v.fill(0);
    this.flowCounter = 0;
    this.elapsed = 0;
    this.thermostatHeating = true;
    this.heatingEnergyJ = 0;
    this.coolingEnergyJ = 0;
    this.pendingSeconds = 0;
  }

  /** Advance by `seconds` of requested simulation time; fractional steps carry over between calls. */
  advance(seconds: number): number {
    if (!Number.isFinite(seconds) || seconds <= 0) return 0;
    const accumulated = this.pendingSeconds + seconds;
    const requestedSteps = Math.floor((accumulated + this.dt * 1e-9) / this.dt);
    const steps = Math.min(MAX_SUBSTEPS_PER_CALL, requestedSteps);
    this.pendingSeconds =
      requestedSteps > MAX_SUBSTEPS_PER_CALL
        ? accumulated % this.dt
        : accumulated - steps * this.dt;
    if (steps === 0) return 0;
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
    const { nx, ny, dt, dx, lossK, cellCap, frontBackK } = this;
    const alpha = this.convection ? this.params.convectionAlpha : this.params.alpha;
    const outsideC = this.room.outsideC;
    const T = this.T;
    const out = this.next;
    const r = (alpha * dt) / (dx * dx);

    if (this.room.thermostat.enabled) {
      let mean = 0;
      for (let i = 0; i < T.length; i++) mean += T[i];
      mean /= T.length;
      const halfBand = this.room.thermostat.deadbandC / 2;
      if (this.thermostatHeating && mean >= this.room.thermostat.targetC + halfBand) {
        this.thermostatHeating = false;
      } else if (!this.thermostatHeating && mean <= this.room.thermostat.targetC - halfBand) {
        this.thermostatHeating = true;
      }
    } else {
      this.thermostatHeating = true;
    }

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
        const k = lossK[i] + frontBackK;
        if (k !== 0) v -= k * (c - outsideC);
        out[i] = v;
      }
    }

    for (const s of this.sources) {
      const watts = s.watts > 0 && this.room.thermostat.enabled && !this.thermostatHeating ? 0 : s.watts;
      if (watts > 0) this.heatingEnergyJ += watts * dt;
      else this.coolingEnergyJ += -watts * dt;
      const dT = (watts * dt) / cellCap / s.cells.length;
      for (let k = 0; k < s.cells.length; k++) out[s.cells[k]] += dT;
    }

    for (const f of this.furniture) {
      let airC = 0;
      for (const i of f.cells) airC += out[i];
      airC /= f.cells.length;
      const energyJ = f.conductanceWPerK * (f.temperatureC - airC) * dt;
      f.temperatureC -= energyJ / f.capacityJPerK;
      const dT = energyJ / (cellCap * f.cells.length);
      for (const i of f.cells) out[i] += dT;
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

  /** Signed heat-loss rates by component, in watts; negative values mean heat enters the room. */
  heatLossBreakdownW(): HeatLossBreakdown {
    const { dx, T } = this;
    const outsideC = this.room.outsideC;
    const depthM = this.room.heightM;
    const top = this.sideProfile('top', this.nx);
    const bottom = this.sideProfile('bottom', this.nx);
    const left = this.sideProfile('left', this.ny);
    const right = this.sideProfile('right', this.ny);
    const wallBaseU = wallU(this.room.wall) * this.params.uScale;
    let roofW = 0;
    let wallsW = 0;
    let floorW = 0;
    let openingsW = 0;

    for (let x = 0; x < this.nx; x++) {
      roofW += top[x] * (T[x] - outsideC) * dx * depthM;
      floorW += bottom[x] * (T[(this.ny - 1) * this.nx + x] - outsideC) * dx * depthM;
    }
    for (let y = 0; y < this.ny; y++) {
      for (const [side, profile, i] of [
        ['left', left, y * this.nx],
        ['right', right, y * this.nx + this.nx - 1],
      ] as const) {
        const position = (y + 0.5) * dx;
        const opening = this.room.openings.some(
          (o) => o.side === side && position >= o.pos - o.length / 2 && position <= o.pos + o.length / 2,
        );
        const loss = profile[y] * (T[i] - outsideC) * dx * depthM;
        if (opening) openingsW += loss;
        else wallsW += loss;
      }
    }
    let sectionDelta = 0;
    for (const value of T) sectionDelta += value - outsideC;
    wallsW += sectionDelta * 2 * wallBaseU * dx * dx;
    const totalW = roofW + wallsW + floorW + openingsW;
    return { roofW, wallsW, floorW, openingsW, totalW };
  }

  /** Total heat currently lost through the enclosure, in watts (negative when the room gains heat). */
  wallLossW(): number {
    return this.heatLossBreakdownW().totalW;
  }

  /** Cumulative heater and cooling-source energy delivered, in kWh. */
  energyUseKWh(): { heating: number; cooling: number } {
    return { heating: this.heatingEnergyJ / 3_600_000, cooling: this.coolingEnergyJ / 3_600_000 };
  }

  /** Whether the thermostat currently permits heat sources to run. */
  thermostatHeatingOn(): boolean {
    return this.thermostatHeating;
  }

  /** Total thermal energy above outside temperature, including the furniture thermal mass, in joules. */
  energyJ(): number {
    let sum = 0;
    for (let i = 0; i < this.T.length; i++) sum += this.T[i] - this.room.outsideC;
    for (const f of this.furniture) sum += ((f.temperatureC - this.room.outsideC) * f.capacityJPerK) / this.cellCap;
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

  /** Sample heat-flow directions from diffusion and, when enabled, simulated air advection. */
  vectorField(): HeatFlowVector[] {
    const { nx, ny, dx } = this;
    const spacing = Math.max(3, Math.ceil(Math.min(nx, ny) / 10));
    const alpha = this.convection ? this.params.convectionAlpha : this.params.alpha;
    let mean = 0;
    for (const value of this.T) mean += value;
    mean /= this.T.length;
    const vectors: HeatFlowVector[] = [];
    for (let y = Math.floor(spacing / 2); y < ny; y += spacing) {
      for (let x = Math.floor(spacing / 2); x < nx; x += spacing) {
        const i = y * nx + x;
        const center = this.T[i];
        const left = this.T[y * nx + Math.max(0, x - 1)];
        const right = this.T[y * nx + Math.min(nx - 1, x + 1)];
        const above = this.T[Math.max(0, y - 1) * nx + x];
        const below = this.T[Math.min(ny - 1, y + 1) * nx + x];
        let vx = (-alpha * (right - left)) / (2 * dx);
        let vy = (-alpha * (below - above)) / (2 * dx);
        if (this.convection) {
          const faceX = y * (nx + 1) + x;
          const faceY = y * nx + x;
          const airU = 0.5 * (this.u[faceX] + this.u[faceX + 1]);
          const airV = 0.5 * (this.v[faceY] + this.v[(y + 1) * nx + x]);
          vx += airU * (center - mean);
          vy += airV * (center - mean);
        }
        const magnitude = Math.hypot(vx, vy);
        if (magnitude > 1e-7) {
          vectors.push({ x: (x + 0.5) * dx, y: (y + 0.5) * dx, dx: vx, dy: vy, magnitude });
        }
      }
    }
    return vectors;
  }
}

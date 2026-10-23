import { DEFAULT_CEILING_FAN, DEFAULT_PHYSICS, FURNITURE_MATERIALS, type PhysicsParams, type RoomConfig } from './config';
import { getModel, getEmitter } from './model';
import { GridGeometry } from './grid';
import { FlowSolver, type BoundaryFlow } from './flow';
import { solveVentilation } from './ventilation';
import { buildSurfaces, type Surface, type SurfaceKind } from './surfaces';
import { RadiationEnclosure, type RadiationPatch } from './radiation';
import { getEnvironment, traceSolar, exteriorConvection, exteriorLongwaveW } from './environment';
import { furnitureBoxes, furnitureOverlaps, physicalFurniture, unionRectangleArea, type Point3 } from './furniture';
import { fieldVectors, trilerp, weightedTrilerp, type SimulationField } from './field';
import { footprintContains, polygonArea, roomFootprint, footprintWalls } from './footprint';
export { trilerp } from './field';
export type { HeatFlowVector } from './field';
export interface HeatLossBreakdown { roofW: number; wallsW: number; floorW: number; openingsW: number; ventilationW: number; totalW: number }
export interface SimulationDiagnostics {
  storedEnergyJ: number; energyBalanceJ: number; relativeEnergyError: number;
  surfaceTemperatures: { id: string; label: string; temperatureC: number }[];
  sensorC: number; ventilationACH: number; pressureResidual: number; maxDivergence: number; iterations: number;
  failure: string | null; solarW: number; outsideC: number; netExternalJ: number;
}
interface Lump { temperature: number; capacity: number }
interface Contact { cells: Int32Array; weights: Float64Array }
interface Face { a: number; b: number; axis: 0 | 1 | 2; index: number; area: number; spacing: number }
const emptyLoss = (): HeatLossBreakdown => ({ roofW: 0, wallsW: 0, floorW: 0, openingsW: 0, ventilationW: 0, totalW: 0 });
const minmod = (a: number, b: number) => a * b <= 0 ? 0 : Math.sign(a) * Math.min(Math.abs(a), Math.abs(b));

/** Coupled finite-volume air, layered solids, radiation and pressure-driven ventilation.
 * Every exchange has a corresponding opposite transfer or an entry in the external ledger.
 * Solver energy is always measured relative to 0°C, independent of outdoor weather.
 */
export class Simulation implements SimulationField {
  readonly nx: number; readonly ny: number; readonly nz: number;
  readonly dx: number; readonly dy: number; readonly dz: number;
  readonly params: PhysicsParams; readonly convection: boolean;
  readonly grid: GridGeometry; readonly flow: FlowSolver;
  readonly solid: Uint8Array; readonly T: Float64Array;
  readonly dt = 1;
  elapsed = 0;
  private room: RoomConfig;
  private solidFurniture: ReturnType<typeof physicalFurniture> = [];
  private boxes: ReturnType<typeof furnitureBoxes>[] = [];
  private capacity: Float64Array;
  private groupCapacity: Float64Array;
  private groups: number[] = [];
  private members: Map<number, number[]> = new Map();
  private faces: Face[] = [];
  private surfaces: Surface[] = [];
  private contacts: Contact[] = [];
  private furniture: Lump[] = [];
  private emitters: Lump[] = [];
  private sources: { cells: Int32Array; weights: Float64Array }[] = [];
  private radiation?: RadiationEnclosure;
  private radiationGroups: number[][] = [];
  private surfaceKey = '';
  private thermostatHeating = true;
  private sensorC: number;
  private heatingJ = 0; private coolingJ = 0;
  private externalJ = 0; private exchangedJ = 0; private initialEnergyJ = 0;
  private loss = emptyLoss();
  private failed: string | null = null;
  private recommendedDt = Infinity;
  private advecting = false;
  private lastFlow = { residual: 0, maxDivergence: 0, iterations: 0 };
  private ventilationACH = 0; private solarW = 0;
  private lastEnvironment: ReturnType<typeof getEnvironment>;

  private fanActuator() {
    const source = this.room.sources.find(s => s.kind === 'fan');
    return source && source.fanEnabled !== false ? {
      x: source.x, y: source.y,
      speedMps: source.fanSpeedMps ?? DEFAULT_CEILING_FAN.speedMps,
      diameterM: source.fanDiameterM ?? DEFAULT_CEILING_FAN.diameterM,
    } : undefined;
  }

  constructor(room: RoomConfig, params: PhysicsParams = DEFAULT_PHYSICS) {
    this.solidFurniture = physicalFurniture(room);
    if (furnitureOverlaps(this.solidFurniture).length) throw new Error('Furniture overlaps: move or remove the highlighted pieces before starting.');
    this.room = room; this.boxes = this.solidFurniture.map(furnitureBoxes); this.params = params; this.convection = room.convection;
    const cells = { fast: 8, coarse: 24, balanced: 32, fine: 48 }[getModel(room).quality];
    const spacing = Math.max(room.widthM, room.heightM, room.ceilingM) / cells;
    this.nx = Math.max(2, Math.round(room.widthM / spacing)); this.ny = Math.max(2, Math.round(room.heightM / spacing)); this.nz = Math.max(2, Math.round(room.ceilingM / spacing));
    this.grid = new GridGeometry(room, this.nx, this.ny, this.nz); this.flow = new FlowSolver(this.grid);
    this.dx = this.grid.dx; this.dy = this.grid.dy; this.dz = this.grid.dz; this.solid = this.grid.solid;
    this.T = new Float64Array(this.grid.volume.length).fill(params.initialC);
    this.capacity = Float64Array.from(this.grid.volume, v => v * params.airDensity * params.airCp);
    this.groupCapacity = new Float64Array(this.T.length);
    for (let i = 0; i < this.T.length; i++) if (this.capacity[i] > 0) {
      const r = this.grid.representative[i]; this.groupCapacity[r] += this.capacity[i];
      const members = this.members.get(r) ?? []; members.push(i); this.members.set(r, members);
    }
    this.groups = [...this.members.keys()];
    if (!this.groups.length) throw new Error('The room must contain some free air.');
    for (let z = 0; z < this.nz; z++) for (let y = 0; y < this.ny; y++) for (let x = 0; x < this.nx; x++) {
      const a = this.index(x, y, z);
      if (x + 1 < this.nx) this.addFace(a, a + 1, 0, this.grid.uIndex(x + 1, y, z), this.grid.openU, this.dx);
      if (y + 1 < this.ny) this.addFace(a, a + this.nx, 1, this.grid.vIndex(x, y + 1, z), this.grid.openV, this.dy);
      if (z + 1 < this.nz) this.addFace(a, a + this.nx * this.ny, 2, this.grid.wIndex(x, y, z + 1), this.grid.openW, this.dz);
    }
    this.furniture = this.solidFurniture.map((f, j) => ({ temperature: params.initialC,
      capacity: this.grid.furnitureVolumes[j].reduce((s, v) => s + v, 0) * FURNITURE_MATERIALS.find(m => m.id === f.material)!.capacity }));
    this.emitters = room.sources.map(s => ({ temperature: params.initialC, capacity: getEmitter(s).capacityJPerK }));
    this.sensorC = params.initialC; this.lastEnvironment = getEnvironment(room, 0);
    this.setRoom(room); this.initialEnergyJ = this.energyJ();
  }
  private index(x: number, y: number, z: number) { return (z * this.ny + y) * this.nx + x; }
  private addFace(a: number, b: number, axis: 0 | 1 | 2, index: number, areas: Float64Array, spacing: number) {
    if (this.capacity[a] && this.capacity[b] && areas[index] > 0 && this.grid.representative[a] !== this.grid.representative[b]) this.faces.push({ a, b, axis, index, area: areas[index], spacing });
  }
  private cellAt(p: readonly number[]): number {
    return this.index(...p.map((v, a) => Math.max(0, Math.min([this.nx, this.ny, this.nz][a] - 1, Math.floor(v / [this.dx, this.dy, this.dz][a])))) as [number, number, number]);
  }
  private nearestAir(p: readonly number[]): number {
    const i = this.cellAt(p); if (this.capacity[i]) return i;
    let best = this.groups[0], distance = Infinity;
    for (const r of this.groups) {
      const c = this.center(r), d = c.reduce((s, n, a) => s + (n - p[a]) ** 2, 0);
      if (d < distance) { best = r; distance = d; }
    }
    return best;
  }
  private center(i: number): Point3 { return [(i % this.nx + .5) * this.dx, (Math.floor(i / this.nx) % this.ny + .5) * this.dy, (Math.floor(i / (this.nx * this.ny)) + .5) * this.dz]; }
  private contact(surface: Surface): Contact {
    const normal = surface.normal, axis = normal.findIndex(n => n !== 0), other = [0, 1, 2].filter(a => a !== axis), spacing = [this.dx, this.dy, this.dz];
    const a = other[0], b = other[1], weights = new Map<number, number>();
    for (let j = Math.floor(surface.min[b] / spacing[b]); j < Math.ceil(surface.max[b] / spacing[b] - 1e-9); j++)
      for (let i = Math.floor(surface.min[a] / spacing[a]); i < Math.ceil(surface.max[a] / spacing[a] - 1e-9); i++) {
        const loA = Math.max(surface.min[a], i * spacing[a]), hiA = Math.min(surface.max[a], (i + 1) * spacing[a]);
        const loB = Math.max(surface.min[b], j * spacing[b]), hiB = Math.min(surface.max[b], (j + 1) * spacing[b]);
        const area = (hiA - loA) * (hiB - loB); if (area <= 0) continue;
        const p = [...surface.center]; p[a] = (loA + hiA) / 2; p[b] = (loB + hiB) / 2;
        if (axis === 0 && surface.kind === 'furniture' && this.solidFurniture[surface.item!].kind === 'wall')
          p[axis] = Math.round(this.solidFurniture[surface.item!].x / spacing[axis]) * spacing[axis] + normal[axis] * 1e-6;
        else p[axis] += normal[axis] * 1e-6;
        const cell = this.grid.representative[this.nearestAir(p)]; weights.set(cell, (weights.get(cell) ?? 0) + area);
      }
    const total = [...weights.values()].reduce((s, w) => s + w, 0);
    return { cells: Int32Array.from(weights.keys()), weights: Float64Array.from(weights.values(), w => w / total) };
  }
  setRoom(room: RoomConfig): void {
    const energyBeforeChange = this.surfaces.length ? this.energyJ() : null;
    const oldSources = new Map(this.room.sources.map((s, i) => [s.id, this.emitters[i]]));
    this.emitters = room.sources.map(s => ({ temperature: oldSources.get(s.id)?.temperature ?? this.params.initialC, capacity: getEmitter(s).capacityJPerK }));
    this.room = room;
    this.solidFurniture = physicalFurniture(room);
    this.boxes = this.solidFurniture.map(furnitureBoxes);
    this.sources = room.sources.map(s => {
      const radius = .25, entries: number[] = [];
      for (let i = 0; i < this.T.length; i++) if (this.capacity[i] && this.center(i).reduce((sum, n, a) => sum + (n - [s.x, s.y, s.z][a]) ** 2, 0) <= radius ** 2) entries.push(i);
      if (!entries.length) entries.push(this.nearestAir([s.x, s.y, s.z]));
      const total = entries.reduce((sum, i) => sum + this.capacity[i], 0);
      return { cells: Int32Array.from(entries), weights: Float64Array.from(entries, i => this.capacity[i] / total) };
    });
    const thermalSources = room.sources.filter(s => s.kind !== 'fan');
    const key = JSON.stringify([room.footprint, room.interiorWalls, room.openings, room.wall, room.roof, room.model?.floor,
      room.model?.wallLayers, room.model?.roofLayers, thermalSources.map(s => [s.id, s.kind, s.x, s.y, s.z, s.emitter])]);
    if (key !== this.surfaceKey) {
      const previous = new Map(this.surfaces.map(s => [s.id, s]));
      this.surfaces = buildSurfaces(room, this.params.initialC);
      for (const s of this.surfaces) { const old = previous.get(s.id); if (old?.column && s.column && old.column.temperatures.length === s.column.temperatures.length) s.column.temperatures.set(old.column.temperatures); }
      this.contacts = this.surfaces.map(s => this.contact(s));
      this.buildRadiation(); this.surfaceKey = key;
      // Changes to model geometry/construction are a controlled external intervention.
    }
    if (energyBeforeChange !== null) this.externalJ += this.energyJ() - energyBeforeChange;
    if (!room.thermostat.enabled) this.thermostatHeating = true;
  }
  private buildRadiation() {
    this.radiationGroups = [];
    const grouped = new Map<string, number[]>();
    this.surfaces.forEach((s, i) => {
      // Consolidate small furniture faces by normal, limiting the cached dense enclosure solve.
      const key = s.kind === 'furniture' ? `f${s.item}:${s.normal.join()}` : s.id;
      const group = grouped.get(key) ?? []; group.push(i); grouped.set(key, group);
    });
    this.radiationGroups = [...grouped.values()];
    const patches: RadiationPatch[] = this.radiationGroups.map(group => {
      const s = this.surfaces[group[0]], area = group.reduce((sum, i) => sum + this.surfaces[i].area, 0);
      if (group.length === 1) return s;
      const center = [0, 1, 2].map(a => group.reduce((sum, i) => sum + this.surfaces[i].center[a] * this.surfaces[i].area, 0) / area) as Point3;
      const axis = s.normal.findIndex(n => n !== 0); center[axis] = s.normal[axis] > 0 ? Math.max(...group.map(i => this.surfaces[i].center[axis])) : Math.min(...group.map(i => this.surfaces[i].center[axis]));
      return { area, center, normal: s.normal, emissivity: s.emissivity };
    });
    this.radiation = patches.length > 1 ? new RadiationEnclosure(patches, this.solidFurniture.flatMap(furnitureBoxes)) : undefined;
  }
  private contactState(contact: Contact) {
    let capacity = 0, energy = 0;
    for (let j = 0; j < contact.cells.length; j++) { const i = contact.cells[j], c = this.groupCapacity[i]; capacity += c; energy += c * this.T[i]; }
    return { capacity, temperature: capacity ? energy / capacity : this.params.initialC };
  }
  private contactHeat(contact: Contact, joules: number) {
    // The implicit air lump contains the full adjacent air volume. Splitting energy
    // by capacity gives each participating cell the exact solved temperature change.
    const state = this.contactState(contact); if (!state.capacity) return;
    for (let j = 0; j < contact.cells.length; j++) {
      const i = contact.cells[j], delta = joules / state.capacity;
      for (const cell of this.members.get(i)!) this.T[cell] += delta;
    }
  }
  private addAirHeat(i: number, joules: number) {
    const r = this.grid.representative[i], c = this.groupCapacity[r]; if (!c) return;
    for (const member of this.members.get(r)!) this.T[member] += joules / c;
  }
  private syncGroups() {
    for (const r of this.groups) {
      let energy = 0; for (const i of this.members.get(r)!) energy += this.T[i] * this.capacity[i];
      const t = energy / this.groupCapacity[r]; for (const i of this.members.get(r)!) this.T[i] = t;
    }
  }
  /** Explicit radiation and ideal emitters get physical stiffness limits too.
   * Construction/film conduction is implicit; source and longwave terms are conservative substeps.
   */
  private thermalStableDt(): number {
    let limit = 1;
    const rates = new Float64Array(this.T.length);
    this.room.sources.forEach((source, j) => {
      if (source.kind === 'fan') return;
      const emitter = getEmitter(source), power = source.powerKW * 1000;
      if (!power || (source.kind === 'heat' && !this.thermostatHeating)) return;
      if (this.room.heatingMode === 'underfloor' && source.kind === 'heat') return;
      if (emitter.kind !== 'ideal' && source.kind === 'heat') limit = Math.min(limit, 2 * Math.max(1, this.emitters[j].capacity) / power);
      else for(let k=0;k<this.sources[j].cells.length;k++) rates[this.grid.representative[this.sources[j].cells[k]]] += power*this.sources[j].weights[k];
    });
    for(const r of this.groups) if(rates[r]) limit=Math.min(limit,2*this.groupCapacity[r]/rates[r]);
    if(getModel(this.room).radiation) for(const surface of this.surfaces) {
      if(surface.kind==='aperture') continue;
      const temperature=this.surfaceTemperature(surface,this.lastEnvironment.outsideC)+273.15;
      const capacity=surface.column?.capacities[0] ?? (surface.kind==='furniture'?this.furniture[surface.item!].capacity:this.emitters[surface.source!].capacity);
      const conductance=4*5.670374419e-8*surface.emissivity*surface.area*Math.max(150,temperature)**3;
      if(capacity>0 && conductance>0) limit=Math.min(limit,.1*capacity/conductance);
    }
    return limit;
  }
  get failure(): string | null { return this.failed; }
  advance(seconds: number, maxSteps = 16): number {
    if (!Number.isFinite(seconds) || seconds <= 0 || this.failed) return 0;
    let done = 0;
    for (let attempt = 0, count = 0; attempt < maxSteps + 16 && count < maxSteps && done < seconds - 1e-10; attempt++) {
      let dt = Math.min(seconds - done, this.recommendedDt, this.thermalStableDt(), 1,
        this.advecting || this.convection || this.fanActuator() ? this.flow.stableDt(1, this.convection ? this.T : undefined, this.fanActuator()) : 1);
      if (!Number.isFinite(dt) || dt <= 0) dt = Math.min(seconds - done, .05);
      // Radiation/emitter stiffness and explicit thermal diffusion restrict this further below.
      const alpha = Math.max(this.params.alpha, this.params.convectionAlpha, ...[this.flow.eddyDiffusivity?.reduce((m, x) => Math.max(m, x), 0) ?? 0]);
      dt = Math.min(dt, .4 / (2 * alpha * (1 / this.dx ** 2 + 1 / this.dy ** 2 + 1 / this.dz ** 2)));
      dt = Math.max(1e-5, dt);
      this.recommendedDt = Infinity;
      if (!this.step(dt)) { if (!this.failed && this.recommendedDt < dt) continue; break; }
      this.elapsed += dt; done += dt;
      count++;
    }
    return done;
  }
  private step(dt: number): boolean {
    const environment = getEnvironment(this.room, this.elapsed + dt / 2); this.lastEnvironment = environment;
    const model = getModel(this.room), mean = this.stats().mean;
    const ventilation = solveVentilation(this.room, mean, { ...environment, orientationDeg: 0 }, this.params.airDensity);
    this.ventilationACH = ventilation.inflowM3s * 3600 / this.grid.volume.reduce((a, b) => a + b, 0);
    const boundaries: BoundaryFlow[] = [];
    const thermalFlows: { cell: number; q: number }[] = [];
    const boundaryTotals = new Map<string, { axis: 0 | 1; index: number; cell: number; outwardSign: -1 | 1; area: number; q: number }>();
    for (const f of ventilation.flows) {
      const wall = footprintWalls(this.room)[f.wallIndex];
      const axis = wall.start.x === wall.end.x ? 0 : 1;
      const along = 1 - axis, alongSpacing = axis === 0 ? this.dy : this.dx, alongCount = axis === 0 ? this.ny : this.nx;
      const startCoord = axis === 0 ? wall.start.y : wall.start.x, endCoord = axis === 0 ? wall.end.y : wall.end.x;
      const targets: { index: number; cell: number; area: number }[] = [];
      const from = f.from ?? f.pos - alongSpacing / 2, to = f.to ?? f.pos + alongSpacing / 2;
      const coordA = startCoord + (endCoord - startCoord) * from / wall.length;
      const coordB = startCoord + (endCoord - startCoord) * to / wall.length;
      const worldFrom = Math.min(coordA, coordB), worldTo = Math.max(coordA, coordB);
      const faceCount = axis === 0 ? this.nx : this.ny;
      const faceCoordinate = axis === 0 ? wall.start.x : wall.start.y;
      const faceSpacing = axis === 0 ? this.dx : this.dy;
      const face = Math.max(0, Math.min(faceCount, Math.round(faceCoordinate / faceSpacing)));
      const outwardSign = (wall.normal[axis] < 0 ? -1 : 1) as -1 | 1;
      const bottom = f.bottom ?? f.z - this.dz / 2, top = f.top ?? f.z + this.dz / 2;
      for (let z = Math.max(0, Math.floor(bottom / this.dz)); z < Math.min(this.nz, Math.ceil(top / this.dz)); z++)
        for (let alongCell = Math.max(0, Math.floor(worldFrom / alongSpacing)); alongCell < Math.min(alongCount, Math.ceil(worldTo / alongSpacing)); alongCell++) {
          const inside = Math.max(0, Math.min(faceCount - 1, Math.floor((faceCoordinate - outwardSign * 1e-6) / faceSpacing)));
          const x = axis === 0 ? inside : alongCell;
          const y = axis === 1 ? inside : alongCell;
          if (x < 0 || x >= this.nx || y < 0 || y >= this.ny) continue;
          const index = axis === 0 ? this.grid.uIndex(face, y, z) : this.grid.vIndex(x, face, z);
          const overlap = Math.max(0, Math.min(worldTo, (alongCell + 1) * alongSpacing) - Math.max(worldFrom, alongCell * alongSpacing));
          const height = Math.max(0, Math.min(top, (z + 1) * this.dz) - Math.max(bottom, z * this.dz));
          const plane = axis === 0 ? wall.start.x : wall.start.y;
          const blockedRects = this.boxes.flat().filter((box) => box.min[axis] <= plane + alongSpacing * 1e-6 && box.max[axis] >= plane - alongSpacing * 1e-6)
            .map((box) => [Math.max(worldFrom, box.min[along]), Math.min(worldTo, box.max[along]),
              Math.max(bottom, box.min[2]), Math.min(top, box.max[2])] as const);
          const blocked = unionRectangleArea(blockedRects.map(([a, b, lo, hi]) =>
            [Math.max(a, alongCell * alongSpacing), Math.min(b, (alongCell + 1) * alongSpacing),
              Math.max(lo, z * this.dz), Math.min(hi, (z + 1) * this.dz)] as const));
          const area = Math.max(0, overlap * height - blocked);
          const cell = this.index(x, y, z);
          if (area > 0 && this.capacity[cell]) targets.push({ index, cell, area });
        }
      const totalArea = targets.reduce((sum, t) => sum + t.area, 0);
      if (!totalArea && Math.abs(f.volumeM3s) > 1e-10) { this.failed = 'A ventilation path is blocked by furniture. Move the piece away from the opening.'; return false; }
      for (const t of targets) {
        const q = f.volumeM3s * t.area / totalArea;
        thermalFlows.push({ cell: t.cell, q });
        const key = `${axis}:${t.index}:${t.cell}`, entry = boundaryTotals.get(key) ??
          { axis, index: t.index, cell: t.cell, outwardSign, area: 0, q: 0 };
        entry.q += q; entry.area += t.area; boundaryTotals.set(key, entry);
      }
    }
    for (const { axis, index, cell, outwardSign, area, q } of boundaryTotals.values()) {
      if (area) boundaries.push({ axis, index, cell, outwardSign, area, velocity: -outwardSign * q / area });
    }
    const ventilationRates = new Float64Array(this.T.length);
    for (const f of thermalFlows) ventilationRates[this.grid.representative[f.cell]] += Math.abs(f.q) * this.params.airDensity * this.params.airCp;
    let ventDt = Infinity;
    for (const r of this.groups) if (ventilationRates[r]) ventDt = Math.min(ventDt, .5 * this.groupCapacity[r] / ventilationRates[r]);
    if (dt > ventDt * 1.00001) { this.recommendedDt = ventDt; return false; }
    this.advecting = this.convection || !!this.fanActuator() || ventilation.inflowM3s > 1e-10 || [this.flow.u, this.flow.v, this.flow.w].some(v => v.some(n => Math.abs(n) > 1e-6));
    let ventilationJ = 0;
    if (this.advecting) {
      const u = this.flow.u.slice(), v = this.flow.v.slice(), w = this.flow.w.slice();
      let converged = false;
      for (let attempt = 0; attempt < 6 && !converged; attempt++) {
        this.flow.u.set(u); this.flow.v.set(v); this.flow.w.set(w);
        const steps = 2 ** attempt, step = dt / steps;
        converged = true;
        for (let n = 0; n < steps; n++) {
          const fan = this.fanActuator();
          const flow = this.flow.step(this.T, step, boundaries, this.convection, fan);
          this.lastFlow = flow;
          if (!flow.converged || this.flow.stableDt(step, this.convection ? this.T : undefined, fan) < step * .999) { converged = false; break; }
        }
      }
      if (!converged) {
        this.flow.u.set(u); this.flow.v.set(v); this.flow.w.set(w);
        this.failed = 'Airflow could not meet convergence and timestep bounds. Try coarser quality or reduce wind.';
        return false;
      }
      // Scalar heat transport uses the updated flow CFL too (momentum subcycling is independent).
      const scalarSteps = Math.max(1, Math.ceil(dt / this.flow.stableDt(dt)));
      for (let n = 0; n < scalarSteps; n++) ventilationJ += this.transport(dt / scalarSteps, thermalFlows, environment.outsideC);
    } else ventilationJ = this.transport(dt, thermalFlows, environment.outsideC);
    const sensor = this.room.thermostat.sensor;
    const measured = sensor?.mode === 'point' ? this.sample(sensor.x, sensor.y, sensor.z) : mean;
    this.sensorC += (measured - this.sensorC) * (sensor?.lagSeconds ? -Math.expm1(-dt / sensor.lagSeconds) : 1);
    if (this.room.thermostat.enabled) {
      const half = this.room.thermostat.deadbandC / 2;
      if (this.sensorC >= this.room.thermostat.targetC + half) this.thermostatHeating = false;
      else if (this.sensorC <= this.room.thermostat.targetC - half) this.thermostatHeating = true;
    } else this.thermostatHeating = true;
    this.loss = emptyLoss();
    this.externalJ += ventilationJ; this.exchangedJ += Math.abs(ventilationJ); this.loss.ventilationW = -ventilationJ / dt;
    const powers = this.room.sources.map(s => s.kind === 'fan' ? 0 : s.kind === 'cold' ? -1000 * s.powerKW : this.thermostatHeating ? 1000 * s.powerKW : 0);
    let floorPower = 0;
    this.room.sources.forEach((s, j) => {
      if (s.kind === 'fan') return;
      const watts = powers[j]; if (watts > 0) this.heatingJ += watts * dt; else this.coolingJ -= watts * dt;
      if (this.room.heatingMode === 'underfloor' && s.kind === 'heat') floorPower += watts;
      else if (getEmitter(s).kind !== 'ideal' && s.kind === 'heat') this.emitters[j].temperature += watts * dt / Math.max(1, this.emitters[j].capacity);
      else for (let n = 0; n < this.sources[j].cells.length; n++) this.addAirHeat(this.sources[j].cells[n], watts * dt * this.sources[j].weights[n]);
    });
    const solar = traceSolar(this.room, environment, this.surfaces);
    this.solarW = solar.transmittedW - solar.escapedW;
    const radiationW = new Float64Array(this.surfaces.length);
    if (model.radiation && this.radiation) {
      const temps = this.radiationGroups.map(group => group.reduce((sum, i) => sum + this.surfaceTemperature(this.surfaces[i], environment.outsideC) * this.surfaces[i].area, 0) / group.reduce((sum, i) => sum + this.surfaces[i].area, 0));
      const exchanges = this.radiation.exchange(temps);
      this.radiationGroups.forEach((group, j) => { const area = group.reduce((sum, i) => sum + this.surfaces[i].area, 0); for (const i of group) radiationW[i] = exchanges[j] * this.surfaces[i].area / area; });
    }
    for (const [id, watts] of solar.furnitureW) { const j = this.solidFurniture.findIndex(f => f.id === id); if (j >= 0 && this.furniture[j].capacity) this.furniture[j].temperature += watts * dt / this.furniture[j].capacity; }
    this.externalJ += this.solarW * dt; this.exchangedJ += Math.abs(this.solarW * dt);
    const floorArea = polygonArea(roomFootprint(this.room));
    for (let j = 0; j < this.surfaces.length; j++) {
      const surface = this.surfaces[j], contact = this.contacts[j], air = this.contactState(contact);
      if (!air.capacity) continue;
      const surfaceC = this.surfaceTemperature(surface, environment.outsideC);
      // Natural-convection film correlations; solid resistance is handled inside each column.
      const h = Math.max(.5, (surface.normal[2] ? 1.52 : 1.31) * Math.cbrt(Math.abs(surfaceC - air.temperature))) + (this.advecting ? this.speedAt(surface.center) * 2 : 0);
      const radiation = radiationW[j], sunlight = solar.patchW[j];
      if (surface.column) {
        const ground = surface.kind === 'floorW' && model.floor.boundary !== 'outside';
        const outsideC = ground ? model.floor.temperatureC : environment.outsideC;
        const outsideH = this.params.uScale * (ground ? 1000 : exteriorConvection(environment.windMps));
        let outsideRadiationW = 0, outsideSolarW = 0;
        if (!ground && model.radiation) {
          const skyFactor = surface.kind === 'roofW' ? 1 : surface.kind === 'floorW' ? 0 : .5;
          outsideRadiationW = this.params.uScale * (
            exteriorLongwaveW(surface.column.outsideC, environment.skyC, surface.area, .9, skyFactor) +
            exteriorLongwaveW(surface.column.outsideC, environment.outsideC, surface.area, .9, 1 - skyFactor));
        }
        if (!ground) {
          const cosine = Math.max(0, -surface.normal.reduce((s, n, a) => s + n * environment.sunDirection[a], 0));
          outsideSolarW = surface.area * (environment.directWm2 * cosine + environment.diffuseWm2 * (surface.kind === 'roofW' ? 1 : surface.kind === 'floorW' ? 0 : .5)) * (surface.kind === 'openingsW' ? .1 : .6);
        }
        const last = surface.column.temperatures.length - 1;
        surface.column.temperatures[last] += (outsideRadiationW + outsideSolarW) * dt / surface.column.capacities[last];
        const result = surface.column.stepMultiAir(dt, Array.from(contact.cells, (i, n) => ({
          temperatureC: this.T[i], capacityJPerK: this.groupCapacity[i], conductanceWPerK: h * surface.area * contact.weights[n],
        })), { temperatureC: outsideC, conductanceWPerK: outsideH * surface.area },
          surface.kind === 'floorW' ? floorPower * surface.area / floorArea : 0, radiation + sunlight,
          surface.kind === 'floorW' ? 1 : undefined);
        for (let n = 0; n < contact.cells.length; n++) for (const i of this.members.get(contact.cells[n])!) this.T[i] = result.airC[n];
        const outsideJ = result.outsideJ + (outsideRadiationW + outsideSolarW) * dt;
        this.externalJ += outsideJ; this.exchangedJ += Math.abs(outsideJ);
        this.loss[surface.kind as 'roofW' | 'floorW' | 'wallsW' | 'openingsW'] -= outsideJ / dt;
      } else if (surface.kind === 'aperture') {
        this.externalJ -= radiation * dt; this.exchangedJ += Math.abs(radiation * dt);
        this.loss.openingsW += radiation;
      } else {
        const lump = surface.kind === 'furniture' ? this.furniture[surface.item!] : this.emitters[surface.source!];
        if (!(lump.capacity > 0)) continue;
        // Two-lump backward Euler exchange, exact equal-and-opposite energy.
        lump.temperature += (radiation + sunlight) * dt / lump.capacity;
        const material = surface.kind === 'furniture' ? FURNITURE_MATERIALS.find(m => m.id === this.solidFurniture[surface.item!].material)! : undefined;
        const conductance = surface.area / (1 / h + (material ? .02 / material.k : 0));
        let effectiveG = 0, effectiveGT = 0;
        const responses = Float64Array.from(contact.cells, (i, n) => {
          const g = conductance * contact.weights[n], c = this.groupCapacity[i];
          const effective = g * c / (c + dt * g);
          effectiveG += effective; effectiveGT += effective * this.T[i];
          return dt * g / (c + dt * g);
        });
        lump.temperature = (lump.capacity * lump.temperature + dt * effectiveGT) / (lump.capacity + dt * effectiveG);
        for (let n = 0; n < contact.cells.length; n++) {
          const i = contact.cells[n], temperature = this.T[i] + responses[n] * (lump.temperature - this.T[i]);
          for (const cell of this.members.get(i)!) this.T[cell] = temperature;
        }
      }
    }
    this.loss.totalW = this.loss.roofW + this.loss.floorW + this.loss.wallsW + this.loss.openingsW + this.loss.ventilationW;
    this.syncGroups();
    if (this.T.some(t => !Number.isFinite(t) || t < -273.15 || t > 2000)) { this.failed = 'Temperature integration left the supported range. Reset and check source powers or boundary settings.'; return false; }
    return true;
  }
  private surfaceTemperature(s: Surface, outsideC: number): number {
    return s.column?.insideC ?? (s.kind === 'furniture' ? this.furniture[s.item!].temperature : s.kind === 'emitter' ? this.emitters[s.source!].temperature : outsideC);
  }
  private speedAt(p: readonly number[]) { return Math.hypot(...this.sampleVelocity(p[0], p[1], p[2])); }
  private transport(dt: number, thermalFlows: readonly { cell: number; q: number }[] = [], outsideC = 20): number {
    const changes = new Float64Array(this.T.length), stride = [1, this.nx, this.nx * this.ny];
    const velocity = [this.flow.u, this.flow.v, this.flow.w], rhoCp = this.params.airDensity * this.params.airCp;
    if (!this.advecting) {
      for (const { a, b, area, spacing } of this.faces) {
        const q = dt * rhoCp * this.params.alpha * area / spacing * (this.T[b] - this.T[a]);
        changes[this.grid.representative[a]] += q; changes[this.grid.representative[b]] -= q;
      }
      for (const r of this.groups) for (const i of this.members.get(r)!) this.T[i] += changes[r] / this.groupCapacity[r];
      return 0;
    }
    const lower = this.T.slice(), upper = this.T.slice();
    const corrections = new Float64Array(this.faces.length);
    const positive = new Float64Array(this.T.length), negative = new Float64Array(this.T.length);
    const slope = (i: number, axis: number) => {
      const pos = axis === 0 ? i % this.nx : axis === 1 ? Math.floor(i / this.nx) % this.ny : Math.floor(i / (this.nx * this.ny));
      if (pos === 0 || pos === [this.nx, this.ny, this.nz][axis] - 1 || !this.capacity[i - stride[axis]] || !this.capacity[i + stride[axis]]) return 0;
      return minmod(this.T[i] - this.T[i - stride[axis]], this.T[i + stride[axis]] - this.T[i]);
    };
    for (let n = 0; n < this.faces.length; n++) {
      const { a, b, axis, index, area, spacing } = this.faces[n];
      const ra = this.grid.representative[a], rb = this.grid.representative[b];
      lower[ra] = Math.min(lower[ra], this.T[b]); upper[ra] = Math.max(upper[ra], this.T[b]);
      lower[rb] = Math.min(lower[rb], this.T[a]); upper[rb] = Math.max(upper[rb], this.T[a]);
      const alpha = this.params.alpha + (this.advecting ? ((this.flow.eddyDiffusivity?.[a] ?? 0) + (this.flow.eddyDiffusivity?.[b] ?? 0)) / 2 : 0);
      let joules = dt * rhoCp * alpha * area / spacing * (this.T[b] - this.T[a]);
      if (this.advecting) {
        const u = velocity[axis][index], courant = Math.min(.5, Math.abs(u) * dt / spacing);
        const donor = u >= 0 ? this.T[a] : this.T[b];
        let upstream = u >= 0 ? this.T[a] + .5 * (1 - courant) * slope(a, axis) : this.T[b] - .5 * (1 - courant) * slope(b, axis);
        upstream = Math.max(Math.min(this.T[a], this.T[b]), Math.min(Math.max(this.T[a], this.T[b]), upstream));
        joules -= dt * rhoCp * u * area * (donor - 20);
        const correction = corrections[n] = -dt * rhoCp * u * area * (upstream - donor);
        if (correction > 0) { positive[ra] += correction; negative[rb] -= correction; }
        else { negative[ra] += correction; positive[rb] -= correction; }
      }
      changes[ra] += joules; changes[rb] -= joules;
    }
    // Boundary and internal fluxes use the same old field, preserving local mass cancellation.
    let ventilationJ = 0;
    for (const f of thermalFlows) {
      const r = this.grid.representative[f.cell];
      const heat = dt * rhoCp * f.q * ((f.q > 0 ? outsideC : this.T[f.cell]) - 20);
      changes[r] += heat; ventilationJ += heat;
      if (f.q > 0) { lower[r] = Math.min(lower[r], outsideC); upper[r] = Math.max(upper[r], outsideC); }
    }
    // Flux-corrected transport: limit pair corrections by each cell's available
    // positive/negative energy budget. Unlike cell clamping this preserves energy.
    for (const r of this.groups) {
      const baseC = this.T[r] + changes[r] / this.groupCapacity[r];
      positive[r] = positive[r] > 0 ? Math.min(1, Math.max(0, (upper[r] - baseC) * this.groupCapacity[r]) / positive[r]) : 1;
      negative[r] = negative[r] < 0 ? Math.min(1, Math.min(0, (lower[r] - baseC) * this.groupCapacity[r]) / negative[r]) : 1;
    }
    for (let n = 0; n < this.faces.length; n++) {
      const { a, b } = this.faces[n], ra = this.grid.representative[a], rb = this.grid.representative[b];
      const q = corrections[n], limit = q > 0 ? Math.min(positive[ra], negative[rb]) : Math.min(negative[ra], positive[rb]);
      changes[ra] += limit * q; changes[rb] -= limit * q;
    }
    for (const r of this.groups) for (const i of this.members.get(r)!) this.T[i] += changes[r] / this.groupCapacity[r];
    return ventilationJ;
  }
  reset(): void {
    this.T.fill(this.params.initialC); this.flow.u.fill(0); this.flow.v.fill(0); this.flow.w.fill(0);
    for (const lump of [...this.furniture, ...this.emitters]) lump.temperature = this.params.initialC;
    for (const s of this.surfaces) s.column?.reset(this.params.initialC);
    this.elapsed = this.heatingJ = this.coolingJ = this.externalJ = this.exchangedJ = 0;
    this.sensorC = this.params.initialC; this.thermostatHeating = true; this.failed = null; this.loss = emptyLoss();
    this.initialEnergyJ = this.energyJ(); this.recommendedDt = Infinity;
    this.lastEnvironment = getEnvironment(this.room, 0); this.lastFlow = { residual: 0, maxDivergence: 0, iterations: 0 };
    this.ventilationACH = this.solarW = 0;
  }
  energyJ(): number {
    let joules = 0; for (let i = 0; i < this.T.length; i++) joules += this.T[i] * this.capacity[i];
    for (const s of this.surfaces) if (s.column) joules += s.column.energyJ();
    for (const lump of [...this.furniture, ...this.emitters]) joules += lump.temperature * lump.capacity;
    return joules;
  }
  diagnostics(): SimulationDiagnostics {
    const storedEnergyJ = this.energyJ(), energyBalanceJ = storedEnergyJ - this.initialEnergyJ - this.heatingJ + this.coolingJ - this.externalJ;
    return { storedEnergyJ, energyBalanceJ, relativeEnergyError: Math.abs(energyBalanceJ) / Math.max(1, this.heatingJ + this.coolingJ + this.exchangedJ),
      surfaceTemperatures: this.surfaces.map(s => ({ id: s.id, label: s.label, temperatureC: this.surfaceTemperature(s, this.lastEnvironment.outsideC) })),
      sensorC: this.sensorC, ventilationACH: this.ventilationACH, pressureResidual: this.lastFlow.residual, maxDivergence: this.lastFlow.maxDivergence,
      iterations: this.lastFlow.iterations, failure: this.failed, solarW: this.solarW, outsideC: this.lastEnvironment.outsideC, netExternalJ: this.externalJ };
  }
  heatLossBreakdownW(): HeatLossBreakdown { return { ...this.loss }; }
  wallLossW(): number { return this.loss.totalW; }
  energyUseKWh() { return { heating: this.heatingJ / 3_600_000, cooling: this.coolingJ / 3_600_000 }; }
  thermostatHeatingOn() { return this.thermostatHeating; }
  furnitureTemperatures(): Record<number, number> { return Object.fromEntries(this.solidFurniture.map((f, i) => [f.id, this.furniture[i].temperature])); }
  stats() {
    let min = Infinity, max = -Infinity, energy = 0, capacity = 0;
    for (let i = 0; i < this.T.length; i++) if (this.capacity[i]) { min = Math.min(min, this.T[i]); max = Math.max(max, this.T[i]); energy += this.T[i] * this.capacity[i]; capacity += this.capacity[i]; }
    return { min, max, mean: energy / capacity };
  }
  isSolid(x: number, y: number, z: number) {
    if (x < 0 || y < 0 || z < 0 || x > this.room.widthM || y > this.room.heightM || z > this.room.ceilingM ||
      !footprintContains(this.room, x, y)) return true;
    const p = [x, y, z]; return this.boxes.some(parts => parts.some(b => p.every((n, a) => n >= b.min[a] && n <= b.max[a])));
  }
  sample(x: number, y: number, z = this.room.ceilingM / 2): number {
    const point = [x,y,z], item = this.boxes.findIndex(parts => parts.some(b => point.every((n,a)=>n>=b.min[a] && n<=b.max[a])));
    if(item>=0) return this.furniture[item].temperature;
    return weightedTrilerp(this.T, this.grid.volume, this.nx, this.ny, this.nz, x / this.dx - .5, y / this.dy - .5, z / this.dz - .5);
  }
  sampleVelocity(x: number, y: number, z: number): Point3 {
    if (this.isSolid(x, y, z)) return [0, 0, 0];
    return [trilerp(this.flow.u, this.nx + 1, this.ny, this.nz, x / this.dx, y / this.dy - .5, z / this.dz - .5),
      trilerp(this.flow.v, this.nx, this.ny + 1, this.nz, x / this.dx - .5, y / this.dy, z / this.dz - .5),
      trilerp(this.flow.w, this.nx, this.ny, this.nz + 1, x / this.dx - .5, y / this.dy - .5, z / this.dz)];
  }
  vectorField() { return fieldVectors(this); }
}

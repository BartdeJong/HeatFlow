/** Conservative cell-centred finite-volume conduction. Backward Euler exchanges
 * are solved jointly with the adjacent air lump, rather than lagging its temperature.
 * https://bigladdersoftware.com/epx/docs/25-2/engineering-reference/conduction-finite-difference-solution.html
 */
export interface ThermalLayer { label: string; thicknessM: number; k: number; density: number; cp: number }
export interface ThermalBoundary { temperatureC: number; conductanceWPerK: number }
export interface AirContact { temperatureC: number; capacityJPerK: number; conductanceWPerK: number }
export interface ColumnExchange { insideJ: number; outsideJ: number }

/** Solve a positive definite thermal-chain matrix in O(n); input arrays are preserved. */
export function solveThermalChain(diagonal: Float64Array, offDiagonal: Float64Array, rhs: Float64Array): Float64Array {
  const d = diagonal.slice();
  const t = rhs.slice();
  for (let i = 1; i < d.length; i++) {
    const m = offDiagonal[i - 1] / d[i - 1];
    d[i] -= m * offDiagonal[i - 1];
    t[i] -= m * t[i - 1];
  }
  t[t.length - 1] /= d[d.length - 1];
  for (let i = t.length - 2; i >= 0; i--) t[i] = (t[i] - offDiagonal[i] * t[i + 1]) / d[i];
  return t;
}

export class LayerColumn {
  readonly temperatures: Float64Array;
  readonly capacities: Float64Array;
  readonly conductances: Float64Array;
  readonly area: number;
  readonly insideHalfResistance: number;
  readonly outsideHalfResistance: number;
  readonly constructionResistanceM2KperW: number;
  private innerFaceC: number;
  private outerFaceC: number;

  constructor(area: number, layers: readonly ThermalLayer[], initialC: number, nodesPerLayer = 3) {
    if (!(area > 0) || !Number.isFinite(area) || !Number.isFinite(initialC)) throw new Error('Invalid thermal column geometry or temperature');
    if (!layers.length || layers.some(l => ![l.thicknessM, l.k, l.density, l.cp].every(v => v > 0 && Number.isFinite(v)))) {
      throw new Error('Construction layers require positive finite thickness, conductivity, density and heat capacity');
    }
    if (!Number.isInteger(nodesPerLayer) || nodesPerLayer < 1 || nodesPerLayer > 100) throw new Error('Invalid construction resolution');
    this.area = area;
    const half: number[] = [], capacities: number[] = [];
    this.constructionResistanceM2KperW = layers.reduce((s, l) => s + l.thicknessM / l.k, 0);
    for (const l of layers) for (let i = 0; i < nodesPerLayer; i++) {
      const dx = l.thicknessM / nodesPerLayer;
      half.push(dx / (2 * l.k * area));
      capacities.push(area * dx * l.density * l.cp);
    }
    this.capacities = new Float64Array(capacities);
    this.temperatures = new Float64Array(capacities.length).fill(initialC);
    this.conductances = new Float64Array(capacities.length - 1);
    for (let i = 0; i < this.conductances.length; i++) this.conductances[i] = 1 / (half[i] + half[i + 1]);
    this.insideHalfResistance = half[0];
    this.outsideHalfResistance = half[half.length - 1];
    this.innerFaceC = this.outerFaceC = initialC;
  }

  get capacityJPerK(): number { return this.capacities.reduce((s, c) => s + c, 0); }
  get insideC(): number { return this.innerFaceC; }
  get outsideC(): number { return this.outerFaceC; }
  energyJ(): number { return this.temperatures.reduce((s, t, i) => s + t * this.capacities[i], 0); }
  reset(temperatureC: number): void {
    this.temperatures.fill(temperatureC);
    this.innerFaceC = this.outerFaceC = temperatureC;
  }
  applyInsideHeat(joules: number): void {
    this.temperatures[0] += joules / this.capacities[0];
    this.innerFaceC = this.temperatures[0];
  }

  applyOutsideHeat(joules: number): void {
    const last = this.temperatures.length - 1;
    this.temperatures[last] += joules / this.capacities[last];
    this.outerFaceC = this.temperatures[last];
  }

  private filmConductance(filmWPerK: number, halfResistance: number): number {
    return filmWPerK > 0 ? 1 / (1 / filmWPerK + halfResistance) : 0;
  }
  private chain(dt: number): { diagonal: Float64Array; off: Float64Array; rhs: Float64Array } {
    const diagonal = Float64Array.from(this.capacities, c => c / dt);
    const rhs = Float64Array.from(this.temperatures, (t, i) => t * diagonal[i]);
    const off = Float64Array.from(this.conductances, g => -g);
    for (let i = 0; i < off.length; i++) { diagonal[i] -= off[i]; diagonal[i + 1] -= off[i]; }
    return { diagonal, off, rhs };
  }

  /** inside/outside heat are positive INTO the construction, films exclude solid resistance. */
  stepBoundaries(dt: number, inside: ThermalBoundary, outside: ThermalBoundary, sourceW = 0, sourceNode = 0, insideSourceW = 0): ColumnExchange {
    if (!(dt > 0)) return { insideJ: 0, outsideJ: 0 };
    const { diagonal, off, rhs } = this.chain(dt);
    const gi = this.filmConductance(inside.conductanceWPerK, this.insideHalfResistance);
    const go = this.filmConductance(outside.conductanceWPerK, this.outsideHalfResistance);
    const last = diagonal.length - 1;
    diagonal[0] += gi; rhs[0] += gi * inside.temperatureC;
    diagonal[last] += go; rhs[last] += go * outside.temperatureC;
    rhs[Math.min(last, Math.max(0, Math.floor(sourceNode)))] += sourceW;
    rhs[0] += insideSourceW;
    this.temperatures.set(solveThermalChain(diagonal, off, rhs));
    const insideW = gi * (inside.temperatureC - this.temperatures[0]);
    const outsideW = go * (outside.temperatureC - this.temperatures[last]);
    this.innerFaceC = this.temperatures[0] + insideW * this.insideHalfResistance;
    this.outerFaceC = this.temperatures[last] + outsideW * this.outsideHalfResistance;
    return { insideJ: insideW * dt, outsideJ: outsideW * dt };
  }

  /** Exact implicit star coupling to heterogeneous adjacent air cells. Eliminating
   * their unknown temperatures leaves one effective Robin boundary for the column.
   */
  stepMultiAir(dt: number, contacts: readonly AirContact[], outside: ThermalBoundary, sourceW = 0, radiationW = 0,
    sourceNode = Math.floor(this.temperatures.length / 2)): ColumnExchange & { airC: Float64Array } {
    let g = 0, gt = 0;
    const response = Float64Array.from(contacts, c => {
      const effective = c.conductanceWPerK * c.capacityJPerK / (c.capacityJPerK + dt * c.conductanceWPerK);
      g += effective; gt += effective * c.temperatureC;
      return dt * c.conductanceWPerK / (c.capacityJPerK + dt * c.conductanceWPerK);
    });
    const result = this.stepBoundaries(dt, { temperatureC: g ? gt / g : this.insideC, conductanceWPerK: g }, outside,
      sourceW, sourceNode, radiationW);
    const airC = Float64Array.from(contacts, (c, i) => c.temperatureC + response[i] * (this.insideC - c.temperatureC));
    return { ...result, airC };
  }

  /** Air capacity includes only the volume coupled to this patch. h units W/(m² K).
   * sourceW heats an embedded node (e.g. floor slab); radiationW heats the inside node.
   */
  step(dt: number, airC: number, airCapacityJPerK: number, insideH: number, outsideC: number, outsideH: number,
    sourceW = 0, radiationW = 0, sourceNode = Math.floor(this.temperatures.length / 2)): ColumnExchange & { airC: number } {
    if (!(dt > 0)) return { airC, insideJ: 0, outsideJ: 0 };
    if (!(airCapacityJPerK > 0)) throw new Error('Air capacity must be positive');
    const chain = this.chain(dt);
    const n = chain.diagonal.length;
    const diagonal = new Float64Array(n + 1), off = new Float64Array(n), rhs = new Float64Array(n + 1);
    const gi = this.filmConductance(insideH * this.area, this.insideHalfResistance);
    const go = this.filmConductance(outsideH * this.area, this.outsideHalfResistance);
    diagonal[0] = airCapacityJPerK / dt + gi;
    rhs[0] = airCapacityJPerK / dt * airC;
    diagonal.set(chain.diagonal, 1); rhs.set(chain.rhs, 1); off.set(chain.off, 1);
    diagonal[1] += gi; off[0] = -gi;
    diagonal[n] += go; rhs[n] += go * outsideC;
    rhs[1] += radiationW;
    rhs[1 + Math.min(n - 1, Math.max(0, Math.floor(sourceNode)))] += sourceW;
    const result = solveThermalChain(diagonal, off, rhs);
    this.temperatures.set(result.subarray(1));
    const insideW = gi * (result[0] - result[1]);
    const outsideW = go * (outsideC - result[n]);
    this.innerFaceC = result[1] + insideW * this.insideHalfResistance;
    this.outerFaceC = result[n] + outsideW * this.outsideHalfResistance;
    return { airC: result[0], insideJ: insideW * dt, outsideJ: outsideW * dt };
  }
}

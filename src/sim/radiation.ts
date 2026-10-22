/** Diffuse-gray enclosure radiation. Air is transparent to longwave radiation.
 * View factors use geometric quadrature, reciprocal area balancing, and cached LU radiosity.
 * https://bigladdersoftware.com/epx/docs/26-1/engineering-reference/inside-heat-balance.html
 */
export type Vec3 = readonly [number, number, number];
export interface RadiationPatch {
  area: number; center: Vec3; normal: Vec3; emissivity: number;
  /** Optional half-edge vectors enable 3x3 surface quadrature instead of midpoint approximation. */
  tangentU?: Vec3; tangentV?: Vec3;
  /** Open apertures let transmitted sunlight leave the room. */
  solarTransparent?: boolean;
}
export interface RadiationBox { min: Vec3; max: Vec3 }
export const STEFAN_BOLTZMANN = 5.670374419e-8;
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Positive distance to an axis-aligned box along a unit ray; null for no hit. */
export function rayBoxDistance(origin: Vec3, direction: Vec3, box: RadiationBox, maxDistance = Infinity): number | null {
  let near = -Infinity, far = Infinity;
  for (let d = 0; d < 3; d++) {
    if (Math.abs(direction[d]) < 1e-12) {
      if (origin[d] < box.min[d] || origin[d] > box.max[d]) return null;
    } else {
      let a = (box.min[d] - origin[d]) / direction[d], b = (box.max[d] - origin[d]) / direction[d];
      if (a > b) [a, b] = [b, a];
      near = Math.max(near, a); far = Math.min(far, b);
    }
  }
  if (far < Math.max(near, 1e-7)) return null;
  const hit = Math.max(0, near);
  return hit < maxDistance - 1e-7 ? hit : null;
}
export function segmentVisible(a: Vec3, b: Vec3, boxes: readonly RadiationBox[]): boolean {
  const delta: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const length = Math.hypot(...delta);
  if (length < 1e-8) return false;
  const direction: Vec3 = [delta[0] / length, delta[1] / length, delta[2] / length];
  const origin: Vec3 = [a[0] + direction[0] * 1e-6, a[1] + direction[1] * 1e-6, a[2] + direction[2] * 1e-6];
  return !boxes.some(box => rayBoxDistance(origin, direction, box, length - 2e-6) !== null);
}
function points(p: RadiationPatch): Vec3[] {
  if (!p.tangentU || !p.tangentV) return [p.center];
  const result: Vec3[] = [];
  for (const u of [-2 / 3, 0, 2 / 3]) for (const v of [-2 / 3, 0, 2 / 3]) {
    result.push([0, 1, 2].map(d => p.center[d] + u * p.tangentU![d] + v * p.tangentV![d]) as unknown as Vec3);
  }
  return result;
}

export class RadiationEnclosure {
  /** Row-major Fij. Row closure and Ai Fij = Aj Fji hold to solver precision. */
  readonly viewFactors: Float64Array;
  private readonly exchangeAreas: Float64Array;
  private readonly lu: Float64Array;
  private readonly pivots: Int32Array;
  private readonly eps: Float64Array;
  readonly patches: readonly RadiationPatch[];

  constructor(patches: readonly RadiationPatch[], blockers: readonly RadiationBox[] = []) {
    if (patches.some(p => !(p.area > 0) || !Number.isFinite(p.area))) throw new Error('Radiation patches need positive area');
    this.patches = patches;
    const n = patches.length;
    const weights = new Float64Array(n * n);
    const sample = patches.map(points);
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      let kernel = 0;
      for (const a of sample[i]) for (const b of sample[j]) {
        const r: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        const r2 = dot(r, r);
        if (r2 < 1e-12 || !segmentVisible(a, b, blockers)) continue;
        kernel += Math.max(0, dot(patches[i].normal, r)) * Math.max(0, -dot(patches[j].normal, r)) / (Math.PI * r2 * r2);
      }
      const w = kernel / (sample[i].length * sample[j].length) * patches[i].area * patches[j].area;
      weights[i * n + j] = weights[j * n + i] = w;
    }
    // Symmetric balancing retains geometric ratios, reciprocity, and enclosure closure.
    // Incomplete or geometrically infeasible patch sets retain unseen radiation as self-view.
    const scales = new Float64Array(n).fill(1);
    for (let iteration = 0; iteration < 1000; iteration++) {
      let error = 0;
      const correction = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        let sum = 0;
        for (let j = 0; j < n; j++) sum += scales[i] * weights[i * n + j] * scales[j];
        correction[i] = sum > 1e-25 ? Math.sqrt(patches[i].area / sum) : 1;
        error = Math.max(error, Math.abs(sum / patches[i].area - 1));
      }
      if (error < 1e-10) break;
      for (let i = 0; i < n; i++) scales[i] = Math.min(1e12, Math.max(1e-12, scales[i] * correction[i]));
    }
    let largestRowRatio = 1;
    for (let i = 0; i < n; i++) {
      let row = 0;
      for (let j = 0; j < n; j++) row += weights[i * n + j] *= scales[i] * scales[j];
      largestRowRatio = Math.max(largestRowRatio, row / patches[i].area);
    }
    this.exchangeAreas = weights;
    this.viewFactors = new Float64Array(n * n);
    for (let i = 0; i < n; i++) {
      let row = 0;
      for (let j = 0; j < n; j++) {
        weights[i * n + j] /= largestRowRatio;
        row += weights[i * n + j];
        this.viewFactors[i * n + j] = weights[i * n + j] / patches[i].area;
      }
      this.viewFactors[i * n + i] += Math.max(0, 1 - row / patches[i].area);
    }
    this.eps = Float64Array.from(patches, p => Math.min(1, Math.max(1e-6, p.emissivity)));
    this.lu = new Float64Array(n * n);
    this.pivots = new Int32Array(n);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      this.lu[i * n + j] = (i === j ? 1 : 0) - (1 - this.eps[i]) * this.viewFactors[i * n + j];
    }
    for (let k = 0; k < n; k++) {
      let pivot = k;
      for (let i = k + 1; i < n; i++) if (Math.abs(this.lu[i * n + k]) > Math.abs(this.lu[pivot * n + k])) pivot = i;
      this.pivots[k] = pivot;
      if (pivot !== k) for (let j = 0; j < n; j++) [this.lu[k * n + j], this.lu[pivot * n + j]] = [this.lu[pivot * n + j], this.lu[k * n + j]];
      for (let i = k + 1; i < n; i++) {
        const factor = this.lu[i * n + k] /= this.lu[k * n + k];
        for (let j = k + 1; j < n; j++) this.lu[i * n + j] -= factor * this.lu[k * n + j];
      }
    }
  }

  /** Net watts into each solid; each pair is applied equal and opposite. */
  exchange(temperaturesC: ArrayLike<number>): Float64Array {
    const n = this.patches.length;
    if (temperaturesC.length !== n) throw new Error('Radiation temperature count mismatch');
    const radiosity = Float64Array.from(this.eps, (e, i) => e * STEFAN_BOLTZMANN * Math.max(1, temperaturesC[i] + 273.15) ** 4);
    for (let k = 0; k < n; k++) {
      const p = this.pivots[k];
      if (p !== k) [radiosity[k], radiosity[p]] = [radiosity[p], radiosity[k]];
    }
    for (let i = 0; i < n; i++) for (let j = 0; j < i; j++) radiosity[i] -= this.lu[i * n + j] * radiosity[j];
    for (let i = n - 1; i >= 0; i--) {
      for (let j = i + 1; j < n; j++) radiosity[i] -= this.lu[i * n + j] * radiosity[j];
      radiosity[i] /= this.lu[i * n + i];
    }
    const watts = new Float64Array(n);
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const q = this.exchangeAreas[i * n + j] * (radiosity[j] - radiosity[i]);
      watts[i] += q; watts[j] -= q;
    }
    return watts;
  }
}

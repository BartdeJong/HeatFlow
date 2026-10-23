export type Vec3 = [number, number, number];
export interface AirStats { min: number; max: number; mean: number }
export interface HeatFlowVector { x: number; y: number; z: number; dx: number; dy: number; dz: number; magnitude: number }
/** Rendering and sampling depend on fields, never on ownership of the solver. */
export interface SimulationField {
  readonly nx: number; readonly ny: number; readonly nz: number;
  readonly dx: number; readonly dy: number; readonly dz: number;
  readonly T: ArrayLike<number>; readonly solid: Uint8Array; readonly elapsed: number;
  readonly generation?: number;
  readonly volume?: ArrayLike<number>;
  sample(x: number, y: number, z?: number): number;
  sampleVelocity(x: number, y: number, z: number): Vec3;
  isSolid(x: number, y: number, z: number): boolean;
  stats(): AirStats;
  vectorField(): HeatFlowVector[];
}
export function trilerp(f: ArrayLike<number>, nx: number, ny: number, nz: number, x: number, y: number, z: number): number {
  const dims = [nx, ny, nz], pos = [x, y, z].map((p, a) => Math.max(0, Math.min(dims[a] - 1, p)));
  const lo = pos.map(Math.floor), hi = lo.map((p, a) => Math.min(dims[a] - 1, p + 1));
  const mix = pos.map((p, a) => p - lo[a]); let value = 0;
  for (let k = 0; k < 2; k++) for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
    const ix = i ? hi[0] : lo[0], iy = j ? hi[1] : lo[1], iz = k ? hi[2] : lo[2];
    value += f[(iz * ny + iy) * nx + ix] * (i ? mix[0] : 1 - mix[0]) * (j ? mix[1] : 1 - mix[1]) * (k ? mix[2] : 1 - mix[2]);
  }
  return value;
}
export function fieldVectors(field: SimulationField): HeatFlowVector[] {
  const vectors: HeatFlowVector[] = [], spacing = Math.max(2, Math.ceil(Math.max(field.nx, field.ny, field.nz) / 7));
  const alpha = 2.2e-5, mean = field.stats().mean;
  for (let k = 1; k < field.nz; k += spacing) for (let j = 1; j < field.ny; j += spacing) for (let i = 1; i < field.nx; i += spacing) {
    const x = (i + .5) * field.dx, y = (j + .5) * field.dy, z = (k + .5) * field.dz;
    if (field.isSolid(x, y, z)) continue;
    const v = field.sampleVelocity(x, y, z), delta = field.sample(x, y, z) - mean;
    const dx = -alpha * (field.sample(x + field.dx, y, z) - field.sample(x - field.dx, y, z)) / (2 * field.dx) + v[0] * delta;
    const dy = -alpha * (field.sample(x, y + field.dy, z) - field.sample(x, y - field.dy, z)) / (2 * field.dy) + v[1] * delta;
    const dz = -alpha * (field.sample(x, y, z + field.dz) - field.sample(x, y, z - field.dz)) / (2 * field.dz) + v[2] * delta;
    const magnitude = Math.hypot(dx, dy, dz); if (magnitude > 1e-9) vectors.push({ x, y, z, dx, dy, dz, magnitude });
  }
  return vectors;
}

/** Air-only interpolation: solid fractions never contaminate a neighboring air probe. */
export function weightedTrilerp(f: ArrayLike<number>, weights: ArrayLike<number>, nx: number, ny: number, nz: number, x: number, y: number, z: number): number {
  const dims = [nx, ny, nz], pos = [x, y, z].map((p,a) => Math.max(0,Math.min(dims[a]-1,p)));
  const lo = pos.map(Math.floor), hi=lo.map((p,a)=>Math.min(dims[a]-1,p+1)), mix=pos.map((p,a)=>p-lo[a]);
  let total=0, value=0, reference: number | undefined;
  for(let k=0;k<2;k++)for(let j=0;j<2;j++)for(let i=0;i<2;i++) {
    const ix=i?hi[0]:lo[0],iy=j?hi[1]:lo[1],iz=k?hi[2]:lo[2],index=(iz*ny+iy)*nx+ix;
    const w=weights[index]*(i?mix[0]:1-mix[0])*(j?mix[1]:1-mix[1])*(k?mix[2]:1-mix[2]);
    if (w <= 0) continue;
    const sample = f[index];
    reference ??= sample;
    total+=w;value+=w*(sample-reference);
  }
  return total && reference !== undefined ? reference + value/total : trilerp(f,nx,ny,nz,x,y,z);
}

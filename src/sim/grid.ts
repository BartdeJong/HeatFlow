import type { RoomConfig } from './config';
import { furnitureBoxes, unionBoxVolume, unionRectangleArea, type FurnitureBox, type Point3 } from './furniture';

/** Exact axis-aligned cut-cell geometry. Volumes remain unmerged for heat accounting. */
export class GridGeometry {
  readonly nx: number; readonly ny: number; readonly nz: number;
  readonly dx: number; readonly dy: number; readonly dz: number;
  readonly volume: Float64Array;
  readonly furnitureVolumes: Float64Array[];
  readonly solid: Uint8Array;
  readonly openU: Float64Array; readonly openV: Float64Array; readonly openW: Float64Array;
  /** Tiny (<10%) fluid cells share this representative's temperature/pressure DOF. */
  readonly representative: Int32Array;
  constructor(readonly room: RoomConfig, nx: number, ny: number, nz: number) {
    this.nx = nx; this.ny = ny; this.nz = nz;
    this.dx = room.widthM / nx; this.dy = room.heightM / ny; this.dz = room.ceilingM / nz;
    const n = nx * ny * nz, cellVolume = this.dx * this.dy * this.dz;
    this.volume = new Float64Array(n); this.solid = new Uint8Array(n);
    this.representative = Int32Array.from({ length: n }, (_, i) => i);
    this.furnitureVolumes = room.furniture.map(() => new Float64Array(n));
    const parts = room.furniture.map(furnitureBoxes), boxes = parts.flat();
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const index = this.index(i, j, k);
      const min: Point3 = [i * this.dx, j * this.dy, k * this.dz];
      const max: Point3 = [(i + 1) * this.dx, (j + 1) * this.dy, (k + 1) * this.dz];
      this.volume[index] = Math.max(0, cellVolume - unionBoxVolume(clipBoxes(boxes, min, max)));
      if (this.volume[index] < cellVolume * 1e-10) { this.volume[index] = 0; this.solid[index] = 1; }
      parts.forEach((item, f) => { this.furnitureVolumes[f][index] = unionBoxVolume(clipBoxes(item, min, max)); });
    }
    this.openU = new Float64Array((nx + 1) * ny * nz);
    this.openV = new Float64Array(nx * (ny + 1) * nz);
    this.openW = new Float64Array(nx * ny * (nz + 1));
    const areas = [this.openU, this.openV, this.openW], spacings = [this.dx, this.dy, this.dz];
    for (let axis = 0; axis < 3; axis++) {
      const counts = [nx, ny, nz]; counts[axis]++;
      const a = (axis + 1) % 3, b = (axis + 2) % 3;
      for (let k = 0; k < counts[2]; k++) for (let j = 0; j < counts[1]; j++) for (let i = 0; i < counts[0]; i++) {
        const coord = [i, j, k], plane = coord[axis] * spacings[axis];
        const loA = coord[a] * spacings[a], hiA = loA + spacings[a];
        const loB = coord[b] * spacings[b], hiB = loB + spacings[b];
        // A box ending exactly at a face still blocks transport through that face.
        const rects = boxes.filter((box) => box.min[axis] <= plane + 1e-12 && box.max[axis] >= plane - 1e-12)
          .map((box) => [Math.max(loA, box.min[a]), Math.min(hiA, box.max[a]), Math.max(loB, box.min[b]), Math.min(hiB, box.max[b])] as [number, number, number, number]);
        const open = Math.max(0, spacings[a] * spacings[b] - unionRectangleArea(rects));
        areas[axis][i + counts[0] * (j + counts[1] * k)] = open < spacings[a] * spacings[b] * 1e-10 ? 0 : open;
      }
    }
    // Union tiny cells only through an actually open face; never connect isolated pockets.
    const root = (i: number): number => { while (this.representative[i] !== i) i = this.representative[i]; return i; };
    const candidates: { i: number; volume: number }[] = [];
    for (let i = 0; i < n; i++) if (this.volume[i] > 0 && this.volume[i] < 0.1 * cellVolume) candidates.push({ i, volume: this.volume[i] });
    candidates.sort((a, b) => a.volume - b.volume);
    for (const { i: index } of candidates) {
      const i = index % nx, j = Math.floor(index / nx) % ny, k = Math.floor(index / (nx * ny));
      const neighbors = [
        [i > 0 ? index - 1 : -1, this.openU[this.uIndex(i, j, k)]],
        [i < nx - 1 ? index + 1 : -1, this.openU[this.uIndex(i + 1, j, k)]],
        [j > 0 ? index - nx : -1, this.openV[this.vIndex(i, j, k)]],
        [j < ny - 1 ? index + nx : -1, this.openV[this.vIndex(i, j + 1, k)]],
        [k > 0 ? index - nx * ny : -1, this.openW[this.wIndex(i, j, k)]],
        [k < nz - 1 ? index + nx * ny : -1, this.openW[this.wIndex(i, j, k + 1)]],
      ].filter(([other, area]) => other >= 0 && area > 0 && this.volume[other] > 0 && root(other) !== root(index));
      neighbors.sort((a, b) => this.volume[b[0]] - this.volume[a[0]] || b[1] - a[1]);
      if (neighbors.length) this.representative[root(index)] = root(neighbors[0][0]);
    }
    for (let i = 0; i < n; i++) this.representative[i] = root(i);
  }
  index(i: number, j: number, k: number): number { return i + this.nx * (j + this.ny * k); }
  uIndex(i: number, j: number, k: number): number { return i + (this.nx + 1) * (j + this.ny * k); }
  vIndex(i: number, j: number, k: number): number { return i + this.nx * (j + (this.ny + 1) * k); }
  wIndex(i: number, j: number, k: number): number { return i + this.nx * (j + this.ny * k); }
}
function clipBoxes(boxes: FurnitureBox[], min: Point3, max: Point3): FurnitureBox[] {
  return boxes.filter((b) => b.min.every((v, a) => v < max[a] && b.max[a] > min[a]))
    .map((b) => ({ ...b, min: b.min.map((v, a) => Math.max(min[a], v)) as Point3, max: b.max.map((v, a) => Math.min(max[a], v)) as Point3 }));
}

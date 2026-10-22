import type { RoomConfig } from './config';
import { fieldVectors, trilerp, weightedTrilerp, type AirStats, type SimulationField, type Vec3 } from './field';
import { furnitureBoxes, type FurnitureBox } from './furniture';
import { geometryKey, snapshotBuffers, type SimulationSnapshot, type WorkerCommand } from './protocol';
export type { SimulationSnapshot } from './protocol';

/** A stable field object; only the worker owns or advances the simulation. */
export class SnapshotField implements SimulationField {
  nx = 2; ny = 2; nz = 2; dx = 1; dy = 1; dz = 1; elapsed = 0; generation = 0;
  T = new Float64Array(8).fill(20); solid = new Uint8Array(8); volume = new Float64Array(8).fill(1);
  u = new Float64Array(12); v = new Float64Array(12); w = new Float64Array(12);
  private boxes: FurnitureBox[] = [];
  private furnitureTemps: Record<number, number> = {};
  apply(snapshot: SimulationSnapshot, room: RoomConfig): ArrayBuffer[] {
    const old = [this.T, this.solid, this.volume, this.u, this.v, this.w].map(a => a.buffer as ArrayBuffer);
    const { nx, ny, nz, dx, dy, dz, T, solid, volume, u, v, w, elapsed, generation } = snapshot;
    Object.assign(this, { nx, ny, nz, dx, dy, dz, T, solid, volume, u, v, w, elapsed, generation });
    this.boxes = room.furniture.flatMap(furnitureBoxes);
    this.furnitureTemps = snapshot.furnitureTemps;
    return old;
  }
  sample(x: number, y: number, z = this.nz * this.dz / 2): number {
    const point = [x, y, z];
    const furniture = this.boxes.find(b => point.every((n, a) => n >= b.min[a] && n <= b.max[a]));
    if (furniture && this.furnitureTemps[furniture.id] !== undefined) return this.furnitureTemps[furniture.id];
    return weightedTrilerp(this.T, this.volume, this.nx, this.ny, this.nz, x / this.dx - .5, y / this.dy - .5, z / this.dz - .5);
  }
  isSolid(x: number, y: number, z: number): boolean {
    return this.boxes.some(b => [x, y, z].every((n, a) => n >= b.min[a] && n <= b.max[a]));
  }
  sampleVelocity(x: number, y: number, z: number): Vec3 {
    if (this.isSolid(x, y, z)) return [0, 0, 0];
    return [trilerp(this.u, this.nx + 1, this.ny, this.nz, x / this.dx, y / this.dy - .5, z / this.dz - .5),
      trilerp(this.v, this.nx, this.ny + 1, this.nz, x / this.dx - .5, y / this.dy, z / this.dz - .5),
      trilerp(this.w, this.nx, this.ny, this.nz + 1, x / this.dx - .5, y / this.dy - .5, z / this.dz)];
  }
  stats(): AirStats {
    let min = Infinity, max = -Infinity, sum = 0, volume = 0;
    for (let i = 0; i < this.T.length; i++) if (this.volume[i] > 0) {
      min = Math.min(min, this.T[i]); max = Math.max(max, this.T[i]); sum += this.T[i] * this.volume[i]; volume += this.volume[i];
    }
    return volume ? { min, max, mean: sum / volume } : { min: 20, max: 20, mean: 20 };
  }
  vectorField() { return fieldVectors(this); }
}
export interface WorkerPort {
  onmessage: ((event: MessageEvent<SimulationSnapshot>) => void) | null;
  onerror?: ((event: ErrorEvent) => void) | null;
  postMessage(message: WorkerCommand, transfer?: Transferable[]): void;
  terminate(): void;
}
export class SimulationClient {
  readonly field = new SnapshotField();
  onUpdate: ((snapshot: SimulationSnapshot) => void) | null = null;
  onError: ((message: string) => void) | null = null;
  private room?: RoomConfig; private key = ''; private generation = 0; private revision = 0; private disposed = false;
  private readonly worker: WorkerPort;
  private pending?: Extract<WorkerCommand, { room: RoomConfig }>;
  private configureTimer?: ReturnType<typeof setTimeout>;
  constructor(worker?: WorkerPort) {
    this.worker = worker ?? new Worker(new URL('./simulation.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = event => this.receive(event.data);
    this.worker.onerror = event => this.onError?.(event.message || 'The simulation worker stopped unexpectedly.');
  }
  configure(room: RoomConfig): void {
    if (this.disposed) return;
    const copy = structuredClone(room);
    if (this.room && JSON.stringify(copy) === JSON.stringify(this.room)) return;
    const key = geometryKey(copy);
    const geometryChanged = !this.room || key !== this.key;
    if (geometryChanged) this.generation++;
    const type = this.room ? 'configure' : 'init';
    this.room = copy; this.key = key; this.revision++;
    // Invalidate old results immediately, but coalesce expensive drag/size rebuilds.
    this.pending = { type, room: copy, generation: this.generation, revision: this.revision };
    if (type === 'init' || !geometryChanged) this.flushConfiguration();
    else {
      if (this.configureTimer !== undefined) clearTimeout(this.configureTimer);
      this.configureTimer = setTimeout(() => this.flushConfiguration(), 75);
    }
  }
  setControl(running: boolean, speed: number): void {
    if (this.disposed) return;
    this.flushConfiguration();
    this.worker.postMessage({ type: 'control', running, speed: Math.max(0, Number.isFinite(speed) ? speed : 1) });
  }
  reset(): void {
    if (this.disposed || !this.room) return;
    this.generation++;
    if (this.pending) {
      // The pending geometry already requires a reset; build only the final room once.
      this.pending.generation = this.generation;
      this.flushConfiguration();
    } else this.worker.postMessage({ type: 'reset', generation: this.generation, revision: this.revision });
  }
  private flushConfiguration(): void {
    if (this.configureTimer !== undefined) clearTimeout(this.configureTimer);
    this.configureTimer = undefined;
    const pending = this.pending; this.pending = undefined;
    if (pending && !this.disposed) this.worker.postMessage(pending);
  }
  private receive(snapshot: SimulationSnapshot): void {
    if (this.disposed) return;
    if (!this.room || snapshot.generation !== this.generation || snapshot.revision !== this.revision) {
      this.recycle(snapshotBuffers(snapshot)); return;
    }
    this.recycle(this.field.apply(snapshot, this.room));
    this.onUpdate?.(snapshot);
  }
  private recycle(buffers: ArrayBuffer[]) { this.worker.postMessage({ type: 'recycle', buffers }, buffers); }
  dispose(): void {
    this.disposed = true; this.flushConfiguration();
    this.worker.onmessage = null; this.worker.onerror = null; this.worker.terminate();
  }
}

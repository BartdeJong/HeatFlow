import type { Vec3 } from './camera';

interface FlowField {
  sampleVelocity(x: number, y: number, z: number): Vec3;
  isSolid?(x: number, y: number, z: number): boolean;
}

interface Trail {
  points: Vec3[];
  temperatures: number[];
}

const TRANSITION_SECONDS = 0.25;

/** Crossfade intact streamlines rather than moving their vertices through furniture. */
export class AirflowTrails {
  private previous: Trail[] = [];
  private current: Trail[] = [];
  private transition = 1;
  private elapsed = -1;
  phase = 0;

  reset() {
    this.previous = []; this.current = []; this.transition = 1;
    this.elapsed = -1; this.phase = 0;
  }

  update(field: FlowField & { sample(x: number, y: number, z: number): number }, size: Vec3,
    seeds: Vec3[], elapsed: number, wallDt: number) {
    if (elapsed < this.elapsed) this.reset();
    this.phase += wallDt;
    this.transition = Math.min(1, this.transition + wallDt / TRANSITION_SECONDS);
    if (elapsed === this.elapsed || this.transition < 1) return;
    this.previous = this.current;
    // Preserve empty seed slots: a disappearing path must not rephase other trails.
    this.current = seeds.map((seed) => {
      const points = traceAirflow(field, size, seed);
      return { points, temperatures: points.map((p) => field.sample(...p)) };
    });
    this.elapsed = elapsed;
    this.transition = 0;
  }

  get layers() {
    return [
      { trails: this.previous, opacity: 1 - this.transition },
      { trails: this.current, opacity: this.transition },
    ];
  }
}

/** A soft pulse with a fixed period, independent of changing streamline length. */
export function airflowHighlight(phase: number, seedIndex: number, segment: number): number {
  const distance = ((phase * 12 + seedIndex * 7.3 - segment) % 44 + 66) % 44 - 22;
  return Math.exp(-distance * distance / 12);
}

/** Trace a streamline through the simulated 3D velocity field. */
export function traceAirflow(field: FlowField, size: Vec3, seed: Vec3): Vec3[] {
  const points: Vec3[] = [[...seed]];
  const step = Math.min(...size) / 24;
  const inside = (p: Vec3) => p.every((value, axis) => value > 0 && value < size[axis]) && !field.isSolid?.(...p);
  if (!inside(seed)) return [];
  for (let i = 0; i < 36; i++) {
    const p = points[points.length - 1];
    const velocity = field.sampleVelocity(...p);
    const speed = Math.hypot(...velocity);
    if (speed < 0.0001) break;
    const middle = p.map((value, axis) => value + velocity[axis] / speed * step / 2) as Vec3;
    if (!inside(middle)) break;
    const nextVelocity = field.sampleVelocity(...middle);
    const nextSpeed = Math.hypot(...nextVelocity);
    if (nextSpeed < 0.0001) break;
    const next = p.map((value, axis) => value + nextVelocity[axis] / nextSpeed * step) as Vec3;
    if (!inside(next)) break;
    points.push(next);
  }
  return points;
}

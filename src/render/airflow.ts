import type { Vec3 } from './camera';

interface FlowField {
  sampleVelocity(x: number, y: number, z: number): Vec3;
  isSolid?(x: number, y: number, z: number): boolean;
}

interface Trail {
  points: Vec3[];
  temperatures: number[];
  speedMps: number;
}

const TRANSITION_SECONDS = 0.25;
const REFERENCE_FLOW_SPEED_MPS = 0.2;
const REFERENCE_GRID_TRAILS = 60;
const REFERENCE_ROOM_VOLUME_M3 = 5 * 4 * 2.5;
const MIN_GRID_TRAILS = 24;
const MAX_GRID_TRAILS = 144;

/** Keep airflow seed density roughly proportional to room volume within a bounded grid size. */
export function airflowGridDimensions(size: Vec3): Vec3 {
  const rawCount = REFERENCE_GRID_TRAILS * size[0] * size[1] * size[2] / REFERENCE_ROOM_VOLUME_M3;
  const targetCount = Math.max(MIN_GRID_TRAILS, Math.min(MAX_GRID_TRAILS, Math.round(rawCount)));
  const scale = Math.cbrt(targetCount / rawCount);
  const ideal: Vec3 = [size[0] * scale, size[1] * scale, size[2] * 1.2 * scale];
  const minimum: Vec3 = [1, 1, 3];
  const dimensions: Vec3 = [
    Math.max(minimum[0], Math.round(ideal[0])),
    Math.max(minimum[1], Math.round(ideal[1])),
    Math.max(minimum[2], Math.round(ideal[2])),
  ];

  while (dimensions[0] * dimensions[1] * dimensions[2] > MAX_GRID_TRAILS) {
    let axis = -1;
    let greatestOverage = -Infinity;
    for (let i = 0; i < dimensions.length; i++) {
      if (dimensions[i] <= minimum[i]) continue;
      const overage = dimensions[i] / ideal[i];
      if (overage > greatestOverage) {
        greatestOverage = overage;
        axis = i;
      }
    }
    if (axis < 0) break;
    dimensions[axis]--;
  }

  return dimensions;
}

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
      const speedMps = points.reduce((sum, p) => {
        const velocity = field.sampleVelocity(...p);
        return sum + Math.hypot(...velocity);
      }, 0) / Math.max(1, points.length);
      return { points, temperatures: points.map((p) => field.sample(...p)), speedMps };
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

/** A soft pulse whose speed follows the mean flow speed along its streamline. */
export function airflowHighlight(phase: number, seedIndex: number, segment: number, speedMps = REFERENCE_FLOW_SPEED_MPS): number {
  const speedScale = Math.min(4, Math.max(0, speedMps) / REFERENCE_FLOW_SPEED_MPS);
  const distance = ((phase * 12 * speedScale + seedIndex * 7.3 - segment) % 44 + 66) % 44 - 22;
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

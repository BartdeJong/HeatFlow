import type { Vec3 } from './camera';

interface FlowField {
  sampleVelocity(x: number, y: number, z: number): Vec3;
  isSolid?(x: number, y: number, z: number): boolean;
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

import type { Furniture } from './config';

export type Point3 = [number, number, number];
export interface FurnitureBox {
  id: number;
  min: Point3;
  max: Point3;
  part: 'body' | 'seat' | 'back' | 'top' | 'leg';
}

export function furnitureExtent(f: Furniture): [number, number] {
  return f.rotation === 90 ? [f.depthM, f.widthM] : [f.widthM, f.depthM];
}

/** Identical solid parts are used for physics, drawing, picking, and trail occlusion. */
export function furnitureBoxes(f: Furniture): FurnitureBox[] {
  const { widthM: w, depthM: d, heightM: h } = f;
  const parts: FurnitureBox[] = [];
  const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, part: FurnitureBox['part']) => {
    const points: Point3[] = [[x0 * w, y0 * d, z0 * h], [x1 * w, y1 * d, z1 * h]];
    const rotated = points.map(([x, y, z]) => f.rotation === 90 ? [f.x - y, f.y + x, z] : [f.x + x, f.y + y, z]);
    parts.push({ id: f.id, min: rotated[0].map((n, i) => Math.min(n, rotated[1][i])) as Point3,
      max: rotated[0].map((n, i) => Math.max(n, rotated[1][i])) as Point3, part });
  };
  const legs = (top: number) => {
    for (const x of [-0.44, 0.36]) for (const y of [-0.42, 0.34]) box(x, y, 0, x + 0.08, y + 0.08, top, 'leg');
  };
  switch (f.kind) {
    case 'table':
      box(-0.5, -0.5, 0.84, 0.5, 0.5, 1, 'top');
      legs(0.84);
      break;
    case 'sofa':
      legs(0.14);
      box(-0.5, -0.5, 0.14, 0.5, 0.5, 0.44, 'body');
      box(-0.4, -0.27, 0.44, 0.4, 0.48, 0.59, 'seat');
      box(-0.5, -0.5, 0.44, 0.5, -0.27, 1, 'back');
      box(-0.5, -0.27, 0.44, -0.4, 0.5, 0.8, 'body');
      box(0.4, -0.27, 0.44, 0.5, 0.5, 0.8, 'body');
      break;
    case 'bed':
      legs(0.18);
      box(-0.5, -0.5, 0.18, 0.5, 0.5, 0.5, 'body');
      box(-0.48, -0.46, 0.5, 0.48, 0.49, 0.8, 'seat');
      box(-0.5, -0.5, 0.5, 0.5, -0.43, 1, 'back');
      break;
    case 'cabinet':
      box(-0.5, -0.5, 0, 0.5, 0.5, 1, 'body');
      break;
  }
  return parts;
}

/** Ray/AABB intersection shared by furniture selection and overlay visibility. */
export function intersectBox(origin: Point3, direction: Point3, box: FurnitureBox): number | null {
  let near = -Infinity, far = Infinity;
  for (let axis = 0; axis < 3; axis++) {
    if (Math.abs(direction[axis]) < 1e-9) {
      if (origin[axis] < box.min[axis] || origin[axis] > box.max[axis]) return null;
      continue;
    }
    const a = (box.min[axis] - origin[axis]) / direction[axis];
    const b = (box.max[axis] - origin[axis]) / direction[axis];
    near = Math.max(near, Math.min(a, b));
    far = Math.min(far, Math.max(a, b));
    if (near > far) return null;
  }
  return far > 1e-5 ? Math.max(0, near) : null;
}

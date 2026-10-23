import type { Furniture, RoomConfig } from './config';

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

export function interiorWallFurniture(room: Pick<RoomConfig, 'interiorWalls' | 'widthM' | 'heightM' | 'ceilingM'>): Furniture[] {
  return (room.interiorWalls ?? []).flatMap((wall) => {
    const horizontal = wall.start.y === wall.end.y;
    const length = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y);
    const widthM = horizontal ? length : wall.thicknessM;
    const depthM = horizontal ? wall.thicknessM : length;
    const x = (wall.start.x + wall.end.x) / 2, y = (wall.start.y + wall.end.y) / 2;
    if (!Number.isFinite(length) || length < 0.1 || !Number.isFinite(wall.thicknessM) || wall.thicknessM <= 0 ||
      x - widthM / 2 < 0 || x + widthM / 2 > room.widthM ||
      y - depthM / 2 < 0 || y + depthM / 2 > room.heightM) return [];
    return [{
      id: -(Math.max(0, Math.floor(wall.id)) * 100 + 1),
      kind: 'wall' as const,
      material: 'masonry' as const,
      x,
      y,
      widthM,
      depthM,
      heightM: room.ceilingM,
      rotation: 0 as const,
    }];
  });
}

export function physicalFurniture(room: RoomConfig): Furniture[] {
  return [...room.furniture, ...interiorWallFurniture(room)];
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
    case 'wall':
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

/** Exact area of a union of axis-aligned rectangles [left,right,bottom,top]. */
export function unionRectangleArea(rectangles: ReadonlyArray<readonly [number, number, number, number]>): number {
  const rects = rectangles.filter(([x0, x1, y0, y1]) => x1 > x0 && y1 > y0);
  const xs = [...new Set(rects.flatMap(([a, b]) => [a, b]))].sort((a, b) => a - b);
  let area = 0;
  for (let i = 1; i < xs.length; i++) {
    const mid = (xs[i - 1] + xs[i]) / 2;
    const intervals = rects.filter(([a, b]) => a < mid && b > mid).map((r) => [r[2], r[3]]).sort((a, b) => a[0] - b[0]);
    let length = 0, end = -Infinity;
    for (const [a, b] of intervals) { if (b > end) { length += b - Math.max(a, end); end = b; } }
    area += (xs[i] - xs[i - 1]) * length;
  }
  return area;
}

/** Exact union volume; overlapping components (e.g. mattress/headboard) count once. */
export function unionBoxVolume(boxes: ReadonlyArray<Pick<FurnitureBox, 'min' | 'max'>>): number {
  const xs = [...new Set(boxes.flatMap((b) => [b.min[0], b.max[0]]))].sort((a, b) => a - b);
  let volume = 0;
  for (let i = 1; i < xs.length; i++) {
    const mid = (xs[i] + xs[i - 1]) / 2;
    const rectangles = boxes.filter((b) => b.min[0] < mid && b.max[0] > mid).map((b) => [b.min[1], b.max[1], b.min[2], b.max[2]] as const);
    volume += (xs[i] - xs[i - 1]) * unionRectangleArea(rectangles);
  }
  return volume;
}
export function furnitureVolume(item: Furniture): number { return unionBoxVolume(furnitureBoxes(item)); }

/** Contact is allowed; only positive solid intersection is an overlap. */
export function furnitureOverlap(a: Furniture, b: Furniture): boolean {
  return furnitureBoxes(a).some((aa) => furnitureBoxes(b).some((bb) => aa.min.every((v, axis) => Math.min(aa.max[axis], bb.max[axis]) - Math.max(v, bb.min[axis]) > 1e-9)));
}
export function furnitureOverlaps(items: ReadonlyArray<Furniture>): [number, number][] {
  const pairs: [number, number][] = [];
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) if (furnitureOverlap(items[i], items[j])) pairs.push([items[i].id, items[j].id]);
  return pairs;
}

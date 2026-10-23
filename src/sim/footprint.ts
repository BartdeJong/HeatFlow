export interface FootprintPoint { x: number; y: number }
export interface FootprintRoom { widthM: number; heightM: number; footprint?: FootprintPoint[] }
export interface FootprintWall {
  index: number;
  start: FootprintPoint;
  end: FootprintPoint;
  length: number;
  normal: [number, number];
  side?: 'top' | 'right' | 'bottom' | 'left';
}
export interface FootprintRectangle { x0: number; y0: number; x1: number; y1: number }

export function roomFootprint(room: FootprintRoom): FootprintPoint[] {
  const points = room.footprint;
  const epsilon = 1e-8;
  if (points?.length && points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)) &&
    Math.abs(Math.min(...points.map((point) => point.x))) < epsilon && Math.abs(Math.max(...points.map((point) => point.x)) - room.widthM) < epsilon &&
    Math.abs(Math.min(...points.map((point) => point.y))) < epsilon && Math.abs(Math.max(...points.map((point) => point.y)) - room.heightM) < epsilon) return points;
  return [{ x: 0, y: 0 }, { x: room.widthM, y: 0 }, { x: room.widthM, y: room.heightM }, { x: 0, y: room.heightM }];
}

export function isValidFootprint(points: unknown, widthM: number, heightM: number): points is FootprintPoint[] {
  if (!Array.isArray(points) || points.length < 4 || points.length > 32) return false;
  const vertices = points as FootprintPoint[];
  if (vertices.some((p) => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y) ||
    p.x < 0 || p.x > widthM || p.y < 0 || p.y > heightM)) return false;
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i], b = vertices[(i + 1) % vertices.length];
    if (a.x === b.x && a.y === b.y) return false;
    if (a.x !== b.x && a.y !== b.y) return false;
  }
  for (let i = 0; i < vertices.length; i++) {
    const before = vertices[(i + vertices.length - 1) % vertices.length], point = vertices[i], after = vertices[(i + 1) % vertices.length];
    if ((before.x === point.x && point.x === after.x && (point.y - before.y) * (after.y - point.y) < 0) ||
      (before.y === point.y && point.y === after.y && (point.x - before.x) * (after.x - point.x) < 0)) return false;
  }
  const epsilon = 1e-8;
  if (Math.abs(Math.min(...vertices.map((point) => point.x))) > epsilon || Math.abs(Math.max(...vertices.map((point) => point.x)) - widthM) > epsilon ||
    Math.abs(Math.min(...vertices.map((point) => point.y))) > epsilon || Math.abs(Math.max(...vertices.map((point) => point.y)) - heightM) > epsilon) return false;
  if (polygonArea(vertices) < 0.25) return false;
  for (let i = 0; i < vertices.length; i++) for (let j = i + 1; j < vertices.length; j++) {
    if (j === i + 1 || (i === 0 && j === vertices.length - 1)) continue;
    if (segmentsIntersect(vertices[i], vertices[(i + 1) % vertices.length], vertices[j], vertices[(j + 1) % vertices.length])) return false;
  }
  return true;
}

export function simplifyFootprint(points: readonly FootprintPoint[]): FootprintPoint[] {
  const simplified = points.map((point) => ({ ...point }));
  let changed = true;
  while (changed && simplified.length > 1) {
    changed = false;
    for (let i = 0; i < simplified.length; i++) {
      const previous = simplified[(i + simplified.length - 1) % simplified.length];
      const point = simplified[i];
      const nextIndex = (i + 1) % simplified.length;
      const next = simplified[nextIndex];
      if ((point.x === next.x && point.y === next.y) ||
        (previous.x === point.x && previous.y === point.y)) {
        simplified.splice(point.x === next.x && point.y === next.y ? nextIndex : i, 1);
        changed = true;
        break;
      }
      const collinearForward =
        (previous.x === point.x && point.x === next.x && (point.y - previous.y) * (next.y - point.y) > 0) ||
        (previous.y === point.y && point.y === next.y && (point.x - previous.x) * (next.x - point.x) > 0);
      if (collinearForward) {
        simplified.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return simplified;
}

function segmentsIntersect(a: FootprintPoint, b: FootprintPoint, c: FootprintPoint, d: FootprintPoint): boolean {
  if (a.x === b.x && c.y === d.y) return a.x >= Math.min(c.x, d.x) && a.x <= Math.max(c.x, d.x) &&
    c.y >= Math.min(a.y, b.y) && c.y <= Math.max(a.y, b.y);
  if (a.y === b.y && c.x === d.x) return c.x >= Math.min(a.x, b.x) && c.x <= Math.max(a.x, b.x) &&
    a.y >= Math.min(c.y, d.y) && a.y <= Math.max(c.y, d.y);
  if (a.x === b.x && c.x === d.x && a.x === c.x) {
    return Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) >= Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y));
  }
  if (a.y === b.y && c.y === d.y && a.y === c.y) {
    return Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) >= Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x));
  }
  return false;
}

export function polygonArea(points: readonly FootprintPoint[]): number {
  let twiceArea = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    twiceArea += a.x * b.y - b.x * a.y;
  }
  return Math.abs(twiceArea) / 2;
}

export function footprintContains(room: FootprintRoom, x: number, y: number): boolean {
  const points = roomFootprint(room);
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[j], b = points[i];
    if (a.x === b.x && Math.abs(x - a.x) < 1e-9 && y >= Math.min(a.y, b.y) && y <= Math.max(a.y, b.y)) return true;
    if (a.y === b.y && Math.abs(y - a.y) < 1e-9 && x >= Math.min(a.x, b.x) && x <= Math.max(a.x, b.x)) return true;
    if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function footprintInteriorPoint(room: FootprintRoom): FootprintPoint {
  const rect = footprintRectangles(room).sort((a, b) => (b.x1 - b.x0) * (b.y1 - b.y0) - (a.x1 - a.x0) * (a.y1 - a.y0))[0];
  if (!rect) return { x: room.widthM / 2, y: room.heightM / 2 };
  return { x: (rect.x0 + rect.x1) / 2, y: (rect.y0 + rect.y1) / 2 };
}

export function nearestFootprintPoint(room: FootprintRoom, x: number, y: number): FootprintPoint {
  if (footprintContains(room, x, y)) return { x, y };
  const candidates = footprintRectangles(room).map((rect) => {
    const insetX = Math.min(1e-6, (rect.x1 - rect.x0) / 4), insetY = Math.min(1e-6, (rect.y1 - rect.y0) / 4);
    const px = Math.max(rect.x0 + insetX, Math.min(rect.x1 - insetX, x));
    const py = Math.max(rect.y0 + insetY, Math.min(rect.y1 - insetY, y));
    return { x: px, y: py, distance: (px - x) ** 2 + (py - y) ** 2 };
  }).sort((a, b) => a.distance - b.distance);
  return candidates[0] ?? footprintInteriorPoint(room);
}

export function footprintCellArea(room: FootprintRoom, x0: number, y0: number, x1: number, y1: number): number {
  if (x1 <= x0 || y1 <= y0) return 0;
  const points = roomFootprint(room);
  const breaks = [...new Set([x0, x1, ...points.map((p) => p.x).filter((x) => x > x0 && x < x1)])].sort((a, b) => a - b);
  let area = 0;
  for (let i = 1; i < breaks.length; i++) {
    const left = breaks[i - 1], right = breaks[i], x = (left + right) / 2;
    const crossings = points.flatMap((a, j) => {
      const b = points[(j + 1) % points.length];
      return a.y === b.y && x > Math.min(a.x, b.x) && x < Math.max(a.x, b.x) ? [a.y] : [];
    }).sort((a, b) => a - b);
    for (let j = 1; j < crossings.length; j += 2) {
      area += (right - left) * Math.max(0, Math.min(y1, crossings[j]) - Math.max(y0, crossings[j - 1]));
    }
  }
  return area;
}

export function footprintLineIntervals(room: FootprintRoom, axis: 0 | 1, coordinate: number): [number, number][] {
  const points = roomFootprint(room);
  const crossings = points.flatMap((a, i) => {
    const b = points[(i + 1) % points.length];
    if (axis === 0 && a.y === b.y && coordinate > Math.min(a.x, b.x) && coordinate < Math.max(a.x, b.x)) return [a.y];
    if (axis === 1 && a.x === b.x && coordinate > Math.min(a.y, b.y) && coordinate < Math.max(a.y, b.y)) return [a.x];
    return [];
  }).sort((a, b) => a - b);
  const intervals: [number, number][] = [];
  for (let i = 1; i < crossings.length; i += 2) intervals.push([crossings[i - 1], crossings[i]]);
  return intervals;
}

export function footprintRectangles(room: FootprintRoom): FootprintRectangle[] {
  const points = roomFootprint(room);
  const xs = [...new Set(points.map((p) => p.x))].sort((a, b) => a - b);
  const rectangles: FootprintRectangle[] = [];
  for (let i = 1; i < xs.length; i++) {
    const x0 = xs[i - 1], x1 = xs[i], x = (x0 + x1) / 2;
    const crossings = points.flatMap((a, j) => {
      const b = points[(j + 1) % points.length];
      return a.y === b.y && x > Math.min(a.x, b.x) && x < Math.max(a.x, b.x) ? [a.y] : [];
    }).sort((a, b) => a - b);
    for (let j = 1; j < crossings.length; j += 2) rectangles.push({ x0, x1, y0: crossings[j - 1], y1: crossings[j] });
  }
  return rectangles;
}

export function footprintWalls(room: FootprintRoom): FootprintWall[] {
  const points = roomFootprint(room);
  let signedArea = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    signedArea += a.x * b.y - b.x * a.y;
  }
  return points.map((start, index) => {
    const end = points[(index + 1) % points.length], dx = end.x - start.x, dy = end.y - start.y;
    const length = Math.hypot(dx, dy), orientation = signedArea >= 0 ? 1 : -1;
    const side = dy === 0 ? start.y === 0 ? 'top' : start.y === room.heightM ? 'bottom' : undefined
      : start.x === 0 ? 'left' : start.x === room.widthM ? 'right' : undefined;
    return { index, start, end, length, normal: [orientation * dy / length, -orientation * dx / length], side };
  });
}

import { getOpeningWallIndex, type RoomConfig, type WallSide } from './config';
import { getModel } from './model';
import { furnitureBoxes, unionRectangleArea } from './furniture';
import { footprintWalls, polygonArea, roomFootprint } from './footprint';

export interface VentilationEnvironment { outsideC: number; windMps: number; windDirectionDeg: number; orientationDeg?: number }
export interface VentilationFlow {
  side: WallSide; wallIndex: number; pos: number; z: number; area: number;
  /** Exact bounds for rasterizing an open strip; leakage paths remain points. */
  from?: number; to?: number; bottom?: number; top?: number;
  /** Positive is INTO the room. Constant reference density ensures volume and mass balance. */
  volumeM3s: number; inflow: boolean; leakage?: boolean;
}
export interface VentilationResult { flows: VentilationFlow[]; inflowM3s: number; outflowM3s: number; imbalance: number; pressurePa: number }
const CD = 0.62, G = 9.81;
/** Single-zone wind/stack pressure network. LeakageACH specifies envelope permeability at 4 Pa.
 * Openings are integrated in horizontal strips, allowing simultaneous low inflow/high outflow.
 * Direction angles are wind FROM azimuth, clockwise from the back-wall outward normal.
 */
export function solveVentilation(room: RoomConfig, insideC: number, env: VentilationEnvironment, rho = 1.2): VentilationResult {
  const model = getModel(room), orientation = env.orientationDeg ?? model.environment.orientationDeg;
  const walls = footprintWalls(room);
  const paths: { side: WallSide; wallIndex: number; pos: number; z: number; area: number; pressure: number; leakage: boolean; from?: number; to?: number; bottom?: number; top?: number }[] = [];
  const pressure = (wallIndex: number, z: number): number => {
    const wall = walls[wallIndex];
    const azimuth = (Math.atan2(wall.normal[0], -wall.normal[1]) * 180 / Math.PI + 360) % 360;
    const c = Math.cos((env.windDirectionDeg - azimuth - orientation) * Math.PI / 180);
    const cp = c > 0 ? 0.6 * c * c : -0.3 * c * c;
    return 0.5 * rho * env.windMps ** 2 * cp - rho * G * (insideC - env.outsideC) / Math.max(150, insideC + 273.15) * (z - room.ceilingM / 2);
  };
  const furniture = room.furniture.flatMap(furnitureBoxes);
  const freeArea = (wallIndex: number, from: number, to: number, bottom: number, top: number) => {
    const wall = walls[wallIndex], axis = wall.start.x === wall.end.x ? 0 : 1, along = 1 - axis;
    const plane = axis === 0 ? wall.start.x : wall.start.y;
    const coord = along === 0 ? 'x' : 'y';
    const a = wall.start[coord] + (wall.end[coord] - wall.start[coord]) * from / wall.length;
    const b = wall.start[coord] + (wall.end[coord] - wall.start[coord]) * to / wall.length;
    const lo = Math.min(a, b), hi = Math.max(a, b);
    const rectangles = furniture.filter(b => b.min[axis] <= plane + 1e-10 && b.max[axis] >= plane - 1e-10)
      .map(box => [Math.max(lo, box.min[along]), Math.min(hi, box.max[along]), Math.max(bottom, box.min[2]), Math.min(top, box.max[2])] as const);
    return Math.max(0, (hi - lo) * (top - bottom) - unionRectangleArea(rectangles));
  };
  for (const wall of walls) {
    const side = wall.side ?? 'top';
    const openings = room.openings.filter((o) => getOpeningWallIndex(room, o) === wall.index);
    const length = wall.length;
    const xs = [...new Set([0, length, ...openings.flatMap((o) => [Math.max(0, o.pos - o.length / 2), Math.min(length, o.pos + o.length / 2)])])].sort((a, b) => a - b);
    const zs = [...new Set([0, room.ceilingM, ...openings.flatMap((o) => [Math.max(0, o.sillM), Math.min(room.ceilingM, o.sillM + o.heightM)])])].sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) for (let k = 1; k < zs.length; k++) {
      const x = (xs[i] + xs[i - 1]) / 2, z = (zs[k] + zs[k - 1]) / 2;
      const opening = openings.findLast((o) => Math.abs(x - o.pos) < o.length / 2 && z > o.sillM && z < o.sillM + o.heightM);
      if (!opening?.open) continue;
      const count = Math.max(16, Math.ceil((zs[k] - zs[k - 1]) / 0.05));
      for (let s = 0; s < count; s++) {
        const height = (zs[k] - zs[k - 1]) / count, zc = zs[k - 1] + (s + 0.5) * height;
        const area = freeArea(wall.index, xs[i - 1], xs[i], zc - height / 2, zc + height / 2);
        if (area <= 1e-12) continue;
        paths.push({ side, wallIndex: wall.index, pos: x, z: zc, area, pressure: pressure(wall.index, zc), leakage: false, from: xs[i - 1], to: xs[i], bottom: zc - height / 2, top: zc + height / 2 });
      }
    }
  }
  if (model.leakageACH > 0) {
    const q4 = model.leakageACH * polygonArea(roomFootprint(room)) * room.ceilingM / 3600;
    // Uniformly distributed lower/upper envelope cracks; no imposed air change rate.
    const totalArea = q4 / (CD * Math.sqrt(2 * 4 / rho));
    const perimeter = walls.reduce((sum, wall) => sum + wall.length, 0);
    for (const wall of walls) for (const f of [0.2, 0.8]) {
      const z = f * room.ceilingM, area = totalArea * wall.length / Math.max(1e-9, perimeter) / 2;
      paths.push({ side: wall.side ?? 'top', wallIndex: wall.index, pos: wall.length / 2, z, area, pressure: pressure(wall.index, z), leakage: true });
    }
  }
  if (!paths.length) return { flows: [], inflowM3s: 0, outflowM3s: 0, imbalance: 0, pressurePa: 0 };
  const flow = (area: number, delta: number): number => CD * area * Math.sign(delta) * Math.sqrt(2 * Math.abs(delta) / rho);
  let lo = Math.min(...paths.map((p) => p.pressure)), hi = Math.max(...paths.map((p) => p.pressure));
  for (let i = 0; i < 100 && hi - lo > 1e-13; i++) {
    const mid = (lo + hi) / 2, net = paths.reduce((q, p) => q + flow(p.area, p.pressure - mid), 0);
    if (net > 0) lo = mid; else hi = mid;
  }
  const pressurePa = (lo + hi) / 2;
  const flows = paths.map((p): VentilationFlow => { const volumeM3s = flow(p.area, p.pressure - pressurePa); return { side: p.side, wallIndex: p.wallIndex, pos: p.pos, z: p.z, area: p.area, volumeM3s, inflow: volumeM3s > 0, leakage: p.leakage, ...(p.leakage ? {} : { from: p.from, to: p.to, bottom: p.bottom, top: p.top }) }; });
  const inflowM3s = flows.reduce((q, p) => q + Math.max(0, p.volumeM3s), 0), outflowM3s = flows.reduce((q, p) => q + Math.max(0, -p.volumeM3s), 0);
  return { flows, inflowM3s, outflowM3s, imbalance: inflowM3s - outflowM3s, pressurePa };
}

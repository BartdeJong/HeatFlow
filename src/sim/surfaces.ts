import { getOpeningWallIndex, wallRegions, type RoomConfig } from './config';
import { floorLayers, roofLayers, wallLayers, getEmitter, type ThermalLayer } from './model';
import { furnitureBoxes, physicalFurniture, type Point3 } from './furniture';
import { LayerColumn } from './thermal';
import type { RadiationPatch } from './radiation';
import { footprintRectangles, footprintWalls } from './footprint';
export type SurfaceKind = 'wallsW' | 'roofW' | 'floorW' | 'openingsW' | 'furniture' | 'emitter' | 'aperture';
export interface Surface extends RadiationPatch {
  id: string; label: string; kind: SurfaceKind; min: Point3; max: Point3;
  column?: LayerColumn; item?: number; source?: number;
}
/** Coarse surface patches are independent of the air mesh. Layers run inside → outside. */
export function buildSurfaces(room: RoomConfig, initialC: number): Surface[] {
  const result: Surface[] = [];
  function rectangle(id: string, label: string, kind: SurfaceKind, min: Point3, max: Point3, normal: Point3, layers?: ThermalLayer[], item?: number, source?: number, emissivity = .9) {
    const axis = normal.findIndex(n => n !== 0), other = [0, 1, 2].filter(a => a !== axis);
    const a = other[0], b = other[1], da = max[a] - min[a], db = max[b] - min[b];
    if (da * db < 1e-10) return;
    const center = min.map((n, k) => (n + max[k]) / 2) as Point3;
    const tangentU: Point3 = [0, 0, 0], tangentV: Point3 = [0, 0, 0]; tangentU[a] = da / 2; tangentV[b] = db / 2;
    result.push({ id, label, kind, min, max, center, normal, tangentU, tangentV, area: da * db, emissivity, solarTransparent: kind === 'aperture',
      column: layers ? new LayerColumn(da * db, layers, initialC) : undefined, item, source });
  }
  for (const wall of footprintWalls(room)) {
    const dx = wall.end.x - wall.start.x, dy = wall.end.y - wall.start.y;
    let index = 0;
    for (const region of wallRegions(room, wall.index)) {
      const opening = room.openings.findLast(o => getOpeningWallIndex(room, o) === wall.index && Math.abs((region.from + region.to) / 2 - o.pos) < o.length / 2 &&
        (region.bottom + region.top) / 2 > o.sillM && (region.bottom + region.top) / 2 < o.sillM + o.heightM);
      const kind: SurfaceKind = opening?.open ? 'aperture' : opening ? 'openingsW' : 'wallsW';
      const construction = opening ? [{ label: opening.kind, thicknessM: .012, k: .012 / Math.max(.05, 1 / (opening.kind === 'window' ? 1.4 : 2) - .17), density: 2500, cp: 750 }] : wallLayers(room);
      const na = Math.ceil((region.to - region.from) / 1.5), nz = Math.ceil((region.top - region.bottom) / 1.5);
      for (let j = 0; j < nz; j++) for (let i = 0; i < na; i++) {
        const from = region.from + i / na * (region.to - region.from), to = region.from + (i + 1) / na * (region.to - region.from);
        const ax = wall.start.x + dx * from / wall.length, ay = wall.start.y + dy * from / wall.length;
        const bx = wall.start.x + dx * to / wall.length, by = wall.start.y + dy * to / wall.length;
        const min: Point3 = [Math.min(ax, bx), Math.min(ay, by), region.bottom + j / nz * (region.top - region.bottom)];
        const max: Point3 = [Math.max(ax, bx), Math.max(ay, by), region.bottom + (j + 1) / nz * (region.top - region.bottom)];
        rectangle(`wall${wall.index}:${index++}`, `${opening?.kind ?? `Wall ${wall.index + 1}`} ${index}`, kind, min, max, [-wall.normal[0], -wall.normal[1], 0], opening?.open ? undefined : construction);
      }
    }
  }
  for (const floor of [true, false]) {
    const z = floor ? 0 : room.ceilingM;
    let index = 0;
    for (const footprint of footprintRectangles(room)) {
      const nx = Math.max(1, Math.ceil((footprint.x1 - footprint.x0) / 1.5));
      const ny = Math.max(1, Math.ceil((footprint.y1 - footprint.y0) / 1.5));
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        rectangle(`${floor ? 'floor' : 'ceiling'}:${index++}`, floor ? 'Floor' : 'Ceiling', floor ? 'floorW' : 'roofW',
          [footprint.x0 + i / nx * (footprint.x1 - footprint.x0), footprint.y0 + j / ny * (footprint.y1 - footprint.y0), z],
          [footprint.x0 + (i + 1) / nx * (footprint.x1 - footprint.x0), footprint.y0 + (j + 1) / ny * (footprint.y1 - footprint.y0), z],
          [0, 0, floor ? 1 : -1], floor ? floorLayers(room) : roofLayers(room));
      }
    }
  }
  // Partition part faces at all intersections and discard hidden/internal rectangles.
  physicalFurniture(room).forEach((f, item) => {
    const boxes = furnitureBoxes(f);
    boxes.forEach((box, part) => { for (let axis = 0; axis < 3; axis++) for (const sign of [-1, 1]) {
      const other = [0, 1, 2].filter(a => a !== axis), a = other[0], b = other[1], plane = sign < 0 ? box.min[axis] : box.max[axis];
      const breaks = (d: number) => [...new Set([box.min[d], box.max[d], ...boxes.flatMap(q => [q.min[d], q.max[d]]).filter(v => v > box.min[d] && v < box.max[d])])].sort((x, y) => x - y);
      const aa = breaks(a), bb = breaks(b);
      for (let j = 1; j < bb.length; j++) for (let i = 1; i < aa.length; i++) {
        const min: Point3 = [0, 0, 0], max: Point3 = [0, 0, 0], normal: Point3 = [0, 0, 0]; normal[axis] = sign;
        min[axis] = max[axis] = plane; min[a] = aa[i - 1]; max[a] = aa[i]; min[b] = bb[j - 1]; max[b] = bb[j];
        const p = min.map((v, d) => (v + max[d]) / 2 + normal[d] * 1e-7);
        if (boxes.some(q => p.every((v, d) => v > q.min[d] && v < q.max[d]))) continue;
        // Ground-contact faces have no room-facing radiation/convection.
        if (axis === 2 && sign < 0 && plane === 0) continue;
        rectangle(`f${f.id}:${part}:${axis}:${sign}:${i}:${j}`, f.kind === 'wall' ? 'Interior wall' : `${f.kind} ${f.id}`,
          'furniture', min, max, normal, undefined, item, undefined, f.material === 'metal' ? .3 : .9);
      }
    } });
  });
  room.sources.forEach((s, source) => {
    const e = getEmitter(s); if (e.kind === 'ideal' || s.kind === 'cold' || s.kind === 'fan') return;
    const size = [e.widthM, e.depthM, e.heightM];
    for (let axis = 0; axis < 3; axis++) for (const sign of [-1, 1]) {
      const min = [s.x, s.y, s.z].map((n, d) => Math.max(0, n - size[d] / 2)) as Point3;
      const max = [s.x, s.y, s.z].map((n, d) => Math.min([room.widthM, room.heightM, room.ceilingM][d], n + size[d] / 2)) as Point3;
      const normal: Point3 = [0, 0, 0]; normal[axis] = sign; min[axis] = max[axis] = sign < 0 ? min[axis] : max[axis];
      rectangle(`s${s.id}:${axis}:${sign}`, `${e.kind} ${s.id}`, 'emitter', min, max, normal, undefined, undefined, source, e.emissivity);
    }
  });
  return result;
}

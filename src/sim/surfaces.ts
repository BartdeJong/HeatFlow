import { wallRegions, type RoomConfig } from './config';
import { floorLayers, roofLayers, wallLayers, getEmitter, type ThermalLayer } from './model';
import { furnitureBoxes, type Point3 } from './furniture';
import { LayerColumn } from './thermal';
import type { RadiationPatch } from './radiation';
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
  for (const side of ['top', 'bottom', 'left', 'right'] as const) {
    const horizontal = side === 'top' || side === 'bottom';
    const axis = horizontal ? 1 : 0, along = horizontal ? 0 : 1;
    const coordinate = side === 'top' || side === 'left' ? 0 : horizontal ? room.heightM : room.widthM;
    const normal: Point3 = [0, 0, 0]; normal[axis] = coordinate === 0 ? 1 : -1;
    let index = 0;
    for (const region of wallRegions(room, side)) {
      const opening = room.openings.findLast(o => o.side === side && Math.abs((region.from + region.to) / 2 - o.pos) < o.length / 2 &&
        (region.bottom + region.top) / 2 > o.sillM && (region.bottom + region.top) / 2 < o.sillM + o.heightM);
      const kind: SurfaceKind = opening?.open ? 'aperture' : opening ? 'openingsW' : 'wallsW';
      const construction = opening ? [{ label: opening.kind, thicknessM: .012, k: .012 / Math.max(.05, 1 / (opening.kind === 'window' ? 1.4 : 2) - .17), density: 2500, cp: 750 }] : wallLayers(room);
      const na = Math.ceil((region.to - region.from) / 1.5), nz = Math.ceil((region.top - region.bottom) / 1.5);
      for (let j = 0; j < nz; j++) for (let i = 0; i < na; i++) {
        const min: Point3 = [0, 0, 0], max: Point3 = [0, 0, 0]; min[axis] = max[axis] = coordinate;
        min[along] = region.from + i / na * (region.to - region.from); max[along] = region.from + (i + 1) / na * (region.to - region.from);
        min[2] = region.bottom + j / nz * (region.top - region.bottom); max[2] = region.bottom + (j + 1) / nz * (region.top - region.bottom);
        rectangle(`${side}:${index++}`, `${opening?.kind ?? side} ${index}`, kind, min, max, normal, opening?.open ? undefined : construction);
      }
    }
  }
  for (const floor of [true, false]) for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
    const z = floor ? 0 : room.ceilingM;
    rectangle(`${floor ? 'floor' : 'ceiling'}:${j * 4 + i}`, floor ? 'Floor' : 'Ceiling', floor ? 'floorW' : 'roofW',
      [i / 4 * room.widthM, j / 4 * room.heightM, z], [(i + 1) / 4 * room.widthM, (j + 1) / 4 * room.heightM, z],
      [0, 0, floor ? 1 : -1], floor ? floorLayers(room) : roofLayers(room));
  }
  // Partition part faces at all intersections and discard hidden/internal rectangles.
  room.furniture.forEach((f, item) => {
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
        rectangle(`f${f.id}:${part}:${axis}:${sign}:${i}:${j}`, `${f.kind} ${f.id}`, 'furniture', min, max, normal, undefined, item, undefined, f.material === 'metal' ? .3 : .9);
      }
    } });
  });
  room.sources.forEach((s, source) => {
    const e = getEmitter(s); if (e.kind === 'ideal' || s.kind === 'cold') return;
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

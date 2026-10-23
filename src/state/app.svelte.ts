import {
  DEFAULT_ROOM,
  FURNITURE_PRESETS,
  LIMITS,
  nextId,
  sanitizeRoom,
  type HeatSource,
  type InteriorWall,
  type Furniture,
  type FurnitureKind,
  type Opening,
  type OpeningKind,
  type RoofConfig,
  type RoomConfig,
  type SourceKind,
  type ThermostatConfig,
  type WallConfig,
} from '../sim/config';
import { footprintCellArea, footprintInteriorPoint, isValidFootprint, nearestFootprintPoint, type FootprintPoint, footprintWalls } from '../sim/footprint';
import { Recorder } from '../sim/recorder';
import { roomFromHash } from '../persist/share';
import type { PaletteId } from '../render/palette';
import { TEMPERATURE_MIN_C, TEMPERATURE_MAX_C } from '../render/temperature-scale';
import { furnitureExtent, furnitureOverlap } from '../sim/furniture';
import { getModel, emitterPreset, type ModelConfig } from '../sim/model';
import { applyInsulationLevel, type InsulationLevel } from '../sim/insulation';
import { interiorWallBounds, interiorWallPlacementError } from '../sim/interior-walls';

export const SPEEDS = [1, 10, 30, 100, 300, 1000] as const;

export type Selection = { kind: 'source' | 'probe' | 'opening' | 'furniture'; id: number } | null;

function initialRoom(): RoomConfig {
  return roomFromHash(location.hash) ?? structuredClone(DEFAULT_ROOM);
}

export const app = $state({
  focusView: true,
  room: initialRoom(),
  running: true,
  speed: 300 as number,
  palette: 'heat' as PaletteId,
  showTemperatureGradient: false,
  gradientOpacity: 1,
  exterior: false,
  showVectors: false,
  view: 'volume' as 'volume' | 'slice',
  showAirflow: true,
  showFps: false,
  sliceAxis: 'z' as 'x' | 'y' | 'z',
  sliceFraction: 0.5,
  cameraToken: 0,
  selection: null as Selection,
  /** Incremented to request a simulation reset. */
  resetToken: 0,
  /** Incremented whenever the recorder gains a sample, so graphs can redraw. */
  graphTick: 0,
  furnitureTemperatures: {} as Record<number, number>,
  placementMessage: '',
  stats: { elapsed: 0, min: 20, max: 20, mean: 20, tMin: TEMPERATURE_MIN_C, tMax: TEMPERATURE_MAX_C, renderFPS: 0, achievedSpeed: 0, diagnostics: { storedEnergyJ: 0, energyBalanceJ: 0, relativeEnergyError: 0, sensorC: 20, ventilationACH: 0, pressureResidual: 0, maxDivergence: 0, iterations: 0, failure: null as string | null, solarW: 0, outsideC: 0, netExternalJ: 0, surfaceTemperatures: [] as { id: string; label: string; temperatureC: number }[] }, heatingKWh: 0, coolingKWh: 0, thermostatHeating: true,
    heatLoss: { roofW: 0, wallsW: 0, floorW: 0, openingsW: 0, ventilationW: 0, totalW: 0 } },
});

/** Temperature history for the graph; lives outside reactive state because it changes constantly. */
export const recorder = new Recorder();

function edit(fn: (room: RoomConfig) => void): void {
  const room = $state.snapshot(app.room) as RoomConfig;
  fn(room);
  app.room = sanitizeRoom(room);
}

export function updateRoom(
  patch: Partial<Pick<RoomConfig, 'widthM' | 'heightM' | 'ceilingM' | 'outsideC' | 'convection' | 'heatingMode'>>,
): void {
  edit((r) => {
    const scaleX = patch.widthM === undefined ? 1 : patch.widthM / r.widthM;
    const scaleY = patch.heightM === undefined ? 1 : patch.heightM / r.heightM;
    Object.assign(r, patch);
    if (r.footprint && (scaleX !== 1 || scaleY !== 1)) {
      r.footprint = r.footprint.map((point) => ({ x: point.x * scaleX, y: point.y * scaleY }));
    }
  });
}

export interface FootprintUpdateOptions {
  widthM: number;
  heightM: number;
  translation: FootprintPoint;
  openingAnchors?: Record<number, { wallIndex: number; pos: number }>;
}

export function updateFootprint(footprint: FootprintPoint[], options?: FootprintUpdateOptions): boolean {
  const original = $state.snapshot(app.room) as RoomConfig;
  const widthM = options?.widthM ?? original.widthM;
  const heightM = options?.heightM ?? original.heightM;
  const translation = options?.translation ?? { x: 0, y: 0 };
  if (widthM < LIMITS.size.min || widthM > LIMITS.size.max || heightM < LIMITS.size.min || heightM > LIMITS.size.max ||
    !isValidFootprint(footprint, widthM, heightM)) {
    app.placementMessage = 'The room outline must stay within the allowed room size and use valid 90° walls.';
    return false;
  }
  const move = (point: FootprintPoint): FootprintPoint => ({ x: point.x + translation.x, y: point.y + translation.y });
  const shiftedInteriorWalls = (original.interiorWalls ?? []).map((wall) => ({
    ...wall, start: move(wall.start), end: move(wall.end),
  }));
  const outsideFurniture = original.furniture.map((item) => ({
    ...item, x: item.x + translation.x, y: item.y + translation.y,
  })).some((item) => {
    const [width, depth] = furnitureExtent(item);
    const x0 = item.x - width / 2, y0 = item.y - depth / 2;
    const x1 = item.x + width / 2, y1 = item.y + depth / 2;
    return x0 < 0 || y0 < 0 || x1 > widthM || y1 > heightM ||
      footprintCellArea({ widthM, heightM, footprint }, x0, y0, x1, y1) < width * depth - 1e-8;
  });
  if (outsideFurniture) {
    app.placementMessage = 'Move or remove furniture that would fall outside the new floorplan.';
    return false;
  }
  const wallOutside = shiftedInteriorWalls.some((wall) => {
    const bounds = interiorWallBounds(wall);
    const area = (bounds.x1 - bounds.x0) * (bounds.y1 - bounds.y0);
    return bounds.x0 < 0 || bounds.y0 < 0 || bounds.x1 > widthM || bounds.y1 > heightM ||
      footprintCellArea({ widthM, heightM, footprint }, bounds.x0, bounds.y0, bounds.x1, bounds.y1) < area - 1e-8;
  });
  if (wallOutside) {
    app.placementMessage = 'Move or remove interior walls that would fall outside the new floorplan.';
    return false;
  }
  const openings = original.openings.map((opening) => ({
    ...opening,
    ...(options?.openingAnchors?.[opening.id] === undefined
      ? {}
      : options.openingAnchors[opening.id]),
  }));
  const room = sanitizeRoom({
    ...original,
    widthM,
    heightM,
    footprint: footprint.map((point) => ({ ...point })),
    sources: original.sources.map((source) => ({ ...source, x: source.x + translation.x, y: source.y + translation.y })),
    probes: original.probes.map((probe) => ({ ...probe, x: probe.x + translation.x, y: probe.y + translation.y })),
    furniture: original.furniture.map((item) => ({ ...item, x: item.x + translation.x, y: item.y + translation.y })),
    interiorWalls: shiftedInteriorWalls,
    openings,
    thermostat: {
      ...original.thermostat,
      ...(original.thermostat.sensor ? { sensor: { ...original.thermostat.sensor,
        x: original.thermostat.sensor.x + translation.x, y: original.thermostat.sensor.y + translation.y } } : {}),
    },
  });
  if ((room.interiorWalls?.length ?? 0) !== shiftedInteriorWalls.length) {
    app.placementMessage = 'Move or remove interior walls that would fall outside the new floorplan.';
    return false;
  }
  app.placementMessage = '';
  app.room = room;
  return true;
}

export function updateModel(patch: Partial<ModelConfig>): void {
  const oldQuality = getModel(app.room).quality;
  edit((r) => { r.model = { ...getModel(r), ...patch }; });
  if (getModel(app.room).quality !== oldQuality) app.resetToken++;
}

export function furnitureWarnings(room: RoomConfig): string[] {
  const warnings: string[] = [];
  for (let i = 0; i < room.furniture.length; i++) for (let j = i + 1; j < room.furniture.length; j++) {
    if (furnitureOverlap(room.furniture[i], room.furniture[j])) warnings.push(`Furniture ${room.furniture[i].id} overlaps furniture ${room.furniture[j].id}. Move or remove one item.`);
  }
  return warnings;
}

export function updateWall(patch: Partial<WallConfig>): void {
  edit((r) => Object.assign(r.wall, patch));
}

export function updateRoof(patch: Partial<RoofConfig>): void {
  edit((r) => Object.assign(r.roof, patch));
}

export function updateInsulationLevel(level: InsulationLevel): void {
  edit((room) => Object.assign(room, applyInsulationLevel(room, level)));
}

export function updateThermostat(patch: Partial<ThermostatConfig>): void {
  edit((r) => Object.assign(r.thermostat, patch));
}

export function addInteriorWall(start: FootprintPoint, end: FootprintPoint): number | null {
  if ((app.room.interiorWalls?.length ?? 0) >= LIMITS.interiorWalls) {
    app.placementMessage = 'The room already has the maximum number of interior walls.';
    return null;
  }
  const wall: InteriorWall = { id: nextId(app.room.interiorWalls ?? []), start, end, thicknessM: 0.1 };
  const error = interiorWallPlacementError(app.room, wall);
  if (error) {
    app.placementMessage = error;
    return null;
  }
  edit((room) => { room.interiorWalls = [...(room.interiorWalls ?? []), wall]; });
  app.placementMessage = '';
  return wall.id;
}

export function updateInteriorWall(id: number, patch: Partial<Pick<InteriorWall, 'start' | 'end' | 'thicknessM'>>): boolean {
  const current = app.room.interiorWalls?.find((wall) => wall.id === id);
  if (!current) return false;
  const candidate = { ...current, ...patch };
  const error = interiorWallPlacementError(app.room, candidate, id);
  if (error) {
    app.placementMessage = error;
    return false;
  }
  edit((room) => {
    const wall = room.interiorWalls?.find((item) => item.id === id);
    if (wall) Object.assign(wall, patch);
  });
  app.placementMessage = '';
  return true;
}

export function removeInteriorWall(id: number): void {
  edit((room) => { room.interiorWalls = (room.interiorWalls ?? []).filter((wall) => wall.id !== id); });
  app.placementMessage = '';
}

export function setRoom(room: RoomConfig): void {
  app.room = sanitizeRoom(room);
  app.selection = null;
  app.placementMessage = furnitureWarnings(app.room).join(' ');
  app.resetToken++;
}

export function resetSimulation(): void {
  app.resetToken++;
}

export function select(sel: Selection): void {
  app.selection = sel;
}

const SPOTS = [
  [0.5, 0.5],
  [0.25, 0.3],
  [0.75, 0.7],
  [0.25, 0.7],
  [0.75, 0.3],
  [0.5, 0.2],
  [0.5, 0.8],
  [0.15, 0.5],
];

export function addSource(kind: SourceKind): void {
  if (app.room.sources.length >= LIMITS.sources) return;
  if (kind === 'fan' && app.room.sources.some((s) => s.kind === 'fan')) return;
  const id = nextId(app.room.sources);
  const [fx, fy] = SPOTS[(id - 1) % SPOTS.length];
  edit((r) => {
    const location = kind === 'fan' ? footprintInteriorPoint(r) : nearestFootprintPoint(r, r.widthM * fx, r.heightM * fy);
    r.sources.push({
      id,
      kind,
      x: location.x,
      y: location.y,
      z: kind === 'heat' ? 0.4 : kind === 'fan' ? r.ceilingM - 0.12 : Math.max(0.4, r.ceilingM - 0.5),
      powerKW: kind === 'heat' ? 1.5 : kind === 'cold' ? 1 : 0,
      ...(kind === 'fan' ? { fanEnabled: true, fanSpeedMps: 1.2, fanDiameterM: 1.2 } : {}),
      ...(kind === 'heat' ? { emitter: emitterPreset('radiator') } : {}),
    });
  });
  app.selection = { kind: 'source', id };
}

export function updateSource(id: number, patch: Partial<Omit<HeatSource, 'id'>>): void {
  edit((r) => {
    const s = r.sources.find((x) => x.id === id);
    if (s) {
      Object.assign(s, patch);
      const location = nearestFootprintPoint(r, s.x, s.y);
      s.x = location.x; s.y = location.y;
    }
  });
}

export function removeSource(id: number): void {
  edit((r) => {
    r.sources = r.sources.filter((s) => s.id !== id);
  });
  if (app.selection?.kind === 'source' && app.selection.id === id) app.selection = null;
}

export function addOpening(kind: OpeningKind): void {
  if (app.room.openings.length >= LIMITS.openings) return;
  const id = nextId(app.room.openings);
  const wall = [...footprintWalls(app.room)].sort((a, b) => b.length - a.length)[0];
  edit((r) => {
    r.openings.push({
      id,
      kind,
      side: wall.side ?? 'top',
      wallIndex: wall.index,
      pos: wall.length / 2,
      length: kind === 'window' ? 1.2 : 0.9,
      heightM: kind === 'window' ? 1.2 : 2.1,
      sillM: kind === 'window' ? 0.8 : 0,
      open: false,
    });
  });
  app.selection = { kind: 'opening', id };
}

export function updateOpening(id: number, patch: Partial<Omit<Opening, 'id'>>): void {
  edit((r) => {
    const o = r.openings.find((x) => x.id === id);
    if (o) Object.assign(o, patch);
  });
}

export function removeOpening(id: number): void {
  edit((r) => {
    r.openings = r.openings.filter((o) => o.id !== id);
  });
  if (app.selection?.kind === 'opening' && app.selection.id === id) app.selection = null;
}

export function addProbe(): void {
  if (app.room.probes.length >= LIMITS.probes) return;
  const id = nextId(app.room.probes);
  edit((r) => {
    const location = nearestFootprintPoint(r, r.widthM * (0.2 + 0.25 * (id - 1)), r.heightM * 0.25);
    r.probes.push({ id, x: location.x, y: location.y, z: r.ceilingM / 2 });
  });
  app.selection = { kind: 'probe', id };
}

export function removeProbe(id: number): void {
  edit((r) => {
    r.probes = r.probes.filter((p) => p.id !== id);
  });
  if (app.selection?.kind === 'probe' && app.selection.id === id) app.selection = null;
}

export function addFurniture(kind: FurnitureKind): void {
  if (app.room.furniture.length >= LIMITS.furniture) return;
  const preset = FURNITURE_PRESETS.find((p) => p.id === kind)!;
  const id = nextId(app.room.furniture);
  edit((r) => {
    const widthM = Math.min(preset.widthM, r.widthM), depthM = Math.min(preset.depthM, r.heightM);
    let x = r.widthM / 2, y = depthM / 2, foundPosition = false;
    for (const fy of [0.1, 0.9, 0.5, 0.3, 0.7]) {
      let found = false;
      for (const fx of [0.1, 0.9, 0.5, 0.3, 0.7]) {
        const cx = widthM / 2 + (r.widthM - widthM) * fx;
        const cy = depthM / 2 + (r.heightM - depthM) * fy;
        const outsideRoom = footprintCellArea(r, cx - widthM / 2, cy - depthM / 2, cx + widthM / 2, cy + depthM / 2) < widthM * depthM - 1e-8;
        const occupied = outsideRoom || r.furniture.some((f) => {
          const [w, d] = furnitureExtent(f);
          return Math.abs(cx - f.x) < (widthM + w) / 2 + 0.1 && Math.abs(cy - f.y) < (depthM + d) / 2 + 0.1;
        }) || r.sources.some((s) => s.kind !== 'fan' && s.z < preset.heightM && Math.abs(cx - s.x) < widthM / 2 + 0.3 && Math.abs(cy - s.y) < depthM / 2 + 0.3);
        if (!occupied) { x = cx; y = cy; found = true; foundPosition = true; break; }
      }
      if (found) break;
    }
    const candidate: Furniture = { id, kind, material: preset.material, x, y, widthM, depthM, heightM: preset.heightM, rotation: 0 };
    if (!foundPosition || r.furniture.some((f) => furnitureOverlap(f, candidate))) {
      app.placementMessage = 'No space for this furniture. Move an item or choose a smaller size.';
      return;
    }
    app.placementMessage = '';
    r.furniture.push(candidate);
  });
  if (app.room.furniture.some((f) => f.id === id)) select({ kind: 'furniture', id });
}

export function updateFurniture(id: number, patch: Partial<Omit<Furniture, 'id'>>): void {
  const room = sanitizeRoom({ ...$state.snapshot(app.room), furniture: app.room.furniture.map((f) => f.id === id ? { ...f, ...patch } : f) });
  const candidate = room.furniture.find((f) => f.id === id);
  if (candidate) {
    const [width, depth] = furnitureExtent(candidate);
    if (footprintCellArea(room, candidate.x - width / 2, candidate.y - depth / 2,
      candidate.x + width / 2, candidate.y + depth / 2) < width * depth - 1e-8) {
      app.placementMessage = 'Furniture must remain inside the floorplan.';
      return;
    }
  }
  if (candidate && room.furniture.some((f) => f.id !== id && furnitureOverlap(f, candidate))) {
    app.placementMessage = 'Furniture cannot overlap. Choose a free position or smaller dimensions.';
    return;
  }
  app.placementMessage = furnitureWarnings(room).join(' ');
  app.room = room;
}

export function removeFurniture(id: number): void {
  edit((r) => { r.furniture = r.furniture.filter((f) => f.id !== id); });
  app.placementMessage = furnitureWarnings(app.room).join(' ');
  if (app.selection?.kind === 'furniture' && app.selection.id === id) select(null);
}

/** Move a source, probe, or piece of furniture to a position in metres. */
export function moveItem(kind: 'source' | 'probe' | 'furniture', id: number, x: number, y: number, z?: number): void {
  if (kind === 'furniture') { updateFurniture(id, { x, y }); return; }
  edit((r) => {
    const item = (kind === 'source' ? r.sources : r.probes).find((i) => i.id === id);
    if (item) {
      const location = nearestFootprintPoint(r, x, y);
      Object.assign(item, {
      x: location.x, y: location.y,
      ...(z === undefined ? {} : { z: kind === 'source' && 'kind' in item && item.kind === 'fan' ? r.ceilingM - 0.12 : z }),
    });
    }
  });
  if (kind === 'probe') {
    recorder.clearSeries(`p${id}`);
    app.graphTick++;
  }
}

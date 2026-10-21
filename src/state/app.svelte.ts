import {
  DEFAULT_ROOM,
  FURNITURE_PRESETS,
  LIMITS,
  nextId,
  sanitizeRoom,
  type HeatSource,
  type Furniture,
  type FurnitureKind,
  type Opening,
  type OpeningKind,
  type RoomConfig,
  type SourceKind,
  type WallConfig,
} from '../sim/config';
import { Recorder } from '../sim/recorder';
import { roomFromHash } from '../persist/share';
import type { PaletteId } from '../render/palette';
import { furnitureExtent } from '../sim/furniture';

export const SPEEDS = [1, 10, 30, 100, 300, 1000] as const;

export type Selection = { kind: 'source' | 'probe' | 'opening' | 'furniture'; id: number } | null;

function initialRoom(): RoomConfig {
  return roomFromHash(location.hash) ?? structuredClone(DEFAULT_ROOM);
}

export const app = $state({
  room: initialRoom(),
  running: true,
  speed: 300 as number,
  palette: 'heat' as PaletteId,
  view: 'volume' as 'volume' | 'slice',
  showAirflow: true,
  sliceAxis: 'z' as 'x' | 'y' | 'z',
  sliceFraction: 0.5,
  cameraToken: 0,
  selection: null as Selection,
  /** Incremented to request a simulation reset. */
  resetToken: 0,
  /** Incremented whenever the recorder gains a sample, so graphs can redraw. */
  graphTick: 0,
  furnitureTemperatures: {} as Record<number, number>,
  stats: { elapsed: 0, min: 20, max: 20, mean: 20, tMin: 0, tMax: 30 },
});

/** Temperature history for the graph; lives outside reactive state because it changes constantly. */
export const recorder = new Recorder();

function edit(fn: (room: RoomConfig) => void): void {
  const room = $state.snapshot(app.room) as RoomConfig;
  fn(room);
  app.room = sanitizeRoom(room);
}

export function updateRoom(
  patch: Partial<Pick<RoomConfig, 'widthM' | 'heightM' | 'ceilingM' | 'outsideC' | 'convection'>>,
): void {
  edit((r) => Object.assign(r, patch));
}

export function updateWall(patch: Partial<WallConfig>): void {
  edit((r) => Object.assign(r.wall, patch));
}

export function setRoom(room: RoomConfig): void {
  app.room = sanitizeRoom(room);
  app.selection = null;
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
  const id = nextId(app.room.sources);
  const [fx, fy] = SPOTS[(id - 1) % SPOTS.length];
  edit((r) => {
    r.sources.push({
      id,
      kind,
      x: r.widthM * fx,
      y: r.heightM * fy,
      z: kind === 'heat' ? 0.4 : Math.max(0.4, r.ceilingM - 0.5),
      powerKW: kind === 'heat' ? 1.5 : 1,
    });
  });
  app.selection = { kind: 'source', id };
}

export function updateSource(id: number, patch: Partial<Omit<HeatSource, 'id'>>): void {
  edit((r) => {
    const s = r.sources.find((x) => x.id === id);
    if (s) Object.assign(s, patch);
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
  edit((r) => {
    r.openings.push({
      id,
      kind,
      side: 'top',
      pos: r.widthM / 2,
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
    r.probes.push({ id, x: r.widthM * (0.2 + 0.25 * (id - 1)), y: r.heightM * 0.25, z: r.ceilingM / 2 });
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
    let x = r.widthM / 2, y = depthM / 2;
    for (const fy of [0.1, 0.9, 0.5, 0.3, 0.7]) {
      let found = false;
      for (const fx of [0.1, 0.9, 0.5, 0.3, 0.7]) {
        const cx = widthM / 2 + (r.widthM - widthM) * fx;
        const cy = depthM / 2 + (r.heightM - depthM) * fy;
        const occupied = r.furniture.some((f) => {
          const [w, d] = furnitureExtent(f);
          return Math.abs(cx - f.x) < (widthM + w) / 2 + 0.1 && Math.abs(cy - f.y) < (depthM + d) / 2 + 0.1;
        }) || r.sources.some((s) => s.z < preset.heightM && Math.abs(cx - s.x) < widthM / 2 + 0.3 && Math.abs(cy - s.y) < depthM / 2 + 0.3);
        if (!occupied) { x = cx; y = cy; found = true; break; }
      }
      if (found) break;
    }
    r.furniture.push({ id, kind, material: preset.material, x, y, widthM, depthM, heightM: preset.heightM, rotation: 0 });
  });
  select({ kind: 'furniture', id });
}

export function updateFurniture(id: number, patch: Partial<Omit<Furniture, 'id'>>): void {
  edit((r) => { const f = r.furniture.find((item) => item.id === id); if (f) Object.assign(f, patch); });
}

export function removeFurniture(id: number): void {
  edit((r) => { r.furniture = r.furniture.filter((f) => f.id !== id); });
  if (app.selection?.kind === 'furniture' && app.selection.id === id) select(null);
}

/** Move a source, probe, or piece of furniture to a position in metres. */
export function moveItem(kind: 'source' | 'probe' | 'furniture', id: number, x: number, y: number, z?: number): void {
  if (kind === 'furniture') { updateFurniture(id, { x, y }); return; }
  edit((r) => {
    const item = (kind === 'source' ? r.sources : r.probes).find((i) => i.id === id);
    if (item) Object.assign(item, { x, y, ...(z === undefined ? {} : { z }) });
  });
  if (kind === 'probe') {
    recorder.clearSeries(`p${id}`);
    app.graphTick++;
  }
}

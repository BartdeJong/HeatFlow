import {
  DEFAULT_ROOM,
  LIMITS,
  nextId,
  sanitizeRoom,
  type HeatSource,
  type Opening,
  type OpeningKind,
  type RoofConfig,
  type RoomConfig,
  type SourceKind,
  type WallConfig,
} from '../sim/config';
import { Recorder } from '../sim/recorder';
import { roomFromHash } from '../persist/share';
import type { PaletteId } from '../render/palette';

export const SPEEDS = [1, 10, 30, 100, 300, 1000] as const;

export type Selection = { kind: 'source' | 'probe' | 'opening'; id: number } | null;

function initialRoom(): RoomConfig {
  return roomFromHash(location.hash) ?? structuredClone(DEFAULT_ROOM);
}

export const app = $state({
  room: initialRoom(),
  running: true,
  speed: 300 as number,
  palette: 'heat' as PaletteId,
  /** Draw the walls and the gable roof around the room section. */
  exterior: false,
  selection: null as Selection,
  /** Incremented to request a simulation reset. */
  resetToken: 0,
  /** Incremented whenever the recorder gains a sample, so graphs can redraw. */
  graphTick: 0,
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

export function updateRoof(patch: Partial<RoofConfig>): void {
  edit((r) => Object.assign(r.roof, patch));
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
      y: r.ceilingM * fy,
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
      side: 'left',
      // Doors stand on the floor, windows sit around the middle of the wall.
      pos: kind === 'window' ? r.ceilingM * 0.55 : r.ceilingM - 1,
      length: kind === 'window' ? 1.2 : 2,
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
    r.probes.push({ id, x: r.widthM * (0.2 + 0.25 * (id - 1)), y: r.ceilingM * 0.25 });
  });
  app.selection = { kind: 'probe', id };
}

export function removeProbe(id: number): void {
  edit((r) => {
    r.probes = r.probes.filter((p) => p.id !== id);
  });
  if (app.selection?.kind === 'probe' && app.selection.id === id) app.selection = null;
}

/** Move a source or probe to a position in metres. */
export function moveItem(kind: 'source' | 'probe', id: number, x: number, y: number): void {
  edit((r) => {
    const item = (kind === 'source' ? r.sources : r.probes).find((i) => i.id === id);
    if (item) Object.assign(item, { x, y });
  });
}

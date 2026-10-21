export type WallMaterialId = 'brick' | 'concrete' | 'wood' | 'aerated';
export type InsulationId = 'mineral' | 'eps' | 'pir';
export type SourceKind = 'heat' | 'cold';
export type OpeningKind = 'window' | 'door';
export type WallSide = 'top' | 'right' | 'bottom' | 'left';

export interface WallConfig {
  material: WallMaterialId;
  thicknessM: number;
  insulation: InsulationId;
  /** Thickness of the insulation layer in metres (0 = none). */
  insulationM: number;
}

export interface HeatSource {
  id: number;
  kind: SourceKind;
  x: number;
  y: number;
  /** Output magnitude in kW. Cold sources remove this much heat. */
  powerKW: number;
}

export interface Opening {
  id: number;
  kind: OpeningKind;
  side: WallSide;
  /** Centre of the opening along its wall, in metres from the wall's start (left or top). */
  pos: number;
  length: number;
  open: boolean;
}

export interface Probe {
  id: number;
  x: number;
  y: number;
}

export interface RoomConfig {
  widthM: number;
  heightM: number;
  /** Third dimension, m. Ceiling height in plan view; the depth of the slice in convection (side) view. */
  ceilingM: number;
  /** Outside air temperature, °C. */
  outsideC: number;
  /** Simulate hot-air buoyancy; the view is then a side section with the ceiling at the top. */
  convection: boolean;
  wall: WallConfig;
  sources: HeatSource[];
  openings: Opening[];
  probes: Probe[];
}

export interface PhysicsParams {
  initialC: number;
  /** Effective (turbulence-boosted) diffusivity of room air when convection is not simulated, m²/s. */
  alpha: number;
  /** Diffusivity used when convection is simulated explicitly, m²/s. */
  convectionAlpha: number;
  /** Multiplier on air heat capacity to account for furniture and wall surfaces. */
  massFactor: number;
  airDensity: number;
  airCp: number;
  /** Multiplies every U-value. Intended for tests (0 = perfectly insulated). */
  uScale: number;
}

export const WALL_MATERIALS: ReadonlyArray<{ id: WallMaterialId; label: string; k: number }> = [
  { id: 'brick', label: 'Brick', k: 0.77 },
  { id: 'concrete', label: 'Concrete', k: 1.7 },
  { id: 'wood', label: 'Wood', k: 0.13 },
  { id: 'aerated', label: 'Aerated concrete', k: 0.16 },
];

export const INSULATIONS: ReadonlyArray<{ id: InsulationId; label: string; k: number }> = [
  { id: 'mineral', label: 'Mineral wool', k: 0.04 },
  { id: 'eps', label: 'EPS foam', k: 0.035 },
  { id: 'pir', label: 'PIR board', k: 0.022 },
];

export const SIDES: ReadonlyArray<{ id: WallSide; label: string }> = [
  { id: 'top', label: 'Top' },
  { id: 'right', label: 'Right' },
  { id: 'bottom', label: 'Bottom' },
  { id: 'left', label: 'Left' },
];

export const OPENING_KINDS: ReadonlyArray<OpeningKind> = ['window', 'door'];
export const SOURCE_KINDS: ReadonlyArray<SourceKind> = ['heat', 'cold'];

/** Combined inside + outside surface resistance, m²K/W. */
const R_SURFACES = 0.17;

/** U-values in W/m²K. An open opening exchanges air with the outside, so its effective U is high. */
export const OPENING_U: Record<OpeningKind, { closed: number; open: number }> = {
  window: { closed: 1.4, open: 30 },
  door: { closed: 2.0, open: 30 },
};

export const LIMITS = {
  size: { min: 2, max: 10, step: 0.1 },
  outside: { min: -30, max: 40, step: 1 },
  power: { min: 0, max: 10, step: 0.1 },
  thickness: { min: 0.05, max: 0.5, step: 0.01 },
  insulation: { min: 0, max: 0.2, step: 0.01 },
  openingLength: { min: 0.3, step: 0.1 },
  sources: 8,
  openings: 8,
  probes: 3,
} as const;

export const DEFAULT_WALL: WallConfig = {
  material: 'brick',
  thicknessM: 0.2,
  insulation: 'mineral',
  insulationM: 0.02,
};

export const DEFAULT_ROOM: RoomConfig = {
  widthM: 5,
  heightM: 4,
  ceilingM: 2.5,
  outsideC: 0,
  convection: false,
  wall: DEFAULT_WALL,
  sources: [{ id: 1, kind: 'heat', x: 2.5, y: 2, powerKW: 0.97 }],
  openings: [],
  probes: [],
};

export const DEFAULT_PHYSICS: PhysicsParams = {
  initialC: 20,
  alpha: 0.02,
  convectionAlpha: 0.004,
  massFactor: 5,
  airDensity: 1.2,
  airCp: 1005,
  uScale: 1,
};

const clamp = (v: unknown, lo: number, hi: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo;

function pick<T extends string>(v: unknown, ids: ReadonlyArray<T>, fallback: T): T {
  return ids.find((id) => id === v) ?? fallback;
}

const materialIds = WALL_MATERIALS.map((m) => m.id);
const insulationIds = INSULATIONS.map((m) => m.id);
const sideIds = SIDES.map((s) => s.id);

/** U-value of the wall construction in W/m²K. */
export function wallU(wall: WallConfig): number {
  const mat = WALL_MATERIALS.find((m) => m.id === wall.material) ?? WALL_MATERIALS[0];
  const ins = INSULATIONS.find((m) => m.id === wall.insulation) ?? INSULATIONS[0];
  return 1 / (R_SURFACES + wall.thicknessM / mat.k + wall.insulationM / ins.k);
}

export function openingU(o: Pick<Opening, 'kind' | 'open'>): number {
  const u = OPENING_U[o.kind];
  return o.open ? u.open : u.closed;
}

/** Total heat loss in watts through all walls and openings if the whole room sat at `targetC`. */
export function holdLossW(room: RoomConfig, targetC: number): number {
  const wall = wallU(room.wall);
  let ua = 0;
  for (const { id } of SIDES) {
    const len = wallLength(room, id);
    let openLen = 0;
    for (const o of room.openings) {
      if (o.side !== id) continue;
      openLen += o.length;
      ua += openingU(o) * o.length;
    }
    ua += wall * Math.max(0, len - openLen);
  }
  return ua * room.ceilingM * (targetC - room.outsideC);
}

/**
 * Power (kW) the given source must have so the room holds `targetC`, given every other source.
 * `reachable` is false when the needed power falls outside the allowed range.
 */
export function holdPowerKW(
  room: RoomConfig,
  sourceId: number,
  targetC = 20,
): { kW: number; reachable: boolean } | null {
  const src = room.sources.find((s) => s.id === sourceId);
  if (!src) return null;
  let others = 0;
  for (const s of room.sources) {
    if (s.id !== sourceId) others += (s.kind === 'cold' ? -1 : 1) * s.powerKW * 1000;
  }
  const net = holdLossW(room, targetC) - others;
  const kW = (src.kind === 'cold' ? -net : net) / 1000;
  const clamped = Math.min(LIMITS.power.max, Math.max(LIMITS.power.min, kW));
  return { kW: Math.round(clamped * 100) / 100, reachable: Math.abs(clamped - kW) < 0.005 };
}

export function wallLength(room: Pick<RoomConfig, 'widthM' | 'heightM'>, side: WallSide): number {
  return side === 'top' || side === 'bottom' ? room.widthM : room.heightM;
}

export function nextId(items: ReadonlyArray<{ id: number }>): number {
  return items.reduce((m, i) => Math.max(m, i.id), 0) + 1;
}

/** Keep valid unique ids, give every other item a fresh one. */
function withIds<T extends { id: number }>(items: T[]): T[] {
  let max = 0;
  for (const it of items) if (Number.isInteger(it.id) && it.id > 0) max = Math.max(max, it.id);
  const seen = new Set<number>();
  return items.map((it) => {
    if (Number.isInteger(it.id) && it.id > 0 && !seen.has(it.id)) {
      seen.add(it.id);
      return it;
    }
    const id = ++max;
    seen.add(id);
    return { ...it, id };
  });
}

function entries<T>(v: unknown, max: number): Partial<T>[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, max).filter((x) => typeof x === 'object' && x !== null);
}

export function sanitizeWall(w: Partial<WallConfig> | undefined): WallConfig {
  return {
    material: pick(w?.material, materialIds, DEFAULT_WALL.material),
    thicknessM: clamp(w?.thicknessM ?? DEFAULT_WALL.thicknessM, LIMITS.thickness.min, LIMITS.thickness.max),
    insulation: pick(w?.insulation, insulationIds, DEFAULT_WALL.insulation),
    insulationM: clamp(w?.insulationM ?? 0, LIMITS.insulation.min, LIMITS.insulation.max),
  };
}

/** Clamp every value into its valid range and drop malformed entries. Accepts untrusted input. */
export function sanitizeRoom(c: Partial<RoomConfig>): RoomConfig {
  const widthM = clamp(c.widthM, LIMITS.size.min, LIMITS.size.max);
  const heightM = clamp(c.heightM, LIMITS.size.min, LIMITS.size.max);
  const ceilingM = clamp(c.ceilingM ?? DEFAULT_ROOM.ceilingM, LIMITS.size.min, LIMITS.size.max);
  const outsideC = clamp(c.outsideC ?? DEFAULT_ROOM.outsideC, LIMITS.outside.min, LIMITS.outside.max);

  const sources = withIds(
    entries<HeatSource>(c.sources, LIMITS.sources).map((s) => ({
      id: s.id as number,
      kind: pick(s.kind, SOURCE_KINDS, 'heat'),
      x: clamp(s.x, 0, widthM),
      y: clamp(s.y, 0, heightM),
      powerKW: clamp(s.powerKW, LIMITS.power.min, LIMITS.power.max),
    })),
  );

  const openings = withIds(
    entries<Opening>(c.openings, LIMITS.openings).map((o) => {
      const side = pick(o.side, sideIds, 'top');
      const wl = wallLength({ widthM, heightM }, side);
      const length = clamp(o.length, LIMITS.openingLength.min, Math.max(LIMITS.openingLength.min, wl - 0.2));
      return {
        id: o.id as number,
        kind: pick(o.kind, OPENING_KINDS, 'window'),
        side,
        pos: clamp(o.pos, length / 2, wl - length / 2),
        length,
        open: o.open === true,
      };
    }),
  );

  const probes = withIds(
    entries<Probe>(c.probes, LIMITS.probes).map((p) => ({
      id: p.id as number,
      x: clamp(p.x, 0, widthM),
      y: clamp(p.y, 0, heightM),
    })),
  );

  return {
    widthM,
    heightM,
    ceilingM,
    outsideC,
    convection: c.convection === true,
    wall: sanitizeWall(c.wall),
    sources,
    openings,
    probes,
  };
}

/** Build a room from the fields of the original single-source format (uniform U-value). */
export function legacyRoom(
  widthM: number,
  heightM: number,
  powerKW: number,
  uValue: number,
  sourceX: number,
  sourceY: number,
): RoomConfig {
  const base = DEFAULT_WALL;
  const mat = WALL_MATERIALS.find((m) => m.id === base.material)!;
  const ins = INSULATIONS.find((m) => m.id === base.insulation)!;
  const rNeeded = 1 / Math.max(0.05, uValue) - R_SURFACES - base.thicknessM / mat.k;
  return sanitizeRoom({
    widthM,
    heightM,
    wall: { ...base, insulationM: Math.max(0, rNeeded) * ins.k },
    sources: [{ id: 1, kind: 'heat', x: sourceX, y: sourceY, powerKW }],
  });
}

/** Interpret stored data of any known version; returns null if it is not a room. */
export function coerceRoom(v: unknown): RoomConfig | null {
  if (typeof v !== 'object' || v === null) return null;
  const c = v as Record<string, unknown>;
  if (
    typeof c.widthM === 'number' &&
    typeof c.heightM === 'number' &&
    typeof c.powerKW === 'number' &&
    typeof c.uValue === 'number' &&
    typeof c.sourceX === 'number' &&
    typeof c.sourceY === 'number'
  ) {
    return legacyRoom(c.widthM, c.heightM, c.powerKW, c.uValue, c.sourceX, c.sourceY);
  }
  if (typeof c.widthM === 'number' && typeof c.heightM === 'number' && Array.isArray(c.sources)) {
    return sanitizeRoom(c as Partial<RoomConfig>);
  }
  return null;
}

export type WallMaterialId = 'brick' | 'concrete' | 'wood' | 'aerated';
export type InsulationId = 'mineral' | 'eps' | 'pir';
export type SourceKind = 'heat' | 'cold';
export type OpeningKind = 'window' | 'door';
export type WallSide = 'top' | 'right' | 'bottom' | 'left';
export type RoofMaterialId = 'tiles' | 'slate' | 'metal' | 'thatch';
export type FurnitureKind = 'sofa' | 'table';
export const FURNITURE_KINDS: FurnitureKind[] = ['sofa', 'table'];

export interface ThermostatConfig {
  enabled: boolean;
  targetC: number;
  deadbandC: number;
}

export interface FurnitureItem {
  id: number;
  kind: FurnitureKind;
  /** Horizontal centre position in metres. Furniture rests on the floor. */
  x: number;
}

export interface RoofConfig {
  /** Gable roof pitch in degrees. */
  pitchDeg: number;
  /** Thickness of the roof insulation layer in metres (0 = none). */
  insulationM: number;
  /** Appearance only. */
  material: RoofMaterialId;
}

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

/**
 * The room is shown and simulated as a side section: x is the width, y is the height
 * (floor at the bottom, ceiling at the top). Sources, probes and openings live in that section.
 */
export interface RoomConfig {
  widthM: number;
  /** Length of the room, i.e. its depth into the screen (front to back), m. */
  heightM: number;
  /** Ceiling height, m (the vertical axis of the side view). */
  ceilingM: number;
  /** Outside air temperature, °C. */
  outsideC: number;
  /** Simulate hot-air buoyancy (air currents) in addition to diffusion. */
  convection: boolean;
  wall: WallConfig;
  roof: RoofConfig;
  thermostat: ThermostatConfig;
  furniture: FurnitureItem[];
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

export const ROOF_MATERIALS: ReadonlyArray<{ id: RoofMaterialId; label: string; color: string }> = [
  { id: 'tiles', label: 'Clay tiles', color: '#b5523b' },
  { id: 'slate', label: 'Slate', color: '#4b5563' },
  { id: 'metal', label: 'Metal', color: '#8a97a6' },
  { id: 'thatch', label: 'Thatch', color: '#b59a58' },
];

/** Roof structure (tiles, battens, ceiling) plus inside/outside surface resistance, m²K/W. */
const R_ROOF_BASE = 0.3;
const K_ROOF_INSULATION = 0.04;

/** U-value of the roof/ceiling construction in W/m²K. */
export function roofU(roof: Pick<RoofConfig, 'insulationM'>): number {
  return 1 / (R_ROOF_BASE + roof.insulationM / K_ROOF_INSULATION);
}

/** Gable roof (seen from the side) whose ridge runs along the room's length; the roof sits on the outer walls. */
export function roofGeometry(room: Pick<RoomConfig, 'widthM' | 'roof' | 'wall'>, overhangM = 0.3) {
  const wallT = room.wall.thicknessM + room.wall.insulationM;
  const rise = (room.widthM / 2 + wallT) * Math.tan((room.roof.pitchDeg * Math.PI) / 180);
  return { rise, overhangM };
}

export const SIDES: ReadonlyArray<{ id: WallSide; label: string }> = [
  { id: 'top', label: 'Top' },
  { id: 'right', label: 'Right' },
  { id: 'bottom', label: 'Bottom' },
  { id: 'left', label: 'Left' },
];

/** Openings can only be placed in the left and right wall of the side view. */
export const OPENING_SIDES: ReadonlyArray<{ id: WallSide; label: string }> = [
  { id: 'left', label: 'Left wall' },
  { id: 'right', label: 'Right wall' },
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
  pitch: { min: 10, max: 60, step: 1 },
  roofInsulation: { min: 0, max: 0.3, step: 0.01 },
  thermostatTarget: { min: 5, max: 30, step: 0.5 },
  thermostatDeadband: { min: 0.2, max: 3, step: 0.1 },
  openingLength: { min: 0.3, step: 0.1 },
  sources: 8,
  openings: 8,
  probes: 3,
  furniture: 8,
} as const;

export const DEFAULT_WALL: WallConfig = {
  material: 'brick',
  thicknessM: 0.2,
  insulation: 'mineral',
  insulationM: 0.02,
};

export const DEFAULT_ROOF: RoofConfig = { pitchDeg: 35, insulationM: 0.1, material: 'tiles' };

export const DEFAULT_THERMOSTAT: ThermostatConfig = {
  enabled: false,
  targetC: 20,
  deadbandC: 0.5,
};

export function furnitureSize(kind: FurnitureKind, roomWidthM: number): { widthM: number; heightM: number } {
  return kind === 'sofa'
    ? { widthM: Math.min(1.8, roomWidthM * 0.38), heightM: 0.78 }
    : { widthM: Math.min(1, roomWidthM * 0.22), heightM: 0.48 };
}

export function defaultFurniture(roomWidthM: number): FurnitureItem[] {
  const rounded = (x: number) => Number(x.toFixed(3));
  return [
    { id: 1, kind: 'sofa', x: rounded(roomWidthM * 0.28) },
    { id: 2, kind: 'table', x: rounded(roomWidthM * 0.72) },
  ];
}

export const DEFAULT_ROOM: RoomConfig = {
  widthM: 5,
  heightM: 4,
  ceilingM: 2.5,
  outsideC: 0,
  convection: false,
  wall: DEFAULT_WALL,
  roof: DEFAULT_ROOF,
  thermostat: DEFAULT_THERMOSTAT,
  furniture: defaultFurniture(5),
  sources: [{ id: 1, kind: 'heat', x: 2.5, y: 2.0, powerKW: 1.54 }],
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
const openingSideIds = OPENING_SIDES.map((s) => s.id);

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
  const roof = roofU(room.roof);
  let ua = 0;
  for (const { id } of SIDES) {
    const len = wallLength(room, id);
    // The top edge of the section is the roof; the bottom edge is the floor.
    const base = id === 'top' ? roof : wall;
    let openLen = 0;
    for (const o of room.openings) {
      if (o.side !== id) continue;
      openLen += o.length;
      ua += openingU(o) * o.length;
    }
    ua += base * Math.max(0, len - openLen);
  }
  const dT = targetC - room.outsideC;
  // Edges of the section are strips as long as the room; the front and back walls are width × height.
  const frontBack = 2 * wall * room.widthM * room.ceilingM;
  return (ua * room.heightM + frontBack) * dT;
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

export function wallLength(room: Pick<RoomConfig, 'widthM' | 'ceilingM'>, side: WallSide): number {
  return side === 'top' || side === 'bottom' ? room.widthM : room.ceilingM;
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

function sanitizeRoof(r: Partial<RoofConfig> | undefined): RoofConfig {
  return {
    pitchDeg: clamp(r?.pitchDeg ?? DEFAULT_ROOF.pitchDeg, LIMITS.pitch.min, LIMITS.pitch.max),
    insulationM: clamp(
      r?.insulationM ?? DEFAULT_ROOF.insulationM,
      LIMITS.roofInsulation.min,
      LIMITS.roofInsulation.max,
    ),
    material: pick(r?.material, ROOF_MATERIALS.map((m) => m.id), DEFAULT_ROOF.material),
  };
}

function sanitizeThermostat(t: Partial<ThermostatConfig> | undefined): ThermostatConfig {
  return {
    enabled: t?.enabled === true,
    targetC: clamp(t?.targetC ?? DEFAULT_THERMOSTAT.targetC, LIMITS.thermostatTarget.min, LIMITS.thermostatTarget.max),
    deadbandC: clamp(
      t?.deadbandC ?? DEFAULT_THERMOSTAT.deadbandC,
      LIMITS.thermostatDeadband.min,
      LIMITS.thermostatDeadband.max,
    ),
  };
}

/** Clamp every value into its valid range and drop malformed entries. Accepts untrusted input. */
export function sanitizeRoom(
  c: Partial<Omit<RoomConfig, 'roof' | 'thermostat'>> & {
    roof?: Partial<RoofConfig>;
    thermostat?: Partial<ThermostatConfig>;
  },
): RoomConfig {
  const widthM = clamp(c.widthM, LIMITS.size.min, LIMITS.size.max);
  const heightM = clamp(c.heightM, LIMITS.size.min, LIMITS.size.max);
  const ceilingM = clamp(c.ceilingM ?? DEFAULT_ROOM.ceilingM, LIMITS.size.min, LIMITS.size.max);
  const outsideC = clamp(c.outsideC ?? DEFAULT_ROOM.outsideC, LIMITS.outside.min, LIMITS.outside.max);

  const sources = withIds(
    entries<HeatSource>(c.sources, LIMITS.sources).map((s) => ({
      id: s.id as number,
      kind: pick(s.kind, SOURCE_KINDS, 'heat'),
      x: clamp(s.x, 0, widthM),
      y: clamp(s.y, 0, ceilingM),
      powerKW: clamp(s.powerKW, LIMITS.power.min, LIMITS.power.max),
    })),
  );

  const openings = withIds(
    entries<Opening>(c.openings, LIMITS.openings).map((o) => {
      const side = pick(o.side, openingSideIds, 'left');
      const wl = wallLength({ widthM, ceilingM }, side);
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
      y: clamp(p.y, 0, ceilingM),
    })),
  );

  const furniture = withIds(
    entries<FurnitureItem>(c.furniture ?? defaultFurniture(widthM), LIMITS.furniture).map((f) => {
      const kind = pick(f.kind, ['sofa', 'table'], 'sofa');
      const { widthM: itemWidth } = furnitureSize(kind, widthM);
      return {
        id: f.id as number,
        kind,
        x: clamp(f.x, itemWidth / 2, widthM - itemWidth / 2),
      };
    }),
  );

  return {
    widthM,
    heightM,
    ceilingM,
    outsideC,
    convection: c.convection === true,
    wall: sanitizeWall(c.wall),
    roof: sanitizeRoof(c.roof),
    thermostat: sanitizeThermostat(c.thermostat),
    furniture,
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

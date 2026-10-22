export type WallMaterialId = 'brick' | 'concrete' | 'wood' | 'aerated';
export type InsulationId = 'mineral' | 'eps' | 'pir';
export type SourceKind = 'heat' | 'cold';
export type HeatingMode = 'point' | 'underfloor';
export type OpeningKind = 'window' | 'door';
export type WallSide = 'top' | 'right' | 'bottom' | 'left';
export type FurnitureKind = 'sofa' | 'table' | 'cabinet' | 'bed';
export type FurnitureMaterial = 'wood' | 'fabric' | 'metal';

export interface Furniture {
  id: number;
  kind: FurnitureKind;
  material: FurnitureMaterial;
  /** Centre on the floor plan, metres. Furniture rests on the floor. */
  x: number;
  y: number;
  widthM: number;
  depthM: number;
  heightM: number;
  rotation: 0 | 90;
}

/** Effective material parameters for the simplified furniture model, not product specifications. */
export const FURNITURE_MATERIALS: ReadonlyArray<{ id: FurnitureMaterial; label: string; k: number; capacity: number; h: number }> = [
  { id: 'wood', label: 'Wood', k: 0.15, capacity: 650_000, h: 4 },
  { id: 'fabric', label: 'Upholstery', k: 0.06, capacity: 100_000, h: 3 },
  { id: 'metal', label: 'Metal', k: 12, capacity: 1_800_000, h: 6 },
];

export const FURNITURE_PRESETS: ReadonlyArray<{ id: FurnitureKind; label: string; widthM: number; depthM: number; heightM: number; material: FurnitureMaterial }> = [
  { id: 'sofa', label: 'Sofa', widthM: 2, depthM: 0.9, heightM: 0.85, material: 'fabric' },
  { id: 'table', label: 'Table', widthM: 1.4, depthM: 0.9, heightM: 0.8, material: 'wood' },
  { id: 'cabinet', label: 'Cabinet', widthM: 1.2, depthM: 0.5, heightM: 1.8, material: 'wood' },
  { id: 'bed', label: 'Bed', widthM: 1.6, depthM: 2, heightM: 0.6, material: 'fabric' },
];

export type RoofMaterialId = 'tiles' | 'slate' | 'metal' | 'thatch';

export interface ThermostatConfig {
  enabled: boolean;
  targetC: number;
  deadbandC: number;
}

export interface RoofConfig { pitchDeg: number; insulationM: number; material: RoofMaterialId; }

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
  /** Height above the floor, metres. x/y locate the point on the floor plan. */
  z: number;
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
  heightM: number;
  sillM: number;
  open: boolean;
}

export interface Probe {
  id: number;
  x: number;
  y: number;
  z: number;
}

/** Volumetric room: x is width, y is floor-plan length, z is height above floor. */
export interface RoomConfig {
  widthM: number;
  /** Length of the room, i.e. its depth into the screen (front to back), m. */
  heightM: number;
  /** Vertical room dimension, metres. heightM is the floor-plan length (y). */
  ceilingM: number;
  /** Outside air temperature, °C. */
  outsideC: number;
  /** Simulate buoyancy-driven airflow in all three dimensions; z points up. */
  convection: boolean;
  wall: WallConfig;
  roof: RoofConfig;
  thermostat: ThermostatConfig;
  heatingMode: HeatingMode;
  sources: HeatSource[];
  openings: Opening[];
  probes: Probe[];
  furniture: Furniture[];
}

export interface PhysicsParams {
  initialC: number;
  /** Effective (turbulence-boosted) diffusivity of room air when convection is not simulated, m²/s. */
  alpha: number;
  /** Diffusivity used when convection is simulated explicitly, m²/s. */
  convectionAlpha: number;
  /** Multiplier on air heat capacity for wall surfaces and unmodelled contents; explicit furniture has its own capacity. */
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
  { id: 'top', label: 'Back (y = 0)' },
  { id: 'right', label: 'Right' },
  { id: 'bottom', label: 'Front (y = length)' },
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

export const DEFAULT_ROOM: RoomConfig = {
  widthM: 5,
  heightM: 4,
  ceilingM: 2.5,
  outsideC: 0,
  convection: false,
  wall: DEFAULT_WALL,
  roof: DEFAULT_ROOF,
  thermostat: DEFAULT_THERMOSTAT,
  heatingMode: 'point',
  sources: [{ id: 1, kind: 'heat', x: 2.5, y: 2, z: 0.4, powerKW: 1.54 }],
  openings: [],
  probes: [],
  furniture: [],
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
  // The floor uses the wall construction; the ceiling uses the roof insulation.
  let ua = room.widthM * room.heightM * (wallU(room.wall) + roofU(room.roof));
  for (const { id } of SIDES) {
    for (const p of wallRegions(room, id)) {
      ua += p.u * (p.to - p.from) * (p.top - p.bottom);
    }
  }
  return ua * (targetC - room.outsideC);
}

/** Non-overlapping patches of a vertical wall. The last opening wins where openings overlap. */
export function wallRegions(room: RoomConfig, side: WallSide) {
  const openings = room.openings.filter((o) => o.side === side);
  const xs = [...new Set([0, wallLength(room, side), ...openings.flatMap((o) => [o.pos - o.length / 2, o.pos + o.length / 2])])].sort((a, b) => a - b);
  const zs = [...new Set([0, room.ceilingM, ...openings.flatMap((o) => [o.sillM, o.sillM + o.heightM])])].sort((a, b) => a - b);
  const regions: { from: number; to: number; bottom: number; top: number; u: number; opening: boolean }[] = [];
  for (let z = 1; z < zs.length; z++) for (let x = 1; x < xs.length; x++) {
    const cx = (xs[x - 1] + xs[x]) / 2;
    const cz = (zs[z - 1] + zs[z]) / 2;
    const opening = openings.findLast((o) => Math.abs(cx - o.pos) < o.length / 2 && cz > o.sillM && cz < o.sillM + o.heightM);
    regions.push({ from: xs[x - 1], to: xs[x], bottom: zs[z - 1], top: zs[z], u: opening ? openingU(opening) : wallU(room.wall), opening: !!opening });
  }
  return regions;
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
      y: clamp(s.y, 0, heightM),
      z: clamp(s.z ?? Math.min(0.4, ceilingM / 2), 0, ceilingM),
      powerKW: clamp(s.powerKW, LIMITS.power.min, LIMITS.power.max),
    })),
  );

  const openings = withIds(
    entries<Opening>(c.openings, LIMITS.openings).map((o) => {
      const side = pick(o.side, sideIds, 'top');
      const wl = wallLength({ widthM, heightM }, side);
      const length = clamp(o.length, LIMITS.openingLength.min, Math.max(LIMITS.openingLength.min, wl - 0.2));
      const height = clamp(o.heightM ?? (o.kind === 'door' ? 2.1 : 1.2), 0.3, ceilingM);
      return {
        id: o.id as number,
        kind: pick(o.kind, OPENING_KINDS, 'window'),
        side,
        pos: clamp(o.pos, length / 2, wl - length / 2),
        length,
        heightM: height,
        sillM: clamp(o.sillM ?? (o.kind === 'door' ? 0 : 0.8), 0, ceilingM - height),
        open: o.open === true,
      };
    }),
  );

  const probes = withIds(
    entries<Probe>(c.probes, LIMITS.probes).map((p) => ({
      id: p.id as number,
      x: clamp(p.x, 0, widthM),
      y: clamp(p.y, 0, heightM),
      z: clamp(p.z ?? ceilingM / 2, 0, ceilingM),
    })),
  );

  const furniture = withIds(entries<Furniture>(c.furniture, LIMITS.furniture).map((f): Furniture => {
    const kind = pick(f.kind, FURNITURE_PRESETS.map((p) => p.id), 'sofa');
    const preset = FURNITURE_PRESETS.find((p) => p.id === kind)!;
    const rotation = f.rotation === 90 ? 90 : 0;
    const fw = clamp(f.widthM ?? preset.widthM, 0.4, rotation === 90 ? heightM : widthM);
    const fd = clamp(f.depthM ?? preset.depthM, 0.4, rotation === 90 ? widthM : heightM);
    const halfX = (rotation === 90 ? fd : fw) / 2;
    const halfY = (rotation === 90 ? fw : fd) / 2;
    return {
      id: f.id as number, kind, rotation,
      material: pick(f.material, FURNITURE_MATERIALS.map((m) => m.id), preset.material),
      x: clamp(f.x ?? widthM / 2, halfX, widthM - halfX),
      y: clamp(f.y ?? heightM / 2, halfY, heightM - halfY),
      widthM: fw, depthM: fd,
      heightM: clamp(f.heightM ?? preset.heightM, 0.4, ceilingM),
    };
  }));

  return {
    widthM,
    heightM,
    ceilingM,
    outsideC,
    convection: c.convection === true,
    wall: sanitizeWall(c.wall),
    roof: sanitizeRoof(c.roof),
    thermostat: sanitizeThermostat(c.thermostat),
    heatingMode: pick(c.heatingMode, ['point', 'underfloor'], 'point'),
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
    sources: [{ id: 1, kind: 'heat', x: sourceX, y: sourceY, z: 0.4, powerKW }],
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
    // main's side-section saves have roof settings but no vertical coordinates.
    // Lift their section into the middle of the floor plan, with screen-up becoming +Z.
    const sectionSources = entries<HeatSource>(c.sources, LIMITS.sources);
    const sectionProbes = entries<Probe>(c.probes, LIMITS.probes);
    const sectionOpenings = entries<Opening>(c.openings, LIMITS.openings);
    const sectionFurniture = entries<Furniture>(c.furniture, LIMITS.furniture);
    const items = [...sectionSources, ...sectionProbes];
    const section = c.roof && (items.some((item) => !('z' in item)) ||
      sectionOpenings.some((o) => !('heightM' in o)) || sectionFurniture.some((f) => !('material' in f)));
    if (section) {
      const depth = c.heightM as number;
      const ceiling = typeof c.ceilingM === 'number' ? c.ceilingM : DEFAULT_ROOM.ceilingM;
      const converted = { ...c } as Partial<RoomConfig>;
      converted.sources = sectionSources.map((s) => ({ ...s, y: depth / 2, z: ceiling - (s.y ?? ceiling / 2) })) as HeatSource[];
      converted.probes = sectionProbes.map((p) => ({ ...p, y: depth / 2, z: ceiling - (p.y ?? ceiling / 2) })) as Probe[];
      converted.openings = sectionOpenings.map((o) => ({ ...o,
        pos: depth / 2, length: o.kind === 'door' ? 0.9 : 1.2,
        heightM: o.length, sillM: ceiling - (o.pos ?? ceiling / 2) - (o.length ?? 1.2) / 2,
      })) as Opening[];
      converted.furniture = sectionFurniture.map((f) => ({ ...FURNITURE_PRESETS.find((p) => p.id === f.kind),
        ...f, y: depth / 2, rotation: 0,
      })) as Furniture[];
      return sanitizeRoom(converted);
    }
    return sanitizeRoom(c as Partial<RoomConfig>);
  }
  return null;
}

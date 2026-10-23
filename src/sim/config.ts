import { solveVentilation } from './ventilation';
import { DEFAULT_MODEL, emitterPreset, sanitizeEmitter, sanitizeModel, sanitizeSensor, getModel, wallLayers, roofLayers, floorLayers, type ModelConfig, type SensorConfig, type EmitterConfig } from './model';
import { footprintWalls, isValidFootprint, nearestFootprintPoint, polygonArea, roomFootprint, type FootprintPoint } from './footprint';

export type WallMaterialId = 'brick' | 'concrete' | 'wood' | 'aerated';
export type InsulationId = 'mineral' | 'eps' | 'pir';
export type SourceKind = 'heat' | 'cold' | 'fan';
export type HeatingMode = 'point' | 'underfloor';
export type OpeningKind = 'window' | 'door';
export type WallSide = 'top' | 'right' | 'bottom' | 'left';
export type FurnitureKind = 'sofa' | 'table' | 'cabinet' | 'bed' | 'wall';
export type FurnitureMaterial = 'wood' | 'fabric' | 'metal' | 'masonry';

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
  { id: 'masonry', label: 'Masonry', k: 0.77, capacity: 1_512_000, h: 6 },
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
  sensor?: SensorConfig;
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
  /** Fan airflow speed, m/s. Used only by ceiling-fan sources. */
  fanSpeedMps?: number;
  /** Fan blade diameter, metres. Used only by ceiling-fan sources. */
  fanDiameterM?: number;
  /** Whether the ceiling fan is currently running. */
  fanEnabled?: boolean;
  emitter?: EmitterConfig;
}

export interface Opening {
  id: number;
  kind: OpeningKind;
  side: WallSide;
  /** Index in the room outline. Missing values are resolved from the legacy side. */
  wallIndex?: number;
  /** Centre of the opening along its wall, in metres from the wall's start (left or top). */
  pos: number;
  length: number;
  heightM: number;
  sillM: number;
  open: boolean;
  solarTransmittance?: number;
}

export interface Probe {
  id: number;
  x: number;
  y: number;
  z: number;
}

export interface InteriorWall {
  id: number;
  start: FootprintPoint;
  end: FootprintPoint;
  thicknessM: number;
}

export interface CeilingFanConfig {
  /** Downward air speed under the fan, m/s. */
  speedMps: number;
  diameterM: number;
}

/** Volumetric room: x is width, y is floor-plan length, z is height above floor. */
export interface RoomConfig {
  widthM: number;
  /** Length of the room, i.e. its depth into the screen (front to back), m. */
  heightM: number;
  /** Optional axis-aligned room outline in metres; omitted legacy rooms are rectangular. */
  footprint?: FootprintPoint[];
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
  interiorWalls?: InteriorWall[];
  model?: ModelConfig;
}

export interface PhysicsParams {
  initialC: number;
  /** Molecular thermal diffusivity of room air, m²/s. */
  alpha: number;
  /** Diffusivity used when convection is simulated explicitly, m²/s. */
  convectionAlpha: number;
  /** Deprecated compatibility multiplier; physical simulations use 1 and explicit thermal storage. */
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
/** The compact v1–v5 share formats encode these two source kinds by index. */
export const SOURCE_KINDS: ReadonlyArray<'heat' | 'cold'> = ['heat', 'cold'];
export const ALL_SOURCE_KINDS: ReadonlyArray<SourceKind> = ['heat', 'cold', 'fan'];

/** Combined inside + outside surface resistance, m²K/W. */
const R_SURFACES = 0.17;

/** U-values in W/m²K. An open opening exchanges air with the outside, so its effective U is high. */
export const OPENING_U: Record<OpeningKind, { closed: number; open: number }> = {
  window: { closed: 1.4, open: 30 },
  door: { closed: 2.0, open: 30 },
};

export const LIMITS = {
  size: { min: 2, max: 15, step: 0.1 },
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
  interiorWalls: 96,
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
  sensor: { mode: 'point', x: 2.5, y: 2, z: 1.1, lagSeconds: 30 },
};

export const DEFAULT_CEILING_FAN: CeilingFanConfig = { speedMps: 1.2, diameterM: 1.2 };

export const DEFAULT_ROOM: RoomConfig = {
  widthM: 12.68,
  heightM: 8.99,
  footprint: [
    { x: 0, y: 0 }, { x: 4.43, y: 0 }, { x: 4.43, y: 2.31 },
    { x: 4.97, y: 2.31 }, { x: 4.97, y: 3.03 }, { x: 5.71, y: 3.03 },
    { x: 5.71, y: 2.31 }, { x: 12.68, y: 2.31 }, { x: 12.68, y: 7 },
    { x: 9.94, y: 7 }, { x: 9.94, y: 8.99 }, { x: 5.43, y: 8.99 },
    { x: 5.43, y: 7 }, { x: 0, y: 7 },
  ],
  interiorWalls: [
    { id: 1, start: { x: 9.94, y: 2.31 }, end: { x: 9.94, y: 4.13 }, thicknessM: 0.14 },
    { id: 2, start: { x: 9.94, y: 6.01 }, end: { x: 9.94, y: 7 }, thicknessM: 0.14 },
  ],
  ceilingM: 2.5,
  outsideC: 0,
  convection: true,
  wall: DEFAULT_WALL,
  roof: DEFAULT_ROOF,
  thermostat: DEFAULT_THERMOSTAT,
  heatingMode: 'point',
  sources: [{ id: 1, kind: 'heat', x: 2.5, y: 1.5, z: 0.4, powerKW: 1.54, emitter: emitterPreset('radiator') }],
  openings: [],
  probes: [],
  furniture: [],
  model: { ...DEFAULT_MODEL, quality: 'fast' },
};

export const DEFAULT_PHYSICS: PhysicsParams = {
  initialC: 20,
  alpha: 2.2e-5,
  convectionAlpha: 2.2e-5,
  massFactor: 1,
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

/** Approximate steady sensible heating demand. Ignores solar and sky radiation;
 * transient air temperatures and emitter temperatures need the full solver. */
export function holdLossW(room: RoomConfig, targetC: number): number {
  const model = getModel(room);
  const resistance = (layers: ReturnType<typeof wallLayers>) => layers.reduce((r, l) => r + l.thicknessM / l.k, 0);
  const uWall = 1 / (R_SURFACES + resistance(wallLayers(room)));
  const uRoof = 1 / (R_SURFACES + resistance(roofLayers(room)));
  const uFloor = 1 / (0.17 + resistance(floorLayers(room)));
  const area = polygonArea(roomFootprint(room));
  const floorBoundary = model.floor.boundary === 'outside' ? room.outsideC : model.floor.temperatureC;
  let loss = area * (uRoof * (targetC - room.outsideC) + uFloor * (targetC - floorBoundary));
  for (const wall of footprintWalls(room)) for (const p of wallRegions(room, wall.index)) {
    const opening = room.openings.findLast(o => getOpeningWallIndex(room, o) === wall.index && Math.abs((p.from + p.to) / 2 - o.pos) < o.length / 2 &&
      (p.bottom + p.top) / 2 > o.sillM && (p.bottom + p.top) / 2 < o.sillM + o.heightM);
    const u = opening?.open ? 0 : opening ? OPENING_U[opening.kind].closed : uWall;
    loss += u * (p.to - p.from) * (p.top - p.bottom) * (targetC - room.outsideC);
  }
  const ventilation = solveVentilation(room, targetC, { outsideC: room.outsideC, windMps: model.environment.windMps, windDirectionDeg: model.environment.windDirectionDeg });
  return loss + 1.2 * 1005 * ventilation.inflowM3s * (targetC - room.outsideC);
}

/** Non-overlapping patches of a vertical wall. The last opening wins where openings overlap. */
export function wallRegions(room: RoomConfig, wallIndex: number) {
  const openings = room.openings.filter((o) => getOpeningWallIndex(room, o) === wallIndex);
  const wall = footprintWalls(room)[wallIndex];
  if (!wall) return [];
  const xs = [...new Set([0, wall.length, ...openings.flatMap((o) => [o.pos - o.length / 2, o.pos + o.length / 2])])].sort((a, b) => a - b);
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
  if (!src || src.kind === 'fan') return null;
  let others = 0;
  for (const s of room.sources) {
    if (s.id !== sourceId && s.kind !== 'fan') others += (s.kind === 'cold' ? -1 : 1) * s.powerKW * 1000;
  }
  const net = holdLossW(room, targetC) - others;
  const kW = (src.kind === 'cold' ? -net : net) / 1000;
  const clamped = Math.min(LIMITS.power.max, Math.max(LIMITS.power.min, kW));
  return { kW: Math.round(clamped * 100) / 100, reachable: Math.abs(clamped - kW) < 0.005 };
}

export function getOpeningWallIndex(room: RoomConfig, opening: Pick<Opening, 'side' | 'wallIndex'>): number {
  const walls = footprintWalls(room);
  if (Number.isInteger(opening.wallIndex) && opening.wallIndex! >= 0 && opening.wallIndex! < walls.length) return opening.wallIndex!;
  return walls.find((wall) => wall.side === opening.side)?.index ?? 0;
}

export function wallLength(room: Pick<RoomConfig, 'widthM' | 'heightM' | 'footprint'>, side: WallSide | number): number {
  if (typeof side === 'number') return footprintWalls(room)[side]?.length ?? 0;
  const matching = footprintWalls(room).filter((wall) => wall.side === side);
  return matching.reduce((length, wall) => length + wall.length, 0) || (side === 'top' || side === 'bottom' ? room.widthM : room.heightM);
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

function sanitizeThermostat(t: Partial<ThermostatConfig> | undefined, widthM: number, heightM: number, ceilingM: number): ThermostatConfig {
  return {
    ...(sanitizeSensor(t?.sensor, widthM, heightM, ceilingM) ? { sensor: sanitizeSensor(t?.sensor, widthM, heightM, ceilingM) } : {}),
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
  c: Partial<Omit<RoomConfig, 'roof' | 'thermostat' | 'interiorWalls'>> & {
    interiorWalls?: unknown;
    roof?: Partial<RoofConfig>;
    thermostat?: Partial<ThermostatConfig>;
    /** Read legacy WIP room saves where the fan was stored outside sources. */
    fan?: Partial<CeilingFanConfig> & { enabled?: boolean };
  },
): RoomConfig {
  const widthM = clamp(c.widthM, LIMITS.size.min, LIMITS.size.max);
  const heightM = clamp(c.heightM, LIMITS.size.min, LIMITS.size.max);
  const footprint = isValidFootprint(c.footprint, widthM, heightM)
    ? c.footprint.map((point) => ({ x: point.x, y: point.y }))
    : undefined;
  const interiorWalls = withIds((Array.isArray(c.interiorWalls) ? c.interiorWalls : [])
    .slice(0, LIMITS.interiorWalls)
    .flatMap((value): InteriorWall[] => {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) return [];
      const wall = value as Record<string, unknown>;
      const thicknessM = clamp(wall.thicknessM, 0.05, 0.5);
      const id = Number.isInteger(wall.id) ? wall.id as number : 0;
      const toWall = (startX: unknown, startY: unknown, endX: unknown, endY: unknown): InteriorWall[] => {
        const horizontal = startY === endY;
        if (typeof startX !== 'number' || typeof startY !== 'number' || typeof endX !== 'number' || typeof endY !== 'number' ||
          ![startX, startY, endX, endY].every(Number.isFinite) ||
          (startX === endX) === (startY === endY) ||
          Math.hypot(endX - startX, endY - startY) < 0.1) return [];
        if (horizontal
          ? startY < thicknessM / 2 || startY > heightM - thicknessM / 2 ||
            startX < 0 || startX > widthM || endX < 0 || endX > widthM
          : startX < thicknessM / 2 || startX > widthM - thicknessM / 2 || startY < 0 || startY > heightM ||
            endX < thicknessM / 2 || endX > widthM - thicknessM / 2 || endY < 0 || endY > heightM) return [];
        return [{ id, start: { x: startX, y: startY }, end: { x: endX, y: endY }, thicknessM }];
      };
      if (wall.start !== null && typeof wall.start === 'object' && wall.end !== null && typeof wall.end === 'object') {
        const start = wall.start as Record<string, unknown>, end = wall.end as Record<string, unknown>;
        return toWall(start.x, start.y, end.x, end.y);
      }
      if (typeof wall.x !== 'number' || !Number.isFinite(wall.x) ||
        !Array.isArray(wall.segments) || wall.x < thicknessM / 2 || wall.x > widthM - thicknessM / 2) return [];
      return wall.segments.slice(0, 12).flatMap((segment): InteriorWall[] => {
        if (segment === null || typeof segment !== 'object' || Array.isArray(segment)) return [];
        const legacySegment = segment as Record<string, unknown>;
        return toWall(wall.x, legacySegment.fromY, wall.x, legacySegment.toY);
      });
    }).slice(0, LIMITS.interiorWalls));
  const ceilingM = clamp(c.ceilingM ?? DEFAULT_ROOM.ceilingM, LIMITS.size.min, LIMITS.size.max);
  const outsideC = clamp(c.outsideC ?? DEFAULT_ROOM.outsideC, LIMITS.outside.min, LIMITS.outside.max);

  let rawSources = entries<HeatSource>(c.sources, LIMITS.sources);
  const hasFanSource = rawSources.some((s) => s.kind === 'fan');
  const fanSpeed = clamp(c.fan?.speedMps ?? DEFAULT_CEILING_FAN.speedMps, 0.3, 2.5);
  const fanDiameter = clamp(c.fan?.diameterM ?? DEFAULT_CEILING_FAN.diameterM, 0.5, 2);
  // Preserve any fan created by the earlier room-level UI while making it a normal movable source.
  if (c.fan?.enabled === true && !hasFanSource && rawSources.length < LIMITS.sources) {
    const id = rawSources.reduce((max, source) => Math.max(max, Number.isInteger(source.id) ? source.id! : 0), 0) + 1;
    rawSources.push({ id, kind: 'fan', x: widthM / 2, y: heightM / 2, z: ceilingM - 0.12, powerKW: 0,
      fanSpeedMps: fanSpeed, fanDiameterM: fanDiameter });
  }
  let foundFan = false;
  rawSources = rawSources.filter((source) => {
    if (source.kind !== 'fan') return true;
    if (foundFan) return false;
    foundFan = true;
    return true;
  });
  const sources = withIds(
    rawSources.map((s) => {
      const kind = pick(s.kind, ALL_SOURCE_KINDS, 'heat');
      const location = nearestFootprintPoint({ widthM, heightM, footprint },
        clamp(s.x, 0, widthM), clamp(s.y, 0, heightM));
      return {
        id: s.id as number,
        kind,
        x: location.x,
        y: location.y,
        z: kind === 'fan' ? ceilingM - 0.12 : clamp(s.z ?? Math.min(0.4, ceilingM / 2), 0, ceilingM),
        powerKW: kind === 'fan' ? 0 : clamp(s.powerKW, LIMITS.power.min, LIMITS.power.max),
        ...(kind === 'fan' ? {
          fanEnabled: s.fanEnabled !== false,
          fanSpeedMps: clamp(s.fanSpeedMps ?? fanSpeed, 0.3, 2.5),
          fanDiameterM: clamp(s.fanDiameterM ?? fanDiameter, 0.5, 2),
        } : {}),
        ...(kind !== 'fan' && sanitizeEmitter(s.emitter) ? { emitter: sanitizeEmitter(s.emitter) } : {}),
      };
    }),
  );

  const openings = withIds(
    entries<Opening>(c.openings, LIMITS.openings).map((o) => {
      const side = pick(o.side, sideIds, 'top');
      const walls = footprintWalls({ widthM, heightM, footprint });
      const wallIndex = Number.isInteger(o.wallIndex) && o.wallIndex! >= 0 && o.wallIndex! < walls.length
        ? o.wallIndex!
        : walls.find((wall) => wall.side === side)?.index ?? 0;
      const wl = wallLength({ widthM, heightM, footprint }, wallIndex);
      const length = clamp(o.length, LIMITS.openingLength.min, Math.max(LIMITS.openingLength.min, wl - 0.2));
      const height = clamp(o.heightM ?? (o.kind === 'door' ? 2.1 : 1.2), 0.3, ceilingM);
      const wallSide = walls[wallIndex]?.side ?? side;
      return {
        id: o.id as number,
        kind: pick(o.kind, OPENING_KINDS, 'window'),
        side: wallSide,
        wallIndex,
        pos: clamp(o.pos, length / 2, wl - length / 2),
        length,
        heightM: height,
        sillM: clamp(o.sillM ?? (o.kind === 'door' ? 0 : 0.8), 0, ceilingM - height),
        open: o.open === true,
        ...(o.solarTransmittance === undefined ? {} : { solarTransmittance: clamp(o.solarTransmittance, 0, 1) }),
      };
    }),
  );

  const probes = withIds(
    entries<Probe>(c.probes, LIMITS.probes).map((p) => {
      const location = nearestFootprintPoint({ widthM, heightM, footprint }, clamp(p.x, 0, widthM), clamp(p.y, 0, heightM));
      return { id: p.id as number, x: location.x, y: location.y, z: clamp(p.z ?? ceilingM / 2, 0, ceilingM) };
    }),
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
    footprint: footprint ?? [
      { x: 0, y: 0 }, { x: widthM, y: 0 }, { x: widthM, y: heightM }, { x: 0, y: heightM },
    ],
    ceilingM,
    outsideC,
    convection: c.convection === true,
    wall: sanitizeWall(c.wall),
    roof: sanitizeRoof(c.roof),
    thermostat: sanitizeThermostat(c.thermostat, widthM, heightM, ceilingM),
    ...(c.model ? { model: sanitizeModel(c.model) } : {}),
    heatingMode: pick(c.heatingMode, ['point', 'underfloor'], 'point'),
    furniture,
    sources,
    openings,
    probes,
    interiorWalls,
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

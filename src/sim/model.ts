import type { HeatSource, RoomConfig } from './config';

/** SI properties of a homogeneous construction layer, ordered inside → outside. */
export interface ThermalLayer { label: string; thicknessM: number; k: number; density: number; cp: number }
export interface SensorConfig { mode: 'average' | 'point'; x: number; y: number; z: number; lagSeconds: number }
export interface EmitterConfig {
  kind: 'ideal' | 'radiator' | 'convector';
  widthM: number; heightM: number; depthM: number; capacityJPerK: number; emissivity: number;
}
export interface EnvironmentConfig {
  preset: 'constant' | 'clear-day' | 'cold-day'; windMps: number; windDirectionDeg: number;
  orientationDeg: number; solarWm2: number; diffuseWm2: number; sunElevationDeg: number;
  sunAzimuthDeg: number; startHour: number; skyOffsetC: number;
}
export interface ModelConfig {
  quality: 'fast' | 'coarse' | 'balanced' | 'fine';
  floor: { boundary: 'ground' | 'outside' | 'adjacent'; temperatureC: number; layers: ThermalLayer[] };
  wallLayers?: ThermalLayer[]; roofLayers?: ThermalLayer[];
  environment: EnvironmentConfig; leakageACH: number; radiation: boolean;
}
export const DEFAULT_FLOOR_LAYERS: ThermalLayer[] = [
  { label: 'Screed', thicknessM: 0.06, k: 1.4, density: 2000, cp: 1000 },
  { label: 'Concrete slab', thicknessM: 0.12, k: 1.7, density: 2300, cp: 880 },
  { label: 'Floor insulation', thicknessM: 0.08, k: 0.035, density: 30, cp: 1400 },
];
export const DEFAULT_MODEL: ModelConfig = {
  quality: 'balanced', floor: { boundary: 'ground', temperatureC: 10, layers: DEFAULT_FLOOR_LAYERS },
  environment: { preset: 'constant', windMps: 0, windDirectionDeg: 0, orientationDeg: 0, solarWm2: 0,
    diffuseWm2: 0, sunElevationDeg: 35, sunAzimuthDeg: 180, startHour: 12, skyOffsetC: 6 },
  leakageACH: 0.2, radiation: true,
};
const object = (v: unknown): Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const number = (v: unknown, fallback: number, min: number, max: number) => typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : fallback;
const choice = <T extends string>(v: unknown, options: readonly T[], fallback: T): T => options.includes(v as T) ? v as T : fallback;
export function sanitizeLayers(v: unknown, fallback: ThermalLayer[]): ThermalLayer[] {
  if (!Array.isArray(v) || !v.length) return fallback.map((l) => ({ ...l }));
  const layers = v.slice(0, 12).filter((l) => l !== null && typeof l === 'object').map((v) => {
    const l = object(v);
    return { label: typeof l.label === 'string' ? l.label.slice(0, 60) : 'Layer', thicknessM: number(l.thicknessM, 0.1, 0.001, 2),
      k: number(l.k, 1, 0.005, 400), density: number(l.density, 1000, 1, 23000), cp: number(l.cp, 1000, 100, 5000) };
  });
  return layers.length ? layers : fallback.map((l) => ({ ...l }));
}
export function sanitizeModel(v: unknown): ModelConfig {
  const m = object(v), floor = object(m.floor), env = object(m.environment), d = DEFAULT_MODEL.environment;
  return {
    quality: choice(m.quality, ['fast', 'coarse', 'balanced', 'fine'], 'balanced'),
    floor: { boundary: choice(floor.boundary, ['ground', 'outside', 'adjacent'], 'ground'), temperatureC: number(floor.temperatureC, 10, -50, 60),
      layers: sanitizeLayers(floor.layers, DEFAULT_FLOOR_LAYERS) },
    ...(Array.isArray(m.wallLayers) ? { wallLayers: sanitizeLayers(m.wallLayers, []) } : {}),
    ...(Array.isArray(m.roofLayers) ? { roofLayers: sanitizeLayers(m.roofLayers, []) } : {}),
    environment: {
      preset: choice(env.preset, ['constant', 'clear-day', 'cold-day'], 'constant'),
      windMps: number(env.windMps, d.windMps, 0, 40), windDirectionDeg: number(env.windDirectionDeg, d.windDirectionDeg, 0, 360),
      orientationDeg: number(env.orientationDeg, d.orientationDeg, 0, 360), solarWm2: number(env.solarWm2, d.solarWm2, 0, 1400),
      diffuseWm2: number(env.diffuseWm2, d.diffuseWm2, 0, 600), sunElevationDeg: number(env.sunElevationDeg, d.sunElevationDeg, -90, 90),
      sunAzimuthDeg: number(env.sunAzimuthDeg, d.sunAzimuthDeg, 0, 360), startHour: number(env.startHour, d.startHour, 0, 24),
      skyOffsetC: number(env.skyOffsetC, d.skyOffsetC, 0, 40),
    }, leakageACH: number(m.leakageACH, 0.2, 0, 10), radiation: m.radiation !== false,
  };
}
/** Missing settings signify an imported legacy room; preserve its boundary intent. */
export function getModel(room: RoomConfig): ModelConfig {
  if (room.model) return sanitizeModel(room.model);
  return { ...sanitizeModel(DEFAULT_MODEL), floor: { boundary: 'outside', temperatureC: room.outsideC, layers: wallLayers(room) }, leakageACH: 0 };
}
export function wallLayers(room: RoomConfig): ThermalLayer[] {
  if (room.model?.wallLayers?.length) return room.model.wallLayers;
  const materials = { brick: [0.77, 1800, 840], concrete: [1.7, 2300, 880], wood: [0.13, 550, 1600], aerated: [0.16, 600, 1000] };
  const [k, density, cp] = materials[room.wall.material] ?? materials.brick;
  const layers: ThermalLayer[] = [{ label: room.wall.material, thicknessM: room.wall.thicknessM, k, density, cp }];
  if (room.wall.insulationM > 0) layers.push({ label: room.wall.insulation, thicknessM: room.wall.insulationM,
    k: { mineral: 0.04, eps: 0.035, pir: 0.022 }[room.wall.insulation] ?? 0.04, density: room.wall.insulation === 'mineral' ? 40 : 30, cp: 1400 });
  return layers;
}
export function roofLayers(room: RoomConfig): ThermalLayer[] {
  if (room.model?.roofLayers?.length) return room.model.roofLayers;
  const layers = [{ label: 'Ceiling board', thicknessM: 0.013, k: 0.25, density: 800, cp: 1090 },
    { label: 'Roof deck', thicknessM: 0.02, k: 0.13, density: 550, cp: 1600 }];
  if (room.roof.insulationM > 0) layers.push({ label: 'Roof insulation', thicknessM: room.roof.insulationM, k: 0.04, density: 40, cp: 1400 });
  return layers;
}
export function floorLayers(room: RoomConfig): ThermalLayer[] { return getModel(room).floor.layers; }
export function emitterPreset(kind: EmitterConfig['kind']): EmitterConfig {
  return kind === 'radiator' ? { kind, widthM: 1, heightM: 0.6, depthM: 0.1, capacityJPerK: 30000, emissivity: 0.9 }
    : kind === 'convector' ? { kind, widthM: 0.8, heightM: 0.4, depthM: 0.12, capacityJPerK: 8000, emissivity: 0.15 }
    : { kind: 'ideal', widthM: 0.1, heightM: 0.1, depthM: 0.1, capacityJPerK: 0, emissivity: 0 };
}
export function sanitizeEmitter(v: unknown): EmitterConfig | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const e = object(v), kind = choice(e.kind, ['ideal', 'radiator', 'convector'], 'ideal'), d = emitterPreset(kind);
  return { kind, widthM: number(e.widthM, d.widthM, 0.05, 4), heightM: number(e.heightM, d.heightM, 0.05, 3),
    depthM: number(e.depthM, d.depthM, 0.02, 1), capacityJPerK: number(e.capacityJPerK, d.capacityJPerK, kind === 'ideal' ? 0 : 1, 1e6),
    emissivity: number(e.emissivity, d.emissivity, 0, 1) };
}
export function getEmitter(source: HeatSource): EmitterConfig { return source.emitter ?? emitterPreset('ideal'); }
export function sanitizeSensor(v: unknown, widthM: number, heightM: number, ceilingM: number): SensorConfig | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const s = object(v);
  return { mode: choice(s.mode, ['average', 'point'], 'average'), x: number(s.x, widthM / 2, 0, widthM),
    y: number(s.y, heightM / 2, 0, heightM), z: number(s.z, Math.min(1.1, ceilingM), 0, ceilingM), lagSeconds: number(s.lagSeconds, 0, 0, 3600) };
}

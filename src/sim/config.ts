export interface RoomConfig {
  widthM: number;
  heightM: number;
  powerKW: number;
  /** Wall U-value in W/m²K. Lower means better insulation. */
  uValue: number;
  sourceX: number;
  sourceY: number;
}

export interface PhysicsParams {
  outsideC: number;
  initialC: number;
  /** Effective (turbulence-boosted) diffusivity of room air, m²/s. */
  alpha: number;
  /** Room height used to turn the 2D slice into a volume, m. */
  depthM: number;
  /** Multiplier on air heat capacity to account for furniture and wall surfaces. */
  massFactor: number;
  airDensity: number;
  airCp: number;
}

export const LIMITS = {
  size: { min: 2, max: 10, step: 0.1 },
  power: { min: 0, max: 10, step: 0.1 },
  u: { min: 0.2, max: 3.0 },
} as const;

export const DEFAULT_ROOM: RoomConfig = {
  widthM: 5,
  heightM: 4,
  powerKW: 1.5,
  uValue: 1.0,
  sourceX: 2.5,
  sourceY: 2,
};

export const DEFAULT_PHYSICS: PhysicsParams = {
  outsideC: 0,
  initialC: 20,
  alpha: 0.02,
  depthM: 2.5,
  massFactor: 5,
  airDensity: 1.2,
  airCp: 1005,
};

const clamp = (v: number, lo: number, hi: number) =>
  Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo;

export function sanitizeRoom(c: RoomConfig): RoomConfig {
  const widthM = clamp(c.widthM, LIMITS.size.min, LIMITS.size.max);
  const heightM = clamp(c.heightM, LIMITS.size.min, LIMITS.size.max);
  return {
    widthM,
    heightM,
    powerKW: clamp(c.powerKW, LIMITS.power.min, LIMITS.power.max),
    uValue: clamp(c.uValue, LIMITS.u.min, LIMITS.u.max),
    sourceX: clamp(c.sourceX, 0, widthM),
    sourceY: clamp(c.sourceY, 0, heightM),
  };
}

/** Slider position 0 (poor insulation) .. 1 (excellent) <-> U-value, log scale. */
export function uFromSlider(t: number): number {
  const { min, max } = LIMITS.u;
  return max * Math.pow(min / max, clamp(t, 0, 1));
}

export function sliderFromU(u: number): number {
  const { min, max } = LIMITS.u;
  return Math.log(clamp(u, min, max) / max) / Math.log(min / max);
}

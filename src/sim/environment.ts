import { getOpeningWallIndex, type Opening, type RoomConfig, type WallSide } from './config';
import { furnitureBoxes } from './furniture';
import { getModel } from './model';
import { rayBoxDistance, segmentVisible, STEFAN_BOLTZMANN, type RadiationPatch, type Vec3 } from './radiation';
import { footprintWalls } from './footprint';

export interface EnvironmentState {
  outsideC: number; windMps: number; windDirectionDeg: number; skyC: number;
  /** Direction is already rotated into room coordinates. */
  orientationDeg: 0;
  /** Direct normal irradiance and diffuse horizontal irradiance, W/m². */
  directWm2: number; diffuseWm2: number;
  /** Unit vector toward the sun in room coordinates. z up, +y toward front. */
  sunDirection: Vec3;
  hour: number;
}
const radians = Math.PI / 180;
export function getEnvironment(room: RoomConfig, elapsed: number): EnvironmentState {
  const e = getModel(room).environment;
  const hour = ((e.startHour + (elapsed % 86400) / 3600) % 24 + 24) % 24;
  const daylight = Math.max(0, Math.sin((hour - 6) / 12 * Math.PI));
  const daily = e.preset !== 'constant';
  const cold = e.preset === 'cold-day';
  const elevation = (daily ? daylight * (cold ? 24 : 55) : e.sunElevationDeg) * radians;
  const azimuth = ((daily ? 90 + (hour - 6) * 15 : e.sunAzimuthDeg) - e.orientationDeg) * radians;
  const sunDirection: Vec3 = [Math.sin(azimuth) * Math.cos(elevation), -Math.cos(azimuth) * Math.cos(elevation), Math.sin(elevation)];
  const outsideC = room.outsideC + (daily ? (cold ? 3 : 5) * Math.cos((hour - 15) * Math.PI / 12) : 0);
  return {
    outsideC, orientationDeg: 0,
    windMps: daily ? Math.max(0, e.windMps + (cold ? 2 : 1) * (1 + Math.sin((hour - 9) * Math.PI / 12)) / 2) : e.windMps,
    windDirectionDeg: ((e.windDirectionDeg - e.orientationDeg + (daily ? 15 * Math.sin(hour * Math.PI / 12) : 0)) % 360 + 360) % 360,
    skyC: outsideC - (daily ? (cold ? 4 : 10) : e.skyOffsetC),
    directWm2: elevation > 0 ? (daily ? (cold ? 450 : 800) * daylight : e.solarWm2) : 0,
    diffuseWm2: elevation > 0 ? (daily ? (cold ? 110 : 100) * daylight : e.diffuseWm2) : 0,
    sunDirection, hour,
  };
}

/** Outdoor film excluding longwave radiation, W/(m² K). */
export function exteriorConvection(windMps: number): number { return 5.7 + 3.8 * Math.max(0, windMps); }
/** Flux into an outside surface. Sky factor 1 for horizontal roof, 0.5 for a wall. */
export function exteriorLongwaveW(surfaceC: number, skyC: number, area: number, emissivity = 0.9, skyFactor = 1): number {
  return area * emissivity * skyFactor * STEFAN_BOLTZMANN * ((skyC + 273.15) ** 4 - (surfaceC + 273.15) ** 4);
}
export function wallOutward(side: WallSide): Vec3 {
  return side === 'top' ? [0, -1, 0] : side === 'bottom' ? [0, 1, 0] : side === 'left' ? [-1, 0, 0] : [1, 0, 0];
}
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function openingPoint(room: RoomConfig, opening: Opening, u: number, v: number): Vec3 {
  const wall = footprintWalls(room)[getOpeningWallIndex(room, opening)];
  const along = opening.pos + (u - 0.5) * opening.length;
  const t = along / wall.length;
  const z = opening.sillM + v * opening.heightM;
  return [wall.start.x + (wall.end.x - wall.start.x) * t - wall.normal[0] * 1e-6,
    wall.start.y + (wall.end.y - wall.start.y) * t - wall.normal[1] * 1e-6, z];
}
function openingOutward(room: RoomConfig, opening: Opening): Vec3 {
  const wall = footprintWalls(room)[getOpeningWallIndex(room, opening)];
  return [wall.normal[0], wall.normal[1], 0];
}
function rayPatch(origin: Vec3, direction: Vec3, p: RadiationPatch): number | null {
  const denom = dot(direction, p.normal);
  if (denom >= -1e-10) return null;
  const r: Vec3 = [p.center[0] - origin[0], p.center[1] - origin[1], p.center[2] - origin[2]];
  const distance = dot(r, p.normal) / denom;
  if (distance <= 1e-5) return null;
  const local: Vec3 = [origin[0] + direction[0] * distance - p.center[0], origin[1] + direction[1] * distance - p.center[1], origin[2] + direction[2] * distance - p.center[2]];
  if (p.tangentU && p.tangentV) {
    if (Math.abs(dot(local, p.tangentU)) > dot(p.tangentU, p.tangentU) + 1e-8 ||
      Math.abs(dot(local, p.tangentV)) > dot(p.tangentV, p.tangentV) + 1e-8) return null;
  } else if (dot(local, local) > p.area / 2) return null;
  return distance;
}
export interface SolarGains { patchW: Float64Array; furnitureW: Map<number, number>; transmittedW: number; escapedW: number }

/** Deterministic 5x5 aperture sampling. Direct rays heat their first solid target,
 * including exact furniture components; diffuse sky gains are distributed by visible projected area.
 * Rectangular patches should supply tangentU/V half-edge vectors.
 */
export function traceSolar(room: RoomConfig, environment: EnvironmentState, patches: readonly RadiationPatch[]): SolarGains {
  const patchW = new Float64Array(patches.length), furnitureW = new Map<number, number>();
  let transmittedW = 0, escapedW = 0;
  const boxes = room.furniture.flatMap(furnitureBoxes);
  const direction: Vec3 = [-environment.sunDirection[0], -environment.sunDirection[1], -environment.sunDirection[2]];
  for (const window of room.openings) {
    if (window.kind !== 'window') continue;
    const transmittance = window.open ? 1 : window.solarTransmittance ?? 0.6;
    const area = window.length * window.heightM;
    const direct = transmittance * area * environment.directWm2 * Math.max(0, dot(openingOutward(room, window), environment.sunDirection));
    transmittedW += direct;
    if (direct > 0) for (let u = 0; u < 5; u++) for (let v = 0; v < 5; v++) {
      const origin = openingPoint(room, window, (u + 0.5) / 5, (v + 0.5) / 5);
      let distance = Infinity, target = -1, furnitureId = -1;
      for (let i = 0; i < patches.length; i++) {
        const hit = rayPatch(origin, direction, patches[i]);
        if (hit !== null && hit < distance) { distance = hit; target = i; }
      }
      for (const box of boxes) {
        const hit = rayBoxDistance(origin, direction, box);
        if (hit !== null && hit < distance) { distance = hit; furnitureId = box.id; target = -1; }
      }
      if (furnitureId >= 0) furnitureW.set(furnitureId, (furnitureW.get(furnitureId) ?? 0) + direct / 25);
      else if (target >= 0 && !patches[target].solarTransparent) patchW[target] += direct / 25;
      else escapedW += direct / 25;
    }
    const diffuse = transmittance * area * environment.diffuseWm2 / 2;
    transmittedW += diffuse;
    if (diffuse > 0) {
      const center = openingPoint(room, window, 0.5, 0.5);
      const weights = patches.map(p => {
        const r: Vec3 = [center[0] - p.center[0], center[1] - p.center[1], center[2] - p.center[2]];
        const r2 = dot(r, r);
        return r2 > 1e-8 && segmentVisible(center, p.center, boxes) ? p.area * Math.max(0, dot(p.normal, r)) / r2 ** 1.5 : 0;
      });
      // Visible furniture receives diffuse energy too; opaque boxes do not delete it.
      const furnitureWeights = room.furniture.map(f => {
        let weight = 0;
        for (const b of boxes.filter(b => b.id === f.id)) {
          const c: Vec3 = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
          const r2 = c.reduce((sum, t, i) => sum + (t - center[i]) ** 2, 0);
          const dx = b.max[0] - b.min[0], dy = b.max[1] - b.min[1], dz = b.max[2] - b.min[2];
          weight += (dx * dy + dx * dz + dy * dz) / Math.max(0.01, r2);
        }
        return weight;
      });
      const total = weights.reduce((s, w) => s + w, 0) + furnitureWeights.reduce((s, w) => s + w, 0);
      if (total > 0) {
        weights.forEach((w, i) => {
          if (patches[i].solarTransparent) escapedW += diffuse * w / total;
          else patchW[i] += diffuse * w / total;
        });
        furnitureWeights.forEach((w, i) => furnitureW.set(room.furniture[i].id, (furnitureW.get(room.furniture[i].id) ?? 0) + diffuse * w / total));
      } else escapedW += diffuse;
    }
  }
  return { patchW, furnitureW, transmittedW, escapedW };
}

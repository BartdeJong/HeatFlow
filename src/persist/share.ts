import {
  DEFAULT_ROOM,
  FURNITURE_PRESETS,
  FURNITURE_MATERIALS,
  INSULATIONS,
  OPENING_KINDS,
  ROOF_MATERIALS,
  SIDES,
  SOURCE_KINDS,
  WALL_MATERIALS,
  legacyRoom,
  coerceRoom,
  sanitizeRoom,
  type RoomConfig,
} from '../sim/config';

const VERSION = 5;

const r = (v: number, d = 3) => Number(v.toFixed(d));
const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const allNums = (a: unknown[]) => a.every(isNum);

/** Encode a room as a compact URL-safe string. */
export function encodeRoom(room: RoomConfig): string {
  const arr = [
    VERSION,
    r(room.widthM),
    r(room.heightM),
    room.convection ? 1 : 0,
    WALL_MATERIALS.findIndex((m) => m.id === room.wall.material),
    r(room.wall.thicknessM),
    INSULATIONS.findIndex((m) => m.id === room.wall.insulation),
    r(room.wall.insulationM),
    room.sources.map((s) => [SOURCE_KINDS.indexOf(s.kind), r(s.x), r(s.y), r(s.z), r(s.powerKW)]),
    room.openings.map((o) => [
      OPENING_KINDS.indexOf(o.kind),
      SIDES.findIndex((s) => s.id === o.side),
      r(o.pos),
      r(o.length),
      o.open ? 1 : 0,
      r(o.heightM),
      r(o.sillM),
    ]),
    room.probes.map((p) => [r(p.x), r(p.y), r(p.z)]),
    r(room.ceilingM),
    r(room.outsideC),
    room.furniture.map((f) => [FURNITURE_PRESETS.findIndex((p) => p.id === f.kind), FURNITURE_MATERIALS.findIndex((m) => m.id === f.material),
      r(f.x), r(f.y), r(f.widthM), r(f.depthM), r(f.heightM), f.rotation]),
    r(room.roof.pitchDeg), r(room.roof.insulationM), ROOF_MATERIALS.findIndex((m) => m.id === room.roof.material),
    room.thermostat.enabled ? 1 : 0, r(room.thermostat.targetC), r(room.thermostat.deadbandC), room.heatingMode === 'underfloor' ? 1 : 0,
  ];
  const b64 = btoa(JSON.stringify(arr));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function rows(v: unknown, width: number): number[][] | null {
  if (!Array.isArray(v)) return null;
  const out: number[][] = [];
  for (const row of v) {
    if (!Array.isArray(row) || row.length !== width || !allNums(row)) return null;
    out.push(row as number[]);
  }
  return out;
}

/** Decode and validate; returns null if the input is not a valid room. */
export function decodeRoom(code: string): RoomConfig | null {
  try {
    const b64 = code.replace(/-/g, '+').replace(/_/g, '/');
    const arr: unknown = JSON.parse(atob(b64));
    if (!Array.isArray(arr)) return null;

    if (arr[0] === 1) {
      if (arr.length !== 7 || !allNums(arr)) return null;
      const [, w, h, p, u, sx, sy] = arr as number[];
      return legacyRoom(w, h, p, u, sx, sy);
    }

    const current = arr[0] === VERSION;
    const furnished = current || arr[0] === 4;
    const volumetric = furnished || arr[0] === 3;
    if ((!volumetric && arr[0] !== 2) || arr.length < 11 || arr.length > (current || arr[0] === 2 ? 21 : furnished ? 14 : 13)) return null;
    if (volumetric && arr.length !== (current ? 21 : furnished ? 14 : 13)) return null;
    const head = arr.slice(1, 8);
    if (!allNums(head)) return null;
    const [widthM, heightM, conv, mat, thick, ins, insM] = head as number[];
    const sources = rows(arr[8], volumetric ? 5 : 4);
    const openings = rows(arr[9], volumetric ? 7 : 5);
    const probes = rows(arr[10], volumetric ? 3 : 2);
    if (!sources || !openings || !probes) return null;
    if (arr.length >= 12 && !isNum(arr[11])) return null;
    if (arr.length >= 13 && !isNum(arr[12])) return null;
    const ceilingM = arr.length >= 12 ? (arr[11] as number) : undefined;
    const outsideC = arr.length >= 13 ? (arr[12] as number) : undefined;
    const furniture = furnished ? rows(arr[13], 8) : [];
    if (!furniture) return null;
    const extras = current ? arr.slice(14, 21) : !volumetric ? arr.slice(13, 19) : [];
    if (!allNums(extras)) return null;
    const [pitchDeg, roofInsM, roofMat, thermostatEnabled, thermostatTargetC, thermostatDeadbandC, heatingMode] = extras as (number | undefined)[];
    if (!volumetric && arr.length > 20 && !isNum(arr[20])) return null;
    const legacyFurniture = !volumetric && arr.length > 19 ? rows(arr[19], 2) : [];
    if (!legacyFurniture) return null;

    if (!volumetric && arr.length > 13) return coerceRoom({
      widthM, heightM, ceilingM, outsideC, convection: conv === 1,
      wall: { material: WALL_MATERIALS[mat]?.id, thicknessM: thick, insulation: INSULATIONS[ins]?.id, insulationM: insM },
      roof: { pitchDeg, insulationM: roofInsM, material: ROOF_MATERIALS[roofMat ?? -1]?.id },
      thermostat: { enabled: thermostatEnabled === 1, targetC: thermostatTargetC, deadbandC: thermostatDeadbandC },
      heatingMode: arr[20] === 1 ? 'underfloor' : 'point',
      sources: sources.map(([k, x, y, powerKW], i) => ({ id: i + 1, kind: SOURCE_KINDS[k], x, y, powerKW })),
      probes: probes.map(([x, y], i) => ({ id: i + 1, x, y })),
      openings: openings.map(([k, side, pos, length, open], i) => ({ id: i + 1, kind: OPENING_KINDS[k], side: SIDES[side]?.id, pos, length, open: open === 1 })),
      furniture: legacyFurniture.map(([kind, x], i) => ({ id: i + 1, kind: FURNITURE_PRESETS[kind]?.id, x })),
    });

    return sanitizeRoom({
      widthM,
      heightM,
      ceilingM,
      outsideC,
      roof: { pitchDeg, insulationM: roofInsM, material: ROOF_MATERIALS[roofMat ?? -1]?.id },
      thermostat: {
        enabled: thermostatEnabled === 1,
        targetC: thermostatTargetC,
        deadbandC: thermostatDeadbandC,
      },
      heatingMode: (current ? heatingMode : arr[20]) === 1 ? 'underfloor' : 'point',
      convection: conv === 1,
      wall: {
        material: WALL_MATERIALS[mat]?.id,
        thicknessM: thick,
        insulation: INSULATIONS[ins]?.id,
        insulationM: insM,
      },
      sources: sources.map(([k, x, y, fourth, fifth], i) => ({
        id: i + 1,
        kind: SOURCE_KINDS[k],
        x,
        y,
        z: volumetric ? fourth : 0.4,
        powerKW: volumetric ? fifth : fourth,
      })),
      openings: openings.map(([k, s, pos, length, open, height, sill], i) => ({
        id: i + 1,
        kind: OPENING_KINDS[k],
        side: SIDES[s]?.id,
        pos,
        length,
        open: open === 1,
        heightM: volumetric ? height : OPENING_KINDS[k] === 'door' ? 2.1 : 1.2,
        sillM: volumetric ? sill : OPENING_KINDS[k] === 'door' ? 0 : 0.8,
      })),
      probes: probes.map(([x, y, z], i) => ({ id: i + 1, x, y, z: volumetric ? z : (ceilingM ?? DEFAULT_ROOM.ceilingM) / 2 })),
      furniture: !volumetric ? legacyFurniture.map(([kind, x], i) => ({
        ...FURNITURE_PRESETS[kind], id: i + 1, kind: FURNITURE_PRESETS[kind]?.id, x, y: heightM / 2, rotation: 0 as const,
      })) : furniture.map(([kind, material, x, y, widthM, depthM, heightM, rotation], i) => ({
        id: i + 1, kind: FURNITURE_PRESETS[kind]?.id, material: FURNITURE_MATERIALS[material]?.id,
        x, y, widthM, depthM, heightM, rotation: rotation === 90 ? 90 : 0,
      })),
    });
  } catch {
    return null;
  }
}

export function shareUrl(room: RoomConfig, base: string = location.href): string {
  const url = new URL(base);
  url.hash = `c=${encodeRoom(room)}`;
  return url.toString();
}

export function roomFromHash(hash: string): RoomConfig | null {
  const m = /^#?c=([A-Za-z0-9_-]+)$/.exec(hash);
  return m ? decodeRoom(m[1]) : null;
}

export { DEFAULT_ROOM };

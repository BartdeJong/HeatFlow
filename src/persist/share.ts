import {
  DEFAULT_ROOM,
  INSULATIONS,
  OPENING_KINDS,
  ROOF_MATERIALS,
  SIDES,
  SOURCE_KINDS,
  WALL_MATERIALS,
  legacyRoom,
  sanitizeRoom,
  type RoomConfig,
} from '../sim/config';

const VERSION = 2;

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
    room.sources.map((s) => [SOURCE_KINDS.indexOf(s.kind), r(s.x), r(s.y), r(s.powerKW)]),
    room.openings.map((o) => [
      OPENING_KINDS.indexOf(o.kind),
      SIDES.findIndex((s) => s.id === o.side),
      r(o.pos),
      r(o.length),
      o.open ? 1 : 0,
    ]),
    room.probes.map((p) => [r(p.x), r(p.y)]),
    r(room.ceilingM),
    r(room.outsideC),
    r(room.roof.pitchDeg),
    r(room.roof.insulationM),
    ROOF_MATERIALS.findIndex((m) => m.id === room.roof.material),
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

    if (arr[0] !== VERSION || arr.length < 11 || arr.length > 16) return null;
    const head = arr.slice(1, 8);
    if (!allNums(head)) return null;
    const [widthM, heightM, conv, mat, thick, ins, insM] = head as number[];
    const sources = rows(arr[8], 4);
    const openings = rows(arr[9], 5);
    const probes = rows(arr[10], 2);
    if (!sources || !openings || !probes) return null;
    // Optional trailing fields, appended over time: ceiling, outside, roof pitch, roof insulation, roof material.
    const extra = arr.slice(11);
    if (!allNums(extra)) return null;
    const [ceilingM, outsideC, pitchDeg, roofInsM, roofMat] = extra as (number | undefined)[];

    return sanitizeRoom({
      widthM,
      heightM,
      ceilingM,
      outsideC,
      roof: { pitchDeg, insulationM: roofInsM, material: ROOF_MATERIALS[roofMat ?? -1]?.id },
      convection: conv === 1,
      wall: {
        material: WALL_MATERIALS[mat]?.id,
        thicknessM: thick,
        insulation: INSULATIONS[ins]?.id,
        insulationM: insM,
      },
      sources: sources.map(([k, x, y, powerKW], i) => ({
        id: i + 1,
        kind: SOURCE_KINDS[k],
        x,
        y,
        powerKW,
      })),
      openings: openings.map(([k, s, pos, length, open], i) => ({
        id: i + 1,
        kind: OPENING_KINDS[k],
        side: SIDES[s]?.id,
        pos,
        length,
        open: open === 1,
      })),
      probes: probes.map(([x, y], i) => ({ id: i + 1, x, y })),
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

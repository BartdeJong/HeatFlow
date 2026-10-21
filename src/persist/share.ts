import { DEFAULT_ROOM, sanitizeRoom, type RoomConfig } from '../sim/config';

const VERSION = 1;

const r = (v: number, d = 3) => Number(v.toFixed(d));

/** Encode a room as a compact URL-safe string. */
export function encodeRoom(room: RoomConfig): string {
  const arr = [
    VERSION,
    r(room.widthM),
    r(room.heightM),
    r(room.powerKW),
    r(room.uValue),
    r(room.sourceX),
    r(room.sourceY),
  ];
  const b64 = btoa(JSON.stringify(arr));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Decode and validate; returns null if the input is not a valid room. */
export function decodeRoom(code: string): RoomConfig | null {
  try {
    const b64 = code.replace(/-/g, '+').replace(/_/g, '/');
    const arr: unknown = JSON.parse(atob(b64));
    if (!Array.isArray(arr) || arr.length !== 7 || arr[0] !== VERSION) return null;
    const nums = arr.slice(1);
    if (!nums.every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
    const [widthM, heightM, powerKW, uValue, sourceX, sourceY] = nums as number[];
    return sanitizeRoom({ widthM, heightM, powerKW, uValue, sourceX, sourceY });
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

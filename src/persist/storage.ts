import { coerceRoom, type RoomConfig } from '../sim/config';

const KEY = 'heatflow.rooms.v1';

export type SavedRooms = Record<string, RoomConfig>;

export function listSavedRooms(): SavedRooms {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    const out: SavedRooms = Object.create(null);
    for (const [name, v] of Object.entries(parsed)) {
      const room = coerceRoom(v);
      if (room) out[name] = room;
    }
    return out;
  } catch {
    return {};
  }
}

/** Returns false if storage is unavailable or full. */
export function saveRoom(name: string, room: RoomConfig): boolean {
  try {
    const all = listSavedRooms();
    all[name] = room;
    localStorage.setItem(KEY, JSON.stringify(all));
    return true;
  } catch {
    return false;
  }
}

export function deleteRoom(name: string): void {
  try {
    const all = listSavedRooms();
    delete all[name];
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* storage unavailable */
  }
}

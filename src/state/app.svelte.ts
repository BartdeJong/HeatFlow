import { DEFAULT_ROOM, sanitizeRoom, type RoomConfig } from '../sim/config';
import { roomFromHash } from '../persist/share';

export const SPEEDS = [30, 100, 300, 1000] as const;

function initialRoom(): RoomConfig {
  return roomFromHash(location.hash) ?? { ...DEFAULT_ROOM };
}

export const app = $state({
  room: initialRoom(),
  running: true,
  speed: 300 as number,
  /** Incremented to request a simulation reset. */
  resetToken: 0,
  stats: { elapsed: 0, min: 20, max: 20, mean: 20, tMin: 0, tMax: 30 },
});

export function updateRoom(patch: Partial<RoomConfig>): void {
  app.room = sanitizeRoom({ ...app.room, ...patch });
}

export function setRoom(room: RoomConfig): void {
  app.room = sanitizeRoom(room);
  app.resetToken++;
}

export function resetSimulation(): void {
  app.resetToken++;
}

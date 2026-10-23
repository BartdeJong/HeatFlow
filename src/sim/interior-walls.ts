import type { InteriorWall, RoomConfig } from './config';
import { footprintCellArea, footprintWalls } from './footprint';

type Bounds = { x0: number; x1: number; y0: number; y1: number };
const EPSILON = 1e-6;

export function interiorWallBounds(wall: InteriorWall): Bounds {
  const horizontal = wall.start.y === wall.end.y;
  const halfThickness = wall.thicknessM / 2;
  return horizontal
    ? {
      x0: Math.min(wall.start.x, wall.end.x),
      x1: Math.max(wall.start.x, wall.end.x),
      y0: wall.start.y - halfThickness,
      y1: wall.start.y + halfThickness,
    }
    : {
      x0: wall.start.x - halfThickness,
      x1: wall.start.x + halfThickness,
      y0: Math.min(wall.start.y, wall.end.y),
      y1: Math.max(wall.start.y, wall.end.y),
    };
}

function intervalGap(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, b0 - a1, a0 - b1);
}

function wallGap(bounds: Bounds, wall: InteriorWall): number {
  if (wall.start.x === wall.end.x) {
    return Math.hypot(
      intervalGap(bounds.x0, bounds.x1, wall.start.x, wall.start.x),
      intervalGap(bounds.y0, bounds.y1, Math.min(wall.start.y, wall.end.y), Math.max(wall.start.y, wall.end.y)),
    );
  }
  return Math.hypot(
    intervalGap(bounds.x0, bounds.x1, Math.min(wall.start.x, wall.end.x), Math.max(wall.start.x, wall.end.x)),
    intervalGap(bounds.y0, bounds.y1, wall.start.y, wall.start.y),
  );
}

export function interiorWallPlacementError(
  room: Pick<RoomConfig, 'widthM' | 'heightM' | 'footprint' | 'interiorWalls'>,
  wall: InteriorWall,
  excludeId?: number,
): string | null {
  const horizontal = wall.start.y === wall.end.y;
  const vertical = wall.start.x === wall.end.x;
  const length = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y);
  if (horizontal === vertical || !Number.isFinite(length) || length < 0.1 ||
    !Number.isFinite(wall.thicknessM) || wall.thicknessM <= 0) {
    return 'Interior walls must be straight, axis-aligned, and at least 0.1 m long.';
  }

  const bounds = interiorWallBounds(wall);
  if (bounds.x0 < 0 || bounds.y0 < 0 || bounds.x1 > room.widthM || bounds.y1 > room.heightM) {
    return 'Keep the full wall inside the room.';
  }
  const area = (bounds.x1 - bounds.x0) * (bounds.y1 - bounds.y0);
  if (footprintCellArea(room, bounds.x0, bounds.y0, bounds.x1, bounds.y1) < area - EPSILON) {
    return 'Keep the full wall inside the room outline.';
  }
  if (footprintWalls(room).some((boundary) => wallGap(bounds, {
    id: -1, start: boundary.start, end: boundary.end, thicknessM: 0,
  }) < EPSILON)) {
    return 'New interior walls must be free-standing and not touch the room boundary.';
  }
  if ((room.interiorWalls ?? []).some((other) => other.id !== excludeId && wallGap(bounds, other) < EPSILON)) {
    return 'New interior walls must be free-standing and not touch another wall.';
  }
  return null;
}

import { describe, expect, it } from 'vitest';
import { DEFAULT_ROOM, sanitizeRoom } from './config';
import { interiorWallPlacementError } from './interior-walls';

const room = () => sanitizeRoom({
  ...DEFAULT_ROOM,
  widthM: 5,
  heightM: 4,
  footprint: undefined,
  interiorWalls: [],
  furniture: [],
});

describe('free-standing interior walls', () => {
  it('accepts a snapped horizontal or vertical wall inside the room', () => {
    const config = room();
    expect(interiorWallPlacementError(config, {
      id: 1, start: { x: 1, y: 2 }, end: { x: 3, y: 2 }, thicknessM: 0.1,
    })).toBeNull();
    expect(interiorWallPlacementError(config, {
      id: 2, start: { x: 2, y: 1 }, end: { x: 2, y: 3 }, thicknessM: 0.1,
    })).toBeNull();
  });

  it('rejects walls that touch the boundary, another wall, or leave the outline', () => {
    const config = room();
    expect(interiorWallPlacementError(config, {
      id: 1, start: { x: 1, y: 0.05 }, end: { x: 3, y: 0.05 }, thicknessM: 0.1,
    })).toContain('free-standing');
    expect(interiorWallPlacementError({
      ...config,
      interiorWalls: [{ id: 2, start: { x: 2, y: 1 }, end: { x: 2, y: 3 }, thicknessM: 0.1 }],
    }, {
      id: 1, start: { x: 1, y: 2 }, end: { x: 3, y: 2 }, thicknessM: 0.1,
    })).toContain('another wall');
    expect(interiorWallPlacementError(config, {
      id: 1, start: { x: 4.8, y: 2 }, end: { x: 5.2, y: 2 }, thicknessM: 0.1,
    })).toContain('inside the room');
  });
});

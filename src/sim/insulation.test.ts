import { describe, expect, it } from 'vitest';
import { DEFAULT_ROOM, sanitizeRoom } from './config';
import { floorLayers, getModel } from './model';
import { applyInsulationLevel, matchingInsulationLevel } from './insulation';

describe('general insulation levels', () => {
  it('matches and applies the coordinated wall, roof, and floor thicknesses', () => {
    const room = applyInsulationLevel(structuredClone(DEFAULT_ROOM), 'good');

    expect(room.wall.insulationM).toBe(0.1);
    expect(room.roof.insulationM).toBe(0.2);
    expect(floorLayers(room).find((layer) => layer.label === 'Floor insulation')?.thicknessM).toBe(0.08);
    expect(floorLayers(room).map((layer) => layer.label)).toEqual(['Screed', 'Concrete slab', 'Floor insulation']);
    expect(matchingInsulationLevel(room)).toBe('good');
  });

  it('removes floor insulation for None and retains the other construction layers', () => {
    const room = applyInsulationLevel(structuredClone(DEFAULT_ROOM), 'none');

    expect(room.wall.insulationM).toBe(0);
    expect(room.roof.insulationM).toBe(0);
    expect(floorLayers(room).map((layer) => layer.label)).toEqual(['Screed', 'Concrete slab']);
    expect(matchingInsulationLevel(room)).toBe('none');
  });

  it('preserves legacy floor boundary intent when applying a level', () => {
    const legacyRoom = sanitizeRoom({ ...DEFAULT_ROOM, model: undefined });
    const updatedRoom = applyInsulationLevel(legacyRoom, 'basic');

    expect(getModel(updatedRoom).floor.boundary).toBe('outside');
    expect(matchingInsulationLevel(updatedRoom)).toBe('basic');
  });

  it('does not label mixed custom insulation values as a preset', () => {
    const room = structuredClone(DEFAULT_ROOM);
    room.wall.insulationM = 0.07;

    expect(matchingInsulationLevel(room)).toBeUndefined();
  });
});

import { describe, expect, it } from 'vitest';
import { DEFAULT_PHYSICS, DEFAULT_ROOM, sanitizeRoom } from './config';
import { footprintCellArea, footprintContains, footprintRectangles, footprintWalls, isValidFootprint, polygonArea, roomFootprint } from './footprint';
import { GridGeometry } from './grid';
import { buildSurfaces } from './surfaces';
import { solveVentilation } from './ventilation';
import { DEFAULT_MODEL } from './model';
import { Simulation } from './simulation';

describe('orthogonal room footprints', () => {
  it('uses a connected L-shaped default and measures its exact floor area', () => {
    expect(isValidFootprint(DEFAULT_ROOM.footprint, DEFAULT_ROOM.widthM, DEFAULT_ROOM.heightM)).toBe(true);
    expect(polygonArea(roomFootprint(DEFAULT_ROOM))).toBe(17.5);
    expect(footprintContains(DEFAULT_ROOM, 2, 3)).toBe(true);
    expect(footprintContains(DEFAULT_ROOM, 4, 3)).toBe(false);
  });

  it('rejects diagonal, crossing and out-of-bounds outlines', () => {
    expect(isValidFootprint([{ x: 0, y: 0 }, { x: 5, y: 1 }, { x: 5, y: 4 }, { x: 0, y: 4 }], 5, 4)).toBe(false);
    expect(isValidFootprint([
      { x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 4 }, { x: 2, y: 4 },
      { x: 2, y: 2 }, { x: 4, y: 2 }, { x: 4, y: 3 }, { x: 1, y: 3 }, { x: 1, y: 4 }, { x: 0, y: 4 },
    ], 5, 4)).toBe(false);
    expect(isValidFootprint([{ x: 1, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 4 }, { x: 0, y: 4 }], 5, 4)).toBe(false);
    expect(sanitizeRoom({ ...DEFAULT_ROOM, footprint: [{ x: 0, y: 0 }, { x: 5, y: 1 }] }).footprint)
      .toEqual([{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 4 }, { x: 0, y: 4 }]);
  });

  it('clips mesh air, horizontal faces and floor patches to the outline', () => {
    const grid = new GridGeometry(DEFAULT_ROOM, 10, 8, 5);
    expect(grid.volume.reduce((sum, value) => sum + value, 0)).toBeCloseTo(17.5 * DEFAULT_ROOM.ceilingM, 10);
    const wallArea = footprintWalls(DEFAULT_ROOM).reduce((sum, wall) => sum + wall.length * DEFAULT_ROOM.ceilingM, 0);
    const surfaceArea = buildSurfaces(DEFAULT_ROOM, 20).filter((surface) => surface.kind !== 'emitter')
      .reduce((sum, surface) => sum + surface.area, 0);
    expect(surfaceArea).toBeCloseTo(2 * 17.5 + wallArea, 10);
    expect(footprintRectangles(DEFAULT_ROOM).reduce((sum, rect) => sum +
      footprintCellArea(DEFAULT_ROOM, rect.x0, rect.y0, rect.x1, rect.y1), 0)).toBeCloseTo(17.5, 10);
  });

  it('round-trips custom footprints and keeps legacy rooms rectangular', () => {
    const shaped = sanitizeRoom({ ...DEFAULT_ROOM });
    const restored = sanitizeRoom(JSON.parse(JSON.stringify(shaped)));
    expect(restored.footprint).toEqual(shaped.footprint);
    const legacy = sanitizeRoom({ ...DEFAULT_ROOM, footprint: undefined });
    expect(polygonArea(roomFootprint(legacy))).toBe(legacy.widthM * legacy.heightM);
  });

  it('keeps openings attached to a selected internal wall segment', () => {
    const room = sanitizeRoom({ ...DEFAULT_ROOM, openings: [{
      id: 1, kind: 'window', side: 'top', wallIndex: 3, pos: 0.75, length: 0.8,
      sillM: 0.6, heightM: 1, open: true,
    }] });
    const apertureArea = buildSurfaces(room, 20).filter((surface) => surface.kind === 'aperture')
      .reduce((sum, surface) => sum + surface.area, 0);
    expect(apertureArea).toBeCloseTo(0.8, 10);
    expect(solveVentilation(room, 20, { outsideC: 0, windMps: 2, windDirectionDeg: 90 }).flows)
      .toContainEqual(expect.objectContaining({ wallIndex: 3 }));
  });

  it('runs balanced ventilation through an opening on an internal outline edge', () => {
    const room = sanitizeRoom({ ...DEFAULT_ROOM, convection: false, sources: [], outsideC: 0,
      model: { ...structuredClone(DEFAULT_MODEL), quality: 'fast', radiation: false, leakageACH: 0 },
      openings: [{ id: 1, kind: 'window', side: 'top', wallIndex: 3, pos: 0.75, length: 0.8,
        sillM: 0.5, heightM: 1, open: true }] });
    const simulation = new Simulation(room, { ...DEFAULT_PHYSICS, uScale: 0 });
    simulation.advance(0.1);
    expect(simulation.diagnostics().failure).toBeNull();
    expect(simulation.diagnostics().ventilationACH).toBeGreaterThan(0);
  });
});

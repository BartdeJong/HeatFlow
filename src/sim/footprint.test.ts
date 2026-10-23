import { describe, expect, it } from 'vitest';
import { DEFAULT_PHYSICS, DEFAULT_ROOM, sanitizeRoom } from './config';
import { furnitureBoxes, physicalFurniture } from './furniture';
import { footprintCellArea, footprintContains, footprintRectangles, footprintWalls, isValidFootprint, polygonArea, roomFootprint, simplifyFootprint } from './footprint';
import { GridGeometry } from './grid';
import { buildSurfaces } from './surfaces';
import { solveVentilation } from './ventilation';
import { DEFAULT_MODEL } from './model';
import { Simulation } from './simulation';

describe('orthogonal room footprints', () => {
  it('matches the measured default outline and models its partition with a passage', () => {
    expect(isValidFootprint(DEFAULT_ROOM.footprint, DEFAULT_ROOM.widthM, DEFAULT_ROOM.heightM)).toBe(true);
    expect(DEFAULT_ROOM.widthM).toBe(12.68);
    expect(DEFAULT_ROOM.heightM).toBe(8.99);
    expect(footprintWalls(DEFAULT_ROOM).find((wall) => wall.start.x === 0 && wall.end.x === 0)?.length).toBe(7);
    expect(footprintContains(DEFAULT_ROOM, 2, 3)).toBe(true);
    expect(footprintContains(DEFAULT_ROOM, 5.3, 2.7)).toBe(false);
    expect(footprintContains(DEFAULT_ROOM, 11, 5)).toBe(true);
    expect(footprintContains(DEFAULT_ROOM, 8, 8)).toBe(true);
    expect(DEFAULT_ROOM.interiorWalls).toEqual([
      { id: 1, start: { x: 9.94, y: 2.31 }, end: { x: 9.94, y: 4.13 }, thicknessM: 0.14 },
      { id: 2, start: { x: 9.94, y: 6.01 }, end: { x: 9.94, y: 7 }, thicknessM: 0.14 },
    ]);
  });

  it('migrates legacy segmented dividers into canonical wall segments', () => {
    const migrated = sanitizeRoom({
      ...DEFAULT_ROOM,
      interiorWalls: [{
        id: 9, x: 4.2, thicknessM: 0.14,
        segments: [{ fromY: 1.2, toY: 2.4 }, { fromY: 3.1, toY: 4.8 }],
      }],
    });
    expect(migrated.interiorWalls).toEqual([
      { id: 9, start: { x: 4.2, y: 1.2 }, end: { x: 4.2, y: 2.4 }, thicknessM: 0.14 },
      { id: 10, start: { x: 4.2, y: 3.1 }, end: { x: 4.2, y: 4.8 }, thicknessM: 0.14 },
    ]);
  });

  it('rejects diagonal, crossing and out-of-bounds outlines', () => {
    expect(isValidFootprint([{ x: 0, y: 0 }, { x: 5, y: 1 }, { x: 5, y: 4 }, { x: 0, y: 4 }], 5, 4)).toBe(false);
    expect(isValidFootprint([
      { x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 4 }, { x: 2, y: 4 },
      { x: 2, y: 2 }, { x: 4, y: 2 }, { x: 4, y: 3 }, { x: 1, y: 3 }, { x: 1, y: 4 }, { x: 0, y: 4 },
    ], 5, 4)).toBe(false);
    expect(isValidFootprint([{ x: 1, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 4 }, { x: 0, y: 4 }], 5, 4)).toBe(false);
    expect(sanitizeRoom({ ...DEFAULT_ROOM, footprint: [{ x: 0, y: 0 }, { x: 5, y: 1 }] }).footprint)
      .toEqual([{ x: 0, y: 0 }, { x: 12.68, y: 0 }, { x: 12.68, y: 8.99 }, { x: 0, y: 8.99 }]);
  });

  it('merges coincident and collinear consecutive corners into one wall', () => {
    const outline = [
      { x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 0 },
      { x: 4, y: 0 }, { x: 4, y: 3 }, { x: 0, y: 3 },
    ];
    const simplified = simplifyFootprint(outline);
    expect(simplified).toEqual([
      { x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }, { x: 0, y: 3 },
    ]);
    expect(isValidFootprint(simplified, 4, 3)).toBe(true);

    const collapsedNotch = simplifyFootprint([
      { x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 0 }, { x: 6, y: 0 },
      { x: 6, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 4 }, { x: 0, y: 4 },
    ]);
    expect(collapsedNotch).toEqual([
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 4 }, { x: 0, y: 4 },
    ]);
    expect(isValidFootprint(collapsedNotch, 10, 4)).toBe(true);
  });

  it('clips mesh air, horizontal faces and floor patches to the outline', () => {
    const grid = new GridGeometry(DEFAULT_ROOM, 10, 8, 5);
    const roomArea = polygonArea(roomFootprint(DEFAULT_ROOM));
    const solidVolume = grid.furnitureVolumes.reduce((total, volumes) => total + volumes.reduce((sum, value) => sum + value, 0), 0);
    expect(grid.volume.reduce((sum, value) => sum + value, 0) + solidVolume).toBeCloseTo(roomArea * DEFAULT_ROOM.ceilingM, 10);
    const wallArea = footprintWalls(DEFAULT_ROOM).reduce((sum, wall) => sum + wall.length * DEFAULT_ROOM.ceilingM, 0);
    const partitionArea = physicalFurniture(DEFAULT_ROOM).flatMap(furnitureBoxes).reduce((sum, box) => {
      const [dx, dy, dz] = box.max.map((value, axis) => value - box.min[axis]);
      return sum + 2 * (dx * dy + dx * dz + dy * dz) - (box.min[2] === 0 ? dx * dy : 0);
    }, 0);
    const surfaceArea = buildSurfaces(DEFAULT_ROOM, 20).filter((surface) => surface.kind !== 'emitter')
      .reduce((sum, surface) => sum + surface.area, 0);
    expect(surfaceArea).toBeCloseTo(2 * roomArea + wallArea + partitionArea, 10);
    expect(footprintRectangles(DEFAULT_ROOM).reduce((sum, rect) => sum +
      footprintCellArea(DEFAULT_ROOM, rect.x0, rect.y0, rect.x1, rect.y1), 0)).toBeCloseTo(roomArea, 10);
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
      id: 1, kind: 'window', side: 'top', wallIndex: 3, pos: 0.36, length: 0.5,
      sillM: 0.6, heightM: 1, open: true,
    }] });
    const apertureArea = buildSurfaces(room, 20).filter((surface) => surface.kind === 'aperture')
      .reduce((sum, surface) => sum + surface.area, 0);
    expect(apertureArea).toBeCloseTo(0.5, 10);
    expect(solveVentilation(room, 20, { outsideC: 0, windMps: 2, windDirectionDeg: 90 }).flows)
      .toContainEqual(expect.objectContaining({ wallIndex: 3 }));
  });

  it('runs balanced ventilation through an opening on an internal outline edge', () => {
    const room = sanitizeRoom({ ...DEFAULT_ROOM, convection: false, sources: [], outsideC: 0,
      model: { ...structuredClone(DEFAULT_MODEL), quality: 'fast', radiation: false, leakageACH: 0 },
      openings: [{ id: 1, kind: 'window', side: 'top', wallIndex: 3, pos: 0.36, length: 0.5,
        sillM: 0.5, heightM: 1, open: true }] });
    const simulation = new Simulation(room, { ...DEFAULT_PHYSICS, uScale: 0 });
    simulation.advance(0.1);
    expect(simulation.diagnostics().failure).toBeNull();
    expect(simulation.diagnostics().ventilationACH).toBeGreaterThan(0);
  });
});

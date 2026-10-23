import { describe, expect, it } from 'vitest';
import { DEFAULT_ROOM, coerceRoom, sanitizeRoom, wallU, type RoomConfig } from '../sim/config';
import { decodeRoom, encodeRoom, roomFromHash, shareUrl } from './share';
import { DEFAULT_MODEL, getModel } from '../sim/model';

const full: RoomConfig = sanitizeRoom({
  widthM: 6.5,
  heightM: 3.2,
  ceilingM: 3.4,
  outsideC: -7,
  convection: true,
  wall: { material: 'wood', thicknessM: 0.15, insulation: 'pir', insulationM: 0.08 },
  roof: { pitchDeg: 48, insulationM: 0.22, material: 'slate' },
  thermostat: { enabled: true, targetC: 21.5, deadbandC: 0.8 },
  heatingMode: 'underfloor',
  sources: [
    { id: 1, kind: 'heat', x: 1.2, y: 3, z: 0.4, powerKW: 2.4 },
    { id: 2, kind: 'cold', x: 5, y: 1, z: 2.8, powerKW: 0.8 },
  ],
  openings: [
    { id: 1, kind: 'window', side: 'top', pos: 3, length: 1.5, heightM: 1.2, sillM: 0.8, open: true },
    { id: 2, kind: 'door', side: 'left', pos: 1.6, length: 0.9, heightM: 2.1, sillM: 0, open: false },
  ],
  probes: [{ id: 1, x: 2, y: 1, z: 1.7 }],
  furniture: [{ id: 1, kind: 'table', material: 'wood', x: 3, y: 1.5, widthM: 1.4, depthM: 0.9, heightM: 0.8, rotation: 90 }],
});

// Fixed legacy payload: never manufacture old links with the current encoder.
function v5(): unknown[] {
  return [5, 6.5, 3.2, 1, 2, 0.15, 2, 0.08,
    [[0, 1.2, 3, 0.4, 2.4], [1, 5, 1, 2.8, 0.8]],
    [[0, 0, 3, 1.5, 1, 1.2, 0.8], [1, 3, 1.6, 0.9, 0, 2.1, 0]],
    [[2, 1, 1.7]], 3.4, -7, [[1, 0, 3, 1.5, 1.4, 0.9, 0.8, 90]],
    48, 0.22, 1, 1, 21.5, 0.8, 1];
}
const legacyThermostat = { enabled: false, targetC: 20, deadbandC: 0.5 };

describe('share', () => {
  it('round-trips a full room', () => {
    expect(decodeRoom(encodeRoom(full))).toEqual(full);
  });

  it('round-trips the default room', () => {
    expect(decodeRoom(encodeRoom(DEFAULT_ROOM))).toEqual(DEFAULT_ROOM);
  });

  it('still reads links made by the single-source version', () => {
    const code = btoa(JSON.stringify([1, 6, 3, 2, 1.0, 1, 1]));
    const room = decodeRoom(code)!;
    expect(room.widthM).toBe(6);
    expect(room.sources).toEqual([{ id: 1, kind: 'heat', x: 1, y: 1, z: 0.4, powerKW: 2 }]);
    expect(wallU(room.wall)).toBeCloseTo(1.0, 1);
  });

  it('defaults the ceiling for links without one', () => {
    const arr = [2, 5, 4, 0, 0, 0.2, 0, 0.02, [[0, 2.5, 2, 1]], [], []];
    const room = decodeRoom(btoa(JSON.stringify(arr)))!;
    expect(room.ceilingM).toBe(2.5);
    expect(room.outsideC).toBe(0);
    expect(room.roof).toEqual(DEFAULT_ROOM.roof);
  });

  it('loads older v2 links with default thermostat and furniture', () => {
    const code = btoa(JSON.stringify([2, 5, 4, 0, 0, 0.2, 0, 0, [], [], []]));
    const room = decodeRoom(code)!;
    expect(room.thermostat).toEqual(legacyThermostat);
    expect(room.furniture).toEqual(DEFAULT_ROOM.furniture);
    expect(room.heatingMode).toBe('point');
  });

  it('migrates version 2 sources, probes and openings to 3D', () => {
    const old = [2, 5, 4, 1, 0, 0.2, 0, 0.02, [[0, 1, 2, 2]], [[0, 0, 2, 1.2, 1], [1, 3, 2, 0.9, 0]], [[3, 1]], 3.2, -5];
    const room = decodeRoom(btoa(JSON.stringify(old)))!;
    expect(room.ceilingM).toBe(3.2);
    expect(room.outsideC).toBe(-5);
    expect(room.convection).toBe(true);
    expect(room.sources[0]).toMatchObject({ x: 1, y: 2, z: 0.4, powerKW: 2 });
    expect(room.probes[0].z).toBe(1.6);
    expect(room.openings[0]).toMatchObject({ heightM: 1.2, sillM: 0.8, open: true });
    expect(room.openings[1]).toMatchObject({ heightM: 2.1, sillM: 0 });
    expect(decodeRoom(encodeRoom(room))).toEqual(room);
  });

  it('loads version 3 rooms without furniture and preserves their heights', () => {
    const old = [3, 5, 4, 1, 0, 0.2, 0, 0.02, [[0, 1, 2, 0.6, 2]], [[0, 0, 2, 1.2, 1, 1.1, 0.7]], [[3, 1, 1.8]], 3.2, -5];
    const room = decodeRoom(btoa(JSON.stringify(old)))!;
    expect(room.furniture).toEqual([]);
    expect(room.sources[0].z).toBe(0.6);
    expect(room.probes[0].z).toBe(1.8);
    expect(room.openings[0].sillM).toBe(0.7);
  });

  it('round-trips all furniture kinds, materials and rotations', () => {
    const room = sanitizeRoom({ ...full, widthM: 8, heightM: 8, furniture: [
      { id: 1, kind: 'sofa', material: 'fabric', x: 2, y: 2, widthM: 2, depthM: 0.9, heightM: 0.85, rotation: 0 },
      { id: 2, kind: 'table', material: 'wood', x: 5, y: 2, widthM: 1.4, depthM: 0.9, heightM: 0.8, rotation: 90 },
      { id: 3, kind: 'cabinet', material: 'metal', x: 6, y: 6, widthM: 1.2, depthM: 0.5, heightM: 1.8, rotation: 0 },
      { id: 4, kind: 'bed', material: 'fabric', x: 2, y: 6, widthM: 1.6, depthM: 2, heightM: 0.6, rotation: 90 },
    ] });
    expect(decodeRoom(encodeRoom(room))).toEqual(room);
  });

  it('loads version 4 furniture links with default roof and thermostat settings', () => {
    const arr = v5();
    arr[0] = 4;
    arr.length = 14;
    const loaded = decodeRoom(btoa(JSON.stringify(arr)))!;
    expect(loaded.furniture).toEqual(full.furniture);
    expect(loaded.sources).toEqual(full.sources);
    expect(loaded.roof).toEqual(DEFAULT_ROOM.roof);
    expect(loaded.thermostat).toEqual(legacyThermostat);
    expect(loaded.heatingMode).toBe('point');
  });

  it('migrates main side-section links and saves while preserving heating settings', () => {
    const arr = [2, 6, 4, 1, 0, 0.2, 0, 0.02, [[0, 1, 2.5, 2]], [[1, 3, 2, 2, 1]], [[3, 1]], 3, -5,
      48, 0.22, 1, 1, 21.5, 0.8, [[0, 1.6]], 1];
    const loaded = decodeRoom(btoa(JSON.stringify(arr)))!;
    expect(loaded.sources[0]).toMatchObject({ x: 1, y: 2, z: 0.5, powerKW: 2 });
    expect(loaded.probes[0]).toMatchObject({ x: 3, y: 2, z: 2 });
    expect(loaded.openings[0]).toMatchObject({ side: 'left', pos: 2, heightM: 2, sillM: 0, open: true });
    expect(loaded.furniture[0]).toMatchObject({ kind: 'sofa', x: 1.6, y: 2, material: 'fabric' });
    expect(loaded.roof).toEqual(full.roof);
    expect(loaded.thermostat).toEqual(full.thermostat);
    expect(loaded.heatingMode).toBe('underfloor');
    const saved = coerceRoom({ ...loaded, sources: [{ id: 1, kind: 'heat', x: 1, y: 2.5, powerKW: 2 }],
      probes: [{ id: 1, x: 3, y: 1 }], openings: [{ id: 1, kind: 'door', side: 'left', pos: 2, length: 2, open: true }],
      furniture: [{ id: 1, kind: 'sofa', x: 1.6 }] });
    expect(saved).toEqual(loaded);
    expect(decodeRoom(encodeRoom(loaded))).toEqual(loaded);
  });

  it('rejects malformed furniture rows', () => {
    const arr = v5() as any[];
    arr[13][0].pop();
    expect(decodeRoom(btoa(JSON.stringify(arr)))).toBeNull();
  });

  it('rejects incomplete 3D coordinates instead of guessing their format', () => {
    const arr = v5() as any[];
    arr[8][0].pop();
    expect(decodeRoom(btoa(JSON.stringify(arr)))).toBeNull();
  });

  it('rejects garbage', () => {
    expect(decodeRoom('not-valid')).toBeNull();
    expect(decodeRoom(btoa('[3,1,1,1,1,1,1]'))).toBeNull();
    expect(decodeRoom(btoa('{"a":1}'))).toBeNull();
    expect(decodeRoom(btoa('[1,"a",1,1,1,1,1]'))).toBeNull();
    expect(decodeRoom(btoa('[2,5,4,0,0,0.2,0,0,[[0,1]],[],[]]'))).toBeNull();
    expect(decodeRoom(btoa('[2,5,4,0,0,0.2,0,0,"x",[],[]]'))).toBeNull();
  });

  it('clamps out-of-range values and unknown enum indexes', () => {
    const arr = [2, 500, 500, 1, 99, 500, 99, 500, [[9, 500, 500, 500]], [[9, 9, 500, 500, 1]], [[500, 500]]];
    const room = decodeRoom(btoa(JSON.stringify(arr)))!;
    expect(room).toEqual(sanitizeRoom(room));
    expect(room.widthM).toBe(15);
    expect(room.wall.material).toBe('brick');
    expect(room.sources[0].powerKW).toBe(10);
    expect(room.sources[0].kind).toBe('heat');
    expect(room.openings[0].side).toBe('top');
    expect(room.probes[0].x).toBe(15);
  });


  it('keeps v5 links with their legacy boundary and ideal source intent', () => {
    const room = decodeRoom(btoa(JSON.stringify(v5())))!;
    expect(room).toEqual(full);
    expect(getModel(room).floor.boundary).toBe('outside');
    expect(getModel(room).leakageACH).toBe(0);
    expect(room.sources[0].emitter).toBeUndefined();
    expect(room.thermostat.sensor).toBeUndefined();
  });

  it('round-trips v6 construction, Unicode labels, sensors, solar and emitter data', () => {
    const room = sanitizeRoom({ ...full, model: { ...structuredClone(DEFAULT_MODEL), floor: {
      boundary: 'adjacent', temperatureC: 18, layers: [{ label: 'Béton ☀', thicknessM: 0.15, k: 1.7, density: 2300, cp: 880 }] } },
      thermostat: { ...full.thermostat, sensor: { mode: 'point', x: 1, y: 2, z: 1.1, lagSeconds: 30 } },
      sources: DEFAULT_ROOM.sources, openings: [{ ...full.openings[0], solarTransmittance: 0.45 }] });
    const code = encodeRoom(room);
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeRoom(code)).toEqual(room);
  });

  it('round-trips canonical interior wall geometry through share links', () => {
    const room = sanitizeRoom({
      ...DEFAULT_ROOM,
      interiorWalls: [
        { id: 31, start: { x: 2, y: 2 }, end: { x: 4, y: 2 }, thicknessM: 0.1 },
        { id: 32, start: { x: 6, y: 3 }, end: { x: 6, y: 5 }, thicknessM: 0.14 },
      ],
    });
    expect(decodeRoom(encodeRoom(room))?.interiorWalls).toEqual(room.interiorWalls);
  });

  it('rejects malformed v6 fields and unsupported versions', () => {
    expect(decodeRoom(btoa(JSON.stringify([6, { widthM: 5, heightM: 4, sources: [] }])))).toBeNull();
    expect(decodeRoom(btoa(JSON.stringify([7, full])))).toBeNull();
    expect(decodeRoom(btoa(JSON.stringify([6, { ...full, sources: [{ x: 1 }] }])))).toBeNull();
  });

  it('builds and parses share URLs', () => {
    const url = shareUrl(full, 'https://example.com/app/');
    expect(url.startsWith('https://example.com/app/#c=')).toBe(true);
    expect(roomFromHash(new URL(url).hash)).toEqual(full);
    expect(roomFromHash('#foo')).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { DEFAULT_ROOM, sanitizeRoom, wallU, type RoomConfig } from '../sim/config';
import { decodeRoom, encodeRoom, roomFromHash, shareUrl } from './share';

const full: RoomConfig = {
  widthM: 6.5,
  heightM: 3.2,
  ceilingM: 3.4,
  outsideC: -7,
  convection: true,
  wall: { material: 'wood', thicknessM: 0.15, insulation: 'pir', insulationM: 0.08 },
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
};

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

  it('rejects malformed furniture rows', () => {
    const arr = JSON.parse(atob(encodeRoom(full).replace(/-/g, '+').replace(/_/g, '/')));
    arr[13][0].pop();
    expect(decodeRoom(btoa(JSON.stringify(arr)))).toBeNull();
  });

  it('rejects incomplete 3D coordinates instead of guessing their format', () => {
    const arr = JSON.parse(atob(encodeRoom(full).replace(/-/g, '+').replace(/_/g, '/')));
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
    expect(room.widthM).toBe(10);
    expect(room.wall.material).toBe('brick');
    expect(room.sources[0].powerKW).toBe(10);
    expect(room.sources[0].kind).toBe('heat');
    expect(room.openings[0].side).toBe('top');
    expect(room.probes[0].x).toBe(10);
  });

  it('builds and parses share URLs', () => {
    const url = shareUrl(full, 'https://example.com/app/');
    expect(url.startsWith('https://example.com/app/#c=')).toBe(true);
    expect(roomFromHash(new URL(url).hash)).toEqual(full);
    expect(roomFromHash('#foo')).toBeNull();
  });
});

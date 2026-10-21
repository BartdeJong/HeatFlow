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
    { id: 1, kind: 'heat', x: 1.2, y: 3, powerKW: 2.4 },
    { id: 2, kind: 'cold', x: 5, y: 1, powerKW: 0.8 },
  ],
  openings: [
    { id: 1, kind: 'window', side: 'top', pos: 3, length: 1.5, open: true },
    { id: 2, kind: 'door', side: 'left', pos: 1.6, length: 0.9, open: false },
  ],
  probes: [{ id: 1, x: 2, y: 1 }],
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
    expect(room.sources).toEqual([{ id: 1, kind: 'heat', x: 1, y: 1, powerKW: 2 }]);
    expect(wallU(room.wall)).toBeCloseTo(1.0, 1);
  });

  it('defaults the ceiling for links without one', () => {
    const arr = JSON.parse(atob(encodeRoom(DEFAULT_ROOM).replace(/-/g, '+').replace(/_/g, '/')));
    arr.pop();
    arr.pop();
    const room = decodeRoom(btoa(JSON.stringify(arr)))!;
    expect(room.ceilingM).toBe(2.5);
    expect(room.outsideC).toBe(0);
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

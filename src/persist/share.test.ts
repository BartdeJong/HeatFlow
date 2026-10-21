import { describe, expect, it } from 'vitest';
import { DEFAULT_ROOM } from '../sim/config';
import { decodeRoom, encodeRoom, roomFromHash, shareUrl } from './share';

describe('share', () => {
  it('round-trips a room', () => {
    const room = { widthM: 6.5, heightM: 3.2, powerKW: 2.4, uValue: 0.45, sourceX: 1.2, sourceY: 3 };
    expect(decodeRoom(encodeRoom(room))).toEqual(room);
  });

  it('rejects garbage', () => {
    expect(decodeRoom('not-valid')).toBeNull();
    expect(decodeRoom(btoa('[2,1,1,1,1,1,1]'))).toBeNull();
    expect(decodeRoom(btoa('{"a":1}'))).toBeNull();
    expect(decodeRoom(btoa('[1,"a",1,1,1,1,1]'))).toBeNull();
  });

  it('clamps out-of-range values', () => {
    const code = btoa(JSON.stringify([1, 500, 500, 500, 500, 500, 500]));
    const room = decodeRoom(code)!;
    expect(room.widthM).toBe(10);
    expect(room.powerKW).toBe(10);
    expect(room.sourceX).toBe(10);
  });

  it('builds and parses share URLs', () => {
    const url = shareUrl(DEFAULT_ROOM, 'https://example.com/app/');
    expect(url.startsWith('https://example.com/app/#c=')).toBe(true);
    expect(roomFromHash(new URL(url).hash)).toEqual(DEFAULT_ROOM);
    expect(roomFromHash('#foo')).toBeNull();
  });
});

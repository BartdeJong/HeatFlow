import { describe, expect, it } from 'vitest';
import { coerceRoom, DEFAULT_PHYSICS, DEFAULT_ROOM, holdLossW, sanitizeRoom } from './config';
import { DEFAULT_MODEL, emitterPreset, floorLayers, getModel, roofLayers, sanitizeModel, wallLayers } from './model';

describe('physical model configuration and migration', () => {
  it('uses physical air properties and explicit storage for new rooms', () => {
    expect(getModel(DEFAULT_ROOM).quality).toBe('fast');
    expect(DEFAULT_PHYSICS.massFactor).toBe(1);
    expect(DEFAULT_PHYSICS.alpha).toBeCloseTo(2.2e-5, 8);
    expect(getModel(DEFAULT_ROOM).floor).toMatchObject({ boundary: 'ground', temperatureC: 10 });
    expect(DEFAULT_ROOM.thermostat.sensor).toMatchObject({ mode: 'point', z: 1.1, lagSeconds: 30 });
    expect(DEFAULT_ROOM.sources[0].emitter?.kind).toBe('radiator');
  });
  it('preserves Fast and detailed resolution choices through sanitization', () => {
    for (const quality of ['fast', 'coarse', 'balanced', 'fine'] as const) {
      expect(sanitizeModel({ ...DEFAULT_MODEL, quality }).quality).toBe(quality);
    }
  });
  it('preserves imported boundary, sensor and source intent', () => {
    const room = coerceRoom({ ...DEFAULT_ROOM, model: undefined, thermostat: { enabled: true, targetC: 20, deadbandC: 0.5 },
      outsideC: -8, sources: [{ id: 1, kind: 'heat', x: 1, y: 2, z: 0.4, powerKW: 2 }] })!;
    expect(getModel(room).floor).toMatchObject({ boundary: 'outside', temperatureC: -8 });
    expect(getModel(room).leakageACH).toBe(0);
    expect(room.thermostat.sensor).toBeUndefined();
    expect(room.sources[0].emitter).toBeUndefined();
    expect(sanitizeRoom(room)).toEqual(room);
  });
  it('normalizes hostile model inputs and remains idempotent', () => {
    const model = sanitizeModel({ quality: 'unknown', leakageACH: Infinity, floor: { boundary: 'invalid', layers: [null, { thicknessM: -1, k: 0, density: Infinity, cp: NaN }] },
      wallLayers: [], environment: { windMps: -100, solarWm2: 10000, startHour: 30 } });
    expect(model.quality).toBe('balanced');
    expect(model.leakageACH).toBe(0.2);
    expect(model.floor.layers[0]).toMatchObject({ thicknessM: 0.001, k: 0.005, density: 1000, cp: 1000 });
    expect(model.environment).toMatchObject({ windMps: 0, solarWm2: 1400, startHour: 24 });
    expect(sanitizeModel(model)).toEqual(model);
  });
  it('derives construction only, without including film resistance', () => {
    const room = sanitizeRoom({ ...DEFAULT_ROOM, model: undefined, wall: { material: 'brick', thicknessM: 0.2, insulation: 'pir', insulationM: 0.08 } });
    expect(wallLayers(room).reduce((r, l) => r + l.thicknessM / l.k, 0)).toBeCloseTo(0.2 / 0.77 + 0.08 / 0.022, 12);
    expect(roofLayers(room).every(l => l.k > 0 && l.cp > 0 && l.density > 0)).toBe(true);
    expect(floorLayers(room)).toEqual(wallLayers(room));
  });
  it('retains custom layers and clamps sensor coordinates with room dimensions', () => {
    const room = sanitizeRoom({ ...DEFAULT_ROOM, model: { ...structuredClone(DEFAULT_MODEL), wallLayers: [{ label: 'Custom', thicknessM: 0.12, k: 0.15, density: 500, cp: 1500 }] },
      thermostat: { ...DEFAULT_ROOM.thermostat, sensor: { mode: 'point', x: 500, y: -1, z: 500, lagSeconds: -5 } } });
    expect(wallLayers(room)[0].label).toBe('Custom');
    expect(room.thermostat.sensor).toMatchObject({ x: 5, y: 0, z: 2.5, lagSeconds: 0 });
    expect(sanitizeRoom(room)).toEqual(room);
  });
  it('uses independent floor boundary in the steady heating estimate', () => {
    const room = structuredClone(DEFAULT_ROOM);
    room.model!.leakageACH = 0;
    const warmFloor = holdLossW(room, 20);
    room.model!.floor.temperatureC = 0;
    expect(holdLossW(room, 20)).toBeGreaterThan(warmFloor);
  });
  it('normalizes emitter thermal capacity without changing legacy ideal sources', () => {
    const room = sanitizeRoom({ ...DEFAULT_ROOM, sources: [{ ...DEFAULT_ROOM.sources[0], emitter: { ...emitterPreset('radiator'), capacityJPerK: -1, emissivity: 2 } }] });
    expect(room.sources[0].emitter).toMatchObject({ capacityJPerK: 1, emissivity: 1 });
  });
});

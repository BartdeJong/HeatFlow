import { describe, expect, it } from 'vitest';
import { DEFAULT_ROOM, type RoomConfig } from './config';
import { DEFAULT_MODEL } from './model';
import { solveVentilation } from './ventilation';
import { exteriorConvection, exteriorLongwaveW, getEnvironment, traceSolar } from './environment';
import type { RadiationPatch } from './radiation';
const room = (): RoomConfig => ({ ...structuredClone(DEFAULT_ROOM), footprint: undefined, model: structuredClone(DEFAULT_MODEL), sources: [] });
const targets: RadiationPatch[] = [
  { area: 20, center: [2.5, 2, 0], normal: [0, 0, 1], emissivity: 0.9, tangentU: [2.5, 0, 0], tangentV: [0, 2, 0] },
  { area: 12.5, center: [2.5, 0, 1.25], normal: [0, 1, 0], emissivity: 0.9, tangentU: [2.5, 0, 0], tangentV: [0, 0, 1.25] },
];
describe('Reproducible weather and solar', () => {
  it('keeps constant weather constant and normalizes the sun vector', () => {
    const r = room();
    expect(getEnvironment(r, 0).outsideC).toBe(r.outsideC);
    expect(getEnvironment(r, 86400).outsideC).toBe(r.outsideC);
    expect(Math.hypot(...getEnvironment(r, 0).sunDirection)).toBeCloseTo(1, 12);
  });
  it('repeats daily presets exactly and suppresses night sunlight', () => {
    const r = room(); r.model!.environment.preset = 'clear-day';
    expect(getEnvironment(r, 2400)).toEqual(getEnvironment(r, 88800));
    const night = getEnvironment(r, 12 * 3600);
    expect(night.directWm2).toBe(0); expect(night.diffuseWm2).toBe(0);
    expect(getEnvironment(r, 0).outsideC).toBeGreaterThan(night.outsideC);
  });
  it('rotates world wind and sunlight into room coordinates', () => {
    const r = room(); r.model!.environment.orientationDeg = 90;
    const e = getEnvironment(r, 0);
    expect(e.windDirectionDeg).toBe(270);
    expect(e.sunDirection[0]).toBeGreaterThan(0.8);
    expect(e.sunDirection[1]).toBeCloseTo(0, 10);
  });

  it('rotates wind pressure only once when feeding the ventilation network', () => {
    const r = room();
    r.model!.environment.orientationDeg = 90; r.model!.environment.windMps = 4;
    r.openings = [{ id: 1, kind: 'window', side: 'left', pos: 2, length: 1, sillM: 0.5, heightM: 1, open: true }];
    const automatic = solveVentilation(r, 20, getEnvironment(r, 0));
    const explicit = solveVentilation(r, 20, { outsideC: 0, windMps: 4, windDirectionDeg: 0 });
    expect(automatic.inflowM3s).toBeCloseTo(explicit.inflowM3s, 10);
    expect(automatic.pressurePa).toBeCloseTo(explicit.pressurePa, 10);
  });
  it('deposits transmitted direct sun on the first surface and conserves diffuse gains', () => {
    const r = room();
    r.model!.environment.solarWm2 = 600; r.model!.environment.diffuseWm2 = 100;
    r.model!.environment.sunElevationDeg = 45;
    r.openings = [{ id: 1, kind: 'window', side: 'bottom', pos: 2.5, length: 1, sillM: 1, heightM: 1, open: false, solarTransmittance: 0.6 }];
    const result = traceSolar(r, getEnvironment(r, 0), targets);
    expect(result.patchW[0]).toBeGreaterThan(200);
    expect(result.escapedW).toBe(0);
    expect(result.transmittedW).toBeCloseTo(600 * Math.SQRT1_2 * 0.6 + 100 * 0.6 / 2, 9);
    expect(result.patchW.reduce((s, w) => s + w, 0)).toBeCloseTo(result.transmittedW, 9);
  });
  it('lets furniture intercept direct rays without deleting their energy', () => {
    const r = room();
    r.model!.environment.solarWm2 = 600; r.model!.environment.sunElevationDeg = 45;
    r.openings = [{ id: 1, kind: 'window', side: 'bottom', pos: 2.5, length: 1, sillM: 1, heightM: 1, open: false }];
    r.furniture = [{ id: 1, kind: 'cabinet', material: 'wood', x: 2.5, y: 3, widthM: 2, depthM: 1, heightM: 2, rotation: 0 }];
    const result = traceSolar(r, getEnvironment(r, 0), targets);
    expect(result.furnitureW.get(1)).toBeCloseTo(result.transmittedW, 9);
    expect(result.patchW[0]).toBe(0);
  });

  it('counts direct rays escaping another open aperture as external transmission', () => {
    const r = room();
    r.model!.environment.solarWm2 = 600; r.model!.environment.sunElevationDeg = 5;
    r.openings = [{ id: 1, kind: 'window', side: 'bottom', pos: 2.5, length: 1, sillM: 1, heightM: 1, open: true }];
    const aperture = { ...targets[1], solarTransparent: true };
    const result = traceSolar(r, getEnvironment(r, 0), [aperture]);
    expect(result.escapedW).toBeCloseTo(result.transmittedW, 9);
    expect(result.patchW[0]).toBe(0);
  });
  it('separates wind convection and sky radiation', () => {
    expect(exteriorConvection(5)).toBeGreaterThan(exteriorConvection(0));
    expect(exteriorLongwaveW(20, 0, 10)).toBeLessThan(0);
    expect(exteriorLongwaveW(20, 20, 10)).toBe(0);
  });
});

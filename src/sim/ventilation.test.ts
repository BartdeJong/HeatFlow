import { describe, expect, it } from 'vitest';
import { DEFAULT_ROOM, type RoomConfig } from './config';
import { DEFAULT_MODEL } from './model';
import { solveVentilation } from './ventilation';
const room: RoomConfig = { ...DEFAULT_ROOM, model: { ...DEFAULT_MODEL, leakageACH: 0 }, openings: [{ id: 1, kind: 'window', side: 'top', pos: 2.5, length: 1, sillM: 0.5, heightM: 1.5, open: true }] };
const env = { outsideC: 0, windMps: 0, windDirectionDeg: 0 };
describe('pressure-network ventilation', () => {
  it('resolves bidirectional exchange through a single opening with balanced mass', () => {
    const v = solveVentilation(room, 20, env);
    expect(v.inflowM3s).toBeGreaterThan(0.05);
    expect(v.outflowM3s).toBeGreaterThan(0.05);
    expect(Math.abs(v.imbalance) / v.inflowM3s).toBeLessThan(1e-8);
    const lower = v.flows.filter((f) => f.z < 1.25), upper = v.flows.filter((f) => f.z > 1.25);
    expect(lower.every((f) => f.inflow)).toBe(true);
    expect(upper.every((f) => !f.inflow)).toBe(true);
  });
  it('reverses stack flow when the exterior becomes warmer', () => {
    const v = solveVentilation(room, 0, { ...env, outsideC: 20 });
    expect(v.flows.filter((f) => f.z < 1.25).every((f) => !f.inflow)).toBe(true);
  });
  it('reverses cross ventilation with the wind', () => {
    const cross = { ...room, openings: [...room.openings, { ...room.openings[0], id: 2, side: 'bottom' as const }] };
    const forward = solveVentilation(cross, 20, { ...env, outsideC: 20, windMps: 5 });
    const reverse = solveVentilation(cross, 20, { ...env, outsideC: 20, windMps: 5, windDirectionDeg: 180 });
    expect(forward.flows.filter((f) => f.side === 'top').every((f) => f.inflow)).toBe(true);
    expect(reverse.flows.filter((f) => f.side === 'top').every((f) => !f.inflow)).toBe(true);
    expect(Math.abs(forward.imbalance) / forward.inflowM3s).toBeLessThan(1e-8);
  });
  it('has no artificial exchange through closed openings or an unforced room', () => {
    expect(solveVentilation({ ...room, openings: room.openings.map((o) => ({ ...o, open: false })) }, 20, env).inflowM3s).toBe(0);
    expect(solveVentilation(room, 20, { ...env, outsideC: 20 }).inflowM3s).toBe(0);
  });
  it('subtracts solid furniture that physically blocks an open window', () => {
    const blocked: RoomConfig = { ...room, furniture: [{ id: 1, kind: 'cabinet', material: 'wood', x: 2.5, y: 0.25, widthM: 2, depthM: 0.5, heightM: 2.5, rotation: 0 }] };
    expect(solveVentilation(blocked, 20, env).inflowM3s).toBe(0);
    const partial = { ...blocked, furniture: [{ ...blocked.furniture[0], widthM: 0.5 }] };
    expect(solveVentilation(partial, 20, env).inflowM3s).toBeCloseTo(solveVentilation(room, 20, env).inflowM3s / 2, 8);
  });
  it('keeps leakage distinct and balances flow independently of opening overlap', () => {
    const leaky = { ...room, model: { ...DEFAULT_MODEL, leakageACH: 0.5 }, openings: [...room.openings, { ...room.openings[0], id: 2 }] };
    const v = solveVentilation(leaky, 20, env);
    expect(v.flows.some((f) => f.leakage)).toBe(true);
    expect(Math.abs(v.imbalance) / v.inflowM3s).toBeLessThan(1e-8);
    const once = solveVentilation({ ...leaky, openings: room.openings }, 20, env);
    expect(v.inflowM3s).toBeCloseTo(once.inflowM3s, 10);
  });
});

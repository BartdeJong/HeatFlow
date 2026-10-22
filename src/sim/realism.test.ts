import { describe, expect, it } from 'vitest';
import { DEFAULT_PHYSICS, DEFAULT_ROOM, type RoomConfig } from './config';
import { DEFAULT_MODEL, emitterPreset } from './model';
import { furnitureVolume } from './furniture';
import { Simulation } from './simulation';

function isolated(): RoomConfig {
  const r = structuredClone(DEFAULT_ROOM);
  r.heightM = 2; r.ceilingM = 2; r.convection = false; r.sources = [];
  r.model = structuredClone(DEFAULT_MODEL);
  r.model.quality = 'coarse'; r.model.radiation = false; r.model.leakageACH = 0;
  r.model.environment.skyOffsetC = 0;
  return r;
}
function advance(sim: Simulation, seconds: number) {
  const end = sim.elapsed + seconds;
  while (sim.elapsed < end - 1e-8) {
    const dt = sim.advance(Math.min(16, end - sim.elapsed));
    if (!dt) throw new Error(sim.diagnostics().failure ?? 'Simulation did not advance');
  }
}
const insulated = { ...DEFAULT_PHYSICS, uScale: 0 };

describe('Integrated physical realism', () => {
  it('closes the complete air-and-building energy ledger over an insulated hour', () => {
    const r = isolated();
    r.heatingMode = 'underfloor';
    r.sources = [{ id: 1, kind: 'heat', x: 2.5, y: 1, z: 0.4, powerKW: 0.1 }];
    const sim = new Simulation(r, insulated);
    const initial = sim.energyJ();
    advance(sim, 3600);
    expect(sim.elapsed).toBeCloseTo(3600, 8);
    expect(Math.abs(sim.energyJ() - initial - 100 * 3600) / (100 * 3600)).toBeLessThan(0.001);
    expect(sim.diagnostics().relativeEnergyError).toBeLessThan(1e-8);
    expect(sim.energyUseKWh().heating).toBeCloseTo(0.1, 9);
  }, 30000);

  it('releases stored slab heat after underfloor heating switches off', () => {
    const r = isolated(); r.heatingMode = 'underfloor';
    r.sources = [{ id: 1, kind: 'heat', x: 2.5, y: 1, z: 0.4, powerKW: 0.3 }];
    const sim = new Simulation(r, insulated);
    advance(sim, 900);
    const atSwitchOff = sim.stats().mean;
    const before = sim.energyJ();
    sim.setRoom({ ...r, sources: r.sources.map(s => ({ ...s, powerKW: 0 })) });
    advance(sim, 300);
    expect(sim.stats().mean).toBeGreaterThan(atSwitchOff);
    expect(sim.energyJ()).toBeCloseTo(before, 3);
    expect(sim.diagnostics().relativeEnergyError).toBeLessThan(1e-8);
  }, 30000);

  it('keeps internal radiator radiation conservative in underfloor mode', () => {
    const r = isolated(); r.model!.radiation = true; r.heatingMode = 'underfloor';
    r.sources = [{ id: 1, kind: 'heat', x: 2.5, y: 1, z: 0.4, powerKW: 0.2, emitter: emitterPreset('radiator') }];
    const sim = new Simulation(r, insulated);
    advance(sim, 120);
    expect(sim.diagnostics().relativeEnergyError).toBeLessThan(1e-8);
  }, 30000);

  it('conserves radiant emitters and partially occupied furniture contact energy', () => {
    const r = isolated(); r.model!.radiation = true;
    r.sources = [{ id: 1, kind: 'heat', x: 2.5, y: 1, z: 0.4, powerKW: 0.2, emitter: emitterPreset('radiator') }];
    r.furniture = [{ id: 1, kind: 'table', material: 'wood', x: 3.5, y: 1, widthM: 1.3, depthM: 0.6, heightM: 0.8, rotation: 0 }];
    const sim = new Simulation(r, insulated);
    advance(sim, 120);
    expect(sim.diagnostics().relativeEnergyError).toBeLessThan(1e-8);
    const occupied = sim.grid.furnitureVolumes[0].reduce((s, v) => s + v, 0);
    expect(occupied).toBeCloseTo(furnitureVolume(r.furniture[0]), 10);
    expect(sim.furnitureTemperatures()[1]).toBeGreaterThan(20);
  }, 30000);



  it('transports pressure-driven window ventilation with buoyancy disabled without undershooting outdoor air', () => {
    const r = isolated(); r.outsideC = 0;
    r.openings = [
      { id: 1, kind: 'window', side: 'bottom', pos: 2.5, length: 1, sillM: 0.5, heightM: 1, open: true },
      { id: 2, kind: 'window', side: 'top', pos: 2.5, length: 1, sillM: 0.5, heightM: 1, open: true },
    ];
    const sim = new Simulation(r, insulated);
    advance(sim, 15);
    expect(sim.stats().min).toBeGreaterThanOrEqual(r.outsideC - 1e-5);
    expect(sim.stats().max).toBeLessThanOrEqual(20 + 1e-5);
    expect(sim.stats().mean).toBeLessThan(20);
    expect(sim.diagnostics().ventilationACH).toBeGreaterThan(0);
    expect(sim.diagnostics().relativeEnergyError).toBeLessThan(0.001);
  }, 30000);
  it('accounts for solar gains intercepted by furniture and rays escaping open windows', () => {
    const r = isolated(); r.outsideC = 20;
    r.model!.environment.solarWm2 = 600; r.model!.environment.diffuseWm2 = 100;
    r.model!.environment.sunElevationDeg = 5;
    r.openings = [
      { id: 1, kind: 'window', side: 'bottom', pos: 2.5, length: 1, sillM: 0.5, heightM: 1, open: true },
      { id: 2, kind: 'window', side: 'top', pos: 2.5, length: 1, sillM: 0.5, heightM: 1, open: true },
    ];
    r.furniture = [{ id: 1, kind: 'cabinet', material: 'wood', x: 3.7, y: 1, widthM: 0.6, depthM: 0.5, heightM: 1, rotation: 0 }];
    const sim = new Simulation(r, insulated);
    advance(sim, 10);
    expect(sim.diagnostics().solarW).toBeGreaterThan(0);
    expect(sim.diagnostics().relativeEnergyError).toBeLessThan(1e-8);
  });

  it('rebuilds physical emitter surfaces when a source changes between cold and heat', () => {
    const r = isolated();
    r.sources = [{ id: 1, kind: 'cold', x: 2.5, y: 1, z: 0.4, powerKW: 0.2, emitter: emitterPreset('radiator') }];
    const sim = new Simulation(r, insulated);
    expect(sim.diagnostics().surfaceTemperatures.some(s => s.label === 'radiator 1')).toBe(false);
    sim.setRoom({ ...r, sources: r.sources.map(s => ({ ...s, kind: 'heat' as const })) });
    expect(sim.diagnostics().surfaceTemperatures.some(s => s.label === 'radiator 1')).toBe(true);
    sim.setRoom(r);
    expect(sim.diagnostics().surfaceTemperatures.some(s => s.label === 'radiator 1')).toBe(false);
  });
  it('accounts for emitter capacity changes as an external intervention', () => {
    const r = isolated();
    r.sources = [{ id: 1, kind: 'heat', x: 2.5, y: 1, z: 0.4, powerKW: 0 }];
    const sim = new Simulation(r, insulated);
    sim.setRoom({ ...r, sources: r.sources.map(s => ({ ...s, emitter: emitterPreset('radiator') })) });
    expect(sim.diagnostics().energyBalanceJ).toBeCloseTo(0, 5);
    expect(sim.diagnostics().netExternalJ).toBeCloseTo(20 * 30000, 5);
  });

  it('uses a fixed energy reference when outdoor temperature changes', () => {
    const r = isolated(); const sim = new Simulation(r, insulated);
    const before = sim.energyJ();
    sim.setRoom({ ...r, outsideC: -25 });
    expect(sim.energyJ()).toBe(before);
    advance(sim, 20);
    expect(sim.diagnostics().energyBalanceJ).toBeCloseTo(0, 4);
  });


  it('keeps Balanced and Fine occupied-zone temperature and heating energy within practical gates', () => {
    const r = isolated(); r.model!.quality = 'balanced';
    r.heatingMode = 'underfloor';
    r.sources = [{ id: 1, kind: 'heat', x: 2.5, y: 1, z: 0.4, powerKW: 0.3 }];
    const balanced = new Simulation(r, insulated);
    const fine = new Simulation({ ...r, model: { ...r.model!, quality: 'fine' } }, insulated);
    advance(balanced, 180); advance(fine, 180);
    const occupiedC = (sim: Simulation) => {
      let energy = 0, volume = 0;
      for (let z = 0; z < sim.nz; z++) if ((z + 0.5) * sim.dz >= 0.1 && (z + 0.5) * sim.dz <= 1.8) {
        for (let y = 0; y < sim.ny; y++) for (let x = 0; x < sim.nx; x++) {
          const i = (z * sim.ny + y) * sim.nx + x;
          energy += sim.T[i] * sim.grid.volume[i]; volume += sim.grid.volume[i];
        }
      }
      return energy / volume;
    };
    expect(Math.abs(occupiedC(balanced) - occupiedC(fine))).toBeLessThan(0.5);
    expect(Math.abs(balanced.energyUseKWh().heating / fine.energyUseKWh().heating - 1)).toBeLessThan(0.05);
    expect(balanced.diagnostics().relativeEnergyError).toBeLessThan(0.001);
    expect(fine.diagnostics().relativeEnergyError).toBeLessThan(0.001);
  }, 30000);
  it('uses actual air heat capacity, with independent stored wall heat', () => {
    const r = isolated(); const sim = new Simulation(r, insulated);
    const before = sim.energyJ();
    sim.T.fill(21);
    const actualCapacity = r.widthM * r.heightM * r.ceilingM * DEFAULT_PHYSICS.airDensity * DEFAULT_PHYSICS.airCp;
    expect(sim.energyJ() - before).toBeCloseTo(actualCapacity, 6);
  });
});

it('rebuilds emitter surfaces when a cold source is changed into a heater', () => {
  const room = isolated();
  room.sources = [{ id: 1, kind: 'cold', x: 2.5, y: 1, z: .4, powerKW: .1, emitter: emitterPreset('radiator') }];
  const sim = new Simulation(room, insulated);
  expect(sim.diagnostics().surfaceTemperatures.some(s => s.label === 'radiator 1')).toBe(false);
  const heated = { ...room, sources: room.sources.map(s => ({ ...s, kind: 'heat' as const })) };
  sim.setRoom(heated);
  expect(sim.diagnostics().surfaceTemperatures.filter(s => s.label === 'radiator 1')).toHaveLength(6);
  sim.setRoom(room);
  expect(sim.diagnostics().surfaceTemperatures.some(s => s.label === 'radiator 1')).toBe(false);
});

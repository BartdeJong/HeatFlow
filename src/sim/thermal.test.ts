import { describe, expect, it } from 'vitest';
import { LayerColumn, type ThermalLayer } from './thermal';
const layers: ThermalLayer[] = [
  { label: 'Brick', thicknessM: 0.2, k: 0.77, density: 1800, cp: 840 },
  { label: 'Insulation', thicknessM: 0.08, k: 0.04, density: 40, cp: 1400 },
];
describe('Layered implicit conduction', () => {
  it('conserves coupled air/solid/source energy for an insulated hour', () => {
    const column = new LayerColumn(12, layers, 20);
    const airCapacity = 50 * 1.2 * 1005;
    let airC = 20;
    const before = column.energyJ() + airC * airCapacity;
    let supplied = 0;
    for (let time = 0; time < 3600; time += 10) {
      const sourceW = time < 1800 ? 1200 : 0;
      supplied += sourceW * 10;
      airC = column.step(10, airC, airCapacity, 3, -10, 0, sourceW).airC;
    }
    expect(Math.abs(column.energyJ() + airC * airCapacity - before - supplied) / supplied).toBeLessThan(1e-10);
    expect(airC).toBeGreaterThan(20);
  });

  it('couples heterogeneous air cells without homogenization overshoot or energy drift', () => {
    const column = new LayerColumn(2, layers, 20);
    const contacts = [
      { temperatureC: 0, capacityJPerK: 100, conductanceWPerK: 2 },
      { temperatureC: 20, capacityJPerK: 200, conductanceWPerK: 8 },
    ];
    const before = column.energyJ() + contacts.reduce((sum, c) => sum + c.temperatureC * c.capacityJPerK, 0);
    const result = column.stepMultiAir(100, contacts, { temperatureC: 0, conductanceWPerK: 0 });
    expect(result.airC[0]).toBeGreaterThan(0);
    expect(result.airC[1]).toBeLessThanOrEqual(20);
    const after = column.energyJ() + contacts.reduce((sum, c, i) => sum + result.airC[i] * c.capacityJPerK, 0);
    expect(after).toBeCloseTo(before, 6);
  });
  it('matches analytical multilayer resistance including independent surface films', () => {
    const area = 8, column = new LayerColumn(area, layers, 10);
    const inside = { temperatureC: 25, conductanceWPerK: 8 * area };
    const outside = { temperatureC: -5, conductanceWPerK: 25 * area };
    let exchange = { insideJ: 0, outsideJ: 0 };
    for (let i = 0; i < 1000; i++) exchange = column.stepBoundaries(86400, inside, outside);
    const expectedW = area * 30 / (1 / 8 + 0.2 / 0.77 + 0.08 / 0.04 + 1 / 25);
    expect(exchange.insideJ / 86400).toBeCloseTo(expectedW, 8);
    expect(exchange.outsideJ / 86400).toBeCloseTo(-expectedW, 8);
    expect(column.insideC).toBeCloseTo(25 - expectedW / inside.conductanceWPerK, 8);
    expect(column.outsideC).toBeCloseTo(-5 + expectedW / outside.conductanceWPerK, 8);
  });
  it('accounts for exterior heat and radiation without losing energy', () => {
    const column = new LayerColumn(4, layers, 20);
    const airCapacity = 1000;
    const before = column.energyJ() + 20 * airCapacity;
    const result = column.step(3600, 20, airCapacity, 3, -10, 25, 500, 120);
    expect(column.energyJ() + result.airC * airCapacity - before).toBeCloseTo(result.outsideJ + 620 * 3600, 5);
    expect((20 - result.airC) * airCapacity).toBeCloseTo(result.insideJ, 6);
  });
  it('retains slab heat and releases it after source switch-off', () => {
    const slab = new LayerColumn(10, [{ label: 'Concrete', thicknessM: 0.1, k: 1.7, density: 2300, cp: 880 }], 20);
    let airC = 20;
    for (let i = 0; i < 360; i++) airC = slab.step(10, airC, 60000, 5, 20, 0, 1000).airC;
    const atOff = airC;
    for (let i = 0; i < 60; i++) airC = slab.step(10, airC, 60000, 5, 20, 0).airC;
    expect(airC).toBeGreaterThan(atOff);
  });
  it('converges under spatial refinement in a representative slab transient', () => {
    const run = (n: number) => {
      const c = new LayerColumn(1, [{ label: 'Concrete', thicknessM: 0.1, k: 1.7, density: 2300, cp: 880 }], 20, n);
      for (let i = 0; i < 3600; i += 2) c.stepBoundaries(2, { temperatureC: 30, conductanceWPerK: 8 }, { temperatureC: 5, conductanceWPerK: 25 });
      return c.energyJ();
    };
    expect(Math.abs(run(6) / run(12) - 1)).toBeLessThan(0.02);
  });
  it('resets and applies surface energy against a fixed 0°C reference', () => {
    const c = new LayerColumn(2, layers, 20);
    expect(c.energyJ()).toBeCloseTo(c.capacityJPerK * 20, 6);
    const before = c.energyJ(); c.applyInsideHeat(250);
    expect(c.energyJ() - before).toBeCloseTo(250, 7);
    c.reset(5); expect(c.energyJ()).toBeCloseTo(c.capacityJPerK * 5, 7);
    expect(c.insideC).toBe(5);
  });
});

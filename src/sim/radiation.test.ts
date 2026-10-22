import { describe, expect, it } from 'vitest';
import { RadiationEnclosure, rayBoxDistance, segmentVisible, STEFAN_BOLTZMANN, type RadiationPatch } from './radiation';
const plates: RadiationPatch[] = [
  { area: 2, center: [0, 0, 0], normal: [0, 0, 1], emissivity: 0.8 },
  { area: 2, center: [0, 0, 1], normal: [0, 0, -1], emissivity: 0.6 },
];
describe('Diffuse-gray thermal radiation', () => {
  it('matches the analytical infinite parallel plate case', () => {
    const radiation = new RadiationEnclosure(plates);
    const watts = radiation.exchange([60, 20]);
    const expected = 2 * STEFAN_BOLTZMANN * (333.15 ** 4 - 293.15 ** 4) / (1 / 0.8 + 1 / 0.6 - 1);
    expect(watts[0]).toBeCloseTo(-expected, 8);
    expect(watts[1]).toBeCloseTo(expected, 8);
  });
  it('exchanges no net energy at equal temperatures', () => {
    const radiation = new RadiationEnclosure(plates);
    expect(Math.max(...radiation.exchange([23, 23]).map(Math.abs))).toBeLessThan(1e-10);
  });
  it('retains reciprocal factors and exact energy cancellation in unequal-area enclosures', () => {
    const patches: RadiationPatch[] = [
      { area: 2, center: [0, 0.5, 0.5], normal: [1, 0, 0], emissivity: 0.7 },
      { area: 3, center: [1, 0.5, 0.5], normal: [-1, 0, 0], emissivity: 0.9 },
      { area: 4, center: [0.5, 0.5, 0], normal: [0, 0, 1], emissivity: 0.5 },
      { area: 3, center: [0.5, 0.5, 1], normal: [0, 0, -1], emissivity: 0.8 },
    ];
    const radiation = new RadiationEnclosure(patches);
    for (let i = 0; i < 4; i++) {
      expect(radiation.viewFactors.slice(i * 4, i * 4 + 4).reduce((s, f) => s + f, 0)).toBeCloseTo(1, 9);
      for (let j = 0; j < 4; j++) expect(patches[i].area * radiation.viewFactors[i * 4 + j]).toBeCloseTo(patches[j].area * radiation.viewFactors[j * 4 + i], 9);
    }
    expect(radiation.exchange([20, 15, 40, 10]).reduce((s, w) => s + w, 0)).toBeCloseTo(0, 10);
    expect(Math.max(...radiation.exchange([20, 20, 20, 20]).map(Math.abs))).toBeLessThan(1e-7);
  });
  it('blocks radiation behind opaque furniture', () => {
    const blocker = { min: [-1, -1, 0.4] as const, max: [1, 1, 0.6] as const };
    const radiation = new RadiationEnclosure(plates, [blocker]);
    expect(Array.from(radiation.exchange([60, 20]))).toEqual([0, 0]);
    expect(segmentVisible([0, 0, 0], [0, 0, 1], [blocker])).toBe(false);
    expect(rayBoxDistance([2, 0, 0], [0, 0, 1], blocker)).toBeNull();
  });
});

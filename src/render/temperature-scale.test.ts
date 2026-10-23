import { expect, it } from 'vitest';
import { PALETTE_IDS, paletteColor, paletteCssGradient } from './palette';
import { temperaturePosition, temperatureStrength } from './temperature-scale';

it('anchors colours to 15–25°C and clamps temperatures outside the scale', () => {
  expect([-40, 15, 20, 25, 80].map(temperaturePosition)).toEqual([0, 0, 0.5, 1, 1]);
  for (const palette of PALETTE_IDS) {
    expect(paletteColor(palette, temperaturePosition(-40))).toEqual(paletteColor(palette, 0));
    expect(paletteColor(palette, temperaturePosition(80))).toEqual(paletteColor(palette, 1));
  }
});

it('keeps a faint neutral tint and increases opacity smoothly and symmetrically', () => {
  expect(temperatureStrength(20)).toBe(0.04);
  expect(temperatureStrength(22.5)).toBeCloseTo(0.52);
  let previous = temperatureStrength(20);
  for (let delta = 0.1; delta <= 5; delta += 0.1) {
    const strength = temperatureStrength(20 + delta);
    expect(strength).toBeCloseTo(temperatureStrength(20 - delta));
    expect(strength).toBeGreaterThan(previous);
    expect(strength).toBeLessThanOrEqual(1);
    previous = strength;
  }
  for (const temperature of [-40, 15, 25, 80]) expect(temperatureStrength(temperature)).toBe(1);
  expect(temperatureStrength(20.001) - temperatureStrength(20)).toBeLessThan(0.000001);
  expect(temperatureStrength(25) - temperatureStrength(24.999)).toBeLessThan(0.000001);
});

it.each(PALETTE_IDS)('shows the neutral fade in the %s legend', palette => {
  const gradient = paletteCssGradient(palette, 'to right');
  expect(gradient).toContain(`rgba(${paletteColor(palette, 0.5).join(',')},0.04) 50%`);
  expect(gradient).toContain(`rgba(${paletteColor(palette, 0).join(',')},1) 0%`);
  expect(gradient).toContain(`rgba(${paletteColor(palette, 1).join(',')},1) 100%`);
});

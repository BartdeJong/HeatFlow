export type PaletteId = 'heat' | 'thermal';

type Stops = ReadonlyArray<readonly [number, number, number, number]>;

/** Palette stops (position 0..1, RGB 0..255). */
export const PALETTES: Record<PaletteId, { label: string; stops: Stops }> = {
  heat: {
    label: 'Heatmap',
    stops: [
      [0.0, 20, 40, 120],
      [0.25, 40, 130, 200],
      [0.45, 90, 200, 140],
      [0.62, 240, 220, 70],
      [0.8, 240, 120, 40],
      [1.0, 200, 30, 30],
    ],
  },
  thermal: {
    label: 'Thermal camera',
    stops: [
      [0.0, 0, 0, 20],
      [0.2, 50, 0, 110],
      [0.4, 150, 20, 110],
      [0.6, 230, 70, 30],
      [0.8, 250, 170, 20],
      [1.0, 255, 255, 210],
    ],
  },
};

export const PALETTE_IDS = Object.keys(PALETTES) as PaletteId[];

export function paletteColor(id: PaletteId, t: number): [number, number, number] {
  const stops = PALETTES[id].stops;
  const x = Math.min(1, Math.max(0, t));
  for (let i = 1; i < stops.length; i++) {
    const [p1, r1, g1, b1] = stops[i];
    if (x <= p1) {
      const [p0, r0, g0, b0] = stops[i - 1];
      const k = (x - p0) / (p1 - p0);
      return [r0 + (r1 - r0) * k, g0 + (g1 - g0) * k, b0 + (b1 - b0) * k];
    }
  }
  const last = stops[stops.length - 1];
  return [last[1], last[2], last[3]];
}

/** 256-entry RGBA lookup table for the palette. */
export function paletteBytes(id: PaletteId): Uint8Array {
  const out = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    const [r, g, b] = paletteColor(id, i / 255);
    out.set([Math.round(r), Math.round(g), Math.round(b), 255], i * 4);
  }
  return out;
}

export function paletteCssGradient(id: PaletteId, direction = 'to top'): string {
  const stops = PALETTES[id].stops.map(([p, r, g, b]) => `rgb(${r},${g},${b}) ${p * 100}%`);
  return `linear-gradient(${direction}, ${stops.join(', ')})`;
}

/** Heat palette stops (position 0..1, RGB 0..255). Shared by the shader, fallback renderer and legend. */
export const PALETTE: ReadonlyArray<readonly [number, number, number, number]> = [
  [0.0, 20, 40, 120],
  [0.25, 40, 130, 200],
  [0.45, 90, 200, 140],
  [0.62, 240, 220, 70],
  [0.8, 240, 120, 40],
  [1.0, 200, 30, 30],
];

export function paletteColor(t: number): [number, number, number] {
  const x = Math.min(1, Math.max(0, t));
  for (let i = 1; i < PALETTE.length; i++) {
    const [p1, r1, g1, b1] = PALETTE[i];
    if (x <= p1) {
      const [p0, r0, g0, b0] = PALETTE[i - 1];
      const k = (x - p0) / (p1 - p0);
      return [r0 + (r1 - r0) * k, g0 + (g1 - g0) * k, b0 + (b1 - b0) * k];
    }
  }
  const last = PALETTE[PALETTE.length - 1];
  return [last[1], last[2], last[3]];
}

export function paletteCssGradient(direction = 'to top'): string {
  const stops = PALETTE.map(([p, r, g, b]) => `rgb(${r},${g},${b}) ${p * 100}%`);
  return `linear-gradient(${direction}, ${stops.join(', ')})`;
}

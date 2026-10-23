import { afterEach, expect, it, vi } from 'vitest';
import { DEFAULT_ROOM } from '../sim/config';
import { Simulation } from '../sim/simulation';
import { defaultCamera, viewTransform } from './camera';
import { createRenderer, type RenderView } from './heatmap';
import { PALETTE_IDS, type PaletteId } from './palette';

afterEach(() => vi.unstubAllGlobals());

function fallback(palette: PaletteId) {
  const fills: string[] = [];
  const context = { fillStyle: '', setTransform() {}, clearRect() { fills.length = 0; },
    beginPath() {}, lineTo() {}, closePath() {}, fill() { fills.push(this.fillStyle); } };
  const canvas = { width: 400, height: 300, clientWidth: 400, clientHeight: 300, getContext: () => context };
  vi.stubGlobal('window', { devicePixelRatio: 1 });
  vi.stubGlobal('document', { createElement: () => ({ getContext: () => null }) });
  return { renderer: createRenderer(canvas as unknown as HTMLCanvasElement, palette), fills };
}

function view(mode: RenderView['mode'], walkMode = false): RenderView {
  return { transform: viewTransform(DEFAULT_ROOM, defaultCamera(), 400, 300),
    size: [DEFAULT_ROOM.widthM, DEFAULT_ROOM.heightM, DEFAULT_ROOM.ceilingM], mode, axis: 'z', fraction: 0.5, walkMode };
}

it.each(PALETTE_IDS)('fades neutral air and shows uniformly warm/cold air in the %s fallback', palette => {
  const { renderer, fills } = fallback(palette);
  const sim = new Simulation({ ...DEFAULT_ROOM, furniture: [] });
  for (const mode of ['slice', 'volume'] as const) for (const walkMode of [false, true]) {
    const alphas = [20, 15, 25].map(temperature => {
      sim.T.fill(temperature);
      renderer.render(sim, view(mode, walkMode));
      expect(fills.length).toBeGreaterThan(0);
      return fills.map(color => Number(color.slice(color.lastIndexOf(',') + 1, -1)));
    });
    expect(Math.max(...alphas[0])).toBeLessThan(0.04);
    expect(Math.min(...alphas[1])).toBeGreaterThan(0.6);
    expect(alphas[1]).toEqual(alphas[2]);
  }
});

it('keeps the same sample appearance across changes to the room temperature distribution', () => {
  const { renderer, fills } = fallback('heat');
  const sim = new Simulation({ ...DEFAULT_ROOM, furniture: [] });
  // Display filtering may retain the same visible sample while solver statistics change.
  const renderView = { ...view('slice'), temperatureField: { T: Float32Array.from(sim.T), sample: () => 22 } };
  sim.T.fill(20);
  renderer.render(sim, renderView);
  const before = [...fills];
  sim.T.fill(40);
  renderer.render(sim, renderView);
  expect(fills).toEqual(before);
});

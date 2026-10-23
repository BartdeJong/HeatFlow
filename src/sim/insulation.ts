import type { RoomConfig } from './config';
import { DEFAULT_FLOOR_LAYERS, floorLayers, getModel } from './model';

export const INSULATION_LEVELS = [
  { id: 'none', label: 'None', wallM: 0, roofM: 0, floorM: 0 },
  { id: 'basic', label: 'Basic', wallM: 0.05, roofM: 0.1, floorM: 0.04 },
  { id: 'good', label: 'Good', wallM: 0.1, roofM: 0.2, floorM: 0.08 },
  { id: 'high', label: 'High', wallM: 0.15, roofM: 0.3, floorM: 0.12 },
] as const;

export type InsulationLevel = (typeof INSULATION_LEVELS)[number]['id'];

const isInsulationLayer = (label: string, conductivity: number) =>
  label.toLowerCase().includes('insulation') || conductivity <= 0.06;

const defaultFloorInsulation = DEFAULT_FLOOR_LAYERS.find((layer) =>
  isInsulationLayer(layer.label, layer.k),
) ?? { label: 'Floor insulation', thicknessM: 0.08, k: 0.035, density: 30, cp: 1400 };

const defaultFloorBaseLayers = DEFAULT_FLOOR_LAYERS.filter((layer) =>
  !isInsulationLayer(layer.label, layer.k),
);

export function isInsulationLevel(value: string): value is InsulationLevel {
  return INSULATION_LEVELS.some((level) => level.id === value);
}

export function matchingInsulationLevel(room: RoomConfig): InsulationLevel | undefined {
  const floorM = floorLayers(room)
    .filter((layer) => isInsulationLayer(layer.label, layer.k))
    .reduce((sum, layer) => sum + layer.thicknessM, 0);
  return INSULATION_LEVELS.find((level) =>
    Math.abs(room.wall.insulationM - level.wallM) < 1e-6 &&
    Math.abs(room.roof.insulationM - level.roofM) < 1e-6 &&
    Math.abs(floorM - level.floorM) < 1e-6,
  )?.id;
}

export function applyInsulationLevel(room: RoomConfig, id: InsulationLevel): RoomConfig {
  const level = INSULATION_LEVELS.find((candidate) => candidate.id === id);
  if (!level) throw new Error(`Unknown insulation level: ${id}`);

  const model = getModel(room);
  const existingFloorInsulation = model.floor.layers.find((layer) =>
    isInsulationLayer(layer.label, layer.k),
  );
  const floorBaseLayers = model.floor.layers.filter((layer) =>
    !isInsulationLayer(layer.label, layer.k),
  );
  const floorBase = floorBaseLayers.length ? floorBaseLayers : defaultFloorBaseLayers;
  const layers = level.floorM > 0
    ? [...floorBase, { ...(existingFloorInsulation ?? defaultFloorInsulation), thicknessM: level.floorM }]
    : [...floorBase];

  return {
    ...room,
    wall: { ...room.wall, insulationM: level.wallM },
    roof: { ...room.roof, insulationM: level.roofM },
    model: { ...model, floor: { ...model.floor, layers } },
  };
}

import type { RoomConfig } from './config';
import type { AirStats } from './field';
import type { HeatLossBreakdown, SimulationDiagnostics } from './simulation';

export interface HistorySnapshot { times: number[]; series: [string, number[]][] }
/** Arrays are read-only to consumers and valid until the next accepted snapshot. */
export interface SimulationSnapshot {
  type: 'snapshot'; generation: number; revision: number;
  nx: number; ny: number; nz: number; dx: number; dy: number; dz: number; elapsed: number;
  T: Float64Array; solid: Uint8Array; volume: Float64Array;
  u: Float64Array; v: Float64Array; w: Float64Array;
  stats: AirStats; diagnostics: SimulationDiagnostics; furnitureTemps: Record<number, number>;
  heatLoss: HeatLossBreakdown; energy: { heating: number; cooling: number };
  thermostatHeating: boolean; achievedSpeed: number; history: HistorySnapshot;
}
export type WorkerCommand =
  | { type: 'init' | 'configure'; room: RoomConfig; generation: number; revision: number }
  | { type: 'control'; running: boolean; speed: number }
  | { type: 'reset'; generation: number; revision: number }
  | { type: 'recycle'; buffers: ArrayBuffer[] };
export function snapshotBuffers(snapshot: SimulationSnapshot): ArrayBuffer[] {
  return [snapshot.T, snapshot.solid, snapshot.volume, snapshot.u, snapshot.v, snapshot.w].map(array => array.buffer as ArrayBuffer);
}
/** Only geometry/storage changes restart a run. Weather, openings, sensors and power update live. */
export function geometryKey(room: RoomConfig): string {
  return JSON.stringify([room.widthM, room.heightM, room.ceilingM, room.convection, room.furniture,
    room.wall, room.roof.insulationM, room.model?.quality ?? 'balanced', room.model?.wallLayers,
    room.model?.roofLayers, room.model?.floor.layers]);
}

import { afterEach, describe, expect, it, vi } from 'vitest';
afterEach(() => vi.useRealTimers());
import { DEFAULT_PHYSICS, DEFAULT_ROOM, sanitizeRoom, type RoomConfig } from './config';
import { DEFAULT_MODEL } from './model';
import { Simulation } from './simulation';
import { SimulationClient, SnapshotField, type WorkerPort } from './runtime';
import { WorkerEngine } from './simulation.worker';
import { geometryKey, snapshotBuffers, type SimulationSnapshot, type WorkerCommand } from './protocol';
import { furnitureBoxes } from './furniture';

function room(): RoomConfig {
  return sanitizeRoom({ ...structuredClone(DEFAULT_ROOM), widthM: 10, heightM: 2, ceilingM: 2, convection: false,
    thermostat: { enabled: false, targetC: 20, deadbandC: .5 }, model: { ...structuredClone(DEFAULT_MODEL), quality: 'coarse', radiation: false, leakageACH: 0 },
    sources: [{ id: 1, kind: 'heat', x: 1, y: 1, z: .5, powerKW: .3 }], probes: [{ id: 1, x: 1, y: 1, z: 1 }] });
}
function engine() {
  const instance = new WorkerEngine(() => 0, r => new Simulation(r, { ...DEFAULT_PHYSICS, uScale: 0 }));
  instance.handle({ type: 'init', room: room(), generation: 1, revision: 1 });
  return instance;
}
class FakeWorker implements WorkerPort {
  onmessage: WorkerPort['onmessage'] = null; onerror: WorkerPort['onerror'] = null;
  messages: WorkerCommand[] = []; terminated = false;
  postMessage(message: WorkerCommand) { this.messages.push(message); }
  terminate() { this.terminated = true; }
  emit(snapshot: SimulationSnapshot) { this.onmessage?.({ data: snapshot } as MessageEvent<SimulationSnapshot>); }
}

describe('worker engine and snapshot field', () => {
  it('matches the direct solver at identical timesteps, including field sampling', () => {
    const worker = engine(), direct = new Simulation(room(), { ...DEFAULT_PHYSICS, uScale: 0 });
    worker.advance(2, Infinity);
    while (direct.elapsed < 2 - 1e-9) direct.advance(Math.min(1, 2 - direct.elapsed), 1);
    const snapshot = worker.snapshot()!;
    expect(snapshot.elapsed).toBe(2);
    expect([...snapshot.T]).toEqual([...direct.T]);
    expect(snapshot.stats).toEqual(direct.stats());
    expect(snapshot.energy).toEqual(direct.energyUseKWh());
    const field = new SnapshotField(); field.apply(snapshot, room());
    expect(field.stats().mean).toBeCloseTo(direct.stats().mean, 10);
    expect(field.stats().min).toBe(direct.stats().min);
    expect(field.stats().max).toBe(direct.stats().max);
    expect(field.sample(1.2, .8, 1.3)).toBe(direct.sample(1.2, .8, 1.3));
    expect(field.sampleVelocity(1.2, .8, 1.3)).toEqual(direct.sampleVelocity(1.2, .8, 1.3));
  });
  it('records every simulated interval even at acceleration and clears moved/removed probes', () => {
    const worker = engine();
    worker.handle({ type: 'control', running: true, speed: 1000 });
    worker.runChunk(.012, Infinity);
    let snapshot = worker.snapshot()!;
    expect(snapshot.history.times).toEqual([0, 5, 10]);
    expect(snapshot.elapsed).toBe(12);
    const changed = room(); changed.probes[0].x = 3;
    worker.handle({ type: 'configure', room: changed, generation: 1, revision: 2 });
    snapshot = worker.snapshot()!;
    expect(new Map(snapshot.history.series).get('p1')!.every(Number.isNaN)).toBe(true);
    changed.probes = [];
    worker.handle({ type: 'configure', room: changed, generation: 1, revision: 3 });
    expect(new Map(worker.snapshot()!.history.series).has('p1')).toBe(false);
  });
  it('only scans statistics when recording and leaves full diagnostics to publication', () => {
    const sim = new Simulation(room(), { ...DEFAULT_PHYSICS, uScale: 0 });
    const stats = vi.spyOn(sim, 'stats'), diagnostics = vi.spyOn(sim, 'diagnostics');
    const worker = new WorkerEngine(() => 0, () => sim);
    worker.handle({ type: 'init', room: room(), generation: 1, revision: 1 });
    worker.advance(12, Infinity);
    // This scenario disables convection and leakage, so step() also calls stats once
    // per physics step for the thermostat; recording adds just three scans (0, 5, 10).
    const steps = vi.spyOn(sim, 'advance');
    stats.mockClear();
    worker.advance(2, Infinity);
    expect(stats).toHaveBeenCalledTimes(steps.mock.calls.length);
    expect(diagnostics).not.toHaveBeenCalled();
    expect(worker.snapshot()!.history.times).toEqual([0, 5, 10]);
    expect(diagnostics).toHaveBeenCalledTimes(1);
  });
  it('retains bounded scheduling deficits and clears them on pause and speed changes', () => {
    let wall = 0;
    const sim = new Simulation(room(), { ...DEFAULT_PHYSICS, uScale: 0 });
    const advance = sim.advance.bind(sim);
    vi.spyOn(sim, 'advance').mockImplementation((seconds, maxSteps) => {
      wall += 10;
      return advance(seconds, maxSteps);
    });
    const worker = new WorkerEngine(() => wall, () => sim);
    worker.handle({ type: 'init', room: room(), generation: 1, revision: 1 });
    worker.handle({ type: 'control', running: true, speed: 300 });
    worker.runChunk(.01, 10);
    const partial = sim.elapsed;
    expect(partial).toBeGreaterThan(0); expect(partial).toBeLessThan(3);
    worker.runChunk(0, Infinity);
    expect(sim.elapsed).toBe(3);
    worker.runChunk(10, 10);
    const beforeCatchup = sim.elapsed;
    worker.runChunk(0, Infinity);
    expect(sim.elapsed).toBeCloseTo(33, 8); // Suspension contributes at most 100ms × 300.
    expect(sim.elapsed).toBeGreaterThan(beforeCatchup);
    worker.runChunk(.01, 10);
    worker.handle({ type: 'control', running: false, speed: 300 });
    const paused = sim.elapsed;
    worker.runChunk(.1, Infinity);
    worker.handle({ type: 'control', running: true, speed: 1 });
    worker.runChunk(0, Infinity);
    expect(sim.elapsed).toBe(paused);
  });
  it('pauses, resets histories, and applies live edits without restarting time', () => {
    const worker = engine();
    worker.runChunk(.1, Infinity);
    expect(worker.snapshot()!.elapsed).toBe(0);
    worker.handle({ type: 'control', running: true, speed: 10 });
    worker.runChunk(.1, Infinity);
    expect(worker.snapshot()!.elapsed).toBe(1);
    const changed = room(); changed.outsideC = -10; changed.sources[0].powerKW = .5;
    expect(geometryKey(changed)).toBe(geometryKey(room()));
    worker.handle({ type: 'configure', room: changed, generation: 1, revision: 2 });
    expect(worker.snapshot()!.elapsed).toBe(1);
    worker.handle({ type: 'control', running: false, speed: 10 });
    worker.runChunk(1, Infinity);
    expect(worker.snapshot()!.elapsed).toBe(1);
    worker.handle({ type: 'reset', generation: 2, revision: 2 });
    const snapshot = worker.snapshot()!;
    expect(snapshot.elapsed).toBe(0); expect(snapshot.generation).toBe(2);
    expect(snapshot.history.times).toEqual([0]);
  });

  it('rebuilds simulation geometry when the room outline changes', () => {
    const rectangular = room();
    const shaped = { ...rectangular, footprint: [
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 1 }, { x: 8, y: 1 }, { x: 8, y: 2 }, { x: 0, y: 2 },
    ] };
    expect(geometryKey(shaped)).not.toBe(geometryKey(rectangular));
  });

  it('recovers a failed solver after a live edit, respecting the latest Play/Pause control', () => {
    const config = room();
    const worker = new WorkerEngine(() => 0, r => {
      const sim = new Simulation(r, { ...DEFAULT_PHYSICS, uScale: 0 });
      if (r.outsideC === 0) {
        vi.spyOn(sim, 'advance').mockReturnValue(0);
        vi.spyOn(sim, 'failure', 'get').mockReturnValue('Blocked ventilation path');
      }
      return sim;
    });
    worker.handle({ type: 'init', room: config, generation: 1, revision: 1 });
    worker.handle({ type: 'control', running: true, speed: 10 });
    worker.runChunk(.1, Infinity);
    expect(worker.snapshot()!.diagnostics.failure).toBe('Blocked ventilation path');
    worker.handle({ type: 'control', running: false, speed: 10 });
    const corrected = room(); corrected.outsideC = -5;
    expect(geometryKey(corrected)).toBe(geometryKey(config));
    worker.handle({ type: 'configure', room: corrected, generation: 1, revision: 2 });
    expect(worker.snapshot()!.diagnostics.failure).toBeNull();
    worker.runChunk(.1, Infinity);
    expect(worker.snapshot()!.elapsed).toBe(0);
    worker.handle({ type: 'control', running: true, speed: 10 });
    worker.runChunk(.1, Infinity);
    expect(worker.snapshot()!.elapsed).toBe(1);
  });

  it('transfers copies and recycles buffers without detaching solver storage', () => {
    const worker = engine(), before = worker.snapshot()!;
    const transferred = structuredClone(before, { transfer: snapshotBuffers(before) });
    expect(before.T.byteLength).toBe(0);
    expect(transferred.T.length).toBeGreaterThan(0);
    const buffers = snapshotBuffers(transferred);
    worker.handle({ type: 'recycle', buffers });
    worker.advance(.25, Infinity);
    const after = worker.snapshot()!;
    expect(after.T.length).toBe(transferred.T.length);
    expect(buffers).toContain(after.T.buffer);
    expect(after.T.every(Number.isFinite)).toBe(true);
    expect(after.elapsed).toBe(.25);
  });
  it('samples staggered velocities and exact furniture solids independently of cell flags', () => {
    const worker = engine(), snapshot = worker.snapshot()!, config = room();
    config.furniture = [{ id: 1, kind: 'table', material: 'wood', x: 3, y: 1, widthM: 1.4, depthM: .9, heightM: .8, rotation: 0 }];
    snapshot.u.fill(1); snapshot.v.fill(2); snapshot.w.fill(3);
    const field = new SnapshotField(); field.apply(snapshot, config);
    const top = furnitureBoxes(config.furniture[0]).find(b => b.part === 'top')!;
    const p = top.min.map((x, a) => (x + top.max[a]) / 2) as [number, number, number];
    expect(field.isSolid(...p)).toBe(true);
    expect(field.sampleVelocity(...p)).toEqual([0, 0, 0]);
    expect(field.isSolid(3, 1, .3)).toBe(false);
    expect(field.sampleVelocity(3, 1, .3)).toEqual([1, 2, 3]);
  });

  it('matches direct temperatures near partially occupied cells and inside furniture', () => {
    const config = room();
    config.furniture = [{ id: 4, kind: 'table', material: 'wood', x: 2.17, y: 1.03, widthM: 1.4, depthM: .9, heightM: .8, rotation: 0 }];
    const direct = new Simulation(config, { ...DEFAULT_PHYSICS, uScale: 0 });
    const worker = new WorkerEngine(() => 0, () => direct);
    worker.handle({ type: 'init', room: config, generation: 1, revision: 1 });
    for (let i = 0; i < direct.T.length; i++) direct.T[i] = 10 + i % 13;
    const snapshot = worker.snapshot()!, field = new SnapshotField();
    field.apply(snapshot, config);
    expect([...snapshot.volume].some(v => v > 0 && v < direct.dx * direct.dy * direct.dz * .99)).toBe(true);
    for (const point of [[2.17, 1.03, .75], [2.17, 1.03, .3], [2.85, 1.03, .83], [1.46, .6, .1]] as [number, number, number][]) {
      expect(field.sample(...point)).toBe(direct.sample(...point));
      expect(field.isSolid(...point)).toBe(direct.isSolid(...point));
    }
    expect(field.sample(2.17, 1.03, .75)).toBe(snapshot.furnitureTemps[4]);
    expect(field.stats().mean).toBeCloseTo(direct.stats().mean, 10);
  });

  it('reports construction/solver failure without advancing or hiding the error', () => {
    const failed = new WorkerEngine(() => 0, () => { throw new Error('Test model failure'); });
    failed.handle({ type: 'init', room: room(), generation: 1, revision: 1 });
    failed.handle({ type: 'control', running: true, speed: 1000 });
    failed.runChunk(10, Infinity);
    const snapshot = failed.snapshot()!;
    expect(snapshot.elapsed).toBe(0);
    expect(snapshot.diagnostics.failure).toBe('Test model failure');
    expect(snapshot.T.every(Number.isFinite)).toBe(true);
  });
});

describe('main-thread worker protocol', () => {
  it('keeps field identity and rejects snapshots after edits/reset/dispose', () => {
    const port = new FakeWorker(), client = new SimulationClient(port), field = client.field;
    let updates = 0; client.onUpdate = () => updates++;
    client.configure(room());
    const snapshot = engine().snapshot()!;
    port.emit(snapshot);
    expect(updates).toBe(1); expect(client.field).toBe(field);
    const changed = room(); changed.outsideC = -5; client.configure(changed);
    port.emit(snapshot);
    expect(updates).toBe(1);
    port.emit({ ...snapshot, revision: 2 });
    expect(updates).toBe(2); expect(client.field).toBe(field);
    client.reset(); port.emit({ ...snapshot, revision: 2 });
    expect(updates).toBe(2);
    port.emit({ ...snapshot, generation: 2, revision: 2 });
    expect(updates).toBe(3); expect(client.field).toBe(field);
    expect(port.messages.some(m => m.type === 'recycle')).toBe(true);
    client.dispose(); port.emit({ ...snapshot, generation: 2, revision: 2 });
    expect(updates).toBe(3); expect(port.terminated).toBe(true);
  });
  it('changes generation on mesh/storage edits but keeps power/weather revisions live', () => {
    vi.useFakeTimers();
    const port = new FakeWorker(), client = new SimulationClient(port);
    client.configure(room());
    const changed = room(); changed.sources[0].powerKW = 2; changed.model!.environment.windMps = 4;
    client.configure(changed);
    changed.model!.quality = 'fine'; client.configure(changed);
    vi.advanceTimersByTime(75);
    const commands = port.messages.filter((m): m is Extract<WorkerCommand, { room: RoomConfig }> => m.type === 'init' || m.type === 'configure');
    expect(commands.map(m => m.generation)).toEqual([1, 1, 2]);
    expect(commands.map(m => m.revision)).toEqual([1, 2, 3]);
    client.dispose();
  });
  it('coalesces dragging geometry and invalidates stale responses during the debounce', () => {
    vi.useFakeTimers();
    const port = new FakeWorker(), client = new SimulationClient(port);
    let updates = 0; client.onUpdate = () => updates++;
    client.configure(room());
    const changed = room(); changed.widthM = 9; client.configure(changed);
    port.emit(engine().snapshot()!);
    expect(updates).toBe(0);
    vi.advanceTimersByTime(20);
    changed.widthM = 8; client.configure(changed);
    vi.advanceTimersByTime(74);
    expect(port.messages.filter(m => m.type === 'init' || m.type === 'configure')).toHaveLength(1);
    vi.advanceTimersByTime(1);
    const commands = port.messages.filter((m): m is Extract<WorkerCommand, { room: RoomConfig }> => 'room' in m);
    expect(commands).toHaveLength(2);
    expect(commands[1].room.widthM).toBe(8);
    expect(commands[1]).toMatchObject({ generation: 3, revision: 3 });
    client.dispose();
  });
  it('flushes the final geometry before controls, folds in resets, and cancels on dispose', () => {
    vi.useFakeTimers();
    const port = new FakeWorker(), client = new SimulationClient(port);
    client.configure(room());
    const changed = room(); changed.widthM = 9; client.configure(changed);
    client.reset();
    expect(port.messages.map(m => m.type)).toEqual(['init', 'configure']);
    expect(port.messages[1]).toMatchObject({ generation: 3, revision: 2 });
    changed.widthM = 8; client.configure(changed);
    client.setControl(false, 10);
    expect(port.messages.slice(-2).map(m => m.type)).toEqual(['configure', 'control']);
    changed.widthM = 7; client.configure(changed);
    const count = port.messages.length;
    client.dispose(); vi.advanceTimersByTime(100);
    expect(port.messages).toHaveLength(count);
  });

});

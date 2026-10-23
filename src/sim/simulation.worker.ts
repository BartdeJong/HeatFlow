import { Simulation } from './simulation';
import { Recorder } from './recorder';
import type { RoomConfig } from './config';
import { geometryKey, snapshotBuffers, type SimulationSnapshot, type WorkerCommand } from './protocol';

/** Testable worker engine. Wall-time limits bound work, never the simulated clock. */
export class WorkerEngine {
  private sim?: Simulation;
  private room?: RoomConfig;
  private key = ''; private generation = 0; private revision = 0;
  private running = false; private requestedRunning = false; private speed = 300; private failure: string | null = null;
  private readonly recorder = new Recorder();
  private buffers: ArrayBuffer[] = [];
  private speedSamples: { wall: number; elapsed: number }[] = [];
  private pendingSeconds = 0;
  constructor(private readonly now: () => number = () => performance.now(), private readonly create: (room: RoomConfig) => Simulation = room => new Simulation(room)) {}
  handle(command: WorkerCommand): boolean {
    if (command.type === 'recycle') {
      for (const buffer of command.buffers) if (buffer.byteLength && this.buffers.length < 24) this.buffers.push(buffer);
      return false;
    }
    if (command.type === 'control') {
      this.requestedRunning = command.running;
      this.running = this.requestedRunning && !this.failure;
      this.speed = Math.max(0, Math.min(1000, Number.isFinite(command.speed) ? command.speed : 1));
      this.speedSamples = [];
      this.pendingSeconds = 0;
      return true;
    }
    if (command.type === 'reset') {
      this.generation = command.generation; this.revision = command.revision;
      if (this.room) this.restart(this.room);
      return true;
    }
    const previous = this.room, key = geometryKey(command.room);
    const restart = !this.sim || !!this.failure || key !== this.key || command.generation !== this.generation;
    this.generation = command.generation; this.revision = command.revision; this.key = key; this.room = command.room;
    if (restart) this.restart(command.room);
    else {
      try {
        this.sim!.setRoom(command.room);
        const keep = new Set(['avg', 'min', 'max', ...command.room.probes.map(p => `p${p.id}`)]);
        this.recorder.removeSeriesExcept(keep);
        for (const p of command.room.probes) {
          const before = previous?.probes.find(q => q.id === p.id);
          if (before && (p.x !== before.x || p.y !== before.y || p.z !== before.z)) this.recorder.clearSeries(`p${p.id}`);
        }
      } catch (error) { this.fail(error); }
    }
    return true;
  }
  private restart(room: RoomConfig) {
    this.failure = null; this.recorder.clear(); this.speedSamples = []; this.pendingSeconds = 0;
    try { this.sim = this.create(room); this.running = this.requestedRunning; this.record(); }
    catch (error) { this.sim = undefined; this.fail(error); }
  }
  private fail(error: unknown) { this.failure = error instanceof Error ? error.message : String(error); this.running = false; }
  private record() {
    const sim = this.sim; if (!sim || !this.room) return;
    if (sim.elapsed < this.recorder.nextSampleAt - 1e-8) return;
    const stats = sim.stats();
    const elapsed = Math.abs(sim.elapsed - this.recorder.nextSampleAt) < 1e-8 ? this.recorder.nextSampleAt : sim.elapsed;
    this.recorder.record(elapsed, { avg: stats.mean, min: stats.min, max: stats.max,
      ...Object.fromEntries(this.room.probes.map(p => [`p${p.id}`, sim.sample(p.x, p.y, p.z)])) });
  }
  /** Bounded deterministic advancement; useful for direct/worker equivalence tests. */
  advance(seconds: number, budgetMs = 10): number {
    if (!this.sim || this.failure || !Number.isFinite(seconds) || seconds <= 0) return 0;
    const started = this.now(), initial = this.sim.elapsed, target = initial + seconds;
    for (let steps = 0; steps < 10000 && this.sim.elapsed < target - 1e-9 && this.now() - started < budgetMs; steps++) {
      this.record();
      const nextSample = this.recorder.nextSampleAt - this.sim.elapsed;
      const step = Math.min(1, target - this.sim.elapsed, nextSample > 1e-9 ? nextSample : 1);
      try {
        const done = this.sim.advance(step, 1);
        const failure = this.sim.failure;
        if (failure) { this.fail(failure); break; }
        if (!(done > 0)) { this.fail('The solver did not advance. Reset the run or change the room configuration.'); break; }
        this.record();
      } catch (error) { this.fail(error); break; }
    }
    return this.sim.elapsed - initial;
  }
  runChunk(wallSeconds: number, budgetMs = 10): number {
    if (!this.running) return 0;
    // Retain short scheduling deficits so yielding/publication does not lose time.
    // Cap debt at 100ms of requested progress, including after tab suspension.
    this.pendingSeconds = Math.min(this.speed * .1, this.pendingSeconds + Math.max(0, Math.min(.1, wallSeconds)) * this.speed);
    const done = this.advance(this.pendingSeconds, budgetMs);
    this.pendingSeconds = Math.max(0, this.pendingSeconds - done);
    return done;
  }
  private array(length: number): Float64Array {
    const size = length * Float64Array.BYTES_PER_ELEMENT, index = this.buffers.findIndex(b => b.byteLength === size);
    return new Float64Array(index < 0 ? new ArrayBuffer(size) : this.buffers.splice(index, 1)[0]);
  }
  private bytes(length: number): Uint8Array {
    const index = this.buffers.findIndex(b => b.byteLength === length);
    return new Uint8Array(index < 0 ? new ArrayBuffer(length) : this.buffers.splice(index, 1)[0]);
  }
  snapshot(): SimulationSnapshot | undefined {
    if (!this.room) return undefined;
    const sim = this.sim, elapsed = sim?.elapsed ?? 0, wall = this.now();
    if (!this.speedSamples.length) this.speedSamples.push({ wall, elapsed });
    this.speedSamples.push({ wall, elapsed });
    while (this.speedSamples.length > 2 && this.speedSamples[1].wall < wall - 1000) this.speedSamples.shift();
    const first = this.speedSamples[0], achievedSpeed = this.running && wall > first.wall ? (elapsed - first.elapsed) * 1000 / (wall - first.wall) : 0;
    const nx = sim?.nx ?? 2, ny = sim?.ny ?? 2, nz = sim?.nz ?? 2;
    const T = this.array(nx * ny * nz), solid = this.bytes(T.length), volume = this.array(T.length);
    const u = this.array((nx + 1) * ny * nz), v = this.array(nx * (ny + 1) * nz), w = this.array(nx * ny * (nz + 1));
    if (sim) { T.set(sim.T); solid.set(sim.solid); volume.set(sim.grid.volume); u.set(sim.flow.u); v.set(sim.flow.v); w.set(sim.flow.w); }
    else {
      T.fill(20); solid.fill(0); volume.fill(this.room.widthM * this.room.heightM * this.room.ceilingM / T.length); u.fill(0); v.fill(0); w.fill(0);
    }
    const diagnostics = sim?.diagnostics() ?? { storedEnergyJ: 0, energyBalanceJ: 0, relativeEnergyError: 0, surfaceTemperatures: [], sensorC: 20,
      ventilationACH: 0, pressureResidual: 0, maxDivergence: 0, iterations: 0, failure: null, solarW: 0, outsideC: this.room.outsideC, netExternalJ: 0 };
    return { type: 'snapshot', generation: this.generation, revision: this.revision, nx, ny, nz,
      dx: sim?.dx ?? this.room.widthM / 2, dy: sim?.dy ?? this.room.heightM / 2, dz: sim?.dz ?? this.room.ceilingM / 2,
      elapsed, T, solid, volume, u, v, w, stats: sim?.stats() ?? { min: 20, max: 20, mean: 20 },
      diagnostics: { ...diagnostics, failure: this.failure ?? diagnostics.failure }, furnitureTemps: sim?.furnitureTemperatures() ?? {},
      heatLoss: sim?.heatLossBreakdownW() ?? { roofW: 0, wallsW: 0, floorW: 0, openingsW: 0, ventilationW: 0, totalW: 0 },
      energy: sim?.energyUseKWh() ?? { heating: 0, cooling: 0 }, thermostatHeating: sim?.thermostatHeatingOn() ?? false, achievedSpeed,
      history: { times: this.recorder.times.slice(), series: [...this.recorder.series].map(([key, values]) => [key, values.slice()]) } };
  }
}

// Guard permits importing WorkerEngine in Node tests without starting a worker loop.
if (typeof self !== 'undefined' && typeof document === 'undefined') {
  const scope = self as unknown as { onmessage: ((event: MessageEvent<WorkerCommand>) => void) | null; postMessage(value: SimulationSnapshot, transfer: Transferable[]): void };
  const engine = new WorkerEngine();
  let lastTick = performance.now(), lastPublish = -Infinity;
  const publish = () => { const snapshot = engine.snapshot(); if (snapshot) scope.postMessage(snapshot, snapshotBuffers(snapshot)); lastPublish = performance.now(); };
  scope.onmessage = event => { if (engine.handle(event.data)) publish(); };
  const tick = () => {
    const now = performance.now(), dt = (now - lastTick) / 1000; lastTick = now;
    engine.runChunk(dt, 10);
    if (performance.now() - lastPublish >= 100) publish();
    setTimeout(tick, 0);
  };
  setTimeout(tick, 0);
}

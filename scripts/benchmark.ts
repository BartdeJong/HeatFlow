import { WorkerEngine } from '../src/sim/simulation.worker';
import { DEFAULT_ROOM, sanitizeRoom } from '../src/sim/config';

// Run outside the test suite so wall-time assertions do not compete with physics tests.
const scenarios = [
  { name: 'Default room', room: DEFAULT_ROOM },
  { name: 'Furnished room', room: { ...DEFAULT_ROOM, furniture: [
    { id: 1, kind: 'table', material: 'wood', x: 1, y: 1, widthM: 1.4, depthM: .9, heightM: .8, rotation: 0 },
  ] } },
];
let failed = false;
for (const scenario of scenarios) {
  const engine = new WorkerEngine();
  engine.handle({ type: 'init', room: sanitizeRoom(scenario.room), generation: 1, revision: 1 });
  engine.handle({ type: 'control', running: true, speed: 300 });
  // Warm up JIT and the room flow before measuring the real worker cadence.
  engine.advance(600, Infinity);
  let previous = performance.now(), published = previous;
  const started = previous, initial = engine.snapshot()!.elapsed;
  while (performance.now() - started < 5000) {
    const now = performance.now();
    engine.runChunk((now - previous) / 1000, 10); previous = now;
    if (now - published >= 100) { engine.snapshot(); published = now; }
    await new Promise(resolve => setTimeout(resolve, 4));
  }
  const wallSeconds = (performance.now() - started) / 1000, snapshot = engine.snapshot()!;
  const achieved = (snapshot.elapsed - initial) / wallSeconds;
  const result = { scenario: scenario.name, requested: 300, achieved: +achieved.toFixed(1),
    relativeEnergyError: snapshot.diagnostics.relativeEnergyError, failure: snapshot.diagnostics.failure };
  console.log(JSON.stringify(result));
  if (achieved < 285 || result.failure || result.relativeEnergyError >= .001) failed = true;
}
if (failed) process.exitCode = 1;

import { trilerp, type Simulation } from '../sim/simulation';

/** A short wall-time display filter; the solver and probe readings remain untouched. */
export class TemperatureDisplay {
  T = new Float32Array(0);
  private sim: Simulation | undefined;
  private elapsed = -1;

  reset() { this.sim = undefined; }

  update(sim: Simulation, wallDt: number) {
    if (sim !== this.sim || sim.elapsed < this.elapsed) {
      this.T = sim.T.slice(); this.sim = sim;
    } else {
      const blend = -Math.expm1(-wallDt / 0.2);
      for (let i = 0; i < this.T.length; i++) this.T[i] += blend * (sim.T[i] - this.T[i]);
    }
    this.elapsed = sim.elapsed;
    let min = Infinity, max = -Infinity, sum = 0, count = 0;
    for (let i = 0; i < this.T.length; i++) if (!sim.solid[i]) {
      min = Math.min(min, this.T[i]); max = Math.max(max, this.T[i]); sum += this.T[i]; count++;
    }
    return count ? { min, max, mean: sum / count } : sim.stats();
  }

  sample(x: number, y: number, z: number): number {
    const sim = this.sim!;
    return trilerp(this.T, sim.nx, sim.ny, sim.nz, x / sim.dx - 0.5, y / sim.dy - 0.5, z / sim.dz - 0.5);
  }
}

import { trilerp, weightedTrilerp, type SimulationField } from '../sim/field';

/** A short wall-time display filter; the solver and probe readings remain untouched. */
export class TemperatureDisplay {
  T = new Float32Array(0);
  private sim: SimulationField | undefined;
  private elapsed = -1;
  private generation = -1;

  reset() { this.sim = undefined; }

  update(sim: SimulationField, wallDt: number) {
    if (sim !== this.sim || sim.elapsed < this.elapsed || (sim.generation ?? -1) !== this.generation) {
      this.T = Float32Array.from(sim.T); this.sim = sim;
    } else {
      const blend = -Math.expm1(-wallDt / 0.2);
      for (let i = 0; i < this.T.length; i++) this.T[i] += blend * (sim.T[i] - this.T[i]);
    }
    this.elapsed = sim.elapsed; this.generation = sim.generation ?? -1;
    let min = Infinity, max = -Infinity, sum = 0, count = 0;
    for (let i = 0; i < this.T.length; i++) if (!sim.solid[i]) {
      min = Math.min(min, this.T[i]); max = Math.max(max, this.T[i]); sum += this.T[i]; count++;
    }
    return count ? { min, max, mean: sum / count } : sim.stats();
  }

  sample(x: number, y: number, z: number): number {
    const sim = this.sim!;
    if (sim.isSolid(x,y,z)) return sim.sample(x,y,z);
    if(sim.volume) return weightedTrilerp(this.T,sim.volume,sim.nx,sim.ny,sim.nz,x/sim.dx-.5,y/sim.dy-.5,z/sim.dz-.5);
    return trilerp(this.T, sim.nx, sim.ny, sim.nz, x / sim.dx - 0.5, y / sim.dy - 0.5, z / sim.dz - 0.5);
  }
}

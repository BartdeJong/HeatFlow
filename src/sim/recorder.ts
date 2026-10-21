/** Time series store with bounded memory: when full, every other sample is dropped and the interval doubles. */
export class Recorder {
  times: number[] = [];
  series = new Map<string, number[]>();
  private interval: number;
  private nextAt = 0;

  constructor(
    private readonly baseInterval = 5,
    private readonly maxPoints = 600,
  ) {
    this.interval = baseInterval;
  }

  clear(): void {
    this.times = [];
    this.series.clear();
    this.interval = this.baseInterval;
    this.nextAt = 0;
  }

  /** Forget the history of one series (e.g. a probe that was moved). */
  clearSeries(key: string): void {
    this.series.get(key)?.fill(NaN);
  }

  removeSeriesExcept(keys: ReadonlySet<string>): void {
    for (const k of [...this.series.keys()]) if (!keys.has(k)) this.series.delete(k);
  }

  /** Store a sample if enough simulated time has passed. Returns true when a sample was taken. */
  record(elapsed: number, values: Record<string, number>): boolean {
    if (elapsed < this.nextAt) return false;
    this.nextAt = elapsed + this.interval;
    const n = this.times.length;
    this.times.push(elapsed);
    for (const key of Object.keys(values)) {
      if (!this.series.has(key)) this.series.set(key, new Array<number>(n).fill(NaN));
    }
    for (const [key, arr] of this.series) arr.push(key in values ? values[key] : NaN);
    if (this.times.length > this.maxPoints) this.decimate();
    return true;
  }

  private decimate(): void {
    const keep = <T>(a: T[]) => a.filter((_, i) => i % 2 === 0);
    this.times = keep(this.times);
    for (const [k, arr] of this.series) this.series.set(k, keep(arr));
    this.interval *= 2;
  }
}

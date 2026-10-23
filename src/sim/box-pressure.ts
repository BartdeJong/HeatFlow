/** Exact separable Neumann Poisson solve for an unobstructed rectangular room.
 * Orthonormal cosine bases diagonalize the finite-volume graph Laplacian.
 * Geometry, transforms and eigenvalues are cached; solves allocate no arrays.
 */
export class BoxPressureSolver {
  private readonly bases: Float64Array[];
  private readonly inverseEigenvalues: Float64Array;
  private readonly first: Float64Array;
  private readonly second: Float64Array;
  constructor(private readonly sizes: readonly number[], spacing: readonly number[]) {
    this.bases = sizes.map(n => Float64Array.from({ length: n * n }, (_, i) => {
      const k = Math.floor(i / n), x = i % n;
      return Math.sqrt((k ? 2 : 1) / n) * Math.cos(Math.PI * k * (x + .5) / n);
    }));
    const [nx, ny, nz] = sizes, [dx, dy, dz] = spacing;
    this.inverseEigenvalues = new Float64Array(nx * ny * nz);
    this.first = new Float64Array(this.inverseEigenvalues.length); this.second = this.first.slice();
    const weights = [dy * dz / dx, dx * dz / dy, dx * dy / dz];
    for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      const eigenvalue = 2 * (weights[0] * (1 - Math.cos(Math.PI * x / nx)) +
        weights[1] * (1 - Math.cos(Math.PI * y / ny)) + weights[2] * (1 - Math.cos(Math.PI * z / nz)));
      this.inverseEigenvalues[(z * ny + y) * nx + x] = eigenvalue ? 1 / eigenvalue : 0;
    }
  }
  solve(rhs: Float64Array, pressure: Float64Array): void {
    this.transform(rhs, this.first, 0, false);
    this.transform(this.first, this.second, 1, false);
    this.transform(this.second, this.first, 2, false);
    for (let i = 0; i < rhs.length; i++) this.first[i] *= this.inverseEigenvalues[i];
    this.transform(this.first, this.second, 2, true);
    this.transform(this.second, this.first, 1, true);
    this.transform(this.first, pressure, 0, true);
  }
  private transform(input: Float64Array, output: Float64Array, axis: number, inverse: boolean) {
    const n = this.sizes[axis], basis = this.bases[axis], stride = axis === 0 ? 1 : axis === 1 ? this.sizes[0] : this.sizes[0] * this.sizes[1];
    const block = stride * n;
    for (let start = 0; start < input.length; start += block) for (let offset = 0; offset < stride; offset++) {
      const base = start + offset;
      for (let k = 0; k < n; k++) {
        let sum = 0;
        if (inverse) for (let x = 0; x < n; x++) sum += basis[x * n + k] * input[base + x * stride];
        else for (let x = 0; x < n; x++) sum += basis[k * n + x] * input[base + x * stride];
        output[base + k * stride] = sum;
      }
    }
  }
}

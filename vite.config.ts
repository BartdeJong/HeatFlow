import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  base: './',
  plugins: [svelte()],
  // The 3D integration tests simulate hours of room heating on shared/CI CPUs.
  test: { environment: 'node', include: ['src/**/*.test.ts'], testTimeout: 60_000, maxWorkers: 1 },
});

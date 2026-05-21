import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [svelte()],
  server: {
    // Allow the app to ?raw-import the canonical legacy fixtures in
    // ../examples (single source of truth, shared with the back-compat tests).
    fs: { allow: ['..'] },
  },
  test: {
    environment: 'node',
  },
});

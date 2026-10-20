import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  // Unit tests never load the project's production .env.
  envDir: resolve('review/altaria-os/empty-env'),
  test: {
    setupFiles: ['./tests/deny-external-network.ts'],
  },
});

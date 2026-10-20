import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  envDir: resolve('review/altaria-os/empty-env'),
  test: { include: ['tests/crm-test.integration.ts'], testTimeout: 30000, maxWorkers: 1 },
});

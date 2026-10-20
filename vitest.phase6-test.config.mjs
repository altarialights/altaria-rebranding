import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';
export default defineConfig({envDir:resolve('review/altaria-os/empty-env'),
  test:{include:['tests/phase6-test.integration.ts'],testTimeout:120_000,maxWorkers:1}});

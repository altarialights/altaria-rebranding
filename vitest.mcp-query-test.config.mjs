import {defineConfig} from 'vitest/config';
import {resolve} from 'node:path';
export default defineConfig({envDir:resolve('review/altaria-os/empty-env'),
  test:{include:['tests/mcp-query-test.integration.ts'],testTimeout:30_000,maxWorkers:1}});

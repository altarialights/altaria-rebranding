import {defineConfig} from 'vitest/config';
import {resolve} from 'node:path';
export default defineConfig({envDir:resolve('review/altaria-os/empty-env'),
  test:{include:['tests/mcp-local-test.integration.ts'],testTimeout:180_000,maxWorkers:1,
    // This transport intentionally returns final JSON results, without progress notifications.
    onConsoleLog(log){if(log.startsWith("responseMode: 'json' drops mid-call notifications."))return false;}}});

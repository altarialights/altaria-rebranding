// @ts-check
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://altarialights.com',
  server: { port: 4321, host: true },
  build: { inlineStylesheets: 'auto' },
});

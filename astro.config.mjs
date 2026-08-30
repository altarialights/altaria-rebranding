// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

const sitemapPaths = new Set([
  '/',
  '/servicios',
  '/desarrollo-web',
  '/marketing',
  '/software',
  '/branding',
  '/contacto',
  '/proyectos/de-zamorano',
]);

export default defineConfig({
  site: 'https://altarialights.com',
  trailingSlash: 'never',
  integrations: [
    sitemap({
      filter(page) {
        return sitemapPaths.has(new URL(page).pathname.replace(/\/$/, '') || '/');
      },
      serialize(item) {
        const url = new URL(item.url);
        url.pathname = url.pathname === '/' ? '/' : url.pathname.replace(/\/$/, '');
        item.url = url.href;
        return item;
      },
    }),
  ],
  server: { port: 4321, host: true },
  build: { inlineStylesheets: 'auto' },
});

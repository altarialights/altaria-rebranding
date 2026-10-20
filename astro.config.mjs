// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import vercel from '@astrojs/vercel';
import { resolve } from 'node:path';

// Local Astro commands must never merge the project's production .env.
const vercelProduction = process.env.VERCEL === '1' && process.env.VERCEL_ENV === 'production';

const sitemapPaths = new Set([
  '/',
  '/servicios',
  '/desarrollo-web',
  '/marketing',
  '/software',
  '/branding',
  '/tarjetas-nfc-personalizadas',
  '/contacto',
  '/medir-nivel-digital',
  '/proyectos/de-zamorano',
]);

export default defineConfig({
  site: 'https://altarialights.com',
  vite: vercelProduction ? {} : { envDir: resolve('review/altaria-os/empty-env') },
  trailingSlash: 'never',
  integrations: [
    sitemap({
      filter(page) {
        const pathname = decodeURI(new URL(page).pathname).replace(/\/$/, '') || '/';
        return sitemapPaths.has(pathname);
      },
      serialize(item) {
        const url = new URL(item.url);
        url.pathname = url.pathname === '/' ? '/' : url.pathname.replace(/\/$/, '');
        item.url = url.href;
        return item;
      },
    }),
  ],
  // Vercel only handles routes that explicitly opt out of prerendering.
  // The rest of the site keeps Astro's default static output.
  adapter: vercel(),
  server: { port: 4321, host: true },
  build: { inlineStylesheets: 'auto' },
});

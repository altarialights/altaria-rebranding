// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import vercel from '@astrojs/vercel';

const sitemapPaths = new Set([
  '/',
  '/servicios',
  '/desarrollo-web',
  '/marketing',
  '/software',
  '/branding',
  '/tarjetas-reseñas-google',
  '/contacto',
  '/medir-nivel-digital',
  '/proyectos/de-zamorano',
]);

export default defineConfig({
  site: 'https://altarialights.com',
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

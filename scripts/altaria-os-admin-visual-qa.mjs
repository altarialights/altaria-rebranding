// Local, unauthenticated visual/security QA. Screenshots stay in ignored review/.
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { chromium } from 'playwright';
import { assertLocalQaUrl } from './lib/local-qa-url.mjs';

const base = 'http://127.0.0.1:4321';
assertLocalQaUrl(`${base}/`);
const folder = resolve('review/altaria-os/phase1');
mkdirSync(folder, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
try {
  for (const viewport of [{ name: 'desktop', width: 1440, height: 900 }, { name: 'mobile', width: 390, height: 844 }]) {
    const browserContext = await browser.newContext({ viewport, deviceScaleFactor: 1 });
    const page = await browserContext.newPage();
    const response = await page.goto(`${base}/admin/login`, { waitUntil: 'networkidle' });
    if (response?.status() !== 200) throw new Error(`Login ${viewport.name} no disponible.`);
    const google = page.getByRole('link', { name: /Continuar con Google/i });
    if (await google.count() !== 1 || !String(await google.getAttribute('href')).startsWith('/auth/altaria/login?')) {
      throw new Error(`Acceso Google staging ausente en ${viewport.name}.`);
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (overflow > 1) throw new Error(`Desbordamiento horizontal en ${viewport.name}: ${overflow}px.`);
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    if (results.violations.length) {
      throw new Error(`Accesibilidad ${viewport.name}: ${results.violations.map((item) => `${item.id}: ${item.nodes.map((node) => node.target.join(' ')).join(', ')}`).join('; ')}`);
    }
    await page.evaluate(() => document.querySelector('astro-dev-toolbar')?.remove());
    await page.screenshot({ path: resolve(folder, `login-${viewport.name}.png`), fullPage: true });
    await browserContext.close();
  }
  const context = await browser.newContext();
  for (const path of ['/admin', '/admin/crm', '/admin/crm/empresas',
    '/admin/crm/oportunidades', '/admin/crm/tareas', '/admin/configuracion',
    '/api/admin/session', '/api/admin/crm/dedup']) {
    const response = await context.request.get(`${base}${path}`, { maxRedirects: 0 });
    if (path.startsWith('/api/')) {
      if (response.status() !== 401) throw new Error(`La API ${path} no rechazó la petición anónima (${response.status()}).`);
    } else if (response.status() !== 303
      || response.headers().location !== '/admin/login') {
      throw new Error(`La ruta ${path} no redirigió al login (${response.status()}).`);
    }
  }
  const workosResponse = await context.request.get(`${base}/auth/altaria/login`, { maxRedirects: 0 });
  const authorizationUrl = new URL(workosResponse.headers().location || '', base);
  if (workosResponse.status() !== 302
    || authorizationUrl.origin !== 'https://api.workos.com'
    || authorizationUrl.pathname !== '/user_management/authorize'
    || authorizationUrl.searchParams.get('provider') !== 'authkit'
    || authorizationUrl.searchParams.get('redirect_uri') !== `${base}/auth/altaria/callback`
    || authorizationUrl.searchParams.get('code_challenge_method') !== 'S256'
    || !authorizationUrl.searchParams.get('state')) {
    throw new Error('El enlace Google no inicia OAuth staging con callback loopback y PKCE.');
  }
  for (const path of ['/', '/tarjetas-nfc-personalizadas']) {
    const response = await context.request.get(`${base}${path}`);
    if (response.status() !== 200) throw new Error(`La ruta pública ${path} no respondió 200.`);
  }
  await context.close();
  console.log('QA local: login desktop/móvil accesible; OAuth staging con callback loopback y PKCE; rutas privadas cerradas y públicas 200.');
} finally {
  await browser.close();
}

import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import profile from '../src/data/contact-cards/navaluenga.json' with { type: 'json' };
import { assertLocalQaUrl } from './lib/local-qa-url.mjs';

const base = process.env.BASE_URL ?? 'http://127.0.0.1:4323';
assertLocalQaUrl(base);
const output = 'review/navaluenga';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const report = { viewports: [], accessibility: [], vcard: {}, share: {} };
try {
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: width < 700 ? 844 : 1000 });
    const response = await page.goto(`${base}${profile.path}`);
    assert.equal(response.status(), 200);
    await page.evaluate(() => document.fonts.ready);
    await page.locator('.portrait').evaluate(image => image.decode());
    assert.equal(await page.locator('h1').textContent(), `${profile.name}.`);
    assert.equal(await page.locator('a[href^="tel:"]').getAttribute('href'), `tel:${profile.phone}`);
    assert.equal(await page.locator('a[href^="mailto:"]').getAttribute('href'), `mailto:${profile.email}`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    assert.equal(overflow, false, `Horizontal overflow at ${width}px`);
    const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    report.accessibility.push({ width, violations: axe.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) })) });
    assert.equal(axe.violations.length, 0, `Accessibility violations at ${width}px: ${axe.violations.map(v => v.id)}`);
    await page.screenshot({ path: `${output}/${width}.png`, fullPage: true });
    report.viewports.push({ width, overflow });
  }
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Guardar contacto' }).click();
  const download = await downloadEvent;
  assert.equal(download.suggestedFilename(), 'armando-garcia-cuenca.vcf');
  await download.saveAs(`${output}/armando-garcia-cuenca.vcf`);
  const raw = await readFile(`${output}/armando-garcia-cuenca.vcf`, 'utf8');
  assert.equal(raw.replace(/\r\n/g, '').includes('\n'), false);
  assert.ok(raw.split('\r\n').every(line => Buffer.byteLength(line) <= 75));
  const unfolded = raw.replace(/\r\n /g, '');
  assert.ok(unfolded.includes('FN:Armando García Cuenca\r\n'));
  assert.ok(unfolded.includes(`ORG:${profile.organization}\r\n`));
  assert.ok(unfolded.includes(`TEL;TYPE=WORK,VOICE:${profile.phone}\r\n`));
  assert.ok(unfolded.includes(`EMAIL;TYPE=INTERNET,WORK:${profile.email}\r\n`));
  for (const [field, type, source] of [['PHOTO', 'JPEG', profile.contactPhoto], ['LOGO', 'PNG', profile.contactLogo]]) {
    const encoded = unfolded.match(new RegExp(`${field};ENCODING=b;TYPE=${type}:(.+)\\r\\n`))?.[1];
    assert.ok(encoded);
    const bytes = Buffer.from(encoded, 'base64');
    assert.deepEqual(bytes, await readFile(`public${source}`));
    const metadata = await sharp(bytes).metadata();
    report.vcard[field] = { format: metadata.format, width: metadata.width, height: metadata.height };
  }
  await page.getByRole('button', { name: 'Compartir tarjeta de contacto' }).click();
  await page.locator('.share-qr').waitFor({ state: 'visible' });
  assert.ok((await page.locator('.share-qr').getAttribute('src')).startsWith('data:image/png;base64,'));
  const dialogAxe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  assert.equal(dialogAxe.violations.length, 0);
  await page.getByRole('button', { name: 'Copiar enlace', exact: true }).click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), `${base}${profile.path}`);
  await page.screenshot({ path: `${output}/share.png`, fullPage: true });
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.share-dialog').isVisible(), false);
  assert.equal(await page.locator('[data-share]').evaluate(el => el === document.activeElement), true);
  report.share = { qr: true, clipboard: true, escapeAndFocusReturn: true };
  assert.deepEqual(errors, []);
  report.errors = errors;
  await writeFile(`${output}/qa.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}

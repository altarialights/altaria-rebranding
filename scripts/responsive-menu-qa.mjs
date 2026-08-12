import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.env.BASE_URL ?? 'http://127.0.0.1:4326/';
const out = process.env.OUT_DIR ?? 'review/responsive-menu/qa';
const viewports = [
  [360, 800],
  [390, 844],
  [430, 932],
  [768, 1024],
  [820, 1180],
  [834, 1194],
];

await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [];

for (const [width, height] of viewports) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  await page.goto(base, { waitUntil: 'networkidle' });

  const button = page.locator('[data-responsive-menu-button]');
  const menu = page.locator('[data-responsive-menu]');
  const initialY = await page.evaluate(() => scrollY);
  await page.screenshot({ path: `${out}/${width}x${height}-closed.png` });

  const closed = await page.evaluate(() => ({
    expanded: document.querySelector('[data-responsive-menu-button]')?.getAttribute('aria-expanded'),
    hidden: document.querySelector('[data-responsive-menu]')?.hasAttribute('hidden'),
    inert: document.querySelector('[data-responsive-menu]')?.hasAttribute('inert'),
    overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }));

  await button.click();
  await page.waitForTimeout(500);
  const open = await page.evaluate(() => {
    const targetSizes = Array.from(document.querySelectorAll('.rh-menu__link, .rh-menu__cta')).map((target) => {
      const rect = target.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    });
    const menuRect = document.querySelector('[data-responsive-menu]')?.getBoundingClientRect();
    return {
      expanded: document.querySelector('[data-responsive-menu-button]')?.getAttribute('aria-expanded'),
      hidden: document.querySelector('[data-responsive-menu]')?.hasAttribute('hidden'),
      inert: document.querySelector('[data-responsive-menu]')?.hasAttribute('inert'),
      shellOpen: document.querySelector('[data-responsive-header]')?.classList.contains('is-menu-open'),
      rootOpen: document.querySelector('[data-responsive-hero]')?.classList.contains('is-menu-open'),
      backgroundInert: Array.from(document.querySelectorAll('.rh-intro, .rh-services, .rh-principles')).every(
        (region) => region.hasAttribute('inert'),
      ),
      activeClass: document.activeElement?.className,
      scrollY,
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      targetSizes,
      menuRect: menuRect ? { left: menuRect.left, right: menuRect.right, bottom: menuRect.bottom } : null,
    };
  });
  await page.screenshot({ path: `${out}/${width}x${height}-open.png` });

  await page.keyboard.press('Escape');
  await page.waitForTimeout(420);
  const escaped = await page.evaluate(() => ({
    expanded: document.querySelector('[data-responsive-menu-button]')?.getAttribute('aria-expanded'),
    hidden: document.querySelector('[data-responsive-menu]')?.hasAttribute('hidden'),
    menuInert: document.querySelector('[data-responsive-menu]')?.hasAttribute('inert'),
    backgroundActive: Array.from(document.querySelectorAll('.rh-intro, .rh-services, .rh-principles')).every(
      (region) => !region.hasAttribute('inert'),
    ),
    focusRestored: document.activeElement?.hasAttribute('data-responsive-menu-button'),
    scrollY,
  }));

  await button.click();
  await page.locator('.rh-menu__link').first().click();
  await page.waitForTimeout(420);
  const linkCloses = (await button.getAttribute('aria-expanded')) === 'false' && (await menu.getAttribute('inert')) !== null;

  for (let cycle = 0; cycle < 20; cycle += 1) {
    await button.click();
    await button.click();
  }
  await page.waitForTimeout(420);
  const cycles = await page.evaluate(() => ({
    expanded: document.querySelector('[data-responsive-menu-button]')?.getAttribute('aria-expanded'),
    hidden: document.querySelector('[data-responsive-menu]')?.hasAttribute('hidden'),
    scrollY,
  }));

  const assertions = {
    closed: closed.expanded === 'false' && closed.hidden && closed.inert,
    opens:
      open.expanded === 'true' &&
      !open.hidden &&
      !open.inert &&
      open.shellOpen &&
      open.rootOpen &&
      open.backgroundInert &&
      open.activeClass === 'rh-header__menu-button',
    noScrollJump: open.scrollY === initialY && escaped.scrollY === initialY && cycles.scrollY === initialY,
    noOverflow: closed.overflowX <= 1 && open.overflowX <= 1,
    noClipping:
      open.menuRect && open.menuRect.left >= 0 && open.menuRect.right <= width && open.menuRect.bottom <= height,
    targets: open.targetSizes.every(({ width: targetWidth, height: targetHeight }) => targetWidth >= 44 && targetHeight >= 44),
    escape:
      escaped.expanded === 'false' &&
      escaped.hidden &&
      escaped.menuInert &&
      escaped.backgroundActive &&
      escaped.focusRestored,
    linkCloses,
    repeatedCycles: cycles.expanded === 'false' && cycles.hidden,
  };

  results.push({
    viewport: `${width}x${height}`,
    passed: pageErrors.length === 0 && Object.values(assertions).every(Boolean),
    pageErrors,
    assertions,
    closed,
    open,
    escaped,
    cycles,
  });
  await page.close();
}

const reduced = await browser.newPage({
  viewport: { width: 390, height: 844 },
  reducedMotion: 'reduce',
});
await reduced.goto(base, { waitUntil: 'networkidle' });
await reduced.locator('[data-responsive-menu-button]').click();
const reducedDurations = await reduced.evaluate(() => ({
  panel: getComputedStyle(document.querySelector('[data-responsive-menu]')).transitionDuration,
  item: getComputedStyle(document.querySelector('.rh-menu__link')).transitionDuration,
}));
results.push({
  test: 'reduced-motion',
  passed: reducedDurations.panel.split(',').every((value) => parseFloat(value) <= 0.001) &&
    reducedDurations.item.split(',').every((value) => parseFloat(value) <= 0.001),
  reducedDurations,
});
await reduced.close();

const rotate = await browser.newPage({ viewport: { width: 390, height: 844 } });
const rotateErrors = [];
rotate.on('pageerror', (error) => rotateErrors.push(String(error)));
await rotate.goto(base, { waitUntil: 'networkidle' });
await rotate.locator('[data-responsive-menu-button]').click();
await rotate.setViewportSize({ width: 844, height: 390 });
await rotate.waitForTimeout(450);
const rotated = await rotate.evaluate(() => ({
  expanded: document.querySelector('[data-responsive-menu-button]')?.getAttribute('aria-expanded'),
  hidden: document.querySelector('[data-responsive-menu]')?.hasAttribute('hidden'),
  overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
}));
await rotate.setViewportSize({ width: 390, height: 844 });
await rotate.waitForTimeout(450);
const restored = await rotate.evaluate(() => ({
  expanded: document.querySelector('[data-responsive-menu-button]')?.getAttribute('aria-expanded'),
  hidden: document.querySelector('[data-responsive-menu]')?.hasAttribute('hidden'),
  roots: document.querySelectorAll('[data-responsive-hero]').length,
}));
results.push({
  test: 'orientation-mobile-tablet-mobile',
  passed:
    rotateErrors.length === 0 &&
    rotated.expanded === 'false' &&
    rotated.hidden &&
    rotated.overflowX <= 1 &&
    restored.expanded === 'false' &&
    restored.hidden &&
    restored.roots === 1,
  pageErrors: rotateErrors,
  rotated,
  restored,
});
await rotate.close();

const desktop = await browser.newPage({ viewport: { width: 1020, height: 768 } });
await desktop.goto(`${base}?perf=lite`, { waitUntil: 'networkidle' });
const desktopState = await desktop.evaluate(() => ({
  experience: document.documentElement.dataset.heroExperience,
  responsiveRoot: document.querySelectorAll('[data-responsive-hero]').length,
  desktopHeader: document.querySelectorAll('[data-header-capsule]').length,
}));
results.push({
  test: 'desktop-regression-boundary',
  passed: desktopState.experience === 'desktop' && desktopState.responsiveRoot === 0 && desktopState.desktopHeader === 1,
  desktopState,
});
await desktop.close();

await browser.close();
const passed = results.filter((result) => result.passed).length;
const summary = { passed, total: results.length, failed: results.length - passed, results };
await writeFile(`${out}/summary.json`, JSON.stringify(summary, null, 2));
console.log(`${passed}/${results.length} responsive menu checks passed`);
for (const result of results.filter((entry) => !entry.passed)) console.log(JSON.stringify(result, null, 2));
if (passed !== results.length) process.exitCode = 1;

import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.env.BASE_URL ?? 'http://127.0.0.1:4326/';
const out = process.env.OUT_DIR ?? 'review/responsive-hero/qa';

const viewports = [
  [320, 568], [320, 700], [360, 800], [375, 812], [390, 844], [412, 915], [430, 932],
  [740, 430], [768, 1024], [810, 1080], [820, 1180], [834, 1112], [900, 1200], [1019, 768],
];

await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [];

async function inspect(width, height) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-responsive-hero][data-initialised="true"]');
  const snapshot = await page.evaluate(() => {
    const root = document.querySelector('[data-responsive-hero]');
    const cards = Array.from(document.querySelectorAll('[data-carousel-slide]'));
    const visibleCards = cards.filter((card) => {
      const rect = card.getBoundingClientRect();
      return rect.right > 0 && rect.left < innerWidth && rect.bottom > 0 && rect.top < innerHeight;
    });
    const controls = Array.from(root?.querySelectorAll('button, a') ?? []);
    const tooSmall = controls
      .filter((control) => {
        const style = getComputedStyle(control);
        const rect = control.getBoundingClientRect();
        const inactiveContainer = control.closest('[hidden], [inert]');
        return !inactiveContainer && control.offsetParent !== null && style.display !== 'none' && style.visibility !== 'hidden' && (rect.width < 43.5 || rect.height < 43.5);
      })
      .map((control) => `${control.tagName.toLowerCase()}.${control.className}`);
    return {
      experience: document.documentElement.dataset.heroExperience,
      responsiveRoots: document.querySelectorAll('[data-responsive-hero]').length,
      desktopRoots: document.querySelectorAll('[data-hero]').length,
      cards: cards.length,
      visibleCards: visibleCards.length,
      current: document.querySelector('[data-carousel-dot][aria-current="true"]')?.getAttribute('data-carousel-dot'),
      title: root?.querySelector('h1')?.textContent?.replace(/\s+/g, ' ').trim(),
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      tooSmall,
      menuDisplay: getComputedStyle(document.querySelector('[data-responsive-menu-button]')).display,
      tabletNavDisplay: getComputedStyle(document.querySelector('.rh-header__desktop-nav')).display,
      reelSeparated: (() => {
        const image = document.querySelector('[data-service-id="contenido"] .rh-service__visual img')?.getBoundingClientRect();
        const copy = document.querySelector('[data-service-id="contenido"] .rh-service__copy')?.getBoundingClientRect();
        return image && copy ? image.bottom <= copy.top + 1 : false;
      })(),
    };
  });

  const mobile = width < 768;
  const assertions = {
    responsiveOnly: snapshot.experience === 'responsive' && snapshot.responsiveRoots === 1 && snapshot.desktopRoots === 0,
    noOverflow: snapshot.overflowX <= 1,
    fiveCards: snapshot.cards === 5,
    completeCopy: snapshot.title?.replace(/\s+/g, '') === 'Tunegociono esunomás.Suimagentampocodeberíaserlo.'.replace(/\s+/g, ''),
    controls: mobile ? snapshot.tooSmall.length === 0 : true,
    reelSeparated: !mobile || snapshot.reelSeparated,
    mode:
      snapshot.menuDisplay !== 'none' &&
      snapshot.tabletNavDisplay === 'none' &&
      (!mobile || snapshot.current === '1'),
  };

  await page.locator('[data-responsive-menu-button]').click();
  assertions.menuOpens = await page.locator('[data-responsive-menu-button]').getAttribute('aria-expanded') === 'true';
  await page.keyboard.press('Escape');
  assertions.menuEscapes =
    (await page.locator('[data-responsive-menu-button]').getAttribute('aria-expanded')) === 'false' &&
    (await page.evaluate(() => document.activeElement?.hasAttribute('data-responsive-menu-button'))) === true;

  if (mobile) {
    await page.locator('[data-carousel-next]').click();
    await page.waitForTimeout(350);
    assertions.nextWorks =
      (await page.locator('[data-carousel-dot][aria-current="true"]').getAttribute('data-carousel-dot')) === '2';
    await page.locator('[data-carousel-shortcut="4"]').click();
    await page.waitForTimeout(350);
    assertions.shortcutWorks =
      (await page.locator('[data-carousel-dot][aria-current="true"]').getAttribute('data-carousel-dot')) === '4';
    await page.locator('[data-carousel-track]').focus();
    await page.keyboard.press('Home');
    await page.waitForTimeout(500);
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(650);
    assertions.keyboardWorks =
      (await page.locator('[data-carousel-dot][aria-current="true"]').getAttribute('data-carousel-dot')) === '1';

    const track = page.locator('[data-carousel-track]');
    await track.scrollIntoViewIfNeeded();
    await page.waitForTimeout(120);
    const trackBox = await track.boundingBox();
    if (trackBox) {
      await page.mouse.move(trackBox.x + trackBox.width * 0.72, trackBox.y + trackBox.height * 0.42);
      await page.mouse.down();
      await page.mouse.move(trackBox.x + trackBox.width * 0.25, trackBox.y + trackBox.height * 0.42, { steps: 10 });
      await page.mouse.up();
      await page.waitForTimeout(650);
      assertions.dragWorks =
        (await page.locator('[data-carousel-dot][aria-current="true"]').getAttribute('data-carousel-dot')) === '2';
    } else {
      assertions.dragWorks = false;
    }
  }

  const passed = pageErrors.length === 0 && Object.values(assertions).every(Boolean);
  results.push({ width, height, passed, pageErrors, snapshot, assertions });
  await page.screenshot({ path: `${out}/${width}x${height}.png`, fullPage: false });
  await page.close();
}

for (const viewport of viewports) await inspect(...viewport);

// Desktop boundary: the responsive subtree and assets must disappear at 1020px.
const boundary = await browser.newPage({ viewport: { width: 1020, height: 768 }, deviceScaleFactor: 1 });
const desktopRequests = [];
boundary.on('request', (request) => desktopRequests.push(request.url()));
await boundary.goto(`${base}?perf=lite`, { waitUntil: 'domcontentloaded' });
await boundary.waitForSelector('[data-performance-hero]');
const boundarySnapshot = await boundary.evaluate(() => ({
  experience: document.documentElement.dataset.heroExperience,
  responsiveRoots: document.querySelectorAll('[data-responsive-hero]').length,
  performanceRoots: document.querySelectorAll('[data-performance-hero]').length,
}));
results.push({
  width: 1020,
  height: 768,
  passed:
    boundarySnapshot.experience === 'desktop' &&
    boundarySnapshot.responsiveRoots === 0 &&
    boundarySnapshot.performanceRoots === 1 &&
    !desktopRequests.some((url) => url.includes('/media/hero-responsive/')),
  snapshot: boundarySnapshot,
  responsiveAssetRequests: desktopRequests.filter((url) => url.includes('/media/hero-responsive/')),
});
await boundary.close();

// Responsive network isolation: no desktop runtime or media is requested.
const networkPage = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
const responsiveRequests = [];
networkPage.on('request', (request) => responsiveRequests.push(request.url()));
await networkPage.goto(base, { waitUntil: 'domcontentloaded' });
await networkPage.waitForSelector('[data-responsive-hero][data-initialised="true"]');
const forbidden = responsiveRequests.filter((url) =>
  /hero-full|hero-balanced|hero-lite|hero-tier-bootstrap|performance-hero-timeline|reel-poster\.jpg|reel-mobile\.mp4/.test(url),
);
results.push({
  test: 'responsive-network-isolation',
  passed: forbidden.length === 0 && responsiveRequests.some((url) => url.includes('/media/hero-responsive/optimized/')),
  forbidden,
  responsiveAssets: responsiveRequests.filter((url) => url.includes('/media/hero-responsive/optimized/')),
});
await networkPage.close();

// Repeated tablet/mobile resizing must not duplicate the tree or listeners.
const resizePage = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
const resizeErrors = [];
resizePage.on('pageerror', (error) => resizeErrors.push(String(error)));
await resizePage.goto(base, { waitUntil: 'domcontentloaded' });
await resizePage.waitForSelector('[data-responsive-hero][data-initialised="true"]');
for (const viewport of [[820, 1180], [390, 844], [768, 1024], [320, 700]]) {
  await resizePage.setViewportSize({ width: viewport[0], height: viewport[1] });
  await resizePage.waitForTimeout(120);
}
const resizeSnapshot = await resizePage.evaluate(() => ({
  rootCount: document.querySelectorAll('[data-responsive-hero]').length,
  cardCount: document.querySelectorAll('[data-carousel-slide]').length,
  initialised: document.querySelector('[data-responsive-hero]')?.getAttribute('data-initialised'),
  overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
}));
results.push({
  test: 'responsive-resize-cycle',
  passed:
    resizeErrors.length === 0 &&
    resizeSnapshot.rootCount === 1 &&
    resizeSnapshot.cardCount === 5 &&
    resizeSnapshot.initialised === 'true' &&
    resizeSnapshot.overflowX <= 1,
  pageErrors: resizeErrors,
  snapshot: resizeSnapshot,
});
await resizePage.close();

// Crossing the architectural boundary performs a controlled reload because
// the existing Full desktop runtime cannot be safely unmounted.
const crossingPage = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
const crossingErrors = [];
crossingPage.on('pageerror', (error) => crossingErrors.push(String(error)));
await crossingPage.goto(`${base}?perf=lite`, { waitUntil: 'domcontentloaded' });
await crossingPage.waitForSelector('[data-responsive-hero][data-initialised="true"]');
const modes = [];
for (const viewport of [[1020, 768], [390, 844], [1020, 768], [430, 932]]) {
  await crossingPage.setViewportSize({ width: viewport[0], height: viewport[1] });
  await crossingPage.waitForFunction(
    (responsive) => document.documentElement.dataset.heroExperience === (responsive ? 'responsive' : 'desktop'),
    viewport[0] < 1020,
  );
  await crossingPage.waitForLoadState('domcontentloaded');
  modes.push(await crossingPage.evaluate(() => document.documentElement.dataset.heroExperience));
}
results.push({
  test: 'responsive-desktop-boundary-cycle',
  passed:
    crossingErrors.length === 0 &&
    modes.join(',') === 'desktop,responsive,desktop,responsive' &&
    (await crossingPage.locator('[data-responsive-hero]').count()) === 1 &&
    (await crossingPage.locator('[data-performance-hero], [data-hero]').count()) === 0,
  pageErrors: crossingErrors,
  modes,
});
await crossingPage.close();

// Reduced motion keeps every control and all content available without
// entrance animations or smooth carousel movement.
const reducedPage = await browser.newPage({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
  reducedMotion: 'reduce',
});
const reducedErrors = [];
reducedPage.on('pageerror', (error) => reducedErrors.push(String(error)));
await reducedPage.goto(base, { waitUntil: 'domcontentloaded' });
await reducedPage.waitForSelector('[data-responsive-hero][data-initialised="true"]');
const reducedSnapshot = await reducedPage.evaluate(() => ({
  animation: getComputedStyle(document.querySelector('.rh-intro__title')).animationName,
  scrollBehavior: getComputedStyle(document.querySelector('[data-carousel-track]')).scrollBehavior,
  visibleTitle: getComputedStyle(document.querySelector('.rh-intro__title')).opacity,
  current: document.querySelector('[data-carousel-dot][aria-current="true"]')?.getAttribute('data-carousel-dot'),
}));
results.push({
  test: 'responsive-reduced-motion',
  passed:
    reducedErrors.length === 0 &&
    reducedSnapshot.animation === 'none' &&
    reducedSnapshot.scrollBehavior === 'auto' &&
    reducedSnapshot.visibleTitle === '1' &&
    reducedSnapshot.current === '1',
  pageErrors: reducedErrors,
  snapshot: reducedSnapshot,
});
await reducedPage.close();

await browser.close();
const passed = results.filter((result) => result.passed).length;
const summary = { passed, total: results.length, failed: results.length - passed, results };
await writeFile(`${out}/summary.json`, JSON.stringify(summary, null, 2));
console.log(`${passed}/${results.length} responsive checks passed`);
for (const result of results.filter((entry) => !entry.passed)) console.log(JSON.stringify(result, null, 2));
if (passed !== results.length) process.exitCode = 1;

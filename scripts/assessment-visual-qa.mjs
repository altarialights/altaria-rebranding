import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const baseUrl = process.env.ASSESSMENT_QA_URL ?? 'http://127.0.0.1:4321';
await mkdir('review', { recursive: true });
const browser = await chromium.launch({ headless: true });

const assertNoHorizontalOverflow = async (page, label) => {
  const sizes = await page.evaluate(() => ({ viewport: window.innerWidth, document: document.documentElement.scrollWidth }));
  if (sizes.document > sizes.viewport + 1) throw new Error(`${label}: horizontal overflow ${sizes.document}px > ${sizes.viewport}px`);
};

try {
  const desktop = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  await desktop.goto(`${baseUrl}/medir-nivel-digital`, { waitUntil: 'networkidle' });
  await assertNoHorizontalOverflow(desktop, 'landing desktop');
  await desktop.screenshot({ path: 'review/assessment-landing-desktop.png', fullPage: true });

  await desktop.locator('[data-start-assessment]').click();
  await desktop.evaluate(() => {
    const key = 'altaria_digital_assessment_draft_v1';
    const raw = localStorage.getItem(key);
    if (!raw) return;
    const draft = JSON.parse(raw);
    draft.startedAt = Date.now() - 60_000;
    localStorage.setItem(key, JSON.stringify(draft));
  });
  await desktop.reload({ waitUntil: 'networkidle' });
  await desktop.locator('[data-start-assessment]').click();

  const sectionValues = ['3', '2', '4', '2', '3'];
  for (let sectionIndex = 0; sectionIndex < sectionValues.length; sectionIndex += 1) {
    const section = desktop.locator(`[data-section="${sectionIndex}"]`);
    for (const input of await section.locator(`input[value="${sectionValues[sectionIndex]}"]`).all()) await input.check();
    await section.locator('[data-section-next]').click();
  }

  await desktop.locator('[data-state-panel="preview"]:not([hidden])').waitFor();
  await assertNoHorizontalOverflow(desktop, 'preview desktop');
  await desktop.screenshot({ path: 'review/assessment-preview-desktop.png', fullPage: true });
  await desktop.locator('[data-open-gate]').click();
  await desktop.locator('input[name="fullName"]').fill('Prueba Visual');
  await desktop.locator('input[name="email"]').fill('qa@empresa.example');
  await desktop.locator('input[name="jobTitle"]').fill('Dirección');
  await desktop.locator('input[name="companyName"]').fill('Empresa de prueba');
  await desktop.locator('input[name="companyUrl"]').fill('https://empresa.example');
  await desktop.locator('select[name="companySize"]').selectOption('11-50');
  await desktop.locator('input[name="privacyConsent"]').check();
  await desktop.locator('[data-lead-form]').evaluate((form) => form.requestSubmit());
  await desktop.waitForURL(/\/medir-nivel-digital\/resultado\//u, { timeout: 15_000 });
  const resultUrl = desktop.url();
  await desktop.waitForLoadState('networkidle');
  const robots = await desktop.locator('meta[name="robots"]').getAttribute('content');
  if (robots !== 'noindex, nofollow') throw new Error(`Unexpected result robots meta: ${robots}`);
  await assertNoHorizontalOverflow(desktop, 'result desktop');
  await desktop.screenshot({ path: 'review/assessment-result-desktop.png', fullPage: true });

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  await mobile.goto(`${baseUrl}/medir-nivel-digital`, { waitUntil: 'networkidle' });
  await assertNoHorizontalOverflow(mobile, 'landing mobile');
  await mobile.screenshot({ path: 'review/assessment-landing-mobile.png', fullPage: true });
  await mobile.goto(resultUrl, { waitUntil: 'networkidle' });
  await assertNoHorizontalOverflow(mobile, 'result mobile');
  await mobile.screenshot({ path: 'review/assessment-result-mobile.png', fullPage: true });

  console.log(JSON.stringify({ ok: true, resultUrl, robots, viewports: ['1440x1000', '390x844'] }, null, 2));
} finally {
  await browser.close();
}

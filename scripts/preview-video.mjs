/**
 * Scroll-behaviour videos — Altaria Lights hero v7.
 *
 * Renders the six clips the review asks for:
 *
 *   hero-scroll-slow.mp4     one long, patient pass
 *   hero-scroll-normal.mp4   a reading pace
 *   hero-scroll-fast.mp4     a flick — the case that used to break
 *   hero-1020x640.mp4        smallest supported desktop
 *   hero-1366x768.mp4        the most common laptop screen
 *   hero-1920x1080.mp4       reference
 *
 * Frames are DRIVEN, not recorded. Each frame sets the scroll to an exact
 * position and screenshots it, then ffmpeg muxes the sequence. That makes
 * the clips reproducible and lets "slow" and "fast" mean an exact number
 * of pixels per frame rather than however hard someone spun a wheel.
 *
 * The page is loaded WITHOUT ?scrub=0 and WITHOUT ?still=1 — these clips
 * exist to show the real thing, trail and float included. The reel's
 * currentTime is stepped 1/FPS per frame so it plays at true speed
 * instead of at screenshot speed.
 *
 * Usage:  npm run build && npm run preview   (one terminal)
 *         node scripts/preview-video.mjs     (another)
 *         node scripts/preview-video.mjs slow normal   (a subset)
 */
import { chromium } from 'playwright';
import { mkdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const BASE = process.env.BASE_URL ?? 'http://localhost:4321';
const OUT = 'review';
const FPS = 30;

/** Window of the hero worth filming: phone entry through laptop settled. */
const FROM = 0.2;
const TO = 0.78;

/**
 * `travel` frames spend that many frames crossing FROM → TO. Fewer frames
 * over the same distance = a faster scroll, which is exactly the variable
 * under test.
 */
const CLIPS = {
  slow: { w: 1920, h: 1080, hold: 24, travel: 620, name: 'hero-scroll-slow' },
  normal: { w: 1920, h: 1080, hold: 24, travel: 330, name: 'hero-scroll-normal' },
  fast: { w: 1920, h: 1080, hold: 30, travel: 120, name: 'hero-scroll-fast' },
  '1020': { w: 1020, h: 640, hold: 24, travel: 330, name: 'hero-1020x640' },
  '1366': { w: 1366, h: 768, hold: 24, travel: 330, name: 'hero-1366x768' },
  '1920': { w: 1920, h: 1080, hold: 24, travel: 330, name: 'hero-1920x1080' },
};

const wanted = process.argv.slice(2);
const jobs = Object.entries(CLIPS).filter(([k]) => wanted.length === 0 || wanted.includes(k));

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROME || undefined,
  args: ['--force-color-profile=srgb', '--hide-scrollbars'],
});

for (const [key, clip] of jobs) {
  const frames = path.join(OUT, `.frames-${key}`);
  const file = path.join(OUT, `${clip.name}.mp4`);
  rmSync(frames, { recursive: true, force: true });
  mkdirSync(frames, { recursive: true });

  const ctx = await browser.newContext({
    viewport: { width: clip.w, height: clip.h },
    deviceScaleFactor: 1,
  });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2600); // opening sequence + reel buffering

  const travelPx = await page.evaluate(() => {
    const hero = document.querySelector('[data-hero]');
    return hero.getBoundingClientRect().height - window.innerHeight;
  });

  const total = clip.hold * 2 + clip.travel;
  const perFrame = ((TO - FROM) * travelPx) / clip.travel;
  console.log(
    `${clip.name} · ${clip.w}×${clip.h} · ${total} frames @ ${FPS} fps ` +
      `(${(total / FPS).toFixed(1)} s) · ${Math.round(perFrame)} px/frame`
  );

  for (let i = 0; i < total; i++) {
    const t =
      i < clip.hold
        ? 0
        : i < clip.hold + clip.travel
          ? (i - clip.hold) / (clip.travel - 1)
          : 1;
    const frac = FROM + (TO - FROM) * t;

    await page.evaluate(
      ({ y, time }) => {
        window.scrollTo(0, y);
        for (const v of document.querySelectorAll('video')) {
          v.pause();
          if (v.duration) v.currentTime = time % v.duration;
        }
      },
      { y: travelPx * frac, time: i / FPS }
    );

    // One rAF for the scroll to render, plus a beat for the seek to land.
    await page.waitForTimeout(30);
    await page.screenshot({ path: path.join(frames, `f${String(i).padStart(4, '0')}.png`) });
    if (i % 90 === 0) console.log(`  ${i}/${total} · progreso ${frac.toFixed(3)}`);
  }

  await ctx.close();

  const ff = spawnSync(
    process.env.FFMPEG || 'ffmpeg',
    [
      '-y',
      '-loglevel', 'error',
      '-framerate', String(FPS),
      '-i', path.join(frames, 'f%04d.png'),
      '-c:v', 'libx264',
      '-preset', 'slow',
      '-crf', '20',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      '-an',
      file,
    ],
    { stdio: 'inherit' }
  );

  if (ff.status !== 0) {
    console.error(
      `\nffmpeg falló (código ${ff.status}). Los PNG siguen en ${frames}; ` +
        'con ffmpeg instalado, el comando de arriba los monta sin volver a capturar.'
    );
    process.exit(1);
  }

  rmSync(frames, { recursive: true, force: true });
  console.log(`  → ${file}`);
}

await browser.close();
console.log('done');

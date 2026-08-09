/**
 * Face-stability diagnostic — Altaria Lights hero devices.
 *
 * Two independent probes, because each failure mode is invisible to the
 * other:
 *
 *   A. GEOMETRY  — sweeps the scroll in small steps and asks
 *      document.elementFromPoint() which face is on top at a grid of
 *      points across each device. Catches missing faces, faces that lose
 *      a coplanar fight, and holes in the silhouette. Hit testing reads
 *      the paint tree, so it sees geometry, never compositing.
 *
 *   B. STABILITY — parks the scroll and screenshots the SAME clip
 *      repeatedly over ~1.4 s. With ?still=1 the float and the cursor
 *      parallax are frozen, so a stable renderer MUST produce byte
 *      identical PNGs. Any difference is the compositor changing its
 *      mind about a layer that nothing asked to change — that is the
 *      flicker, and a geometry probe can never see it.
 *
 * Usage:  npm run build && npm run preview   (one terminal)
 *         node scripts/diagnose-faces.mjs    (another)
 */
import { chromium, firefox, webkit } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const BASE = process.env.BASE_URL ?? 'http://localhost:4321';
const OUT = 'review/diagnose';
/* BROWSER=chromium|firefox|webkit. WebKit is the one that matters most
   here: Safari has historically been the strictest about preserve-3d and
   the loosest about coplanar sorting, so a fix that only holds in Blink
   is not a fix. */
const ENGINE = process.env.BROWSER ?? 'chromium';
const VIEW = { width: Number(process.env.VW ?? 1920), height: Number(process.env.VH ?? 1080) };
mkdirSync(OUT, { recursive: true });

const lines = [];
const log = (s) => {
  console.log(s);
  lines.push(s);
};

const ENGINES = { chromium, firefox, webkit };
const browser = await ENGINES[ENGINE].launch(
  ENGINE === 'chromium'
    ? {
        executablePath: process.env.PW_CHROME || undefined,
        args: ['--force-color-profile=srgb', '--hide-scrollbars'],
      }
    : {}
);
const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 1 });
const page = await ctx.newPage();

async function load(query) {
  await page.goto(`${BASE}/${query}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2400);
  return page.evaluate(() => {
    const hero = document.querySelector('[data-hero]');
    return hero.getBoundingClientRect().height - window.innerHeight;
  });
}

const seek = async (travel, frac, settle = 90) => {
  await page.evaluate((y) => window.scrollTo(0, y), travel * frac);
  await page.waitForTimeout(settle);
};

/* ------------------------------------------------------------------ *
 * A · geometry sweep
 * ------------------------------------------------------------------ */
async function geometrySweep(travel, label, from, to, step, prefix) {
  log(`\n--- A · geometría · ${label} (${from} → ${to}) ---`);

  /* Hit testing is useless here (full-bleed overlays sit above the stage)
     and getBoxQuads is not implemented in this Chromium. So compose the
     transform chain by hand with DOMMatrix, from the perspective root
     down to each face, and read the two numbers that actually decide what
     the renderer does:
        · normal.z  → which side of the face we are on, i.e. exactly what
                      backface-visibility tests
        · centre.z  → depth, and therefore paint order
     Two faces with the same normal AND the same centre z are coplanar and
     will z-fight. This is the ground truth, not an approximation of it. */
  const census = new Map();
  const coplanar = new Map();

  for (let p = from; p <= to + 1e-9; p += step) {
    await seek(travel, p, 24);
    const faces = await page.evaluate((pre) => {
      const out = {};
      for (const el of document.querySelectorAll(`[class*="${pre}__"]`)) {
        const cls = typeof el.className === 'string' ? el.className : '';
        const m = cls.match(new RegExp(`${pre}__[a-z-]+`));
        if (!m) continue;

        // Accumulate parent-first up to the element that owns perspective.
        const chain = [];
        for (let n = el; n && n !== document.body; n = n.parentElement) {
          chain.unshift(n);
          if (getComputedStyle(n).perspective !== 'none') break;
        }
        let M = new DOMMatrix();
        for (const n of chain) {
          const t = getComputedStyle(n).transform;
          if (t && t !== 'none') M = M.multiply(new DOMMatrix(t));
        }

        const n0 = M.transformPoint({ x: 0, y: 0, z: 0, w: 1 });
        const n1 = M.transformPoint({ x: 0, y: 0, z: 1, w: 1 });
        const r = el.getBoundingClientRect();

        const cs = getComputedStyle(el);
        /* Three conditions have to hold before two surfaces can actually
           z-fight, and checking only the first over-reports badly:
             1. same plane (normal + depth)
             2. both PAINTED — a structural wrapper with no background
                cannot fight anything
             3. both direct participants of the SAME preserve-3d context.
                A parent with transform-style: flat paints its children in
                document order, in 2D. That is precisely the fix applied to
                .laptop__deck and .phone__front, so a probe that ignores it
                would keep reporting the bug after it was gone.
           Screen overlap is checked outside, from the projected boxes. */
        const painted =
          cs.backgroundImage !== 'none' ||
          (cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent');
        const parent = el.parentElement;
        const in3d = parent ? getComputedStyle(parent).transformStyle === 'preserve-3d' : false;

        out[m[0]] = {
          nz: +(n1.z - n0.z).toFixed(4),
          z: +n0.z.toFixed(2),
          w: Math.round(r.width),
          h: Math.round(r.height),
          bf: cs.backfaceVisibility,
          painted,
          in3d,
          ctx: in3d ? (parent.className || 'root').toString().split(' ')[0] : '',
          box: [r.left, r.top, r.right, r.bottom],
        };
      }
      return out;
    }, prefix);

    for (const [name, f] of Object.entries(faces)) {
      if (!census.has(name)) census.set(name, []);
      // A face is DARK when it is turned away and hidden by backface.
      const hidden = f.bf === 'hidden' && f.nz < 0;
      census.get(name).push({ p: +p.toFixed(3), nz: f.nz, z: f.z, hidden, w: f.w, h: f.h });
    }

    const names = Object.keys(faces);
    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        const A = faces[names[i]];
        const B = faces[names[j]];
        if (!A.painted || !B.painted) continue;
        if (!A.in3d || !B.in3d || A.ctx !== B.ctx) continue;
        if (Math.abs(A.nz - B.nz) > 0.002 || Math.abs(A.z - B.z) > 0.6) continue;
        // Coplanar is only a fight where the two actually overlap on screen.
        const ox = Math.min(A.box[2], B.box[2]) - Math.max(A.box[0], B.box[0]);
        const oy = Math.min(A.box[3], B.box[3]) - Math.max(A.box[1], B.box[1]);
        if (ox > 2 && oy > 2) {
          const k = `${names[i]} ≡ ${names[j]}`;
          coplanar.set(k, (coplanar.get(k) ?? 0) + 1);
        }
      }
    }
  }

  const total = Math.round((to - from) / step) + 1;
  for (const [face, hits] of [...census.entries()].sort()) {
    const shown = hits.filter((h) => !h.hidden && h.w > 1 && h.h > 1);
    if (shown.length === 0) {
      log(`  ${face.padEnd(22)} NUNCA visible en este tramo  ⚠`);
      continue;
    }
    let runs = 1;
    for (let i = 1; i < shown.length; i++) if (shown[i].p - shown[i - 1].p > step * 1.6) runs++;
    const flips = hits.filter((h, i) => i > 0 && h.hidden !== hits[i - 1].hidden).length;
    const flag =
      (runs > 1 ? `  ⚠ ${runs} tramos` : '') + (flips > 1 ? `  ⚠ ${flips} conmutaciones backface` : '');
    log(
      `  ${face.padEnd(22)} visible ${shown.length}/${total} pasos ` +
        `(${shown[0].p.toFixed(3)}→${shown[shown.length - 1].p.toFixed(3)})${flag}`
    );
  }

  if (coplanar.size) {
    log('  Caras COPLANARES (misma normal y misma z → z-fighting):');
    for (const [k, n] of [...coplanar.entries()].sort((a, b) => b[1] - a[1])) {
      log(`    ⚠ ${k}  en ${n}/${total} pasos`);
    }
  } else {
    log('  Sin caras coplanares.');
  }
}

/* ------------------------------------------------------------------ *
 * B · render stability at a parked scroll position
 * ------------------------------------------------------------------ */
async function stability(travel, label, frac, sel) {
  const box = await (async () => {
    await seek(travel, frac, 500);
    return page.evaluate((s) => {
      const el = document.querySelector(s);
      const b = el.getBoundingClientRect();
      // Clamp to the viewport on BOTH edges. Since v9 the devices leave to
      // the right instead of parking in a corner, so a probe aimed at one
      // of them late in the timeline gets a box that starts past 1920 —
      // and Playwright throws "clipped area is outside the image" rather
      // than returning an empty shot.
      const x = Math.max(0, Math.floor(b.left) - 12);
      const y = Math.max(0, Math.floor(b.top) - 12);
      return {
        x,
        y,
        width: Math.max(0, Math.min(innerWidth - x, Math.ceil(b.width) + 24)),
        height: Math.max(0, Math.min(innerHeight - y, Math.ceil(b.height) + 24)),
      };
    }, sel);
  })();

  if (box.width < 8 || box.height < 8) {
    log(`  ${label.padEnd(26)} (fuera de pantalla)`);
    return 0;
  }

  /* Re-arrive so the capture window starts just after a scroll event, then
     wait 150 ms. That wait is a compromise, and the number matters:
       · long enough that ScrollTrigger has applied the new progress and
         the engine has finished its first rasterisation pass — without
         it Firefox and WebKit report churn that is the probe's fault,
         not the page's;
       · short enough that the window still straddles 260 ms, which is
         where the v5 will-change timer fired. Capture 1 lands inside that
         window and capture 2 outside it, so the original fault would
         still be caught. */
  await seek(travel, frac - 0.004, 60);
  await seek(travel, frac, Number(process.env.STABLE_SETTLE ?? 150));

  const hashes = [];
  for (let i = 0; i < 12; i++) {
    const buf = await page.screenshot({ clip: box });
    hashes.push(createHash('sha1').update(buf).digest('hex').slice(0, 10));
    await page.waitForTimeout(130);
  }

  const distinct = [...new Set(hashes)];
  const flag = distinct.length > 1 ? `  ⚠ ${distinct.length} renders distintos` : '  estable';
  log(`  ${label.padEnd(26)} ${hashes.map((h) => h.slice(0, 4)).join(' ')}${flag}`);
  return distinct.length;
}

/* ------------------------------------------------------------------ */
const travel = await load('?scrub=0&still=1');
log(
  `${ENGINE} · hero travel ${Math.round(travel)} px · ` +
    `viewport ${VIEW.width}×${VIEW.height} · ?scrub=0&still=1`
);

await geometrySweep(travel, 'móvil, giro de entrada', 0.13, 0.24, 0.003, 'phone');
await geometrySweep(travel, 'portátil, apertura', 0.29, 0.48, 0.004, 'laptop');
await geometrySweep(travel, 'monitor, entrada', 0.49, 0.63, 0.004, 'monitor');
await geometrySweep(travel, 'tablet, giro de entrada', 0.65, 0.77, 0.003, 'tablet');

log('\n--- B · estabilidad de render con el scroll parado ---');
log('   (10 capturas del mismo recorte, 140 ms aparte, sin float ni cursor)');
let unstable = 0;
for (const [label, frac, sel] of [
  ['móvil · trasera', 0.163, '[data-obj="phone"]'],
  ['móvil · perfil', 0.175, '[data-obj="phone"]'],
  ['móvil · frontal', 0.24, '[data-obj="phone"]'],
  ['portátil · cerrado', 0.31, '[data-obj="laptop"]'],
  ['portátil · abriendo', 0.39, '[data-obj="laptop"]'],
  ['portátil · abierto', 0.45, '[data-obj="laptop"]'],
  ['monitor · protagonista', 0.6, '[data-obj="monitor"]'],
  ['tablet · trasera', 0.665, '[data-obj="tablet"]'],
  ['tablet · protagonista', 0.75, '[data-obj="tablet"]'],
  // v8 parked the four devices in a corner and checked the stack here.
  // They leave the stage now, so the thing worth watching at 0.9 is the
  // closing ring.
  ['cierre · anillo de cards', 0.9, '[data-obj="flow"]'],
]) {
  if ((await stability(travel, label, frac, sel)) > 1) unstable++;
}

log(`\nRESUMEN: ${unstable} de 10 posiciones renderizan de forma inestable con el scroll parado.`);

writeFileSync(`${OUT}/informe-${ENGINE}-${VIEW.width}x${VIEW.height}.txt`, lines.join('\n'), 'utf8');
await browser.close();

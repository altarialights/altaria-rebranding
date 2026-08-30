import sharp from 'sharp';
import { readFile, writeFile } from 'node:fs/promises';

const brandIcon = 'public/brand/optimized/altaria-v2-fondo-azul-512.webp';
const brandLogo = 'public/brand/optimized/altaria-v2-logo-header-768.webp';
const servicesHero = 'public/media/servicios/optimized/hero-1200.webp';
const outputDirectory = 'public/brand/optimized';

const background = Buffer.from(`
  <svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#63b4e2"/>
        <stop offset="0.58" stop-color="#a8d9f3"/>
        <stop offset="1" stop-color="#eff9ff"/>
      </linearGradient>
      <radialGradient id="sun" cx="0.82" cy="0.14" r="0.18">
        <stop offset="0" stop-color="#fff9df" stop-opacity="0.96"/>
        <stop offset="0.24" stop-color="#fff9df" stop-opacity="0.34"/>
        <stop offset="1" stop-color="#fff9df" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="1200" height="630" fill="url(#sky)"/>
    <rect width="1200" height="630" fill="url(#sun)"/>
    <ellipse cx="220" cy="620" rx="420" ry="92" fill="#ffffff" fill-opacity="0.8"/>
    <ellipse cx="820" cy="638" rx="560" ry="112" fill="#ffffff" fill-opacity="0.88"/>
  </svg>
`);

const logo = await sharp(brandLogo).resize({ width: 520, withoutEnlargement: true }).webp().toBuffer();
const hero = await sharp(servicesHero).resize({ width: 650, withoutEnlargement: true }).webp().toBuffer();

await sharp(background)
  .composite([
    { input: logo, left: 72, top: 98 },
    { input: hero, left: 520, top: 72 },
  ])
  .jpeg({ quality: 86, mozjpeg: true })
  .toFile(`${outputDirectory}/altaria-og-1200x630.jpg`);

await Promise.all([
  sharp(brandIcon).resize(180, 180).png({ compressionLevel: 9 }).toFile(`${outputDirectory}/altaria-v2-apple-touch-icon-180.png`),
  sharp(brandIcon).resize(192, 192).png({ compressionLevel: 9 }).toFile(`${outputDirectory}/altaria-v2-icon-192.png`),
  sharp(brandIcon).resize(512, 512).png({ compressionLevel: 9 }).toFile(`${outputDirectory}/altaria-v2-icon-512.png`),
]);

const faviconPng = await readFile(`${outputDirectory}/altaria-v2-favicon-48.png`);
const iconHeader = Buffer.alloc(22);
iconHeader.writeUInt16LE(0, 0);
iconHeader.writeUInt16LE(1, 2);
iconHeader.writeUInt16LE(1, 4);
iconHeader.writeUInt8(48, 6);
iconHeader.writeUInt8(48, 7);
iconHeader.writeUInt8(0, 8);
iconHeader.writeUInt8(0, 9);
iconHeader.writeUInt16LE(1, 10);
iconHeader.writeUInt16LE(32, 12);
iconHeader.writeUInt32LE(faviconPng.length, 14);
iconHeader.writeUInt32LE(22, 18);
await writeFile('public/favicon.ico', Buffer.concat([iconHeader, faviconPng]));

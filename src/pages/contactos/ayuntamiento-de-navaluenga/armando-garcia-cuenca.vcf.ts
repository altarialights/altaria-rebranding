import type { APIRoute } from 'astro';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import profile from '../../../data/contact-cards/navaluenga.json';

export const prerender = true;

const escapeText = (text: string) => text.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,');

// vCard 3.0 uses CRLF and folds lines at 75 octets, without splitting UTF-8.
function foldLine(line: string) {
  const parts: string[] = [];
  let current = '';
  for (const char of line) {
    if (Buffer.byteLength(current + char, 'utf8') > 75) {
      parts.push(current);
      current = ' ';
    }
    current += char;
  }
  parts.push(current);
  return parts.join('\r\n');
}

export const GET: APIRoute = async ({ site }) => {
  const [photo, logo] = await Promise.all([
    readFile(resolve('public', profile.contactPhoto.slice(1))),
    readFile(resolve('public', profile.contactLogo.slice(1))),
  ]);
  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `N:${escapeText(profile.familyName)};${escapeText(profile.givenName)};;;`,
    `FN:${escapeText(profile.name)}`,
    `ORG:${escapeText(profile.organization)}`,
    `TITLE:${escapeText(profile.title)}`,
    `ROLE:${escapeText(profile.secondaryTitle)}`,
    `TEL;TYPE=WORK,VOICE:${profile.phone}`,
    `EMAIL;TYPE=INTERNET,WORK:${profile.email}`,
    `URL:${profile.website}`,
    `URL:${new URL(profile.path, site).href}`,
    `NOTE:${escapeText(`${profile.secondaryTitle}. ${profile.department}. ${profile.party}.`)}`,
    `PHOTO;ENCODING=b;TYPE=JPEG:${photo.toString('base64')}`,
    `LOGO;ENCODING=b;TYPE=PNG:${logo.toString('base64')}`,
    'END:VCARD',
  ];
  return new Response(lines.map(foldLine).join('\r\n') + '\r\n', {
    headers: {
      'Content-Type': 'text/vcard; charset=utf-8',
      'Content-Disposition': 'attachment; filename="armando-garcia-cuenca.vcf"',
    },
  });
};

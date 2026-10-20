import { publicCodePattern } from './links';

// The canonical printable URL is deliberately absent until a reviewed public
// domain is configured. This local address is for browser QA only.
export function localTestLink(code: string) {
  if (!publicCodePattern.test(code)) throw new Error('invalid_test_code');
  return { canonicalUrl: null, testUrl: `http://127.0.0.1:4321/c/${code}` } as const;
}

export function testQrPreview(svg: string): string {
  if (!svg.startsWith('<svg ') || !svg.endsWith('</svg>')) throw new Error('invalid_qr_svg');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1350" viewBox="0 0 1200 1350">${svg}
    <rect x="0" y="1200" width="1200" height="150" fill="#7c1834"/>
    <text x="600" y="1262" text-anchor="middle" fill="white" font-family="Arial,sans-serif" font-size="44" font-weight="700">SOLO TEST · NO IMPRIMIR</text>
    <text x="600" y="1312" text-anchor="middle" fill="white" font-family="Arial,sans-serif" font-size="25">127.0.0.1 no funciona fuera de este equipo</text></svg>`;
}

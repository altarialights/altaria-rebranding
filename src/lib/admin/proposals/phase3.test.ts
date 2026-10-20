import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { priceProposal, parseScaledDecimal } from './money';
import { renderProposalPdf } from './pdf';
import { encryptGmailToken, decryptGmailToken } from '../gmail/crypto';
import { approvedGmailTestEmail, beginGmailOAuth, finishGmailOAuth, GMAIL_SCOPE, verifyGmailOAuth } from '../gmail/oauth';
import { emailsFromHeader } from '../gmail/sync';
import type { AdminPrincipal } from '../access';

const line = { kind: 'service' as const, catalogItemId: null, name: 'Servicio sintético',
  description: 'Únicamente datos de prueba', quantity: '1.250', unitPrice: '99.99',
  discountPercent: '10.00', taxPercent: '21.00' };
describe('Propuestas: economía canónica', () => {
  it('redondea cada base, descuento e impuesto half-up y suma céntimos enteros', () => {
    const quote = priceProposal([line, { ...line, quantity: '0.001', unitPrice: '5.00',
      discountPercent: '0', taxPercent: '0' }]);
    expect(quote.lines[0]).toMatchObject({ subtotalCents: 12499, discountCents: 1250,
      taxCents: 2362, totalCents: 13611 });
    expect(quote.lines[1].subtotalCents).toBe(1);
    expect(quote.totalCents).toBe(13612);
  });
  it('rechaza decimales ambiguos, importes excesivos y descuentos fuera de rango', () => {
    expect(() => parseScaledDecimal('1,23', 2, 100000n)).toThrow();
    expect(() => priceProposal([{ ...line, unitPrice: '0.001' }])).toThrow();
    expect(() => priceProposal([{ ...line, discountPercent: '101' }])).toThrow();
    expect(() => priceProposal([])).toThrow();
  });
  it('genera un PDF descargable de una versión sintética sin entidad de factura', async () => {
    const quote = priceProposal([line]);
    const bytes = await renderProposalPdf({ title: 'Propuesta sintética',
      organizationName: 'Empresa sintética', versionNumber: 1, createdAt: '2026-01-01T00:00:00Z',
      snapshot: { description: 'Alcance de prueba', scope: 'Trabajo de prueba',
        schedule: 'Tres semanas', terms: 'Sujeto a revisión', expiresAt: null, ...quote } });
    expect(Buffer.from(bytes.subarray(0, 5)).toString()).toBe('%PDF-');
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(1);
    expect(pdf.getTitle()).toContain('Propuesta sintética');
    if (process.env.ALTARIA_PHASE3_PDF_QA === '1') {
      mkdirSync('review/altaria-os/phase3', { recursive: true });
      writeFileSync('review/altaria-os/phase3/sample-proposal.pdf', bytes);
    }
  });
});
describe('Gmail staging: tokens y OAuth local', () => {
  const principal: AdminPrincipal = { id: 'synthetic-owner', email: 'owner@example.test',
    displayName: 'Propietario sintético', roles: ['owner'], sessionHash: 'a'.repeat(64) };
  it('cifra refresh tokens y rechaza claves erróneas o ciphertext manipulado', () => {
    const key = randomBytes(32).toString('hex');
    const encrypted = encryptGmailToken('synthetic-refresh-token', key);
    expect(encrypted).not.toContain('synthetic-refresh-token');
    expect(decryptGmailToken(encrypted, key)).toBe('synthetic-refresh-token');
    expect(() => decryptGmailToken(encrypted, randomBytes(32).toString('hex'))).toThrow();
  });
  it('liga state y PKCE a la sesión, e impide el intercambio de estado', () => {
    const key = randomBytes(32).toString('hex');
    const pending = beginGmailOAuth(principal, { clientId: 'synthetic-client',
      clientSecret: 'synthetic-secret', key, testEmail: 'mailbox@example.test',
      redirectUri: 'http://127.0.0.1:4321/api/admin/gmail/callback' });
    const request = new URL(pending.url);
    const state = request.searchParams.get('state')!;
    expect(request.searchParams.get('scope')?.split(' ')).toEqual(['openid', 'email', GMAIL_SCOPE]);
    expect(GMAIL_SCOPE).toBe('https://www.googleapis.com/auth/gmail.metadata');
    expect(verifyGmailOAuth(pending.cookie, state, principal, key)).toHaveLength(43);
    expect(() => verifyGmailOAuth(pending.cookie, state, { ...principal, sessionHash: 'b'.repeat(64) }, key)).toThrow();
    expect(() => verifyGmailOAuth(pending.cookie, 'wrong', principal, key)).toThrow();
  });
  it('detecta múltiples destinatarios para no asociar un hilo por el primero', () => {
    expect(emailsFromHeader('Uno <uno@example.test>, Dos <dos@example.test>'))
      .toEqual(['uno@example.test', 'dos@example.test']);
  });
  it('exige un buzón TEST distinto de la cuenta comercial y sus alias', () => {
    expect(approvedGmailTestEmail('mailbox@example.test')).toBe('mailbox@example.test');
    expect(approvedGmailTestEmail('altarialights@gmail.com')).toBeNull();
    expect(approvedGmailTestEmail('altaria.lights+test@googlemail.com')).toBeNull();
    expect(approvedGmailTestEmail('Mailbox@example.test')).toBeNull();
  });
  it('vincula el sub y email Google TEST verificados y cifra el refresh token', async () => {
    const key = randomBytes(32).toString('hex');
    const config = { clientId: 'synthetic-client', clientSecret: 'synthetic-secret', key,
      redirectUri: 'http://127.0.0.1:4321/api/admin/gmail/callback', testEmail: 'mailbox@example.test' };
    const originalFetch = globalThis.fetch;
    const writes: unknown[][] = [];
    const db = { get: async () => null, batch: async (items: unknown[]) => { writes.push(items); } };
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/token')) return Response.json({ access_token: 'synthetic-access',
        refresh_token: 'synthetic-refresh', scope: `openid email ${GMAIL_SCOPE}` });
      if (url.endsWith('/userinfo')) return Response.json({ sub: 'synthetic-sub',
        email: 'mailbox@example.test', email_verified: true });
      if (url.endsWith('/profile')) return Response.json({ emailAddress: 'mailbox@example.test' });
      if (url.endsWith('/labels')) return Response.json({ labels: [{ id: 'Label_Test',
        name: 'ALTARIA/CRM', type: 'user' }] });
      throw new Error('unexpected_google_endpoint');
    }) as typeof fetch;
    try {
      await finishGmailOAuth(principal, 'synthetic-code', 'synthetic-verifier', config, db as never);
      expect(writes).toHaveLength(1);
      const args = (writes[0][0] as { args: unknown[] }).args;
      expect(args).toContain('synthetic-sub');
      expect(args).toContain('mailbox@example.test');
      expect(args).not.toContain('synthetic-refresh');
    } finally { globalThis.fetch = originalFetch; }
  });
});

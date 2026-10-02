import { describe, it, expect } from 'vitest';
import { cardWhatsAppMessage, cardsWhatsAppUrl, CARDS_WHATSAPP_URL } from './cards-whatsapp';
describe('Cards WhatsApp handoff', () => {
  it('uses the existing business number and keeps Unicode, links and line breaks in one text parameter', () => {
    const message = cardWhatsAppMessage({ product: 'Reseñas', quantity: 5, configuration: {
      version: 2, design: 'own', destination: 'link', artwork: 'requested-later', details: { url: 'https://example.com/?a=1&b=2', instructions: 'Azul + blanco & café' },
    } });
    const url = new URL(cardsWhatsAppUrl(message));
    expect(url.origin + url.pathname).toBe('https://wa.me/34619132563');
    expect(url.searchParams.get('text')).toBe(message);
    expect(url.searchParams.size).toBe(1);
    expect(message).toContain('Cantidad: 5');
    expect(message).toContain('Tengo diseño o materiales');
  });
  it('opens generic contact without form data or database availability', () => {
    expect(new URL(CARDS_WHATSAPP_URL).pathname).toBe('/34619132563');
    const message = cardWhatsAppMessage({ product: 'Mi web', quantity: 1, configuration: {
      version: 2, design: 'custom', destination: 'help', artwork: 'not-required', details: {},
    } });
    expect(message).not.toContain('undefined');
    expect(message).toContain('Necesito ayuda');
    expect(message).not.toContain('Email:');
  });
  it('makes any shortened long brief explicit in the preview', () => {
    const message = cardWhatsAppMessage({ product: 'Otra idea', quantity: 20, configuration: {
      version: 2, design: 'custom', destination: 'create', artwork: 'not-required', details: { project: 'a'.repeat(9000) },
    } });
    expect(message.length).toBeLessThan(6000);
    expect(message).toContain('detalles restantes');
  });
});

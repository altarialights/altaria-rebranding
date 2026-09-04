import type { StripeMode } from '../lib/orders/stripe-mode';

export const getCardsCheckoutCopy = (mode: StripeMode) => mode === 'live'
  ? {
      summary: 'Pago seguro.',
      notice: 'El servidor recalcula todos los importes antes de abrir Stripe. Los precios incluyen IVA.',
      button: 'Pagar de forma segura',
      secure: 'Pago seguro procesado por Stripe',
    }
  : {
      summary: 'Pago seguro · Modo de prueba.',
      notice: 'El servidor recalcula todos los importes antes de abrir Stripe. Los precios incluyen IVA.',
      button: 'Pagar con Stripe (prueba)',
      secure: 'Checkout alojado y seguro de Stripe · Modo de prueba',
    };

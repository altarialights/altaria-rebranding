import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ row: {} as Record<string, unknown>, events: new Set<string>(), updates: 0 }));
vi.mock('../db/client', () => ({ getDatabase: () => ({ transactionAsync: (operation: (tx: unknown) => Promise<unknown>) => ({ immediate: () => operation({
  get: async (sql: string, ...args: unknown[]) => {
    if (sql.includes('FROM eventos_stripe')) return state.events.has(String(args[0])) ? { stripe_event_id: args[0] } : undefined;
    if (sql.startsWith('SELECT id FROM pedidos_tarjetas')) return state.row.stripe_checkout_session_id === null ? { id: state.row.id } : undefined;
    if (sql.includes('FROM pedidos_tarjetas')) return state.row.id === args[0] && state.row.stripe_checkout_session_id === args[1] ? { ...state.row } : undefined;
  },
  run: async (sql: string, ...args: unknown[]) => {
    if (sql.includes('INSERT INTO eventos_stripe')) state.events.add(String(args[1]));
    if (sql.includes('UPDATE pedidos_tarjetas')) { state.row.estado = 'pagado'; state.updates++; }
  },
}) }) }) }));
import { handlePaidCheckout } from './webhook.service';
import { processPaidCheckoutSession } from '../db/card-orders.repository';
import type { CheckoutSessionData } from './types';

const session: CheckoutSessionData = {
  id: 'cs_test_qa', url: null, livemode: false, clientReferenceId: 'order-qa', paymentStatus: 'paid', amountTotal: 4000,
  currency: 'eur', paymentIntentId: 'pi_test_qa', customerId: null, metadata: { pedido_id: 'order-qa', numero_pedido: 'QA' },
};
describe('webhook transitions using the real repository and a transaction test double', () => {
  beforeEach(() => {
    state.events.clear(); state.updates = 0;
    state.row = { id: 'order-qa', numero_pedido: 'QA', estado: 'pendiente_pago', total_centimos: 4000,
      stripe_entorno: 'test', stripe_checkout_session_id: 'cs_test_qa', producto_nombre: 'Tarjeta de reservas', personalizacion_json: '{}' };
  });
  it('confirms independently of the return page and only notifies once for repeated or equivalent events', async () => {
    const notify = vi.fn().mockResolvedValue({ status: 'sent', timestamp: '2026-10-02T10:00:00Z', providerMessageId: 1 });
    const dependencies = { notify, recordNotification: vi.fn() };
    expect((await handlePaidCheckout('evt_1', 'checkout.session.completed', session, dependencies)).resultado).toBe('pagado');
    expect((await handlePaidCheckout('evt_1', 'checkout.session.completed', session, dependencies)).resultado).toBe('duplicado');
    expect((await handlePaidCheckout('evt_2', 'checkout.session.async_payment_succeeded', session, dependencies)).resultado).toBe('ya_pagado');
    expect(state.updates).toBe(1); expect(notify).toHaveBeenCalledOnce();
    expect(notify.mock.calls[0][0].productoNombre).toBe('Tarjeta de reservas');
  });
  it('keeps pending and failed asynchronous payments unpaid, then accepts a later valid success', async () => {
    expect((await processPaidCheckoutSession('evt_pending', 'checkout.session.completed', { ...session, paymentStatus: 'unpaid' })).resultado).toBe('pago_pendiente');
    expect((await processPaidCheckoutSession('evt_failed', 'checkout.session.async_payment_failed', { ...session, paymentStatus: 'unpaid' })).resultado).toBe('pago_pendiente');
    expect(state.updates).toBe(0);
    expect((await processPaidCheckoutSession('evt_paid', 'checkout.session.async_payment_succeeded', session)).resultado).toBe('pagado');
  });
  it('does not consume an event that arrives before the session has been persisted', async () => {
    state.row.stripe_checkout_session_id = null;
    await expect(processPaidCheckoutSession('evt_race', 'checkout.session.completed', session)).rejects.toThrow(/vinculando/);
    expect(state.events.has('evt_race')).toBe(false);
    state.row.stripe_checkout_session_id = session.id;
    expect((await processPaidCheckoutSession('evt_race', 'checkout.session.completed', session)).resultado).toBe('pagado');
  });
  it.each([
    [{ amountTotal: 1 }, 'importe_incorrecto'], [{ currency: 'usd' }, 'moneda_incorrecta'],
    [{ metadata: {} }, 'metadata_incorrecta'], [{ livemode: true }, 'entorno_incorrecto'],
  ] as const)('does not confirm inconsistent events %j', async (changes, expected) => {
    expect((await processPaidCheckoutSession('evt_bad', 'checkout.session.completed', { ...session, ...changes })).resultado).toBe(expected);
    expect(state.updates).toBe(0);
  });
});

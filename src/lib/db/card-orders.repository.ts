import type { Transaction } from '@tursodatabase/serverless';
import { getDatabase } from './client';
import type {
  CheckoutSessionData,
  EstadoPedido,
  NuevoPedidoTarjetas,
  PedidoTarjetas,
  ResumenPedidoPublico,
} from '../orders/types';
import { validateCheckoutPayment } from '../orders/payment-validation';
import { stripeEnvironmentMatches, type StripeMode } from '../orders/stripe-mode';

type DatabaseRow = Record<string, unknown>;

const isRow = (value: unknown): value is DatabaseRow => Boolean(value) && typeof value === 'object';
const textOrNull = (value: unknown): string | null => typeof value === 'string' ? value : null;
const requiredText = (value: unknown): string => typeof value === 'string' ? value : '';
const requiredNumber = (value: unknown): number => typeof value === 'number' ? value : Number(value);

const mapPedido = (row: DatabaseRow): PedidoTarjetas => ({
  id: requiredText(row.id),
  numeroPedido: requiredText(row.numero_pedido),
  claveIdempotencia: requiredText(row.clave_idempotencia),
  huellaSolicitud: requiredText(row.huella_solicitud),
  estado: requiredText(row.estado) as EstadoPedido,
  googlePlaceId: requiredText(row.google_place_id),
  negocioNombre: requiredText(row.negocio_nombre),
  negocioDireccion: requiredText(row.negocio_direccion),
  googleMapsUrl: textOrNull(row.google_maps_url),
  cantidad: requiredNumber(row.cantidad),
  precioUnitarioCentimos: requiredNumber(row.precio_unitario_centimos),
  subtotalCentimos: requiredNumber(row.subtotal_centimos),
  envioCentimos: requiredNumber(row.envio_centimos),
  impuestosCentimos: requiredNumber(row.impuestos_centimos),
  totalCentimos: requiredNumber(row.total_centimos),
  moneda: 'eur',
  clienteNombre: requiredText(row.cliente_nombre),
  clienteEmail: requiredText(row.cliente_email),
  clienteTelefono: requiredText(row.cliente_telefono),
  envioDireccion: requiredText(row.envio_direccion),
  envioDireccionExtra: textOrNull(row.envio_direccion_extra),
  envioCodigoPostal: requiredText(row.envio_codigo_postal),
  envioCiudad: requiredText(row.envio_ciudad),
  envioProvincia: requiredText(row.envio_provincia),
  envioPais: 'ES',
  referenciaEnvio: textOrNull(row.referencia_envio),
  stripeCheckoutSessionId: textOrNull(row.stripe_checkout_session_id),
  stripePaymentIntentId: textOrNull(row.stripe_payment_intent_id),
  stripeCustomerId: textOrNull(row.stripe_customer_id),
  stripeEntorno: requiredText(row.stripe_entorno) === 'live' ? 'live' : 'test',
  creadoEn: requiredText(row.creado_en),
  pagadoEn: textOrNull(row.pagado_en),
  telegramNotificadoEn: textOrNull(row.telegram_notificado_en),
});

const SELECT_PEDIDO = `SELECT
  id, numero_pedido, clave_idempotencia, huella_solicitud, estado,
  google_place_id, negocio_nombre, negocio_direccion, google_maps_url, cantidad,
  precio_unitario_centimos, subtotal_centimos, envio_centimos, impuestos_centimos,
  total_centimos, moneda, cliente_nombre, cliente_email, cliente_telefono,
  envio_direccion, envio_direccion_extra, envio_codigo_postal, envio_ciudad,
  envio_provincia, envio_pais, referencia_envio, stripe_checkout_session_id,
  stripe_payment_intent_id, stripe_customer_id, stripe_entorno, creado_en, pagado_en,
  telegram_notificado_en
FROM pedidos_tarjetas`;

export const findCardOrderByIdempotencyKey = async (key: string): Promise<PedidoTarjetas | null> => {
  const row: unknown = await getDatabase().get(`${SELECT_PEDIDO} WHERE clave_idempotencia = ? LIMIT 1`, key);
  return isRow(row) ? mapPedido(row) : null;
};

export const createPendingCardOrder = async (input: NuevoPedidoTarjetas): Promise<{ pedido: PedidoTarjetas; creado: boolean }> => {
  const database = getDatabase();
  await database.pragma('foreign_keys = ON');
  try {
    await database.batch([
      {
        sql: `INSERT INTO pedidos_tarjetas (
          id, numero_pedido, clave_idempotencia, huella_solicitud, estado,
          google_place_id, negocio_nombre, negocio_direccion, google_maps_url, cantidad,
          precio_unitario_centimos, subtotal_centimos, envio_centimos, impuestos_centimos,
          total_centimos, moneda, cliente_nombre, cliente_email, cliente_telefono,
          envio_direccion, envio_direccion_extra, envio_codigo_postal, envio_ciudad,
          envio_provincia, envio_pais, referencia_envio, stripe_entorno, creado_en
        ) VALUES (?, ?, ?, ?, 'pendiente_pago', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          input.id, input.numeroPedido, input.claveIdempotencia, input.huellaSolicitud,
          input.negocio.googlePlaceId, input.negocio.nombre, input.negocio.direccion,
          input.negocio.googleMapsUrl ?? null, input.cantidad, input.precioUnitarioCentimos,
          input.subtotalCentimos, input.envioCentimos, input.impuestosCentimos,
          input.totalCentimos, input.moneda, input.cliente.nombre, input.cliente.email,
          input.cliente.telefono, input.envio.direccion, input.envio.direccionExtra ?? null,
          input.envio.codigoPostal, input.envio.ciudad, input.envio.provincia, input.envio.pais,
          input.envio.referencia ?? null, input.stripeEntorno, input.creadoEn,
        ],
      },
      {
        sql: `INSERT INTO eventos_pedido (
          id, pedido_id, tipo_evento, estado_anterior, estado_nuevo,
          datos_minimos_json, clave_idempotencia, creado_en
        ) VALUES (?, ?, 'pedido_creado', NULL, 'pendiente_pago', '{}', ?, ?)`,
        args: [crypto.randomUUID(), input.id, `pedido:${input.id}:creado`, input.creadoEn],
      },
    ], 'immediate');
  } catch (error) {
    const existente = await findCardOrderByIdempotencyKey(input.claveIdempotencia);
    if (existente) return { pedido: existente, creado: false };
    throw error;
  }
  const pedido = await findCardOrderByIdempotencyKey(input.claveIdempotencia);
  if (!pedido) throw new Error('No se pudo recuperar el pedido recién creado.');
  return { pedido, creado: true };
};

export const saveCheckoutSession = async (pedidoId: string, sessionId: string): Promise<void> => {
  const timestamp = new Date().toISOString();
  await getDatabase().batch([
    {
      sql: `UPDATE pedidos_tarjetas
            SET stripe_checkout_session_id = ?
            WHERE id = ? AND (stripe_checkout_session_id IS NULL OR stripe_checkout_session_id = ?)`,
      args: [sessionId, pedidoId, sessionId],
    },
    {
      sql: `INSERT OR IGNORE INTO eventos_pedido (
              id, pedido_id, tipo_evento, estado_anterior, estado_nuevo,
              datos_minimos_json, clave_idempotencia, creado_en
            ) VALUES (?, ?, 'checkout_creado', 'pendiente_pago', 'pendiente_pago', '{}', ?, ?)`,
      args: [crypto.randomUUID(), pedidoId, `checkout:${sessionId}`, timestamp],
    },
  ], 'immediate');
};

export type StripeEventResult =
  | { resultado: 'duplicado'; pedido: null; notificarTelegram: false }
  | { resultado: 'pagado'; pedido: PedidoTarjetas; notificarTelegram: true }
  | { resultado: 'ya_pagado'; pedido: PedidoTarjetas; notificarTelegram: false }
  | { resultado: 'pago_pendiente' | 'importe_incorrecto' | 'moneda_incorrecta' | 'metadata_incorrecta' | 'pedido_no_encontrado' | 'entorno_incorrecto'; pedido: PedidoTarjetas | null; notificarTelegram: false };

const insertStripeEvent = async (
  tx: Transaction,
  eventId: string,
  eventType: string,
  pedidoId: string | null,
  resultado: Exclude<StripeEventResult['resultado'], 'duplicado' | 'pagado' | 'ya_pagado' | 'entorno_incorrecto'> | 'procesado' | 'duplicado_estado',
  data: Record<string, string | number | null>,
  timestamp: string,
): Promise<void> => {
  await tx.run(
    `INSERT INTO eventos_stripe (
      id, stripe_event_id, pedido_id, tipo, resultado, datos_minimos_json, procesado_en
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    crypto.randomUUID(), eventId, pedidoId, eventType, resultado, JSON.stringify(data), timestamp,
  );
};

export const processPaidCheckoutSession = async (
  eventId: string,
  eventType: string,
  session: CheckoutSessionData,
): Promise<StripeEventResult> => {
  const database = getDatabase();
  const operation = database.transactionAsync(async (tx: Transaction): Promise<StripeEventResult> => {
    const existing: unknown = await tx.get(
      'SELECT stripe_event_id FROM eventos_stripe WHERE stripe_event_id = ? LIMIT 1',
      eventId,
    );
    if (isRow(existing)) return { resultado: 'duplicado', pedido: null, notificarTelegram: false };

    const pedidoRow: unknown = session.clientReferenceId
      ? await tx.get(
          `${SELECT_PEDIDO} WHERE id = ? AND stripe_checkout_session_id = ? LIMIT 1`,
          session.clientReferenceId, session.id,
        )
      : null;
    const pedido = isRow(pedidoRow) ? mapPedido(pedidoRow) : null;
    const timestamp = new Date().toISOString();
    const eventData = {
      amount_total: session.amountTotal,
      currency: session.currency,
      payment_status: session.paymentStatus,
    };

    if (!pedido) {
      await insertStripeEvent(tx, eventId, eventType, null, 'pedido_no_encontrado', eventData, timestamp);
      return { resultado: 'pedido_no_encontrado', pedido: null, notificarTelegram: false };
    }
    if (!stripeEnvironmentMatches(pedido.stripeEntorno, session.livemode)) {
      return { resultado: 'entorno_incorrecto', pedido, notificarTelegram: false };
    }
    const paymentValidation = validateCheckoutPayment(pedido, session);
    if (paymentValidation === 'metadata_incorrecta') {
      await insertStripeEvent(tx, eventId, eventType, pedido.id, paymentValidation, eventData, timestamp);
      await tx.run(
        `INSERT INTO eventos_pedido (
          id, pedido_id, tipo_evento, estado_anterior, estado_nuevo,
          datos_minimos_json, clave_idempotencia, creado_en
        ) VALUES (?, ?, 'incidencia_pago', ?, ?, ?, ?, ?)`,
        crypto.randomUUID(), pedido.id, pedido.estado, pedido.estado,
        JSON.stringify({ motivo: 'metadata_incorrecta', stripe_event_id: eventId }),
        `stripe:${eventId}:incidencia`, timestamp,
      );
      return { resultado: 'metadata_incorrecta', pedido, notificarTelegram: false };
    }
    if (paymentValidation === 'pago_pendiente') {
      await insertStripeEvent(tx, eventId, eventType, pedido.id, paymentValidation, eventData, timestamp);
      return { resultado: 'pago_pendiente', pedido, notificarTelegram: false };
    }
    if (paymentValidation === 'moneda_incorrecta') {
      await insertStripeEvent(tx, eventId, eventType, pedido.id, paymentValidation, eventData, timestamp);
      await tx.run(
        `INSERT INTO eventos_pedido (
          id, pedido_id, tipo_evento, estado_anterior, estado_nuevo,
          datos_minimos_json, clave_idempotencia, creado_en
        ) VALUES (?, ?, 'incidencia_pago', ?, ?, ?, ?, ?)`,
        crypto.randomUUID(), pedido.id, pedido.estado, pedido.estado,
        JSON.stringify({ motivo: 'moneda_incorrecta', stripe_event_id: eventId }),
        `stripe:${eventId}:incidencia`, timestamp,
      );
      return { resultado: 'moneda_incorrecta', pedido, notificarTelegram: false };
    }
    if (paymentValidation === 'importe_incorrecto') {
      await insertStripeEvent(tx, eventId, eventType, pedido.id, paymentValidation, eventData, timestamp);
      await tx.run(
        `INSERT INTO eventos_pedido (
          id, pedido_id, tipo_evento, estado_anterior, estado_nuevo,
          datos_minimos_json, clave_idempotencia, creado_en
        ) VALUES (?, ?, 'incidencia_pago', ?, ?, ?, ?, ?)`,
        crypto.randomUUID(), pedido.id, pedido.estado, pedido.estado,
        JSON.stringify({ motivo: 'importe_incorrecto', stripe_event_id: eventId }),
        `stripe:${eventId}:incidencia`, timestamp,
      );
      return { resultado: 'importe_incorrecto', pedido, notificarTelegram: false };
    }
    if (pedido.estado === 'pagado') {
      await insertStripeEvent(tx, eventId, eventType, pedido.id, 'duplicado_estado', eventData, timestamp);
      return { resultado: 'ya_pagado', pedido, notificarTelegram: false };
    }
    if (pedido.estado !== 'pendiente_pago') {
      await insertStripeEvent(tx, eventId, eventType, pedido.id, 'duplicado_estado', eventData, timestamp);
      return { resultado: 'ya_pagado', pedido, notificarTelegram: false };
    }

    await tx.run(
      `UPDATE pedidos_tarjetas SET
        estado = 'pagado', pagado_en = ?, stripe_payment_intent_id = ?, stripe_customer_id = ?
       WHERE id = ? AND estado = 'pendiente_pago'`,
      timestamp, session.paymentIntentId, session.customerId, pedido.id,
    );
    await tx.run(
      `INSERT INTO eventos_pedido (
        id, pedido_id, tipo_evento, estado_anterior, estado_nuevo,
        datos_minimos_json, clave_idempotencia, creado_en
      ) VALUES (?, ?, 'pago_confirmado', 'pendiente_pago', 'pagado', ?, ?, ?)`,
      crypto.randomUUID(), pedido.id,
      JSON.stringify({ stripe_event_id: eventId, checkout_session_id: session.id }),
      `stripe:${eventId}:pago`, timestamp,
    );
    await insertStripeEvent(tx, eventId, eventType, pedido.id, 'procesado', eventData, timestamp);

    return {
      resultado: 'pagado',
      pedido: {
        ...pedido,
        estado: 'pagado',
        pagadoEn: timestamp,
        stripePaymentIntentId: session.paymentIntentId,
        stripeCustomerId: session.customerId,
      },
      notificarTelegram: true,
    };
  });

  return operation.immediate();
};

export const recordCardOrderTelegramResult = async (
  pedidoId: string,
  stripeEventId: string,
  result: { status: 'sent'; timestamp: string; providerMessageId: number } | { status: 'failed'; timestamp: string; reason: string },
): Promise<void> => {
  const sent = result.status === 'sent';
  await getDatabase().batch([
    {
      sql: `UPDATE pedidos_tarjetas SET
              telegram_notificado_en = CASE WHEN ? = 1 THEN ? ELSE telegram_notificado_en END,
              telegram_ultimo_error = ?
            WHERE id = ?`,
      args: [sent ? 1 : 0, result.timestamp, sent ? null : result.reason, pedidoId],
    },
    {
      sql: `INSERT OR IGNORE INTO eventos_pedido (
              id, pedido_id, tipo_evento, estado_anterior, estado_nuevo,
              datos_minimos_json, clave_idempotencia, creado_en
            ) VALUES (?, ?, ?, 'pagado', 'pagado', ?, ?, ?)`,
      args: [
        crypto.randomUUID(), pedidoId,
        sent ? 'telegram_enviado' : 'telegram_fallido',
        JSON.stringify(sent ? { provider_message_id: result.providerMessageId } : { motivo: result.reason }),
        `telegram:${stripeEventId}`, result.timestamp,
      ],
    },
  ], 'immediate');
};

export const findPublicCardOrderByCheckoutSession = async (
  sessionId: string,
  stripeEntorno: StripeMode,
): Promise<ResumenPedidoPublico | null> => {
  const row: unknown = await getDatabase().get(
    `SELECT numero_pedido, negocio_nombre, cantidad, total_centimos, moneda, estado
     FROM pedidos_tarjetas
     WHERE stripe_checkout_session_id = ? AND stripe_entorno = ? LIMIT 1`,
    sessionId, stripeEntorno,
  );
  if (!isRow(row)) return null;
  return {
    numeroPedido: requiredText(row.numero_pedido),
    negocioNombre: requiredText(row.negocio_nombre),
    cantidad: requiredNumber(row.cantidad),
    totalCentimos: requiredNumber(row.total_centimos),
    moneda: 'eur',
    estado: requiredText(row.estado) as EstadoPedido,
  };
};

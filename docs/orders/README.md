# Pedidos de tarjetas NFC + QR

## Flujo

1. `POST /api/tarjetas/checkout` valida origen y payload.
2. El servidor calcula todos los importes y crea `pedidos_tarjetas` en `pendiente_pago`.
3. Stripe Checkout se crea con la misma clave idempotente y sus IDs se guardan en Turso.
4. `POST /api/stripe/webhook` verifica el cuerpo raw y `Stripe-Signature`.
5. Solo un evento test con `payment_status=paid`, EUR e importe idéntico cambia el pedido a `pagado`.
6. La transacción registra `eventos_stripe` y `eventos_pedido`; después del commit se intenta Telegram.
7. `/tarjetas-reseñas-google/pedido-confirmado` consulta Turso por la sesión y nunca interpreta el redirect como prueba de pago.

## Configuración local

Variables server-side:

```dotenv
TURSO_DATABASE_URL=
TURSO_AUTH_TOKEN=
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
```

La aplicación rechaza cualquier `STRIPE_SECRET_KEY` que no empiece por `sk_test_` y cualquier webhook con `livemode=true`. No necesita publishable key porque usa Checkout alojado.

Aplica una sola vez la migración:

```powershell
Get-Content -Raw migrations/002_create_card_orders.sql | turso db shell altaria-digital-index
```

Para escuchar webhooks locales en el puerto configurado de Astro:

```powershell
stripe login
stripe listen --events checkout.session.completed,checkout.session.async_payment_succeeded,checkout.session.async_payment_failed --forward-to http://localhost:4321/api/stripe/webhook
```

Copia el secreto `whsec_...` que muestra Stripe CLI en `STRIPE_WEBHOOK_SECRET`. El secreto de CLI no es el mismo que el del endpoint del Dashboard.

## Dashboard de Stripe (sandbox)

- Activa el modo de prueba/sandbox.
- Usa una clave secreta `sk_test_...` en Vercel; nunca una `sk_live_...`.
- Crea el endpoint `https://altarialights.com/api/stripe/webhook` en modo prueba.
- Suscribe `checkout.session.completed`, `checkout.session.async_payment_succeeded` y `checkout.session.async_payment_failed`.
- Guarda el signing secret test como `STRIPE_WEBHOOK_SECRET`.
- Mantén Stripe Tax, facturas, cupones y suscripciones desactivados.

## Fiscalidad pendiente

`impuestos_centimos` existe, pero actualmente vale cero. Antes de aceptar pagos reales debe aprobarse la política fiscal, reflejarla en la UI y adaptar el cálculo server-side. No basta con cambiar las claves de Stripe.

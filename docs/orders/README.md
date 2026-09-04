# Pedidos de tarjetas NFC + QR

## Flujo

1. `POST /api/tarjetas/checkout` valida origen y payload.
2. El servidor calcula todos los importes y crea `pedidos_tarjetas` en `pendiente_pago`.
3. Stripe Checkout se crea con la misma clave idempotente y sus IDs se guardan en Turso.
4. `POST /api/stripe/webhook` verifica el cuerpo raw y `Stripe-Signature`.
5. Solo un evento cuyo `livemode` coincida con `STRIPE_MODE` y con `pedido.stripe_entorno`, con `payment_status=paid`, EUR e importe idéntico, cambia el pedido a `pagado`.
6. La transacción registra `eventos_stripe` y `eventos_pedido`; después del commit se intenta Telegram.
7. `/tarjetas-reseñas-google/pedido-confirmado` consulta Turso por la sesión y nunca interpreta el redirect como prueba de pago.

## Configuración local

Variables server-side:

```dotenv
TURSO_DATABASE_URL=
TURSO_AUTH_TOKEN=
STRIPE_MODE=test
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
```

La aplicación exige `STRIPE_MODE=test|live`. En `test` solo acepta `sk_test_` y eventos `livemode=false`; en `live` solo acepta `sk_live_` y eventos `livemode=true`. El secreto de webhook debe pertenecer al endpoint del mismo entorno. No necesita publishable key porque usa Checkout alojado.

En una instalación nueva, aplica cada migración una sola vez:

```powershell
Get-Content -Raw migrations/002_create_card_orders.sql | turso db shell altaria-digital-index
Get-Content -Raw migrations/003_add_card_order_stripe_environment.sql | turso db shell altaria-digital-index
```

Si `002_create_card_orders.sql` ya está aplicada, ejecuta únicamente la migración `003`.

Para escuchar webhooks locales en el puerto configurado de Astro:

```powershell
stripe login
stripe listen --events checkout.session.completed,checkout.session.async_payment_succeeded,checkout.session.async_payment_failed --forward-to http://localhost:4321/api/stripe/webhook
```

Copia el secreto `whsec_...` que muestra Stripe CLI en `STRIPE_WEBHOOK_SECRET`. El secreto de CLI no es el mismo que el del endpoint del Dashboard.

## Dashboard de Stripe

- Para local/desarrollo, usa `STRIPE_MODE=test`, `sk_test_...` y el signing secret test/CLI.
- Para Vercel Production, usa `STRIPE_MODE=live` y una clave `sk_live_...`.
- Crea el endpoint LIVE `https://altarialights.com/api/stripe/webhook` desde el modo LIVE del Dashboard.
- Suscribe `checkout.session.completed`, `checkout.session.async_payment_succeeded` y `checkout.session.async_payment_failed`.
- Guarda el signing secret del endpoint LIVE como `STRIPE_WEBHOOK_SECRET` en Vercel Production.
- Mantén Stripe Tax, facturas, cupones y suscripciones desactivados.

## Importes e IVA

Los precios mostrados y cobrados incluyen IVA. `impuestos_centimos` permanece a cero porque no se añade una segunda cantidad fiscal al total; el importe autoritativo se calcula siempre en servidor.

# Esquema de datos — Índice Altaria de Madurez Digital

## Objetivo

La base Turso conserva el resultado canónico de cada evaluación, sus respuestas versionadas, la atribución de campaña y el lead profesional que desbloqueó el informe. Ningún dato personal se escribe antes del envío voluntario del último formulario. Las URL públicas usan un token aleatorio; la base solo conserva su SHA-256.

El código usa el SDK remoto actual `@tursodatabase/serverless`, SQL explícito y parámetros posicionales. No existe ORM. `src/lib/db/persistence.service.ts` activa `foreign_keys` y ejecuta todas las inserciones en un único batch `immediate`, que Turso trata como transacción atómica.

## Tablas

### `digital_assessments`

Una fila por diagnóstico completado.

| Columna | Tipo / regla | Uso |
|---|---|---|
| `id` | TEXT PK, UUID | Identificador interno no enumerable. |
| `questionnaire_version` | TEXT NOT NULL | Fuente de verdad usada, inicialmente `v1`. |
| `result_token_hash` | TEXT UNIQUE NOT NULL | SHA-256 hexadecimal del token público. Nunca se guarda el token raw. |
| `overall_score` | INTEGER 0–100 | Índice canónico recalculado en servidor. |
| `maturity_level` | TEXT CHECK | Nivel determinista correspondiente al score. |
| `primary_opportunity` | TEXT NOT NULL | Dimensión válida con menor score. |
| `secondary_opportunity` | TEXT nullable | Segunda dimensión válida con menor score. |
| `source_channel` | TEXT nullable | Canal de entrada derivado inicialmente de `utm_source`. |
| `utm_source`, `utm_medium`, `utm_campaign`, `utm_content` | TEXT nullable | Atribución de campaña. |
| `referrer` | TEXT nullable | Referencia capturada al entrar. |
| `created_at` | TEXT NOT NULL | UTC ISO 8601. |

No contiene PII. Escribe `src/lib/db/assessments.repository.ts`; lee el mismo repositorio para resolver un token.

### `digital_assessment_scores`

Una fila por dimensión y assessment. PK compuesta `(assessment_id, dimension)` y FK con borrado en cascada.

| Columna | Regla |
|---|---|
| `assessment_id` | FK a `digital_assessments.id`. |
| `dimension` | CHECK sobre las cinco dimensiones v1. |
| `score` | INTEGER 0–100 o NULL si faltan datos. |
| `status` | `valid` o `insufficient_data`. |
| `valid_answers` | 0–5. |

No contiene PII. Escribe y lee `assessments.repository.ts`.

### `digital_assessment_answers`

Conserva las respuestas históricas para reproducibilidad. `id` es UUID; `(assessment_id, question_key)` es único; FK con cascada.

| Columna | Regla |
|---|---|
| `question_key`, `question_version` | Identifican afirmación y versión. |
| `dimension` | Dimensión a la que pertenecía en esa versión. |
| `raw_value` | 1–5 o NULL para «No aplica». |
| `normalized_score` | 0, 25, 50, 75, 100 o NULL. |
| `created_at` | UTC ISO 8601. |

No contiene PII. Escribe `assessments.repository.ts`. No se lee en la UI v1; permite auditoría y futuras reevaluaciones.

### `digital_leads`

Una fila profesional por assessment (`assessment_id` UNIQUE, FK con cascada).

| Columna | Tipo / regla | PII |
|---|---|---|
| `id` | TEXT PK, UUID | No |
| `full_name`, `email`, `job_title` | TEXT NOT NULL | Sí |
| `company_name`, `company_url`, `company_size` | TEXT NOT NULL | Sí, información profesional |
| `review_requested` | INTEGER boolean CHECK | No |
| `privacy_consent_at` | UTC ISO 8601 | Sí, evidencia de consentimiento |
| `marketing_consent_at` | UTC ISO 8601 nullable | Sí, evidencia separada y opcional |
| `commercial_score` | INTEGER 0–100 | No; métrica interna distinta del índice |
| `commercial_priority` | LOW / MEDIUM / HIGH / VERY_HIGH | No |
| `crm_status` | Estado CHECK, default NEW | No |
| `created_at` | UTC ISO 8601 | No |

Escribe `src/lib/db/leads.repository.ts`; lee `assessments.repository.ts` solo para personalizar la página y estado de revisión. Nunca registrar email o nombre en logs.

### `digital_lead_events`

Histórico append-only de eventos asociados a un lead. FK con cascada. `metadata_json` guarda JSON serializado sin PII. Eventos: `report_unlocked`, `review_requested`, `result_viewed`, `telegram_notification_sent` y `telegram_notification_failed`. Los eventos de Telegram guardan únicamente fecha, proveedor, tipo de notificación, identificador de mensaje o motivo técnico de fallo. Escribe `leads.repository.ts`.

### `pedidos_tarjetas`

Una fila por intento de pedido de tarjetas NFC + QR. La migración `002_create_card_orders.sql` es append-only y no modifica las tablas del diagnóstico.

| Grupo | Columnas | Regla |
|---|---|---|
| Identidad | `id`, `numero_pedido` | UUID interno y número público `ALT-TRJ-AAAAMMDD-XXXXXXXXXXXX`, ambos únicos. |
| Idempotencia | `clave_idempotencia`, `huella_solicitud` | La clave UUID del navegador es única y la huella SHA-256 impide reutilizarla con datos distintos. |
| Estado | `estado` y timestamps operativos | Estados permitidos: `pendiente_pago`, `pagado`, `preparando`, `enviado`, `entregado`, `cancelado`, `reembolsado`. Solo el webhook confirmado marca `pagado`. |
| Negocio | `google_place_id`, `negocio_nombre`, `negocio_direccion`, `google_maps_url` | Datos mínimos devueltos por Google Places. No se guardan reseñas, fotos ni horarios. |
| Importes | cantidad e importes en céntimos | EUR. El servidor calcula precio, envío y total; nunca acepta importes del navegador. Los precios son finales con IVA incluido y `impuestos_centimos` queda a cero porque no se suma un recargo fiscal adicional. |
| Cliente y envío | nombre, email, teléfono y dirección | PII estrictamente necesaria para el pedido y futuro fulfillment. |
| Stripe | IDs de Checkout, PaymentIntent y Customer; `stripe_entorno` | IDs técnicos; no se almacenan tarjetas ni datos bancarios. Checkout y PaymentIntent son únicos cuando existen. `stripe_entorno` distingue `test` y `live`; los registros anteriores a la migración 003 quedan como `test`. |
| Operación | tracking, transportista y timestamps | Preparado para fulfillment futuro, sin integración InPost actual. |
| Telegram | `telegram_notificado_en`, `telegram_ultimo_error` | Permite conocer la entrega y preparar reintentos sin revertir el pago. |

### `eventos_pedido`

Timeline append-only del pedido. Guarda tipo, transición de estado y JSON mínimo sin PII. `clave_idempotencia` evita repetir eventos de creación de Checkout, Stripe o Telegram. FK a `pedidos_tarjetas` con cascada.

### `eventos_stripe`

Registro idempotente de webhooks. `stripe_event_id` es `UNIQUE`; antes de cualquier transición se comprueba si ya existe dentro de una transacción `immediate`. Guarda solo el tipo, resultado, pedido relacionado, importe/currency/payment status y fecha, nunca el payload completo.

## Relaciones e índices

```text
digital_assessments 1 ── 5 digital_assessment_scores
digital_assessments 1 ── 25 digital_assessment_answers
digital_assessments 1 ── 1 digital_leads 1 ── N digital_lead_events
pedidos_tarjetas 1 ── N eventos_pedido
pedidos_tarjetas 1 ── N eventos_stripe
```

Hay índices por fecha/campaña, prioridad comercial, estado CRM, estado/fecha de pedidos y timelines. Las claves únicas de número de pedido, idempotencia y Stripe crean además índices SQLite implícitos.

## Flujo de escritura

1. Astro Action valida con Zod, origen, honeypot y tiempo mínimo.
2. El servidor valida `questionnaire_version` y recalcula todos los scores.
3. Genera IDs UUID, token de 32 bytes y SHA-256.
4. Calcula lead score con configuración centralizada.
5. Un batch atómico escribe assessment, cinco scores, veinticinco respuestas, lead y eventos.
6. Tras el commit genera la URL de resultado e intenta la notificación interna; su entrega o fallo se registra como evento sin PII.
7. Devuelve la URL con el token raw aunque la notificación externa falle.

Un fallo en cualquier sentencia revierte el batch completo.

## Versionado y migraciones

- `migrations/` es append-only y usa prefijos numéricos.
- Nunca se edita una migración aplicada; se añade `002_descripcion.sql`, etc.
- Después de cada cambio se actualiza este documento.
- `002_create_card_orders.sql` añade exclusivamente las tres tablas de pedidos y sus índices; no contiene `DROP` ni altera datos existentes.
- `003_add_card_order_stripe_environment.sql` añade `stripe_entorno` con default `test` y restricción `test/live`; no borra ni recrea tablas y clasifica como `test` los pedidos existentes.
- Preguntas o scoring nuevos crean `questionnaires/v2.ts`; los registros históricos conservan `questionnaire_version` y `question_version`.
- Todos los timestamps son texto ISO 8601 en UTC generado por el servidor.

## Aplicación inicial

```powershell
turso auth login
turso db create altaria-digital-index
Get-Content -Raw migrations/001_create_digital_assessment.sql | turso db shell altaria-digital-index
turso db show altaria-digital-index
turso db tokens create altaria-digital-index
```

Guarda la URL y el token únicamente como `TURSO_DATABASE_URL` y `TURSO_AUTH_TOKEN` en las variables cifradas de Vercel. Antes de aplicar futuras migraciones, registra externamente qué números ya se ejecutaron; v1 no introduce una tabla automática de migraciones.

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

## Relaciones e índices

```text
digital_assessments 1 ── 5 digital_assessment_scores
digital_assessments 1 ── 25 digital_assessment_answers
digital_assessments 1 ── 1 digital_leads 1 ── N digital_lead_events
```

Hay índices por fecha/campaña, prioridad comercial, estado CRM y timeline de eventos. El hash de token y las claves únicas ya crean índices SQLite implícitos.

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

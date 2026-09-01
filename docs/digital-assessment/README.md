# Índice Altaria de Madurez Digital

## Arquitectura funcional

`/medir-nivel-digital` sigue siendo una página prerenderizada. Contiene una aplicación ligera en TypeScript/DOM nativo: intro, cinco secciones, preview y captura profesional. No se ha añadido React ni una librería de gráficas. El borrador versionado en `localStorage` solo contiene respuestas y tiempo de inicio, nunca PII.

El submit llama a `submitDigitalAssessment` en `src/actions/index.ts`. La Action valida, recalcula en servidor, persiste en Turso y devuelve el token. `/medir-nivel-digital/resultado/[token]` exporta `prerender = false`, resuelve el SHA-256 del token y renderiza el informe bajo demanda. Todas las demás páginas conservan el prerender por defecto de Astro.

```text
Landing estática → 5 etapas → preview local → lead gate
                                      ↓
                              Astro Action + Zod
                                      ↓
                        scoring canónico + lead score
                                      ↓
                         batch atómico remoto Turso
                                      ↓
                       resultado dinámico noindex
```

## Módulos

- `questionnaires/v1.ts`: única fuente versionada de dimensiones, preguntas, pesos, niveles, copy y 20 mappings de recomendación.
- `scoring.ts`: normalización, scores, nivel y orden de oportunidad.
- `lead-scoring.ts`: métrica comercial interna con pesos configurables.
- `validation.ts`: contrato Zod del cliente al servidor.
- `token.ts`: token aleatorio, hash y token de demo sin PII.
- `src/lib/db/`: cliente, repositorios SQL y orquestación atómica.
- `tracking.ts`: capa desacoplada que reutiliza PostHog solo si existe consentimiento.
- `email/email.service.ts`: contrato NoOp para el proveedor futuro.

## Seguridad y privacidad

- El cliente solo muestra una preview; nunca envía una puntuación confiable.
- Token público de 32 bytes base64url; la DB guarda SHA-256.
- SQL parametrizado, batch transaccional y foreign keys activadas.
- Comprobación same-origin cuando el navegador envía `Origin`.
- Honeypot, límites Zod y mínimo de 45 segundos.
- No se registra PII en analytics ni logs.
- Privacidad y marketing son consentimientos separados y no preseleccionados.
- Resultado con `noindex, nofollow` y sin canonical.
- `rate-limit.ts` es el punto de extensión para Vercel Firewall o un store compartido.

## Demo local

1. Copia `.env.example` a `.env`.
2. Mantén `ASSESSMENT_DEMO_MODE=true`.
3. Ejecuta `npm run dev`.

Demo solo se activa cuando Astro está en desarrollo. No persiste PII. El token demo codifica exclusivamente respuestas y permite probar el informe. En build/producción el flag no simula guardado; sin credenciales Turso la Action devuelve un error controlado.

## Producción en Vercel

1. Crea la base y aplica las migraciones según `docs/database/SCHEMA.md`.
2. Configura `TURSO_DATABASE_URL` y `TURSO_AUTH_TOKEN` como variables server-only en Vercel.
3. No configures variables con prefijo `PUBLIC_`.
4. Despliega y prueba una evaluación real.

El proyecto usa `@astrojs/vercel@9.0.5`, última rama compatible con Astro 5.18. No se activó `output: 'server'`: landing y páginas históricas siguen estáticas; únicamente Actions y el resultado requieren funciones Vercel.

## Analytics y eventos

`trackAssessmentEvent()` emite: `assessment_started`, `assessment_section_completed`, `assessment_completed`, `report_gate_viewed`, `report_unlocked`, `review_requested`, `result_viewed`. Respeta el consentimiento existente de PostHog. Los hitos vinculados a un lead también se escriben en `digital_lead_events`.

## CRM futuro

`digital_leads.crm_status` ya admite `NEW`, `REVIEWED`, `CONTACTED`, `CONVERSATION`, `MEETING`, `PROPOSAL`, `WON`, `LOST`, `NURTURE`. Una futura `/admin/leads` debería usar autenticación, autorización, paginación y un repositorio separado; no debe consultar SQL desde componentes.

## Roadmap

- V2: emails por categoría, alertas de alto valor con proveedor aprobado, dashboard admin, estados/notas CRM y n8n.
- V3: PDF, repetir evaluación, evolución temporal y benchmarking.
- V4: benchmarking por tamaño/sector exclusivamente con datos reales anonimizados, informes agregados y contenido propio.

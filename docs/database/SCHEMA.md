# Esquema de datos — Altaria Lights

## Objetivo

La base Turso conserva el resultado canónico de cada evaluación, sus respuestas versionadas, la atribución de campaña y el lead profesional que desbloqueó el informe. Ningún dato personal se escribe antes del envío voluntario del último formulario. Las URL públicas usan un token aleatorio; la base solo conserva su SHA-256.

El código usa el SDK remoto actual `@tursodatabase/serverless`, SQL explícito y parámetros posicionales. No existe ORM. `src/lib/db/persistence.service.ts` activa `foreign_keys` y ejecuta todas las inserciones en un único batch `immediate`, que Turso trata como transacción atómica.

## Tablas

### Altaria OS Fase 7 — MCP privado (022, solo TEST)

`022_altaria_os_mcp_private.sql` añade una concesión MCP explícita por usuario, una cola de acciones preparadas con clave de idempotencia, hash SHA-256, versión y caducidad, eventos inmutables y contadores horarios persistentes. No altera tablas ni migraciones anteriores. La concesión MCP empieza vacía: ningún usuario recibe acceso por tener un rol administrativo. Su revocación se comprueba en cada llamada junto con el identificador estable WorkOS y los permisos actuales del módulo y recurso.

`os_mcp_action_requests` extiende el patrón de aprobaciones de Fase 6 sin reutilizar incorrectamente `os_approvals`, cuya restricción de 017 permite únicamente `work_item.complete`. Las solicitudes MCP se muestran en la misma bandeja del administrador; la decisión y ejecución son acciones humanas separadas. Una solicitud caducada, modificada o duplicada no se ejecuta. El estado `executing` bloquea reintentos automáticos si hay una caída entre la escritura del servicio existente y el registro del resultado; requiere conciliación manual para evitar duplicados. No se almacenan tokens OAuth, secretos, diseños ni cuerpos de correo en la auditoría.

El recurso MCP solo se habilita en TEST tras verificar Turso, Stripe test, WorkOS staging, `iss`, `aud`, `sub`, `client_id`, vigencia del JWT y concesión local. La integración real con ChatGPT permanece desactivada hasta autorizar WorkOS Connect y un túnel o HTTPS de prueba.

### Altaria OS Fase 6.5C — Content OS (019–021, solo TEST)

`019_altaria_os_content_core.sql` crea marcas y canales editoriales ampliables, concesiones explícitas por usuario/marca sin asignar roles CRM/Cards, proyectos, políticas de revisión simple o por etapas, objetivos de frecuencia, piezas, versiones de texto inmutables, eventos, comentarios y guías de marca versionadas. La configuración inicial contiene tres marcas (Martín Altaria, Altaria Cards y Restaurante De Zamorano) y cuatro pares marca/canal; De Zamorano comienza `planned` hasta verificar derechos. No se insertan publicaciones ni cuentas sociales.

`content_pieces` conserva etapa editorial (`idea/script/visuals/editing/review/ready`), estado posterior independiente (`none/scheduled/published/analyzed/archived`), pausa transversal con motivo, versión y revisión optimista. Las FKs compuestas obligan a que canal y proyecto pertenezcan a la misma marca. `content_piece_versions`, `content_events`, `content_comments` y `content_brand_guide_versions` rechazan UPDATE/DELETE mediante triggers. Cada lectura de texto versionado verifica SHA-256.

`020_altaria_os_content_workflow.sql` agrega solo metadatos de activos (`content_assets`), vínculos a versiones, solicitudes y decisiones de revisión, programación y confirmación de publicación, métricas, vínculos explícitos al CRM y a `os_work_items`. Los bytes multimedia se guardan fuera de Turso en un adaptador **local TEST simulado** privado; proveedor `mock_local`, clave aleatoria opaca, hash, tamaño, formato y procedencia. No hay bucket R2 ni URL firmada persistente. Las decisiones y métricas son append-only. La solicitud congela política, versión y hashes; un cambio la invalida. Solo evidencia humana verificable o evidencia sintética claramente marcada TEST permite estado confirmado. Programar no publica.

`021_altaria_os_content_version_format.sql` añade `format_snapshot` a `content_piece_versions`. Cada versión nueva guarda y protege por SHA-256 el formato junto al texto; consultar una versión histórica muestra su formato original. Se añade sin alterar 019/020. No había piezas persistentes en TEST antes de aplicar 021.

Las cinco reglas `content.*` se insertan en `os_rule_config`; el trigger de eventos escribe outbox en la misma transacción. El motor existente crea `os_work_items` idempotentes y `content_work_links`, sin segundo sistema de tareas. `os_approvals` conserva su acción cerrada `work_item.complete`; la revisión editorial usa `content_review_requests`/`content_review_decisions` y se presenta en la bandeja existente. El acceso exige WorkOS verificado, marcador TEST y permisos por marca en servidor; `viewer` por sí solo no concede acceso editorial.

### Altaria OS Fase 6.5B — Sales OS (018, solo TEST)

`018_altaria_os_sales.sql` amplía el CRM existente; no crea otro pipeline, empresa ni sistema de envío. `crm_sales_entries` conserva la clasificación y el estado editorial (`draft`, `review`, `approved`, `retired`), con versión última y versión aprobada separadas. `crm_sales_entry_versions` guarda texto y siguiente paso con SHA-256, procedencia (`new_proposal`, `supplied_original`, `site_reference`), fuente y autor. Sus versiones y `crm_sales_entry_events` son inmutables mediante triggers. Una edición crea versión nueva y vuelve a revisión; la versión aprobada anterior continúa disponible para lectores autorizados. Solo `owner` aprueba o retira.

`crm_sales_draft_sources` vincula un borrador **local** de `crm_gmail_drafts` con la versión exacta de la guía, empresa y oportunidad coherente. No envía correos. `crm_contact_channel_reviews` registra decisiones manuales por canal y contacto, incluidas oposiciones, en historial inmutable; un bloqueo de empresa prevalece sobre cualquier contacto y un bloqueo de contacto impide preparar su borrador. Una decisión ausente nunca se interpreta como consentimiento o autorización de envío. `crm_prospect_campaigns` y miembros permiten planificación manual, con máximo 20 empresas impuesto por trigger; no hay secuencias automáticas.

La regla `sales.opportunity.guide` usa el motor de Fase 6: un trigger inserta en `os_outbox` un evento por etapa abierta de oportunidad; el trabajador crea una sugerencia idempotente en `os_work_items`, sin contacto externo ni tarea repetida. Las tareas y actividades humanas siguen usando los servicios CRM. El contenido inicial es redacción nueva en estado `review`, con clave de semilla idempotente y procedencia explícita; ningún texto se presenta como histórico o aprobado.

### Altaria OS Fase 6 — automatizaciones (017, solo TEST)

`017_altaria_os_automations.sql` añade tablas y disparadores nuevos y una columna
anulable `crm_tasks.automation_key` con índice único parcial. No reescribe pedidos,
pagos, respuestas, versiones de propuesta ni migraciones previas. Los disparadores
insertan eventos de negocio en `os_outbox` **en la misma transacción** que la fuente:
lead vinculado, llamada, oportunidad ganada/perdida, respuesta/estado de propuesta,
pago confirmado **únicamente de pedido Stripe test**, incidencia, pausa/retirada
de enlace y entrega. El payload contiene identificadores y estados, sin datos de
contacto, cuerpo de correo, arte ni información de pago.

| Entidad | Integridad y uso |
|---|---|
| `os_rule_config` | Reglas predefinidas, activas/pausadas; `daily.brief.local_time` empieza `NULL`, sin hora supuesta. Sólo el propietario cambia reglas y horario. |
| `os_outbox` | Un evento por `dedupe_key` única, con fecha de despacho. Un evento y su escritura fuente se confirman o revierten juntos. |
| `os_jobs`, `os_job_attempts` | Trabajo persistente con clave de idempotencia única, ejecución futura, máximo de intentos, lease recuperable de 90 s, error técnico limitado y reintento exponencial entre 30 s y 6 h. Los intentos son inmutables. Una regla pausada conserva sus jobs. |
| `crm_tasks.automation_key` | Tarea de revisión de lead única por enlace de origen; el índice parcial impide duplicados aun con dos trabajadores. |
| `os_work_items` | Acciones sugeridas o alertas, con fuente, prioridad, contexto CRM/Cards, asignación opcional y clave única. No modifica pagos ni registra verificaciones físicas. Estados `open`, `done`, `cancelled`. |
| `os_notifications`, `os_notification_attempts` | Cola idempotente de plantillas Telegram **simuladas**, con lease/reintento/error/resultado. No contiene token, chat ni dirección externa. Intentos inmutables. |
| `os_daily_briefs` | Snapshot por día `Europe/Madrid`, PK de fecha; la misma fuente alimenta Inicio y la notificación simulada. |
| `os_approvals`, `os_approval_events` | Solicitud exacta `work_item.complete` con JSON, SHA-256, versión de recurso, solicitante, vencimiento, aprobador, ejecución y resultado. La ejecución es única por clave; eventos inmutables. No existe acción arbitraria ni conector MCP. |

Índices de cola por estado/fecha, de trabajo por estado/prioridad y contexto, y
de aprobaciones por estado/caducidad. El trabajador local se ejecuta sólo tras
comprobar `ALTARIA_TEST_ISOLATED`, el host Turso aprobado, marcador remoto y Stripe
test. Todo SQL variable está parametrizado. Conservación propuesta: outbox y
auditoría 400 días, intentos 90 días y notificaciones simuladas 30 días; **no se
purga nada automáticamente en TEST** hasta aprobar una política y verificar que
los estados pendientes o fallidos no se pierden.

### Altaria OS Fase 3 — propuestas y Gmail (009–010)

`009_altaria_os_proposals_gmail.sql` es incremental: agrega tablas de propuestas y correo, y tres columnas anulables para cancelar tareas sin borrar ni reescribir tareas existentes. Se aplicó únicamente en `altaria-os-test` tras comprobar URL, token, marcador remoto, Stripe test, WorkOS staging y hashes 001–008. `010_altaria_os_proposal_immutability.sql` agrega seis triggers que rechazan UPDATE y DELETE de versiones, partidas y eventos; se aplicó sólo después de verificar hashes 001–009. No contienen datos reales ni cambian migraciones anteriores.

| Tablas | Regla |
|---|---|
| `crm_proposal_templates`, `crm_proposal_catalog` | Plantillas y productos/servicios reutilizables. El catálogo empieza vacío: no se inventan tarifas de Altaria. |
| `crm_proposals` | Una propuesta pertenece a una oportunidad y empresa coherentes mediante FK compuesta. Estado comercial `draft`, `sent`, `accepted`, `rejected` o `expired`, independiente de pedidos y facturas. |
| `crm_proposal_versions`, `crm_proposal_version_items` | Cada guardado crea una versión nueva con snapshot JSON, SHA-256 y partidas desnormalizadas para consulta. Seis triggers de 010 impiden actualizar o eliminar versiones, partidas y eventos. El hash se verifica antes de lectura/PDF. |
| `crm_proposal_events` | Historial comercial append-only, con actor, versión, fecha e idempotencia opcional. La auditoría sensible también entra en `altaria_admin_audit_events`. |
| `crm_proposal_followups` y `crm_tasks.cancelled_*` | Vincula una versión enviada con una tarea única. Una respuesta o decisión cancela el seguimiento sin eliminar el historial. |
| `crm_gmail_connections` | Identidad Google estable, token de actualización cifrado AES-256-GCM, etiqueta fija y cursor de historial. No guarda tokens en claro. Sin conexión real hasta aprobar Google Cloud y permisos restringidos. |
| `crm_gmail_threads`, `crm_gmail_messages` | IDs únicos por conexión, asociación revisable con empresa/contacto y metadatos mínimos de mensajes de `ALTARIA/CRM`. No guarda el buzón completo ni cuerpos completos. |
| `crm_gmail_drafts`, `crm_gmail_sync_incidents` | Borradores locales revisables (nunca envían) e incidencias de sincronización visibles. |

Importes de propuestas: euros como texto decimal en el formulario; el servidor los convierte a céntimos enteros. Cantidad con tres decimales (`quantity_milli`), descuento e impuesto en puntos básicos (`bps`). Por partida se redondea **half-up** a céntimos al calcular base `cantidad × precio`, descuento sobre base e impuesto sobre base menos descuento. Los totales son la suma de partidas ya redondeadas; máximo 99.999.999,99 €. Nunca se usan flotantes para el cálculo canónico. Una aceptación comercial no genera factura ni marca un pedido como pagado. Sólo puede marcar `won` automáticamente si la oportunidad está en `negotiation`, transición ya permitida por el CRM; en otras etapas queda pendiente el avance manual.

Gmail: la etiqueta limita el procesamiento en el servicio, **no** el permiso OAuth de Google. `gmail.metadata` permite leer etiquetas y cabeceras de todo el buzón y sigue siendo restringido; puede requerir verificación y evaluación de seguridad. La conexión exige una dirección TEST explícita y rechaza la cuenta comercial conocida y sus alias Gmail. La sincronización inicial lista mensajes etiquetados; la incremental usa `historyId`, revalida la etiqueta antes de persistir y hace resincronización si el historial caduca. Mensajes no etiquetados, incluso respuestas del mismo hilo, no se importan automáticamente. La asociación por email requiere una sola coincidencia; ambigüedades quedan sin asociar. La interfaz no envía correos.

### Altaria OS Fase 2 — CRM central (008)

`008_altaria_os_crm.sql` añade únicamente tablas e índices nuevos. No altera snapshots ni filas históricas de diagnósticos, consultas o pedidos. En `altaria-os-test` se aplicaron 001–006 sobre tablas de origen vacías, sin copiar datos de producción, y después 008; 007 se conservó. El script `altaria-os-phase2-migrate.mjs` comprobó el marcador remoto, la identidad del propietario, las tablas previstas, el SHA-256 de cada migración y la integridad referencial. Ninguna de estas migraciones CRM se ha aplicado a producción.

| Tabla | Finalidad e integridad |
|---|---|
| `crm_organizations` | Ficha de empresa, sector, ubicación, web, origen y responsable local; nombres normalizados para búsqueda. Estado activo o fusionado, con referencia a la ficha destino. |
| `crm_organization_identifiers` | Identificadores fiscales, dominios y otros IDs. Sólo un identificador **verificado** puede pertenecer a una empresa a la vez; las señales no verificadas no provocan fusiones automáticas. |
| `crm_contacts` | Personas de una empresa; email único por empresa y máximo un contacto principal. |
| `crm_opportunities` y `crm_opportunity_stage_events` | Varias oportunidades por empresa. Etapa, importe opcional y versión; historial append-only con actor y fecha para cada transición, escrito en el mismo batch. |
| `crm_activities` | Llamada, visita, reunión o nota, asociada a empresa y opcionalmente a contacto y oportunidad de esa misma empresa mediante claves foráneas compuestas. |
| `crm_tasks` | Seguimientos y tareas asignadas. Puede nacer de una actividad sin repetir empresa; las referencias a actividad, contacto y oportunidad exigen la misma empresa. |
| `crm_source_links` | Vínculos uno a uno con `digital_leads`, `consultas_tarjetas` o `pedidos_tarjetas` mediante claves foráneas reales. No duplica ni modifica el registro histórico. |
| `crm_timeline_events` | Cronología append-only de operaciones comerciales, con actor y metadatos técnicos sin PII. |
| `crm_organization_merges` | Registro para una futura fusión manual autorizada. La Fase 2 no fusiona empresas de forma automática. |

Todas las escrituras CRM requieren autorización de servidor por rol y recurso, SQL parametrizado, validación previa y auditoría local en `altaria_admin_audit_events`. Los cambios compuestos usan un batch `immediate`. Las entidades de prueba serán sintéticas y se señalarán como TEST en la interfaz.

### Altaria OS Fase 1 — identidad y auditoría (007)

`007_altaria_os_identity.sql` crea tablas independientes de pedidos, Cards y diagnósticos. En `altaria-os-test` se aplica sólo después de verificar la URL fijada, la separación de secretos, la caducidad del token y el marcador remoto; `altaria_schema_migrations` conserva su SHA-256. No se ejecutan las migraciones 001–006 en TEST para esta fase.

| Tabla | Finalidad |
|---|---|
| `altaria_admin_users` | Lista cerrada de personas autorizadas. Email normalizado único, ID WorkOS único y estado `invited`, `active` o `suspended`. El login no crea usuarios automáticamente. |
| `altaria_admin_roles` | Catálogo fijo `owner`, `sales`, `production`, `viewer`; etiquetas españolas. |
| `altaria_admin_user_roles` | Asignación de roles con fecha y autor. La autorización efectiva se consulta en Turso en el servidor, no se confía en un rol del navegador. |
| `altaria_admin_audit_events` | Historial append-only de acción, resultado, actor, sesión resumida con hash y destino técnico. `details_json` debe excluir secretos y datos personales. |
| `altaria_admin_revoked_sessions` | Hash de sesiones revocadas, con caducidad. La comprobación de acceso debe rechazar sesiones listadas. |

No se insertan usuarios ni datos de negocio en la migración; únicamente las cuatro definiciones de rol. La base TEST contiene datos sintéticos o de configuración de pruebas exclusivamente. Esta migración no se ha aplicado a producción.

### `altaria_test_environment` (sólo en la base TEST independiente)

Tabla de control creada únicamente por `scripts/altaria-os-test-bootstrap.mjs` después de verificar que la nueva base `altaria-os-test` estaba vacía. Contiene una sola fila: `id = 'test'` y un marcador aleatorio hexadecimal de 32 bytes (`marker`). El lanzador de desarrollo consulta esta fila antes de iniciar Astro. Esta tabla no forma parte de las migraciones del producto y no se creará en producción. Se aplicó exclusivamente a la base remota TEST.

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
| Altaria Cards (004) | `producto_id`, `producto_nombre`, `personalizacion_json` | Identificador estable y nombre del producto congelado al crear el pedido; JSON con destino e indicaciones de preparación (PII); opcionalmente `configuracion` v2 del asistente, descrita abajo. Los pedidos anteriores reciben `resenas`, el nombre del modelo Google y `{}`. Para usos sin Google las columnas antiguas obligatorias conservan cadenas vacías, sin exigir una ficha. |

### `card_artwork` (005)

Originales de impresión subidos voluntariamente desde el modal. `token` es un ID
aleatorio (PK), **no una credencial de descarga**. `owner_hash` contiene SHA-256 del
secreto de sesión (cookie HttpOnly, SameSite=Strict, Secure en HTTPS, 24 horas).
Toda lectura, eliminación y asociación comprueba ID + propietario en el servidor.
Una sesión ajena no obtiene el archivo aunque conozca su ID o URL.

Metadatos: `filename` original, MIME detectado por decodificación, `size_bytes`,
`width`, `height` orientados según EXIF, `validation_status` (`ready|review`),
`warnings_json`, `layout_json` (encajar/recortar vista, posición), `sha256` del original
y `created_at`. Ubicación física: `card_artwork.content_base64` en Turso, original
codificado base64, no en `/public`, Vercel Blob ni disco efímero. Sin recomprimir,
deformar, ampliar o recortar los bytes originales. SQL siempre parametrizado.

PNG/JPEG/WebP estáticos, máximo 3 MiB y 40 MP como límite de decodificación segura.
CR80 85,60 × 53,98 mm, tolerancia relativa de proporción ±2 %, referencia mínima
1012 × 638 px (~300 ppp). No hay máximo de dimensiones aparte del límite de píxeles.
Otra proporción, resolución baja o recorte visual voluntario marcan `review` sin
bloquear el pedido. `ready` no sustituye la comprobación profesional previa a imprimir.

`order_id` FK a `pedidos_tarjetas.id`, `inquiry_id` FK a `consultas_tarjetas.id`,
ON DELETE RESTRICT; CHECK impide ambas asociaciones a la vez. Archivo sin asociación
es un borrador. Crear pedido/consulta y asociar archivo se realiza en una transacción
inmediata, verificando propietario y que esté libre. El JSON conserva una referencia
y metadatos canónicos del servidor. No se confía en URL, medidas o estado del cliente.
Solo pueden eliminarse desde la web borradores propios sin pedido ni consulta;
reemplazar no altera un diseño ya asociado. No hay borrado automático de expedientes.

Descarga del visitante: sesión propietaria y attachment/no-store/nosniff. No hay
listado público. Telegram recibe referencia, estado y el original adjunto al aviso de pedido pagado; nunca credenciales ni
enlace permanente. No existe panel admin autenticado ni firma temporal desplegada.
El equipo exporta el original por pedido/consulta con `scripts/export-card-artwork.mjs`
y credenciales internas Turso, comprobando SHA-256. No se envían bytes a Stripe.
005 revisada sigue **sin aplicar a TEST ni producción**; no se ha modificado ninguna
migración aplicada. Ver plan de aplicación y rollback en `docs/orders/MIGRATIONS-TEST.md`.

### `consultas_tarjetas` (004)

Solicitudes a medida separadas del pago. Columnas: `id` UUID PK; `clave_idempotencia` UNIQUE;
`huella_solicitud` SHA-256; `producto_id` (catálogo o `a-medida`); `nombre`, `contacto`,
`idea` obligatorios; `negocio`, `cantidad` opcionales; `configuracion_json` con destino, notas y opcionalmente `tarjeta` v2;
`privacidad_aceptada_en`, `creado_en` UTC; `estado` (`nueva`, `contactada`, `cerrada`).
Cantidad entre 1 y 500 cuando existe. Índice por estado y fecha.

PII: nombre, contacto, negocio, idea y configuración. Escribe
`src/lib/db/card-inquiries.repository.ts` mediante parámetros, únicamente después del envío
voluntario con consentimiento. La clave única deduplica reintentos y la huella rechaza
la reutilización con otros datos. La consulta se considera recibida solo tras recuperar
la fila persistida. No se envía a Telegram ni se registran textos o contactos en logs.
El equipo consulta estas filas en Turso; no existe aún un panel de gestión.

### Configuración guiada de tarjetas (JSON v2)

Sin cambiar el SQL de 004, `pedidos_tarjetas.personalizacion_json.configuracion` y
`consultas_tarjetas.configuracion_json.tarjeta` admiten:

- `version: 2`, `design: own | custom | existing`, `destination: link | help | create`.
- `details`: URL; negocio/localidad para ayuda; perfiles sociales opcionales;
  teléfono y mensaje de WhatsApp; nombre, empresa, teléfono, email y web de vCard;
  descripción del proyecto; colores, texto, estilo e instrucciones de diseño.
- `artwork: requested-later | not-required | uploaded`: los pedidos nuevos con diseño
  propio exigen `uploaded` y `artworkFile: {token, filename}` verificado en servidor.
  Los valores anteriores se conservan para compatibilidad histórica.
- `contactPhone`: teléfono de quien solicita (el email está en `contacto` en consultas).

Zod limita campos y longitudes; solo se envían detalles activos del asistente.
El servidor permite diseño propio o por Altaria y un destino existente o ayuda
sencilla; bloquea Checkout para creación de destino e integraciones por revisar.
El destino canónico queda congelado en `personalizacion_json.destino`; puede quedar
vacío cuando el pedido incluye ayuda para localizar el enlace existente.

Sin modificar el SQL, `personalizacion_json.tarifa` conserva un snapshot calculado
exclusivamente por el servidor: `{ version, disenoCentimos }`. El subtotal incluye
cantidad × precio unitario más diseño por pedido. El total añade envío; IVA incluido
sin recargo adicional. Stripe crea una línea de diseño de cantidad 1 desde este
snapshot, nunca desde el catálogo actual. Los pedidos anteriores sin `tarifa` no
añaden diseño y conservan todos sus importes. La tarifa Google antigua no se aplica
a nuevos pedidos. Un reintento recupera el pedido persistido sin recalcularlo.
Estas propiedades pueden contener PII. Las filas anteriores con `{}` siguen siendo
válidas. **004 no cambia respecto al primer pase y sigue sin aplicarse a producción.**

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
- `005_card_artwork.sql` añade únicamente la tabla de originales; no modifica pedidos
  ni migraciones anteriores. Aplicar después de 004 antes de habilitar subidas.
- Nunca se edita una migración aplicada; se añade `002_descripcion.sql`, etc.
- Después de cada cambio se actualiza este documento.
- `002_create_card_orders.sql` añade exclusivamente las tres tablas de pedidos y sus índices; no contiene `DROP` ni altera datos existentes.
- `003_add_card_order_stripe_environment.sql` añade `stripe_entorno` con default `test` y restricción `test/live`; no borra ni recrea tablas y clasifica como `test` los pedidos existentes.
- `004_altaria_cards_catalog_and_inquiries.sql` añade tres columnas a pedidos y la tabla de consultas. No borra ni reescribe importes, IDs de Stripe ni estados históricos. Aplicar una vez, después de 003 y antes de desplegar el código de Altaria Cards. No se ha ejecutado contra una base remota durante esta implementación.
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

## Ampliacion de subida a 3 MiB

El codigo admite 3.145.728 bytes. Requiere `006_card_artwork_3mb.sql`, aplicada en produccion el 2026-10-02 con copia previa e integridad verificada. Reconstruye card_artwork en una transaccion conservando todas sus columnas, originales, relaciones e indices; solo amplia el CHECK de size_bytes. No modifica 005. Turso ya admite 3 MiB. Falta desplegar el codigo actualizado para habilitar el nuevo limite en la web. Copia privada: review/migrations-production/006-before-1790945942264.json. La tabla tenia 0 archivos al aplicar la migracion.

## Original descargable en Telegram (2026-10-02)

El aviso de pedido pagado con artwork incluye un segundo mensaje `sendDocument`,
como respuesta al aviso, con el original sin recomprimir. Consulta interna por
`card_artwork.order_id` unido a un pedido con `pagado_en`; verifica peso y SHA-256.
No usa URL del navegador, no abre endpoints nuevos ni publica enlaces. El destino
es exclusivamente TELEGRAM_CHAT_ID del servidor. No requiere migracion.
El fichero conserva su nombre y bytes. Si el adjunto falla, se registra fallo de
notificacion sin revertir el pago. El webhook duplicado mantiene la deduplicacion
existente; no hay reintento automatico de adjuntos ni reenvio historico.
Las solicitudes de propuesta siguen sin notificacion Telegram automatica.
Validacion de envio mediante fetch simulado; no se enviaron archivos reales.

## Altaria OS, Fase 4: Cards y producción (TEST, migraciones 011–012)

`011_altaria_os_cards_production.sql` y `012_altaria_os_cards_payment_guards.sql`
están aplicadas exclusivamente a `altaria-os-test`, con hashes registrados en
`altaria_schema_migrations` y marcador remoto verificado. Este apartado describe
el esquema TEST actual; los apartados históricos anteriores documentan el estado
que tenían sus respectivas entregas. No se ha migrado producción.

- `cards_production_jobs`: una ficha por pedido, con etapa independiente del
  estado comercial y de pago de `pedidos_tarjetas`, prioridad, versión para
  concurrencia optimista y transportista/seguimiento manuales. La secuencia
  permitida es preparación → producción → verificación → listo para envío →
  enviado → entregado. No se escriben los campos de pago ni se reconstruye el
  checkout. Los triggers bloquean pedidos live, sin pago confirmado o sin el
  evento `pago_confirmado` emitido por el webhook existente.
- `cards_production_checks`: una fila inmutable por pedido y comprobación;
  guarda quién la registró, cuándo y una nota obligatoria. Preparación y diseño
  preceden a producción; impresión y programación NFC preceden a verificación;
  QR, NFC y control físico preceden a listo para envío. La aplicación exige un
  POST autenticado y CSRF por cada acción humana. No hay autocompletado físico.
- `cards_batches`: lotes inmutables con cantidad, modo y clave de idempotencia
  única. `request_hash` rechaza reutilizar la misma clave con datos distintos.
  La suma de cantidades debe igualar la del pedido antes de producir.
- `cards_units`: unidades inmutables con secuencia única por lote e identificador
  interno global único. En `shared_batch`, todas las unidades usan el código de
  lote; en `individual`, cada unidad tiene código y referencia de destino propia;
  en `identified_shared`, cada unidad tiene código y comparte referencia de
  destino con su lote. Los códigos internos no son todavía QR públicos.
- `cards_destination_refs`: relación interna preparada para asociar futuros
  destinos dinámicos. No contiene URL pública, no resuelve redirecciones y no
  crea servicio de QR. Una futura fase añadirá destinos/versiones mediante otra
  migración revisada.
- `cards_production_incidents`: incidencias menores o bloqueantes con apertura,
  resolución, actor y fecha. Una incidencia bloqueante abierta impide pasar a
  listo para envío, enviar o marcar entrega.
- `cards_production_events`: historial de producción append-only, unido al
  pedido, actor y fecha. Cada mutación sensible también genera una fila en
  `altaria_admin_audit_events`. `eventos_pedido` conserva el historial de pago
  separado. `crm_source_links.card_order_id` (008) sigue siendo la relación
  única y manual con la empresa CRM; no se duplica ni se infiere por email.

Las rutas `/admin/cards` y `/api/admin/cards/*` filtran exclusivamente
`stripe_entorno='test'`. Además de la autorización WorkOS y roles de servidor,
el servicio comprueba `ALTARIA_TEST_ISOLATED`, Stripe test y el marcador remoto
antes de leer o mutar. El original se descarga solo por owner/production, tras
verificar pago TEST, integridad SHA-256 y auditoría, como attachment sin caché.
El rol viewer puede consultar la ficha pero no descargar originales ni modificarla;
sales no accede a Cards. Las pruebas de integración insertan únicamente datos
sintéticos en una transacción TEST que se revierte por completo.
## Fase 5: enlaces dinámicos Cards (solo TEST)

La migración incremental `013_altaria_os_cards_dynamic_links.sql` añade los dominios HTTPS aprobados por pedido (`cards_redirect_domains`), un destino actual por referencia de la Fase 4 (`cards_destination_targets`) y su historial inmutable (`cards_destination_history`). Los destinos compartidos de los modos `shared_batch` e `identified_shared` siguen vinculados a la misma referencia. Cada unidad identificada dispone de sus propios códigos QR y NFC; `shared_batch` dispone de dos códigos por lote. Los códigos públicos aleatorios de 192 bits son permanentes y únicos en `cards_dynamic_links`; las pausas y retiradas conservan el código y quedan en `cards_link_status_history`. `cards_link_generation_requests` impide repetir una generación con otros parámetros.

`cards_open_events` guarda únicamente identificador de enlace, fecha UTC y clase de tráfico (`unclassified` o `suspected_bot`). No guarda IP, cookie, agente de usuario, identificador de persona ni URL de solicitud. El disparador `cards_open_rollup` incrementa `cards_link_daily_metrics` por día y clase. `cards_link_retention` establece 30 días para eventos mínimos y 400 días para agregados, configurables por propietario; la purga es una acción explícita. Las aperturas no equivalen a personas, ventas ni reseñas. Los informes se filtran por pedido, empresa CRM vinculada, lote, unidad, canal, campaña, destino y periodo.

`cards_ready_links_guard` exige antes de `ready_to_ship` un QR y un NFC activos por cada unidad (o por el lote compartido), con destino y dominio aprobados. Las siete comprobaciones físicas de la Fase 4 siguen siendo acciones humanas independientes. Los cambios de destino precisan versión, motivo y auditoría; el historial no se sobrescribe. La ruta `/c/{code}` es local TEST, responde con redirección temporal sin caché y nunca accede a pedidos live. Su límite de solicitudes es local y se deberá sustituir por protección de borde antes de aprobar una publicación pública. Los códigos de prueba contienen `127.0.0.1`, no un dominio real.

La migración append-only `014_altaria_os_cards_link_replacements.sql` permite sustituir un código retirado por uno nuevo sin resucitar el anterior. Los índices únicos parciales admiten una sola versión no retirada por unidad o lote y canal. `cards_link_replacements` enlaza ambos identificadores con motivo, actor, fecha y clave de idempotencia; su historial es inmutable. Es necesaria una nueva impresión/programación y verificación física humana antes de enviar una unidad con código sustituido.

La migración append-only `015_altaria_os_cards_link_verification.sql` añade barreras SQL: las comprobaciones humanas `qr_verified` y `nfc_verified` exigen ambos enlaces activos para cada unidad, y el paso a `shipped` vuelve a comprobarlos. El servicio replica esas validaciones antes de escribir. Una sustitución se limita a etapas previas a la verificación física; un código retirado después requiere una incidencia y una revisión operativa, nunca un marcado automático de verificación.

La migración append-only `016_altaria_os_cards_destination_analytics.sql` captura la revisión del destino en cada nueva apertura y agrega en `cards_link_destination_daily_metrics` por enlace, día, revisión y clase de tráfico. La URL histórica procede de `cards_destination_history`, que es inmutable. Los eventos anteriores a 016 siguen sumando en `cards_link_daily_metrics`, pero se etiquetan como «Destino histórico no clasificado»; no se atribuyen retrospectivamente al destino actual. La purga de retención elimina también el agregado por revisión.

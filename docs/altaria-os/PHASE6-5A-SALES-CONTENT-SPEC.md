# Altaria OS · Fase 6.5A · Auditoría y especificación

Fecha: 13/10/2026. Alcance: investigación y diseño de Sales OS y Content OS. No se ha escrito código funcional ni se han creado o aplicado migraciones.

## 1. Estado comprobado

- Repositorio local `altaria-lights-nueva`, remoto `altarialights/altaria-rebranding`; rama `feat/altaria-os`. El checkpoint local `refs/codex/checkpoints/phase5-before-phase6-20261012` apunta a `33b6c4c830318071f1200052e3677d0a908ce9b4`. El árbol ya tenía cambios de fases anteriores; se han conservado.
- `git diff --check` termina correctamente (solo avisos de normalización LF/CRLF). Turso `altaria-os-test`, Stripe test y WorkOS staging superan la comprobación de identidad. El marcador remoto TEST coincide.
- Una lectura protegida de `altaria_schema_migrations` comprobó 17 filas, nombres 001–017, SHA-256 iguales a los archivos locales y cero errores en `PRAGMA foreign_key_check`. La siguiente numeración local disponible es **018**. El comando de migraciones con `--apply-test` fue rechazado por la revisión automática al poder escribir; no se ejecutó. La comprobación anterior usó exclusivamente SELECT y PRAGMA de lectura.
- El token Turso TEST sigue vigente y vence el **15/10/2026 16:48:29 Europe/Madrid** (14:48:29 UTC). La renovación necesita autorización específica para crear una nueva credencial exclusiva de TEST. No se ha renovado ni se ha modificado `.env`.

## 2. Inventario de materiales realmente encontrados

La búsqueda se limitó al repositorio y a carpetas hermanas de `C:\Users\marti\Desktop\Altaria Lights` relacionadas con Altaria, Cards, redes sociales y De Zamorano. No se recorrieron directorios personales ajenos al proyecto ni datos de cuentas externas.

| Fuente | Evidencia comprobada | Uso propuesto y límite |
|---|---|---|
| `src/pages/servicios.astro`, `src/pages/marketing.astro`, `src/pages/tarjetas-nfc-personalizadas.astro`, `src/pages/proyectos/de-zamorano.astro` | Copy público actual de servicios, Cards y caso De Zamorano; activos optimizados en `public/media` y `public/brand` | Referencia de oferta y tono ya publicado. No convertir afirmaciones, métricas o imágenes en plantillas comerciales aprobadas sin revisión. |
| `docs/orders/ALTARIA-CARDS.md` y `docs/altaria-os/PHASE-2.md` a `PHASE6.md` | Contratos y decisiones de producto, CRM, propuestas, Cards, QR y automatizaciones | Fuente técnica del catálogo, flujos y restricciones; no son un manual comercial aprobado. |
| Carpeta hermana `redes sociales/archivos-referencia-agentes-publicar-redes` | Dos DOCX de una guía externa de Claude Code/Metricool/Higgsfield y nueve Markdown de agentes, habilidades y plantillas. `brand_voice — plantilla.md` y `brand_design — plantilla.md` contienen marcadores sin rellenar. | Referencia de proceso editorial y control de calidad. No es ALTARIA CONTENT OS implementado ni una guía de marca verificada. Su publicación automática contradice el alcance actual y queda descartada. |
| Carpeta hermana `redes sociales/assets` y `redes sociales/videos` | 35 PNG y nueve MP4 en la carpeta de redes; hay piezas con nombres de proyectos y recursos generados. `assets/guiones` está vacía. | Inventario de posibles referencias; cada activo requiere revisión de autoría, derechos, marca y versión antes de vincularse. No importar archivos en Turso. |
| Carpeta hermana `imagenes de la marca` | PNG, un PSD y `colores.txt` con cuatro colores; no se encontró documento que asigne esos colores a las tres marcas editoriales. | Referencia a contrastar con la identidad actual. No usar como guía oficial sin validación. |
| Carpetas hermanas `CARDS` y `de-zamorano` | Proyectos separados, diseños y activos; De Zamorano tiene web y documentos de marketing propios. | No copiar expedientes, personas, campañas ni configuraciones reales al TEST. Solo referencias expresamente aprobadas podrán enlazarse más adelante. |

**No localizado en este alcance:** un manual Sales OS original, guiones de ventas aprobados, biblioteca de objeciones, emails sectoriales aprobados, calendarios editoriales, guías completas para Martín Altaria/Altaria Cards/De Zamorano ni un directorio identificable como `ALTARIA MEDIA`. Esto no prueba que no existan en otra ubicación. Todo contenido nuevo deberá figurar como **propuesta pendiente de revisión**, con origen y versión, nunca como material histórico recuperado.

## 3. Funcionalidad existente reutilizable

| Capacidad actual | Reutilización prevista |
|---|---|
| WorkOS staging, MFA, usuarios por ID estable, roles `owner/sales/production/viewer`, CSRF, middleware y auditoría | Un solo acceso a `/admin`; autorización de página, API y recurso en servidor. Content necesita concesiones por marca adicionales. |
| `crm_organizations`, contactos, oportunidades con etapas, actividades `call/visit/meeting/note`, tareas, cronología y enlaces de origen | Sales OS guía el proceso existente. Registrar llamadas y visitas como actividades; seguimientos como tareas; evitar otro pipeline. |
| Propuestas, versiones inmutables, catálogo, borradores locales `crm_gmail_drafts` | Abrir propuesta desde oportunidad y preparar borradores comerciales sin enviar ni conectar Gmail. Plantillas de mensaje y su procedencia necesitarán modelo propio. |
| `os_outbox`, jobs, reglas, `os_work_items`, `os_approvals`, Inicio y Telegram simulado | Recordatorios y deduplicación; integrar Content en «Mi trabajo» con permisos por marca. No ampliar a publicación o correo automático. |
| Astro, `AdminShell`, `CrmNav`, CSS y activos actuales | Un solo panel, navegación y patrones responsive. Búsqueda global actual solo busca empresas. |

Limitaciones verificadas: `os_work_items.kind` tiene un CHECK cerrado; `listMyWork` solo categoriza CRM/Cards y oculta trabajos sin organización/pedido a usuarios no owner. `os_approvals` acepta únicamente `work_item.complete` con FK a `os_work_items`: completar una tarea no equivale a aprobar una publicación. `crm_gmail_drafts` guarda borradores locales editables, sin versiones inmutables. El catálogo de propuestas no es una biblioteca de guiones comerciales. No existen tablas ni rutas de Contenido.

## 4. Arquitectura compartida propuesta

Mantener Astro, Turso TEST y las capas de identidad, auditoría y automatizaciones. Separar los dominios `sales` y `content` en servicios y tablas propias, con enlaces explícitos al CRM y un adaptador de lectura para Inicio. Ningún cambio de estado editorial debe modificar por sí solo una oportunidad comercial, un pedido o un pago.

```text
WorkOS + roles + concesiones por marca
                 │
             AdminShell
   ┌─────────────┼─────────────┐
 CRM + Sales    Cards       Content
   │                             │
 organizaciones ← enlaces explícitos → marcas y piezas
   └──────── tareas + outbox + Mi trabajo ────────┘
             auditoría + Turso TEST
```

### Identidad y permisos

- Sales: `crm:read` para consultar guía aprobada; `crm:write` más autorización sobre la organización para actividades, tareas, borradores y propuestas. Solo owner publica o retira versiones de la biblioteca hasta definir un editor comercial.
- Content: owner administra todo; los demás usuarios solo ven o actúan en marcas asignadas. Concesiones por usuario y marca con capacidades separadas `read`, `edit`, `review`, `record_publication`. Ninguna concesión implícita por ser `viewer`, `sales` o `production`; el permiso de navegación y el permiso del recurso se comprueban en servidor. No añadir una marca publicadora «Altaria Lights».
- Cada mutación exige sesión WorkOS, origen, CSRF, validación de entrada, comprobación del marcador TEST y auditoría. Evitar PII y contenido completo en eventos técnicos, logs y avisos.

## 5. Sales OS dentro del CRM

Ruta propuesta: `/admin/crm/guia-comercial`, como pestaña de `CrmNav`. Vista con búsqueda, categorías Prospección/Email/Llamadas/Presencial/Objeciones/Ventas adicionales, sector y canal. Las fichas muestran texto aprobado, origen, versión, fecha de revisión, preguntas de diagnóstico y siguiente paso. Un borrador propuesto se distingue visualmente y no se ofrece como respuesta aprobada.

Flujo desde empresa: **contexto verificable → guía pertinente → preparación de llamada o mensaje → revisión de elegibilidad del canal → actividad CRM o borrador local → tarea de seguimiento → propuesta existente**. El usuario selecciona el texto y lo adapta; no se envía nada. Una objeción tiene respuesta respetuosa, preguntas y opciones de siguiente paso, sin promesas de resultados. Una recomendación de venta adicional requiere una necesidad anotada en la ficha.

Captación manual: campañas locales con ámbito inicial Navaluenga/Ávila, máximo 20 organizaciones por campaña, alta tras comprobación de duplicados y revisión humana antes de contacto. No hay búsqueda periódica ni importación automática. Un estado de canal `desconocido` impide sugerir envío; registrar fuente, fecha y oposición sin deducir consentimiento del mero hecho de tener email o teléfono. La interpretación jurídica de cada canal se revisará antes del uso real.

### Entidades candidatas para la migración 018

| Tabla | Claves y restricciones propuestas |
|---|---|
| `crm_sales_entries` | ID, categoría, canal, sector opcional, título, estado `proposed/approved/retired`, versión publicada y autor. Índices por estado/categoría/sector y texto normalizado para búsqueda acotada. |
| `crm_sales_entry_versions` | ID, entrada FK, número UNIQUE por entrada, contenido JSON validado por tipo, SHA-256, origen (`site_reference`, `supplied_original`, `new_proposal`), ruta/identificador de procedencia y actor/fecha. Trigger de no UPDATE/DELETE. |
| `crm_sales_entry_events` | Eventos append-only de propuesta, revisión, aprobación y retiro; actor, fecha y versión. |
| `crm_sales_draft_sources` | FK única por borrador local a `crm_gmail_drafts`, versión de plantilla y organización; el texto final del borrador sigue siendo editable y nunca se envía por esta fase. |
| `crm_prospect_campaigns` y `crm_prospect_campaign_members` | Campaña manual con zona/sector y revisor; miembro FK a organización, UNIQUE(campaña, organización), máximo 20 impuesto en transacción y trigger. Sin agenda periódica. |
| `crm_contact_channel_reviews` | Organización y contacto opcional coherentes, canal, decisión `unknown/eligible/blocked`, base/evidencia mínima, actor/fecha. Historial append-only; una oposición prevalece hasta revisión explícita. |

No duplicar `crm_organizations`, contactos, oportunidades, etapas, actividades, tareas ni propuestas. Reutilizar `crm_tasks.automation_key` para seguimientos idempotentes. Las nuevas plantillas no se importarán como aprobadas sin procedencia comprobada y revisión humana.

## 6. Content OS

Navegación principal: **Inicio · CRM · Cards · Contenido · Informes · Configuración**. Dentro de Contenido, una cabecera con selector de marca, filtros de canal y acceso a Calendario, Lista, Biblioteca y Guías. Tres marcas editoriales: Martín Altaria (Instagram, LinkedIn), Altaria Cards (Instagram) y Restaurante De Zamorano (Instagram). Son cuatro combinaciones marca/canal, sin cuenta «Altaria Lights» publicadora.

### Pantallas y flujo

1. `/admin/contenido`: resumen de pendientes reales, calendario con vistas mes/semana/lista, filtros de marca/canal, fecha objetivo y responsable. Frecuencia objetivo configurable por combinación, sin generar piezas ficticias para llenar huecos.
2. `/admin/contenido/nueva` y `/admin/contenido/[id]`: ficha progresiva con idea, objetivo, hook, guion, copy, CTA, referencias, moodboard, versiones, recursos, checklist, comentarios, revisión e historial. En móvil, una acción principal por etapa y secciones plegables, sin formulario gigante.
3. `/admin/contenido/biblioteca`: metadatos y referencias a originales, trabajo y finales, con derechos, procedencia y checksum. No almacenar binarios en Turso. Cualquier carpeta local descubierta requiere selección y autorización antes de importación.
4. `/admin/contenido/marcas`: versiones de guía de marca, ejemplos aprobados y huecos explícitos. La guía de cada marca empieza incompleta hasta validar identidad, tono, recursos y derechos.

Etapas: `idea → script → visuals → editing → review → ready`. `on_hold` es una bandera transversal con motivo y etapa conservada. Después: `scheduled → published → analyzed → archived`. `ready` no indica publicación. `scheduled` requiere registro humano de fecha y destino; `published` requiere confirmación real y evidencia (por ejemplo, URL canónica de la pieza más fecha y actor), nunca se infiere de `ready` o de una fecha pasada. En TEST las pruebas usan evidencias sintéticas claramente marcadas. Una vuelta para cambios crea una versión nueva y un evento, sin sobrescribir originales.

### Entidades candidatas para migraciones 019–020

| Tabla | Claves y restricciones propuestas |
|---|---|
| `content_brands`, `content_brand_channels`, `content_brand_memberships` | Claves estables para las tres marcas y cuatro canales; UNIQUE(marca, canal); grants por usuario/marca/capacidad. Inicialización sin cuentas sociales ni tokens. |
| `content_frequency_targets` | Marca/canal, vigencia y frecuencia objetivo configurable, con autor/fecha; no altera publicaciones existentes. |
| `content_pieces` | ID, marca/canal coherentes por FK compuesta, formato, etapa CHECK, `on_hold` y motivo, fecha objetivo, responsable, versión actual y control de concurrencia. Índices por marca/canal/fecha/etapa/responsable. |
| `content_piece_versions` | Snapshot de textos y decisiones con número UNIQUE por pieza, SHA-256, actor y fecha. Triggers de no UPDATE/DELETE; el cambio de texto crea versión. |
| `content_assets`, `content_piece_assets` | Referencia a objeto o ruta autorizada, clase `original/work/final/reference`, checksum, MIME, tamaño, autoría/derechos y estado de revisión. Enlace FK con pieza y versión cuando corresponda; no bytes ni URLs públicas permanentes. |
| `content_brand_guide_versions` | Guía por marca, versión inmutable, estado propuesto/aprobado y fuentes verificadas. |
| `content_review_requests`, `content_review_checks`, `content_comments`, `content_events` | Revisión y checklist con actor, resultado, motivo e historial append-only. `ready` solo tras checklist y revisión aprobada de la versión actual; comentarios conservan autor y fecha. |
| `content_publication_records`, `content_metrics` | Programación y confirmación separadas. Métricas con `manual/imported/calculated/unavailable`, valor nullable, unidad, fuente, fecha y actor; ausencia nunca se presenta como cero. |
| `content_crm_links`, `content_work_links` | Enlaces FK explícitos a organización/oportunidad/campaña comercial o a `os_work_items`; tipo de relación y actor. Prohibir asociaciones por coincidencia de nombre, email o estadísticas. |

De Zamorano puede enlazarse a una organización CRM solo tras selección humana; esa relación no da acceso automático a datos de clientes ni transfiere derechos de activos. Una pieza de Altaria Cards puede enlazarse a una campaña manual. Una publicación que origine una oportunidad requiere registro humano y evidencia del origen; publicación y oportunidad conservan estados independientes.

### Ficheros y adaptadores

Turso conserva metadatos, versiones, relaciones y eventos. Los originales y vídeos grandes se guardarán en almacenamiento de objetos elegido posteriormente, tras revisar precio, permisos, residencia, retención y derechos. Diseñar una interfaz de almacenamiento con IDs opacos, checksum, acceso firmado de corta duración y separación TEST/producción. No contratar ni crear servicios en 6.5A. Preparar una interfaz de adaptador de publicación/analítica sin credenciales; por ahora solo registro manual verificable. Evaluar Metricool u otras APIs oficiales antes de cualquier conexión. No conectar Higgsfield, After Effects, Instagram o LinkedIn ni gastar créditos.

## 7. Automatizaciones y aprobación

El motor de Fase 6 puede recibir eventos `sales.*` y `content.*` por outbox con deduplicación; cada regla deberá existir en `os_rule_config` mediante migración incremental. Sales sugiere acciones, crea tareas solo con contexto y clave única y prepara borradores locales, sin enviar. Content crea recordatorios de guion, grabación, revisión, bloqueo o fecha y los vincula a la pieza. El usuario decide y registra la publicación.

`os_work_items` puede usar clases genéricas existentes (`review`, `next_action`) con `source_type='content_piece'` y relación FK adicional `content_work_links`; así se preserva 017. `listMyWork`, su filtro y `completeWorkItem` necesitarán autorización por marca antes de mostrar o completar estas acciones. No usar `organization_id` de un posible enlace CRM como sustituto del permiso editorial.

El modelo actual `os_approvals` no permite una aprobación de contenido por CHECK y FK. Recomiendo **revisión editorial específica** con `content_review_requests` y el mismo patrón de auditoría, hash, caducidad y ejecución única; la interfaz de Inicio puede mostrar ambas colas. Esto conserva el historial de Fase 6 y evita reinterpretar `work_item.complete` como autorización de publicación. Esta elección requiere aprobación antes de 6.5C.

## 8. Riesgos y decisiones para aprobar antes de 6.5B/6.5C

1. **Material comercial:** aportar ubicación de guiones/emails/objeciones originales, si existen, y aprobar su procedencia. En su ausencia, redactar material nuevo como `proposed` y revisarlo pieza a pieza. El copy web no se importará como plantilla aprobada sin esa revisión.
2. **Marcas y derechos:** validar las tres guías de marca, propietarios de los activos y si De Zamorano autoriza gestionar sus contenidos desde Altaria OS. Los repositorios vecinos no implican autorización de uso editorial.
3. **Permisos editoriales:** aprobar concesiones por marca independientes de roles globales. Definir quién puede revisar y quién puede registrar una publicación real; por defecto solo owner hasta decidirlo.
4. **Aprobaciones:** aprobar revisión específica de contenido, sin modificar la semántica de `os_approvals` de Fase 6.
5. **Almacenamiento multimedia:** decidir proveedor y coste después de medir volumen y derechos. En TEST se pueden usar referencias y ficheros sintéticos sin crear servicio externo.
6. **Credencial TEST:** autorizar por separado la creación de un nuevo token Turso de corta duración y mínimo privilegio antes del 15/10/2026 a las 16:48 Europe/Madrid; no se necesita para cerrar esta auditoría.

## 9. Plan de ejecución posterior y pruebas

- **6.5B:** migración 018 propuesta, biblioteca comercial, flujo de revisión e integración contextual en CRM. Pruebas de rol/recurso, versiones, fuente, oposición, límite de 20, deduplicación y ausencia de envío.
- **6.5C:** migraciones 019–020 propuestas después de revisar 018, marcas, calendario, ficha, versiones, recursos, revisión y trabajo editorial. Pruebas de transición, aprobación, acceso cruzado entre marcas, evidencia de publicación, métricas ausentes, activos y asociaciones CRM.
- Tras cada hito: verificación de identidad TEST y marcador, tests con datos sintéticos, integración transaccional con rollback, regresión de CRM/propuestas/Cards/QR/automatizaciones/pedidos, TypeScript, build aislado, accesibilidad, responsive 360/390/768/1024/1440, escaneo de secretos y `git diff --check`.

No se inicia 6.5B, 6.5C ni MCP sin revisar y aprobar el alcance correspondiente. No hay push, despliegue, publicación social, email comercial ni cambios en producción en este hito.

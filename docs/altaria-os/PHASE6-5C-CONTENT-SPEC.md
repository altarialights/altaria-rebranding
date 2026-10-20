# Altaria OS · Fase 6.5C · Especificación final de Content OS

Fecha: 13/10/2026. **Documento de diseño; no autoriza implementar, migrar ni contratar.**

## 1. Estado verificado y límites

- Rama `feat/altaria-os`; se conservan los cambios locales anteriores. `git diff --check` termina con código 0 (avisos LF/CRLF). No hubo push ni despliegue.
- Comprobación de solo lectura: Turso `altaria-os-test` con marcador interno correcto, Stripe en modo test y WorkOS staging con indicadores Google, MFA y alta libre desactivada. Las 18 migraciones aplicadas coinciden por nombre y SHA-256 con 001–018; `PRAGMA foreign_key_check` no devuelve incidencias. No hay tablas `content_*`; **019** es el siguiente número disponible.
- El token Turso TEST caduca el **15/10/2026 14:48:29 UTC** (16:48:29 Europe/Madrid). Está vigente al verificarlo; su renovación exige autorización específica para credencial TEST. No se ha renovado.
- Fuentes leídas: [especificación 6.5A](PHASE6-5A-SALES-CONTENT-SPEC.md), [esquema](../database/SCHEMA.md), migraciones 007, 008, 017 y 018; servicios de acceso, rutas, Mi trabajo y aprobaciones. No hay tabla ni ruta Content existente.
- El acceso actual exige uno de cuatro roles globales. `viewer` también da lectura de CRM y Cards; **no sirve como rol editorial**. El ajuste de identidad propuesto en §4 permite usuario WorkOS activo con concesión editorial y sin roles globales, sin aprovisionamiento automático por email.

## 2. Producto y mapa de pantallas

Navegación principal: **Inicio · CRM · Cards · Contenido · Informes · Configuración**. Contenido será visible solo con alguna concesión editorial activa. Sus cuatro vistas persistentes serán:

| Vista | Ruta propuesta | Función principal |
|---|---|---|
| Calendario | `/admin/contenido` | Mes, semana y lista; fechas objetivo, programación y piezas publicadas diferenciadas. Filtros de marca, canal, estado y responsable; huecos explícitos, sin piezas inventadas. |
| Producción | `/admin/contenido/produccion` | Lista/kanban por etapa, prioridad, responsable, bloqueo y revisión. La ficha `/admin/contenido/piezas/[id]` es un detalle de esta vista, no un quinto módulo. |
| Biblioteca | `/admin/contenido/biblioteca` | Metadatos de originales, material de trabajo, exportaciones, referencias, derechos y vínculos a piezas. Búsqueda sin indexar binarios en Turso. |
| Marcas | `/admin/contenido/marcas` | Tres marcas, cuatro canales, guías versionadas, proyectos, frecuencia objetivo, política de revisión y miembros autorizados. |

Combinaciones permitidas al inicio: **Martín Altaria** → Instagram, LinkedIn; **Altaria Cards** → Instagram; **Restaurante De Zamorano** → Instagram. No crear una marca publicadora adicional. La activación editorial de De Zamorano depende de acreditar autorización de uso de sus activos (§10).

En escritorio: selector de marca y vistas en una sola barra, filtros persistentes y panel de detalle. En móvil: selector compacto, cuatro pestañas accesibles, filtros en panel plegable y una acción primaria por etapa. Los estados vacíos explican si faltan piezas, permisos, activos o confirmación de publicación. El calendario muestra zona `Europe/Madrid`; Turso guarda fechas UTC y la zona usada para presentarlas.

## 3. Flujos UX

1. **Planificar:** elegir marca/canal permitido → crear idea con objetivo y fecha opcionales → responsable editorial autorizado → aparecer en Calendario y Producción. Frecuencia objetivo configura un aviso de hueco, no crea piezas.
2. **Producir:** IDEA → GUION → VISUALES → EDICIÓN → REVISIÓN → LISTA. La ficha guía cada etapa con campos concretos, checklist, archivos vinculados, comentarios y próxima acción. Retroceder para cambios crea versión nueva. `EN ESPERA` es una bandera transversal con motivo, actor, fecha y etapa conservada; reanudar restaura esa etapa.
3. **Revisar:** la política efectiva se toma de proyecto, o de marca si el proyecto no la sobrescribe, y se congela en la solicitud. Modo sencillo: una aprobación de la pieza final. Modo por etapas: aprobación de GUION, VISUALES y PIEZA FINAL. El revisor ve exactamente la versión y hashes de archivos que aprueba. Rechazo deja motivo y devuelve a la etapa adecuada. Solo la versión final con verificaciones vigentes alcanza LISTA.
4. **Publicar:** LISTA → PROGRAMADA por fecha/canal y acción humana; no hay publicador automático. Una fecha pasada nunca causa PUBLICADA. Registrar evidencia verificable de una publicación real permite PUBLICADA; tras registrar métricas o su ausencia motivada pasa a ANALIZADA; ARCHIVADA requiere acción humana. La publicación mantiene su propia revisión de la pieza y nunca modifica CRM o pedidos por sí sola.
5. **Colaborar:** editor crea/corrige; revisor asignado aprueba; persona con permiso de registro documenta programación y evidencia; Inicio muestra trabajo editorial autorizado. El equipo puede colaborar en las tres marcas solo tras concederles las tres pertenencias, sin acceso comercial o financiero implícito.
6. **Vincular CRM:** enlace explícito y humano de pieza/campaña a una organización u oportunidad existente. La ficha editorial muestra solo contexto mínimo autorizado; si un editor no tiene `crm:read`, ve identificador/etiqueta editorial previamente aprobada, no la ficha CRM ni contactos. El usuario CRM ve el enlace solo si posee `crm:read` y permiso de recurso. Ningún emparejamiento por nombre o email.

## 4. Matriz de permisos y acceso

Las capacidades **por marca** son `read`, `edit`, `review`, `record_publication` y `manage_brand`. Son concesiones explícitas, auditables y revocables para un `altaria_admin_users.id` ya vinculado a identidad WorkOS estable y verificada. `manage_brand` permite políticas, guías, proyectos y membresías; por defecto solo owner. `owner` mantiene control global, pero todas sus acciones editoriales quedan auditadas. Un revisor no aprueba su propia solicitud ni una versión alterada después de pedir revisión; owner también necesita segunda revisión para piezas propias si la política exige separación de funciones, o una excepción registrada antes del cierre.

| Acción | Owner | Lectura | Edición | Revisión | Registro publicación | Gestión marca |
|---|---:|---:|---:|---:|---:|---:|
| Consultar marca y activos autorizados | Sí | Sí | Sí | Sí | Sí | Sí |
| Crear/editar pieza, versión y vínculo de activo | Sí | No | Sí | No | No | Sí |
| Solicitar revisión | Sí | No | Sí | No | No | Sí |
| Aprobar/rechazar versión asignada | Sí* | No | No | Sí* | No | Sí* |
| Registrar programación y evidencia | Sí | No | No | No | Sí | Sí |
| Cambiar guía, política, proyecto o miembros | Sí | No | No | No | No | Sí |
| Ver CRM, Cards, pagos, usuarios o configuración | Según rol global | No | No | No | No | No |

\* Con comprobación de asignación, versión y separación de funciones. Una misma persona puede acumular capacidades si se le conceden expresamente. Todas las consultas y acciones sobre pieza, proyecto, archivo, revisión, trabajo, API y URL firmada verifican marca y capacidad **en servidor**.

Cambio técnico necesario: ampliar `AdminPrincipal` con pertenencias editoriales activas leídas de Turso. Permitir entrar a usuarios activos, vinculados por ID WorkOS, con pertenencia editorial y **cero** roles globales; `/admin` y la navegación mostrarán solo trabajo de sus marcas. La puerta de `/admin/contenido/*` exige acceso editorial general y cada servicio vuelve a comprobar la marca. `viewer`, `sales` y `production` no obtienen acceso editorial por su nombre de rol. Suspensión, revocación o pérdida de membresía surten efecto en la siguiente petición. Mutaciones con origen/CSRF y auditoría existentes.

## 5. Esquema propuesto: migraciones append-only 019 y 020

**No se crean ni aplican en este hito.** Antes de implementarlas: volver a leer `docs/database/SCHEMA.md`, 007/008/017/018 y verificar hashes/marcador; después actualizar SCHEMA sin editar migraciones aplicadas. SQL parametrizado y FKs activas. IDs UUID, timestamps UTC, índices por marca/fecha/estado y unicidad de claves de idempotencia.

### 019 · Núcleo editorial

| Tabla | Campos y restricciones esenciales |
|---|---|
| `content_brands`, `content_brand_channels` | Claves estables para tres marcas y cuatro pares autorizados; canal FK compuesto por marca, unicidad y estado `planned/active/paused`. No tokens sociales. |
| `content_brand_memberships` | FK usuario/marca, capacidades booleanas o filas de capacidad, concedente, fecha y revocación; UNIQUE activo por usuario/marca. Ningún rol global se modifica. |
| `content_projects` | FK a marca, nombre, revisión opcional que sobrescribe la política de marca, estado y responsable. No duplica empresa CRM. |
| `content_review_policies` | Versión por marca o proyecto, modo `simple/staged`, etapas requeridas y vigencia; cambios futuros no reinterpretan rondas antiguas. |
| `content_frequency_targets` | Marca/canal, periodo, objetivo, vigencia y autor; nunca genera publicaciones o métricas ficticias. |
| `content_pieces` | Marca + canal coherentes, proyecto opcional de la misma marca, formato, etapa editorial CHECK, estado posterior separado, `on_hold`/motivo, fecha objetivo, responsable, versión actual y contador de concurrencia. Invariantes: `on_hold` exige motivo; `ready` exige revisión vigente; `published` exige confirmación vinculada. |
| `content_piece_versions` | Snapshot inmutable de idea, objetivo, hook, guion, copy, CTA, referencias, decisiones de formato y manifiesto de assets; `UNIQUE(piece_id,version)`, SHA-256, autor, fecha y procedencia. Triggers prohíben UPDATE/DELETE. |
| `content_events`, `content_comments` | Eventos de etapa, pausa, reasignación y decisión; comentarios append-only con actor/fecha. Metadatos técnicos mínimos en auditoría, sin cuerpos ni URLs firmadas. |
| `content_brand_guide_versions` | Guía inmutable por marca, versión, fuente, estado borrador/revisión/aprobado y aprobador. Empieza incompleta; no promover plantillas externas a guía oficial. |

### 020 · Recursos, revisión, publicación e integración

| Tabla | Campos y restricciones esenciales |
|---|---|
| `content_assets`, `content_piece_assets` | Asset de marca, clase `original/work/final/reference`, entorno TEST/producción, proveedor, bucket lógico y clave opaca, tamaño, MIME comprobado, SHA-256 del byte stream, derechos/procedencia, estado `pending/verified/quarantined`; FK de unión a pieza y versión. Sin binarios ni URL firmadas en Turso. Clave de objeto inmutable y única. |
| `content_review_requests`, `content_review_decisions` | Ronda por pieza y versión, política congelada, etapa `script/visuals/final`, manifiesto de hashes, estado, revisor asignado, vencimiento opcional y clave idempotente. Decisiones append-only; única ronda activa por pieza/etapa/versión. Rechazo incluye motivo. |
| `content_publication_records` | Pieza, marca/canal, programación y confirmación separadas. La confirmación exige URL canónica o ID de plataforma verificable, fecha, actor, método/evidencia y revisor; UNIQUE de ID/permalink por canal para evitar duplicados. En TEST solo evidencia sintética marcada; nunca se representa como publicación real. |
| `content_metrics` | Publicación FK, métrica/valor/unidad, ventana, fuente `manual/imported/calculated/unavailable`, captura/actor y versión. `NULL` significa sin dato; cero significa cero observado. No scrapeo ni conexión social en 6.5C. |
| `content_crm_links`, `content_work_links` | FKs explícitas a organización/oportunidad coherentes y a `os_work_items`; tipo de relación, actor/fecha y unicidad. El vínculo no hereda permisos. |
| `os_rule_config` + disparadores `content.*` | Nuevas reglas nombradas e inserciones outbox idempotentes para revisión, bloqueo y fecha. No cambiar la semántica de 017 ni enviar notificaciones reales. |

Si el tamaño de 020 dificulta una transacción migratoria revisable, dividirlo en 020–021 **antes** de aplicar cualquiera. La numeración siguiente se vuelve a comprobar entonces; los nombres aquí son propuesta.

## 6. Revisión, versiones y publicación verificable

- Cada guardado de texto crea un snapshot nuevo; cada asset tiene clave y checksum inmutables. El estado actual apunta a una versión, pero no modifica versiones previas. Concurrencia optimista por versión esperada; conflicto 409 invita a recargar/comparar.
- Al solicitar revisión se congela política, versión, manifiesto de assets y hash. En modo por etapas, la aprobación de guion cubre texto/guion; la de visuales cubre manifiesto visual; la final cubre exportación, copy, CTA y destino. Un cambio relevante invalida esa aprobación y las posteriores. No permitir aprobar la propia solicitud sin excepción auditada.
- `os_approvals` solo admite `work_item.complete` y referencia `os_work_items`. Las decisiones editoriales viven en `content_review_*` y aparecen en la bandeja de aprobaciones existente mediante adaptador de lectura; nunca se reinterpretará completar un trabajo como aprobar una pieza.
- `LISTA` significa lista para publicar. `PROGRAMADA` requiere canal y fecha registrados por persona autorizada, sin envío. `PUBLICADA` requiere una persona autorizada que verifique un permalink/ID real en la plataforma, registre hora, evidencia y método; una segunda comprobación se exige cuando la política de marca lo indique. Un permalink pegado sin verificación queda **pendiente de confirmación**. Sin API social, la comprobación es humana y auditable, por lo que la interfaz no afirmará verificación automática. En TEST, un valor sintético jamás activará una indicación de publicación real. `ANALIZADA` admite métricas ausentes con motivo. `ARCHIVADA` preserva historial.

## 7. Multimedia privada y adaptador

Turso guarda solo metadatos. El adaptador `ContentStorage` recibe marca, entorno, ID de asset y política; ofrece `beginUpload`, `completeUpload`, `head`, `authorizeRead`, `abortUpload` y `deleteAfterRetention`. Implementación de prueba local con bytes sintéticos y límite estricto; proveedor cloud se conecta solo tras autorización. El contrato usa claves opacas y no filtra SDK, bucket ni URL al modelo de dominio. Separación física TEST/producción, credenciales por bucket/entorno de mínimo privilegio.

Flujo futuro: sesión/editor/marca autorizados → reserva de asset y clave aleatoria no reutilizable → carga directa multipart al bucket privado con permiso temporal → `HEAD`, tamaño, tipo real y SHA-256 confirmados en servidor → cuarentena hasta revisión de derechos/seguridad → asociación a versión. Descarga tras autorización de marca mediante URL de vida corta o proxy controlado. URL firmada es un portador de acceso: no guardarla en Turso, logs ni referers; no asumir que se revoca antes de expirar. Para originales grandes, límites y cancelación de multipart; retención/versiones y borrado auditado. No usar `public/media`, base64 en Turso ni disco efímero de Vercel para los vídeos.

| Opción | Encaje con vídeo privado y originales | Precio público orientativo y cautelas |
|---|---|---|
| **Cloudflare R2 Standard (recomendación provisional)** | S3 compatible, bucket privado por entorno, URL firmada corta, multipart reanudable hasta 5 TiB; acceso directo reduce paso por Vercel. CORS y privilegios se configuran por entorno. | 10 GB-mes, 1 M operaciones A y 10 M B incluidos al mes; después **USD 0,015/GB-mes**, 4,50/M A, 0,36/M B; egreso R2 sin cargo. Requiere activar suscripción R2 aunque el uso quede en el tramo gratuito; puede generar cargos por exceso. [Precio](https://developers.cloudflare.com/r2/pricing/), [multipart](https://developers.cloudflare.com/r2/objects/upload-objects/), [URL firmadas](https://developers.cloudflare.com/r2/api/s3/presigned-urls/). |
| **Vercel Blob privado** | Integración simple con Vercel y multipart. El almacenamiento privado figura como beta; entrega privada pasa por Function y el proveedor desaconseja servir archivos privados >100 MB salvo tráfico bajo. El callback de carga cliente no alcanza localhost sin túnel. | Tabla Hobby: 1 GB-mes, 2.000 operaciones avanzadas y 10 GB de transferencia Blob incluidos; exceso Pro orientativo **USD 0,023/GB-mes**, 5/M operaciones avanzadas y 0,05/GB transferencia Blob, más transferencia/ejecución de Function para privados. Hobby corta acceso al superar cuotas. [Precio](https://vercel.com/docs/vercel-blob/usage-and-pricing), [privado](https://vercel.com/docs/vercel-blob/private-storage), [local](https://vercel.com/docs/vercel-blob/client-upload). |
| **Amazon S3 Standard (referencia S3 compatible)** | IAM, bloqueo público, región elegible, cifrado y multipart maduros; máxima flexibilidad, más configuración y vigilancia de costes. URL firmadas también son reutilizables hasta caducar; claves nuevas evitan sobreescritura. | Factura por región, GB-mes, solicitudes y transferencia. Referencia publicada para US East: aprox. **USD 0,023/GB-mes** y 0,005/1.000 PUT; el precio de región UE y tráfico a Vercel debe cotizarse antes de elegir. AWS incluye 100 GB/mes de salida a Internet agregada entre servicios, sujeto a condiciones. [Precios](https://aws.amazon.com/s3/pricing/), [URL firmadas](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html). |

Escenario ilustrativo de **100 GB-mes almacenados, 200 GB descargados, 1.000 cargas y 10.000 lecturas**, sin transformación, Function, impuestos ni duplicación de versiones: R2 Standard ≈ **USD 1,35/mes** por almacenamiento tras 10 GB incluidos y operaciones dentro del tramo gratuito; Vercel Blob ≈ **USD 12,30/mes antes de cualquier cuota incluida** (100 × 0,023 + 200 × 0,05), **más** costes de entrega privada/Function; S3 requiere región y tarifa de egreso concreta, por lo que no se da total comparable. Son inferencias de tarifas públicas, no presupuestos ni costes observados en una cuenta. Antes de contratar medir GB de originales, exportaciones retenidas, lecturas y residencia/derechos. No se creó ningún bucket ni se activó facturación.

## 8. Integración con Altaria OS

- **Identidad:** WorkOS y `altaria_admin_users` por ID estable; concesiones editoriales independientes. Auditoría existente para acción/resultado/actor; eventos Content detallan versión y motivo sin secretos.
- **Mi trabajo:** reutilizar `os_work_items` con `kind=review/next_action`, `source_type=content_piece` y enlace FK. `listMyWork` debe hacer join con marca y filtrar por membresía; nunca inferir permiso de `organization_id`. `completeWorkItem` y `accessibleWork` deben rechazar por defecto las fuentes Content y delegar a servicio editorial con validación por marca. Categoría Content en la bandeja y resumen, sin segunda lista de tareas. `crm_tasks` queda para tareas comerciales ligadas a empresa; un trabajo editorial independiente usa el motor OS.
- **Aprobaciones:** cola editorial en Inicio junto a la actual, con presentación y servicio propios. Las aprobaciones actuales de `work_item.complete` permanecen intactas.
- **Automatizaciones:** `os_outbox` y `os_rule_config` generan recordatorios idempotentes; un cambio de versión/etapa cancela sugerencias obsoletas. El resumen diario usa el mismo snapshot y solo cuentas de marcas accesibles. Adaptador Telegram sigue simulado y no contiene contenido sensible.
- **CRM:** enlaces explícitos con selección humana y FK; no trasladar datos de contacto al contenido ni cambiar etapas comerciales por métricas sociales.

## 9. Implementación propuesta y pruebas

1. Tras aprobación: nuevo control de permisos editorial y pruebas de usuario con **cero roles globales**, filtrado por tres marcas, revocación y accesos API/asset.
2. Migración 019 + SCHEMA: marcas/canales, miembros, proyectos, políticas, piezas y versiones. Semilla de **configuración** de tres marcas/cuatro canales, sin publicaciones, cuentas sociales ni guías ficticias. Aplicar solo en TEST con marcador, hashes y FK verificados.
3. Cuatro vistas Astro, ficha progresiva, calendario y flujos de etapa/pausa, historial, accesibilidad y responsive 360/390/768/1024/1440.
4. Migración 020 + SCHEMA: assets como metadatos, revisión y publicación, enlaces CRM/trabajo, reglas outbox. Adaptador de almacenamiento **simulado local**; el proveedor real queda pendiente de aprobación. Probar concurrencia, revisión simple/por etapas, invalidación por cambio, separación autor/revisor, evidencia y métricas ausentes.
5. Integrar Inicio, aprobaciones y automatizaciones con controles de marca. Probar deduplicación, reintentos, cancelación por cambios y ausencia de envíos/publicaciones.
6. Pruebas sintéticas con rollback en Turso TEST: permisos cruzados, aislamiento, migraciones y checksum; regresión CRM, Sales, propuestas, Cards, QR, pedidos y checkout; TypeScript/build aislado, WCAG y teclado, contraste, desbordamientos, escaneo de secretos y `git diff --check`.

## 10. Dependencias, riesgos y decisiones posteriores

1. **Aprobar esta especificación** antes de código o migraciones. Esta entrega se detiene aquí.
2. Autorizar renovación de token Turso TEST por separado antes de su vencimiento si se va a programar después del 15/10/2026.
3. Elegir y autorizar proveedor, suscripción/bucket TEST, límite de gasto y credencial acotada antes de cualquier almacenamiento cloud. R2 es recomendación provisional, no selección ejecutada.
4. Validar derechos de uso y responsables de las guías/activos de las tres marcas, especialmente De Zamorano. Los archivos hallados en carpetas vecinas no se importan ni se presumen autorizados.
5. Definir personas concretas para revisar y registrar publicaciones. Hasta entonces, solo owner puede gestionar miembros/políticas y no se aprovisiona a nadie.
6. Sin conexión Instagram, LinkedIn, generadores, Gmail, Telegram real ni MCP. La verificación manual de publicaciones tiene el límite explícito de que no equivale a confirmación automática de plataforma.

**Producción permanece intacta respecto a las acciones de esta especificación.**

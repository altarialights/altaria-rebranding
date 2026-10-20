# Altaria OS · Fase 6 · Automatizaciones en TEST

## Aislamiento y checkpoint

Trabajo local en `feat/altaria-os`. Antes de escribir se verificaron `git diff --check`,
escaneo de secretos, Turso `altaria-os-test` con marcador remoto, Stripe test,
WorkOS staging y hashes de migraciones 001–016. El token Turso TEST vence el
**15/10/2026 14:48 UTC** y estaba vigente el 12/10. Se creó el ref Git local
`refs/codex/checkpoints/phase5-before-phase6-20261012` en el commit
`33b6c4c830318071f1200052e3677d0a908ce9b4`, con índice alternativo: no
cambió el HEAD, el staging ni archivos del usuario. Se excluyeron capturas
temporales `.playwright-mcp/` y secretos ignorados. No hubo push ni despliegue.

Para renovar el token después, solicitar autorización para **crear sólo un nuevo
token de `altaria-os-test`**, de corta duración y privilegios mínimos, en la cuenta
Turso verificada. Actualizar únicamente `.env.test` ignorado por Git y repetir
`altaria-os-test-inspect.mjs` y `altaria-os-phase6-migrate.mjs --apply-test`.
No modificar `.env`, tokens live ni otras bases. No se renovó en esta fase.

## Revisión de QR de Fase 5

La URL canónica de impresión permanece `null`; la URL local TEST se calcula por
separado. La ficha solo muestra un QR de vista previa con la banda visible
«SOLO TEST · NO IMPRIMIR». Los endpoints de SVG/PNG descargable y manifiesto
responden `409` mientras no exista una URL canónica pública aprobada. Ningún
QR con `127.0.0.1` se ofrece como material comercial. No se configuró dominio.

La ruta `/c/{code}` continúa local y `302` temporal. La comprobación de host,
Stripe test y variables se realiza en proceso; la consulta única a Turso une el
código con el **marcador remoto TEST** y el pedido test. Si falla cualquiera,
responde `404`. Registrar aperturas ya no añade una espera fija de 180 ms a la
redirección. En local esa escritura es de mejor esfuerzo: una caída del proceso
puede perderla y se necesitará ingestión durable antes de uso público.

Benchmark desde este equipo, pedido sintético, 40 solicitudes secuenciales y
30 con concurrencia 5 (no sigue el destino externo): p95 secuencial pasó de
**286,2 a 206,8 ms** y concurrente de **1.459,2 a 872,2 ms** al unir la
comprobación del marcador con la búsqueda. El ensayo anterior a Fase 6 dio
281,3 ms y 1.196,9 ms, respectivamente. La diferencia se explica en parte por
un viaje remoto menos; la red Turso, el servidor de desarrollo y escrituras
concurrentes siguen influyendo. No extrapolar estas cifras a producción.

Las aperturas mínimas se agregan por triggers 013/016 al insertar el evento;
el trabajador Fase 6 consume eventos comerciales de outbox, **no** las aperturas
individuales. La purga de `cards_open_events` y agregados sigue disponible sólo
como acción manual autorizada, con retención configurada. Antes de publicar se
requiere cola durable de analítica, purga programada, límite distribuido,
alertas y medición en infraestructura equivalente.

## Motor y reglas

La migración append-only 017 añade `os_outbox`, `os_jobs`, intentos, reglas,
trabajo, notificaciones simuladas, resumen diario y aprobaciones. Está aplicada
únicamente en `altaria-os-test`, con hash y marcador verificados. Los triggers
insertan outbox en la transacción de origen. El trabajador local despierta cada
minuto, reclama un job mediante lease de 90 s, ejecuta efectos idempotentes,
registra el intento y reintenta con backoff entre 30 s y 6 h. Un lease caducado
puede recuperarse; claves únicas en jobs, tareas, elementos de trabajo y avisos
evitan repetir efectos. Una regla pausada conserva su cola. La vista de
Configuración muestra estado, errores e historial y permite procesar o
reintentar manualmente. El endpoint interno exige secreto efímero de proceso,
origen loopback, TEST y marcador; no se habilitó Cron en Vercel.

Reglas iniciales:

| Evento verificado | Acción automática en TEST |
|---|---|
| Lead digital vinculado a empresa | Tarea CRM de revisión única por vínculo. No asigna leads ambiguos. |
| Llamada sin seguimiento abierto | Sugerencia de siguiente acción. |
| Tarea vencida | Prioridad urgente en Inicio, sin duplicar la tarea. |
| Oportunidad ganada | Sugerencia de próximos pasos. |
| Oportunidad perdida | Conserva el motivo registrado por CRM y cancela seguimientos abiertos vinculados. |
| Propuesta enviada | Mantiene el seguimiento creado por Fase 3 y prepara aviso simulado. |
| Cambios pedidos | Sugerencia de revisión y aviso simulado; Fase 3 cancela seguimiento obsoleto. |
| Propuesta caducada | Sugiere revisión; no inventa respuesta ni marca venta. |
| Pago Stripe test confirmado | Trabajo para preparar el pedido y aviso simulado; no altera pago. |
| Incidencia Cards abierta | Acción prioritaria y aviso simulado según severidad. |
| Enlace pausado/retirado | Alerta y aviso simulado. |
| Entrega registrada por persona | Sugerencia de posventa a siete días, sin correo. |

El trabajador cierra acciones obsoletas cuando empieza producción, se resuelve
una incidencia o se reactiva un enlace. Las verificaciones de QR/NFC/estado
físico siguen siendo humanas y los triggers de Fase 4/5 bloquean envíos
incompletos. Gmail permanece desconectado; no se procesan respuestas Gmail.

## Mi trabajo, resumen y aprobaciones

`/admin` agrupa tareas CRM, propuestas sin seguimiento, pedidos TEST pendientes,
incidencias, acciones automáticas y aprobaciones. Filtra y ordena por urgencia
o fecha, abre la ficha de origen y permite completar solo con el permiso de
servidor correspondiente. Evita mostrar una incidencia o pedido dos veces
cuando la regla ya creó su acción. Roles sales ven sus empresas; producción
ve Cards; owner puede revisar todo; viewer no puede mutar.

El resumen usa `listMyWork` para el snapshot de Inicio y Telegram simulado.
La fecha de unicidad se calcula con `Europe/Madrid`. El propietario configuró
provisionalmente las **08:30**, modificables desde Configuración. Una PK por día
evita duplicados. El 13/10/2026 se verificó en Turso TEST un único resumen y
un único aviso simulado del día, con los mismos recuentos que muestra Inicio.
Se genera sin IA y a partir de registros reales del entorno TEST, sin
estadísticas inventadas.

El adaptador Telegram **solo simula** entrega. No hay bot, chat, token ni
solicitud de red. El aviso diario toma los mismos recuentos del snapshot que
se muestra en Inicio, sin nombres de clientes. Las demás plantillas son
genéricas y no incorporan PII. La cola registra
reintentos, errores y resultados. Activación real requiere autorización
separada y revisión de plantilla/destinatario.

Las aprobaciones implementan por ahora la acción permitida
`work_item.complete`. Guardan solicitante, acción, recurso, JSON exacto,
SHA-256, versión de contenido, caducidad, revisor, ejecución única y resultado.
Se rechaza ejecutar si cambia el contenido o ya se ejecutó. Queda preparado
un contrato restringido para futuras herramientas MCP, pero no existe aún
conector ChatGPT ni una acción arbitraria.

## Seguridad, retención y pendientes

Las APIs mutables exigen sesión WorkOS, rol de servidor, origen y CSRF. Cada
acción sensible se audita; los intentos y eventos de aprobación son inmutables.
Datos sintéticos de integración se insertan en una transacción que se revierte.
No se enviaron correos ni avisos reales. No se creó ningún servicio ni coste
adicional. Producción y `.env` live no fueron tocadas por estas acciones.

Retención recomendada, aún **no activada**: outbox y auditoría 400 días,
intentos 90, resultados Telegram simulados 30. No purgar eventos pendientes,
fallidos ni material de aprobación hasta definir política y prueba de
recuperación. Antes de producción se necesita cron con autenticación de
máquina revisada, monitoreo, límites de concurrencia entre instancias y una
cola durable para aperturas QR. No se activó Telegram real, Gmail ni MCP.

## Verificación visual autenticada

El propietario completó Google Sign-In y MFA en WorkOS staging y confirmó que
ve «Mi trabajo». Con esa sesión real se revisaron `/admin` y
`/admin/configuracion` a **360, 390, 768, 1024 y 1440 px**. Las capturas están
en `review/altaria-os/phase6/` (directorio local ignorado por Git). No hubo
desbordamiento horizontal. Se comprobaron navegación, filtro, orden, búsqueda,
estados vacíos, historial, alertas y acciones de configuración.

La revisión detectó y corrigió el cierre inaccesible del menú móvil: ahora
tiene botón visible, responde a Escape y actualiza `aria-expanded`. También se
retiró el rótulo «En preparación» de Configuración, se muestra la hora efectiva
del resumen, se tradujeron estados del historial y se sustituyó el botón de
generar resumen cuando el del día ya existe. Se ajustaron colores secundarios
para contraste. La auditoría axe-core de WCAG 2 A/AA y 2.1 A/AA en Inicio y
Configuración, móvil y escritorio, no registró infracciones tras los ajustes.

El token Turso TEST seguía vigente el 13/10/2026 y vence el
**15/10/2026 14:48:29 UTC**. No se renovó: la renovación crea una credencial
externa y necesita autorización específica. El procedimiento seguro figura en
«Aislamiento y checkpoint».

## Cierre de pruebas (13/10/2026)

- Suite local: 22 archivos y 304 tests correctos. Integración Fase 6: 1 test
  transaccional con reversión y datos sintéticos. Regresiones CRM, propuestas,
  Cards y QR: correctas, también con reversión.
- Astro/TypeScript: 0 errores y 0 avisos; 40 sugerencias ya presentes en el
  repositorio. `build:isolated`: correcto, sin despliegue.
- QA de acceso local: login móvil y escritorio, cierre de rutas privadas sin
  sesión y rutas públicas accesibles. axe-core: 0 infracciones WCAG 2/2.1 A/AA
  en las dos pantallas autenticadas y cinco anchos.
- `git diff --check`: correcto. Escaneo de archivos Git y build: sin secretos
  locales detectados. La rama sigue siendo `feat/altaria-os`; el checkpoint
  conserva el hash indicado arriba. Los cambios de trabajo existentes no se
  descartaron ni publicaron.

Esta verificación cubre TEST local. Para operación pública siguen pendientes
los requisitos de cron, observabilidad, cola durable y autorización expresa
de Telegram real descritos en este documento.

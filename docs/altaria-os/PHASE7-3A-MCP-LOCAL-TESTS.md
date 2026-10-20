# Fase 7.3A Pruebas locales de MCP

Verificación del 15 de octubre de 2026 en `feat/altaria-os`. Las 25 herramientas de lectura y las 8 de preparación se ejecutan mediante JSON-RPC contra el manejador MCP local, con datos sintéticos en Turso `altaria-os-test`. No se ha conectado ChatGPT ni activado OAuth Connect, CIMD, un túnel o facturación.

## Aislamiento y datos sintéticos

El control previo verifica URL TEST fijada y distinta de producción, token distinto y vigente, marcador remoto, las 22 migraciones consecutivas 001–022 y sus hashes SHA-256, claves foráneas, configuración Stripe test, credenciales WorkOS staging y callback loopback. MCP permanece desactivado y hay cero concesiones persistentes activas. Stripe y WorkOS se comprueban por configuración local; esta fase no llama a sus API ni vuelve a inspeccionar sus paneles.

El token Turso TEST vence el **20 de octubre de 2026 a las 12:03:13 UTC**, **14:03:13 en Madrid**. No se renueva ni se genera ninguna clave.

`tests/mcp-synthetic-fixture.ts` prepara estos registros dentro de una transacción que siempre se revierte:

- Seis identidades locales ficticias: propietario, comercial, producción, lector, editor y usuario sin permisos. Los sujetos WorkOS son cadenas sintéticas; no son usuarios creados en WorkOS.
- Empresa propia y empresa ajena, un contacto principal y 22 contactos para paginación, oportunidad y tarea vencida.
- Propuesta en borrador pendiente de revisión, guion comercial aprobado, objeción aprobada y candidato sin aprobar.
- Pedido Cards TEST, evento sintético de pago, producción en preparación, lote, tarjeta, destino `example.test`, incidencia y exactamente siete aperturas sintéticas. Otro pedido con fecha de pago pero sin evento comprueba el rechazo de una falsa confirmación.
- Pieza Altaria Cards con fecha editorial del 15 de octubre; otra con fecha editorial del 22 y publicación programada para el 16. Se añade una revisión pendiente, una guía aprobada TEST y un recurso privado ficticio.
- Texto de prompt injection en tarea CRM, guion editorial, actividad y borrador de correo.

Los registros usan prefijos TEST, identificadores de ejecución únicos y correos `example.test`. No se copia información de producción. Las lecturas agregadas pueden incluir otros registros ya existentes en TEST; solo se crean o alteran filas sintéticas, salvo una nueva versión sintética de guía de marca, igualmente revertida.

La limpieza es el **rollback obligatorio de toda la transacción**, incluso cuando falla una aserción. No existe modo de confirmar el seed. Se comparan los recuentos de 43 tablas antes y después, sin borrar registros por prefijo ni desactivar triggers. Las aprobaciones, auditoría y concesiones sintéticas también se revierten; los resultados quedan en archivos locales sin credenciales.

## Resultados de las herramientas

Las siguientes comprobaciones pasan en la integración local. El inventario exacto y la fecha de ejecución quedan en `review/altaria-os/phase73a-mcp-results.json`.

| Herramienta | Resultado comprobado |
| --- | --- |
| `crm_search_companies` | Empresas autorizadas, búsqueda vacía y final de página correcto |
| `crm_get_company` | Empresa propia, campos mínimos y rechazo de empresa ajena o inexistente |
| `crm_list_contacts` | Dos páginas de 20 y 3 contactos, sin duplicados |
| `crm_list_opportunities` | Oportunidad sintética vinculada a la empresa |
| `crm_followups_needed` | Oportunidad con tarea vencida y motivo `due_task` |
| `crm_list_pending_proposals` | Propuesta pendiente distinguida como `draft_for_review` |
| `crm_list_tasks` | Tarea pendiente; texto malicioso conservado como dato |
| `crm_list_timeline` | Eventos de la empresa, sin detalles privados |
| `sales_find_approved` | Solo versión aprobada; cambios pendientes no alteran la búsqueda |
| `sales_find_objections` | Categoría de la versión aprobada |
| `sales_get_template` | Texto aprobado exacto; candidato pendiente rechazado |
| `sales_suggest_materials` | Sector aprobado y páginas distintas con `nextOffset` correcto |
| `cards_list_orders` | Pedido TEST, estado de producción y rechazo de estado inventado |
| `cards_needing_production` | Pedido con pago confirmado; excluye fecha sin evento de pago |
| `cards_get_production` | Preparación y confirmación de pago basada en fecha, estado y evento |
| `cards_list_batches` | Lote y cantidad sin códigos privados |
| `cards_list_incidents` | Incidencia sintética menor |
| `cards_aggregate_stats` | Estadísticas y aperturas; el fixture añade exactamente siete |
| `content_list_brands` | Marcas visibles según permisos |
| `content_calendar` | Fecha editorial y programación en semanas distintas, `Europe/Madrid` |
| `content_get_piece` | Guion y metadatos mínimos; sin clave privada ni descarga de original |
| `content_list_states` | Estados editoriales de Altaria Cards |
| `content_list_tasks` | Tarea editorial pendiente |
| `content_list_approvals` | Revisión pendiente de la pieza sintética |
| `content_get_approved_guide` | Guía aprobada con comprobación de integridad |
| `sales_prepare_candidate` | Solicitud y, tras aprobación separada, candidato en revisión |
| `crm_prepare_activity` | Solicitud y actividad sintética autorizada |
| `crm_prepare_task` | Solicitud y tarea sintética sin duplicados |
| `proposal_prepare_draft` | Solicitud y propuesta en borrador |
| `gmail_prepare_draft` | Solicitud y borrador local revisable; ningún envío |
| `content_prepare_idea` | Solicitud e idea editorial, sin publicación |
| `content_prepare_script` | Solicitud y nueva versión de guion |
| `content_prepare_review` | Solicitud de revisión pendiente; no aprueba contenido |

Las 25 lecturas rechazan campos desconocidos y al usuario sin permisos. Las ocho preparaciones rechazan ejecución en modo de solo lectura, campos de autoaprobación y al usuario no autorizado. Se verifican límites inválidos y recursos inexistentes. El protocolo limita las páginas a 20 y el desplazamiento a 200; sugerencias comerciales devuelven como máximo cinco por página. No se ha realizado una prueba de carga ni de todas las combinaciones posibles de filtros.

## Matriz de permisos y seguridad

| Identidad sintética | Comprobación local |
| --- | --- |
| Propietario con lectura | Inventario de 25 lecturas, sin preparaciones |
| Propietario con preparación | 33 herramientas; preparar no ejecuta ni aprueba |
| Comercial | Solo su empresa en búsqueda; empresa ajena denegada en lectura y preparación; no puede aprobar |
| Producción | Inventario limitado a herramientas Cards |
| Lector | Ninguna herramienta de preparación |
| Editor Altaria Cards | Solo herramientas Content; marca ajena denegada en lectura y preparación |
| Sin permisos o identidad inexistente | Herramientas y resolución de identidad denegadas |
| Concesión local revocada | Siguiente resolución de identidad y ejecución denegadas |

Las pruebas criptográficas usan claves efímeras sintéticas en memoria y verifican firma incorrecta, issuer incorrecto, audiencia incorrecta o múltiple, token caducado, claims obligatorios ausentes, identidad y cliente incorrectos. Una petición sin bearer falla antes de consultar datos. También se comprueban los desafíos HTTP y de herramienta y los esquemas OAuth del inventario.

Las respuestas marcan el contenido de negocio como `untrustedBusinessData`. Los campos maliciosos se devuelven como datos y no alteran permisos ni disparan pagos, envíos o publicaciones. No se filtran originales, claves de almacenamiento, direcciones privadas de envío ni destinos QR. Esta prueba verifica el comportamiento del servidor; la resistencia del modelo de ChatGPT ante esos textos sigue pendiente de conexión real.

## Aprobaciones y auditoría

Cada una de las ocho preparaciones crea solo una solicitud pendiente. Una aprobación posterior mediante la función administrativa y con propietario sintético permite ejecutar la acción autorizada. No hay herramienta MCP que apruebe en nombre del propietario.

Se verifican idempotencia, conflicto al reutilizar una clave con otro contenido, rechazo de ejecución repetida, solicitud caducada antes o después de aprobar, contenido de solicitud modificado, recurso modificado y concesión revocada. Cada ejecución registra eventos de solicitud, aprobación y ejecución. El último recorrido MCP registra 112 eventos de auditoría del propietario sintético, con las 33 herramientas representadas y sin copiar el texto malicioso a los detalles. El borrado de eventos de acción queda bloqueado por los triggers.

Los recuentos de mensajes Gmail, eventos Stripe y publicaciones confirmadas permanecen iguales; tampoco cambian el pago ni el destino QR del pedido sintético. El interceptor de red de la integración permite exclusivamente el host Turso TEST fijado y registra cero intentos de servicios externos adicionales.

## Pasarela

La prueba abre HTTP real en **127.0.0.1:4331**, con upstream sintético inyectado. No arranca Astro ni un túnel. Al terminar, cierra el listener; se confirma después `ECONNREFUSED` en ese puerto.

| Método | Ruta permitida |
| --- | --- |
| GET, POST, DELETE | `/mcp` |
| GET | `/.well-known/oauth-protected-resource` |

Se comprueba por HTTP que `/admin`, `/api/admin`, archivos privados, `.env.test`, depuración, métricas y rutas no autorizadas reciben 404 sin alcanzar el upstream. PUT, PATCH, OPTIONS y HEAD sobre `/mcp`, y métodos de escritura sobre metadata, también se rechazan. Otras pruebas cubren host y Origin ajenos, rutas codificadas, query, cookies, redirecciones y respuestas excesivas. El upstream sintético devuelve 401 para MCP y 200 para metadata: esto prueba el enrutamiento, no una sesión OAuth real.

## Correcciones

- La búsqueda de empresas consulta un registro adicional antes de anunciar otra página.
- Las sugerencias comerciales respetan desplazamiento y devuelven `nextOffset`.
- Las búsquedas, categorías y sectores comerciales usan la versión aprobada incluso para el propietario; una revisión pendiente no contamina la selección.
- El esquema de pedidos acepta únicamente estados de producción conocidos.
- El detalle de producción exige evento de pago y estado válido además de la fecha para afirmar pago confirmado.
- El ejecutor secuencial usa procesos nuevos para los controles inicial y final. En el primer recorrido, las nueve suites pasaron pero el control final no pudo verificar el marcador; una inspección nueva confirmó el aislamiento. No se relaja el control ni se reintentan escrituras automáticamente.

No se modifica el esquema ni se ejecutan migraciones. Se conservan los cambios anteriores y los archivos privados de configuración.

## Reproducción y resultados

Desde PowerShell, con las dependencias instaladas y el token TEST vigente:

```powershell
$env:ALTARIA_MCP_GATEWAY_TEST_PORT='4331'
node scripts/altaria-os-unit-test.mjs
Remove-Item Env:ALTARIA_MCP_GATEWAY_TEST_PORT
node scripts/altaria-os-phase73a-test.mjs
node node_modules/astro/bin/astro.mjs check
node scripts/altaria-os-isolated-build.mjs
node scripts/altaria-os-secret-scan.mjs --include-build
git diff --check
```

El ejecutor se detiene ante el primer fallo y exige aislamiento antes y después. Ejecuta secuencialmente MCP local, CRM, propuestas/Gmail, producción Cards, enlaces/estadísticas Cards, automatizaciones, Sales, Content OS y planes SQL MCP. No usarlo a la vez que otro proceso escriba en TEST: la comprobación de recuentos presupone ausencia de escrituras concurrentes.

| Verificación | Resultado |
| --- | --- |
| Suite general | 330 pruebas, 28 archivos |
| Integraciones y regresiones TEST | 11 pruebas, 9 archivos; incluyen el recorrido de las 33 herramientas |
| TypeScript / Astro check | 0 errores, 0 warnings, 51 hints |
| Build aislado | Correcto; sin credenciales reales |
| Secretos | Sin coincidencias con los secretos locales conocidos en archivos Git y build |
| Git | `feat/altaria-os`, cambios previos conservados; `git diff --check` correcto |

Los resultados detallados están en `review/altaria-os/phase73a-mcp-results.json`, `phase73a-regressions.json` y los logs `phase73a-*.log`. El JSON de regresiones solo marca `complete: true` tras superar también el control final. Las 33 herramientas son comprobaciones dentro de la integración; no se suman otra vez al total de 341 pruebas.

## Pendiente de una conexión real

Siguen pendientes los costes y condiciones del túnel, OAuth real con WorkOS Connect, autenticación Google y MFA del usuario concreto, instalación privada en ChatGPT, negociación completa del transporte, visibilidad real de herramientas en ChatGPT y revocación de consentimientos o refresh tokens en WorkOS. La revocación local inmediata sí está comprobada.

La fase termina sin activar ningún servicio externo, sin concesiones MCP persistentes, sin modificar producción, sin push y sin despliegue. La siguiente fase requiere autorización específica; la primera conexión propuesta seguirá siendo solo de lectura.

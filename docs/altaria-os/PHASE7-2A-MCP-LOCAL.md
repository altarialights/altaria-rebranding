# Fase 7.2A: MCP preparado en local

Esta fase no activa OAuth Connect, CIMD, túneles ni conectores externos. `ALTARIA_MCP_ENABLED=0` y la pasarela no se ha iniciado.

## Identidades y configuración pendiente

| Variable | Significado | Valor permitido al autorizar la conexión |
| --- | --- | --- |
| `ALTARIA_MCP_ASTRO_ORIGIN` | Servidor Astro TEST interno | `http://127.0.0.1:4321` |
| `ALTARIA_MCP_TRANSPORT_URL` | Transporte local de la pasarela | `http://127.0.0.1:4331/mcp` |
| `ALTARIA_MCP_RESOURCE` | Resource Indicator público TEST | URL HTTPS exacta, terminada en `/mcp` |
| `ALTARIA_MCP_OAUTH_ISSUER` | Issuer WorkOS staging | Origen HTTPS AuthKit exacto |
| `ALTARIA_MCP_OAUTH_AUDIENCE` | Audiencia del JWT Connect | Igual a `ALTARIA_MCP_RESOURCE` |
| `ALTARIA_MCP_RESOURCE_HOST` | Host TEST confirmado | Igual al host del recurso |
| `ALTARIA_MCP_CLIENT_ID` | Cliente ChatGPT CIMD | URL exacta del documento del cliente |

No hay valor predeterminado para el recurso HTTPS, issuer, audiencia o cliente. La configuración rechaza URL con credenciales, query o fragmento, valores no canónicos, localhost como recurso, dominios Altaria reales y Vercel. El identificador del recurso no depende de la dirección interna. Solo después de una autorización externa se podrán rellenar los valores reales en `.env.test`, fuera de Git.

## OAuth y autorización

`/mcp` verifica firma JWT RS256 con JWKS WorkOS, issuer, audiencia única exacta, `exp` e `iat` obligatorios, `client_id`, `sub`, `jti`, consentimiento `sid` y `openid`. Rechaza identidad o consentimiento vacíos, emisión futura y tokens sin caducidad. En WorkOS Connect, `sid` es un **identificador de consentimiento**, no una sesión AuthKit. El `sub` se compara con el identificador WorkOS estable de un usuario activo, se comprueba una concesión MCP individual en cada llamada y se recalculan roles, empresa y marca. La lista de herramientas declara `securitySchemes: [{type:'oauth2',scopes:['openid']}]` por herramienta y su espejo `_meta.securitySchemes`. El SDK instalado (2.3.1) aún no emite la primera propiedad; el transporte la añade a la respuesta `tools/list`. Las respuestas 401 incluyen `WWW-Authenticate`; para `tools/call`, el resultado JSON-RPC contiene además `isError` y `_meta["mcp/www_authenticate"]`. La metadata OAuth usa el mismo Resource Indicator.

La revocación de la concesión local deniega la siguiente llamada. La revocación real del consentimiento OAuth y de tokens de actualización se comprobará solo en la fase externa autorizada.

## Herramientas y fechas

Hay **25 lecturas y 8 preparaciones**. Las lecturas nuevas consultan propuestas en borrador o enviadas sin decisión, oportunidades abiertas con tarea vencida o sin tarea de seguimiento fechada y pedidos Cards TEST con pago confirmado que siguen en preparación, producción o verificación. `content_calendar` exige intervalo, zona `Europe/Madrid` y `dateKind`: `editorial_due` lee `content_pieces.due_at`; `publication_scheduled` lee exclusivamente `content_publication_records.scheduled_at` con estado `scheduled`. Programar una pieza no significa publicarla. Los resultados siguen limitados a 20 por página, con SQL parametrizado y permisos por recurso. Los guiones comerciales conservan la validación de versión aprobada y hash.

## Pasarela local

`scripts/lib/mcp-local-gateway.mjs` liga solo `127.0.0.1:4331`. `scripts/altaria-os-mcp-gateway.mjs` exige activación explícita TEST, aislamiento Turso/Stripe/WorkOS, marcador remoto y token vigente antes de escuchar. No se ha iniciado en esta fase.

| Método | Ruta permitida | Destino |
| --- | --- | --- |
| GET, POST, DELETE | `/mcp` | `http://127.0.0.1:4321/mcp` |
| GET | `/.well-known/oauth-protected-resource` | Misma ruta en Astro TEST |

Todas las demás rutas reciben 404, incluidas `/admin`, `/api/admin`, archivos privados, depuración y métricas. Se rechazan hosts ajenos, cabecera `Origin`, query, fragmento y rutas codificadas. No se reenvían cookies ni redirecciones. El cuerpo de petición y las respuestas JSON están acotados a 128 KiB; una conexión SSE se transmite con límite total de 1 MiB y plazo de cinco minutos. La pasarela no registra cuerpos ni secretos. Las pruebas usan origen sintético y escucha loopback efímera.

Tras una autorización adicional, `tunnel-client` deberá apuntar **solo** a `http://127.0.0.1:4331/mcp`, nunca al puerto 4321 de Astro. Habrá que comparar la URL HTTPS asignada, Resource Indicator WorkOS, callback ChatGPT y client ID CIMD antes de poner `ALTARIA_MCP_ENABLED=1`. No instalar un conector ni iniciar la pasarela hasta completar esa revisión.

Fuentes: [OpenAI OAuth MCP](https://developers.openai.com/plugins/build/auth), [Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels), [WorkOS AuthKit MCP](https://workos.com/docs/authkit/mcp), [claims WorkOS Connect](https://workos.com/docs/authkit/connect/token-claims).

## Verificación del 15/10/2026

Preparación local revisada en `feat/altaria-os`. Se conservaron los cambios anteriores; no se aplicaron migraciones, no se modificó `.env.test`, ni se activaron servicios. La revisión encontró la separación OAuth, las consultas nuevas y la pasarela ya implementadas. En este pase se endurecieron los claims obligatorios del JWT, se añadieron los desafíos de herramienta y el espejo de esquemas de seguridad, y se limitó la lectura de respuestas de la pasarela antes de acumularlas completas en memoria. Se ampliaron las pruebas correspondientes.

| Estado | Evidencia / alcance |
| --- | --- |
| Implementado | Configuración de cinco identidades separadas, 25 herramientas de lectura y 8 de preparación, pasarela con lista cerrada, concesiones locales y revisión humana |
| Verificado localmente | 329 pruebas en 28 archivos: MCP, permisos, CRM, propuestas, Sales, Content, Cards, automatizaciones y aislamiento; TypeScript sin errores; build aislado correcto |
| Verificado en TEST externo, solo lectura | Marcador remoto; hashes 001–022; claves foráneas; token válido; cero concesiones MCP activas; inventario WorkOS staging; cinco planes SQL mediante EXPLAIN |
| Pendiente de autorización | Configurar Connect/CIMD y recurso en WorkOS, crear/ejecutar túnel y su clave, instalar/autenticar en ChatGPT, conceder acceso MCP y comprobar OAuth real |
| No verificado | Permisos, disponibilidad y costes del túnel en la cuenta; herramientas de preparación disponibles en ChatGPT; identidad Google/MFA del futuro usuario de conexión; revocación real del consentimiento Connect |

El token Turso TEST expira exactamente el **20/10/2026 a las 12:03:13 UTC** (14:03:13 en Madrid). El marcador remoto coincide y `ALTARIA_MCP_ENABLED` sigue sin activar. Stripe test se verificó por modo, prefijo y separación de credenciales; no se efectuaron llamadas a Stripe. WorkOS staging respondió al inventario de lectura: dos usuarios en la primera página y una organización. El inspector solo evalúa identidad Google/MFA cuando hay un único usuario, por lo que en esta ejecución devuelve `verifiedUser: null`; los flags locales no sustituyen una comprobación del usuario concreto.

Comandos ejecutados:

- `node scripts/altaria-os-test-inspect.mjs`: correcto con acceso de red autorizado; el primer intento restringido no pudo consultar el marcador.
- `node scripts/altaria-os-workos-staging-inspect.mjs`: inventario staging de solo lectura, con la limitación de identidad indicada.
- Comprobación de solo lectura de `altaria_schema_migrations`: 22 nombres consecutivos y sus SHA-256 coinciden con disco; `PRAGMA foreign_key_check` vacío. Ninguna migración ejecutada.
- `node scripts/altaria-os-unit-test.mjs`: **329/329**, 28 archivos. La primera ejecución restringida falló al leer `pako`; el pase con acceso a dependencias y red de pruebas bloqueada pasó.
- `ALTARIA_MCP_QUERY_TEST=1` con `vitest.mcp-query-test.config.mjs`: **1/1**, cinco consultas planificadas sobre el esquema TEST; no lee filas comerciales ni prueba resultados de negocio reales.
- `node node_modules/astro/bin/astro.mjs check`: **0 errores, 0 warnings, 51 hints**.
- `node scripts/altaria-os-isolated-build.mjs`: correcto con acceso a dependencias; el primer intento restringido falló en el empaquetador Vercel. Persiste el aviso de importación estática/dinámica de `performance-tier.ts`, ajeno a MCP. No se desplegó el resultado.
- `node scripts/altaria-os-secret-scan.mjs --include-build`: 2738 archivos de código y build sin coincidencias con los secretos locales incluidos en el escáner; no equivale a una detección universal de credenciales.
- `git diff --check` y comprobación adicional de los ocho archivos modificados no rastreados: sin errores de espacios; se eliminó una línea vacía final en la documentación.

Las pruebas usan JWT y personas sintéticas. Cubren ausencia de token, firma incorrecta, issuer/audience equivocados, expiración y claims ausentes, concesión revocada, usuario denegado, roles, empresa y marca, validación estricta, texto de negocio no confiable, idempotencia, aprobación caducada, auditoría y separación de fechas con cambio horario. La pasarela se prueba en loopback efímero con upstream simulado; también se comprueban rutas privadas, Host/Origin, cookies, redirecciones y cancelación de respuestas excesivas. Esto no es QA integral ni certifica el flujo real de consentimiento.

## Configuración externa futura: valores conocidos y pendientes

| Elemento | Configuración requerida; no aplicada |
| --- | --- |
| Astro interno | `ALTARIA_MCP_ASTRO_ORIGIN=http://127.0.0.1:4321` |
| Pasarela | `ALTARIA_MCP_TRANSPORT_URL=http://127.0.0.1:4331/mcp`; el futuro cliente de túnel usa esta URL como `--mcp-server-url` |
| Recurso | `ALTARIA_MCP_RESOURCE`: URI HTTPS TEST exacta confirmada durante la configuración autorizada; sin valor inventado. El validador local actual admite ruta `/mcp`; otra forma de URI exige revisión local explícita |
| Audiencia | `ALTARIA_MCP_OAUTH_AUDIENCE` idéntica al recurso; `ALTARIA_MCP_RESOURCE_HOST` idéntico a su hostname |
| WorkOS | `ALTARIA_MCP_OAUTH_ISSUER`: origen AuthKit staging confirmado; JWKS en ese origen + `/oauth2/jwks`; discovery en ese origen + `/.well-known/oauth-authorization-server` |
| Cliente y callback ChatGPT | Copiar literalmente el client metadata document y redirect URI que muestre la gestión del servidor ChatGPT. No deducir el callback a partir del callback local AuthKit |
| CIMD | Habilitar solo con nueva autorización; comprobar metadata de cliente y callback reales, PKCE S256 y compatibilidad del método de autenticación del cliente anunciado por WorkOS |
| Scope | `openid`; los permisos comerciales y editoriales se conceden dentro de Altaria OS. No solicitar permisos de envío, pagos ni publicación |
| Usuario | Verificar identidad Google, email verificado y MFA del sujeto estable que se vinculará, mantener alta cerrada; conceder lectura/preparación por separado |
| Túnel | ID y clave de ejecución todavía inexistentes en esta preparación; organización/workspace destino y permisos pendientes. Nunca usar el puerto de Astro como destino ni reenviar `/ui`, `/metrics` o endpoints admin |

El issuer y las políticas de identidad pueden comprobarse en staging sin conocer el túnel; el Resource Indicator y su audiencia requieren el identificador definitivo del recurso. Los valores exactos del cliente y callback dependen de la modalidad que presente ChatGPT. Según la [documentación oficial de autenticación](https://developers.openai.com/plugins/build/auth), esa modalidad puede usar callback estable o específico; este informe no presupone ninguno. El callback AuthKit `http://127.0.0.1:4321/auth/altaria/callback` pertenece al acceso local a Altaria OS y no es el callback OAuth de ChatGPT.

La [documentación de Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels) describe transporte saliente y descubrimiento OAuth por el túnel, con el servidor de autorización accesible por separado. No demuestra disponibilidad de la cuenta. Antes de cualquier conexión debe comprobarse que el recurso HTTPS y la URL de metadata anunciados por el desafío se resuelven correctamente por la ruta del túnel. No se ha creado una URL pública de metadata ni se han inventado identificadores.

## Instalación y revocación futuras

Tras las autorizaciones específicas: verificar permisos del workspace y del túnel; revisar el perfil con destino loopback; configurar WorkOS y metadata exacta; iniciar únicamente servicios TEST; instalar el servidor privado en ChatGPT; autenticar al usuario mediante Connect; conceder acceso local desde Altaria OS; comprobar primero las 25 lecturas y después, si la cuenta lo permite, las 8 preparaciones. Las preparaciones siguen pendientes de aprobación y ejecución humana separadas en Altaria OS.

Para cortar acceso: desactivar MCP y detener la pasarela/cliente de túnel; revocar la concesión local; desconectar ChatGPT; revocar consentimiento Connect y refresh tokens en WorkOS; revocar la clave de ejecución y eliminar el túnel cuando se autorice. Cerrar una sesión AuthKit no equivale a revocar consentimiento Connect. La validación JWT local no prueba revocación inmediata de un consentimiento externo: la concesión local proporciona el corte inmediato y el comportamiento de WorkOS debe validarse en la fase externa.

No se han consultado ni modificado endpoints de producción; sus valores locales se usaron únicamente para comparar y rechazar reutilización. No hubo cambios de WorkOS, recursos nuevos, exposición pública, conexión ChatGPT, push ni despliegue. Git conserva cambios anteriores sin commit, incluidos numerosos archivos todavía no rastreados; esta entrega no los atribuye a este pase.

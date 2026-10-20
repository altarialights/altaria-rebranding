# Fase 7: MCP privado en TEST

## Estado y límite operativo

La migración 022 instala concesiones por usuario, solicitudes preparadas, eventos inmutables y límites horarios en Turso TEST. El servidor MCP se inicia **cerrado**: `ALTARIA_MCP_ENABLED` no se ha activado y no hay concesiones de acceso. No se ha conectado ChatGPT ni se han creado túneles, clientes OAuth, dominios o recursos externos. La credencial Turso TEST actual caduca el 20/10/2026 a las 12:03 UTC.

El endpoint `/mcp` usa HTTP transport del SDK MCP y OAuth por usuario. Requiere token JWT WorkOS con firma RS256 verificada por JWKS, emisor, audiencia exacta del recurso, `client_id` de ChatGPT, `sub`, `jti`, `sid`, `openid` y caducidad válidos. El `sub` debe coincidir con el identificador WorkOS estable de un usuario activo de Altaria OS; también se comprueba una concesión MCP explícita en cada llamada. El token no se guarda. La autorización de CRM, Cards y marcas editoriales se vuelve a consultar en Turso. Stripe debe seguir en modo test y la base debe conservar el marcador de aislamiento.

La metadata OAuth se sirve en `/.well-known/oauth-protected-resource` solo si MCP está configurado. No existe cuenta global que eluda permisos. Se aplican 60 lecturas y 10 preparaciones por usuario y hora en TEST, cuerpo máximo de 128 KiB, entradas Zod estrictas, paginación y salida máxima de 36 KiB. Los textos comerciales devueltos se marcan como datos no confiables. El servidor no ofrece SQL arbitrario, envío de correo, publicación, pagos, cambios de QR ni borrado masivo.

## Herramientas

| Módulo | Lectura | Preparación con aprobación posterior |
| --- | --- | --- |
| CRM | Empresas, ficha, contactos, oportunidades, tareas y cronología | Actividad y tarea |
| Sales OS | Material aprobado, objeciones, plantilla y sugerencias por contexto conocido | Candidato en revisión |
| Cards | Pedidos TEST, producción, lotes, incidencias y cifras agregadas | Ninguna |
| Content OS | Marcas, calendario, piezas, estados, tareas, revisiones y guía aprobada | Idea, nueva versión de guion y solicitud de revisión |
| Propuestas / Gmail | Ninguna lectura adicional | Propuesta vacía y borrador de correo **local**; no se envía |

Las 22 lecturas y 8 preparaciones se registran por usuario. Sales OS solo devuelve versiones aprobadas cuyo hash sigue íntegro. Los textos nuevos pendientes no se presentan como aprobados. Cards devuelve únicamente pedidos con `stripe_entorno='test'` y excluye diseños originales, códigos individuales y destinos QR. Content OS filtra por membresía de marca. Las búsquedas usan parámetros SQL; no se acepta SQL del cliente.

## Revisión humana y procedencia

La aprobación de Fase 6 (`os_approvals`) está restringida por `CHECK` a `work_item.complete`; la migración 022 añade una cola MCP separada y la presenta en la misma zona de control de `/admin` y `/admin/configuracion/mcp`, sin cambiar la migración 017. La página solo es visible al propietario autenticado por Google/MFA. Las concesiones MCP se otorgan o revocan allí mediante CSRF y quedan auditadas.

Preparar una acción solo crea una solicitud pendiente, con solicitante, herramienta, parámetros exactos, recurso y versión, SHA-256, caducidad de 1 minuto a 7 días, clave de idempotencia y evento inmutable. Aprobar y ejecutar son dos acciones humanas distintas dentro de Altaria OS. Antes de ejecutar se verifica de nuevo hash, usuario, concesión, permiso, recurso, versión y caducidad. La ejecución usa los servicios existentes de CRM, Sales, propuestas, borradores locales y Content OS. El resultado enlaza recurso creado, origen `chatgpt_mcp_test`, autor, propietario aprobador, fecha y estado; la auditoría registra la procedencia. Las aprobaciones o instrucciones de ChatGPT por sí solas no ejecutan operaciones.

La ejecución se reclama una sola vez. Si se interrumpe después de reclamarla, el estado `executing` exige conciliación manual; nunca se reintenta automáticamente porque el servicio podría haber creado el registro. La interfaz no presenta ese estado como completado. Las solicitudes caducadas o con cambios de recurso se cierran sin crear un registro.

## Activación externa pendiente de autorización

1. En **WorkOS staging**, habilitar AuthKit/Connect como servidor OAuth para MCP; configurar el Resource Indicator exacto, el emisor y las claves JWKS; comprobar si el cliente ChatGPT usa Client ID Metadata Document (CIMD) o el mecanismo admitido en el entorno. Mantener Google Sign-In, MFA y el alta cerrada. No se necesitan scopes comerciales amplios: `openid` identifica al usuario y Altaria OS aplica permisos locales.
2. Proporcionar un endpoint HTTPS accesible desde ChatGPT, preferentemente el **Secure MCP Tunnel** de OpenAI para pruebas locales. Su creación requiere un tunnel ID y credencial de OpenAI Platform con permisos de túnel, además del permiso del workspace ChatGPT para conectores MCP. No se ha creado ni configurado nada de esto. Alternativa: despliegue TEST HTTPS separado, que requeriría aprobación adicional y revisión de costes; producción está prohibida en esta fase.
3. Tras autorización, registrar la configuración exacta en `.env.test` fuera de Git, verificar metadata OAuth y callbacks en WorkOS staging, activar el flag MCP solo durante la prueba, conceder acceso a un usuario verificado y probar el conector real en ChatGPT. Desde 7.2A, Astro interno y transporte loopback están separados del Resource Indicator HTTPS y de la audiencia; no hay recurso OAuth localhost ni fallback productivo. Véase la configuración cerrada en `PHASE7-2A-MCP-LOCAL.md`.
4. Comprobar la revocación de concesión y de OAuth desde WorkOS, además del cierre de sesión. Solo entonces se podrá afirmar que la conexión real funciona.

La instalación de paquetes NPM no genera cargos. Las pruebas actuales consumen la base Turso TEST existente. Coste incremental observado: 0 €. No se afirma que un futuro túnel, workspace, despliegue o configuración OAuth tenga coste cero sin confirmar las condiciones de la cuenta.

## Verificación local

Aplicar/verificar la migración: `node scripts/altaria-os-phase7-migrate.mjs --apply-test`. Comprueba hashes 001–022, marcador, Stripe test, WorkOS staging, caducidad del token y claves foráneas; solo aplica 022 si falta. `pnpm test src/lib/admin/mcp/mcp.test.ts` prueba configuración cerrada, filtros de herramientas, vinculación de identidad estable, idempotencia, caducidad y JSON-RPC con identidades sintéticas. La prueba MCP local no sustituye la conexión real ChatGPT/OAuth. `pnpm check`, `pnpm build:isolated`, `pnpm test` y `git diff --check` completan la regresión.

Referencias técnicas: [OpenAI autenticación de plugins](https://developers.openai.com/plugins/build/auth), [conexión MCP con ChatGPT](https://developers.openai.com/plugins/deploy/connect-chatgpt), [Secure MCP Tunnels](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels), [WorkOS AuthKit MCP](https://workos.com/docs/authkit/mcp), [SDK TypeScript MCP](https://github.com/modelcontextprotocol/typescript-sdk).

## Actualización local 7.2A

La configuración OAuth, la pasarela local y la semántica de las 33 herramientas se documentan en [PHASE7-2A-MCP-LOCAL.md](./PHASE7-2A-MCP-LOCAL.md). Esta sección sustituye las instrucciones de activación localhost anteriores; MCP continúa desactivado.

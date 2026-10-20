# ALTARIA OS — Fase 1: administrador privado

Estado del 2026-10-08: implementación local en `feat/altaria-os`. No se ha hecho push ni despliegue. Un inicio real de Google OAuth y TOTP en WorkOS staging ya se verificó por identidad, factor, sesión y eventos. Las banderas de `.env.test` están en `1`; el acceso al panel sigue cerrado para cualquier cuenta que no figure en la lista de usuarios de Turso TEST. El propietario inicial autorizado ya está aprovisionado exclusivamente en TEST y vinculado mediante su ID estable de WorkOS.

## Aislamiento y datos

- `pnpm dev` carga sólo `.env.test`, comprueba que Turso y Stripe no coinciden con `.env` y lee el marcador de `altaria-os-test` antes de iniciar Astro.
- La migración append-only `007_altaria_os_identity.sql` se aplicó únicamente a `altaria-os-test`. Se verificaron marcador, hash registrado, cuatro roles, claves foráneas y ausencia inicial de usuarios y eventos. No se ejecutaron 001–006 contra TEST ni migraciones contra producción.
- El token Turso TEST está limitado a esta base y caduca el 2026-10-15 a las 14:48:29 UTC. La clave WorkOS staging de esta fase caduca también a los siete días. Renovarlas mediante el mismo preflight cuando sea necesario, nunca copiando secretos productivos.
- El modelo contiene usuarios vinculados por ID WorkOS y email verificado, roles locales, asignaciones, auditoría append-only y hashes de sesiones revocadas. El propietario se incorporó tras verificar Google OAuth, un factor TOTP, eventos de éxito OAuth/MFA, sesión OAuth activa y el correo comunicado por la persona titular. `altaria-os-phase1-owner-verify.mjs` confirma un único propietario activo, sólo rol `owner` y evento de auditoría.

## Autenticación y acceso

- WorkOS staging gratuito: aplicación `Altaria OS TEST`, callback en `http://127.0.0.1:4321/auth/altaria/callback`, Google social habilitado, Microsoft/GitHub/Apple y contraseña deshabilitados; MFA AuthKit configurado como **Required**. No hay conexiones SSO. Las sesiones se limitan a 12 horas, inactividad de 2 horas y access token de 5 minutos. El alta libre se deshabilitó en WorkOS staging el 2026-10-08 y la página de configuración volvió a mostrar `Sign-up: Disabled` y `Multi-factor auth: Required` tras recargar. La lista local de Turso también niega el acceso administrativo a identidades no aprovisionadas.
- Astro conserva las rutas públicas prerenderizadas. Middleware de servidor protege `/admin`, sus secciones y `/api/admin/*`; comprueba cookie WorkOS, marcador remoto TEST en cada resolución local, identidad verificada, coincidencia de ID y email en Turso, estado activo, sesión no revocada y permiso local por ruta. No hay alta automática al iniciar sesión.
- La API de sesión sólo muestra secciones permitidas. La revocación se protege con origen y token CSRF, bloquea la sesión local y registra la acción en un lote atómico; solicita además revocación remota a WorkOS.
- La interfaz incluye Inicio, CRM, Cards, Informes y Configuración, navegación según permisos, estados vacíos explícitos y búsqueda preparada pero deshabilitada hasta que existan entidades. No se exponen pedidos, clientes ni estadísticas ficticias.
- La prueba de viabilidad MCP se limita a investigación: WorkOS documenta OAuth/Connect y soporte MCP. Resource Indicator, scopes, CIMD/DCR y consentimiento se probarán en una fase posterior; no se ha creado cliente MCP ni habilitado OAuth para agentes.

## Procedimiento de cierre

1. Obtener del titular el correo Google que autoriza como propietario inicial. No solicitar claves ni códigos. Google + TOTP reales ya se comprobaron para el único usuario staging.
2. Registrar ese correo en `ALTARIA_TEST_OWNER_EMAIL` dentro de `.env.test` ignorado por Git.
3. Ejecutar `node scripts/altaria-os-phase1-owner.mjs --apply-test`. El script comprueba aislamiento, marcador, hash de migración, Google, TOTP, sesión y eventos de éxito antes de escribir exclusivamente en TEST. Es idempotente para la misma identidad.
4. Validar `/admin` y `/api/admin/session` con la sesión del propietario, denegación de permisos, revocación, accesibilidad, móvil/escritorio y capturas en `review/altaria-os/phase1/`, ignorado por Git.
5. Mantener el alta libre deshabilitada en WorkOS staging y comprobar Google y MFA requeridos antes de nuevos cambios de autenticación. Las banderas verificadas están en `1` tras ejecutar `scripts/altaria-os-workos-activate-test.mjs --apply-test` y reiniciar `pnpm dev`.
6. Repetir `pnpm test`, `pnpm exec tsc --noEmit`, `pnpm build:isolated`, `node scripts/altaria-os-phase1-verify.mjs`, `git diff --check` y escaneo de secretos versionados.

## Resultados hasta ahora

- 288 pruebas locales en 19 archivos, TypeScript y build aislado: correctos. Se añadieron casos de rechazo para coincidencia sólo por email, email distinto con mismo ID y usuario suspendido.
- Login local: sin desbordamiento a 1440 × 900 ni 390 × 844; Axe sin violaciones WCAG A/AA. Sin sesión `/admin` redirige al login (303) y la API devuelve 401. El botón inicia OAuth staging con callback loopback y PKCE. Las páginas públicas `/` y `/tarjetas-nfc-personalizadas` devuelven 200.
- WorkOS staging: un usuario con email verificado, sólo identidad Google, factor TOTP, sesión OAuth activa y eventos de éxito OAuth/MFA de la aplicación. Sin SSO. El callback llegó al servidor local. No se muestran identificadores ni credenciales en las comprobaciones.
- Capturas de login: `review/altaria-os/phase1/login-desktop.png` y `login-mobile.png`.
- Panel con identidad sintética, sólo para QA visual: Axe sin violaciones WCAG A/AA en escritorio y móvil, incluido el diálogo de búsqueda; menú móvil y diálogo operativos, sin desbordamiento. Capturas `panel-preview-desktop.png` y `panel-preview-mobile.png` en el mismo directorio ignorado. La ruta temporal usada para esta revisión se eliminó y devuelve 404.
- El propietario aprobado se verificó en WorkOS staging por email exacto verificado e identidad Google; su ID estable se vinculó en Turso TEST. El marcador, la migración y la auditoría se verificaron tras el alta.
- Recorrido autenticado real después del alta: callback 302, `/admin` 200, `/admin/configuracion` 200 y `POST /api/admin/session/revoke` 303 al login. La persona titular confirmó visualmente el panel y el regreso al login. `altaria-os-phase1-session-verify.mjs` confirmó el hash de revocación local, la auditoría y el evento `session.revoked` de WorkOS para la misma sesión. WorkOS ya no la enumera entre las sesiones consultables.
- Denegación real de una segunda cuenta Google autorizada sólo para TEST: WorkOS completó Google OAuth y MFA, el callback respondió 302 y `/admin` 403. `altaria-os-phase1-unauthorized-verify.mjs` confirmó email verificado, identidad Google, factor TOTP, sesión OAuth y eventos de éxito OAuth/MFA para esa cuenta, mientras Turso TEST conservó un único usuario y un único `owner`; la segunda identidad no existe en la lista local. Tras la prueba se usó la ruta de logout de WorkOS staging y la consulta posterior ya no encontró una sesión OAuth activa de esa cuenta. Las pruebas de servidor también cubren ID, email y estado incorrectos, además de rutas anónimas.
- Las capturas del panel son de la revisión visual con identidad sintética; no se obtuvo captura de la sesión privada del propietario. El alta libre de WorkOS staging ya figura como deshabilitada y no se modificó producción.

## Coste y límites

Turso TEST permanece en plan Free, Stripe test no ha generado pagos y WorkOS staging es gratuito. Coste incremental observado: **0**. No se ha creado preview Vercel, dominio, túnel ni servicio de pago. La disponibilidad y las cuotas del plan gratuito pueden cambiar; revisarlas antes de cualquier despliegue.

Fuentes: [WorkOS staging](https://workos.com/docs/authkit/environments), [Astro](https://workos.com/docs/sdks/authkit-astro), [Google social](https://workos.com/docs/authkit/social-login), [MFA](https://workos.com/docs/authkit/mfa), [sesiones](https://workos.com/docs/authkit/sessions), [MCP](https://workos.com/docs/authkit/mcp), [precios](https://workos.com/pricing).

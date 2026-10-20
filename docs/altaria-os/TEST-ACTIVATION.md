# ALTARIA OS — activación de TEST

Este documento registra el estado y las decisiones de la Fase 0.2. La Fase 1 autorizada y su estado actual se documentan en [PHASE-1.md](./PHASE-1.md).

Estado: entorno TEST local activado y verificado el 2026-10-08. No se ha desplegado ni iniciado la Fase 1.

## Recursos aprobados en diseño

- Turso: base nueva `altaria-os-test`, vacía e independiente. No utilizar `--from-db`, importaciones, dumps, réplicas ni datos de producción.
- Stripe: exclusivamente claves y webhooks de modo test.
- WorkOS: candidato para una prueba de concepto posterior en staging.
- Publicación: bloqueada hasta aprobación final.

## Procedimiento de alta aplicado

1. Identificar la organización y el plan de Turso; confirmar que `altaria-os-test` no existe. Comprobar que el alta cabe en el plan gratuito o informar del coste antes de actuar.
2. Crear una base vacía con ese nombre, sin origen ni copia de producción. Registrar su URL y verificar que identifica la base esperada.
3. Emitir un token **limitado a esa base**, de lectura y escritura porque el marcador y la inicialización requieren escritura, con caducidad corta. No usar tokens de organización o grupo. Si se desea acceso de consulta separado, emitir otro token de solo lectura para verificaciones posteriores.
4. Guardar URL y token únicamente en `.env.test`, ignorado por Git. Registrar un marcador TEST aleatorio en ese mismo archivo. Nunca imprimir secretos ni incorporarlos a documentación o commits.
5. Verificar localmente las comprobaciones previas: protocolo y host de Turso, separación frente a `.env`, token diferente, marcador válido, Stripe `sk_test_` y secreto de webhook test distinto del de producción.
6. Ejecutar el bootstrap exclusivamente contra la base TEST vacía. El script rechaza una base con tablas de negocio o marcador previo incorrecto. Después consultar el marcador y la lista de tablas sin leer datos reales.

La creación de la base y su token se efectuaron con autorización expresa tras comprobar la cuenta `altarialights`, plan Free, 34 bases existentes de 100 permitidas y ausencia de `altaria-os-test`. Se eligió el grupo `default` y el motor libSQL/SQLite, sin importar, copiar ni ramificar otra base. El token de lectura y escritura está limitado a esa base y caduca el 2026-10-15 a las 14:48:29 UTC. La base estaba vacía antes del bootstrap y después contiene únicamente `altaria_test_environment` con el marcador verificado.

## Stripe test local

Se verificó la cuenta Stripe «Altaria Lights» en el entorno de prueba y se obtuvo una clave `sk_test_` existente. Una consulta de solo lectura confirmó que corresponde a la misma cuenta. El secreto `whsec_` se obtuvo con `stripe listen --print-secret` usando exclusivamente esa clave TEST; se confirmó que permanece estable y que difiere del secreto productivo. Ambos valores están sólo en `.env.test`, ignorado por Git.

Para recibir webhooks locales, iniciar `pnpm dev` y después `pnpm stripe:test:listen`. El segundo comando valida la configuración y el marcador remoto, usa sólo la clave test, limita los eventos a `checkout.session.completed` y `checkout.session.expired`, reenvía a `http://127.0.0.1:4321/api/stripe/webhook` y oculta el secreto en la salida. Se comprobó el estado «listo» y se detuvo el listener. No se registró una URL pública, túnel ni endpoint Stripe persistente. Un webhook persistente fuera de localhost exigiría una URL HTTPS pública o un túnel y autorización específica antes de crearlo. Una prueba de entrega con eventos sintéticos queda pendiente hasta que existan tablas de pedidos TEST y se autorice esa prueba; no se generaron pagos.

## WorkOS: prueba de concepto propuesta

En una futura prueba local, usar un entorno WorkOS staging y un callback localhost. Mantener el adaptador Vercel existente; proteger solamente rutas dinámicas, dejando las páginas públicas prerenderizadas. Probar Google Social Login, MFA TOTP obligatorio, sesiones y roles. Para MCP, activar CIMD en staging (está desactivado por defecto), registrar un Resource Indicator de TEST y verificar OAuth con PKCE, `iss`, `aud` y permisos en el servidor; habilitar DCR sólo si el cliente lo requiere. Comprobar de forma explícita el comportamiento MFA con Google social y con SSO: la exigencia MFA integrada de AuthKit no se aplica a usuarios SSO. No configurar todavía una cuenta, aplicación, proveedor social, dominio o claves WorkOS. Sin ese entorno y sus credenciales, una prueba de concepto local sólo podría simular el proveedor y no validaría Google, MFA ni OAuth real; por ello queda pendiente.

## Criterio de activación

Este criterio está cumplido para el entorno local: base independiente identificada, token limitado, `.env.test` separado, marcador remoto confirmado, arranque local correcto y pruebas de aislamiento superadas. La caducidad del token exige renovarlo de forma controlada cuando venza; el servidor debe fallar cerrado si ya no puede verificar el marcador. No se han aplicado migraciones de producto ni se ha aprobado la Fase 1.

## Auditoría previa del 2026-10-08

- Rama `feat/altaria-os`; `.env.test` ausente e ignorado por Git. La `.env` productiva permanece sin modificar y fuera de Git.
- Sin CLI Turso, Stripe o Vercel, sin variables TEST de proceso y sin sesión autenticada en los paneles Turso o Stripe disponibles para esta tarea. Los paneles redirigen a inicio de sesión. No se usaron las credenciales productivas locales para consultar cuentas o servicios.
- `pnpm test`: 17 archivos, 269 pruebas superadas con datos sintéticos. `pnpm exec tsc --noEmit` y `pnpm build:isolated`: correctos.
- `pnpm dev` sin `.env.test` y bootstrap sin opción de inicialización: rechazo esperado antes de conectar. `git diff --check`: correcto. Escaneo de patrones de secretos en código y documentación: sin hallazgos; `.env.test` confirmado como ignorado.
- No se ha creado ni inicializado la base TEST, ni obtenido credenciales Stripe test. Plan y cuota reales de la cuenta Turso sin confirmar por falta de acceso; ningún coste incurrido por estas acciones.

## Activación del 2026-10-08

- Turso Starter (Free) confirmado en facturación, sin método de pago y con gasto actual mostrado como «-». Había 34 bases antes y 35 después, dentro del límite gratuito de 100. Nueva base `altaria-os-test` creada vacía en `default`. Consulta de solo lectura previa: 0 tablas de usuario. Bootstrap: sólo tabla y fila de marcador. Consulta posterior: marcador correcto y una única tabla de control.
- Stripe test: clave `sk_test_` existente guardada localmente, identidad de cuenta confirmada mediante API de solo lectura. Secreto de listener test guardado y comparado con una segunda invocación. Listener local operativo; sin URL pública, túnel, webhook live ni eventos de pago.
- `pnpm dev` inició Astro después de consultar el marcador remoto; `GET /` en loopback devolvió 200. `pnpm stripe:test:listen` llegó a «listo» y se detuvo sin procesos residuales.
- `pnpm test`: 269 pruebas superadas en 17 archivos con datos sintéticos. `pnpm exec tsc --noEmit` y `pnpm build:isolated`: correctos. Repetir tras cualquier cambio en los lanzadores.
- Ninguna credencial se imprimió ni se guardó en archivos versionados; `.env.test` continúa ignorado. No se ejecutaron migraciones del producto, pagos, despliegues ni push.

## Fuentes

- Turso, creación: https://docs.turso.tech/cli/db/create
- Turso, tokens por base, solo lectura y caducidad: https://docs.turso.tech/cli/db/tokens/create
- Stripe, tipos de claves: https://docs.stripe.com/keys
- WorkOS, SDK Astro: https://workos.com/docs/sdks/authkit-astro
- WorkOS, MFA: https://workos.com/docs/authkit/mfa
- WorkOS, MCP: https://workos.com/docs/authkit/mcp

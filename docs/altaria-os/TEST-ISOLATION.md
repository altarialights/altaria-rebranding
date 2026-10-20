# ALTARIA OS — aislamiento de desarrollo y pruebas

Estado: 2026-10-08. La rama local de trabajo es `feat/altaria-os`. La base independiente `altaria-os-test` y el entorno local TEST están activados; no se ha desplegado. La `.env` actual del proyecto contiene una URL Turso de producción y Stripe live; no debe utilizarse para desarrollar ni probar ALTARIA OS.

## Qué bloquea el proyecto

- `pnpm dev` carga exclusivamente `.env.test` mediante el lanzador seguro. Si falta o es ambigua, no arranca Astro. Compara host y token con la `.env` local de producción y con el host productivo conocido. Requiere una URL TEST fijada por separado, Stripe `test` con `sk_test_` y un marcador comprobado en la Turso remota antes de iniciar el servidor.
- El lanzador elimina las credenciales heredadas de Turso, Stripe, WorkOS, Telegram y Maps antes de arrancar Astro. La configuración Astro usa un directorio de variables vacío en comandos locales para que no mezcle la `.env` productiva, incluso si se invoca Astro directamente. El cliente Turso y el modo Stripe rechazan accesos fuera de Vercel Production que no hayan pasado el lanzador.
- `pnpm test` elimina credenciales heredadas, usa un directorio `.env` vacío y bloquea `fetch` externo. Los tests existentes usan dobles para Turso y Stripe; la suite de aislamiento usa únicamente valores sintéticos.
- Los scripts de QA con navegador rechazan URLs que no sean HTTP loopback. `prepare-cards-test.mjs` y `export-card-artwork.mjs` sólo aceptan la Turso TEST con marcador remoto. El inicializador rechaza bases con cualquier tabla de usuario.
- Ningún nombre como `test`, una variable `STRIPE_MODE=test` o una URL pasada por argumento bastan por sí solos para autorizar operaciones.

## Configuración aplicada y referencia para una base nueva

1. Crear **una base Turso nueva y vacía**, separada de producción. No copiar datos de clientes. Su URL y token deben diferir de los productivos. Registrar su identidad como destino TEST aprobado.
2. Copiar `.env.test.example` a `.env.test` (ignorado por Git). Completar `ALTARIA_TEST_TURSO_URL` y `TURSO_DATABASE_URL` con la misma URL exacta de esa nueva base y proporcionar **un token exclusivo**. Completar `ALTARIA_TEST_DB_MARKER` con 32 bytes aleatorios hexadecimales minúsculos. Generarlo localmente, por ejemplo con `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`.
3. Configurar una clave Stripe `sk_test_` y un secreto webhook **de test** `whsec_`. No copiar claves live. Mantener Telegram sin configurar; las pruebas de avisos usarán dobles hasta que se autorice un chat de prueba.
4. Sólo al crear una base TEST nueva y vacía, ejecutar una vez `node scripts/altaria-os-test-bootstrap.mjs --initialize-empty-test-db`. Este paso escribe **únicamente el marcador** y se niega a operar sobre una base con tablas de usuario. No repetirlo en la base ya inicializada.
5. `pnpm dev` comprobará el marcador mediante una consulta parametrizada. Si falla, no iniciará la aplicación. En Fase 1 se aplicó exclusivamente la migración incremental 007 de identidad a TEST, mediante `scripts/altaria-os-phase1-migrate.mjs`; 001–006 siguen sin aplicarse a esa base. Los futuros seeders y migradores de ALTARIA OS deberán reutilizar `scripts/lib/test-isolation.mjs` y consultar el marcador antes de escribir.

El marcador remoto es una defensa adicional frente a una URL equivocada. No sustituye la revisión humana del recurso y sus permisos. La comparación con la `.env` local y el host productivo conocido impide usar por error las credenciales actuales, incluso si se renombran como TEST. Si cambia el host productivo, se debe actualizar la lista de rechazo antes de continuar.

## Comandos permitidos ahora

- `pnpm test`: pruebas unitarias con datos sintéticos, sin secretos ni red.
- `pnpm exec tsc --noEmit`: comprobación estática de tipos, sin ejecutar la aplicación.
- `pnpm build:isolated`: build local con credenciales Stripe sintéticas y sin Turso, Telegram ni claves reales. Sólo genera archivos ignorados en `dist/` y `.vercel/`.
- `pnpm dev`: inicia Astro sólo después de validar `.env.test` y el marcador remoto. Si el token caduca o falta cualquier comprobación, debe fallar cerrado.
- `pnpm stripe:test:listen`: escucha sólo eventos Stripe TEST y los reenvía al servidor local; iniciar después de `pnpm dev`.
- `node scripts/altaria-os-phase1-verify.mjs`: comprueba sólo mediante lectura el marcador, hash de 007, roles y claves foráneas en TEST.
- `node scripts/altaria-os-secret-scan.mjs`: compara secretos locales con los archivos que Git incluiría y sólo informa de recuentos.

No utilizar directamente `astro dev`, `node --env-file=.env` ni scripts propios que conecten Turso/Stripe mientras la `.env` local apunte a producción. Un comando Astro local directo no carga esa `.env`, pero tampoco configura TEST y fallará al acceder a los servicios. No ejecutar pruebas E2E o migraciones remotas antes de configurar TEST. Los scripts heredados de QA sólo aceptan un servidor local; dicho servidor también debe haberse iniciado mediante el lanzador seguro o el servidor de QA que elimina credenciales.

## Límites actuales

La conexión remota TEST, el bootstrap del marcador, la clave Stripe test y el listener local están verificados. La migración 007 se aplicó sólo en TEST; no se han aplicado 001–006 a esa base, enviado eventos de pago ni probado la entrega de webhooks contra tablas de pedidos. El token Turso caduca el 2026-10-15 a las 14:48:29 UTC. Google OAuth y MFA TOTP de WorkOS staging ya están verificados, pero el panel seguirá cerrado hasta autorizar y aprovisionar al propietario en Turso TEST. La defensa aplica a los comandos y módulos del repositorio; una llamada manual a una API externa fuera de estos controles requiere la misma revisión humana.

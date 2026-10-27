# Agenda pública de reuniones

## Estado de producción — 27/10/2026

Google OAuth publicado/reautorizado y variables Vercel configuradas según confirmación del usuario. Migraciones **023 y 024 aplicadas y verificadas en Turso producción**; copia previa y hashes documentados en `docs/database/SCHEMA.md`. El script `scripts/meetings-production-migrate.mjs` comprueba el host real fijado, rechaza TEST y estados parciales, respalda antes de aplicar y valida integridad y conservación del esquema anterior. Pendientes: subir/publicar el código, conectar el webhook y activar/verificar la agenda. Los apartados inferiores conservan el procedimiento y estado de entregas anteriores.

## Gestión desde Telegram — actualización del 27/10/2026

El usuario ha elegido conservar para producción el calendario ya autorizado:
`7bf5bc2bac61103fc969b7db95a40e330b6ef8bbd5052dd62a9ddf21561f6c9a@group.calendar.google.com`.
No hace falta crear otro calendario. Esto no convierte la base Turso TEST en producción. Una vez publicado, desactivar las reservas locales sobre ese calendario para evitar dos bases independientes reservando a la vez.

La migración append-only **024**, posterior a 023, está aplicada en TEST. Ambas siguen pendientes en producción. Añade el enlace de Calendar, intención durable de cancelación, fecha de cancelación y edición pendiente de Telegram.

Validación: 302 pruebas automatizadas superadas, comprobación Astro sin errores y build aislado correcto. Se ha actualizado el aviso real de la reserva TEST existente mediante `editMessageText`; la fila sigue confirmada, sin cancelación ni error, con el enlace oficial guardado y sin ediciones pendientes. No se ha cancelado ni cambiado de hora esa cita para probar el código.

- **Modificar reunión** abre el evento oficial en Google Calendar. Iniciar sesión con la cuenta organizadora, pulsar el lápiz, cambiar fecha/hora, guardar y enviar la actualización a los invitados cuando Google lo pregunte. No hay panel ni login propio de la web.
- **Eliminar reunión** pide una segunda confirmación en el mismo mensaje. Solo actúa para el propietario configurado, en el chat configurado y sobre el mensaje original. Cancela con ETag y `sendUpdates=all`; solo libera el hueco cuando Google confirma la eliminación o el evento ya no existe.
- Un cambio de fecha invalida una confirmación antigua. Los fallos transitorios conservan intención y ocupación; el cron y las siguientes consultas recuperan el proceso. Las ediciones del aviso se reintentan sin enviar otro mensaje.
- La conciliación ocurre antes de consultar o reservar huecos, al consultar una reserva y en el cron diario. El aviso se actualiza en esa conciliación, no instantáneamente al editar en Google. Si una edición externa solapa otra reserva, se cierra temporalmente la disponibilidad hasta resolver el conflicto en Calendar. No convertir las citas en eventos de día completo ni trasladarlas a otro calendario.
- Para reducir llamadas se leen eventos futuros paginados y solo se concilian filas cambiadas. Un fallo o presupuesto de tiempo agotado cierra la consulta; nunca se interpreta como agenda vacía. [Referencia de Google](https://developers.google.com/workspace/calendar/api/v3/reference/events/list).

### Prueba local de los botones

`node scripts/meetings-telegram.mjs --prepare-test-owner` identifica al usuario mediante el comando de prueba conocido y guarda su ID y un secreto aleatorio en el archivo privado. Reiniciar el servidor para cargar esos valores.

`node scripts/meetings-telegram.mjs --poll-test http://127.0.0.1:4323` mantiene los botones activos mientras ese proceso y el servidor local sigan abiertos. No desactiva webhooks existentes.

### Activación en Vercel Production

1. Aplicar **023 y 024**, en ese orden, a la base de producción verificando destino y copia previa; no aplicar migraciones históricas del CRM.
2. Configurar en Vercel las credenciales OAuth existentes y el mismo calendario. Si la app sigue en Testing, completar su publicación OAuth y obtener un refresh token definitivo antes de activar producción.
3. Configurar `BOOKING_TELEGRAM_BOT_TOKEN` y `BOOKING_TELEGRAM_CHAT_ID` con el bot dedicado elegido; además, `BOOKING_TELEGRAM_OWNER_ID` y `BOOKING_TELEGRAM_WEBHOOK_SECRET`. Las variables `TELEGRAM_*` del bot de pagos no se sustituyen.
4. Desplegar la web. Detener el polling local si se reutiliza ese bot.
5. Usando los mismos valores de producción en el archivo privado local, ejecutar `node scripts/meetings-telegram.mjs --set-production-webhook https://DOMINIO/api/reuniones/telegram`, sustituyendo DOMINIO por el dominio real. El script rechaza sobrescribir un webhook de otra URL. Este paso aún no se ha ejecutado.
6. Verificar una reserva controlada y sus botones en el despliegue antes de abrir la agenda. El webhook permite usar los botones sin mantener este ordenador encendido.

La página es `/agendar-reunion`. `/contacto` no se modifica. Astro y DOM nativo, sin framework de UI. La disponibilidad y el precio (no hay cobro) no dependen de valores enviados por el navegador. La agenda permanece cerrada hasta configurar Google, Turso y la recuperación autenticada.

## Estado de la entrega

- Migración nueva: `023_meeting_bookings.sql`, independiente del antiguo panel. **Aplicada el 27/10/2026 en `altaria-os-test`**, tras renovar el token y verificar URL y marcador remoto. Concurrencia, leases, estados y límites comprobados directamente en Turso con filas sintéticas eliminadas al terminar. Producción intacta.
- Google Calendar/Meet: OAuth autorizado y reserva real de TEST verificada el 27/10/2026, con un único evento, Meet e invitado.
- Telegram: primera reserva real de TEST con aviso marcado como enviado y message_id persistido, sin error. Se utiliz? exclusivamente el bot y grupo de pruebas configurados; las pruebas automatizadas siguen usando mocks.
- La tarea diaria es compatible con Vercel Hobby. No se garantiza recuperación en un minuto si el visitante cierra la página. Ver límites abajo.

## 1. Recuperar Turso TEST

Renovar un token de lectura/escritura para la base TEST existente:

```sh
turso auth login
turso db tokens create altaria-os-test --expiration 30d
```

Actualizar únicamente `TURSO_AUTH_TOKEN` en `.env.test`, sin pegarlo en chat ni modificar `.env`. Después:

```sh
node scripts/meetings-migrate.mjs
node scripts/meetings-migrate.mjs --apply-test
```

El script verifica la separación de producción, la URL TEST fijada y su marcador remoto. La migración, sus triggers y el registro de hash se aplican juntos en un batch `immediate`. Una segunda ejecución verifica el hash y no reescribe el esquema. Si hay estado parcial, se detiene. No borra tablas existentes ni requiere las migraciones del antiguo CRM.

Producción: pendiente aplicar **solo 023 y 024**, en orden y tras verificar la copia de seguridad y el destino. No ejecutar automáticamente todas las migraciones del repositorio: 007–022 son históricas de TEST.

## 2. Autorizar Google Calendar

Si ya se usa Gmail, esa cuenta de Google sirve para Calendar. Entrar en [Google Calendar](https://calendar.google.com/) y completar su configuración inicial. No se necesita crear una cuenta de servicio.

1. Crear un proyecto en [Google Cloud Console](https://console.cloud.google.com/), habilitar **Google Calendar API** y configurar la pantalla de consentimiento OAuth.
2. Crear credenciales OAuth de tipo **aplicación web**. Registrar exactamente `http://127.0.0.1:8765/callback` como URI de redirección autorizada. Este callback existe solo mientras corre el comando local; no hay login público ni callback administrativo desplegado.
3. Copiar `.env.bookings.example` a `.env.bookings.local`. Rellenar `BOOKING_GOOGLE_CLIENT_ID` y `BOOKING_GOOGLE_CLIENT_SECRET` en ese archivo privado.
4. Ejecutar `node scripts/meetings-google-authorize.mjs`. Abrir la URL que muestra y autorizar con la cuenta organizadora. Usa state aleatorio y PKCE; guarda el refresh token directamente en el archivo privado, sin imprimirlo.
5. La autorización solicita `calendar.events` y `calendar.freebusy`. La cuenta debe tener permisos de escritura sobre el calendario destino y poder generar conferencias `hangoutsMeet`. Los calendarios adicionales de ocupación deben ser accesibles para esa misma cuenta.
6. Copiar el ID exacto de calendario desde **Configuración → Integrar el calendario** a `BOOKING_GOOGLE_CALENDAR_ID`. `BOOKING_BUSY_CALENDAR_IDS` admite otros IDs separados por comas; el calendario de reservas siempre se consulta también.
7. Para desarrollo usar un calendario de prueba separado, indicar el mismo ID en `BOOKING_GOOGLE_TEST_CALENDAR_ID` y un correo propio de prueba en `BOOKING_TEST_ATTENDEE_EMAIL`. Fuera de Vercel Production se rechazan otros destinatarios.

Una app OAuth externa en modo Testing puede tener refresh tokens de duración limitada; preparar el estado de publicación/consentimiento adecuado antes de activar producción. No es suficiente conectar Google Calendar al chat: el servidor desplegado necesita su propia autorización OAuth. [OAuth de Google](https://developers.google.com/identity/protocols/oauth2/web-server).

## 3. Variables y despliegue

Todas son del servidor, sin prefijo `PUBLIC_`:

| Variables | Uso |
|---|---|
| `BOOKING_ENABLED=true` | Abrir la agenda solo tras terminar la configuración y aplicar 023. |
| `BOOKING_GOOGLE_CLIENT_ID`, `BOOKING_GOOGLE_CLIENT_SECRET`, `BOOKING_GOOGLE_REFRESH_TOKEN` | OAuth autorizado por el organizador. |
| `BOOKING_GOOGLE_CALENDAR_ID`, `BOOKING_BUSY_CALENDAR_IDS` | Calendario destino y otros calendarios ocupados. |
| `BOOKING_RATE_SECRET` | Secreto aleatorio de al menos 32 caracteres para HMAC de límites. |
| `CRON_SECRET` | Otro secreto aleatorio de al menos 32 caracteres; Vercel lo incluye como Bearer al invocar el cron. |
| `BOOKING_TELEGRAM_BOT_TOKEN`, `BOOKING_TELEGRAM_CHAT_ID` | Bot y chat dedicados a reuniones en producción. |
| `BOOKING_TELEGRAM_OWNER_ID`, `BOOKING_TELEGRAM_WEBHOOK_SECRET` | Usuario autorizado y secreto independiente para el webhook. |
| `BOOKING_TEST_TELEGRAM_BOT_TOKEN`, `BOOKING_TEST_TELEGRAM_CHAT_ID` | Bot/chat separados usados exclusivamente fuera de Vercel Production. El lanzador local rechaza reutilizar los de producción. |
| `BOOKING_ORGANIZER_NAME` | Opcional; si falta se usa «Somos el equipo de Altaria Lights». |
| `BOOKING_SCHEDULE_JSON` | Opcional: configuración de horarios validada en servidor. |
| `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` | Se reutilizan las variables existentes de cada entorno. |

Generar cada secreto de manera independiente con `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` y guardarlo localmente o en Vercel. No incluir secretos en Git. `.env.bookings.local` está cubierto por `.env.*.local` en `.gitignore`. `scripts/dev.mjs` importa únicamente sus claves `BOOKING_*` y `CRON_SECRET` después de verificar TEST; continúa sin importar los secretos de producción.

Configuración inicial: Europe/Madrid, 30 minutos, lunes–viernes 10:00–14:00 y 16:00–18:00, margen de 15 minutos, antelación mínima 24 horas, horizonte 30 días. Un único módulo genera y revalida huecos en el servidor. Fechas UTC en Turso; conversión civil mediante la base IANA de `Intl` y tratamiento del cambio de hora. Los tiempos civiles inexistentes se omiten. La UI muestra Europe/Madrid y el desfase local aplicable.

## Estados y recuperación

1. FreeBusy de Google más reservas activas de Turso determinan la disponibilidad. Cualquier error por calendario cierra la consulta; nunca se interpreta como vacío.
2. INSERT atómico de `pending` retiene el hueco. Triggers SQL comprueban solapamientos y márgenes; la clave única y huella de datos deduplican dobles clics y reenvíos. El token de estado se guarda solo como SHA-256.
3. Un lease de dos minutos permite trabajar a una sola petición por reserva. Google se consulta otra vez antes de crear. El ID de evento y `conferenceData.createRequest.requestId` son estables. Una respuesta perdida se recupera consultando ese ID; no se genera otro evento.
4. La primera creación no invita a nadie. La conferencia puede quedar pendiente; las siguientes consultas recuperan su estado. Con Meet listo se añade el asistente mediante PATCH con ETag y `sendUpdates=all`. Un reintento consulta asistentes antes de repetir el PATCH. Solo entonces se marca `confirmed` y se muestra el enlace real.
5. Un fallo o vencimiento de 15 minutos inicia compensación. Un evento existente se elimina antes de liberar el hueco; si el INSERT tuvo resultado desconocido se concilia el mismo ID antes de cancelar. Nunca se libera por un timeout a ciegas. Si Google sigue inaccesible, queda pendiente hasta que se recupere; una edición manual incompatible del evento requiere revisión del operador. No existe transacción distribuida con Google y una modificación externa posterior a FreeBusy puede aún introducir un conflicto: el sistema no puede bloquear las ediciones manuales de Calendar.
6. Telegram se entrega después de confirmar. Su fallo no cambia el éxito del visitante. Los rechazos explícitos se reintentan con backoff persistente. Un timeout, respuesta ambigua o muerte del proceso entre envío y registro deja `uncertain`: Bot API no ofrece clave de idempotencia para `sendMessage`, por lo que garantizar simultáneamente reenvío automático y ausencia absoluta de duplicados no es posible. Se prioriza no duplicar. Revisar el chat por ID de reserva antes de resolver el estado mediante el comando de mantenimiento.

`GET /api/reuniones/recuperar` exige `Authorization: Bearer CRON_SECRET`, sin panel ni login. Procesa hasta ocho pendientes por invocación con límite de tiempo, recupera leases y purga contadores caducados. No usa tareas desprendidas de la petición. La consulta de estado también ejecuta recuperación y la página la sondea cada 10 segundos durante un máximo de 15 minutos.

Mantenimiento autenticado desde terminal: `node scripts/meetings-maintenance.mjs` lista IDs, estados y errores de TEST, sin contactos. Tras revisar una entrega incierta en el chat, usar `--booking=ID --delivered-message-id=ID_TELEGRAM` si llegó, o `--booking=ID --retry-confirmed-absent` únicamente si se ha comprobado que no llegó. Para producción exige además `--production --expected-url=URL_EXACTA`; no se ha ejecutado en producción. Este comando no envía mensajes por sí mismo: concilia el envío o lo vuelve a encolar.

`vercel.json` configura una invocación diaria a las 06:00 UTC, dentro de los límites de Hobby. Vercel puede retrasarla dentro de esa hora y no reintenta automáticamente fallos. Revisar los logs del cron y la cola; si se necesita recuperación frecuente sin visitantes o para más volumen, usar un scheduler externo autorizado que invoque el mismo endpoint con el secreto, o Pro con un cron más frecuente. **Hobby diario no equivale a recuperación inmediata.** [Límites de Vercel](https://vercel.com/docs/cron-jobs/usage-and-pricing), [seguridad y ejecución](https://vercel.com/docs/cron-jobs/manage-cron-jobs).

## Comprobación

```sh
pnpm test
pnpm check
pnpm build:isolated
# Requiere TEST remoto autorizado; crea y elimina únicamente sus filas sintéticas.
node scripts/meetings-turso-test.mjs
# En otra terminal: servidor local sin credenciales, solo para QA visual con mocks.
node node_modules/astro/bin/astro.mjs dev --host 127.0.0.1 --port 4322
node scripts/meetings-visual-qa.mjs
```

Las pruebas usan SQL real en memoria como harness de compatibilidad de Turso/SQLite y mocks de Google/Telegram. Cubren concurrencia, idempotencia, márgenes, cambios de hora, validación, errores y compensación. Las capturas y el informe de accesibilidad están en `review/meetings/`. Los enlaces Meet de esas pruebas son exclusivamente fixtures interceptados en el navegador, no reuniones reales ni datos de la aplicación.

Para una prueba completa real: renovar TEST y aplicar 023, autorizar un calendario de pruebas compatible con Meet, configurar un correo propio como destinatario de pruebas y un bot/chat de pruebas, activar `BOOKING_ENABLED` y ejecutar `pnpm dev`. Reservar desde `/agendar-reunion`, esperar la confirmación, comprobar que existe un solo evento con Meet e invitación y que Telegram contiene el mensaje y enlace manual de WhatsApp. No pulsar enviar en WhatsApp a un tercero. Al terminar, cancelar el evento de prueba y conciliar la fila de TEST. El recorrido externo se verific? con la reserva realizada por el usuario el 27/10/2026 para el 29/10/2026 de 11:30 a 12:00 Europe/Madrid. El evento de prueba se conserva; no se ha cancelado ni se ha enviado WhatsApp. Producci?n sigue pendiente de configuraci?n, migraci?n y despliegue.

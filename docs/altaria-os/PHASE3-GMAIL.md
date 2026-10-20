# Gmail CRM — Fase 3.1 TEST

La Fase 3.1 creó el proyecto Google Cloud independiente `altaria-os-gmail-test` el 2026-10-08. No se ha habilitado Gmail API, configurado consentimiento, generado cliente OAuth ni conectado un buzón. `ALTARIA_GMAIL_CONNECT_ENABLED` no está activada y los secretos Gmail no están presentes en `.env.test`. La cuenta de prueba aún no existe; el usuario ha decidido posponer la prueba real. La creación fuera de `altarialights-org` no pidió cuenta de facturación, pero Google vinculó automáticamente el proyecto nuevo a la cuenta de prueba gratuita. La revisión automática rechazó la confirmación para inhabilitarla, y el usuario indicó **dejar el proyecto sin uso**. Se canceló el diálogo; no se ha cambiado la facturación. **No activar APIs ni crear credenciales en este proyecto mientras dure esa decisión.**

## Decisión de acceso

La sincronización sólo importa mensajes que tengan la etiqueta `ALTARIA/CRM` en el momento de su lectura. La etiqueta es una regla **de la aplicación**; Google concede el alcance `gmail.metadata` sobre las etiquetas y cabeceras del buzón completo, que sigue siendo **restringido**. Los mensajes nuevos de un hilo no heredan necesariamente la etiqueta: para detectar una respuesta hay que etiquetar también ese mensaje o automatizarlo en Gmail tras una decisión adicional. No se solicita `gmail.compose` ni `gmail.send`; los borradores se conservan localmente y ningún endpoint envía correo. La conexión requiere `ALTARIA_GMAIL_TEST_EMAIL` explícito, verifica identidad Google `sub`, email y perfil Gmail, y rechaza la cuenta comercial conocida y sus alias Gmail.

### Comparación de permisos

| Alcance | Acceso real | Decisión |
|---|---|---|
| `openid email` | Identidad Google y email verificado; no lee correo. | Necesario para fijar `sub` y confirmar la cuenta TEST. |
| `gmail.labels` | Ver y administrar etiquetas; no lee cabeceras de mensajes. | Insuficiente para asociación y respuestas. |
| `gmail.metadata` | Lee etiquetas y cabeceras, incluso de mensajes fuera de `ALTARIA/CRM`; no lee cuerpos. Restringido. | Elegido: cubre `labels.list`, `getProfile`, `messages.list/get` en formato metadata y `history.list`. |
| `gmail.readonly` | Lee mensajes y configuración del buzón completo, incluidos cuerpos. Restringido. | Excesivo para el flujo actual. |
| `gmail.modify`, `gmail.compose`, `gmail.send` | Permiten cambios o envío. | No solicitados: no hay envío ni borradores en Gmail. |

[Google clasifica los alcances](https://developers.google.com/workspace/gmail/api/auth/scopes); las referencias de [messages.get](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/get) y [history.list](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.history/list) confirman `gmail.metadata`. El flujo usa state de un solo uso, PKCE, cookie HttpOnly y AES-256-GCM. La sincronización incremental usa `history.list` y una resincronización etiquetada cuando el historial devuelve 404, como explica [Google: sincronización](https://developers.google.com/workspace/gmail/api/guides/sync).

[Google publica](https://developers.google.com/workspace/gmail/api/reference/quota) que el uso estándar de Gmail API no tiene coste adicional y que el umbral diario actual es 80 millones de unidades de cuota por proyecto; indica que el exceso podría facturarse más adelante en 2026 con aviso previo. No se observaron cargos nuevos ni se hicieron llamadas Gmail. La cuenta de prueba gratuita de Cloud mostró el mismo crédito restante antes y después de crear el proyecto. Como el proyecto TEST quedó vinculado a esa cuenta, sólo se garantiza ausencia de uso mediante la decisión de mantenerlo inactivo. No se han contratado servicios.

### Verificación y producción

La [excepción de Testing/staging](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification) permite el ensayo con usuarios de prueba explícitos, aviso de app no verificada, máximo de usuarios y refresh tokens de duración limitada. Para producción, «pocos usuarios conocidos personalmente» puede ser una excepción de uso personal, pero no equivale a «una sola cuenta» y Google decide su aplicabilidad. Una app `Internal` exige una organización Google Workspace o Cloud Identity propietaria del proyecto y audiencia interna; una cuenta Gmail personal no la convierte en interna. Si no aplica una excepción, el alcance restringido puede exigir verificación y, al almacenar datos restringidos en el servidor, evaluación de seguridad anual por tercero aprobado. El precio de esa evaluación no aparece fijado por Google; debe obtenerse presupuesto antes de desplegar. [Excepciones y evaluación](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification), [Testing y caducidad](https://support.google.com/cloud/answer/15549945).

## Pasos pendientes para la prueba real

1. Cuando el usuario decida reanudar esta prueba, resolver expresamente la vinculación de facturación del proyecto TEST. Si Gmail API exige facturación, obtener autorización específica de facturación/coste antes de activarla.
2. Crear una cuenta Gmail dedicada a TEST bajo control del usuario, sin reutilizar la cuenta comercial ni alias, y comunicar sólo su dirección. Preparar únicamente contactos y mensajes sintéticos y la etiqueta `ALTARIA/CRM` en ese buzón. El código no crea ni modifica etiquetas.
3. Habilitar Gmail API en el proyecto TEST y configurar pantalla OAuth **External / Testing**, con ese usuario de prueba explícito; no publicar. Registrar cliente web con callback exacto `http://127.0.0.1:4321/api/admin/gmail/callback` y alcances `openid email gmail.metadata`.
4. Guardar ID y secreto OAuth, email TEST y una clave aleatoria de 32 bytes en `.env.test`, sin copiarlos de `.env` ni ponerlos en Git. Activar `ALTARIA_GMAIL_CONNECT_ENABLED=1` sólo tras validar identidad, alcance y costes.
5. Conectar mediante el propietario autenticado con Google y MFA en Altaria OS, y elegir sólo el buzón Gmail TEST durante consentimiento. El callback verifica `sub`, email y perfil Gmail y almacena sólo el refresh token cifrado. Ejecutar sincronización manual, deduplicación, error/reintento y desconexión/revocación reales sin enviar correo.

No hay cron ni Pub/Sub; la sincronización es manual para TEST. Los borradores locales necesitan revisión y copia/envío deliberado fuera del producto; no se envían ni se crean en Gmail. Al desconectar, el servidor intenta revocar el refresh token en Google y siempre elimina su copia local. Si la revocación externa falla, deja una incidencia visible; se debe confirmar la revocación desde la cuenta Google. Esta ruta aún no se ha ensayado con un buzón real.

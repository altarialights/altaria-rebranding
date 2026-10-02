> Estado actualizado 2026-10-02: el usuario autoriz? omitir TEST y aplicar 004 y 005
> en producci?n (`altaria-digital-index-altarialights.aws-eu-west-1.turso.io`).
> Ambas se confirmaron en una transacci?n; copia privada de las 8 tablas en
> `review/migrations-production/2026-10-02T12-44-51.574Z-before.json` (no versionada).
> Los 8 pedidos anteriores conservaron sus campos e importes. ?ndices, FK e integridad
> verificados. Informe y hashes en el archivo `-applied.json` de la misma carpeta.
> No se hicieron pagos, notificaciones ni despliegues. La prueba funcional queda
> a cargo del usuario. Las referencias posteriores a migraciones pendientes describen
> el estado anterior a esta aplicaci?n, no el estado actual de producci?n.

# Altaria Cards — estado actual

## Contacto y configuración

Revisión de octubre de 2026: se elimina el formulario independiente «Todo empieza
con una idea» y la opción «Usar el modelo Altaria existente» del asistente.
Todos los CTA «Cuéntanos tu idea» de Altaria Cards (hero de inicio, landing,
cabecera de la landing, proceso y cierre) enlazan al WhatsApp del proyecto:
**+34 619 13 25 63**, definido en `service-interests.ts`. No se envían mensajes
automáticos: el visitante abre WhatsApp, revisa el texto y decide enviarlo.

El asistente conserva cinco pasos: diseño propio o por Altaria; nueve tipos;
destino existente/ayuda/creación; personalización y cantidad; revisión. Nombre,
email y teléfono son obligatorios para comprar y opcionales al solicitar propuesta.
En compra, el último paso pide envío y consentimiento y abre Stripe. En propuesta,
muestra el mensaje preparado y abre WhatsApp. Si adjunta diseño, primero guarda
una consulta con sus datos y consentimiento para asociar el archivo a un ID real;
si falla, no afirma que se haya recibido. Sin archivo, WhatsApp no depende de Turso.
También hay un enlace directo a WhatsApp
para quien no quiera completar el asistente.

Al elegir «Tengo mi diseño» se abre un modal PNG/JPG/JPEG/WebP estático: máximo
3 MiB y 40 MP. CR80: 85,60 × 53,98 mm; tolerancia ±2 % de proporción. Referencia mínima
1012 × 638 px (~300 ppp), sin rechazar mayor resolución. Otra proporción o baja
resolución producen aviso y «Enviar para revisión», sin bloquear toda la compra.
Se comprueba formato real, tamaño, píxeles, orientación EXIF y decodificación en servidor.

Vista previa: «Encajar completa» por defecto, o «Recortar vista previa» elegido
explícitamente con posición horizontal/vertical. El recorte solo es una indicación
para el equipo y se marca para revisión. El original siempre permanece intacto.
Se puede volver, reemplazar o eliminar un borrador propio; un diseño asociado a un
pedido/consulta no puede borrarse desde el navegador. El borrador guarda ID y metadatos,
nunca base64. Al reabrir se comprueba acceso de sesión y se recupera el original.

Almacenamiento: Turso, tabla `card_artwork`, bytes base64 + SHA-256 + metadatos + FK
`order_id` o `inquiry_id`. Asociación atómica con el alta del pedido/consulta.
La sesión privada protege lectura, borrado y asociación; el ID no autoriza acceso.
Telegram informa referencia, nombre y estado («REQUIERE REVISIÓN» cuando corresponda),
sin URL permanente ni credenciales. Descarga interna mediante herramienta autenticada
`scripts/export-card-artwork.mjs`; no existe aún un panel admin ni firmas temporales.
Una proporción distinta no autoriza imprimir sin revisión del equipo.

Requiere **004 → 005**, pendientes y sin aplicar a ninguna base remota. Preparación,
dependencias, copia y rollback: [MIGRATIONS-TEST.md](MIGRATIONS-TEST.md).

El mensaje lleva el tipo, cantidad, diseño, destino y detalles activos del proyecto.
Los datos ocultos no se comparten. Si supera 6000 caracteres, la vista previa lo
acorta explícitamente y pide continuar los detalles en la conversación. Los datos
no se consideran recibidos ni guardados por abrir WhatsApp.

El borrador se conserva en `sessionStorage` durante 24 horas, con enlaces por tipo,
ficha Google y paso actual. Un borrador antiguo del modelo retirado se recupera
como diseño propio, conservando el resto. Los consentimientos no se restauran.

## Precio y Stripe

Tarifa provisional centralizada en `src/data/cards-catalog.ts`, `cardsPricing`:

| Cantidad | Precio por unidad |
|---|---|
| 1–4 | 20 € |
| 5–9 | 18 € |
| 10–19 | 15 € |
| 20–49 | 15 € |
| 50–500 | 10 € |

Todos los tipos comparten precio. Diseño listo para imprimir: 0 € adicional;
diseño por Altaria: 10 € **por pedido**, nunca multiplicado por cantidad.
Se conserva el envío vigente: 4,90 € para una unidad, gratis desde dos. IVA incluido.
Los importes de tarjetas, diseño, envío y total se muestran antes del pago.

Destino existente: incluido. Ayuda para localizar un destino sencillo existente:
incluida, sin exigir Google Places. La ayuda de acceso/fichaje y «otra idea» necesita
revisión de compatibilidad; aporta un enlace existente para comprar la tarjeta o
solicita propuesta para la integración. Crear cualquier destino pasa a «Solicitar
propuesta» por WhatsApp, sin abrir Stripe y sin mostrar un importe orientativo.
vCard/redes con compra directa requieren el enlace existente; crear una página
para reunir datos/perfiles corresponde a creación de destino.

El servidor calcula importes y destino; ignora precios enviados por el navegador.
Guarda en `personalizacion.tarifa` la versión y el suplemento de diseño aplicado.
Stripe usa exclusivamente los importes persistidos y añade una línea de diseño de
cantidad 1. Un reintento conserva su importe aunque cambie el catálogo.
`config.ts` mantiene la tarifa Google antigua para compatibilidad histórica; no se
usa para crear pedidos nuevos. Las solicitudes antiguas solo pueden reanudar un
pedido ya guardado; no pueden crear otro con la tarifa anterior.

`canCheckoutConfiguration`, Zod y el servicio comprueban el alcance antes de crear
un pedido o una sesión. El webhook conserva firma
sobre cuerpo raw, comprobaciones de metadata, entorno, moneda, importe y estado,
idempotencia y transacción. Las confirmaciones antiguas y nuevas siguen disponibles.

No se ha desplegado, no se han hecho cobros y no se ha aplicado ninguna migración.
Para probar pago externo se necesitan Stripe test, signing secret y webhook de test,
además de Turso de test identificado con las migraciones 002–004.

## Catálogo visual

«Ver todas las opciones» abre `CardsCatalogModal.astro`: búsqueda que ignora tildes,
nueve categorías en la barra izquierda, contadores, estado vacío y reset. En móvil
las categorías pasan a una fila desplazable. El diálogo nativo permite Escape,
conserva el foco y bloquea el scroll de fondo mientras está abierto.

Hay **18 ejemplos, dos por categoría**, definidos en `src/data/card-examples.ts`.
Cada uno tiene un diseño distinto de tarjeta y una pantalla de móvil que ilustra
su destino, una explicación de funcionamiento y dos acciones:

- «Quiero una así»: WhatsApp con el ejemplo elegido en el mensaje.
- «Personalizar»: cierra el catálogo, selecciona el tipo y guarda el ejemplo como
  referencia de diseño dentro del asistente.

Son conceptos de negocios ficticios, no clientes reales ni servicios ya desplegados.
Acceso/fichaje requiere revisar compatibilidad; las cartas, páginas y sistemas nuevos
requieren acordar alcance. No se publican precios, garantías ni plazos inventados.

## Imágenes y ancho del inicio

20 imágenes generadas con el **tool integrado image_gen**, una llamada por diseño:
18 ejemplos, el hero de tres tarjetas y el chico sonriente con su tarjeta.
Prompts exactos y archivos de salida: `docs/orders/CARDS-IMAGE-PROMPTS.json`.
Entregables del proyecto: `public/media/altaria-cards/examples/*.webp`, 900 × 600,
calidad 84, aproximadamente 35–55 KB por imagen y carga diferida. Cada ejemplo tiene
además una versión de 450 × 300 para pantallas pequeñas, seleccionada por `srcset`.
El hero compartido por landing e index usa `optimized/cards-hero-{480,960,1440}.webp`
(30–130 KB) y el chico `optimized/cards-happy-{360,720}.webp` (26–62 KB), dentro de
`public/media/altaria-cards/`. Ambos conservan transparencia, con calidad 82 y
dimensiones explícitas. El hero de la landing tiene prioridad alta; index, chico y
catálogo usan carga diferida. Todas las variantes se sirven mediante `srcset/sizes`.
Los PNG originales
permanecen en el directorio de imágenes generadas de Codex; la web solo usa copias
optimizadas dentro del proyecto. No requiere dependencia nueva ni framework UI.

La sección Altaria Cards del index usa el mismo ancho de `.case__inner`:
`min(100% - 2 * var(--gutter), 1680px)`; en móvil respeta márgenes de 18 px.
Se conservan Puffy, Geist, la paleta y los assets anteriores del hero y cierre.

## Base de datos y compatibilidad

**004 permanece sin cambios y sin aplicar. 005 revisada también está pendiente.**
Las tablas, relaciones y JSON están documentados en `docs/database/SCHEMA.md`.
El endpoint `/api/tarjetas/consulta` conserva validación, SQL parametrizado e
idempotencia. La UI lo invoca únicamente para propuestas con diseño adjunto, antes
de abrir WhatsApp, para guardar y asociar el archivo a una solicitud real. Los CTA
directos y propuestas sin archivo siguen sin escribir en Turso.

Se conservan `/api/tarjetas/checkout`, `/api/stripe/webhook`, las dos rutas de
confirmación y el 301 de `/tarjetas-reseñas-google` a `/tarjetas-nfc-personalizadas`.
La cancelación usa `?pago=cancelado#comprar`; el hash antiguo sigue resolviéndose.

## Comprobaciones locales

- Tests: `node node_modules/vitest/vitest.mjs run`.
- Tipos: `node node_modules/astro/bin/astro.mjs check`.
- Build: `node node_modules/astro/bin/astro.mjs build`.
- QA: `node scripts/cards-qa-server.mjs`, servidor aislado sin `.env` real y con red
  externa bloqueada; después `node scripts/cards-qa.mjs`. `CARDS_QA_URL` indica el
  puerto local y `PW_CHROME` permite usar Chrome instalado.
- El navegador intercepta WhatsApp antes de salir: no abre una conversación real ni
  envía un mensaje. Se comprueban 54 ramas: 32 pagos simulados y 22 propuestas;
  el POST de Checkout y su redirección están interceptados, sin servicios externos,
  18 assets, categorías, búsqueda, teclado, selección, borrador y tamaños
  360/390/768/1024/1440/1920. Evidencia en `review/altaria-cards/whatsapp-catalog/`.

## Ampliacion de subida a 3 MiB

El codigo admite 3.145.728 bytes. Requiere `006_card_artwork_3mb.sql`, aplicada en produccion el 2026-10-02 con copia previa e integridad verificada. Reconstruye card_artwork en una transaccion conservando todas sus columnas, originales, relaciones e indices; solo amplia el CHECK de size_bytes. No modifica 005. Turso ya admite 3 MiB. Falta desplegar el codigo actualizado para habilitar el nuevo limite en la web. Copia privada: review/migrations-production/006-before-1790945942264.json. La tabla tenia 0 archivos al aplicar la migracion.

## Original descargable en Telegram (2026-10-02)

El aviso de pedido pagado con artwork incluye un segundo mensaje `sendDocument`,
como respuesta al aviso, con el original sin recomprimir. Consulta interna por
`card_artwork.order_id` unido a un pedido con `pagado_en`; verifica peso y SHA-256.
No usa URL del navegador, no abre endpoints nuevos ni publica enlaces. El destino
es exclusivamente TELEGRAM_CHAT_ID del servidor. No requiere migracion.
El fichero conserva su nombre y bytes. Si el adjunto falla, se registra fallo de
notificacion sin revertir el pago. El webhook duplicado mantiene la deduplicacion
existente; no hay reintento automatico de adjuntos ni reenvio historico.
Las solicitudes de propuesta siguen sin notificacion Telegram automatica.
Validacion de envio mediante fetch simulado; no se enviaron archivos reales.

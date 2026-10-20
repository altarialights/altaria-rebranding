# Content OS · preparación del piloto Cloudflare R2

Estado: **diseño local; R2 no activado**. Fecha: 13/10/2026. Esta guía no autoriza suscripción, facturación, bucket, credenciales, cargas ni despliegue. El adaptador activo sigue siendo `mock_local`, limitado a 20 MiB por archivo y solo en TEST.

## Decisión propuesta y recursos

Usar **R2 Standard** con un bucket privado exclusivo de TEST, por ejemplo `altaria-content-test`, en **jurisdicción `eu`**. La jurisdicción se fija al crear el bucket y no se puede cambiar. Una pista de ubicación `weur` solo optimiza colocación y **no equivale** a garantía de residencia UE. Validar el endpoint jurisdiccional `https://<account-id>.eu.r2.cloudflarestorage.com` antes de cualquier escritura. No usar `r2.dev`, dominio público ni bucket compartido con producción. La [documentación de ubicación](https://developers.cloudflare.com/r2/reference/data-location/) distingue ambas opciones.

Activar R2 exige una [suscripción R2 en la cuenta Cloudflare](https://developers.cloudflare.com/r2/get-started/) aunque el uso inicial entre en el tramo gratuito. La autorización futura debe cubrir expresamente esa activación y el posible consumo. Crear después el bucket TEST, CORS limitado al origen TEST autorizado, regla de caducidad de multipart incompletos, credenciales S3 limitadas **a ese bucket** y permisos `Object Read & Write`; no conceder administración de buckets al runtime. Si se separan funciones, emitir credencial de solo lectura para descargas y otra de escritura para carga; la [política de tokens R2](https://developers.cloudflare.com/r2/api/tokens/) admite alcance por bucket.

## Configuración prevista, siempre privada en servidor

| Variable futura | Valor esperado / control |
|---|---|
| `ALTARIA_CONTENT_STORAGE_PROVIDER` | `mock_local` por defecto en TEST; `r2` solo tras activación explícita. |
| `ALTARIA_R2_ACCOUNT_ID` | ID de la cuenta Cloudflare autorizada, cotejado con el bucket. |
| `ALTARIA_R2_BUCKET` | Nombre exacto del bucket TEST, fijado en lista permitida del servidor. |
| `ALTARIA_R2_JURISDICTION` | `eu` obligatorio para el piloto. |
| `ALTARIA_R2_ENDPOINT` | Host `*.eu.r2.cloudflarestorage.com`, sin URL suministrada por el cliente. |
| `ALTARIA_R2_ACCESS_KEY_ID`, `ALTARIA_R2_SECRET_ACCESS_KEY` | Credencial S3 de bucket TEST, solo en entorno servidor; nunca `PUBLIC_`, Git, logs ni HTML. |
| `ALTARIA_R2_MAX_OBJECT_BYTES`, `ALTARIA_R2_MAX_TOTAL_BYTES` | Límites de aplicación para cargas y capacidad del piloto; control preventivo propio, no tope de facturación. |

El contrato local `ContentMultipartAdapter` modela inicio, autorización temporal de parte, finalización, aborto, verificación, lectura temporal y eliminación. `InMemoryMultipartAdapter` permite pruebas sintéticas; sus URL `mock://` **no son URL cloud ni sirven al navegador**. La integración R2 real, el SDK y el cambio de proveedor quedan pendientes de aprobación.

## Flujo de carga privada

1. El servidor valida sesión WorkOS staging, CSRF/origen, marca, capacidad editorial `edit`, pieza/version actual, tipo declarado, tamaño, cuota de aplicación, entorno TEST y clave de idempotencia. Genera una clave de objeto opaca bajo prefijo TEST; no acepta claves propuestas por el cliente.
2. El servidor inicia multipart con R2 y firma **cada `UploadPart`** con expiración breve, número de parte y objeto fijos. El navegador envía partes directamente al endpoint R2. Los originales grandes **no atraviesan Vercel Functions**: su límite de cuerpo/respuesta es [4,5 MiB](https://vercel.com/docs/functions/limitations).
3. Partes de al menos **5 MiB salvo la última**, máximo 5 GiB por parte y 10.000 partes, con tamaño uniforme salvo la última, según [límites multipart de R2](https://developers.cloudflare.com/r2/objects/upload-objects/). Registrar ETags por parte; reintentar una parte con el mismo número. Cancelar llama `AbortMultipartUpload`. Configurar limpieza de incompletos; R2 tiene [caducidad predeterminada de siete días](https://developers.cloudflare.com/r2/buckets/object-lifecycles/).
4. Al completar, el servidor comprueba el manifiesto, `HEAD`, tamaño, MIME real y SHA-256 de los bytes por un procedimiento verificable. Un ETag multipart **no equivale** al SHA-256 del archivo. Hasta completar verificaciones, el activo queda `pending`/cuarentena y no se vincula a la pieza. La asociación y auditoría se confirman de forma idempotente en Turso TEST.
5. Si falla la base tras guardar el objeto, registrar incidencia y eliminar/retener temporalmente el objeto huérfano para reconciliación; nunca ocultar el error como éxito. No reutilizar una URL firmada ni un objeto para otra versión o marca.

La [documentación de URL firmadas](https://developers.cloudflare.com/r2/api/s3/presigned-urls/) permite operaciones S3 como GET y PUT; no admite `POST` de formulario HTML. Confirmar en el piloto la firma de `UploadPart`, CORS y cabeceras exactas antes de declarar compatible la carga directa.

## Descargas, permisos y retención

Cada vista previa o descarga comienza en una ruta autenticada que comprueba el permiso `read` para la marca del activo, estado `verified`, entorno TEST y política de retención. Para archivos grandes, devolver una URL GET firmada con vida de 60 segundos y `Cache-Control: private, no-store`, sin persistirla en Turso, HTML cacheable ni logs. La URL es un portador de acceso hasta expirar; no promete revocación inmediata. Evitar filtrar la URL en `Referer` mediante política de referencia. Para originales sensibles valorar proxy autorizado de streaming, midiendo costes y límites de Vercel antes de decidir. Las versiones y manifiestos conservan hashes aunque el binario se elimine por una acción humana autorizada tras retención.

El borrado verifica que no haya versiones o retenciones que exijan conservar el activo; audita solicitud, resultado y reconciliación. No habilitar reglas de expiración que eliminen originales vigentes. Mantener separación de buckets y tokens TEST/producción, y comparar identidad de cuenta, jurisdicción y bucket en cada arranque y antes de escribir.

## Coste y control real

La [tarifa pública R2 Standard](https://developers.cloudflare.com/r2/pricing/) de octubre de 2026 incluye al mes **10 GB-mes, 1 millón de operaciones Class A y 10 millones Class B**; después cobra **USD 0,015/GB-mes**, **USD 4,50/millón A** y **USD 0,36/millón B**. La transferencia de salida R2 figura sin cargo; otras capas, Vercel, impuestos y transformaciones se presupuestan aparte. Un piloto estable de **50 GB-mes** sería aproximadamente **USD 0,60/mes** por almacenamiento tras los 10 GB incluidos, si las operaciones siguen dentro de los tramos gratuitos. Versiones, multipart, duplicados y retención elevan capacidad y operaciones; el presupuesto es orientativo, no coste confirmado.

Proponer avisos de **USD 2 y USD 5** y revisión diaria de uso. Los [budget alerts de Cloudflare](https://developers.cloudflare.com/billing/manage/budget-alerts/) son para gasto de cuenta, pueden llegar después del consumo y **no pausan ni limitan** el servicio. Poner límites de aplicación de 50 GB totales y tamaño por archivo, cupos por marca, máximo de cargas simultáneas, limpieza de incompletos y bloqueo de nuevas cargas al alcanzar umbral medido; estos controles también requieren validar su comportamiento real en el piloto. No aceptar cargos sin nueva autorización.

## Prueba y reversión autorizables más adelante

Antes de cargar: verificar suscripción aprobada, bucket vacío y privado, región `eu`, token solo de bucket, CORS de origen TEST, variables servidor, marcador Turso TEST y cuota. Cargar **solo** imagen, vídeo y PDF sintéticos; probar multipart interrumpido/reanudado, cancelación, digest, vista previa y GET firmado, caducidad de URL, denegación entre marcas, eliminación y reconciliación. Confirmar que no hay URLs públicas y revisar factura/uso observado. Ninguna prueba debe contener originales comerciales.

Para detener el piloto: bloquear nuevos inicios en la aplicación, abortar cargas en curso, mantener lectura privada de objetos ya asociados hasta migrarlos o eliminarlos conforme a retención, revocar credenciales TEST identificadas y desactivar la integración. **No cambiar a `mock_local` mientras existan referencias R2** sin un plan de acceso o migración, ni eliminar el bucket antes de conciliar activos y versiones. La desactivación de suscripción/bucket requiere autorización específica y una comprobación de impacto.

**Autorización futura sugerida:** «Autorizo activar R2 para un bucket TEST privado en jurisdicción UE, con token limitado al bucket, piloto de hasta 50 GB y pruebas sintéticas; acepto los costes variables indicados. No autorizo producción». Antes de ejecutarla habrá que reconfirmar precios, plan y límites efectivos en la cuenta.

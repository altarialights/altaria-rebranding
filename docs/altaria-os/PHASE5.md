# Altaria OS · Fase 5 · Enlaces QR/NFC en TEST

> Actualización de seguridad de Fase 6 (12/10/2026): el material descargable
> SVG/PNG y el manifiesto con `127.0.0.1` están bloqueados con `409`. La URL
> canónica de impresión queda pendiente y separada de la URL local TEST. La
> vista previa QR lleva «SOLO TEST · NO IMPRIMIR». La redirección ya no espera
> 180 ms por analítica y comprueba el marcador TEST en la misma consulta del
> destino. Nueva medición local: p95 206,8 ms secuencial y 872,2 ms con
> concurrencia 5. Véase [PHASE6.md](PHASE6.md).

## Alcance y operación

El módulo funciona únicamente en la rama `feat/altaria-os`, con `ALTARIA_TEST_ISOLATED=1`, el marcador remoto de `altaria-os-test` y Stripe test. La ruta `/c/{code}` rechaza hosts distintos de `127.0.0.1` y `localhost` y no tiene dominio público. No hay DNS, despliegue, servicio externo nuevo ni envío de comunicaciones. Las URLs imprimibles contienen `127.0.0.1` y son **solo para pruebas locales**; no deben grabarse en tarjetas comerciales.

La migración 013 crea destinos versionados, códigos y agregados; la 014 permite reemplazar un código retirado sin reactivarlo; la 015 añade barreras SQL antes de la verificación física y del envío; la 016 agrega aperturas por revisión histórica de destino. Se aplicaron en `altaria-os-test` después de verificar URL, token, marcador, Stripe test, WorkOS staging y hashes 001–012. Los scripts `altaria-os-phase5-*-migrate.mjs --apply-test` son idempotentes y rechazan CI/Vercel o una base sin marcador. Las migraciones anteriores no se editaron. Véase [SCHEMA.md](../database/SCHEMA.md).

Un propietario aprueba el nombre exacto de un dominio HTTPS por pedido. El servidor rechaza URL con HTTP, credenciales, fragmentos, IP literal, host local, puerto no estándar, claves sensibles en la consulta y caracteres de control. No consulta la URL, por lo que evita solicitudes de servidor hacia el destino. La aprobación manual **no verifica la propiedad ni reputación del dominio**; eso requiere un control adicional antes de publicar. El cambio de URL requiere motivo, revisión y permiso `cards:write`; queda en el historial inmutable y en auditoría. El acceso QR imprimible y el manifiesto requieren `cards:write`; la analítica y las fichas requieren `cards:read`.

El modo compartido tiene un código QR y otro NFC por lote. Los modos individual y destino compartido identificado tienen ambos códigos por unidad. El código aleatorio de 24 bytes (192 bits) permanece al cambiar de destino. Las claves de idempotencia previenen duplicados. Un enlace pausado o retirado responde como uno desconocido. Un código retirado no se puede reactivar: antes de la verificación física se crea un sustituto auditable que exige reimpresión/programación. Si la retirada ocurre después de verificar físicamente o enviar, se debe abrir una incidencia y revisar el trabajo; la aplicación no falsea una nueva comprobación.

La producción exige enlaces QR y NFC activos por unidad/lote antes de registrar las comprobaciones físicas, antes de `ready_to_ship` y otra vez antes de `shipped`. El pago Stripe y el estado comercial no se modifican. Los destinos se gestionan en `/admin/cards/{pedido}/enlaces`, la ficha individual en `/admin/cards/enlaces/{enlace}` y el análisis en `/admin/cards/analitica`.

## Analítica y privacidad

Una apertura es una solicitud HTTP al enlace, no una persona única, venta o reseña. La clase `suspected_bot` se infiere de patrones simples del agente de usuario; el resto queda `unclassified`, nunca se denomina tráfico humano confirmado. No se persisten IP, agentes de usuario, cookies, parámetros de solicitud ni identificadores invasivos. Los disparadores acumulan por enlace/día/clase y por revisión de destino. Las aperturas anteriores a la migración 016 se mantienen como «Destino histórico no clasificado»; nunca se atribuyen al destino actual. La interfaz permite filtrar por empresa CRM vinculada, pedido, campaña, lote, unidad, canal, destino, periodo y clase; compara el periodo seleccionado con el anterior de igual duración y ofrece CSV autorizado. La vista muestra hasta 12 filas; cuando una consulta/exportación supera 2000 filas, exige acotar filtros y evita mostrar cifras parciales. La retención configurable por propietario parte de 30 días para eventos y 400 para agregados; la purga vencida es manual en TEST.

La escritura de métricas tiene un presupuesto de 180 ms y falla sin impedir la redirección. Por ello, ante fallos o cierre de proceso puede faltar alguna apertura. Antes de exposición pública se necesita cola durable o infraestructura equivalente, límite distribuido en el borde, alertas de errores, purga programada y revisión jurídica de privacidad. La barrera local de 600 solicitudes/minuto es global al proceso y solo sirve para TEST.

## QA y rendimiento

`scripts/altaria-os-phase5-qa-fixture.mjs --create-test` creó un pedido claramente marcado `QA SINTÉTICO · NO ENVIAR` con tres lotes, seis códigos y aperturas ficticias; no produjo ningún cargo Stripe ni creó una identidad WorkOS. Permanece en Turso TEST porque el historial de Cards es inmutable. Su identificador local está en `review/altaria-os/phase5/qa-fixture.json` (ignorado por Git). Los tests de integración usan otros registros sintéticos dentro de transacciones revertidas.

`scripts/altaria-os-phase5-benchmark.mjs --run-test` realizó 40 GET secuenciales y 30 con concurrencia 5 al servidor local, sin seguir el destino externo. Resultado final observado: secuencial p50 **243,7 ms**, p95 **281,3 ms**, máximo **289,5 ms**; concurrente p95 **1196,9 ms**, máximo **1242,6 ms**. Se registraron los 71 eventos versionados esperados (incluida una solicitud de calentamiento). Incluye la consulta al Turso TEST remoto y las comprobaciones de aislamiento; no predice la latencia de un despliegue público. Se verificaron 302 temporal, `no-store`, ausencia de referente y respuestas 404 equivalentes para códigos inválidos/desconocidos. La latencia concurrente exige una nueva evaluación antes de publicación.

Las tres pantallas nuevas se comprobaron a 360, 390, 768, 1024 y 1440 px sin desbordamiento de documento. axe WCAG 2.0/2.1 A/AA reportó cero infracciones en esas pantallas tras corregir contraste y foco de regiones desplazables. Las capturas están en `review/altaria-os/phase5/` y quedan fuera de Git.

## Futuras automatizaciones

Telegram y otras automatizaciones pueden consumir, tras una autorización separada, eventos de `cards_destination_history`, `cards_link_status_history`, `cards_link_replacements`, `cards_production_incidents` y agregados diarios. Será necesario un outbox o cursor idempotente con permisos y retención específicos para evitar pérdidas y mensajes repetidos. Esta fase no crea bots, tokens ni envía comunicaciones.

## Pendiente antes de publicación

Faltan un dominio público autorizado, verificación de propiedad/reputación de los destinos, límite distribuido, cola de métricas, purga programada, revisión legal, control de errores, prueba de carga en infraestructura equivalente y un plan para migrar o reimprimir códigos locales TEST. Ningún recurso de esta fase está habilitado en producción.

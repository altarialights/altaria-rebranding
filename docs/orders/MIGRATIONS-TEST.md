# Altaria Cards: preparación de TEST (2026-10-02)

No se ha publicado ni aplicado SQL a producción ni a una base TEST remota.
No se ha identificado todavía una URL/credencial TEST independiente autorizada.

## Qué hace cada migración

- **004_altaria_cards_catalog_and_inquiries.sql**: añade `producto_id`,
  `producto_nombre`, `personalizacion_json` a pedidos, con defaults compatibles con
  el modelo histórico; crea `consultas_tarjetas` y su índice. No cambia importes,
  IDs de Stripe, estados o datos antiguos. No depende de 005.
- **005_card_artwork.sql**: crea originales privados, metadatos, estado de revisión,
  hash de sesión, integridad, encuadre visual, FK a pedido/consulta e índices.
  Depende de `pedidos_tarjetas` (002) y `consultas_tarjetas` (004). Su borrador anterior
  no se aplicó a ninguna base remota; esta revisión no edita una migración aplicada.

Orden: **002 → 003 → 004 → 005**. En una base con 002/003 aplicadas, ejecutar 004
y 005 juntas en una transacción. No ejecutar 005 aislada antes de 004, aunque SQLite
permita declarar una FK cuyo destino todavía no existe. Si hay aplicación parcial
o una versión antigua de 005, detenerse: hace falta inspección y una migración nueva.

## Comprobaciones locales

`python scripts/check-cards-migrations.py` usa exclusivamente SQLite en memoria:
crea el esquema anterior y un pedido histórico; aplica 004/005; compara todos los
campos antiguos; prueba FK e integridad; provoca un fallo intermedio y verifica que
rollback restaura el esquema y pedido originales. No abre `.env` ni Turso.
Los tests de seguridad comprueban aislamiento de sesiones y no autorización por ID.
La compatibilidad remota real con Turso debe comprobarse en TEST antes de producción.

## Preparar y aplicar solo a TEST

1. Crear/identificar una base Turso TEST separada, sin clientes ni claves live.
2. Guardar un snapshot/export y verificar que puede restaurarse en otra base TEST.
3. Usar variables separadas `CARDS_DATABASE_ENV=test`, `CARDS_TEST_DATABASE_URL`,
   `CARDS_TEST_AUTH_TOKEN` en un archivo local privado `.env.test`. No versionarlo.
4. Ejecutar **solo lectura**, sustituyendo la URL por la TEST aprobada:

   `node --env-file=.env.test scripts/prepare-cards-test.mjs --expected-url=URL_TEST`

5. Tras verificar copia y destino, mismo comando con `--apply --backup-confirmed`.
   El script bloquea un destino que coincida con la base activa de `.env`, rechaza
   esquemas parciales/repeticiones y aplica ambas en un batch `immediate` atómico.
6. Verificar columnas, tablas, `PRAGMA foreign_key_check` y `integrity_check`; cargar
   originales ficticios y comprobar asociación/descarga con dos sesiones distintas.
   Stripe TEST y Telegram de pruebas se validan posteriormente; nada live.

No ejecutar el script usando `.env` de producción. No cambiar la configuración
productiva para que apunte temporalmente a TEST.

## Rollback

Antes del commit, un error en 004 o 005 revierte ambas por transacción. Después de
un commit, retirar el código nuevo y restaurar la copia en una base TEST nueva;
verificarla antes de cambiar exclusivamente la configuración de TEST. No eliminar
columnas/tablas a ciegas ni perder solicitudes/archivos creados después del backup:
exportarlos si deben conservarse. Si hay datos útiles, preferir corrección mediante
otra migración append-only. Las migraciones anteriores nunca se reescriben.

## Recuperación interna del original

`node --env-file=.env.test scripts/export-card-artwork.mjs order UUID RUTA_PRIVADA`

También admite `inquiry UUID`. Requiere las credenciales Turso de ese entorno
(`TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`), consulta por FK, verifica SHA-256 y escribe
sin sobrescribir un archivo existente. No imprime credenciales. La ruta de salida
debe ser privada y estar fuera de `public/`. Telegram no es una vía de autenticación:
solo aporta la referencia del pedido. Un futuro panel/URL firmada requiere su propia
autenticación, caducidad y auditoría; no se ha improvisado un enlace público.

Conclusión: aptas para probar en una base TEST aislada tras copia y preflight;
no equivale a autorización ni certificación de despliegue productivo.

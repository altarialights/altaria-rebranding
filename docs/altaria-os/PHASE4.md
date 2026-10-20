# Fase 4 · Cards y producción en TEST

Estado: implementada localmente en `feat/altaria-os`. Sin push ni despliegue.
Migraciones 011 y 012 aplicadas únicamente a `altaria-os-test` y verificadas por
hash y marcador remoto. No se modificó el esquema de producción.

## Flujo

La bandeja `/admin/cards` consulta exclusivamente pedidos `stripe_entorno='test'`.
Permite buscar por número, negocio, cliente o email y filtrar por etapa, fecha y
prioridad. El pedido conserva sus estados de compra y pago; la ficha de producción
tiene etapas independientes. Se inicia solo cuando `pagado_en` y un evento
`pago_confirmado` del webhook existen para un pedido TEST. El servicio y los
triggers de base rechazan el inicio y las transiciones si falta esa evidencia.

Preparación → producción → verificación → listo para envío → enviado → entregado.
Cada avance es consecutivo y usa versión para detectar cambios simultáneos.
Preparación requiere checklist, revisión humana del diseño y lotes que cubran
todas las unidades. Producción requiere registro de impresión y programación NFC.
Listo para envío requiere verificación QR, NFC y física, además de ninguna
incidencia bloqueante abierta. Envío exige transportista y seguimiento; entrega
se registra manualmente. Ninguna comprobación física se marca automáticamente.

Los lotes soportan código compartido, código individual y unidades identificadas
con destino compartido. La clave de idempotencia y el hash de solicitud evitan
reintentos divergentes. Códigos y referencias son internos; aún no existe URL,
destino editable ni servicio público de redirección QR. No se crean facturas ni
se cambia el pago Stripe.

El vínculo pedido–empresa reutiliza `crm_source_links` y su auditoría; se hace
manualmente por el propietario. La ficha muestra diseño, personalización,
incidencias, lotes, unidades, seguimiento e historial. El original solo se
descarga por owner/production desde endpoint autenticado, tras comprobar pedido
TEST pagado e integridad SHA-256; se devuelve como attachment sin caché.

## Seguridad y permisos

- owner: lectura, mutaciones Cards y original; también enlace CRM.
- production: lectura, mutaciones Cards y original.
- viewer: lectura de la ficha, sin mutaciones ni original.
- sales: sin acceso a Cards.

El middleware exige sesión WorkOS y permisos para páginas y APIs. Los POST exigen
origen same-origin y token CSRF específico de Cards. Cada lectura y mutación
Cards vuelve a exigir arranque local aislado, URL Turso TEST fijada, Stripe test
y marcador remoto. Las mutaciones y la descarga original dejan auditoría.

## Aplicación y comprobación

En un entorno local con `.env.test` válido y `.env` productivo separado:

```powershell
node scripts/altaria-os-phase4-migrate.mjs --apply-test
node scripts/altaria-os-phase4-harden.mjs --apply-test
node scripts/altaria-os-phase4-test-verify.mjs --apply-test
pnpm test
pnpm check
pnpm build:isolated
node scripts/altaria-os-secret-scan.mjs --include-build
```

El test de integración inserta usuarios, pedidos y lotes sintéticos dentro de
una transacción que se revierte. Comprueba las tres modalidades, idempotencia,
permisos, pedidos live simulados dentro de TEST, pago sin evento, etapas,
incidencias tardías, seguimiento, CRM, inmutabilidad y auditoría. La suite local
incluye regresión de checkout y Stripe. Se verificó rechazo sin sesión en
`/admin/cards`, API de mutación y endpoint del original.

Capturas de bandeja y ficha: `review/altaria-os/phase4/`, a 360, 390, 768,
1024 y 1440 px. La ficha usó un pedido pendiente de pago marcado
`QA-SINTETICO` y se retiró tras las capturas. La revisión automática con axe del
contenido de ambas páginas terminó sin infracciones. No existe todavía un
pedido Stripe test pagado permanente para una comprobación visual con todas las
etapas desplegadas. Antes de cualquier despliegue hará falta revisar migraciones,
roles, contenido real de pedidos y operación de taller en un staging publicado.

Gmail, QR dinámicos, MCP y despliegue permanecen fuera de esta fase.

# Altaria OS · Fase 2 · CRM central

## Alcance en TEST

El CRM vive bajo `/admin/crm`. Incluye listado y búsqueda de empresas, ficha unificada, contactos, oportunidades, pipeline, actividades, tareas, seguimiento, cronología y vínculos manuales con diagnóstico, consulta Cards y pedido Cards. Los registros históricos permanecen en sus tablas originales. No hay importación automática ni fusión de empresas.

Las etapas son `new → contacted → interested → proposal → negotiation → won`, con salida a `lost` desde cualquier etapa abierta. El servidor comprueba la transición y escribe el evento de etapa, la cronología y la auditoría en la misma transacción. `lost` exige motivo. Las tareas pueden crearse desde una actividad y asociarse a su contacto u oportunidad sin repetir la empresa.

Los roles `owner` y `sales` pueden escribir; `sales` sólo puede leer y modificar las empresas a su cargo. `viewer` sólo consulta. Una tarea u oportunidad sólo se asigna al responsable de la empresa o a un propietario con acceso global. El middleware exige sesión WorkOS staging y permiso para cada página y API. Cada POST exige origen local, CSRF ligado a la sesión y validación de entrada. Las coincidencias fiables se bloquean. Una coincidencia posible exige revisión y confirmación expresa del propietario; `sales` no puede saltarse esa revisión ni enumerar fichas ajenas mediante el detector.

## Esquema y aislamiento

`migrations/008_altaria_os_crm.sql` es append-only. Se aplicó únicamente a `altaria-os-test` después de 001–006 sobre fuentes vacías. 007 y su hash se conservaron. `scripts/altaria-os-phase2-migrate.mjs` exige `--apply-test`, verifica Turso TEST contra la URL aprobada y producción, el marcador remoto, token vigente, Stripe test, WorkOS staging, MFA, Google, alta libre cerrada, inventario de tablas y hashes de migraciones. No se ejecutó en producción.

Las conexiones y secretos se cargan desde `.env.test` ignorado por Git. El arranque local usa `pnpm dev`, que vuelve a comprobar el aislamiento antes de iniciar Astro. Ninguna clave se envía al cliente.

## Pruebas seguras

```powershell
node scripts/altaria-os-test-inspect.mjs
node scripts/altaria-os-phase2-migrate.mjs --apply-test
node scripts/altaria-os-crm-test-verify.mjs --apply-test
$env:ALTARIA_CRM_INTEGRATION_TEST='1'; pnpm exec vitest run --config vitest.crm-test.config.mjs
pnpm test
pnpm check
pnpm build:isolated
```

Los dos ensayos de integración insertan exclusivamente datos sintéticos dentro de transacciones que provocan rollback. Comparan los recuentos anteriores y posteriores, comprueban el marcador TEST y fallan si aparecen datos de negocio inesperados. El primero valida integridad, unicidad y los tres tipos de vínculo. El segundo ejecuta el servicio real de CRM para comprobar deduplicación, búsqueda, transiciones, actividad, tareas, permisos y auditoría.

Se revisaron las cinco vistas con la sesión real del propietario en 360, 390, 768, 1024 y 1440 px. Axe no detectó infracciones WCAG 2 A/AA y 2.1 A/AA en las vistas vacías de 390 y 1440 px. Una maqueta DOM temporal, claramente marcada como sintética y nunca escrita en Turso, permitió revisar las siete etapas simultáneas del pipeline: columnas desplazables en escritorio y lista vertical en móvil.

También se creó en TEST una ficha llamada `QA SINTÉTICA ALTARIA OS 2026-10-08` mediante la interfaz autenticada. Se añadieron un contacto, una oportunidad, una transición de etapa y una llamada con tarea de seguimiento; la tarea se completó desde la ficha. Se capturaron ficha y pipeline poblados en móvil y escritorio y Axe quedó sin infracciones. Después se retiraron únicamente esas filas sintéticas con `review/altaria-os/phase2/cleanup-synthetic-fixture.mjs`, validando nombre exacto, marcador e integridad. Los eventos de auditoría de esas operaciones se conservan por diseño; no contienen secretos ni datos de clientes. Las capturas están en `review/altaria-os/phase2/`, carpeta ignorada por Git.

## Límites deliberados

- La vinculación con una fuente existente exige su UUID verificado de TEST y no cambia la fila original. No se muestra un explorador de datos históricos ni se importan registros de forma masiva.
- Los identificadores escritos manualmente quedan sin verificar; sólo una fuente contrastada puede elevar un identificador a verificado. No hay fusión automática. La tabla de fusiones queda preparada para un flujo futuro con aprobación y auditoría.
- Gmail, propuestas, automatizaciones, agentes, producción Cards y MCP pertenecen a fases posteriores.
- El panel permanece local en TEST. No hay push ni despliegue.

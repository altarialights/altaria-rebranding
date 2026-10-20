# Altaria OS · Fase 6.5B · Sales OS

Fecha: 13/10/2026. Alcance: código local y Turso `altaria-os-test`, rama `feat/altaria-os`. Sin push ni despliegue.

## Resultado

- `/admin/crm/guia-comercial` integra biblioteca, búsqueda, filtros, lectura contextual, copia rápida, edición por versiones, procedencia, revisión del propietario y acciones CRM.
- La migración append-only `018_altaria_os_sales.sql` se aplicó solo tras validar URL TEST, token, Stripe test, WorkOS staging, marcador remoto y SHA-256 de 001–017. Verificación posterior: 001–018 coinciden y `PRAGMA foreign_key_check` devuelve cero incidencias.
- 29 textos **nuevos** cargados de forma idempotente para siete familias de servicios y once categorías. Los 29 están en `review`, ninguno aprobado. La auditoría 6.5A no localizó originales comerciales verificables; por tanto hay **0 textos recuperados**.
- El borrador local se vincula a la versión exacta del texto, empresa y oportunidad. No existe envío en esta fase. Una oposición o bloqueo de canal impide crear un borrador, incluso desde el formulario Gmail previo.
- El motor Fase 6 sugiere conversación y siguiente paso por oportunidad abierta. Cambios de etapa cancelan sugerencias obsoletas; las tareas se crean solo por acción humana con los servicios CRM.
- Una ficha DEMO TEST, una oportunidad y una tarea sintéticas permanecen en Turso TEST para revisar la experiencia contextual. Todos sus rótulos indican DEMO TEST. Las pruebas automatizadas adicionales se revierten mediante transacción.

## Verificación

| Comprobación | Resultado |
|---|---|
| Unitarias | 22 suites, 304 pruebas aprobadas |
| Sales OS TEST | 2 pruebas de validación e integración aprobadas; rollback sintético completo |
| CRM / propuestas / Cards / QR / automatizaciones | Regresiones TEST aprobadas; transacciones sintéticas revertidas |
| TypeScript / Astro | 0 errores |
| Build aislado | Correcto, sin credenciales reales cargadas |
| Axe WCAG A/AA en guía y contexto | 0 infracciones; 29 comprobaciones aprobadas |
| Responsive | 360, 390, 768, 1024 y 1440 px, sin desbordamiento horizontal |
| Secretos y Git | Escaneo de archivos versionables y build sin coincidencias; `git diff --check` correcto |

Capturas: [escritorio](../../review/altaria-os/phase65b-desktop-1440.png), [móvil 360](../../review/altaria-os/phase65b-mobile-360.png), [contexto de empresa](../../review/altaria-os/phase65b-context-desktop.png) y [contexto móvil 390](../../review/altaria-os/phase65b-context-mobile-390.png).

## Límites y siguiente decisión

- El propietario debe revisar y aprobar los 29 textos antes de ofrecerlos como material aprobado al equipo comercial. La guía muestra el estado pendiente de forma explícita.
- La tabla de campañas manuales queda preparada con máximo 20 empresas, pero esta fase no añade una interfaz de campañas ni envíos. La gestión de contactos externos necesita revisión operativa y jurídica antes de uso real.
- Gmail real y Telegram real siguen desconectados. Los borradores son locales; no se enviaron comunicaciones.
- El token Turso TEST está vigente hasta **15/10/2026 14:48:29 UTC**. La renovación requiere autorización específica para una credencial exclusiva de TEST antes de esa fecha.
- No se tocó producción mediante estas acciones. No se hizo push, despliegue, pago ni conexión a Content OS o MCP.

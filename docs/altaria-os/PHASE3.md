# Altaria OS — Fase 3 en TEST

## Entregado localmente

- Editor comercial dentro del CRM: empresa → oportunidad → propuesta → versiones y PDF. Plantillas y catálogo son configurables por el propietario y empiezan vacíos, sin tarifas inventadas.
- Cálculo canónico de EUR en céntimos y redondeo por partida documentado en `docs/database/SCHEMA.md`. Las versiones y partidas no admiten UPDATE/DELETE gracias a la migración 010. Una versión enviada se conserva aunque se prepare otra.
- Estado comercial explícito: marcar como enviada sólo registra un hecho manual y programa una tarea única de seguimiento; aceptación/rechazo piden nota. Una aceptación no crea pedido, pago ni factura. Sólo una oportunidad ya en `negotiation` pasa a `won` por la transición permitida.
- Gmail preparado detrás de una bandera desactivada. OAuth con state, PKCE, identidad Google verificada y refresh token cifrado. Sincronización manual inicial e incremental de mensajes con etiqueta `ALTARIA/CRM`, deduplicación, reintento tras interrupción, asociación conservadora y registro de respuestas. Los borradores se revisan localmente; no hay endpoint de envío.
- Páginas protegidas para lista/editor de propuestas, ficha integrada de empresa, conversación etiquetada y borrador local. Permisos del CRM y CSRF aplican también a las APIs nuevas.

## Aplicación y pruebas

Las migraciones `009_altaria_os_proposals_gmail.sql` y `010_altaria_os_proposal_immutability.sql` se aplicaron exclusivamente a `altaria-os-test`, con marcador remoto, separación de Stripe test/WorkOS staging, hashes y FK comprobados. Para verificar el estado actual: `node scripts/altaria-os-phase3-migrate.mjs --apply-test` y `node scripts/altaria-os-phase3-harden.mjs --apply-test`; ambos son idempotentes una vez aplicados.

La integración sintética usa `node scripts/altaria-os-phase3-test-verify.mjs --apply-test`. Toda inserción queda dentro de una transacción que se revierte deliberadamente; comprueba conteos antes/después y marcador. Incluye permisos de otro usuario, conflicto de versión, triggers de inmutabilidad, seguimiento cancelado, reintento Gmail, deduplicación, error de proveedor y borrador revisado. Los tests unitarios, `pnpm check` y `pnpm build:isolated` se ejecutan sin secretos productivos. Las capturas y un PDF sintético de QA están en `review/altaria-os/phase3/`, excluido de Git; la fixture visual se eliminó de TEST después de capturar.

## Pendiente de recursos TEST

La conexión real Gmail requiere Gmail API, pantalla de consentimiento y alcance restringido `gmail.metadata` descritos en `PHASE3-GMAIL.md`. Se creó el proyecto `altaria-os-gmail-test`, pero Google lo vinculó automáticamente a la cuenta de facturación de prueba. Por decisión del usuario, permanece sin uso. No hay credenciales Gmail en `.env.test`, no se ha accedido a un buzón ni se ha enviado correo. El usuario ha pospuesto crear una cuenta Gmail de prueba independiente; tras reanudar, se deberán verificar identidad `sub`/email, etiqueta, renovación/revocación de token y cuotas. La sincronización sigue siendo manual; no hay servicio programado ni dominio público.

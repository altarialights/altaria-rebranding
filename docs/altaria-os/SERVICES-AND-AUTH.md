# ALTARIA OS — servicios e identidad (investigación del 2026-10-08)

Actualización de Fase 1: se creó una aplicación WorkOS staging gratuita y se integró AuthKit Astro localmente. Google social y MFA TOTP real se verificaron mediante identidad, factor, sesión y eventos; el propietario local sigue pendiente de autorización por correo. Véase [PHASE-1.md](./PHASE-1.md). Las decisiones y pendientes de Fase 0.2 siguientes son históricos.

Se creó únicamente la base Turso `altaria-os-test` dentro del plan Free y se prepararon credenciales Stripe test locales. No se contrató ningún servicio ni se desplegó. Los precios son orientativos, en USD cuando el proveedor los publica así, sin impuestos ni consumo adicional. Deben revisarse de nuevo antes de contratar.

## Proveedores de identidad

Requisitos: Google como método de entrada, MFA **obligatorio** también para las cuentas autorizadas, permisos comprobados en el servidor y un servidor OAuth compatible con el MCP privado de ChatGPT. Los roles de negocio seguirán siendo datos y comprobaciones de Altaria OS, aunque el proveedor ofrezca RBAC. La integración no debe convertir las páginas públicas prerenderizadas en un sitio completamente dinámico.

| Proveedor | Encaje | Precio orientativo | Comprobación pendiente |
|---|---|---|---|
| **WorkOS AuthKit** | Google social, política MFA requerida, RBAC y soporte anunciado de OAuth 2.1 para MCP. Candidato preferente para un equipo interno pequeño. | User Management desde **$0/mes** hasta 1 M de usuarios activos; dominio personalizado **$99/mes** y SSO empresarial **$125/conexión/mes** si se necesitan. | Verificar en un entorno de prueba que la exigencia TOTP se aplica al inicio con Google y que el flujo exacto de ChatGPT acepta su metadata, audiencia y scopes. La documentación indica que la obligación MFA de AuthKit no se aplica a usuarios SSO; no debemos confundir Google social con una conexión SSO. |
| **Auth0** | Google social, MFA, RBAC y registro dinámico de clientes; OpenAI lo documenta como opción para MCP. | Free **$0**; Essentials desde **$35/mes** y Professional desde **$240/mes** en la tabla consultada. El plan concreto depende del caso y límites. | Confirmar qué plan permite exigir el factor elegido a todos los administradores y configurar el acceso de ChatGPT sin habilitar permisos amplios a clientes registrados dinámicamente. |
| **Clerk** | Google social, opción de exigir MFA, OAuth con CIMD/DCR y SDK Astro. | Hobby **$0**, pero la tabla consultada reserva MFA para **Pro**, desde **$20/mes facturado anualmente**. | Su guía Astro propone salida totalmente `server`; comprobar una integración que conserve el prerender público actual. Probar scopes y flujo MCP con ChatGPT. |

Fuentes oficiales: [WorkOS precio](https://workos.com/pricing), [MFA](https://workos.com/docs/authkit/mfa) y [MCP](https://workos.com/mcp); [Auth0 precio](https://auth0.com/pricing) y [DCR](https://auth0.com/docs/get-started/applications/dynamic-client-registration); [Clerk precio](https://clerk.com/pricing), [MFA requerida](https://clerk.com/docs/guides/configure/auth-strategies/sign-up-sign-in-options), [OAuth/CIMD](https://clerk.com/docs/guides/configure/auth-strategies/oauth/how-clerk-implements-oauth) y [Astro](https://clerk.com/docs/reference/astro/overview); [requisitos de OAuth MCP de OpenAI](https://developers.openai.com/plugins/build/auth).

**Recomendación provisional:** evaluar WorkOS primero y Auth0 como alternativa, con una prueba real de Google + MFA + conexión MCP antes de elegir. Ninguno se ha instalado. La autorización por endpoint y la lista cerrada de usuarios residirán en Altaria OS, independientemente del proveedor.

## Recursos externos previstos

| Recurso | Momento y propósito | Coste / condición conocida |
|---|---|---|
| Turso TEST independiente | `altaria-os-test` creada en Free, con token por base válido durante siete días y marcador verificado. Sin migraciones de producto. | [Free $0/mes](https://turso.tech/pricing?frequency=monthly) dentro de cuotas; Developer publicado en **$5.99/mes** si se necesitara, sin contratarlo. |
| Stripe test | `sk_test_` y secreto de listener local `whsec_` obtenidos en la cuenta autorizada. Sin webhook público ni eventos de pago. | Sin cargo por esta configuración; la [documentación de pruebas Stripe](https://docs.stripe.com/testing) separa las pruebas de modo live. |
| Proveedor de identidad + Google Sign-In | Fase 1; proyecto/cliente OAuth de pruebas y cuentas administradoras. | Costes según proveedor de la tabla. El proyecto Google y las credenciales requieren configuración autorizada. |
| Vercel preview aislado | Demostración posterior, con variables TEST y sin dominio productivo. | Depende del plan y del uso. [Hobby](https://vercel.com/docs/plans/hobby) es gratuito sólo para proyectos personales y no comerciales; Pro implica cargo por miembro y consumo. No se desplegó preview. |
| Gmail OAuth | Fase Gmail; proyecto Google separado para test, etiqueta comercial y cuenta autorizada. | El [uso estándar de la API](https://developers.google.com/workspace/gmail/api/reference/quota) se publica sin cargo adicional bajo umbrales; cuotas y facturación pueden cambiar. Scopes de lectura son restringidos y pueden exigir verificación y evaluación de seguridad, con coste y plazo por determinar según excepción aplicable. [Google](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification). |
| Telegram TEST | Fase de avisos; bot/chat distintos de los reales. | [Bots ordinarios gratuitos](https://core.telegram.org/bots/faq) dentro de límites; no se enviarán mensajes en esta fase. |
| Almacenamiento privado PDF | Fase propuestas; PDFs versionados y archivos grandes fuera de Turso. | Proveedor y coste por decidir antes de crear recursos. |
| Dominio `go.altarialights.com` | Fase QR, sólo tras verificar control del dominio. | Sin cambio DNS ahora; posibles costes del proveedor actual por determinar. |
| ChatGPT / MCP | Fase de agentes; conexión OAuth de prueba y validación de herramientas. | Depende del plan y disponibilidad de la cuenta ChatGPT; no se ha contratado ni configurado. |

## Decisiones de usuario antes de la Fase 1

1. Aprobar explícitamente la Fase 1; el entorno TEST local ya está activado, pero esta aprobación aún no se ha concedido.
2. Elegir proveedor de identidad tras validar costes y el flujo Google + MFA + OAuth MCP. Especificar las identidades que podrán entrar y quién será propietario.
3. Autorizar separadamente cualquier proyecto Google, preview Vercel, bot/chat, almacenamiento o configuración DNS cuando llegue su fase.

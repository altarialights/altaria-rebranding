import type { APIRoute } from 'astro';

export const GET: APIRoute = ({ site }) => {
  if (!site) throw new Error('Astro site must be configured to generate llms.txt.');

  const url = (pathname: string) => new URL(pathname, site).href;
  const body = `# Altaria Lights

> Altaria Lights es un estudio digital fundado por Martín Camarero que ayuda a negocios y empresas a construir, mejorar y conectar toda su parte digital.

Trabajamos especialmente con negocios que desarrollan su actividad en el mundo físico y necesitan trasladar, mejorar o ampliar esa actividad mediante tecnología. Combinamos desarrollo web, marketing digital, software a medida, automatización y branding para mejorar su presencia, captación de clientes, operaciones y marca.

No somos exclusivamente una agencia de marketing, una empresa de desarrollo web o una empresa de software. Podemos trabajar distintas áreas digitales de un negocio y conectarlas dentro de una misma estrategia.

## Servicios

- [Todos los servicios](${url('/servicios')}): visión completa de las soluciones digitales de Altaria Lights.
- [Desarrollo web](${url('/desarrollo-web')}): experiencias web modernas orientadas a imagen, conversión, velocidad y facilidad de uso.
- [Marketing digital](${url('/marketing')}): estrategia para ganar visibilidad, construir confianza, captar clientes y mejorar la relación con la audiencia.
- [Software a medida](${url('/software')}): herramientas y automatizaciones para organizar procesos, ahorrar tiempo, reducir errores y operar mejor.
- [Branding](${url('/branding')}): identidades coherentes en entornos digitales y físicos.

## Caso real

- [De Zamorano](${url('/proyectos/de-zamorano')}): digitalización de un restaurante con desarrollo web, reservas online, experiencia móvil, carta digital y SEO local.

## Contacto

- [Contactar con Altaria Lights](${url('/contacto')})
`;

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};

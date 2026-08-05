/**
 * ALTARIA LIGHTS — single source of truth for every string in the hero
 * and in the "Cómo funciona" section.
 *
 * Nothing here is invented data: there are no metrics, no testimonials,
 * no client names beyond the one real case (De Zamorano), and no claimed
 * results. Copy is provisional and meant to be edited here, never inside
 * a component.
 */

export interface FlowNodeContent {
  id: string;
  /** Node label shown in the hero. */
  label: string;
  /** Micro-copy under the label — four words maximum. */
  micro: string;
  /** Body of the floating explanation card on hover/focus. */
  tooltip: string;
  /** Anchor in the "Cómo funciona" section. */
  href: string;
  /** Article heading. */
  stepTitle: string;
  /** Article body. */
  stepBody: string;
}

export const intro = {
  /** Full-bleed opening statement. Two lines, cloud typeface. */
  lines: ['Tu negocio no es uno más.', 'Su imagen tampoco debería serlo.'],
  /** Discreet cue that appears ~1.5 s after load. */
  cue: 'Descubre',
} as const;

export const header = {
  wordmark: 'Altaria Lights',
  nav: [
    { label: 'Servicios', href: '#como-funciona' },
    { label: 'Caso real', href: '#paso-web' },
    { label: 'Proceso', href: '#como-funciona' },
  ],
  cta: { label: 'Hablemos', href: '#contacto' },
} as const;

export const socialBeat = {
  title: ['Nos encargamos', 'de tus redes.'],
  sub: 'Contenido que hace que te miren.',
  /** Accessible description for the reel. */
  reelLabel: 'Ejemplo de reel vertical producido por Altaria Lights',
} as const;

export const webBeat = {
  title: ['Creamos', 'tu página web.'],
  sub: 'Una web que sí representa tu negocio.',
  /**
   * Approved alternative, kept here so switching is a one-line edit:
   *   title: ['Hacemos', 'tu web.'],
   *   sub: 'Para que tu negocio se vea como merece.',
   */
} as const;

export const growthBeat = {
  title: ['Lo conectamos', 'todo.'],
  sub: 'Contenido. Visitas. Web. Reservas.',
} as const;

export const flow: FlowNodeContent[] = [
  {
    id: 'creatividad',
    label: 'Creatividad',
    micro: 'Llamamos la atención.',
    tooltip:
      'Diseñamos contenido y campañas que consiguen que tu negocio deje de pasar desapercibido.',
    href: '#paso-creatividad',
    stepTitle: 'Primero conseguimos atención.',
    stepBody:
      'Definimos el mensaje, la identidad visual y las piezas que hacen que alguien se detenga.',
  },
  {
    id: 'visita',
    label: 'Visita',
    micro: 'Alguien te descubre.',
    tooltip:
      'Conectamos las piezas para atraer a personas que realmente pueden necesitar tus servicios.',
    href: '#paso-visita',
    stepTitle: 'Después atraemos a las personas adecuadas.',
    stepBody:
      'Organizamos campañas, contenido y puntos de entrada para generar visitas con intención.',
  },
  {
    id: 'web',
    label: 'Web',
    micro: 'Generas confianza.',
    tooltip:
      'Construimos una experiencia clara y profesional que convierte curiosidad en confianza.',
    href: '#paso-web',
    stepTitle: 'La web convierte esa visita en confianza.',
    stepBody:
      'Diseñamos una experiencia rápida, clara y profesional que demuestra el valor real del negocio.',
  },
  {
    id: 'reserva',
    label: 'Reserva',
    micro: 'Da el siguiente paso.',
    tooltip:
      'Facilitamos que contactar, comprar o reservar sea rápido, sencillo y medible.',
    href: '#paso-reserva',
    stepTitle: 'Y facilitamos el siguiente paso.',
    stepBody:
      'Contacto, compra, reserva o solicitud: reducimos la fricción y automatizamos lo que tenga sentido.',
  },
];

export const howItWorks = {
  title: ['No son piezas sueltas.', 'Es un sistema.'],
  sub: 'Cada paso prepara el siguiente.',
} as const;

/**
 * Beat boundaries as fractions of the hero scroll track. The GSAP master
 * timeline is normalised to a duration of exactly 1, so these map
 * directly onto scroll progress — and the debug HUD reads the same list.
 */
export const beats = [
  { n: 0, id: 'intro', from: 0.0, to: 0.22, label: 'Apertura de marca' },
  { n: 1, id: 'social', from: 0.22, to: 0.46, label: 'Redes sociales' },
  { n: 2, id: 'web', from: 0.46, to: 0.72, label: 'Página web' },
  { n: 3, id: 'growth', from: 0.72, to: 0.94, label: 'Sistema conectado' },
  { n: 4, id: 'exit', from: 0.94, to: 1.0, label: 'Salida' },
] as const;

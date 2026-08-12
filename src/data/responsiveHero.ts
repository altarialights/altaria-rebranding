import { brandBeat, growthBeat, socialBeat, softwareBeat, webBeat } from './hero';

export type ResponsiveServiceIcon =
  | 'content'
  | 'web'
  | 'software'
  | 'brand'
  | 'connected';

export interface ResponsiveService {
  id: string;
  eyebrow: string;
  title: readonly string[];
  description: string;
  icon: ResponsiveServiceIcon;
  image: {
    src: string;
    srcset: string;
    width: number;
    height: number;
    alt: string;
  };
}

const optimized = '/media/hero-responsive/optimized';

/**
 * Responsive-only editorial model. Tablet keeps the approved narrative
 * order. Mobile starts on Web through the tiny carousel controller while
 * preserving this DOM/reading order.
 */
export const responsiveServices: ResponsiveService[] = [
  {
    id: 'contenido',
    eyebrow: 'Contenido',
    title: socialBeat.title,
    description: socialBeat.sub,
    icon: 'content',
    image: {
      src: `${optimized}/reel-480.webp`,
      srcset: `${optimized}/reel-480.webp 480w, ${optimized}/reel-768.webp 768w`,
      width: 709,
      height: 1317,
      alt: 'Teléfono con un ejemplo de contenido vertical de Altaria Lights',
    },
  },
  {
    id: 'web',
    eyebrow: 'Web',
    title: webBeat.title,
    description: webBeat.sub,
    icon: 'web',
    image: {
      src: `${optimized}/web-480.webp`,
      srcset: `${optimized}/web-480.webp 480w, ${optimized}/web-768.webp 768w`,
      width: 768,
      height: 491,
      alt: 'Portátil con una web diseñada por Altaria Lights',
    },
  },
  {
    id: 'software',
    eyebrow: 'Software',
    title: softwareBeat.title,
    description: softwareBeat.sub,
    icon: 'software',
    image: {
      src: `${optimized}/software-480.webp`,
      srcset: `${optimized}/software-480.webp 480w, ${optimized}/software-768.webp 768w`,
      width: 768,
      height: 561,
      alt: 'Panel de software a medida diseñado por Altaria Lights',
    },
  },
  {
    id: 'marca',
    eyebrow: 'Marca',
    title: brandBeat.title,
    description: brandBeat.sub,
    icon: 'brand',
    image: {
      src: `${optimized}/marca-480.webp`,
      srcset: `${optimized}/marca-480.webp 480w, ${optimized}/marca-768.webp 768w`,
      width: 768,
      height: 552,
      alt: 'Tablero de identidad visual de Altaria Lights',
    },
  },
  {
    id: 'conectado',
    eyebrow: 'Conectado',
    title: growthBeat.title,
    description: growthBeat.sub,
    icon: 'connected',
    image: {
      src: `${optimized}/tu-negocio-480.webp`,
      srcset: `${optimized}/tu-negocio-480.webp 480w, ${optimized}/tu-negocio-768.webp 768w`,
      width: 768,
      height: 712,
      alt: 'Sistema de servicios conectados alrededor de un negocio',
    },
  },
];

export const responsivePrinciples = [
  'Mensaje claro',
  'Diseño coherente',
  'Experiencia rápida',
  'Sistema conectado',
] as const;

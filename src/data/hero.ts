/**
 * ALTARIA LIGHTS — single source of truth for every string in the hero
 * and in the "Cómo funciona" section.
 *
 * Nothing here is invented data: there are no metrics, no testimonials,
 * no client names beyond the one real case (De Zamorano) and no claimed
 * results. Copy is provisional and meant to be edited here, never inside
 * a component.
 *
 * Tone rule for the hero, v8: every headline is two short lines and every
 * subtitle is one short sentence. If a line does not fit in a breath, it
 * is too long for a beat that lasts one scroll.
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
    lines: ["Tu negocio no es uno más.", "Su imagen tampoco debería serlo."],
    /** Discreet cue that appears ~1.5 s after load. */
    cue: "Descubre",
} as const;

export const header = {
    wordmark: "ALTARIA LIGHTS",
    nav: [
        { label: "Servicios", href: "#como-funciona" },
        { label: "Caso real", href: "#paso-web" },
        { label: "Proceso", href: "#como-funciona" },
    ],
    cta: { label: "Hablemos", href: "#contacto" },
} as const;

export const socialBeat = {
    title: ["Hacemos", "que te vean."],
    sub: "Contenido para tus redes.",
    cta: "Quiero más visibilidad",
    /** Accessible description for the reel. */
    reelLabel: "Ejemplo de reel vertical producido por Altaria Lights",
} as const;

export const webBeat = {
    title: ["Creamos", "tu página web."],
    sub: "Una web a tu altura.",
    cta: "Quiero una web así",
} as const;

/**
 * The three states of the visual web demonstration inside the laptop.
 *
 * This is deliberately qualitative: the small dashboard explains that a
 * website can produce measurable outcomes without presenting invented
 * percentages or results as if they belonged to a real Altaria project.
 */
export const embeddedWeb = {
    label: "Demostración visual de una web estratégica que genera confianza, facilita las ventas, construye marca y permite medir resultados.",
    impact: {
        title: ["Tu web habla", "antes que tú."],
        sub: "La primera impresión importa.",
        pillars: [
            { id: "trust", label: "Confianza" },
            { id: "sales", label: "Ventas" },
            { id: "brand", label: "Marca" },
            { id: "results", label: "Resultados" },
        ],
    },
    benefits: {
        title: ["Una buena web", "trabaja por ti."],
        cards: [
            {
                id: "trust",
                title: "Confianza",
                body: "Que entren y confíen.",
            },
            {
                id: "sales",
                title: "Ventas",
                body: "Que visiten y actúen.",
            },
            {
                id: "brand",
                title: "Marca",
                body: "Que te recuerden.",
            },
            {
                id: "results",
                title: "Resultados",
                body: "Que puedas mejorar.",
            },
        ],
    },
    results: {
        title: ["Una web", "convierte."],
        sub: "Más oportunidades, mejor rendimiento.",
        modules: [
            { id: "clicks", label: "Más clics" },
            { id: "contacts", label: "Más contactos" },
            { id: "conversion", label: "Más conversión" },
            { id: "performance", label: "Mejor rendimiento" },
        ],
    },
} as const;

export const softwareBeat = {
    /* Was 'Hacemos software' / 'a medida.'. Two problems: it opened with
     the same verb as the social beat three beats earlier, and at sixteen
     characters it was the longest line in the hero by four — which is
     what set the ceiling on how big every headline could be before it
     ran into the laptop. Shorter, blunter, and it lets the whole set
     grow. */
    title: ["Software", "a tu medida."],
    sub: "Herramientas para tu empresa.",
    cta: "Tengo una idea",
    /** Accessible description for the abstract dashboard. */
    screenLabel:
        "Representación abstracta de un panel de software a medida: módulos, gráficas y código, sin datos reales",
} as const;

export const brandBeat = {
    title: ["Diseñamos", "tu imagen."],
    sub: "Tu marca, de principio a fin.",
    cta: "Quiero mejorar mi marca",
    /** Accessible description for the branding canvas. */
    screenLabel:
        "Identidad visual de Altaria Lights: el logotipo aparece sobre la nube y se presenta junto a su paleta de color",
} as const;

export const growthBeat = {
    title: ["Lo conectamos", "todo."],
    sub: "Contenido. Web. Software. Marca.",
    cta: "Hablemos de mi negocio",
} as const;

/**
 * The five nodes of the closing circuit.
 *
 * Four of them are the four services the hero has just shown, in the
 * order it showed them; the fifth is what the system is FOR. They are
 * laid out as an irregular ring in GrowthBeat.astro and wired into a
 * closed loop, so the last connector returns to the first.
 */
export const flow: FlowNodeContent[] = [
    {
        id: "contenido",
        label: "Contenido",
        micro: "Consigues atención.",
        tooltip: "Producimos y gestionamos el contenido que hace que te vean.",
        href: "#paso-contenido",
        stepTitle: "Primero conseguimos atención.",
        stepBody:
            "Definimos el mensaje y producimos las piezas que hacen que alguien se detenga en lugar de seguir bajando.",
    },
    {
        id: "marca",
        label: "Marca",
        micro: "Te reconocen.",
        tooltip:
            "La imagen completa de tu negocio: símbolo, color, tipografía y aplicaciones.",
        href: "#paso-marca",
        stepTitle: "La imagen sostiene todo lo demás.",
        stepBody:
            "Construimos la identidad visual y las reglas para aplicarla, de modo que todo lo que publiques se reconozca como tuyo.",
    },
    {
        id: "web",
        label: "Web",
        micro: "Generas confianza.",
        tooltip:
            "Una web clara y rápida que convierte la curiosidad en confianza.",
        href: "#paso-web",
        stepTitle: "La web convierte la visita en confianza.",
        stepBody:
            "Diseñamos una experiencia rápida, clara y profesional que demuestra el valor real del negocio.",
    },
    {
        id: "software",
        label: "Software",
        micro: "Trabajas mejor.",
        tooltip:
            "Programas hechos a medida para cómo funciona tu empresa por dentro.",
        href: "#paso-software",
        stepTitle: "Por dentro también hace falta orden.",
        stepBody:
            "Desarrollamos las herramientas internas que tu negocio necesita y automatizamos lo que hoy se hace a mano.",
    },
    {
        id: "contacto",
        label: "Contacto",
        micro: "Da el siguiente paso.",
        tooltip: "Contactar, comprar o reservar: rápido, sencillo y medible.",
        href: "#paso-contacto",
        stepTitle: "Y el siguiente paso es fácil.",
        stepBody:
            "Contacto, compra, reserva o solicitud: reducimos la fricción y automatizamos lo que tenga sentido.",
    },
];

export const howItWorks = {
    title: ["No son piezas sueltas.", "Es un sistema."],
    sub: "Cada paso prepara el siguiente.",
} as const;

/**
 * The signature hidden in the sun.
 *
 * `label` is what a screen reader announces on the control itself — it
 * has to describe the button without giving the joke away to people who
 * are simply tabbing through, so it says what it is, not what it says.
 */
export const sunSignature = {
    label: "El sol",
    intro: "Somos Altaria Lights y...",
    line: ["NO DECORAMOS,", "HACEMOS MARCA."],
    encore: "Parece que te gustó lo del Sol 😂",
} as const;

/**
 * Beat boundaries as fractions of the hero scroll track. The GSAP master
 * timeline is normalised to a duration of exactly 1, so these map
 * directly onto scroll progress — and the debug HUD reads the same list.
 *
 * v8 has FIVE service beats instead of three. `--hero-scroll` was raised
 * to 820vh at the same time so each beat keeps roughly the absolute
 * amount of scrolling it had before: the choreography is not compressed,
 * the track is longer.
 */
export const beats = [
    { n: 0, id: "intro", from: 0.0, to: 0.115, label: "Apertura de marca" },
    { n: 1, id: "social", from: 0.115, to: 0.275, label: "Contenido y redes" },
    { n: 2, id: "web", from: 0.275, to: 0.48, label: "Página web" },
    { n: 3, id: "software", from: 0.48, to: 0.635, label: "Software a medida" },
    { n: 4, id: "brand", from: 0.635, to: 0.775, label: "Imagen de marca" },
    { n: 5, id: "system", from: 0.775, to: 0.945, label: "Sistema conectado" },
    { n: 6, id: "exit", from: 0.945, to: 1.0, label: "Salida" },
] as const;

/**
 * Desktop/full boundaries after inserting 540vh of useful travel into
 * the open-laptop beat. Compact and reduced motion intentionally keep
 * `beats` above and the original 1120vh track.
 */
export const beatsFull = [
    { n: 0, id: "intro", from: 0.0, to: 0.075192, label: "Apertura de marca" },
    {
        n: 1,
        id: "social",
        from: 0.075192,
        to: 0.179808,
        label: "Contenido y redes",
    },
    { n: 2, id: "web", from: 0.179808, to: 0.66, label: "Página web" },
    {
        n: 3,
        id: "software",
        from: 0.66,
        to: 0.761346,
        label: "Software a medida",
    },
    {
        n: 4,
        id: "brand",
        from: 0.761346,
        to: 0.852885,
        label: "Imagen de marca",
    },
    {
        n: 5,
        id: "system",
        from: 0.852885,
        to: 0.964038,
        label: "Sistema conectado",
    },
    { n: 6, id: "exit", from: 0.964038, to: 1.0, label: "Salida" },
] as const;

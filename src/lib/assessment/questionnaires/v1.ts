import type {
  AssessmentDimension,
  MaturityLevel,
  QuestionKey,
  Recommendation,
} from '../types';

export type RecommendationBand = 'critical' | 'developing' | 'solid' | 'advanced';

export interface QuestionDefinition {
  key: QuestionKey;
  text: string;
  allowNotApplicable: boolean;
}

export interface DimensionDefinition {
  key: AssessmentDimension;
  label: string;
  shortLabel: string;
  intro: string;
  weight: number;
  questions: readonly QuestionDefinition[];
  recommendations: Readonly<Record<RecommendationBand, Recommendation>>;
}

export interface MaturityDefinition {
  key: MaturityLevel;
  min: number;
  max: number;
  label: string;
  copy: string;
}

const presenceRecommendations: Readonly<Record<RecommendationBand, Recommendation>> = {
  critical: {
    title: 'La presencia digital está por debajo del nivel del negocio.',
    detected: 'La web, la claridad del mensaje o la medición parecen necesitar una revisión de base.',
    whyItMatters: 'La primera impresión digital condiciona la confianza y puede hacer perder oportunidades antes de que exista una conversación.',
    reviewFirst: ['propuesta de valor de la web', 'experiencia móvil y velocidad', 'acciones de contacto y analítica'],
  },
  developing: {
    title: 'La base existe, pero la experiencia todavía tiene fricciones.',
    detected: 'Hay piezas funcionales que no parecen trabajar con la misma claridad o eficacia.',
    whyItMatters: 'Pequeñas fricciones acumuladas reducen la comprensión, la confianza y la conversión.',
    reviewFirst: ['jerarquía del mensaje', 'recorridos de conversión', 'medición por canal'],
  },
  solid: {
    title: 'La presencia digital es sólida y puede afinarse.',
    detected: 'La web acompaña razonablemente al negocio, con oportunidades concretas de optimización.',
    whyItMatters: 'Una base sólida permite mejorar conversión y medición sin rehacerlo todo.',
    reviewFirst: ['páginas de mayor intención', 'rendimiento real', 'calidad de eventos analíticos'],
  },
  advanced: {
    title: 'La presencia digital está bien alineada.',
    detected: 'Tus respuestas reflejan claridad, facilidad de uso y capacidad de medición.',
    whyItMatters: 'El siguiente retorno suele venir de optimizaciones específicas, no de una reconstrucción general.',
    reviewFirst: ['experimentos de conversión', 'segmentación de mensajes', 'mejora continua de rendimiento'],
  },
};

const acquisitionRecommendations: Readonly<Record<RecommendationBand, Recommendation>> = {
  critical: {
    title: 'La captación depende de esfuerzos poco previsibles.',
    detected: 'Faltan canales recurrentes, trazabilidad o un proceso estable de seguimiento comercial.',
    whyItMatters: 'Sin un sistema de captación medible, el crecimiento depende demasiado de acciones puntuales o del boca a boca.',
    reviewFirst: ['fuentes actuales de oportunidades', 'seguimiento de leads', 'dependencia de un único canal'],
  },
  developing: {
    title: 'Hay actividad de captación, pero todavía está fragmentada.',
    detected: 'Algunos canales funcionan, aunque objetivos, atribución y seguimiento no parecen totalmente conectados.',
    whyItMatters: 'La fragmentación dificulta saber dónde invertir tiempo y presupuesto.',
    reviewFirst: ['objetivo por canal', 'atribución básica', 'proceso de seguimiento'],
  },
  solid: {
    title: 'La captación tiene una base consistente.',
    detected: 'Existen canales y procesos útiles, con margen para ganar previsibilidad.',
    whyItMatters: 'Una mejor lectura del embudo ayuda a escalar lo que funciona y retirar lo que no.',
    reviewFirst: ['conversión por canal', 'calidad del lead', 'diversificación rentable'],
  },
  advanced: {
    title: 'La captación parece sistemática y medible.',
    detected: 'Tus respuestas muestran recurrencia, trazabilidad y seguimiento comercial.',
    whyItMatters: 'El reto pasa de crear el sistema a optimizar eficiencia y calidad.',
    reviewFirst: ['coste de oportunidad', 'automatización del seguimiento', 'experimentación por segmento'],
  },
};

const brandRecommendations: Readonly<Record<RecommendationBand, Recommendation>> = {
  critical: {
    title: 'La percepción digital puede estar restando valor al negocio.',
    detected: 'La identidad, el mensaje o los materiales no parecen representar de forma consistente el nivel real de la empresa.',
    whyItMatters: 'Una percepción débil obliga a justificar más el precio y reduce confianza antes del contacto.',
    reviewFirst: ['coherencia visual', 'diferenciación', 'fotografía, textos y materiales comerciales'],
  },
  developing: {
    title: 'La marca tiene elementos valiosos, pero no siempre habla con una sola voz.',
    detected: 'La coherencia entre canales o la diferenciación todavía puede reforzarse.',
    whyItMatters: 'La inconsistencia hace que una empresa sólida parezca menos madura de lo que es.',
    reviewFirst: ['sistema visual', 'mensajes clave', 'consistencia entre puntos de contacto'],
  },
  solid: {
    title: 'La marca transmite una percepción profesional.',
    detected: 'Existe una base coherente con oportunidades de diferenciación y refinamiento.',
    whyItMatters: 'Una marca sólida puede convertir mejor cuando hace más específica su promesa.',
    reviewFirst: ['territorio diferencial', 'casos y evidencias', 'aplicaciones comerciales'],
  },
  advanced: {
    title: 'La marca está bien alineada con la experiencia real.',
    detected: 'Identidad, comunicación y percepción parecen trabajar de forma coherente.',
    whyItMatters: 'El valor está en proteger la consistencia mientras la empresa crece.',
    reviewFirst: ['gobernanza de marca', 'nuevos formatos', 'consistencia en equipos y proveedores'],
  },
};

const operationsRecommendations: Readonly<Record<RecommendationBand, Recommendation>> = {
  critical: {
    title: 'Demasiado trabajo depende todavía de procesos manuales.',
    detected: 'Una parte importante de la operativa podría estar consumiendo tiempo en tareas repetitivas, duplicación de información o procesos poco centralizados.',
    whyItMatters: 'El trabajo manual aumenta errores, tiempos de respuesta y dependencia de personas concretas.',
    reviewFirst: ['tareas repetitivas', 'duplicación de datos', 'procesos por email, WhatsApp u hojas de cálculo', 'automatizaciones de alto retorno'],
  },
  developing: {
    title: 'La operativa funciona, pero depende de varios remiendos.',
    detected: 'Existen procesos útiles que todavía requieren pasos manuales o búsquedas innecesarias.',
    whyItMatters: 'A medida que crece el volumen, estos puntos se convierten en cuellos de botella.',
    reviewFirst: ['traspasos entre herramientas', 'documentación crítica', 'cuadro de mando operativo'],
  },
  solid: {
    title: 'La operación tiene una base ordenada.',
    detected: 'Los procesos principales parecen controlados, con margen para automatizar y medir mejor.',
    whyItMatters: 'Optimizar los puntos de mayor frecuencia libera capacidad sin añadir estructura innecesaria.',
    reviewFirst: ['procesos de alta frecuencia', 'alertas y excepciones', 'indicadores accesibles'],
  },
  advanced: {
    title: 'La operativa digital parece preparada para escalar.',
    detected: 'Automatización, documentación e información están razonablemente conectadas.',
    whyItMatters: 'La prioridad es evitar complejidad accidental y mantener el sistema comprensible.',
    reviewFirst: ['mantenimiento de automatizaciones', 'calidad de procesos', 'eliminación de herramientas redundantes'],
  },
};

const technologyRecommendations: Readonly<Record<RecommendationBand, Recommendation>> = {
  critical: {
    title: 'La tecnología puede estar actuando como freno.',
    detected: 'Las herramientas parecen poco conectadas, difíciles de adaptar o insuficientes para el crecimiento previsto.',
    whyItMatters: 'Un stack mal ajustado multiplica trabajo manual y limita decisiones basadas en datos.',
    reviewFirst: ['mapa de herramientas', 'integraciones críticas', 'seguridad y acceso a datos', 'necesidades no cubiertas'],
  },
  developing: {
    title: 'El stack resuelve el día a día, pero no funciona como sistema.',
    detected: 'Hay herramientas adecuadas que todavía comparten poca información o generan límites operativos.',
    whyItMatters: 'Las desconexiones tecnológicas terminan trasladándose a personas y procesos.',
    reviewFirst: ['integraciones prioritarias', 'fuentes maestras de datos', 'límites del software actual'],
  },
  solid: {
    title: 'La tecnología acompaña razonablemente al negocio.',
    detected: 'Las herramientas cubren las necesidades principales y permiten evolucionar.',
    whyItMatters: 'Una arquitectura clara permite añadir capacidad sin crear deuda innecesaria.',
    reviewFirst: ['escalabilidad', 'calidad del dato', 'automatizaciones entre sistemas'],
  },
  advanced: {
    title: 'La tecnología parece ser una ventaja operativa.',
    detected: 'Sistemas, datos y capacidad de adaptación están bien alineados.',
    whyItMatters: 'La oportunidad está en mantener esa ventaja con decisiones simples y gobernadas.',
    reviewFirst: ['observabilidad', 'gobierno de datos', 'hoja de ruta tecnológica'],
  },
};

export const questionnaireV1 = {
  version: 'v1',
  responseScale: {
    1: 'Nada cierto en nuestra empresa',
    2: 'Poco cierto',
    3: 'Parcialmente cierto',
    4: 'Bastante cierto',
    5: 'Totalmente cierto',
  },
  minimumValidAnswersPerDimension: 3,
  disclaimer: 'Este índice es una herramienta orientativa basada en las respuestas proporcionadas. Una revisión específica puede detectar factores que el cuestionario no contempla.',
  maturityLevels: [
    { key: 'IMPORTANT_DIGITAL_DEBT', min: 0, max: 39, label: 'Deuda digital importante', copy: 'El negocio parece estar funcionando claramente por delante de parte de su infraestructura digital.' },
    { key: 'FRAGMENTED_DIGITIZATION', min: 40, max: 59, label: 'Digitalización fragmentada', copy: 'Existen buenas piezas, pero todavía hay desconexiones o áreas con margen claro de mejora.' },
    { key: 'SOLID_DIGITAL_BASE', min: 60, max: 79, label: 'Base digital sólida', copy: 'La empresa cuenta con una buena base, aunque todavía existen oportunidades relevantes para mejorar.' },
    { key: 'HIGH_DIGITAL_MATURITY', min: 80, max: 100, label: 'Madurez digital alta', copy: 'La parte digital parece estar razonablemente alineada con el nivel del negocio.' },
  ] satisfies readonly MaturityDefinition[],
  dimensions: [
    {
      key: 'presence', label: 'Presencia digital', shortLabel: 'Presencia', weight: 0.2,
      intro: 'Cómo representa y funciona tu empresa en sus puntos de contacto digitales.',
      questions: [
        { key: 'P1', text: 'Nuestra web representa correctamente el nivel actual de la empresa.', allowNotApplicable: true },
        { key: 'P2', text: 'Una persona que llega por primera vez entiende rápidamente qué hacemos, para quién y por qué elegirnos.', allowNotApplicable: true },
        { key: 'P3', text: 'Nuestra experiencia digital funciona bien en móvil y es rápida y sencilla de utilizar.', allowNotApplicable: true },
        { key: 'P4', text: 'Acciones importantes como contactar, reservar, comprar o solicitar información son fáciles de completar.', allowNotApplicable: true },
        { key: 'P5', text: 'Podemos medir qué hacen los usuarios en nuestra web y qué canales generan oportunidades.', allowNotApplicable: true },
      ], recommendations: presenceRecommendations,
    },
    {
      key: 'acquisition', label: 'Captación', shortLabel: 'Captación', weight: 0.2,
      intro: 'Cómo llegan, se miden y se trabajan las oportunidades comerciales.',
      questions: [
        { key: 'C1', text: 'Tenemos canales digitales que generan oportunidades comerciales de forma recurrente.', allowNotApplicable: true },
        { key: 'C2', text: 'Nuestro contenido y nuestras redes tienen objetivos empresariales claros, no únicamente visibilidad.', allowNotApplicable: true },
        { key: 'C3', text: 'Sabemos de dónde llegan nuestros leads y clientes.', allowNotApplicable: true },
        { key: 'C4', text: 'Existe un proceso claro para hacer seguimiento de las oportunidades comerciales.', allowNotApplicable: true },
        { key: 'C5', text: 'Nuestra captación no depende excesivamente de un único canal o del boca a boca.', allowNotApplicable: true },
      ], recommendations: acquisitionRecommendations,
    },
    {
      key: 'brand', label: 'Marca y percepción', shortLabel: 'Marca', weight: 0.2,
      intro: 'La coherencia entre lo que la empresa es y lo que transmite.',
      questions: [
        { key: 'M1', text: 'Nuestra identidad visual es coherente entre web, redes, documentos y puntos físicos.', allowNotApplicable: true },
        { key: 'M2', text: 'Nuestra marca representa correctamente el nivel actual de la empresa.', allowNotApplicable: true },
        { key: 'M3', text: 'Nuestra comunicación permite diferenciarnos claramente de competidores similares.', allowNotApplicable: true },
        { key: 'M4', text: 'Fotografías, textos, materiales comerciales y contenido transmiten una imagen profesional.', allowNotApplicable: true },
        { key: 'M5', text: 'La percepción digital de la empresa está a la altura de la experiencia real que recibe el cliente.', allowNotApplicable: true },
      ], recommendations: brandRecommendations,
    },
    {
      key: 'operations', label: 'Operaciones', shortLabel: 'Operaciones', weight: 0.2,
      intro: 'Cómo fluye el trabajo, la información y la medición interna.',
      questions: [
        { key: 'O1', text: 'Las tareas repetitivas están automatizadas cuando hacerlo aporta valor.', allowNotApplicable: true },
        { key: 'O2', text: 'Evitamos introducir manualmente la misma información en varias herramientas.', allowNotApplicable: true },
        { key: 'O3', text: 'La información importante está centralizada y puede localizarse fácilmente.', allowNotApplicable: true },
        { key: 'O4', text: 'Los procesos importantes están suficientemente documentados y no dependen únicamente de una persona.', allowNotApplicable: true },
        { key: 'O5', text: 'Podemos consultar el estado del negocio y sus principales indicadores sin tener que recopilar información manualmente.', allowNotApplicable: true },
      ], recommendations: operationsRecommendations,
    },
    {
      key: 'technology', label: 'Tecnología', shortLabel: 'Tecnología', weight: 0.2,
      intro: 'El encaje de herramientas, datos e infraestructura con el negocio.',
      questions: [
        { key: 'T1', text: 'El software que utilizamos se adapta razonablemente a cómo funciona realmente nuestra empresa.', allowNotApplicable: true },
        { key: 'T2', text: 'Nuestras principales herramientas comparten información entre sí cuando es necesario.', allowNotApplicable: true },
        { key: 'T3', text: 'Los datos relevantes están organizados, protegidos y accesibles para las personas adecuadas.', allowNotApplicable: true },
        { key: 'T4', text: 'Podemos adaptar o desarrollar herramientas internas cuando las soluciones genéricas no cubren nuestras necesidades.', allowNotApplicable: true },
        { key: 'T5', text: 'Los sistemas actuales pueden acompañar el crecimiento de la empresa sin convertirse en un freno.', allowNotApplicable: true },
      ], recommendations: technologyRecommendations,
    },
  ] satisfies readonly DimensionDefinition[],
} as const;

export const QUESTION_KEYS = questionnaireV1.dimensions.flatMap((dimension) =>
  dimension.questions.map((question) => question.key),
);

export const getDimensionDefinition = (dimension: AssessmentDimension): DimensionDefinition => {
  const definition = questionnaireV1.dimensions.find((item) => item.key === dimension);
  if (!definition) throw new Error(`Unknown assessment dimension: ${dimension}`);
  return definition;
};

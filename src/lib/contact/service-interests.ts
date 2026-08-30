export const SERVICE_INTEREST_STORAGE_KEY = "altaria_service_interests";

export const WHATSAPP_BASE_URL = "https://wa.me/34619132563";

export const CONTACT_EMAIL = "altarialights@gmail.com";

export const GMAIL_COMPOSE_BASE_URL =
    "https://mail.google.com/mail/?view=cm&fs=1";

export const serviceInterestLabels = {
    marketing: "marketing digital",

    "desarrollo-web": "desarrollo web",

    software: "software a medida",

    branding: "branding",

    servicios: "los servicios de Altaria Lights",
} as const;

export type ServiceInterest = keyof typeof serviceInterestLabels;

export function isServiceInterest(
    value: string | null | undefined,
): value is ServiceInterest {
    return Boolean(value && value in serviceInterestLabels);
}

export function readServiceInterests(): ServiceInterest[] {
    if (typeof window === "undefined") return [];

    try {
        const stored = JSON.parse(
            window.sessionStorage.getItem(SERVICE_INTEREST_STORAGE_KEY) ?? "[]",
        );

        return Array.isArray(stored)
            ? stored.filter(
                  (value, index, values): value is ServiceInterest =>
                      typeof value === "string" &&
                      isServiceInterest(value) &&
                      values.indexOf(value) === index,
              )
            : [];
    } catch {
        return [];
    }
}

function storeServiceInterests(interests: readonly ServiceInterest[]): void {
    if (typeof window === "undefined") return;

    try {
        window.sessionStorage.setItem(
            SERVICE_INTEREST_STORAGE_KEY,
            JSON.stringify([...interests]),
        );
    } catch {
        // The generic WhatsApp message remains available when storage is unavailable.
    }
}

export function recordServiceInterest(interest: ServiceInterest): void {
    const interests = readServiceInterests();

    if (interests.includes(interest)) return;

    storeServiceInterests([...interests, interest]);
}

export function collectServiceInterests(search = ""): ServiceInterest[] {
    const explicit = new URLSearchParams(search)
        .getAll("interes")
        .flatMap((value) => value.split(","))
        .map((value) => value.trim())
        .filter(isServiceInterest);

    const combined = [
        ...new Set<ServiceInterest>([...explicit, ...readServiceInterests()]),
    ];

    const interests =
        combined.length > 1
            ? combined.filter((interest) => interest !== "servicios")
            : combined;

    storeServiceInterests(interests);

    return interests;
}

function formatSpanishList(items: readonly string[]): string {
    if (items.length < 2) return items[0] ?? "";

    if (items.length === 2) {
        return `${items[0]} y ${items[1]}`;
    }

    return `${items.slice(0, -1).join(", ")} y ${items.at(-1)}`;
}

function uniqueServiceInterests(
    interests: readonly ServiceInterest[],
): ServiceInterest[] {
    return [...new Set(interests)];
}

export function createWhatsAppMessage(
    interests: readonly ServiceInterest[],
): string {
    const unique = uniqueServiceInterests(interests);

    if (unique.length === 0) {
        return "Hola, he estado viendo vuestra web y me gustaría contaros mi proyecto para ver cómo podéis ayudarme.";
    }

    if (unique.length === 1 && unique[0] === "software") {
        return "Hola, he estado viendo vuestra web y me gustaría hablar con vosotros sobre software a medida.";
    }

    if (unique.length === 1 && unique[0] === "servicios") {
        return "Hola, he estado viendo vuestra web y me gustaría que me contarais más sobre vuestros servicios.";
    }

    if (unique.length === 1) {
        return `Hola, he estado viendo vuestra web y me gustaría que me contarais más sobre el servicio de ${serviceInterestLabels[unique[0]]}.`;
    }

    const labels = unique.map((interest) => serviceInterestLabels[interest]);

    return `Hola, he estado viendo vuestra web y me gustaría que me contarais más sobre los servicios de ${formatSpanishList(labels)}.`;
}

export function createWhatsAppUrl(
    interests: readonly ServiceInterest[],
): string {
    return `${WHATSAPP_BASE_URL}?text=${encodeURIComponent(
        createWhatsAppMessage(interests),
    )}`;
}

const emailSubjectByInterest: Record<ServiceInterest, string> = {
    "desarrollo-web":
        "Quiero trabajar con vosotros en desarrollo web — Altaria Lights",

    marketing:
        "Quiero trabajar con vosotros en marketing digital — Altaria Lights",

    software:
        "Quiero trabajar con vosotros en software a medida — Altaria Lights",

    branding: "Quiero trabajar con vosotros en branding — Altaria Lights",

    servicios: "Quiero trabajar con Altaria Lights",
};

const emailContextByInterest: Record<ServiceInterest, string> = {
    "desarrollo-web":
        "He estado viendo vuestro servicio de desarrollo web y creo que encaja con lo que necesito. Me gustaría trabajar con vosotros para llevar mi proyecto al siguiente nivel.",

    marketing:
        "He estado viendo vuestro servicio de marketing digital y creo que podéis ayudarme a hacer crecer mi negocio. Me gustaría trabajar con vosotros para definir una estrategia que tenga sentido.",

    software:
        "He estado viendo vuestro servicio de software a medida y tengo una idea o proceso que me gustaría desarrollar con vosotros.",

    branding:
        "He estado viendo vuestro servicio de branding y me gustaría trabajar con vosotros para construir o mejorar la imagen de mi marca.",

    servicios:
        "He estado viendo vuestros servicios y creo que podéis ayudarme con mi proyecto. Me gustaría trabajar con vosotros y valorar qué solución tendría más sentido.",
};

export function createEmailSubject(
    interests: readonly ServiceInterest[],
): string {
    const unique = uniqueServiceInterests(interests);

    if (unique.length === 0) {
        return "Quiero trabajar con Altaria Lights";
    }

    if (unique.length === 1) {
        return emailSubjectByInterest[unique[0]];
    }

    return "Quiero trabajar con vosotros en mi proyecto — Altaria Lights";
}

export function createEmailBody(interests: readonly ServiceInterest[]): string {
    const unique = uniqueServiceInterests(interests);

    let context =
        "He estado viendo vuestra web y creo que podéis ayudarme con mi proyecto. Me gustaría trabajar con vosotros y contaros un poco mejor lo que tengo en mente.";

    if (unique.length === 1) {
        context = emailContextByInterest[unique[0]];
    } else if (
        unique.length === 2 &&
        unique.includes("marketing") &&
        unique.includes("branding")
    ) {
        context =
            "He estado viendo vuestros servicios de marketing digital y branding y creo que ambos encajan con lo que necesito. Me gustaría trabajar con vosotros para construir una estrategia y una imagen más sólidas para mi negocio.";
    } else if (unique.length > 1) {
        context =
            "He estado viendo varios de vuestros servicios y creo que podéis ayudarme a llevar mi proyecto más lejos. Me gustaría trabajar con vosotros y valorar qué combinación tendría más sentido.";
    }

    return [
        "¡Hola Altaria!",
        "",
        context,
        "",
        "Me llamo...",
        "[Tu nombre]",
        "",
        "Mi número de teléfono es...",
        "[Tu número de teléfono]",
        "",
        "Mi empresa o proyecto es...",
        "[Nombre de tu empresa o proyecto]",
        "",
        "Lo que necesito es...",
        "[Cuéntanos brevemente qué quieres crear, mejorar o solucionar]",
        "",
        "Mi principal objetivo es...",
        "[Ej.: conseguir más clientes, mejorar mi imagen, automatizar procesos, vender más...]",
        "",
        "También creo que es importante que sepáis...",
        "[Opcional]",
        "",
        "¡Hablamos pronto!",
    ].join("\n");
}

export function createGmailUrl(interests: readonly ServiceInterest[]): string {
    return [
        GMAIL_COMPOSE_BASE_URL,
        `&to=${encodeURIComponent(CONTACT_EMAIL)}`,
        `&su=${encodeURIComponent(createEmailSubject(interests))}`,
        `&body=${encodeURIComponent(createEmailBody(interests))}`,
    ].join("");
}

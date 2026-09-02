export const SITE_NAME = "Altaria Lights";
export const SITE_LANGUAGE = "es-ES";
export const DEFAULT_OG_IMAGE_PATH = "/brand/optimized/altaria-og-v2.png";
export const DEFAULT_ROBOTS =
    "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1";

export type JsonLd = Record<string, unknown>;

export const normalizePathname = (pathname: string): string => {
    const cleanPath = pathname.split(/[?#]/, 1)[0] || "/";
    if (cleanPath === "/") return "/";
    return `/${cleanPath.replace(/^\/+|\/+$/g, "")}`;
};

export const absoluteUrl = (pathname: string, site: URL): string =>
    new URL(normalizePathname(pathname), site).href;

export const createOrganizationSchema = (site: URL): JsonLd => ({
    "@type": "Organization",
    "@id": new URL("/#organization", site).href,
    name: SITE_NAME,
    url: new URL("/", site).href,
    logo: {
        "@type": "ImageObject",
        url: new URL("/brand/optimized/altaria-v2-icon-512.png", site).href,
        width: 512,
        height: 512,
    },
    email: "altarialights@gmail.com",
    description:
        "Estudio digital fundado por Martín Camarero que ayuda a negocios y empresas a construir, mejorar y conectar su parte digital mediante desarrollo web, marketing, software, automatización y branding.",
    founder: {
        "@type": "Person",
        name: "Martín Camarero",
    },
});

export const createWebsiteSchema = (site: URL): JsonLd => ({
    "@type": "WebSite",
    "@id": new URL("/#website", site).href,
    url: new URL("/", site).href,
    name: SITE_NAME,
    inLanguage: SITE_LANGUAGE,
    publisher: { "@id": new URL("/#organization", site).href },
});

export const createServiceSchema = (
    site: URL,
    pathname: string,
    name: string,
    description: string,
    serviceType: string,
): JsonLd => {
    const url = absoluteUrl(pathname, site);

    return {
        "@type": "Service",
        "@id": `${url}#service`,
        name,
        description,
        serviceType,
        url,
        provider: { "@id": new URL("/#organization", site).href },
        areaServed: "España",
    };
};

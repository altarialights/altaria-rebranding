# Altaria Lights — Hero v4

Experiencia de hero desktop construida con Astro y GSAP ScrollTrigger, más la
sección **«Cómo funciona»** a la que enlazan los nodos del sistema.

> **Higgsfield no ha sido invocado en ningún momento.** Cero generaciones,
> cero créditos. Todas las nubes son *placeholders* en CSS, claramente
> marcados y sustituibles sin reescribir componentes.

---

## Requisitos

- **Node.js 20 o superior** (probado en 22.22).
- npm 10 o superior.

## Instalación

```bash
npm install
```

## Ejecución en desarrollo

```bash
npm run dev          # http://localhost:4321
```

## Build de producción

```bash
npm run build        # genera dist/
npm run preview      # sirve dist/ en http://localhost:4321
npm run check        # astro check — 0 errores
```

## Capturas de revisión

```bash
# terminal 1
npm run build && npm run preview
# terminal 2
npm run shoot
```

Las imágenes se escriben en **`review/`**. No son assets del sitio: están
excluidas de git a propósito, porque se regeneran con un comando.

---

## Estructura

```
src/
  data/
    hero.ts                    ← TODO el copy y las fronteras de beat
  components/
    hero/
      HeroExperience.astro     Stage sticky + planos de profundidad
      IntroStatement.astro     Frase de apertura y su disolución
      FloatingHeader.astro     Header cápsula (entra tras la frase)
      SocialBeat.astro         Texto del beat de redes
      WebBeat.astro            Texto del beat de web
      GrowthBeat.astro         Texto + clúster de nodos
      DevicePhone.astro        Móvil sin marca (CSS 3D)
      DeviceLaptop.astro       Portátil sin marca (CSS 3D)
      FlowNode.astro           Nodo interactivo (enlace real)
      FlowTooltip.astro        Tarjeta explicativa flotante
      CloudLayers.astro        Placeholders HG-01/02/03/04
      Sky.astro                Cielo y sol, 100 % CSS
      HeroDebugOverlay.astro   Capas de depuración B y G
    sections/
      HowItWorks.astro         Destino de los nodos
    ScreenDeZamorano.astro     Pantalla del portátil (USR-01)
  scripts/
    hero-timeline.ts           Timeline maestra GSAP
    flow-interactions.ts       Hover, focus, Escape, scroll y resaltado
  styles/
    tokens.css                 Geometría de escena y cajas de asset
    fonts.css                  @font-face
    global.css                 Reset y estilos compartidos de beat
  lib/capture.ts               Detección de USR-01
public/
  media/reel-altaria.mp4       Reel real, reencodado
  media/reel-poster.jpg        Póster
  fonts/geist-variable.woff2   Geist Variable
  brand/favicon.svg            Marcador (pendiente USR-05)
scripts/shoot.mjs              Arnés de capturas
```

### Dónde está cada cosa

| Qué | Dónde |
|---|---|
| **Todo el copy** | `src/data/hero.ts` |
| **Reel** | `public/media/reel-altaria.mp4` (+ `reel-poster.jpg`) |
| **Capturas de revisión** | `review/` |
| **Tipografía de titulares** | `public/fonts/geist-variable.woff2` |
| **Tipografía nube** | `public/fonts/altaria-cloud.woff2` — **aún no existe**, ver abajo |
| **Captura de De Zamorano** | `public/media/dezamorano-home.png` — **aún no existe**, ver abajo |

---

## Tipografía nube

La declaración ya está preparada en `src/styles/fonts.css`:

```css
@font-face {
  font-family: 'Altaria Cloud';
  src: url('/fonts/altaria-cloud.woff2') format('woff2');
  font-display: swap;
}
```

y centralizada en un token de `src/styles/tokens.css`:

```css
--font-cloud: 'Altaria Cloud', 'Arial Black', 'Geist Variable', sans-serif;
```

**El archivo todavía no está en el proyecto.** Hasta que se deposite en
`public/fonts/altaria-cloud.woff2`, el navegador cae al respaldo pesado, que
mantiene la caja y el peso visual de la frase. La familia se usa **solo** en la
frase de apertura y queda reservada para el futuro bloque «¿Lo ves?»; no debe
aparecer en el resto de la web.

El tamaño de la frase se ajusta solo: `fitIntro()` en `hero-timeline.ts` mide
la línea más larga y escala el cuerpo para que **siempre quepa en dos líneas**,
sea cual sea el copy que se escriba en `data/hero.ts`.

## Captura de De Zamorano

Deja el PNG en:

```
public/media/dezamorano-home.png
```

No hay que tocar el markup. `src/lib/capture.ts` lo detecta y a partir de ahí:

1. el portátil muestra la captura real en lugar de la superficie pendiente;
2. **se activa el scroll interno lento del beat de web**, que está
   implementado pero desactivado mientras el archivo no exista (desplazar un
   marcador que encaja exacto en el bisel solo revelaría negro).

Idealmente una captura de **página completa** (no solo el viewport), a DPR 2 y
sin barra de scroll.

---

## Sustituir los placeholders de nube por HG-01, HG-02 y HG-04

Los cuatro planos viven en `src/components/hero/CloudLayers.astro` y cada uno
lleva su `data-asset`:

| Plano | Asset | Papel |
|---|---|---|
| `.plane--near` | **HG-01** | Banco frontal, **por delante** de los dispositivos |
| `.plane--mid` | **HG-02** | Término medio |
| `.plane--far` | **HG-03** | Cirros lejanos |
| `.plane--exit` | **HG-04** | Banco por el que el hero sale hacia la siguiente sección |

Para sustituir uno, cambia **solo su `background`**:

```css
.plane--near {
  /* placeholder CSS eliminado */
  background-image: url('/media/clouds/hg-01.avif');
  background-size: cover;
  background-position: bottom center;
  filter: none;                /* el asset ya trae su propio detalle */
}
```

No hay que tocar nada más: geometría, `z-index`, profundidad de parallax y las
cajas del depurador salen de `tokens.css` y de la timeline, que no cambian.

**Requisitos del arte para HG-01:** la masa debe concentrarse en las **dos
esquinas inferiores**, con el centro bajo y despejado. Una pared blanca
continua aplana el encuadre y se come el clúster de dispositivos. Cada nube
necesita corona cálida arriba y bajo azul-gris debajo: ese contraste es lo que
la separa de la niebla. Pulsa **`B`** en el navegador para ver las cajas
exactas con sus medidas en píxeles.

---

## Depuración

| Tecla | Capa |
|---|---|
| **`B`** | Cajas de asset: rectángulos de HG-01/02/03/04 con dimensiones en vivo |
| **`G`** | HUD de escena: progreso global, beat activo, progreso local, rango y bounding boxes de frase, header, textos, móvil, portátil, nodos y salida |

También por URL: `?boxes=1` y `?hud=1`. Ocultas por defecto, así que las
capturas salen limpias.

---

## Notas de arquitectura

- **Una sola timeline maestra**, normalizada a duración exactamente 1, de modo
  que las fronteras de beat (`data/hero.ts`) coinciden con el progreso de
  scroll. Hay una guarda que avisa por consola si alguna hija la desajusta.
- **Sin scroll hijacking ni snap.** Scroll normal con `scrub: 0.9`.
- **Tres envoltorios por objeto**, cada uno con una única transformación
  (timeline / flotación / cursor), para que nunca compitan.
- **Coordenadas por el centro**, en unidades de viewport y como funciones, así
  que `invalidateOnRefresh` las reevalúa: 1440, 1920 y 2560 comparten un solo
  camino de código.
- **Sin Three.js ni WebGL.**
- El reel usa `preload="none"` y solo se reproduce dentro de su beat.

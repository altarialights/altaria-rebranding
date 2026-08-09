# Altaria Lights — Hero v7

Experiencia de hero desktop construida con Astro y GSAP ScrollTrigger, más la
sección **«Cómo funciona»** a la que enlazan los nodos del sistema.

El móvil y el portátil son **sólidos 3D cerrados en CSS**: caras frontal,
trasera y laterales reales, separadas físicamente en Z. La reconstrucción y la
causa del parpadeo que se corrigió en v7 están en
[`docs/produccion/ARQUITECTURA-3D-DISPOSITIVOS.md`](docs/produccion/ARQUITECTURA-3D-DISPOSITIVOS.md).

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
      BeatCopy.astro           Bloque de mensaje: nube + titular + sub
      CopyCloud.astro          La nube gráfica (5 variantes)
      SocialBeat.astro         Texto del beat de redes
      WebBeat.astro            Texto del beat de web
      GrowthBeat.astro         Texto + clúster de nodos
      DevicePhone.astro        Móvil sin marca (CSS 3D)
      DeviceLaptop.astro       Portátil sin marca (CSS 3D)
      FlowNode.astro           Nodo interactivo (enlace real)
      FlowTooltip.astro        Tarjeta explicativa flotante
      CloudLayers.astro        Placeholders HG-01/02/03/04 + nubes sueltas
      SkyEvents.astro          Pájaros, avión y cohete
      SunSignature.astro       El sol interactivo y la firma
      Sky.astro                Cielo, sol y respiración de luz, 100 % CSS
      HeroDebugOverlay.astro   Capas de depuración B y G
    sections/
      HowItWorks.astro         Destino de los nodos
    ScreenDeZamorano.astro     Pantalla del portátil (USR-01)
  scripts/
    hero-timeline.ts           Timeline maestra GSAP
    sky-life.ts                Eventos del cielo, en su propio reloj
    sun-signature.ts           El easter egg del sol
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
  fonts/Puffy.woff2            Puffy (display)
  brand/favicon.svg            Marcador (pendiente USR-05)
scripts/
  shoot.mjs                    Arnés de capturas
  diagnose-faces.mjs           Censo de caras 3D + prueba de estabilidad
  preview-video.mjs            Vídeos de comportamiento de scroll
docs/produccion/
  ARQUITECTURA-3D-DISPOSITIVOS.md   Causa del parpadeo y geometría de los sólidos
  MANIFIESTO-PRODUCCION-VISUAL.md   Plan de assets
  PUERTA-0-PROTOTIPO.md / PUERTA-0-HERO.md
```

### Dónde está cada cosa

| Qué | Dónde |
|---|---|
| **Todo el copy** | `src/data/hero.ts` |
| **Reel** | `public/media/reel-altaria.mp4` (+ `reel-poster.jpg`) |
| **Capturas de revisión** | `review/` |
| **Tipografía de cuerpo** | `public/fonts/geist-variable.woff2` |
| **Tipografía de display** | `public/fonts/Puffy.woff2` |
| **Captura de De Zamorano** | `public/media/dezamorano-home.png` — **aún no existe**, ver abajo |

---

## Tipografía de display — Puffy

Redonda muy gruesa, de [eifetx/Puffy-Fonts](https://github.com/eifetx/Puffy-Fonts)
(SIL OFL 1.1, 410 glifos / 92 idiomas). Servida en local desde
`public/fonts/Puffy.woff2`, sin peticiones a terceros.

Se usa en **dos sitios y solo dos**: la frase de apertura, en blanco sobre el
cielo, y los titulares de cada beat, en azul marino. Nunca en cuerpo de texto —
no tiene un corte de texto, y por debajo de ~24 px deja de leerse y pasa a ser
decoración.

```css
/* src/styles/fonts.css */
@font-face {
  font-family: 'Puffy';
  src: url('/fonts/Puffy.woff2') format('woff2');
  font-weight: 100 900;   /* ver abajo */
  font-display: swap;
}
```

```css
/* src/styles/tokens.css */
--font-display: 'Puffy', 'Altaria Cloud', 'Arial Black', 'Geist Variable', sans-serif;
--ink-navy: #0f2c56;      /* color de los titulares de beat */
```

Tres cosas que conviene no deshacer:

- **El rango `100 900` no inventa pesos, los impide.** Puffy es estática, de un
  solo corte —sin tabla `fvar`— y ese corte ya es el más gordo que publica la
  familia. Declarar el rango mapea cualquier `font-weight` al mismo archivo, así
  que el navegador nunca aplica negrita sintética; en una redonda tan gruesa la
  síntesis emborrona los empalmes. El último gramo de peso lo pone un
  `-webkit-text-stroke` de `0.012em` en el propio color del texto.
- **El tracking va casi a cero.** Geist llevaba `-0.045em` porque es una
  grotesca estrecha; con Puffy a ese valor los ojales se tocan.
- **Nada que use esta fuente puede recortar.** Antes había máscaras de línea
  con el `padding` justo para librar los glifos, y «el justo» no es una regla:
  es una apuesta que se pierde con la primera diéresis. Ahora `.beat__title .ln`
  y `.intro__lineWrap` no tienen `overflow` — sin máscara no hay nada que corte
  un acento, una tilde ni el `text-stroke`.
  Aparte, donde se usa `background-clip: text` (la frase del sol) **hace falta
  `padding` sí o sí**: ahí el degradado solo se pinta dentro de la caja del
  elemento y el texto es transparente, así que la parte del glifo que se sale
  no se recorta — sencillamente no se dibuja. Era exactamente lo que se comía
  la tilde de «TENÍA».

El `@font-face` de `Altaria Cloud` sigue declarado como último respaldo por si
algún día llega un archivo propio, pero ya no bloquea nada.

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

Cada plano son **dos nodos**: `.plane` lleva el parallax de scroll y
`.plane__body` la deriva. Para sustituir uno, cambia **solo el `background`
del interior**:

```css
.plane--near .plane__body {
  /* placeholder CSS eliminado */
  background-image: url('/media/clouds/hg-01.avif');
  background-size: cover;
  background-position: bottom center;
  filter: none;                /* el asset ya trae su propio detalle */
}
```

No hay que tocar nada más: geometría, `z-index`, profundidad de parallax,
deriva y las cajas del depurador salen de `tokens.css` y de la timeline, que no
cambian.

Los dos nodos no son decoración: una animación CSS de `transform` gana al
estilo inline, así que poner la deriva en el mismo nodo que el parallax no las
suma — la deriva borra el parallax sin avisar.

**Requisitos del arte para HG-01:** la masa debe concentrarse en las **dos
esquinas inferiores**, con el centro bajo y despejado. Una pared blanca
continua aplana el encuadre y se come el clúster de dispositivos. Cada nube
necesita corona cálida arriba y bajo azul-gris debajo: ese contraste es lo que
la separa de la niebla. Pulsa **`B`** en el navegador para ver las cajas
exactas con sus medidas en píxeles.

---

## La vida del cielo

Tres capas, de menos a más evidente.

**Los bancos se mecen.** Cada uno con su periodo, su amplitud y su sentido, y
los tres ordenados por profundidad: el cercano es el más rápido y el lejano el
más lento, que es lo que significa parallax. Son periodos de minutos — el
registro en el que nunca pillas al cielo moviéndose, solo notas que no es el
mismo cielo que hace un rato.

**Cinco nubes sueltas cruzan el encuadre**, a 11–29 px/s, en las dos
direcciones, con cinco composiciones distintas: distinto número de bultos,
distinta asimetría, unas con bajo azulado y otras no. Dos de ellas además
engordan y adelgazan en un periodo que no tiene nada que ver con su travesía.
Viven en la franja 6–30vh, vacía en todos los beats, y son cirros translúcidos
y muy desenfocados: a esa altura, sobre un cielo `#2b81d4`, un cúmulo opaco
competiría con el titular.

**Cuatro eventos puntuales**, repartidos y separados por silencios largos:

| Progreso | Qué | Dónde |
|---|---|---|
| 0,09 | Bandada de cinco, de derecha a izquierda | 15vh, escenario vacío |
| 0,31 | Avión lejano con estela | 14vh, entre dos titulares |
| 0,58 | Tres pájaros, más pequeños y al revés | 13vh |
| 0,77 | Cohete | Sube por el cuadrante inferior izquierdo |

La colocación está medida, no estimada: muestreando el escenario cada 2,5 % de
la timeline salen dos franjas vacías en **todos** los beats — la banda 10–30vh
y el cuadrante inferior izquierdo por debajo de 54vh. Los eventos van ahí.

Corren en su propio reloj, no scrubeados (`src/scripts/sky-life.ts`): el scroll
solo decide cuándo arrancan. Nunca hay dos a la vez —al dispararse uno, el
anterior se jubila—, no se disparan con la pestaña oculta ni durante un scroll
rápido, y se rearman al alejarse del punto de disparo. En movimiento reducido y
por debajo de 1020 px no existen.

### Los tres se pueden tocar

Un easter egg, no una función. No se anuncia en ninguna parte: la única pista
es que el elemento crece un poco bajo el cursor.

| Elemento | Reacción |
|---|---|
| Pájaros | Bocadillo «EY. CON LOS PÁJAROS NO.», la formación se rompe, baten más rápido y se van al doble y medio de velocidad |
| Avión | Estalla una nube de vapor **encima**, la estela se deshace, y el avión entra en pérdida y cae en media parábola hasta perderse en el banco de nubes |
| Cohete | Aro de vapor que se expande, ocho nubecillas, la columna se ensancha un instante y sale disparado |

Y si alguien los toca los tres, un momento después: «Eso no estaba en el
briefing.» Una sola vez por carga.

### El sol

El cuarto, y el único que no es una broma. Un disco invisible sobre el sol, sin
más pista que el cursor y una reacción mínima: el halo crece un 4,5 % y se
enciende un núcleo cálido debajo. Al pulsarlo, el sol responde con un pulso, el
halo se abre, el cielo se ahonda alrededor del centro y aparece la firma —
«Somos Altaria Lights.» en la sans, pequeña y espaciada, y debajo «Alguna luz
tenía que haber.» en Puffy, grande, con un barrido de luz cálida que cruza las
letras una sola vez. Se sostiene 2,3 s y se deshace: la línea grande pierde
densidad, se desenfoca y sube un poco, como vapor.

Detalles que lo sostienen:

- **El velo es una capa pintada, no opacidad sobre la escena.** Atenuar un
  ancestro de los dispositivos metería cuatro subárboles `preserve-3d` en una
  superficie de render y la destruiría dos segundos después — el mismo ciclo
  que causaba el parpadeo de v5.
- **El barrido es un degradado recortado a las letras**, así que la luz pasa
  *por dentro* de los glifos. Como eso deja el texto transparente, el
  resplandor va con `drop-shadow` y no con `text-shadow`, que lo imprimiría
  dentro de las letras.
- **Solo la primera vez.** Después el sol responde únicamente con un pulso.
- **Mientras cruza un pájaro, el avión o el cohete, el sol se aparta**: su
  disco llega a ~16vh, justo el carril por el que vuelan.
- **No toca el scroll ni la timeline.** Si el usuario sigue bajando, el momento
  no se cancela: se acelera y termina.
- Con movimiento reducido sigue existiendo, con una entrada y salida planas y
  sin expansión del halo. Es contenido, no adorno.

Tres reglas sostienen todo esto:

- **Una reacción por aparición**, no por click. La bandada a la que ya has
  gritado es la que se va; la siguiente, un 20 % del hero más tarde, es otra.
- **Nada se crea al hacer click.** Ocho nubecillas, un aro y un bocadillo,
  construidos con la página y reutilizados. No hay forma de acumular nada
  porque no hay nada que acumular.
- **La reacción nunca toca un nodo que esté usando la coreografía.** La raíz de
  la bandada lleva la travesía, así que la dispersión va en cada pájaro; los
  cambios de velocidad van por el `timeScale` de la timeline del evento, que es
  lo único que se puede cambiar en vuelo sin pelearse con nada.

---

## Depuración

| Tecla | Capa |
|---|---|
| **`B`** | Cajas de asset: rectángulos de HG-01/02/03/04 con dimensiones en vivo |
| **`G`** | HUD de escena: progreso, beat, rotaciones X/Y/Z de ambos dispositivos, ángulo de tapa, progreso de entrada, estado del reel y del scroll interno de De Zamorano |
| **`F`** | Caras 3D: tiñe cada superficie de los dos sólidos, para ver cuáles existen y cuál está pintando el renderer |

También por URL: `?boxes=1`, `?hud=1` y `?faces=1`. Ocultas por defecto, así que
las capturas salen limpias.

Solo para el arnés de revisión, nunca en producción: `?scrub=0` quita el
arrastre de 0,9 s para que un scroll programado renderice el fotograma exacto
que pidió, y `?still=1` congela la flotación y el parallax de cursor.

---

## Verificación del render 3D

```bash
npm run build && npm run preview       # terminal 1
node scripts/diagnose-faces.mjs        # terminal 2
```

Dos sondas: un censo de caras que compone la cadena de matrices y detecta
coplanaridades reales, y una prueba de estabilidad que captura doce veces el
mismo recorte con el scroll parado — un render estable devuelve doce PNG
idénticos.

Variables: `BROWSER=chromium|firefox|webkit`, `VW`/`VH`, `STABLE_SETTLE`.

**Resultado actual:** 0 de 7 posiciones inestables en Chromium y WebKit, en los
siete viewports probados (1020×640 a 2560×1440). Detalle y causa raíz en
[`docs/produccion/ARQUITECTURA-3D-DISPOSITIVOS.md`](docs/produccion/ARQUITECTURA-3D-DISPOSITIVOS.md).

### Vídeos de comportamiento

```bash
node scripts/preview-video.mjs                 # los seis
node scripts/preview-video.mjs slow fast       # un subconjunto
```

Requiere **ffmpeg** en el PATH. Los fotogramas se conducen, no se graban: cada
uno fija una posición de scroll exacta, así que «lento» y «rápido» significan un
número concreto de píxeles por fotograma y los clips son reproducibles.

---

## Notas de arquitectura

- **Una sola timeline maestra**, normalizada a duración exactamente 1, de modo
  que las fronteras de beat (`data/hero.ts`) coinciden con el progreso de
  scroll. Hay una guarda que avisa por consola si alguna hija la desajusta.
- **Sin scroll hijacking ni snap.** Scroll normal con `scrub: 0.9`.
- **Cinco envoltorios por dispositivo 3D**, cada uno con una única
  transformación: `.obj` (timeline) → `.obj__stage` (perspectiva, sin
  transform) → `.obj__float` (deriva) → `.obj__point` (cursor) → `.obj__spin`
  (rotación de entrada). El clúster de nodos es plano y conserva el par
  original `.obj` → `.obj__float`.
- **La perspectiva vive dentro de `.obj`**, así que su origen es el centro del
  propio dispositivo y el 3D se lee igual esté donde esté sobre el escenario.
- **`will-change` no se alterna nunca.** Vive en CSS, permanente, y solo en
  `.obj--phone` y `.obj--laptop`, que están por encima de la perspectiva.
  Alternarlo alrededor de los eventos de scroll era la causa del parpadeo.
- **Coordenadas por el centro**, en unidades de viewport y como funciones, así
  que `invalidateOnRefresh` las reevalúa: de 1020 a 2560 comparten un solo
  camino de código.
- **Experiencia completa desde 1020 px.** Por debajo, la rama `compact`.
- **Sin Three.js ni WebGL.**
- El reel usa `preload="none"` y su reproducción se controla por la rotación
  real del móvil: solo suena con la pantalla dentro de ±15° de la cámara.

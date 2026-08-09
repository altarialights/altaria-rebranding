# Altaria Lights — contexto de proyecto

Web de estudio digital. Servicios encadenados: **contenido → web → sistema**.
Cliente real único: **De Zamorano** (restaurante, Navaluenga, Ávila).

Estado actual: **hero v8 + sección «Cómo funciona»**, pendiente de aprobación.
El resto de la home no está construido.

La composición se apoya en **una retícula horizontal única**
(`--canvas-inset`): el header ocupa exactamente ese ancho y el titular
arranca en su borde izquierdo. Cada mensaje de servicio va sobre una
**nube gráfica** propia —cinco variantes de la misma familia, dibujadas
con elipses en `CopyCloud.astro`— deliberadamente naíf frente a las nubes
atmosféricas del fondo.

El hero recorre **cinco servicios** en cinco beats: contenido (móvil),
web (portátil), software a medida (monitor), imagen de marca (tablet) y
el circuito que los conecta. Cada dispositivo, tras su beat, se retira a
una **pila en la esquina superior derecha** en vez de desaparecer: al
llegar al cierre la esquina sostiene los cuatro. Los cuatro son sólidos
CSS 3D cerrados; ver `docs/produccion/ARQUITECTURA-3D-DISPOSITIVOS.md`.

El cielo tiene vida propia: cuatro bancos de nube que se mecen, cinco
nubes sueltas cruzando a distintas velocidades y alturas, y **cuatro
eventos puntuales** repartidos por el scroll — pájaros a 0,09, un avión
con estela a 0,31, más pájaros a 0,58 y un cohete a 0,77. Están colocados
sobre las dos franjas que están vacías en todos los beats: la banda
10–30vh y el cuadrante inferior izquierdo.

Los tres son **clicables**, como easter egg: los pájaros sueltan un
bocadillo y se largan, al avión le estalla una nube encima y cae en media
parábola, el cohete acelera y se va. Una reacción por aparición. No se anuncia en
ningún sitio; la única pista es que el elemento crece un poco bajo el
cursor.

**El sol también**, y es el único que habla de la marca: al pulsarlo el
cielo se ahonda y aparece «Somos Altaria Lights. / Alguna luz tenía que
haber.» Una vez por carga; después solo responde con un pulso. Vive en
`sun-signature.ts`, fuera del `matchMedia`, porque está en pantalla
durante todo el hero y funciona también con movimiento reducido.

---

## Reglas duras

Estas no son preferencias de estilo. Romper cualquiera invalida el trabajo.

1. **No llamar a Higgsfield sin aprobación explícita del usuario para ese
   asset concreto.** Cada generación cuesta dinero real. Saldo: plan
   `starter`. El plan de producción está en
   `docs/produccion/MANIFIESTO-PRODUCCION-VISUAL.md`; el flujo es por puertas
   con revisión humana entre cada una.
2. **Cero datos inventados.** Ni métricas, ni testimonios, ni resultados, ni
   clientes además de De Zamorano. Si no hay dato verificable, la sección se
   resuelve cualitativamente. Esto ya está aplicado en el beat de sistema.
3. **No inventar el logo.** No existe todavía. El wordmark es HTML temporal
   con su hueco reservado en `FloatingHeader.astro` y en
   `public/brand/favicon.svg`.
4. **No reproducir ni recrear contenido de De Zamorano.** Solo la captura
   real cuando exista. Mientras no exista, superficie neutra con marcador.
   Por el mismo motivo, el panel del monitor es **abstracto**: formas, no
   datos. Ni cifras, ni porcentajes, ni etiquetas de eje. Y el lienzo de
   la tablet dibuja la **construcción** de un símbolo, nunca un logo
   terminado — inventarlo ahí violaría la regla 3.
5. **El reel aparece solo dentro del móvil.** Nunca como fondo ni suelto.
6. **De Zamorano aparece solo dentro del portátil.**
7. **Todo el texto es HTML real.** Nada de texto dentro de imágenes.
8. **Los dispositivos son CSS 3D**, sin marca, sin mockups de terceros, sin
   imágenes generadas.
9. **Español de España.**

---

## Comandos

```bash
npm run dev      # desarrollo
npm run build    # build de producción
npm run preview  # sirve dist/
npm run check    # astro check — debe dar 0 errores
npm run shoot    # capturas de revisión (requiere preview corriendo)
```

Depuración en el navegador: **`B`** cajas de asset · **`G`** HUD de escena.
También `?boxes=1` y `?hud=1`.

Los momentos que fotografía `npm run shoot` salen del calendario de cues de
`hero-timeline.ts`. **Si se retima un beat, hay que moverlos ahí también**:
estuvieron desfasados desde v8 y el arnés fotografiaba el escenario vacío.

---

## Invariantes de arquitectura

Romper estos rompe la escena de formas poco evidentes. Ya ha pasado.

- **La timeline maestra dura exactamente 1.** Las fronteras de beat en
  `src/data/hero.ts` se mapean directamente sobre el progreso de scroll. Hay
  una guarda que avisa por consola si se desvía. *Una subtimeline con
  duraciones GSAP por defecto la estiró a 3,75 y todos los beats renderizaban
  su estado final.*
- **Una sola timeline maestra.** Nada de timelines sueltas compitiendo.
- **Coordenadas por el centro**, en unidades de viewport, y siempre como
  **funciones** (`x: () => vw(72)`), para que `invalidateOnRefresh` las
  reevalúe. Así 1440/1920/2560 comparten un solo camino de código.
- **Cinco envoltorios por dispositivo 3D, una transformación cada uno:**
  `.obj` (timeline) → `.obj__stage` (perspectiva, sin transform) →
  `.obj__float` (flotación) → `.obj__point` (cursor) → `.obj__spin`
  (rotación de entrada). Meter dos transformaciones en el mismo nodo hace
  que se pisen. El clúster de nodos es plano y conserva el par original.
- **La perspectiva va dentro de `.obj`**, nunca en el escenario: su origen
  es así el centro del propio dispositivo.
- **Nunca alternar `will-change` sobre nodos 3D.** Vive en CSS,
  permanente, y solo en `.obj--phone` y `.obj--laptop`. *Armarlo al empezar
  el scroll y quitarlo 260 ms después era el 100 % del parpadeo: crear y
  destruir una capa re-rasteriza el subárbol `preserve-3d` y las caras
  saltan.* Ver `docs/produccion/ARQUITECTURA-3D-DISPOSITIVOS.md`.
- **Ninguna superficie pintada puede compartir plano y profundidad con
  otra dentro del mismo contexto `preserve-3d`.** Los adornos van dentro de
  una cara con `transform-style: flat` (`.laptop__deck`,
  `.phone__front`, `.laptop__screen-frame`). *Cinco superficies coplanares
  eran la razón de que el teclado apareciese y desapareciese.*
- **`backface-visibility` no sostiene la silueta.** Ambos dispositivos son
  sólidos cerrados con laterales reales que siempre se pintan; sin ellos
  hay un fotograma en el cruce de perfil sin ninguna cara.
- **`rotationX` negativo mira el objeto desde arriba.** Con la base
  extendiéndose hacia cámara, un valor positivo lo mira desde abajo.
- **Solo `[data-obj="phone|laptop|flow"]` llevan origen centrado.** Los
  bloques de texto también tienen `data-obj`, pero solo para el HUD; si se
  centran, la columna se va media pantalla fuera.
- **Nunca animar propiedades de layout** (`width`, `height`, `top`…). Todo
  con `transform` y `opacity`. *Animar el `width` del header era el 100 % del
  CLS del proyecto.*
- **Todo el copy vive en `src/data/hero.ts`.** Nunca dentro de un componente.
- **Una sola retícula horizontal.** `--canvas-inset` decide los márgenes;
  de ahí salen el ancho del header y `--copy-x`. El inicio de la cápsula y
  el inicio del titular son la misma línea vertical a cualquier anchura.
- **Ningún elemento con Puffy puede recortar.** Nada de `overflow: hidden`
  sobre un titular: sin máscara no hay nada que corte un acento, una tilde
  o un `text-stroke`. Y donde se usa `background-clip: text` hay que dar
  `padding`, porque ahí el glifo que se sale de la caja **no se pinta**.
  *Ese era el bug de «TENÍA».*
- **El titular nunca se cruza con el dispositivo.** La línea más ancha
  mide 13 caracteres × 0,542 × `--step-beat`; el borde izquierdo del
  protagonista tiene que quedar a la derecha de eso. Al tocar la escala
  del copy o el ancho de un dispositivo hay que rehacer la cuenta.
- **La nube del copy es fondo, nunca contenedor.** Se disuelve hacia la
  derecha con una máscara y no recorta nada. Su geometría se deriva del
  titular, no del bloque: alto = 4,15 × `--step-beat`, y el ancho se
  **construye** (1,30 + la línea más larga + su voladizo). Una nube
  dimensionada por sus palabras no puede invadir el escenario.
- **El aspecto del `viewBox` de cada nube sale de su factor de ancho.**
  El alto llega por el aspecto, así que dibujarlo a ojo deja el subtítulo
  colgando fuera de las variantes estrechas.
- **Lo que tiene que librar el titular no son las crestas, son los valles
  entre ellas.** El titular es una recta y la silueta no. Siete lóbulos a
  poco más de un radio de distancia mantienen cualquier hundimiento por
  encima de la tinta.
- **Se mide la TINTA, no la caja.** Con Puffy los glifos se salen de la
  caja de línea, y un acento sube 0,235 del cuerpo por encima de las
  mayúsculas — el caso que manda es un acento en la **primera** línea.
- **Los bajos de la nube son libres a la derecha.** Siete bultos iguales
  sobre una base plana son una tarjeta con festones; una panza que cuelga
  bajo las palabras y se levanta hacia la derecha es una nube.
- **Ninguna máscara CSS sobre la nube.** Se pinta en la caja del elemento
  y el desenfoque se sale de ella: fuera, el degradado se repetía y
  dibujaba un rectángulo alrededor y un corte recto a la derecha.
- **Una región de filtro SVG recorta su propio resultado.** La del
  desenfoque de sombra era más estrecha que tres sigmas y cortaba plano:
  *una línea horizontal a lo ancho del cielo bajo cada nube*.
- **El sol vive por debajo de la cápsula del header.** Desde que el header
  ocupa todo el canvas, cualquier cosa a su altura queda detrás de él.
- **Las cards del cierre nacen `inert`.** Se activan una a una, cuando la
  suya ya ha llegado, y se apagan al salir. *Antes eran enlaces vivos
  sobre cielo vacío desde el primer fotograma.*
- **`.beat` no captura el puntero.** Los cinco bloques de copy están apilados
  en el mismo sitio y cuatro son invisibles en cualquier momento, pero
  invisible no es intangible: a `z-index: 5` tapaban la mitad izquierda del
  escenario. *La card de Contacto era inaccesible por debajo de 1440.*
- **Puffy solo en la frase de apertura y en los titulares de beat.** Es
  estática, de un corte, y el rango `100 900` del `@font-face` existe para
  impedir la negrita sintética, no para pedir pesos. Detalle en el README.
- **El cielo no va en la timeline maestra.** Las nubes a la deriva son
  animaciones CSS y los eventos (pájaros, avión, cohete) corren en su
  propio reloj desde `sky-life.ts`; el scroll solo decide *cuándo*
  arrancan. Scrubearlos haría que un pájaro batiese las alas hacia atrás
  al subir y que una estela se des-dibujase. Mismo patrón que
  `monitorLife()`.
- **Los eventos del cielo se jubilan, no se rechazan.** Al dispararse uno,
  el anterior se desvanece y se mata. *La primera versión se saltaba el
  disparo si había algo en marcha, y la bandada dura 15,5 s mientras que
  el siguiente disparo está a un 22 % del hero: a ritmo de lectura el
  avión no aparecía nunca.*
- **Ninguna caja invisible a pantalla completa puede capturar el puntero.**
  `.beat` y `.hero__objects` llevan `pointer-events: none`; lo único que
  vuelve a activarlo dentro son las cards del cierre. *`.hero__objects`
  es `inset: 0` en z-index 3 y se comía todos los clics del cielo.*
- **Una reacción por aparición, y nada se crea al hacer click.** Ocho
  nubecillas, un aro y un bocadillo, creados con la página y reutilizados.
  Sin eso, click compulsivo = basura acumulada en pantalla.
- **Un padre a `opacity: 0` esconde a sus hijos digan lo que digan.** El
  contenedor de las nubecillas lo heredaba de la regla que oculta el
  bocadillo: *se animaban perfectamente y no pintaban nada*.
- **El velo del sol es una capa pintada, nunca opacidad sobre un ancestro
  de los dispositivos.** Atenuar `.hero__objects` metería cuatro subárboles
  `preserve-3d` en una superficie de render y la destruiría dos segundos
  después — exactamente el ciclo que provocaba el parpadeo de v5.
- **Astro aísla TODOS los compuestos de un selector.** Un
  `[data-sky-busy] .sun-hit` escrito tal cual exige que el escenario lleve
  el id de scope de *ese* componente y no encaja nunca, sin dar error. El
  ancestro ajeno va con `:global()`. Mismo origen que lo de los
  `@keyframes`.
- **Mientras cruza un evento del cielo, el sol se aparta**
  (`data-sky-busy`). Su disco llega a ~16vh, justo el carril del avión y
  de la segunda bandada; sin esto son inclicables al pasar por delante.
- **Dos nodos por plano de nube, una transformación cada uno.** `.plane`
  lleva el parallax de scroll (GSAP) y `.plane__body` la deriva (CSS). Una
  animación CSS de `transform` gana al estilo inline, así que juntarlas en
  el mismo nodo no las combina: *la deriva borra el parallax*.
- **Astro renombra los `@keyframes` al aislar estilos.** Solo puede
  reescribir el nombre donde lo ve, así que `animation-name: var(--algo)`
  apunta a un nombre que ya no existe y la animación no arranca sin dar
  ningún error. La variación por instancia va por clase, nunca por
  variable.
- **`?still=1` congela también las animaciones CSS** (`global.css`, una
  regla sobre `[data-still='1']`). Sin eso el arnés de estabilidad
  fotografía una nube cruzando y da falsos positivos.
- Las nubes son placeholders sustituibles cambiando **solo el `background`**
  de la regla `.plane--x .plane__body` en `CloudLayers.astro`. La geometría
  sale de `tokens.css`.

## Trampas conocidas

- `page.hover()` de Playwright **desplaza el elemento a la vista**, lo que
  rebobina la timeline y captura una escena a medio construir. Usar
  `page.mouse.move()` sobre el bounding box.
- Los nodos llevan `white-space: nowrap` para su etiqueta; cualquier hijo lo
  hereda. La tarjeta explicativa necesita `white-space: normal` explícito.
- `.step:last-child` no funciona si cada `.step` es hijo único de su `<li>`:
  hay que apuntar al `li`.
- El sol se pinta a `opacity: 0` para poder entrar con fade. Si se toca el
  arranque, hay que conservar ese fade o el sol nunca se ve.

---

## Material pendiente del cliente

| Ref | Qué | Bloquea |
|---|---|---|
| **USR-01** | Captura full-page de la home de De Zamorano (DPR 2, sin barra de scroll) → `public/media/dezamorano-home.png` | La pantalla del portátil y el scroll interno del beat de web, que está implementado pero desactivado hasta que exista el archivo |
| **USR-05** | Logo, hex de marca, tipografías con licencia | La identidad definitiva |
| **USR-07** | Precios, proceso, textos comerciales | Las secciones que faltan |

Ambos archivos se autodetectan: al dejarlos en su ruta, los componentes los
usan sin tocar markup.

---

## Documentación

- `docs/produccion/MANIFIESTO-PRODUCCION-VISUAL.md` — plan de assets, qué se
  genera y qué no, y por qué.
- `docs/produccion/PUERTA-0-PROTOTIPO.md` — primer prototipo y las cajas de
  asset medidas.
- `docs/produccion/PUERTA-0-HERO.md` — versión de cinco beats.
- `README.md` — instalación, estructura y cómo sustituir los placeholders.

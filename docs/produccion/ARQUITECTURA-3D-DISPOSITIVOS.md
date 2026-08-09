# Arquitectura 3D de los dispositivos — hero v7

Documento técnico de la reconstrucción del móvil y del portátil. Cubre la
causa real del parpadeo, cómo se corrigió, la geometría de cada sólido y
cómo se verifica que sigue corregido.

Todo lo que hay aquí es HTML, CSS 3D, GSAP y ScrollTrigger. **Sin
Three.js, sin WebGL, sin Higgsfield, sin assets nuevos.**

---

## 1. Causa raíz del parpadeo

El fallo se reportó así: *«ocurre prácticamente en cuanto hago scroll,
incluso con scroll mínimo»*. Esa frase es el diagnóstico, porque descarta
las explicaciones habituales — un problema de velocidad se notaría solo al
acelerar.

Había **tres causas independientes**. Ninguna es la que se suele citar.

### 1.1 · Alternancia de `will-change` (la que producía el parpadeo)

v5 armaba `will-change: transform, opacity` sobre cada nodo transformado
al empezar el scroll y lo retiraba 260 ms después de parar. Parecía
higiene. Era el bug.

La sonda de estabilidad (`scripts/diagnose-faces.mjs`, prueba B) aparca el
scroll, congela flotación y cursor con `?still=1`, y captura diez veces el
mismo recorte. Un render estable **tiene que** devolver diez PNG idénticos.

**v5 devolvía dos renders distintos en 7 de 7 posiciones**, siempre con la
misma forma: la primera captura difería de todas las posteriores.

```
móvil · trasera      94cb bec0 bec0 bec0 bec0 bec0 bec0 bec0 bec0 bec0   ⚠
portátil · abierto   f00e 80ad 80ad 80ad 80ad 80ad 80ad 80ad 80ad 80ad   ⚠
```

Esa primera captura cae dentro de la ventana de `will-change`; el resto
caen después de que expire. Añadir o quitar una pista de composición
obliga a Chromium a crear o destruir una *render surface* y a re-rasterizar
el subárbol `preserve-3d` con otra estrategia. Las caras saltan. Y como se
rearmaba en **cada evento de scroll**, saltaba con el clic mínimo de la
rueda — exactamente como se reportó.

`will-change: opacity` empeoraba el caso: aplana todo el sólido en una
única textura.

**Corrección.** La promoción vive ahora en CSS, una vez, permanente, y solo
en `.obj--phone` y `.obj--laptop` — que están **por encima** de la
perspectiva, así que una capa ahí no puede partir el contexto 3D. Nada de
`will-change` dentro de la escena, ni en `.obj__float`, ni alternado.

### 1.2 · Caras coplanares en la base del portátil (el teclado)

La cubierta era **un plano** con el teclado, el hueco, el trackpad, la
bisagra y el labio colgando como hijos sin transformar. Como ese plano
declaraba `transform-style: preserve-3d`, esos hijos **no se aplanaban
dentro de él**: quedaban en el mismo espacio 3D y a la misma profundidad.

El censo de caras lo cuantificó:

```
⚠ laptop__base ≡ laptop__hinge   en 51/51 pasos
⚠ laptop__base ≡ laptop__well    en 51/51 pasos
⚠ laptop__base ≡ laptop__keys    en 51/51 pasos
⚠ laptop__base ≡ laptop__lip     en 51/51 pasos
```

Cinco superficies pintadas a z idéntica, con un ancestro animado moviendo
la matriz fracciones de píxel. El renderer rompe ese empate de forma
distinta en cada fotograma: por eso el teclado iba y venía.

**Corrección.** `.laptop__deck` es **una** superficie con
`transform-style: flat`, y teclado, trackpad, hueco, bisagra y labio se
pintan **dentro** de ella. Ya no pueden competir porque ya no están en el
espacio 3D. Lo mismo en la tapa con `.laptop__screen-frame`.

### 1.3 · El cruce de perfil dejaba un fotograma sin ninguna cara

El móvil era cara frontal + trasera + dos cantos, y se apoyaba en
`backface-visibility` para intercambiar frontal por trasera. El censo:

```
phone__rear   visible 13/42 pasos (0.238→0.286)
phone__front  visible 28/42 pasos (0.290→0.398)
```

13 + 28 = 41 de 42. **Un paso en el que no se renderizaba ninguna de las
dos**, justo en el cruce de perfil, con solo dos cantos sosteniendo la
silueta. El portátil tenía el mismo hueco entre `shell` (hasta 0.540) y
`frame` (desde 0.545).

**Corrección.** Ambos objetos son ahora sólidos cerrados con caras
laterales reales que **siempre se pintan** (sin `backface-visibility`).
`backface-visibility` sobrevive solo en frontal y trasera, donde su
trabajo es honesto: impedir que la pantalla se vea reflejada a través de
la carcasa.

---

## 2. Arquitectura del móvil

```
.obj                position / escala / opacidad   ← timeline maestra
 └ .obj__stage      perspective, sin transform
    └ .obj__float   deriva de reposo
       └ .obj__point  parallax de cursor
          └ .obj__spin  rotación de entrada       ← timeline maestra
             └ .phone__object     preserve-3d, el sólido
                ├ .phone__side--left/right/top/bottom
                ├ .phone__back    translateZ(−t/2) rotateY(180°)
                └ .phone__front   translateZ(+t/2)   transform-style: FLAT
                   ├ .phone__screen  (vídeo + .phone__off)
                   ├ .phone__notch
                   └ .phone__glass
```

- Seis superficies, cada una separada físicamente en Z por `--phone-t`
  (≈ 9 % del ancho: un móvil real mide 8,25 mm sobre 70,6 mm).
- La cara frontal es `flat` **a propósito**: pantalla, notch y cristal se
  pintan dentro, no flotan como hermanos a la misma profundidad.
- Los cuatro laterales van **sin** `backface-visibility`: durante un giro
  de 198° cada uno se ve por sus dos lados.
- Los extremos de los laterales están rebajados y afilados
  (`border-radius: 45% / 2.5%`) para que una tira recta no asome por la
  esquina redondeada del cuerpo.

### La perspectiva va dentro de `.obj`

Su origen es entonces el centro del propio dispositivo, así que el 3D se
lee igual esté donde esté sobre el escenario. Una perspectiva única a
nivel de escenario lo deformaría en los bordes. Además significa que el
fundido de opacidad de `.obj` (que aplana el 3D en esa frontera) ocurre
**por encima** del contexto 3D en vez de cortarlo por la mitad.

### Las esquinas: un canto de 24 caras

Una tira plana no puede seguir una esquina redondeada, así que las cuatro
paredes solo cubren el **tramo recto** de cada borde. Sus insets son
exactamente el radio del cuerpo (13 % del ancho en horizontal, 6,2 % de la
altura en vertical): con valores aproximados, el sobrante asomaba por fuera
de la silueta y parecía una pieza suelta en la esquina inferior.

Eso deja las cuatro esquinas curvas sin pared. `.phone__core` —un plano en
z = 0, del tamaño y radio de las caras, en material de canto— tapa el
hueco **de frente**, pero está de perfil justo cuando la esquina importa,
así que no cierra el canto: cerca del perfil el borde se bifurcaba en dos
puntas con un agujero en medio.

La solución es facetar el arco. `SEG = 5` tiras por esquina, cada una
sobre una cuerda del arco y con el grosor completo del cuerpo: **20
facetas más las 4 paredes hacen un canto de 24 lados**, continuo en
cualquier punto del giro de 198°. La flecha residual es
`r(1 − cos 9°) ≈ 0,5 px`.

La geometría se calcula en el frontmatter del componente, no a mano: cada
cuerda se mide en unidades de ancho (la `y` se escala por la relación de
aspecto), de modo que longitudes y ángulos son exactos. Cada faceta se
estira un 8 % para que las juntas solapen en vez de tocarse a tope.

### El ease importa más que los ángulos

A 90° un móvil **es** una varilla metálica. Eso no es un fallo: es lo que
se ve de un móvil de perfil, y ahora que existen los cuatro laterales se
renderiza como varilla sólida en vez de desaparecer. Pero es el instante
menos legible del giro, así que la rotación lo **atraviesa rápido**:

- tramo A usa `power2.in`, que alcanza su velocidad máxima al final;
- 90° cae en el 94 % del tramo A;
- el cruce dura ≈ 1vh de scroll, frente a los ≈ 8vh que un `inOut`
  simétrico se quedaba parado encima.

---

## 3. Arquitectura del portátil

```
.obj__spin
 └ .laptop__object          preserve-3d
    ├ .laptop__pivot        origen 50% 100% (línea de bisagra), rotateX
    │  └ .laptop__lid       preserve-3d
    │     ├ .laptop__screen-frame   translateZ(+lid-t/2)  FLAT
    │     │   └ .laptop__bezel → .laptop__track → ScreenDeZamorano
    │     │     .laptop__glass · .laptop__cover · .laptop__chin
    │     ├ .laptop__lid-back       translateZ(−lid-t/2) rotateY(180°)
    │     └ .laptop__lid-edge--top/left/right
    └ .laptop__base-group   rotateX(90°) desde la bisagra, preserve-3d
       ├ .laptop__deck          FLAT  → hinge · well · keys · pad · lip
       ├ .laptop__base-bottom   translateZ(−base-t)
       ├ .laptop__base-front    rotateX(90°) desde el borde cercano
       ├ .laptop__base-left     rotateY(90°) desde el borde izquierdo
       └ .laptop__base-right    rotateY(90°) desde el borde derecho
```

### Las esquinas inferiores

En v5 solo existía una tira frontal, **rebajada** por los lados
(`left: 1.2%; right: 1.2%`). Los dos extremos de la base terminaban en el
aire: de ahí el mal remate volumétrico en las esquinas inferiores
izquierda y derecha.

Ahora la base es una **caja cerrada**: cubierta, fondo y tres paredes. Las
paredes izquierda y derecha llegan de borde a borde (`top: 0; bottom: 0`),
así que la cubierta, el fondo y la pared frontal se encuentran con ellas en
una arista real. No hay hueco que rematar porque no hay hueco.

**Los signos de las dos paredes laterales no son iguales.** Dentro de este
grupo, −z es arriba en el mundo. La caja de la pared izquierda avanza en
+x local desde su origen, así que `rotateY(90deg)` la manda a −z y baja por
debajo de la cubierta. La de la derecha avanza en −x local desde el suyo,
de modo que ese mismo `rotateY(90deg)` la manda a +z y **sube por encima**
de la cubierta: ese era el desacople del lado inferior derecho. Necesita
`rotateY(-90deg)`.

### Profundidad de la base: un número derivado

Un portátil cerrado tiene una sola huella; tapa y base cubren el mismo
rectángulo. La tapa mide **64,81 %** del ancho — 1,15 % de padding
superior + 61,06 % de bisel (97,7 % de ancho a 16:10) + 2,6 % de mentón —
así que al plegarse llega a 64,81 % desde la bisagra. Con la base a 60 %,
la tapa sobresalía casi un 5 % del ancho, y eso es lo que se leía como *«la
parte de arriba es más grande que la de abajo»* con la máquina cerrada.

Como el grupo ya arranca 0,7 % más allá de la bisagra por holgura, su
profundidad propia es 64,81 − 0,7 = **64,1 %**. Los dos bordes cierran
juntos.

### Sistema de coordenadas de la base

`.laptop__base-group` se tumba desde la línea de bisagra con
`rotateX(90deg)` y se extiende **hacia la cámara**. Dentro de su marco
local: **x = ancho, y = profundidad, −z = arriba en el mundo**. Por eso las
paredes rotan como rotan; no es arbitrario.

### El signo de `rotationX` del contenedor

**`rotationX` negativo es el que mira el objeto DESDE ARRIBA**, y el signo
no es cuestión de gusto.

`rotateX(+C)` lleva el +y del objeto hacia +z. La base se extiende por +z
(sale de la bisagra hacia la cámara), así que un C positivo **sube** su
borde cercano en pantalla e inclina la tapa **hacia** el espectador: la
máquina se está viendo por debajo, la cubierta se aplasta a una tira de
30 px y la tapa cerrada enseña la pantalla en lugar de la carcasa.

Con C negativo el borde cercano baja, la tapa se recuesta como una real, y
`backface-visibility` resuelve en el sentido correcto.

### La tapa cerrada enseña aluminio

`backface-visibility` no puede encargarse de esto: CSS decide frontal o
trasera **solo por el signo z de la normal transformada**, sin tener en
cuenta dónde está la superficie. Una tapa cerrada a −90° es horizontal, su
normal tiene z = 0, y la inclinación de cámara del contenedor la empuja a
positivo — la máquina cerrada renderiza su pantalla y esconde su carcasa.
Pelear con geometría significa o sobre-rotar la tapa dentro de la base, o
inclinar el teclado a un ángulo que ningún portátil tiene.

Por eso `.laptop__cover` es explícito: material de tapa opaco sobre el
bisel, fundido por la timeline cuando la tapa pasa de ~55°. Además cumple
literalmente el requisito de no mostrar la captura de De Zamorano antes de
que la tapa permita verla.

---

## 4. Reparto del beat del portátil

Ventana 0,442 → 0,745, repartida **20 / 25 / 20 / 35**:

| Tramo | Progreso | Qué pasa |
|---|---|---|
| Fase A · 0–20 % | 0,442 → 0,5006 | asciende desde las nubes, cerrado |
| Fase B · 20–45 % | 0,5006 → 0,5738 | gira de frente, la tapa rompe el sello |
| Fase C · 45–65 % | 0,5738 → 0,6324 | la tapa completa, el cuerpo se asienta |
| Estable · 65–100 % | 0,6324 → 0,745 | **abierto, teclado claramente visible** |

El último tercio es el objetivo. La máquina está abierta y de frente
durante **0,113 del recorrido ≈ 52vh de scroll**, frente a 37vh en v5. El
teclado ya no depende de acertar un instante estrecho.

`--hero-scroll` sube de 520vh a 580vh para que ese tercio valga la pena
recorrerlo; los demás beats conservan aproximadamente su recorrido
absoluto.

---

## 5. Experiencia desktop desde 1020 px

`gsap.matchMedia` usa `(min-width: 1020px)` para la rama completa. Desde
1020 px se conserva **todo**: frase inicial, header desktop, entrada y giro
del móvil, reel, ascenso y apertura del portátil, teclado, y los beats de
crecimiento. Solo cambian las proporciones.

| Rango | Qué cambia |
|---|---|
| 1440+ | referencia |
| 1200–1439 | dispositivos y tipografía más ajustados, header 1080 px |
| 1020–1199 | portátil 49vw, móvil 21vw, header 944 px, `copy-x` 5vw |
| < 1020 | única simplificación real (rama `compact`) |

### Alturas de viewport bajas

Un escalar `--dev-k` reduce **ambos** dispositivos a la vez. Los
breakpoints de ancho deciden las proporciones; `--dev-k` decide si caben
verticalmente. Separarlos es lo que permite que un portátil de 1366×768
ejecute la coreografía completa en vez de una versión recortada.

| Altura | `--dev-k` |
|---|---|
| ≤ 840 px | 0,9 |
| ≤ 740 px | 0,8 |
| ≤ 660 px | 0,7 |

---

## 6. Cómo se verifica

```bash
npm run build && npm run preview       # terminal 1
node scripts/diagnose-faces.mjs        # terminal 2
```

Variables: `BROWSER=chromium|firefox|webkit`, `VW`/`VH`, `STABLE_SETTLE`.

### Prueba A · geometría

Compone a mano la cadena de transformaciones con `DOMMatrix`, desde la raíz
de perspectiva hasta cada cara, y lee los dos números que de verdad deciden
lo que hace el renderer:

- **normal.z** → de qué lado de la cara estamos, que es exactamente lo que
  prueba `backface-visibility`;
- **centro.z** → profundidad, y por tanto orden de pintado.

Dos caras se marcan como conflicto solo si se cumplen **tres** condiciones:
mismo plano, **ambas pintadas** (un envoltorio estructural sin fondo no
puede competir con nada), y **ambas participantes directas del mismo
contexto `preserve-3d`** — un padre con `transform-style: flat` pinta a sus
hijos en orden de documento, en 2D, que es precisamente la corrección
aplicada. Un test que ignorase eso seguiría reportando el bug después de
arreglado.

> El *hit testing* no sirve aquí (hay overlays a pantalla completa por
> encima del escenario) y `getBoxQuads()` no está implementado en este
> Chromium. De ahí la composición manual de matrices.

### Prueba B · estabilidad

Aparca el scroll y captura doce veces el mismo recorte. Con `?still=1` la
flotación y el cursor están congelados, así que un render estable **tiene
que** devolver doce PNG idénticos.

Los 150 ms de asentamiento son un compromiso deliberado: suficientes para
que ScrollTrigger haya aplicado el progreso, y **lo bastante cortos como
para seguir cruzando los 260 ms** donde disparaba el temporizador de v5.
La captura 1 cae dentro de esa ventana y la 2 fuera, así que el fallo
original se seguiría detectando.

### Resultados

| Motor | Antes | Después |
|---|---|---|
| Chromium | 7 / 7 inestables | **0 / 7** |
| WebKit | — | **0 / 7** |
| Firefox | — | 0 / 7 con asentamiento de 700 ms |

Firefox necesita ≈ 0,5 s para converger su rasterizado por *tiles* tras un
scroll. Converge **y se queda convergido**, a diferencia del fallo de v5,
que conmutaba de forma determinista en la frontera del temporizador y
volvía a conmutar en cada evento de scroll. La composición es idéntica
durante todo el tramo; lo que varía es el antialiasing a nivel de tile.

Viewports verificados en Chromium: 1020×640, 1152×720, 1280×720, 1366×768,
1440×900, 1920×1080, 2560×1440 — **0 / 7 inestables en todos**.

### Residuo aceptado

```
⚠ laptop__screen-frame ≡ laptop__lid-edge  en 1/59 pasos
```

Un paso de 59 en el que la tira del canto superior de la tapa degenera a
área nula y su plano coincide con el del marco. Al tener área cero no
puede pintar nada, así que no hay conflicto visible. Se documenta en vez de
esconderse.

---

## 7. Modo de depuración

| Tecla | Capa |
|---|---|
| **`B`** | Cajas de asset HG-01/02/03/04 con medidas en vivo |
| **`G`** | HUD: progreso, beat, rotaciones X/Y/Z de ambos dispositivos, ángulo de tapa, progreso de entrada, estado del reel y del scroll interno |
| **`F`** | **Caras 3D**: tiñe cada superficie de los dos sólidos |

También por URL: `?boxes=1`, `?hud=1`, `?faces=1`.

Solo para el arnés de revisión, nunca en producción:

- `?scrub=0` quita el arrastre de 0,9 s para que un scroll programado
  renderice exactamente el fotograma que pidió;
- `?still=1` congela flotación y parallax de cursor, para que la prueba de
  estabilidad compare fotogramas realmente idénticos.

### Colores del modo `F`

| Color | Superficie |
|---|---|
| Azul | frontal del móvil · marco de pantalla del portátil |
| Rojo | trasera del móvil · trasera de la tapa |
| Amarillo | laterales del móvil · cantos de la tapa |
| Verde | cubierta del portátil (teclado) |
| Naranja | pared frontal de la base |
| Morado | paredes izquierda y derecha de la base |
| Gris | fondo de la base |

# MANIFIESTO DE PRODUCCIÓN VISUAL — ALTARIA LIGHTS

> Estado: **PROPUESTA — PENDIENTE DE APROBACIÓN**
> No se ha generado ningún asset. Cero créditos gastados.
> Contexto de cuenta verificado: **516 créditos, plan `starter`, sin allowance «unlim»**.

---

## 1. Resumen creativo del proyecto

Altaria Lights vende tres cosas encadenadas: **atención** (contenido/reel), **confianza** (web) y **crecimiento** (campaña). La web debe demostrar eso mismo en su propio cuerpo: no contarlo, ejecutarlo.

La metáfora rectora es la **ascensión**: el negocio del cliente sube desde el ruido hasta el aire limpio. Eso da una gramática vertical muy simple y muy potente:

- **Arriba = cielo, luz, claridad, Altaria.**
- **Abajo = tormenta, cristal roto, presencia digital fragmentada.**
- **El scroll es el viaje.** Se baja al problema una sola vez, y se vuelve a subir.

Decisión creativa central: **el cielo no es un fondo, es el escenario.** Todo lo demás flota, aterriza o se rompe dentro de él. Esto tiene una consecuencia de producción enorme, y es la tesis de este manifiesto:

> **Si el cielo es un sistema de capas y no una foto, se genera una vez y sirve para toda la web** — apertura, transformación, «¿LO VES?», CTA final, sección oscura y el easter egg meteorológico. Un solo cuerpo de assets, seis usos.

De ahí salen las tres reglas duras que gobiernan todo el plan:

1. **El degradado de cielo y el sol son CSS, no imagen.** Cero bytes, escalan a cualquier viewport, y son *animables* — lo que hace que el botón «NO PULSES AQUÍ» salga prácticamente gratis.
2. **Las nubes son capas PNG con alfa, no escenas cerradas.** Permiten parallax real, se re-tintan a tormenta por CSS y no obligan a recortar composiciones fijas.
3. **Ninguna pantalla se inventa.** Los dispositivos son carcasas vacías; dentro va la captura real de De Zamorano y el reel real, insertados por CSS/HTML.

Resultado: **11 assets generados (4 bloqueantes, 1 opcional), 0 assets de motion.**

---

## 2. Lenguaje visual detectado en las referencias

### Análisis por referencia

**REF-01 — Hero con dispositivos flotando**
Cielo diurno de alta clave, sol reventado en esquina superior derecha, banco de cúmulos ocupando el tercio inferior y los laterales, pico nevado asomando abajo-izquierda. Un portátil apoyado en una roca caliza clara; tablet flotando a la izquierda, tres móviles a la derecha en profundidades distintas. Todas las pantallas muestran una web de restaurante oscura y premium.
**Lo decisivo:** el tercio izquierdo está deliberadamente **vacío**, ocupado solo por barras blancas de placeholder (tres líneas de titular + dos píldoras de botón). Eso no es decoración: es la maqueta diciendo *«aquí va HTML real»*. Cualquier asset que generemos para el hero **debe respetar ese vacío a la izquierda**.

**REF-02 — El problema**
Atardecer sombrío, techo de nubes pesadas, sol bajo y frío detrás del horizonte. Paleta carbón/azul noche con un único acento cálido en la línea del horizonte. Flotan paneles de UI en cristal **agrietado y roto**: una web fracturada, tarjetas de post social, burbujas de mensaje sin responder, un calendario con equis y un post-it «BOOKING», un formulario. Esquirlas de cristal suspendidas.
**Lo decisivo:** el contenido de esos paneles es *literalmente interfaz* — debe ser HTML. Lo que no es HTML es **la grieta y el cristal**. Ahí está la única generación necesaria de esta sección.

**REF-03 — «¿LO VES?»**
Azul más saturado en el cenit, sol arriba a la derecha, cúmulos en las dos esquinas inferiores, y tipografía de palo seco condensada, en caja alta, **construida con materia de nube**. Composición centrada, aire abundante, jerarquía de tres líneas.
**Lo decisivo:** es el momento emocional de la web y a la vez el mayor conflicto técnico del proyecto. Se trata en §7.

**REF-04 — De Zamorano (captura real)**
Captura de navegador real (se ve la barra de scroll). Hero oscuro con chuletón a la brasa, logotipo caligráfico dorado, wordmark serif crema «DE ZAMORANO», kicker en versalitas espaciadas, dos CTA (píldora dorada sólida + píldora outline), indicador «SCROLL» y navegación de capítulos abajo-derecha (BRASA / CORTE / EMPLATADO / SOBREMESA).
Paleta: negro cálido, latón/dorado, crema. Tipografía serif de display.
**Lo decisivo:** es material real y es lo que da credibilidad a toda la web. **Nunca se sustituye por nada generado.**

**REF-05 — Placa de cielo limpia**
El mismo cielo de REF-01 sin dispositivos. Mar de nubes en la mitad inferior, pico nevado abajo-izquierda, azul limpio y mucho vacío arriba-izquierda.
**Lo decisivo:** REF-01 **es** REF-05 más objetos. Eso confirma que la referencia ya fue construida por capas, y valida la arquitectura que propongo: **una placa madre de cielo y todo lo demás compuesto encima.** REF-05 es por tanto la referencia de estilo maestra para condicionar todas las generaciones de nube.

**REEL — `202607100133_1_1.mp4` (analizado técnicamente)**
`1080×1920` (9:16) · `10,15 s` · `50 fps` · H.264 · **14,1 Mbps · 17,9 MB** · pista de audio presente pero **en silencio absoluto (−91 dB)**.
Contenido: plano continuo de un personaje estilo figura de vinilo (traje negro) caminando hacia cámara por una plaza futurista; torres de cristal, esfera con anillo de neón violeta, cielo azul con cúmulos.

### Lenguaje visual común

| Eje | Lectura |
|---|---|
| **Atmósfera** | Aire, altitud, silencio. Nada está apoyado en el suelo salvo lo que queremos que ancle. |
| **Color** | Dos polos puros: azul cielo + blanco cálido (luz) frente a carbón + azul noche (problema). Un único acento cálido dorado, que además **coincide con el dorado de De Zamorano** — el caso real encaja en la paleta sin forzarla. |
| **Luz** | Direccional, siempre desde **arriba a la derecha**, cálida, con bloom generoso. Es la regla de continuidad más importante: todo asset generado debe compartir esa dirección o el montaje se cae. |
| **Composición** | Alta clave, mucho vacío, sujeto flotando en el tercio central-derecho, texto a la izquierda. Nubes cerrando por abajo y por los laterales, nunca por arriba. |
| **Materiales** | Vapor, cristal, aluminio, caliza. Todo es o traslúcido o mate; no hay plásticos brillantes ni metales cromados. |
| **Planos** | Angular medio, horizonte alto, ligero contrapicado en el hero (miramos hacia arriba: ascensión). |
| **Profundidad** | Tres planos claros: primer término (nube/roca), término medio (dispositivos), fondo (cielo, montaña). Es una invitación explícita al parallax. |
| **Función narrativa** | REF-05 = estado. REF-01 = promesa. REF-02 = conflicto. REF-03 = tesis. REF-04 = prueba. |

### Dos conflictos que hay que nombrar

**a) El reel contradice parcialmente el brief.** Se pidió expresamente *«nada tipo cripto ni cyberpunk»*, y el reel es una ciudad sci-fi con neón violeta. Comparte el cielo azul y las nubes, que salvan la conexión, pero no es atmósfera de marca.
**Recomendación:** usarlo **exclusivamente dentro de la pantalla del móvil del hero y en la sección de servicios**, donde se lee como *«esto es contenido que producimos»* y no como *«así es Altaria»*. Encuadrado dentro de un dispositivo, el choque estilístico deja de ser un problema y pasa a ser una demo. Fuera de un dispositivo, rompería la marca.

**b) El reel está mudo y pesa 40× lo que debería.** 17,9 MB para 10 s es inviable en web. Se re-encoda localmente (coste 0) a ~1,2 MB. El silencio, en realidad, **juega a favor**: el autoplay en web debe ir mudo de todas formas.

---

## 3. Assets que aportará el usuario

| Asset ID | Nombre | Sección | Tipo | Fuente | Descripción | Finalidad narrativa | Formato | Resolución/Duración | Alpha | Prioridad | ¿Bloqueante? | Referencias | Observaciones técnicas |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| USR-01 | De Zamorano — home desktop full-page | Hero, Caso real | user-supplied | Usuario | Captura **de página completa** (no solo el viewport) de la home | Prueba real dentro del portátil; permite scroll animado en pantalla | PNG → WebP | 1600 px ancho × alto real | No | Alta | **Sí** | REF-04 | Capturar a DPR 2 y **sin barra de scroll**; sin barra de navegador. Es la que se anima verticalmente dentro de HG-08 |
| USR-02 | De Zamorano — vistas interiores (3–4) | Caso real | user-supplied | Usuario | Secciones de carta, galería, reservas | Demuestra profundidad del proyecto, no solo un hero bonito | PNG → WebP | 1600 px ancho | No | Alta | No | REF-04 | Recortes por sección, no la página entera |
| USR-03 | De Zamorano — móvil | Caso real, Hero | user-supplied | Usuario | Captura 9:16 de la web en móvil | Rellena móviles del hero con material real | PNG → WebP | 750×1624 | No | Media | No | REF-01 | Necesaria si queremos que **todos** los móviles del hero lleven contenido real |
| USR-04 | Reel vertical | Hero (pantalla móvil), Servicios | user-supplied | Usuario | `202607100133_1_1.mp4` — 10,15 s, 9:16, mudo | Beat 1 del hero: **atención** | MP4 (H.264) + WebM (AV1) + poster JPG | 720×1280 · 10 s · objetivo ≤1,3 MB | No | Alta | **Sí** | — | **Re-encodar obligatorio** (origen: 17,9 MB / 50 fps / 14 Mbps). Ver §13 para el comando exacto. Loop, `muted`, `playsinline`, `preload="none"` |
| USR-05 | Marca Altaria Lights | Global | user-supplied | Usuario | Logo, wordmark, favicon, hex exactos, tipografías con licencia | Identidad | SVG + WOFF2 | Vectorial | Sí | Alta | **Sí (para build)** | — | **No recibido.** No bloquea la generación de assets, sí bloquea la maquetación |
| USR-06 | Fotografías reales del equipo | Equipo | user-supplied | Usuario | Retratos reales | Cercanía y transparencia | JPG → WebP | 1200 px lado corto | No | Media | No | — | **No se generarán personas sintéticas bajo ningún concepto.** Si no hay fotos, la sección se resuelve tipográficamente (ver CODE-11) |
| USR-07 | Datos reales: precios, proceso, testimonios, métricas | Precios, Proceso, Caso real | user-supplied | Usuario | Cifras y textos verificables | Honestidad y conversión | Texto | — | — | Alta | **Sí (para build)** | — | Si no hay métricas verificables de De Zamorano, **no se afirma ningún resultado numérico** |
| USR-08 | Consentimiento de De Zamorano | Caso real | user-supplied | Usuario | Permiso para usarlos como caso público | Legal | — | — | — | Alta | No | — | Trámite, pero conviene tenerlo por escrito antes de publicar |

---

## 4. Assets que deben construirse en código

| Asset ID | Nombre | Sección | Tipo | Fuente | Descripción | Finalidad narrativa | Formato | Resolución/Duración | Alpha | Prioridad | ¿Bloqueante? | Referencias | Observaciones técnicas |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| CODE-01 | **Cielo base + sol** | Todas las claras | code | Código | `linear-gradient` azul→pálido + `radial-gradient` cálido arriba-derecha | Escenario permanente | CSS | Cualquier viewport | — | Alta | **Sí** | REF-05 | **La decisión de mayor impacto del plan.** 0 bytes, nítido a cualquier resolución, y sus stops son variables CSS → el cambio de clima del easter egg es una interpolación, no un asset |
| CODE-02 | Motor de parallax | Apertura, Hero, ¿Lo ves?, CTA | code | Código | Traslación por scroll de las capas HG-01..03 a velocidades distintas | Sensación de profundidad y ascenso | JS + CSS | — | — | Alta | No | REF-01 | `transform: translate3d` sobre `IntersectionObserver`; **respetar `prefers-reduced-motion`** |
| CODE-03 | Composición de pantallas (`matrix3d`) | Hero | code | Código | Inserta USR-01/03/04 dentro de las carcasas HG-08/09/10 con perspectiva | Contenido **real**, nunca falso | CSS 3D | — | — | Alta | **Sí** | REF-01 | Las 4 esquinas de cada pantalla se detectan del render y se resuelve la homografía. Ver §14 |
| CODE-04 | Titular «¿LO VES?» | Bloque central | code | Código | `<h2>` real con `background-clip: text` sobre la textura HG-06 + filtro SVG de desplazamiento | Tesis de la web | HTML/CSS/SVG | — | — | Alta | No | REF-03 | Texto seleccionable, indexable, accesible y traducible. Ver §7 |
| CODE-05 | Paneles rotos del problema | El problema | code | Código | Tarjetas glassmorphism (`backdrop-filter`) con textos reales, y HG-07 superpuesto en `mix-blend-mode` | Presencia digital fragmentada | HTML/CSS | — | — | Alta | No | REF-02 | Las esquirlas se hacen con `clip-path` poligonal + degradados: gratis, animables y más ligeras que un PNG |
| CODE-06 | Easter egg «NO PULSES AQUÍ» | Global | code | Código | Cambio de clima 6–8 s y vuelta | Toque memorable | JS + Canvas 2D | — | — | Media | No | REF-02 | **0 assets nuevos.** Ver desglose en §7 |
| CODE-07 | Lluvia | Easter egg | code | Código | ~300 partículas en Canvas 2D | Clima | Canvas | — | — | Media | No | REF-02 | Un solo canvas; se destruye al terminar. Nunca WebGL para esto |
| CODE-08 | Relámpago | Easter egg | code | Código | Flash de opacidad + trazo SVG con `stroke-dasharray` | Clima | CSS/SVG | — | — | Baja | No | REF-02 | Suave. Riesgo de fotosensibilidad: máximo 2 destellos, nunca >3 Hz |
| CODE-09 | Cards de servicios y pricing | Servicios y precios | code | Código | Tarjetas, tabla comparativa, precios «desde» | Claridad y conversión | HTML/CSS | — | — | Alta | No | — | Nítido, editable, indexable. Generarlo como imagen sería un error grave |
| CODE-10 | Timeline de proceso | Proceso | code | Código | 6 pasos + iconografía de línea | Desmitificar el «cómo» | HTML/SVG | — | — | Alta | No | — | Iconos SVG dibujados a mano, no generados |
| CODE-11 | Equipo y transparencia | Equipo | code | Código | Retícula de retratos (USR-06) + copy | Cercanía | HTML/CSS | — | — | Media | No | — | Si no hay fotos: versión tipográfica con nombres y rol. Nunca *stock* ni personas sintéticas |
| CODE-12 | Header, nav, formularios, footer | Global | code | Código | Toda la UI del sitio | — | HTML/CSS | — | — | Alta | No | REF-01 | — |
| CODE-13 | Contadores / panel de resultados | Hero (beat 3) | code | Código | Panel animado con métricas reales | Beat 3: **crecimiento** | HTML/CSS/JS | — | — | Media | No | — | Sustituye a un clip generado de «campaña». Más honesto, más ligero, y usa datos reales de USR-07 |

---

## 5. Assets que deben generarse con MCP Higgsfield

**11 assets. 4 bloqueantes. 1 opcional. 0 motion.**

| Asset ID | Nombre | Sección | Tipo | Fuente | Descripción | Finalidad narrativa | Formato | Resolución/Duración | Alpha | Prioridad | ¿Bloqueante? | Referencias | Observaciones técnicas |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **HG-01** | **Banco de nubes — primer término** | Apertura, Hero, ¿Lo ves?, Transformación, CTA | still | Higgsfield | Cúmulos volumétricos densos ocupando el tercio inferior, iluminados desde arriba-derecha, sobre azul plano | Suelo del mundo: sobre esto flota todo | WebP + AVIF con alfa | 21:9 · 2K → entrega 2560 px | **Sí** | Alta | **Sí** | REF-05, REF-01 | **Define el ADN visual de toda la web.** Se genera primero y se usa como referencia de estilo para HG-02/03/04. Generar sobre azul saturado plano y extraer alfa por luminancia en local (gratis) |
| **HG-02** | Capa de nubes — término medio | Íd. | still | Higgsfield | Cúmulos más pequeños y desaturados, plano intermedio | Segundo plano de parallax | WebP + AVIF con alfa | 21:9 · 2K | **Sí** | Alta | No | HG-01 | Condicionada por HG-01. Se puede espejar y reescalar en local para multiplicar variedad sin generar |
| **HG-03** | Capa de nubes — cirros altos | Íd. | still | Higgsfield | Velos finos y tenues en la parte alta | Aire y altitud | WebP + AVIF con alfa | 21:9 · 1K basta | **Sí** | Media | No | HG-01 | Se puede lanzar la v1 sin este. Candidato n.º 1 a recorte si aprieta el presupuesto |
| **HG-04** | Capa de nubes de tormenta | El problema, Easter egg | still | Higgsfield | Cúmulonimbos oscuros y turbulentos, borde cálido en la base | Conflicto, y clima del easter egg | WebP + AVIF con alfa | 21:9 · 2K | **Sí** | Alta | No | REF-02 | **Doble uso.** El re-tintado por CSS de HG-01 llega al ~70 % de una tormenta; esta capa aporta el 30 % de turbulencia que el filtro no puede inventar |
| **HG-05** | Roca / pedestal | Hero, CTA final | still | Higgsfield | Peñasco de caliza clara, plano superior útil, matas de hierba y flores diminutas | Ancla el hero; cima en el cierre | WebP con alfa | 3:2 · 2K | **Sí** | Alta | **Sí** | REF-01 | **Dos usos con un asset:** en el hero recortada por abajo, en el CTA entera y más pequeña. Debe generarse con **sombra proyectada propia** hacia abajo-izquierda (sol a la derecha) |
| **HG-06** | Textura de nube/algodón *seamless* | Bloque «¿LO VES?» | still | Higgsfield | Superficie de vapor blanco, iluminación suave y uniforme, sin sujeto | Materia del titular en CSS | WebP | 1:1 · 2K (1024² tras tilear) | No | Alta | No | REF-03 | Es lo que hace posible CODE-04. La continuidad *seamless* se remata en local con *offset + heal* — no confiar en que el modelo la entregue perfecta |
| **HG-07** | Overlay de cristal agrietado | El problema | still | Higgsfield | Patrón radial de grietas con astillas, sobre negro puro | Rotura sobre paneles HTML | PNG → WebP con alfa | 16:9 · 2K | **Sí** | Media | No | REF-02 | Sobre negro puro para poder extraer alfa por luminancia y usarlo en `mix-blend-mode: screen`. **Un solo patrón reutilizable** en todos los paneles con rotación/escala distintas |
| **HG-08** | Carcasa de portátil | Hero | still | Higgsfield | Portátil **genérico y sin marca**, 3/4 flotante, pantalla en color plano | Beat 2: **confianza** (web real dentro) | PNG → WebP con alfa | 3:2 · 4K → entrega 2048 px | **Sí** | Alta | **Sí** | REF-01 | Pantalla en **verde plano `#00FF00`** para detectar las 4 esquinas y resolver el `matrix3d`. Fondo magenta plano para el keying. **Sin logotipos** (marca registrada) |
| **HG-09** | Carcasa de móvil | Hero | still | Higgsfield | Móvil genérico sin marca, flotante, pantalla plana | Contiene el reel real | PNG → WebP con alfa | 9:16 · 2K | **Sí** | Alta | **Sí** | REF-01 | **Un asset, tres móviles:** se reutiliza con rotación, escala y desenfoque distintos por profundidad. Misma dirección de luz que HG-08 |
| **HG-10** | Carcasa de tablet | Hero | still | Higgsfield | Tablet genérica sin marca, flotante | Amplía la familia de dispositivos | PNG → WebP con alfa | 4:3 · 2K | **Sí** | Media | No | REF-01 | Prescindible en v1: el hero funciona con portátil + móviles |
| **HG-11** | Pico de montaña lejano *(opcional)* | Apertura, CTA | still | Higgsfield | Cumbre nevada emergiendo del mar de nubes | Escala y altitud | WebP con alfa | 16:9 · 1K | **Sí** | Baja | No | REF-05 | Puramente atmosférico. Solo si sobran créditos |

---

## 6. Orden de generación recomendado

El orden no es arbitrario: **cada bloque desbloquea al siguiente y reduce su riesgo.**

```
BLOQUE 0 — Sin coste
  Prototipo HTML del hero y del bloque "¿LO VES?" con placeholders grises.
  Confirma encuadres, zonas seguras y el vacío izquierdo ANTES de generar nada.

BLOQUE 1 — ADN visual            [1 asset · GATE DURO]
  HG-01  Banco de nubes frontal
  → Fija sol, temperatura, densidad y estilo de nube para TODO el proyecto.
  → Sin aprobar esto, no se genera nada más.

BLOQUE 2 — Sistema de cielo      [2 assets · condicionados por HG-01]
  HG-02  Nubes término medio
  HG-04  Nubes de tormenta
  → Con HG-01+02+04 ya existen las secciones clara, de transición y oscura.

BLOQUE 3 — Hero jugable          [3 assets · GATE DE INTEGRACIÓN]
  HG-05  Roca / pedestal
  HG-08  Carcasa de portátil
  HG-09  Carcasa de móvil
  → Aquí se valida lo más arriesgado: que USR-01 y USR-04 encajen
    con perspectiva creíble. Se prueba en navegador antes de seguir.

BLOQUE 4 — Momento emocional     [1 asset]
  HG-06  Textura de nube seamless
  → Habilita CODE-04. Punto de decisión del plan B tipográfico (§7).

BLOQUE 5 — Acabado               [2 assets]
  HG-07  Cristal agrietado
  HG-03  Cirros altos

BLOQUE 6 — Opcionales            [2 assets · solo si sobra presupuesto]
  HG-10  Tablet
  HG-11  Pico de montaña
```

---

## 7. Justificación de por qué cada asset sí o no debe generarse

### Lo que NO se genera, y por qué

**El degradado de cielo y el sol → CSS.** Es la decisión que más dinero ahorra y más calidad da a la vez. Un JPG de cielo sería el elemento LCP, pesaría cientos de KB, se recortaría mal entre 16:10 y 21:9, y sería **estático**. En CSS pesa cero, es nítido en cualquier pantalla, pinta de inmediato — y, sobre todo, sus stops son variables CSS. Eso convierte el cambio de clima del easter egg en `transition` sobre cuatro variables en lugar de en una secuencia de vídeo. Un asset menos y una funcionalidad más.

**Cualquier interfaz, titular, botón, precio o formulario → HTML.** Ya está en el brief y lo suscribo sin matices: texto en imagen es texto invisible para Google, ilegible para un lector de pantalla, imposible de traducir, borroso al hacer zoom y caro de corregir. La web de Altaria vende presencia digital; un titular pixelado sería una contradicción en sus propios términos.

**Los paneles rotos del problema → HTML + una sola textura.** Los paneles *son* interfaz: mensajes sin responder, un calendario con reservas caídas, un formulario. Su contenido debe leerse y debe poder editarse. Lo que sí es irreproducible en CSS es la **fractura del cristal**: la geometría de una grieta real tiene una irregularidad que ningún `clip-path` finge bien. Por eso se genera HG-07 y solo HG-07. Las esquirlas sueltas sí salen bien con `clip-path` y además se animan mejor.

**Las capturas de pantalla → material real.** Innegociable. Generar una web falsa para meterla en el portátil destruiría exactamente aquello que la sección viene a demostrar. Además ya existe USR-01.

**Personas → nunca.** Ni equipo sintético, ni testimonios con cara inventada, ni clientes que no existen. Si no hay fotos del equipo, la sección se resuelve con tipografía y sigue transmitiendo cercanía. Una cara falsa en la sección «transparencia» es el peor error posible en esta web.

**Motion → cero assets. Ésta es la decisión que más presupuesto libera.**
Repasemos qué pedía motion y cómo se resuelve sin generarlo:

| Necesidad | Solución | Coste |
|---|---|---|
| Beat 1 — atención | El reel real (USR-04) ya existe | 0 |
| Beat 2 — confianza | Scroll animado por CSS de la captura larga USR-01 dentro del portátil | 0 |
| Beat 3 — crecimiento | Panel de métricas animado en HTML (CODE-13), con **datos reales** | 0 |
| Deriva de nubes | `translate3d` lento sobre HG-01/02/03 | 0 |
| Lluvia, rayo, cambio de clima | Canvas + CSS (CODE-06/07/08) | 0 |

A esto se suma el argumento de rendimiento: un vídeo de fondo cuesta 1–3 MB, compite con el LCP y en móvil se decodifica mal. **El parallax por capas se ve mejor que un vídeo de nubes y pesa una décima parte.**

### Lo que SÍ se genera, y por qué

**HG-01/02/03 (nubes claras).** Es lo único genuinamente irreemplazable del proyecto. Un cúmulo volumétrico con luz de contra no se falsifica con degradados ni con `feTurbulence`: se nota siempre. Tres capas con alfa dan profundidad real, se reutilizan en cinco secciones y son de los assets que mejor comprimen que existen (superficies suaves, poco detalle de alta frecuencia): por debajo de 180 KB cada una.

**HG-04 (tormenta).** Se podría intentar con `filter: brightness(.25) saturate(.6)` sobre HG-01 — y de hecho ése es el 70 % del efecto y lo vamos a usar igualmente para la transición del easter egg. Pero una nube de buen tiempo oscurecida sigue teniendo **silueta de buen tiempo**: bordes redondeados y separados. Una tormenta tiene masa continua y turbulencia. Ese 30 % restante es justo lo que hace creíble la sección del problema. Y el asset se paga dos veces, porque es también el clima del botón absurdo.

**HG-05 (roca).** Da el anclaje físico que distingue «flotar» de «estar suelto en el aire». Se usa dos veces con lecturas distintas: base en el hero, cima en el CTA final. Dos momentos narrativos, un asset.

**HG-08/09/10 (carcasas).** Aquí conviene ser explícito sobre la alternativa. Se podrían usar mockups de dispositivo gratuitos existentes: coste cero y geometría perfecta. Dos motivos para generarlos igualmente:
1. **Legal.** Los frames de dispositivos comerciales llevan marca registrada y condiciones de uso. Una carcasa genérica sin logotipo elimina el problema de raíz.
2. **Continuidad de luz.** Un mockup de stock viene iluminado de forma neutra y plana. Nuestro hero tiene un sol muy marcado arriba a la derecha. Un dispositivo con luz que no corresponde al cielo en el que flota se detecta al instante, aunque el espectador no sepa decir por qué.

Aun así, **si HG-08 falla dos veces, se pasa a mockup libre sin discusión.** Es un asset de riesgo medio-alto y conviene tener el plan B decidido de antemano, no improvisado.

**HG-06 (textura de nube) — la decisión más delicada del proyecto.**

La referencia REF-03 tiene el texto construido *con* nube. Y el brief dice, con razón, que no se genere texto en imagen. Ambas cosas son ciertas a la vez. Opciones:

| Opción | Resultado | Veredicto |
|---|---|---|
| Generar la imagen con el texto incrustado | Fiel a la referencia, pero: no indexable, no accesible, no traducible, se recorta mal, corregir una coma cuesta una generación | **Descartada como opción principal** |
| Generar cada letra como PNG con alfa | ~35 letras, inconsistentes entre sí, carísimo | Descartada |
| **Texto HTML real + `background-clip: text` sobre HG-06 + filtro SVG de desplazamiento + resplandor** | Texto real, nítido, seleccionable, indexable, responsive, editable. **Un asset en vez de un titular cerrado** | **Recomendada** |

Honestamente: la opción recomendada llega a un ~85 % del efecto de la referencia. El 15 % que falta son los bordes algodonosos que desbordan la silueta de la letra, que un recorte de texto no puede producir porque el alfa lo define la tipografía. Se mitiga bastante con `feTurbulence` + `feDisplacementMap` sobre el texto y un `text-shadow` blanco difuso.

**Plan B decidido de antemano:** si al maquetarlo no alcanza el listón, se genera *entonces* la versión con texto incrustado — manteniendo el `<h2>` real oculto para SEO y accesibilidad. Esperar no cuesta nada: la generación vale lo mismo hoy que dentro de dos semanas, y para entonces sabremos si hace falta. Si hay que recurrir al plan B, el modelo indicado es `gpt_image_2`, que es el único del catálogo con etiqueta de renderizado tipográfico.

### El easter egg «NO PULSES AQUÍ» — desglose técnico

| Elemento | Implementación | Assets |
|---|---|---|
| Oscurecimiento del cielo | `transition` sobre las variables de CODE-01 | 0 |
| Nubes que se oscurecen y aceleran | `filter` + `animation-duration` sobre HG-01/02 | 0 (reuso) |
| Entrada de tormenta | HG-04 deslizándose desde arriba | 0 (ya presupuestado) |
| Lluvia | Canvas 2D, ~300 partículas | 0 |
| Relámpago | Flash de opacidad + trazo SVG | 0 |
| Trueno | Sonido CC0, **silenciado por defecto** con conmutador | 0 |
| Vuelta al buen tiempo | La misma transición al revés | 0 |

**Coste en Higgsfield: cero.** El botón no necesita ni un solo asset propio porque toda su materia prima ya está presupuestada para otras secciones. Éste es el mejor argumento a favor de la arquitectura por capas.

Salvaguardas obligatorias: duración total 6–8 s con vuelta automática; interrumpible; el clic no debe desplazar la página; **respeto estricto a `prefers-reduced-motion`** (con la preferencia activa, cambia el color del cielo y nada más); máximo dos destellos y nunca por encima de 3 Hz, por fotosensibilidad; y el botón nunca debe tapar un CTA real.

---

## 8. Qué assets still y qué assets motion

**Still: 11 de 11. Motion: 0 de 11.**

Es una conclusión deliberada, no una omisión. El motion en Higgsfield es el gasto por unidad más alto del catálogo, y en este proyecto **no hay ni una sola necesidad de movimiento que el navegador no resuelva mejor**, con más ligereza y con control total de la reproducción. Además, el único vídeo que la web realmente necesita ya existe y es real (USR-04) — que es exactamente el tipo de material que el brief pide privilegiar.

Reconsideraría el motion solo en un escenario: que se quiera un *hero loop* de deriva de nubes que el parallax por capas no consiga igualar. Mi recomendación es **no reservar presupuesto para ello ahora**; se evalúa con el hero ya montado y con datos de rendimiento reales delante.

---

## 9. Resolución, ratio y duración recomendadas

| Asset | Ratio | Gen. | Entrega web | Formatos | Peso objetivo |
|---|---|---|---|---|---|
| HG-01 | 21:9 | 2K | 2560 px ancho | AVIF + WebP con alfa | ≤180 KB |
| HG-02 | 21:9 | 2K | 2048 px | AVIF + WebP con alfa | ≤140 KB |
| HG-03 | 21:9 | 1K | 1600 px | AVIF + WebP con alfa | ≤80 KB |
| HG-04 | 21:9 | 2K | 2560 px | AVIF + WebP con alfa | ≤200 KB |
| HG-05 | 3:2 | 2K | 1600 px | WebP con alfa | ≤120 KB |
| HG-06 | 1:1 | 2K | 1024×1024 tileable | WebP | ≤90 KB |
| HG-07 | 16:9 | 2K | 2048 px | WebP con alfa | ≤80 KB |
| HG-08 | 3:2 | **4K** | 2048 px | WebP con alfa | ≤220 KB |
| HG-09 | 9:16 | 2K | 1024 px | WebP con alfa | ≤120 KB |
| HG-10 | 4:3 | 2K | 1280 px | WebP con alfa | ≤140 KB |
| HG-11 | 16:9 | 1K | 1280 px | WebP con alfa | ≤60 KB |
| USR-04 (reel) | 9:16 | — | 720×1280 · 30 fps · 10 s | MP4 H.264 + WebM AV1 + poster | ≤1,3 MB |

**Presupuesto total de la página:** ≈1,4 MB de imagen + 1,3 MB de vídeo con `preload="none"`. El *first paint* no depende de ninguno de los dos, porque el cielo es CSS.

Notas de resolución: **`21:9` es el ratio clave** para las nubes — cubre monitores ultrapanorámicos sin estirar y se recorta con elegancia hacia 16:9. HG-08 es el único que justifica 4K: es el objeto más grande y el único con aristas duras, donde cualquier blandura se percibe de inmediato. Las nubes **no deben upscalarse**: son difusas por naturaleza y el upscale solo añadiría peso y grano artificial.

---

## 10. Referencias por asset

Estrategia: **REF-05 es la referencia madre.** Se sube y se usa para condicionar HG-01. Una vez aprobado, **HG-01 pasa a ser la referencia de todo lo demás.** Así la coherencia se hereda en cadena en lugar de reconstruirse en cada prompt, que es donde se van los créditos en re-tiradas.

| Asset | Referencia principal | Referencias de apoyo | Qué se hereda |
|---|---|---|---|
| HG-01 | **REF-05** | REF-01 | Color, densidad, ángulo solar, temperatura |
| HG-02 | **HG-01 aprobado** | REF-05 | ADN de nube, coherencia de escala |
| HG-03 | **HG-01 aprobado** | REF-05 | Continuidad atmosférica |
| HG-04 | **REF-02** | HG-01 | Estructura de nube coherente en clave oscura |
| HG-05 | **REF-01** (roca del hero) | REF-05 | Caliza clara, sombra hacia abajo-izquierda |
| HG-06 | **REF-03** | HG-01 | Materia de vapor idéntica a las nubes de la web |
| HG-07 | **REF-02** | — | Estilo de fractura de los paneles |
| HG-08 | **REF-01** | REF-04 (para el ángulo de pantalla) | Perspectiva 3/4 y luz desde arriba-derecha |
| HG-09 | **REF-01** | HG-08 | Idéntica dirección de luz y acabado |
| HG-10 | **REF-01** | HG-08, HG-09 | Familia de dispositivos consistente |
| HG-11 | **REF-05** (pico abajo-izquierda) | — | Escala y perspectiva atmosférica |

---

## 11. Bloqueantes y no bloqueantes

**Bloqueantes para empezar a construir (4 generados + 3 del usuario)**

| Qué | Por qué |
|---|---|
| HG-01 | Define el ADN visual; **todo lo demás se condiciona a partir de él** |
| HG-05 | Sin la roca, el hero no tiene anclaje ni composición |
| HG-08 | Objeto principal del hero |
| HG-09 | Contiene el reel: el beat 1 de la narrativa |
| USR-01 | Sin captura real, el portátil está vacío |
| USR-04 | Ya entregado ✅ (pendiente de re-encodar) |
| USR-05 (marca) | **No recibido.** No frena la generación, sí la maquetación |

**Pueden venir después:** HG-02, HG-03, HG-04, HG-06, HG-07, HG-10, HG-11, USR-02, USR-03, USR-06, USR-07.

**Ruta crítica:** HG-01 → aprobación → HG-05/08/09 → montaje del hero → validación de perspectiva con USR-01 → resto. **El hero es el mayor riesgo del proyecto y por eso se ataca primero**, no al final.

---

## 12. Dudas y carencias de material detectadas

**Crítico — necesito respuesta antes del Bloque 3**

1. **El reel choca con el brief.** Se pidió expresamente evitar lo cyberpunk y el reel es una ciudad sci-fi con neón violeta. Mi propuesta es encapsularlo dentro de la pantalla del móvil, donde se lee como demo de servicio y no como atmósfera de marca. **¿Se valida ese encuadre, o se prevé sustituirlo por un reel más alineado?**
2. **¿Qué es el reel exactamente?** ¿Pieza para un cliente, demo propia, o mascota de marca? Cambia el rótulo que lleva al lado y cambia la promesa. Y si el personaje reproduce el parecido de una persona concreta, conviene confirmar que hay permiso.
3. **USR-01 no está.** Tengo una captura de viewport de De Zamorano (REF-04), no una captura de página completa. Para el scroll animado dentro del portátil hace falta la larga, a DPR 2 y sin barra de scroll.

**Importante — necesario antes de maquetar**

4. **No hay materiales de marca Altaria Lights**: logo, wordmark, favicon, hex exactos, tipografías (y su licencia web). Es lo único que impide empezar a maquetar en cuanto lleguen los assets.
5. **Precios reales.** La sección es código, pero sin cifras u horquillas no hay contenido. El brief pide honestidad: mejor «desde X €» que un rango inventado.
6. **Métricas de De Zamorano.** Si no hay datos verificables, CODE-13 se replantea como narrativa cualitativa. **No se publicará ninguna cifra que no se pueda sostener.**
7. **Fotos del equipo.** Si no las hay, la sección va tipográfica. Repito la línea roja: no se generarán personas.

**Menor**

8. **¿La web es solo en español?** Si se prevé inglés, refuerza aún más la decisión de mantener el titular «¿LO VES?» en HTML.
9. **Tipografía del bloque central.** El `background-clip: text` pide un palo seco condensado, grueso y de contornos generosos. Conviene elegirla antes de generar HG-06, porque la escala del grano de la textura debe corresponderse con el grosor del trazo.
10. **Sin repositorio previo.** El repo está vacío: no hay web anterior que auditar ni deuda técnica que heredar. Partimos de cero, lo cual es una buena noticia para el rendimiento.

---

## 13. Cómo minimizar coste sin perder calidad

Con **516 créditos y plan `starter`**, el margen es real pero no holgado. Once assets caben con comodidad si no se malgasta en re-tiradas. Tácticas, ordenadas por ahorro:

1. **Maquetar antes de generar.** El Bloque 0 monta el hero con rectángulos grises. Descubrir que un encuadre no funciona cuesta cero en HTML y cuesta una generación en Higgsfield. Es, con diferencia, la medida que más créditos salva.
2. **Una variante por *prompt*.** Nada de pedir cuatro opciones por costumbre. Se genera una, se juzga, y solo se repite si falla. En un sistema por capas la variación real se consigue después, en composición.
3. **Encadenar referencias.** HG-01 condiciona a HG-02/03/04. Un asset bien condicionado sale a la primera; uno descrito solo con texto sale a la tercera.
4. **Explorar barato, rematar caro.** `nano_banana` (etiquetado *budget*) a 1K para tantear composiciones dudosas; `nano_banana_2` a 2K solo para el render definitivo. Un descarte a 1K cuesta una fracción de un descarte a 4K.
5. **Todo el post-proceso en local, gratis.** Extracción de alfa por luminancia, tintado, desenfoque, escalado, espejado, *tiling seamless*, recorte y codificación AVIF/WebP. Reservar la herramienta `remove_background` únicamente para HG-05/08/09/10, donde el borde es duro y el keying manual sí sufre; las nubes sobre azul plano se separan mejor por luminancia, y sale gratis.
6. **Multiplicar por transformación, no por generación.** Un móvil generado son tres móviles en pantalla con distinta rotación, escala y desenfoque. Una capa de nubes espejada y reescalada aporta variedad sin coste. El espectador no detecta la repetición cuando cambian escala y profundidad.
7. **Reutilizar entre estados de ánimo.** La tormenta del problema y la del easter egg son el mismo asset. La roca del hero y la del CTA son el mismo asset.
8. **Upscalar solo lo que tiene aristas.** HG-08 sí. Las nubes no: se degradan a peso sin ganar nada.
9. **Cero motion.** Ya justificado en §8. Es la partida grande que este plan no gasta.
10. **Nada de texto generado.** Cada titular en HTML es una generación que no se hace y un archivo que no se descarga.

**Re-encodado del reel (coste 0, ahorro de 16,6 MB):**

```bash
# 17,9 MB → ~1,2 MB, sin pérdida perceptible en una pantalla de móvil de 300 px
ffmpeg -i 202607100133_1_1.mp4 -vf "fps=30,scale=720:1280" \
  -c:v libx264 -crf 30 -preset slow -profile:v high -pix_fmt yuv420p \
  -movflags +faststart -an reel-altaria.mp4

# Variante AV1 para navegadores modernos (~40 % más ligera)
ffmpeg -i 202607100133_1_1.mp4 -vf "fps=30,scale=720:1280" \
  -c:v libsvtav1 -crf 40 -preset 6 -an reel-altaria.webm

# Poster para que no haya fotograma en negro antes de reproducir
ffmpeg -i reel-altaria.mp4 -ss 1.5 -frames:v 1 -q:v 3 reel-poster.jpg
```

Se elimina la pista de audio (`-an`): está en silencio absoluto, el autoplay debe ir mudo igualmente, y son bytes que no aportan nada.

---

## 14. Pipeline exacto de generación por Higgsfield

### Paso 0 — Preparación (sin coste)

```
select_workspace                  → fijar workspace de destino
balance                           → confirmado: 516 créditos, plan starter
media_upload  REF-05              → referencia madre de cielo
media_upload  REF-01              → referencia de composición del hero
media_upload  REF-02              → referencia de la sección oscura
media_upload  REF-03              → referencia de materia de nube
```

### Modelos seleccionados

| Uso | Modelo | Motivo |
|---|---|---|
| Todos los assets definitivos | **`nano_banana_2`** | Fotorrealista, admite imagen de referencia, hasta 4K, y **soporta `21:9`** — imprescindible para las bandas de nubes |
| Pruebas de encuadre baratas | **`nano_banana`** | Etiquetado *budget*, admite image-to-image, suficiente para juzgar composición |
| *Solo* plan B tipográfico | **`gpt_image_2`** | Único del catálogo con etiqueta de renderizado de texto. **No se usará salvo que §7 lo requiera** |

Se descartan `marketing_studio_image`, `ms_image` y `nano_banana_2_lite`: los dos primeros están orientados a anuncios de producto con *brand kit* (no es nuestro caso y añaden pasos obligatorios), y el tercero está limitado a 1K.

### Bucle por asset

```
1. generate_image(model='nano_banana_2', aspect_ratio=<ratio>,
                  resolution=<1k|2k|4k>, medias=[<referencia>], prompt=<...>)
2. jobs_wait
3. show_generation_by_ids  →  revisión humana  →  APROBAR / REPETIR
4. (solo carcasas y roca)  remove_background
5. (solo HG-08)            upscale_image → 4K
6. Post-proceso local, gratis:
     · nubes  → alfa por luminancia sobre azul plano
     · HG-06  → offset 50 % + heal para seamless real
     · HG-08/09/10 → detección de las 4 esquinas verdes de pantalla
                     y resolución de la homografía → matriz matrix3d
     · codificación AVIF + WebP, presupuesto de peso de §9
```

### Reglas de *prompt* obligatorias en todos los assets

Estas líneas van en **todos** los prompts y son la diferencia entre once assets que forman un mundo y once assets que no pegan entre sí:

- `warm sunlight from the upper right` — la regla de continuidad más importante del proyecto.
- `no text, no letters, no typography, no watermark, no UI` — sin excepción.
- `no logos, no brand marks` — en las carcasas, por marca registrada.
- `photorealistic, soft volumetric light, high key, calm` — el registro emocional.
- Capas de nube: `isolated clouds on flat saturated blue background, no horizon line, no ground` — para que el keying salga limpio.
- Carcasas: `flat solid #00FF00 screen, flat magenta background, no reflections on screen` — para poder detectar las esquinas y componer con `matrix3d`.

### Control de gasto

Tras cada bloque se llama a `balance` y se compara el consumo real con la previsión. Si un asset necesita más de **dos** tiradas, se detiene y se reevalúa antes de insistir: dos fallos seguidos casi nunca significan que haga falta una tercera tirada, sino que el enfoque está mal planteado o que conviene el plan B (mockup libre en HG-08, texto incrustado en HG-06).

---

# SIGUIENTE PASO RECOMENDADO

La secuencia de menor riesgo posible. **Cada puerta es un alto real: no se pasa sin aprobación explícita.**

### Puerta 0 — Antes de gastar un solo crédito *(sin coste)*

Necesito de tu parte:
- Respuesta a las dudas **1, 2 y 3** de §12 (reel y captura full-page).
- Visto bueno a las tres decisiones estructurales: **cielo en CSS**, **nubes por capas con alfa**, **cero motion**.

Y por mi parte, si lo apruebas, monto el **prototipo HTML del hero con placeholders grises**. Sirve para fijar encuadres y zonas seguras, y garantiza que HG-01 se genere ya con el recorte correcto. Es la hora mejor invertida de todo el proyecto y no cuesta nada.

### Puerta 1 — HG-01, en solitario *(1 generación)*

Se genera **únicamente** el banco de nubes frontal. Nada más.
Se revisa contra tres criterios: **¿el sol viene de arriba a la derecha? ¿el azul es el azul de la marca? ¿la densidad de nube deja respirar el tercio izquierdo?**
Si algo no encaja, se corrige aquí — donde cuesta una generación y no once.

> **Ésta es la puerta más importante del plan.** HG-01 no es una nube: es el ADN visual del que hereda todo lo demás.

### Puerta 2 — Sistema de cielo *(2 generaciones)*

HG-02 y HG-04, ya condicionados por HG-01 aprobado.
Criterio: montadas las tres capas en el prototipo, **¿el parallax produce profundidad real? ¿la tormenta convive con la nube clara sin parecer otro proyecto?**

### Puerta 3 — El hero jugable *(3 generaciones · la puerta de mayor riesgo)*

HG-05, HG-08 y HG-09.
Criterio: **USR-01 insertada en el portátil y USR-04 reproduciéndose en el móvil, en navegador, con perspectiva creíble y luz coherente.**
Es el único punto donde el plan puede torcerse de verdad. Si la carcasa no funciona a la segunda tirada, se cambia a mockup libre sin insistir.
Superada esta puerta, **el riesgo del proyecto está prácticamente resuelto.**

### Puerta 4 — El momento emocional *(1 generación)*

HG-06 y maquetación de CODE-04.
Criterio: **¿el titular «¿LO VES?» emociona siendo texto real?**
Si sí, hemos ganado SEO, accesibilidad y traducibilidad sin sacrificar nada. Si no, se activa el plan B de §7 y se genera la versión incrustada — decisión informada y tomada en el momento correcto, no por defecto.

### Puerta 5 — Acabado *(2 generaciones)*

HG-07 y HG-03. Riesgo bajo, se pueden lanzar juntos.

### Puerta 6 — Opcionales *(2 generaciones)*

HG-10 y HG-11, **solo si el saldo lo permite con holgura** tras las cinco puertas anteriores.

---

**Total: 11 generaciones en 6 puertas, de las cuales 4 son opcionales o aplazables.**
Un enfoque ingenuo — una escena cerrada por sección, más clips de motion — habría rondado las 25–30 generaciones, con vídeos de fondo pesados, texto incrustado no indexable y pantallas falsas.

**No se generará nada hasta que este manifiesto quede aprobado.**

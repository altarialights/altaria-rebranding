# PUERTA 0 — Hero reconstruido (5 beats)

> **Higgsfield NO ha sido invocado. Cero generaciones, cero créditos.**
> Saldo intacto: **516 créditos, plan `starter`**.

---

## 1. Archivos

### Nuevos

```
src/lib/capture.ts                      Detección de USR-01, compartida
src/components/hero/Stage.astro         Sticky stage + planos de profundidad
src/components/hero/Sky.astro           L0 · cielo y sol (CSS puro)
src/components/hero/Clouds.astro        L1/L2/L4 · placeholders HG-03/02/01
src/components/hero/Phone.astro         Móvil sin marca, CSS 3D
src/components/hero/Laptop.astro        Portátil sin marca, CSS 3D
src/components/hero/GrowthSystem.astro  Beat 3 · sistema en HTML/SVG
src/components/hero/Copy.astro          L5 · todo el texto del hero
src/components/hero/DebugHud.astro      Capas de depuración B y G
```

### Reescritos

```
src/scripts/hero.ts               Timeline maestra GSAP + ScrollTrigger
src/styles/tokens.css             Geometría de escena y cajas de asset
src/components/SiteHeader.astro   Header transparente → cápsula
src/components/ScreenDeZamorano.astro
src/pages/index.astro
scripts/shoot.mjs                 Arnés de capturas de 5 beats
package.json                      + gsap 3.15
```

### Eliminados

```
HeroStage.astro · SkyBackdrop.astro · CloudLayers.astro · Pedestal.astro
DeviceLaptop.astro · DevicePhone.astro · GrowthFlow.astro
AssetBoxOverlay.astro
```

**Reutilizado:** cielo y sol CSS, el reel ya optimizado, la disciplina de
transformaciones de los dispositivos, el sistema de depuración y los estilos
globales. Todo lo demás es nuevo.

---

## 2. Altura y rangos de scroll

| Concepto | Valor |
|---|---|
| Altura del hero | **460 vh** (`--hero-scroll`) |
| Stage | `sticky`, `top: 0`, `height: 100svh` |
| Recorrido real de scroll @1920×1080 | 3 888 px |
| Scrub | `0.9` |
| Duración de la timeline maestra | **exactamente 1.000** (normalizada) |

| Beat | Rango | Scroll @1920 | Contenido |
|---|---|---|---|
| 0 · Entrada y atmósfera | 0 – 14 % | 0 – 544 px | Cielo, sol, nubes, titular, CTAs |
| 1 · Atención | 14 – 36 % | 544 – 1 400 px | Móvil + reel |
| 2 · Confianza | 36 – 62 % | 1 400 – 2 411 px | Portátil + De Zamorano |
| 3 · Crecimiento | 62 – 86 % | 2 411 – 3 344 px | Sistema conectado |
| 4 · Síntesis y salida | 86 – 100 % | 3 344 – 3 888 px | Los tres + cierre |

---

## 3. Estado de cada objeto por beat

Coordenadas del **centro** del objeto en unidades de viewport. Son los valores
literales de la timeline (`src/scripts/hero.ts`), no estimaciones.

### Móvil

| Beat | x | y | escala | rotX | rotY | rotZ | opacidad |
|---|---|---|---|---|---|---|---|
| inicial (fuera de cuadro) | 112 vw | −18 vh | 0.62 | −8° | −24° | 18° | 0 |
| 1 · protagonista | 70 vw | 47 vh | 1.00 | 2° | −8° | 3° | 1 |
| 2 · secundario | 88 vw | 36 vh | 0.58 | 2° | −10° | 3° | 0.78 |
| 3 · al fondo | 86 vw | 27 vh | 0.46 | 2° | −10° | 3° | 0.60 |
| 4 · síntesis | 80 vw | 31 vh | 0.50 | 2° | −10° | 3° | 0.82 |

### Portátil

| Beat | x | y | escala | rotX | rotY | rotZ | opacidad |
|---|---|---|---|---|---|---|---|
| inicial (bajo el encuadre) | 53 vw | 118 vh | 0.72 | 18° | 8° | −2° | 0 |
| 2 · protagonista | 53 vw | 58 vh | 1.00 | 2° | −4° | 0° | 1 |
| 3 · cede espacio | 47 vw | 58 vh | 0.74 | 2° | −6° | 0° | 1 |
| 4 · síntesis | 55 vw | 54 vh | 0.72 | 2° | −6° | 0° | 1 |
| salida (94 %) | 55 vw | 46 vh | 0.72 | 2° | −6° | 0° | 0.9 |

### Sistema de crecimiento

| Beat | x | y | escala | opacidad |
|---|---|---|---|---|
| inicial | 84 vw | 66 vh | 0.90 | 0 |
| 3 · protagonista | 80 vw | 60 vh | 1.00 | 1 |
| 4 · síntesis | 84 vw | 62 vh | 0.78 | 0.92 |

### Texto y header

| Elemento | Beat 0 | Beat 1 | Beat 2 | Beat 3 | Beat 4 |
|---|---|---|---|---|---|
| Titular (lead) | op 1 · y 0 | op 0.45 · y −6 vh · esc 0.95 | op 0 | op 0 | op 0 |
| Rótulo 01 | — | op 1 | op 0 | — | — |
| Rótulo 02 | — | — | op 1 | op 0 | — |
| Rótulo 03 | — | — | — | op 1 | op 0 |
| Síntesis | — | — | — | — | op 1 |
| Píldora del header | scaleX 1 · transparente | scaleX 0.69 · blanco 72 % · blur 14 | íd. | íd. | íd. |

### Jerarquía en el beat 4

Portátil **1** · sistema **0.78** · móvil **0.50**, tal y como pedía el brief.

---

## 4. Transiciones

**0 → 1 (14 %).** El sol y las nubes ya están asentados. El móvil entra desde
`112 vw / −18 vh` describiendo una curva: `x` corre con `power1.inOut` y `y`
con `power3.out`, de modo que la trayectoria se arquea en lugar de ser recta.
Gira de 18° a 3°, desciende y se estabiliza. El indicio luminoso de la derecha
se apaga y el titular retrocede a 0.45 de opacidad.

**1 → 2 (31–39 %).** El móvil se aparta a la derecha, baja a escala 0.58 y se
queda como prueba de lo anterior — no desaparece. El titular se retira por
completo justo antes de que llegue el portátil: un titular fantasma detrás de
un dispositivo de 800 px se lee como error, no como profundidad. El portátil
emerge desde `118 vh` **atravesando el plano de nubes L4**, que está por
delante de él en el eje Z.

**2 → 3 (57–66 %).** El portátil se desplaza a la izquierda y baja a 0.74 para
abrir sitio. El sistema entra por la derecha y sus piezas aparecen en orden —
creatividad, visita, web, reserva — con 2,8 % de separación entre cada una
(≈110 ms al ritmo de scroll previsto). Los cables se dibujan con
`stroke-dashoffset` detrás de cada nodo.

**3 → 4 (86 %).** El destello recorre la ruta completa **una sola vez** y se
apaga. Los tres objetos se recolocan en la jerarquía final y entra la frase de
síntesis.

**Salida (94–100 %).** Los dispositivos ascienden, las nubes siguen bajando, el
cielo pierde saturación (`saturate(0.88)`) y el texto se desvanece. El sticky
termina y la siguiente sección entra sin corte.

---

## 5. Rendimiento

| Recurso | Bruto | Gzip |
|---|---|---|
| HTML | 13 KB | 3 KB |
| CSS | 20 KB | 5 KB |
| JS (GSAP + ScrollTrigger + hero) | 122 KB | **47 KB** |
| **Total del primer render** | 155 KB | **≈55 KB** |
| Reel | 1,22 MB | `preload="none"` |
| Póster | 104 KB | |

- El módulo JS es **diferido**: no bloquea el primer render.
- El LCP es texto (`<span>` del titular); el cielo es CSS y pinta de inmediato.
- El reel no se descarga hasta que el móvil entra en el beat 1.
- GSAP + ScrollTrigger son 47 KB gzip. Es el coste real de la coreografía
  pedida; conviene tenerlo presente al presupuestar el resto de la home.

## 6. CLS

**0.00000 en 1440, 1920 y 2560**, medido con `PerformanceObserver` recorriendo
el hero completo.

Merece una nota porque no salió gratis. La primera versión daba **0.021**, y al
listar las fuentes resultó que **el 100 % procedía de un único elemento**: la
animación de `width` del header, que relayoutaba sus hijos en cada fotograma
del scrub. Está reescrito: el contenedor mantiene una anchura fija y la cápsula
es un fondo hermano escalado con `transform`, con los dos grupos de contenido
desplazados por `translateX`. Las transformaciones no provocan layout, así que
el morfeo del header ahora cuesta cero.

## 7. Accesibilidad

- `prefers-reduced-motion` verificado en navegador: composición estática
  coherente, los beats siguen avanzando por opacidad y **los cinco titulares
  siguen presentes y legibles en el DOM**.
- Todo el texto es HTML real: seleccionable, indexable, traducible.
- El vídeo lleva `aria-label`, va mudo y sin controles.
- El sistema del beat 3 tiene `role="img"` con descripción del recorrido.
- Foco visible en toda la interfaz.

---

## 8. Confirmaciones

- **Higgsfield no ha sido invocado en ningún momento.** Ninguna llamada
  `generate_*`. Saldo sin tocar: 516 créditos.
- El reel aparece **solo** dentro del móvil, nunca como fondo.
- De Zamorano aparece **solo** dentro del portátil.
- Dispositivos en HTML/CSS 3D: sin imágenes generadas, sin mockups de
  terceros, sin marcas registradas.
- Cielo y luz solar en CSS.
- Sin cifras, testimonios, campañas ni clientes inventados.
- Sin scroll hijacking: scroll normal con `scrub`.
- No se ha desarrollado ninguna sección posterior al hero.
- Sin push: el acceso de escritura sigue devolviendo 403.

---

## 9. Limitaciones detectadas

1. **USR-01 sigue sin llegar como archivo.** Las capturas de De Zamorano
   llegan como imágenes de conversación y no puedo escribirlas en disco. El
   portátil muestra un placeholder neutro que no reproduce contenido del
   cliente. **El scroll interno del beat 2 está implementado pero desactivado**
   hasta que exista el archivo: desplazar un placeholder que encaja exacto en
   el bisel solo revelaría negro. Se activa solo al dejar el PNG en
   `public/media/dezamorano-home.png`.

2. **HG-05 (roca / pedestal) se queda sin uso en el hero.** El nuevo guion no
   contempla ningún pedestal: el portátil emerge de una capa de nubes con
   bruma de contacto. HG-05 deja de ser bloqueante y su único uso posible pasa
   a ser el CTA final («escena elevada, sensación de cima»). Conviene decidir
   si sigue en el plan o se elimina.

3. **Las cajas de nube han cambiado** respecto a la Puerta 0 anterior. Ahora
   son tres bandas (L1/L2/L4) y —lo importante— **la masa de HG-01 debe
   concentrarse en las dos esquinas inferiores, no repartida a lo ancho**. Una
   pared blanca continua aplana el encuadre y se come el clúster de
   dispositivos. Las medidas exactas se leen con la tecla `B`.

4. **GSAP pesa 47 KB gzip.** Es asumible para este hero, pero si el resto de la
   home no necesita coreografía conviene no extender su uso por inercia.

5. **El reel sigue siendo estéticamente ajeno a la marca** (ciudad sci-fi con
   neón violeta). Encapsulado en el móvil funciona como demo de servicio, que
   es lo aprobado, pero sigue pendiente decidir si se sustituye.

---

## 10. Depuración

| Tecla | Capa |
|---|---|
| `B` | Cajas de asset: rectángulos exactos de HG-01, HG-02, HG-03 y HG-04 con dimensiones en píxeles en vivo |
| `G` | HUD de escena: progreso global, beat actual, progreso local, rango del beat y bounding boxes de móvil, portátil, sistema, texto y header |

También por URL: `?boxes=1` y `?hud=1`. Ambas capas están ocultas por defecto,
así que las capturas finales salen limpias.

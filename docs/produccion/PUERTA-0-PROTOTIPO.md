# PUERTA 0 — Prototipo del hero (sin créditos Higgsfield)

> Estado: **listo para revisión**. Cero generaciones. Cero créditos gastados.
> Saldo Higgsfield intacto: **516 créditos, plan `starter`**.

---

## 1. Qué se ha construido

Un prototipo funcional del hero en Astro, con todos los assets de Higgsfield
sustituidos por *placeholders* que ocupan **exactamente** la caja que ocupará
el asset final. El objetivo no es que el prototipo sea bonito: es que las
cajas, las escalas y el recorrido sean correctos **antes** de generar.

### Archivos creados

```
astro.config.mjs                          Configuración Astro 7
package.json

src/
  layouts/Base.astro                      HTML base, lang="es-ES", slot de favicon
  pages/index.astro                       Página única del prototipo
  styles/
    tokens.css                            ★ FUENTE ÚNICA DE VERDAD de las cajas de asset
    global.css                            Reset, foco visible, prefers-reduced-motion
  components/
    SkyBackdrop.astro                     CODE-01 · cielo + sol, 100 % CSS
    CloudLayers.astro                     Placeholders de HG-01 / HG-02 / HG-03
    Pedestal.astro                        Placeholder de HG-05
    DeviceLaptop.astro                    Portátil sin marca, CSS 3D
    DevicePhone.astro                     Móvil sin marca, CSS 3D
    ScreenDeZamorano.astro                Placeholder de USR-01 (auto-sustituible)
    GrowthFlow.astro                      Beat 3 cualitativo, sin cifras
    SiteHeader.astro                      Wordmark HTML temporal + slots reservados
    AssetBoxOverlay.astro                 ★ Visor de cajas de asset (tecla B)
  scripts/hero.ts                         Scroll driver, parallax, lazy del reel

public/
  media/reel-altaria.mp4                  Reel reencodado · 1,22 MB
  media/reel-poster.jpg                   Póster · 103 KB
  brand/favicon.svg                       Marcador; se sustituye por USR-05

scripts/shoot.mjs                         Arnés de capturas para revisión
review/*.png                              12 capturas de revisión
```

### Cómo revisarlo

```bash
pnpm install
pnpm dev          # http://localhost:4321
```

- **Tecla `B`** (o `?boxes=1`): muestra las cajas exactas de HG-01, HG-02,
  HG-04 y HG-05 con sus dimensiones en píxeles en vivo.
- Scroll completo del hero: 320 vh, tres beats.

---

## 2. Decisiones ya implementadas

| Decisión | Estado |
|---|---|
| Cielo y sol en CSS | ✅ `SkyBackdrop.astro` — 0 bytes, variables animables listas para el easter egg |
| Nubes en capas independientes | ✅ 3 capas con parallax propio |
| Dispositivos sin Higgsfield | ✅ CSS 3D, sin marca, sin mockup de terceros |
| Pantalla = contenido real insertado aparte | ✅ El reel es un `<video>` real dentro del móvil |
| Reel solo dentro de un dispositivo | ✅ Nunca aparece como fondo |
| Reel reencodado sin audio | ✅ 17,9 MB → **1,22 MB** · 720×1280 · 30 fps |
| Rótulo del reel | ✅ «Contenido que consigue atención.» |
| Sin logo inventado | ✅ Wordmark HTML `ALTARIA LIGHTS` + slots reservados |
| Español de España, titulares en HTML | ✅ `lang="es-ES"`, `<h1>` real |
| Beat 3 cualitativo, sin métricas | ✅ Contenido → Visita → Web → Contacto o reserva |
| Sin precios ni testimonios inventados | ✅ No existen en el prototipo |
| Cero motion generado | ✅ Todo el movimiento es CSS/JS |

**Nota sobre el WebM:** se probó una variante AV1/VP9 y salió **más pesada**
(1,4 MB) que el H.264 (1,22 MB). Se descarta: añadir un segundo formato solo
sumaría peso. El MP4 tiene soporte universal y ya cumple el objetivo de 1–1,3 MB.

---

## 3. Cajas exactas de los assets Higgsfield

Medidas reales tomadas del navegador en las tres resoluciones objetivo.
`x/y` son la esquina superior izquierda dentro del stage de 100 vh.

### HG-01 · Nubes de primer término

| Viewport | x | y | Ancho | Alto | Ratio real |
|---|---|---|---|---|---|
| 1440×900 | 0 | 540 | **1440** | **378** | 3,81 : 1 |
| 1920×1080 | 0 | 648 | **1920** | **454** | 4,23 : 1 |
| 2560×1440 | 0 | 864 | **2560** | **605** | 4,23 : 1 |

### HG-02 · Nubes de término medio

| Viewport | x | y | Ancho | Alto | Ratio real |
|---|---|---|---|---|---|
| 1440×900 | 0 | 450 | **1440** | **270** | 5,33 : 1 |
| 1920×1080 | 0 | 540 | **1920** | **324** | 5,93 : 1 |
| 2560×1440 | 0 | 720 | **2560** | **432** | 5,93 : 1 |

### HG-04 · Nubes de tormenta (a pantalla completa)

| Viewport | x | y | Ancho | Alto | Ratio real |
|---|---|---|---|---|---|
| 1440×900 | 0 | 0 | **1440** | **900** | 16 : 10 |
| 1920×1080 | 0 | 0 | **1920** | **1080** | 16 : 9 |
| 2560×1440 | 0 | 0 | **2560** | **1440** | 16 : 9 |

### HG-05 · Roca / pedestal

| Viewport | x | y | Ancho | Alto | Ratio real |
|---|---|---|---|---|---|
| 1440×900 | 691 | 584 | **461** | **307** | 1,50 : 1 |
| 1920×1080 | 922 | 660 | **614** | **409** | 1,50 : 1 |
| 2560×1440 | 1254 | 983 | **666** | **443** | 1,50 : 1 |

---

## 4. Hallazgos del prototipo que corrigen el manifiesto

Esto es precisamente para lo que servía la Puerta 0.

### 4.1 Las bandas de nube son mucho más apaisadas que 21:9

El manifiesto proponía generar HG-01 y HG-02 en 21:9 (2,33 : 1). Medido en
el navegador, **la caja real de HG-01 es de 3,8 : 1 a 4,2 : 1** y la de HG-02
llega a **5,9 : 1**. Un asset 21:9 estirado a cubrir esa banda desperdiciaría
más de la mitad de su altura.

**Corrección:** seguimos generando en **21:9** (es el ratio más ancho que
ofrece `nano_banana_2`), pero **recortamos en local, gratis**, a la banda
final. Consecuencia directa para el prompt:

> Las coronas iluminadas de las nubes deben quedar en **la mitad inferior**
> del encuadre generado, porque el recorte se queda con esa zona.

Sin este hallazgo, el primer HG-01 habría salido con la masa de nube centrada
y habríamos perdido la generación.

### 4.2 HG-04 no es 21:9, es 16:9

La tormenta es a pantalla completa, no una banda. Se genera en **16:9** con la
masa densa en el 60 % superior. (El manifiesto decía 21:9 por inercia con las
otras capas de nube: es un error y queda corregido.)

### 4.3 HG-05 confirma 3:2 exacto

La caja da 1,50 : 1 en las tres resoluciones. El ratio del manifiesto era
correcto. **No cambia nada.**

### 4.4 El valor tonal de la roca es la instrucción crítica

En la primera versión la roca era clara y **desaparecía** contra el banco de
nubes blanco. El cuerpo de la roca tiene que ser **más oscuro que las nubes**;
solo el plano superior iluminado se acerca al blanco. Va al prompt de HG-05
como requisito, no como sugerencia.

### 4.5 El parallax va hacia abajo, no hacia arriba

La narrativa es ascensión: al hacer scroll **la cámara sube**, así que las
capas de suelo (nubes, roca) **bajan** y salen de cuadro, y los dispositivos
se elevan levemente. Con el signo invertido, el banco de nubes subía y se
tragaba la composición.

### 4.6 A 2560 la composición se partía en dos

Con el gutter original, la columna de texto quedaba a ~950 px del clúster de
dispositivos y el hero se leía como dos mitades sin relación. Corregido con un
gutter proporcional (`9vw`) y acercando el clúster a partir de 2200 px.

---

## 5. Rendimiento medido

| Métrica | Valor |
|---|---|
| HTML | 12 KB |
| CSS | 22 KB (crítico, en línea) |
| JS | **1,8 KB en línea** — ninguna petición extra |
| **Total del primer render** | **≈34 KB** |
| Reel | 1,22 MB con `preload="none"` — no se descarga hasta que el móvil entra en pantalla |
| Elemento LCP | el `<h1>`, texto real: el cielo es CSS y pinta de inmediato |

El primer render **no depende de ninguna imagen**. Cuando lleguen HG-01…HG-05
solo HG-01 debería precargarse.

## 6. Accesibilidad

- `prefers-reduced-motion` verificado en navegador: **cero transformaciones de
  parallax**, y los beats siguen avanzando, de modo que ningún contenido queda
  inalcanzable.
- Titulares y textos son HTML real: seleccionables, indexables, traducibles.
- Foco visible en toda la interfaz.
- El vídeo lleva `aria-label` y no tiene audio.

---

## 7. Qué sigue pendiente de ti

| Ref | Qué | Bloquea |
|---|---|---|
| USR-01 | Captura full-page de la home de De Zamorano (DPR 2, sin barra de scroll) | Solo el realismo del portátil; el prototipo ya funciona sin ella |
| USR-05 | Logo, hex y tipografías con licencia | La maquetación final, no la generación |
| USR-07 | Precios, proceso, textos | Las secciones posteriores |

**Sustitución de USR-01:** basta con dejar el PNG en
`public/media/dezamorano-home.png`. El componente lo detecta y lo usa
automáticamente, sin tocar una línea de markup.

---

## 8. Estado del repositorio

El trabajo está commiteado en `claude/altaria-lights-production-plan-bkujlj`.
**No se ha hecho push:** el token de esta sesión tiene lectura pero no
escritura sobre el repositorio (GitHub devuelve 403 en `git push`, mientras
que `git ls-remote` funciona). Se requiere que un administrador conceda
permiso de escritura.

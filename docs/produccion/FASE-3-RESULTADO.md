# FASE 3 — RESULTADO

- Fecha de validación: 11 de agosto de 2026.
- Baseline archivado: commit `3802458`.
- Ámbito: hero desktop de Altaria Lights.

## 1. Resumen ejecutivo

La Fase 3 introduce tres representaciones independientes del mismo hero:

- **Full** conserva el árbol, la dirección visual, el vídeo, el 3D, las nubes, las interacciones y la timeline aprobados.
- **Balanced** reconstruye la experiencia como una composición 2.5D de 248 nodos, sin vídeo, filtros SVG ni `preserve-3d`.
- **Lite** utiliza una representación plana premium de 149 nodos, sin vídeo, filtros, `backdrop-filter`, 3D complejo ni loops decorativos permanentes.

La selección ocurre antes de inicializar cualquier runtime caro. Solo se clona un árbol, solo se restauran sus assets y solo se importa su módulo. Los otros dos tiers permanecen en `<template>` inerte y se eliminan antes de arrancar la timeline.

Resultado principal bajo Chromium, 1366×768 y CPU ×6:

| Métrica | Full | Balanced | Lite |
|---|---:|---:|---:|
| FPS aproximado | 25,60 | 60,00 | 60,00 |
| P95 | 66,65 ms | 16,70 ms | 16,80 ms |
| TaskDuration | 3179 ms | 2280 ms | 2037 ms |
| Trabajo idle | 485 ms | 114 ms | 80 ms |
| Hilo principal libre en idle | 68,37% | 92,50% | 94,74% |
| Nodos del hero | 1177 | 248 | 149 |
| Transferencia tras recorrer el hero | 4,049 MiB | 0,685 MiB | 0,676 MiB |

Balanced reduce P95 un 74,9%, TaskDuration un 28,3% y el DOM del hero un 78,9% respecto a Full. Lite reduce P95 un 74,8%, TaskDuration un 35,9% y el DOM un 87,3%.

## 2. Arquitectura de tiers

### Cuándo y cómo se decide

`performance-tier-boot.js` se inyecta como JavaScript clásico síncrono al principio de `<head>`, inmediatamente después del `viewport`. Lee el override, capacidades, red, viewport y cualquier downgrade de la sesión antes de que exista un hero pintable.

La decisión preliminar se publica en:

```html
<html data-performance-tier="balanced">
```

El orden de prioridad es:

1. `?perf=full|balanced|lite`.
2. Conservación del renderer compacto existente por debajo de 1020 px.
3. Heurística de capacidades y red.
4. Un downgrade previo de la misma `sessionStorage`, únicamente si abarata el tier.
5. Balanced como fallback conservador.

### Cómo se monta

El host contiene tres templates parser-inert y un outlet vacío. El bootstrap:

1. clona en un `DocumentFragment` solo el candidato;
2. neutraliza `src`, `srcset` y `poster` antes de conectarlo;
3. conecta el candidato durante dos frames reales;
4. finaliza el frame-health guard;
5. si procede, remonta una única vez un tier inferior;
6. bloquea el tier;
7. restaura únicamente los assets del árbol definitivo;
8. elimina los tres templates;
9. importa dinámicamente un solo runtime;
10. inicializa una sola timeline.

Full, Balanced y Lite nunca coexisten como árboles activos. Tampoco coexisten sus ScrollTriggers, listeners, vídeos o runtimes.

### Protección frente a preload

Ocultar un `<img>` o un `<video>` no evita necesariamente su descarga. Por eso los atributos multimedia se trasladan a atributos `data-performance-*` mientras el fragmento está desconectado. En Full, la URL del reel permanece además fría hasta la primera intención real de navegación, ya que WebKit puede ignorar `preload="none"`.

## 3. Full

### Cambios realizados

No se ha rediseñado Full ni se ha sustituido su timeline. Los cambios son de integración:

- Full vive dentro del nuevo host selectivo.
- Su runtime se carga mediante `import()` solo cuando ha ganado el resolver.
- La interacción de swatches de la tablet se movió del `<script>` hoisted del componente al runtime Full; así no crea listeners desde un template inactivo.
- Se mantiene fría la URL del reel hasta el primer scroll para impedir el preload no solicitado de WebKit.
- Los handlers de `pagehide/pageshow` se prepararon para no disponer el runtime cuando `event.persisted=true`.
- Durante los dos frames preliminares se replica exactamente el estado de pintura Full en progreso 0: superficies futuras ocultas e intro en estado idle.

### Equivalencia visual

La regresión se comparó contra el `dist` exacto del commit `3802458`, en nueve momentos y dos viewports.

- `full-final` produce 14/18 capturas byte a byte idénticas; varían Intro y Monitor.
- `full-repeat` produce 16/18 idénticas; solo varía Intro, un estado temporal que tampoco es byte-determinista entre las dos pasadas del propio baseline.
- En `full-repeat`, phone, laptop, las tres miniwebs, monitor, tablet y flow coinciden exactamente en 1366×768 y 1920×1080.
- Los 18 estados conservan progreso y `overflowX = 0`.

La igualdad SHA se reporta por separado de la revisión perceptual: la inspección manual no detectó cambios de composición en los estados variables. Full mantiene vídeo, CSS 3D, nubes, intro, monitor vivo, tablet, flow y easter eggs.

### Rendimiento frente al baseline

Se usan dos pasadas del baseline y dos de Full para no confundir ruido con regresión:

| Métrica | Baseline, mediana | Full, mediana | Diferencia |
|---|---:|---:|---:|
| FPS | 25,06 | 25,60 | +2,1% |
| P95 | 66,70 ms | 66,65 ms | −0,1% |
| TaskDuration | 3137,9 ms | 3179,2 ms | +1,3% |

El rango observado de TaskDuration del baseline fue 3005–3271 ms y el de Full 3115–3243 ms. TaskDuration queda dentro del rango observado del baseline y P95 se mantiene; no se detecta una regresión clara en estas dos pasadas.

## 4. Balanced

Balanced mantiene los cinco beats, las tres escenas internas de la web y toda la identidad, pero nace como renderer 2.5D independiente.

| Beat | Solución visual | Simplificación principal |
|---|---|---|
| Intro | H1 real Puffy sobre cielo, bancos de nubes con lóbulos y parallax de scroll | `opacity`, `translate` y escala; sin turbulence ni displacement |
| Móvil | Teléfono 2.5D con cámaras, notch, highlights y póster real | Una carcasa frontal de pocas capas; sin vídeo ni sólido 3D |
| Portátil | Tapa, pantalla, base, teclado y trackpad 2.5D | Apertura por `scaleY`; sin caras CSS 3D |
| Miniweb 1 | «Tu web habla antes que tú», pilares y card de confianza | HTML reducido; sin efectos secundarios caros |
| Miniweb 2 | Cuatro beneficios, iconos y card destacada | Grid estático, transiciones de opacity/translate |
| Miniweb 3 | Gráfica, módulos y resultados | Barras y módulos planos, sin loops |
| Monitor | Carcasa premium, rail, editor, gráfica y módulos | Dashboard estático; sin monitor life ni diez animaciones |
| Tablet | Logo animado nube→marca, tipografías, jerarquía, wordmark, paleta y variantes | Frame 2.5D; hover de hex por CSS |
| Flow | Hub, una órbita y cinco cards con microcopy | Sin imagen de 2,26 MiB, glows, filtros ni múltiples órbitas |
| Cielo/easter eggs | Sol, pájaros, avión y cohete con movimiento ligado al scroll | Sin loops idle; reacción solo al interactuar |

Balanced usa 248 nodos, cero filtros del hero y cero `preserve-3d`. Su único movimiento ambiental continuo durante la historia es el desplazamiento reversible de un wrapper de nubes, por transform y ligado al scroll; al parar el scroll queda idle.

Las métricas de los nueve estados de Balanced se detallan en la sección 13.

## 5. Lite

Lite cuenta exactamente la misma historia con menos superficies y con formas CSS planas de alta legibilidad.

| Beat | Solución visual | Simplificación principal |
|---|---|---|
| Intro | Mismo copy, cielo y bancos de nubes | Salida corta opacity/translate/scale, sin efectos de raster |
| Móvil | Teléfono plano premium con borde, sombra, notch CSS y póster | Sin vídeo, cámaras adicionales ni contexto 3D |
| Portátil | Ilusión de tapa y base con teclado CSS | Apertura `scaleY`; menos detalles y sombras |
| Miniweb 1 | Copy, card CSS y cuatro pilares | Decoración dibujada con pseudo-elementos |
| Miniweb 2 | Cuatro beneficios completos | Cards tipográficas sin subnodos de icono |
| Miniweb 3 | Gráfica CSS y cuatro resultados | Gráfica en backgrounds, sin nodos de barras |
| Monitor | Monitor reconocible con dashboard plano | UI sintetizada en un elemento y dos pseudos |
| Tablet | Logo, dos especímenes tipográficos y cuatro swatches | Sin jerarquía, wordmark y variantes secundarios |
| Flow | Hub y grid simétrico 3+2 | Sin órbita, microcopy ni glow |
| Cielo/easter eggs | Mismo sol clickable y siluetas simplificadas | El runtime los prepara una vez y solo los hace visibles/interactivos en su ventana; cero partículas perpetuas |

Lite usa 149 nodos, cero vídeo, filtros, `preserve-3d`, `backdrop-filter`, `will-change`, keyframes o loops permanentes. La miniweb sigue teniendo tres estados reales controlados por el scroll principal.

Las métricas de los nueve estados de Lite se detallan en la sección 13.

## 6. Detección automática

| Señal | Full | Balanced | Lite |
|---|---|---|---|
| `deviceMemory` + cores | memoria ≥8 y cores ≥8 | combinaciones intermedias o desconocidas | memoria ≤4 y cores ≤4 |
| Señal muy débil aislada | no | por defecto | memoria ≤2 o cores ≤2 si además hay ahorro de datos/red 2G |
| `saveData` | impide Full | sí, salvo combinación claramente débil | junto a memoria/CPU muy limitada |
| `effectiveType` 2G/slow-2G | impide Full | sí, salvo combinación claramente débil | junto a memoria/CPU muy limitada |
| APIs ausentes | no se presupone potencia | fallback | solo con otra evidencia fuerte |
| ancho <1020 px, automático | renderer Full-compact aprobado | — | — |
| Reduced Motion | no selecciona tier | no selecciona tier | no selecciona tier |

Casos ambiguos van a Balanced. Full exige dos señales fuertes independientes; una sola cifra alta no basta. Lite tampoco se asigna a un portátil normal por una señal aislada. No existe UA sniffing ni una lista de GPUs, Windows o navegadores.

## 7. Runtime frame health

El monitor empieza en el `<head>` y observa únicamente el ritmo real de los primeros frames. No ejecuta una animación de benchmark. Conserva como máximo 48 deltas y mide:

- mediana;
- P95;
- frames ≥34 ms;
- frames ≥50 ms;
- frames ≥100 ms;
- peor frame.

El bootstrap espera dos `requestAnimationFrame` con el candidato ya conectado. Se incluye el intervalo head→primer paint para que un cliente rápido también genere las dos muestras requeridas.

Puede hacer exclusivamente:

- Full → Balanced;
- Balanced → Lite.

Con cuatro o más muestras, Full baja si la mediana llega a 34 ms, hay una proporción elevada de frames lentos con P95 ≥50 ms o aparecen dos frames ≥100 ms. Balanced baja con mediana ≥50 ms, una proporción severa con P95 ≥85 ms o tres frames ≥100 ms. Con solo dos o tres muestras se aplican umbrales más severos: Full necesita dos frames ≥50 ms y mediana ≥45 ms; Balanced, dos frames ≥100 ms. Así se evitan downgrades por ruido aislado.

No se calibra si hay override, viewport compacto, documento oculto, navegación restaurada, hash profundo o scroll previo. Tras la decisión se bloquea el tier antes del primer import. Nunca cambia durante un giro, beat o interacción.

Solo un downgrade real se guarda en `sessionStorage`; nunca se persiste una mejora ni se escribe almacenamiento permanente.

## 8. Overrides

Los tres overrides tienen prioridad absoluta y omiten toda calibración:

```text
?perf=full
?perf=balanced
?perf=lite
```

Con `?debug=1` aparece un HUD no interactivo con tier, razón, viewport, memoria, cores, red, Reduced Motion, restored scroll, frame health y si hubo downgrade. Sin `debug=1` no se muestra UI pública.

La suite funcional verificó override, heurística, APIs desconocidas, `saveData`, sesión, downgrade temprano, lock, restored scroll, 1019/1020, Reduced Motion, debug y aislamiento de runtime/assets.

## 9. Network

Medición CDP con caché desactivada y el mismo servidor estático local sin compresión. Es una comparación reproducible, no una predicción del tráfico CDN.

| Métrica | Full | Balanced | Lite |
|---|---:|---:|---:|
| Transferencia inicial | 0,721 MiB | 0,685 MiB | 0,676 MiB |
| Total tras recorrer hero | 4,049 MiB | 0,685 MiB | 0,676 MiB |
| Requests iniciales | 13 | 14 | 12 |
| Requests totales | 15 | 14 | 12 |
| Imágenes | 2,302 MiB | 0,141 MiB | 0,132 MiB |
| Vídeo | 1,168 MiB | 0 | 0 |
| JavaScript | 171,9 KiB | 135,3 KiB | 135,3 KiB |
| CSS | 149,1 KiB | 149,1 KiB | 149,1 KiB |
| Fuentes | 122,3 KiB | 122,3 KiB | 122,3 KiB |

El total Full de 4,049 MiB y 15 requests es la pasada representativa con una descarga completa del MP4. `full-repeat` emitió una segunda petición Range completa y terminó en 5,217 MiB/16 requests. Por tanto, el total Full depende del comportamiento Range del navegador; Balanced y Lite permanecieron estables y sin vídeo.

Network confirma:

- Full no pide el MP4 en el arranque y sí lo carga al entrar en la historia del móvil.
- Balanced no solicita MP4, `centro-nodos.png` ni chunks Full.
- Lite no solicita ningún MP4, variantes de marca Balanced, `centro-nodos.png` ni chunks Full/Balanced.
- Cada tier importa únicamente su wrapper y el runtime que necesita.

El HTML contiene los templates inertes de los tres tiers, lo que añade transferencia inicial respecto al baseline, pero no nodos activos/pintables. El coste bruto local es aproximadamente +49 KiB de documento, +39 KiB de CSS y +13 KiB de JS en Full. En producción comprimida será menor, pero sigue siendo un tradeoff explícito de esta arquitectura.

## 10. Memoria

Estas métricas no deben sumarse: pertenecen a dominios distintos y no equivalen a memoria total de proceso o GPU.

| Métrica aproximada | Full | Balanced | Lite |
|---|---:|---:|---:|
| JS heap usado | 3,481 MiB | 2,681 MiB | 2,619 MiB |
| JS heap reservado | 4,109 MiB | 3,359 MiB | 3,109 MiB |
| Embedder heap | 4,926 MiB | 2,337 MiB | 2,065 MiB |
| Backing storage | 193,7 KiB | 153,1 KiB | 153,0 KiB |
| Imágenes RGBA potenciales | 6,579 MiB | 4,095 MiB | 4,016 MiB |
| Decoder de vídeo | reel 720×1280 | ninguno | ninguno |

Balanced reduce el heap JS usado un 23,0% y Lite un 24,7%. La aproximación de imágenes decodificadas baja un 37,8%/39,0%. El runner no expone memoria real del decoder ni memoria GPU; ambas quedan **N/D** y no se fabrica una cifra para ellas.

## 11. DOM / compositor

| Métrica | Full | Balanced | Lite |
|---|---:|---:|---:|
| Elementos documento | 1267 | 339 | 240 |
| Elementos hero | 1177 | 248 | 149 |
| Nodos CDP | 3059 | 862 | 664 |
| Event listeners | 99 | 54 | 54 |
| Cajas renderizadas, máximo | 318 | 133 | 67 |
| Candidatos pintables en viewport, máximo | 291 | 133 | 67 |
| Elementos del hero con `filter`, máximo | 44 | 0 | 0 |
| `preserve-3d`, máximo | 7 | 0 | 0 |

Balanced mantiene un pequeño blur solo en la cápsula compartida del header; Lite lo elimina. Dentro del hero ambos tiers tienen cero filtros y cero `backdrop-filter`.

`Performance.getMetrics` no expuso Paint, Layerize, número de capas ni área promovida en este Chromium. El runner los declara **N/D** y no inventa valores. «Candidatos pintables» es una aproximación DOM/computed-style, no una capa real del compositor.

## 12. Performance global

Metodología: Chromium, 1366×768, CPU ×6, scroll normalizado 0→0,964 durante 6000 ms. Full y baseline usan la mediana de dos pasadas; Balanced y Lite corresponden a una pasada final cada uno.

| Métrica | Baseline | Full | Balanced | Lite |
|---|---:|---:|---:|---:|
| FPS aproximado | 25,06 | 25,60 | 60,00 | 60,00 |
| P95 | 66,70 ms | 66,65 ms | 16,70 ms | 16,80 ms |
| TaskDuration | 3137,9 ms | 3179,2 ms | 2279,9 ms | 2036,5 ms |
| LayoutDuration | 11,82 ms | 9,32 ms | 0 | 0 |
| RecalcStyle | 851,5 ms | 861,9 ms | 248,3 ms | 241,9 ms |
| Paint | N/D | N/D | N/D | N/D |
| Layerization | N/D | N/D | N/D | N/D |

Balanced y Lite alcanzan el techo de 60 Hz del entorno. Su ScriptDuration absoluto procesa más callbacks precisamente porque presenta más del doble de frames; normalizado queda en 1,97 ms/frame para Balanced y 1,75 ms/frame para Lite, frente a 3,59 ms/frame en Full.

Como referencia de varianza, una pasada Full alcanzó un frame máximo de 183,3 ms; aun así, P95 permaneció entre 66,6 y 66,7 ms en ambas pasadas.

### Idle

Ventana de 1500 ms estacionada en miniweb 2, después de 1300 ms de settle y con `scrollDeltaPx = 0`:

| Métrica | Full | Balanced | Lite |
|---|---:|---:|---:|
| FPS | 29,68 | 60,00 | 60,00 |
| P95 | 50,0 ms | 16,7 ms | 16,7 ms |
| TaskDuration | 485,0 ms | 113,7 ms | 79,8 ms |
| RecalcStyle | 89,5 ms | 0 | 0 |
| Hilo principal libre | 68,37% | 92,50% | 94,74% |

## 13. Performance por beat

Formato de cada celda: `FPS / P95 ms / TaskDuration ms`.

| Beat | Full | Balanced | Lite |
|---|---:|---:|---:|
| Intro | 23,1 / 50,1 / 277,9 | 60,0 / 16,7 / 203,6 | 60,0 / 16,7 / 183,0 |
| Móvil | 20,4 / 100,0 / 288,8 | 60,0 / 16,8 / 244,5 | 60,0 / 16,7 / 211,1 |
| Portátil | 28,6 / 50,0 / 354,7 | 58,6 / 16,7 / 315,5 | 60,0 / 16,8 / 271,0 |
| Miniweb 1 | 29,0 / 50,0 / 334,6 | 60,0 / 16,7 / 243,7 | 60,0 / 16,8 / 214,2 |
| Miniweb 2 | 28,0 / 50,1 / 311,3 | 60,0 / 16,7 / 238,7 | 60,0 / 16,7 / 192,1 |
| Miniweb 3 | 28,0 / 50,0 / 321,5 | 60,0 / 16,8 / 248,6 | 60,0 / 16,7 / 214,5 |
| Monitor | 28,6 / 50,0 / 539,1 | 60,0 / 16,8 / 227,3 | 60,0 / 16,8 / 202,7 |
| Tablet | 28,0 / 50,0 / 416,0 | 60,0 / 16,8 / 279,0 | 60,0 / 16,8 / 238,4 |
| Flow | 29,7 / 50,1 / 465,4 | 60,0 / 16,8 / 257,9 | 60,0 / 16,7 / 214,3 |

En las pasadas finales, P95 mejora en los nueve estados. Balanced reduce especialmente monitor y flow; Lite añade margen en todos los beats y mantiene P95 alrededor de un frame de 60 Hz.

## 14. Visual regression Full

Confirmación explícita tras revisión manual: **Full no ha cambiado perceptiblemente**.

- Baseline y Full se capturaron con el mismo runner, mismos progresos, `?still=1`, scroll instantáneo y color sRGB.
- `full-final` coincide por SHA-256 en 14/18 capturas; varían Intro y Monitor.
- `full-repeat` coincide en 16/18; solo varía Intro, que tampoco es byte-determinista entre dos pasadas del baseline.
- En `full-repeat`, phone, laptop, miniweb 1/2/3, monitor, tablet y flow son exactos en ambos viewports.
- La revisión perceptual separada no encontró un cambio de composición en Intro ni Monitor.
- Se verificaron también navegación rápida, scroll reverso, URL fría del reel y restauración de scroll.

Las capturas están en `review/phase3/baseline-final`, `review/phase3/full-final` y `review/phase3/full-repeat`.

## 15. Responsive

La validación cubre:

- 1020×640;
- 1152×720;
- 1280×720;
- 1366×768;
- 1440×900;
- 1920×1080;
- 2560×1440.

En cada viewport se recorren los nueve estados de Balanced y Lite, con comprobaciones de overflow horizontal, stage sticky, protagonista/copy, miniweb activa, interacción invisible, scroll forward/reverse y salto Home/End. Por debajo de 1020 px el modo automático conserva el renderer Full-compact existente; 1019/1020 se probó como boundary explícito.

Resultado final automatizado: **285/285 PASS**:

- 252/252 estados de beat (2 tiers × 7 viewports × 9 momentos × ida/vuelta);
- 28/28 casos de navegación Home/End;
- 5/5 smokes: interacciones Balanced/Lite, Reduced Motion Balanced/Lite y fallback con JavaScript desactivado.

El resultado detallado está en `review/phase3-responsive-qa/summary.json`. Las contact sheets de revisión visual de 1366 y 1920 están en `review/phase3-visual-final-post`.

## 16. Compatibilidad

| Motor | Resultado | Cobertura |
|---|---|---|
| Chromium | PASS | resolver completo, overrides, auto, downgrade, sesión, scroll, aislamiento y tres runtimes |
| Firefox 153 | PASS | Full/Balanced/Lite, runtime único y cero page errors |
| WebKit | PASS | Full/Balanced/Lite, runtime único y MP4 frío en el arranque |

Suite funcional cross-browser: **23/23 casos ejecutados PASS**. Las dos pruebas específicas de BFCache se registran aparte como **skip ambiental**, no como PASS ni como fallo de Altaria.

Validación final del código: `pnpm astro check` terminó con 0 errores, 0 warnings y 0 hints; `pnpm build` generó correctamente la página y los chunks separados de Full, Balanced y Lite.

El Chromium incluido con Playwright arranca con BFCache desactivado. Incluso retirando esa opción, dos páginas HTML independientes volvieron con `navigation.type="back_forward"`, pero `pageshow.persisted=false`, perdieron el token DOM y expusieron `notRestoredReasons="masked"`. El mismo control mínimo en Firefox y WebKit devolvió `persisted=false`, token perdido y scroll a cero. Al no admitir BFCache ni el caso de control, el entorno no permite validar una restauración BFCache real de Altaria. Sí pasó la restauración por reload con scroll exacto `3840 → 3840`, tier bloqueado y runtime operativo.

En el entorno Windows de QA, Firefox necesitó desactivar sus sandboxes de subprocess exclusivamente en el harness y forzar WebRender software. El fallo original ocurría en `newPage()` antes de cualquier URL (`SpawnTarget Error:0`), por lo que no era un error de Altaria. Con esa configuración local, los tres tiers navegaron y ejecutaron correctamente.

No se detectaron primitivas obviamente incompatibles con Chrome 109 en Lite. La compatibilidad real con el PC Windows 7 objetivo queda pendiente de la prueba física descrita en la sección 21.

## 17. Reduced Motion

Reduced Motion es independiente del tier y nunca se interpreta como señal de hardware.

- Full conserva su composición estática aprobada.
- Balanced y Lite muestran una composición final estable con los dispositivos, resultado de miniweb, marca y flow.
- No existe timeline ornamental en movimiento continuo.
- El tier detectado sigue siendo Full, Balanced o Lite según capacidades/override.
- Focus, `inert`, `aria-hidden` de escenas y contraste se mantienen.

## 18. Assets creados

No fue necesario crear ningún bitmap o vídeo nuevo. Se reutilizaron assets ya optimizados y aprobados:

| Ruta | Resolución | Peso | Tier | Uso |
|---|---:|---:|---|---|
| `public/media/reel-poster.jpg` | 720×1280 | 100,65 KiB | todos | póster del reel; Balanced/Lite lo usan sin decoder de vídeo |
| `public/brand/optimized/altaria-logo-256.png` | 256×256 | 18,75 KiB | todos | tablet, flow y header |
| `public/brand/optimized/altaria-cloud-256.png` | 256×256 | 15,57 KiB | todos | transición de marca |
| `public/brand/optimized/altaria-logo-positive-128.png` | 128×81 | 3,10 KiB | Full/Balanced | variante positiva |
| `public/brand/optimized/altaria-logo-negative-128.png` | 128×81 | 5,41 KiB | Full/Balanced | variante negativa |

Lite no solicita las dos variantes de logotipo. Full sigue utilizando los assets originales y no se ha borrado ninguno.

## 19. Archivos modificados

### Integración

- `src/layouts/Base.astro`: resolver síncrono temprano en `<head>`.
- `src/pages/index.astro`: host selectivo, imports dinámicos, debug y fallback.
- `src/components/hero/HeroTierHost.astro`: outlet, templates inertes y contenido sin JS.
- `src/components/hero/DeviceTablet.astro`: eliminación del script hoisted.
- `src/styles/global.css`: coste de la cápsula adaptado por tier sin alterar Full.

### Resolver y runtimes

- `src/scripts/performance-tier-boot.js`: heurística, sesión y frame health temprano.
- `src/scripts/performance-tier.ts`: contrato tipado y debug.
- `src/scripts/hero-tier-bootstrap.ts`: montaje, neutralización de media, lock e import único.
- `src/scripts/hero-full.ts`, `hero-balanced.ts`, `hero-lite.ts`: boundaries de runtime.
- `src/scripts/performance-hero-timeline.ts`: timeline Balanced/Lite, a11y y easter eggs.
- `src/scripts/full-tablet-swatches.ts`: interacción exclusiva del runtime Full.
- `src/scripts/hero-timeline.ts`: conexión de swatches y lifecycle BFCache; timeline visual intacta.

### Renderers adaptativos

- `src/components/hero/performance/PerformanceHero.astro`.
- `PerformanceSky.astro`.
- `PerformanceCopy.astro`.
- `PerformancePhone.astro`.
- `PerformanceLaptop.astro`.
- `PerformanceMonitor.astro`.
- `PerformanceTablet.astro`.
- `PerformanceFlow.astro`.

### QA

- `scripts/phase3-benchmark.mjs`: screenshots, red, DOM, heap, FPS/P95/Task e idle.
- `scripts/phase3-tier-qa.mjs`: resolver, aislamiento y cross-browser.
- `scripts/phase3-responsive-qa.mjs`: 7 viewports, ida/vuelta, navegación, interacciones, Reduced Motion y fallback sin JavaScript.
- `scripts/phase3-image-diff.ps1`: regresión visual cuantitativa.
- `docs/produccion/FASE-3-RESULTADO.md`: metodología, resultados, limitaciones y protocolo de prueba física.

## 20. Problemas encontrados

- **Tres árboles ocultos seguían siendo caros.** Se descartó montar Full+Balanced+Lite con CSS; se usan templates inertes, clon único e import dinámico.
- **Un template no garantiza media fría después del clone.** Se neutralizan URLs antes de conectar el fragmento.
- **Los scripts copiados desde un template pueden ejecutarse.** La lógica de swatches se movió al runtime Full y el bootstrap elimina cualquier `<script>` del fragmento.
- **WebKit descargaba el MP4 con `preload="none"`.** La URL queda fría hasta intención real de navegación.
- **Dos rAF conectados producían una sola muestra en clientes rápidos.** Se incorporó el intervalo head→primer paint.
- **El candidato Full sin runtime no representaba su progreso 0 real.** Se replica su lifecycle de visibilidad durante la calibración.
- **Un hash profundo hacía smooth-scroll por todo el hero.** Se restaura instantáneamente antes y después del runtime.
- **Full no era desmontable de forma segura.** Se descartó cambiar de tier después del boundary; la decisión queda bloqueada antes del import.
- **Prerasterizar las nubes Full no compensó en la Fase 2A.** Balanced/Lite usan una dirección propia en CSS, sin intentar copiar el raster Full.
- **Un vídeo Balanced reducido seguía manteniendo decoder y riesgo de frame loss.** Se eligió el póster aprobado: mejor estabilidad, cero MP4 y calidad suficiente a la escala real.
- **Paint/Layerize no estaban disponibles en el runner mínimo fiable.** Se reportan como N/D en lugar de atribuir cifras falsas.
- **Firefox no podía crear subprocess en el sandbox Windows de QA.** Se aisló como fallo ambiental y se validó con sandbox desactivado solo en el harness y render software.
- **Reduced Motion mostraba Results con `aria-hidden="true"`.** La sincronización visual/accesible se corrigió y la repetición completa cerró en 285/285 PASS.
- **El harness no pudo materializar BFCache ni con dos HTML independientes.** Se mantiene como skip ambiental transparente; no se presenta como validación de la aplicación.

## 21. Recomendación de prueba real

En el PC antiguo, usar el mismo navegador, ventana, escala y conexión para las tres URLs. El override manda siempre, incluso si existe un downgrade de sesión:

```text
/?perf=full&debug=1
/?perf=balanced&debug=1
/?perf=lite&debug=1
```

Comparar en este orden:

1. Recarga dura arriba del todo y primera respuesta del scroll.
2. Intro y desaparición del titular.
3. Móvil: estabilidad; en Full además comprobar vídeo y giro.
4. Portátil: apertura y las tres miniwebs.
5. Monitor, tablet y flow.
6. Scroll lento, wheel rápido, Page Down, End, Home y vuelta hacia arriba.
7. Dejar 10 segundos parado en miniweb 2 y observar fluidez, ventilador y uso de CPU.
8. Cambiar de pestaña y volver; después navegar atrás/adelante.
9. Probar sol, pájaros, avión, cohete, swatches y links del flow.
10. En Network, verificar que Balanced/Lite no solicitan `reel-altaria.mp4` ni `centro-nodos.png`.

Anotar para cada modo:

- FPS/percepción de tirones;
- si hay freezes superiores a una décima de segundo;
- calidad percibida del móvil, miniweb y flow;
- tier, razón, memoria, cores y frame health mostrados por el HUD;
- navegador, resolución y escala de Windows.

Después, abrir `/?debug=1` sin override. Esa prueba confirma si el resolver automático elige razonablemente y si el frame-health guard degrada antes del primer dispositivo.

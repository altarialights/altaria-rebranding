# Altaria Lights — contexto de proyecto

Web de estudio digital. Servicios encadenados: **contenido → web → sistema**.
Cliente real único: **De Zamorano** (restaurante, Navaluenga, Ávila).

Estado actual: **hero v4 + sección «Cómo funciona»**, pendiente de aprobación.
El resto de la home no está construido.

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
- **Tres envoltorios por objeto, una transformación cada uno:**
  `.obj` (timeline) → `.obj__float` (flotación) → `.obj__point` (cursor).
  Meter dos transformaciones en el mismo nodo hace que se pisen.
- **Solo `[data-obj="phone|laptop|flow"]` llevan origen centrado.** Los
  bloques de texto también tienen `data-obj`, pero solo para el HUD; si se
  centran, la columna se va media pantalla fuera.
- **Nunca animar propiedades de layout** (`width`, `height`, `top`…). Todo
  con `transform` y `opacity`. *Animar el `width` del header era el 100 % del
  CLS del proyecto.*
- **Todo el copy vive en `src/data/hero.ts`.** Nunca dentro de un componente.
- Las nubes son placeholders sustituibles cambiando **solo el `background`**
  de su regla en `CloudLayers.astro`. La geometría sale de `tokens.css`.

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
| — | `public/fonts/altaria-cloud.woff2` | La frase de apertura usa el respaldo pesado mientras tanto |
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

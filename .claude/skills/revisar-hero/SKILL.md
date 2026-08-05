---
name: revisar-hero
description: Compila el proyecto, levanta el preview, genera las capturas de revisión del hero en 1440/1920/2560 y las inspecciona buscando solapes, textos partidos y objetos fuera de encuadre. Úsalo siempre que cambies la composición, la timeline, el copy o la tipografía del hero — no des por bueno un cambio visual sin pasar por aquí.
---

# Revisar el hero

Bucle de verificación visual del hero de Altaria Lights. El objetivo es que
ningún cambio de composición se dé por bueno sin mirarlo en las tres
resoluciones objetivo.

## Cuándo usarlo

Después de tocar cualquiera de estos:

- `src/scripts/hero-timeline.ts` (posiciones, escalas, tiempos)
- `src/styles/tokens.css` (geometría, tipografía)
- `src/data/hero.ts` (copy — cambia el ancho de los titulares)
- cualquier componente de `src/components/hero/`

## Procedimiento

1. **Comprueba tipos primero.** `npm run check` debe dar 0 errores. Si falla,
   arréglalo antes de generar capturas: no tiene sentido revisar píxeles de
   algo que no compila.

2. **Compila y levanta el preview.**
   ```bash
   npm run build
   npm run preview      # en segundo plano, puerto 4321
   ```
   Espera a que responda antes de continuar.

3. **Genera las capturas.**
   ```bash
   npm run shoot
   ```
   Escribe en `review/`. El script imprime, por cada momento, el centro,
   ancho y opacidad de cada objeto: úsalo para detectar solapes por número
   antes incluso de abrir las imágenes.

4. **Mira las imágenes.** Como mínimo `1920-*`, y `1440-web-beat` y
   `2560-growth-beat`, que son donde antes han aparecido los problemas.

## Qué buscar

Estos son los fallos que ya han ocurrido en este proyecto:

- **Titulares partidos en tres líneas.** Deben ser dos. El copy sale de
  `data/hero.ts` y los saltos vienen del array, nunca de que el contenedor
  se quede corto.
- **Texto pisado por el portátil.** Es el solape recurrente. Comprueba que
  el borde izquierdo del portátil queda a la derecha del final del titular
  en los beats de web y de sistema, y en las tres anchuras.
- **Objetos que tapan el header** o se salen por arriba, sobre todo el móvil
  en los beats tardíos.
- **La frase de apertura debe caber en dos líneas** en las tres anchuras. La
  ajusta `fitIntro()`, pero un copy mucho más largo la dejará diminuta: si
  el resultado no tiene presencia, hay que acortar el texto, no forzar el
  tamaño.
- **Nada visible antes de tiempo.** En `intro-statement` no puede verse ni
  header, ni dispositivos, ni nodos, ni CTAs.

## Comprobaciones que no son visuales

Cuando el cambio toque animación o layout, verifica además:

- **CLS.** Debe quedarse holgadamente por debajo de 0,1 en las tres
  anchuras. Si sube, casi seguro es que algo está animando una propiedad de
  layout en lugar de `transform`/`opacity`.
- **Sin scroll horizontal** (`scrollWidth - clientWidth === 0`).
- **`prefers-reduced-motion`**: composición estática coherente y todos los
  titulares presentes en el DOM.
- **La consola no debe avisar de la duración de la timeline.** Si aparece
  «La timeline maestra dura X en lugar de 1», alguna subtimeline se ha
  desmadrado y los beats ya no coinciden con el scroll.

## Trampa del arnés

`page.hover()` de Playwright desplaza el elemento a la vista, lo que rebobina
la timeline y captura una escena a medio construir. Para la captura de hover,
mueve el ratón al bounding box con `page.mouse.move()`. Ya está resuelto en
`scripts/shoot.mjs`; no lo revviertas.

## No hagas

- No llames a Higgsfield desde este bucle. Nunca.
- No borres capturas antiguas antes de comparar si el cambio era una mejora.

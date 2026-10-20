# Tarjeta de contacto de Navaluenga

- Página: `/contactos/ayuntamiento-de-navaluenga/armando-garcia-cuenca`
- VCF: `/contactos/ayuntamiento-de-navaluenga/armando-garcia-cuenca.vcf`
- Datos: `src/data/contact-cards/navaluenga.json`.
- Organización: Ayuntamiento de Navaluenga.
- Persona: Armando García Cuenca, alcalde y diputado provincial.

Página Astro estática, con Geist local, imágenes locales optimizadas, iconos
SVG, enlaces de teléfono y correo, descarga de contacto y diálogo para
compartir. El QR se genera localmente bajo demanda con la URL abierta.
No utiliza base de datos ni añade dependencias.

El VCF se genera durante la compilación. Incluye nombre, organización, cargo,
teléfono, correo, web, fotografía JPEG y logotipo PNG incrustados; usa vCard 3.0,
UTF-8, CRLF y líneas plegadas a 75 octetos. La visualización del campo LOGO
depende de la aplicación de contactos. La fotografía queda en PHOTO.

## Procedencia

Los datos de contacto y responsabilidades se han transcrito de la tarjeta
proporcionada por el usuario. El retrato es una fotografía institucional
alternativa; no es el recorte de la imagen adjunta.

- Fotografía: https://aytonavaluenga.es/saludo-del-alcalde/
- Archivo original: https://aytonavaluenga.es/wp-content/uploads/2021/07/armando-garcia-cuenca.jpg
- Logotipo: https://www.pp.es/wp-content/uploads/2022/08/logo-short.svg
- Área provincial: https://www.diputacionavila.es/la-diputacion/areas/asuntos-europeos-energia-y-turismo.html

## Verificación

Con el servidor local de QA en ejecución:

```powershell
node scripts/cards-qa-server.mjs
$env:BASE_URL = 'http://127.0.0.1:4323'
node scripts/navaluenga-contact-qa.mjs
node node_modules/astro/bin/astro.mjs check
node scripts/altaria-os-isolated-build.mjs
```

Ajustar `BASE_URL` al puerto que indique el servidor. El script revisa cinco
anchos de pantalla, accesibilidad WCAG AA con axe, enlaces, descarga real,
estructura del VCF, integridad de sus imágenes, QR, portapapeles y cierre del
diálogo mediante Escape. Guarda capturas e informe en `review/navaluenga/`.
La importación en las aplicaciones nativas de iOS y Android requiere una
comprobación en dispositivos reales.

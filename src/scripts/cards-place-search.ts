// Extraído del buscador existente de tarjetas: misma API Places y carga diferida.
export interface SelectedCardPlace {
  googlePlaceId: string;
  nombre: string;
  direccion: string;
  googleMapsUrl: string;
}
interface PlacePrediction {
  placeId: string;
  mainText?: { text: string };
  secondaryText?: { text: string };
  text: { text: string };
  toPlace(): {
    id?: string; displayName?: string; formattedAddress?: string; googleMapsURI?: string;
    fetchFields(options: { fields: string[] }): Promise<void>;
  };
}
interface PlacesLibrary {
  AutocompleteSessionToken: new () => object;
  AutocompleteSuggestion: {
    fetchAutocompleteSuggestions(request: Record<string, unknown>): Promise<{ suggestions: { placePrediction?: PlacePrediction }[] }>;
  };
}
interface MapsNamespace { importLibrary?: (library: string) => Promise<unknown>; [key: string]: unknown }
type MapsWindow = Window & { google?: { maps?: MapsNamespace } };
let googleMapsLoader: Promise<MapsNamespace> | null = null;

function loadGoogleMaps(apiKey: string): Promise<MapsNamespace> {
  const mapsWindow = window as MapsWindow;
  if (mapsWindow.google?.maps?.importLibrary) return Promise.resolve(mapsWindow.google.maps);
  if (googleMapsLoader) return googleMapsLoader;
  googleMapsLoader = new Promise((resolve, reject) => {
    const callbackName = '__altariaGoogleMapsReady';
    const google = mapsWindow.google ?? (mapsWindow.google = {});
    const maps = google.maps ?? (google.maps = {});
    const script = document.createElement('script');
    const timeout = window.setTimeout(() => fail(), 15_000);
    const fail = () => {
      window.clearTimeout(timeout); delete maps[callbackName]; script.remove(); googleMapsLoader = null;
      reject(new Error('Google Maps no está disponible.'));
    };
    maps[callbackName] = () => { window.clearTimeout(timeout); delete maps[callbackName]; resolve(maps); };
    const params = new URLSearchParams({ key: apiKey, v: 'weekly', loading: 'async', language: 'es', region: 'ES', callback: `google.maps.${callbackName}` });
    script.async = true;
    script.src = `https://maps.googleapis.com/maps/api/js?${params}`;
    script.onerror = fail;
    document.head.append(script);
  });
  return googleMapsLoader;
}

export function initCardPlaceSearch(root: HTMLFormElement, onChange: (place: SelectedCardPlace | null) => void) {
  const input = root.querySelector<HTMLInputElement>('#cards-google-search')!;
  const list = root.querySelector<HTMLUListElement>('#cards-google-options')!;
  const popover = root.querySelector<HTMLElement>('[data-place-popover]')!;
  const status = root.querySelector<HTMLElement>('#cards-google-status')!;
  const apiKey = root.dataset.googleMapsApiKey?.trim();
  let library: PlacesLibrary | null = null;
  let selected: SelectedCardPlace | null = null;
  let suggestions: PlacePrediction[] = [];
  let active = -1;
  let requestId = 0;
  let timer = 0;
  let token: object | null = null;
  const close = () => { popover.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); active = -1; };
  const select = async (prediction: PlacePrediction) => {
    const id = ++requestId;
    close(); status.textContent = 'Confirmando el negocio…';
    try {
      const place = prediction.toPlace();
      await place.fetchFields({ fields: ['id', 'displayName', 'formattedAddress', 'googleMapsURI'] });
      if (id !== requestId) return;
      restore({ googlePlaceId: place.id ?? prediction.placeId, nombre: place.displayName ?? prediction.text.text,
        direccion: place.formattedAddress ?? '', googleMapsUrl: place.googleMapsURI ?? '' });
      token = null;
    } catch { if (id === requestId) status.textContent = 'No hemos podido confirmar el negocio. Prueba otra vez o cuéntanos tu idea.'; }
  };
  const highlight = (index: number) => {
    active = (index + suggestions.length) % suggestions.length;
    [...list.children].forEach((item, i) => item.setAttribute('aria-selected', String(i === active)));
    const item = list.children[active];
    if (item) { input.setAttribute('aria-activedescendant', item.id); item.scrollIntoView({ block: 'nearest' }); }
  };
  const search = async (query: string, id: number) => {
    status.textContent = 'Buscando negocios…';
    try {
      if (!apiKey) throw new Error('Missing key');
      const maps = await loadGoogleMaps(apiKey);
      if (!maps.importLibrary) throw new Error('Missing Places');
      library ??= await maps.importLibrary('places') as PlacesLibrary;
      token ??= new library.AutocompleteSessionToken();
      const result = await library.AutocompleteSuggestion.fetchAutocompleteSuggestions({
        input: query, sessionToken: token, language: 'es', region: 'es', includedRegionCodes: ['es'], pureServiceAreaBusinessesIncluded: true,
      });
      if (id !== requestId || input.disabled) return;
      suggestions = result.suggestions.flatMap((entry) => entry.placePrediction ? [entry.placePrediction] : []);
      list.replaceChildren();
      suggestions.forEach((prediction, index) => {
        const item = document.createElement('li');
        item.id = `cards-place-${index}`; item.setAttribute('role', 'option'); item.setAttribute('aria-selected', 'false');
        const name = document.createElement('strong'); name.textContent = prediction.mainText?.text ?? prediction.text.text;
        const address = document.createElement('small'); address.textContent = prediction.secondaryText?.text ?? '';
        item.append(name, address);
        item.addEventListener('pointerdown', (event) => event.preventDefault());
        item.addEventListener('pointermove', () => highlight(index));
        item.addEventListener('click', () => void select(prediction));
        list.append(item);
      });
      popover.hidden = !suggestions.length;
      input.setAttribute('aria-expanded', String(Boolean(suggestions.length)));
      status.textContent = suggestions.length ? `${suggestions.length} negocios encontrados. Usa las flechas para elegir.` : 'No encontramos ese negocio. Prueba con el nombre y la localidad.';
    } catch {
      if (id === requestId) { close(); status.textContent = 'No podemos buscar ahora. Puedes contarnos tu idea para que te ayudemos.'; }
    }
  };
  const restore = (place: SelectedCardPlace | null) => {
    selected = place; input.value = place?.nombre ?? ''; close();
    input.setCustomValidity('');
    status.textContent = place ? `Seleccionado: ${place.nombre}${place.direccion ? ` · ${place.direccion}` : ''}` : '';
    onChange(place);
  };
  input.addEventListener('input', () => {
    selected = null; onChange(null); input.setCustomValidity(''); close(); window.clearTimeout(timer);
    const id = ++requestId;
    if (input.value.trim().length < 3) { status.textContent = 'Escribe al menos 3 caracteres.'; return; }
    timer = window.setTimeout(() => void search(input.value.trim(), id), 250);
  });
  input.addEventListener('keydown', (event) => {
    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && suggestions.length && !popover.hidden) {
      event.preventDefault(); highlight(active + (event.key === 'ArrowDown' ? 1 : -1));
    } else if (event.key === 'Enter' && active >= 0 && !popover.hidden) { event.preventDefault(); void select(suggestions[active]); }
    else if (event.key === 'Escape') close();
  });
  root.addEventListener('change', () => { if (input.disabled) { ++requestId; close(); } });
  document.addEventListener('pointerdown', (event) => { if (!input.parentElement?.contains(event.target as Node)) close(); });
  return { get: () => selected, restore };
}

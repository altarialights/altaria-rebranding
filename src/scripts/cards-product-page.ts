import gsap from 'gsap';
import { cardsProductConfig } from '../data/cards-product';

const AUTOCOMPLETE_DEBOUNCE_MS = 250;
const AUTOCOMPLETE_MIN_CHARACTERS = 3;

interface FormattableText {
  text: string;
}

interface PlaceDetails {
  id?: string;
  displayName?: string;
  formattedAddress?: string;
  googleMapsURI?: string;
  fetchFields(options: { fields: string[] }): Promise<void>;
}

interface PlacePrediction {
  placeId: string;
  mainText?: FormattableText;
  secondaryText?: FormattableText;
  text: FormattableText;
  toPlace(): PlaceDetails;
}

interface AutocompleteSuggestionResult {
  placePrediction?: PlacePrediction;
}

interface PlacesLibrary {
  AutocompleteSessionToken: new () => object;
  AutocompleteSuggestion: {
    fetchAutocompleteSuggestions(request: Record<string, unknown>): Promise<{ suggestions: AutocompleteSuggestionResult[] }>;
  };
}

interface SelectedPlace {
  placeId: string;
  displayName: string;
  formattedAddress: string;
  googleMapsURI: string;
}

interface MapsNamespace {
  importLibrary?: (library: string) => Promise<unknown>;
  [key: string]: unknown;
}

type MapsWindow = Window & typeof globalThis & {
  google?: { maps?: MapsNamespace };
};

let googleMapsLoader: Promise<MapsNamespace> | null = null;

function loadGoogleMaps(apiKey: string): Promise<MapsNamespace> {
  const mapsWindow = window as MapsWindow;
  const existingMaps = mapsWindow.google?.maps;
  if (existingMaps?.importLibrary) return Promise.resolve(existingMaps);
  if (googleMapsLoader) return googleMapsLoader;

  googleMapsLoader = new Promise((resolve, reject) => {
    const callbackName = '__altariaGoogleMapsReady';
    const google = mapsWindow.google ?? (mapsWindow.google = {});
    const maps = google.maps ?? (google.maps = {});
    const script = document.createElement('script');
    const params = new URLSearchParams({
      key: apiKey,
      v: 'weekly',
      loading: 'async',
      language: 'es',
      region: 'ES',
      callback: `google.maps.${callbackName}`,
    });

    maps[callbackName] = () => {
      delete maps[callbackName];
      resolve(maps);
    };
    script.id = 'altaria-google-maps-loader';
    script.async = true;
    script.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
    script.onerror = () => {
      delete maps[callbackName];
      googleMapsLoader = null;
      reject(new Error('Google Maps could not load.'));
    };
    document.head.append(script);
  });

  return googleMapsLoader;
}

async function loadPlacesLibrary(apiKey: string): Promise<PlacesLibrary> {
  const maps = await loadGoogleMaps(apiKey);
  if (!maps.importLibrary) throw new Error('Google Maps importLibrary is unavailable.');
  return maps.importLibrary('places') as Promise<PlacesLibrary>;
}

function initConfigurator(): void {
  const builder = document.querySelector<HTMLFormElement>('[data-card-builder]');
  if (!builder || builder.dataset.initialised === 'true') return;
  builder.dataset.initialised = 'true';

  const currency = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });
  const apiKey = builder.dataset.googleMapsApiKey?.trim() ?? '';
  const searchRoot = builder.querySelector<HTMLElement>('[data-place-autocomplete]');
  const searchInput = builder.querySelector<HTMLInputElement>('[data-business-search]');
  const suggestionsPopover = builder.querySelector<HTMLElement>('[data-suggestions-popover]');
  const suggestionsList = builder.querySelector<HTMLUListElement>('[data-business-suggestions]');
  const attribution = builder.querySelector<HTMLElement>('[data-google-attribution]');
  const searchStatus = builder.querySelector<HTMLElement>('[data-search-status]');
  const selectedPlaceCard = builder.querySelector<HTMLElement>('[data-selected-place]');
  const placeName = builder.querySelector<HTMLElement>('[data-place-name]');
  const placeAddress = builder.querySelector<HTMLElement>('[data-place-address]');
  const placeState = builder.querySelector<HTMLElement>('[data-place-state]');
  const placeMap = builder.querySelector<HTMLElement>('[data-place-map]');
  const summaryBusiness = builder.querySelector<HTMLElement>('[data-summary-business]');
  const quantityButtons = [...builder.querySelectorAll<HTMLButtonElement>('[data-quantity], [data-quantity-custom]')];
  const customButton = builder.querySelector<HTMLButtonElement>('[data-quantity-custom]');
  const customPanel = builder.querySelector<HTMLElement>('[data-custom-quantity-panel]');
  const customInput = builder.querySelector<HTMLInputElement>('[data-custom-quantity]');
  const customError = builder.querySelector<HTMLElement>('[data-custom-quantity-error]');
  const quantityOutput = builder.querySelector<HTMLElement>('[data-summary-quantity]');
  const quantityUnit = builder.querySelector<HTMLElement>('[data-summary-unit]');
  const unitOutput = builder.querySelector<HTMLElement>('[data-unit-price]');
  const subtotalOutput = builder.querySelector<HTMLElement>('[data-summary-subtotal]');
  const taxOutput = builder.querySelector<HTMLElement>('[data-tax]');
  const totalOutput = builder.querySelector<HTMLElement>('[data-total]');
  const builderStatus = builder.querySelector<HTMLElement>('[data-builder-status]');
  const submitButton = builder.querySelector<HTMLButtonElement>('[data-builder-submit]');
  const submitLabel = builder.querySelector<HTMLElement>('[data-builder-submit-label]');
  const requiredFields = [...builder.querySelectorAll<HTMLInputElement>('[data-required-field]')];
  const placeFields = new Map(
    [...builder.querySelectorAll<HTMLInputElement>('[data-place-field]')].map((field) => [field.dataset.placeField ?? '', field]),
  );

  if (!searchRoot || !searchInput || !suggestionsPopover || !suggestionsList || !searchStatus) return;

  let placesLibrary: PlacesLibrary | null = null;
  let placesPromise: Promise<PlacesLibrary> | null = null;
  let sessionToken: object | null = null;
  let suggestions: PlacePrediction[] = [];
  let activeSuggestion = -1;
  let debounceTimer = 0;
  let latestRequestId = 0;
  let selectedPlace: SelectedPlace | null = null;
  let selectedQuantity: number | null = 1;
  let submitting = false;

  const setSearchState = (state: 'default' | 'loading' | 'results' | 'empty' | 'error' | 'selected', message = ''): void => {
    searchRoot.dataset.state = state;
    searchStatus.textContent = message;
  };

  const closeSuggestions = (): void => {
    suggestionsPopover.hidden = true;
    searchInput.setAttribute('aria-expanded', 'false');
    searchInput.setAttribute('aria-activedescendant', '');
    activeSuggestion = -1;
  };

  const positionSuggestions = (): void => {
    if (suggestionsPopover.hidden) return;
    const rootRect = searchRoot.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rootRect.bottom - 12;
    const spaceAbove = rootRect.top - 12;
    const openAbove = spaceBelow < 220 && spaceAbove > spaceBelow;
    const available = Math.max(132, (openAbove ? spaceAbove : spaceBelow) - 39);
    suggestionsPopover.classList.toggle('is-above', openAbove);
    suggestionsList.style.maxHeight = `${Math.min(292, Math.floor(available))}px`;
  };

  const openSuggestions = (): void => {
    if (!suggestions.length) return;
    suggestionsPopover.hidden = false;
    searchInput.setAttribute('aria-expanded', 'true');
    requestAnimationFrame(positionSuggestions);
  };

  const clearSelection = (): void => {
    if (!selectedPlace) return;
    selectedPlace = null;
    selectedPlaceCard?.classList.remove('is-selected');
    placeMap?.classList.remove('is-selected');
    if (placeName) placeName.textContent = 'Tu negocio';
    if (placeAddress) placeAddress.textContent = 'Selecciona tu ficha de Google';
    if (placeState) placeState.textContent = 'Pendiente de seleccionar';
    if (summaryBusiness) summaryBusiness.textContent = 'Pendiente';
    placeFields.forEach((field) => { field.value = ''; });
  };

  const ensurePlaces = async (): Promise<PlacesLibrary> => {
    if (placesLibrary) return placesLibrary;
    if (!apiKey) throw new Error('Missing PUBLIC_GOOGLE_MAPS_API_KEY.');
    placesPromise ??= loadPlacesLibrary(apiKey);
    placesLibrary = await placesPromise;
    return placesLibrary;
  };

  const setActiveSuggestion = (nextIndex: number): void => {
    const options = [...suggestionsList.querySelectorAll<HTMLElement>('[role="option"]')];
    if (!options.length) return;
    activeSuggestion = (nextIndex + options.length) % options.length;
    options.forEach((option, index) => {
      const active = index === activeSuggestion;
      option.classList.toggle('is-active', active);
      option.setAttribute('aria-selected', String(active));
      if (active) {
        searchInput.setAttribute('aria-activedescendant', option.id);
        option.scrollIntoView({ block: 'nearest' });
      }
    });
  };

  const selectPrediction = async (prediction: PlacePrediction): Promise<void> => {
    const selectionRequestId = ++latestRequestId;
    closeSuggestions();
    setSearchState('loading', 'Confirmando el negocio…');

    try {
      const place = prediction.toPlace();
      await place.fetchFields({ fields: ['id', 'displayName', 'formattedAddress', 'googleMapsURI'] });
      if (selectionRequestId !== latestRequestId) return;

      selectedPlace = {
        placeId: place.id ?? prediction.placeId,
        displayName: place.displayName ?? prediction.mainText?.text ?? prediction.text.text,
        formattedAddress: place.formattedAddress ?? prediction.secondaryText?.text ?? '',
        googleMapsURI: place.googleMapsURI ?? '',
      };

      searchInput.value = selectedPlace.displayName;
      if (placeName) placeName.textContent = selectedPlace.displayName;
      if (placeAddress) placeAddress.textContent = selectedPlace.formattedAddress;
      if (placeState) placeState.textContent = 'Negocio seleccionado';
      if (summaryBusiness) summaryBusiness.textContent = selectedPlace.displayName;
      selectedPlaceCard?.classList.add('is-selected');
      placeMap?.classList.add('is-selected');
      placeMap?.setAttribute('aria-label', `Referencia visual para ${selectedPlace.displayName}`);
      placeFields.get('placeId')!.value = selectedPlace.placeId;
      placeFields.get('displayName')!.value = selectedPlace.displayName;
      placeFields.get('formattedAddress')!.value = selectedPlace.formattedAddress;
      placeFields.get('googleMapsURI')!.value = selectedPlace.googleMapsURI;
      sessionToken = null;
      suggestions = [];
      suggestionsList.replaceChildren();
      setSearchState('selected', 'Negocio seleccionado correctamente.');
      selectedPlaceCard?.classList.add('is-found');
      window.setTimeout(() => selectedPlaceCard?.classList.remove('is-found'), 550);
      builder.dispatchEvent(new CustomEvent<SelectedPlace>('cards:place-selected', { detail: selectedPlace }));
    } catch {
      sessionToken = null;
      setSearchState('error', 'No hemos podido confirmar el negocio. Inténtalo de nuevo.');
    }
  };

  const renderSuggestions = (nextSuggestions: PlacePrediction[]): void => {
    suggestions = nextSuggestions;
    suggestionsList.replaceChildren();
    activeSuggestion = -1;

    suggestions.forEach((prediction, index) => {
      const option = document.createElement('li');
      const name = document.createElement('strong');
      const address = document.createElement('small');
      const icon = document.createElement('span');
      const arrow = document.createElement('span');
      option.id = `business-suggestion-${index}`;
      option.className = 'builder-suggestion';
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', 'false');
      icon.className = 'builder-suggestion__pin';
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = '⌖';
      name.textContent = prediction.mainText?.text ?? prediction.text.text;
      address.textContent = prediction.secondaryText?.text ?? 'España';
      arrow.className = 'builder-suggestion__arrow';
      arrow.setAttribute('aria-hidden', 'true');
      arrow.textContent = '→';
      option.append(icon, Object.assign(document.createElement('span'), { className: 'builder-suggestion__copy' }), arrow);
      option.children[1].append(name, address);
      option.addEventListener('pointermove', () => setActiveSuggestion(index));
      option.addEventListener('pointerdown', (event) => event.preventDefault());
      option.addEventListener('click', () => void selectPrediction(prediction));
      suggestionsList.append(option);
    });

    if (suggestions.length) {
      if (attribution && !attribution.firstElementChild) {
        const image = document.createElement('img');
        image.src = 'https://maps.gstatic.com/mapfiles/api-3/images/powered-by-google-on-white3.png';
        image.alt = 'Powered by Google';
        image.width = 120;
        image.height = 15;
        attribution.append(image);
      }
      if (attribution) attribution.hidden = false;
      openSuggestions();
      setSearchState('results', `${suggestions.length} ${suggestions.length === 1 ? 'negocio encontrado' : 'negocios encontrados'}.`);
      return;
    }

    if (attribution) attribution.hidden = true;
    closeSuggestions();
    setSearchState('empty', 'No encontramos ese negocio. Prueba con el nombre y la localidad.');
  };

  const requestSuggestions = async (query: string, requestId: number): Promise<void> => {
    setSearchState('loading', 'Buscando negocios…');
    try {
      const library = await ensurePlaces();
      sessionToken ??= new library.AutocompleteSessionToken();
      const response = await library.AutocompleteSuggestion.fetchAutocompleteSuggestions({
        input: query,
        sessionToken,
        language: 'es',
        region: 'es',
        includedRegionCodes: ['es'],
        pureServiceAreaBusinessesIncluded: true,
      });
      if (requestId !== latestRequestId || searchInput.value.trim() !== query) return;
      renderSuggestions(response.suggestions.flatMap((suggestion) => suggestion.placePrediction ? [suggestion.placePrediction] : []));
    } catch {
      if (requestId !== latestRequestId) return;
      suggestions = [];
      suggestionsList.replaceChildren();
      closeSuggestions();
      setSearchState('error', 'No hemos podido buscar ahora mismo. Inténtalo de nuevo.');
    }
  };

  searchInput.addEventListener('input', () => {
    const query = searchInput.value.trim();
    window.clearTimeout(debounceTimer);
    latestRequestId += 1;
    clearSelection();
    closeSuggestions();

    if (query.length < AUTOCOMPLETE_MIN_CHARACTERS) {
      suggestions = [];
      suggestionsList.replaceChildren();
      sessionToken = null;
      setSearchState('default');
      return;
    }

    const requestId = latestRequestId;
    debounceTimer = window.setTimeout(() => void requestSuggestions(query, requestId), AUTOCOMPLETE_DEBOUNCE_MS);
  });

  searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' && suggestions.length) {
      event.preventDefault();
      openSuggestions();
      setActiveSuggestion(activeSuggestion + 1);
    } else if (event.key === 'ArrowUp' && suggestions.length) {
      event.preventDefault();
      openSuggestions();
      setActiveSuggestion(activeSuggestion - 1);
    } else if (event.key === 'Enter' && activeSuggestion >= 0) {
      event.preventDefault();
      void selectPrediction(suggestions[activeSuggestion]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closeSuggestions();
    }
  });
  searchInput.addEventListener('focus', openSuggestions);
  document.addEventListener('pointerdown', (event) => {
    if (!searchRoot.contains(event.target as Node)) closeSuggestions();
  });
  window.addEventListener('resize', positionSuggestions, { passive: true });

  const setQuantity = (quantity: number | null): void => {
    selectedQuantity = quantity;
    if (!quantity) {
      if (quantityOutput) quantityOutput.textContent = 'Pendiente';
      if (quantityUnit) quantityUnit.textContent = '';
      if (unitOutput) unitOutput.textContent = currency.format(cardsProductConfig.unitPrice);
      if (subtotalOutput) subtotalOutput.textContent = '—';
      if (taxOutput) taxOutput.textContent = '—';
      if (totalOutput) totalOutput.textContent = '—';
      return;
    }
    const subtotal = cardsProductConfig.unitPrice * quantity;
    const tax = cardsProductConfig.taxes;
    if (quantityOutput) quantityOutput.textContent = String(quantity);
    if (quantityUnit) quantityUnit.textContent = quantity === 1 ? 'unidad' : 'unidades';
    if (unitOutput) unitOutput.textContent = currency.format(cardsProductConfig.unitPrice);
    if (subtotalOutput) subtotalOutput.textContent = currency.format(subtotal);
    if (taxOutput) taxOutput.textContent = currency.format(tax);
    if (totalOutput) totalOutput.textContent = currency.format(subtotal + cardsProductConfig.shipping + tax);
  };

  const selectQuantityButton = (selected: HTMLButtonElement): void => {
    quantityButtons.forEach((button) => {
      const active = button === selected;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  };

  const validateCustomQuantity = (showError = true): number | null => {
    if (!customInput) return null;
    const value = customInput.value.trim();
    const valid = /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) >= 1;
    customInput.setAttribute('aria-invalid', String(!valid && showError));
    if (customError) customError.textContent = !valid && showError ? 'Introduce un número entero igual o mayor que 1.' : '';
    return valid ? Number(value) : null;
  };

  quantityButtons.forEach((button) => {
    button.addEventListener('click', () => {
      selectQuantityButton(button);
      if (button === customButton) {
        if (customPanel) {
          customPanel.hidden = false;
          requestAnimationFrame(() => customPanel.classList.add('is-visible'));
        }
        setQuantity(validateCustomQuantity(false));
        customInput?.focus({ preventScroll: true });
        return;
      }
      customPanel?.classList.remove('is-visible');
      if (customPanel) window.setTimeout(() => { customPanel.hidden = true; }, 180);
      setQuantity(Number(button.dataset.quantity));
    });
  });

  customInput?.addEventListener('keydown', (event) => {
    if (['-', '+', '.', ',', 'e', 'E'].includes(event.key)) event.preventDefault();
  });
  customInput?.addEventListener('input', () => setQuantity(validateCustomQuantity(customInput.value !== '')));
  customInput?.addEventListener('blur', () => setQuantity(validateCustomQuantity(true)));

  requiredFields.forEach((field) => {
    field.addEventListener('input', () => {
      field.classList.remove('is-invalid');
      field.removeAttribute('aria-invalid');
    });
    field.addEventListener('blur', () => {
      const invalid = !field.checkValidity();
      field.classList.toggle('is-invalid', invalid);
      field.setAttribute('aria-invalid', String(invalid));
    });
  });

  const setSubmitting = (active: boolean): void => {
    submitting = active;
    if (submitButton) {
      submitButton.disabled = active;
      submitButton.classList.toggle('is-loading', active);
    }
    if (submitLabel) submitLabel.textContent = active ? 'Preparando pago…' : 'Pagar con Stripe (prueba)';
  };

  const readValue = (name: string): string => {
    const field = builder.elements.namedItem(name);
    return field instanceof HTMLInputElement ? field.value.trim() : '';
  };

  const getIdempotencyKey = (): string => {
    const storageKey = 'altaria.cards.checkout.idempotency-key';
    try {
      const current = window.sessionStorage.getItem(storageKey);
      if (current && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(current)) return current;
      const next = crypto.randomUUID();
      window.sessionStorage.setItem(storageKey, next);
      return next;
    } catch {
      return crypto.randomUUID();
    }
  };

  if (new URLSearchParams(window.location.search).get('pago') === 'cancelado' && builderStatus) {
    builderStatus.textContent = 'El pago se canceló. Tu pedido sigue pendiente y no se ha realizado ningún cobro.';
  }

  builder.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submitting) return;
    if (builderStatus) builderStatus.textContent = '';
    if (!selectedPlace) {
      setSearchState('error', 'Selecciona tu negocio en la lista de Google.');
      searchInput.focus();
      return;
    }
    if (!selectedQuantity) {
      validateCustomQuantity(true);
      customInput?.focus();
      return;
    }
    const firstInvalid = requiredFields.find((field) => !field.checkValidity());
    if (firstInvalid) {
      const label = firstInvalid.closest('label')?.querySelector('span')?.textContent?.trim() ?? 'este campo';
      firstInvalid.classList.add('is-invalid');
      firstInvalid.setAttribute('aria-invalid', 'true');
      if (builderStatus) builderStatus.textContent = `Revisa ${label.toLocaleLowerCase('es')}.`;
      firstInvalid.focus();
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch('/api/tarjetas/checkout', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          claveIdempotencia: getIdempotencyKey(),
          negocio: {
            googlePlaceId: selectedPlace.placeId,
            nombre: selectedPlace.displayName,
            direccion: selectedPlace.formattedAddress,
            googleMapsUrl: selectedPlace.googleMapsURI,
          },
          cantidad: selectedQuantity,
          cliente: {
            nombre: readValue('customerName'),
            email: readValue('customerEmail'),
            telefono: readValue('customerPhone'),
          },
          envio: {
            direccion: readValue('shippingAddress'),
            direccionExtra: readValue('shippingAddressExtra') || undefined,
            codigoPostal: readValue('shippingPostalCode'),
            ciudad: readValue('shippingCity'),
            provincia: readValue('shippingProvince'),
            pais: 'ES',
            referencia: readValue('shippingReference') || undefined,
          },
        }),
      });
      const payload: unknown = await response.json().catch(() => null);
      const result = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
      if (!response.ok || typeof result.checkoutUrl !== 'string') {
        if (response.status === 409) {
          try { window.sessionStorage.removeItem('altaria.cards.checkout.idempotency-key'); } catch { /* Optional storage. */ }
        }
        throw new Error(typeof result.error === 'string' ? result.error : 'No hemos podido preparar el pago.');
      }
      const checkoutUrl = new URL(result.checkoutUrl);
      if (checkoutUrl.protocol !== 'https:' || checkoutUrl.hostname !== 'checkout.stripe.com') {
        throw new Error('Stripe ha devuelto una dirección de pago no válida.');
      }
      window.location.assign(checkoutUrl.href);
    } catch (error) {
      setSubmitting(false);
      if (builderStatus) {
        builderStatus.textContent = error instanceof Error
          ? error.message
          : 'No hemos podido preparar el pago. Inténtalo de nuevo.';
      }
    }
  });
}

function initFaq(): void {
  const faq = document.querySelector<HTMLElement>('[data-cards-faq]');
  if (!faq || faq.dataset.initialised === 'true') return;
  faq.dataset.initialised = 'true';
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  faq.querySelectorAll<HTMLElement>('.cards-faq__item').forEach((item) => {
    const button = item.querySelector<HTMLButtonElement>('button[aria-controls]');
    const panel = item.querySelector<HTMLElement>('[data-faq-panel]');
    const inner = panel?.firstElementChild as HTMLElement | null;
    if (!button || !panel || !inner) return;

    button.addEventListener('click', () => {
      const opening = button.getAttribute('aria-expanded') !== 'true';
      button.setAttribute('aria-expanded', String(opening));
      item.classList.toggle('is-open', opening);
      gsap.killTweensOf([panel, inner]);

      if (reduceMotion.matches) {
        panel.hidden = !opening;
        panel.style.removeProperty('height');
        inner.style.removeProperty('opacity');
        inner.style.removeProperty('transform');
        return;
      }

      if (opening) {
        panel.hidden = false;
        const targetHeight = inner.scrollHeight;
        gsap.fromTo(panel, { height: 0 }, {
          height: targetHeight,
          duration: 0.42,
          ease: 'power3.out',
          onComplete: () => panel.style.removeProperty('height'),
        });
        gsap.fromTo(inner, { opacity: 0, y: -4 }, { opacity: 1, y: 0, duration: 0.36, ease: 'power2.out' });
        return;
      }

      gsap.to(inner, { opacity: 0, y: -4, duration: 0.22, ease: 'power2.out' });
      gsap.fromTo(panel, { height: panel.scrollHeight }, {
        height: 0,
        duration: 0.36,
        ease: 'power2.out',
        onComplete: () => {
          panel.hidden = true;
          panel.style.removeProperty('height');
        },
      });
    });
  });
}

export function initCardsProductPage(): void {
  initConfigurator();
  initFaq();
}

import { cardWhatsAppMessage, cardsWhatsAppUrl } from '../lib/contact/cards-whatsapp';
import { initCardsArtwork } from './cards-artwork';
import type { CardArtwork } from '../lib/orders/artwork';
import { findCardProduct } from '../data/cards-catalog';
import { calculateCardProductPrice } from '../lib/orders/catalog-pricing';
import { canCheckoutConfiguration, cardDestinationUrl, designLabels, destinationLabels, validWebUrl, type CardConfiguration } from '../lib/orders/card-configuration';
import { field, value, readStored, writeStored, restoreFields, fieldsSnapshot, money, post, requestKey } from './cards-form-state';
import { initCardPlaceSearch, type SelectedCardPlace } from './cards-place-search';

const DRAFT_KEY = 'altaria.cards.configuration.v2';
const phoneValid = (phone: string) => {
  let normalized = phone.replace(/[\s().\-/]/gu, '');
  if (normalized.startsWith('00')) normalized = `+${normalized.slice(2)}`;
  if (/^\d{9}$/u.test(normalized)) normalized = `+34${normalized}`;
  return /^\+[1-9]\d{7,14}$/u.test(normalized);
};
type Input = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

export function initCardsWizard(form: HTMLFormElement) {
  const get = (name: string) => value(form, name);
  const query = <T extends HTMLElement = HTMLElement>(selector: string) => form.querySelector<T>(selector)!;
  const steps = [...form.querySelectorAll<HTMLFieldSetElement>('[data-step]')];
  const status = query('[data-config-status]');
  const next = query<HTMLButtonElement>('[data-next]');
  const submit = query<HTMLButtonElement>('[data-final-submit]');
  const consent = field(form, 'consent') as HTMLInputElement;
  const draft = readStored(DRAFT_KEY);
  const startedAt = Date.now();
  const savedArtwork = draft?.artworkFile as Partial<CardArtwork> | undefined;
  let artworkFile: CardArtwork | undefined = savedArtwork && /^[a-f0-9]{64}$/.test(savedArtwork.token ?? '') && typeof savedArtwork.filename === 'string' ? savedArtwork as CardArtwork : undefined;
  restoreFields(form, draft?.fields);
  steps.forEach(step => { step.disabled = false; });
  const restoredDesign = get('design');
  if (draft && restoredDesign !== 'own' && restoredDesign !== 'custom') (form.elements.namedItem('design') as RadioNodeList).value = 'own';
  let step = Math.min(5, Math.max(1, Number(draft?.step) || 1));
  let place: SelectedCardPlace | null = null;
  let sending = false;
  let previousDirect: boolean | undefined;
  let currentProduct = get('productoId');
  const perProduct = (draft?.perProduct && typeof draft.perProduct === 'object' ? draft.perProduct : {}) as Record<string, Record<string, string>>;
  const destinationFields = ['destination', 'url', 'helpBusiness', 'locality', 'project', 'otherProject'];
  const summaryDetails = query<HTMLDetailsElement>('[data-summary-details]');
  const mobile = window.matchMedia('(max-width: 850px)');
  summaryDetails.open = !mobile.matches;
  mobile.addEventListener('change', () => { summaryDetails.open = !mobile.matches; });
  const save = () => {
    if (currentProduct) perProduct[currentProduct] = Object.fromEntries(destinationFields.map(name => [name, get(name)]));
    writeStored(DRAFT_KEY, { fields: fieldsSnapshot(form), step, place, perProduct, artworkFile });
  };
  const syncProduct = () => {
    const selected = get('productoId');
    if (selected === currentProduct) return;
    currentProduct = selected;
    restoreFields(form, perProduct[selected] ?? Object.fromEntries(destinationFields.map(name => [name, ''])));
  };
  const put = (key: string, text: string) => { query(`[data-summary="${key}"]`).textContent = text; };
  const toggle = (selector: string, visible: boolean) => {
    form.querySelectorAll<HTMLElement>(selector).forEach(block => {
      block.hidden = !visible;
      block.querySelectorAll<Input>('input,select,textarea').forEach(input => { input.disabled = !visible; });
    });
  };
  const configuration = (): CardConfiguration | undefined => {
    if (!(get('design') in designLabels) || !(get('destination') in destinationLabels)) return undefined;
    const details: CardConfiguration['details'] = {};
    const names = ['url', 'locality', 'instagram', 'tiktok', 'facebook', 'youtube', 'linkedin', 'other', 'phone', 'message', 'name', 'company', 'email', 'web', 'project', 'colors', 'text', 'style', 'instructions'] as const;
    names.forEach(name => { const input = field(form, name); if (!input.disabled && get(name)) details[name] = get(name); });
    if (!field(form, 'helpBusiness').disabled) details.business = get('helpBusiness');
    if (!field(form, 'otherProject').disabled) details.project = get('otherProject');
    if (!field(form, 'vcardPhone').disabled && get('vcardPhone')) details.phone = get('vcardPhone');
    return { version: 2, design: get('design') as CardConfiguration['design'], destination: get('destination') as CardConfiguration['destination'], details, artwork: get('design') === 'own' ? artworkFile ? 'uploaded' : 'requested-later' : 'not-required', artworkFile: get('design') === 'own' ? artworkFile : undefined, contactPhone: get('clienteTelefono') };
  };
  const direct = () => Boolean(configuration() && canCheckoutConfiguration(get('productoId'), configuration(), place?.googlePlaceId));
  const quantity = () => Number(get('cantidad'));
  const destinationUrl = () => configuration() ? cardDestinationUrl(configuration()!, get('productoId'), get('productoId') === 'resenas' ? place?.googlePlaceId : undefined) : '';
  const whatsappMessage = () => configuration() ? cardWhatsAppMessage({ product: findCardProduct(get('productoId'))?.name ?? 'Por definir', quantity: quantity(), configuration: configuration()!, business: get('negocioNombre'), name: get('clienteNombre'), email: get('clienteEmail'), destinationUrl: destinationUrl() }) : '';
  const missing = (index: number): string[] => {
    const result: string[] = [];
    if (index === 1 && !(get('design') in designLabels)) result.push('elige el diseño');
    if (index === 1 && get('design') === 'own' && !artworkFile) result.push('adjunta tu diseño');
    if (index === 2 && !findCardProduct(get('productoId'))) result.push('elige el tipo de tarjeta');
    if (index === 3 && !(get('destination') in destinationLabels)) result.push('elige cómo preparar el destino');
    steps[index - 1].querySelectorAll<Input>('input,select,textarea').forEach(input => {
      if (input.disabled || input.type === 'radio' || input.name === 'website') return;
      input.setCustomValidity('');
      const text = input.value.trim();
      if (text && input.type === 'url' && !validWebUrl(text)) input.setCustomValidity('Introduce una URL http o https válida.');
      if (text && input.type === 'tel' && !phoneValid(text)) input.setCustomValidity('Introduce un teléfono válido con prefijo.');
      if (text && 'minLength' in input && input.minLength > 0 && text.length < input.minLength) input.setCustomValidity(`Introduce al menos ${input.minLength} caracteres.`);
      if (input.required && !text) input.setCustomValidity('Completa este dato.');
      if (!input.validity.valid) {
        const label = input.closest('label');
        const labelText = [...(label?.childNodes ?? [])].filter(n => n.nodeType === Node.TEXT_NODE).map(n => n.textContent).join('').trim();
        result.push(input.type === 'checkbox' ? 'acepta las condiciones indicadas' : labelText || label?.querySelector('span')?.textContent || input.name);
      }
    });
    if (index === 3 && get('destination') === 'link' && get('productoId') === 'redes-sociales'
      && !['url','instagram','tiktok','facebook','youtube','linkedin','other'].some(name => get(name))) result.push('añade al menos un enlace');
    return result;
  };
  const update = () => {
    const product = findCardProduct(get('productoId'));
    const mode = get('destination');
    ['link','help','create'].forEach(branch => toggle(`[data-branch="${branch}"]`, mode === branch));
    form.querySelectorAll<HTMLElement>('[data-type-fields]').forEach(block => toggle(`[data-type-fields="${block.dataset.typeFields}"]`, Boolean(mode) && mode !== 'create' && block.dataset.typeFields!.split(' ').includes(get('productoId'))));
    toggle('[data-google-fields]', mode === 'help' && product?.id === 'resenas');
    query('[data-google-url-note]').hidden = product?.id !== 'resenas';
    toggle('[data-design-fields]', get('design') === 'custom');
    query('[data-artwork-pending]').hidden = get('design') !== 'own';
    query('[data-own-artwork]').hidden = get('design') !== 'own';
    form.querySelectorAll('[data-artwork-summary]').forEach(el => { el.textContent = artworkFile ? `${artworkFile.filename} · ${artworkFile.width ?? '?'} × ${artworkFile.height ?? '?'} px · ${artworkFile.status === 'review' ? 'Requiere revisión' : 'Guardado'}` : 'No has adjuntado un diseño.'; });
    const preset = get('quantityPreset');
    query('[data-custom-quantity]').hidden = preset !== 'custom';
    if (preset !== 'custom') field(form, 'cantidad').value = preset;
    form.querySelectorAll<HTMLInputElement>('[data-required]').forEach(input => {
      input.required = input.dataset.required === 'always'
        || (input.dataset.required === 'url' && get('productoId') !== 'whatsapp')
        || (input.dataset.required === 'phone' && mode === 'link' && !get('url'))
        || (input.dataset.required === 'contact' && mode === 'link');
    });
    query('[data-destination-label]').textContent = field(form, 'url').required ? 'Enlace de destino' : 'Enlace de destino (opcional)';
    const purchasable = direct();
    toggle('[data-shipping-fields]', purchasable);
    const savesInquiry = !purchasable && get('design') === 'own' && Boolean(artworkFile);
    toggle('[data-purchase-consent]', purchasable || savesInquiry);
    query('[data-whatsapp-review]').hidden = purchasable;
    query('[data-contact-copy]').textContent = purchasable ? 'Indica tus datos para preparar el pedido y enviarte la confirmación.' : savesInquiry ? 'Indica tus datos para asociar el diseño a tu solicitud antes de hablar por WhatsApp.' : 'Tus datos de contacto son opcionales: revisaremos tu propuesta por WhatsApp.';
    query<HTMLTextAreaElement>('[data-whatsapp-preview]').value = whatsappMessage();
    ['negocioNombre','clienteNombre','clienteEmail','clienteTelefono'].forEach(name => { field(form, name).required = purchasable || savesInquiry; });
    if (previousDirect !== purchasable) {
      consent.checked = false;
      query('[data-consent-copy]').innerHTML = purchasable
        ? 'He leído y acepto las <a href="/condiciones-de-compra" target="_blank" rel="noopener">Condiciones de compra</a> y conozco la <a href="/privacidad" target="_blank" rel="noopener">Política de privacidad</a>.'
        : 'He leído y acepto la <a href="/privacidad" target="_blank" rel="noopener">Política de privacidad</a> para gestionar mi solicitud.';
      previousDirect = purchasable;
    }
    steps.forEach((panel, i) => { panel.hidden = i + 1 !== step; });
    query('[data-step-count]').textContent = `Paso ${step} de 5`;
    query<HTMLButtonElement>('[data-back]').disabled = step === 1 || sending;
    next.hidden = step === 5;
    const currentMissing = missing(step);
    const allMissing = [1,2,3,4,5].flatMap(missing);
    next.disabled = sending || currentMissing.length > 0;
    query('[data-step-missing]').textContent = currentMissing.length ? `Para continuar: ${currentMissing.join(', ')}.` : '';
    form.querySelectorAll<HTMLButtonElement>('[data-go-step]').forEach(button => {
      const target = Number(button.dataset.goStep);
      button.disabled = sending || (target > step && Array.from({ length: target - 1 }, (_, i) => missing(i + 1)).some(items => items.length));
      if (button.closest('.ac-stepper')) {
        if (target === step) button.setAttribute('aria-current', 'step'); else button.removeAttribute('aria-current');
      }
    });
    put('design', designLabels[get('design') as keyof typeof designLabels] ?? 'Por elegir');
    put('product', product?.name ?? 'Por elegir');
    put('destination', `${destinationLabels[mode as keyof typeof destinationLabels] ?? 'Por elegir'}${mode === 'help' && product?.id === 'resenas' && place ? ` · ${place.nombre}` : ''}`);
    put('quantity', Number.isInteger(quantity()) && quantity() > 0 ? `${quantity()} ${quantity() === 1 ? 'tarjeta' : 'tarjetas'}` : 'Por indicar');
    put('personalization', get('design') === 'own' ? artworkFile ? `${artworkFile.filename}${artworkFile.status==='review'?' · requiere revisión':''}` : 'Diseño pendiente de adjuntar' : get('design') === 'custom' ? 'Diseño por Altaria' : 'Por elegir');
    put('contact', get('clienteNombre') || 'Por indicar');
    query('[data-summary-row="shipping"]').hidden = !purchasable;
    put('shipping', get('envioCiudad') ? `${get('envioCiudad')} · España` : 'España · dirección pendiente');
    query('[data-scope]').textContent = !product ? '' : purchasable ? product.scope : 'Hablemos por WhatsApp para concretar tu tarjeta y su presupuesto.';
    query('[data-final-title]').textContent = purchasable ? '¿Dónde enviamos tu tarjeta?' : 'Revisa tu solicitud';
    query('[data-final-copy]').textContent = purchasable ? 'Solo falta la dirección. Puedes corregir cualquier elección desde el resumen.' : savesInquiry ? 'Guardaremos tu solicitud y la referencia privada del diseño antes de abrir WhatsApp.' : 'Revisa tu idea y continúa a WhatsApp.';
    query('[data-price-breakdown]').textContent = '';
    query('[data-total-label]').textContent = purchasable ? 'Total · IVA incluido' : 'Precio';
    put('total', product ? 'Pendiente de propuesta' : 'Pendiente de selección');
    if (purchasable) {
      try {
        const amounts = calculateCardProductPrice(product!.id, quantity(), get('design') as 'own' | 'custom');
        put('total', money(amounts.totalCentimos));
        query('[data-price-breakdown]').textContent = `${quantity()} × ${money(amounts.precioUnitarioCentimos)} · Diseño ${money(amounts.disenoCentimos)} por pedido · Envío ${money(amounts.envioCentimos)}${form.dataset.mode === 'test' ? ' · Modo de prueba' : ''}`;
      } catch { put('total', 'Revisa la cantidad'); }
    }
    submit.textContent = purchasable ? 'Comprar · Ir al pago →' : 'Solicitar propuesta →';
    query('[data-direct-whatsapp]').hidden = !purchasable && step === 5;
    submit.disabled = sending || allMissing.length > 0 || step !== 5;
    query('[data-final-missing]').textContent = step !== 5 ? 'Completa los pasos para revisar y continuar.' : allMissing.length ? `Falta: ${allMissing.join(', ')}.` : '';
  };
  const showStep = (target: number) => {
    step = Math.max(1, Math.min(5, target)); update(); save();
    const legend = steps[step - 1].querySelector<HTMLElement>('legend')!;
    legend.focus({ preventScroll: true });
    query('.ac-stepper').scrollIntoView({ block: 'start', behavior: 'instant' });
  };
  const placeSearch = initCardPlaceSearch(form, selected => {
    place = selected;
    if (selected) {
      field(form, 'helpBusiness').value = selected.nombre;
      if (!get('negocioNombre')) field(form, 'negocioNombre').value = selected.nombre;
    }
    update(); save();
  });
  const storedPlace = draft?.place as Partial<SelectedCardPlace> | undefined;
  if (storedPlace && ['googlePlaceId','nombre','direccion','googleMapsUrl'].every(key => typeof storedPlace[key as keyof SelectedCardPlace] === 'string')) placeSearch.restore(storedPlace as SelectedCardPlace);
  form.addEventListener('input', () => { status.textContent = ''; syncProduct(); update(); save(); });
  form.addEventListener('change', () => {
    syncProduct();
    if (!get('negocioNombre') && get('helpBusiness')) field(form, 'negocioNombre').value = get('helpBusiness');
    update(); save();
  });
  next.addEventListener('click', () => { if (!missing(step).length) showStep(step + 1); });
  query('[data-back]').addEventListener('click', () => showStep(step - 1));
  form.querySelectorAll<HTMLButtonElement>('[data-go-step]').forEach(button => button.addEventListener('click', () => showStep(Number(button.dataset.goStep))));
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (sending) return;
    if (step !== 5) { next.click(); return; }
    if ([1,2,3,4,5].flatMap(missing).length) { update(); return; }
    const config = configuration()!;
    const purchasable = direct();
    if (!purchasable) {
      save();
      if (config.artworkFile) {
        sending=true;update();status.textContent='Guardando tu solicitud con el diseño…';
        try {
          const payload={productoId:get('productoId'),nombre:get('clienteNombre'),contacto:get('clienteEmail'),negocio:get('negocioNombre'),cantidad:quantity(),idea:config.details.project||'Solicitud de tarjeta con diseño aportado',configuracion:{tarjeta:config},privacidad:consent.checked,website:get('website')};
          const result=await post('/api/tarjetas/consulta',{...payload,startedAt,claveIdempotencia:requestKey(`${DRAFT_KEY}.inquiry`,payload)});
          window.location.assign(cardsWhatsAppUrl(`${whatsappMessage()}\nReferencia de solicitud: ${result.id}`));
        } catch(error) {status.dataset.error='true';status.textContent=error instanceof Error?error.message:'No se ha podido guardar la solicitud.';}
        finally{sending=false;update();}
      } else window.location.assign(cardsWhatsAppUrl(whatsappMessage()));
      return;
    }
    const payload = {
      productoId: get('productoId'), cantidad: quantity(), aceptaCondicionesCompra: consent.checked,
      negocio: { googlePlaceId: config.destination === 'help' && get('productoId') === 'resenas' ? place?.googlePlaceId ?? '' : '', nombre: get('negocioNombre'), direccion: config.destination === 'help' && get('productoId') === 'resenas' ? place?.direccion ?? '' : '', googleMapsUrl: config.destination === 'help' && get('productoId') === 'resenas' ? place?.googleMapsUrl : undefined },
      personalizacion: { destino: destinationUrl(), configuracion: config },
      cliente: { nombre: get('clienteNombre'), email: get('clienteEmail'), telefono: get('clienteTelefono') },
      envio: { direccion: get('envioDireccion'), direccionExtra: get('envioDireccionExtra'), ciudad: get('envioCiudad'), provincia: get('envioProvincia'), codigoPostal: get('envioCodigoPostal'), pais: 'ES' },
    };
    save(); sending = true; update(); form.setAttribute('aria-busy', 'true');
    status.dataset.error = 'false'; status.dataset.success = 'false';
    status.textContent = purchasable ? 'Preparando el pago seguro…' : 'Guardando tu solicitud…';
    try {
      const result = await post('/api/tarjetas/checkout', {
        ...payload, claveIdempotencia: requestKey(`${DRAFT_KEY}.${purchasable ? 'checkout' : 'inquiry'}`, payload),
      });
      if (purchasable) {
        const url = new URL(String(result.checkoutUrl));
        if (url.protocol !== 'https:' || url.hostname !== 'checkout.stripe.com') throw new Error('No hemos recibido una dirección de pago válida.');
        window.location.assign(url.href);
      }
    } catch (error) {
      status.dataset.error = 'true'; status.textContent = error instanceof Error ? error.message : 'No se ha podido completar. Tus datos siguen aquí.';
    } finally { sending = false; update(); form.removeAttribute('aria-busy'); }
  });
  const artworkModal = initCardsArtwork(file => { artworkFile = file; update(); save(); }, () => artworkFile);
  form.querySelectorAll<HTMLElement>('[data-open-artwork], input[name="design"][value="own"]').forEach(button => button.addEventListener('click', () => artworkModal.open(button)));
  update();
  if (new URLSearchParams(location.search).get('pago') === 'cancelado') status.textContent = 'Has vuelto del pago. Tu configuración sigue aquí para revisarla. El estado del pedido se confirma por separado.';
  if (location.hash === '#configurador') location.replace(`${location.pathname}${location.search}#comprar`);
  return { selectProduct(id: string) { (form.elements.namedItem('productoId') as RadioNodeList).value = id; syncProduct(); showStep(get('design') ? 2 : 1); } };
}

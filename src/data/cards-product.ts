import {
  CANTIDAD_ENVIO_GRATIS,
  CANTIDAD_MAXIMA,
  ENVIO_CENTIMOS,
  IMPUESTOS_CENTIMOS,
  PRECIO_UNITARIO_10_CENTIMOS,
  PRECIO_UNITARIO_20_CENTIMOS,
  PRECIO_UNITARIO_CENTIMOS,
} from '../lib/orders/config';

export const cardsProductConfig = Object.freeze({
  unitPrice: PRECIO_UNITARIO_CENTIMOS / 100,
  priceTiers: [
    { minQuantity: 20, unitPrice: PRECIO_UNITARIO_20_CENTIMOS / 100 },
    { minQuantity: 10, unitPrice: PRECIO_UNITARIO_10_CENTIMOS / 100 },
    { minQuantity: 1, unitPrice: PRECIO_UNITARIO_CENTIMOS / 100 },
  ],
  shipping: ENVIO_CENTIMOS / 100,
  freeShippingFrom: CANTIDAD_ENVIO_GRATIS,
  taxes: IMPUESTOS_CENTIMOS / 100,
  maxQuantity: CANTIDAD_MAXIMA,
});

import {
  CANTIDAD_MAXIMA,
  ENVIO_CENTIMOS,
  IMPUESTOS_CENTIMOS,
  PRECIO_UNITARIO_CENTIMOS,
} from '../lib/orders/config';

export const cardsProductConfig = Object.freeze({
  unitPrice: PRECIO_UNITARIO_CENTIMOS / 100,
  shipping: ENVIO_CENTIMOS / 100,
  taxes: IMPUESTOS_CENTIMOS / 100,
  maxQuantity: CANTIDAD_MAXIMA,
});

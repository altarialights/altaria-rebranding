import { cardsPricing, findCardProduct, hasPurchasablePrice, LEGACY_CARD_PRODUCT_ID } from '../../data/cards-catalog';
import { CANTIDAD_MAXIMA, type ImportesPedido } from './config';

export class ProductUnavailableError extends Error {}

export const calculateCardProductPrice = (productId = LEGACY_CARD_PRODUCT_ID, quantity: number, design: 'own' | 'custom' = 'own'): ImportesPedido & { disenoCentimos: number } => {
  const product = findCardProduct(productId);
  if (!product || !hasPurchasablePrice(product) || !product.price) {
    throw new ProductUnavailableError('Esta opción requiere una propuesta antes del pago.');
  }
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > CANTIDAD_MAXIMA) {
    throw new RangeError('Cantidad de pedido no válida.');
  }
  const tier = [...product.price.tiers].sort((a, b) => b.minimum - a.minimum).find((item) => quantity >= item.minimum)!;
  const disenoCentimos = cardsPricing.design[design];
  if (!Number.isSafeInteger(disenoCentimos) || disenoCentimos < 0) throw new ProductUnavailableError('Diseño no válido.');
  const subtotalCentimos = tier.unitAmount * quantity + disenoCentimos;
  const envioCentimos = quantity >= product.price.freeShippingFrom ? 0 : product.price.shippingAmount;
  return {
    precioUnitarioCentimos: tier.unitAmount, subtotalCentimos, envioCentimos, disenoCentimos,
    impuestosCentimos: 0, totalCentimos: subtotalCentimos + envioCentimos, moneda: product.price.currency,
  };
};

export const PRECIO_UNITARIO_CENTIMOS = 2_000;
export const PRECIO_UNITARIO_10_CENTIMOS = 1_750;
export const PRECIO_UNITARIO_20_CENTIMOS = 1_500;
export const ENVIO_CENTIMOS = 490;
export const CANTIDAD_ENVIO_GRATIS = 2;

// Los precios son importes finales con IVA incluido. No se suma una línea fiscal
// adicional ni se activa Stripe Tax sobre estos importes.
export const IMPUESTOS_CENTIMOS = 0;
export const MONEDA_PEDIDO = 'eur' as const;
export const PAIS_ENVIO = 'ES' as const;
export const CANTIDAD_MAXIMA = 500;

export const calcularPrecioUnitarioCentimos = (cantidad: number): number => {
  if (cantidad >= 20) return PRECIO_UNITARIO_20_CENTIMOS;
  if (cantidad >= 10) return PRECIO_UNITARIO_10_CENTIMOS;
  return PRECIO_UNITARIO_CENTIMOS;
};

export interface ImportesPedido {
  precioUnitarioCentimos: number;
  subtotalCentimos: number;
  envioCentimos: number;
  impuestosCentimos: number;
  totalCentimos: number;
  moneda: typeof MONEDA_PEDIDO;
}

export const calcularImportesPedido = (cantidad: number): ImportesPedido => {
  if (!Number.isSafeInteger(cantidad) || cantidad < 1 || cantidad > CANTIDAD_MAXIMA) {
    throw new RangeError('Cantidad de pedido no válida.');
  }
  const precioUnitarioCentimos = calcularPrecioUnitarioCentimos(cantidad);
  const subtotalCentimos = precioUnitarioCentimos * cantidad;
  const envioCentimos = cantidad >= CANTIDAD_ENVIO_GRATIS ? 0 : ENVIO_CENTIMOS;
  return {
    precioUnitarioCentimos,
    subtotalCentimos,
    envioCentimos,
    impuestosCentimos: IMPUESTOS_CENTIMOS,
    totalCentimos: subtotalCentimos + envioCentimos + IMPUESTOS_CENTIMOS,
    moneda: MONEDA_PEDIDO,
  };
};

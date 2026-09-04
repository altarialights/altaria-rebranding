export const PRECIO_UNITARIO_CENTIMOS = 2_500;
export const ENVIO_CENTIMOS = 490;

// La política fiscal aún no está definida. No activar Stripe Tax ni aplicar IVA
// hasta que exista una decisión fiscal aprobada.
export const IMPUESTOS_CENTIMOS = 0;
export const MONEDA_PEDIDO = 'eur' as const;
export const PAIS_ENVIO = 'ES' as const;
export const CANTIDAD_MAXIMA = 500;

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
  const subtotalCentimos = PRECIO_UNITARIO_CENTIMOS * cantidad;
  return {
    precioUnitarioCentimos: PRECIO_UNITARIO_CENTIMOS,
    subtotalCentimos,
    envioCentimos: ENVIO_CENTIMOS,
    impuestosCentimos: IMPUESTOS_CENTIMOS,
    totalCentimos: subtotalCentimos + ENVIO_CENTIMOS + IMPUESTOS_CENTIMOS,
    moneda: MONEDA_PEDIDO,
  };
};

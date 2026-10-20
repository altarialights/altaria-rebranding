/** EUR arithmetic. Input is decimal text; no floating point enters the ledger. */
export function parseScaledDecimal(value: string, scale: number, max: bigint): bigint {
  if (!new RegExp(`^(?:0|[1-9]\\d{0,9})(?:\\.\\d{1,${scale}})?$`).test(value)) {
    throw new Error('invalid_decimal');
  }
  const [whole, fraction = ''] = value.split('.');
  const result = BigInt(whole) * 10n ** BigInt(scale)
    + BigInt(fraction.padEnd(scale, '0') || '0');
  if (result > max) throw new Error('amount_overflow');
  return result;
}

export const roundHalfUp = (numerator: bigint, denominator: bigint): bigint => {
  if (numerator < 0n || denominator <= 0n) throw new Error('invalid_rounding');
  return (numerator + denominator / 2n) / denominator;
};

export interface LineInput {
  kind: 'product' | 'service' | 'custom';
  catalogItemId: string | null;
  name: string;
  description: string;
  quantity: string;
  unitPrice: string;
  discountPercent: string;
  taxPercent: string;
}

export function priceProposal(lines: LineInput[]) {
  if (!lines.length || lines.length > 40) throw new Error('invalid_lines');
  let subtotal = 0n; let discount = 0n; let tax = 0n; let total = 0n;
  const priced = lines.map((line) => {
    if (!['product', 'service', 'custom'].includes(line.kind)
      || typeof line.name !== 'string' || typeof line.description !== 'string'
      || line.name.trim().length < 2 || line.name.length > 160 || line.description.length > 1000
      || (line.catalogItemId !== null && (typeof line.catalogItemId !== 'string'
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(line.catalogItemId)))) {
      throw new Error('invalid_line');
    }
    const quantityMilli = parseScaledDecimal(line.quantity, 3, 999_999_999n);
    if (quantityMilli === 0n) throw new Error('invalid_quantity');
    const unitPriceCents = parseScaledDecimal(line.unitPrice, 2, 9_999_999_999n);
    const discountBps = parseScaledDecimal(line.discountPercent, 2, 10_000n);
    const taxBps = parseScaledDecimal(line.taxPercent, 2, 10_000n);
    const lineSubtotal = roundHalfUp(quantityMilli * unitPriceCents, 1000n);
    const lineDiscount = roundHalfUp(lineSubtotal * discountBps, 10_000n);
    const lineTax = roundHalfUp((lineSubtotal - lineDiscount) * taxBps, 10_000n);
    const lineTotal = lineSubtotal - lineDiscount + lineTax;
    if ([lineSubtotal, lineDiscount, lineTax, lineTotal].some((amount) => amount > 9_999_999_999n)) {
      throw new Error('amount_overflow');
    }
    subtotal += lineSubtotal; discount += lineDiscount; tax += lineTax; total += lineTotal;
    if (total > 9_999_999_999n) throw new Error('amount_overflow');
    return { ...line, name: line.name.trim(), description: line.description.trim(),
      quantityMilli: Number(quantityMilli), unitPriceCents: Number(unitPriceCents),
      discountBps: Number(discountBps), taxBps: Number(taxBps),
      subtotalCents: Number(lineSubtotal), discountCents: Number(lineDiscount),
      taxCents: Number(lineTax), totalCents: Number(lineTotal) };
  });
  return { lines: priced, subtotalCents: Number(subtotal), discountCents: Number(discount),
    taxCents: Number(tax), totalCents: Number(total) };
}

export function formatCents(cents: number): string {
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(cents / 100);
}

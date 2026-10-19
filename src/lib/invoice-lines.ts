export type InvoiceItemRow = {
  description: string;
  quantity: number | string;
  unit_price: number | string;
};
export type InvoiceLine = {
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
};

export const FALLBACK_DESCRIPTION = "Decoration services";

/** Real invoice items, or one "Decoration services" line for the invoice total when there are none. */
export function resolveLines(total: number, items: InvoiceItemRow[]): InvoiceLine[] {
  if (items.length === 0) {
    return [{ description: FALLBACK_DESCRIPTION, quantity: 1, unitPrice: total, amount: total }];
  }
  return items.map((i) => {
    const quantity = Number(i.quantity);
    const unitPrice = Number(i.unit_price);
    return {
      description: i.description,
      quantity,
      unitPrice,
      amount: Math.round(quantity * unitPrice * 100) / 100,
    };
  });
}

import type {
  ChargeLine,
  ItemInfo,
  ProductCostSummary,
  ReceiptRow,
} from '../types/domain'

/**
 * Cost and margin maths, in one place so the mock, OData and custom-service
 * providers cannot drift apart.
 *
 * Definitions used throughout (documented because the source spreadsheet's
 * summary block was not internally consistent — see README "Formulas"):
 *
 *   landedCost      = purchasePriceFob + financialChargesAoc     (per unit)
 *   marginEstimate  = (sellingPrice - landedCost) / sellingPrice (fraction)
 *
 * Averages in the summary are QUANTITY-WEIGHTED, not simple means. A 5-unit
 * receipt should not move the average as much as a 5,000-unit receipt.
 */

/** Guards the division so a zero/absent selling price yields 0 rather than NaN/Infinity. */
export function marginFraction(sellingPrice: number, cost: number): number {
  if (!Number.isFinite(sellingPrice) || sellingPrice === 0) return 0
  return (sellingPrice - cost) / sellingPrice
}

/**
 * Sum of the charges that add to the goods value on a receipt line, extended
 * amount. That is financial (add-on) charges on the purchase side and
 * conversion cost on the production side.
 *
 * `Stock` charges are excluded on purpose: they have already capitalised into
 * the item's inventory cost, so counting them here would double them up.
 */
export function totalFinancialCharges(charges: ChargeLine[]): number {
  return charges
    .filter((c) => c.chargeType === 'Financial' || c.chargeType === 'Conversion')
    .reduce((sum, c) => sum + c.amount, 0)
}

/**
 * Fills in the derived fields on a row from its raw parts. Providers build the
 * raw parts; this decides what "landed" and "margin" mean.
 */
export function costRow(
  raw: Omit<
    ReceiptRow,
    'financialChargesAoc' | 'landedCost' | 'marginEstimate' | 'id'
  > & { id?: string },
): ReceiptRow {
  const qty = raw.quantityReceived
  const extendedAoc = totalFinancialCharges(raw.charges)
  const financialChargesAoc = qty !== 0 ? extendedAoc / qty : 0
  const landedCost = raw.purchasePriceFob + financialChargesAoc

  return {
    ...raw,
    id:
      raw.id ??
      `${raw.purchaseOrderNumber}|${raw.receiptNumber}|${raw.purchaseLineNumber}`,
    financialChargesAoc,
    landedCost,
    marginEstimate: marginFraction(raw.sellingPrice, landedCost),
  }
}

/** Quantity-weighted mean of `pick` across rows; falls back to a simple mean when total qty is 0. */
function weightedMean(rows: ReceiptRow[], pick: (r: ReceiptRow) => number): number {
  if (rows.length === 0) return 0
  const totalQty = rows.reduce((s, r) => s + r.quantityReceived, 0)
  if (totalQty === 0) {
    return rows.reduce((s, r) => s + pick(r), 0) / rows.length
  }
  return rows.reduce((s, r) => s + pick(r) * r.quantityReceived, 0) / totalQty
}

export function summarise(
  rows: ReceiptRow[],
  item: ItemInfo,
): ProductCostSummary {
  const averagePurchaseCost = weightedMean(rows, (r) => r.purchasePriceFob)
  const averageAddOnCost = weightedMean(rows, (r) => r.financialChargesAoc)
  const averageLandedCost = weightedMean(rows, (r) => r.landedCost)

  return {
    averagePurchaseCost,
    averageAddOnCost,
    averageLandedCost,
    sellingPrice: item.sellingPrice,
    currentCost: item.currentCost,
    averageMarginStandard: marginFraction(item.sellingPrice, item.currentCost),
    averageMarginLanded: marginFraction(item.sellingPrice, averageLandedCost),
    totalQuantity: rows.reduce((s, r) => s + r.quantityReceived, 0),
    receiptCount: rows.length,
    currency: item.currency,
  }
}

/**
 * Allocates a header-level charge across the order's receipt lines, mirroring
 * D365's MarkupAllocation behaviour.
 *
 * `basis` returns the allocation weight for each line. When every weight is
 * zero (e.g. "Net weight" on items with no weight maintained) we fall back to
 * an equal split and the caller surfaces a warning, rather than silently
 * dropping the charge and understating landed cost.
 */
export function allocateHeaderCharge(
  totalAmount: number,
  lines: readonly { quantity: number; netAmount: number; netWeight?: number }[],
  method: string,
): { amounts: number[]; fellBack: boolean } {
  const basis = (l: (typeof lines)[number]): number => {
    switch (method) {
      case 'Quantity':
        return l.quantity
      case 'Net weight':
        return (l.netWeight ?? 0) * l.quantity
      case 'Equally':
        return 1
      case 'Net amount':
      default:
        return l.netAmount
    }
  }

  const weights = lines.map(basis)
  const total = weights.reduce((s, w) => s + w, 0)

  if (total === 0) {
    const even = lines.length === 0 ? 0 : totalAmount / lines.length
    return { amounts: lines.map(() => even), fellBack: true }
  }

  // Allocate proportionally, then push the rounding remainder onto the largest
  // line so the allocated amounts sum exactly back to totalAmount.
  const raw = weights.map((w) => (w / total) * totalAmount)
  const rounded = raw.map((a) => Math.round(a * 100) / 100)
  const drift =
    Math.round((totalAmount - rounded.reduce((s, a) => s + a, 0)) * 100) / 100

  if (drift !== 0 && rounded.length > 0) {
    let biggest = 0
    for (let i = 1; i < weights.length; i++) {
      if (weights[i] > weights[biggest]) biggest = i
    }
    rounded[biggest] = Math.round((rounded[biggest] + drift) * 100) / 100
  }

  return { amounts: rounded, fellBack: false }
}

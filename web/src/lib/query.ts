import type { ProductCostQuery, ReceiptRow } from '../types/domain'
import { addDaysIso, todayIso } from './format'

/**
 * Collapses the two mutually-exclusive date inputs into one concrete window.
 * `daysBack` wins when both are supplied, matching how the parameters panel
 * clears the explicit dates the moment a rolling window is typed.
 */
export function resolveDateWindow(q: ProductCostQuery): {
  from?: string
  to?: string
} {
  if (q.daysBack && q.daysBack > 0) {
    const to = todayIso()
    return { from: addDaysIso(to, -q.daysBack), to }
  }
  return { from: q.fromDate || undefined, to: q.toDate || undefined }
}

/**
 * Applies the optional parameters. Used verbatim by the mock provider and as a
 * safety net by the OData provider, where some filters can't be pushed down to
 * the service (batch, for instance, lives on a different entity than the line).
 */
export function matchesQuery(row: ReceiptRow, q: ProductCostQuery): boolean {
  if (q.itemNumber && !eq(row.itemNumber, q.itemNumber)) return false
  if (q.siteId && !eq(row.siteId, q.siteId)) return false
  if (q.warehouseId && !eq(row.warehouseId, q.warehouseId)) return false
  if (q.locationId && !eq(row.locationId, q.locationId)) return false
  if (q.batchNumber && !eq(row.batchNumber, q.batchNumber)) return false
  if (q.purchaseOrderNumber && !eq(row.purchaseOrderNumber, q.purchaseOrderNumber))
    return false

  const { from, to } = resolveDateWindow(q)
  const date = row.receiptDate.slice(0, 10)
  if (from && date < from) return false
  if (to && date > to) return false

  return true
}

function eq(a: string | undefined, b: string): boolean {
  return (a ?? '').toLowerCase() === b.trim().toLowerCase()
}

/** True when at least one optional narrowing parameter is set. */
export function hasOptionalFilters(q: ProductCostQuery): boolean {
  return Boolean(
    q.siteId ||
      q.warehouseId ||
      q.locationId ||
      q.batchNumber ||
      q.purchaseOrderNumber ||
      q.fromDate ||
      q.toDate ||
      q.daysBack,
  )
}

/**
 * Drill-through deep links back into Finance and Operations.
 *
 * F&O accepts a menu item plus a record filter on the query string, e.g.
 *   {env}/?cmp=USMF&mi=action:PurchTableListPage&PurchTable.PurchId=000123
 *
 * When VITE_D365_URL is unset (the offline demo case) these return null and the
 * UI renders the value as plain text instead of a dead link.
 */

const BASE = (import.meta.env.VITE_D365_URL ?? '').replace(/\/+$/, '')
const COMPANY = import.meta.env.VITE_COMPANY ?? 'USMF'

export const deepLinksEnabled = BASE.length > 0

function link(menuItem: string, filters: Record<string, string>): string | null {
  if (!deepLinksEnabled) return null
  const params = new URLSearchParams({ cmp: COMPANY, mi: menuItem, ...filters })
  return `${BASE}/?${params.toString()}`
}

export function purchaseOrderLink(purchId: string): string | null {
  return link('action:PurchTableListPage', { 'PurchTable.PurchId': purchId })
}

export function productReceiptLink(receiptId: string): string | null {
  return link('action:VendPackingSlipJournal', {
    'VendPackingSlipJour.PackingSlipId': receiptId,
  })
}

export function productionOrderLink(prodId: string): string | null {
  return link('action:ProdTableListPage', { 'ProdTable.ProdId': prodId })
}

export function releasedProductLink(itemId: string): string | null {
  return link('action:EcoResProductDetailsExtended', {
    'InventTable.ItemId': itemId,
  })
}

export function batchLink(itemId: string, batchId: string): string | null {
  return link('action:InventBatch', {
    'InventBatch.ItemId': itemId,
    'InventBatch.InventBatchId': batchId,
  })
}

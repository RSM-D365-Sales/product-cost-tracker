import type {
  ItemInfo,
  ProductCostQuery,
  ProductCostResult,
  Ref,
} from '../types/domain'
import { costRow, summarise } from '../lib/calc'
import { ProviderError, type ProductCostProvider } from './types'
import { productionNotImplemented } from './productionStub'
import { createODataProvider } from './odataProvider'

/**
 * Custom X++ service provider.
 *
 * One POST to RSMProductCostInquiryService.getProductCost, which does the join,
 * the header-charge allocation and the financial/stock charge classification
 * server-side, where the posting profiles and net weights actually live.
 *
 * The lookups still go through the OData provider — there is no reason to write
 * X++ for a warehouse dropdown.
 *
 * The X++ contracts in /dynamics serialise into exactly this payload shape.
 */

const API_BASE = (import.meta.env.VITE_API_BASE ?? '/api').replace(/\/+$/, '')
const COMPANY = import.meta.env.VITE_COMPANY ?? 'USMF'

/** Mirrors RSMProductCostResultContract. */
interface ServicePayload {
  item: {
    itemNumber: string
    productName: string
    unit: string
    currency: string
    currentCost: number
    sellingPrice: number
    itemGroupId?: string
    costingMethod?: string
  }
  rows: {
    purchaseOrderNumber: string
    purchaseLineNumber: number
    receiptNumber: string
    receiptDate: string
    itemNumber: string
    vendorAccount: string
    vendorName: string
    siteId: string
    warehouseId: string
    locationId?: string
    batchNumber?: string
    quantityReceived: number
    unit: string
    currency: string
    purchasePriceFob: number
    charges: {
      chargeCode: string
      description: string
      chargeType: 'Financial' | 'Stock'
      source: 'Header' | 'Line'
      allocationMethod?: string
      amount: number
    }[]
  }[]
  warnings?: string[]
}

export function createServiceProvider(): ProductCostProvider {
  // Composition rather than inheritance: reuse the OData lookups verbatim.
  const lookups = createODataProvider()

  return {
    kind: 'service',
    label: 'D365 custom service',

    // The X++ side would be a second service — RSMProductionCostInquiryService
    // — reading BOMVersion/BOMTable, the route, InventSum and InventBatch. It
    // has not been written for the same reason the OData path has not: the
    // shape is not in doubt, but the effectivity and dimension rules differ
    // enough per environment that a guess would mislead.
    getProductionCostInquiry: productionNotImplemented('custom service'),

    lookupProducedItems: (term: string, signal?: AbortSignal) =>
      lookups.lookupProducedItems(term, signal),

    async getProductCostInquiry(
      query: ProductCostQuery,
      signal?: AbortSignal,
    ): Promise<ProductCostResult> {
      const started = performance.now()

      const res = await fetch(`${API_BASE}/service/product-cost`, {
        method: 'POST',
        signal,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ company: COMPANY, ...query }),
      })

      if (!res.ok) {
        const body = await res.text().catch(() => '')
        throw new ProviderError(
          `The product cost service returned HTTP ${res.status}.`,
          body.slice(0, 400) ||
            'Check that RSMProductCostInquiryService is deployed and that D365_SERVICE_PATH in the proxy .env points at it.',
          res.status,
        )
      }

      const payload = (await res.json()) as ServicePayload

      // The service supplies raw parts; landed cost and margin are still
      // derived here so every provider produces identical numbers.
      const rows = payload.rows.map((r) =>
        costRow({
          ...r,
          productName: payload.item.productName,
          sellingPrice: payload.item.sellingPrice,
          charges: r.charges.map((c) => ({
            ...c,
            allocationMethod: c.allocationMethod as never,
            amountPerUnit:
              r.quantityReceived !== 0 ? c.amount / r.quantityReceived : 0,
          })),
        }),
      )

      const item: ItemInfo = payload.item

      return {
        query,
        item,
        summary: summarise(rows, item),
        rows,
        warnings: payload.warnings ?? [],
        source: 'service',
        elapsedMs: Math.round(performance.now() - started),
      }
    },

    lookupItems: (term: string, signal?: AbortSignal): Promise<ItemInfo[]> =>
      lookups.lookupItems(term, signal),
    lookupSites: (term: string, signal?: AbortSignal): Promise<Ref[]> =>
      lookups.lookupSites(term, signal),
    lookupWarehouses: (
      siteId: string | undefined,
      term: string,
      signal?: AbortSignal,
    ): Promise<Ref[]> => lookups.lookupWarehouses(siteId, term, signal),
    lookupBatches: (
      itemNumber: string,
      term: string,
      signal?: AbortSignal,
    ): Promise<Ref[]> => lookups.lookupBatches(itemNumber, term, signal),
    lookupPurchaseOrders: (
      itemNumber: string,
      term: string,
      signal?: AbortSignal,
    ): Promise<Ref[]> => lookups.lookupPurchaseOrders(itemNumber, term, signal),
  }
}

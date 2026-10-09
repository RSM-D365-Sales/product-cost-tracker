import type { ItemInfo, Ref } from '../types/domain'
import { LIVE_ITEMS, isLiveItem } from '../data/liveItems'
import { mockProvider } from './mockProvider'
import { createODataProvider } from './odataProvider'
import { LIVE_COMPANY } from './odataClient'
import { ProviderError, type ProductCostProvider } from './types'

/**
 * Seeded demo data for the catalogue, live Dynamics 365 for the items listed in
 * data/liveItems.ts — one page, routed per item.
 *
 * The seed is untouched: every seeded item returns exactly what the mock
 * provider returns, so the scripted demo is unchanged. The live items are the
 * second act — create a purchase order in Finance and Supply Chain, then run
 * the same item here.
 *
 * Results carry the `source` that produced them ('mock' or 'odata'), which is
 * what the page reads to show where a given set of numbers came from.
 */
export function createHybridProvider(): ProductCostProvider {
  const live = createODataProvider()
  const seed = mockProvider
  const route = (itemNumber: string) => (isLiveItem(itemNumber) ? live : seed)

  /** Merges a live lookup into a seeded one; a live failure never blanks the list. */
  async function withLive(
    seeded: Promise<Ref[]>,
    fromLive: Promise<Ref[]>,
  ): Promise<Ref[]> {
    const [a, b] = await Promise.allSettled([seeded, fromLive])
    if (a.status === 'rejected') throw a.reason
    const out = [...a.value]
    if (b.status === 'fulfilled') {
      const ids = new Set(out.map((r) => r.id.toLowerCase()))
      for (const r of b.value) if (!ids.has(r.id.toLowerCase())) out.push(r)
    }
    return out
  }

  return {
    kind: 'hybrid',
    label: `Demo data + Dynamics 365 · ${LIVE_COMPANY}`,

    getProductCostInquiry: (query, signal) =>
      route(query.itemNumber).getProductCostInquiry(query, signal),

    async getProductionCostInquiry(query, signal) {
      if (isLiveItem(query.itemNumber)) {
        throw new ProviderError(
          `The production cost inquiry is not connected to Dynamics 365 for ${query.itemNumber.trim().toUpperCase()}.`,
          'Live items are read by the product cost inquiry only. The production page runs on the demo catalogue — pick one of its produced items from the Item lookup.',
          501,
        )
      }
      return seed.getProductionCostInquiry(query, signal)
    },

    // Produced-item lookup stays on the seed; the live items are not wired
    // into the production inquiry.
    lookupProducedItems: (term, signal) => seed.lookupProducedItems(term, signal),

    // Live items are listed from data/liveItems.ts rather than queried, so the
    // lookup opens instantly and still works if the proxy is down. They go at
    // the end of the list, after the seeded catalogue.
    async lookupItems(term, signal): Promise<ItemInfo[]> {
      const seeded = await seed.lookupItems(term, signal)
      const t = term.trim().toLowerCase()
      const liveMatches = LIVE_ITEMS.filter(
        (i) =>
          !t ||
          i.itemNumber.toLowerCase().includes(t) ||
          i.productName.toLowerCase().includes(t),
      ).map<ItemInfo>((i) => ({
        itemNumber: i.itemNumber,
        productName: i.productName,
        unit: '',
        currency: 'USD',
        currentCost: 0,
        sellingPrice: 0,
      }))
      return [...seeded, ...liveMatches]
    },

    // Sites and warehouses have no item context, so both catalogues are offered.
    lookupSites: (term, signal) =>
      withLive(seed.lookupSites(term, signal), live.lookupSites(term, signal)),

    lookupWarehouses: (siteId, term, signal) =>
      withLive(
        seed.lookupWarehouses(siteId, term, signal),
        live.lookupWarehouses(siteId, term, signal),
      ),

    lookupBatches: (itemNumber, term, signal) =>
      route(itemNumber).lookupBatches(itemNumber, term, signal),

    lookupPurchaseOrders: (itemNumber, term, signal) =>
      route(itemNumber).lookupPurchaseOrders(itemNumber, term, signal),
  }
}

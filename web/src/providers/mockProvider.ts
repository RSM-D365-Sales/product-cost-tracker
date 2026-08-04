import type {
  ItemInfo,
  ProductCostQuery,
  ProductCostResult,
  Ref,
} from '../types/domain'
import type {
  BatchOnHand,
  ProductionCostQuery,
  ProductionCostResult,
} from '../types/production'
import { summarise } from '../lib/calc'
import { matchesQuery } from '../lib/query'
import {
  buildPlan,
  costBom,
  rollUp,
  type ComponentMaster,
} from '../lib/production'
import { todayIso } from '../lib/format'
import {
  FOCUS_ITEMS,
  ITEMS,
  SITES,
  WAREHOUSES,
  batchesForItem,
  itemByNumber,
  itemInfoOf,
  seedRows,
} from '../data/seed'
import {
  bomSpecFor,
  isBatchTracked,
  linesForItem,
  onHandBatches,
  producedItems,
  shelfLifeOf,
} from '../data/productionSeed'
import { ProviderError, type ProductCostProvider } from './types'

/**
 * In-browser provider backed by the deterministic seed. No network, so it works
 * on a plane, behind a customer firewall, or when the sandbox is down.
 *
 * A small artificial latency is applied so the loading states in the UI are
 * exercised during a demo rather than flashing past.
 */

const LATENCY_MS = 220

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'))
    const t = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t)
        reject(new DOMException('Aborted', 'AbortError'))
      },
      { once: true },
    )
  })
}

function contains(haystack: string | undefined, needle: string): boolean {
  if (!needle) return true
  return (haystack ?? '').toLowerCase().includes(needle.trim().toLowerCase())
}

export const mockProvider: ProductCostProvider = {
  kind: 'mock',
  label: 'Demo data (offline)',

  async getProductCostInquiry(
    query: ProductCostQuery,
    signal?: AbortSignal,
  ): Promise<ProductCostResult> {
    const started = performance.now()
    await delay(LATENCY_MS, signal)

    const item = itemByNumber(query.itemNumber)
    if (!item) {
      throw new ProviderError(
        `Item number ${query.itemNumber} does not exist.`,
        `Demo data holds ${ITEMS.length} released products, including ` +
          `${FOCUS_ITEMS.map((i) => i.itemNumber).join(', ')}. ` +
          'Open the Item lookup to browse the rest.',
      )
    }

    const rows = seedRows().filter((r) =>
      matchesQuery(r, { ...query, itemNumber: item.itemNumber }),
    )

    const warnings: string[] = []
    if (rows.length === 0) {
      warnings.push(
        'No product receipts match the selected criteria. Widen the date range or clear the optional parameters.',
      )
    }

    const itemInfo = itemInfoOf(item)

    return {
      query,
      item: itemInfo,
      summary: summarise(rows, itemInfo),
      rows,
      warnings,
      source: 'mock',
      elapsedMs: Math.round(performance.now() - started),
    }
  },

  async getProductionCostInquiry(
    query: ProductionCostQuery,
    signal?: AbortSignal,
  ): Promise<ProductionCostResult> {
    const started = performance.now()
    await delay(LATENCY_MS, signal)

    const item = itemByNumber(query.itemNumber)
    if (!item) {
      throw new ProviderError(
        `Item number ${query.itemNumber} does not exist.`,
        `Demo data holds ${ITEMS.length} released products. ` +
          `Produced items are ${producedItems()
            .map((i) => i.itemNumber)
            .join(', ')}.`,
      )
    }
    if (item.kind !== 'finished') {
      throw new ProviderError(
        `${item.itemNumber} ${item.productName} is not a produced item.`,
        'A production cost inquiry needs an item with an approved bill of ' +
          `material. Try ${producedItems()
            .slice(0, 3)
            .map((i) => i.itemNumber)
            .join(', ')}.`,
      )
    }

    // Everything is measured from the plan start date, not from "now": moving
    // the start date forward must age the batches, or the plan silently lies
    // about how much shelf life is left.
    const planStartDate = query.planStartDate || todayIso()
    const horizonDays = query.horizonDays ?? 21
    const minimumRunQuantity = query.minimumRunQuantity ?? 250

    const spec = bomSpecFor(item)
    const itemInfo = itemInfoOf(item)

    // Item-master facts for every component, plus the finished item, so the
    // costing never has to reach back into the catalogue itself.
    const masters = new Map<string, ComponentMaster>()
    for (const componentNumber of [
      ...spec.components.map((c) => c.itemNumber),
      item.itemNumber,
    ]) {
      const master = itemByNumber(componentNumber)
      if (!master) continue
      masters.set(componentNumber, {
        itemNumber: master.itemNumber,
        productName: master.productName,
        unit: master.unit,
        currentCost: master.currentCost,
        batchTracked: isBatchTracked(master),
        shelfLifeDays: shelfLifeOf(master.itemNumber),
      })
    }

    // Lots for the batch-tracked components and for the finished item itself —
    // a planner wants to see what is already made before making more.
    const relevant = new Set(
      [...masters.values()].filter((m) => m.batchTracked).map((m) => m.itemNumber),
    )
    const onHand: BatchOnHand[] = onHandBatches(planStartDate).filter((b) =>
      relevant.has(b.itemNumber),
    )

    const bom = costBom(
      spec,
      itemInfo,
      query.siteId || '2',
      planStartDate,
      masters,
      onHand,
    )

    const rows = seedRows().filter((r) => r.itemNumber === item.itemNumber)
    const rollup = rollUp(bom, itemInfo, rows)

    // The site narrows where you can MAKE it, not what material you can use:
    // stock at another site is a transfer away, and the plan says so.
    const lines = linesForItem(item.itemNumber, query.siteId)
    const enabled = query.lineIds
      ? lines.filter((l) => query.lineIds!.includes(l.lineId))
      : lines.filter((l) => l.enabledByDefault)

    const { plan, atRisk, summary, warnings } = buildPlan({
      item: itemInfo,
      bom,
      onHand,
      lines: enabled,
      planStartDate,
      horizonDays,
      minimumRunQuantity,
    })

    if (lines.length === 0) {
      warnings.push(
        query.siteId
          ? `No production line at site ${query.siteId} is tooled for ${item.itemNumber}.`
          : `No production line is tooled for ${item.itemNumber}.`,
      )
    }

    const variance = rollup.total - rollup.currentCost
    if (rollup.currentCost > 0 && Math.abs(variance) / rollup.currentCost > 0.05) {
      warnings.push(
        `Calculated cost is ${variance > 0 ? 'above' : 'below'} the item's current inventory cost by ` +
          `${Math.abs((variance / rollup.currentCost) * 100).toFixed(1)}%. ` +
          'The cost calculation prices batch-tracked components at the landed cost of stock on hand; the item cost record has not kept up.',
      )
    }

    return {
      query,
      item: itemInfo,
      bom,
      rollup,
      onHand,
      lines,
      plan,
      atRisk,
      summary,
      warnings,
      source: 'mock',
      elapsedMs: Math.round(performance.now() - started),
    }
  },

  async lookupProducedItems(
    term: string,
    signal?: AbortSignal,
  ): Promise<ItemInfo[]> {
    await delay(80, signal)
    return producedItems()
      .filter((i) => contains(i.itemNumber, term) || contains(i.productName, term))
      .map(itemInfoOf)
  },

  async lookupItems(term: string, signal?: AbortSignal): Promise<ItemInfo[]> {
    await delay(80, signal)
    return ITEMS.filter(
      (i) => contains(i.itemNumber, term) || contains(i.productName, term),
    ).map(itemInfoOf)
  },

  async lookupSites(term: string, signal?: AbortSignal): Promise<Ref[]> {
    await delay(60, signal)
    return SITES.filter((s) => contains(s.id, term) || contains(s.name, term))
  },

  async lookupWarehouses(
    siteId: string | undefined,
    term: string,
    signal?: AbortSignal,
  ): Promise<Ref[]> {
    await delay(60, signal)
    return WAREHOUSES.filter(
      (w) =>
        (!siteId || w.siteId === siteId) &&
        (contains(w.id, term) || contains(w.name, term)),
    ).map((w) => ({ id: w.id, name: `${w.name} (site ${w.siteId})` }))
  },

  async lookupBatches(
    itemNumber: string,
    term: string,
    signal?: AbortSignal,
  ): Promise<Ref[]> {
    await delay(60, signal)
    if (!itemNumber) return []
    return batchesForItem(itemNumber)
      .filter((b) => contains(b, term))
      .slice(0, 50)
      .map((b) => ({ id: b }))
  },

  async lookupPurchaseOrders(
    itemNumber: string,
    term: string,
    signal?: AbortSignal,
  ): Promise<Ref[]> {
    await delay(60, signal)
    const seen = new Map<string, string>()
    for (const r of seedRows()) {
      if (itemNumber && r.itemNumber !== itemNumber) continue
      if (!contains(r.purchaseOrderNumber, term)) continue
      if (!seen.has(r.purchaseOrderNumber)) {
        seen.set(
          r.purchaseOrderNumber,
          r.sourceType === 'Production' ? 'Production order' : r.vendorName,
        )
      }
    }
    return [...seen.entries()].slice(0, 50).map(([id, name]) => ({ id, name }))
  },
}

import type {
  AllocationMethod,
  ChargeLine,
  ItemInfo,
  ProductCostQuery,
  ProductCostResult,
  ReceiptRow,
  Ref,
} from '../types/domain'
import { allocateHeaderCharge, costRow, summarise } from '../lib/calc'
import { matchesQuery, resolveDateWindow } from '../lib/query'
import {
  ALLOCATION_MAP,
  FINANCIAL_CHARGE_CODES,
  ODATA,
} from '../lib/odataConfig'
import {
  and,
  anyOf,
  chunk,
  dateLit,
  lit,
  odataQuery,
} from './odataClient'
import { ProviderError, type ProductCostProvider } from './types'
import { productionNotImplemented } from './productionStub'

/**
 * Standard-entity provider.
 *
 * Reads product receipt lines, their purchase order lines, and the order's
 * charges, then performs the join and the header-charge allocation client-side.
 *
 * The allocation is the part worth understanding: F&O stores a header charge as
 * ONE row against the order, not as a share per line. To get a per-unit add-on
 * cost we have to spread that amount across every line of the order using the
 * order's allocation method — including lines for other items, because they
 * absorbed part of the freight too — and then prorate the receiving line's share
 * by how much of the ordered quantity this particular receipt covered.
 *
 * Two known limitations, both surfaced as warnings rather than hidden:
 *   - Net-weight allocation needs a per-line net weight, which the PO line
 *     entity does not expose. Those charges fall back to an equal split.
 *   - Whether a charge is financial or stock depends on the charge code's
 *     posting type, which is not on the charge entities either. See
 *     FINANCIAL_CHARGE_CODES in odataConfig.ts.
 *
 * Both are resolved properly by the custom service (see /dynamics).
 */

const PAGE_KEYS = 40

type Row = Record<string, unknown>

const str = (r: Row, f: string): string => {
  const v = r[f]
  return v == null ? '' : String(v)
}
const num = (r: Row, f: string): number => {
  const v = r[f]
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

function isFinancial(chargeCode: string): boolean {
  if (FINANCIAL_CHARGE_CODES.length === 0) return true
  return FINANCIAL_CHARGE_CODES.some(
    (c) => c.toLowerCase() === chargeCode.toLowerCase(),
  )
}

function allocationOf(raw: string): AllocationMethod {
  return (ALLOCATION_MAP[raw] as AllocationMethod) ?? 'Net amount'
}

async function fetchItem(
  itemNumber: string,
  signal?: AbortSignal,
): Promise<ItemInfo> {
  const e = ODATA.releasedProducts
  const rows = await odataQuery<Row>(
    e.set,
    {
      filter: `${e.fields.itemNumber} eq ${lit(itemNumber)}`,
      top: 1,
      signal,
    },
    'releasedProducts',
  )

  const r = rows[0]
  if (!r) {
    throw new ProviderError(
      `Item number ${itemNumber} does not exist.`,
      `No record in ${e.set} matched ${e.fields.itemNumber} eq '${itemNumber}'.`,
    )
  }

  return {
    itemNumber: str(r, e.fields.itemNumber),
    productName: str(r, e.fields.productName),
    unit: str(r, e.fields.unit) || 'ea',
    currency: 'USD',
    currentCost: num(r, e.fields.costPrice),
    sellingPrice: num(r, e.fields.salesPrice),
    itemGroupId: str(r, e.fields.itemGroupId) || undefined,
    costingMethod: str(r, e.fields.costingMethod) || undefined,
  }
}

export function createODataProvider(): ProductCostProvider {
  const provider: ProductCostProvider = {
    kind: 'odata',
    label: 'D365 OData (standard entities)',

    getProductionCostInquiry: productionNotImplemented('OData'),

    // ReleasedProductsV2 exposes no reliable "has an approved BOM" flag, so
    // this cannot narrow to produced items the way the mock provider does. The
    // inquiry itself rejects an item without a BOM, so an over-broad lookup
    // costs the user one failed run rather than a wrong answer.
    lookupProducedItems: (term: string, signal?: AbortSignal) =>
      provider.lookupItems(term, signal),

    async getProductCostInquiry(
      query: ProductCostQuery,
      signal?: AbortSignal,
    ): Promise<ProductCostResult> {
      const started = performance.now()
      const warnings: string[] = []

      const item = await fetchItem(query.itemNumber, signal)

      // --- 1. Product receipt lines for the item, narrowed as far as the
      //        entity allows us to push filters down. -----------------------
      const prl = ODATA.productReceiptLines
      const { from, to } = resolveDateWindow(query)

      const receiptFilter = and(
        `${prl.fields.itemNumber} eq ${lit(item.itemNumber)}`,
        from ? `${prl.fields.receiptDate} ge ${dateLit(from)}` : undefined,
        to ? `${prl.fields.receiptDate} le ${dateLit(to)}` : undefined,
        query.siteId ? `${prl.fields.siteId} eq ${lit(query.siteId)}` : undefined,
        query.warehouseId
          ? `${prl.fields.warehouseId} eq ${lit(query.warehouseId)}`
          : undefined,
        query.batchNumber
          ? `${prl.fields.batchNumber} eq ${lit(query.batchNumber)}`
          : undefined,
        query.locationId
          ? `${prl.fields.locationId} eq ${lit(query.locationId)}`
          : undefined,
        query.purchaseOrderNumber
          ? `${prl.fields.purchaseOrderNumber} eq ${lit(query.purchaseOrderNumber)}`
          : undefined,
      )

      const receiptLines = await odataQuery<Row>(
        prl.set,
        {
          filter: receiptFilter,
          orderby: `${prl.fields.receiptDate} desc`,
          signal,
        },
        'productReceiptLines',
      )

      if (receiptLines.length === 0) {
        return {
          query,
          item,
          summary: summarise([], item),
          rows: [],
          warnings: [
            'No product receipts match the selected criteria. Widen the date range or clear the optional parameters.',
          ],
          source: 'odata',
          elapsedMs: Math.round(performance.now() - started),
        }
      }

      const poNumbers = [
        ...new Set(
          receiptLines.map((r) => str(r, prl.fields.purchaseOrderNumber)),
        ),
      ].filter(Boolean)

      // --- 2. Everything hanging off those orders, in parallel. ------------
      const [poLines, poHeaders, headerCharges, lineCharges] = await Promise.all(
        [
          fetchByPo(ODATA.purchaseOrderLines, 'purchaseOrderLines', poNumbers, signal),
          fetchByPo(
            ODATA.purchaseOrderHeaders,
            'purchaseOrderHeaders',
            poNumbers,
            signal,
          ),
          fetchByPo(ODATA.headerCharges, 'headerCharges', poNumbers, signal),
          fetchByPo(ODATA.lineCharges, 'lineCharges', poNumbers, signal),
        ],
      )

      // --- 3. Index by purchase order. -------------------------------------
      const pol = ODATA.purchaseOrderLines
      const linesByPo = groupBy(poLines, (r) =>
        str(r, pol.fields.purchaseOrderNumber),
      )
      const headerByPo = new Map(
        poHeaders.map((r) => [
          str(r, ODATA.purchaseOrderHeaders.fields.purchaseOrderNumber),
          r,
        ]),
      )
      const hChargesByPo = groupBy(headerCharges, (r) =>
        str(r, ODATA.headerCharges.fields.purchaseOrderNumber),
      )
      const lChargesByPo = groupBy(lineCharges, (r) =>
        str(r, ODATA.lineCharges.fields.purchaseOrderNumber),
      )

      // --- 4. Allocate header charges across each order's lines. ------------
      // Key: `${po}|${lineNumber}` -> allocated charges for the FULL ordered qty.
      const allocated = new Map<string, ChargeLine[]>()
      let weightFallbacks = 0

      for (const po of poNumbers) {
        const lines = linesByPo.get(po) ?? []
        if (lines.length === 0) continue

        const basis = lines.map((l) => ({
          quantity: num(l, pol.fields.orderedQuantity),
          netAmount:
            num(l, pol.fields.lineAmount) ||
            num(l, pol.fields.orderedQuantity) * num(l, pol.fields.unitPrice),
          // Not exposed by the PO line entity — see the note at the top.
          netWeight: 0,
        }))

        for (const ch of hChargesByPo.get(po) ?? []) {
          const f = ODATA.headerCharges.fields
          const code = str(ch, f.chargeCode)
          if (!isFinancial(code)) continue

          const total =
            num(ch, f.calculatedAmount) || num(ch, f.chargeValue)
          if (total === 0) continue

          const method = allocationOf(str(ch, f.allocationMethod))
          const { amounts, fellBack } = allocateHeaderCharge(
            total,
            basis,
            method === 'Net weight' ? 'Net amount' : method,
          )
          if (method === 'Net weight') weightFallbacks++
          if (fellBack) weightFallbacks++

          amounts.forEach((amount, i) => {
            if (amount === 0) return
            const key = `${po}|${num(lines[i], pol.fields.lineNumber)}`
            const list = allocated.get(key) ?? []
            list.push({
              chargeCode: code,
              description: str(ch, f.description) || code,
              chargeType: 'Financial',
              source: 'Header',
              allocationMethod: method,
              amount,
              amountPerUnit: basis[i].quantity ? amount / basis[i].quantity : 0,
            })
            allocated.set(key, list)
          })
        }

        // Line charges attach directly, no allocation needed.
        for (const ch of lChargesByPo.get(po) ?? []) {
          const f = ODATA.lineCharges.fields
          const code = str(ch, f.chargeCode)
          if (!isFinancial(code)) continue

          const amount = num(ch, f.calculatedAmount)
          if (amount === 0) continue

          const lineNo = num(ch, f.lineNumber)
          const key = `${po}|${lineNo}`
          const orderedQty =
            basis[
              lines.findIndex((l) => num(l, pol.fields.lineNumber) === lineNo)
            ]?.quantity ?? 0

          const list = allocated.get(key) ?? []
          list.push({
            chargeCode: code,
            description: str(ch, f.description) || code,
            chargeType: 'Financial',
            source: 'Line',
            amount,
            amountPerUnit: orderedQty ? amount / orderedQty : 0,
          })
          allocated.set(key, list)
        }
      }

      // --- 5. Build one row per receipt line, prorating the order-level
      //        allocation by the share of ordered quantity received. ---------
      const rows: ReceiptRow[] = []

      for (const rl of receiptLines) {
        const po = str(rl, prl.fields.purchaseOrderNumber)
        const lineNo = num(rl, prl.fields.purchaseLineNumber)
        const receivedQty = num(rl, prl.fields.receivedQuantity)
        if (receivedQty === 0) continue

        const poLine = (linesByPo.get(po) ?? []).find(
          (l) => num(l, pol.fields.lineNumber) === lineNo,
        )
        const orderedQty = poLine ? num(poLine, pol.fields.orderedQuantity) : 0
        const fobPrice = poLine ? num(poLine, pol.fields.unitPrice) : 0

        // A receipt covering half the ordered quantity absorbs half the charge.
        const share = orderedQty > 0 ? receivedQty / orderedQty : 1
        const charges: ChargeLine[] = (
          allocated.get(`${po}|${lineNo}`) ?? []
        ).map((c) => {
          const amount = Math.round(c.amount * share * 100) / 100
          return { ...c, amount, amountPerUnit: amount / receivedQty }
        })

        const header = headerByPo.get(po)
        const hf = ODATA.purchaseOrderHeaders.fields

        rows.push(
          costRow({
            purchaseOrderNumber: po,
            purchaseLineNumber: lineNo,
            receiptNumber: str(rl, prl.fields.productReceiptNumber),
            receiptDate: str(rl, prl.fields.receiptDate).slice(0, 10),
            itemNumber: str(rl, prl.fields.itemNumber),
            productName: item.productName,
            vendorAccount: header ? str(header, hf.vendorAccount) : '',
            vendorName: header ? str(header, hf.vendorName) : '',
            siteId: str(rl, prl.fields.siteId),
            warehouseId: str(rl, prl.fields.warehouseId),
            locationId: str(rl, prl.fields.locationId) || undefined,
            batchNumber: str(rl, prl.fields.batchNumber) || undefined,
            quantityReceived: receivedQty,
            unit: poLine ? str(poLine, pol.fields.unit) || item.unit : item.unit,
            currency: header ? str(header, hf.currency) || 'USD' : 'USD',
            purchasePriceFob: fobPrice,
            sellingPrice: item.sellingPrice,
            charges,
          }),
        )
      }

      // Belt-and-braces: re-apply the filters locally in case an entity
      // silently ignored one of the pushed-down clauses.
      const filtered = rows.filter((r) => matchesQuery(r, query))

      if (weightFallbacks > 0) {
        warnings.push(
          `${weightFallbacks} charge${weightFallbacks === 1 ? '' : 's'} using net-weight allocation were spread by net amount instead — the purchase order line entity does not expose a per-line net weight. Use the custom service for exact net-weight allocation.`,
        )
      }
      if (FINANCIAL_CHARGE_CODES.length === 0) {
        warnings.push(
          'All charge codes are being treated as financial (add-on). Populate FINANCIAL_CHARGE_CODES in odataConfig.ts to exclude charges that capitalise into inventory.',
        )
      }
      if (filtered.length === 0) {
        warnings.push(
          'No product receipts match the selected criteria after filtering.',
        )
      }

      return {
        query,
        item,
        summary: summarise(filtered, item),
        rows: filtered,
        warnings,
        source: 'odata',
        elapsedMs: Math.round(performance.now() - started),
      }
    },

    async lookupItems(term: string, signal?: AbortSignal): Promise<ItemInfo[]> {
      const e = ODATA.releasedProducts
      const t = term.trim()
      const rows = await odataQuery<Row>(
        e.set,
        {
          filter: t
            ? `contains(${e.fields.itemNumber},${lit(t)}) or contains(${e.fields.productName},${lit(t)})`
            : undefined,
          select: [e.fields.itemNumber, e.fields.productName, e.fields.unit],
          top: 25,
          signal,
        },
        'releasedProducts',
      )
      return rows.map((r) => ({
        itemNumber: str(r, e.fields.itemNumber),
        productName: str(r, e.fields.productName),
        unit: str(r, e.fields.unit),
        currency: 'USD',
        currentCost: 0,
        sellingPrice: 0,
      }))
    },

    async lookupSites(term: string, signal?: AbortSignal): Promise<Ref[]> {
      const e = ODATA.sites
      const t = term.trim()
      const rows = await odataQuery<Row>(
        e.set,
        {
          filter: t ? `contains(${e.fields.siteId},${lit(t)})` : undefined,
          top: 25,
          signal,
        },
        'sites',
      )
      return rows.map((r) => ({
        id: str(r, e.fields.siteId),
        name: str(r, e.fields.siteName),
      }))
    },

    async lookupWarehouses(
      siteId: string | undefined,
      term: string,
      signal?: AbortSignal,
    ): Promise<Ref[]> {
      const e = ODATA.warehouses
      const t = term.trim()
      const rows = await odataQuery<Row>(
        e.set,
        {
          filter: and(
            siteId ? `${e.fields.siteId} eq ${lit(siteId)}` : undefined,
            t ? `contains(${e.fields.warehouseId},${lit(t)})` : undefined,
          ),
          top: 25,
          signal,
        },
        'warehouses',
      )
      return rows.map((r) => ({
        id: str(r, e.fields.warehouseId),
        name: str(r, e.fields.warehouseName),
      }))
    },

    async lookupBatches(
      itemNumber: string,
      term: string,
      signal?: AbortSignal,
    ): Promise<Ref[]> {
      if (!itemNumber.trim()) return []
      const e = ODATA.productReceiptLines
      const t = term.trim()
      const rows = await odataQuery<Row>(
        e.set,
        {
          filter: and(
            `${e.fields.itemNumber} eq ${lit(itemNumber.trim())}`,
            t ? `contains(${e.fields.batchNumber},${lit(t)})` : undefined,
          ),
          select: [e.fields.batchNumber],
          top: 200,
          signal,
        },
        'productReceiptLines',
      )
      const seen = new Set(
        rows.map((r) => str(r, e.fields.batchNumber)).filter(Boolean),
      )
      return [...seen].sort().slice(0, 50).map((id) => ({ id }))
    },

    async lookupPurchaseOrders(
      itemNumber: string,
      term: string,
      signal?: AbortSignal,
    ): Promise<Ref[]> {
      const e = ODATA.purchaseOrderLines
      const t = term.trim()
      const rows = await odataQuery<Row>(
        e.set,
        {
          filter: and(
            itemNumber.trim()
              ? `${e.fields.itemNumber} eq ${lit(itemNumber.trim())}`
              : undefined,
            t
              ? `contains(${e.fields.purchaseOrderNumber},${lit(t)})`
              : undefined,
          ),
          select: [e.fields.purchaseOrderNumber],
          top: 200,
          signal,
        },
        'purchaseOrderLines',
      )
      const seen = new Set(
        rows.map((r) => str(r, e.fields.purchaseOrderNumber)).filter(Boolean),
      )
      return [...seen].sort().slice(0, 50).map((id) => ({ id }))
    },
  }

  return provider
}

/** Fetches an entity for a set of PO numbers, chunked to keep URLs short. */
async function fetchByPo(
  entity: { set: string; fields: Record<string, string> },
  configKey: string,
  poNumbers: string[],
  signal?: AbortSignal,
): Promise<Row[]> {
  const batches = chunk(poNumbers, PAGE_KEYS)
  const results = await Promise.all(
    batches.map((batch) =>
      odataQuery<Row>(
        entity.set,
        {
          filter: anyOf(entity.fields.purchaseOrderNumber, batch),
          signal,
        },
        configKey,
      ),
    ),
  )
  return results.flat()
}

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const r of rows) {
    const k = key(r)
    const list = map.get(k)
    if (list) list.push(r)
    else map.set(k, [r])
  }
  return map
}

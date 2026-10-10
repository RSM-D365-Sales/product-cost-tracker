import type {
  AllocationMethod,
  ChargeLine,
  ItemInfo,
  ProductCostQuery,
  ProductCostResult,
  ReceiptRow,
  Ref,
  VendorInfo,
} from '../types/domain'
import { allocateHeaderCharge, costRow, summarise } from '../lib/calc'
import { matchesQuery, resolveDateWindow } from '../lib/query'
import {
  ALLOCATION_MAP,
  DONE_LINE_STATUSES,
  FINANCIAL_CHARGE_CODES,
  OPEN_LINE_STATUSES,
  isoDateOrEmpty,
} from '../lib/odataConfig'
import {
  LIVE_COMPANY,
  and,
  anyOf,
  chunk,
  dateLit,
  lit,
  odataQuery,
} from './odataClient'
import { requireEntity, resolveEntity, type ResolvedEntity } from './odataSchema'
import { ProviderError, type ProductCostProvider } from './types'
import { productionNotImplemented } from './productionStub'
import { liveItemName } from '../data/liveItems'
import { fetchLandedCost } from './landedCostSource'

/**
 * Standard-entity provider.
 *
 * Reads the item's product receipt lines and its open purchase order lines,
 * the order lines and headers behind them, and the orders' charges, then
 * performs the join and the header-charge allocation client-side.
 *
 * The allocation is the part worth understanding: F&O stores a header charge as
 * ONE row against the order, not as a share per line. To get a per-unit add-on
 * cost we have to spread that amount across every line of the order using the
 * order's allocation method — including lines for other items, because they
 * absorbed part of the freight too — and then prorate the receiving line's share
 * by how much of the ordered quantity this particular receipt covered.
 *
 * Open lines get the same treatment, prorated by the quantity still to come, so
 * a purchase order created minutes ago shows up as an Expected row at its
 * confirmed price plus its share of the charges already on the order.
 *
 * Field names are bound at runtime from candidates — see providers/odataSchema.ts.
 *
 * Two known limitations, both surfaced as warnings rather than hidden:
 *   - Net-weight allocation needs a per-line net weight, which the PO line
 *     entity does not expose. Those charges fall back to a net-amount split.
 *   - Whether a charge is financial or stock depends on the charge code's
 *     posting type, which is not on the charge entities either. See
 *     FINANCIAL_CHARGE_CODES in odataConfig.ts.
 *
 * Both are resolved properly by the custom service (see /dynamics).
 */

const PAGE_KEYS = 40

type Row = Record<string, unknown>

/** Reads a bound field; an unbound one ('') reads as empty. */
const str = (r: Row | undefined, f: string): string => {
  if (!r || !f) return ''
  const v = r[f]
  return v == null ? '' : String(v)
}
const num = (r: Row | undefined, f: string): number => {
  if (!r || !f) return 0
  const v = r[f]
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

/** Equality clause, or nothing when the entity does not expose the field. */
const eqIf = (field: string, value: string | undefined): string | undefined =>
  field && value ? `${field} eq ${lit(value)}` : undefined

function isFinancial(chargeCode: string): boolean {
  if (FINANCIAL_CHARGE_CODES.length === 0) return true
  return FINANCIAL_CHARGE_CODES.some(
    (c) => c.toLowerCase() === chargeCode.toLowerCase(),
  )
}

function allocationOf(raw: string): AllocationMethod {
  return (ALLOCATION_MAP[raw] as AllocationMethod) ?? 'Net amount'
}

const lineKey = (po: string, line: number): string => `${po}|${line}`

/**
 * A charge's amount for the whole order (header) or the whole line, from its
 * MarkupCategory. D365 stores the inputs rather than the result: a per-piece
 * charge is a unit amount, a percentage charge is a rate on the net amount.
 * `basis` is what the charge applies to — the order's or the line's net amount
 * and ordered quantity.
 */
function chargeAmount(
  ch: Row,
  f: Record<string, string>,
  basis: { amount: number; quantity: number },
): number {
  const computed = num(ch, f.calculatedAmount)
  if (computed !== 0) return computed

  const category = str(ch, f.category).toLowerCase()
  if (category.startsWith('pcs') || category.includes('piece')) {
    return num(ch, f.unitAmount) * basis.quantity
  }
  if (category.includes('percent')) {
    return (num(ch, f.percentage) / 100) * basis.amount
  }
  if (category.startsWith('external')) return num(ch, f.externalAmount)
  if (category.startsWith('proportional')) return num(ch, f.proportionalAmount)
  // Fixed — and the fallback when the category is not exposed: the first
  // amount that is actually populated.
  return (
    num(ch, f.fixedAmount) ||
    num(ch, f.externalAmount) ||
    num(ch, f.proportionalAmount)
  )
}

/** Net unit price of an order line: line amount / quantity, else price / price unit. */
function unitPriceOf(line: Row | undefined, f: Record<string, string>): number {
  if (!line) return 0
  const ordered = num(line, f.orderedQuantity)
  const amount = num(line, f.lineAmount)
  if (ordered > 0 && amount > 0) return amount / ordered
  const per = num(line, f.priceQuantity)
  return num(line, f.unitPrice) / (per > 0 ? per : 1)
}

async function fetchItem(
  itemNumber: string,
  signal?: AbortSignal,
): Promise<{
  item: ItemInfo
  exposes: { cost: boolean; sales: boolean }
  /** Unit the released product's purchase price is quoted in. */
  purchaseUnit: string
}> {
  const e = await requireEntity('releasedProducts', signal)
  const rows = await odataQuery<Row>(
    e.set,
    { filter: `${e.f.itemNumber} eq ${lit(itemNumber)}`, top: 1, signal },
    'releasedProducts',
  )

  const r = rows[0]
  if (!r) {
    throw new ProviderError(
      `Item number ${itemNumber} does not exist in company ${LIVE_COMPANY}.`,
      `No released product in ${e.set} matched ${e.f.itemNumber} eq '${itemNumber}'. ` +
        'Check the item is released to this legal entity, or set VITE_LIVE_COMPANY in web/.env.',
    )
  }

  return {
    item: {
      itemNumber: str(r, e.f.itemNumber),
      productName:
        str(r, e.f.productName) ||
        liveItemName(itemNumber) ||
        str(r, e.f.searchName) ||
        itemNumber,
      unit: str(r, e.f.unit) || 'ea',
      currency: 'USD',
      currentCost: num(r, e.f.costPrice),
      sellingPrice: num(r, e.f.salesPrice),
      itemGroupId: str(r, e.f.itemGroupId) || undefined,
      costingMethod: str(r, e.f.costingMethod) || undefined,
      masterPurchasePrice: e.f.purchasePrice ? num(r, e.f.purchasePrice) : undefined,
    },
    exposes: { cost: Boolean(e.f.costPrice), sales: Boolean(e.f.salesPrice) },
    purchaseUnit: str(r, e.f.purchaseUnit),
  }
}

export function createODataProvider(): ProductCostProvider {
  const provider: ProductCostProvider = {
    kind: 'odata',
    label: `Dynamics 365 · ${LIVE_COMPANY}`,

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

      // Bind every entity up front, in parallel; each is one $top=1 the first
      // time and free after that.
      const [{ item, exposes, purchaseUnit: masterPurchaseUnit }, prl, pol, poh, hc, lc, uom] = await Promise.all([
        fetchItem(query.itemNumber, signal),
        requireEntity('productReceiptLines', signal),
        requireEntity('purchaseOrderLines', signal),
        requireEntity('purchaseOrderHeaders', signal),
        resolveEntity('headerCharges', signal),
        resolveEntity('lineCharges', signal),
        resolveEntity('unitConversions', signal),
      ])
      const P = prl.f
      const L = pol.f

      // --- 1. Posted receipts for the item, narrowed as far as the entity
      //        allows filters to be pushed down. -----------------------------
      const { from, to } = resolveDateWindow(query)
      const receiptLines = await odataQuery<Row>(
        prl.set,
        {
          filter: and(
            `${P.itemNumber} eq ${lit(item.itemNumber)}`,
            from ? `${P.receiptDate} ge ${dateLit(from)}` : undefined,
            to ? `${P.receiptDate} le ${dateLit(to, true)}` : undefined,
            eqIf(P.siteId, query.siteId),
            eqIf(P.warehouseId, query.warehouseId),
            eqIf(P.batchNumber, query.batchNumber),
            eqIf(P.locationId, query.locationId),
            eqIf(P.purchaseOrderNumber, query.purchaseOrderNumber),
          ),
          orderby: `${P.receiptDate} desc`,
          signal,
        },
        'productReceiptLines',
      )

      // --- 2. Open order lines for the item. Like the seeded provider, the
      //        rolling daysBack window does not apply — an expected receipt is
      //        in the future by nature — and a batch or location filter rules
      //        them out, because neither exists until the goods arrive. ------
      const wantExpected = !query.batchNumber && !query.locationId
      const itemLines = wantExpected
        ? await odataQuery<Row>(
            pol.set,
            {
              filter: and(
                `${L.itemNumber} eq ${lit(item.itemNumber)}`,
                eqIf(L.siteId, query.siteId),
                eqIf(L.warehouseId, query.warehouseId),
                eqIf(L.purchaseOrderNumber, query.purchaseOrderNumber),
              ),
              signal,
            },
            'purchaseOrderLines',
          )
        : []
      const openLines = itemLines.filter((l) => {
        // Without a status field, an open line is one with quantity left to
        // receive — decided below once receipts are netted off.
        if (!L.lineStatus) return true
        return OPEN_LINE_STATUSES.includes(str(l, L.lineStatus))
      })
      // Lines already in stock. A line invoiced straight from the order, with
      // no product receipt posted, has no receipt line at all — without this
      // it would vanish from the page (PO002352 / PO002355 in d365s-cd2).
      const doneLines = L.lineStatus
        ? itemLines.filter((l) => DONE_LINE_STATUSES.includes(str(l, L.lineStatus)))
        : []
      const linePos = [
        ...new Set(
          [...openLines, ...doneLines].map((l) => str(l, L.purchaseOrderNumber)),
        ),
      ]

      // Everything already received against those lines — in full, not
      // windowed, or a part-received line would look larger than it is.
      const receivedAgainstLines = await fetchByKeys(
        prl,
        'productReceiptLines',
        P.purchaseOrderNumber,
        linePos,
        signal,
        `${P.itemNumber} eq ${lit(item.itemNumber)}`,
      )
      const receivedByLine = new Map<string, number>()
      for (const r of receivedAgainstLines) {
        const k = lineKey(str(r, P.purchaseOrderNumber), num(r, P.purchaseLineNumber))
        receivedByLine.set(k, (receivedByLine.get(k) ?? 0) + num(r, P.receivedQuantity))
      }

      // Only an explicit from/to pair narrows expected rows — see step 2.
      const expFrom = query.daysBack ? '' : query.fromDate ?? ''
      const expTo = query.daysBack ? '' : query.toDate ?? ''
      const expectedSource = openLines
        .map((l) => {
          const po = str(l, L.purchaseOrderNumber)
          const lineNo = num(l, L.lineNumber)
          const ordered = num(l, L.orderedQuantity)
          const remaining = ordered - (receivedByLine.get(lineKey(po, lineNo)) ?? 0)
          const date =
            isoDateOrEmpty(l[L.confirmedDate]) || isoDateOrEmpty(l[L.requestedDate])
          return { line: l, po, lineNo, ordered, remaining, date }
        })
        .filter((x) => x.remaining > 0)

      // Received or invoiced lines with no receipt line anywhere: invoiced
      // directly. Shown as posted, marked "Invoiced", at the line's delivery
      // date — the closest date the order line carries.
      const invoicedOnly = doneLines
        .map((l) => {
          const po = str(l, L.purchaseOrderNumber)
          const lineNo = num(l, L.lineNumber)
          return {
            line: l,
            po,
            lineNo,
            ordered: num(l, L.orderedQuantity),
            date:
              isoDateOrEmpty(l[L.confirmedDate]) || isoDateOrEmpty(l[L.requestedDate]),
          }
        })
        .filter((x) => x.ordered > 0 && !receivedByLine.has(lineKey(x.po, x.lineNo)))
        .filter((x) => (!expFrom || !x.date || x.date >= expFrom) && (!expTo || !x.date || x.date <= expTo))

      if (
        receiptLines.length === 0 &&
        expectedSource.length === 0 &&
        invoicedOnly.length === 0
      ) {
        return {
          query,
          item,
          summary: summarise([], item),
          rows: [],
          warnings: [
            `No product receipts or open purchase order lines for ${item.itemNumber} in ${LIVE_COMPANY} match the selected criteria. Widen the date range or clear the optional parameters.`,
          ],
          source: 'odata',
          elapsedMs: Math.round(performance.now() - started),
        }
      }

      const poNumbers = [
        ...new Set([
          ...receiptLines.map((r) => str(r, P.purchaseOrderNumber)),
          ...expectedSource.map((x) => x.po),
          ...invoicedOnly.map((x) => x.po),
        ]),
      ].filter(Boolean)

      // Product-specific unit conversions, only needed when the item is bought
      // in a unit other than its inventory unit.
      const purchaseUnits = new Set(
        [...itemLines, ...receiptLines]
          .map((r) => (str(r, L.unit) || str(r, P.purchaseUnit)).toLowerCase())
          .concat(masterPurchaseUnit.toLowerCase())
          .filter((u) => u && u !== item.unit.toLowerCase()),
      )
      const conversions =
        uom && purchaseUnits.size > 0
          ? await odataQuery<Row>(
              uom.set,
              {
                filter: `${uom.f.productNumber} eq ${lit(item.itemNumber)}`,
                // Shared across companies: no dataAreaId to filter on.
                companyScoped: false,
                signal,
              },
              'unitConversions',
            ).catch(() => [] as Row[])
          : []

      // --- 3. Everything hanging off those orders, in parallel. ------------
      // ALL lines of each order, not just this item's: the header charge was
      // spread across every one of them.
      const [poLines, poHeaders, headerCharges, lineCharges, landed] = await Promise.all([
        fetchByKeys(pol, 'purchaseOrderLines', L.purchaseOrderNumber, poNumbers, signal),
        fetchByKeys(poh, 'purchaseOrderHeaders', poh.f.purchaseOrderNumber, poNumbers, signal),
        hc
          ? fetchByKeys(hc, 'headerCharges', hc.f.purchaseOrderNumber, poNumbers, signal)
          : Promise.resolve([]),
        lc
          ? fetchByKeys(lc, 'lineCharges', lc.f.purchaseOrderNumber, poNumbers, signal)
          : Promise.resolve([]),
        // Landed Cost module: voyage, container, folio and PO-line costs.
        fetchLandedCost(
          poNumbers,
          itemLines.map((l) => ({
            po: str(l, L.purchaseOrderNumber),
            line: num(l, L.lineNumber),
            quantity: num(l, L.orderedQuantity),
            amount: num(l, L.lineAmount),
          })),
          signal,
        ),
      ])

      // --- 4. Index by purchase order. -------------------------------------
      const linesByPo = groupBy(poLines, (r) => str(r, L.purchaseOrderNumber))
      const lineByKey = new Map(
        poLines.map((l) => [
          lineKey(str(l, L.purchaseOrderNumber), num(l, L.lineNumber)),
          l,
        ]),
      )
      const headerByPo = new Map(
        poHeaders.map((r) => [str(r, poh.f.purchaseOrderNumber), r]),
      )
      const hChargesByPo = hc
        ? groupBy(headerCharges, (r) => str(r, hc.f.purchaseOrderNumber))
        : new Map<string, Row[]>()
      const lChargesByPo = lc
        ? groupBy(lineCharges, (r) => str(r, lc.f.purchaseOrderNumber))
        : new Map<string, Row[]>()

      // --- 5. Allocate header charges across each order's lines. ------------
      // Key: `${po}|${lineNumber}` -> allocated charges for the FULL ordered qty.
      const allocated = new Map<string, ChargeLine[]>()
      let weightFallbacks = 0

      for (const po of poNumbers) {
        const lines = linesByPo.get(po) ?? []
        if (lines.length === 0) continue

        const basis = lines.map((l) => ({
          quantity: num(l, L.orderedQuantity),
          netAmount: num(l, L.lineAmount) || num(l, L.orderedQuantity) * unitPriceOf(l, L),
          // Not exposed by the PO line entity — see the note at the top.
          netWeight: 0,
        }))

        if (hc) {
          const f = hc.f
          for (const ch of hChargesByPo.get(po) ?? []) {
            const code = str(ch, f.chargeCode)
            if (!isFinancial(code)) continue

            const total = chargeAmount(ch, f, {
              amount: basis.reduce((s, b) => s + b.netAmount, 0),
              quantity: basis.reduce((s, b) => s + b.quantity, 0),
            })
            if (total === 0) continue

            const method = allocationOf(str(ch, f.allocationMethod))
            const { amounts, fellBack } = allocateHeaderCharge(
              total,
              basis,
              method === 'Net weight' ? 'Net amount' : method,
            )
            if (method === 'Net weight' || fellBack) weightFallbacks++

            amounts.forEach((amount, i) => {
              if (amount === 0) return
              const key = lineKey(po, num(lines[i], L.lineNumber))
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
        }

        // Line charges attach directly, no allocation needed.
        if (lc) {
          const f = lc.f
          for (const ch of lChargesByPo.get(po) ?? []) {
            const code = str(ch, f.chargeCode)
            if (!isFinancial(code)) continue

            const key = lineKey(po, num(ch, f.lineNumber))
            const poLine = lineByKey.get(key)
            const orderedQty = num(poLine, L.orderedQuantity)

            const amount = chargeAmount(ch, f, {
              amount: num(poLine, L.lineAmount) || orderedQty * unitPriceOf(poLine, L),
              quantity: orderedQty,
            })
            if (amount === 0) continue

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
      }

      // Landed Cost module charges, per PO line. They come apportioned over
      // the quantity on the voyage; restate them over the ordered quantity so
      // chargesFor prorates them like every other charge.
      for (const [key, lcLine] of landed.byLine) {
        const poLine = lineByKey.get(key)
        if (!poLine || lcLine.charges.length === 0) continue
        const ordered = num(poLine, L.orderedQuantity)
        const scale = lcLine.quantity > 0 && ordered > 0 ? ordered / lcLine.quantity : 1
        const list = allocated.get(key) ?? []
        for (const c of lcLine.charges) {
          const amount = Math.round(c.amount * scale * 100) / 100
          list.push({ ...c, amount, amountPerUnit: ordered ? amount / ordered : 0 })
        }
        allocated.set(key, list)
      }

      /** The order-level allocation, prorated to `qty` of the ordered quantity. */
      const chargesFor = (
        key: string,
        qty: number,
        ordered: number,
        estimated: boolean,
      ): ChargeLine[] => {
        const share = ordered > 0 ? qty / ordered : 1
        return (allocated.get(key) ?? []).map((c) => {
          const amount = Math.round(c.amount * share * 100) / 100
          return {
            ...c,
            // Landed Cost charges already say estimated or actual — an actual
            // voyage cost on a not-yet-received line is still an actual.
            description:
              estimated && !c.status ? `${c.description} (estimated)` : c.description,
            amount,
            amountPerUnit: qty ? amount / qty : 0,
          }
        })
      }

      const hf = poh.f
      const vendorOf = (po: string) => {
        const h = headerByPo.get(po)
        return {
          vendorAccount: str(h, hf.vendorAccount),
          vendorName: str(h, hf.vendorName) || str(h, hf.vendorAccount),
          currency: str(h, hf.currency) || item.currency,
        }
      }

      // --- 6. Units. Rows are reported in the item's inventory unit, so a
      //        pallet-bought item (FG865: purchased in PL, stocked in cs) does
      //        not average pallets against cases. Each receipt states both
      //        quantities, which gives the factor; open lines in the same
      //        purchase unit reuse it. ----------------------------------------
      const invUnit = item.unit.toLowerCase()
      const factorByUnit = new Map<string, number>([[invUnit, 1]])
      for (const r of [...receiptLines, ...receivedAgainstLines]) {
        const unit = str(r, P.purchaseUnit).toLowerCase()
        const purch = num(r, P.receivedQuantity)
        const inv = num(r, P.receivedInventoryQuantity)
        if (unit && purch > 0 && inv > 0 && !factorByUnit.has(unit)) {
          factorByUnit.set(unit, inv / purch)
        }
      }
      // Where no receipt has shown the ratio yet, the item's own conversion
      // record — in either direction.
      if (uom) {
        for (const c of conversions) {
          const from = str(c, uom.f.fromUnit).toLowerCase()
          const to = str(c, uom.f.toUnit).toLowerCase()
          const den = num(c, uom.f.denominator) || 1
          const ratio = num(c, uom.f.factor) * (num(c, uom.f.numerator) || 1) / den
          if (!(ratio > 0)) continue
          if (to === invUnit && !factorByUnit.has(from)) factorByUnit.set(from, ratio)
          if (from === invUnit && !factorByUnit.has(to)) factorByUnit.set(to, 1 / ratio)
        }
      }
      // The released product's purchase price, per inventory unit like
      // everything else on the page. Left as it is when the factor is unknown.
      const masterFactor = factorByUnit.get(masterPurchaseUnit.toLowerCase())
      if (item.masterPurchasePrice !== undefined && masterFactor && masterFactor !== 1) {
        item.masterPurchasePrice = item.masterPurchasePrice / masterFactor
      }

      const unconverted = new Set<string>()
      /** Restates per-purchase-unit figures per inventory unit when the factor is known. */
      const inInventoryUnit = (
        qty: number,
        unitPrice: number,
        unit: string,
        charges: ChargeLine[],
        factorHint?: number,
      ) => {
        const factor = factorHint ?? factorByUnit.get(unit.toLowerCase())
        if (!factor || factor === 1) {
          if (!factor && unit) unconverted.add(unit)
          return { quantity: qty, price: unitPrice, unit: factor ? item.unit : unit || item.unit, charges }
        }
        const quantity = qty * factor
        return {
          quantity,
          price: unitPrice / factor,
          unit: item.unit,
          charges: charges.map((c) => ({
            ...c,
            amountPerUnit: quantity ? c.amount / quantity : 0,
          })),
        }
      }

      // --- 7. One row per receipt line. ------------------------------------
      const rows: ReceiptRow[] = []
      for (const rl of receiptLines) {
        const po = str(rl, P.purchaseOrderNumber)
        const lineNo = num(rl, P.purchaseLineNumber)
        const receivedQty = num(rl, P.receivedQuantity)
        if (receivedQty === 0) continue

        const key = lineKey(po, lineNo)
        const poLine = lineByKey.get(key)
        const invQty = num(rl, P.receivedInventoryQuantity)
        const q = inInventoryUnit(
          receivedQty,
          unitPriceOf(poLine, L),
          str(rl, P.purchaseUnit) || str(poLine, L.unit),
          chargesFor(key, receivedQty, num(poLine, L.orderedQuantity), false),
          // This receipt's own ratio beats the item-level one.
          invQty > 0 ? invQty / receivedQty : undefined,
        )

        rows.push(
          costRow({
            sourceType: 'Purchase',
            purchaseOrderNumber: po,
            purchaseLineNumber: lineNo,
            receiptNumber: str(rl, P.productReceiptNumber),
            receiptDate: str(rl, P.receiptDate).slice(0, 10),
            itemNumber: str(rl, P.itemNumber),
            productName: item.productName,
            ...vendorOf(po),
            siteId: str(rl, P.siteId) || str(poLine, L.siteId),
            warehouseId: str(rl, P.warehouseId) || str(poLine, L.warehouseId),
            locationId: str(rl, P.locationId) || undefined,
            batchNumber: str(rl, P.batchNumber) || undefined,
            quantityReceived: q.quantity,
            unit: q.unit,
            purchasePriceFob: q.price,
            sellingPrice: item.sellingPrice,
            charges: q.charges,
          }),
        )
      }

      // Lines invoiced without a product receipt, as posted rows.
      for (const x of invoicedOnly) {
        const key = lineKey(x.po, x.lineNo)
        const poLine = lineByKey.get(key) ?? x.line
        const q = inInventoryUnit(
          x.ordered,
          unitPriceOf(poLine, L),
          str(poLine, L.unit),
          chargesFor(key, x.ordered, x.ordered, false),
        )
        rows.push(
          costRow({
            id: `${x.po}|invoiced|${x.lineNo}`,
            sourceType: 'Purchase',
            purchaseOrderNumber: x.po,
            purchaseLineNumber: x.lineNo,
            receiptNumber: 'Invoiced',
            receiptDate: x.date || new Date().toISOString().slice(0, 10),
            itemNumber: item.itemNumber,
            productName: item.productName,
            ...vendorOf(x.po),
            siteId: str(poLine, L.siteId),
            warehouseId: str(poLine, L.warehouseId),
            quantityReceived: q.quantity,
            unit: q.unit,
            purchasePriceFob: q.price,
            sellingPrice: item.sellingPrice,
            charges: q.charges,
          }),
        )
      }

      // Belt-and-braces: re-apply the filters locally in case an entity
      // silently ignored one of the pushed-down clauses.
      const posted = rows
        .filter((r) => matchesQuery(r, query))
        .sort((a, b) => (a.receiptDate < b.receiptDate ? 1 : -1))

      // --- 8. One Expected row per open line, soonest delivery first. ------
      const expected: ReceiptRow[] = expectedSource
        .map((x) => {
          const key = lineKey(x.po, x.lineNo)
          const q = inInventoryUnit(
            x.remaining,
            unitPriceOf(lineByKey.get(key) ?? x.line, L),
            str(x.line, L.unit),
            chargesFor(key, x.remaining, x.ordered, true),
          )
          return costRow({
            id: `${x.po}|expected|${x.lineNo}`,
            sourceType: 'Purchase',
            receiptStatus: 'Expected',
            purchaseOrderNumber: x.po,
            purchaseLineNumber: x.lineNo,
            receiptNumber: '',
            // An order with no delivery date yet is shown as due today rather
            // than dropped — it is still committed supply.
            receiptDate: x.date || new Date().toISOString().slice(0, 10),
            itemNumber: item.itemNumber,
            productName: item.productName,
            ...vendorOf(x.po),
            siteId: str(x.line, L.siteId),
            warehouseId: str(x.line, L.warehouseId),
            quantityReceived: q.quantity,
            unit: q.unit,
            purchasePriceFob: q.price,
            sellingPrice: item.sellingPrice,
            charges: q.charges,
          })
        })
        .sort((a, b) => (a.receiptDate < b.receiptDate ? -1 : 1))

      // Vendors in the result, for the Copilot vendor mix. F&O carries no
      // quoted lead time on the order, so none is claimed.
      const vendors = new Map<string, VendorInfo>()
      for (const r of [...posted, ...expected]) {
        if (r.vendorAccount && !vendors.has(r.vendorAccount)) {
          vendors.set(r.vendorAccount, {
            vendorAccount: r.vendorAccount,
            vendorName: r.vendorName,
          })
        }
      }

      // --- 9. Say plainly what could not be read. --------------------------
      // Only the repeats that touch this item's lines are this page's business.
      const ownLines = new Set([...lineByKey.keys()].filter((k) =>
        [...receiptLines, ...itemLines].some(
          (r) =>
            lineKey(
              str(r, P.purchaseOrderNumber) || str(r, L.purchaseOrderNumber),
              num(r, P.purchaseLineNumber) || num(r, L.lineNumber),
            ) === k,
        ),
      ))
      const repeats = landed.repeatedActuals.filter((r) => ownLines.has(r.scope))
      if (repeats.length > 0) {
        warnings.push(
          `Landed cost actuals posted more than once: ${repeats
            .map((r) => `${r.scope.replace('|', ' line ')} cost line ${r.costLineNumber} appears ${r.times}× in cost journal ${r.journal}`)
            .join('; ')}. They are counted as recorded — check the journal in Landed cost if that is not intended.`,
        )
      }
      if (landed.fallbacks > 0) {
        warnings.push(
          `${landed.fallbacks} landed cost${landed.fallbacks === 1 ? '' : 's'} could not be spread by ${landed.fallbacks === 1 ? 'its' : 'their'} apportionment method (weight, volume or measurement is not maintained on the voyage lines) and ${landed.fallbacks === 1 ? 'was' : 'were'} spread by quantity instead.`,
        )
      }
      const foreign = [...landed.currencies].filter(
        (c) => c && c.toUpperCase() !== item.currency.toUpperCase(),
      )
      if (foreign.length > 0) {
        warnings.push(
          `Some landed costs are in ${foreign.join(', ')} and are shown unconverted alongside ${item.currency}.`,
        )
      }
      if (invoicedOnly.length > 0) {
        warnings.push(
          `${invoicedOnly.length === 1 ? '1 order line was' : `${invoicedOnly.length} order lines were`} invoiced without a product receipt. ${invoicedOnly.length === 1 ? 'It is' : 'They are'} shown as posted, marked "Invoiced", at the line's delivery date.`,
        )
      }
      if (unconverted.size > 0) {
        warnings.push(
          `Some order lines are in ${[...unconverted].join(', ')} and no receipt yet shows how that converts to ${item.unit}, so those lines are shown per ${[...unconverted].join('/')}. They convert automatically once the first one is received.`,
        )
      }
      if (!hc && !lc) {
        warnings.push(
          'No purchase order charge entity was found in this environment, so add-on cost shows as zero and landed cost equals the purchase price.',
        )
      }
      if (weightFallbacks > 0) {
        warnings.push(
          `${weightFallbacks} charge${weightFallbacks === 1 ? '' : 's'} using net-weight allocation were spread by net amount instead — the purchase order line entity does not expose a per-line net weight. Use the custom service for exact net-weight allocation.`,
        )
      }
      // An empty FINANCIAL_CHARGE_CODES (every charge counted as add-on) is a
      // setup decision, not a finding about this item, so it is reported once
      // by `npm run check:live` rather than on every run in front of a room.
      if (item.sellingPrice === 0) {
        warnings.push(
          exposes.sales
            ? `${item.itemNumber} has no sales price on the released product, so margins read as zero.`
            : 'The released product entity does not expose a sales price in this environment, so margins read as zero.',
        )
      }
      if (!exposes.cost) {
        warnings.push(
          'The released product entity does not expose the item cost in this environment, so the standard margin cannot be shown.',
        )
      }
      if (posted.length === 0) {
        warnings.push(
          expected.length > 0
            ? `${item.itemNumber} has no posted product receipts in this window yet — the ${expected.length === 1 ? 'open order line is' : `${expected.length} open order lines are`} shown as Expected.`
            : 'No product receipts match the selected criteria after filtering.',
        )
      }

      return {
        query,
        item,
        summary: summarise(posted, item),
        rows: posted,
        expected: expected.length > 0 ? expected : undefined,
        vendors: vendors.size > 0 ? [...vendors.values()] : undefined,
        warnings,
        source: 'odata',
        elapsedMs: Math.round(performance.now() - started),
      }
    },

    async lookupItems(term: string, signal?: AbortSignal): Promise<ItemInfo[]> {
      const e = await requireEntity('releasedProducts', signal)
      const t = term.trim()
      const rows = await odataQuery<Row>(
        e.set,
        {
          filter: t
            ? `contains(${e.f.itemNumber},${lit(t)})` +
              (e.f.productName ? ` or contains(${e.f.productName},${lit(t)})` : '')
            : undefined,
          select: [e.f.itemNumber, e.f.productName, e.f.unit].filter(Boolean),
          top: 25,
          signal,
        },
        'releasedProducts',
      )
      return rows.map((r) => ({
        itemNumber: str(r, e.f.itemNumber),
        productName: str(r, e.f.productName),
        unit: str(r, e.f.unit),
        currency: 'USD',
        currentCost: 0,
        sellingPrice: 0,
      }))
    },

    async lookupSites(term: string, signal?: AbortSignal): Promise<Ref[]> {
      const e = await requireEntity('sites', signal)
      const t = term.trim()
      const rows = await odataQuery<Row>(
        e.set,
        {
          filter: t ? `contains(${e.f.siteId},${lit(t)})` : undefined,
          top: 25,
          signal,
        },
        'sites',
      )
      return rows.map((r) => ({
        id: str(r, e.f.siteId),
        name: str(r, e.f.siteName) || undefined,
      }))
    },

    async lookupWarehouses(
      siteId: string | undefined,
      term: string,
      signal?: AbortSignal,
    ): Promise<Ref[]> {
      const e = await requireEntity('warehouses', signal)
      const t = term.trim()
      const rows = await odataQuery<Row>(
        e.set,
        {
          filter: and(
            eqIf(e.f.siteId, siteId),
            t ? `contains(${e.f.warehouseId},${lit(t)})` : undefined,
          ),
          top: 25,
          signal,
        },
        'warehouses',
      )
      return rows.map((r) => ({
        id: str(r, e.f.warehouseId),
        name: str(r, e.f.warehouseName) || undefined,
      }))
    },

    async lookupBatches(
      itemNumber: string,
      term: string,
      signal?: AbortSignal,
    ): Promise<Ref[]> {
      if (!itemNumber.trim()) return []
      const e = await requireEntity('productReceiptLines', signal)
      if (!e.f.batchNumber) return []
      const t = term.trim()
      const rows = await odataQuery<Row>(
        e.set,
        {
          filter: and(
            `${e.f.itemNumber} eq ${lit(itemNumber.trim())}`,
            t ? `contains(${e.f.batchNumber},${lit(t)})` : undefined,
          ),
          select: [e.f.batchNumber],
          top: 200,
          signal,
        },
        'productReceiptLines',
      )
      const seen = new Set(rows.map((r) => str(r, e.f.batchNumber)).filter(Boolean))
      return [...seen].sort().slice(0, 50).map((id) => ({ id }))
    },

    async lookupPurchaseOrders(
      itemNumber: string,
      term: string,
      signal?: AbortSignal,
    ): Promise<Ref[]> {
      const e = await requireEntity('purchaseOrderLines', signal)
      const t = term.trim()
      const rows = await odataQuery<Row>(
        e.set,
        {
          filter: and(
            eqIf(e.f.itemNumber, itemNumber.trim()),
            t ? `contains(${e.f.purchaseOrderNumber},${lit(t)})` : undefined,
          ),
          select: [e.f.purchaseOrderNumber],
          top: 200,
          signal,
        },
        'purchaseOrderLines',
      )
      // Newest first: order numbers are sequential, and the one just created
      // in the walkthrough is the one the presenter is looking for.
      const seen = new Set(rows.map((r) => str(r, e.f.purchaseOrderNumber)).filter(Boolean))
      return [...seen].sort().reverse().slice(0, 50).map((id) => ({ id }))
    },
  }

  return provider
}

/** Fetches an entity for a set of key values, chunked to keep URLs short. */
async function fetchByKeys(
  entity: ResolvedEntity,
  configKey: string,
  field: string,
  values: string[],
  signal?: AbortSignal,
  extraFilter?: string,
): Promise<Row[]> {
  if (values.length === 0) return []
  const batches = chunk(values, PAGE_KEYS)
  const results = await Promise.all(
    batches.map((batch) =>
      odataQuery<Row>(
        entity.set,
        { filter: and(anyOf(field, batch), extraFilter), signal },
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

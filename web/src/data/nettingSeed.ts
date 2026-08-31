import type { DemandLine, ImpactInputs, SupplyLot } from '../types/netting'
import { addDaysIso, todayIso } from '../lib/format'
import { expectedRows, itemByNumber } from './seed'
import { onHandBatches, producedItems, shelfLifeOf } from './productionSeed'

/**
 * The demand side of the impact analysis: planned production orders pegged
 * against a raw material's supply.
 *
 * Demand is DERIVED, not hand-authored. The planning policy is lot-for-lot: for
 * every supply lot — each unexpired lot on hand and each open PO line — one
 * planned order of the finished good that consumes this material is generated,
 * sized to that lot (rounded down to 100) and dated shortly after the lot is
 * available, never past its expiry. That is what a lot-for-lot coverage policy
 * produces on the Net requirements page, and it has the property the demo
 * needs: the baseline nets clean, so ANY adverse change to an open PO — moved
 * out, confirmed short — surfaces immediately as a pegged shortfall, and a
 * quantity confirmed long surfaces as material with no demand against it.
 *
 * The netting is item-level and ignores the inquiry's site filter, as D365's
 * net requirements do when coverage is planned per item.
 */

/** Lots below this are residual noise — left unpegged as planning slack. */
const PEG_FLOOR = 1_000

/** Days between a lot becoming available and the planned order that spends it. */
const CONSUMPTION_LAG = 2

const HORIZON_DAYS = 28

/** Stable planned-order number ranges per focus raw material. */
const PLANNED_ORDER_BASE: Record<string, number> = {
  F440: 110,
  RAW541: 210,
}

let impactCache: { asOf: string; byItem: Map<string, ImpactInputs | undefined> } | null =
  null

/**
 * Supply and pegged demand for one item, or undefined when the item has no
 * open purchase orders to simulate against.
 */
export function impactInputsFor(
  itemNumber: string,
  today: string = todayIso(),
): ImpactInputs | undefined {
  if (impactCache?.asOf !== today) {
    impactCache = { asOf: today, byItem: new Map() }
  }
  if (impactCache.byItem.has(itemNumber)) {
    return impactCache.byItem.get(itemNumber)
  }
  const built = build(itemNumber, today)
  impactCache.byItem.set(itemNumber, built)
  return built
}

function build(itemNumber: string, today: string): ImpactInputs | undefined {
  const item = itemByNumber(itemNumber)
  const expected = expectedRows(today).filter((r) => r.itemNumber === itemNumber)
  if (!item || expected.length === 0) return undefined

  const consumer = producedItems().find(
    (fg) => fg.bom?.itemNumber === itemNumber,
  )
  const description = consumer
    ? `${consumer.itemNumber} ${consumer.productName} — planned production`
    : `${itemNumber} — planned requirement`

  const shelfLife = shelfLifeOf(itemNumber)

  const onHand = onHandBatches(today).filter(
    (b) => b.itemNumber === itemNumber && b.status !== 'Expired' && b.quantity > 0,
  )

  const supplies: SupplyLot[] = [
    ...onHand.map(
      (b): SupplyLot => ({
        id: `oh|${b.batchNumber}`,
        kind: 'On hand',
        reference: b.batchNumber,
        availableDate: today,
        expiryDate: b.expiryDate,
        quantity: b.quantity,
        unit: b.unit,
        unitCost: b.landedCost,
        currency: b.currency,
      }),
    ),
    ...expected.map(
      (r): SupplyLot => ({
        id: r.id,
        kind: 'Expected',
        reference: r.purchaseOrderNumber,
        availableDate: r.receiptDate,
        expiryDate: shelfLife ? addDaysIso(r.receiptDate, shelfLife) : undefined,
        quantity: r.quantityReceived,
        unit: r.unit,
        unitCost: r.landedCost,
        currency: r.currency,
      }),
    ),
  ]

  // One planned order per peggable lot. On-hand lots are spread three days
  // apart in expiry order (never past their own expiry); an open PO's order
  // lands CONSUMPTION_LAG days after the confirmed delivery. Both sequences
  // rise with the lot order, so the FEFO netting consumes lot for lot.
  const demands: DemandLine[] = []
  let sequence = PLANNED_ORDER_BASE[itemNumber] ?? 310

  const sortedOnHand = [...onHand].sort((a, b) =>
    a.expiryDate < b.expiryDate ? -1 : 1,
  )
  let onHandIndex = 0
  for (const b of sortedOnHand) {
    const quantity = Math.floor(b.quantity / 100) * 100
    if (quantity < PEG_FLOOR) continue
    const day = Math.max(
      0,
      Math.min(b.daysToExpiry, 1 + onHandIndex * 3, HORIZON_DAYS - 1),
    )
    demands.push({
      id: `pp|${sequence}`,
      reference: `PP-000${sequence}`,
      description,
      requiredDate: addDaysIso(today, day),
      quantity,
      unit: b.unit,
    })
    sequence += 2
    onHandIndex += 1
  }

  for (const r of expected) {
    const quantity = Math.floor(r.quantityReceived / 100) * 100
    if (quantity < PEG_FLOOR) continue
    demands.push({
      id: `pp|${sequence}`,
      reference: `PP-000${sequence}`,
      description,
      requiredDate: addDaysIso(r.receiptDate, CONSUMPTION_LAG),
      quantity,
      unit: r.unit,
    })
    sequence += 2
  }

  return {
    itemNumber,
    asOf: today,
    horizonDays: HORIZON_DAYS,
    supplies,
    demands,
  }
}

/**
 * Domain model for the impact analysis — the netting of supply against
 * downstream demand that D365's Net requirements page shows, and that the
 * Procurement agent's impact analysis runs when a vendor asks to move a
 * purchase order.
 *
 * The provider supplies the two sides — what supply exists (on-hand lots and
 * open purchase order lines) and what downstream demand is pegged against it —
 * and lib/netting.ts does the arithmetic, so a simulation is a pure re-run
 * with adjusted supply rather than a second data fetch.
 */

/** One source of supply the netting can draw from. */
export interface SupplyLot {
  id: string
  /** An unexpired lot in the warehouse, or an open PO line not yet received. */
  kind: 'On hand' | 'Expected'
  /** Batch number for on-hand supply, purchase order number for expected. */
  reference: string
  /** First day the material can be consumed. Today for on-hand lots. */
  availableDate: string
  /** Absent = does not expire inside any horizon that matters. */
  expiryDate?: string
  quantity: number
  unit: string
  /** Landed cost for on-hand lots; expected landed cost for open PO lines. */
  unitCost: number
  currency: string
}

/** One line of downstream demand — a planned production order's requirement. */
export interface DemandLine {
  id: string
  /** Planned order reference, e.g. PP-000112. */
  reference: string
  /** What the demand feeds, e.g. "FG816 AVOCADO 40 4CT — planned production". */
  description: string
  requiredDate: string
  quantity: number
  unit: string
}

/** Everything the impact analysis needs for one item. */
export interface ImpactInputs {
  itemNumber: string
  /** The day the netting starts — on-hand is as at this date. */
  asOf: string
  /** Days the projection strip covers. Demand never extends past it. */
  horizonDays: number
  supplies: SupplyLot[]
  demands: DemandLine[]
}

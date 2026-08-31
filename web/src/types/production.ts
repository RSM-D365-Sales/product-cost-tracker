/**
 * Domain model for the Production cost inquiry.
 *
 * Where types/domain.ts answers "what did this receipt actually cost me", this
 * file answers the next three questions a plant asks:
 *
 *   1. What does one finished unit cost to make?   -> ProductionBom + CostRollup
 *   2. What material do I actually have, and how long before it is rubbish?
 *                                                   -> BatchOnHand
 *   3. What should I run, on which line, and when?  -> PlannedRun + AtRiskBatch
 *
 * The link back to the product cost inquiry is `BatchOnHand.landedCost`: a batch
 * is valued at the landed cost of the receipt that created it, so the cost of a
 * planned run is the actual cost of the specific lots it will consume rather
 * than a standard. That is what batch actual costing means, and it is why two
 * runs of the same item on the same line cost different amounts.
 *
 * Money is per unit unless a field name says otherwise, in the item's currency.
 */

import type {
  ItemInfo,
  ProviderKind,
  ReceiptRow,
  ReceiptSourceType,
} from './domain'

/**
 * D365 cost groups. Material and Packaging both come off the BOM; Labour and
 * Overhead both come off the route. Splitting packaging out of material is a
 * convention rather than a rule, but food manufacturers universally want to see
 * "what did the can cost me" separately from "what did the beans cost me".
 */
export type CostGroup = 'Material' | 'Packaging' | 'Labour' | 'Overhead'

/** How a component's unit cost was arrived at — shown so no figure is a mystery. */
export type CostBasis =
  /** Quantity-weighted landed cost of the batches currently on hand. */
  | 'On-hand average'
  /** The item's own inventory cost, used when nothing is on hand to average. */
  | 'Item cost'
  /** The actual landed cost of the specific batch a planned run consumes. */
  | 'Batch actual'

/** One BOM line, costed. */
export interface BomComponentLine {
  lineNumber: number
  itemNumber: string
  productName: string
  /** Net quantity per one finished unit, before scrap. */
  quantityPer: number
  unit: string
  /** BOM line scrap/waste, as a fraction. */
  scrapPercent: number
  /** quantityPer * (1 + scrapPercent) — what is actually drawn from stock. */
  quantityConsumed: number
  costGroup: CostGroup
  unitCost: number
  costBasis: CostBasis
  /** quantityConsumed * unitCost. */
  extendedCost: number
  /**
   * Batch-tracked components are the ones that can constrain and spoil, so only
   * these are netted against on-hand lots when the plan is built. Packaging is
   * bought to a min/max and is assumed available.
   */
  batchTracked: boolean
  /** Days from receipt to expiry. Absent for items that do not expire. */
  shelfLifeDays?: number
}

/** One route operation, costed. Labour and overhead only — material is the BOM. */
export interface RouteOperationLine {
  operationNumber: number
  description: string
  /** Work centre / resource group, e.g. PACK-01. */
  resourceId: string
  costGroup: CostGroup
  costPerUnit: number
}

/** The costed bill of material and route for one finished item. */
export interface ProductionBom {
  itemNumber: string
  productName: string
  unit: string
  currency: string
  bomId: string
  bomVersion: string
  routeId: string
  siteId: string
  /**
   * D365 expresses a BOM per a series quantity; every figure in `components` is
   * already divided down to one finished unit, and this is carried only so the
   * header can say what the approved version actually reads.
   */
  perSeries: number
  approvedOn: string
  components: BomComponentLine[]
  operations: RouteOperationLine[]
}

/** The cost calculation: what one unit costs, split the way D365 splits it. */
export interface CostRollup {
  byGroup: { group: CostGroup; amount: number }[]
  material: number
  packaging: number
  labour: number
  overhead: number
  /** Sum of the four. The calculated cost of one finished unit. */
  total: number
  /** The item's current inventory cost, for comparison. */
  currentCost: number
  /**
   * Quantity-weighted actual cost of this item's posted production receipts —
   * the same rows the product cost inquiry grid shows. Calculated vs. actual is
   * the variance a cost accountant is looking for.
   */
  actualCost: number
  actualRunCount: number
  sellingPrice: number
  /** (sellingPrice - total) / sellingPrice. */
  marginCalculated: number
  /** (sellingPrice - currentCost) / sellingPrice. */
  marginCurrent: number
  currency: string
}

/**
 * Expired batches are still returned — a plant needs to see what it is about to
 * write off, not have it quietly filtered away.
 */
export type BatchStatus = 'Available' | 'Expiring' | 'Expired'

/** One lot of one item sitting in one place, valued at what it actually cost. */
export interface BatchOnHand {
  id: string
  itemNumber: string
  productName: string
  batchNumber: string
  siteId: string
  warehouseId: string
  locationId?: string
  /** Physical on hand, in the item's stocking unit. */
  quantity: number
  unit: string
  receiptDate: string
  expiryDate: string
  /** Negative once expired. Relative to the query's plan start date. */
  daysToExpiry: number
  status: BatchStatus
  /** Per unit, from the receipt that created the batch. */
  landedCost: number
  /** quantity * landedCost. */
  inventoryValue: number
  currency: string
  /** Product receipt or report-as-finished journal that created the lot. */
  receiptNumber: string
  /** Purchase order or production order behind that receipt. */
  orderNumber: string
  sourceType: ReceiptSourceType
}

/** A production line and the capacity it can commit to this item family. */
export interface ProductionLine {
  lineId: string
  name: string
  siteId: string
  /** Where the finished goods are reported in. */
  warehouseId: string
  /** Finished items this line is tooled for. */
  itemNumbers: string[]
  /** Finished units per running hour. */
  unitsPerHour: number
  /**
   * Hours per day this line can give THIS item. A line that also runs other
   * products cannot give all 24, and committed hours is the number a planner
   * actually negotiates over — so it is the knob the page exposes.
   */
  hoursPerDay: number
  /** Changeover and CIP before a run starts, in hours. */
  setupHours: number
  enabledByDefault: boolean
}

/** One component draw behind a planned run. */
export interface PlannedConsumption {
  itemNumber: string
  productName: string
  /** Absent for components that are not batch tracked. */
  batchNumber?: string
  expiryDate?: string
  quantity: number
  unit: string
  unitCost: number
  extendedCost: number
  costGroup: CostGroup
}

/** One proposed production run: what to make, where, when, from which lots. */
export interface PlannedRun {
  id: string
  sequence: number
  lineId: string
  lineName: string
  siteId: string
  warehouseId: string
  itemNumber: string
  quantity: number
  unit: string
  startDate: string
  /** Inclusive. A run occupying one day starts and ends on the same date. */
  endDate: string
  runHours: number
  /** The FEFO-oldest batch this run consumes — the reason it is scheduled here. */
  drivingBatchNumber: string
  drivingBatchExpiry: string
  /**
   * Days between the run completing and the driving batch expiring. Zero means
   * it finishes on the last legal day; the planner never returns a negative.
   */
  slackDays: number
  consumption: PlannedConsumption[]
  materialCostPerUnit: number
  packagingCostPerUnit: number
  /** Labour + overhead, per unit. */
  conversionCostPerUnit: number
  totalCostPerUnit: number
  extendedCost: number
  sellingPrice: number
  marginEstimate: number
  currency: string
}

/** Material that cannot be consumed before it expires, and what that costs. */
export interface AtRiskBatch {
  batchNumber: string
  itemNumber: string
  productName: string
  expiryDate: string
  daysToExpiry: number
  /** The portion that cannot be consumed in time, not the whole batch. */
  quantity: number
  unit: string
  unitCost: number
  value: number
  reason: string
}

export interface ProductionPlanSummary {
  runCount: number
  plannedQuantity: number
  unit: string
  totalCost: number
  averageCostPerUnit: number
  plannedRevenue: number
  /** (plannedRevenue - totalCost) / plannedRevenue. */
  plannedMargin: number
  /** Extended cost of the batch-tracked material the plan consumes. */
  materialValueConsumed: number
  atRiskQuantity: number
  atRiskValue: number
  /** scheduledHours / availableHours over the horizon. */
  capacityUtilisation: number
  availableHours: number
  scheduledHours: number
  currency: string
  horizonFrom: string
  horizonTo: string
  /** Plain-English statement of what limited the plan. */
  bindingConstraint: string
}

/**
 * `itemNumber` must be a produced item. Everything else has a sensible default
 * so the page runs on an item number alone.
 */
export interface ProductionCostQuery {
  itemNumber: string
  siteId?: string
  /** ISO date the plan starts. Defaults to today. */
  planStartDate?: string
  /** Planning horizon in days, inclusive of the start date. Defaults to 21. */
  horizonDays?: number
  /** Lines to plan on. Absent means every line flagged `enabledByDefault`. */
  lineIds?: string[]
  /** Proposed runs below this are not worth a changeover. Defaults to 250. */
  minimumRunQuantity?: number
}

export interface ProductionCostResult {
  query: ProductionCostQuery
  item: ItemInfo
  bom: ProductionBom
  rollup: CostRollup
  /**
   * The item's posted production receipts — the same rows the product cost
   * inquiry shows — so the variance analysis can set each actual run against
   * the calculated cost without a second inquiry. Newest first.
   */
  actualRuns: ReceiptRow[]
  /** Every batch-tracked component, plus the finished item itself. */
  onHand: BatchOnHand[]
  /** Lines capable of the item, whether or not the plan used them. */
  lines: ProductionLine[]
  plan: PlannedRun[]
  atRisk: AtRiskBatch[]
  summary: ProductionPlanSummary
  warnings: string[]
  source: ProviderKind
  elapsedMs: number
}

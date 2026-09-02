/**
 * Domain model for the Product cost inquiry.
 *
 * These types are the contract between the UI and whatever is supplying data
 * (seeded mock, standard OData entities, or the custom X++ service). The X++
 * data contracts in /dynamics are written to serialise into exactly this shape,
 * so a provider swap is a one-line change in providers/index.ts.
 *
 * Money is always PER UNIT unless a field name says otherwise, and always in
 * the transaction currency of the receipt. Quantities are in the purchase unit.
 */

/** How a charge behaves against inventory cost. */
export type ChargeType =
  /** Posts to expense / does not capitalise into inventory value (the "AOC" bucket). */
  | 'Financial'
  /** Capitalises into the inventory cost of the received goods. */
  | 'Stock'
  /**
   * Conversion cost picked up by a production order — direct labour, machine
   * time, production overhead, packaging materials. Only ever present on rows
   * with `sourceType === 'Production'`, and it rolls into the same per-unit
   * bucket as a purchase-side financial charge so one grid column serves both.
   */
  | 'Conversion'

/** Where the charge was captured in D365. */
export type ChargeSource = 'Header' | 'Line'

/**
 * D365 header-charge allocation methods (MarkupAllocation). Header charges are
 * spread across the lines of the order; which method is used materially changes
 * the per-unit add-on cost, which is why two receipts of the same item at the
 * same FOB price can land at different costs.
 */
export type AllocationMethod =
  | 'Net amount'
  | 'Quantity'
  | 'Net weight'
  | 'Volume'
  | 'Equally'
  | 'Manual'

export interface ChargeLine {
  /** MarkupCode, e.g. FREIGHT, DUTY, BROKERAGE. */
  chargeCode: string
  description: string
  chargeType: ChargeType
  source: ChargeSource
  /** Only meaningful when source === 'Header'. */
  allocationMethod?: AllocationMethod
  /** Amount allocated to THIS receipt line, transaction currency, extended. */
  amount: number
  /** amount / quantityReceived. Precomputed so the UI never divides by zero. */
  amountPerUnit: number
}

/**
 * Where the inventory receipt came from. Purchased items are received against a
 * purchase order; manufactured items are reported as finished against a
 * production order. Both are inventory receipts and both carry a per-unit cost,
 * so they share this row shape — `sourceType` is what lets the UI label them
 * honestly instead of calling a production order a "PO number".
 *
 * Absent means 'Purchase' (the OData and service providers only return
 * purchase-side receipts today).
 */
export type ReceiptSourceType = 'Purchase' | 'Production'

/**
 * Whether the goods have actually arrived. `Expected` rows are open purchase
 * order lines not yet product-receipted: the quantity is ordered-not-received,
 * the receipt date is the confirmed delivery date, the price is the
 * vendor-confirmed price and the charges are estimates — which is exactly what
 * makes them worth putting on the same grid: they say where the next receipts
 * are EXPECTED to land against where the posted ones actually did.
 *
 * Absent means 'Posted'. Expected rows never enter the summary averages, the
 * trend fit, or the variance baseline — a cost you have not yet paid is not a
 * cost you paid — they are only measured against them.
 */
export type ReceiptStatus = 'Posted' | 'Expected'

/** One product receipt line, fully costed. This is a row in the main grid. */
export interface ReceiptRow {
  /** Stable synthetic key: `${purchaseOrderNumber}|${receiptNumber}|${purchaseLineNumber}`. */
  id: string

  /** Defaults to 'Purchase' when absent. */
  sourceType?: ReceiptSourceType

  /** Defaults to 'Posted' when absent. See ReceiptStatus. */
  receiptStatus?: ReceiptStatus

  /** Purchase order number, or the production order number when produced. */
  purchaseOrderNumber: string
  purchaseLineNumber: number
  /** Product receipt (packing slip) id, or the report-as-finished journal id. */
  receiptNumber: string
  /** ISO-8601 date (no time component is meaningful here). */
  receiptDate: string

  itemNumber: string
  productName: string

  vendorAccount: string
  vendorName: string

  siteId: string
  warehouseId: string
  locationId?: string
  batchNumber?: string

  /**
   * Under batch actual costing the cost of a produced batch is the actual cost
   * of the batch it consumed, not a standard. These two fields record that link
   * so a finished-goods row can be traced back to the raw-material receipt it
   * was made from. Only set when `sourceType === 'Production'`.
   */
  sourceItemNumber?: string
  sourceBatchNumber?: string

  quantityReceived: number
  unit: string
  currency: string

  /**
   * Per unit, goods only, no charges. Purchased: the free-on-board purchase
   * price. Produced: the BOM material cost drawn from the consumed batch.
   */
  purchasePriceFob: number
  /**
   * Per unit. Purchased: allocated financial (add-on) charges. Produced:
   * allocated conversion cost. Sum of `charges` divided by quantity.
   */
  financialChargesAoc: number
  /** purchasePriceFob + financialChargesAoc. */
  landedCost: number
  /** Active sales price per unit at the time of query. */
  sellingPrice: number
  /** (sellingPrice - landedCost) / sellingPrice, as a fraction. */
  marginEstimate: number

  /** The individual charges that rolled up into financialChargesAoc. */
  charges: ChargeLine[]
}

/** Header block above the grid. All figures are quantity-weighted. */
export interface ProductCostSummary {
  averagePurchaseCost: number
  averageLandedCost: number
  averageAddOnCost: number
  /** Current active sales price. */
  sellingPrice: number
  /** Current inventory cost from the item's costing record. */
  currentCost: number
  /** (sellingPrice - currentCost) / sellingPrice. */
  averageMarginStandard: number
  /** (sellingPrice - averageLandedCost) / sellingPrice. */
  averageMarginLanded: number

  totalQuantity: number
  receiptCount: number
  currency: string
}

export interface ItemInfo {
  itemNumber: string
  productName: string
  /** Item's stocking/inventory unit. */
  unit: string
  currency: string
  /** InventItemPrice active cost. */
  currentCost: number
  /** Active sales price. */
  sellingPrice: number
  itemGroupId?: string
  costingMethod?: string
}

/** Generic id/name pair used by the lookup fields. */
export interface Ref {
  id: string
  name?: string
}

/** Vendor master detail for the vendors appearing in a result. */
export interface VendorInfo {
  vendorAccount: string
  vendorName: string
  /** Quoted order-to-dock lead time in days. Absent when the source does not carry one. */
  leadTimeDays?: number
}

/**
 * Query parameters. `itemNumber` is the only required one; everything else
 * narrows the result. `daysBack` and the from/to pair are mutually exclusive —
 * `daysBack` wins if both are set (see lib/query.ts:resolveDateWindow).
 */
export interface ProductCostQuery {
  itemNumber: string
  siteId?: string
  warehouseId?: string
  locationId?: string
  batchNumber?: string
  purchaseOrderNumber?: string
  /** ISO date, inclusive. */
  fromDate?: string
  /** ISO date, inclusive. */
  toDate?: string
  /** Rolling window ending today. Overrides fromDate/toDate when set. */
  daysBack?: number
}

export type ProviderKind = 'mock' | 'odata' | 'service'

export interface ProductCostResult {
  query: ProductCostQuery
  item: ItemInfo
  summary: ProductCostSummary
  rows: ReceiptRow[]
  /**
   * Open purchase order lines not yet received (`receiptStatus: 'Expected'`),
   * newest expected date first. Kept apart from `rows` so the summary, trend
   * and variance baseline stay posted-actuals-only; the page decides whether
   * to show them in the grid. Absent when the provider has none.
   */
  expected?: ReceiptRow[]
  /**
   * Vendor master rows for the vendor accounts present in `rows` or
   * `expected`, when the source carries them — lead times feed the Copilot
   * vendor-mix narrative. Absent on providers with no vendor master mapped.
   */
  vendors?: VendorInfo[]
  /**
   * Supply and pegged downstream demand for the impact analysis, when the
   * item has expected receipts to simulate against. See types/netting.ts.
   */
  impact?: import('./netting').ImpactInputs
  /** Non-fatal notes, e.g. "3 header charges could not be allocated". */
  warnings: string[]
  source: ProviderKind
  elapsedMs: number
}

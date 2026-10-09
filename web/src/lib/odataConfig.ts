/**
 * OData entity-set and field-name mapping.
 *
 * ============================ READ THIS FIRST ============================
 * Public data-entity names and their exposed field names DRIFT between F&O
 * versions and are affected by which features are enabled in an environment.
 * Rather than scatter guesses through the provider, every name the app depends
 * on lives here, in one object, so reconciling it against a real environment is
 * a single-file edit.
 *
 * To verify against YOUR environment (takes about two minutes):
 *
 *   1. Start the proxy:            npm run dev:server
 *   2. List the entity sets:       curl "http://localhost:8787/api/probe?q=purchase"
 *                                  curl "http://localhost:8787/api/probe?q=receipt"
 *                                  curl "http://localhost:8787/api/probe?q=charge"
 *   3. Inspect one entity's fields: curl "http://localhost:8787/api/probe/PurchaseOrderLines"
 *   4. Correct the names below.
 *
 * The entries flagged CONFIRM are the ones most likely to differ — product
 * receipt and charge entities in particular. The provider raises an error that
 * names the config key when an entity set 404s, so a wrong guess is obvious
 * rather than silent.
 *
 * CANDIDATES. Because the names drift, `set` and every field may list several
 * candidates, most likely first. At the first live call the provider reads ONE
 * record of the entity and binds each logical field to the first candidate
 * that record actually carries (see providers/odataSchema.ts), so a version
 * that calls it ReceivingSiteId and one that calls it SiteId both work without
 * an edit. A `required` field with no matching candidate fails loudly, listing
 * the names the entity does expose; an optional one is left unbound and
 * simply not read. `npm run check:live` prints the binding for every entity.
 * ========================================================================
 */

/** One property name, or candidates in order of preference. */
export type FieldSpec = string | readonly string[]

export interface EntityMap {
  /** OData entity set name as it appears after /data/, or candidates. */
  set: string | readonly string[]
  /** Logical field name -> the property name(s) the entity may expose. */
  fields: Record<string, FieldSpec>
  /** Logical fields the provider cannot work without. */
  required?: readonly string[]
  /** When true, a missing entity set degrades with a warning instead of failing. */
  optional?: boolean
}

export const ODATA: {
  releasedProducts: EntityMap
  purchaseOrderHeaders: EntityMap
  purchaseOrderLines: EntityMap
  productReceiptLines: EntityMap
  headerCharges: EntityMap
  lineCharges: EntityMap
  sites: EntityMap
  warehouses: EntityMap
} = {
  releasedProducts: {
    set: 'ReleasedProductsV2',
    fields: {
      itemNumber: 'ItemNumber',
      productName: ['ProductName', 'SearchName', 'ProductSearchName'],
      unit: ['InventoryUnitSymbol', 'PurchaseUnitSymbol'],
      salesPrice: 'SalesPrice',
      // The item-master purchase price, shown beside what the orders paid.
      purchasePrice: 'PurchasePrice',
      // CONFIRM — the active inventory cost. Not every version exposes it on
      // the released product; when none of these exist the summary says so.
      costPrice: ['UnitCost', 'CostPrice', 'InventoryPrice', 'ProductionStandardCost'],
      itemGroupId: ['ItemGroupId', 'ProductGroupId'],
      costingMethod: ['InventoryCostingMethod', 'ItemModelGroupId'],
    },
    required: ['itemNumber'],
  },

  purchaseOrderHeaders: {
    set: ['PurchaseOrderHeadersV2', 'PurchaseOrderHeaders'],
    fields: {
      purchaseOrderNumber: 'PurchaseOrderNumber',
      vendorAccount: ['OrderVendorAccountNumber', 'InvoiceVendorAccountNumber'],
      // PurchaseOrderName defaults to the vendor's name when the order is
      // created, which saves a join to VendorsV2.
      vendorName: ['VendorName', 'PurchaseOrderName'],
      currency: 'CurrencyCode',
    },
    required: ['purchaseOrderNumber'],
  },

  purchaseOrderLines: {
    set: ['PurchaseOrderLinesV2', 'PurchaseOrderLines'],
    fields: {
      purchaseOrderNumber: 'PurchaseOrderNumber',
      lineNumber: 'LineNumber',
      itemNumber: 'ItemNumber',
      orderedQuantity: 'OrderedPurchaseQuantity',
      unitPrice: 'PurchasePrice',
      // Price unit: PurchasePrice is per this many purchase units.
      priceQuantity: 'PurchasePriceQuantity',
      // Net of line discount — the preferred source of the unit price.
      lineAmount: 'LineAmount',
      unit: 'PurchaseUnitSymbol',
      siteId: 'ReceivingSiteId',
      warehouseId: 'ReceivingWarehouseId',
      // PurchStatus: Backorder (open order) | Received | Invoiced | Canceled.
      lineStatus: ['PurchaseOrderLineStatus', 'LineStatus'],
      confirmedDate: 'ConfirmedDeliveryDate',
      requestedDate: ['RequestedDeliveryDate', 'DeliveryDate'],
    },
    required: ['purchaseOrderNumber', 'lineNumber', 'itemNumber', 'orderedQuantity'],
  },

  // CONFIRM — the most version-sensitive entity in the file. Backing table is
  // VendPackingSlipTrans. Note the PO line number is listed before LineNumber:
  // on some versions LineNumber is the receipt's own line, not the order's.
  productReceiptLines: {
    set: ['ProductReceiptLines', 'PurchaseOrderProductReceiptLines', 'VendorProductReceiptLines'],
    fields: {
      productReceiptNumber: ['ProductReceiptNumber', 'PackingSlipId'],
      purchaseOrderNumber: ['PurchaseOrderNumber', 'PurchId'],
      purchaseLineNumber: ['PurchaseOrderLineNumber', 'PurchaseLineNumber', 'LineNumber'],
      itemNumber: ['ItemNumber', 'ItemId'],
      // Purchase units first, because the price it is multiplied by is per
      // purchase unit.
      receivedQuantity: [
        'ReceivedPurchaseQuantity',
        'ReceivedQuantity',
        'ReceivedInventoryQuantity',
        'Quantity',
      ],
      receiptDate: ['ProductReceiptDate', 'DeliveryDate', 'ReceiptDate'],
      siteId: ['ReceivingSiteId', 'SiteId', 'InventorySiteId'],
      warehouseId: ['ReceivingWarehouseId', 'WarehouseId', 'InventoryWarehouseId'],
      locationId: ['ReceivingWarehouseLocationId', 'WarehouseLocationId', 'LocationId'],
      batchNumber: ['ItemBatchNumber', 'BatchNumber'],
    },
    required: [
      'productReceiptNumber',
      'purchaseOrderNumber',
      'purchaseLineNumber',
      'itemNumber',
      'receivedQuantity',
      'receiptDate',
    ],
  },

  // CONFIRM — MarkupTrans-backed. Some environments expose a single
  // "PurchaseOrderCharges" set with a Level/RefType discriminator instead of
  // this header/line split; if so, point both entries at it and add the
  // discriminator to `extraFilter` in the provider. Optional: without them the
  // inquiry still runs, at FOB, and says so.
  headerCharges: {
    set: ['PurchaseOrderHeaderCharges', 'PurchaseOrderHeaderChargesV2'],
    fields: {
      purchaseOrderNumber: 'PurchaseOrderNumber',
      chargeCode: ['ChargeCode', 'PurchaseChargeCode'],
      description: ['Description', 'ChargeDescription'],
      chargeValue: ['ChargeValue', 'FixedChargeAmount'],
      calculatedAmount: ['CalculatedChargeAmount', 'ChargeAmount'],
      allocationMethod: ['ChargeAllocationMethod', 'AllocationMethod'],
      currency: 'CurrencyCode',
    },
    required: ['purchaseOrderNumber', 'chargeCode'],
    optional: true,
  },

  lineCharges: {
    set: ['PurchaseOrderLineCharges', 'PurchaseOrderLineChargesV2'],
    fields: {
      purchaseOrderNumber: 'PurchaseOrderNumber',
      lineNumber: ['PurchaseOrderLineNumber', 'LineNumber'],
      chargeCode: ['ChargeCode', 'PurchaseChargeCode'],
      description: ['Description', 'ChargeDescription'],
      calculatedAmount: ['CalculatedChargeAmount', 'ChargeAmount', 'FixedChargeAmount'],
      currency: 'CurrencyCode',
    },
    required: ['purchaseOrderNumber', 'lineNumber', 'chargeCode'],
    optional: true,
  },

  sites: {
    set: 'OperationalSites',
    fields: { siteId: 'SiteId', siteName: 'SiteName' },
    required: ['siteId'],
  },

  warehouses: {
    set: 'Warehouses',
    fields: {
      warehouseId: 'WarehouseId',
      warehouseName: 'WarehouseName',
      siteId: ['OperationalSiteId', 'WarehouseSiteId', 'SiteId'],
    },
    required: ['warehouseId'],
  },
}

export type EntityKey = keyof typeof ODATA

/** The candidate list behind a FieldSpec or set name. */
export function candidates(spec: string | readonly string[]): readonly string[] {
  return typeof spec === 'string' ? [spec] : spec
}

/**
 * Binds every logical field to the first candidate present on a sampled record.
 * Unbound optional fields come back as '' — callers treat '' as "this entity
 * does not expose it" and neither filter on it nor read it.
 *
 * Pure, so the provider and scripts/check-live.ts resolve identically.
 */
export function bindFields(
  entity: EntityMap,
  present: ReadonlySet<string>,
): { fields: Record<string, string>; missing: string[] } {
  const fields: Record<string, string> = {}
  const missing: string[] = []
  for (const [logical, spec] of Object.entries(entity.fields)) {
    const hit = candidates(spec).find((c) => present.has(c))
    fields[logical] = hit ?? ''
    if (!hit && entity.required?.includes(logical)) missing.push(logical)
  }
  return { fields, missing }
}

/** F&O writes an empty date as 1900-01-01; anything that early means "not set". */
export function isoDateOrEmpty(value: unknown): string {
  const s = value == null ? '' : String(value).slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && s > '1901-01-01' ? s : ''
}

/** PurchStatus values that mean the line is still waiting for goods. */
export const OPEN_LINE_STATUSES = ['Backorder', 'None', 'OpenOrder']

/**
 * Charge codes that are FINANCIAL (expensed, the "AOC" bucket in the inquiry)
 * rather than capitalised into inventory cost.
 *
 * The authoritative answer lives on the charge code's posting setup
 * (MarkupTable.PostingType / "Debit type = Item"), which is not reliably exposed
 * on the charge entities. Two options:
 *   - list the codes here (fast, and fine for a fixed chart of charge codes), or
 *   - use the custom service, which reads the posting type server-side.
 * When the list is empty every charge is treated as financial.
 */
export const FINANCIAL_CHARGE_CODES: string[] = []

/**
 * ===================== PRODUCTION INQUIRY — NOT MAPPED =====================
 *
 * The production cost inquiry runs on the mock provider only. These are the
 * entity sets a live implementation would need; none has been verified, so none
 * is wired into ODATA above — a guess here would return a wrong cost rather
 * than an obvious error, which is the one failure mode worth avoiding.
 *
 * Probe them the same way as the rest:
 *   curl "http://localhost:8787/api/probe?q=bom"
 *   curl "http://localhost:8787/api/probe?q=onhand"
 *   curl "http://localhost:8787/api/probe?q=batch"
 *   curl "http://localhost:8787/api/probe/BillOfMaterialLines"
 *
 * Bill of material and route
 *   BillOfMaterials / BillOfMaterialLines  (BOMTable / BOM)
 *   BillOfMaterialVersions                 (BOMVersion — needs the site and
 *                                           date effectivity filter, which is
 *                                           the part most likely to be wrong)
 *   RouteVersions / Routes / RouteOperations
 *   CostCategories, CostGroups             (for the Labour/Overhead split)
 *
 * Inventory position
 *   InventoryOnHandByLocation or a warehouse on-hand entity (InventSum-backed).
 *   Aggregation across inventory dimensions is the risk: the same lot in two
 *   locations must not be double counted.
 *   InventoryBatches (InventBatch) for ExpiryDate / ProdDate / ShelfAdviceDate.
 *   ReleasedProductsV2 exposes ShelfLifePeriodDays on some versions.
 *
 * Capacity
 *   There is no standard entity for "hours this line will commit to this item".
 *   OperationsResources plus resource calendars get you gross capacity; the
 *   committed hours the page plans on are a planning assumption and would stay
 *   a parameter rather than a read.
 * ==========================================================================
 */

/** Maps F&O's MarkupAllocation enum values onto our AllocationMethod union. */
export const ALLOCATION_MAP: Record<string, string> = {
  Net: 'Net amount',
  NetAmount: 'Net amount',
  Amount: 'Net amount',
  Qty: 'Quantity',
  Quantity: 'Quantity',
  Weight: 'Net weight',
  NetWeight: 'Net weight',
  Volume: 'Volume',
  Equally: 'Equally',
  Manual: 'Manual',
}

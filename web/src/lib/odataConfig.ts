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
 * ========================================================================
 */

export interface EntityMap {
  /** OData entity set name, as it appears after /data/. */
  set: string
  /** Logical field name -> the property name exposed by the entity. */
  fields: Record<string, string>
}

export const ODATA: {
  releasedProducts: EntityMap
  purchaseOrderHeaders: EntityMap
  purchaseOrderLines: EntityMap
  productReceiptHeaders: EntityMap
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
      productName: 'ProductName',
      unit: 'InventoryUnitSymbol',
      salesPrice: 'SalesPrice',
      costPrice: 'CostPrice',
      itemGroupId: 'ItemGroupId',
      costingMethod: 'InventoryCostingMethod', // CONFIRM
    },
  },

  purchaseOrderHeaders: {
    set: 'PurchaseOrderHeadersV2',
    fields: {
      purchaseOrderNumber: 'PurchaseOrderNumber',
      vendorAccount: 'OrderVendorAccountNumber',
      vendorName: 'VendorName', // CONFIRM — may need a join to VendorsV2
      currency: 'CurrencyCode',
    },
  },

  purchaseOrderLines: {
    set: 'PurchaseOrderLines',
    fields: {
      purchaseOrderNumber: 'PurchaseOrderNumber',
      lineNumber: 'LineNumber',
      itemNumber: 'ItemNumber',
      orderedQuantity: 'OrderedPurchaseQuantity',
      unitPrice: 'PurchasePrice',
      lineAmount: 'LineAmount',
      unit: 'PurchaseUnitSymbol',
      siteId: 'ReceivingSiteId',
      warehouseId: 'ReceivingWarehouseId',
    },
  },

  // CONFIRM — this pair is the most version-sensitive in the file.
  // Backing tables are VendPackingSlipJour / VendPackingSlipTrans.
  productReceiptHeaders: {
    set: 'ProductReceiptHeaders',
    fields: {
      productReceiptNumber: 'ProductReceiptNumber',
      purchaseOrderNumber: 'PurchaseOrderNumber',
      receiptDate: 'ProductReceiptDate',
      vendorAccount: 'VendorAccountNumber',
    },
  },

  productReceiptLines: {
    set: 'ProductReceiptLines',
    fields: {
      productReceiptNumber: 'ProductReceiptNumber',
      purchaseOrderNumber: 'PurchaseOrderNumber',
      purchaseLineNumber: 'LineNumber',
      itemNumber: 'ItemNumber',
      receivedQuantity: 'ReceivedInventoryQuantity',
      receiptDate: 'ProductReceiptDate',
      siteId: 'SiteId',
      warehouseId: 'WarehouseId',
      locationId: 'LocationId',
      batchNumber: 'BatchNumber',
    },
  },

  // CONFIRM — MarkupTrans-backed. Some environments expose a single
  // "PurchaseOrderCharges" set with a Level/RefType discriminator instead of
  // this header/line split; if so, point both entries at it and add the
  // discriminator to `extraFilter` in the provider.
  headerCharges: {
    set: 'PurchaseOrderHeaderCharges',
    fields: {
      purchaseOrderNumber: 'PurchaseOrderNumber',
      chargeCode: 'ChargeCode',
      description: 'Description',
      chargeValue: 'ChargeValue',
      calculatedAmount: 'CalculatedChargeAmount',
      allocationMethod: 'ChargeAllocationMethod',
      currency: 'CurrencyCode',
    },
  },

  lineCharges: {
    set: 'PurchaseOrderLineCharges',
    fields: {
      purchaseOrderNumber: 'PurchaseOrderNumber',
      lineNumber: 'LineNumber',
      chargeCode: 'ChargeCode',
      description: 'Description',
      calculatedAmount: 'CalculatedChargeAmount',
      currency: 'CurrencyCode',
    },
  },

  sites: {
    set: 'OperationalSites',
    fields: { siteId: 'SiteId', siteName: 'SiteName' },
  },

  warehouses: {
    set: 'Warehouses',
    fields: {
      warehouseId: 'WarehouseId',
      warehouseName: 'WarehouseName',
      siteId: 'WarehouseSiteId',
    },
  },
}

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

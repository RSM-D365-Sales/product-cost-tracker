import type {
  AllocationMethod,
  ChargeLine,
  ItemInfo,
  ReceiptRow,
} from '../types/domain'
import { allocateHeaderCharge, costRow } from '../lib/calc'
import { addDaysIso, isoOf, todayIso } from '../lib/format'
import { dayNumber } from '../lib/trend'

/**
 * Deterministic demo data for the mock provider — Bluestem Fresh Produce, a
 * Grand Rapids grower-packer-shipper and fresh-cut processor (RSM's fictional
 * IFPA demo company). Item numbers, names, sites, suppliers and growers come
 * from the Bluestem company data pack (../Blustem-company-details); every
 * figure is generated here.
 *
 * Two layers:
 *  1. ANCHOR rows — hand-authored so the headline numbers are stable and can be
 *     quoted in a demo script. Five purchase receipts of the two raw materials
 *     from V3014 Ridgeview Produce Exchange — blueberries into the Hart packing
 *     house, Honeycrisp apples into the Grand Rapids fresh-cut plant — and five
 *     production receipts of the two finished goods that consume those exact
 *     batches.
 *  2. Everything else is generated from a seeded PRNG, relative to today, so the
 *     grid always has recent activity and the date filters have something to do.
 *
 * There is no Math.random anywhere: the same seed always produces the same data,
 * which matters when you're demoing off a screenshot taken last week. The anchor
 * rows use absolute dates in early 2026 and therefore age; the generated rows
 * always sit in the trailing 24 months.
 *
 * The point the anchors make: all three blueberry receipts land at the same $2.35
 * FOB price, but at $2.77, $2.66 and $2.90 landed — and each finished-goods run
 * inherits the actual cost of the batch it consumed, which is what batch actual
 * costing does and what a standard cost would hide.
 */

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------

/** Cost components a production order picks up on top of BOM material. */
interface ConversionSpec {
  code: string
  description: string
  /** Cost per finished unit before run-to-run variation. */
  perUnit: number
}

export interface CatalogItem extends ItemInfo {
  /** `raw` and `packaging` are bought; `finished` is made. */
  kind: 'raw' | 'packaging' | 'finished'
  /** lb per stocking unit — the basis for "Net weight" charge allocation. */
  netWeight: number
  /** Typical FOB purchase price, before seasonal drift. Purchased items only. */
  basePurchasePrice?: number
  /**
   * Charge families this item attracts on an inbound load. Winter blueberries
   * cross the Mexican border and need cold chain; Honeycrisp come out of
   * controlled-atmosphere storage and carry a storage and handling charge.
   */
  chargeTags?: string[]
  /** `[min, max, step]` for a purchase order line. Defaults to bulk commodity volumes. */
  orderQty?: [number, number, number]
  /**
   * Fractional change in purchase price per year. Food commodities do not sit
   * still, and a cost inquiry with no drift in it has nothing to inquire about.
   */
  priceDriftPerYear?: number
  /**
   * Seasonal swing as a fraction of the base price, peaking in `peakMonth`
   * (1-12). Produce swings hard on harvest windows; dry goods barely move.
   */
  seasonality?: { amplitude: number; peakMonth: number }
  /**
   * Where inbound loads of this item are received. One entry means always
   * there — which is the case for both focus raw materials, per the demo
   * scenario. More than one and the order picks between them.
   */
  receiving?: { siteId: string; warehouseId: string }[]
  /**
   * Deliberate multi-sourcing. When set, generated orders that the volume draw
   * does not give the lead vendor are funnelled to these named alternates
   * instead of scattering across the whole vendor list, and an alternate's
   * `priceFactor` scales the prices on its single-commodity loads — that is
   * how "shorter lead time but dearer" becomes visible in the receipts rather
   * than staying master-data trivia. The funnelling is a pure remap that
   * consumes no PRNG draws, so no other item's generated figures move.
   * Quoted lead times live on the vendor records.
   */
  sourcing?: { vendorId: string; priceFactor: number }[]
  /**
   * Who actually supplies a background item. The vendor draw still runs over
   * the whole list it is given, and its result is remapped onto these by
   * index, so a clamshell comes from a packaging supplier and romaine from a
   * grower without any PRNG draw being added or removed.
   */
  vendorIds?: string[]
  /** Where a produced item is reported as finished when not at the co-packer. */
  production?: { siteId: string; warehouseId: string }
  /** Raw material consumed, and how much of it per finished unit. */
  bom?: { itemNumber: string; quantityPer: number }
  /** Conversion cost components picked up by a production order. */
  conversion?: ConversionSpec[]
}

/**
 * The four items the demo is built around. Everything hand-authored — the
 * anchor rows, the README figures, the assertions in verify.mjs — refers to
 * these, and they are generated from the PRNG stream first so that adding
 * background items cannot shift their numbers.
 */
export const FOCUS_ITEMS: CatalogItem[] = [
  {
    itemNumber: 'RAW-BLU',
    productName: 'Blueberries, bulk',
    unit: 'lb',
    currency: 'USD',
    // Every currentCost here sits deliberately a few percent under the
    // quantity-weighted landed cost of the item's own receipts. That gap is the
    // point of the inquiry: the cost carried on the item understates what the
    // receipts say you actually paid, and the summary block puts the two margins
    // side by side.
    currentCost: 2.96,
    // Raw materials are not sold as such; this is the bulk resale/transfer
    // price the margin column is measured against.
    sellingPrice: 3.95,
    itemGroupId: 'RM-Produce',
    costingMethod: 'Batch actual cost',
    kind: 'raw',
    netWeight: 1,
    basePurchasePrice: 2.35,
    chargeTags: ['all', 'cold', 'import'],
    receiving: [{ siteId: 'HRT', warehouseId: 'HRT-RM' }],
    priceDriftPerYear: 0.11,
    // Winter and spring volume comes up from Baja; the Michigan crop floods
    // the market over late summer and the price softens with it. Kept modest
    // on purpose: the seeded window spans ~23 months, so a large annual cycle
    // lands on unmatched endpoints and tilts a straight-line fit enough to
    // cancel the drift entirely. The background produce items carry the big
    // swings instead, where a weak fit is a fair thing to show.
    seasonality: { amplitude: 0.05, peakMonth: 9 },
    // Off-lead loads go to the two berry growers directly rather than landing
    // on the apple grower in the vendor list. No premium: same fruit, same
    // terms — this only keeps the vendor column honest.
    sourcing: [
      { vendorId: 'G2028', priceFactor: 1 },
      { vendorId: 'G2030', priceFactor: 1 },
    ],
  },
  {
    itemNumber: 'RAW-APL-HC',
    productName: 'Apples, Honeycrisp, bulk',
    unit: 'lb',
    currency: 'USD',
    currentCost: 0.75,
    sellingPrice: 1.05,
    itemGroupId: 'RM-Produce',
    costingMethod: 'Batch actual cost',
    kind: 'raw',
    netWeight: 1,
    basePurchasePrice: 0.58,
    chargeTags: ['all', 'stored'],
    receiving: [{ siteId: 'GRP', warehouseId: 'GRP-RM' }],
    priceDriftPerYear: 0.07,
    // Storage fruit gets dearer as the CA rooms empty ahead of the new crop.
    seasonality: { amplitude: 0.03, peakMonth: 8 },
    // Deliberately dual-sourced: Ridgeview books the cheap fruit on an 18-day
    // CA-room opening schedule and keeps the lead-vendor share; every other
    // load is a Van Dyke truck off the Fruit Ridge — in 5 days at roughly a 7%
    // premium. The premium surfaces in the vendor column, the variance flags
    // and the Copilot vendor-mix section; the lead times sit on the vendor
    // records.
    sourcing: [{ vendorId: 'G2014', priceFactor: 1.07 }],
  },
  {
    itemNumber: 'PK-BLU-PINT',
    productName: 'Blueberries pint clamshell',
    unit: 'cs',
    currency: 'USD',
    currentCost: 28.9,
    sellingPrice: 37.5,
    itemGroupId: 'FG-Packed',
    costingMethod: 'Batch actual cost',
    kind: 'finished',
    // Twelve 12 oz pints to a case.
    netWeight: 9.6,
    bom: { itemNumber: 'RAW-BLU', quantityPer: 9 },
    production: { siteId: 'HRT', warehouseId: 'HRT-FG' },
    conversion: [
      { code: 'PACK', description: 'Packaging — clamshells, label and case', perUnit: 1.4 },
      { code: 'LABOR', description: 'Direct labour — sort and pack line', perUnit: 1.3 },
      { code: 'OVHD', description: 'Production overhead', perUnit: 0.75 },
      { code: 'QA', description: 'Quality and food safety', perUnit: 0.18 },
    ],
  },
  {
    itemNumber: 'FC-APL-SLC-2OZ',
    productName: 'Apple Slices 2 oz snack cup',
    unit: 'cs',
    currency: 'USD',
    currentCost: 6.55,
    sellingPrice: 10.95,
    itemGroupId: 'FG-FreshCut',
    costingMethod: 'Batch actual cost',
    kind: 'finished',
    // Case of 24 x 2 oz cups; 4 lb of whole fruit per case after coring.
    netWeight: 3.4,
    bom: { itemNumber: 'RAW-APL-HC', quantityPer: 4 },
    production: { siteId: 'GRP', warehouseId: 'GRP-FG' },
    conversion: [
      { code: 'CUP', description: 'Cups and lids', perUnit: 1.15 },
      { code: 'LABEL', description: 'Labels and shipping cases', perUnit: 0.72 },
      { code: 'LABOR', description: 'Direct labour — wash, core, slice and fill', perUnit: 1.1 },
      { code: 'OVHD', description: 'Production overhead — slicing line', perUnit: 0.7 },
      { code: 'QA', description: 'Quality and food safety', perUnit: 0.12 },
    ],
  },
]

/**
 * Background items. None of these carry hand-authored rows and nothing in the
 * demo script points at them — they exist so the item lookup reads like a real
 * product master, the site and warehouse filters have somewhere else to point,
 * and a curious prospect who types a different item number gets a populated
 * grid instead of an empty one.
 *
 * They are generated from a SEPARATE PRNG stream (see `seedRows`), so adding to
 * or editing this list cannot move a single figure on the four focus items.
 */
export const FILLER_ITEMS: CatalogItem[] = [
  // --- Produce -------------------------------------------------------------
  {
    itemNumber: 'RAW-APL-GA',
    productName: 'Apples, Gala, bulk',
    unit: 'lb',
    currency: 'USD',
    currentCost: 0.46,
    sellingPrice: 0.68,
    itemGroupId: 'RM-Produce',
    costingMethod: 'Batch actual cost',
    kind: 'raw',
    netWeight: 1,
    basePurchasePrice: 0.38,
    chargeTags: ['all', 'stored'],
    receiving: [
      { siteId: 'GRP', warehouseId: 'GRP-RM' },
      { siteId: 'GRP', warehouseId: 'GRP-CS' },
    ],
    vendorIds: ['G2019', 'G2014', 'G2018'],
    priceDriftPerYear: 0.05,
    seasonality: { amplitude: 0.06, peakMonth: 7 },
  },
  {
    itemNumber: 'RAW-ROM',
    productName: 'Romaine, bulk',
    unit: 'lb',
    currency: 'USD',
    currentCost: 0.66,
    sellingPrice: 0.9,
    itemGroupId: 'RM-Produce',
    costingMethod: 'Batch actual cost',
    kind: 'raw',
    netWeight: 1,
    basePurchasePrice: 0.52,
    chargeTags: ['all', 'cold'],
    receiving: [
      { siteId: 'SAL', warehouseId: 'SAL-XD' },
      { siteId: 'GRP', warehouseId: 'GRP-RM' },
    ],
    vendorIds: ['G2026', 'G2027', 'G2001'],
    priceDriftPerYear: 0.08,
    seasonality: { amplitude: 0.22, peakMonth: 11 },
  },
  {
    itemNumber: 'RAW-CUC',
    productName: 'Cucumbers, bulk',
    unit: 'lb',
    currency: 'USD',
    currentCost: 0.41,
    sellingPrice: 0.6,
    itemGroupId: 'RM-Produce',
    costingMethod: 'Batch actual cost',
    kind: 'raw',
    netWeight: 1,
    basePurchasePrice: 0.34,
    chargeTags: ['all', 'cold', 'import'],
    receiving: [
      { siteId: 'GRP', warehouseId: 'GRP-RM' },
      { siteId: 'SAL', warehouseId: 'SAL-XD' },
    ],
    vendorIds: ['G2028', 'G2004', 'G2021'],
    priceDriftPerYear: 0.06,
    seasonality: { amplitude: 0.18, peakMonth: 1 },
  },
  {
    itemNumber: 'RAW-PEP',
    productName: 'Bell Peppers, bulk',
    unit: 'lb',
    currency: 'USD',
    currentCost: 0.98,
    sellingPrice: 1.4,
    itemGroupId: 'RM-Produce',
    costingMethod: 'Batch actual cost',
    kind: 'raw',
    netWeight: 1,
    basePurchasePrice: 0.82,
    chargeTags: ['all', 'cold', 'import'],
    receiving: [{ siteId: 'GRP', warehouseId: 'GRP-RM' }],
    vendorIds: ['G2029', 'G2010'],
    priceDriftPerYear: 0.07,
    seasonality: { amplitude: 0.16, peakMonth: 2 },
  },
  {
    itemNumber: 'RAW-ASP',
    productName: 'Asparagus, bulk',
    unit: 'lb',
    currency: 'USD',
    currentCost: 1.94,
    sellingPrice: 2.6,
    itemGroupId: 'RM-Produce',
    costingMethod: 'Batch actual cost',
    kind: 'raw',
    netWeight: 1,
    basePurchasePrice: 1.55,
    chargeTags: ['all', 'cold'],
    receiving: [
      { siteId: 'HRT', warehouseId: 'HRT-RM' },
      { siteId: 'GRP', warehouseId: 'GRP-RM' },
    ],
    vendorIds: ['G2005', 'G2007'],
    priceDriftPerYear: 0.06,
    seasonality: { amplitude: 0.2, peakMonth: 3 },
  },
  {
    itemNumber: 'RAW-SQB',
    productName: 'Butternut Squash, bulk',
    unit: 'lb',
    currency: 'USD',
    currentCost: 0.33,
    sellingPrice: 0.5,
    itemGroupId: 'RM-Produce',
    costingMethod: 'Batch actual cost',
    kind: 'raw',
    netWeight: 1,
    basePurchasePrice: 0.28,
    chargeTags: ['all', 'stored'],
    receiving: [{ siteId: 'GRP', warehouseId: 'GRP-CS' }],
    vendorIds: ['G2024', 'G2004'],
    priceDriftPerYear: 0.04,
    seasonality: { amplitude: 0.1, peakMonth: 6 },
  },
  // --- Ingredients ---------------------------------------------------------
  {
    itemNumber: 'ING-ASCORB',
    productName: 'Ascorbic/calcium anti-browning solution',
    unit: 'dr',
    currency: 'USD',
    currentCost: 488.0,
    sellingPrice: 650.0,
    itemGroupId: 'RM-Ingredient',
    costingMethod: 'Batch actual cost',
    kind: 'raw',
    netWeight: 480,
    basePurchasePrice: 395.0,
    chargeTags: ['all'],
    orderQty: [8, 40, 1],
    receiving: [{ siteId: 'GRP', warehouseId: 'GRP-DS' }],
    vendorIds: ['V3008'],
    priceDriftPerYear: 0.09,
  },
  {
    itemNumber: 'ING-DIP-RANCH',
    productName: 'Ranch dip 1 oz cup',
    unit: 'ea',
    currency: 'USD',
    currentCost: 0.21,
    sellingPrice: 0.29,
    itemGroupId: 'RM-Ingredient',
    costingMethod: 'Batch actual cost',
    kind: 'raw',
    netWeight: 0.07,
    basePurchasePrice: 0.18,
    chargeTags: ['all'],
    orderQty: [20_000, 120_000, 1_000],
    receiving: [{ siteId: 'GRP', warehouseId: 'GRP-RM' }],
    vendorIds: ['V3007'],
    priceDriftPerYear: 0.06,
  },
  {
    itemNumber: 'ING-CAESAR-KIT',
    productName: 'Caesar dressing + croutons kit',
    unit: 'ea',
    currency: 'USD',
    currentCost: 0.35,
    sellingPrice: 0.48,
    itemGroupId: 'RM-Ingredient',
    costingMethod: 'Batch actual cost',
    kind: 'raw',
    netWeight: 0.12,
    basePurchasePrice: 0.3,
    chargeTags: ['all'],
    orderQty: [10_000, 60_000, 500],
    receiving: [{ siteId: 'GRP', warehouseId: 'GRP-RM' }],
    vendorIds: ['V3007'],
    priceDriftPerYear: 0.05,
  },
  // --- Packaging -----------------------------------------------------------
  {
    itemNumber: 'PKG-CUP-2OZ',
    productName: '2 oz snack cup + lid',
    unit: 'ea',
    currency: 'USD',
    currentCost: 0.05,
    sellingPrice: 0.066,
    itemGroupId: 'PKG-Rigid',
    costingMethod: 'Weighted avg.',
    kind: 'packaging',
    netWeight: 0.01,
    basePurchasePrice: 0.041,
    chargeTags: ['all'],
    orderQty: [100_000, 480_000, 5_000],
    receiving: [
      { siteId: 'GRP', warehouseId: 'GRP-DS' },
      { siteId: 'HOL', warehouseId: 'HOL-STG' },
    ],
    vendorIds: ['V3001', 'V3002'],
    priceDriftPerYear: 0.1,
  },
  {
    itemNumber: 'PKG-CTN-RSC-24',
    productName: 'Corrugated RSC 24-ct case',
    unit: 'ea',
    currency: 'USD',
    currentCost: 0.68,
    sellingPrice: 0.95,
    itemGroupId: 'PKG-Fibre',
    costingMethod: 'Weighted avg.',
    kind: 'packaging',
    netWeight: 0.6,
    basePurchasePrice: 0.56,
    chargeTags: ['all'],
    orderQty: [8_000, 40_000, 500],
    receiving: [
      { siteId: 'GRP', warehouseId: 'GRP-DS' },
      { siteId: 'HOL', warehouseId: 'HOL-STG' },
      { siteId: 'HOL', warehouseId: 'HOL-CP' },
    ],
    vendorIds: ['V3003', 'V3001'],
    priceDriftPerYear: 0.06,
  },
  {
    itemNumber: 'PKG-LBL-CASE',
    productName: 'Case labels, roll of 4,000',
    unit: 'ea',
    currency: 'USD',
    currentCost: 17.1,
    sellingPrice: 24.0,
    itemGroupId: 'PKG-Label',
    costingMethod: 'Weighted avg.',
    kind: 'packaging',
    netWeight: 3.2,
    basePurchasePrice: 14.8,
    chargeTags: ['all'],
    orderQty: [200, 1_200, 25],
    receiving: [
      { siteId: 'GRP', warehouseId: 'GRP-DS' },
      { siteId: 'HRT', warehouseId: 'HRT-DS' },
    ],
    vendorIds: ['V3004'],
    priceDriftPerYear: 0.03,
  },
  {
    itemNumber: 'PKG-CLAM-PINT',
    productName: 'Pint clamshell PET',
    unit: 'ea',
    currency: 'USD',
    currentCost: 0.056,
    sellingPrice: 0.075,
    itemGroupId: 'PKG-Rigid',
    costingMethod: 'Weighted avg.',
    kind: 'packaging',
    netWeight: 0.03,
    basePurchasePrice: 0.046,
    chargeTags: ['all'],
    orderQty: [100_000, 500_000, 5_000],
    receiving: [
      { siteId: 'HRT', warehouseId: 'HRT-DS' },
      { siteId: 'HOL', warehouseId: 'HOL-CP' },
    ],
    vendorIds: ['V3002', 'V3001'],
    priceDriftPerYear: 0.07,
  },
  {
    itemNumber: 'PKG-CTN-RSC-12',
    productName: 'Corrugated RSC 12-ct case',
    unit: 'ea',
    currency: 'USD',
    currentCost: 0.6,
    sellingPrice: 0.86,
    itemGroupId: 'PKG-Fibre',
    costingMethod: 'Weighted avg.',
    kind: 'packaging',
    netWeight: 0.55,
    basePurchasePrice: 0.51,
    chargeTags: ['all'],
    orderQty: [8_000, 40_000, 500],
    receiving: [
      { siteId: 'HRT', warehouseId: 'HRT-DS' },
      { siteId: 'HOL', warehouseId: 'HOL-CP' },
    ],
    vendorIds: ['V3003', 'V3001'],
    priceDriftPerYear: 0.05,
  },
  {
    itemNumber: 'PKG-POUCH-3LB',
    productName: '3 lb apple pouch, printed',
    unit: 'ea',
    currency: 'USD',
    currentCost: 0.09,
    sellingPrice: 0.12,
    itemGroupId: 'PKG-Flexible',
    costingMethod: 'Weighted avg.',
    kind: 'packaging',
    netWeight: 0.02,
    basePurchasePrice: 0.075,
    chargeTags: ['all'],
    orderQty: [60_000, 300_000, 5_000],
    receiving: [{ siteId: 'HRT', warehouseId: 'HRT-DS' }],
    vendorIds: ['V3001', 'V3005'],
    priceDriftPerYear: 0.06,
  },
  {
    itemNumber: 'PKG-FILM-MAP',
    productName: 'MAP film roll 12in',
    unit: 'ea',
    currency: 'USD',
    currentCost: 194.0,
    sellingPrice: 255.0,
    itemGroupId: 'PKG-Flexible',
    costingMethod: 'Weighted avg.',
    kind: 'packaging',
    netWeight: 38,
    basePurchasePrice: 165.0,
    chargeTags: ['all'],
    orderQty: [20, 160, 5],
    receiving: [{ siteId: 'GRP', warehouseId: 'GRP-DS' }],
    vendorIds: ['V3005'],
    priceDriftPerYear: 0.08,
  },
  // --- Produced ------------------------------------------------------------
  {
    itemNumber: 'PK-APL-GA-3LB',
    productName: 'Gala Apples 3 lb pouch',
    unit: 'cs',
    currency: 'USD',
    currentCost: 19.3,
    sellingPrice: 26.5,
    itemGroupId: 'FG-Packed',
    costingMethod: 'Batch actual cost',
    kind: 'finished',
    netWeight: 37,
    // Twelve 3 lb pouches.
    bom: { itemNumber: 'RAW-APL-GA', quantityPer: 36 },
    production: { siteId: 'HRT', warehouseId: 'HRT-FG' },
    conversion: [
      { code: 'PACK', description: 'Pouches and shipping case', perUnit: 1.55 },
      { code: 'LABOR', description: 'Direct labour — apple pack line', perUnit: 1.2 },
      { code: 'OVHD', description: 'Production overhead', perUnit: 0.85 },
      { code: 'QA', description: 'Quality and food safety', perUnit: 0.1 },
    ],
  },
  {
    itemNumber: 'PK-ASP-1LB',
    productName: 'Asparagus 1 lb bunch',
    unit: 'cs',
    currency: 'USD',
    currentCost: 27.3,
    sellingPrice: 36.0,
    itemGroupId: 'FG-Packed',
    costingMethod: 'Batch actual cost',
    kind: 'finished',
    netWeight: 11.5,
    // Eleven 1 lb bunches, plus butt-end trim.
    bom: { itemNumber: 'RAW-ASP', quantityPer: 11.5 },
    production: { siteId: 'HRT', warehouseId: 'HRT-FG' },
    conversion: [
      { code: 'PACK', description: 'Bands, sleeves and shipping case', perUnit: 0.95 },
      { code: 'LABOR', description: 'Direct labour — trim, bunch and pack', perUnit: 2.1 },
      { code: 'OVHD', description: 'Production overhead', perUnit: 1.05 },
      { code: 'QA', description: 'Quality and food safety', perUnit: 0.15 },
    ],
  },
  {
    itemNumber: 'PK-CUC-SLC',
    productName: 'Slicer Cucumbers 24 ct',
    unit: 'cs',
    currency: 'USD',
    currentCost: 10.1,
    sellingPrice: 14.25,
    itemGroupId: 'FG-Packed',
    costingMethod: 'Batch actual cost',
    kind: 'finished',
    netWeight: 19.5,
    bom: { itemNumber: 'RAW-CUC', quantityPer: 19 },
    production: { siteId: 'GRP', warehouseId: 'GRP-FG' },
    conversion: [
      { code: 'PACK', description: 'Wax and shipping case', perUnit: 0.8 },
      { code: 'LABOR', description: 'Direct labour — grade and pack', perUnit: 0.95 },
      { code: 'OVHD', description: 'Production overhead', perUnit: 0.7 },
      { code: 'QA', description: 'Quality and food safety', perUnit: 0.08 },
    ],
  },
  {
    itemNumber: 'FC-SAL-ROM-CHOP',
    productName: 'Chopped Romaine 2 lb foodservice',
    unit: 'cs',
    currency: 'USD',
    currentCost: 14.8,
    sellingPrice: 22.5,
    itemGroupId: 'FG-FreshCut',
    costingMethod: 'Batch actual cost',
    kind: 'finished',
    netWeight: 12.5,
    // Six 2 lb bags, at an 80% core-and-trim yield.
    bom: { itemNumber: 'RAW-ROM', quantityPer: 15 },
    production: { siteId: 'GRP', warehouseId: 'GRP-FG' },
    conversion: [
      { code: 'PACK', description: 'MAP bags and shipping case', perUnit: 1.1 },
      { code: 'LABOR', description: 'Direct labour — core, chop, wash and bag', perUnit: 2.4 },
      { code: 'OVHD', description: 'Production overhead — salad line', perUnit: 1.6 },
      { code: 'QA', description: 'Quality and food safety', perUnit: 0.2 },
    ],
  },
  {
    itemNumber: 'FC-VEG-SQB-DICE',
    productName: 'Diced Butternut Squash 12 oz',
    unit: 'cs',
    currency: 'USD',
    currentCost: 8.7,
    sellingPrice: 14.4,
    itemGroupId: 'FG-FreshCut',
    costingMethod: 'Batch actual cost',
    kind: 'finished',
    netWeight: 6.4,
    // Eight 12 oz trays, at a two-thirds peel-and-seed yield.
    bom: { itemNumber: 'RAW-SQB', quantityPer: 9 },
    production: { siteId: 'GRP', warehouseId: 'GRP-FG' },
    conversion: [
      { code: 'PACK', description: 'Trays, film and shipping case', perUnit: 1.35 },
      { code: 'LABOR', description: 'Direct labour — peel, seed and dice', perUnit: 2.6 },
      { code: 'OVHD', description: 'Production overhead — dice line', perUnit: 1.7 },
      { code: 'QA', description: 'Quality and food safety', perUnit: 0.18 },
    ],
  },
  {
    itemNumber: 'FC-PEP-DICE-5LB',
    productName: 'Diced Peppers 5 lb foodservice',
    unit: 'cs',
    currency: 'USD',
    currentCost: 27.5,
    sellingPrice: 38.4,
    itemGroupId: 'FG-FreshCut',
    costingMethod: 'Batch actual cost',
    kind: 'finished',
    netWeight: 20.5,
    // Four 5 lb bags, after coring and seeding.
    bom: { itemNumber: 'RAW-PEP', quantityPer: 24 },
    production: { siteId: 'GRP', warehouseId: 'GRP-FG' },
    conversion: [
      { code: 'PACK', description: 'Bags and shipping case', perUnit: 0.95 },
      { code: 'LABOR', description: 'Direct labour — core, seed and dice', perUnit: 2.6 },
      { code: 'OVHD', description: 'Production overhead — dice line', perUnit: 1.75 },
      { code: 'QA', description: 'Quality and food safety', perUnit: 0.18 },
    ],
  },
]

/** The full product master, focus items first. */
export const ITEMS: CatalogItem[] = [...FOCUS_ITEMS, ...FILLER_ITEMS]

/**
 * V3014 Ridgeview Produce Exchange is the lead marketer for both focus raw
 * materials and carries every anchor receipt; the growers exist so the vendor
 * column varies and the purchase-order lookup returns more than one name.
 * Grower accounts and names are Bluestem's own (growers.csv in the data pack).
 *
 * `leadTimeDays` is the vendor's quoted order-to-dock lead time. RAW-APL-HC is
 * the item that makes it interesting: Ridgeview is cheapest but books fruit on
 * an 18-day CA-room schedule, Van Dyke charges ~7% more and delivers in 5 —
 * see the `sourcing` mix on the RAW-APL-HC catalogue entry.
 *
 * Order matters: the lead vendor is first, and the focus pass draws a vendor
 * by index into this list, so it must keep four entries.
 */
export const VENDORS = [
  { id: 'V3014', name: 'Ridgeview Produce Exchange', leadTimeDays: 18 },
  { id: 'G2028', name: 'Baja Fresca S.A.', leadTimeDays: 12 },
  { id: 'G2014', name: 'Van Dyke Vegetable Co.', leadTimeDays: 5 },
  { id: 'G2030', name: 'Central Coast Berry Co.', leadTimeDays: 9 },
]

/** Suppliers and growers used only by the background items. */
export const FILLER_VENDORS = [
  { id: 'V3001', name: 'Great Lakes Packaging Corp', leadTimeDays: 5 },
  { id: 'V3002', name: 'ClearPak Clamshells Inc.', leadTimeDays: 10 },
  { id: 'V3003', name: 'Wolverine Corrugated', leadTimeDays: 10 },
  { id: 'V3004', name: 'LabelWorks Midwest', leadTimeDays: 10 },
  { id: 'V3005', name: 'FreshSeal Films', leadTimeDays: 14 },
  { id: 'V3007', name: 'Prairie Foods Ingredients', leadTimeDays: 21 },
  { id: 'V3008', name: 'NatureSafe Processing Aids', leadTimeDays: 14 },
  { id: 'G2001', name: 'Vander Molen Farms', leadTimeDays: 3 },
  { id: 'G2004', name: 'Hillcrest Family Farms', leadTimeDays: 3 },
  { id: 'G2005', name: 'DeBoer Asparagus Co.', leadTimeDays: 2 },
  { id: 'G2007', name: 'Sunny Ridge Growers', leadTimeDays: 3 },
  { id: 'G2010', name: 'Oceana Fresh Farms', leadTimeDays: 3 },
  { id: 'G2018', name: 'Pine Grove Produce', leadTimeDays: 6 },
  { id: 'G2019', name: 'North Branch Farms', leadTimeDays: 4 },
  { id: 'G2021', name: 'Evergreen Valley Growers', leadTimeDays: 3 },
  { id: 'G2024', name: 'Stone Barn Vegetables', leadTimeDays: 4 },
  { id: 'G2026', name: 'Salinas Valley Greens', leadTimeDays: 6 },
  { id: 'G2027', name: 'Yuma Sun Farms', leadTimeDays: 5 },
  { id: 'G2029', name: 'Sinaloa Verde Produce', leadTimeDays: 9 },
]

const ALL_VENDORS = [...VENDORS, ...FILLER_VENDORS]

function vendorById(id: string): { id: string; name: string } {
  return ALL_VENDORS.find((v) => v.id === id)!
}

/** Bluestem's four sites (sites.csv in the data pack). */
export const SITES = [
  { id: 'GRP', name: 'Grand Rapids Fresh-Cut Plant' },
  { id: 'HRT', name: 'Hart Packing House' },
  { id: 'HOL', name: 'Holland Distribution Center' },
  { id: 'SAL', name: 'Salinas Consolidation Hub' },
]

export const WAREHOUSES = [
  { id: 'GRP-RM', siteId: 'GRP', name: 'Raw receiving cooler' },
  { id: 'GRP-CS', siteId: 'GRP', name: 'CA storage' },
  { id: 'GRP-DS', siteId: 'GRP', name: 'Dry and packaging stores' },
  { id: 'GRP-FG', siteId: 'GRP', name: 'Finished goods cooler' },
  { id: 'HRT-RM', siteId: 'HRT', name: 'Raw receiving cooler' },
  { id: 'HRT-DS', siteId: 'HRT', name: 'Dry and packaging stores' },
  { id: 'HRT-FG', siteId: 'HRT', name: 'Finished goods cooler' },
  { id: 'HOL-FG', siteId: 'HOL', name: 'DC finished goods' },
  { id: 'HOL-STG', siteId: 'HOL', name: 'DC staging' },
  { id: 'HOL-CP', siteId: 'HOL', name: 'Co-pack cooler' },
  { id: 'SAL-XD', siteId: 'SAL', name: 'Cross-dock cooler' },
]

/**
 * Where the contract packer in the Holland DC reports finished goods. About a
 * fifth of produced volume runs there rather than in house.
 */
const COPACK = { siteId: 'HOL', warehouseId: 'HOL-CP' }

/** Receiving point for an item with none configured. */
const DEFAULT_RECEIVING = { siteId: 'GRP', warehouseId: 'GRP-RM' }

export const LOCATIONS = [
  'RECV-01',
  'COLD-01',
  'COLD-02',
  'DRY-01',
  'DRY-02',
  'PKG-01',
  'FG-01',
]

/** Where an inbound item is put away — produce cold, packaging by itself, rest dry. */
function receivingLocations(item: CatalogItem): string[] {
  if (item.itemGroupId === 'RM-Produce') return ['COLD-01', 'COLD-02', 'RECV-01']
  if (item.kind === 'packaging') return ['PKG-01', 'DRY-02', 'RECV-01']
  return ['DRY-01', 'DRY-02', 'RECV-01']
}

/** Default purchase order line size, in the item's own unit. */
const DEFAULT_ORDER_QTY: [number, number, number] = [14_000, 60_000, 500]

interface ChargeSpec {
  code: string
  description: string
  allocationMethod: AllocationMethod
  /** Roughly what fraction of goods value this charge tends to be. */
  rate: number
  /** Only applied to orders where every line's item carries this tag. */
  tag: string
}

const CHARGE_CATALOG: ChargeSpec[] = [
  { code: 'FREIGHT', description: 'Inbound reefer freight', allocationMethod: 'Net weight', rate: 0.115, tag: 'all' },
  { code: 'FUEL', description: 'Fuel surcharge', allocationMethod: 'Net weight', rate: 0.022, tag: 'all' },
  { code: 'PALLET', description: 'CHEP pallets and dunnage', allocationMethod: 'Quantity', rate: 0.012, tag: 'all' },
  { code: 'INSPECT', description: 'USDA inspection and grading', allocationMethod: 'Equally', rate: 0.008, tag: 'all' },
  { code: 'DEMUR', description: 'Detention and demurrage', allocationMethod: 'Equally', rate: 0.014, tag: 'all' },
  { code: 'PRECOOL', description: 'Forced-air pre-cooling and cold chain', allocationMethod: 'Quantity', rate: 0.03, tag: 'cold' },
  { code: 'BROKER', description: 'Customs brokerage', allocationMethod: 'Equally', rate: 0.01, tag: 'import' },
  { code: 'CUSTOMS', description: 'Border crossing and customs fees', allocationMethod: 'Net amount', rate: 0.028, tag: 'import' },
  { code: 'CASTOR', description: 'CA storage and handling', allocationMethod: 'Net weight', rate: 0.016, tag: 'stored' },
]

const chargeSpec = (code: string): ChargeSpec =>
  CHARGE_CATALOG.find((c) => c.code === code)!

/**
 * Freight, fuel and port charges have climbed faster than the goods they carry.
 * This is why landed cost trends up more steeply than the purchase price does —
 * the widening gap between the two lines on the trend chart is the argument the
 * whole app is making, so it has to actually be in the data.
 */
const CHARGE_INFLATION_PER_YEAR = 0.11

// ---------------------------------------------------------------------------
// Deterministic PRNG (mulberry32)
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const round = (value: number, dp = 2): number => {
  const f = 10 ** dp
  return Math.round(value * f) / f
}

/**
 * Food-industry lot code: item, two-digit year, day of year, then a letter for
 * the nth lot of that item on that day. Reading `RAW-BLU-26061A` off the grid tells
 * a plant operator exactly which delivery it was.
 *
 * `reserved` primes the per-day counters with the hand-authored anchor batches,
 * so a generated receipt landing on an anchor's date issues `…B` instead of
 * colliding. Two receipts sharing a lot code would make the consumed-batch trace
 * on the production rows ambiguous.
 */
function lotStem(itemNumber: string, iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  const dayOfYear =
    Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / 86_400_000) + 1
  return `${itemNumber}-${String(y).slice(2)}${String(dayOfYear).padStart(3, '0')}`
}

/**
 * The nth lot code an item would be issued on a date, without consuming a
 * counter. The relative-dated inbound anchors need to name their own batches
 * before the issuer has run, and they reserve those codes so the issuer cannot
 * hand the same one out twice.
 */
export function lotCode(itemNumber: string, iso: string, nth = 0): string {
  return `${lotStem(itemNumber, iso)}${String.fromCharCode(65 + Math.min(nth, 25))}`
}

function lotIssuer(
  reserved: string[] = [],
): (itemNumber: string, iso: string) => string {
  const seen = new Map<string, number>()

  for (const code of reserved) {
    const stem = code.slice(0, -1)
    const nth = code.charCodeAt(code.length - 1) - 65
    seen.set(stem, Math.max(seen.get(stem) ?? 0, nth + 1))
  }

  return (itemNumber, iso) => {
    const stem = lotStem(itemNumber, iso)
    const n = seen.get(stem) ?? 0
    seen.set(stem, n + 1)
    return `${stem}${String.fromCharCode(65 + Math.min(n, 25))}`
  }
}

// ---------------------------------------------------------------------------
// Anchor rows — the numbers the demo script quotes
// ---------------------------------------------------------------------------

/**
 * Five purchase receipts from V3014 Ridgeview Produce Exchange — the
 * blueberries into Hart (HRT / HRT-RM), the Honeycrisp into Grand Rapids
 * (GRP / GRP-RM). Extended charge amounts are chosen so the per-unit add-on
 * cost lands on a round figure: RAW-BLU at $0.42, $0.31 and $0.55; RAW-APL-HC
 * at $0.14 and $0.19.
 */
const PURCHASE_ANCHORS: {
  item: string
  po: string
  receipt: string
  date: string
  batch: string
  location: string
  qty: number
  fob: number
  charges: [string, number][]
}[] = [
  {
    item: 'RAW-BLU',
    po: 'PO-000241',
    receipt: 'PR-104812',
    date: '2026-03-02',
    batch: 'RAW-BLU-26061A',
    location: 'COLD-01',
    qty: 42_000,
    fob: 2.35,
    // 11,340 + 3,360 + 1,260 + 1,680 = 17,640 over 42,000 lb -> 0.42/lb
    charges: [
      ['FREIGHT', 11_340.0],
      ['PRECOOL', 3_360.0],
      ['BROKER', 1_260.0],
      ['CUSTOMS', 1_680.0],
    ],
  },
  {
    item: 'RAW-BLU',
    po: 'PO-000258',
    receipt: 'PR-105196',
    date: '2026-04-13',
    batch: 'RAW-BLU-26103A',
    location: 'COLD-02',
    qty: 38_000,
    fob: 2.35,
    // 7,600 + 2,280 + 950 + 950 = 11,780 over 38,000 lb -> 0.31/lb
    charges: [
      ['FREIGHT', 7_600.0],
      ['PRECOOL', 2_280.0],
      ['BROKER', 950.0],
      ['CUSTOMS', 950.0],
    ],
  },
  {
    item: 'RAW-BLU',
    po: 'PO-000273',
    receipt: 'PR-105644',
    date: '2026-05-18',
    batch: 'RAW-BLU-26138A',
    location: 'COLD-01',
    qty: 40_000,
    fob: 2.35,
    // The load held at the Otay Mesa crossing: demurrage alone adds $0.06/lb.
    // 14,000 + 3,200 + 1,200 + 2,400 + 1,200 = 22,000 over 40,000 lb -> 0.55/lb
    charges: [
      ['FREIGHT', 14_000.0],
      ['PRECOOL', 3_200.0],
      ['BROKER', 1_200.0],
      ['DEMUR', 2_400.0],
      ['CUSTOMS', 1_200.0],
    ],
  },
  {
    item: 'RAW-APL-HC',
    po: 'PO-000249',
    receipt: 'PR-104980',
    date: '2026-03-24',
    batch: 'RAW-APL-HC-26083A',
    location: 'COLD-02',
    qty: 44_000,
    fob: 0.58,
    // 4,400 + 880 + 880 = 6,160 over 44,000 lb -> 0.14/lb
    charges: [
      ['FREIGHT', 4_400.0],
      ['CASTOR', 880.0],
      ['PALLET', 880.0],
    ],
  },
  {
    item: 'RAW-APL-HC',
    po: 'PO-000269',
    receipt: 'PR-105432',
    date: '2026-05-05',
    batch: 'RAW-APL-HC-26125A',
    location: 'COLD-01',
    qty: 40_000,
    fob: 0.58,
    // 5,600 + 800 + 800 + 400 = 7,600 over 40,000 lb -> 0.19/lb
    charges: [
      ['FREIGHT', 5_600.0],
      ['CASTOR', 800.0],
      ['PALLET', 800.0],
      ['DEMUR', 400.0],
    ],
  },
]

/**
 * Five production receipts. `material` is the BOM quantity multiplied by the
 * actual landed cost of `sourceBatch` — so a case of PK-BLU-PINT costs $28.56,
 * $27.48 and $29.86 across three otherwise similar runs, mostly because the
 * 9 lb of blueberries behind each case landed at $2.77, $2.66 and $2.90.
 */
const PRODUCTION_ANCHORS: {
  item: string
  order: string
  journal: string
  date: string
  batch: string
  sourceItem: string
  sourceBatch: string
  siteId: string
  warehouseId: string
  qty: number
  material: number
  conversion: [string, number][]
}[] = [
  {
    item: 'PK-BLU-PINT',
    order: 'P000318',
    journal: 'PJ-000318',
    date: '2026-03-09',
    batch: 'PK-BLU-PINT-26068A',
    sourceItem: 'RAW-BLU',
    sourceBatch: 'RAW-BLU-26061A',
    siteId: 'HRT',
    warehouseId: 'HRT-FG',
    qty: 3_400,
    material: 24.93, // 9 lb x $2.77
    conversion: [
      ['PACK', 1.4],
      ['LABOR', 1.3],
      ['OVHD', 0.75],
      ['QA', 0.18],
    ],
  },
  {
    item: 'PK-BLU-PINT',
    order: 'P000341',
    journal: 'PJ-000341',
    date: '2026-04-20',
    batch: 'PK-BLU-PINT-26110A',
    sourceItem: 'RAW-BLU',
    sourceBatch: 'RAW-BLU-26103A',
    siteId: 'HRT',
    warehouseId: 'HRT-FG',
    qty: 3_100,
    material: 23.94, // 9 lb x $2.66
    conversion: [
      ['PACK', 1.4],
      ['LABOR', 1.24],
      ['OVHD', 0.72],
      ['QA', 0.18],
    ],
  },
  {
    // Packed by the contract packer in the Holland DC.
    item: 'PK-BLU-PINT',
    order: 'P000369',
    journal: 'PJ-000369',
    date: '2026-05-26',
    batch: 'PK-BLU-PINT-26146A',
    sourceItem: 'RAW-BLU',
    sourceBatch: 'RAW-BLU-26138A',
    siteId: 'HOL',
    warehouseId: 'HOL-CP',
    qty: 3_300,
    material: 26.1, // 9 lb x $2.90
    conversion: [
      ['PACK', 1.44],
      ['LABOR', 1.36],
      ['OVHD', 0.78],
      ['QA', 0.18],
    ],
  },
  {
    item: 'FC-APL-SLC-2OZ',
    order: 'P000327',
    journal: 'PJ-000327',
    date: '2026-03-31',
    batch: 'FC-APL-SLC-2OZ-26090A',
    sourceItem: 'RAW-APL-HC',
    sourceBatch: 'RAW-APL-HC-26083A',
    siteId: 'GRP',
    warehouseId: 'GRP-FG',
    qty: 8_400,
    material: 2.88, // 4 lb x $0.72
    conversion: [
      ['CUP', 1.15],
      ['LABEL', 0.72],
      ['LABOR', 1.1],
      ['OVHD', 0.7],
      ['QA', 0.12],
    ],
  },
  {
    item: 'FC-APL-SLC-2OZ',
    order: 'P000358',
    journal: 'PJ-000358',
    date: '2026-05-12',
    batch: 'FC-APL-SLC-2OZ-26132A',
    sourceItem: 'RAW-APL-HC',
    sourceBatch: 'RAW-APL-HC-26125A',
    siteId: 'GRP',
    warehouseId: 'GRP-FG',
    qty: 7_800,
    material: 3.08, // 4 lb x $0.77
    conversion: [
      ['CUP', 1.18],
      ['LABEL', 0.72],
      ['LABOR', 1.14],
      ['OVHD', 0.72],
      ['QA', 0.12],
    ],
  },
]

function buildPurchaseAnchors(): ReceiptRow[] {
  return PURCHASE_ANCHORS.map((a) => {
    const item = itemByNumber(a.item)!
    const charges: ChargeLine[] = a.charges.map(([code, amount]) => {
      const spec = chargeSpec(code)
      return {
        chargeCode: spec.code,
        description: spec.description,
        chargeType: 'Financial',
        source: 'Header',
        allocationMethod: spec.allocationMethod,
        amount,
        amountPerUnit: amount / a.qty,
      }
    })

    return costRow({
      sourceType: 'Purchase',
      purchaseOrderNumber: a.po,
      purchaseLineNumber: 1,
      receiptNumber: a.receipt,
      receiptDate: a.date,
      itemNumber: item.itemNumber,
      productName: item.productName,
      vendorAccount: VENDORS[0].id,
      vendorName: VENDORS[0].name,
      siteId: item.receiving![0].siteId,
      warehouseId: item.receiving![0].warehouseId,
      locationId: a.location,
      batchNumber: a.batch,
      quantityReceived: a.qty,
      unit: item.unit,
      currency: item.currency,
      purchasePriceFob: a.fob,
      sellingPrice: item.sellingPrice,
      charges,
    })
  })
}

// ---------------------------------------------------------------------------
// Recent inbound anchors — the stock that is actually sitting there today
// ---------------------------------------------------------------------------

/**
 * Seven receipts dated relative to TODAY, which exist so the production cost
 * inquiry has live inventory to plan against.
 *
 * The generated receipts are spread over a 24-month window, so at any moment
 * roughly one of them falls inside a 21-day blueberry shelf life — not enough to
 * plan a week of production from. These are hand-authored instead, staggered
 * across the expiry window so the plan has a genuine FEFO ordering to work out,
 * and priced on the same upward trend the generated receipts follow so they do
 * not distort the cost trend chart.
 *
 * `daysAgo` drives both the receipt date and, via the item's shelf life, the
 * expiry date. RAW-BLU's first lot is deliberately sized so that it CANNOT be
 * consumed before it expires on the default two committed lines — enabling the
 * co-packer in the parameters is what clears it. That is the demo.
 *
 * Charges are given per unit and extended by the generator, because these were
 * authored to land on a chosen cost rather than the other way round.
 */
const INBOUND_ANCHORS: {
  item: string
  daysAgo: number
  location: string
  qty: number
  fob: number
  /** Per unit; the sum is the add-on cost per unit. */
  charges: [string, number][]
  /** Physical quantity still on hand today. */
  onHand: number
}[] = [
  // --- RAW-BLU Blueberries, 21-day shelf life --------------------------------
  {
    item: 'RAW-BLU',
    daysAgo: 20,
    location: 'COLD-01',
    qty: 62_000,
    fob: 2.42, // + 0.39 = 2.81 landed
    charges: [
      ['FREIGHT', 0.25],
      ['PRECOOL', 0.07],
      ['BROKER', 0.025],
      ['CUSTOMS', 0.045],
    ],
    onHand: 62_000,
  },
  {
    item: 'RAW-BLU',
    daysAgo: 14,
    location: 'COLD-01',
    qty: 38_000,
    fob: 2.4, // + 0.34 = 2.74 landed
    charges: [
      ['FREIGHT', 0.215],
      ['PRECOOL', 0.06],
      ['BROKER', 0.022],
      ['CUSTOMS', 0.043],
    ],
    onHand: 38_000,
  },
  {
    item: 'RAW-BLU',
    daysAgo: 9,
    location: 'COLD-02',
    qty: 44_000,
    fob: 2.48, // + 0.45 = 2.93 landed
    charges: [
      ['FREIGHT', 0.29],
      ['PRECOOL', 0.078],
      ['BROKER', 0.037],
      ['CUSTOMS', 0.045],
    ],
    onHand: 44_000,
  },
  {
    item: 'RAW-BLU',
    daysAgo: 4,
    location: 'COLD-02',
    qty: 34_000,
    fob: 2.38, // + 0.30 = 2.68 landed
    charges: [
      ['FREIGHT', 0.19],
      ['PRECOOL', 0.055],
      ['BROKER', 0.017],
      ['CUSTOMS', 0.038],
    ],
    onHand: 34_000,
  },
  {
    item: 'RAW-BLU',
    daysAgo: 1,
    location: 'COLD-01',
    qty: 40_000,
    fob: 2.45, // + 0.40 = 2.85 landed
    charges: [
      ['FREIGHT', 0.255],
      ['PRECOOL', 0.072],
      ['BROKER', 0.028],
      ['CUSTOMS', 0.045],
    ],
    onHand: 40_000,
  },
  // --- RAW-APL-HC Honeycrisp, 120 days out of CA storage ---------------------
  // Nothing here is close to expiring; the contrast with the blueberries is
  // the point. Storage apples are constrained by how much you have, berries by
  // how long you have to use them.
  {
    item: 'RAW-APL-HC',
    daysAgo: 40,
    location: 'COLD-02',
    qty: 96_000,
    fob: 0.66, // + 0.13 = 0.79 landed
    charges: [
      ['FREIGHT', 0.085],
      ['CASTOR', 0.021],
      ['PALLET', 0.012],
      ['INSPECT', 0.012],
    ],
    onHand: 74_000,
  },
  {
    item: 'RAW-APL-HC',
    daysAgo: 12,
    location: 'COLD-01',
    qty: 120_000,
    fob: 0.68, // + 0.14 = 0.82 landed
    charges: [
      ['FREIGHT', 0.092],
      ['CASTOR', 0.022],
      ['PALLET', 0.013],
      ['INSPECT', 0.013],
    ],
    onHand: 120_000,
  },
]

/** Batch number an inbound anchor takes, given today's date. */
function inboundBatch(a: (typeof INBOUND_ANCHORS)[number], today: string): string {
  return lotCode(a.item, addDaysIso(today, -a.daysAgo))
}

function buildInboundAnchors(today: string): ReceiptRow[] {
  return INBOUND_ANCHORS.map((a, i) => {
    const item = itemByNumber(a.item)!
    const receiptDate = addDaysIso(today, -a.daysAgo)

    const charges: ChargeLine[] = a.charges.map(([code, perUnit]) => {
      const spec = chargeSpec(code)
      return {
        chargeCode: spec.code,
        description: spec.description,
        chargeType: 'Financial',
        source: 'Header',
        allocationMethod: spec.allocationMethod,
        amount: round(perUnit * a.qty),
        amountPerUnit: perUnit,
      }
    })

    return costRow({
      sourceType: 'Purchase',
      // Numbered off a range of their own so they cannot collide with either
      // generated pass, and ordered oldest-first so the ids climb.
      purchaseOrderNumber: `PO-000${900 + i * 3}`,
      purchaseLineNumber: 1,
      receiptNumber: `PR-1099${String(10 + i * 4).padStart(2, '0')}`,
      receiptDate,
      itemNumber: item.itemNumber,
      productName: item.productName,
      vendorAccount: VENDORS[0].id,
      vendorName: VENDORS[0].name,
      siteId: item.receiving![0].siteId,
      warehouseId: item.receiving![0].warehouseId,
      locationId: a.location,
      batchNumber: inboundBatch(a, today),
      quantityReceived: a.qty,
      unit: item.unit,
      currency: item.currency,
      purchasePriceFob: a.fob,
      sellingPrice: item.sellingPrice,
      charges,
    })
  })
}

/**
 * Physical on-hand for the hand-authored inbound lots, keyed by batch number.
 * Stated rather than derived: these lots carry the production plan, and a demo
 * that quotes "62,000 lb expiring tomorrow" needs that to be 62,000 lb every
 * time it is run. Every other batch is depleted by the turnover model in
 * data/productionSeed.ts instead.
 */
export function explicitOnHand(): Map<string, number> {
  const today = todayIso()
  return new Map(
    INBOUND_ANCHORS.map((a) => [inboundBatch(a, today), a.onHand]),
  )
}

// ---------------------------------------------------------------------------
// Expected receipts — open purchase orders not yet received
// ---------------------------------------------------------------------------

/**
 * Open PO lines for the two focus raw materials, dated relative to TODAY so
 * the pipeline always stretches into the future. Vendor-confirmed FOB prices
 * on the same gentle upward drift as the posted receipts; charges are per-unit
 * ESTIMATES (accruals), because nothing has been invoiced yet.
 *
 * These are deliberately NOT part of seedRows(): an expected receipt is not a
 * posted one, and folding them in would move the summary averages, the trend
 * fit and the variance baseline that the demo script quotes. They surface only
 * through `expectedRows()` and the provider's `expected` result field, and
 * they are the supply side the impact analysis simulates against.
 *
 * PO numbers sit in the 920–949 range: above the inbound anchors (900–918),
 * below both generated ranges.
 */
const EXPECTED_ORDERS: {
  item: string
  po: string
  /** Vendor account. Defaults to the lead marketer V3014 Ridgeview Produce Exchange. */
  vendorId?: string
  /** Confirmed delivery, days after today. */
  daysOut: number
  qty: number
  fob: number
  /** Per unit, estimated. */
  charges: [string, number][]
}[] = [
  // --- RAW-BLU Blueberries: one load roughly every six days ------------------
  {
    item: 'RAW-BLU',
    po: 'PO-000920',
    daysOut: 5,
    qty: 40_000,
    fob: 2.44,
    charges: [
      ['FREIGHT', 0.25],
      ['PRECOOL', 0.07],
      ['BROKER', 0.026],
      ['CUSTOMS', 0.044],
    ],
  },
  {
    item: 'RAW-BLU',
    po: 'PO-000926',
    daysOut: 11,
    qty: 44_000,
    fob: 2.47,
    charges: [
      ['FREIGHT', 0.26],
      ['PRECOOL', 0.072],
      ['BROKER', 0.026],
      ['CUSTOMS', 0.045],
    ],
  },
  {
    item: 'RAW-BLU',
    po: 'PO-000931',
    daysOut: 17,
    qty: 42_000,
    fob: 2.46,
    charges: [
      ['FREIGHT', 0.265],
      ['PRECOOL', 0.073],
      ['BROKER', 0.027],
      ['CUSTOMS', 0.045],
    ],
  },
  {
    item: 'RAW-BLU',
    po: 'PO-000938',
    daysOut: 24,
    qty: 46_000,
    fob: 2.5,
    charges: [
      ['FREIGHT', 0.27],
      ['PRECOOL', 0.074],
      ['BROKER', 0.027],
      ['CUSTOMS', 0.046],
    ],
  },
  // --- RAW-APL-HC Honeycrisp: two CA-room loads and one spot top-up ----------
  // PO-000946 is the dual-sourcing story in one row: Van Dyke delivers in
  // 4 days at a fob ~7% over the Ridgeview loads either side of it. Same
  // apples, different pipeline — the premium is the price of speed.
  {
    item: 'RAW-APL-HC',
    po: 'PO-000946',
    vendorId: 'G2014',
    daysOut: 4,
    qty: 60_000,
    fob: 0.74,
    charges: [
      ['FREIGHT', 0.085],
      ['CASTOR', 0.021],
      ['PALLET', 0.013],
      ['INSPECT', 0.012],
    ],
  },
  {
    item: 'RAW-APL-HC',
    po: 'PO-000944',
    daysOut: 9,
    qty: 100_000,
    fob: 0.67,
    charges: [
      ['FREIGHT', 0.09],
      ['CASTOR', 0.022],
      ['PALLET', 0.013],
      ['INSPECT', 0.012],
    ],
  },
  {
    item: 'RAW-APL-HC',
    po: 'PO-000949',
    daysOut: 21,
    qty: 120_000,
    fob: 0.69,
    charges: [
      ['FREIGHT', 0.092],
      ['CASTOR', 0.022],
      ['PALLET', 0.013],
      ['INSPECT', 0.013],
    ],
  },
]

let expectedCache: { asOf: string; rows: ReceiptRow[] } | null = null

/**
 * Open PO lines as receipt-shaped rows, soonest delivery first. No receipt
 * number and no batch — neither exists until the goods arrive.
 */
export function expectedRows(today: string = todayIso()): ReceiptRow[] {
  if (expectedCache?.asOf === today) return expectedCache.rows

  const rows = EXPECTED_ORDERS.map((e) => {
    const item = itemByNumber(e.item)!
    const vendor = VENDORS.find((v) => v.id === e.vendorId) ?? VENDORS[0]
    const charges: ChargeLine[] = e.charges.map(([code, perUnit]) => {
      const spec = chargeSpec(code)
      return {
        chargeCode: spec.code,
        description: `${spec.description} (estimated)`,
        chargeType: 'Financial' as const,
        source: 'Header' as const,
        allocationMethod: spec.allocationMethod,
        amount: round(perUnit * e.qty),
        amountPerUnit: perUnit,
      }
    })

    return costRow({
      id: `${e.po}|expected|1`,
      sourceType: 'Purchase',
      receiptStatus: 'Expected',
      purchaseOrderNumber: e.po,
      purchaseLineNumber: 1,
      receiptNumber: '',
      receiptDate: addDaysIso(today, e.daysOut),
      itemNumber: item.itemNumber,
      productName: item.productName,
      vendorAccount: vendor.id,
      vendorName: vendor.name,
      siteId: item.receiving![0].siteId,
      warehouseId: item.receiving![0].warehouseId,
      quantityReceived: e.qty,
      unit: item.unit,
      currency: item.currency,
      purchasePriceFob: e.fob,
      sellingPrice: item.sellingPrice,
      charges,
    })
  }).sort((a, b) => (a.receiptDate < b.receiptDate ? -1 : 1))

  expectedCache = { asOf: today, rows }
  return rows
}

function buildProductionAnchors(): ReceiptRow[] {
  return PRODUCTION_ANCHORS.map((a) => {
    const item = itemByNumber(a.item)!
    const charges: ChargeLine[] = a.conversion.map(([code, perUnit]) => {
      const spec = item.conversion!.find((c) => c.code === code)!
      return {
        chargeCode: spec.code,
        description: spec.description,
        chargeType: 'Conversion',
        source: 'Line',
        amount: round(perUnit * a.qty),
        amountPerUnit: perUnit,
      }
    })

    return costRow({
      sourceType: 'Production',
      purchaseOrderNumber: a.order,
      purchaseLineNumber: 1,
      receiptNumber: a.journal,
      receiptDate: a.date,
      itemNumber: item.itemNumber,
      productName: item.productName,
      vendorAccount: '',
      vendorName: '',
      siteId: a.siteId,
      warehouseId: a.warehouseId,
      locationId: 'FG-01',
      batchNumber: a.batch,
      sourceItemNumber: a.sourceItem,
      sourceBatchNumber: a.sourceBatch,
      quantityReceived: a.qty,
      unit: item.unit,
      currency: item.currency,
      purchasePriceFob: a.material,
      sellingPrice: item.sellingPrice,
      charges,
    })
  })
}

// ---------------------------------------------------------------------------
// Procedural generation — purchase orders
// ---------------------------------------------------------------------------

interface DraftLine {
  item: CatalogItem
  quantity: number
  price: number
  netAmount: number
  netWeight: number
}

/**
 * Builds one purchase order and emits a receipt row per line.
 *
 * A load usually carries two lots of the same commodity and occasionally mixes
 * both raw materials on one consolidated reefer, because Ridgeview markets
 * berries and apples alike. Header charges are allocated across ALL lines of the order, which is
 * what makes the per-unit add-on cost move between receipts of the same item at
 * the same FOB price — a second, larger lot on the order dilutes the first one's
 * share.
 */
function buildPurchaseOrder(
  rnd: () => number,
  lot: (itemNumber: string, iso: string) => string,
  poNumber: string,
  receiptNumber: string,
  receiptDate: string,
  primary: CatalogItem,
  /** Where a second item on the order may come from, and which vendors supply it. */
  pool: CatalogItem[],
  vendors: { id: string; name: string }[],
  /** Years elapsed since the start of the seeded window — drives price drift. */
  years: number,
): ReceiptRow[] {
  // The lead vendor carries most of the volume.
  const drawnIndex =
    rnd() < 0.68 ? 0 : 1 + Math.floor(rnd() * (vendors.length - 1))
  // A background item with its own supplier list takes the draw by index, so
  // the packaging comes from a packaging supplier — a remap, not a new draw.
  const drawn = primary.vendorIds
    ? vendorById(primary.vendorIds[drawnIndex % primary.vendorIds.length])
    : vendors[drawnIndex]

  // An item with a sourcing mix funnels its non-lead volume to the mix's named
  // alternates instead of scattering it across the whole vendor list — every
  // non-Ridgeview load of RAW-APL-HC is a Van Dyke truck, not whichever grower
  // the draw happened to land on. The funnelling is a pure remap: it consumes
  // no PRNG draws and changes no dates, quantities or draw-derived prices, so
  // no other item's generated figures move (verify.mjs holds either way).
  let vendor = drawn
  if (primary.sourcing?.length && drawn.id !== vendors[0].id) {
    const alt =
      primary.sourcing.find((s) => s.vendorId === drawn.id) ?? primary.sourcing[0]
    vendor = vendors.find((v) => v.id === alt.vendorId) ?? drawn
  }

  const month = Number(receiptDate.slice(5, 7))

  const mkLine = (item: CatalogItem): DraftLine => {
    const [min, max, step] = item.orderQty ?? DEFAULT_ORDER_QTY
    const quantity = Math.round((min + rnd() * (max - min)) / step) * step

    // Price = base × secular drift × seasonal cycle × noise. The first two are
    // what the trend chart is able to find; the third is what stops it from
    // finding a perfect line, which is also true of the real thing.
    const drift = 1 + (item.priceDriftPerYear ?? 0) * years
    const season = item.seasonality
      ? 1 +
        item.seasonality.amplitude *
          Math.cos((2 * Math.PI * (month - item.seasonality.peakMonth)) / 12)
      : 1
    const price = round(
      item.basePurchasePrice! * drift * season * (0.94 + rnd() * 0.12),
    )

    return {
      item,
      quantity,
      price,
      netAmount: quantity * price,
      netWeight: item.netWeight,
    }
  }

  const lines: DraftLine[] = [mkLine(primary)]
  if (rnd() < 0.55) lines.push(mkLine(primary))
  if (rnd() < 0.2) {
    const others = pool.filter(
      (i) => i.kind !== 'finished' && i.itemNumber !== primary.itemNumber,
    )
    // Only draw from the PRNG when there is an actual choice to make, so that
    // a two-item pool consumes exactly what it did before this was generalised.
    if (others.length === 1) lines.push(mkLine(others[0]))
    else if (others.length > 1) {
      lines.push(mkLine(others[Math.floor(rnd() * others.length)]))
    }
  }

  // An alternate vendor's premium applies to its dedicated single-commodity
  // loads; a mixed load is a brokered consolidation at broker terms. Keeping
  // the factor off mixed orders also keeps every rider line another item
  // contributed — and the header charges allocated across it — exactly as the
  // draws made them, so the premium cannot leak into other items' figures.
  const premium =
    primary.sourcing?.find((s) => s.vendorId === vendor.id)?.priceFactor ?? 1
  if (
    premium !== 1 &&
    lines.every((l) => l.item.itemNumber === primary.itemNumber)
  ) {
    for (const l of lines) {
      l.price = round(l.price * premium)
      l.netAmount = l.quantity * l.price
    }
  }

  const goodsValue = lines.reduce((s, l) => s + l.netAmount, 0)

  // A charge only applies when every line on the order attracts it — a mixed
  // produce/dry load gets freight and pallets but neither cold chain nor
  // fumigation.
  const tags = lines
    .map((l) => new Set(l.item.chargeTags ?? []))
    .reduce((acc, s) => new Set([...acc].filter((t) => s.has(t))))

  const applicable = CHARGE_CATALOG.filter((c) => tags.has(c.tag))
  const chosen = applicable.filter(
    (c) => c.code === 'FREIGHT' || rnd() < (c.code === 'DEMUR' ? 0.22 : 0.6),
  )

  const perLineCharges: ChargeLine[][] = lines.map(() => [])

  const chargeInflation = 1 + CHARGE_INFLATION_PER_YEAR * years

  for (const spec of chosen) {
    const total = round(
      goodsValue * spec.rate * chargeInflation * (0.72 + rnd() * 0.56),
    )
    const { amounts } = allocateHeaderCharge(
      total,
      lines.map((l) => ({
        quantity: l.quantity,
        netAmount: l.netAmount,
        netWeight: l.netWeight,
      })),
      spec.allocationMethod,
    )
    amounts.forEach((amount, idx) => {
      if (amount === 0) return
      perLineCharges[idx].push({
        chargeCode: spec.code,
        description: spec.description,
        chargeType: 'Financial',
        source: 'Header',
        allocationMethod: spec.allocationMethod,
        amount,
        amountPerUnit: amount / lines[idx].quantity,
      })
    })
  }

  // Occasionally the incoming lot is held for a lab result before it is
  // released, and the test is charged to the line.
  if (rnd() < 0.18) {
    const amount = round(lines[0].netAmount * 0.004)
    perLineCharges[0].push({
      chargeCode: 'LABTEST',
      description: 'Residue screen and micro testing',
      chargeType: 'Financial',
      source: 'Line',
      amount,
      amountPerUnit: amount / lines[0].quantity,
    })
  }

  // One delivery point per order, taken from the item that drove it. A single
  // configured option is used as-is rather than drawn for, so each focus raw
  // material always lands in its one receiving cooler without touching the PRNG.
  const recvOptions = primary.receiving ?? [DEFAULT_RECEIVING]
  const recv =
    recvOptions.length === 1
      ? recvOptions[0]
      : recvOptions[Math.floor(rnd() * recvOptions.length)]

  return lines.map((l, idx) => {
    const locations = receivingLocations(l.item)
    // A rider line with exactly one receiving point of its own is delivered
    // there (a line-level delivery address), so a blueberry lot consolidated
    // onto an apple load still lands at Hart. No draw: single options only.
    const lineRecv =
      idx > 0 && l.item.receiving?.length === 1 ? l.item.receiving[0] : recv
    return costRow({
      sourceType: 'Purchase',
      purchaseOrderNumber: poNumber,
      purchaseLineNumber: idx + 1,
      receiptNumber,
      receiptDate,
      itemNumber: l.item.itemNumber,
      productName: l.item.productName,
      vendorAccount: vendor.id,
      vendorName: vendor.name,
      siteId: lineRecv.siteId,
      warehouseId: lineRecv.warehouseId,
      locationId: locations[Math.floor(rnd() * locations.length)],
      batchNumber: lot(l.item.itemNumber, receiptDate),
      quantityReceived: l.quantity,
      unit: l.item.unit,
      currency: l.item.currency,
      purchasePriceFob: l.price,
      sellingPrice: l.item.sellingPrice,
      charges: perLineCharges[idx],
    })
  })
}

// ---------------------------------------------------------------------------
// Procedural generation — production orders
// ---------------------------------------------------------------------------

/**
 * Reports one production order as finished against a raw-material batch that
 * was actually received earlier. Material cost is that batch's real landed cost
 * scaled by the BOM quantity, so the finished goods rows are internally
 * consistent with the purchase rows above them rather than independently
 * invented numbers.
 */
function buildProductionOrder(
  rnd: () => number,
  lot: (itemNumber: string, iso: string) => string,
  orderNumber: string,
  receiptDate: string,
  item: CatalogItem,
  source: ReceiptRow,
): ReceiptRow {
  const { quantityPer } = item.bom!
  const consumed = source.quantityReceived * (0.55 + rnd() * 0.35)
  const quantity = Math.max(
    100,
    Math.floor(consumed / quantityPer / 100) * 100,
  )

  const charges: ChargeLine[] = item.conversion!.map((spec) => {
    const perUnit = round(spec.perUnit * (0.88 + rnd() * 0.24), 4)
    return {
      chargeCode: spec.code,
      description: spec.description,
      chargeType: 'Conversion',
      source: 'Line',
      amount: round(perUnit * quantity),
      amountPerUnit: perUnit,
    }
  })

  // A fifth of the volume is packed at the co-packer rather than in house.
  const atCopacker = rnd() < 0.2
  const home = item.production ?? { siteId: 'GRP', warehouseId: 'GRP-FG' }

  return costRow({
    sourceType: 'Production',
    purchaseOrderNumber: orderNumber,
    purchaseLineNumber: 1,
    receiptNumber: `PJ-${orderNumber.slice(1)}`,
    receiptDate,
    itemNumber: item.itemNumber,
    productName: item.productName,
    vendorAccount: '',
    vendorName: '',
    siteId: atCopacker ? COPACK.siteId : home.siteId,
    warehouseId: atCopacker ? COPACK.warehouseId : home.warehouseId,
    locationId: 'FG-01',
    batchNumber: lot(item.itemNumber, receiptDate),
    sourceItemNumber: source.itemNumber,
    sourceBatchNumber: source.batchNumber,
    quantityReceived: quantity,
    unit: item.unit,
    currency: item.currency,
    purchasePriceFob: round(quantityPer * source.landedCost, 4),
    sellingPrice: item.sellingPrice,
    charges,
  })
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

/** Number sequences, kept apart so the two passes cannot issue the same id. */
interface Sequences {
  po: number
  receipt: number
  prod: number
}

/**
 * Generates purchases then production for one set of items, sharing a PRNG.
 *
 * Production draws its material cost from a raw-material row produced in the
 * same pass, so a set is self-contained: whatever an item's finished goods cost
 * traces back to a receipt sitting in the same result.
 */
function buildForItems(
  rnd: () => number,
  lot: (itemNumber: string, iso: string) => string,
  today: string,
  items: CatalogItem[],
  vendors: { id: string; name: string }[],
  seq: Sequences,
  ordersPerItem: number,
  runsPerItem: number,
  /** Already-built receipts this set's production may also consume. */
  seedPurchases: ReceiptRow[] = [],
): { purchases: ReceiptRow[]; production: ReceiptRow[] } {
  const purchases: ReceiptRow[] = [...seedPurchases]
  const production: ReceiptRow[] = []

  // Drift is measured from the start of the seeded window, so the oldest
  // receipts sit at the base price and the newest carry two years of it.
  const baseDay = dayNumber(today) - 730
  const yearsAt = (iso: string) => (dayNumber(iso) - baseDay) / 365

  for (const item of items.filter((i) => i.kind !== 'finished')) {
    // Dates first, sorted, so purchase order numbers climb with the calendar
    // the way a real number sequence does.
    const dates = Array.from({ length: ordersPerItem }, () =>
      addDaysIso(today, -Math.floor(rnd() * 720) - 1),
    ).sort()

    for (const receiptDate of dates) {
      seq.po += 1 + Math.floor(rnd() * 3)
      seq.receipt += 1 + Math.floor(rnd() * 9)
      purchases.push(
        ...buildPurchaseOrder(
          rnd,
          lot,
          `PO-${String(seq.po).padStart(6, '0')}`,
          `PR-${seq.receipt}`,
          receiptDate,
          item,
          items,
          vendors,
          yearsAt(receiptDate),
        ),
      )
    }
  }

  for (const item of items.filter((i) => i.kind === 'finished')) {
    const feedstock = purchases
      .filter((r) => r.itemNumber === item.bom!.itemNumber)
      .sort((a, b) => (a.receiptDate < b.receiptDate ? -1 : 1))

    const dates = Array.from({ length: runsPerItem }, () =>
      addDaysIso(today, -Math.floor(rnd() * 700) - 1),
    ).sort()

    for (const receiptDate of dates) {
      // Consume something received 3-40 days before the run; fall back to the
      // most recent earlier receipt when nothing sits in that window.
      const window = feedstock.filter(
        (r) =>
          r.receiptDate <= addDaysIso(receiptDate, -3) &&
          r.receiptDate >= addDaysIso(receiptDate, -40),
      )
      const earlier = window.length
        ? window
        : feedstock.filter((r) => r.receiptDate < receiptDate)
      if (earlier.length === 0) continue

      const source = earlier[Math.floor(rnd() * earlier.length)]
      seq.prod += 1 + Math.floor(rnd() * 3)
      production.push(
        buildProductionOrder(
          rnd,
          lot,
          `P${String(seq.prod).padStart(6, '0')}`,
          receiptDate,
          item,
          source,
        ),
      )
    }
  }

  // Hand the caller only what this pass created; the seed rows are already his.
  return { purchases: purchases.slice(seedPurchases.length), production }
}

let cached: ReceiptRow[] | null = null

/**
 * All receipt rows across all items. Memoised — generation is pure.
 *
 * Two independent passes. The focus items go first on their own PRNG stream and
 * their own number ranges, so the background catalogue can grow, shrink or be
 * re-priced without moving a single figure the demo script quotes. `verify.mjs`
 * asserts the anchors either way.
 */
export function seedRows(): ReceiptRow[] {
  if (cached) return cached

  const today = todayIso()

  const lot = lotIssuer([
    ...PURCHASE_ANCHORS.map((a) => a.batch),
    ...PRODUCTION_ANCHORS.map((a) => a.batch),
    ...INBOUND_ANCHORS.map((a) => inboundBatch(a, today)),
  ])

  const purchaseAnchors = buildPurchaseAnchors()
  // Deliberately NOT handed to buildForItems as feedstock: these lots are the
  // stock the production plan is allowed to spend, so no generated production
  // order may quietly consume them first.
  const inboundAnchors = buildInboundAnchors(today)

  const focus = buildForItems(
    mulberry32(0x50524354), // "PRCT"
    lot,
    today,
    FOCUS_ITEMS,
    VENDORS,
    { po: 300, receipt: 106_000, prod: 400 },
    26,
    20,
    // The anchor receipts are real inventory too — a production run may consume
    // one, which is exactly what the PK-BLU-PINT anchors do.
    purchaseAnchors,
  )

  const filler = buildForItems(
    mulberry32(0x46494c4c), // "FILL"
    lot,
    today,
    FILLER_ITEMS,
    FILLER_VENDORS,
    { po: 2_000, receipt: 300_000, prod: 5_000 },
    9,
    8,
  )

  const rows = [
    ...purchaseAnchors,
    ...inboundAnchors,
    ...focus.purchases,
    ...filler.purchases,
    ...buildProductionAnchors(),
    ...focus.production,
    ...filler.production,
  ]

  rows.sort((a, b) => (a.receiptDate < b.receiptDate ? 1 : -1))
  cached = rows
  return rows
}

/** Batch numbers actually present for an item, for the batch lookup. */
export function batchesForItem(itemNumber: string): string[] {
  const set = new Set<string>()
  for (const r of seedRows()) {
    if (r.itemNumber === itemNumber && r.batchNumber) set.add(r.batchNumber)
  }
  return [...set].sort()
}

export function itemByNumber(itemNumber: string): CatalogItem | undefined {
  return ITEMS.find(
    (i) => i.itemNumber.toLowerCase() === itemNumber.trim().toLowerCase(),
  )
}

/** Strips the generation-only fields so only the shared contract escapes. */
export function itemInfoOf(item: CatalogItem): ItemInfo {
  return {
    itemNumber: item.itemNumber,
    productName: item.productName,
    unit: item.unit,
    currency: item.currency,
    currentCost: item.currentCost,
    sellingPrice: item.sellingPrice,
    itemGroupId: item.itemGroupId,
    costingMethod: item.costingMethod,
  }
}

/** Exposed for the "as of" line in the footer. */
export const SEED_GENERATED_AT = isoOf(new Date())

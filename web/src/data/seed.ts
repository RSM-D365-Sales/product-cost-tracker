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
 * Deterministic demo data for the mock provider — a food and beverage
 * manufacturer that buys bulk produce and dry commodities and packs them into
 * branded finished goods.
 *
 * Two layers:
 *  1. ANCHOR rows — hand-authored so the headline numbers are stable and can be
 *     quoted in a demo script. Five purchase receipts of the two raw materials
 *     from R1002 Davis Enterprises into site 2 / warehouse 24, and five
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
 * The point the anchors make: all three avocado receipts land at the same $2.35
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
   * Charge families this item attracts on an inbound load. Avocados cross the
   * border and need cold chain; domestic dry beans need neither but do get
   * fumigated.
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
    itemNumber: 'F440',
    productName: 'Bulk Avocados ORG 40',
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
    receiving: [{ siteId: '2', warehouseId: '24' }],
    priceDriftPerYear: 0.11,
    // Imported Hass supply thins out over late summer and price peaks with it.
    // Kept modest on purpose: the seeded window spans ~23 months, so a large
    // annual cycle lands on unmatched endpoints and tilts a straight-line fit
    // enough to cancel the drift entirely. The background produce items carry
    // the big swings instead, where a weak fit is a fair thing to show.
    seasonality: { amplitude: 0.05, peakMonth: 9 },
  },
  {
    itemNumber: 'RAW541',
    productName: 'Raw Black Beans Bulk',
    unit: 'lb',
    currency: 'USD',
    currentCost: 0.75,
    sellingPrice: 1.05,
    itemGroupId: 'RM-Dry',
    costingMethod: 'Batch actual cost',
    kind: 'raw',
    netWeight: 1,
    basePurchasePrice: 0.58,
    chargeTags: ['all', 'dry'],
    receiving: [{ siteId: '2', warehouseId: '24' }],
    priceDriftPerYear: 0.07,
    // Dry beans move on the autumn harvest, and far less than produce does.
    seasonality: { amplitude: 0.03, peakMonth: 8 },
  },
  {
    itemNumber: 'FG816',
    productName: 'AVOCADO 40 4CT',
    unit: 'ea',
    currency: 'USD',
    currentCost: 8.07,
    sellingPrice: 10.95,
    itemGroupId: 'FG-Fresh',
    costingMethod: 'Batch actual cost',
    kind: 'finished',
    // Four size-40 avocados to a pack, ~0.625 lb each.
    netWeight: 2.6,
    bom: { itemNumber: 'F440', quantityPer: 2.5 },
    conversion: [
      { code: 'PACK', description: 'Packaging — net bag and tray', perUnit: 0.34 },
      { code: 'LABOR', description: 'Direct labour — pack line', perUnit: 0.38 },
      { code: 'OVHD', description: 'Production overhead', perUnit: 0.22 },
      { code: 'QA', description: 'Quality and food safety', perUnit: 0.06 },
    ],
  },
  {
    itemNumber: 'FG841',
    productName: 'Canned Black Beans',
    unit: 'cs',
    currency: 'USD',
    currentCost: 10.47,
    sellingPrice: 16.95,
    itemGroupId: 'FG-Canned',
    costingMethod: 'Batch actual cost',
    kind: 'finished',
    // Case of 24 x 15.5 oz.
    netWeight: 25,
    bom: { itemNumber: 'RAW541', quantityPer: 6 },
    conversion: [
      { code: 'CAN', description: 'Cans and ends', perUnit: 4.32 },
      { code: 'LABEL', description: 'Labels and shipping cartons', perUnit: 0.48 },
      { code: 'LABOR', description: 'Direct labour — soak, cook and fill', perUnit: 0.95 },
      { code: 'OVHD', description: 'Production overhead — retort', perUnit: 0.55 },
      { code: 'QA', description: 'Quality and food safety', perUnit: 0.1 },
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
  // --- Dry commodities -----------------------------------------------------
  {
    itemNumber: 'RAW512',
    productName: 'Raw Pinto Beans Bulk',
    unit: 'lb',
    currency: 'USD',
    currentCost: 0.65,
    sellingPrice: 0.98,
    itemGroupId: 'RM-Dry',
    costingMethod: 'Batch actual cost',
    kind: 'raw',
    netWeight: 1,
    basePurchasePrice: 0.54,
    chargeTags: ['all', 'dry'],
    receiving: [{ siteId: '2', warehouseId: '24' }],
    priceDriftPerYear: 0.04,
    seasonality: { amplitude: 0.05, peakMonth: 8 },
  },
  {
    itemNumber: 'RAW566',
    productName: 'Raw Chick Peas Bulk',
    unit: 'lb',
    currency: 'USD',
    currentCost: 0.88,
    sellingPrice: 1.25,
    itemGroupId: 'RM-Dry',
    costingMethod: 'Batch actual cost',
    kind: 'raw',
    netWeight: 1,
    basePurchasePrice: 0.71,
    chargeTags: ['all', 'dry'],
    receiving: [{ siteId: '2', warehouseId: '24' }],
    priceDriftPerYear: 0.07,
    seasonality: { amplitude: 0.06, peakMonth: 7 },
  },
  {
    itemNumber: 'RAW580',
    productName: 'Long Grain White Rice Bulk',
    unit: 'lb',
    currency: 'USD',
    currentCost: 0.50,
    sellingPrice: 0.78,
    itemGroupId: 'RM-Dry',
    costingMethod: 'Batch actual cost',
    kind: 'raw',
    netWeight: 1,
    basePurchasePrice: 0.42,
    chargeTags: ['all', 'dry'],
    receiving: [
      { siteId: '2', warehouseId: '24' },
      { siteId: '3', warehouseId: '31' },
    ],
    priceDriftPerYear: 0.03,
    seasonality: { amplitude: 0.04, peakMonth: 6 },
  },
  // --- Produce -------------------------------------------------------------
  {
    itemNumber: 'F410',
    productName: 'Bulk Mangos ORG 12',
    unit: 'lb',
    currency: 'USD',
    currentCost: 1.98,
    sellingPrice: 2.85,
    itemGroupId: 'RM-Produce',
    costingMethod: 'Batch actual cost',
    kind: 'raw',
    netWeight: 1,
    basePurchasePrice: 1.62,
    chargeTags: ['all', 'cold', 'import'],
    receiving: [
      { siteId: '2', warehouseId: '24' },
      { siteId: '2', warehouseId: '25' },
    ],
    priceDriftPerYear: 0.06,
    seasonality: { amplitude: 0.16, peakMonth: 11 },
  },
  {
    itemNumber: 'F460',
    productName: 'Bulk Limes 200CT',
    unit: 'lb',
    currency: 'USD',
    currentCost: 1.16,
    sellingPrice: 1.65,
    itemGroupId: 'RM-Produce',
    costingMethod: 'Batch actual cost',
    kind: 'raw',
    netWeight: 1,
    basePurchasePrice: 0.88,
    chargeTags: ['all', 'cold', 'import'],
    receiving: [
      { siteId: '2', warehouseId: '24' },
      { siteId: '2', warehouseId: '25' },
    ],
    priceDriftPerYear: 0.12,
    seasonality: { amplitude: 0.22, peakMonth: 5 },
  },
  // --- Ingredients ---------------------------------------------------------
  {
    itemNumber: 'ING220',
    productName: 'Olive Oil Extra Virgin Bulk',
    unit: 'gal',
    currency: 'USD',
    currentCost: 32.25,
    sellingPrice: 44.0,
    itemGroupId: 'RM-Ingredient',
    costingMethod: 'Batch actual cost',
    kind: 'raw',
    netWeight: 7.6,
    basePurchasePrice: 24.5,
    chargeTags: ['all', 'import'],
    orderQty: [2_000, 9_000, 100],
    receiving: [{ siteId: '2', warehouseId: '24' }],
    priceDriftPerYear: 0.14,
    seasonality: { amplitude: 0.05, peakMonth: 10 },
  },
  {
    itemNumber: 'ING305',
    productName: 'Tomato Puree Bulk',
    unit: 'lb',
    currency: 'USD',
    currentCost: 0.45,
    sellingPrice: 0.7,
    itemGroupId: 'RM-Ingredient',
    costingMethod: 'Batch actual cost',
    kind: 'raw',
    netWeight: 1,
    basePurchasePrice: 0.38,
    chargeTags: ['all'],
    orderQty: [10_000, 40_000, 500],
    receiving: [{ siteId: '2', warehouseId: '24' }],
    priceDriftPerYear: 0.05,
    seasonality: { amplitude: 0.07, peakMonth: 6 },
  },
  {
    itemNumber: 'ING410',
    productName: 'Sea Salt Food Grade',
    unit: 'lb',
    currency: 'USD',
    currentCost: 0.22,
    sellingPrice: 0.35,
    itemGroupId: 'RM-Ingredient',
    costingMethod: 'Batch actual cost',
    kind: 'raw',
    netWeight: 1,
    basePurchasePrice: 0.16,
    chargeTags: ['all', 'dry'],
    orderQty: [4_000, 20_000, 250],
    receiving: [{ siteId: '2', warehouseId: '24' }],
    priceDriftPerYear: 0.02,
  },
  {
    itemNumber: 'ING455',
    productName: 'Adobo Seasoning Blend',
    unit: 'lb',
    currency: 'USD',
    currentCost: 3.73,
    sellingPrice: 5.4,
    itemGroupId: 'RM-Ingredient',
    costingMethod: 'Batch actual cost',
    kind: 'raw',
    netWeight: 1,
    basePurchasePrice: 3.15,
    chargeTags: ['all', 'import'],
    orderQty: [1_500, 8_000, 100],
    receiving: [{ siteId: '2', warehouseId: '24' }],
    priceDriftPerYear: 0.08,
  },
  // --- Packaging -----------------------------------------------------------
  {
    itemNumber: 'PKG101',
    productName: 'Can 15.5 OZ with Ends',
    unit: 'ea',
    currency: 'USD',
    currentCost: 0.21,
    sellingPrice: 0.28,
    itemGroupId: 'PKG-Rigid',
    costingMethod: 'Weighted avg.',
    kind: 'packaging',
    netWeight: 0.09,
    basePurchasePrice: 0.17,
    chargeTags: ['all'],
    orderQty: [80_000, 400_000, 1_000],
    receiving: [
      { siteId: '2', warehouseId: '24' },
      { siteId: '1', warehouseId: '12' },
    ],
    priceDriftPerYear: 0.10,
  },
  {
    itemNumber: 'PKG210',
    productName: 'Shipping Carton 24CT',
    unit: 'ea',
    currency: 'USD',
    currentCost: 0.75,
    sellingPrice: 1.05,
    itemGroupId: 'PKG-Fibre',
    costingMethod: 'Weighted avg.',
    kind: 'packaging',
    netWeight: 0.55,
    basePurchasePrice: 0.62,
    chargeTags: ['all'],
    orderQty: [8_000, 40_000, 500],
    receiving: [
      { siteId: '2', warehouseId: '24' },
      { siteId: '1', warehouseId: '12' },
      { siteId: '3', warehouseId: '31' },
    ],
    priceDriftPerYear: 0.06,
  },
  {
    itemNumber: 'PKG305',
    productName: 'Pressure Sensitive Label Roll',
    unit: 'ea',
    currency: 'USD',
    currentCost: 17.70,
    sellingPrice: 24.0,
    itemGroupId: 'PKG-Label',
    costingMethod: 'Weighted avg.',
    kind: 'packaging',
    netWeight: 3.2,
    basePurchasePrice: 14.8,
    chargeTags: ['all'],
    orderQty: [200, 1_200, 25],
    receiving: [
      { siteId: '2', warehouseId: '24' },
      { siteId: '1', warehouseId: '12' },
    ],
    priceDriftPerYear: 0.03,
  },
  // Appended after the rest of the packaging block on purpose: the generator
  // walks this array in order, so adding here leaves every item above it —
  // PKG101 included — generating exactly the rows it generated before.
  {
    itemNumber: 'PKG420',
    productName: 'Avocado Net Bag 4CT',
    unit: 'ea',
    currency: 'USD',
    currentCost: 0.14,
    sellingPrice: 0.19,
    itemGroupId: 'PKG-Flexible',
    costingMethod: 'Weighted avg.',
    kind: 'packaging',
    netWeight: 0.02,
    basePurchasePrice: 0.115,
    chargeTags: ['all'],
    orderQty: [40_000, 200_000, 1_000],
    receiving: [
      { siteId: '2', warehouseId: '24' },
      { siteId: '3', warehouseId: '31' },
    ],
    priceDriftPerYear: 0.07,
  },
  {
    itemNumber: 'PKG430',
    productName: 'Produce Tray 4CT',
    unit: 'ea',
    currency: 'USD',
    currentCost: 0.16,
    sellingPrice: 0.22,
    itemGroupId: 'PKG-Fibre',
    costingMethod: 'Weighted avg.',
    kind: 'packaging',
    netWeight: 0.05,
    basePurchasePrice: 0.13,
    chargeTags: ['all'],
    orderQty: [30_000, 150_000, 1_000],
    receiving: [
      { siteId: '2', warehouseId: '24' },
      { siteId: '3', warehouseId: '31' },
    ],
    priceDriftPerYear: 0.05,
  },
  // --- Produced ------------------------------------------------------------
  {
    itemNumber: 'FG802',
    productName: 'Canned Pinto Beans',
    unit: 'cs',
    currency: 'USD',
    currentCost: 9.92,
    sellingPrice: 15.95,
    itemGroupId: 'FG-Canned',
    costingMethod: 'Batch actual cost',
    kind: 'finished',
    netWeight: 25,
    bom: { itemNumber: 'RAW512', quantityPer: 6 },
    conversion: [
      { code: 'CAN', description: 'Cans and ends', perUnit: 4.32 },
      { code: 'LABEL', description: 'Labels and shipping cartons', perUnit: 0.48 },
      { code: 'LABOR', description: 'Direct labour — soak, cook and fill', perUnit: 0.92 },
      { code: 'OVHD', description: 'Production overhead — retort', perUnit: 0.54 },
      { code: 'QA', description: 'Quality and food safety', perUnit: 0.1 },
    ],
  },
  {
    itemNumber: 'FG825',
    productName: 'Canned Chick Peas',
    unit: 'cs',
    currency: 'USD',
    currentCost: 10.89,
    sellingPrice: 18.5,
    itemGroupId: 'FG-Canned',
    costingMethod: 'Batch actual cost',
    kind: 'finished',
    netWeight: 25,
    bom: { itemNumber: 'RAW566', quantityPer: 6 },
    conversion: [
      { code: 'CAN', description: 'Cans and ends', perUnit: 4.32 },
      { code: 'LABEL', description: 'Labels and shipping cartons', perUnit: 0.48 },
      { code: 'LABOR', description: 'Direct labour — soak, cook and fill', perUnit: 0.94 },
      { code: 'OVHD', description: 'Production overhead — retort', perUnit: 0.55 },
      { code: 'QA', description: 'Quality and food safety', perUnit: 0.1 },
    ],
  },
  {
    itemNumber: 'FG860',
    productName: 'White Rice 5LB',
    unit: 'ea',
    currency: 'USD',
    currentCost: 3.40,
    sellingPrice: 4.95,
    itemGroupId: 'FG-Dry',
    costingMethod: 'Batch actual cost',
    kind: 'finished',
    netWeight: 5.2,
    bom: { itemNumber: 'RAW580', quantityPer: 5 },
    conversion: [
      { code: 'PACK', description: 'Poly bag and handle', perUnit: 0.42 },
      { code: 'LABOR', description: 'Direct labour — bagging line', perUnit: 0.26 },
      { code: 'OVHD', description: 'Production overhead', perUnit: 0.18 },
      { code: 'QA', description: 'Quality and food safety', perUnit: 0.04 },
    ],
  },
  {
    itemNumber: 'FG874',
    productName: 'Mango Nectar 12CT',
    unit: 'cs',
    currency: 'USD',
    currentCost: 13.20,
    sellingPrice: 21.5,
    itemGroupId: 'FG-Beverage',
    costingMethod: 'Batch actual cost',
    kind: 'finished',
    netWeight: 15,
    bom: { itemNumber: 'F410', quantityPer: 4 },
    conversion: [
      { code: 'CAN', description: 'Cans and ends', perUnit: 2.88 },
      { code: 'LABEL', description: 'Labels and shipping cartons', perUnit: 0.42 },
      { code: 'LABOR', description: 'Direct labour — pulp, blend and fill', perUnit: 0.86 },
      { code: 'OVHD', description: 'Production overhead — pasteuriser', perUnit: 0.62 },
      { code: 'QA', description: 'Quality and food safety', perUnit: 0.09 },
    ],
  },
  {
    itemNumber: 'FG892',
    productName: 'Olive Oil 17 OZ',
    unit: 'ea',
    currency: 'USD',
    currentCost: 5.33,
    sellingPrice: 8.95,
    itemGroupId: 'FG-Ingredient',
    costingMethod: 'Batch actual cost',
    kind: 'finished',
    netWeight: 1.4,
    // 17 fl oz is 0.133 of a US gallon.
    bom: { itemNumber: 'ING220', quantityPer: 0.133 },
    conversion: [
      { code: 'PACK', description: 'Bottle and closure', perUnit: 0.58 },
      { code: 'LABEL', description: 'Labels and shipping cartons', perUnit: 0.11 },
      { code: 'LABOR', description: 'Direct labour — fill line', perUnit: 0.22 },
      { code: 'OVHD', description: 'Production overhead', perUnit: 0.16 },
      { code: 'QA', description: 'Quality and food safety', perUnit: 0.03 },
    ],
  },
]

/** The full product master, focus items first. */
export const ITEMS: CatalogItem[] = [...FOCUS_ITEMS, ...FILLER_ITEMS]

/**
 * R1002 Davis Enterprises is the primary supplier for both focus raw materials
 * and carries every anchor receipt; the rest exist so the vendor column varies
 * and the purchase-order lookup returns more than one name.
 */
export const VENDORS = [
  { id: 'R1002', name: 'Davis Enterprises' },
  { id: 'R1017', name: 'Valle Verde Produce' },
  { id: 'R1024', name: 'Rio Grande Commodities' },
  { id: 'R1038', name: 'Harvest Ridge Growers' },
]

/** Suppliers used only by the background items. */
export const FILLER_VENDORS = [
  { id: 'R1044', name: 'Delta Grain and Pulse' },
  { id: 'R1051', name: 'Mediterranean Oils SA' },
  { id: 'R1063', name: 'Atlantic Can and Closure' },
  { id: 'R1078', name: 'Summit Fibre Packaging' },
  { id: 'R1085', name: 'Casa Especias Trading' },
]

export const SITES = [
  { id: '1', name: 'Distribution center' },
  { id: '2', name: 'Food processing plant' },
  { id: '3', name: 'Co-pack facility' },
]

export const WAREHOUSES = [
  { id: '11', siteId: '1', name: 'DC finished goods' },
  { id: '12', siteId: '1', name: 'DC staging' },
  { id: '24', siteId: '2', name: 'Raw material receiving' },
  { id: '25', siteId: '2', name: 'Cold storage' },
  { id: '26', siteId: '2', name: 'Finished goods' },
  { id: '31', siteId: '3', name: 'Co-pack inventory' },
]

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
  if (item.chargeTags?.includes('cold')) return ['COLD-01', 'COLD-02', 'RECV-01']
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
  { code: 'FREIGHT', description: 'Inbound freight', allocationMethod: 'Net weight', rate: 0.115, tag: 'all' },
  { code: 'FUEL', description: 'Fuel surcharge', allocationMethod: 'Net weight', rate: 0.022, tag: 'all' },
  { code: 'PALLET', description: 'Pallets and dunnage', allocationMethod: 'Quantity', rate: 0.012, tag: 'all' },
  { code: 'INSPECT', description: 'USDA inspection and grading', allocationMethod: 'Equally', rate: 0.008, tag: 'all' },
  { code: 'DEMUR', description: 'Detention and demurrage', allocationMethod: 'Equally', rate: 0.014, tag: 'all' },
  { code: 'PRECOOL', description: 'Pre-cooling and cold chain', allocationMethod: 'Quantity', rate: 0.03, tag: 'cold' },
  { code: 'BROKER', description: 'Customs brokerage', allocationMethod: 'Equally', rate: 0.01, tag: 'import' },
  { code: 'DUTY', description: 'Import duty', allocationMethod: 'Net amount', rate: 0.028, tag: 'import' },
  { code: 'FUMIG', description: 'Fumigation and treatment', allocationMethod: 'Net weight', rate: 0.016, tag: 'dry' },
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
 * the nth lot of that item on that day. Reading `F440-26061A` off the grid tells
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
 * Five purchase receipts from R1002 Davis Enterprises into site 2 / warehouse
 * 24. Extended charge amounts are chosen so the per-unit add-on cost lands on a
 * round figure: F440 at $0.42, $0.31 and $0.55; RAW541 at $0.14 and $0.19.
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
    item: 'F440',
    po: 'PO-000241',
    receipt: 'PR-104812',
    date: '2026-03-02',
    batch: 'F440-26061A',
    location: 'COLD-01',
    qty: 42_000,
    fob: 2.35,
    // 11,340 + 3,360 + 1,260 + 1,680 = 17,640 over 42,000 lb -> 0.42/lb
    charges: [
      ['FREIGHT', 11_340.0],
      ['PRECOOL', 3_360.0],
      ['BROKER', 1_260.0],
      ['DUTY', 1_680.0],
    ],
  },
  {
    item: 'F440',
    po: 'PO-000258',
    receipt: 'PR-105196',
    date: '2026-04-13',
    batch: 'F440-26103A',
    location: 'COLD-02',
    qty: 38_000,
    fob: 2.35,
    // 7,600 + 2,280 + 950 + 950 = 11,780 over 38,000 lb -> 0.31/lb
    charges: [
      ['FREIGHT', 7_600.0],
      ['PRECOOL', 2_280.0],
      ['BROKER', 950.0],
      ['DUTY', 950.0],
    ],
  },
  {
    item: 'F440',
    po: 'PO-000273',
    receipt: 'PR-105644',
    date: '2026-05-18',
    batch: 'F440-26138A',
    location: 'COLD-01',
    qty: 40_000,
    fob: 2.35,
    // The load that sat at the port: demurrage alone adds $0.06/lb.
    // 14,000 + 3,200 + 1,200 + 2,400 + 1,200 = 22,000 over 40,000 lb -> 0.55/lb
    charges: [
      ['FREIGHT', 14_000.0],
      ['PRECOOL', 3_200.0],
      ['BROKER', 1_200.0],
      ['DEMUR', 2_400.0],
      ['DUTY', 1_200.0],
    ],
  },
  {
    item: 'RAW541',
    po: 'PO-000249',
    receipt: 'PR-104980',
    date: '2026-03-24',
    batch: 'RAW541-26083A',
    location: 'DRY-01',
    qty: 44_000,
    fob: 0.58,
    // 4,400 + 880 + 880 = 6,160 over 44,000 lb -> 0.14/lb
    charges: [
      ['FREIGHT', 4_400.0],
      ['FUMIG', 880.0],
      ['PALLET', 880.0],
    ],
  },
  {
    item: 'RAW541',
    po: 'PO-000269',
    receipt: 'PR-105432',
    date: '2026-05-05',
    batch: 'RAW541-26125A',
    location: 'DRY-02',
    qty: 40_000,
    fob: 0.58,
    // 5,600 + 800 + 800 + 400 = 7,600 over 40,000 lb -> 0.19/lb
    charges: [
      ['FREIGHT', 5_600.0],
      ['FUMIG', 800.0],
      ['PALLET', 800.0],
      ['DEMUR', 400.0],
    ],
  },
]

/**
 * Five production receipts. `material` is the BOM quantity multiplied by the
 * actual landed cost of `sourceBatch` — so FG816 costs $7.93, $7.62 and $8.29
 * across three otherwise identical runs purely because the avocados behind them
 * landed at $2.77, $2.66 and $2.90.
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
    item: 'FG816',
    order: 'P000318',
    journal: 'PJ-000318',
    date: '2026-03-09',
    batch: 'FG816-26068A',
    sourceItem: 'F440',
    sourceBatch: 'F440-26061A',
    siteId: '2',
    warehouseId: '26',
    qty: 12_400,
    material: 6.93, // 2.5 lb x $2.77
    conversion: [
      ['PACK', 0.34],
      ['LABOR', 0.38],
      ['OVHD', 0.22],
      ['QA', 0.06],
    ],
  },
  {
    item: 'FG816',
    order: 'P000341',
    journal: 'PJ-000341',
    date: '2026-04-20',
    batch: 'FG816-26110A',
    sourceItem: 'F440',
    sourceBatch: 'F440-26103A',
    siteId: '2',
    warehouseId: '26',
    qty: 11_200,
    material: 6.65, // 2.5 lb x $2.66
    conversion: [
      ['PACK', 0.34],
      ['LABOR', 0.36],
      ['OVHD', 0.21],
      ['QA', 0.06],
    ],
  },
  {
    item: 'FG816',
    order: 'P000369',
    journal: 'PJ-000369',
    date: '2026-05-26',
    batch: 'FG816-26146A',
    sourceItem: 'F440',
    sourceBatch: 'F440-26138A',
    siteId: '3',
    warehouseId: '31',
    qty: 12_000,
    material: 7.25, // 2.5 lb x $2.90
    conversion: [
      ['PACK', 0.35],
      ['LABOR', 0.4],
      ['OVHD', 0.23],
      ['QA', 0.06],
    ],
  },
  {
    item: 'FG841',
    order: 'P000327',
    journal: 'PJ-000327',
    date: '2026-03-31',
    batch: 'FG841-26090A',
    sourceItem: 'RAW541',
    sourceBatch: 'RAW541-26083A',
    siteId: '2',
    warehouseId: '26',
    qty: 5_600,
    material: 4.32, // 6 lb x $0.72
    conversion: [
      ['CAN', 4.32],
      ['LABEL', 0.48],
      ['LABOR', 0.95],
      ['OVHD', 0.55],
      ['QA', 0.1],
    ],
  },
  {
    item: 'FG841',
    order: 'P000358',
    journal: 'PJ-000358',
    date: '2026-05-12',
    batch: 'FG841-26132A',
    sourceItem: 'RAW541',
    sourceBatch: 'RAW541-26125A',
    siteId: '2',
    warehouseId: '26',
    qty: 5_200,
    material: 4.62, // 6 lb x $0.77
    conversion: [
      ['CAN', 4.44],
      ['LABEL', 0.48],
      ['LABOR', 0.98],
      ['OVHD', 0.57],
      ['QA', 0.1],
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
      vendorAccount: 'R1002',
      vendorName: 'Davis Enterprises',
      siteId: '2',
      warehouseId: '24',
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
 * roughly one of them falls inside a 21-day avocado shelf life — not enough to
 * plan a week of production from. These are hand-authored instead, staggered
 * across the expiry window so the plan has a genuine FEFO ordering to work out,
 * and priced on the same upward trend the generated receipts follow so they do
 * not distort the cost trend chart.
 *
 * `daysAgo` drives both the receipt date and, via the item's shelf life, the
 * expiry date. F440's first lot is deliberately sized so that it CANNOT be
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
  // --- F440 Bulk Avocados, 21-day shelf life -------------------------------
  {
    item: 'F440',
    daysAgo: 20,
    location: 'COLD-01',
    qty: 62_000,
    fob: 2.42, // + 0.39 = 2.81 landed
    charges: [
      ['FREIGHT', 0.25],
      ['PRECOOL', 0.07],
      ['BROKER', 0.025],
      ['DUTY', 0.045],
    ],
    onHand: 62_000,
  },
  {
    item: 'F440',
    daysAgo: 14,
    location: 'COLD-01',
    qty: 38_000,
    fob: 2.4, // + 0.34 = 2.74 landed
    charges: [
      ['FREIGHT', 0.215],
      ['PRECOOL', 0.06],
      ['BROKER', 0.022],
      ['DUTY', 0.043],
    ],
    onHand: 38_000,
  },
  {
    item: 'F440',
    daysAgo: 9,
    location: 'COLD-02',
    qty: 44_000,
    fob: 2.48, // + 0.45 = 2.93 landed
    charges: [
      ['FREIGHT', 0.29],
      ['PRECOOL', 0.078],
      ['BROKER', 0.037],
      ['DUTY', 0.045],
    ],
    onHand: 44_000,
  },
  {
    item: 'F440',
    daysAgo: 4,
    location: 'COLD-02',
    qty: 34_000,
    fob: 2.38, // + 0.30 = 2.68 landed
    charges: [
      ['FREIGHT', 0.19],
      ['PRECOOL', 0.055],
      ['BROKER', 0.017],
      ['DUTY', 0.038],
    ],
    onHand: 34_000,
  },
  {
    item: 'F440',
    daysAgo: 1,
    location: 'COLD-01',
    qty: 40_000,
    fob: 2.45, // + 0.40 = 2.85 landed
    charges: [
      ['FREIGHT', 0.255],
      ['PRECOOL', 0.072],
      ['BROKER', 0.028],
      ['DUTY', 0.045],
    ],
    onHand: 40_000,
  },
  // --- RAW541 Raw Black Beans, 2-year shelf life ---------------------------
  // Nothing here is close to expiring; the contrast with the avocados is the
  // point. Dry goods are constrained by how much you have, produce by how long
  // you have to use it.
  {
    item: 'RAW541',
    daysAgo: 40,
    location: 'DRY-01',
    qty: 96_000,
    fob: 0.66, // + 0.13 = 0.79 landed
    charges: [
      ['FREIGHT', 0.085],
      ['FUMIG', 0.021],
      ['PALLET', 0.012],
      ['INSPECT', 0.012],
    ],
    onHand: 74_000,
  },
  {
    item: 'RAW541',
    daysAgo: 12,
    location: 'DRY-02',
    qty: 120_000,
    fob: 0.68, // + 0.14 = 0.82 landed
    charges: [
      ['FREIGHT', 0.092],
      ['FUMIG', 0.022],
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
      vendorAccount: 'R1002',
      vendorName: 'Davis Enterprises',
      siteId: '2',
      warehouseId: '24',
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
  /** Confirmed delivery, days after today. */
  daysOut: number
  qty: number
  fob: number
  /** Per unit, estimated. */
  charges: [string, number][]
}[] = [
  // --- F440 Bulk Avocados: one load roughly every six days -----------------
  {
    item: 'F440',
    po: 'PO-000920',
    daysOut: 5,
    qty: 40_000,
    fob: 2.44,
    charges: [
      ['FREIGHT', 0.25],
      ['PRECOOL', 0.07],
      ['BROKER', 0.026],
      ['DUTY', 0.044],
    ],
  },
  {
    item: 'F440',
    po: 'PO-000926',
    daysOut: 11,
    qty: 44_000,
    fob: 2.47,
    charges: [
      ['FREIGHT', 0.26],
      ['PRECOOL', 0.072],
      ['BROKER', 0.026],
      ['DUTY', 0.045],
    ],
  },
  {
    item: 'F440',
    po: 'PO-000931',
    daysOut: 17,
    qty: 42_000,
    fob: 2.46,
    charges: [
      ['FREIGHT', 0.265],
      ['PRECOOL', 0.073],
      ['BROKER', 0.027],
      ['DUTY', 0.045],
    ],
  },
  {
    item: 'F440',
    po: 'PO-000938',
    daysOut: 24,
    qty: 46_000,
    fob: 2.5,
    charges: [
      ['FREIGHT', 0.27],
      ['PRECOOL', 0.074],
      ['BROKER', 0.027],
      ['DUTY', 0.046],
    ],
  },
  // --- RAW541 Raw Black Beans: two bulk loads ------------------------------
  {
    item: 'RAW541',
    po: 'PO-000944',
    daysOut: 9,
    qty: 100_000,
    fob: 0.67,
    charges: [
      ['FREIGHT', 0.09],
      ['FUMIG', 0.022],
      ['PALLET', 0.013],
      ['INSPECT', 0.012],
    ],
  },
  {
    item: 'RAW541',
    po: 'PO-000949',
    daysOut: 21,
    qty: 120_000,
    fob: 0.69,
    charges: [
      ['FREIGHT', 0.092],
      ['FUMIG', 0.022],
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
      vendorAccount: 'R1002',
      vendorName: 'Davis Enterprises',
      siteId: '2',
      warehouseId: '24',
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
 * both raw materials, because Davis Enterprises brokers produce and dry goods
 * alike. Header charges are allocated across ALL lines of the order, which is
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
  const vendor =
    rnd() < 0.68 ? vendors[0] : vendors[1 + Math.floor(rnd() * (vendors.length - 1))]

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
  // configured option is used as-is rather than drawn for, so the two focus raw
  // materials always land in site 2 / warehouse 24 without touching the PRNG.
  const recvOptions = primary.receiving ?? [{ siteId: '2', warehouseId: '24' }]
  const recv =
    recvOptions.length === 1
      ? recvOptions[0]
      : recvOptions[Math.floor(rnd() * recvOptions.length)]

  return lines.map((l, idx) => {
    const locations = receivingLocations(l.item)
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
      siteId: recv.siteId,
      warehouseId: recv.warehouseId,
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
    siteId: atCopacker ? '3' : '2',
    warehouseId: atCopacker ? '31' : '26',
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
    // one, which is exactly what the FG816 anchors do.
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

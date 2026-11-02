import type {
  AllocationMethod,
  ChargeLine,
  ItemInfo,
  ReceiptRow,
} from '../../../types/domain'
import { allocateHeaderCharge, costRow } from '../../../lib/calc'
import { addDaysIso, isoOf, todayIso } from '../../../lib/format'
import { dayNumber } from '../../../lib/trend'

/**
 * Deterministic demo data for the wheels edition — Northline Wheel & Rim, a
 * fictional maker of off-the-road (OTR) steel wheels and rims for mining and
 * industrial equipment (legal entity NWR). Every name here is invented and
 * every figure is generated here.
 *
 * Two layers, the same shape as the default edition:
 *  1. ANCHOR rows — hand-authored so the headline numbers are stable and can be
 *     quoted in a demo script. Five purchase receipts of the two raw materials
 *     from V4001 Harrowfield Plate Steel into the West Coast Plant, and five
 *     production receipts of the two wheels that consume those exact batches.
 *  2. Everything else is generated from a seeded PRNG, so the grid always has
 *     recent activity and the date filters have something to do.
 *
 * There is no Math.random anywhere: the same seed always produces the same data.
 * Unlike the default edition, nothing here carries an absolute date. Every row,
 * anchors included, is dated relative to today, so the cost trend always runs up
 * to about today with the open POs just after it, however long after the build
 * the demo is shown.
 *
 * The point the anchors make: all three plate receipts were bought at the same
 * $1,185/t mill price, but land at $1,368, $1,338 and $1,420 depending on what
 * the ocean leg did — and each wheel inherits the actual cost of the heat it
 * consumed, which is what batch actual costing does and what a standard cost
 * would hide.
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
  /** `raw` and `component` are bought; `finished` is made. */
  kind: 'raw' | 'component' | 'finished'
  /** kg per stocking unit — the basis for "Net weight" charge allocation. */
  netWeight: number
  /** Typical mill purchase price, before cyclical drift. Purchased items only. */
  basePurchasePrice?: number
  /**
   * Charge families this item attracts on an inbound load. Imported steel
   * crosses an ocean, pays duty and carries a mill inspection; domestic
   * consumables only ever pay inland freight.
   */
  chargeTags?: string[]
  /** `[min, max, step]` for a purchase order line. Defaults to plate volumes. */
  orderQty?: [number, number, number]
  /**
   * Fractional change in purchase price per year. Steel does not sit still, and
   * a cost inquiry with no drift in it has nothing to inquire about.
   */
  priceDriftPerYear?: number
  /** Cyclical swing as a fraction of the base price, peaking in `peakMonth` (1-12). */
  seasonality?: { amplitude: number; peakMonth: number }
  /**
   * Where inbound loads of this item are received. One entry means always
   * there; more than one and the order picks between them.
   */
  receiving?: { siteId: string; warehouseId: string }[]
  /**
   * Deliberate multi-sourcing. Generated orders that the volume draw does not
   * give the lead vendor are funnelled to these named alternates, and an
   * alternate's `priceFactor` scales the prices on its single-commodity loads —
   * that is how "shorter lead time but dearer" becomes visible in the receipts.
   * Quoted lead times live on the vendor records.
   */
  sourcing?: { vendorId: string; priceFactor: number }[]
  /**
   * Who actually supplies a background item. The vendor draw still runs over
   * the whole list it is given, and its result is remapped onto these by index.
   */
  vendorIds?: string[]
  /** Where a produced item is reported as finished when not at the Asia Plant. */
  production?: { siteId: string; warehouseId: string }
  /** Raw material consumed, and how much of it per finished unit. */
  bom?: { itemNumber: string; quantityPer: number }
  /** Conversion cost components picked up by a production order. */
  conversion?: ConversionSpec[]
}

/**
 * The four items the demo is built around. Everything hand-authored refers to
 * these, and they are generated from the PRNG stream first so that adding
 * background items cannot shift their numbers.
 */
export const FOCUS_ITEMS: CatalogItem[] = [
  {
    itemNumber: 'RM-PLT-A572',
    productName: 'Steel plate, rim grade',
    unit: 't',
    currency: 'USD',
    // Every currentCost here sits deliberately a few percent under the
    // quantity-weighted landed cost of the item's own receipts. That gap is the
    // point of the inquiry: the cost carried on the item understates what the
    // receipts say you actually paid, and the summary block puts the two margins
    // side by side.
    currentCost: 1_312,
    // Raw materials are not sold as such; this is the transfer price the margin
    // column is measured against.
    sellingPrice: 1_760,
    itemGroupId: 'RM-Plate',
    costingMethod: 'Batch actual cost',
    kind: 'raw',
    netWeight: 1_000,
    basePurchasePrice: 1_050,
    chargeTags: ['all', 'ocean', 'import', 'mill'],
    orderQty: [40, 180, 5],
    receiving: [{ siteId: 'PLT-W', warehouseId: 'PLTW-RM' }],
    priceDriftPerYear: 0.1,
    // Kept modest on purpose: the seeded window spans about 23 months, so a
    // large annual cycle lands on unmatched endpoints and tilts a straight-line
    // fit enough to cancel the drift.
    seasonality: { amplitude: 0.03, peakMonth: 3 },
    // Oakhollow matches the mill price; Marland holds stock near the port and
    // ships in 12 days at roughly a 6% premium. The premium surfaces in the
    // vendor column, the variance flags and the Copilot vendor-mix section.
    sourcing: [
      { vendorId: 'V4002', priceFactor: 1 },
      { vendorId: 'V4003', priceFactor: 1.06 },
    ],
  },
  {
    itemNumber: 'RM-BAR-FLG',
    productName: 'Steel flange bar',
    unit: 't',
    currency: 'USD',
    currentCost: 1_556,
    sellingPrice: 2_120,
    itemGroupId: 'RM-Bar',
    costingMethod: 'Batch actual cost',
    kind: 'raw',
    netWeight: 1_000,
    basePurchasePrice: 1_240,
    chargeTags: ['all', 'ocean', 'import', 'mill'],
    orderQty: [20, 90, 5],
    receiving: [{ siteId: 'PLT-W', warehouseId: 'PLTW-RM' }],
    priceDriftPerYear: 0.09,
    seasonality: { amplitude: 0.025, peakMonth: 4 },
    // Oakhollow rolls bar as well as plate, which is also why a mixed booking
    // from either mill can carry both.
    sourcing: [
      { vendorId: 'V4002', priceFactor: 1 },
      { vendorId: 'V4003', priceFactor: 1.07 },
    ],
  },
  {
    itemNumber: 'FG-OTR-5129',
    productName: 'OTR wheel, 51 in, surface mining',
    unit: 'ea',
    currency: 'USD',
    currentCost: 3_640,
    sellingPrice: 5_000,
    itemGroupId: 'FG-OTR',
    costingMethod: 'Batch actual cost',
    kind: 'finished',
    netWeight: 1_120,
    bom: { itemNumber: 'RM-PLT-A572', quantityPer: 1.18 },
    production: { siteId: 'PLT-W', warehouseId: 'PLTW-FG' },
    conversion: [
      { code: 'BAR', description: 'Flange bar', perUnit: 240 },
      { code: 'COMP', description: 'Rings, bead seat, seal, valve and consumables', perUnit: 860 },
      { code: 'WELD', description: 'Rim seam and flange weld', perUnit: 190 },
      { code: 'MACH', description: 'Machining — bead seat and gutter', perUnit: 150 },
      { code: 'PAINT', description: 'Shot-blast, prime and topcoat', perUnit: 85 },
      { code: 'LABOR', description: 'Direct labour — form, fit and assemble', perUnit: 320 },
      { code: 'OVHD', description: 'Production overhead', perUnit: 240 },
      { code: 'QA', description: 'NDT and dimensional inspection', perUnit: 35 },
    ],
  },
  {
    itemNumber: 'FG-OTR-3525',
    productName: 'OTR wheel, 35 in, underground',
    unit: 'ea',
    currency: 'USD',
    currentCost: 1_992,
    sellingPrice: 2_720,
    itemGroupId: 'FG-OTR',
    costingMethod: 'Batch actual cost',
    kind: 'finished',
    netWeight: 590,
    bom: { itemNumber: 'RM-PLT-A572', quantityPer: 0.62 },
    production: { siteId: 'PLT-W', warehouseId: 'PLTW-FG' },
    conversion: [
      { code: 'BAR', description: 'Flange bar', perUnit: 118 },
      { code: 'COMP', description: 'Rings, bead seat, seal, valve and consumables', perUnit: 500 },
      { code: 'WELD', description: 'Rim seam and flange weld', perUnit: 110 },
      { code: 'MACH', description: 'Machining — bead seat and gutter', perUnit: 85 },
      { code: 'PAINT', description: 'Shot-blast, prime and topcoat', perUnit: 55 },
      { code: 'LABOR', description: 'Direct labour — form, fit and assemble', perUnit: 190 },
      { code: 'OVHD', description: 'Production overhead', perUnit: 140 },
      { code: 'QA', description: 'NDT and dimensional inspection', perUnit: 22 },
    ],
  },
]

/**
 * A bought-in background item. Cost and price are derived from the base price
 * rather than authored one by one: item cost sits a touch under what the
 * drifted receipts average, and the selling price leaves about a quarter margin
 * unless `sellFactor` says otherwise. Imported parts start higher, because
 * their base price is a mill price with an ocean lane still to pay.
 */
function bought(spec: {
  itemNumber: string
  productName: string
  unit: string
  itemGroupId: string
  base: number
  orderQty: [number, number, number]
  receiving: { siteId: string; warehouseId: string }[]
  vendorIds: string[]
  drift: number
  netWeight: number
  chargeTags?: string[]
  sellFactor?: number
}): CatalogItem {
  // Runs at module load, ahead of the `round` helper further down the file.
  const cents = (value: number) => Math.round(value * 100) / 100
  const imported = spec.chargeTags?.includes('ocean') ?? false
  return {
    itemNumber: spec.itemNumber,
    productName: spec.productName,
    unit: spec.unit,
    currency: 'USD',
    currentCost: cents(spec.base * (imported ? 1.19 : 1.06)),
    sellingPrice: cents(spec.base * (spec.sellFactor ?? (imported ? 1.62 : 1.43))),
    itemGroupId: spec.itemGroupId,
    costingMethod: 'Weighted avg.',
    kind: 'component',
    netWeight: spec.netWeight,
    basePurchasePrice: spec.base,
    chargeTags: spec.chargeTags ?? ['all'],
    orderQty: spec.orderQty,
    receiving: spec.receiving,
    vendorIds: spec.vendorIds,
    priceDriftPerYear: spec.drift,
  }
}

/** Forged and rolled parts come over the same ocean lane the steel does. */
const IMPORTED = ['all', 'ocean', 'import']

const RING_STORES = [
  { siteId: 'PLT-W', warehouseId: 'PLTW-CP' },
  { siteId: 'PLT-A', warehouseId: 'PLTA-CP' },
  { siteId: 'SVC-N', warehouseId: 'SVCN-STG' },
]
const SEAL_STORES = [
  { siteId: 'PLT-W', warehouseId: 'PLTW-CP' },
  { siteId: 'SVC-S', warehouseId: 'SVCS-STG' },
]
const CONSUMABLE_STORES = [
  { siteId: 'PLT-W', warehouseId: 'PLTW-CS' },
  { siteId: 'PLT-A', warehouseId: 'PLTA-CS' },
]

/**
 * Background items. None of these carry hand-authored rows — they exist so the
 * item lookup reads like a real product master, the site and warehouse filters
 * have somewhere else to point, and a curious prospect who types a different
 * item number gets a populated grid instead of an empty one.
 *
 * They are generated from a SEPARATE PRNG stream (see `seedRows`), so adding to
 * or editing this list cannot move a single figure on the four focus items.
 */
export const FILLER_ITEMS: CatalogItem[] = [
  // --- Rings and bead seats ------------------------------------------------
  bought({ itemNumber: 'CMP-LR-5129', productName: 'Lock ring, 51 in', unit: 'ea', itemGroupId: 'CMP-Rings', base: 168, orderQty: [60, 400, 10], receiving: RING_STORES, vendorIds: ['V4004', 'V4003'], drift: 0.07, netWeight: 62, chargeTags: IMPORTED }),
  bought({ itemNumber: 'CMP-LR-3525', productName: 'Lock ring, 35 in', unit: 'ea', itemGroupId: 'CMP-Rings', base: 96, orderQty: [80, 500, 10], receiving: RING_STORES, vendorIds: ['V4004', 'V4003'], drift: 0.07, netWeight: 31, chargeTags: IMPORTED }),
  bought({ itemNumber: 'CMP-SR-5129', productName: 'Side ring, 51 in', unit: 'ea', itemGroupId: 'CMP-Rings', base: 152, orderQty: [60, 400, 10], receiving: RING_STORES, vendorIds: ['V4004'], drift: 0.08, netWeight: 74, chargeTags: IMPORTED }),
  bought({ itemNumber: 'CMP-SR-3525', productName: 'Side ring, 35 in', unit: 'ea', itemGroupId: 'CMP-Rings', base: 88, orderQty: [80, 500, 10], receiving: RING_STORES, vendorIds: ['V4004'], drift: 0.08, netWeight: 38, chargeTags: IMPORTED }),
  bought({ itemNumber: 'CMP-BS-5129', productName: 'Bead seat band, 51 in', unit: 'ea', itemGroupId: 'CMP-Rings', base: 130, orderQty: [60, 400, 10], receiving: RING_STORES, vendorIds: ['V4004', 'V4003'], drift: 0.08, netWeight: 56, chargeTags: IMPORTED, sellFactor: 1.72 }),
  bought({ itemNumber: 'CMP-BS-3525', productName: 'Bead seat band, 35 in', unit: 'ea', itemGroupId: 'CMP-Rings', base: 78, orderQty: [80, 500, 10], receiving: RING_STORES, vendorIds: ['V4004', 'V4003'], drift: 0.08, netWeight: 29, chargeTags: IMPORTED, sellFactor: 1.72 }),
  // --- Seals and valves ----------------------------------------------------
  bought({ itemNumber: 'CMP-OR-5129', productName: 'O-ring, 51 in', unit: 'ea', itemGroupId: 'CMP-Seals', base: 34, orderQty: [200, 1_500, 50], receiving: SEAL_STORES, vendorIds: ['V4102'], drift: 0.05, netWeight: 1.4 }),
  bought({ itemNumber: 'CMP-OR-3525', productName: 'O-ring, 35 in', unit: 'ea', itemGroupId: 'CMP-Seals', base: 22, orderQty: [200, 1_500, 50], receiving: SEAL_STORES, vendorIds: ['V4102'], drift: 0.05, netWeight: 0.8 }),
  bought({ itemNumber: 'CMP-VS-OTR', productName: 'Valve stem, OTR', unit: 'ea', itemGroupId: 'CMP-Seals', base: 21, orderQty: [300, 2_000, 50], receiving: SEAL_STORES, vendorIds: ['V4103'], drift: 0.06, netWeight: 0.3, sellFactor: 1.6 }),
  // --- Weld, paint and shipping consumables --------------------------------
  bought({ itemNumber: 'CON-WIRE', productName: 'Weld wire, flux-cored', unit: 'kg', itemGroupId: 'CON-Weld', base: 3.2, orderQty: [2_000, 12_000, 100], receiving: CONSUMABLE_STORES, vendorIds: ['V4105'], drift: 0.06, netWeight: 1 }),
  bought({ itemNumber: 'CON-GAS', productName: 'Shielding gas, argon mix', unit: 'cyl', itemGroupId: 'CON-Weld', base: 46, orderQty: [40, 240, 10], receiving: CONSUMABLE_STORES, vendorIds: ['V4105'], drift: 0.05, netWeight: 68 }),
  bought({ itemNumber: 'CON-PRM', productName: 'Primer, zinc-rich', unit: 'L', itemGroupId: 'CON-Paint', base: 10.8, orderQty: [400, 3_000, 50], receiving: CONSUMABLE_STORES, vendorIds: ['V4104'], drift: 0.06, netWeight: 2.4 }),
  bought({ itemNumber: 'CON-TOP', productName: 'Topcoat, polyurethane', unit: 'L', itemGroupId: 'CON-Paint', base: 15.6, orderQty: [400, 3_000, 50], receiving: CONSUMABLE_STORES, vendorIds: ['V4104'], drift: 0.07, netWeight: 1.6 }),
  bought({ itemNumber: 'CON-CRD', productName: 'Shipping cradle, steel', unit: 'ea', itemGroupId: 'CON-Logistics', base: 58, orderQty: [100, 800, 20], receiving: CONSUMABLE_STORES, vendorIds: ['V4105'], drift: 0.05, netWeight: 26 }),
  bought({ itemNumber: 'CON-BOLT', productName: 'Fastener set, grade 8', unit: 'ea', itemGroupId: 'CON-Logistics', base: 18, orderQty: [200, 1_500, 50], receiving: CONSUMABLE_STORES, vendorIds: ['V4101'], drift: 0.04, netWeight: 2.2 }),
  bought({ itemNumber: 'CON-INS', productName: 'Carbide insert, box of 10', unit: 'ea', itemGroupId: 'CON-Weld', base: 96, orderQty: [20, 160, 5], receiving: CONSUMABLE_STORES, vendorIds: ['V4105'], drift: 0.04, netWeight: 0.4, sellFactor: 1.6 }),
  // --- Produced ------------------------------------------------------------
  {
    itemNumber: 'FG-RB-5129',
    productName: 'Rim base, 51 in',
    unit: 'ea',
    currency: 'USD',
    currentCost: 1_512,
    sellingPrice: 2_180,
    itemGroupId: 'FG-Rim',
    costingMethod: 'Batch actual cost',
    kind: 'finished',
    netWeight: 690,
    bom: { itemNumber: 'RM-PLT-A572', quantityPer: 0.74 },
    production: { siteId: 'PLT-W', warehouseId: 'PLTW-FG' },
    conversion: [
      { code: 'COMP', description: 'Weld wire, primer and consumables', perUnit: 70 },
      { code: 'WELD', description: 'Rim seam weld', perUnit: 115 },
      { code: 'MACH', description: 'Machining — gutter', perUnit: 80 },
      { code: 'PAINT', description: 'Shot-blast and prime', perUnit: 40 },
      { code: 'LABOR', description: 'Direct labour — form and roll', perUnit: 165 },
      { code: 'OVHD', description: 'Production overhead', perUnit: 120 },
      { code: 'QA', description: 'NDT and dimensional inspection', perUnit: 18 },
    ],
  },
  {
    itemNumber: 'FG-RB-3525',
    productName: 'Rim base, 35 in',
    unit: 'ea',
    currency: 'USD',
    currentCost: 815,
    sellingPrice: 1_190,
    itemGroupId: 'FG-Rim',
    costingMethod: 'Batch actual cost',
    kind: 'finished',
    netWeight: 355,
    bom: { itemNumber: 'RM-PLT-A572', quantityPer: 0.38 },
    production: { siteId: 'PLT-W', warehouseId: 'PLTW-FG' },
    conversion: [
      { code: 'COMP', description: 'Weld wire, primer and consumables', perUnit: 42 },
      { code: 'WELD', description: 'Rim seam weld', perUnit: 62 },
      { code: 'MACH', description: 'Machining — gutter', perUnit: 44 },
      { code: 'PAINT', description: 'Shot-blast and prime', perUnit: 24 },
      { code: 'LABOR', description: 'Direct labour — form and roll', perUnit: 88 },
      { code: 'OVHD', description: 'Production overhead', perUnit: 64 },
      { code: 'QA', description: 'NDT and dimensional inspection', perUnit: 12 },
    ],
  },
  {
    itemNumber: 'FG-LR-5129',
    productName: 'Lock ring, 51 in, service',
    unit: 'ea',
    currency: 'USD',
    currentCost: 222,
    sellingPrice: 345,
    itemGroupId: 'FG-Service',
    costingMethod: 'Batch actual cost',
    kind: 'finished',
    netWeight: 62,
    bom: { itemNumber: 'RM-BAR-FLG', quantityPer: 0.07 },
    production: { siteId: 'SVC-N', warehouseId: 'SVCN-FG' },
    conversion: [
      { code: 'LABOR', description: 'Direct labour — ring roll', perUnit: 62 },
      { code: 'PAINT', description: 'Prime', perUnit: 12 },
      { code: 'OVHD', description: 'Production overhead', perUnit: 42 },
      { code: 'QA', description: 'Dimensional inspection', perUnit: 6 },
    ],
  },
  {
    itemNumber: 'FG-LR-3525',
    productName: 'Lock ring, 35 in, service',
    unit: 'ea',
    currency: 'USD',
    currentCost: 128,
    sellingPrice: 182,
    itemGroupId: 'FG-Service',
    costingMethod: 'Batch actual cost',
    kind: 'finished',
    netWeight: 31,
    bom: { itemNumber: 'RM-BAR-FLG', quantityPer: 0.035 },
    production: { siteId: 'SVC-N', warehouseId: 'SVCN-FG' },
    conversion: [
      { code: 'LABOR', description: 'Direct labour — ring roll', perUnit: 40 },
      { code: 'PAINT', description: 'Prime', perUnit: 8 },
      { code: 'OVHD', description: 'Production overhead', perUnit: 27 },
      { code: 'QA', description: 'Dimensional inspection', perUnit: 4 },
    ],
  },
  {
    itemNumber: 'FG-SR-5129',
    productName: 'Side ring, 51 in, service',
    unit: 'ea',
    currency: 'USD',
    currentCost: 254,
    sellingPrice: 365,
    itemGroupId: 'FG-Service',
    costingMethod: 'Batch actual cost',
    kind: 'finished',
    netWeight: 74,
    bom: { itemNumber: 'RM-BAR-FLG', quantityPer: 0.08 },
    production: { siteId: 'SVC-S', warehouseId: 'SVCS-FG' },
    conversion: [
      { code: 'LABOR', description: 'Direct labour — ring roll', perUnit: 70 },
      { code: 'PAINT', description: 'Prime', perUnit: 14 },
      { code: 'OVHD', description: 'Production overhead', perUnit: 48 },
      { code: 'QA', description: 'Dimensional inspection', perUnit: 6 },
    ],
  },
]

/** The full product master, focus items first. */
export const ITEMS: CatalogItem[] = [...FOCUS_ITEMS, ...FILLER_ITEMS]

/**
 * V4001 Harrowfield Plate Steel is the lead mill for both focus raw materials
 * and carries every anchor receipt; the others exist so the vendor column varies
 * and the purchase-order lookup returns more than one name.
 *
 * `leadTimeDays` is the vendor's quoted order-to-dock lead time. Harrowfield is
 * cheapest but on a 45-day mill-and-ocean pipeline; Marland charges 6-7% more
 * and delivers in 12 — see the `sourcing` mix on the catalogue entries.
 *
 * Order matters: the lead vendor is first, and the focus pass draws a vendor
 * by index into this list, so it must keep four entries.
 */
export const VENDORS = [
  { id: 'V4001', name: 'Harrowfield Plate Steel', leadTimeDays: 45 },
  { id: 'V4002', name: 'Oakhollow Rolling', leadTimeDays: 38 },
  { id: 'V4003', name: 'Marland Steel Service', leadTimeDays: 12 },
  { id: 'V4004', name: 'Vostrand Forgings', leadTimeDays: 30 },
]

/** Suppliers used only by the background items. */
export const FILLER_VENDORS = [
  { id: 'V4101', name: 'Tresco Fasteners', leadTimeDays: 10 },
  { id: 'V4102', name: 'Nakamori Seals', leadTimeDays: 21 },
  { id: 'V4103', name: 'Quintara Valves', leadTimeDays: 14 },
  { id: 'V4104', name: 'Brightline Coatings', leadTimeDays: 7 },
  { id: 'V4105', name: 'Ambrose Tooling', leadTimeDays: 5 },
]

const ALL_VENDORS = [...VENDORS, ...FILLER_VENDORS]

function vendorById(id: string): { id: string; name: string } {
  return ALL_VENDORS.find((v) => v.id === id)!
}

/** Two plants and two service branches, all fictional. */
export const SITES = [
  { id: 'PLT-W', name: 'West Coast Plant' },
  { id: 'PLT-A', name: 'Asia Plant' },
  { id: 'SVC-N', name: 'North Service Branch' },
  { id: 'SVC-S', name: 'South Service Branch' },
]

export const WAREHOUSES = [
  { id: 'PLTW-RM', siteId: 'PLT-W', name: 'Plate and bar yard' },
  { id: 'PLTW-CP', siteId: 'PLT-W', name: 'Bought-in components' },
  { id: 'PLTW-CS', siteId: 'PLT-W', name: 'Consumables store' },
  { id: 'PLTW-FG', siteId: 'PLT-W', name: 'Finished wheels' },
  { id: 'PLTA-RM', siteId: 'PLT-A', name: 'Plate and bar yard' },
  { id: 'PLTA-CP', siteId: 'PLT-A', name: 'Bought-in components' },
  { id: 'PLTA-CS', siteId: 'PLT-A', name: 'Consumables store' },
  { id: 'PLTA-FG', siteId: 'PLT-A', name: 'Finished wheels' },
  { id: 'SVCN-FG', siteId: 'SVC-N', name: 'Branch finished stock' },
  { id: 'SVCN-STG', siteId: 'SVC-N', name: 'Branch staging' },
  { id: 'SVCS-FG', siteId: 'SVC-S', name: 'Branch finished stock' },
  { id: 'SVCS-STG', siteId: 'SVC-S', name: 'Branch staging' },
]

/**
 * Where a run built at the Asia Plant reports finished goods. About a fifth of
 * produced volume is built there rather than on the West Coast.
 */
const ASIA_BUILD = { siteId: 'PLT-A', warehouseId: 'PLTA-FG' }

/** Receiving point for an item with none configured. */
const DEFAULT_RECEIVING = { siteId: 'PLT-W', warehouseId: 'PLTW-RM' }

export const LOCATIONS = [
  'RECV-01',
  'YARD-01',
  'YARD-02',
  'STORE-01',
  'STORE-02',
  'CMP-01',
  'FG-01',
]

/** Where an inbound item is put away — steel in the yard, parts in the racks. */
function receivingLocations(item: CatalogItem): string[] {
  if (item.kind === 'raw') return ['YARD-01', 'YARD-02', 'RECV-01']
  if (item.itemGroupId?.startsWith('CMP-')) return ['CMP-01', 'STORE-02', 'RECV-01']
  return ['STORE-01', 'STORE-02', 'RECV-01']
}

/** Default purchase order line size, in the item's own unit. */
const DEFAULT_ORDER_QTY: [number, number, number] = [40, 180, 5]

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
  { code: 'OCEAN', description: 'Ocean freight — Redfern Freight', allocationMethod: 'Net weight', rate: 0.078, tag: 'ocean' },
  { code: 'INLAND', description: 'Inland freight — Redfern Freight', allocationMethod: 'Net weight', rate: 0.026, tag: 'all' },
  { code: 'DUTY', description: 'Import duty', allocationMethod: 'Net amount', rate: 0.032, tag: 'import' },
  { code: 'PORT', description: 'Port and handling', allocationMethod: 'Quantity', rate: 0.014, tag: 'ocean' },
  { code: 'MILLINSP', description: 'Mill inspection', allocationMethod: 'Equally', rate: 0.008, tag: 'mill' },
  { code: 'DEMUR', description: 'Port storage and demurrage', allocationMethod: 'Equally', rate: 0.012, tag: 'ocean' },
]

/** Charges a load may or may not attract; everything else in the catalogue is certain. */
const OPTIONAL_CHARGES = new Set(['MILLINSP', 'DEMUR'])

const chargeSpec = (code: string): ChargeSpec =>
  CHARGE_CATALOG.find((c) => c.code === code)!

/**
 * Freight and port charges have climbed faster than the steel they carry. This
 * is why landed cost trends up more steeply than the purchase price does — the
 * widening gap between the two lines on the trend chart is the argument the
 * whole app is making, so it has to actually be in the data.
 */
const CHARGE_INFLATION_PER_YEAR = 0.1

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
 * Heat lot code: item, two-digit year, day of year, then a letter for the nth
 * lot of that item on that day. Reading `RM-PLT-A572-26061A` off the grid tells a
 * yard operator exactly which delivery it was.
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
 * Five purchase receipts from V4001 Harrowfield Plate Steel into the West Coast
 * Plant (PLT-W / PLTW-RM). Extended charge amounts are chosen so the per-unit
 * add-on cost lands on a round figure: RM-PLT-A572 at $183, $153 and $235;
 * RM-BAR-FLG at $155 and $191. Dated relative to today so they keep their place
 * on the trend however old the build gets.
 */
const PURCHASE_ANCHORS: {
  item: string
  po: string
  receipt: string
  daysAgo: number
  location: string
  qty: number
  fob: number
  charges: [string, number][]
}[] = [
  {
    item: 'RM-PLT-A572',
    po: 'PO-000241',
    receipt: 'PR-104812',
    daysAgo: 320,
    location: 'YARD-01',
    qty: 180,
    fob: 1_185,
    // 19,800 + 5,040 + 6,300 + 1,800 = 32,940 over 180 t -> 183/t
    charges: [
      ['OCEAN', 19_800.0],
      ['INLAND', 5_040.0],
      ['DUTY', 6_300.0],
      ['PORT', 1_800.0],
    ],
  },
  {
    item: 'RM-PLT-A572',
    po: 'PO-000258',
    receipt: 'PR-105196',
    daysAgo: 276,
    location: 'YARD-02',
    qty: 160,
    fob: 1_185,
    // 13,600 + 4,000 + 5,600 + 1,280 = 24,480 over 160 t -> 153/t
    charges: [
      ['OCEAN', 13_600.0],
      ['INLAND', 4_000.0],
      ['DUTY', 5_600.0],
      ['PORT', 1_280.0],
    ],
  },
  {
    item: 'RM-PLT-A572',
    po: 'PO-000273',
    receipt: 'PR-105644',
    daysAgo: 241,
    location: 'YARD-01',
    qty: 170,
    fob: 1_185,
    // The load caught in a port queue: a spot ocean rate, and demurrage alone
    // adds $20/t.
    // 23,800 + 4,760 + 5,950 + 2,040 + 3,400 = 39,950 over 170 t -> 235/t
    charges: [
      ['OCEAN', 23_800.0],
      ['INLAND', 4_760.0],
      ['DUTY', 5_950.0],
      ['PORT', 2_040.0],
      ['DEMUR', 3_400.0],
    ],
  },
  {
    item: 'RM-BAR-FLG',
    po: 'PO-000249',
    receipt: 'PR-104980',
    daysAgo: 298,
    location: 'YARD-02',
    qty: 60,
    fob: 1_345,
    // 5,400 + 1,320 + 2,100 + 480 = 9,300 over 60 t -> 155/t
    charges: [
      ['OCEAN', 5_400.0],
      ['INLAND', 1_320.0],
      ['DUTY', 2_100.0],
      ['PORT', 480.0],
    ],
  },
  {
    item: 'RM-BAR-FLG',
    po: 'PO-000269',
    receipt: 'PR-105432',
    daysAgo: 256,
    location: 'YARD-01',
    qty: 55,
    fob: 1_345,
    // 6,600 + 1,430 + 1,925 + 550 = 10,505 over 55 t -> 191/t
    charges: [
      ['OCEAN', 6_600.0],
      ['INLAND', 1_430.0],
      ['DUTY', 1_925.0],
      ['PORT', 550.0],
    ],
  },
]

/** Batch number a purchase anchor takes, given today's date. */
function anchorBatch(item: string, daysAgo: number, today: string): string {
  return lotCode(item, addDaysIso(today, -daysAgo))
}

/**
 * Five production receipts. `material` is the BOM quantity multiplied by the
 * actual landed cost of the source batch — so a 51 in wheel's plate costs
 * $1,614.24, $1,578.84 and $1,675.60 across three otherwise similar runs, mostly
 * because the 1.18 t behind each wheel landed at $1,368, $1,338 and $1,420.
 */
const PRODUCTION_ANCHORS: {
  item: string
  order: string
  journal: string
  daysAgo: number
  sourceItem: string
  sourceDaysAgo: number
  siteId: string
  warehouseId: string
  qty: number
  material: number
  conversion: [string, number][]
}[] = [
  {
    item: 'FG-OTR-5129',
    order: 'P000318',
    journal: 'PJ-000318',
    daysAgo: 313,
    sourceItem: 'RM-PLT-A572',
    sourceDaysAgo: 320,
    siteId: 'PLT-W',
    warehouseId: 'PLTW-FG',
    qty: 110,
    material: 1_614.24, // 1.18 t x $1,368
    conversion: [
      ['BAR', 240],
      ['COMP', 850],
      ['WELD', 188],
      ['MACH', 148],
      ['PAINT', 84],
      ['LABOR', 318],
      ['OVHD', 238],
      ['QA', 34],
    ],
  },
  {
    item: 'FG-OTR-5129',
    order: 'P000341',
    journal: 'PJ-000341',
    daysAgo: 269,
    sourceItem: 'RM-PLT-A572',
    sourceDaysAgo: 276,
    siteId: 'PLT-W',
    warehouseId: 'PLTW-FG',
    qty: 100,
    material: 1_578.84, // 1.18 t x $1,338
    conversion: [
      ['BAR', 236],
      ['COMP', 850],
      ['WELD', 182],
      ['MACH', 144],
      ['PAINT', 84],
      ['LABOR', 306],
      ['OVHD', 230],
      ['QA', 34],
    ],
  },
  {
    // Built at the Asia Plant.
    item: 'FG-OTR-5129',
    order: 'P000369',
    journal: 'PJ-000369',
    daysAgo: 234,
    sourceItem: 'RM-PLT-A572',
    sourceDaysAgo: 241,
    siteId: 'PLT-A',
    warehouseId: 'PLTA-FG',
    qty: 105,
    material: 1_675.6, // 1.18 t x $1,420
    conversion: [
      ['BAR', 246],
      ['COMP', 872],
      ['WELD', 196],
      ['MACH', 156],
      ['PAINT', 88],
      ['LABOR', 336],
      ['OVHD', 246],
      ['QA', 36],
    ],
  },
  {
    item: 'FG-OTR-3525',
    order: 'P000327',
    journal: 'PJ-000327',
    daysAgo: 306,
    sourceItem: 'RM-PLT-A572',
    sourceDaysAgo: 320,
    siteId: 'PLT-W',
    warehouseId: 'PLTW-FG',
    qty: 70,
    material: 848.16, // 0.62 t x $1,368
    conversion: [
      ['BAR', 118],
      ['COMP', 498],
      ['WELD', 110],
      ['MACH', 85],
      ['PAINT', 55],
      ['LABOR', 190],
      ['OVHD', 140],
      ['QA', 22],
    ],
  },
  {
    item: 'FG-OTR-3525',
    order: 'P000358',
    journal: 'PJ-000358',
    daysAgo: 262,
    sourceItem: 'RM-PLT-A572',
    sourceDaysAgo: 276,
    siteId: 'PLT-W',
    warehouseId: 'PLTW-FG',
    qty: 60,
    material: 829.56, // 0.62 t x $1,338
    conversion: [
      ['BAR', 120],
      ['COMP', 502],
      ['WELD', 112],
      ['MACH', 86],
      ['PAINT', 55],
      ['LABOR', 194],
      ['OVHD', 142],
      ['QA', 22],
    ],
  },
]

function buildPurchaseAnchors(today: string): ReceiptRow[] {
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
      receiptDate: addDaysIso(today, -a.daysAgo),
      itemNumber: item.itemNumber,
      productName: item.productName,
      vendorAccount: VENDORS[0].id,
      vendorName: VENDORS[0].name,
      siteId: item.receiving![0].siteId,
      warehouseId: item.receiving![0].warehouseId,
      locationId: a.location,
      batchNumber: anchorBatch(a.item, a.daysAgo, today),
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
 * Rim-grade plate is released against a mill certificate that has to be reviewed
 * 180 days after receipt: past that date the heat is held for re-test and cannot
 * be issued. These lots are staggered across that window so the plan has a
 * genuine earliest-review-first ordering to work out, and priced on the same
 * upward trend the generated receipts follow so they do not distort the cost
 * trend chart.
 *
 * `daysAgo` drives both the receipt date and, via the item's review window, the
 * review date. RM-PLT-A572's first lot is deliberately sized so that it CANNOT
 * be consumed before its review date on the default two wheel cells — enabling
 * the Asia Plant cell in the parameters is what clears it. That is the demo.
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
  // --- RM-PLT-A572 Steel plate, 180-day mill cert review ---------------------
  {
    item: 'RM-PLT-A572',
    daysAgo: 179,
    location: 'YARD-01',
    qty: 125,
    fob: 1_205, // + 196 = 1,401 landed
    charges: [
      ['OCEAN', 118],
      ['INLAND', 30],
      ['DUTY', 36],
      ['PORT', 12],
    ],
    onHand: 125,
  },
  {
    item: 'RM-PLT-A572',
    daysAgo: 150,
    location: 'YARD-01',
    qty: 140,
    fob: 1_214, // + 176 = 1,390 landed
    charges: [
      ['OCEAN', 102],
      ['INLAND', 28],
      ['DUTY', 36],
      ['PORT', 10],
    ],
    onHand: 140,
  },
  {
    item: 'RM-PLT-A572',
    daysAgo: 110,
    location: 'YARD-02',
    qty: 125,
    fob: 1_228, // + 212 = 1,440 landed
    charges: [
      ['OCEAN', 132],
      ['INLAND', 30],
      ['DUTY', 37],
      ['PORT', 13],
    ],
    onHand: 125,
  },
  {
    item: 'RM-PLT-A572',
    daysAgo: 60,
    location: 'YARD-02',
    qty: 150,
    fob: 1_244, // + 187 = 1,431 landed
    charges: [
      ['OCEAN', 110],
      ['INLAND', 29],
      ['DUTY', 37],
      ['PORT', 11],
    ],
    onHand: 150,
  },
  {
    item: 'RM-PLT-A572',
    daysAgo: 15,
    location: 'YARD-01',
    qty: 135,
    fob: 1_258, // + 208 = 1,466 landed
    charges: [
      ['OCEAN', 126],
      ['INLAND', 31],
      ['DUTY', 38],
      ['PORT', 13],
    ],
    onHand: 135,
  },
  // --- RM-BAR-FLG Flange bar, 270-day mill cert review -----------------------
  // Nothing here is near review; the contrast with the plate is the point, and
  // there is enough of it that plate stays the material that drives the plan.
  {
    item: 'RM-BAR-FLG',
    daysAgo: 120,
    location: 'YARD-02',
    qty: 110,
    fob: 1_392, // + 172 = 1,564 landed
    charges: [
      ['OCEAN', 104],
      ['INLAND', 24],
      ['DUTY', 35],
      ['PORT', 9],
    ],
    onHand: 90,
  },
  {
    item: 'RM-BAR-FLG',
    daysAgo: 35,
    location: 'YARD-01',
    qty: 120,
    fob: 1_440, // + 191 = 1,631 landed
    charges: [
      ['OCEAN', 118],
      ['INLAND', 26],
      ['DUTY', 37],
      ['PORT', 10],
    ],
    onHand: 110,
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
 * that quotes "125 t reaching its mill cert review tomorrow" needs that to be
 * 125 t every time it is run. Every other batch is depleted by the turnover
 * model in data/productionSeed.ts instead.
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
 * the pipeline always stretches into the future. Vendor-confirmed mill prices
 * on the same upward drift as the posted receipts; charges are per-unit
 * ESTIMATES (accruals), because nothing has been invoiced yet.
 *
 * These are deliberately NOT part of seedRows(): an expected receipt is not a
 * posted one, and folding them in would move the summary averages, the trend
 * fit and the variance baseline. They surface only through `expectedRows()` and
 * the provider's `expected` result field, and they are the supply side the
 * impact analysis simulates against.
 *
 * PO numbers sit in the 920–949 range: above the inbound anchors (900–918),
 * below both generated ranges.
 */
const EXPECTED_ORDERS: {
  item: string
  po: string
  /** Vendor account. Defaults to the lead mill V4001 Harrowfield Plate Steel. */
  vendorId?: string
  /** Confirmed delivery, days after today. */
  daysOut: number
  qty: number
  fob: number
  /** Per unit, estimated. */
  charges: [string, number][]
}[] = [
  // --- RM-PLT-A572 Steel plate: one vessel roughly every week ----------------
  {
    item: 'RM-PLT-A572',
    po: 'PO-000920',
    daysOut: 6,
    qty: 150,
    fob: 1_262,
    charges: [
      ['OCEAN', 122],
      ['INLAND', 30],
      ['DUTY', 38],
      ['PORT', 12],
    ],
  },
  {
    item: 'RM-PLT-A572',
    po: 'PO-000926',
    daysOut: 13,
    qty: 130,
    fob: 1_268,
    charges: [
      ['OCEAN', 126],
      ['INLAND', 31],
      ['DUTY', 38],
      ['PORT', 12],
    ],
  },
  {
    item: 'RM-PLT-A572',
    po: 'PO-000931',
    daysOut: 20,
    qty: 160,
    fob: 1_266,
    charges: [
      ['OCEAN', 128],
      ['INLAND', 31],
      ['DUTY', 38],
      ['PORT', 13],
    ],
  },
  {
    item: 'RM-PLT-A572',
    po: 'PO-000938',
    daysOut: 27,
    qty: 140,
    fob: 1_275,
    charges: [
      ['OCEAN', 130],
      ['INLAND', 31],
      ['DUTY', 39],
      ['PORT', 13],
    ],
  },
  // --- RM-BAR-FLG Flange bar: two mill loads and one spot top-up -------------
  // PO-000946 is the dual-sourcing story in one row: Marland delivers in 5 days
  // at a mill price ~7% over the Harrowfield loads either side of it. Same bar,
  // different pipeline — the premium is the price of speed.
  {
    item: 'RM-BAR-FLG',
    po: 'PO-000946',
    vendorId: 'V4003',
    daysOut: 5,
    qty: 45,
    fob: 1_565,
    charges: [
      ['OCEAN', 118],
      ['INLAND', 26],
      ['DUTY', 37],
      ['PORT', 10],
    ],
  },
  {
    item: 'RM-BAR-FLG',
    po: 'PO-000944',
    daysOut: 11,
    qty: 70,
    fob: 1_458,
    charges: [
      ['OCEAN', 120],
      ['INLAND', 26],
      ['DUTY', 38],
      ['PORT', 10],
    ],
  },
  {
    item: 'RM-BAR-FLG',
    po: 'PO-000949',
    daysOut: 23,
    qty: 80,
    fob: 1_466,
    charges: [
      ['OCEAN', 122],
      ['INLAND', 27],
      ['DUTY', 38],
      ['PORT', 11],
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

function buildProductionAnchors(today: string): ReceiptRow[] {
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
      receiptDate: addDaysIso(today, -a.daysAgo),
      itemNumber: item.itemNumber,
      productName: item.productName,
      vendorAccount: '',
      vendorName: '',
      siteId: a.siteId,
      warehouseId: a.warehouseId,
      locationId: 'FG-01',
      batchNumber: anchorBatch(a.item, a.daysAgo, today),
      sourceItemNumber: a.sourceItem,
      sourceBatchNumber: anchorBatch(a.sourceItem, a.sourceDaysAgo, today),
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
 * A load usually carries two heats of the same grade and occasionally mixes
 * plate and bar on one consolidated booking, because the mills roll both. Header
 * charges are allocated across ALL lines of the order, which is what makes the
 * per-unit add-on cost move between receipts of the same item at the same FOB
 * price — a second, larger heat on the order dilutes the first one's share.
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
  // alternates instead of scattering it across the whole vendor list. The
  // funnelling is a pure remap: it consumes no PRNG draws and changes no dates,
  // quantities or draw-derived prices, so no other item's figures move.
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
    // Mills quote steel in whole dollars a ton; cents only on the cheap items.
    const price = round(
      item.basePurchasePrice! * drift * season * (0.94 + rnd() * 0.12),
      item.basePurchasePrice! >= 100 ? 0 : 2,
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
      l.price = round(l.price * premium, 0)
      l.netAmount = l.quantity * l.price
    }
  }

  const goodsValue = lines.reduce((s, l) => s + l.netAmount, 0)

  // A charge only applies when every line on the order attracts it — a mixed
  // steel and consumables load gets inland freight but no ocean leg or duty.
  const tags = lines
    .map((l) => new Set(l.item.chargeTags ?? []))
    .reduce((acc, s) => new Set([...acc].filter((t) => s.has(t))))

  const applicable = CHARGE_CATALOG.filter((c) => tags.has(c.tag))
  // An import always pays its freight legs, duty and port handling; only the
  // inspection and a demurrage bill come and go, so the spread between loads
  // is mostly what the ocean rate did.
  const chosen = applicable.filter(
    (c) =>
      !OPTIONAL_CHARGES.has(c.code) || rnd() < (c.code === 'DEMUR' ? 0.22 : 0.7),
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

  // Occasionally an incoming heat is held for an ultrasonic test before it is
  // released, and the test is charged to the line.
  if (tags.has('mill') && rnd() < 0.18) {
    const amount = round(lines[0].netAmount * 0.004)
    perLineCharges[0].push({
      chargeCode: 'UTTEST',
      description: 'Ultrasonic plate test',
      chargeType: 'Financial',
      source: 'Line',
      amount,
      amountPerUnit: amount / lines[0].quantity,
    })
  }

  // One delivery point per order, taken from the item that drove it. A single
  // configured option is used as-is rather than drawn for, so each focus raw
  // material always lands in the plate yard without touching the PRNG.
  const recvOptions = primary.receiving ?? [DEFAULT_RECEIVING]
  const recv =
    recvOptions.length === 1
      ? recvOptions[0]
      : recvOptions[Math.floor(rnd() * recvOptions.length)]

  return lines.map((l, idx) => {
    const locations = receivingLocations(l.item)
    // A rider line with exactly one receiving point of its own is delivered
    // there (a line-level delivery address). No draw: single options only.
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
  // Wheels are built in tens, not case-hundreds.
  const quantity = Math.max(10, Math.floor(consumed / quantityPer / 5) * 5)

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

  // A fifth of the volume is built at the Asia Plant.
  const atAsiaPlant = rnd() < 0.2
  const home = item.production ?? { siteId: 'PLT-W', warehouseId: 'PLTW-FG' }

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
    siteId: atAsiaPlant ? ASIA_BUILD.siteId : home.siteId,
    warehouseId: atAsiaPlant ? ASIA_BUILD.warehouseId : home.warehouseId,
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
 * re-priced without moving a single figure the demo script quotes.
 */
export function seedRows(): ReceiptRow[] {
  if (cached) return cached

  const today = todayIso()

  const lot = lotIssuer([
    ...PURCHASE_ANCHORS.map((a) => anchorBatch(a.item, a.daysAgo, today)),
    ...PRODUCTION_ANCHORS.map((a) => anchorBatch(a.item, a.daysAgo, today)),
    ...INBOUND_ANCHORS.map((a) => inboundBatch(a, today)),
  ])

  const purchaseAnchors = buildPurchaseAnchors(today)
  // Deliberately NOT handed to buildForItems as feedstock: these lots are the
  // stock the production plan is allowed to spend, so no generated production
  // order may quietly consume them first.
  const inboundAnchors = buildInboundAnchors(today)

  const focus = buildForItems(
    mulberry32(0x4e575248), // "NWRH"
    lot,
    today,
    FOCUS_ITEMS,
    VENDORS,
    { po: 300, receipt: 106_000, prod: 400 },
    30,
    20,
    // The anchor receipts are real inventory too — a production run may consume
    // one, which is exactly what the wheel anchors do.
    purchaseAnchors,
  )

  const filler = buildForItems(
    mulberry32(0x4e575247), // "NWRG"
    lot,
    today,
    FILLER_ITEMS,
    FILLER_VENDORS,
    { po: 2_000, receipt: 300_000, prod: 5_000 },
    9,
    8,
    // Rim bases and service rings are cut from the same plate and bar as the
    // wheels. They only read those receipts, so the focus figures cannot move.
    [...purchaseAnchors, ...focus.purchases],
  )

  const rows = [
    ...purchaseAnchors,
    ...inboundAnchors,
    ...focus.purchases,
    ...filler.purchases,
    ...buildProductionAnchors(today),
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

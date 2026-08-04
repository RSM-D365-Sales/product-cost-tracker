import type { BatchOnHand, CostGroup, ProductionLine } from '../types/production'
import type { CatalogItem } from './seed'
import { ITEMS, explicitOnHand, itemByNumber, seedRows } from './seed'
import { addDaysIso } from '../lib/format'
import { dayNumber } from '../lib/trend'

/**
 * Manufacturing master data for the production cost inquiry: shelf lives, bills
 * of material, routes, production lines, and the derivation of what is actually
 * on hand right now.
 *
 * Kept out of seed.ts on purpose. seed.ts owns the hand-authored figures the
 * demo script quotes and the two PRNG streams that must never move; everything
 * here is layered on top of the receipts it already produces, so a change in
 * this file cannot shift a single number on the product cost inquiry.
 *
 * The one rule this file follows: on-hand inventory is DERIVED from receipts,
 * never invented. A lot exists because a product receipt or a report-as-finished
 * created it, it is valued at that receipt's landed cost, and it expires a shelf
 * life after that receipt's date. That is what makes the two pages agree.
 */

// ---------------------------------------------------------------------------
// Shelf life and stock turn
// ---------------------------------------------------------------------------

/**
 * Days from receipt to expiry. Only batch-tracked items carry one; packaging is
 * bought to a min/max, is not lot controlled, and does not go off.
 *
 * These are the numbers the whole plan turns on. Bulk avocados at 21 days are
 * the reason the FEFO ordering matters; black beans at two years are the
 * contrast that shows it is shelf life, not quantity, doing the work.
 */
const SHELF_LIFE_DAYS: Record<string, number> = {
  // Focus items
  F440: 21,
  RAW541: 730,
  FG816: 14,
  FG841: 1095,
  // Background produce, dry goods and ingredients
  F410: 12, // Bulk Mangos
  F460: 24, // Bulk Limes
  RAW512: 730,
  RAW566: 730,
  RAW580: 540,
  ING220: 545, // Olive oil
  ING305: 400, // Tomato puree
  ING410: 1_825, // Sea salt
  ING455: 730, // Seasoning blend
  FG802: 1095,
  FG825: 1095,
  FG860: 365,
  FG874: 548,
  FG892: 545,
}

/**
 * How long a lot of this item typically sits before it is fully issued. Used to
 * deplete the historical receipts: a lot received `turnDays` ago or longer has
 * been consumed, a lot received half that long ago is half gone.
 *
 * This is a modelling shortcut and the only place in the app where on-hand is
 * not a strict receipts-minus-issues figure — the seed has no sales orders or
 * inventory journals to net against, so stock turn stands in for them. The
 * hand-authored inbound lots override it (see seed.ts `explicitOnHand`), which
 * is why the lots the plan actually consumes are exact.
 */
const TURN_DAYS_DEFAULT: Record<CatalogItem['kind'], number> = {
  raw: 45,
  packaging: 120,
  finished: 30,
}

const TURN_DAYS: Record<string, number> = {
  F440: 24,
  RAW541: 70,
  FG816: 16,
  FG841: 60,
}

export function shelfLifeOf(itemNumber: string): number | undefined {
  return SHELF_LIFE_DAYS[itemNumber]
}

export function turnDaysOf(item: CatalogItem): number {
  return TURN_DAYS[item.itemNumber] ?? TURN_DAYS_DEFAULT[item.kind]
}

/** Batch-tracked items are lot controlled, expire, and constrain the plan. */
export function isBatchTracked(item: CatalogItem): boolean {
  return item.kind !== 'packaging'
}

/** A lot inside this many days of expiry is called out rather than just listed. */
export const EXPIRING_WITHIN_DAYS = 7

// ---------------------------------------------------------------------------
// Bills of material and routes
// ---------------------------------------------------------------------------

export interface BomSpecComponent {
  lineNumber: number
  itemNumber: string
  /** Used only when the component is not a catalogued item (derived BOMs). */
  productName?: string
  quantityPer: number
  unit: string
  /** Fraction. D365 BOM line "Scrap %". */
  scrapPercent: number
  costGroup: CostGroup
  /**
   * Unit cost for a component that is not a catalogued item, so the costing has
   * something to price it at. Only the derived BOMs use this.
   */
  unitCostOverride?: number
}

export interface BomSpecOperation {
  operationNumber: number
  description: string
  resourceId: string
  costGroup: CostGroup
  costPerUnit: number
}

export interface BomSpec {
  bomId: string
  bomVersion: string
  routeId: string
  /** D365 "per series" — the quantity the approved version is expressed for. */
  perSeries: number
  /** Days before today the version was approved. */
  approvedDaysAgo: number
  components: BomSpecComponent[]
  operations: BomSpecOperation[]
}

/**
 * Hand-authored BOMs for the two focus items, at the level of detail a plant
 * would actually maintain: every packaging component is a real released product
 * with its own purchase history, and labour and overhead are split across route
 * operations rather than being one lump.
 *
 * Rolling these up at today's costs does NOT reproduce the conversion cost on
 * the historical production receipts, and that is deliberate. FG816 comes out
 * about 2% above its item cost; FG841 comes out nearly 18% above, because
 * twenty-four cans at today's price cost more than the beans that go in them.
 * The gap between a calculated cost and a stale item cost is the thing a
 * production cost inquiry exists to expose.
 */
const BOM_SPECS: Record<string, BomSpec> = {
  FG816: {
    bomId: 'BOM-FG816',
    bomVersion: 'V3',
    routeId: 'RTE-FG816',
    perSeries: 1_000,
    approvedDaysAgo: 138,
    components: [
      {
        lineNumber: 10,
        itemNumber: 'F440',
        quantityPer: 2.5,
        unit: 'lb',
        // Grading out undersize and blemished fruit off the wash line.
        scrapPercent: 0.03,
        costGroup: 'Material',
      },
      {
        lineNumber: 20,
        itemNumber: 'PKG420',
        quantityPer: 1,
        unit: 'ea',
        scrapPercent: 0.015,
        costGroup: 'Packaging',
      },
      {
        lineNumber: 30,
        itemNumber: 'PKG430',
        quantityPer: 1,
        unit: 'ea',
        scrapPercent: 0.01,
        costGroup: 'Packaging',
      },
      {
        lineNumber: 40,
        itemNumber: 'PKG305',
        // One roll of 4,000 labels covers 4,000 packs.
        quantityPer: 0.00025,
        unit: 'ea',
        scrapPercent: 0,
        costGroup: 'Packaging',
      },
    ],
    operations: [
      {
        operationNumber: 10,
        description: 'Wash, grade and size',
        resourceId: 'PACK-01',
        costGroup: 'Labour',
        costPerUnit: 0.11,
      },
      {
        operationNumber: 20,
        description: 'Pack line — bag, tray and seal',
        resourceId: 'PACK-01',
        costGroup: 'Labour',
        costPerUnit: 0.27,
      },
      {
        operationNumber: 30,
        description: 'Production overhead',
        resourceId: 'PACK-01',
        costGroup: 'Overhead',
        costPerUnit: 0.22,
      },
      {
        operationNumber: 40,
        description: 'Quality and food safety',
        resourceId: 'QA-01',
        costGroup: 'Overhead',
        costPerUnit: 0.06,
      },
    ],
  },

  FG841: {
    bomId: 'BOM-FG841',
    bomVersion: 'V2',
    routeId: 'RTE-FG841',
    perSeries: 500,
    approvedDaysAgo: 402,
    components: [
      {
        lineNumber: 10,
        itemNumber: 'RAW541',
        quantityPer: 6,
        unit: 'lb',
        scrapPercent: 0.02,
        costGroup: 'Material',
      },
      {
        lineNumber: 20,
        itemNumber: 'PKG101',
        quantityPer: 24,
        unit: 'ea',
        // Seamer rejects and dented ends.
        scrapPercent: 0.012,
        costGroup: 'Packaging',
      },
      {
        lineNumber: 30,
        itemNumber: 'PKG210',
        quantityPer: 1,
        unit: 'ea',
        scrapPercent: 0.005,
        costGroup: 'Packaging',
      },
      {
        lineNumber: 40,
        itemNumber: 'PKG305',
        // 24 labels off a 12,000-label roll.
        quantityPer: 0.002,
        unit: 'ea',
        scrapPercent: 0,
        costGroup: 'Packaging',
      },
    ],
    operations: [
      {
        operationNumber: 10,
        description: 'Soak, rinse and blanch',
        resourceId: 'RETORT-01',
        costGroup: 'Labour',
        costPerUnit: 0.31,
      },
      {
        operationNumber: 20,
        description: 'Fill, seam and retort',
        resourceId: 'RETORT-01',
        costGroup: 'Labour',
        costPerUnit: 0.64,
      },
      {
        operationNumber: 30,
        description: 'Production overhead — retort',
        resourceId: 'RETORT-01',
        costGroup: 'Overhead',
        costPerUnit: 0.45,
      },
      {
        operationNumber: 40,
        description: 'Quality and food safety',
        resourceId: 'QA-01',
        costGroup: 'Overhead',
        costPerUnit: 0.1,
      },
    ],
  },
}

/** Maps a background item's conversion charge codes onto BOM/route structure. */
const DERIVED_PACKAGING_CODES = new Set(['PACK', 'CAN', 'LABEL'])
const DERIVED_OVERHEAD_CODES = new Set(['OVHD', 'QA'])

/**
 * A BOM for a background finished good, derived from the same conversion specs
 * its production receipts were costed with.
 *
 * Coarser than the hand-authored pair on purpose — the packaging lines are one
 * "set" per finished unit rather than a real component item and pack ratio,
 * because nothing in the demo inspects them and inventing pack ratios for five
 * background products would be five more things that could be wrong. What it
 * does guarantee is that the roll-up ties exactly to the item's own production
 * receipts, so a prospect who types FG802 gets a page that is internally
 * consistent rather than an empty one.
 */
function deriveBomSpec(item: CatalogItem): BomSpec {
  const components: BomSpecComponent[] = []
  const operations: BomSpecOperation[] = []

  if (item.bom) {
    const raw = itemByNumber(item.bom.itemNumber)
    components.push({
      lineNumber: 10,
      itemNumber: item.bom.itemNumber,
      quantityPer: item.bom.quantityPer,
      unit: raw?.unit ?? 'ea',
      scrapPercent: 0.02,
      costGroup: 'Material',
    })
  }

  let componentLine = 20
  let operationNumber = 10

  for (const spec of item.conversion ?? []) {
    if (DERIVED_PACKAGING_CODES.has(spec.code)) {
      components.push({
        lineNumber: componentLine,
        itemNumber: spec.code,
        productName: spec.description,
        quantityPer: 1,
        unit: 'set',
        scrapPercent: 0,
        costGroup: 'Packaging',
        unitCostOverride: spec.perUnit,
      })
      componentLine += 10
    } else {
      operations.push({
        operationNumber,
        description: spec.description,
        resourceId: DERIVED_OVERHEAD_CODES.has(spec.code) ? 'OVHD-01' : 'PROD-01',
        costGroup: DERIVED_OVERHEAD_CODES.has(spec.code) ? 'Overhead' : 'Labour',
        costPerUnit: spec.perUnit,
      })
      operationNumber += 10
    }
  }

  return {
    bomId: `BOM-${item.itemNumber}`,
    bomVersion: 'V1',
    routeId: `RTE-${item.itemNumber}`,
    perSeries: 100,
    approvedDaysAgo: 260,
    components,
    operations,
  }
}

/** The approved BOM and route for a produced item. */
export function bomSpecFor(item: CatalogItem): BomSpec {
  return BOM_SPECS[item.itemNumber] ?? deriveBomSpec(item)
}

// ---------------------------------------------------------------------------
// Production lines
// ---------------------------------------------------------------------------

/**
 * `hoursPerDay` is hours COMMITTED to this item family, not hours the line
 * exists for. A pack line that also runs three other SKUs cannot give the
 * avocado plan sixteen hours, and committed hours is the number a planner
 * actually negotiates — which is why it is the knob the page exposes.
 *
 * The co-pack line is off by default. Turning it on is what rescues the oldest
 * avocado lot from being written off, and is the moment the demo is built
 * around: the plan quantifies the spoilage, and the parameters fix it.
 */
export const PRODUCTION_LINES: ProductionLine[] = [
  {
    lineId: 'PL-AV1',
    name: 'Avocado pack line 1',
    siteId: '2',
    warehouseId: '26',
    itemNumbers: ['FG816'],
    unitsPerHour: 1_200,
    hoursPerDay: 6,
    setupHours: 0.75,
    enabledByDefault: true,
  },
  {
    lineId: 'PL-AV2',
    name: 'Avocado pack line 2',
    siteId: '2',
    warehouseId: '26',
    itemNumbers: ['FG816'],
    unitsPerHour: 900,
    hoursPerDay: 4,
    setupHours: 0.75,
    enabledByDefault: true,
  },
  {
    lineId: 'PL-CP1',
    name: 'Co-pack line — Co-pack facility',
    siteId: '3',
    warehouseId: '31',
    itemNumbers: ['FG816'],
    unitsPerHour: 600,
    hoursPerDay: 10,
    setupHours: 1.5,
    enabledByDefault: false,
  },
  {
    lineId: 'PL-RT1',
    name: 'Retort line 1',
    siteId: '2',
    warehouseId: '26',
    itemNumbers: ['FG841'],
    unitsPerHour: 400,
    hoursPerDay: 10,
    setupHours: 2,
    enabledByDefault: true,
  },
  {
    lineId: 'PL-RT2',
    name: 'Retort line 2',
    siteId: '2',
    warehouseId: '26',
    itemNumbers: ['FG841'],
    unitsPerHour: 300,
    hoursPerDay: 6,
    setupHours: 2,
    enabledByDefault: true,
  },
  // Background finished goods share two general-purpose lines rather than each
  // getting authored capacity of its own.
  {
    lineId: 'PL-GP1',
    name: 'General packing line 1',
    siteId: '2',
    warehouseId: '26',
    itemNumbers: ['FG802', 'FG825', 'FG860', 'FG874', 'FG892'],
    unitsPerHour: 500,
    hoursPerDay: 8,
    setupHours: 1,
    enabledByDefault: true,
  },
  {
    lineId: 'PL-GP2',
    name: 'General packing line 2',
    siteId: '1',
    warehouseId: '11',
    itemNumbers: ['FG802', 'FG825', 'FG860', 'FG874', 'FG892'],
    unitsPerHour: 350,
    hoursPerDay: 6,
    setupHours: 1,
    enabledByDefault: true,
  },
]

export function linesForItem(itemNumber: string, siteId?: string): ProductionLine[] {
  return PRODUCTION_LINES.filter(
    (l) =>
      l.itemNumbers.includes(itemNumber) && (!siteId || l.siteId === siteId),
  )
}

// ---------------------------------------------------------------------------
// On-hand inventory
// ---------------------------------------------------------------------------

const daysBetween = (from: string, to: string): number =>
  dayNumber(to) - dayNumber(from)

/**
 * How much of each raw-material lot the posted production orders already ate.
 *
 * A production receipt records the batch it consumed and the quantity it
 * produced; multiplying that quantity by the BOM ratio gives back the material
 * it drew. The historical generator predates the scrap percentages above and
 * consumed at the net ratio, so this uses the net ratio too — netting at a
 * ratio the receipts were never costed at would make lots go negative.
 */
function consumedByProduction(): Map<string, number> {
  const consumed = new Map<string, number>()

  for (const row of seedRows()) {
    if (row.sourceType !== 'Production') continue
    if (!row.sourceBatchNumber) continue

    const fg = itemByNumber(row.itemNumber)
    const quantityPer = fg?.bom?.quantityPer
    if (!quantityPer) continue

    const key = row.sourceBatchNumber
    consumed.set(key, (consumed.get(key) ?? 0) + row.quantityReceived * quantityPer)
  }

  return consumed
}

let onHandCache: { asOf: string; batches: BatchOnHand[] } | null = null

/**
 * Every lot with stock on it, as at `asOf`, valued at the landed cost of the
 * receipt that created it.
 *
 * Returned in FEFO order — earliest expiry first — because that is the order the
 * planner consumes them in and the order a warehouse supervisor wants to read.
 */
export function onHandBatches(asOf: string): BatchOnHand[] {
  if (onHandCache?.asOf === asOf) return onHandCache.batches

  const consumed = consumedByProduction()
  const explicit = explicitOnHand()
  const batches: BatchOnHand[] = []

  for (const row of seedRows()) {
    if (!row.batchNumber) continue

    const item = itemByNumber(row.itemNumber)
    if (!item || !isBatchTracked(item)) continue

    const age = daysBetween(row.receiptDate, asOf)
    // Receipts dated after the plan start have not happened yet.
    if (age < 0) continue

    let quantity: number
    const stated = explicit.get(row.batchNumber)
    if (stated !== undefined) {
      quantity = stated
    } else {
      const residual = Math.max(0, 1 - age / turnDaysOf(item))
      quantity = row.quantityReceived * residual - (consumed.get(row.batchNumber) ?? 0)
    }

    quantity = Math.round(Math.max(0, quantity))
    if (quantity <= 0) continue

    const shelfLife = shelfLifeOf(row.itemNumber)
    // An item with no shelf life maintained still needs a date to sort on; ten
    // years out keeps it behind everything real without special-casing.
    const expiryDate = addDaysIso(row.receiptDate, shelfLife ?? 3_650)
    const daysToExpiry = daysBetween(asOf, expiryDate)

    batches.push({
      id: `${row.itemNumber}|${row.batchNumber}`,
      itemNumber: row.itemNumber,
      productName: row.productName,
      batchNumber: row.batchNumber,
      siteId: row.siteId,
      warehouseId: row.warehouseId,
      locationId: row.locationId,
      quantity,
      unit: row.unit,
      receiptDate: row.receiptDate,
      expiryDate,
      daysToExpiry,
      status:
        daysToExpiry < 0
          ? 'Expired'
          : daysToExpiry <= EXPIRING_WITHIN_DAYS
            ? 'Expiring'
            : 'Available',
      landedCost: row.landedCost,
      inventoryValue: quantity * row.landedCost,
      currency: row.currency,
      receiptNumber: row.receiptNumber,
      orderNumber: row.purchaseOrderNumber,
      sourceType: row.sourceType ?? 'Purchase',
    })
  }

  batches.sort((a, b) =>
    a.expiryDate === b.expiryDate
      ? a.batchNumber < b.batchNumber
        ? -1
        : 1
      : a.expiryDate < b.expiryDate
        ? -1
        : 1,
  )

  onHandCache = { asOf, batches }
  return batches
}

/** Produced items, for the item lookup on the production page. */
export function producedItems(): CatalogItem[] {
  return ITEMS.filter((i) => i.kind === 'finished')
}

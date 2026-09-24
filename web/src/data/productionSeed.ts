import type { BatchOnHand, CostGroup, ProductionLine } from '../types/production'
import type { CatalogItem } from './seed'
import { ITEMS, explicitOnHand, itemByNumber, seedRows } from './seed'
import { addDaysIso } from '../lib/format'
import { dayNumber } from '../lib/trend'
import { costGroupOfConversionCode } from '../lib/variance'

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
 * These are the numbers the whole plan turns on. Blueberries at 21 days are
 * the reason the FEFO ordering matters; Honeycrisp at 120 days out of CA
 * storage are the contrast that shows it is shelf life, not quantity, doing
 * the work. Figures follow Bluestem's item master (items.csv).
 */
const SHELF_LIFE_DAYS: Record<string, number> = {
  // Focus items
  'RAW-BLU': 21,
  'RAW-APL-HC': 120,
  'PK-BLU-PINT': 12,
  'FC-APL-SLC-2OZ': 18,
  // Background produce and ingredients
  'RAW-APL-GA': 120,
  'RAW-ROM': 14,
  'RAW-CUC': 14,
  'RAW-PEP': 14,
  'RAW-ASP': 14,
  'RAW-SQB': 90,
  'ING-ASCORB': 365,
  'ING-DIP-RANCH': 60,
  'ING-CAESAR-KIT': 120,
  // Background finished goods
  'PK-APL-GA-3LB': 45,
  'PK-ASP-1LB': 10,
  'PK-CUC-SLC': 12,
  'FC-SAL-ROM-CHOP': 12,
  'FC-VEG-SQB-DICE': 12,
  'FC-PEP-DICE-5LB': 10,
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
  'RAW-BLU': 24,
  'RAW-APL-HC': 70,
  'PK-BLU-PINT': 10,
  'FC-APL-SLC-2OZ': 14,
  // Two-week produce turns inside its shelf life, as it has to.
  'RAW-ROM': 12,
  'RAW-CUC': 12,
  'RAW-PEP': 12,
  'RAW-ASP': 12,
  'PK-ASP-1LB': 8,
  'PK-CUC-SLC': 10,
  'FC-SAL-ROM-CHOP': 10,
  'FC-VEG-SQB-DICE': 10,
  'FC-PEP-DICE-5LB': 8,
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
 * the historical production receipts, and that is deliberate. PK-BLU-PINT
 * comes out close to its item cost; FC-APL-SLC-2OZ comes out well above it,
 * because the fruit on hand today landed dearer than the fruit the cost record
 * was set from, and twenty-four cups and lids to a case are not free either.
 * The gap between a calculated cost and a stale item cost is the thing a
 * production cost inquiry exists to expose.
 */
const BOM_SPECS: Record<string, BomSpec> = {
  'PK-BLU-PINT': {
    bomId: 'BOM-PK-BLU-PINT',
    bomVersion: 'V3',
    routeId: 'RTE-PK-BLU-PINT',
    perSeries: 1_000,
    approvedDaysAgo: 138,
    components: [
      {
        lineNumber: 10,
        itemNumber: 'RAW-BLU',
        quantityPer: 9,
        unit: 'lb',
        // Soft, split and stemmed fruit sorted out on the optical sorter.
        scrapPercent: 0.03,
        costGroup: 'Material',
      },
      {
        lineNumber: 20,
        itemNumber: 'PKG-CLAM-PINT',
        quantityPer: 12,
        unit: 'ea',
        scrapPercent: 0.015,
        costGroup: 'Packaging',
      },
      {
        lineNumber: 30,
        itemNumber: 'PKG-CTN-RSC-12',
        quantityPer: 1,
        unit: 'ea',
        scrapPercent: 0.01,
        costGroup: 'Packaging',
      },
      {
        lineNumber: 40,
        itemNumber: 'PKG-LBL-CASE',
        // One case label off a roll of 4,000.
        quantityPer: 0.00025,
        unit: 'ea',
        scrapPercent: 0,
        costGroup: 'Packaging',
      },
    ],
    operations: [
      {
        operationNumber: 10,
        description: 'Receive, pre-cool and optical sort',
        resourceId: 'HRT-P2',
        costGroup: 'Labour',
        costPerUnit: 0.42,
      },
      {
        operationNumber: 20,
        description: 'Pack line — fill, lid and case',
        resourceId: 'HRT-P2',
        costGroup: 'Labour',
        costPerUnit: 0.88,
      },
      {
        operationNumber: 30,
        description: 'Production overhead',
        resourceId: 'HRT-P2',
        costGroup: 'Overhead',
        costPerUnit: 0.75,
      },
      {
        operationNumber: 40,
        description: 'Quality and food safety',
        resourceId: 'QA-HRT',
        costGroup: 'Overhead',
        costPerUnit: 0.18,
      },
    ],
  },

  'FC-APL-SLC-2OZ': {
    bomId: 'BOM-FC-APL-SLC-2OZ',
    bomVersion: 'V2',
    routeId: 'RTE-FC-APL-SLC-2OZ',
    perSeries: 500,
    approvedDaysAgo: 402,
    components: [
      {
        lineNumber: 10,
        itemNumber: 'RAW-APL-HC',
        quantityPer: 4,
        unit: 'lb',
        scrapPercent: 0.02,
        costGroup: 'Material',
      },
      {
        lineNumber: 20,
        itemNumber: 'PKG-CUP-2OZ',
        quantityPer: 24,
        unit: 'ea',
        // Fill-and-seal rejects and mis-seated lids.
        scrapPercent: 0.012,
        costGroup: 'Packaging',
      },
      {
        lineNumber: 30,
        itemNumber: 'PKG-CTN-RSC-24',
        quantityPer: 1,
        unit: 'ea',
        scrapPercent: 0.005,
        costGroup: 'Packaging',
      },
      {
        lineNumber: 40,
        itemNumber: 'PKG-LBL-CASE',
        // One case label off a roll of 4,000.
        quantityPer: 0.00025,
        unit: 'ea',
        scrapPercent: 0,
        costGroup: 'Packaging',
      },
    ],
    operations: [
      {
        operationNumber: 10,
        description: 'Wash, core and slice',
        resourceId: 'GRP-L1',
        costGroup: 'Labour',
        costPerUnit: 0.42,
      },
      {
        operationNumber: 20,
        description: 'Anti-browning dip, fill and lid',
        resourceId: 'GRP-L1',
        costGroup: 'Labour',
        costPerUnit: 0.68,
      },
      {
        operationNumber: 30,
        description: 'Production overhead — slicing line',
        resourceId: 'GRP-L1',
        costGroup: 'Overhead',
        costPerUnit: 0.62,
      },
      {
        operationNumber: 40,
        description: 'Quality and food safety',
        resourceId: 'QA-GRP',
        costGroup: 'Overhead',
        costPerUnit: 0.12,
      },
    ],
  },
}

/**
 * A BOM for a background finished good, derived from the same conversion specs
 * its production receipts were costed with.
 *
 * Coarser than the hand-authored pair on purpose — the packaging lines are one
 * "set" per finished unit rather than a real component item and pack ratio,
 * because nothing in the demo inspects them and inventing pack ratios for six
 * background products would be six more things that could be wrong. What it
 * does guarantee is that the roll-up ties exactly to the item's own production
 * receipts, so a prospect who types PK-CUC-SLC gets a page that is internally
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

  // The code-to-group mapping is the same one the variance analysis reads a
  // posted run with, so a derived BOM plans a cost in the exact group the
  // actuals will land in.
  for (const spec of item.conversion ?? []) {
    const group = costGroupOfConversionCode(spec.code)
    if (group === 'Packaging') {
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
        resourceId: group === 'Overhead' ? 'OVHD-01' : 'PROD-01',
        costGroup: group,
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
 * exists for. A pack line that also runs cherries cannot give the blueberry
 * plan sixteen hours, and committed hours is the number a planner actually
 * negotiates — which is why it is the knob the page exposes. Line ids and
 * names follow Bluestem's production_lines.csv where the line exists there.
 *
 * The co-pack line is off by default. Turning it on is what rescues the oldest
 * blueberry lot from being written off, and is the moment the demo is built
 * around: the plan quantifies the spoilage, and the parameters fix it.
 */
export const PRODUCTION_LINES: ProductionLine[] = [
  {
    lineId: 'HRT-P2',
    name: 'Berry & Cherry Pack Line',
    siteId: 'HRT',
    warehouseId: 'HRT-FG',
    itemNumbers: ['PK-BLU-PINT'],
    unitsPerHour: 330,
    hoursPerDay: 6,
    setupHours: 0.75,
    enabledByDefault: true,
  },
  {
    lineId: 'HRT-P3',
    name: 'Berry Pack Line 2 (seasonal)',
    siteId: 'HRT',
    warehouseId: 'HRT-FG',
    itemNumbers: ['PK-BLU-PINT'],
    unitsPerHour: 250,
    hoursPerDay: 4,
    setupHours: 0.75,
    enabledByDefault: true,
  },
  {
    lineId: 'HOL-CP1',
    name: 'Co-pack line — Holland DC',
    siteId: 'HOL',
    warehouseId: 'HOL-CP',
    itemNumbers: ['PK-BLU-PINT'],
    unitsPerHour: 170,
    hoursPerDay: 10,
    setupHours: 1.5,
    enabledByDefault: false,
  },
  {
    lineId: 'GRP-L1',
    name: 'Apple Slicing Line 1',
    siteId: 'GRP',
    warehouseId: 'GRP-FG',
    itemNumbers: ['FC-APL-SLC-2OZ'],
    unitsPerHour: 420,
    hoursPerDay: 10,
    setupHours: 1,
    enabledByDefault: true,
  },
  {
    lineId: 'GRP-L2',
    name: 'Apple Slicing Line 2',
    siteId: 'GRP',
    warehouseId: 'GRP-FG',
    itemNumbers: ['FC-APL-SLC-2OZ'],
    unitsPerHour: 420,
    hoursPerDay: 6,
    setupHours: 1,
    enabledByDefault: true,
  },
  // Background finished goods share Bluestem's other lines rather than each
  // getting authored capacity of its own.
  {
    lineId: 'GRP-L3',
    name: 'Vegetable Dice & Blend Line',
    siteId: 'GRP',
    warehouseId: 'GRP-FG',
    itemNumbers: ['FC-VEG-SQB-DICE', 'FC-PEP-DICE-5LB', 'PK-CUC-SLC'],
    unitsPerHour: 300,
    hoursPerDay: 8,
    setupHours: 1,
    enabledByDefault: true,
  },
  {
    lineId: 'GRP-L4',
    name: 'Salad Kit Line',
    siteId: 'GRP',
    warehouseId: 'GRP-FG',
    itemNumbers: ['FC-SAL-ROM-CHOP'],
    unitsPerHour: 360,
    hoursPerDay: 8,
    setupHours: 1,
    enabledByDefault: true,
  },
  {
    lineId: 'HRT-P1',
    name: 'Apple Pack Line',
    siteId: 'HRT',
    warehouseId: 'HRT-FG',
    itemNumbers: ['PK-APL-GA-3LB', 'PK-ASP-1LB'],
    unitsPerHour: 600,
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

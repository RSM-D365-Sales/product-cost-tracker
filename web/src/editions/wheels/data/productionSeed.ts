import type { BatchOnHand, CostGroup, ProductionLine } from '../../../types/production'
import type { CatalogItem } from './seed'
import { ITEMS, explicitOnHand, itemByNumber, seedRows } from './seed'
import { addDaysIso } from '../../../lib/format'
import { dayNumber } from '../../../lib/trend'
import { costGroupOfConversionCode } from '../lib/variance'

/**
 * Manufacturing master data for the wheels edition's production cost inquiry:
 * mill cert review windows, bills of material, routes, wheel cells, and the
 * derivation of what is actually on hand right now.
 *
 * Kept out of seed.ts on purpose. seed.ts owns the hand-authored figures and the
 * two PRNG streams; everything here is layered on top of the receipts it
 * already produces, so a change in this file cannot shift a single number on the
 * product cost inquiry.
 *
 * The one rule this file follows: on-hand inventory is DERIVED from receipts,
 * never invented. A lot exists because a product receipt or a report-as-finished
 * created it, it is valued at that receipt's landed cost, and its mill cert
 * review falls a fixed window after that receipt's date. That is what makes the
 * two pages agree.
 */

// ---------------------------------------------------------------------------
// Mill cert review and stock turn
// ---------------------------------------------------------------------------

/**
 * Days from receipt to mill certificate review. Steel does not go off, but a
 * heat held past this date needs a re-test before it can be issued to an OTR
 * wheel, so it behaves exactly like a dated lot: the shared `expiry` fields carry
 * the review date. Only the raw steel has one; finished goods and bought-in
 * components are not held against a review date.
 */
const SHELF_LIFE_DAYS: Record<string, number> = {
  'RM-PLT-A572': 180,
  'RM-BAR-FLG': 270,
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
  raw: 90,
  component: 120,
  finished: 30,
}

const TURN_DAYS: Record<string, number> = {
  'RM-BAR-FLG': 120,
  'FG-LR-5129': 45,
  'FG-LR-3525': 45,
  'FG-SR-5129': 45,
}

export function shelfLifeOf(itemNumber: string): number | undefined {
  return SHELF_LIFE_DAYS[itemNumber]
}

export function turnDaysOf(item: CatalogItem): number {
  return TURN_DAYS[item.itemNumber] ?? TURN_DAYS_DEFAULT[item.kind]
}

/** Batch-tracked items are heat controlled and constrain the plan. */
export function isBatchTracked(item: CatalogItem): boolean {
  return item.kind !== 'component'
}

/** A lot inside this many days of its review is called out rather than just listed. */
export const EXPIRING_WITHIN_DAYS = 14

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

/** The rings, seals and consumables every wheel takes, for one wheel size. */
function wheelComponents(
  size: '5129' | '3525',
  consumables: { wire: number; gas: number; primer: number; topcoat: number },
): BomSpecComponent[] {
  const part = (
    lineNumber: number,
    itemNumber: string,
    quantityPer: number,
    unit: string,
    scrapPercent: number,
  ): BomSpecComponent => ({
    lineNumber,
    itemNumber,
    quantityPer,
    unit,
    scrapPercent,
    // The shared "Packaging" cost group; this edition labels it as bought-in
    // components (see COST_GROUP_LABELS in lib/variance.ts).
    costGroup: 'Packaging',
  })

  return [
    part(30, `CMP-LR-${size}`, 1, 'ea', 0.005),
    part(40, `CMP-SR-${size}`, 1, 'ea', 0.005),
    part(50, `CMP-BS-${size}`, 1, 'ea', 0.01),
    part(60, `CMP-OR-${size}`, 1, 'ea', 0.02),
    part(70, 'CMP-VS-OTR', 1, 'ea', 0.01),
    part(80, 'CON-WIRE', consumables.wire, 'kg', 0.05),
    part(90, 'CON-GAS', consumables.gas, 'cyl', 0),
    part(100, 'CON-PRM', consumables.primer, 'L', 0.03),
    part(110, 'CON-TOP', consumables.topcoat, 'L', 0.03),
    part(120, 'CON-CRD', 1, 'ea', 0),
  ]
}

/**
 * Hand-authored BOMs for the two focus wheels, at the level of detail a plant
 * would actually maintain: every bought-in component is a real released product
 * with its own purchase history, and labour and overhead are split across route
 * operations rather than being one lump.
 *
 * Rolling these up at today's costs does NOT reproduce the conversion cost on
 * the historical production receipts, and that is deliberate. Both wheels come
 * out above their item cost, because the plate on hand today landed dearer than
 * the plate the cost record was set from. The gap between a calculated cost and
 * a stale item cost is the thing a production cost inquiry exists to expose.
 */
const BOM_SPECS: Record<string, BomSpec> = {
  'FG-OTR-5129': {
    bomId: 'BOM-FG-OTR-5129',
    bomVersion: 'V3',
    routeId: 'RTE-FG-OTR-5129',
    perSeries: 100,
    approvedDaysAgo: 138,
    components: [
      {
        lineNumber: 10,
        itemNumber: 'RM-PLT-A572',
        quantityPer: 1.18,
        unit: 't',
        // Plate burn-off and rim blank offcut.
        scrapPercent: 0.04,
        costGroup: 'Material',
      },
      {
        lineNumber: 20,
        itemNumber: 'RM-BAR-FLG',
        quantityPer: 0.165,
        unit: 't',
        scrapPercent: 0.03,
        costGroup: 'Material',
      },
      ...wheelComponents('5129', { wire: 20, gas: 0.5, primer: 6, topcoat: 5 }),
    ],
    operations: [
      {
        operationNumber: 10,
        description: 'Cut, form and roll rim base',
        resourceId: 'PLTW-W1',
        costGroup: 'Labour',
        costPerUnit: 168,
      },
      {
        operationNumber: 20,
        description: 'Seam and flange weld',
        resourceId: 'PLTW-W1',
        costGroup: 'Labour',
        costPerUnit: 196,
      },
      {
        operationNumber: 30,
        description: 'Machine bead seat and gutter',
        resourceId: 'PLTW-W1',
        costGroup: 'Labour',
        costPerUnit: 155,
      },
      {
        operationNumber: 40,
        description: 'Fit rings and gauge',
        resourceId: 'PLTW-W1',
        costGroup: 'Labour',
        costPerUnit: 166,
      },
      {
        operationNumber: 50,
        description: 'Shot-blast, prime and topcoat',
        resourceId: 'PLTW-W1',
        costGroup: 'Labour',
        costPerUnit: 88,
      },
      {
        operationNumber: 60,
        description: 'Production overhead',
        resourceId: 'PLTW-W1',
        costGroup: 'Overhead',
        costPerUnit: 246,
      },
      {
        operationNumber: 70,
        description: 'NDT and dimensional inspection',
        resourceId: 'QA-PLTW',
        costGroup: 'Overhead',
        costPerUnit: 36,
      },
    ],
  },

  'FG-OTR-3525': {
    bomId: 'BOM-FG-OTR-3525',
    bomVersion: 'V2',
    routeId: 'RTE-FG-OTR-3525',
    perSeries: 100,
    approvedDaysAgo: 402,
    components: [
      {
        lineNumber: 10,
        itemNumber: 'RM-PLT-A572',
        quantityPer: 0.62,
        unit: 't',
        scrapPercent: 0.04,
        costGroup: 'Material',
      },
      {
        lineNumber: 20,
        itemNumber: 'RM-BAR-FLG',
        quantityPer: 0.08,
        unit: 't',
        scrapPercent: 0.03,
        costGroup: 'Material',
      },
      ...wheelComponents('3525', { wire: 11, gas: 0.3, primer: 3.5, topcoat: 3 }),
    ],
    operations: [
      {
        operationNumber: 10,
        description: 'Cut, form and roll rim base',
        resourceId: 'PLTW-W3',
        costGroup: 'Labour',
        costPerUnit: 96,
      },
      {
        operationNumber: 20,
        description: 'Seam and flange weld',
        resourceId: 'PLTW-W3',
        costGroup: 'Labour',
        costPerUnit: 112,
      },
      {
        operationNumber: 30,
        description: 'Machine bead seat and gutter',
        resourceId: 'PLTW-W3',
        costGroup: 'Labour',
        costPerUnit: 86,
      },
      {
        operationNumber: 40,
        description: 'Fit rings and gauge',
        resourceId: 'PLTW-W3',
        costGroup: 'Labour',
        costPerUnit: 98,
      },
      {
        operationNumber: 50,
        description: 'Shot-blast, prime and topcoat',
        resourceId: 'PLTW-W3',
        costGroup: 'Labour',
        costPerUnit: 56,
      },
      {
        operationNumber: 60,
        description: 'Production overhead',
        resourceId: 'PLTW-W3',
        costGroup: 'Overhead',
        costPerUnit: 144,
      },
      {
        operationNumber: 70,
        description: 'NDT and dimensional inspection',
        resourceId: 'QA-PLTW',
        costGroup: 'Overhead',
        costPerUnit: 22,
      },
    ],
  },
}

/**
 * A BOM for a background finished good, derived from the same conversion specs
 * its production receipts were costed with.
 *
 * Coarser than the hand-authored pair on purpose — the bought-in lines are one
 * "set" per finished unit rather than a real component item and ratio, because
 * nothing in the demo inspects them. What it does guarantee is that the roll-up
 * ties exactly to the item's own production receipts, so a prospect who types
 * FG-RB-5129 gets a page that is internally consistent rather than an empty one.
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
 * `hoursPerDay` is hours COMMITTED to this item family, not hours the cell exists
 * for. A cell that also runs other wheel sizes cannot give this plan sixteen
 * hours, and committed hours is the number a planner actually negotiates — which
 * is why it is the knob the page exposes.
 *
 * The Asia Plant cell is off by default. Turning it on is what rescues the oldest
 * plate heat from going back for re-test, and is the moment the demo is built
 * around: the plan quantifies the exposure, and the parameters fix it.
 */
export const PRODUCTION_LINES: ProductionLine[] = [
  {
    lineId: 'PLTW-W1',
    name: 'Wheel Cell 1 — 51 in',
    siteId: 'PLT-W',
    warehouseId: 'PLTW-FG',
    itemNumbers: ['FG-OTR-5129'],
    unitsPerHour: 3.5,
    hoursPerDay: 9,
    setupHours: 1,
    enabledByDefault: true,
  },
  {
    lineId: 'PLTW-W2',
    name: 'Wheel Cell 2 — 51 in',
    siteId: 'PLT-W',
    warehouseId: 'PLTW-FG',
    itemNumbers: ['FG-OTR-5129'],
    unitsPerHour: 2.5,
    hoursPerDay: 6,
    setupHours: 1,
    enabledByDefault: true,
  },
  {
    lineId: 'PLTA-W1',
    name: 'Wheel cell — Asia Plant',
    siteId: 'PLT-A',
    warehouseId: 'PLTA-FG',
    itemNumbers: ['FG-OTR-5129', 'FG-OTR-3525'],
    unitsPerHour: 1.5,
    hoursPerDay: 10,
    setupHours: 1.5,
    enabledByDefault: false,
  },
  {
    lineId: 'PLTW-W3',
    name: 'Wheel Cell 3 — 35 in',
    siteId: 'PLT-W',
    warehouseId: 'PLTW-FG',
    itemNumbers: ['FG-OTR-3525'],
    unitsPerHour: 8,
    hoursPerDay: 8,
    setupHours: 1,
    enabledByDefault: true,
  },
  {
    lineId: 'PLTW-W4',
    name: 'Wheel Cell 4 — 35 in',
    siteId: 'PLT-W',
    warehouseId: 'PLTW-FG',
    itemNumbers: ['FG-OTR-3525'],
    unitsPerHour: 6,
    hoursPerDay: 6,
    setupHours: 1,
    enabledByDefault: true,
  },
  // Background finished goods share two lines rather than each getting authored
  // capacity of its own.
  {
    lineId: 'PLTW-R1',
    name: 'Rim Base Line',
    siteId: 'PLT-W',
    warehouseId: 'PLTW-FG',
    itemNumbers: ['FG-RB-5129', 'FG-RB-3525'],
    unitsPerHour: 16,
    hoursPerDay: 10,
    setupHours: 1,
    enabledByDefault: true,
  },
  {
    lineId: 'SVCN-L1',
    name: 'Ring Roll Line',
    siteId: 'SVC-N',
    warehouseId: 'SVCN-FG',
    itemNumbers: ['FG-LR-5129', 'FG-LR-3525', 'FG-SR-5129'],
    unitsPerHour: 14,
    hoursPerDay: 8,
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
 * Returned earliest mill cert review first, because that is the order the
 * planner consumes them in and the order a yard supervisor wants to read.
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
    // An item with no review window still needs a date to sort on; ten years
    // out keeps it behind everything real without special-casing.
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

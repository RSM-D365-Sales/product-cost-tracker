import type { ItemInfo, ReceiptRow } from '../types/domain'
import type {
  AtRiskBatch,
  BatchOnHand,
  BomComponentLine,
  CostGroup,
  CostRollup,
  PlannedConsumption,
  PlannedRun,
  ProductionBom,
  ProductionLine,
  ProductionPlanSummary,
} from '../types/production'
import type { BomSpec } from '../data/productionSeed'
import { marginFraction } from './calc'
import { addDaysIso } from './format'
import { dayNumber } from './trend'

/**
 * Production costing and planning. Pure functions over data a provider hands in,
 * for the same reason lib/calc.ts is: the mock provider and any future OData or
 * X++ provider must not be able to disagree about what a run costs.
 *
 * Two things live here.
 *
 * COSTING (`costBom`) rolls a bill of material and route up into a cost per
 * finished unit, split by cost group. Batch-tracked components are priced at the
 * quantity-weighted landed cost of the lots actually on hand — not at a standard
 * — so the calculated cost moves when your inventory does.
 *
 * PLANNING (`buildPlan`) answers "what should I run, and what will spoil if I
 * don't". Lots are consumed strictly first-expired-first-out; each proposed run
 * is placed on the earliest line-day that can still finish before the lot it
 * consumes expires; whatever cannot be placed in time is reported as at-risk
 * material with a value against it. Capacity is committed hours per line per
 * day, so the plan tightens or loosens as a planner negotiates hours.
 */

const daysBetween = (from: string, to: string): number =>
  dayNumber(to) - dayNumber(from)

/** Floating-point slack for hour comparisons. */
const EPSILON = 1e-6

/** Item master fields the costing needs for a component. */
export interface ComponentMaster {
  itemNumber: string
  productName: string
  unit: string
  currentCost: number
  batchTracked: boolean
  shelfLifeDays?: number
}

// ---------------------------------------------------------------------------
// Costing
// ---------------------------------------------------------------------------

/** Quantity-weighted landed cost of the lots on hand for one item. */
function onHandAverageCost(
  itemNumber: string,
  onHand: readonly BatchOnHand[],
): number | undefined {
  let value = 0
  let quantity = 0

  for (const b of onHand) {
    // Expired stock is not going into anything, so it must not drag the
    // valuation of what is.
    if (b.itemNumber !== itemNumber || b.status === 'Expired') continue
    value += b.quantity * b.landedCost
    quantity += b.quantity
  }

  return quantity > 0 ? value / quantity : undefined
}

/**
 * Costs one bill of material and its route.
 *
 * `masters` supplies item-master facts for the components; a component with no
 * master (the coarse packaging lines on a derived BOM) falls back to the unit
 * cost carried on the spec.
 */
export function costBom(
  spec: BomSpec,
  item: ItemInfo,
  siteId: string,
  today: string,
  masters: ReadonlyMap<string, ComponentMaster>,
  onHand: readonly BatchOnHand[],
): ProductionBom {
  const components: BomComponentLine[] = spec.components.map((c) => {
    const master = masters.get(c.itemNumber)
    const batchTracked = master?.batchTracked ?? false
    const quantityConsumed = c.quantityPer * (1 + c.scrapPercent)

    const average = batchTracked
      ? onHandAverageCost(c.itemNumber, onHand)
      : undefined
    const unitCost =
      average ?? master?.currentCost ?? c.unitCostOverride ?? 0

    return {
      lineNumber: c.lineNumber,
      itemNumber: c.itemNumber,
      productName: master?.productName ?? c.productName ?? c.itemNumber,
      quantityPer: c.quantityPer,
      unit: master?.unit ?? c.unit,
      scrapPercent: c.scrapPercent,
      quantityConsumed,
      costGroup: c.costGroup,
      unitCost,
      costBasis: average !== undefined ? 'On-hand average' : 'Item cost',
      extendedCost: quantityConsumed * unitCost,
      batchTracked,
      shelfLifeDays: master?.shelfLifeDays,
    }
  })

  return {
    itemNumber: item.itemNumber,
    productName: item.productName,
    unit: item.unit,
    currency: item.currency,
    bomId: spec.bomId,
    bomVersion: spec.bomVersion,
    routeId: spec.routeId,
    siteId,
    perSeries: spec.perSeries,
    approvedOn: addDaysIso(today, -spec.approvedDaysAgo),
    components,
    operations: spec.operations.map((o) => ({ ...o })),
  }
}

const GROUP_ORDER: CostGroup[] = ['Material', 'Packaging', 'Labour', 'Overhead']

/**
 * Rolls the costed BOM up by cost group and sets it against the two figures a
 * cost accountant will ask for next: the item's own inventory cost, and what
 * this item's posted production receipts actually came in at.
 */
export function rollUp(
  bom: ProductionBom,
  item: ItemInfo,
  actualRows: readonly ReceiptRow[],
): CostRollup {
  const sumComponents = (group: CostGroup): number =>
    bom.components
      .filter((c) => c.costGroup === group)
      .reduce((s, c) => s + c.extendedCost, 0)

  const sumOperations = (group: CostGroup): number =>
    bom.operations
      .filter((o) => o.costGroup === group)
      .reduce((s, o) => s + o.costPerUnit, 0)

  const material = sumComponents('Material')
  const packaging = sumComponents('Packaging')
  const labour = sumOperations('Labour')
  const overhead = sumOperations('Overhead')
  const total = material + packaging + labour + overhead

  const producedRows = actualRows.filter((r) => r.sourceType === 'Production')
  const actualQty = producedRows.reduce((s, r) => s + r.quantityReceived, 0)
  const actualCost =
    actualQty > 0
      ? producedRows.reduce((s, r) => s + r.landedCost * r.quantityReceived, 0) /
        actualQty
      : 0

  return {
    byGroup: GROUP_ORDER.map((group) => ({
      group,
      amount:
        group === 'Material'
          ? material
          : group === 'Packaging'
            ? packaging
            : group === 'Labour'
              ? labour
              : overhead,
    })),
    material,
    packaging,
    labour,
    overhead,
    total,
    currentCost: item.currentCost,
    actualCost,
    actualRunCount: producedRows.length,
    sellingPrice: item.sellingPrice,
    marginCalculated: marginFraction(item.sellingPrice, total),
    marginCurrent: marginFraction(item.sellingPrice, item.currentCost),
    currency: item.currency,
  }
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

export interface PlanInput {
  item: ItemInfo
  bom: ProductionBom
  onHand: readonly BatchOnHand[]
  /** Only the lines the query enabled. An empty list yields an empty plan. */
  lines: readonly ProductionLine[]
  planStartDate: string
  horizonDays: number
  minimumRunQuantity: number
}

export interface PlanOutput {
  plan: PlannedRun[]
  atRisk: AtRiskBatch[]
  summary: ProductionPlanSummary
  warnings: string[]
}

/** A component's lots, mutated as the plan spends them. */
interface Pool {
  component: BomComponentLine
  lots: { batch: BatchOnHand; remaining: number }[]
}

function buildPool(
  component: BomComponentLine,
  onHand: readonly BatchOnHand[],
): Pool {
  return {
    component,
    lots: onHand
      .filter(
        (b) =>
          b.itemNumber === component.itemNumber &&
          b.status !== 'Expired' &&
          b.quantity > 0,
      )
      // onHandBatches already returns FEFO order; re-sorting keeps this
      // function honest if it is ever handed an unsorted list.
      .sort((a, b) => (a.expiryDate < b.expiryDate ? -1 : 1))
      .map((batch) => ({ batch, remaining: batch.quantity })),
  }
}

const poolRemaining = (pool: Pool): number =>
  pool.lots.reduce((s, l) => s + l.remaining, 0)

/** Finished units the pool can still cover. */
const poolUnits = (pool: Pool): number =>
  pool.component.quantityConsumed > 0
    ? Math.floor(poolRemaining(pool) / pool.component.quantityConsumed)
    : Number.POSITIVE_INFINITY

/**
 * Draws `quantity` of a component out of its pool, oldest expiry first, and
 * returns one consumption line per lot touched.
 */
function drawFromPool(pool: Pool, quantity: number): PlannedConsumption[] {
  const drawn: PlannedConsumption[] = []
  let outstanding = quantity

  for (const lot of pool.lots) {
    if (outstanding <= EPSILON) break
    if (lot.remaining <= 0) continue

    const take = Math.min(lot.remaining, outstanding)
    lot.remaining -= take
    outstanding -= take

    drawn.push({
      itemNumber: pool.component.itemNumber,
      productName: pool.component.productName,
      batchNumber: lot.batch.batchNumber,
      expiryDate: lot.batch.expiryDate,
      quantity: take,
      unit: pool.component.unit,
      unitCost: lot.batch.landedCost,
      extendedCost: take * lot.batch.landedCost,
      costGroup: pool.component.costGroup,
    })
  }

  return drawn
}

/**
 * Builds the production plan.
 *
 * The shape of the algorithm, because the output is only trustworthy if the
 * rules behind it are legible:
 *
 *  1. Every batch-tracked component gets a pool of its unexpired lots. The pool
 *     covering the fewest finished units is the DRIVER — it is what the plan is
 *     really constrained by, and it is what runs are ordered around.
 *  2. Driver lots are taken first-expired-first-out. For each lot, runs are
 *     placed on the earliest line-day with committed hours free, and never on a
 *     day after that lot's expiry date.
 *  3. Whatever a lot could have yielded but could not be placed in time is
 *     at-risk material, valued at that lot's own landed cost.
 *  4. Each run is costed from the lots it actually draws, so two runs of the
 *     same item on the same line legitimately cost different amounts.
 */
export function buildPlan(input: PlanInput): PlanOutput {
  const { item, bom, onHand, lines, planStartDate, horizonDays } = input
  const minimumRunQuantity = Math.max(1, input.minimumRunQuantity)
  const horizonEnd = addDaysIso(planStartDate, Math.max(0, horizonDays - 1))

  const warnings: string[] = []
  const plan: PlannedRun[] = []
  const atRisk: AtRiskBatch[] = []

  const trackedComponents = bom.components.filter(
    (c) => c.batchTracked && c.quantityConsumed > 0,
  )
  const pools = trackedComponents.map((c) => buildPool(c, onHand))
  const looseComponents = bom.components.filter(
    (c) => !c.batchTracked && c.quantityConsumed > 0,
  )
  const conversionCostPerUnit = bom.operations.reduce(
    (s, o) => s + o.costPerUnit,
    0,
  )

  // --- Capacity ledger: committed hours per line per day -------------------
  const hoursFree: number[][] = lines.map((l) =>
    new Array<number>(Math.max(0, horizonDays)).fill(l.hoursPerDay),
  )
  const availableHours = lines.reduce(
    (s, l) => s + l.hoursPerDay * Math.max(0, horizonDays),
    0,
  )

  const emptySummary = (bindingConstraint: string): ProductionPlanSummary => ({
    runCount: 0,
    plannedQuantity: 0,
    unit: item.unit,
    totalCost: 0,
    averageCostPerUnit: 0,
    plannedRevenue: 0,
    plannedMargin: 0,
    materialValueConsumed: 0,
    atRiskQuantity: 0,
    atRiskValue: 0,
    capacityUtilisation: 0,
    availableHours,
    scheduledHours: 0,
    currency: item.currency,
    horizonFrom: planStartDate,
    horizonTo: horizonEnd,
    bindingConstraint,
  })

  if (lines.length === 0) {
    warnings.push(
      'No production line is selected, so nothing can be planned. Select at least one line in the parameters.',
    )
    return { plan, atRisk, summary: emptySummary('No line selected'), warnings }
  }

  if (pools.length === 0) {
    warnings.push(
      `${bom.itemNumber} has no batch-tracked component on its bill of material, so there is no material constraint to plan against.`,
    )
    return {
      plan,
      atRisk,
      summary: emptySummary('No batch-tracked component'),
      warnings,
    }
  }

  // --- The driver: whichever component covers the fewest finished units ----
  let driver = pools[0]
  for (const pool of pools) {
    if (poolUnits(pool) < poolUnits(driver)) driver = pool
  }
  const others = pools.filter((p) => p !== driver)

  if (poolRemaining(driver) <= 0) {
    warnings.push(
      `There is no unexpired ${driver.component.itemNumber} ${driver.component.productName} on hand, so no run can be planned.`,
    )
    return {
      plan,
      atRisk,
      summary: emptySummary(`No ${driver.component.itemNumber} on hand`),
      warnings,
    }
  }

  let sequence = 0
  let transfersNeeded = 0
  let materialShortComponent = ''

  for (const lot of driver.lots) {
    if (lot.remaining <= EPSILON) continue

    // What this lot could yield on its own, and what the other components
    // actually allow — the difference is short material, not spoilage.
    const unitsInLot = Math.floor(lot.remaining / driver.component.quantityConsumed)
    if (unitsInLot <= 0) continue

    const otherLimit = others.reduce(
      (min, p) => Math.min(min, poolUnits(p)),
      Number.POSITIVE_INFINITY,
    )
    const shortComponent = others.find((p) => poolUnits(p) < unitsInLot)
    if (shortComponent && !materialShortComponent) {
      materialShortComponent = shortComponent.component.itemNumber
    }

    const allowed = Math.min(unitsInLot, otherLimit)
    let remainingUnits = allowed

    // A run may not finish after the lot it consumes has expired.
    const lastDay = Math.min(
      horizonDays - 1,
      daysBetween(planStartDate, lot.batch.expiryDate),
    )

    for (let day = 0; day <= lastDay && remainingUnits > 0; day++) {
      for (let li = 0; li < lines.length && remainingUnits > 0; li++) {
        const line = lines[li]
        const free = hoursFree[li][day]
        if (free <= line.setupHours + EPSILON) continue

        const capacity = Math.floor((free - line.setupHours) * line.unitsPerHour)
        if (capacity <= 0) continue

        const quantity = Math.min(remainingUnits, capacity)
        // Do not burn a changeover on a token run while a bigger slot is still
        // available further out; a genuinely small remainder still gets made.
        if (quantity < minimumRunQuantity && remainingUnits >= minimumRunQuantity) {
          continue
        }

        const startDate = addDaysIso(planStartDate, day)
        const consumption: PlannedConsumption[] = []

        // Driver first, so the run's driving batch is its first material line.
        const driverQty = quantity * driver.component.quantityConsumed
        lot.remaining -= driverQty
        consumption.push({
          itemNumber: driver.component.itemNumber,
          productName: driver.component.productName,
          batchNumber: lot.batch.batchNumber,
          expiryDate: lot.batch.expiryDate,
          quantity: driverQty,
          unit: driver.component.unit,
          unitCost: lot.batch.landedCost,
          extendedCost: driverQty * lot.batch.landedCost,
          costGroup: driver.component.costGroup,
        })

        for (const pool of others) {
          consumption.push(
            ...drawFromPool(pool, quantity * pool.component.quantityConsumed),
          )
        }

        for (const c of looseComponents) {
          const drawQty = quantity * c.quantityConsumed
          consumption.push({
            itemNumber: c.itemNumber,
            productName: c.productName,
            quantity: drawQty,
            unit: c.unit,
            unitCost: c.unitCost,
            extendedCost: drawQty * c.unitCost,
            costGroup: c.costGroup,
          })
        }

        const groupTotal = (group: CostGroup): number =>
          consumption
            .filter((x) => x.costGroup === group)
            .reduce((s, x) => s + x.extendedCost, 0)

        const materialCostPerUnit = groupTotal('Material') / quantity
        const packagingCostPerUnit = groupTotal('Packaging') / quantity
        const totalCostPerUnit =
          materialCostPerUnit + packagingCostPerUnit + conversionCostPerUnit

        if (line.siteId !== lot.batch.siteId) transfersNeeded += 1

        sequence += 1
        plan.push({
          id: `${line.lineId}|${startDate}|${sequence}`,
          sequence,
          lineId: line.lineId,
          lineName: line.name,
          siteId: line.siteId,
          warehouseId: line.warehouseId,
          itemNumber: item.itemNumber,
          quantity,
          unit: item.unit,
          startDate,
          endDate: startDate,
          runHours: line.setupHours + quantity / line.unitsPerHour,
          drivingBatchNumber: lot.batch.batchNumber,
          drivingBatchExpiry: lot.batch.expiryDate,
          slackDays: daysBetween(startDate, lot.batch.expiryDate),
          consumption,
          materialCostPerUnit,
          packagingCostPerUnit,
          conversionCostPerUnit,
          totalCostPerUnit,
          extendedCost: totalCostPerUnit * quantity,
          sellingPrice: item.sellingPrice,
          marginEstimate: marginFraction(item.sellingPrice, totalCostPerUnit),
          currency: item.currency,
        })

        hoursFree[li][day] -= line.setupHours + quantity / line.unitsPerHour
        remainingUnits -= quantity
      }
    }

    // Anything the lot could have yielded but the plan could not place.
    const unplaced = unitsInLot - (allowed - remainingUnits)
    if (unplaced > 0) {
      const shortOnMaterial = allowed < unitsInLot && remainingUnits === 0
      const quantity = Math.min(
        lot.remaining,
        unplaced * driver.component.quantityConsumed,
      )
      if (quantity > EPSILON) {
        atRisk.push({
          batchNumber: lot.batch.batchNumber,
          itemNumber: lot.batch.itemNumber,
          productName: lot.batch.productName,
          expiryDate: lot.batch.expiryDate,
          daysToExpiry: lot.batch.daysToExpiry,
          quantity,
          unit: lot.batch.unit,
          unitCost: lot.batch.landedCost,
          value: quantity * lot.batch.landedCost,
          reason: shortOnMaterial
            ? `Not enough ${materialShortComponent || 'component material'} on hand to convert the rest of this lot`
            : lastDay < horizonDays - 1
              ? 'No line capacity left before the lot expires'
              : 'Beyond the planning horizon',
        })
      }
    }
  }

  plan.sort((a, b) =>
    a.startDate === b.startDate
      ? a.lineId < b.lineId
        ? -1
        : 1
      : a.startDate < b.startDate
        ? -1
        : 1,
  )

  // --- Summary -------------------------------------------------------------
  const plannedQuantity = plan.reduce((s, r) => s + r.quantity, 0)
  const totalCost = plan.reduce((s, r) => s + r.extendedCost, 0)
  const scheduledHours = plan.reduce((s, r) => s + r.runHours, 0)
  const plannedRevenue = plannedQuantity * item.sellingPrice
  const materialValueConsumed = plan.reduce(
    (s, r) =>
      s +
      r.consumption
        .filter((c) => c.costGroup === 'Material')
        .reduce((t, c) => t + c.extendedCost, 0),
    0,
  )
  const atRiskQuantity = atRisk.reduce((s, b) => s + b.quantity, 0)
  const atRiskValue = atRisk.reduce((s, b) => s + b.value, 0)
  const capacityUtilisation =
    availableHours > 0 ? scheduledHours / availableHours : 0

  // Material is spent when no single lot has enough left for one more unit.
  // Testing the pool TOTAL instead would never fire: each lot leaves up to one
  // unit's worth of remainder behind, and those remainders sum to more than a
  // unit without any of them being usable.
  const materialSpent = driver.lots.every(
    (l) => l.remaining < driver.component.quantityConsumed,
  )

  const bindingConstraint =
    atRiskQuantity > 0
      ? `Line capacity before expiry — ${Math.round(atRiskQuantity).toLocaleString('en-US')} ${driver.component.unit} of ${driver.component.itemNumber} cannot be run in time`
      : materialSpent
        ? `Material — the ${driver.component.itemNumber} on hand is fully committed`
        : capacityUtilisation >= 0.95
          ? 'Line capacity — every committed hour in the horizon is scheduled'
          : 'Neither material nor capacity is fully committed'

  if (atRiskValue > 0) {
    warnings.push(
      `${Math.round(atRiskQuantity).toLocaleString('en-US')} ${driver.component.unit} of ${driver.component.itemNumber} will expire before the selected lines can consume it. Enable another line or extend committed hours to recover it.`,
    )
  }
  if (transfersNeeded > 0) {
    warnings.push(
      `${transfersNeeded} planned ${transfersNeeded === 1 ? 'run is' : 'runs are'} on a line at a different site to the material. An inventory transfer is required before those runs can start.`,
    )
  }
  const expiredValue = onHand
    .filter((b) => b.status === 'Expired')
    .reduce((s, b) => s + b.inventoryValue, 0)
  if (expiredValue > 0) {
    warnings.push(
      `Stock already past its expiry date is excluded from the plan and from component valuation.`,
    )
  }

  return {
    plan,
    atRisk,
    summary: {
      runCount: plan.length,
      plannedQuantity,
      unit: item.unit,
      totalCost,
      averageCostPerUnit: plannedQuantity > 0 ? totalCost / plannedQuantity : 0,
      plannedRevenue,
      plannedMargin: marginFraction(plannedRevenue, totalCost),
      materialValueConsumed,
      atRiskQuantity,
      atRiskValue,
      capacityUtilisation,
      availableHours,
      scheduledHours,
      currency: item.currency,
      horizonFrom: planStartDate,
      horizonTo: horizonEnd,
      bindingConstraint,
    },
    warnings,
  }
}

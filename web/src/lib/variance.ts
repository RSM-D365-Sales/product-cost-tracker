import type { ReceiptRow } from '../types/domain'
import type { CostGroup, CostRollup } from '../types/production'

/**
 * Variance analysis, in one place for the same reason lib/calc.ts is: the
 * panels, the Copilot narrative and any future provider must not be able to
 * disagree about which receipt is out of bounds or why.
 *
 * Two analyses live here.
 *
 * LANDED COST (`analyseLandedVariance`) sets every receipt in a result against
 * the quantity-weighted baseline of that same result and decomposes the gap
 * into named causes — purchase price, transportation, customs and duty, and so
 * on — by bucketing the charge codes. The cause deltas sum exactly to the
 * landed variance, because landed cost is exactly FOB plus charges; nothing is
 * estimated.
 *
 * PRODUCTION RUNS (`analyseRunVariance`) does the same for posted production
 * receipts by cost group (material, packaging, labour, overhead), and also
 * bridges the run average to the calculated cost of the current BOM and route.
 * Out-of-bounds detection is against the PEER average of the runs, not against
 * the calculated cost: the calculation prices material at today's on-hand
 * lots, so a systematic gap against history is expected and is reported as the
 * bridge — a genuine outlier is a run that left its own cohort.
 *
 * Money is per unit throughout, in the rows' transaction currency.
 */

// ---------------------------------------------------------------------------
// Cause buckets
// ---------------------------------------------------------------------------

/** The FOB / material slot on the row, which is not a charge line. */
export const PRICE_CAUSE_KEY = 'PRICE'

/**
 * Charge codes rolled into the causes a cost accountant argues about. A code
 * with no mapping keeps its own description, so an unmapped charge is still
 * reported rather than lumped into "other".
 */
const CAUSE_OF_CODE: Record<string, { key: string; label: string }> = {
  FREIGHT: { key: 'TRANSPORT', label: 'Transportation' },
  FUEL: { key: 'TRANSPORT', label: 'Transportation' },
  PALLET: { key: 'TRANSPORT', label: 'Transportation' },
  DEMUR: { key: 'TRANSPORT', label: 'Transportation' },
  PRECOOL: { key: 'COLDCHAIN', label: 'Cold chain' },
  BROKER: { key: 'CUSTOMS', label: 'Customs & duty' },
  DUTY: { key: 'CUSTOMS', label: 'Customs & duty' },
  INSPECT: { key: 'COMPLIANCE', label: 'Inspection & testing' },
  LABTEST: { key: 'COMPLIANCE', label: 'Inspection & testing' },
  FUMIG: { key: 'COMPLIANCE', label: 'Inspection & testing' },
  // Conversion codes on production receipts.
  PACK: { key: 'PACKAGING', label: 'Packaging' },
  CAN: { key: 'PACKAGING', label: 'Packaging' },
  LABEL: { key: 'PACKAGING', label: 'Packaging' },
  LABOR: { key: 'LABOUR', label: 'Labour' },
  OVHD: { key: 'OVERHEAD', label: 'Overhead' },
  QA: { key: 'OVERHEAD', label: 'Overhead' },
}

/**
 * Cost group a conversion charge code belongs to. The seed's derived BOMs use
 * this same function (see data/productionSeed.ts), so the group a run's actual
 * cost lands in is by construction the group its BOM plans it in.
 */
export function costGroupOfConversionCode(code: string): CostGroup {
  const key = CAUSE_OF_CODE[code]?.key
  if (key === 'PACKAGING') return 'Packaging'
  if (key === 'OVERHEAD') return 'Overhead'
  return 'Labour'
}

/** Display labels for the four cost groups, food-manufacturer flavoured. */
export const COST_GROUP_LABELS: Record<CostGroup, string> = {
  Material: 'Material (food)',
  Packaging: 'Packaging',
  Labour: 'Labour',
  Overhead: 'Overhead',
}

export const COST_GROUPS: CostGroup[] = [
  'Material',
  'Packaging',
  'Labour',
  'Overhead',
]

// ---------------------------------------------------------------------------
// Shared shapes
// ---------------------------------------------------------------------------

/** Costs above baseline read as unfavourable, below as favourable. */
export type VarianceDirection = 'above' | 'below'

/** One cause's contribution to a receipt's variance, per unit. */
export interface CauseDelta {
  key: string
  label: string
  /** This receipt, per unit. */
  amount: number
  /** Quantity-weighted average across the result, per unit. */
  baseline: number
  /** amount - baseline. The deltas across all causes sum to the variance. */
  delta: number
}

/** Ignore deltas below a fifth of a cent — they are rounding, not causes. */
const DRIVER_FLOOR = 0.002

const direction = (variance: number): VarianceDirection =>
  variance >= 0 ? 'above' : 'below'

/** Causes worth naming, largest absolute movement first. */
function drivers(causes: CauseDelta[]): CauseDelta[] {
  return causes
    .filter((c) => Math.abs(c.delta) >= DRIVER_FLOOR)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
}

// ---------------------------------------------------------------------------
// Landed cost variance
// ---------------------------------------------------------------------------

export interface ReceiptVariance {
  row: ReceiptRow
  /** Landed cost minus the baseline, per unit. */
  variance: number
  /** As a fraction of the baseline. */
  variancePct: number
  direction: VarianceDirection
  outOfBounds: boolean
  /** Every cause, in the analysis's canonical order. Deltas sum to `variance`. */
  causes: CauseDelta[]
  /** The causes worth naming, largest first. */
  drivers: CauseDelta[]
}

export interface LandedVarianceAnalysis {
  currency: string
  /** Tolerance band, as a percentage (5 means ±5%). */
  tolerancePct: number
  /** Quantity-weighted average landed cost of the result. */
  baseline: number
  /** Label for the FOB/material slot, e.g. "Purchase price (FOB)". */
  priceCauseLabel: string
  /** All receipts, in the order they were handed in. */
  receipts: ReceiptVariance[]
  /** Out-of-bounds receipts only, worst first by |variance %|. */
  flagged: ReceiptVariance[]
  aboveCount: number
  belowCount: number
  /** Cause labels present in the result, canonical order (price first). */
  causeLabels: { key: string; label: string }[]
}

interface CauseAccumulator {
  key: string
  label: string
  /** Extended (not per-unit) amount, summed across rows, for the baseline. */
  extended: number
}

function causeOfCharge(code: string, description: string): { key: string; label: string } {
  return CAUSE_OF_CODE[code] ?? { key: code, label: description || code }
}

/**
 * Per-unit cause amounts for one row. Derived from extended amounts divided by
 * the row's own quantity so the causes sum exactly to the row's landed cost —
 * `amountPerUnit` on the charge line can carry a rounding hair against it.
 */
function rowCauses(row: ReceiptRow): Map<string, { label: string; amount: number }> {
  const qty = row.quantityReceived
  const map = new Map<string, { label: string; amount: number }>()
  map.set(PRICE_CAUSE_KEY, { label: '', amount: row.purchasePriceFob })

  for (const ch of row.charges) {
    const cause = causeOfCharge(ch.chargeCode, ch.description)
    const perUnit = qty !== 0 ? ch.amount / qty : ch.amountPerUnit
    const acc = map.get(cause.key)
    if (acc) acc.amount += perUnit
    else map.set(cause.key, { label: cause.label, amount: perUnit })
  }

  return map
}

export function analyseLandedVariance(
  rows: ReceiptRow[],
  tolerancePct: number,
): LandedVarianceAnalysis | null {
  if (rows.length === 0) return null

  const currency = rows[0].currency
  const totalQty = rows.reduce((s, r) => s + r.quantityReceived, 0)
  // Weighted mean; simple mean when the quantities are somehow all zero.
  const weight = (r: ReceiptRow) =>
    totalQty !== 0 ? r.quantityReceived / totalQty : 1 / rows.length

  const allProduction = rows.every((r) => r.sourceType === 'Production')
  const anyProduction = rows.some((r) => r.sourceType === 'Production')
  const priceCauseLabel = allProduction
    ? 'Material (consumed batch)'
    : anyProduction
      ? 'Purchase price / material'
      : 'Purchase price (FOB)'

  // Union of causes across the result, with extended totals for the baseline.
  // A receipt that avoided a charge others paid gets a favourable delta for it.
  const accumulators = new Map<string, CauseAccumulator>()
  accumulators.set(PRICE_CAUSE_KEY, {
    key: PRICE_CAUSE_KEY,
    label: priceCauseLabel,
    extended: 0,
  })

  const perRow = rows.map((row) => rowCauses(row))

  rows.forEach((row, i) => {
    for (const [key, { label, amount }] of perRow[i]) {
      let acc = accumulators.get(key)
      if (!acc) {
        acc = { key, label, extended: 0 }
        accumulators.set(key, acc)
      }
      acc.extended += amount * row.quantityReceived
    }
  })

  const baselineOf = (key: string): number => {
    const acc = accumulators.get(key)
    if (!acc) return 0
    if (totalQty !== 0) return acc.extended / totalQty
    // All-zero quantities: fall back to a simple mean of the per-row amounts.
    return (
      perRow.reduce((s, m) => s + (m.get(key)?.amount ?? 0), 0) / rows.length
    )
  }

  // Canonical order: price first, then descending baseline weight.
  const ordered = [...accumulators.values()].sort((a, b) => {
    if (a.key === PRICE_CAUSE_KEY) return -1
    if (b.key === PRICE_CAUSE_KEY) return 1
    return baselineOf(b.key) - baselineOf(a.key)
  })

  const baseline = rows.reduce((s, r) => s + r.landedCost * weight(r), 0)
  const tolerance = tolerancePct / 100

  const receipts: ReceiptVariance[] = rows.map((row, i) => {
    const variance = row.landedCost - baseline
    const variancePct = baseline !== 0 ? variance / baseline : 0
    const causes: CauseDelta[] = ordered.map((acc) => {
      const amount = perRow[i].get(acc.key)?.amount ?? 0
      const b = baselineOf(acc.key)
      return {
        key: acc.key,
        label: acc.label,
        amount,
        baseline: b,
        delta: amount - b,
      }
    })

    return {
      row,
      variance,
      variancePct,
      direction: direction(variance),
      outOfBounds: baseline !== 0 && Math.abs(variancePct) > tolerance,
      causes,
      drivers: drivers(causes),
    }
  })

  const flagged = receipts
    .filter((r) => r.outOfBounds)
    .sort((a, b) => Math.abs(b.variancePct) - Math.abs(a.variancePct))

  return {
    currency,
    tolerancePct,
    baseline,
    priceCauseLabel,
    receipts,
    flagged,
    aboveCount: flagged.filter((r) => r.direction === 'above').length,
    belowCount: flagged.filter((r) => r.direction === 'below').length,
    causeLabels: ordered.map(({ key, label }) => ({ key, label })),
  }
}

// ---------------------------------------------------------------------------
// Production run variance
// ---------------------------------------------------------------------------

/** One cost group's calculated-vs-actual position across the posted runs. */
export interface GroupBridge {
  group: CostGroup
  label: string
  /** Today's BOM and route, from the cost roll-up. */
  calculated: number
  /** Quantity-weighted average of the posted runs. */
  actual: number
  /** actual - calculated. Positive means the runs cost more than the calc. */
  variance: number
  /** As a fraction of calculated. */
  variancePct: number
}

export interface RunVariance {
  row: ReceiptRow
  /** Actual per-unit cost by group. Material is the consumed batch's cost. */
  perUnit: Record<CostGroup, number>
  total: number
  /** Total minus the peer (run-average) baseline, per unit. */
  variance: number
  variancePct: number
  direction: VarianceDirection
  outOfBounds: boolean
  /** Group deltas against the peer baseline. Sum to `variance`. */
  causes: CauseDelta[]
  drivers: CauseDelta[]
}

export interface ProductionVarianceAnalysis {
  currency: string
  tolerancePct: number
  /** Quantity-weighted run average per group, the out-of-bounds baseline. */
  baseline: Record<CostGroup, number>
  baselineTotal: number
  calculatedTotal: number
  /** actual average minus calculated, per unit. */
  bridgeVariance: number
  bridgeVariancePct: number
  bridge: GroupBridge[]
  runs: RunVariance[]
  /** Out-of-bounds runs only, worst first by |variance %|. */
  flagged: RunVariance[]
  aboveCount: number
  belowCount: number
}

/** Actual per-unit cost of one posted run, split by cost group. */
export function runCostByGroup(row: ReceiptRow): Record<CostGroup, number> {
  const qty = row.quantityReceived
  const groups: Record<CostGroup, number> = {
    Material: row.purchasePriceFob,
    Packaging: 0,
    Labour: 0,
    Overhead: 0,
  }
  for (const ch of row.charges) {
    const group = costGroupOfConversionCode(ch.chargeCode)
    groups[group] += qty !== 0 ? ch.amount / qty : ch.amountPerUnit
  }
  return groups
}

export function analyseRunVariance(
  runs: ReceiptRow[],
  rollup: CostRollup,
  tolerancePct: number,
): ProductionVarianceAnalysis | null {
  if (runs.length === 0) return null

  const currency = runs[0].currency
  const totalQty = runs.reduce((s, r) => s + r.quantityReceived, 0)
  const weight = (r: ReceiptRow) =>
    totalQty !== 0 ? r.quantityReceived / totalQty : 1 / runs.length

  const perRun = runs.map((r) => runCostByGroup(r))

  const baseline: Record<CostGroup, number> = {
    Material: 0,
    Packaging: 0,
    Labour: 0,
    Overhead: 0,
  }
  runs.forEach((row, i) => {
    for (const group of COST_GROUPS) {
      baseline[group] += perRun[i][group] * weight(row)
    }
  })
  const baselineTotal = runs.reduce((s, r) => s + r.landedCost * weight(r), 0)

  const calculatedOf: Record<CostGroup, number> = {
    Material: rollup.material,
    Packaging: rollup.packaging,
    Labour: rollup.labour,
    Overhead: rollup.overhead,
  }

  const bridge: GroupBridge[] = COST_GROUPS.map((group) => {
    const calculated = calculatedOf[group]
    const actual = baseline[group]
    const variance = actual - calculated
    return {
      group,
      label: COST_GROUP_LABELS[group],
      calculated,
      actual,
      variance,
      variancePct: calculated !== 0 ? variance / calculated : 0,
    }
  })

  const tolerance = tolerancePct / 100

  const runVariances: RunVariance[] = runs.map((row, i) => {
    const total = row.landedCost
    const variance = total - baselineTotal
    const variancePct = baselineTotal !== 0 ? variance / baselineTotal : 0
    const causes: CauseDelta[] = COST_GROUPS.map((group) => ({
      key: group,
      label: COST_GROUP_LABELS[group],
      amount: perRun[i][group],
      baseline: baseline[group],
      delta: perRun[i][group] - baseline[group],
    }))

    return {
      row,
      perUnit: perRun[i],
      total,
      variance,
      variancePct,
      direction: direction(variance),
      outOfBounds: baselineTotal !== 0 && Math.abs(variancePct) > tolerance,
      causes,
      drivers: drivers(causes),
    }
  })

  const flagged = runVariances
    .filter((r) => r.outOfBounds)
    .sort((a, b) => Math.abs(b.variancePct) - Math.abs(a.variancePct))

  const bridgeVariance = baselineTotal - rollup.total

  return {
    currency,
    tolerancePct,
    baseline,
    baselineTotal,
    calculatedTotal: rollup.total,
    bridgeVariance,
    bridgeVariancePct: rollup.total !== 0 ? bridgeVariance / rollup.total : 0,
    bridge,
    runs: runVariances,
    flagged,
    aboveCount: flagged.filter((r) => r.direction === 'above').length,
    belowCount: flagged.filter((r) => r.direction === 'below').length,
  }
}

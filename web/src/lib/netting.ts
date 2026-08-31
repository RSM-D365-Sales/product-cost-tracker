import type { DemandLine, ImpactInputs, SupplyLot } from '../types/netting'
import { addDaysIso } from './format'
import { dayNumber } from './trend'

/**
 * The netting engine behind the impact analysis: supply against pegged demand,
 * day by day, expiry-aware.
 *
 * Mirrors what D365's Net requirements page shows and what the Procurement
 * agent's impact analysis computes when a vendor requests a change: demand
 * lines are covered first-expired-first-out from the supply that is available
 * and still in date on their required day, whatever cannot be covered is a
 * shortfall pegged to a named downstream order, and whatever expires with
 * quantity still on it is a write-off with a value.
 *
 * A simulation is the same function run again with adjusted supply — an open
 * PO line moved out or in (`shiftDays`, which moves its expiry with it, because
 * shelf life travels with the receipt) or confirmed short or long
 * (`quantityPct`). Only expected supply can be adjusted; the lots already in
 * the warehouse are facts.
 *
 * Pure function, deterministic, no provider access — the UI re-runs it on
 * every keystroke of the simulation controls.
 */

/** A vendor change request applied to one expected supply line. */
export interface SupplyAdjustment {
  /** Positive moves the receipt out, negative pulls it in. */
  shiftDays: number
  /** 100 = as ordered; 80 = confirmed 20% short; 120 = 20% long. */
  quantityPct: number
}

export type Adjustments = Record<string, SupplyAdjustment | undefined>

export const NEUTRAL_ADJUSTMENT: SupplyAdjustment = {
  shiftDays: 0,
  quantityPct: 100,
}

export function isNeutral(a: SupplyAdjustment | undefined): boolean {
  return !a || (Math.round(a.shiftDays) === 0 && a.quantityPct === 100)
}

export function hasActiveAdjustments(adjustments: Adjustments): boolean {
  return Object.values(adjustments).some((a) => !isNeutral(a))
}

/** One draw of supply against a demand line. */
export interface AllocationFrom {
  supplyId: string
  reference: string
  kind: SupplyLot['kind']
  quantity: number
}

/** A demand line and how (or whether) the netting covered it. */
export interface DemandCoverage {
  demand: DemandLine
  allocations: AllocationFrom[]
  covered: number
  /** Quantity no supply could cover on the required day. */
  short: number
}

/** A supply line and where it went. */
export interface SupplyUsage {
  /** The supply as netted — adjustments already applied. */
  supply: SupplyLot
  /** Demand references this line covered, in draw order. */
  pegged: { demandId: string; reference: string; quantity: number }[]
  consumed: number
  /** Quantity still on the line when it expired inside the ledger. */
  expiredUnused: number
  /** Quantity left at the end of the ledger (not expired, not consumed). */
  leftover: number
}

/** One day of the projection strip. */
export interface NettingDay {
  date: string
  dayIndex: number
  /** Supply becoming available this day. */
  receipts: number
  /** Demand due this day. */
  requirements: number
  /** Demand due this day that nothing could cover. */
  shortfall: number
  /** Quantity written off this day (lots expiring with stock on them). */
  expired: number
  /** Usable stock at end of day. */
  projected: number
}

export interface NettingResult {
  days: NettingDay[]
  coverage: DemandCoverage[]
  usage: SupplyUsage[]
  demandQuantity: number
  coveredQuantity: number
  shortQuantity: number
  /** Demand lines with a shortfall, in required-date order. */
  shortDemands: DemandCoverage[]
  firstShortDate?: string
  expiredQuantity: number
  expiredValue: number
  endingOnHand: number
  hasShortfall: boolean
}

/**
 * Sets a simulated netting against its baseline, the way the Procurement
 * agent's impact analysis reports a vendor change request: does the change
 * put downstream orders at risk, and what else moved.
 */
export interface NettingComparison {
  shortQuantityDelta: number
  expiredValueDelta: number
  endingOnHandDelta: number
  /** Demand lines shorter under the simulation than under the baseline. */
  newlyShortDemands: DemandCoverage[]
  /** The verdict: downstream orders go short, or material newly expires. */
  hasImpact: boolean
}

export function compareNetting(
  baseline: NettingResult,
  simulated: NettingResult,
): NettingComparison {
  const baselineShortById = new Map(
    baseline.coverage.map((c) => [c.demand.id, c.short]),
  )
  const newlyShortDemands = simulated.coverage.filter(
    (c) => c.short > (baselineShortById.get(c.demand.id) ?? 0) + 0.5,
  )

  const shortQuantityDelta = simulated.shortQuantity - baseline.shortQuantity
  const expiredValueDelta = simulated.expiredValue - baseline.expiredValue

  return {
    shortQuantityDelta,
    expiredValueDelta,
    endingOnHandDelta: simulated.endingOnHand - baseline.endingOnHand,
    newlyShortDemands,
    hasImpact: shortQuantityDelta > 0.5 || expiredValueDelta > 1,
  }
}

/** Applies a change request to one supply line. On-hand lots are immutable. */
export function applyAdjustment(
  supply: SupplyLot,
  adjustment: SupplyAdjustment | undefined,
): SupplyLot {
  if (supply.kind !== 'Expected' || isNeutral(adjustment)) return supply
  const shift = Math.round(adjustment!.shiftDays || 0)
  const pct = adjustment!.quantityPct
  return {
    ...supply,
    availableDate: addDaysIso(supply.availableDate, shift),
    expiryDate: supply.expiryDate
      ? addDaysIso(supply.expiryDate, shift)
      : undefined,
    quantity: Math.max(0, Math.round((supply.quantity * pct) / 100)),
  }
}

interface Lot {
  supply: SupplyLot
  availDay: number
  expiryDay: number
  remaining: number
  usage: SupplyUsage
}

export function runNetting(
  inputs: ImpactInputs,
  adjustments: Adjustments,
): NettingResult {
  const day0 = dayNumber(inputs.asOf)
  const dayOf = (iso: string) => dayNumber(iso) - day0

  const lots: Lot[] = inputs.supplies.map((raw) => {
    const supply = applyAdjustment(raw, adjustments[raw.id])
    const usage: SupplyUsage = {
      supply,
      pegged: [],
      consumed: 0,
      expiredUnused: 0,
      leftover: 0,
    }
    return {
      supply,
      availDay: dayOf(supply.availableDate),
      expiryDay: supply.expiryDate
        ? dayOf(supply.expiryDate)
        : Number.POSITIVE_INFINITY,
      remaining: supply.quantity,
      usage,
    }
  })

  const demands = [...inputs.demands].sort((a, b) =>
    a.requiredDate === b.requiredDate
      ? a.id < b.id
        ? -1
        : 1
      : a.requiredDate < b.requiredDate
        ? -1
        : 1,
  )
  const coverage: DemandCoverage[] = demands.map((demand) => ({
    demand,
    allocations: [],
    covered: 0,
    short: 0,
  }))

  // The strip shows `horizonDays`, but the ledger must run out to the last
  // demand or shift-adjusted receipt so nothing quietly falls off the end.
  const lastDay = Math.max(
    inputs.horizonDays - 1,
    ...demands.map((d) => dayOf(d.requiredDate)),
    ...lots.map((l) => (Number.isFinite(l.availDay) ? l.availDay : 0)),
  )

  const days: NettingDay[] = []

  for (let d = 0; d <= lastDay; d++) {
    const receipts = lots
      .filter((l) => l.availDay === d)
      .reduce((s, l) => s + l.supply.quantity, 0)

    let requirements = 0
    let shortfall = 0

    for (const c of coverage) {
      if (dayOf(c.demand.requiredDate) !== d) continue
      requirements += c.demand.quantity

      let outstanding = c.demand.quantity
      // First-expired-first-out among supply that has arrived and is in date.
      const candidates = lots
        .filter((l) => l.availDay <= d && l.expiryDay >= d && l.remaining > 0)
        .sort((a, b) =>
          a.expiryDay === b.expiryDay
            ? a.availDay - b.availDay
            : a.expiryDay - b.expiryDay,
        )

      for (const lot of candidates) {
        if (outstanding <= 0) break
        const take = Math.min(lot.remaining, outstanding)
        lot.remaining -= take
        outstanding -= take
        lot.usage.consumed += take
        lot.usage.pegged.push({
          demandId: c.demand.id,
          reference: c.demand.reference,
          quantity: take,
        })
        c.allocations.push({
          supplyId: lot.supply.id,
          reference: lot.supply.reference,
          kind: lot.supply.kind,
          quantity: take,
        })
      }

      c.covered = c.demand.quantity - outstanding
      c.short = outstanding
      shortfall += outstanding
    }

    // Lots expire at end of day, after the day's demand has drawn.
    let expired = 0
    for (const lot of lots) {
      if (lot.expiryDay === d && lot.remaining > 0) {
        expired += lot.remaining
        lot.usage.expiredUnused += lot.remaining
        lot.remaining = 0
      }
    }

    days.push({
      date: addDaysIso(inputs.asOf, d),
      dayIndex: d,
      receipts,
      requirements,
      shortfall,
      expired,
      projected: lots
        .filter((l) => l.availDay <= d)
        .reduce((s, l) => s + l.remaining, 0),
    })
  }

  for (const lot of lots) lot.usage.leftover = lot.remaining

  const demandQuantity = demands.reduce((s, d) => s + d.quantity, 0)
  const shortQuantity = coverage.reduce((s, c) => s + c.short, 0)
  const shortDemands = coverage.filter((c) => c.short > 0)
  const expiredQuantity = lots.reduce((s, l) => s + l.usage.expiredUnused, 0)
  const expiredValue = lots.reduce(
    (s, l) => s + l.usage.expiredUnused * l.supply.unitCost,
    0,
  )

  return {
    days,
    coverage,
    usage: lots.map((l) => l.usage),
    demandQuantity,
    coveredQuantity: demandQuantity - shortQuantity,
    shortQuantity,
    shortDemands,
    firstShortDate: shortDemands[0]?.demand.requiredDate,
    expiredQuantity,
    expiredValue,
    endingOnHand: lots.reduce((s, l) => s + l.remaining, 0),
    hasShortfall: shortQuantity > 0,
  }
}

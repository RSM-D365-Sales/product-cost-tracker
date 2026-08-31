import type { ProductCostResult } from '../types/domain'
import type { ProductionCostResult } from '../types/production'
import type { ImpactInputs } from '../types/netting'
import type {
  LandedVarianceAnalysis,
  ProductionVarianceAnalysis,
} from './variance'
import type { Adjustments, NettingComparison, NettingResult } from './netting'
import { isNeutral } from './netting'
import { money, percent, qty, shortDate, signedMoney, signedPercent } from './format'
import { resolveDateWindow } from './query'

/**
 * The Copilot pane's narrative, composed deterministically from the figures on
 * the page. Every number quoted here is read off the same result object the
 * grids render — the analysis is generated, but nothing in it is invented, so
 * a prospect who checks a sentence against the grid finds the grid agrees.
 *
 * Tone rules: state the finding, then the number, then what to do about it.
 * Short sentences. No hedging that a cost accountant would not write.
 */

export interface CopilotSection {
  heading: string
  paragraphs: string[]
  bullets?: string[]
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const pts = (fraction: number): string =>
  `${Math.abs(fraction * 100).toFixed(1)} points`

/** "receipts", "runs" — pluralised without a library. */
const n = (count: number, singular: string, plural = `${singular}s`): string =>
  `${count} ${count === 1 ? singular : plural}`

// ---------------------------------------------------------------------------
// Purchasing activity — the product cost inquiry
// ---------------------------------------------------------------------------

/** The impact-analysis state, when the item has open POs to simulate against. */
export interface ImpactNarrativeInput {
  inputs: ImpactInputs
  baseline: NettingResult
  simulated: NettingResult
  comparison: NettingComparison
  adjustments: Adjustments
  /** True when at least one simulated change differs from as-ordered. */
  active: boolean
}

/** "PO-000931 moved out 7 days and confirmed 20% short", per adjusted line. */
function describeChanges(impact: ImpactNarrativeInput): string {
  const parts: string[] = []
  for (const s of impact.inputs.supplies) {
    if (s.kind !== 'Expected') continue
    const a = impact.adjustments[s.id]
    if (isNeutral(a)) continue
    const bits: string[] = []
    const shift = Math.round(a!.shiftDays)
    if (shift !== 0) {
      bits.push(`moved ${shift > 0 ? 'out' : 'in'} ${n(Math.abs(shift), 'day')}`)
    }
    if (a!.quantityPct !== 100) {
      bits.push(
        a!.quantityPct < 100
          ? `confirmed ${100 - a!.quantityPct}% short`
          : `confirmed ${a!.quantityPct - 100}% long`,
      )
    }
    parts.push(`${s.reference} ${bits.join(' and ')}`)
  }
  return parts.join('; ')
}

function impactSection(impact: ImpactNarrativeInput, unit: string): CopilotSection {
  const { inputs, baseline, simulated, comparison, active } = impact
  const cur = inputs.supplies[0]?.currency ?? 'USD'
  const expected = inputs.supplies.filter((s) => s.kind === 'Expected')
  const inbound = expected.reduce((s, e) => s + e.quantity, 0)
  const paragraphs: string[] = []

  if (!active) {
    const covered = baseline.coverage.filter((c) => c.short <= 0).length
    paragraphs.push(
      `${n(expected.length, 'open purchase order')} between ${shortDate(expected[0].availableDate)} and ` +
        `${shortDate(expected[expected.length - 1].availableDate)} add ${qty(inbound)} ${unit} to the supply. ` +
        `${covered} of ${baseline.coverage.length} downstream planned orders are covered at the confirmed dates and quantities` +
        (baseline.hasShortfall
          ? `; ${qty(baseline.shortQuantity)} ${unit} is already short from ${shortDate(baseline.firstShortDate!)}.`
          : ' — nothing goes short.'),
    )
    paragraphs.push(
      'Simulate a date or quantity change on an open order to see the downstream impact of a vendor change request before accepting it.',
    )
    return { heading: 'Impact analysis', paragraphs }
  }

  const changes = describeChanges(impact)
  if (comparison.hasImpact) {
    const first = comparison.newlyShortDemands[0] ?? simulated.shortDemands[0]
    let verdict =
      `Has impact — ${changes}. ` +
      (comparison.newlyShortDemands.length > 0 && first
        ? `${n(comparison.newlyShortDemands.length, 'downstream order goes', 'downstream orders go')} short, starting with ` +
          `${first.demand.reference} (${first.demand.description}) short ${qty(first.short)} ${unit} on ` +
          `${shortDate(first.demand.requiredDate)}.`
        : '')
    if (comparison.expiredValueDelta > 1) {
      verdict += ` ${money(comparison.expiredValueDelta, cur)} of material now expires unconsumed.`
    }
    paragraphs.push(verdict.trim())
  } else {
    paragraphs.push(
      `No impact — ${changes}. Every downstream order stays covered at the simulated dates and quantities.`,
    )
    if (comparison.endingOnHandDelta > 500) {
      paragraphs.push(
        `The change does add ${qty(comparison.endingOnHandDelta)} ${unit} of supply with no demand pegged to it — ` +
          'stock to sell through or push to a later requirement.',
      )
    }
  }

  return { heading: 'Impact analysis', paragraphs }
}

export function purchasingNarrative(
  result: ProductCostResult,
  analysis: LandedVarianceAnalysis | null,
  impact?: ImpactNarrativeInput,
): CopilotSection[] {
  const { item, summary, rows, query } = result
  const cur = summary.currency
  const unit = item.unit
  const sections: CopilotSection[] = []

  const window = resolveDateWindow(query)
  const windowText =
    window.from && window.to
      ? `between ${shortDate(window.from)} and ${shortDate(window.to)}`
      : window.from
        ? `since ${shortDate(window.from)}`
        : window.to
          ? `up to ${shortDate(window.to)}`
          : 'across all posted dates'

  const scopeFilters: string[] = []
  if (query.siteId) scopeFilters.push(`site ${query.siteId}`)
  if (query.warehouseId) scopeFilters.push(`warehouse ${query.warehouseId}`)
  if (query.batchNumber) scopeFilters.push(`batch ${query.batchNumber}`)
  if (query.purchaseOrderNumber)
    scopeFilters.push(`order ${query.purchaseOrderNumber}`)

  const produced = rows.filter((r) => r.sourceType === 'Production').length
  const purchased = rows.length - produced
  const vendors = new Set(
    rows.filter((r) => r.vendorAccount).map((r) => r.vendorAccount),
  )

  const activityBits: string[] = []
  if (purchased > 0)
    activityBits.push(
      `${n(purchased, 'purchase receipt')} from ${n(vendors.size, 'vendor')}`,
    )
  if (produced > 0)
    activityBits.push(`${n(produced, 'posted production run')}`)

  sections.push({
    heading: 'What was reviewed',
    paragraphs: [
      `${item.itemNumber} ${item.productName}: ${activityBits.join(' and ')} ` +
        `${windowText}${scopeFilters.length ? `, limited to ${scopeFilters.join(', ')}` : ''}, ` +
        `totalling ${qty(summary.totalQuantity)} ${unit}.`,
    ],
  })

  // --- Cost position -------------------------------------------------------
  const addOnShare =
    summary.averageLandedCost !== 0
      ? summary.averageAddOnCost / summary.averageLandedCost
      : 0
  const costGap =
    summary.currentCost !== 0
      ? (summary.averageLandedCost - summary.currentCost) / summary.currentCost
      : 0

  const position: string[] = [
    `The average landed cost is ${money(summary.averageLandedCost, cur)} per ${unit} — ` +
      `${money(summary.averagePurchaseCost, cur)} of goods plus ` +
      `${money(summary.averageAddOnCost, cur)} of ${produced > 0 && purchased === 0 ? 'conversion cost' : 'add-on charges'} ` +
      `(${percent(addOnShare)} of the landed figure).`,
  ]

  if (Math.abs(costGap) > 0.02) {
    position.push(
      `The item's cost record of ${money(summary.currentCost, cur)} ${costGap > 0 ? 'understates' : 'overstates'} ` +
        `that by ${percent(Math.abs(costGap))}, so the margin it implies (${percent(summary.averageMarginStandard)}) ` +
        `is ${costGap > 0 ? 'optimistic' : 'pessimistic'} against the ${percent(summary.averageMarginLanded)} the receipts support — ` +
        `a ${pts(summary.averageMarginStandard - summary.averageMarginLanded)} difference on every ${unit} sold.`,
    )
  } else {
    position.push(
      `The item's cost record of ${money(summary.currentCost, cur)} is within 2% of what the receipts actually landed at; ` +
        `margin at landed cost is ${percent(summary.averageMarginLanded)}.`,
    )
  }

  sections.push({ heading: 'Cost position', paragraphs: position })

  // --- Cost movement over the window --------------------------------------
  if (rows.length >= 6) {
    const asc = [...rows].sort((a, b) =>
      a.receiptDate < b.receiptDate ? -1 : 1,
    )
    const half = Math.floor(asc.length / 2)
    const meanLanded = (slice: typeof asc) => {
      const q = slice.reduce((s, r) => s + r.quantityReceived, 0)
      return q !== 0
        ? slice.reduce((s, r) => s + r.landedCost * r.quantityReceived, 0) / q
        : 0
    }
    const older = meanLanded(asc.slice(0, half))
    const newer = meanLanded(asc.slice(half))
    const change = older !== 0 ? (newer - older) / older : 0

    if (Math.abs(change) >= 0.015) {
      sections.push({
        heading: 'Cost movement',
        paragraphs: [
          `Landed cost is ${change > 0 ? 'rising' : 'easing'} across the window: the newer half of the receipts ` +
            `averages ${money(newer, cur)} per ${unit} against ${money(older, cur)} for the older half ` +
            `(${signedPercent(change)}).`,
        ],
      })
    }
  }

  // --- Variance ------------------------------------------------------------
  if (analysis && analysis.receipts.length >= 2) {
    const paras: string[] = []
    if (analysis.flagged.length === 0) {
      paras.push(
        `All ${n(analysis.receipts.length, 'receipt')} land within ±${analysis.tolerancePct}% of the ` +
          `baseline landed cost of ${money(analysis.baseline, cur)} per ${unit}. Nothing needs chasing at this tolerance.`,
      )
    } else {
      paras.push(
        `${n(analysis.flagged.length, 'receipt')} of ${analysis.receipts.length} fall outside ±${analysis.tolerancePct}% ` +
          `of the ${money(analysis.baseline, cur)} baseline — ${analysis.aboveCount} above (unfavourable), ${analysis.belowCount} below.`,
      )
      const worst = analysis.flagged[0]
      const driverText = worst.drivers
        .slice(0, 2)
        .map((d) => `${d.label.toLowerCase()} ${signedMoney(d.delta, cur)}`)
        .join(' and ')
      paras.push(
        `The largest is ${worst.row.receiptNumber} on ${worst.row.purchaseOrderNumber} ` +
          `(${shortDate(worst.row.receiptDate)}): ${money(worst.row.landedCost, cur)} per ${unit}, ` +
          `${signedPercent(worst.variancePct)} against the baseline, driven by ${driverText || 'broad movement across components'}.`,
      )
    }
    sections.push({ heading: 'Landed cost variance', paragraphs: paras })
  }

  // --- Expected supply and impact analysis ---------------------------------
  if (impact) {
    sections.push(impactSection(impact, item.unit))
  }

  // --- Recommendations -----------------------------------------------------
  const bullets: string[] = []
  if (impact?.active && impact.comparison.hasImpact) {
    const first =
      impact.comparison.newlyShortDemands[0] ?? impact.simulated.shortDemands[0]
    bullets.push(
      first
        ? `Before accepting the vendor's change, ask to split the delivery so ${first.demand.reference} keeps its ${shortDate(first.demand.requiredDate)} requirement covered, or move that planned order to match.`
        : 'Before accepting the vendor’s change, review the expiry exposure it creates in the impact analysis.',
    )
  }
  if (costGap > 0.02) {
    bullets.push(
      `Update the item cost record — it trails the receipts by ${percent(Math.abs(costGap))} and is flattering the margin.`,
    )
  }
  if (analysis) {
    const transport = analysis.causeLabels.find((c) => c.key === 'TRANSPORT')
    if (transport && analysis.aboveCount > 0) {
      const worstTransport = analysis.flagged.find((f) =>
        f.drivers.some((d) => d.key === 'TRANSPORT' && d.delta > 0),
      )
      if (worstTransport) {
        bullets.push(
          'Transportation is the recurring unfavourable driver on the flagged receipts — review carrier rates and load consolidation before the next contract cycle.',
        )
      }
    }
    if (analysis.aboveCount > 0) {
      bullets.push(
        `Walk the ${n(analysis.aboveCount, 'flagged unfavourable receipt')} with the buyer — the cause split on each row says whether the price or the charges moved.`,
      )
    }
  }
  if (bullets.length === 0) {
    bullets.push(
      'No action needed at this tolerance. Tighten the band or widen the date range to look deeper.',
    )
  }
  sections.push({ heading: 'Suggested actions', paragraphs: [], bullets })

  return sections
}

// ---------------------------------------------------------------------------
// Production activity — the production cost inquiry
// ---------------------------------------------------------------------------

export function productionNarrative(
  result: ProductionCostResult,
  analysis: ProductionVarianceAnalysis | null,
): CopilotSection[] {
  const { item, bom, rollup, summary, atRisk, lines, query } = result
  const cur = rollup.currency
  const unit = item.unit
  const sections: CopilotSection[] = []

  sections.push({
    heading: 'What was reviewed',
    paragraphs: [
      `${item.itemNumber} ${item.productName}: bill of material ${bom.bomId} ${bom.bomVersion} ` +
        `with ${n(bom.components.length, 'component')} and ${n(bom.operations.length, 'route operation')}` +
        `${query.siteId ? ` at site ${query.siteId}` : ''}, planned ${shortDate(summary.horizonFrom)} to ${shortDate(summary.horizonTo)}.`,
    ],
  })

  // --- Cost position -------------------------------------------------------
  const currentGap =
    rollup.currentCost !== 0
      ? (rollup.total - rollup.currentCost) / rollup.currentCost
      : 0
  const position: string[] = [
    `A unit calculates at ${money(rollup.total, cur)} today — that is ${signedPercent(currentGap)} against ` +
      `the ${money(rollup.currentCost, cur)} on the item's cost record, so the real margin is ` +
      `${percent(rollup.marginCalculated)} rather than the ${percent(rollup.marginCurrent)} the record suggests.`,
  ]
  if (rollup.actualRunCount > 0) {
    position.push(
      `${n(rollup.actualRunCount, 'posted run')} averaged ${money(rollup.actualCost, cur)} per ${unit}.`,
    )
  }
  sections.push({ heading: 'Cost position', paragraphs: position })

  // --- Variance drivers ----------------------------------------------------
  if (analysis) {
    const paras: string[] = []
    const biggest = [...analysis.bridge].sort(
      (a, b) => Math.abs(b.variance) - Math.abs(a.variance),
    )[0]
    if (biggest && Math.abs(analysis.bridgeVariance) > 0.005) {
      paras.push(
        `Posted runs average ${money(analysis.baselineTotal, cur)} against the ${money(analysis.calculatedTotal, cur)} calculation ` +
          `(${signedMoney(analysis.bridgeVariance, cur)} per ${unit}). ${biggest.label} carries the largest gap at ` +
          `${signedMoney(biggest.variance, cur)}${
            biggest.group === 'Material'
              ? ' — the calculation prices material at the lots on hand today, while each run consumed the lots of its own day'
              : ''
          }.`,
      )
    }
    if (analysis.flagged.length > 0) {
      const worst = analysis.flagged[0]
      const driverText = worst.drivers
        .slice(0, 2)
        .map((d) => `${d.label.toLowerCase()} ${signedMoney(d.delta, cur)}`)
        .join(' and ')
      paras.push(
        `${n(analysis.flagged.length, 'run')} of ${analysis.runs.length} sit outside ±${analysis.tolerancePct}% of the cohort average — ` +
          `the widest is ${worst.row.purchaseOrderNumber} (${shortDate(worst.row.receiptDate)}) at ${money(worst.total, cur)} per ${unit}, ` +
          `${signedPercent(worst.variancePct)}, on ${driverText || 'broad movement across groups'}.`,
      )
    } else {
      paras.push(
        `No posted run leaves ±${analysis.tolerancePct}% of the cohort average — run-to-run cost discipline is good; the story is in the bridge, not the outliers.`,
      )
    }
    if (paras.length > 0) {
      sections.push({ heading: 'Variance drivers', paragraphs: paras })
    }
  }

  // --- Plan and material exposure ------------------------------------------
  const planParas: string[] = [
    `The plan proposes ${n(summary.runCount, 'run')} for ${qty(summary.plannedQuantity)} ${unit} ` +
      `at an average ${money(summary.averageCostPerUnit, cur)}, using ${percent(summary.capacityUtilisation)} of committed line hours. ` +
      `Binding constraint: ${summary.bindingConstraint.toLowerCase()}.`,
  ]
  if (summary.atRiskValue > 0) {
    const worstLot = [...atRisk].sort((a, b) => b.value - a.value)[0]
    planParas.push(
      `${money(summary.atRiskValue, cur)} of material cannot be consumed before it expires — ` +
        `${qty(summary.atRiskQuantity)} ${worstLot?.unit ?? ''} of ${worstLot?.itemNumber ?? 'material'}, ` +
        `led by batch ${worstLot?.batchNumber} (expires ${shortDate(worstLot?.expiryDate ?? '')}).`,
    )
  } else {
    planParas.push('No material expires unconsumed under this plan.')
  }
  sections.push({ heading: 'Plan and material exposure', paragraphs: planParas })

  // --- Recommendations -----------------------------------------------------
  const bullets: string[] = []

  const enabledIds = new Set(
    (query.lineIds ?? lines.filter((l) => l.enabledByDefault).map((l) => l.lineId)),
  )
  const idleLine = lines.find((l) => !enabledIds.has(l.lineId))
  if (summary.atRiskValue > 0 && idleLine) {
    bullets.push(
      `Enable ${idleLine.lineId} (${idleLine.name}) and re-run — the current line set leaves ${money(summary.atRiskValue, cur)} to expire.`,
    )
  }
  if (Math.abs(currentGap) > 0.05) {
    bullets.push(
      `Recalculate and activate the item cost — the record is ${percent(Math.abs(currentGap))} ${currentGap > 0 ? 'below' : 'above'} what the BOM rolls up to today.`,
    )
  }
  if (analysis) {
    const unfavourable = [...analysis.bridge]
      .filter((b) => b.variance > 0.01 && b.group !== 'Material')
      .sort((a, b) => b.variance - a.variance)[0]
    if (unfavourable) {
      bullets.push(
        `Review ${unfavourable.label.toLowerCase()} inputs — posted runs carry ${signedMoney(unfavourable.variance, cur)} per ${unit} against the calculation.`,
      )
    }
  }
  if (bullets.length === 0) {
    bullets.push(
      'No action needed: the plan clears the material on hand and costs are tracking the calculation.',
    )
  }
  sections.push({ heading: 'Suggested actions', paragraphs: [], bullets })

  return sections
}

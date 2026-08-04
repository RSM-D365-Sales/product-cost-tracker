import type { AtRiskBatch, ProductionPlanSummary } from '../types/production'
import { money, percent, qty, shortDate } from '../lib/format'

/**
 * What the plan comes to, and what it fails to save.
 *
 * The at-risk block is the reason this page exists. A plan that only says "here
 * is what you can make" lets spoilage stay invisible; putting a dollar value on
 * the material that expires unconverted is what turns the parameters above it
 * into a decision.
 */

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string
  value: string
  sub?: string
  tone?: string
}) {
  return (
    <div className="border border-stroke bg-[#FAF9F8] px-3 py-2">
      <div className="text-sm text-ink-secondary">{label}</div>
      <div
        className={`text-lg font-semibold tabular-nums ${tone ?? 'text-ink'}`}
      >
        {value}
      </div>
      {sub ? <div className="text-sm text-ink-secondary">{sub}</div> : null}
    </div>
  )
}

export function PlanSummaryPanel({
  summary,
  atRisk,
}: {
  summary: ProductionPlanSummary
  atRisk: AtRiskBatch[]
}) {
  const c = summary.currency
  // The at-risk quantity is measured in the CONSUMED component's unit (lb of
  // avocados), not the finished item's (packs), so it has to come off the rows.
  const atRiskUnit = atRisk[0]?.unit ?? ''

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-3 xl:grid-cols-6">
        <Stat
          label="Planned output"
          value={`${qty(summary.plannedQuantity)} ${summary.unit}`}
          sub={`${summary.runCount} ${summary.runCount === 1 ? 'run' : 'runs'}`}
        />
        <Stat
          label="Average cost per unit"
          value={money(summary.averageCostPerUnit, c)}
          sub="At the lots actually consumed"
        />
        <Stat
          label="Total production cost"
          value={money(summary.totalCost, c)}
          sub={`Material ${money(summary.materialValueConsumed, c)}`}
        />
        <Stat
          label="Planned margin"
          value={percent(summary.plannedMargin)}
          sub={`Revenue ${money(summary.plannedRevenue, c)}`}
          tone={
            summary.plannedMargin >= 0.3
              ? 'text-status-good'
              : summary.plannedMargin >= 0.15
                ? 'text-status-warn'
                : 'text-status-bad'
          }
        />
        <Stat
          label="Capacity utilised"
          value={percent(summary.capacityUtilisation)}
          sub={`${qty(summary.scheduledHours)} of ${qty(summary.availableHours)} h`}
        />
        <Stat
          label="Material at risk"
          value={money(summary.atRiskValue, c)}
          sub={
            summary.atRiskQuantity > 0
              ? `${qty(Math.round(summary.atRiskQuantity))} ${atRiskUnit} expires unconverted`
              : 'Nothing expires unconverted'
          }
          tone={summary.atRiskValue > 0 ? 'text-status-bad' : 'text-status-good'}
        />
      </div>

      <p className="text-base text-ink-secondary">
        Horizon {shortDate(summary.horizonFrom)} –{' '}
        {shortDate(summary.horizonTo)} · binding constraint{' '}
        <span className="font-semibold text-ink">
          {summary.bindingConstraint}
        </span>
      </p>

      {atRisk.length > 0 ? (
        <div className="border border-status-bad/40 bg-status-badBg">
          <div className="border-b border-status-bad/25 px-3 py-[6px] text-md font-semibold text-status-bad">
            Material that will expire before it can be run
          </div>
          <table className="w-full border-separate border-spacing-0 text-base">
            <thead>
              <tr>
                {[
                  'Batch',
                  'Item',
                  'Expiry date',
                  'Days',
                  'Quantity',
                  'Unit cost',
                  'Value',
                  'Reason',
                ].map((h, i) => (
                  <th
                    key={h}
                    className={[
                      'border-b border-status-bad/20 px-3 py-1 text-sm font-semibold text-status-bad',
                      i >= 3 && i <= 6 ? 'text-right' : 'text-left',
                    ].join(' ')}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {atRisk.map((b) => (
                <tr key={b.batchNumber}>
                  <td className="border-b border-status-bad/15 px-3 py-1 font-mono text-sm">
                    {b.batchNumber}
                  </td>
                  <td className="border-b border-status-bad/15 px-3 py-1">
                    <span className="font-semibold">{b.itemNumber}</span>
                    <span className="ml-1 text-ink-secondary">
                      {b.productName}
                    </span>
                  </td>
                  <td className="border-b border-status-bad/15 px-3 py-1">
                    {shortDate(b.expiryDate)}
                  </td>
                  <td className="border-b border-status-bad/15 px-3 py-1 text-right tabular-nums">
                    {qty(b.daysToExpiry)}
                  </td>
                  <td className="border-b border-status-bad/15 px-3 py-1 text-right tabular-nums">
                    {qty(Math.round(b.quantity))} {b.unit}
                  </td>
                  <td className="border-b border-status-bad/15 px-3 py-1 text-right tabular-nums">
                    {money(b.unitCost, c)}
                  </td>
                  <td className="border-b border-status-bad/15 px-3 py-1 text-right font-semibold tabular-nums text-status-bad">
                    {money(b.value, c)}
                  </td>
                  <td className="border-b border-status-bad/15 px-3 py-1 text-sm text-ink-secondary">
                    {b.reason}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  )
}

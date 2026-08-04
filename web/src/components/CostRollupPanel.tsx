import type { CostGroup, CostRollup } from '../types/production'
import { money, percent } from '../lib/format'

/**
 * The cost calculation block: what one finished unit costs, split by cost
 * group, set against the item's own cost record and against what its posted
 * production receipts actually came in at.
 *
 * Those three numbers rarely agree, and the gaps are the point. Calculated is
 * what today's stock and today's route say it costs; current cost is what the
 * item master still believes; actual is what the last runs really cost.
 */

/** Tints for the four cost groups. Ordered dark to light, material heaviest. */
const GROUP_FILL: Record<CostGroup, string> = {
  Material: 'bg-brand',
  Packaging: 'bg-brand/60',
  Labour: 'bg-status-good/70',
  Overhead: 'bg-status-warn/70',
}

function marginTone(fraction: number): string {
  if (fraction >= 0.3) return 'text-status-good'
  if (fraction >= 0.15) return 'text-status-warn'
  return 'text-status-bad'
}

function varianceTone(variance: number): string {
  if (variance > 0) return 'text-status-bad'
  if (variance < 0) return 'text-status-good'
  return 'text-ink'
}

function ReadOnlyValue({
  label,
  value,
  tone,
  emphasis,
  title,
}: {
  label: string
  value: string
  tone?: string
  emphasis?: boolean
  title?: string
}) {
  return (
    <div className="flex items-center gap-3" title={title}>
      <span className="w-[210px] shrink-0 text-base text-brand">{label}</span>
      <span
        className={[
          'min-w-[120px] border border-stroke bg-[#FAF9F8] px-2 py-[3px] text-right text-base tabular-nums',
          emphasis ? 'font-semibold' : '',
          tone ?? 'text-ink',
        ].join(' ')}
      >
        {value}
      </span>
    </div>
  )
}

export function CostRollupPanel({
  rollup,
  unit,
}: {
  rollup: CostRollup
  unit: string
}) {
  const c = rollup.currency
  const variance = rollup.total - rollup.currentCost
  const variancePct = rollup.currentCost > 0 ? variance / rollup.currentCost : 0
  const actualVariance = rollup.actualCost > 0 ? rollup.total - rollup.actualCost : 0

  return (
    <div className="space-y-4">
      {/* Cost group composition — the whole bar is one finished unit. */}
      <div>
        <div className="mb-1 flex items-baseline gap-2">
          <span className="text-base text-brand">
            Calculated cost per {unit}
          </span>
          <span className="text-lg font-semibold tabular-nums text-ink">
            {money(rollup.total, c)}
          </span>
        </div>

        {/* 2px of surface between segments: abutting fills read as one mark and
            the eye loses the boundary, particularly for the thin ones. */}
        <div
          className="flex h-5 w-full gap-[2px] overflow-hidden border border-stroke bg-[#FAF9F8]"
          role="img"
          aria-label={rollup.byGroup
            .map((g) => `${g.group} ${money(g.amount, c)}`)
            .join(', ')}
        >
          {rollup.byGroup
            .filter((g) => g.amount > 0)
            .map((g) => (
              <div
                key={g.group}
                className={GROUP_FILL[g.group]}
                style={{
                  width: `${rollup.total > 0 ? (g.amount / rollup.total) * 100 : 0}%`,
                }}
                title={`${g.group} ${money(g.amount, c)} per ${unit}`}
              />
            ))}
        </div>

        <div className="mt-[6px] flex flex-wrap gap-x-5 gap-y-1">
          {rollup.byGroup.map((g) => (
            <span key={g.group} className="flex items-baseline gap-[6px]">
              <span
                className={`inline-block h-[9px] w-[9px] shrink-0 translate-y-[1px] ${GROUP_FILL[g.group]}`}
              />
              <span className="text-sm text-ink-secondary">{g.group}</span>
              <span className="text-base tabular-nums text-ink">
                {money(g.amount, c)}
              </span>
              <span className="text-sm tabular-nums text-ink-secondary">
                {percent(rollup.total > 0 ? g.amount / rollup.total : 0)}
              </span>
            </span>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-x-12 gap-y-2 border-t border-stroke-subtle pt-3 lg:grid-cols-2">
        <div className="space-y-2">
          <ReadOnlyValue
            label="Calculated cost"
            value={money(rollup.total, c)}
            emphasis
            title="Bill of material at the landed cost of stock on hand, plus the route"
          />
          <ReadOnlyValue
            label="Current cost"
            value={money(rollup.currentCost, c)}
            title="The cost carried on the item master"
          />
          <ReadOnlyValue
            label="Variance to current cost"
            value={`${variance >= 0 ? '+' : ''}${money(variance, c)}  (${variance >= 0 ? '+' : ''}${percent(variancePct)})`}
            tone={varianceTone(variance)}
            emphasis
            title="Positive means the item master is understating what this now costs to make"
          />
          <ReadOnlyValue
            label={`Actual cost (${rollup.actualRunCount} posted ${rollup.actualRunCount === 1 ? 'run' : 'runs'})`}
            value={
              rollup.actualRunCount > 0 ? money(rollup.actualCost, c) : '—'
            }
            title="Quantity-weighted cost of this item's posted production receipts"
          />
        </div>

        <div className="space-y-2">
          <ReadOnlyValue label="Selling price" value={money(rollup.sellingPrice, c)} />
          <ReadOnlyValue
            label={'Margin at calculated cost'}
            value={percent(rollup.marginCalculated)}
            tone={marginTone(rollup.marginCalculated)}
            emphasis
          />
          <ReadOnlyValue
            label={'Margin at current cost'}
            value={percent(rollup.marginCurrent)}
            tone={marginTone(rollup.marginCurrent)}
            emphasis
            title="What the margin looks like if you trust the item master"
          />
          <ReadOnlyValue
            label="Variance to actual cost"
            value={
              rollup.actualRunCount > 0
                ? `${actualVariance >= 0 ? '+' : ''}${money(actualVariance, c)}`
                : '—'
            }
            tone={
              rollup.actualRunCount > 0 ? varianceTone(actualVariance) : undefined
            }
          />
        </div>
      </div>
    </div>
  )
}

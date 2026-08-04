import type { ProductCostSummary } from '../types/domain'
import { money, percent, qty } from '../lib/format'

/**
 * The Summary block, laid out to mirror the source spreadsheet: cost figures on
 * the left, price and margin figures on the right, each as a read-only boxed
 * value with a blue caption.
 */

/** Margin bands used only for the colour cue; the number is always shown as-is. */
function marginTone(fraction: number): string {
  if (fraction >= 0.3) return 'text-status-good'
  if (fraction >= 0.15) return 'text-status-warn'
  return 'text-status-bad'
}

function ReadOnlyValue({
  label,
  value,
  tone,
  emphasis,
}: {
  label: string
  value: string
  tone?: string
  emphasis?: boolean
}) {
  return (
    <div className="flex items-center gap-3">
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

export function SummaryPanel({
  summary,
  unit,
}: {
  summary: ProductCostSummary
  unit: string
}) {
  const c = summary.currency

  return (
    <div className="grid grid-cols-1 gap-x-12 gap-y-2 lg:grid-cols-2">
      <div className="space-y-2">
        <ReadOnlyValue
          label="Average purchase cost"
          value={money(summary.averagePurchaseCost, c)}
        />
        <ReadOnlyValue
          label="Average landed cost"
          value={money(summary.averageLandedCost, c)}
          emphasis
        />
        <ReadOnlyValue
          label="Average add-on cost"
          value={money(summary.averageAddOnCost, c)}
        />
        <ReadOnlyValue
          label="Selling price"
          value={money(summary.sellingPrice, c)}
        />
      </div>

      <div className="space-y-2">
        <ReadOnlyValue
          label="Current cost"
          value={money(summary.currentCost, c)}
        />
        <ReadOnlyValue
          label={'Average margin "standard"'}
          value={percent(summary.averageMarginStandard)}
          tone={marginTone(summary.averageMarginStandard)}
          emphasis
        />
        <ReadOnlyValue
          label={'Average margin "landed"'}
          value={percent(summary.averageMarginLanded)}
          tone={marginTone(summary.averageMarginLanded)}
          emphasis
        />
        <ReadOnlyValue
          label="Quantity received"
          value={`${qty(summary.totalQuantity)} ${unit}`}
        />
      </div>
    </div>
  )
}

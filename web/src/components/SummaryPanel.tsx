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

/**
 * Prices only a live environment has to offer: the released product's purchase
 * price, and where the open order lines are priced. A purchase order created
 * in the walkthrough has no receipts yet, so without these the averages above
 * would be the only figures on the block — and they would be zero.
 */
export interface LivePrices {
  masterPurchasePrice?: number
  openOrders?: { quantity: number; purchasePrice: number; landedCost: number }
}

export function SummaryPanel({
  summary,
  unit,
  live,
}: {
  summary: ProductCostSummary
  unit: string
  live?: LivePrices
}) {
  const c = summary.currency
  // Nothing received yet (e.g. a purchase order created minutes ago): an
  // average of no receipts is not $0.00, and a landed margin on it is not 100%.
  const none = summary.receiptCount === 0
  const avg = (v: number) => (none ? '—' : money(v, c))

  return (
    <>
    <div className="grid grid-cols-1 gap-x-12 gap-y-2 lg:grid-cols-2">
      <div className="space-y-2">
        <ReadOnlyValue
          label="Average purchase cost"
          value={avg(summary.averagePurchaseCost)}
        />
        <ReadOnlyValue
          label="Average landed cost"
          value={avg(summary.averageLandedCost)}
          emphasis
        />
        <ReadOnlyValue
          label="Average add-on cost"
          value={avg(summary.averageAddOnCost)}
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
          value={none ? '—' : percent(summary.averageMarginLanded)}
          tone={none ? undefined : marginTone(summary.averageMarginLanded)}
          emphasis
        />
        <ReadOnlyValue
          label="Quantity received"
          value={`${qty(summary.totalQuantity)} ${unit}`}
        />
      </div>
    </div>

    {live && (live.masterPurchasePrice !== undefined || live.openOrders) ? (
      <div className="mt-3 grid grid-cols-1 gap-x-12 gap-y-2 border-t border-stroke-subtle pt-3 lg:grid-cols-2">
        <div className="space-y-2">
          {live.masterPurchasePrice !== undefined ? (
            <ReadOnlyValue
              label="Purchase price (released product)"
              value={money(live.masterPurchasePrice, c)}
            />
          ) : null}
          {live.openOrders ? (
            <ReadOnlyValue
              label="Open order purchase price"
              value={money(live.openOrders.purchasePrice, c)}
            />
          ) : null}
        </div>
        {live.openOrders ? (
          <div className="space-y-2">
            <ReadOnlyValue
              label="Open order landed cost"
              value={money(live.openOrders.landedCost, c)}
              emphasis
            />
            <ReadOnlyValue
              label="Quantity on order"
              value={`${qty(live.openOrders.quantity)} ${unit}`}
            />
          </div>
        ) : null}
      </div>
    ) : null}
    </>
  )
}

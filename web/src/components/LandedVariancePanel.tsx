import { useMemo } from 'react'
import type {
  CauseDelta,
  LandedVarianceAnalysis,
  ReceiptVariance,
  VarianceDirection,
} from '../lib/variance'
import { Grid, type Column } from './d365/Grid'
import { money, qty, shortDate, signedMoney, signedPercent } from '../lib/format'

/**
 * Landed cost variance: which receipts left the pack, in which direction, and
 * which cost component moved them — purchase price, transportation, customs,
 * and so on. The baseline is the quantity-weighted average landed cost of the
 * receipts in this result, so it moves with whatever window and filters the
 * inquiry was run with.
 */

export function DirectionPill({ direction }: { direction: VarianceDirection }) {
  const above = direction === 'above'
  return (
    <span
      className={[
        'inline-flex border px-[6px] py-px text-2xs font-semibold uppercase tracking-wide',
        above
          ? 'border-status-bad/40 bg-status-badBg text-status-bad'
          : 'border-status-good/40 bg-status-goodBg text-status-good',
      ].join(' ')}
      title={
        above
          ? 'Landed above the baseline — unfavourable'
          : 'Landed below the baseline — favourable'
      }
    >
      {above ? 'Above' : 'Below'}
    </span>
  )
}

export function varianceTone(value: number): string {
  if (value > 0) return 'text-status-bad'
  if (value < 0) return 'text-status-good'
  return 'text-ink'
}

/** "Transportation +$0.22 · Purchase price (FOB) +$0.05" — the story in a cell. */
export function DriverChips({
  drivers,
  currency,
  max = 2,
}: {
  drivers: CauseDelta[]
  currency: string
  max?: number
}) {
  if (drivers.length === 0) {
    return <span className="text-ink-secondary">Broad movement</span>
  }
  const text = drivers
    .slice(0, max)
    .map((d) => `${d.label} ${signedMoney(d.delta, currency)}`)
    .join(' · ')
  const full = drivers
    .map((d) => `${d.label} ${signedMoney(d.delta, currency)}`)
    .join(' · ')
  return (
    <span className="block truncate" title={full}>
      {text}
      {drivers.length > max ? ' · …' : ''}
    </span>
  )
}

/**
 * Tolerance is a form field, not a constant: nudging it live and watching rows
 * enter and leave the net is how the band gets agreed in the room.
 */
export function ToleranceField({
  tolerancePct,
  onToleranceChange,
}: {
  tolerancePct: number
  onToleranceChange: (pct: number) => void
}) {
  return (
    <div className="shrink-0">
      <label className="f-label" htmlFor="variance-tolerance">
        Tolerance (± %)
      </label>
      <input
        id="variance-tolerance"
        type="number"
        min={0.5}
        step={0.5}
        value={tolerancePct}
        onChange={(e) => {
          const v = Number(e.target.value)
          if (Number.isFinite(v) && v > 0) onToleranceChange(v)
        }}
        className="f-input f-input-num w-[90px]"
      />
    </div>
  )
}

/** Expanded row: the full cause decomposition, deltas tying out to the total. */
function CauseBreakdown({
  v,
  currency,
  unit,
  baseline,
}: {
  v: ReceiptVariance
  currency: string
  unit: string
  baseline: number
}) {
  const maxAbs = Math.max(...v.causes.map((c) => Math.abs(c.delta)), 0.0001)

  return (
    <div>
      <div className="mb-1 text-sm font-semibold text-ink">
        Variance causes — {v.row.purchaseOrderNumber} / {v.row.receiptNumber} ·{' '}
        {shortDate(v.row.receiptDate)}
      </div>
      <table className="w-full max-w-[860px] border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            <th className="border-b border-stroke py-1 pr-4 text-left font-semibold">
              Cause
            </th>
            <th className="border-b border-stroke py-1 pr-4 text-right font-semibold">
              This receipt / {unit}
            </th>
            <th className="border-b border-stroke py-1 pr-4 text-right font-semibold">
              Baseline / {unit}
            </th>
            <th className="border-b border-stroke py-1 pr-4 text-right font-semibold">
              Variance
            </th>
            <th className="border-b border-stroke py-1 text-left font-semibold">
              <span className="sr-only">Relative size</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {v.causes.map((c) => (
            <tr key={c.key}>
              <td className="border-b border-stroke-subtle py-1 pr-4">
                {c.label}
              </td>
              <td className="border-b border-stroke-subtle py-1 pr-4 text-right tabular-nums">
                {money(c.amount, currency)}
              </td>
              <td className="border-b border-stroke-subtle py-1 pr-4 text-right tabular-nums text-ink-secondary">
                {money(c.baseline, currency)}
              </td>
              <td
                className={`border-b border-stroke-subtle py-1 pr-4 text-right font-semibold tabular-nums ${varianceTone(c.delta)}`}
              >
                {signedMoney(c.delta, currency)}
              </td>
              <td className="border-b border-stroke-subtle py-1">
                <DivergingBar delta={c.delta} maxAbs={maxAbs} />
              </td>
            </tr>
          ))}
          <tr>
            <td className="py-1 pr-4 font-semibold">Landed cost</td>
            <td className="py-1 pr-4 text-right font-semibold tabular-nums">
              {money(v.row.landedCost, currency)}
            </td>
            <td className="py-1 pr-4 text-right font-semibold tabular-nums text-ink-secondary">
              {money(baseline, currency)}
            </td>
            <td
              className={`py-1 pr-4 text-right font-semibold tabular-nums ${varianceTone(v.variance)}`}
            >
              {signedMoney(v.variance, currency)}
            </td>
            <td className="py-1" />
          </tr>
        </tbody>
      </table>
    </div>
  )
}

/** Zero in the middle; unfavourable grows right in red, favourable left in green. */
export function DivergingBar({
  delta,
  maxAbs,
}: {
  delta: number
  maxAbs: number
}) {
  const half = Math.min(50, (Math.abs(delta) / maxAbs) * 50)
  return (
    <div
      className="relative h-[10px] w-[130px] border border-stroke bg-[#FAF9F8]"
      aria-hidden="true"
    >
      <div className="absolute inset-y-0 left-1/2 w-px bg-stroke-strong/60" />
      <div
        className={`absolute inset-y-[1px] ${delta >= 0 ? 'bg-status-bad/70' : 'bg-status-good/70'}`}
        style={
          delta >= 0
            ? { left: '50%', width: `${half}%` }
            : { right: '50%', width: `${half}%` }
        }
      />
    </div>
  )
}

export function VarianceStatTile({
  label,
  value,
  tone,
  hint,
}: {
  label: string
  value: string
  tone?: string
  hint?: string
}) {
  return (
    <div
      className="border border-stroke bg-[#FAF9F8] px-3 py-2"
      title={hint}
    >
      <div className="text-sm text-ink-secondary">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${tone ?? 'text-ink'}`}>
        {value}
      </div>
    </div>
  )
}

export function LandedVariancePanel({
  analysis,
  unit,
  tolerancePct,
  onToleranceChange,
}: {
  analysis: LandedVarianceAnalysis
  unit: string
  tolerancePct: number
  onToleranceChange: (pct: number) => void
}) {
  const { currency, baseline, flagged, receipts } = analysis

  const columns = useMemo<Column<ReceiptVariance>[]>(
    () => [
      {
        key: 'po',
        header: 'Order',
        width: '100px',
        sortValue: (v) => v.row.purchaseOrderNumber,
        render: (v) => v.row.purchaseOrderNumber,
      },
      {
        key: 'receipt',
        header: 'Receipt number',
        width: '115px',
        sortValue: (v) => v.row.receiptNumber,
        render: (v) => v.row.receiptNumber,
      },
      {
        key: 'date',
        header: 'Receipt date',
        width: '100px',
        sortValue: (v) => v.row.receiptDate,
        render: (v) => shortDate(v.row.receiptDate),
      },
      {
        key: 'batch',
        header: 'Batch',
        width: '110px',
        sortValue: (v) => v.row.batchNumber ?? '',
        render: (v) => v.row.batchNumber ?? '—',
      },
      {
        key: 'qty',
        header: 'Quantity',
        width: '90px',
        align: 'right',
        sortValue: (v) => v.row.quantityReceived,
        render: (v) => qty(v.row.quantityReceived),
      },
      {
        key: 'landed',
        header: 'Landed cost',
        width: '100px',
        align: 'right',
        sortValue: (v) => v.row.landedCost,
        render: (v) => (
          <span className="font-semibold">
            {money(v.row.landedCost, currency)}
          </span>
        ),
      },
      {
        key: 'baseline',
        header: 'Baseline',
        headerTitle: 'Quantity-weighted average landed cost of this result',
        width: '95px',
        align: 'right',
        sortValue: () => baseline,
        render: () => (
          <span className="text-ink-secondary">{money(baseline, currency)}</span>
        ),
      },
      {
        key: 'var',
        header: 'Variance',
        width: '95px',
        align: 'right',
        sortValue: (v) => v.variance,
        render: (v) => (
          <span className={`font-semibold ${varianceTone(v.variance)}`}>
            {signedMoney(v.variance, currency)}
          </span>
        ),
      },
      {
        key: 'varPct',
        header: 'Variance %',
        width: '95px',
        align: 'right',
        sortValue: (v) => v.variancePct,
        render: (v) => (
          <span className={varianceTone(v.variance)}>
            {signedPercent(v.variancePct)}
          </span>
        ),
      },
      {
        key: 'dir',
        header: 'Direction',
        width: '85px',
        sortValue: (v) => v.direction,
        render: (v) => <DirectionPill direction={v.direction} />,
      },
      {
        key: 'drivers',
        header: 'Variance drivers',
        headerTitle:
          'The cost components that moved this receipt away from the baseline, largest first. Expand the row for the full decomposition.',
        render: (v) => <DriverChips drivers={v.drivers} currency={currency} />,
      },
    ],
    [currency, baseline],
  )

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-4">
        <p className="min-w-[260px] max-w-[860px] flex-1 text-base text-ink-secondary">
          Each receipt is measured against the quantity-weighted average landed
          cost of this result. A receipt outside the tolerance band is listed
          below with the cost components that put it there — the direction on
          each cause is what tells you whether to call the carrier or the buyer.
        </p>
        <ToleranceField
          tolerancePct={tolerancePct}
          onToleranceChange={onToleranceChange}
        />
      </div>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <VarianceStatTile
          label={`Baseline landed cost / ${unit}`}
          value={money(baseline, currency)}
          hint="Quantity-weighted average of every receipt in this result"
        />
        <VarianceStatTile
          label="Within tolerance"
          value={`${receipts.length - flagged.length} of ${receipts.length}`}
        />
        <VarianceStatTile
          label={`Above +${tolerancePct}%`}
          value={String(analysis.aboveCount)}
          tone={analysis.aboveCount > 0 ? 'text-status-bad' : undefined}
          hint="Landed above the baseline — unfavourable"
        />
        <VarianceStatTile
          label={`Below −${tolerancePct}%`}
          value={String(analysis.belowCount)}
          tone={analysis.belowCount > 0 ? 'text-status-good' : undefined}
          hint="Landed below the baseline — favourable"
        />
      </div>

      {flagged.length === 0 ? (
        <p className="border border-status-good/40 bg-status-goodBg px-3 py-2 text-base text-status-good">
          Every receipt in this result lands within ±{tolerancePct}% of the
          baseline. Widen the date range or tighten the tolerance to look
          harder.
        </p>
      ) : (
        <Grid
          columns={columns}
          rows={flagged}
          getRowId={(v) => v.row.id}
          renderDetail={(v) => (
            <CauseBreakdown
              v={v}
              currency={currency}
              unit={unit}
              baseline={baseline}
            />
          )}
          emptyMessage="No receipts are outside the tolerance band."
          maxHeight="380px"
        />
      )}
    </div>
  )
}

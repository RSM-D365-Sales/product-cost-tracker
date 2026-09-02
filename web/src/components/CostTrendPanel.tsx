import { useMemo, useState } from 'react'
import type { ProductCostResult, ReceiptRow } from '../types/domain'
import {
  CostTrendChart,
  FORECAST_PRESETS,
  SERIES,
  type SeriesKey,
} from './CostTrendChart'
import { MessageBar } from './d365/MessageBar'
import {
  dayNumber,
  fitQuality,
  fitTrend,
  predictAt,
  predictionInterval,
  slopePerYear,
  type FitQuality,
  type TrendFit,
} from '../lib/trend'
import { money, percent } from '../lib/format'

/**
 * "Cost trend" — the chart plus the controls that scope it and the numbers
 * behind it.
 *
 * The controls sit in one row above the plot and change only how the SAME rows
 * are drawn; anything that changes WHICH rows are in play stays in the
 * Parameters block, so the chart and the grid can never disagree.
 *
 * The fit statistics are deliberately as prominent as the projection itself. A
 * trend line drawn through scattered seasonal commodity prices looks every bit
 * as confident as one through a genuine march upward, and the only thing that
 * tells them apart is r² — so it is on screen, in words, next to the number it
 * qualifies.
 */

const QUALITY_COPY = {
  strong: {
    kind: 'info' as const,
    title: 'The trend explains most of the variation in these receipts.',
    detail:
      'The projection is a reasonable read of where price is heading, on the assumption that nothing structural changes.',
  },
  moderate: {
    kind: 'info' as const,
    title: 'The trend explains some of the variation in these receipts.',
    detail:
      'Receipts scatter around the line by more than the line moves. Treat the projection as a direction of travel, not a number to plan against.',
  },
  weak: {
    kind: 'warning' as const,
    title: 'Weak fit — these receipts barely follow a straight line at all.',
    detail:
      'Seasonal produce and spot-market commodities normally look like this. The projection is shown for completeness; do not quote it as a forecast.',
  },
}

/** One series, its fit, and everything derived from the fit. */
interface SeriesStat {
  key: SeriesKey
  label: string
  color: string
  pick: (r: ReceiptRow) => number
  /** Null when there were too few receipts, or too few distinct dates. */
  fit: TrendFit | null
  /** Present exactly when `fit` is. */
  perYear?: number
  projected?: number
  band?: { lo: number; hi: number }
  quality?: FitQuality
}

export function CostTrendPanel({
  result,
  expected,
}: {
  result: ProductCostResult
  /**
   * Open PO lines to plot as hollow marks at their confirmed delivery dates.
   * The page passes them only while "Show expected POs" is on, so the chart
   * and the grid always agree on whether the pipeline is in view. They never
   * enter the fit or the stats below it.
   */
  expected?: ReceiptRow[]
}) {
  const [horizonDays, setHorizonDays] = useState(182)
  const [visible, setVisible] = useState<Record<SeriesKey, boolean>>({
    landed: true,
    fob: true,
  })

  const { rows, item } = result

  const stats = useMemo<SeriesStat[]>(() => {
    const points = (pick: (r: ReceiptRow) => number) =>
      rows.map((r) => ({ t: dayNumber(r.receiptDate), y: pick(r) }))

    const lastT = rows.length
      ? Math.max(...rows.map((r) => dayNumber(r.receiptDate)))
      : 0

    return SERIES.map((s) => {
      const fit = fitTrend(points(s.pick))
      if (!fit) return { ...s, fit: null }
      const at = lastT + horizonDays
      return {
        ...s,
        fit,
        perYear: slopePerYear(fit),
        projected: predictAt(fit, at),
        band: predictionInterval(fit, at),
        quality: fitQuality(fit),
      }
    })
  }, [rows, horizonDays])

  // The message speaks for the primary series, which is the one carrying the
  // direct label on the chart.
  const primary = stats.find((s) => s.key === 'landed' && s.fit)
  const note = primary?.quality ? QUALITY_COPY[primary.quality] : null

  const toggle = (key: SeriesKey) => {
    setVisible((prev) => {
      const next = { ...prev, [key]: !prev[key] }
      // Never let the reader empty the plot.
      if (!next.landed && !next.fob) return prev
      return next
    })
  }

  if (rows.length < 3) {
    return (
      <p className="py-8 text-center text-sm text-ink-secondary">
        A trend needs at least three receipts. This inquiry returned{' '}
        {rows.length}. Widen the date range or clear the optional parameters.
      </p>
    )
  }

  return (
    <div>
      {/* One control row, above everything it scopes. */}
      <div className="mb-3 flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-stroke-subtle pb-3">
        <div className="flex items-center gap-2">
          <span className="text-sm text-ink-secondary">Project forward</span>
          <div className="flex" role="group" aria-label="Projection horizon">
            {FORECAST_PRESETS.map((p) => (
              <button
                key={p.days}
                type="button"
                aria-pressed={horizonDays === p.days}
                onClick={() => setHorizonDays(p.days)}
                className={`border px-2 py-[3px] text-sm transition-colors ${
                  horizonDays === p.days
                    ? 'border-brand bg-brand-tint font-semibold text-brand'
                    : 'border-stroke bg-surface text-ink hover:bg-[#F3F2F1]'
                } -ml-px first:ml-0`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Doubles as the legend: the swatch is the mark's own colour, and the
            text stays in ink so identity never rests on coloured type. */}
        <div className="flex items-center gap-3" role="group" aria-label="Series">
          {SERIES.map((s) => (
            <label
              key={s.key}
              className="flex cursor-pointer items-center gap-[6px] text-sm text-ink"
            >
              <input
                type="checkbox"
                checked={visible[s.key]}
                onChange={() => toggle(s.key)}
                className="h-[13px] w-[13px] accent-brand"
              />
              <span
                aria-hidden="true"
                className="h-[3px] w-4 rounded-full"
                style={{ backgroundColor: s.color }}
              />
              {s.label}
            </label>
          ))}
          {expected && expected.length > 0 ? (
            <span className="flex items-center gap-[6px] text-sm text-ink-secondary">
              <span
                aria-hidden="true"
                className="h-[9px] w-[9px] rounded-full border-2 border-ink-secondary bg-surface"
              />
              {expected.length} expected{' '}
              {expected.length === 1 ? 'PO' : 'POs'} — hollow marks
            </span>
          ) : null}
        </div>
      </div>

      <CostTrendChart
        rows={rows}
        expected={expected}
        currency={item.currency}
        unit={item.unit}
        horizonDays={horizonDays}
        visible={visible}
      />

      <div className="mt-3 grid grid-cols-1 gap-x-8 gap-y-2 border-t border-stroke-subtle pt-3 md:grid-cols-2">
        {stats.map((s) => (
          <div key={s.key} data-series={s.key}>
            <div className="flex items-center gap-[6px]">
              <span
                aria-hidden="true"
                className="h-[3px] w-4 rounded-full"
                style={{ backgroundColor: s.color }}
              />
              <span className="text-sm font-semibold text-ink">{s.label}</span>
              {!visible[s.key] ? (
                <span className="text-xs text-ink-secondary">(hidden)</span>
              ) : null}
            </div>

            {s.fit ? (
              <dl className="mt-1 grid grid-cols-3 gap-x-3">
                <Stat
                  stat="trend"
                  label="Trend"
                  value={`${s.perYear! >= 0 ? '+' : '−'}${money(
                    Math.abs(s.perYear!),
                    item.currency,
                  )}`}
                  hint={`per ${item.unit} per year`}
                />
                <Stat
                  stat="fit"
                  label="Fit (r²)"
                  value={percent(s.fit.r2)}
                  hint={`${s.fit.n} receipts`}
                />
                {horizonDays > 0 ? (
                  <Stat
                    stat="projected"
                    label="Projected"
                    value={money(s.projected!, item.currency)}
                    hint={`${money(s.band!.lo, item.currency)} – ${money(
                      s.band!.hi,
                      item.currency,
                    )}`}
                  />
                ) : (
                  <Stat
                    stat="projected"
                    label="Projected"
                    value="—"
                    hint="no horizon set"
                  />
                )}
              </dl>
            ) : (
              <p className="mt-1 text-sm text-ink-secondary">
                Not enough distinct receipt dates to fit a trend.
              </p>
            )}
          </div>
        ))}
      </div>

      {note ? (
        <div className="mt-3">
          <MessageBar kind={note.kind} title={note.title} detail={note.detail} />
        </div>
      ) : null}

      {horizonDays > 0 ? (
        <p className="mt-2 text-xs text-ink-secondary">
          The projection is an ordinary least-squares line through the receipts
          above, extended forward. The shaded band is the 95% interval for where
          a single future receipt would land — it widens with distance because
          the further out you go, the less the past constrains it. Unlike the
          Summary block, the fit is unweighted: each receipt counts as one
          negotiated price regardless of load size.
        </p>
      ) : null}

      {expected && expected.length > 0 ? (
        <p className="mt-2 text-xs text-ink-secondary">
          Hollow marks are open purchase orders at their confirmed delivery
          dates — vendor-confirmed prices plus estimated charges. They are
          plotted for context and never enter the fit or the statistics above:
          a cost not yet paid is not part of the trend.
        </p>
      ) : null}
    </div>
  )
}

function Stat({
  stat,
  label,
  value,
  hint,
}: {
  /** Stable hook for verify.mjs — the visible text is not scrapeable, because
      the SVG's own labels and axis ticks sit in the same subtree. */
  stat: string
  label: string
  value: string
  hint: string
}) {
  return (
    <div>
      <dt className="text-xs text-ink-secondary">{label}</dt>
      <dd
        data-stat={stat}
        className="text-base font-semibold tabular-nums text-ink"
      >
        {value}
      </dd>
      <dd className="text-xs text-ink-secondary">{hint}</dd>
    </div>
  )
}

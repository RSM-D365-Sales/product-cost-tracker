import { useMemo, useState } from 'react'
import type {
  AtRiskBatch,
  BatchOnHand,
  PlannedRun,
  ProductionPlanSummary,
} from '../types/production'
import { money, percent, qty, shortDate } from '../lib/format'
import { dayNumber, isoFromDayNumber } from '../lib/trend'

/**
 * Committed capacity against scheduled load, one column per day.
 *
 * The form is a meter per day, not a line: the reader's job is "is this day full
 * relative to its limit", which is a ratio against a limit. The track is the
 * hours committed to this item that day; the fill is the hours the plan actually
 * schedules. A day that fills its track is a day that cannot absorb another lot.
 *
 * Lot expiries are marked under the axis, because the shape of the fill is
 * otherwise inexplicable — the plan front-loads not because early days are
 * cheaper but because material is about to go off.
 */

const BAR_MIN_WIDTH = 26
const BAR_GAP = 2
const PLOT_HEIGHT = 92
const MARKER_BAND = 22

interface DayCell {
  index: number
  iso: string
  scheduledHours: number
  committedHours: number
  quantity: number
  runs: PlannedRun[]
  /** Lots whose last usable day this is. */
  expiring: BatchOnHand[]
  expiringAtRisk: boolean
}

export function CapacityTimeline({
  summary,
  plan,
  onHand,
  atRisk,
  componentItemNumbers,
}: {
  summary: ProductionPlanSummary
  plan: PlannedRun[]
  onHand: BatchOnHand[]
  atRisk: AtRiskBatch[]
  /** Batch-tracked component items — the ones whose expiry constrains the plan. */
  componentItemNumbers: string[]
}) {
  const [hover, setHover] = useState<number | null>(null)

  const days = useMemo<DayCell[]>(() => {
    const first = dayNumber(summary.horizonFrom)
    const last = dayNumber(summary.horizonTo)
    const count = Math.max(1, last - first + 1)
    const committedPerDay = summary.availableHours / count
    const atRiskBatches = new Set(atRisk.map((b) => b.batchNumber))
    const components = new Set(componentItemNumbers)

    return Array.from({ length: count }, (_, index) => {
      const iso = isoFromDayNumber(first + index)
      const runs = plan.filter((r) => r.startDate === iso)
      const expiring = onHand.filter(
        (b) => components.has(b.itemNumber) && b.expiryDate === iso,
      )

      return {
        index,
        iso,
        scheduledHours: runs.reduce((s, r) => s + r.runHours, 0),
        committedHours: committedPerDay,
        quantity: runs.reduce((s, r) => s + r.quantity, 0),
        runs,
        expiring,
        expiringAtRisk: expiring.some((b) => atRiskBatches.has(b.batchNumber)),
      }
    })
  }, [summary, plan, onHand, atRisk, componentItemNumbers])

  const barWidth = BAR_MIN_WIDTH
  const step = barWidth + BAR_GAP
  const width = days.length * step - BAR_GAP
  const height = PLOT_HEIGHT + MARKER_BAND
  const ceiling = Math.max(
    ...days.map((d) => Math.max(d.scheduledHours, d.committedHours)),
    1,
  )
  const scale = (hours: number) => (hours / ceiling) * PLOT_HEIGHT

  // Direct-label the busiest day only. A number on every column is noise.
  const busiest = days.reduce(
    (best, d) => (d.scheduledHours > best.scheduledHours ? d : best),
    days[0],
  )

  const active = hover !== null ? days[hover] : null

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-baseline gap-x-6 gap-y-1">
        <h3 className="text-md font-semibold text-ink">
          Committed capacity and scheduled load
        </h3>
        <span className="text-sm text-ink-secondary">
          {qty(summary.scheduledHours)} of {qty(summary.availableHours)} committed
          hours scheduled ·{' '}
          <span className="font-semibold text-ink">
            {percent(summary.capacityUtilisation)}
          </span>{' '}
          utilised
        </span>
      </div>

      <div className="overflow-x-auto border border-stroke bg-surface p-3">
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={`Scheduled hours per day against committed hours, ${shortDate(summary.horizonFrom)} to ${shortDate(summary.horizonTo)}. ${percent(summary.capacityUtilisation)} of committed capacity is scheduled.`}
          className="block"
          onMouseLeave={() => setHover(null)}
        >
          {days.map((d) => {
            const x = d.index * step
            const trackHeight = Math.max(1, scale(d.committedHours))
            const fillHeight = Math.max(0, scale(d.scheduledHours))
            const isHover = hover === d.index

            return (
              <g key={d.iso}>
                {/* Track: the hours this item is allowed to have that day. */}
                <rect
                  x={x}
                  y={PLOT_HEIGHT - trackHeight}
                  width={barWidth}
                  height={trackHeight}
                  rx={3}
                  className="fill-[#EDEBE9]"
                />
                {fillHeight > 0 ? (
                  <rect
                    x={x}
                    y={PLOT_HEIGHT - fillHeight}
                    width={barWidth}
                    height={fillHeight}
                    rx={3}
                    className="fill-brand"
                  />
                ) : null}

                {/* Expiry marker, under the axis, in the day it lapses. */}
                {d.expiring.length > 0 ? (
                  <rect
                    x={x}
                    y={PLOT_HEIGHT + 4}
                    width={barWidth}
                    height={4}
                    rx={2}
                    className={
                      d.expiringAtRisk
                        ? 'fill-status-bad'
                        : 'fill-status-warn'
                    }
                  />
                ) : null}

                <text
                  x={x + barWidth / 2}
                  y={height - 6}
                  textAnchor="middle"
                  className="fill-ink-secondary text-[9px]"
                >
                  {Number(d.iso.slice(8, 10))}
                </text>

                {d === busiest && d.scheduledHours > 0 ? (
                  <text
                    x={x + barWidth / 2}
                    y={PLOT_HEIGHT - fillHeight - 4}
                    textAnchor="middle"
                    className="fill-ink text-[10px] font-semibold"
                  >
                    {d.scheduledHours.toFixed(1)}h
                  </text>
                ) : null}

                {/* Hit target spans the full column height, not just the fill. */}
                <rect
                  x={x - BAR_GAP / 2}
                  y={0}
                  width={step}
                  height={height}
                  fill="transparent"
                  onMouseEnter={() => setHover(d.index)}
                />
                {isHover ? (
                  <rect
                    x={x - 1}
                    y={-1}
                    width={barWidth + 2}
                    height={PLOT_HEIGHT + 2}
                    rx={4}
                    fill="none"
                    className="stroke-ink-secondary"
                    strokeWidth={1}
                  />
                ) : null}
              </g>
            )
          })}

          <line
            x1={0}
            y1={PLOT_HEIGHT}
            x2={width}
            y2={PLOT_HEIGHT}
            className="stroke-stroke"
            strokeWidth={1}
          />
        </svg>
      </div>

      <div className="mt-[6px] flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
        <span className="flex items-center gap-[6px]">
          <span className="inline-block h-[9px] w-[9px] bg-brand" />
          <span className="text-ink-secondary">Scheduled hours</span>
        </span>
        <span className="flex items-center gap-[6px]">
          <span className="inline-block h-[9px] w-[9px] bg-[#EDEBE9]" />
          <span className="text-ink-secondary">Committed hours available</span>
        </span>
        <span className="flex items-center gap-[6px]">
          <span className="inline-block h-[4px] w-[12px] bg-status-warn" />
          <span className="text-ink-secondary">Batch expires</span>
        </span>
        <span className="flex items-center gap-[6px]">
          <span className="inline-block h-[4px] w-[12px] bg-status-bad" />
          <span className="text-ink-secondary">Batch expires with stock left</span>
        </span>
      </div>

      {/* Read-out rather than a floating tooltip: it never clips at the edge of
          the scroll container and it stays put while the eye moves. */}
      <div
        role="status"
        aria-live="polite"
        className="mt-2 min-h-[46px] border border-stroke bg-[#FAF9F8] px-3 py-2 text-base"
      >
        {active ? (
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
            <span className="font-semibold text-ink">
              {shortDate(active.iso)}
            </span>
            <span className="text-ink-secondary">
              Scheduled{' '}
              <span className="font-semibold tabular-nums text-ink">
                {active.scheduledHours.toFixed(2)} h
              </span>{' '}
              of {active.committedHours.toFixed(2)} h committed
            </span>
            <span className="text-ink-secondary">
              {active.runs.length}{' '}
              {active.runs.length === 1 ? 'run' : 'runs'} ·{' '}
              <span className="font-semibold tabular-nums text-ink">
                {qty(active.quantity)} {summary.unit}
              </span>
            </span>
            {active.expiring.length > 0 ? (
              <span
                className={
                  active.expiringAtRisk ? 'text-status-bad' : 'text-status-warn'
                }
              >
                Last usable day for{' '}
                {active.expiring.map((b) => b.batchNumber).join(', ')}
              </span>
            ) : null}
          </div>
        ) : (
          <span className="text-ink-secondary">
            Point at a day to read its load. Binding constraint:{' '}
            <span className="text-ink">{summary.bindingConstraint}</span>
            {summary.atRiskValue > 0 ? (
              <>
                {' '}
                · at risk{' '}
                <span className="font-semibold text-status-bad">
                  {money(summary.atRiskValue, summary.currency)}
                </span>
              </>
            ) : null}
          </span>
        )}
      </div>
    </div>
  )
}

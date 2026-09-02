import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReceiptRow } from '../types/domain'
import {
  dayNumber,
  fitTrend,
  predictAt,
  predictionInterval,
  type TrendFit,
} from '../lib/trend'
import { money, qty, shortDate } from '../lib/format'

/**
 * Cost per unit over time, with a fitted trend and a forward projection.
 *
 * Hand-rolled SVG rather than a charting library: the bundle stays
 * dependency-free and safe under a strict CSP, and the marks can follow the
 * F&O visual language instead of fighting a library's defaults.
 *
 * Two series, both in currency per unit, so they share ONE y-axis — a second
 * scale would invent a correlation that isn't in the data. The gap between them
 * is the add-on cost, which is the thing this whole app exists to show, so
 * plotting them together is the point rather than a convenience.
 *
 * Palette: D365 brand blue and Fluent orange, validated as a categorical pair
 * against the white chart surface (CVD ΔE 23.9, normal-vision ΔE 31.4, both
 * clear of the 8 / 15 floors, both ≥ 3:1 contrast).
 */

const SERIES = [
  {
    key: 'landed' as const,
    label: 'Landed cost',
    color: '#0F6CBD',
    pick: (r: ReceiptRow) => r.landedCost,
  },
  {
    key: 'fob' as const,
    label: 'Purchase / material',
    color: '#CA5010',
    pick: (r: ReceiptRow) => r.purchasePriceFob,
  },
]

export type SeriesKey = (typeof SERIES)[number]['key']

// Chart chrome, one step off the surface so it stays recessive.
const INK = '#242424'
const INK_SECONDARY = '#605E5C'
const INK_MUTED = '#8A8886'
const GRID = '#E1DFDD'
const SURFACE = '#FFFFFF'
const FORECAST_WASH = '#FAF9F8'

const PAD = { top: 16, right: 76, bottom: 30, left: 60 }
const HEIGHT = 300

/** Axis ticks on 1/2/5 x 10^n boundaries so the labels read as round numbers. */
function niceTicks(min: number, max: number, target = 5): number[] {
  if (!(max > min)) return [min]
  const raw = (max - min) / target
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  const normalised = raw / magnitude
  const step =
    (normalised >= 5 ? 10 : normalised >= 2 ? 5 : normalised >= 1 ? 2 : 1) *
    magnitude

  const out: number[] = []
  for (
    let v = Math.ceil(min / step) * step;
    v <= max + step * 1e-9;
    v += step
  ) {
    out.push(Math.round(v * 1e6) / 1e6)
  }
  return out
}

/** Month-start ticks across the domain, thinned to roughly `target` of them. */
function monthTicks(fromDay: number, toDay: number, target = 6): number[] {
  const start = new Date(fromDay * 86_400_000)
  const months: number[] = []
  const cursor = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1),
  )
  while (true) {
    const day = Math.round(cursor.getTime() / 86_400_000)
    if (day > toDay) break
    if (day >= fromDay) months.push(day)
    cursor.setUTCMonth(cursor.getUTCMonth() + 1)
  }
  if (months.length <= target) return months
  const stride = Math.ceil(months.length / target)
  return months.filter((_, i) => i % stride === 0)
}

function monthLabel(day: number): string {
  const d = new Date(day * 86_400_000)
  return `${d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })} ${String(
    d.getUTCFullYear(),
  ).slice(2)}`
}

interface Plotted {
  key: SeriesKey
  label: string
  color: string
  pick: (r: ReceiptRow) => number
  points: { t: number; y: number; row: ReceiptRow }[]
  /** Open PO lines, drawn hollow at their confirmed delivery dates. */
  expectedPoints: { t: number; y: number; row: ReceiptRow }[]
  fit: TrendFit | null
}

export function CostTrendChart({
  rows,
  expected,
  currency,
  unit,
  horizonDays,
  visible,
}: {
  rows: ReceiptRow[]
  /**
   * Open purchase orders not yet received. Plotted as hollow marks at their
   * confirmed delivery dates — visible context, but NEVER part of the fit: a
   * cost not yet paid is not a trend that has been measured.
   */
  expected?: ReceiptRow[]
  currency: string
  unit: string
  /** Days past the last receipt to project. Zero draws history only. */
  horizonDays: number
  /** Which series are switched on; at least one is always on. */
  visible: Record<SeriesKey, boolean>
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(880)
  const [activeT, setActiveT] = useState<number | null>(null)

  // Measure rather than rely on a viewBox, so 11px axis labels stay 11px
  // instead of being scaled to whatever the container happens to be.
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      setWidth(Math.max(420, Math.round(entry.contentRect.width)))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const model = useMemo(() => {
    const dated = rows
      .map((row) => ({ t: dayNumber(row.receiptDate), row }))
      .sort((a, b) => a.t - b.t)
    const expDated = (expected ?? [])
      .map((row) => ({ t: dayNumber(row.receiptDate), row }))
      .sort((a, b) => a.t - b.t)

    const series: Plotted[] = SERIES.filter((s) => visible[s.key]).map((s) => {
      const points = dated.map(({ t, row }) => ({ t, y: s.pick(row), row }))
      const expectedPoints = expDated.map(({ t, row }) => ({
        t,
        y: s.pick(row),
        row,
      }))
      // fitTrend sees the posted points only, by construction.
      return { ...s, points, expectedPoints, fit: fitTrend(points) }
    })

    if (dated.length === 0) return null

    const firstT = dated[0].t
    const lastT = dated[dated.length - 1].t
    // The fit is only ever projected `horizonDays` past the last POSTED
    // receipt; the x-domain must additionally reach the furthest confirmed
    // delivery, so open POs stay on the plot even with the horizon off.
    const projT = lastT + horizonDays
    const endT = Math.max(
      projT,
      expDated.length > 0 ? expDated[expDated.length - 1].t : projT,
    )

    // The y-domain has to hold the projection band too, or the forecast runs
    // off the top of the plot exactly when it matters most.
    let lo = Infinity
    let hi = -Infinity
    for (const s of series) {
      for (const p of [...s.points, ...s.expectedPoints]) {
        lo = Math.min(lo, p.y)
        hi = Math.max(hi, p.y)
      }
      if (s.fit && horizonDays > 0) {
        const band = predictionInterval(s.fit, projT)
        lo = Math.min(lo, band.lo)
        hi = Math.max(hi, band.hi)
      }
    }
    if (!Number.isFinite(lo)) return null
    if (hi === lo) {
      lo -= 1
      hi += 1
    }
    const headroom = (hi - lo) * 0.08
    lo = Math.max(0, lo - headroom)
    hi += headroom

    return { dated, expDated, series, firstT, lastT, projT, endT, lo, hi }
  }, [rows, expected, horizonDays, visible])

  if (!model) {
    return (
      <p className="py-10 text-center text-sm text-ink-secondary">
        Run the inquiry to plot its receipts over time.
      </p>
    )
  }

  const { dated, expDated, series, firstT, lastT, projT, endT, lo, hi } = model

  const plotW = width - PAD.left - PAD.right
  const plotH = HEIGHT - PAD.top - PAD.bottom
  const spanT = Math.max(1, endT - firstT)

  const x = (t: number) => PAD.left + ((t - firstT) / spanT) * plotW
  const y = (v: number) => PAD.top + (1 - (v - lo) / (hi - lo)) * plotH

  const yTicks = niceTicks(lo, hi)
  const xTicks = monthTicks(firstT, endT)

  // One entry per distinct date, expected deliveries included — what the
  // crosshair snaps to.
  const dates = [
    ...new Set([...dated, ...expDated].map((d) => d.t)),
  ].sort((a, b) => a - b)

  const snap = (clientX: number) => {
    const el = wrapRef.current
    if (!el) return
    const px = clientX - el.getBoundingClientRect().left
    const t = firstT + ((px - PAD.left) / plotW) * spanT
    let best = dates[0]
    for (const d of dates) {
      if (Math.abs(d - t) < Math.abs(best - t)) best = d
    }
    setActiveT(best)
  }

  const stepActive = (dir: -1 | 1) => {
    setActiveT((prev) => {
      if (prev === null) return dates[dir === 1 ? 0 : dates.length - 1]
      const i = dates.indexOf(prev)
      return dates[Math.min(dates.length - 1, Math.max(0, i + dir))]
    })
  }

  const activeRows = activeT === null
    ? []
    : [...dated, ...expDated].filter((d) => d.t === activeT).map((d) => d.row)

  const forecastOn = horizonDays > 0

  return (
    <div ref={wrapRef} className="relative w-full">
      <svg
        width={width}
        height={HEIGHT}
        role="img"
        aria-label={`Cost per ${unit} over time for ${dated.length} receipts${
          expDated.length > 0
            ? ` and ${expDated.length} open purchase orders`
            : ''
        }, with fitted trend${forecastOn ? ' and projection' : ''}`}
        tabIndex={0}
        className="block outline-none focus-visible:ring-1 focus-visible:ring-brand"
        onPointerMove={(e) => snap(e.clientX)}
        onPointerLeave={() => setActiveT(null)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') {
            e.preventDefault()
            stepActive(1)
          } else if (e.key === 'ArrowLeft') {
            e.preventDefault()
            stepActive(-1)
          } else if (e.key === 'Escape') {
            setActiveT(null)
          }
        }}
      >
        {/* Future region — everything past the last posted receipt, whether
            that is the projection, the open POs, or both. A wash rather than a
            dashed grid, so the only dashed thing on the chart is the projected
            line itself. */}
        {endT > lastT ? (
          <>
            <rect
              x={x(lastT)}
              y={PAD.top}
              width={Math.max(0, x(endT) - x(lastT))}
              height={plotH}
              fill={FORECAST_WASH}
            />
            <text
              x={x(lastT) + 6}
              y={PAD.top + 11}
              fontSize={11}
              fill={INK_MUTED}
            >
              {forecastOn ? 'Projected' : 'Expected'}
            </text>
          </>
        ) : null}

        {yTicks.map((v) => (
          <line
            key={`g${v}`}
            x1={PAD.left}
            x2={PAD.left + plotW}
            y1={y(v)}
            y2={y(v)}
            stroke={GRID}
            strokeWidth={1}
          />
        ))}

        {yTicks.map((v) => (
          <text
            key={`yt${v}`}
            x={PAD.left - 8}
            y={y(v) + 4}
            textAnchor="end"
            fontSize={11}
            fill={INK_MUTED}
            style={{ fontVariantNumeric: 'tabular-nums' }}
          >
            {money(v, currency)}
          </text>
        ))}

        {xTicks.map((t) => (
          <text
            key={`xt${t}`}
            x={x(t)}
            y={HEIGHT - PAD.bottom + 18}
            textAnchor="middle"
            fontSize={11}
            fill={INK_MUTED}
          >
            {monthLabel(t)}
          </text>
        ))}

        <line
          x1={PAD.left}
          x2={PAD.left + plotW}
          y1={PAD.top + plotH}
          y2={PAD.top + plotH}
          stroke="#C8C6C4"
          strokeWidth={1}
        />

        {/* Prediction bands sit behind everything they belong to. */}
        {forecastOn
          ? series.map((s) => {
              if (!s.fit) return null
              const steps = 24
              const top: string[] = []
              const bottom: string[] = []
              for (let i = 0; i <= steps; i++) {
                const t = lastT + ((projT - lastT) * i) / steps
                const band = predictionInterval(s.fit, t)
                top.push(`${x(t)},${y(band.hi)}`)
                bottom.push(`${x(t)},${y(band.lo)}`)
              }
              return (
                <polygon
                  key={`band-${s.key}`}
                  points={[...top, ...bottom.reverse()].join(' ')}
                  fill={s.color}
                  opacity={0.1}
                />
              )
            })
          : null}

        {series.map((s) => {
          if (!s.fit) return null
          return (
            <g key={`trend-${s.key}`}>
              <line
                x1={x(firstT)}
                y1={y(predictAt(s.fit, firstT))}
                x2={x(lastT)}
                y2={y(predictAt(s.fit, lastT))}
                stroke={s.color}
                strokeWidth={2}
                strokeLinecap="round"
              />
              {forecastOn ? (
                <line
                  x1={x(lastT)}
                  y1={y(predictAt(s.fit, lastT))}
                  x2={x(projT)}
                  y2={y(predictAt(s.fit, projT))}
                  stroke={s.color}
                  strokeWidth={2}
                  strokeDasharray="5 4"
                  strokeLinecap="round"
                />
              ) : null}
            </g>
          )
        })}

        {/* Actual receipts. The 2px surface ring keeps them readable where they
            pile up on the trend line or on each other. */}
        {series.map((s) => (
          <g key={`dots-${s.key}`}>
            {s.points.map((p, i) => (
              <circle
                key={i}
                cx={x(p.t)}
                cy={y(p.y)}
                r={4}
                fill={s.color}
                stroke={SURFACE}
                strokeWidth={2}
                opacity={activeT === null || activeT === p.t ? 1 : 0.45}
              />
            ))}
          </g>
        ))}

        {/* Open POs, hollow: the outline says "confirmed, not yet real" the
            same way the Expected pill does in the grid. Series identity stays
            on the outline colour; the shape carries the status. */}
        {series.map((s) => (
          <g key={`exp-${s.key}`}>
            {s.expectedPoints.map((p, i) => (
              <circle
                key={i}
                cx={x(p.t)}
                cy={y(p.y)}
                r={4}
                fill={SURFACE}
                stroke={s.color}
                strokeWidth={2}
                opacity={activeT === null || activeT === p.t ? 1 : 0.45}
              />
            ))}
          </g>
        ))}

        {/* Direct-label only the primary series' projected endpoint. The other
            projections are in the stats row below, which cannot collide. */}
        {forecastOn && series[0]?.fit ? (
          <text
            x={x(projT) + 8}
            y={y(predictAt(series[0].fit, projT)) + 4}
            fontSize={12}
            fontWeight={600}
            fill={INK}
            style={{ fontVariantNumeric: 'tabular-nums' }}
          >
            {money(predictAt(series[0].fit, projT), currency)}
          </text>
        ) : null}

        {activeT !== null ? (
          <line
            x1={x(activeT)}
            x2={x(activeT)}
            y1={PAD.top}
            y2={PAD.top + plotH}
            stroke={INK_SECONDARY}
            strokeWidth={1}
          />
        ) : null}
      </svg>

      {activeT !== null && activeRows.length > 0 ? (
        <Tooltip
          rows={activeRows}
          series={series}
          currency={currency}
          unit={unit}
          left={x(activeT)}
          width={width}
        />
      ) : null}

      <p className="mt-1 text-xs text-ink-secondary">
        Hover the plot, or focus it and use the left and right arrow keys, to
        read a receipt. Every value is also in the grid below.
      </p>
    </div>
  )
}

function Tooltip({
  rows,
  series,
  currency,
  unit,
  left,
  width,
}: {
  rows: ReceiptRow[]
  series: Plotted[]
  currency: string
  unit: string
  left: number
  width: number
}) {
  // Flip to the left of the crosshair when it would run off the right edge.
  const flip = left > width - 240
  const row = rows[0]
  const isExpected = row.receiptStatus === 'Expected'

  return (
    <div
      className="pointer-events-none absolute top-4 z-20 w-[220px] border border-stroke bg-surface p-2 shadow-flyout"
      style={flip ? { right: width - left + 10 } : { left: left + 10 }}
      role="status"
    >
      <div className="flex items-baseline gap-2 text-sm font-semibold text-ink">
        {shortDate(row.receiptDate)}
        {isExpected ? (
          <span className="border border-brand/40 bg-brand-tint px-[5px] py-px text-2xs font-semibold uppercase tracking-wide text-brand">
            Expected
          </span>
        ) : null}
      </div>
      <div className="mb-1 truncate text-xs text-ink-secondary">
        {row.purchaseOrderNumber}
        {rows.length > 1 ? ` +${rows.length - 1} more` : ''} ·{' '}
        {qty(row.quantityReceived)} {unit}
      </div>

      {series.map((s) => (
        <div key={s.key} className="flex items-baseline gap-2 py-[1px]">
          <span
            aria-hidden="true"
            className="h-[2px] w-3 shrink-0 rounded-full"
            style={{ backgroundColor: s.color }}
          />
          <span className="text-base font-semibold tabular-nums text-ink">
            {money(s.pick(row), currency)}
          </span>
          <span className="truncate text-xs text-ink-secondary">{s.label}</span>
        </div>
      ))}

      <div className="mt-1 border-t border-stroke-subtle pt-1 text-xs text-ink-secondary">
        Charges{isExpected ? ' (estimated)' : ''}{' '}
        <span className="font-semibold tabular-nums text-ink">
          {money(row.financialChargesAoc, currency)}
        </span>{' '}
        per {unit}
      </div>
    </div>
  )
}

export { SERIES }

export const FORECAST_PRESETS: { label: string; days: number }[] = [
  { label: 'None', days: 0 },
  { label: '3 months', days: 91 },
  { label: '6 months', days: 182 },
  { label: '12 months', days: 365 },
]

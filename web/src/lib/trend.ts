/**
 * Least-squares trend fitting and forward projection for the cost trend chart.
 *
 * Kept separate from calc.ts because it answers a different question. calc.ts
 * says what inventory actually cost, so its averages are QUANTITY-WEIGHTED — a
 * 42,000 lb receipt should move the number more than a 4,000 lb one. This file
 * asks where the *price* is heading, so it is deliberately UNWEIGHTED: each
 * receipt is one negotiated price, and a large load is not a stronger signal
 * about next quarter's market than a small one.
 *
 * Nothing here is a forecasting model. It is an ordinary linear regression
 * extended past the last observation, which is only as good as the assumption
 * that the recent trend continues — so every fit reports its own r² and the
 * projection carries a prediction interval rather than a single confident line.
 * Seasonal commodities (which is most of a food and beverage catalogue) will
 * often fit poorly, and the UI is expected to say so rather than hide it.
 */

/** One observation: `t` is a day number, `y` the value in currency per unit. */
export interface TrendPoint {
  t: number
  y: number
}

export interface TrendFit {
  /** Currency per unit, per day. */
  slopePerDay: number
  intercept: number
  /** Proportion of variance explained, 0..1. Clamped — a flat series gives 1. */
  r2: number
  /** Residual standard deviation, in currency per unit. */
  residualSd: number
  n: number
  /** Mean of t across the observations — the pivot the interval widens around. */
  meanT: number
  /** Σ(t - meanT)². Zero when every receipt shares one date. */
  sumSqT: number
  /** Two-sided 95% critical value for n-2 degrees of freedom. */
  tCritical: number
}

/** Days since the Unix epoch for an ISO date, parsed as UTC to avoid DST drift. */
export function dayNumber(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000)
}

/** Inverse of `dayNumber`. */
export function isoFromDayNumber(day: number): string {
  const dt = new Date(day * 86_400_000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())}`
}

/**
 * Two-sided 95% Student's t critical values. A table rather than an
 * approximation because the interesting case here is small n — a dozen receipts
 * — where the normal 1.96 is meaningfully too narrow and would overstate how
 * much the projection can be trusted. Falls back conservatively to the next
 * lower degrees of freedom listed.
 */
const T_95: [df: number, value: number][] = [
  [1, 12.706],
  [2, 4.303],
  [3, 3.182],
  [4, 2.776],
  [5, 2.571],
  [6, 2.447],
  [7, 2.365],
  [8, 2.306],
  [9, 2.262],
  [10, 2.228],
  [12, 2.179],
  [14, 2.145],
  [16, 2.12],
  [18, 2.101],
  [20, 2.086],
  [25, 2.06],
  [30, 2.042],
  [40, 2.021],
  [60, 2.0],
  [120, 1.98],
]

function tCritical95(df: number): number {
  if (df <= 0) return T_95[0][1]
  let value = 1.96
  for (const [d, v] of T_95) {
    if (df <= d) return v
    value = v
  }
  // Past the last row the t distribution has effectively converged on normal.
  return Math.min(value, 1.96)
}

/**
 * Ordinary least squares. Returns null when there is nothing meaningful to fit:
 * fewer than three points (two points always fit perfectly and would report a
 * fictitious r² of 1), or every point on the same date.
 */
export function fitTrend(points: TrendPoint[]): TrendFit | null {
  const n = points.length
  if (n < 3) return null

  const meanT = points.reduce((s, p) => s + p.t, 0) / n
  const meanY = points.reduce((s, p) => s + p.y, 0) / n

  let sumSqT = 0
  let sumTY = 0
  for (const p of points) {
    const dt = p.t - meanT
    sumSqT += dt * dt
    sumTY += dt * (p.y - meanY)
  }
  if (sumSqT === 0) return null

  const slopePerDay = sumTY / sumSqT
  const intercept = meanY - slopePerDay * meanT

  let ssRes = 0
  let ssTot = 0
  for (const p of points) {
    const predicted = intercept + slopePerDay * p.t
    ssRes += (p.y - predicted) ** 2
    ssTot += (p.y - meanY) ** 2
  }

  return {
    slopePerDay,
    intercept,
    // A perfectly flat series has no variance to explain; call that a full fit
    // rather than 0/0. Clamped below because ssRes can exceed ssTot only via
    // floating-point noise here, but a negative r² would still read as a bug.
    r2: ssTot === 0 ? 1 : Math.max(0, 1 - ssRes / ssTot),
    residualSd: Math.sqrt(ssRes / (n - 2)),
    n,
    meanT,
    sumSqT,
    tCritical: tCritical95(n - 2),
  }
}

export function predictAt(fit: TrendFit, t: number): number {
  return fit.intercept + fit.slopePerDay * t
}

/**
 * 95% prediction interval for a NEW observation at `t` — the range a future
 * receipt would land in, not the much narrower range the fitted line itself
 * sits in. That is the honest band for "what might we pay", and it widens the
 * further `t` sits from the centre of the observed data, which is exactly the
 * visual warning a viewer needs when reading a projection.
 */
export function predictionInterval(
  fit: TrendFit,
  t: number,
): { lo: number; hi: number } {
  const centre = predictAt(fit, t)
  const dt = t - fit.meanT
  const se =
    fit.residualSd * Math.sqrt(1 + 1 / fit.n + (dt * dt) / fit.sumSqT)
  const margin = fit.tCritical * se
  return { lo: centre - margin, hi: centre + margin }
}

/** Currency per unit per year — the readable form of the slope. */
export function slopePerYear(fit: TrendFit): number {
  return fit.slopePerDay * 365
}

/**
 * How much weight to put on the projection. Thresholds are deliberately strict:
 * a demo that shows a confident line through scattered commodity prices is
 * worse than one that admits the scatter.
 */
export type FitQuality = 'strong' | 'moderate' | 'weak'

export function fitQuality(fit: TrendFit): FitQuality {
  if (fit.r2 >= 0.5) return 'strong'
  if (fit.r2 >= 0.2) return 'moderate'
  return 'weak'
}

/** Display formatting to match D365 F&O conventions. */

const currencyCache = new Map<string, Intl.NumberFormat>()

export function money(value: number, currency = 'USD'): string {
  let fmt = currencyCache.get(currency)
  if (!fmt) {
    fmt = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
    currencyCache.set(currency, fmt)
  }
  return fmt.format(Number.isFinite(value) ? value : 0)
}

const qtyFmt = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
})

export function qty(value: number): string {
  return qtyFmt.format(Number.isFinite(value) ? value : 0)
}

const preciseQtyFmt = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 6,
})

/**
 * Quantity that keeps its decimals when there are only decimals to keep.
 *
 * BOM lines legitimately hold quantities like 0.00025 rolls of labels per pack.
 * Rounding those to two places renders "0" against a real cost, which reads as
 * a bug in the data rather than a small number.
 */
export function qtyPrecise(value: number): string {
  if (!Number.isFinite(value)) return qty(0)
  return value !== 0 && Math.abs(value) < 0.01
    ? preciseQtyFmt.format(value)
    : qty(value)
}

/** Money that keeps four decimals when two would round it to zero. */
export function moneyPrecise(value: number, currency = 'USD'): string {
  if (Number.isFinite(value) && value !== 0 && Math.abs(value) < 0.01) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: 4,
      maximumFractionDigits: 4,
    }).format(value)
  }
  return money(value, currency)
}

const pctFmt = new Intl.NumberFormat('en-US', {
  style: 'percent',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/** Takes a fraction (0.284) and renders a percentage ("28.40%"). */
export function percent(fraction: number): string {
  return pctFmt.format(Number.isFinite(fraction) ? fraction : 0)
}

/**
 * F&O renders dates in the user's locale format. Parses the ISO date as local
 * rather than UTC so a receipt dated the 1st never displays as the 31st.
 */
export function shortDate(iso: string): string {
  if (!iso) return ''
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return iso
  return new Date(y, m - 1, d).toLocaleDateString('en-US')
}

/** Today as an ISO date string, using local time. */
export function todayIso(): string {
  const now = new Date()
  return isoOf(now)
}

export function isoOf(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  dt.setDate(dt.getDate() + days)
  return isoOf(dt)
}

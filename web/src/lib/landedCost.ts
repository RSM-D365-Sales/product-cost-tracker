import type { AllocationMethod, ChargeLine } from '../types/domain'

/**
 * Landed Cost module (ITM*) costs turned into per-PO-line charges.
 *
 * D365 records each cost once, at the level it was incurred — a voyage, a
 * shipping container, a folio, or one PO line — with a category, a value and
 * an apportionment method, and records posted actuals against the same cost
 * line. It exposes no entity holding the result per PO line, so this file does
 * the apportionment, the way D365's own does:
 *
 *   category   Fixed    the value is the cost, spread over the lines by the
 *                       apportionment basis
 *              Rate     the value is per unit of the basis: each line pays
 *                       value × its own basis
 *              Percent  the value is a % of each line's amount
 *   minimum    a Rate/Percent cost totalling less than its minimum is lifted
 *              to it, spread in the same proportions
 *   basis      Quantity, Weight, Volume, Value (line amount), Measurement;
 *              Equally / anything else → equal shares. A basis that is zero on
 *              every line falls back to quantity, then to equal shares.
 *   actuals    a posted actual for cost line n replaces the estimate for line
 *              n at that level, and is spread by that estimate's basis.
 *
 * Pure: the provider fetches, this computes, so it can be checked against a
 * real voyage without a browser.
 */

/** One PO line's share of a voyage — LandedCostPurchaseLines. */
export interface LcLine {
  po: string
  line: number
  voyageId: string
  containerId: string
  folioId: string
  quantity: number
  amount: number
  weight: number
  volume: number
  measurement: number
}

/** An estimated cost line at some level — CostTrans*Tables. */
export interface LcCost {
  level: 'Voyage' | 'Container' | 'Folio' | 'Line'
  /** Voyage id, `${voyage}|${container}`, folio id, or `${po}|${line}`. */
  scope: string
  lineNumber: number
  costType: string
  category: string
  value: number
  apportionment: string
  minimum: number
  currency: string
}

/** A posted actual, pointing at the estimated cost line it settles. */
export interface LcActual {
  level: LcCost['level']
  scope: string
  costLineNumber: number
  amount: number
  /** Cost journal and line it was posted on, when known. */
  journal?: string
  journalLine?: number
}

export interface LcLineCharges {
  /** Extended charges for everything of this PO line on voyages. */
  charges: ChargeLine[]
  /** Quantity those charges cover (sum of ShipQty). */
  quantity: number
}

export interface LcResult {
  byLine: Map<string, LcLineCharges>
  /** Costs whose basis was zero on every line and fell back. */
  fallbacks: number
  currencies: Set<string>
  /**
   * Costs settled by more than one line of the same cost journal — counted as
   * recorded, because that is what D365 holds, but worth a look: in
   * d365s-cd2, journal 00673 settles PO002355's tariff twice on lines 2–6.
   */
  repeatedActuals: { scope: string; costLineNumber: number; journal: string; times: number }[]
}

const lineKey = (po: string, line: number): string => `${po}|${line}`

function basisOf(l: LcLine, method: string): number {
  const m = method.toLowerCase()
  if (m.startsWith('qty') || m.startsWith('quantity')) return l.quantity
  if (m.startsWith('weight')) return l.weight
  if (m.startsWith('volume')) return l.volume
  if (m.startsWith('value') || m.startsWith('amount') || m.startsWith('net')) return l.amount
  if (m.startsWith('measure')) return l.measurement
  return 1
}

function allocationLabel(method: string): AllocationMethod | undefined {
  const m = method.toLowerCase()
  if (m.startsWith('qty') || m.startsWith('quantity')) return 'Quantity'
  if (m.startsWith('weight')) return 'Net weight'
  if (m.startsWith('volume')) return 'Volume'
  if (m.startsWith('value') || m.startsWith('amount') || m.startsWith('net')) return 'Net amount'
  if (m.startsWith('equal')) return 'Equally'
  return undefined
}

/** Weights for `lines` by `method`, falling back when they are all zero. */
function weights(lines: LcLine[], method: string): { w: number[]; fellBack: boolean } {
  let w = lines.map((l) => basisOf(l, method))
  if (w.some((x) => x > 0)) return { w, fellBack: false }
  w = lines.map((l) => l.quantity)
  if (w.some((x) => x > 0)) return { w, fellBack: lines.length > 1 }
  return { w: lines.map(() => 1), fellBack: lines.length > 1 }
}

/** Amount each line bears of one cost (estimated, or `actual` when posted). */
function apportion(
  cost: LcCost,
  lines: LcLine[],
  actual: number | undefined,
): { amounts: number[]; fellBack: boolean } {
  const { w, fellBack } = weights(lines, cost.apportionment)
  const total = w.reduce((s, x) => s + x, 0)
  const share = (amount: number) => w.map((x) => (total > 0 ? (amount * x) / total : 0))

  // A posted actual is a settled total: spread it, never re-derive it.
  if (actual !== undefined) return { amounts: share(actual), fellBack }

  const category = cost.category.toLowerCase()
  let amounts: number[]
  if (category.startsWith('percent')) {
    amounts = lines.map((l) => (cost.value / 100) * l.amount)
  } else if (category.startsWith('rate')) {
    amounts = lines.map((l) => cost.value * basisOf(l, cost.apportionment))
  } else {
    return { amounts: share(cost.value), fellBack }
  }
  const sum = amounts.reduce((s, x) => s + x, 0)
  if (cost.minimum > 0 && sum < cost.minimum) {
    return { amounts: share(cost.minimum), fellBack }
  }
  return { amounts, fellBack: false }
}

export function landedCostByLine(
  lines: LcLine[],
  costs: LcCost[],
  actuals: LcActual[],
): LcResult {
  const byLine = new Map<string, LcLineCharges>()
  const currencies = new Set<string>()
  let fallbacks = 0

  for (const l of lines) {
    const k = lineKey(l.po, l.line)
    const entry = byLine.get(k) ?? { charges: [], quantity: 0 }
    entry.quantity += l.quantity
    byLine.set(k, entry)
  }

  // Actuals summed per (level, scope, cost line) — one cost line can be
  // settled by several journal lines.
  const actualTotal = new Map<string, number>()
  const journalHits = new Map<string, { a: LcActual; lines: Set<number> }>()
  for (const a of actuals) {
    const k = `${a.level}|${a.scope}|${a.costLineNumber}`
    actualTotal.set(k, (actualTotal.get(k) ?? 0) + a.amount)
    if (a.journal) {
      const jk = `${k}|${a.journal}`
      const hit = journalHits.get(jk) ?? { a, lines: new Set<number>() }
      hit.lines.add(a.journalLine ?? hit.lines.size)
      journalHits.set(jk, hit)
    }
  }
  const repeatedActuals = [...journalHits.values()]
    .filter((h) => h.lines.size > 1)
    .map((h) => ({
      scope: h.a.scope,
      costLineNumber: h.a.costLineNumber,
      journal: h.a.journal!,
      times: h.lines.size,
    }))

  const linesIn = (cost: LcCost): LcLine[] => {
    switch (cost.level) {
      case 'Voyage':
        return lines.filter((l) => l.voyageId === cost.scope)
      case 'Container':
        return lines.filter((l) => `${l.voyageId}|${l.containerId}` === cost.scope)
      case 'Folio':
        return lines.filter((l) => l.folioId === cost.scope)
      case 'Line':
        return lines.filter((l) => lineKey(l.po, l.line) === cost.scope)
    }
  }

  // An actual with no estimate behind it still happened: carry it as a fixed
  // cost spread by quantity, so the landed cost does not quietly drop it.
  const estimated = new Set(costs.map((c) => `${c.level}|${c.scope}|${c.lineNumber}`))
  const orphanActuals: LcCost[] = [...actualTotal.keys()]
    .filter((k) => !estimated.has(k))
    .map((k) => {
      const [level, ...rest] = k.split('|')
      const lineNumber = Number(rest.pop())
      return {
        level: level as LcCost['level'],
        scope: rest.join('|'),
        lineNumber,
        costType: `Cost line ${lineNumber}`,
        category: 'Fixed',
        value: 0,
        apportionment: 'Quantity',
        minimum: 0,
        currency: '',
      }
    })

  for (const cost of [...costs, ...orphanActuals]) {
    const scoped = linesIn(cost)
    if (scoped.length === 0) continue
    const actual = actualTotal.get(`${cost.level}|${cost.scope}|${cost.lineNumber}`)
    const { amounts, fellBack } = apportion(cost, scoped, actual)
    if (fellBack) fallbacks++
    if (cost.currency) currencies.add(cost.currency)

    const where =
      cost.level === 'Voyage'
        ? `voyage ${cost.scope}`
        : cost.level === 'Container'
          ? `container ${cost.scope.split('|')[1]} (${cost.scope.split('|')[0]})`
          : cost.level === 'Folio'
            ? `folio ${cost.scope}`
            : 'PO line'
    const status = actual !== undefined ? 'Actual' : 'Estimated'

    scoped.forEach((l, i) => {
      const amount = Math.round(amounts[i] * 100) / 100
      if (amount === 0) return
      const entry = byLine.get(lineKey(l.po, l.line))!
      entry.charges.push({
        chargeCode: cost.costType,
        description: `${cost.costType} · ${where} (${status.toLowerCase()})`,
        chargeType: 'Financial',
        source: cost.level === 'Line' ? 'Line' : 'Header',
        allocationMethod: cost.level === 'Line' ? undefined : allocationLabel(cost.apportionment),
        amount,
        amountPerUnit: 0, // set once the provider knows the row's quantity
        status,
      })
    })
  }

  return { byLine, fallbacks, currencies, repeatedActuals }
}

import {
  landedCostByLine,
  type LcActual,
  type LcCost,
  type LcLine,
  type LcResult,
} from '../lib/landedCost'
import type { EntityKey } from '../lib/odataConfig'
import { and, anyOf, chunk, odataQuery } from './odataClient'
import { resolveEntity, type ResolvedEntity } from './odataSchema'

/**
 * Reads the Landed Cost module (voyages, containers, folios, their estimated
 * costs and posted actuals) for a set of purchase orders and hands it to
 * lib/landedCost.ts to apportion. Entity and field names are in
 * lib/odataConfig.ts under LANDED COST MODULE.
 *
 * Every voyage line is read, not only the item's: a container's freight is
 * spread across everything in the container, so the other items' weight and
 * value are part of this item's cost.
 */

type Row = Record<string, unknown>
const str = (r: Row, f: string): string => (f && r[f] != null ? String(r[f]) : '')
const num = (r: Row, f: string): number => {
  const n = f ? Number(r[f]) : NaN
  return Number.isFinite(n) ? n : 0
}

const EMPTY: LcResult = {
  byLine: new Map(),
  fallbacks: 0,
  currencies: new Set(),
  repeatedActuals: [],
}

async function byKeys(
  e: ResolvedEntity | null,
  key: EntityKey,
  field: string,
  values: string[],
  signal?: AbortSignal,
): Promise<Row[]> {
  if (!e || !field || values.length === 0) return []
  const pages = await Promise.all(
    chunk(values, 40).map((batch) =>
      odataQuery<Row>(e.set, { filter: and(anyOf(field, batch)), signal }, key),
    ),
  )
  // Journal-line entities can return the same row twice; identical rows are
  // one posting.
  return [...new Map(pages.flat().map((r) => [JSON.stringify(stripMeta(r)), r])).values()]
}

function stripMeta(r: Row): Row {
  return Object.fromEntries(Object.entries(r).filter(([k]) => !k.startsWith('@')))
}

/** PO lines not on any voyage can still carry line-level costs. */
export interface PoLineBasis {
  po: string
  line: number
  quantity: number
  amount: number
}

export async function fetchLandedCost(
  poNumbers: string[],
  poLines: PoLineBasis[],
  signal?: AbortSignal,
): Promise<LcResult & { available: boolean }> {
  const lcl = await resolveEntity('lcLines', signal)
  if (!lcl || poNumbers.length === 0) return { ...EMPTY, available: Boolean(lcl) }

  const [vc, cc, fc, ic, va, ca, fa, la] = await Promise.all([
    resolveEntity('lcVoyageCosts', signal),
    resolveEntity('lcContainerCosts', signal),
    resolveEntity('lcFolioCosts', signal),
    resolveEntity('lcLineCosts', signal),
    resolveEntity('lcVoyageActuals', signal),
    resolveEntity('lcContainerActuals', signal),
    resolveEntity('lcFolioActuals', signal),
    resolveEntity('lcLineActuals', signal),
  ])
  const F = lcl.f

  // The item's lines on voyages, then everything else on those voyages.
  const own = await byKeys(lcl, 'lcLines', F.purchaseOrderNumber, poNumbers, signal)
  const voyages = [...new Set(own.map((r) => str(r, F.voyageId)).filter(Boolean))]
  const all = await byKeys(lcl, 'lcLines', F.voyageId, voyages, signal)
  const lineRows = all.length ? all : own

  const lines: LcLine[] = lineRows.map((r) => ({
    po: str(r, F.purchaseOrderNumber),
    line: num(r, F.lineNumber),
    voyageId: str(r, F.voyageId),
    containerId: str(r, F.containerId),
    folioId: str(r, F.folioId),
    quantity: num(r, F.quantity),
    amount: num(r, F.amount),
    weight: num(r, F.weight),
    volume: num(r, F.volume),
    measurement: num(r, F.measurement),
  }))
  const folios = [...new Set(lines.map((l) => l.folioId).filter(Boolean))]
  const linePos = [...new Set([...poNumbers, ...lines.map((l) => l.po)])]

  const [vcR, ccR, fcR, icR, vaR, caR, faR, laR] = await Promise.all([
    byKeys(vc, 'lcVoyageCosts', vc?.f.voyageId ?? '', voyages, signal),
    byKeys(cc, 'lcContainerCosts', cc?.f.voyageId ?? '', voyages, signal),
    byKeys(fc, 'lcFolioCosts', fc?.f.folioId ?? '', folios, signal),
    byKeys(ic, 'lcLineCosts', ic?.f.purchaseOrderNumber ?? '', linePos, signal),
    byKeys(va, 'lcVoyageActuals', va?.f.voyageId ?? '', voyages, signal),
    byKeys(ca, 'lcContainerActuals', ca?.f.voyageId ?? '', voyages, signal),
    byKeys(fa, 'lcFolioActuals', fa?.f.folioId ?? '', folios, signal),
    byKeys(la, 'lcLineActuals', la?.f.purchaseOrderNumber ?? '', linePos, signal),
  ])

  const cost =
    (level: LcCost['level'], e: ResolvedEntity, scope: (r: Row) => string) =>
    (r: Row): LcCost => ({
      level,
      scope: scope(r),
      lineNumber: num(r, e.f.lineNumber),
      costType: str(r, e.f.costType),
      category: str(r, e.f.category),
      value: num(r, e.f.value),
      apportionment: str(r, e.f.apportionment),
      minimum: num(r, e.f.minimum),
      currency: str(r, e.f.currency),
    })
  const actual =
    (level: LcActual['level'], e: ResolvedEntity, scope: (r: Row) => string) =>
    (r: Row): LcActual => ({
      level,
      scope: scope(r),
      costLineNumber: num(r, e.f.costLineNumber),
      amount: num(r, e.f.amount),
      journal: str(r, e.f.journal) || undefined,
      journalLine: e.f.journalLine ? num(r, e.f.journalLine) : undefined,
    })

  const costs: LcCost[] = [
    ...(vc ? vcR.map(cost('Voyage', vc, (r) => str(r, vc.f.voyageId))) : []),
    ...(cc
      ? ccR.map(cost('Container', cc, (r) => `${str(r, cc.f.voyageId)}|${str(r, cc.f.containerId)}`))
      : []),
    ...(fc ? fcR.map(cost('Folio', fc, (r) => str(r, fc.f.folioId))) : []),
    ...(ic
      ? icR.map(
          cost('Line', ic, (r) => `${str(r, ic.f.purchaseOrderNumber)}|${num(r, ic.f.purchaseLineNumber)}`),
        )
      : []),
  ]
  const actuals: LcActual[] = [
    ...(va ? vaR.map(actual('Voyage', va, (r) => str(r, va.f.voyageId))) : []),
    ...(ca
      ? caR.map(actual('Container', ca, (r) => `${str(r, ca.f.voyageId)}|${str(r, ca.f.containerId)}`))
      : []),
    ...(fa ? faR.map(actual('Folio', fa, (r) => str(r, fa.f.folioId))) : []),
    ...(la
      ? laR.map(
          actual('Line', la, (r) => `${str(r, la.f.purchaseOrderNumber)}|${num(r, la.f.purchaseLineNumber)}`),
        )
      : []),
  ]

  // Line-level costs on a PO line that is on no voyage: stand the PO line in
  // as its own basis so the cost is not lost.
  const onVoyage = new Set(lines.map((l) => `${l.po}|${l.line}`))
  for (const p of poLines) {
    const k = `${p.po}|${p.line}`
    if (onVoyage.has(k)) continue
    if (!costs.some((c) => c.level === 'Line' && c.scope === k)) continue
    lines.push({
      po: p.po, line: p.line, voyageId: '', containerId: '', folioId: '',
      quantity: p.quantity, amount: p.amount, weight: 0, volume: 0, measurement: 0,
    })
  }

  return { ...landedCostByLine(lines, costs, actuals), available: true }
}

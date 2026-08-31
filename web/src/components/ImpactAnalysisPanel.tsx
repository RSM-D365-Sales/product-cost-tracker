import type { ImpactInputs, SupplyLot } from '../types/netting'
import type {
  Adjustments,
  NettingComparison,
  NettingResult,
  SupplyAdjustment,
} from '../lib/netting'
import { NEUTRAL_ADJUSTMENT, isNeutral } from '../lib/netting'
import { money, qty, shortDate } from '../lib/format'
import { VarianceStatTile } from './LandedVariancePanel'

/**
 * Impact analysis: the item's open purchase orders netted against the
 * downstream demand pegged to them, and a simulation of the change requests a
 * vendor actually sends — a delivery moved out or in, a quantity confirmed
 * short or long. Modelled on the Procurement agent's impact analysis: the
 * verdict is *Has impact* or *No impact*, and impact means a named downstream
 * order goes short or material newly expires with value on it.
 *
 * Everything here is a pure re-run of lib/netting.ts with adjusted supply; the
 * page owns the adjustment state so Copilot can narrate the same simulation.
 */

export function ImpactVerdictPill({
  active,
  comparison,
}: {
  active: boolean
  comparison: NettingComparison
}) {
  if (!active) return null
  const bad = comparison.hasImpact
  return (
    <span
      className={[
        'inline-flex border px-[6px] py-px text-2xs font-semibold uppercase tracking-wide',
        bad
          ? 'border-status-bad/40 bg-status-badBg text-status-bad'
          : 'border-status-good/40 bg-status-goodBg text-status-good',
      ].join(' ')}
      title={
        bad
          ? 'The simulated change puts downstream orders at risk'
          : 'The simulated change leaves every downstream order covered'
      }
    >
      {bad ? 'Has impact' : 'No impact'}
    </span>
  )
}

/** Day strip of projected usable stock. One series; red marks shortfall days. */
function ProjectionStrip({
  label,
  result,
  horizonDays,
  maxProjected,
  unit,
}: {
  label: string
  result: NettingResult
  horizonDays: number
  maxProjected: number
  unit: string
}) {
  const days = result.days.slice(0, horizonDays)

  return (
    <div>
      <div className="mb-[2px] flex items-baseline gap-2">
        <span className="text-sm font-semibold text-ink">{label}</span>
        <span className="text-sm text-ink-secondary">
          projected usable stock by day
          {result.firstShortDate
            ? ` · first shortfall ${shortDate(result.firstShortDate)}`
            : ' · no shortfall'}
        </span>
      </div>
      <div className="flex h-16 items-end gap-[2px] border border-stroke bg-[#FAF9F8] px-[2px] pt-[2px]">
        {days.map((d) => {
          const heightPct =
            maxProjected > 0 ? (d.projected / maxProjected) * 100 : 0
          const title =
            `${shortDate(d.date)} — on hand ${qty(d.projected)} ${unit}` +
            (d.receipts > 0 ? ` · receipts ${qty(d.receipts)}` : '') +
            (d.requirements > 0 ? ` · requirements ${qty(d.requirements)}` : '') +
            (d.shortfall > 0 ? ` · SHORT ${qty(d.shortfall)}` : '') +
            (d.expired > 0 ? ` · expired ${qty(d.expired)}` : '')
          return (
            <div
              key={d.date}
              className="flex h-full flex-1 flex-col justify-end"
              title={title}
            >
              <div
                className={d.receipts > 0 ? 'bg-brand' : 'bg-brand/60'}
                style={{ height: `${Math.max(heightPct, d.projected > 0 ? 3 : 0)}%` }}
              />
              <div
                className={
                  d.shortfall > 0 ? 'h-[3px] bg-status-bad' : 'h-[3px] bg-transparent'
                }
              />
            </div>
          )
        })}
      </div>
      <div className="mt-[2px] flex justify-between text-2xs text-ink-secondary">
        {[0, 7, 14, 21, horizonDays].map((d) => (
          <span key={d}>+{d}d</span>
        ))}
      </div>
    </div>
  )
}

function AdjustmentField({
  id,
  label,
  value,
  min,
  max,
  onChange,
}: {
  id: string
  label: string
  value: number
  min: number
  max: number
  onChange: (v: number) => void
}) {
  return (
    <input
      id={id}
      aria-label={label}
      title={label}
      type="number"
      min={min}
      max={max}
      value={value}
      onChange={(e) => {
        const v = Number(e.target.value)
        if (Number.isFinite(v)) onChange(Math.max(min, Math.min(max, v)))
      }}
      className="f-input f-input-num w-[74px]"
    />
  )
}

export function ImpactAnalysisPanel({
  inputs,
  baseline,
  simulated,
  comparison,
  adjustments,
  active,
  onAdjust,
  onReset,
}: {
  inputs: ImpactInputs
  baseline: NettingResult
  simulated: NettingResult
  comparison: NettingComparison
  adjustments: Adjustments
  /** True when at least one adjustment differs from as-ordered. */
  active: boolean
  onAdjust: (supplyId: string, adjustment: SupplyAdjustment) => void
  onReset: () => void
}) {
  const currency = inputs.supplies[0]?.currency ?? 'USD'
  const unit = inputs.supplies[0]?.unit ?? ''
  const expected = inputs.supplies.filter((s) => s.kind === 'Expected')
  const show = active ? simulated : baseline

  const usageOf = (s: SupplyLot) =>
    show.usage.find((u) => u.supply.id === s.id)

  const maxProjected = Math.max(
    ...baseline.days.map((d) => d.projected),
    ...simulated.days.map((d) => d.projected),
    1,
  )

  const coveredOrders = show.coverage.filter((c) => c.short <= 0).length

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-4">
        <p className="min-w-[260px] max-w-[860px] flex-1 text-base text-ink-secondary">
          Net requirements for {inputs.itemNumber}: stock on hand and open
          purchase orders, set against the planned production pegged to them.
          Simulate the change request a vendor would send — a delivery moved
          out or in, a quantity confirmed short or long — and the pegging shows
          which downstream orders are hit before anything is accepted.
        </p>
        <div className="flex items-center gap-2">
          <ImpactVerdictPill active={active} comparison={comparison} />
          {active ? (
            <button type="button" className="f-btn" onClick={onReset}>
              Reset simulation
            </button>
          ) : null}
        </div>
      </div>

      {/* --- The open purchase orders and their simulation controls -------- */}
      <div className="border border-stroke">
        <table className="f-grid" style={{ tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: '110px' }} />
            <col style={{ width: '150px' }} />
            <col style={{ width: '150px' }} />
            <col style={{ width: '110px' }} />
            <col />
            <col style={{ width: '96px' }} />
            <col style={{ width: '96px' }} />
          </colgroup>
          <thead>
            <tr>
              <th className="text-left">Purchase order</th>
              <th className="text-left">Confirmed delivery</th>
              <th className="text-right">Quantity</th>
              <th
                className="text-right"
                title="Vendor-confirmed price plus estimated charges, per unit"
              >
                Expected landed
              </th>
              <th
                className="text-left"
                title="Downstream planned orders this line covers under the current netting"
              >
                Pegged to
              </th>
              <th className="text-right" title="Days to move the delivery: positive is out, negative is in">
                Shift (days)
              </th>
              <th className="text-right" title="Confirmed quantity as a percentage of ordered: 80 is short, 120 is long">
                Quantity (%)
              </th>
            </tr>
          </thead>
          <tbody>
            {expected.map((s) => {
              const a = adjustments[s.id] ?? NEUTRAL_ADJUSTMENT
              const usage = usageOf(s)
              const adjusted = usage?.supply
              const shifted = !isNeutral(a) && adjusted
              return (
                <tr key={s.id}>
                  <td className="font-semibold">{s.reference}</td>
                  <td>
                    {shortDate(s.availableDate)}
                    {shifted && adjusted.availableDate !== s.availableDate ? (
                      <span className="text-brand">
                        {' '}
                        → {shortDate(adjusted.availableDate)}
                      </span>
                    ) : null}
                  </td>
                  <td className="f-num">
                    {qty(s.quantity)}
                    {shifted && adjusted.quantity !== s.quantity ? (
                      <span className="text-brand">
                        {' '}
                        → {qty(adjusted.quantity)}
                      </span>
                    ) : null}{' '}
                    {s.unit}
                  </td>
                  <td className="f-num">{money(s.unitCost, currency)}</td>
                  <td>
                    <span
                      className="block truncate text-ink-secondary"
                      title={
                        usage && usage.pegged.length > 0
                          ? usage.pegged
                              .map((p) => `${p.reference} (${qty(p.quantity)} ${s.unit})`)
                              .join(' · ')
                          : 'Nothing is pegged to this line'
                      }
                    >
                      {usage && usage.pegged.length > 0
                        ? [...new Set(usage.pegged.map((p) => p.reference))].join(' · ')
                        : '—'}
                    </span>
                  </td>
                  <td className="f-num">
                    <AdjustmentField
                      id={`shift-${s.reference}`}
                      label={`Shift ${s.reference} by days`}
                      value={a.shiftDays}
                      min={-14}
                      max={21}
                      onChange={(v) => onAdjust(s.id, { ...a, shiftDays: v })}
                    />
                  </td>
                  <td className="f-num">
                    <AdjustmentField
                      id={`qty-${s.reference}`}
                      label={`Quantity percent for ${s.reference}`}
                      value={a.quantityPct}
                      min={0}
                      max={200}
                      onChange={(v) => onAdjust(s.id, { ...a, quantityPct: v })}
                    />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* --- What the netting says ---------------------------------------- */}
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <VarianceStatTile
          label="Downstream orders covered"
          value={`${coveredOrders} of ${show.coverage.length}`}
          tone={show.hasShortfall ? 'text-status-bad' : 'text-status-good'}
          hint={
            active
              ? `Baseline: ${baseline.coverage.filter((c) => c.short <= 0).length} of ${baseline.coverage.length}`
              : 'Planned production orders fully covered by on hand and expected supply'
          }
        />
        <VarianceStatTile
          label="First shortfall"
          value={show.firstShortDate ? shortDate(show.firstShortDate) : '—'}
          tone={show.firstShortDate ? 'text-status-bad' : undefined}
          hint={
            active
              ? `Baseline: ${baseline.firstShortDate ? shortDate(baseline.firstShortDate) : 'none'}`
              : undefined
          }
        />
        <VarianceStatTile
          label="Short quantity"
          value={`${qty(show.shortQuantity)} ${unit}`}
          tone={show.shortQuantity > 0 ? 'text-status-bad' : undefined}
          hint={active ? `Baseline: ${qty(baseline.shortQuantity)} ${unit}` : undefined}
        />
        <VarianceStatTile
          label="Expires unconsumed"
          value={money(show.expiredValue, currency)}
          tone={
            show.expiredValue > baseline.expiredValue + 1
              ? 'text-status-bad'
              : undefined
          }
          hint={
            active
              ? `Baseline: ${money(baseline.expiredValue, currency)}`
              : 'Supply the netting cannot consume before its expiry date'
          }
        />
      </div>

      {/* --- Impacted downstream orders ------------------------------------ */}
      {show.shortDemands.length > 0 ? (
        <div>
          <h3 className="mb-1 text-md font-semibold text-ink">
            Impacted downstream orders
          </h3>
          <table className="w-full max-w-[860px] border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th className="border-b border-stroke py-1 pr-4 text-left font-semibold">
                  Planned order
                </th>
                <th className="border-b border-stroke py-1 pr-4 text-left font-semibold">
                  For
                </th>
                <th className="border-b border-stroke py-1 pr-4 text-left font-semibold">
                  Required
                </th>
                <th className="border-b border-stroke py-1 pr-4 text-right font-semibold">
                  Requirement
                </th>
                <th className="border-b border-stroke py-1 text-right font-semibold">
                  Short
                </th>
              </tr>
            </thead>
            <tbody>
              {show.shortDemands.map((c) => (
                <tr key={c.demand.id}>
                  <td className="border-b border-stroke-subtle py-1 pr-4 font-semibold">
                    {c.demand.reference}
                  </td>
                  <td className="border-b border-stroke-subtle py-1 pr-4 text-ink-secondary">
                    {c.demand.description}
                  </td>
                  <td className="border-b border-stroke-subtle py-1 pr-4">
                    {shortDate(c.demand.requiredDate)}
                  </td>
                  <td className="border-b border-stroke-subtle py-1 pr-4 text-right tabular-nums">
                    {qty(c.demand.quantity)} {c.demand.unit}
                  </td>
                  <td className="border-b border-stroke-subtle py-1 text-right font-semibold tabular-nums text-status-bad">
                    {qty(c.short)} {c.demand.unit}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {/* --- Projected on hand --------------------------------------------- */}
      <div className="space-y-2">
        <ProjectionStrip
          label={active ? 'Baseline' : 'Projected on hand'}
          result={baseline}
          horizonDays={inputs.horizonDays}
          maxProjected={maxProjected}
          unit={unit}
        />
        {active ? (
          <ProjectionStrip
            label="Simulated"
            result={simulated}
            horizonDays={inputs.horizonDays}
            maxProjected={maxProjected}
            unit={unit}
          />
        ) : null}
      </div>

      <p className="text-sm text-ink-secondary">
        Demand is the planned production pegged lot-for-lot against this
        material's supply; the netting is item-level and expiry-aware
        (first-expired-first-out), and it ignores the inquiry's site filter the
        way net requirements do. Darker columns mark receipt days; a red edge
        marks a day with unmet demand.
      </p>
    </div>
  )
}

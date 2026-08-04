import { useCallback } from 'react'
import type { Ref } from '../types/domain'
import type { ProductionCostQuery, ProductionLine } from '../types/production'
import type { ProductCostProvider } from '../providers/types'
import { DateField, Field, LookupField, NumberField } from './d365/Fields'
import { qty } from '../lib/format'

/**
 * Parameters for the production cost inquiry.
 *
 * The committed-hours model is the reason the line list is a set of checkboxes
 * rather than a read-only display: which lines you are willing to give the run
 * is a decision, not a fact, and toggling one is how a planner answers "can I
 * still save that lot?".
 */

export interface ProductionParamsForm {
  itemNumber: string
  siteId: string
  planStartDate: string
  horizonDays: number | ''
  minimumRunQuantity: number | ''
  /** null means "whatever the provider treats as committed by default". */
  lineIds: string[] | null
}

export const EMPTY_PRODUCTION_PARAMS: ProductionParamsForm = {
  itemNumber: '',
  siteId: '',
  planStartDate: '',
  horizonDays: 21,
  minimumRunQuantity: 250,
  lineIds: null,
}

export function toProductionQuery(f: ProductionParamsForm): ProductionCostQuery {
  return {
    itemNumber: f.itemNumber.trim(),
    siteId: f.siteId.trim() || undefined,
    planStartDate: f.planStartDate || undefined,
    horizonDays: typeof f.horizonDays === 'number' ? f.horizonDays : undefined,
    minimumRunQuantity:
      typeof f.minimumRunQuantity === 'number' ? f.minimumRunQuantity : undefined,
    lineIds: f.lineIds ?? undefined,
  }
}

interface ProductionParametersPanelProps {
  form: ProductionParamsForm
  onChange: (next: ProductionParamsForm) => void
  provider: ProductCostProvider
  onRun: () => void
  /** Lines tooled for the item. Empty until the first run has returned. */
  lines: ProductionLine[]
}

export function ProductionParametersPanel({
  form,
  onChange,
  provider,
  onRun,
  lines,
}: ProductionParametersPanelProps) {
  const set = <K extends keyof ProductionParamsForm>(
    key: K,
    value: ProductionParamsForm[K],
  ) => {
    const next = { ...form, [key]: value }
    // A different item is tooled on different lines, and a different site puts
    // different lines in reach; either way the selection no longer applies.
    if (key === 'itemNumber' || key === 'siteId') next.lineIds = null
    onChange(next)
  }

  const fetchProducedItems = useCallback(
    async (term: string, signal: AbortSignal): Promise<Ref[]> => {
      const items = await provider.lookupProducedItems(term, signal)
      return items.map((i) => ({ id: i.itemNumber, name: i.productName }))
    },
    [provider],
  )
  const fetchSites = useCallback(
    (term: string, signal: AbortSignal) => provider.lookupSites(term, signal),
    [provider],
  )

  const selected = form.lineIds
  const isSelected = (line: ProductionLine): boolean =>
    selected ? selected.includes(line.lineId) : line.enabledByDefault

  const toggleLine = (line: ProductionLine) => {
    const current = lines.filter(isSelected).map((l) => l.lineId)
    const next = current.includes(line.lineId)
      ? current.filter((id) => id !== line.lineId)
      : [...current, line.lineId]
    onChange({ ...form, lineIds: next })
  }

  const committedHours = lines
    .filter(isSelected)
    .reduce((s, l) => s + l.hoursPerDay, 0)

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-x-8 gap-y-3 md:grid-cols-2 xl:grid-cols-3">
        <LookupField
          label="Item"
          required
          value={form.itemNumber}
          onChange={(v) => set('itemNumber', v)}
          fetchOptions={fetchProducedItems}
          placeholder="Produced item number"
          hint="Must have an approved bill of material"
          onEnter={onRun}
        />
        <DateField
          label="Plan start date"
          value={form.planStartDate}
          onChange={(v) => set('planStartDate', v)}
        />
        <NumberField
          label="Minimum run quantity"
          value={form.minimumRunQuantity}
          min={1}
          onChange={(v) => set('minimumRunQuantity', v)}
          hint="Below this a changeover is not worth making"
        />

        <LookupField
          label="Site"
          value={form.siteId}
          onChange={(v) => set('siteId', v)}
          fetchOptions={fetchSites}
          placeholder="All sites"
          hint="Limits where it can be made, not which stock it can use"
          onEnter={onRun}
        />
        <NumberField
          label="Planning horizon (days)"
          value={form.horizonDays}
          min={1}
          onChange={(v) => set('horizonDays', v)}
          hint="Counted from the plan start date, inclusive"
        />
      </div>

      <Field label="Production lines">
        {lines.length === 0 ? (
          <p className="text-base text-ink-secondary">
            Run the inquiry to list the lines tooled for this item.
          </p>
        ) : (
          <div className="border border-stroke bg-[#FAF9F8]">
            {lines.map((line) => {
              const on = isSelected(line)
              return (
                <label
                  key={line.lineId}
                  className="flex cursor-pointer items-baseline gap-2 border-b border-stroke-subtle px-2 py-[6px] last:border-b-0 hover:bg-[#F3F2F1]"
                >
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => toggleLine(line)}
                    className="h-[13px] w-[13px] shrink-0 cursor-pointer accent-brand"
                  />
                  <span className="w-[70px] shrink-0 font-semibold text-ink">
                    {line.lineId}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-ink">
                    {line.name}
                  </span>
                  <span className="shrink-0 tabular-nums text-ink-secondary">
                    site {line.siteId} · {qty(line.unitsPerHour)}/h ·{' '}
                    {qty(line.hoursPerDay)} h/day committed
                  </span>
                </label>
              )
            })}
            <div className="flex items-baseline justify-end gap-2 bg-[#F3F2F1] px-2 py-[5px] text-sm">
              <span className="text-ink-secondary">Committed hours per day</span>
              <span className="font-semibold tabular-nums text-ink">
                {qty(committedHours)}
              </span>
            </div>
          </div>
        )}
      </Field>
    </div>
  )
}

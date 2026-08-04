import { useCallback } from 'react'
import type { ProductCostQuery, Ref } from '../types/domain'
import type { ProductCostProvider } from '../providers/types'
import { DateField, LookupField, NumberField, TextField } from './d365/Fields'

/**
 * The Parameters block. Item is mandatory; everything else narrows the result.
 *
 * The date range and "days back" are mutually exclusive by construction —
 * typing in one visibly disables the other rather than silently losing.
 */

export interface ParamsForm {
  itemNumber: string
  siteId: string
  warehouseId: string
  locationId: string
  batchNumber: string
  purchaseOrderNumber: string
  fromDate: string
  toDate: string
  daysBack: number | ''
}

export const EMPTY_PARAMS: ParamsForm = {
  itemNumber: '',
  siteId: '',
  warehouseId: '',
  locationId: '',
  batchNumber: '',
  purchaseOrderNumber: '',
  fromDate: '',
  toDate: '',
  daysBack: '',
}

export function toQuery(f: ParamsForm): ProductCostQuery {
  return {
    itemNumber: f.itemNumber.trim(),
    siteId: f.siteId.trim() || undefined,
    warehouseId: f.warehouseId.trim() || undefined,
    locationId: f.locationId.trim() || undefined,
    batchNumber: f.batchNumber.trim() || undefined,
    purchaseOrderNumber: f.purchaseOrderNumber.trim() || undefined,
    fromDate: f.fromDate || undefined,
    toDate: f.toDate || undefined,
    daysBack: typeof f.daysBack === 'number' ? f.daysBack : undefined,
  }
}

interface ParametersPanelProps {
  form: ParamsForm
  onChange: (next: ParamsForm) => void
  provider: ProductCostProvider
  onRun: () => void
}

export function ParametersPanel({
  form,
  onChange,
  provider,
  onRun,
}: ParametersPanelProps) {
  const set = <K extends keyof ParamsForm>(key: K, value: ParamsForm[K]) => {
    const next = { ...form, [key]: value }

    // Changing the site invalidates a warehouse that belongs to another site.
    if (key === 'siteId') next.warehouseId = ''
    // Changing the item invalidates its batches.
    if (key === 'itemNumber') next.batchNumber = ''

    onChange(next)
  }

  const usingRollingWindow = form.daysBack !== '' && Number(form.daysBack) > 0
  const usingExplicitDates = Boolean(form.fromDate || form.toDate)

  // Memoised so LookupField's fetch effect doesn't re-fire on every keystroke
  // of an unrelated field.
  const fetchItems = useCallback(
    async (term: string, signal: AbortSignal): Promise<Ref[]> => {
      const items = await provider.lookupItems(term, signal)
      return items.map((i) => ({ id: i.itemNumber, name: i.productName }))
    },
    [provider],
  )
  const fetchSites = useCallback(
    (term: string, signal: AbortSignal) => provider.lookupSites(term, signal),
    [provider],
  )
  const fetchWarehouses = useCallback(
    (term: string, signal: AbortSignal) =>
      provider.lookupWarehouses(form.siteId.trim() || undefined, term, signal),
    [provider, form.siteId],
  )
  const fetchBatches = useCallback(
    (term: string, signal: AbortSignal) =>
      provider.lookupBatches(form.itemNumber.trim(), term, signal),
    [provider, form.itemNumber],
  )
  const fetchPos = useCallback(
    (term: string, signal: AbortSignal) =>
      provider.lookupPurchaseOrders(form.itemNumber.trim(), term, signal),
    [provider, form.itemNumber],
  )

  return (
    <div className="grid grid-cols-1 gap-x-8 gap-y-3 md:grid-cols-2 xl:grid-cols-3">
      <LookupField
        label="Item"
        required
        value={form.itemNumber}
        onChange={(v) => set('itemNumber', v)}
        fetchOptions={fetchItems}
        placeholder="Item number"
        onEnter={onRun}
      />
      {/* Locations are warehouse-scoped in F&O and there is no useful lookup
          until a warehouse is chosen, so this stays free text. */}
      <TextField
        label="Location"
        value={form.locationId}
        onChange={(v) => set('locationId', v)}
        placeholder="Optional"
        onEnter={onRun}
      />
      <NumberField
        label="Days back"
        value={form.daysBack}
        min={1}
        onChange={(v) => {
          const next = { ...form, daysBack: v }
          // A rolling window replaces any explicit range.
          if (v !== '' && Number(v) > 0) {
            next.fromDate = ''
            next.toDate = ''
          }
          onChange(next)
        }}
        placeholder={usingExplicitDates ? 'Using date range' : 'e.g. 180'}
        hint="Rolling window ending today"
      />

      <LookupField
        label="Site"
        value={form.siteId}
        onChange={(v) => set('siteId', v)}
        fetchOptions={fetchSites}
        placeholder="Optional"
        onEnter={onRun}
      />
      <LookupField
        label="Batch"
        value={form.batchNumber}
        onChange={(v) => set('batchNumber', v)}
        fetchOptions={fetchBatches}
        disabled={!form.itemNumber.trim()}
        placeholder={
          form.itemNumber.trim() ? 'Optional' : 'Select an item first'
        }
        onEnter={onRun}
      />
      <DateField
        label="From date"
        value={form.fromDate}
        disabled={usingRollingWindow}
        onChange={(v) => onChange({ ...form, fromDate: v, daysBack: '' })}
      />

      <LookupField
        label="Warehouse"
        value={form.warehouseId}
        onChange={(v) => set('warehouseId', v)}
        fetchOptions={fetchWarehouses}
        placeholder="Optional"
        hint={form.siteId ? `Filtered to site ${form.siteId}` : undefined}
        onEnter={onRun}
      />
      <LookupField
        label="PO number"
        value={form.purchaseOrderNumber}
        onChange={(v) => set('purchaseOrderNumber', v)}
        fetchOptions={fetchPos}
        placeholder="Optional"
        onEnter={onRun}
      />
      <DateField
        label="To date"
        value={form.toDate}
        disabled={usingRollingWindow}
        onChange={(v) => onChange({ ...form, toDate: v, daysBack: '' })}
      />
    </div>
  )
}

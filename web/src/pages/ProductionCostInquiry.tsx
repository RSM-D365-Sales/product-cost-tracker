import { useCallback, useEffect, useRef, useState } from 'react'
import type { ProductionCostResult } from '../types/production'
import type { ProductCostProvider } from '../providers/types'
import { ProviderError } from '../providers/types'

import { AppShell } from '../components/d365/AppShell'
import {
  ActionButton,
  ActionDivider,
  ActionGroup,
  ActionPane,
} from '../components/d365/ActionPane'
import { FastTab } from '../components/d365/FastTab'
import { MessageBar } from '../components/d365/MessageBar'
import {
  IconBox,
  IconChart,
  IconClear,
  IconExcel,
  IconExpand,
  IconFilter,
  IconGrid,
  IconRefresh,
  IconSpinner,
  IconTree,
} from '../components/d365/Icons'

import {
  EMPTY_PRODUCTION_PARAMS,
  ProductionParametersPanel,
  toProductionQuery,
  type ProductionParamsForm,
} from '../components/ProductionParametersPanel'
import { CostRollupPanel } from '../components/CostRollupPanel'
import { BomPanel } from '../components/BomPanel'
import { BatchOnHandGrid } from '../components/BatchOnHandGrid'
import { PlanSummaryPanel } from '../components/PlanSummaryPanel'
import { ProductionPlanGrid } from '../components/ProductionPlanGrid'
import { CapacityTimeline } from '../components/CapacityTimeline'

import { money, percent, qty } from '../lib/format'
import { downloadPlanCsv } from '../lib/export'
import { PAGES, type PageId } from '../lib/route'

const COMPANY = import.meta.env.VITE_COMPANY ?? 'USMF'
const PAGE = PAGES.find((p) => p.id === 'production-cost')!

/**
 * Production cost inquiry.
 *
 * Reads top to bottom as one argument: this is what a unit costs to make, this
 * is the stock you have to make it from and how long you have to use it, and
 * this is the plan that falls out of those two facts — costed at the actual
 * lots it consumes, not at a standard.
 */
export function ProductionCostInquiry({
  provider,
  initialItem,
  onNavigate,
}: {
  provider: ProductCostProvider
  initialItem?: string
  onNavigate?: (pageId: PageId, params?: Record<string, string>) => void
}) {
  // Opens empty. An item arriving on the hash from the product cost inquiry
  // still fills the field, but nothing is chosen on the operator's behalf.
  const [form, setForm] = useState<ProductionParamsForm>({
    ...EMPTY_PRODUCTION_PARAMS,
    itemNumber: initialItem ?? '',
  })
  const [result, setResult] = useState<ProductionCostResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<{ title: string; detail?: string } | null>(
    null,
  )
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null)

  const [showParams, setShowParams] = useState(true)
  const [showRollup, setShowRollup] = useState(true)
  // The BOM is the evidence behind the cost rather than the answer itself, so
  // it starts closed the way an F&O detail FastTab does.
  const [showBom, setShowBom] = useState(false)
  const [showBatches, setShowBatches] = useState(true)
  const [showPlan, setShowPlan] = useState(true)
  const [showCapacity, setShowCapacity] = useState(true)
  const [activeTab, setActiveTab] = useState('Production cost inquiry')

  const inflight = useRef<AbortController | null>(null)
  useEffect(() => () => inflight.current?.abort(), [])

  const run = useCallback(async () => {
    const query = toProductionQuery(form)

    if (!query.itemNumber) {
      setError({
        title: 'Item is a required field.',
        detail: 'Enter a produced item number before running the inquiry.',
      })
      return
    }

    inflight.current?.abort()
    const ctrl = new AbortController()
    inflight.current = ctrl

    setLoading(true)
    setError(null)

    try {
      const res = await provider.getProductionCostInquiry(query, ctrl.signal)
      if (ctrl.signal.aborted) return
      setResult(res)
      setSelectedRunId(res.plan[0]?.id ?? null)
      setSelectedBatchId(res.onHand[0]?.id ?? null)
      // Materialise the default line selection so the checkboxes below show
      // what actually ran, and toggling one is a real edit rather than a reset.
      setForm((f) =>
        f.lineIds
          ? f
          : {
              ...f,
              lineIds: res.lines
                .filter((l) => l.enabledByDefault)
                .map((l) => l.lineId),
            },
      )
      if (res.plan.length > 0) setShowParams(false)
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return
      if (e instanceof ProviderError) {
        setError({ title: e.message, detail: e.detail })
      } else {
        setError({
          title: 'The inquiry could not be completed.',
          detail: e instanceof Error ? e.message : String(e),
        })
      }
      setResult(null)
    } finally {
      if (!ctrl.signal.aborted) setLoading(false)
    }
  }, [form, provider])

  const reset = () => {
    inflight.current?.abort()
    setForm({ ...EMPTY_PRODUCTION_PARAMS })
    setResult(null)
    setError(null)
    setSelectedRunId(null)
    setSelectedBatchId(null)
    setShowParams(true)
    setLoading(false)
  }

  const openInProductCostInquiry = useCallback(
    (itemNumber: string) => onNavigate?.('product-cost', { item: itemNumber }),
    [onNavigate],
  )

  const componentItemNumbers =
    result?.bom.components.filter((c) => c.batchTracked).map((c) => c.itemNumber) ??
    []

  return (
    <AppShell
      company={COMPANY}
      moduleTrail={PAGE.moduleTrail}
      title={PAGE.title}
      activePageId={PAGE.id}
      onNavigate={onNavigate ? (id) => onNavigate(id) : undefined}
      captionAside={<ProviderBadge provider={provider} />}
      statusBar={
        <StatusBar result={result} loading={loading} provider={provider} />
      }
    >
      <div className="space-y-2">
        <ActionPane
          tabs={['Production cost inquiry', 'View']}
          activeTab={activeTab}
          onTabChange={setActiveTab}
        >
          {activeTab === 'Production cost inquiry' ? (
            <>
              <ActionGroup label="Inquiry">
                <ActionButton
                  primary
                  icon={loading ? IconSpinner : IconFilter}
                  onClick={run}
                  disabled={loading}
                >
                  {loading ? 'Running…' : 'Run'}
                </ActionButton>
                <ActionButton icon={IconRefresh} onClick={run} disabled={loading}>
                  Refresh
                </ActionButton>
                <ActionButton icon={IconClear} onClick={reset}>
                  Reset
                </ActionButton>
              </ActionGroup>

              <ActionDivider />

              <ActionGroup label="Parameters">
                <ActionButton
                  icon={IconExpand}
                  onClick={() => setShowParams((v) => !v)}
                >
                  {showParams ? 'Hide parameters' : 'Show parameters'}
                </ActionButton>
              </ActionGroup>

              <ActionDivider />

              <ActionGroup label="Related information">
                <ActionButton
                  icon={IconGrid}
                  disabled={!onNavigate || !result}
                  onClick={() =>
                    result && openInProductCostInquiry(result.item.itemNumber)
                  }
                  title="Open this item's posted receipts in the product cost inquiry"
                >
                  Product cost inquiry
                </ActionButton>
                <ActionButton
                  icon={IconBox}
                  disabled={!onNavigate || componentItemNumbers.length === 0}
                  onClick={() =>
                    componentItemNumbers[0] &&
                    openInProductCostInquiry(componentItemNumbers[0])
                  }
                  title="Open the receipts behind the batches this item consumes"
                >
                  Component receipts
                </ActionButton>
              </ActionGroup>

              <ActionDivider />

              <ActionGroup label="Microsoft Office">
                <ActionButton
                  icon={IconExcel}
                  disabled={!result || result.plan.length === 0}
                  onClick={() => result && downloadPlanCsv(result)}
                  title="Export the plan, one row per consumed lot, to a CSV that Excel opens directly"
                >
                  Export plan to Excel
                </ActionButton>
              </ActionGroup>
            </>
          ) : (
            <ActionGroup label="Show">
              <ActionButton icon={IconTree} onClick={() => setShowBom((v) => !v)}>
                {showBom ? 'Hide bill of material' : 'Bill of material'}
              </ActionButton>
              <ActionButton
                icon={IconBox}
                onClick={() => setShowBatches((v) => !v)}
              >
                {showBatches ? 'Hide available batches' : 'Available batches'}
              </ActionButton>
              <ActionButton
                icon={IconChart}
                onClick={() => setShowCapacity((v) => !v)}
              >
                {showCapacity ? 'Hide capacity' : 'Capacity'}
              </ActionButton>
            </ActionGroup>
          )}
        </ActionPane>

        {error ? (
          <MessageBar
            kind="error"
            title={error.title}
            detail={error.detail}
            onDismiss={() => setError(null)}
          />
        ) : null}

        {result?.warnings.map((w) => (
          <MessageBar key={w} kind="warning" title={w} />
        )) ?? null}

        <FastTab
          title="Parameters"
          expanded={showParams}
          onToggle={() => setShowParams((v) => !v)}
          summary={[
            { label: 'Item', value: form.itemNumber || '—' },
            {
              label: 'Horizon',
              value:
                typeof form.horizonDays === 'number'
                  ? `${form.horizonDays} days`
                  : '—',
            },
            {
              label: 'Lines',
              value: form.lineIds
                ? `${form.lineIds.length} selected`
                : 'Default',
            },
          ]}
        >
          <ProductionParametersPanel
            form={form}
            onChange={setForm}
            provider={provider}
            onRun={run}
            lines={result?.lines ?? []}
          />
          <div className="mt-4 flex items-center gap-2 border-t border-stroke-subtle pt-3">
            <ActionButton primary onClick={run} disabled={loading}>
              {loading ? 'Running…' : 'Run inquiry'}
            </ActionButton>
            <ActionButton onClick={reset}>Reset</ActionButton>
            <span className="ml-2 text-sm text-ink-secondary">
              Item is required. Changing the lines or the horizon and running
              again is how the plan is negotiated.
            </span>
          </div>
        </FastTab>

        {result ? (
          <>
            <FastTab
              title="Cost calculation"
              expanded={showRollup}
              onToggle={() => setShowRollup((v) => !v)}
              badge={
                <span className="ml-1 border border-stroke bg-[#F3F2F1] px-[6px] py-px text-xs text-ink-secondary">
                  {result.item.itemNumber} · {result.item.productName}
                </span>
              }
              summary={[
                {
                  label: 'Calculated',
                  value: money(result.rollup.total, result.rollup.currency),
                },
                {
                  label: 'Current cost',
                  value: money(result.rollup.currentCost, result.rollup.currency),
                },
                {
                  label: 'Margin',
                  value: percent(result.rollup.marginCalculated),
                },
              ]}
            >
              <CostRollupPanel rollup={result.rollup} unit={result.item.unit} />
            </FastTab>

            <FastTab
              title="Bill of material and route"
              expanded={showBom}
              onToggle={() => setShowBom((v) => !v)}
              badge={
                <span className="ml-1 border border-stroke bg-[#F3F2F1] px-[6px] py-px text-xs text-ink-secondary">
                  {result.bom.bomId} · {result.bom.bomVersion}
                </span>
              }
              summary={[
                {
                  label: 'Components',
                  value: qty(result.bom.components.length),
                },
                {
                  label: 'Operations',
                  value: qty(result.bom.operations.length),
                },
              ]}
            >
              <BomPanel
                bom={result.bom}
                onOpenItem={onNavigate ? openInProductCostInquiry : undefined}
              />
            </FastTab>

            <FastTab
              title="Available batches"
              expanded={showBatches}
              onToggle={() => setShowBatches((v) => !v)}
              summary={[
                { label: 'Lots', value: qty(result.onHand.length) },
                {
                  label: 'Expiring',
                  value: qty(
                    result.onHand.filter((b) => b.status === 'Expiring').length,
                  ),
                },
                {
                  label: 'Inventory value',
                  value: money(
                    result.onHand.reduce((s, b) => s + b.inventoryValue, 0),
                    result.item.currency,
                  ),
                },
              ]}
            >
              <p className="mb-2 text-base text-ink-secondary">
                Every lot is valued at the landed cost of the receipt that
                created it — the same figure the product cost inquiry reports.
                Lots are listed first-expired-first-out, which is the order the
                plan consumes them in.
              </p>
              <BatchOnHandGrid
                batches={result.onHand}
                loading={loading}
                selectedId={selectedBatchId}
                onSelect={setSelectedBatchId}
              />
            </FastTab>

            {showCapacity ? (
              <FastTab
                title="Capacity"
                expanded={showCapacity}
                onToggle={() => setShowCapacity((v) => !v)}
                summary={[
                  {
                    label: 'Utilised',
                    value: percent(result.summary.capacityUtilisation),
                  },
                ]}
              >
                <CapacityTimeline
                  summary={result.summary}
                  plan={result.plan}
                  onHand={result.onHand}
                  atRisk={result.atRisk}
                  componentItemNumbers={componentItemNumbers}
                />
              </FastTab>
            ) : null}

            <FastTab
              title="Production plan"
              expanded={showPlan}
              onToggle={() => setShowPlan((v) => !v)}
              summary={[
                {
                  label: 'Output',
                  value: `${qty(result.summary.plannedQuantity)} ${result.item.unit}`,
                },
                {
                  label: 'Avg. cost',
                  value: money(
                    result.summary.averageCostPerUnit,
                    result.summary.currency,
                  ),
                },
                {
                  label: 'At risk',
                  value: money(
                    result.summary.atRiskValue,
                    result.summary.currency,
                  ),
                },
              ]}
            >
              <div className="space-y-3">
                <PlanSummaryPanel
                  summary={result.summary}
                  atRisk={result.atRisk}
                />
                <div>
                  <div className="mb-1 flex items-baseline gap-2 px-[2px]">
                    <h3 className="text-md font-semibold text-ink">
                      Proposed runs
                    </h3>
                    <span className="text-sm text-ink-secondary">
                      {result.plan.length}{' '}
                      {result.plan.length === 1 ? 'run' : 'runs'} · expand a run
                      to see the lots it consumes and what they cost
                    </span>
                  </div>
                  <ProductionPlanGrid
                    runs={result.plan}
                    loading={loading}
                    selectedId={selectedRunId}
                    onSelect={setSelectedRunId}
                  />
                </div>
              </div>
            </FastTab>
          </>
        ) : (
          <div className="border border-stroke bg-surface px-3 py-10 text-center text-base text-ink-secondary">
            Enter a produced item number and select Run to calculate its cost and
            plan against the batches on hand.
          </div>
        )}
      </div>
    </AppShell>
  )
}

function ProviderBadge({ provider }: { provider: ProductCostProvider }) {
  const tone =
    provider.kind === 'mock'
      ? 'border-status-warn/40 bg-status-warnBg text-status-warn'
      : 'border-status-good/40 bg-status-goodBg text-status-good'

  return (
    <span
      className={`inline-flex items-center gap-[6px] border px-2 py-[2px] text-sm ${tone}`}
      title={`Data provider: ${provider.kind}`}
    >
      <span className="h-[6px] w-[6px] rounded-full bg-current" />
      {provider.label}
    </span>
  )
}

function StatusBar({
  result,
  loading,
  provider,
}: {
  result: ProductionCostResult | null
  loading: boolean
  provider: ProductCostProvider
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
      <span>
        {loading
          ? 'Calculating…'
          : result
            ? `${result.plan.length} planned runs · ${qty(result.summary.plannedQuantity)} ${result.item.unit} from ${result.onHand.length} lots on hand`
            : 'Ready'}
      </span>
      {result && !loading ? (
        <span>Calculated in {result.elapsedMs} ms</span>
      ) : null}
      <span className="ml-auto">
        Source: {provider.label} ({provider.kind})
      </span>
    </div>
  )
}

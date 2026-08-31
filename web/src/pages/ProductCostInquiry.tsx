import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ProductCostResult } from '../types/domain'
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
  IconChart,
  IconClear,
  IconCopilot,
  IconExcel,
  IconExpand,
  IconFactory,
  IconFilter,
  IconRefresh,
  IconSpinner,
  IconVariance,
} from '../components/d365/Icons'
import { PAGES, type PageId } from '../lib/route'

import {
  EMPTY_PARAMS,
  ParametersPanel,
  toQuery,
  type ParamsForm,
} from '../components/ParametersPanel'
import { SummaryPanel } from '../components/SummaryPanel'
import { CostTrendPanel } from '../components/CostTrendPanel'
import { ReceiptGrid } from '../components/ReceiptGrid'
import { LandedVariancePanel } from '../components/LandedVariancePanel'
import { CopilotPane } from '../components/CopilotPane'

import { money, percent, qty, signedPercent } from '../lib/format'
import { hasOptionalFilters, resolveDateWindow } from '../lib/query'
import { downloadCsv } from '../lib/export'
import { deepLinksEnabled } from '../lib/links'
import { analyseLandedVariance } from '../lib/variance'
import { purchasingNarrative } from '../lib/copilot'

const COMPANY = import.meta.env.VITE_COMPANY ?? 'USMF'

const PAGE = PAGES.find((p) => p.id === 'product-cost')!

export function ProductCostInquiry({
  provider,
  initialItem,
  onNavigate,
}: {
  provider: ProductCostProvider
  /** Item carried in on the hash, e.g. from the production cost inquiry. */
  initialItem?: string
  onNavigate?: (pageId: PageId, params?: Record<string, string>) => void
}) {
  // Opens empty. An item arriving on the hash from the production cost inquiry
  // still fills the field, but nothing is chosen on the operator's behalf.
  const [form, setForm] = useState<ParamsForm>({
    ...EMPTY_PARAMS,
    itemNumber: initialItem ?? '',
  })
  const [result, setResult] = useState<ProductCostResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<{ title: string; detail?: string } | null>(
    null,
  )
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showParams, setShowParams] = useState(true)
  const [showSummary, setShowSummary] = useState(true)
  // Starts closed: the grid is the answer to the question that was asked, and
  // the trend is the follow-up question.
  const [showTrend, setShowTrend] = useState(false)
  // Collapsed rather than absent: the FastTab header always reports how many
  // receipts sit outside the band, and one click opens the evidence.
  const [showVariance, setShowVariance] = useState(false)
  const [tolerancePct, setTolerancePct] = useState(5)
  const [copilotOpen, setCopilotOpen] = useState(false)
  const [activeTab, setActiveTab] = useState('Product cost inquiry')

  const variance = useMemo(
    () =>
      result && result.rows.length > 0
        ? analyseLandedVariance(result.rows, tolerancePct)
        : null,
    [result, tolerancePct],
  )

  const copilotSections = useMemo(
    () => (result ? purchasingNarrative(result, variance) : null),
    [result, variance],
  )

  // Only ever one inquiry in flight; a second Run cancels the first.
  const inflight = useRef<AbortController | null>(null)
  useEffect(() => () => inflight.current?.abort(), [])

  const run = useCallback(async () => {
    const query = toQuery(form)

    if (!query.itemNumber) {
      setError({
        title: 'Item is a required field.',
        detail: 'Enter an item number before running the inquiry.',
      })
      return
    }

    inflight.current?.abort()
    const ctrl = new AbortController()
    inflight.current = ctrl

    setLoading(true)
    setError(null)

    try {
      const res = await provider.getProductCostInquiry(query, ctrl.signal)
      if (ctrl.signal.aborted) return
      setResult(res)
      setSelectedId(res.rows[0]?.id ?? null)
      // Collapse the parameters block once there are results to look at, the
      // way F&O inquiry forms hand the screen over to the grid.
      if (res.rows.length > 0) setShowParams(false)
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
    setForm({ ...EMPTY_PARAMS })
    setResult(null)
    setError(null)
    setSelectedId(null)
    setShowParams(true)
    setLoading(false)
  }

  const summary = result?.summary
  const window = resolveDateWindow(toQuery(form))

  return (
    <AppShell
      company={COMPANY}
      moduleTrail={PAGE.moduleTrail}
      title={PAGE.title}
      activePageId={PAGE.id}
      onNavigate={onNavigate ? (id) => onNavigate(id) : undefined}
      captionAside={<ProviderBadge provider={provider} />}
      statusBar={
        <StatusBar
          result={result}
          loading={loading}
          provider={provider}
        />
      }
    >
      <div className="space-y-2">
        <ActionPane
          tabs={['Product cost inquiry', 'Options']}
          activeTab={activeTab}
          onTabChange={setActiveTab}
        >
          {activeTab === 'Product cost inquiry' ? (
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

              <ActionGroup label="Analyze">
                <ActionButton
                  icon={IconChart}
                  disabled={!result || result.rows.length === 0}
                  onClick={() => setShowTrend((v) => !v)}
                  title="Plot these receipts over time, with a fitted trend and an optional projection"
                >
                  {showTrend ? 'Hide cost trend' : 'Cost trend'}
                </ActionButton>
                <ActionButton
                  icon={IconVariance}
                  disabled={!result || result.rows.length === 0}
                  onClick={() => setShowVariance((v) => !v)}
                  title="Receipts outside the tolerance band, with the cost components that put them there"
                >
                  {showVariance ? 'Hide cost variance' : 'Cost variance'}
                </ActionButton>
                {onNavigate ? (
                  <ActionButton
                    icon={IconFactory}
                    disabled={!form.itemNumber.trim()}
                    onClick={() =>
                      onNavigate('production-cost', {
                        item: form.itemNumber.trim(),
                      })
                    }
                    title="Take this item to the production cost inquiry: its bill of material, the batches on hand, and what can be made from them"
                  >
                    Production cost
                  </ActionButton>
                ) : null}
              </ActionGroup>

              <ActionDivider />

              <ActionGroup label="Microsoft Office">
                <ActionButton
                  icon={IconExcel}
                  disabled={!result || result.rows.length === 0}
                  onClick={() => result && downloadCsv(result)}
                  title="Export the grid to a CSV that Excel opens directly"
                >
                  Export to Excel
                </ActionButton>
              </ActionGroup>

              <ActionDivider />

              <ActionGroup label="Copilot">
                <ActionButton
                  icon={IconCopilot}
                  onClick={() => setCopilotOpen((v) => !v)}
                  title="A written analysis of the purchasing activity this inquiry returned"
                >
                  {copilotOpen ? 'Hide Copilot' : 'Copilot'}
                </ActionButton>
              </ActionGroup>
            </>
          ) : (
            <ActionGroup label="View">
              <ActionButton
                icon={IconExpand}
                onClick={() => setShowSummary((v) => !v)}
              >
                {showSummary ? 'Hide summary' : 'Show summary'}
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
              label: 'Range',
              value:
                window.from || window.to
                  ? `${window.from ?? '…'} → ${window.to ?? '…'}`
                  : 'All dates',
            },
            {
              label: 'Filters',
              value: hasOptionalFilters(toQuery(form)) ? 'Applied' : 'None',
            },
          ]}
        >
          <ParametersPanel
            form={form}
            onChange={setForm}
            provider={provider}
            onRun={run}
          />
          <div className="mt-4 flex items-center gap-2 border-t border-stroke-subtle pt-3">
            <ActionButton primary onClick={run} disabled={loading}>
              {loading ? 'Running…' : 'Run inquiry'}
            </ActionButton>
            <ActionButton onClick={reset}>Reset</ActionButton>
            <span className="ml-2 text-sm text-ink-secondary">
              Item is required. All other parameters narrow the result.
            </span>
          </div>
        </FastTab>

        {summary && result ? (
          <FastTab
            title="Summary"
            expanded={showSummary}
            onToggle={() => setShowSummary((v) => !v)}
            badge={
              <span className="ml-1 border border-stroke bg-[#F3F2F1] px-[6px] py-px text-xs text-ink-secondary">
                {result.item.itemNumber} · {result.item.productName}
              </span>
            }
            summary={[
              {
                label: 'Avg. landed',
                value: money(summary.averageLandedCost, summary.currency),
              },
              {
                label: 'Margin (landed)',
                value: percent(summary.averageMarginLanded),
              },
              { label: 'Receipts', value: qty(summary.receiptCount) },
            ]}
          >
            <SummaryPanel summary={summary} unit={result.item.unit} />
          </FastTab>
        ) : null}

        {result && variance ? (
          <FastTab
            title="Landed cost variance"
            expanded={showVariance}
            onToggle={() => setShowVariance((v) => !v)}
            badge={
              <span className="ml-1 border border-stroke bg-[#F3F2F1] px-[6px] py-px text-xs text-ink-secondary">
                vs quantity-weighted baseline
              </span>
            }
            summary={[
              {
                label: 'Baseline',
                value: money(variance.baseline, variance.currency),
              },
              {
                label: `Outside ±${tolerancePct}%`,
                value: `${variance.flagged.length} of ${variance.receipts.length}`,
              },
              {
                label: 'Largest',
                value: variance.flagged[0]
                  ? signedPercent(variance.flagged[0].variancePct)
                  : '—',
              },
            ]}
          >
            <LandedVariancePanel
              analysis={variance}
              unit={result.item.unit}
              tolerancePct={tolerancePct}
              onToleranceChange={setTolerancePct}
            />
          </FastTab>
        ) : null}

        {result && result.rows.length > 0 && showTrend ? (
          <FastTab
            title="Cost trend"
            expanded={showTrend}
            onToggle={() => setShowTrend((v) => !v)}
            badge={
              <span className="ml-1 border border-stroke bg-[#F3F2F1] px-[6px] py-px text-xs text-ink-secondary">
                {result.item.itemNumber} · per {result.item.unit}
              </span>
            }
          >
            <CostTrendPanel result={result} />
          </FastTab>
        ) : null}

        <div>
          <div className="mb-1 flex items-baseline gap-2 px-[2px]">
            <h2 className="text-md font-semibold text-ink">Product receipts</h2>
            {result ? (
              <span className="text-sm text-ink-secondary">
                {result.rows.length}{' '}
                {result.rows.length === 1 ? 'line' : 'lines'}
                {deepLinksEnabled
                  ? ' · select an order or receipt number to open it in Finance and Operations'
                  : ' · expand a row to see the charge breakdown'}
              </span>
            ) : null}
          </div>

          <ReceiptGrid
            rows={result?.rows ?? []}
            loading={loading}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        </div>
      </div>

      <CopilotPane
        open={copilotOpen}
        onClose={() => setCopilotOpen(false)}
        sections={copilotSections}
        contextLabel={
          result
            ? `Analysis of purchasing activity for ${result.item.itemNumber} ${result.item.productName}`
            : undefined
        }
      />
    </AppShell>
  )
}

/**
 * Which environment the numbers came from. Only rendered once the app is
 * pointed at a live one — on the seeded provider there is nothing to announce,
 * and the page should read as the F&O form it is modelled on.
 */
function ProviderBadge({ provider }: { provider: ProductCostProvider }) {
  if (provider.kind === 'mock') return null

  return (
    <span
      className="inline-flex items-center gap-[6px] border border-status-good/40 bg-status-goodBg px-2 py-[2px] text-sm text-status-good"
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
  result: ProductCostResult | null
  loading: boolean
  provider: ProductCostProvider
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
      <span>
        {loading
          ? 'Retrieving data…'
          : result
            ? `${result.rows.length} product receipt lines · ${qty(result.summary.totalQuantity)} ${result.item.unit} received`
            : 'Ready'}
      </span>
      {result && !loading ? (
        <span>Retrieved in {result.elapsedMs} ms</span>
      ) : null}
      {provider.kind === 'mock' ? null : (
        <span className="ml-auto">
          Source: {provider.label} ({provider.kind})
        </span>
      )}
    </div>
  )
}

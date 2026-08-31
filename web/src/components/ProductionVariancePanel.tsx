import { Fragment, useMemo, useState } from 'react'
import type { ProductionBom } from '../types/production'
import type {
  GroupBridge,
  ProductionVarianceAnalysis,
  RunVariance,
} from '../lib/variance'
import { Grid, type Column } from './d365/Grid'
import { IconChevronDown, IconChevronRight } from './d365/Icons'
import {
  money,
  moneyPrecise,
  qty,
  qtyPrecise,
  shortDate,
  signedMoney,
  signedPercent,
} from '../lib/format'
import {
  DirectionPill,
  DivergingBar,
  DriverChips,
  ToleranceField,
  VarianceStatTile,
  varianceTone,
} from './LandedVariancePanel'

/**
 * Production cost variance, told in two halves.
 *
 * The BRIDGE sets what the posted runs actually cost against what today's BOM
 * and route say a unit should cost, by cost group — and each group opens up to
 * the component and operation lines behind it, which is where "packaging is
 * up" becomes "cans are up".
 *
 * The RUN GRID hunts outliers. Its baseline is the runs' own quantity-weighted
 * average, not the calculation: material is priced at today's lots, so a
 * uniform gap against history is expected and belongs to the bridge. A run
 * flagged here left its own cohort, and the group deltas say in which
 * direction and on what.
 */

function GroupDrilldown({ group, bom }: { group: GroupBridge; bom: ProductionBom }) {
  const currency = bom.currency
  const components = bom.components.filter((c) => c.costGroup === group.group)
  const operations = bom.operations.filter((o) => o.costGroup === group.group)

  if (components.length === 0 && operations.length === 0) {
    return (
      <p className="text-sm text-ink-secondary">
        Nothing on the bill of material or route carries this cost group.
      </p>
    )
  }

  return (
    <div className="space-y-2">
      {components.length > 0 ? (
        <table className="w-full max-w-[860px] border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th className="border-b border-stroke py-1 pr-4 text-left font-semibold">
                Component
              </th>
              <th className="border-b border-stroke py-1 pr-4 text-left font-semibold">
                Product name
              </th>
              <th className="border-b border-stroke py-1 pr-4 text-right font-semibold">
                Consumed / {bom.unit}
              </th>
              <th className="border-b border-stroke py-1 pr-4 text-right font-semibold">
                Unit cost
              </th>
              <th className="border-b border-stroke py-1 pr-4 text-left font-semibold">
                Cost basis
              </th>
              <th className="border-b border-stroke py-1 text-right font-semibold">
                Cost / {bom.unit}
              </th>
            </tr>
          </thead>
          <tbody>
            {components.map((c) => (
              <tr key={c.lineNumber}>
                <td className="border-b border-stroke-subtle py-1 pr-4 font-semibold">
                  {c.itemNumber}
                </td>
                <td className="border-b border-stroke-subtle py-1 pr-4 text-ink-secondary">
                  {c.productName}
                </td>
                <td className="border-b border-stroke-subtle py-1 pr-4 text-right tabular-nums">
                  {qtyPrecise(c.quantityConsumed)} {c.unit}
                </td>
                <td className="border-b border-stroke-subtle py-1 pr-4 text-right tabular-nums">
                  {moneyPrecise(c.unitCost, currency)}
                </td>
                <td className="border-b border-stroke-subtle py-1 pr-4 text-ink-secondary">
                  {c.costBasis}
                </td>
                <td className="border-b border-stroke-subtle py-1 text-right font-semibold tabular-nums">
                  {moneyPrecise(c.extendedCost, currency)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      {operations.length > 0 ? (
        <table className="w-full max-w-[860px] border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th className="border-b border-stroke py-1 pr-4 text-left font-semibold">
                Operation
              </th>
              <th className="border-b border-stroke py-1 pr-4 text-left font-semibold">
                Description
              </th>
              <th className="border-b border-stroke py-1 pr-4 text-left font-semibold">
                Resource
              </th>
              <th className="border-b border-stroke py-1 text-right font-semibold">
                Cost / {bom.unit}
              </th>
            </tr>
          </thead>
          <tbody>
            {operations.map((o) => (
              <tr key={o.operationNumber}>
                <td className="border-b border-stroke-subtle py-1 pr-4 font-semibold">
                  {o.operationNumber}
                </td>
                <td className="border-b border-stroke-subtle py-1 pr-4 text-ink-secondary">
                  {o.description}
                </td>
                <td className="border-b border-stroke-subtle py-1 pr-4">
                  {o.resourceId}
                </td>
                <td className="border-b border-stroke-subtle py-1 text-right font-semibold tabular-nums">
                  {money(o.costPerUnit, currency)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      {group.group === 'Material' ? (
        <p className="text-sm text-ink-secondary">
          Calculated material is priced at the landed cost of the lots on hand
          today; the runs consumed the lots of their own day. The gap between
          the two columns is real cost movement, not an error.
        </p>
      ) : null}
    </div>
  )
}

/** Calculated vs actual by cost group, each group opening to its BOM lines. */
function CostGroupBridge({
  analysis,
  bom,
  unit,
}: {
  analysis: ProductionVarianceAnalysis
  bom: ProductionBom
  unit: string
}) {
  const [open, setOpen] = useState<Set<string>>(new Set())
  const currency = analysis.currency
  const maxAbs = Math.max(
    ...analysis.bridge.map((b) => Math.abs(b.variance)),
    0.0001,
  )

  const toggle = (group: string) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(group)) next.delete(group)
      else next.add(group)
      return next
    })

  return (
    <div className="border border-stroke">
      <table className="f-grid" style={{ tableLayout: 'fixed' }}>
        <colgroup>
          <col style={{ width: '30px' }} />
          <col style={{ width: '170px' }} />
          <col style={{ width: '130px' }} />
          <col style={{ width: '130px' }} />
          <col style={{ width: '110px' }} />
          <col style={{ width: '100px' }} />
          <col />
        </colgroup>
        <thead>
          <tr>
            <th>
              <span className="sr-only">Expand</span>
            </th>
            <th className="text-left">Cost group</th>
            <th className="text-right" title="Today's BOM and route, per unit">
              Calculated / {unit}
            </th>
            <th
              className="text-right"
              title="Quantity-weighted average of the posted runs, per unit"
            >
              Actual runs / {unit}
            </th>
            <th className="text-right">Variance</th>
            <th className="text-right">Variance %</th>
            <th className="text-left">
              <span className="sr-only">Relative size</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {analysis.bridge.map((b) => {
            const expanded = open.has(b.group)
            const Chevron = expanded ? IconChevronDown : IconChevronRight
            return (
              <Fragment key={b.group}>
                <tr>
                  <td>
                    <button
                      type="button"
                      onClick={() => toggle(b.group)}
                      aria-expanded={expanded}
                      aria-label={`${expanded ? 'Collapse' : 'Expand'} ${b.label}`}
                      className="flex h-5 w-5 items-center justify-center text-ink-secondary hover:text-brand"
                    >
                      <Chevron className="h-3.5 w-3.5" />
                    </button>
                  </td>
                  <td className="font-semibold">{b.label}</td>
                  <td className="f-num">{money(b.calculated, currency)}</td>
                  <td className="f-num">{money(b.actual, currency)}</td>
                  <td className={`f-num font-semibold ${varianceTone(b.variance)}`}>
                    {signedMoney(b.variance, currency)}
                  </td>
                  <td className={`f-num ${varianceTone(b.variance)}`}>
                    {b.calculated !== 0 ? signedPercent(b.variancePct) : '—'}
                  </td>
                  <td>
                    <DivergingBar delta={b.variance} maxAbs={maxAbs} />
                  </td>
                </tr>
                {expanded ? (
                  <tr>
                    <td colSpan={7} className="!bg-[#FAF9F8] !p-0">
                      <div className="border-l-[3px] border-brand px-3 py-2">
                        <GroupDrilldown group={b} bom={bom} />
                      </div>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            )
          })}
          <tr>
            <td />
            <td className="font-semibold">Total</td>
            <td className="f-num font-semibold">
              {money(analysis.calculatedTotal, currency)}
            </td>
            <td className="f-num font-semibold">
              {money(analysis.baselineTotal, currency)}
            </td>
            <td
              className={`f-num font-semibold ${varianceTone(analysis.bridgeVariance)}`}
            >
              {signedMoney(analysis.bridgeVariance, currency)}
            </td>
            <td className={`f-num ${varianceTone(analysis.bridgeVariance)}`}>
              {signedPercent(analysis.bridgeVariancePct)}
            </td>
            <td />
          </tr>
        </tbody>
      </table>
    </div>
  )
}

/** Expanded run row: this run against its cohort and the calculation, by group. */
function RunBreakdown({
  v,
  analysis,
  unit,
}: {
  v: RunVariance
  analysis: ProductionVarianceAnalysis
  unit: string
}) {
  const currency = analysis.currency
  const maxAbs = Math.max(...v.causes.map((c) => Math.abs(c.delta)), 0.0001)
  const calculatedOf: Record<string, number> = Object.fromEntries(
    analysis.bridge.map((b) => [b.group, b.calculated]),
  )

  return (
    <div>
      <div className="mb-1 text-sm font-semibold text-ink">
        Run {v.row.purchaseOrderNumber} · {shortDate(v.row.receiptDate)} ·{' '}
        {qty(v.row.quantityReceived)} {unit}
      </div>

      {v.row.sourceBatchNumber ? (
        <p className="mb-2 text-sm text-ink-secondary">
          Material was drawn from batch{' '}
          <span className="font-semibold text-ink">{v.row.sourceBatchNumber}</span>{' '}
          of {v.row.sourceItemNumber} at that lot's actual landed cost — under
          batch actual costing, the material line below is that lot's price, not
          a standard.
        </p>
      ) : null}

      <table className="w-full max-w-[860px] border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            <th className="border-b border-stroke py-1 pr-4 text-left font-semibold">
              Cost group
            </th>
            <th className="border-b border-stroke py-1 pr-4 text-right font-semibold">
              This run / {unit}
            </th>
            <th className="border-b border-stroke py-1 pr-4 text-right font-semibold">
              Runs average
            </th>
            <th className="border-b border-stroke py-1 pr-4 text-right font-semibold">
              Calculated
            </th>
            <th className="border-b border-stroke py-1 pr-4 text-right font-semibold">
              Δ vs average
            </th>
            <th className="border-b border-stroke py-1 text-left font-semibold">
              <span className="sr-only">Relative size</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {v.causes.map((c) => (
            <tr key={c.key}>
              <td className="border-b border-stroke-subtle py-1 pr-4">
                {c.label}
              </td>
              <td className="border-b border-stroke-subtle py-1 pr-4 text-right tabular-nums">
                {money(c.amount, currency)}
              </td>
              <td className="border-b border-stroke-subtle py-1 pr-4 text-right tabular-nums text-ink-secondary">
                {money(c.baseline, currency)}
              </td>
              <td className="border-b border-stroke-subtle py-1 pr-4 text-right tabular-nums text-ink-secondary">
                {money(calculatedOf[c.key] ?? 0, currency)}
              </td>
              <td
                className={`border-b border-stroke-subtle py-1 pr-4 text-right font-semibold tabular-nums ${varianceTone(c.delta)}`}
              >
                {signedMoney(c.delta, currency)}
              </td>
              <td className="border-b border-stroke-subtle py-1">
                <DivergingBar delta={c.delta} maxAbs={maxAbs} />
              </td>
            </tr>
          ))}
          <tr>
            <td className="py-1 pr-4 font-semibold">Total</td>
            <td className="py-1 pr-4 text-right font-semibold tabular-nums">
              {money(v.total, currency)}
            </td>
            <td className="py-1 pr-4 text-right font-semibold tabular-nums text-ink-secondary">
              {money(analysis.baselineTotal, currency)}
            </td>
            <td className="py-1 pr-4 text-right font-semibold tabular-nums text-ink-secondary">
              {money(analysis.calculatedTotal, currency)}
            </td>
            <td
              className={`py-1 pr-4 text-right font-semibold tabular-nums ${varianceTone(v.variance)}`}
            >
              {signedMoney(v.variance, currency)}
            </td>
            <td className="py-1" />
          </tr>
        </tbody>
      </table>
    </div>
  )
}

export function ProductionVariancePanel({
  analysis,
  bom,
  unit,
  tolerancePct,
  onToleranceChange,
}: {
  analysis: ProductionVarianceAnalysis
  bom: ProductionBom
  unit: string
  tolerancePct: number
  onToleranceChange: (pct: number) => void
}) {
  const currency = analysis.currency
  const worstBridge = [...analysis.bridge].sort(
    (a, b) => Math.abs(b.variance) - Math.abs(a.variance),
  )[0]

  const columns = useMemo<Column<RunVariance>[]>(
    () => [
      {
        key: 'order',
        header: 'Production order',
        width: '120px',
        sortValue: (v) => v.row.purchaseOrderNumber,
        render: (v) => v.row.purchaseOrderNumber,
      },
      {
        key: 'date',
        header: 'Reported date',
        width: '105px',
        sortValue: (v) => v.row.receiptDate,
        render: (v) => shortDate(v.row.receiptDate),
      },
      {
        key: 'batch',
        header: 'Batch',
        width: '115px',
        sortValue: (v) => v.row.batchNumber ?? '',
        render: (v) => v.row.batchNumber ?? '—',
      },
      {
        key: 'qty',
        header: 'Quantity',
        width: '90px',
        align: 'right',
        sortValue: (v) => v.row.quantityReceived,
        render: (v) => qty(v.row.quantityReceived),
      },
      {
        key: 'actual',
        header: 'Actual cost',
        headerTitle: 'Per unit: consumed material plus conversion',
        width: '95px',
        align: 'right',
        sortValue: (v) => v.total,
        render: (v) => (
          <span className="font-semibold">{money(v.total, currency)}</span>
        ),
      },
      {
        key: 'baseline',
        header: 'Runs average',
        headerTitle: 'Quantity-weighted average cost of all posted runs',
        width: '105px',
        align: 'right',
        sortValue: () => analysis.baselineTotal,
        render: () => (
          <span className="text-ink-secondary">
            {money(analysis.baselineTotal, currency)}
          </span>
        ),
      },
      {
        key: 'var',
        header: 'Variance',
        width: '90px',
        align: 'right',
        sortValue: (v) => v.variance,
        render: (v) => (
          <span className={`font-semibold ${varianceTone(v.variance)}`}>
            {signedMoney(v.variance, currency)}
          </span>
        ),
      },
      {
        key: 'varPct',
        header: 'Variance %',
        width: '95px',
        align: 'right',
        sortValue: (v) => v.variancePct,
        render: (v) => (
          <span className={varianceTone(v.variance)}>
            {signedPercent(v.variancePct)}
          </span>
        ),
      },
      {
        key: 'dir',
        header: 'Direction',
        width: '85px',
        sortValue: (v) => v.direction,
        render: (v) => <DirectionPill direction={v.direction} />,
      },
      {
        key: 'drivers',
        header: 'Variance drivers',
        headerTitle:
          'Cost groups that moved this run away from the cohort, largest first. Expand the row for the full decomposition.',
        render: (v) => <DriverChips drivers={v.drivers} currency={currency} />,
      },
    ],
    [currency, analysis.baselineTotal],
  )

  return (
    <div className="space-y-4">
      <div>
        <div className="mb-1 flex items-baseline gap-2">
          <h3 className="text-md font-semibold text-ink">
            Calculated cost vs posted runs
          </h3>
          <span className="text-sm text-ink-secondary">
            by cost group · expand a group to see the component and operation
            lines behind it
          </span>
        </div>
        <CostGroupBridge analysis={analysis} bom={bom} unit={unit} />
      </div>

      <div>
        <div className="mb-2 flex flex-wrap items-end gap-4">
          <div className="min-w-[260px] max-w-[860px] flex-1">
            <h3 className="text-md font-semibold text-ink">
              Runs outside tolerance
            </h3>
            <p className="text-base text-ink-secondary">
              Measured against the runs' own quantity-weighted average of{' '}
              {money(analysis.baselineTotal, currency)} per {unit} — a run
              flagged here left its cohort, which is a different question from
              the calculated-cost bridge above.
            </p>
          </div>
          <ToleranceField
            tolerancePct={tolerancePct}
            onToleranceChange={onToleranceChange}
          />
        </div>

        <div className="mb-2 grid grid-cols-2 gap-2 lg:grid-cols-4">
          <VarianceStatTile
            label="Posted runs"
            value={String(analysis.runs.length)}
          />
          <VarianceStatTile
            label="Within tolerance"
            value={`${analysis.runs.length - analysis.flagged.length} of ${analysis.runs.length}`}
          />
          <VarianceStatTile
            label={`Above +${tolerancePct}%`}
            value={String(analysis.aboveCount)}
            tone={analysis.aboveCount > 0 ? 'text-status-bad' : undefined}
          />
          <VarianceStatTile
            label="Largest group movement"
            value={
              worstBridge
                ? `${worstBridge.label} ${signedMoney(worstBridge.variance, currency)}`
                : '—'
            }
            tone={worstBridge ? varianceTone(worstBridge.variance) : undefined}
            hint="Biggest calculated-vs-actual gap in the bridge above"
          />
        </div>

        {analysis.flagged.length === 0 ? (
          <p className="border border-status-good/40 bg-status-goodBg px-3 py-2 text-base text-status-good">
            Every posted run sits within ±{tolerancePct}% of the cohort average.
            Tighten the tolerance to look harder.
          </p>
        ) : (
          <Grid
            columns={columns}
            rows={analysis.flagged}
            getRowId={(v) => v.row.id}
            renderDetail={(v) => (
              <RunBreakdown v={v} analysis={analysis} unit={unit} />
            )}
            emptyMessage="No runs are outside the tolerance band."
            maxHeight="380px"
          />
        )}
      </div>
    </div>
  )
}

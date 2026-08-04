import { useMemo } from 'react'
import type { PlannedRun } from '../types/production'
import { Grid, type Column } from './d365/Grid'
import {
  money,
  moneyPrecise,
  percent,
  qty,
  qtyPrecise,
  shortDate,
} from '../lib/format'

/**
 * The proposed production plan: one row per run, in the order the lines would
 * actually make them.
 *
 * The column that matters is "Cost per unit". It differs run to run even on the
 * same line making the same item, because each run is costed at the actual
 * landed cost of the specific lot it consumes. Expand a row to see that lot.
 */

function marginTone(fraction: number): string {
  if (fraction >= 0.3) return 'text-status-good'
  if (fraction >= 0.15) return 'text-status-warn'
  return 'text-status-bad'
}

/** How much room the run leaves before its driving lot expires. */
function SlackCell({ run }: { run: PlannedRun }) {
  const tone =
    run.slackDays <= 0
      ? 'text-status-bad font-semibold'
      : run.slackDays <= 2
        ? 'text-status-warn font-semibold'
        : 'text-ink'
  return (
    <span
      className={tone}
      title={`Driving batch ${run.drivingBatchNumber} expires ${shortDate(run.drivingBatchExpiry)}`}
    >
      {run.slackDays === 0 ? 'Last day' : `${qty(run.slackDays)} d`}
    </span>
  )
}

function RunDetail({ run }: { run: PlannedRun }) {
  return (
    <div>
      <div className="mb-1 text-sm font-semibold text-ink">
        Material for run {run.sequence} — {qty(run.quantity)} {run.unit} on{' '}
        {run.lineId} {run.lineName}, {shortDate(run.startDate)}
      </div>
      <p className="mb-2 text-sm text-ink-secondary">
        Consumed first-expired-first-out. Batch-tracked components are drawn from
        named lots and costed at what those lots actually landed at; the rest are
        priced from the item cost record.
      </p>

      <table className="w-full max-w-[1000px] border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            <th className="border-b border-stroke py-1 pr-4 text-left font-semibold">
              Item
            </th>
            <th className="border-b border-stroke py-1 pr-4 text-left font-semibold">
              Product name
            </th>
            <th className="border-b border-stroke py-1 pr-4 text-left font-semibold">
              Batch
            </th>
            <th className="border-b border-stroke py-1 pr-4 text-left font-semibold">
              Expires
            </th>
            <th className="border-b border-stroke py-1 pr-4 text-left font-semibold">
              Cost group
            </th>
            <th className="border-b border-stroke py-1 pr-4 text-right font-semibold">
              Quantity
            </th>
            <th className="border-b border-stroke py-1 pr-4 text-right font-semibold">
              Unit cost
            </th>
            <th className="border-b border-stroke py-1 text-right font-semibold">
              Amount
            </th>
          </tr>
        </thead>
        <tbody>
          {run.consumption.map((c, i) => (
            <tr key={`${c.itemNumber}-${c.batchNumber ?? 'na'}-${i}`}>
              <td className="border-b border-stroke-subtle py-1 pr-4 font-semibold">
                {c.itemNumber}
              </td>
              <td className="border-b border-stroke-subtle py-1 pr-4 text-ink-secondary">
                {c.productName}
              </td>
              <td className="border-b border-stroke-subtle py-1 pr-4">
                {c.batchNumber ?? (
                  <span className="text-ink-disabled">Not lot controlled</span>
                )}
              </td>
              <td className="border-b border-stroke-subtle py-1 pr-4 text-ink-secondary">
                {c.expiryDate ? shortDate(c.expiryDate) : '—'}
              </td>
              <td className="border-b border-stroke-subtle py-1 pr-4">
                {c.costGroup}
              </td>
              <td className="border-b border-stroke-subtle py-1 pr-4 text-right tabular-nums">
                {qtyPrecise(c.quantity)} {c.unit}
              </td>
              <td className="border-b border-stroke-subtle py-1 pr-4 text-right tabular-nums">
                {money(c.unitCost, run.currency)}
              </td>
              <td className="border-b border-stroke-subtle py-1 text-right tabular-nums">
                {moneyPrecise(c.extendedCost, run.currency)}
              </td>
            </tr>
          ))}

          <tr>
            <td colSpan={5} className="py-1 pr-4 text-right text-ink-secondary">
              Conversion — labour and overhead from route {run.itemNumber}
            </td>
            <td className="py-1 pr-4 text-right tabular-nums text-ink-secondary">
              {qty(run.quantity)} {run.unit}
            </td>
            <td className="py-1 pr-4 text-right tabular-nums text-ink-secondary">
              {money(run.conversionCostPerUnit, run.currency)}
            </td>
            <td className="py-1 text-right tabular-nums text-ink-secondary">
              {money(run.conversionCostPerUnit * run.quantity, run.currency)}
            </td>
          </tr>

          <tr>
            <td colSpan={6} className="py-1 pr-4 text-right font-semibold">
              Total run cost
            </td>
            <td className="py-1 pr-4 text-right font-semibold tabular-nums">
              {money(run.totalCostPerUnit, run.currency)}
            </td>
            <td className="py-1 text-right font-semibold tabular-nums">
              {money(run.extendedCost, run.currency)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

export function ProductionPlanGrid({
  runs,
  loading,
  selectedId,
  onSelect,
}: {
  runs: PlannedRun[]
  loading?: boolean
  selectedId?: string | null
  onSelect?: (id: string) => void
}) {
  const columns = useMemo<Column<PlannedRun>[]>(
    () => [
      {
        key: 'seq',
        header: '#',
        width: '44px',
        align: 'right',
        sortValue: (r) => r.sequence,
        render: (r) => r.sequence,
      },
      {
        key: 'date',
        header: 'Run date',
        width: '98px',
        sortValue: (r) => r.startDate,
        render: (r) => shortDate(r.startDate),
      },
      {
        key: 'line',
        header: 'Production line',
        width: '190px',
        sortValue: (r) => r.lineId,
        render: (r) => (
          <span className="block truncate" title={r.lineName}>
            <span className="font-semibold">{r.lineId}</span>
            <span className="ml-1 text-ink-secondary">{r.lineName}</span>
          </span>
        ),
      },
      {
        key: 'site',
        header: 'Site',
        width: '50px',
        sortValue: (r) => r.siteId,
        render: (r) => r.siteId,
      },
      {
        key: 'qty',
        header: 'Quantity',
        width: '92px',
        align: 'right',
        sortValue: (r) => r.quantity,
        render: (r) => <span className="font-semibold">{qty(r.quantity)}</span>,
      },
      {
        key: 'hours',
        header: 'Hours',
        headerTitle: 'Setup plus run time on the line',
        width: '72px',
        align: 'right',
        sortValue: (r) => r.runHours,
        render: (r) => r.runHours.toFixed(2),
      },
      {
        key: 'batch',
        header: 'Driving batch',
        headerTitle:
          'The oldest-expiring lot this run consumes — the reason it is scheduled here',
        width: '128px',
        sortValue: (r) => r.drivingBatchNumber,
        render: (r) => (
          <span className="block truncate font-mono text-sm">
            {r.drivingBatchNumber}
          </span>
        ),
      },
      {
        key: 'slack',
        header: 'Slack',
        headerTitle: 'Days between the run and the driving batch expiring',
        width: '76px',
        align: 'right',
        sortValue: (r) => r.slackDays,
        render: (r) => <SlackCell run={r} />,
      },
      {
        key: 'material',
        header: 'Material',
        width: '96px',
        align: 'right',
        sortValue: (r) => r.materialCostPerUnit,
        render: (r) => money(r.materialCostPerUnit, r.currency),
      },
      {
        key: 'packaging',
        header: 'Packaging',
        width: '96px',
        align: 'right',
        sortValue: (r) => r.packagingCostPerUnit,
        render: (r) => money(r.packagingCostPerUnit, r.currency),
      },
      {
        key: 'conversion',
        header: 'Conversion',
        width: '100px',
        align: 'right',
        sortValue: (r) => r.conversionCostPerUnit,
        render: (r) => money(r.conversionCostPerUnit, r.currency),
      },
      {
        key: 'unitCost',
        header: 'Cost per unit',
        width: '106px',
        align: 'right',
        sortValue: (r) => r.totalCostPerUnit,
        render: (r) => (
          <span className="font-semibold">
            {money(r.totalCostPerUnit, r.currency)}
          </span>
        ),
      },
      {
        key: 'extended',
        header: 'Run cost',
        width: '112px',
        align: 'right',
        sortValue: (r) => r.extendedCost,
        render: (r) => money(r.extendedCost, r.currency),
      },
      {
        key: 'margin',
        header: 'Margin',
        width: '86px',
        align: 'right',
        sortValue: (r) => r.marginEstimate,
        render: (r) => (
          <span className={`font-semibold ${marginTone(r.marginEstimate)}`}>
            {percent(r.marginEstimate)}
          </span>
        ),
      },
    ],
    [],
  )

  return (
    <Grid
      columns={columns}
      rows={runs}
      getRowId={(r) => r.id}
      selectedId={selectedId}
      onSelect={onSelect}
      loading={loading}
      renderDetail={(r) => <RunDetail run={r} />}
      emptyMessage="Nothing can be planned. Check that batches are on hand and at least one line is selected."
      maxHeight="420px"
    />
  )
}

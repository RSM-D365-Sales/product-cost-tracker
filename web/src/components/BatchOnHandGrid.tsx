import { useMemo } from 'react'
import type { BatchOnHand, BatchStatus } from '../types/production'
import { Grid, type Column } from './d365/Grid'
import { money, qty, shortDate } from '../lib/format'
import { batchLink, productReceiptLink, purchaseOrderLink } from '../lib/links'

/**
 * Available batches: every lot with stock on it, in FEFO order, valued at the
 * landed cost of the receipt that created it.
 *
 * This is the join the two pages are built around. The cost on each row is not
 * a standard and not an average — it is the landed cost the product cost
 * inquiry reported for that exact receipt, which is why the same item shows a
 * different cost on every line.
 */

const STATUS_STYLE: Record<BatchStatus, string> = {
  Available: 'border-status-good/40 bg-status-goodBg text-status-good',
  Expiring: 'border-status-warn/40 bg-status-warnBg text-status-warn',
  Expired: 'border-status-bad/40 bg-status-badBg text-status-bad',
}

function StatusPill({ batch }: { batch: BatchOnHand }) {
  return (
    <span
      className={`inline-block border px-[5px] py-px text-2xs uppercase tracking-wide ${STATUS_STYLE[batch.status]}`}
    >
      {batch.status}
    </span>
  )
}

/** Days remaining, coloured the way a warehouse board would colour them. */
function ExpiryCell({ batch }: { batch: BatchOnHand }) {
  const days = batch.daysToExpiry
  const tone =
    days < 0
      ? 'text-status-bad font-semibold'
      : days <= 2
        ? 'text-status-bad font-semibold'
        : days <= 7
          ? 'text-status-warn font-semibold'
          : 'text-ink'

  return (
    <span className={tone}>
      {days < 0
        ? `${Math.abs(days)} d ago`
        : days === 0
          ? 'Today'
          : `${qty(days)} d`}
    </span>
  )
}

export function BatchOnHandGrid({
  batches,
  loading,
  selectedId,
  onSelect,
}: {
  batches: BatchOnHand[]
  loading?: boolean
  selectedId?: string | null
  onSelect?: (id: string) => void
}) {
  const columns = useMemo<Column<BatchOnHand>[]>(
    () => [
      {
        key: 'item',
        header: 'Item',
        width: '84px',
        sortValue: (r) => r.itemNumber,
        render: (r) => r.itemNumber,
      },
      {
        key: 'batch',
        header: 'Batch number',
        width: '128px',
        sortValue: (r) => r.batchNumber,
        render: (r) => {
          const href = batchLink(r.itemNumber, r.batchNumber)
          return href ? (
            <a className="f-link truncate" href={href} target="_blank" rel="noreferrer">
              {r.batchNumber}
            </a>
          ) : (
            <span className="truncate font-mono text-sm">{r.batchNumber}</span>
          )
        },
      },
      {
        key: 'name',
        header: 'Product name',
        sortValue: (r) => r.productName,
        render: (r) => (
          <span className="block truncate" title={r.productName}>
            {r.productName}
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
        key: 'whs',
        header: 'Whs.',
        width: '54px',
        sortValue: (r) => r.warehouseId,
        render: (r) => r.warehouseId,
      },
      {
        key: 'loc',
        header: 'Location',
        width: '80px',
        sortValue: (r) => r.locationId ?? '',
        render: (r) => r.locationId ?? '—',
      },
      {
        key: 'qty',
        header: 'On hand',
        width: '96px',
        align: 'right',
        sortValue: (r) => r.quantity,
        render: (r) => (
          <span className="font-semibold">{qty(r.quantity)}</span>
        ),
      },
      {
        key: 'unit',
        header: 'Unit',
        width: '50px',
        render: (r) => r.unit,
      },
      {
        key: 'received',
        header: 'Received',
        width: '95px',
        sortValue: (r) => r.receiptDate,
        render: (r) => shortDate(r.receiptDate),
      },
      {
        key: 'expiry',
        header: 'Expiry date',
        width: '100px',
        sortValue: (r) => r.expiryDate,
        render: (r) => shortDate(r.expiryDate),
      },
      {
        key: 'days',
        header: 'Shelf life left',
        width: '100px',
        align: 'right',
        sortValue: (r) => r.daysToExpiry,
        render: (r) => <ExpiryCell batch={r} />,
      },
      {
        key: 'status',
        header: 'Status',
        width: '92px',
        sortValue: (r) => r.status,
        render: (r) => <StatusPill batch={r} />,
      },
      {
        key: 'cost',
        header: 'Landed cost',
        headerTitle:
          'Per unit, from the product receipt that created this batch — not a standard cost',
        width: '104px',
        align: 'right',
        sortValue: (r) => r.landedCost,
        render: (r) => (
          <span className="font-semibold">{money(r.landedCost, r.currency)}</span>
        ),
      },
      {
        key: 'value',
        header: 'Inventory value',
        width: '118px',
        align: 'right',
        sortValue: (r) => r.inventoryValue,
        render: (r) => money(r.inventoryValue, r.currency),
      },
      {
        key: 'source',
        header: 'Created by',
        width: '150px',
        sortValue: (r) => r.receiptNumber,
        render: (r) => {
          const href =
            r.sourceType === 'Production'
              ? null
              : productReceiptLink(r.receiptNumber)
          const orderHref =
            r.sourceType === 'Production' ? null : purchaseOrderLink(r.orderNumber)
          return (
            <span className="block truncate" title={`${r.orderNumber} · ${r.receiptNumber}`}>
              {href ? (
                <a className="f-link" href={href} target="_blank" rel="noreferrer">
                  {r.receiptNumber}
                </a>
              ) : (
                r.receiptNumber
              )}
              <span className="ml-1 text-ink-secondary">
                {orderHref ? (
                  <a className="f-link" href={orderHref} target="_blank" rel="noreferrer">
                    {r.orderNumber}
                  </a>
                ) : (
                  r.orderNumber
                )}
              </span>
            </span>
          )
        },
      },
    ],
    [],
  )

  return (
    <Grid
      columns={columns}
      rows={batches}
      getRowId={(r) => r.id}
      selectedId={selectedId}
      onSelect={onSelect}
      loading={loading}
      emptyMessage="No batch-tracked stock is on hand for this item's components."
      maxHeight="360px"
    />
  )
}

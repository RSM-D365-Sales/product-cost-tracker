import { useMemo } from 'react'
import type { ReceiptRow } from '../types/domain'
import { Grid, type Column } from './d365/Grid'
import { ChargeDetail } from './ChargeDetail'
import { money, percent, qty, shortDate } from '../lib/format'
import {
  productReceiptLink,
  productionOrderLink,
  purchaseOrderLink,
  releasedProductLink,
} from '../lib/links'

/** Renders as an anchor when deep links are configured, plain text otherwise. */
function DrillLink({ value, href }: { value: string; href: string | null }) {
  if (!href) return <span className="truncate">{value}</span>
  return (
    <a
      className="f-link truncate"
      href={href}
      target="_blank"
      rel="noreferrer"
      title={`Open ${value} in Finance and Operations`}
    >
      {value}
    </a>
  )
}

/** Absent sourceType means a purchase — see ReceiptRow. */
const isProduction = (r: ReceiptRow): boolean => r.sourceType === 'Production'

function marginTone(fraction: number): string {
  if (fraction >= 0.3) return 'text-status-good'
  if (fraction >= 0.15) return 'text-status-warn'
  return 'text-status-bad'
}

export function ReceiptGrid({
  rows,
  loading,
  selectedId,
  onSelect,
}: {
  rows: ReceiptRow[]
  loading: boolean
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const columns = useMemo<Column<ReceiptRow>[]>(
    () => [
      {
        key: 'po',
        header: 'Order',
        headerTitle:
          'Purchase order for received items, production order for manufactured items',
        width: '110px',
        sortValue: (r) => r.purchaseOrderNumber,
        render: (r) => (
          <DrillLink
            value={r.purchaseOrderNumber}
            href={
              isProduction(r)
                ? productionOrderLink(r.purchaseOrderNumber)
                : purchaseOrderLink(r.purchaseOrderNumber)
            }
          />
        ),
      },
      {
        key: 'receipt',
        header: 'Receipt number',
        headerTitle:
          'Product receipt for purchases, report-as-finished journal for production',
        width: '120px',
        sortValue: (r) => r.receiptNumber,
        render: (r) => (
          <DrillLink
            value={r.receiptNumber}
            href={isProduction(r) ? null : productReceiptLink(r.receiptNumber)}
          />
        ),
      },
      {
        key: 'item',
        header: 'Item',
        width: '90px',
        sortValue: (r) => r.itemNumber,
        render: (r) => (
          <DrillLink
            value={r.itemNumber}
            href={releasedProductLink(r.itemNumber)}
          />
        ),
      },
      {
        key: 'date',
        header: 'Receipt date',
        width: '105px',
        sortValue: (r) => r.receiptDate,
        render: (r) => shortDate(r.receiptDate),
      },
      {
        key: 'vendor',
        header: 'Vendor',
        width: '150px',
        sortValue: (r) => (isProduction(r) ? '' : r.vendorAccount),
        render: (r) =>
          isProduction(r) ? (
            <span
              className="block truncate text-ink-secondary"
              title="Manufactured in house — no vendor"
            >
              Produced
            </span>
          ) : (
            <span className="block truncate" title={r.vendorName}>
              {r.vendorAccount}
              <span className="ml-1 text-ink-secondary">{r.vendorName}</span>
            </span>
          ),
      },
      {
        key: 'site',
        header: 'Site',
        width: '55px',
        sortValue: (r) => r.siteId,
        render: (r) => r.siteId,
      },
      {
        key: 'whs',
        header: 'Whs.',
        width: '58px',
        sortValue: (r) => r.warehouseId,
        render: (r) => r.warehouseId,
      },
      {
        key: 'qty',
        header: 'Quantity received',
        width: '120px',
        align: 'right',
        sortValue: (r) => r.quantityReceived,
        render: (r) => qty(r.quantityReceived),
      },
      {
        key: 'fob',
        header: 'Purchase / material',
        headerTitle:
          'Per unit, goods only. Purchased: FOB price excluding charges. Produced: BOM material cost at the consumed batch’s actual cost.',
        width: '138px',
        align: 'right',
        sortValue: (r) => r.purchasePriceFob,
        render: (r) => money(r.purchasePriceFob, r.currency),
      },
      {
        key: 'aoc',
        header: 'Charges / conversion',
        headerTitle:
          'Per unit. Purchased: allocated add-on charges. Produced: conversion cost. Expand the row for the breakdown.',
        width: '150px',
        align: 'right',
        sortValue: (r) => r.financialChargesAoc,
        render: (r) => money(r.financialChargesAoc, r.currency),
      },
      {
        key: 'landed',
        header: 'Landed cost',
        width: '110px',
        align: 'right',
        sortValue: (r) => r.landedCost,
        render: (r) => (
          <span className="font-semibold">{money(r.landedCost, r.currency)}</span>
        ),
      },
      {
        key: 'sell',
        header: 'Selling price',
        width: '105px',
        align: 'right',
        sortValue: (r) => r.sellingPrice,
        render: (r) => money(r.sellingPrice, r.currency),
      },
      {
        key: 'margin',
        header: 'Margin estimate',
        width: '110px',
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
      rows={rows}
      getRowId={(r) => r.id}
      selectedId={selectedId}
      onSelect={onSelect}
      loading={loading}
      renderDetail={(r) => <ChargeDetail row={r} />}
      emptyMessage="Enter an item number and select Run to retrieve product receipts."
      maxHeight="480px"
    />
  )
}

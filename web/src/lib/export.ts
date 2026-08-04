import type { ProductCostResult } from '../types/domain'
import type { ProductionCostResult } from '../types/production'

/**
 * "Open in Microsoft Office > Export to Excel" equivalent. Emits CSV with a
 * UTF-8 BOM so Excel on Windows reads the currency symbols correctly, and
 * quotes every field so item descriptions with commas survive the round trip.
 */

function csvCell(value: unknown): string {
  const s = value == null ? '' : String(value)
  return `"${s.replace(/"/g, '""')}"`
}

const HEADERS = [
  'Source',
  'Order',
  'Receipt number',
  'Item number',
  'Product name',
  'Receipt date',
  'Vendor account',
  'Vendor name',
  'Site',
  'Warehouse',
  'Location',
  'Batch',
  'Consumed item',
  'Consumed batch',
  'Quantity received',
  'Unit',
  'Currency',
  'Purchase / material cost',
  'Charges / conversion',
  'Landed cost',
  'Selling price',
  'Margin estimate',
]

export function toCsv(result: ProductCostResult): string {
  const lines: string[] = [HEADERS.map(csvCell).join(',')]

  for (const r of result.rows) {
    lines.push(
      [
        r.sourceType ?? 'Purchase',
        r.purchaseOrderNumber,
        r.receiptNumber,
        r.itemNumber,
        r.productName,
        r.receiptDate.slice(0, 10),
        r.vendorAccount,
        r.vendorName,
        r.siteId,
        r.warehouseId,
        r.locationId ?? '',
        r.batchNumber ?? '',
        r.sourceItemNumber ?? '',
        r.sourceBatchNumber ?? '',
        r.quantityReceived,
        r.unit,
        r.currency,
        r.purchasePriceFob.toFixed(2),
        r.financialChargesAoc.toFixed(2),
        r.landedCost.toFixed(2),
        r.sellingPrice.toFixed(2),
        // Written as a decimal fraction so Excel can format it as a percentage.
        r.marginEstimate.toFixed(4),
      ]
        .map(csvCell)
        .join(','),
    )
  }

  return lines.join('\r\n')
}

function download(csv: string, filename: string): void {
  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export function downloadCsv(result: ProductCostResult): void {
  download(
    toCsv(result),
    `ProductCostInquiry_${result.item.itemNumber}_${result.rows.length}rows.csv`,
  )
}

/**
 * The production plan, one row per consumed lot rather than one per run, so the
 * export is the traceable version: every line says which batch went into which
 * run at what cost. Summing the Amount column reproduces the total plan cost.
 */
const PLAN_HEADERS = [
  'Run',
  'Run date',
  'Line',
  'Line name',
  'Site',
  'Warehouse',
  'Finished item',
  'Run quantity',
  'Unit',
  'Run hours',
  'Driving batch',
  'Driving batch expiry',
  'Slack days',
  'Component item',
  'Component name',
  'Component batch',
  'Component expiry',
  'Cost group',
  'Component quantity',
  'Component unit',
  'Component unit cost',
  'Amount',
  'Run cost per unit',
  'Run margin',
]

export function planToCsv(result: ProductionCostResult): string {
  const lines: string[] = [PLAN_HEADERS.map(csvCell).join(',')]

  for (const run of result.plan) {
    const rows: (string | number)[][] = run.consumption.map((c) => [
      c.itemNumber,
      c.productName,
      c.batchNumber ?? '',
      c.expiryDate ?? '',
      c.costGroup,
      c.quantity.toFixed(4),
      c.unit,
      c.unitCost.toFixed(4),
      c.extendedCost.toFixed(2),
    ])

    // Conversion has no component behind it, so it gets a line of its own —
    // otherwise the Amount column would not sum back to the run cost.
    rows.push([
      run.itemNumber,
      'Labour and overhead (route)',
      '',
      '',
      'Conversion',
      run.quantity.toFixed(4),
      run.unit,
      run.conversionCostPerUnit.toFixed(4),
      (run.conversionCostPerUnit * run.quantity).toFixed(2),
    ])

    for (const detail of rows) {
      lines.push(
        [
          run.sequence,
          run.startDate,
          run.lineId,
          run.lineName,
          run.siteId,
          run.warehouseId,
          run.itemNumber,
          run.quantity,
          run.unit,
          run.runHours.toFixed(3),
          run.drivingBatchNumber,
          run.drivingBatchExpiry,
          run.slackDays,
          ...detail,
          run.totalCostPerUnit.toFixed(4),
          run.marginEstimate.toFixed(4),
        ]
          .map(csvCell)
          .join(','),
      )
    }
  }

  return lines.join('\r\n')
}

export function downloadPlanCsv(result: ProductionCostResult): void {
  download(
    planToCsv(result),
    `ProductionPlan_${result.item.itemNumber}_${result.plan.length}runs.csv`,
  )
}

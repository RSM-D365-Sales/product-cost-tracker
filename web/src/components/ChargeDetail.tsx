import type { ReceiptRow } from '../types/domain'
import { money, qty } from '../lib/format'

/**
 * Expanded row content: the individual charges that make up the add-on cost.
 *
 * This is the part a standard OData grid can't show without the join, and it's
 * where a controller sees *why* two receipts of the same item at the same FOB
 * price landed at different costs.
 */
export function ChargeDetail({ row }: { row: ReceiptRow }) {
  const produced = row.sourceType === 'Production'

  if (row.charges.length === 0) {
    return (
      <p className="text-sm text-ink-secondary">
        No charges were posted against this receipt line. Landed cost equals the
        purchase price.
      </p>
    )
  }

  const extendedTotal = row.charges.reduce((s, c) => s + c.amount, 0)

  return (
    <div>
      <div className="mb-1 text-sm font-semibold text-ink">
        {produced ? 'Conversion cost' : 'Charges'} — {row.purchaseOrderNumber} /{' '}
        {row.receiptNumber} · line {row.purchaseLineNumber}
      </div>

      {/* Under batch actual costing the material cost is not a standard — it is
          whatever the consumed batch actually cost, which is the whole reason
          two identical production runs come out at different landed costs. */}
      {produced && row.sourceBatchNumber ? (
        <p className="mb-2 text-sm text-ink-secondary">
          Material {money(row.purchasePriceFob, row.currency)} per {row.unit} —
          consumed batch{' '}
          <span className="font-semibold text-ink">{row.sourceBatchNumber}</span>{' '}
          of {row.sourceItemNumber} at its actual landed cost.
        </p>
      ) : null}

      <table className="w-full max-w-[900px] border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            <th className="border-b border-stroke py-1 pr-4 text-left font-semibold">
              Charge code
            </th>
            <th className="border-b border-stroke py-1 pr-4 text-left font-semibold">
              Description
            </th>
            <th className="border-b border-stroke py-1 pr-4 text-left font-semibold">
              Source
            </th>
            <th className="border-b border-stroke py-1 pr-4 text-left font-semibold">
              Allocation
            </th>
            <th className="border-b border-stroke py-1 pr-4 text-right font-semibold">
              Amount
            </th>
            <th className="border-b border-stroke py-1 text-right font-semibold">
              Per unit
            </th>
          </tr>
        </thead>
        <tbody>
          {row.charges.map((ch) => (
            <tr key={`${ch.source}-${ch.chargeCode}`}>
              <td className="border-b border-stroke-subtle py-1 pr-4 font-semibold">
                {ch.chargeCode}
              </td>
              <td className="border-b border-stroke-subtle py-1 pr-4 text-ink-secondary">
                {ch.description}
              </td>
              <td className="border-b border-stroke-subtle py-1 pr-4">
                {ch.source}
              </td>
              <td className="border-b border-stroke-subtle py-1 pr-4 text-ink-secondary">
                {ch.allocationMethod ?? '—'}
              </td>
              <td className="border-b border-stroke-subtle py-1 pr-4 text-right tabular-nums">
                {money(ch.amount, row.currency)}
              </td>
              <td className="border-b border-stroke-subtle py-1 text-right tabular-nums">
                {money(ch.amountPerUnit, row.currency)}
              </td>
            </tr>
          ))}

          <tr>
            <td colSpan={4} className="py-1 pr-4 text-right font-semibold">
              Total {produced ? 'conversion' : 'add-on'} cost over{' '}
              {qty(row.quantityReceived)} {row.unit}
            </td>
            <td className="py-1 pr-4 text-right font-semibold tabular-nums">
              {money(extendedTotal, row.currency)}
            </td>
            <td className="py-1 text-right font-semibold tabular-nums">
              {money(row.financialChargesAoc, row.currency)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

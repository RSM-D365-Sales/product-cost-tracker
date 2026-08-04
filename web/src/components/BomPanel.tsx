import { useMemo } from 'react'
import type {
  BomComponentLine,
  ProductionBom,
  RouteOperationLine,
} from '../types/production'
import { Grid, type Column } from './d365/Grid'
import {
  money,
  moneyPrecise,
  percent,
  qty,
  qtyPrecise,
  shortDate,
} from '../lib/format'
import { releasedProductLink } from '../lib/links'

/**
 * The bill of material and the route, costed.
 *
 * Two grids rather than one, because they are two different records in D365 and
 * conflating them hides which half of the cost you can actually negotiate: the
 * BOM is what you buy, the route is what you do.
 */

function CostBasisTag({ line }: { line: BomComponentLine }) {
  const onHand = line.costBasis === 'On-hand average'
  return (
    <span
      className={[
        'inline-block border px-[5px] py-px text-2xs uppercase tracking-wide',
        onHand
          ? 'border-brand/30 bg-brand-tint text-brand'
          : 'border-stroke bg-[#F3F2F1] text-ink-secondary',
      ].join(' ')}
      title={
        onHand
          ? 'Priced at the quantity-weighted landed cost of the batches on hand'
          : 'Priced from the item cost record — this component is not lot controlled'
      }
    >
      {line.costBasis}
    </span>
  )
}

export function BomPanel({
  bom,
  onOpenItem,
}: {
  bom: ProductionBom
  /** Drills a component through to the product cost inquiry. */
  onOpenItem?: (itemNumber: string) => void
}) {
  const c = bom.currency

  const componentColumns = useMemo<Column<BomComponentLine>[]>(
    () => [
      {
        key: 'line',
        header: 'Line',
        width: '60px',
        align: 'right',
        sortValue: (r) => r.lineNumber,
        render: (r) => r.lineNumber,
      },
      {
        key: 'item',
        header: 'Item',
        width: '92px',
        sortValue: (r) => r.itemNumber,
        render: (r) =>
          onOpenItem && r.batchTracked ? (
            <button
              type="button"
              className="f-link truncate"
              onClick={() => onOpenItem(r.itemNumber)}
              title={`Open ${r.itemNumber} in the product cost inquiry`}
            >
              {r.itemNumber}
            </button>
          ) : releasedProductLink(r.itemNumber) ? (
            <a
              className="f-link truncate"
              href={releasedProductLink(r.itemNumber)!}
              target="_blank"
              rel="noreferrer"
            >
              {r.itemNumber}
            </a>
          ) : (
            <span className="truncate">{r.itemNumber}</span>
          ),
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
        key: 'per',
        header: 'Quantity per',
        width: '100px',
        align: 'right',
        sortValue: (r) => r.quantityPer,
        render: (r) => (
          <span title={`Per one ${bom.unit} of ${bom.itemNumber}`}>
            {qtyPrecise(r.quantityPer)}
          </span>
        ),
      },
      {
        key: 'unit',
        header: 'Unit',
        width: '56px',
        render: (r) => r.unit,
      },
      {
        key: 'scrap',
        header: 'Scrap',
        width: '70px',
        align: 'right',
        sortValue: (r) => r.scrapPercent,
        render: (r) =>
          r.scrapPercent > 0 ? (
            percent(r.scrapPercent)
          ) : (
            <span className="text-ink-disabled">—</span>
          ),
      },
      {
        key: 'consumed',
        header: 'Consumed',
        headerTitle: 'Quantity per, grossed up for scrap — what is actually drawn',
        width: '92px',
        align: 'right',
        sortValue: (r) => r.quantityConsumed,
        render: (r) => qtyPrecise(r.quantityConsumed),
      },
      {
        key: 'group',
        header: 'Cost group',
        width: '95px',
        sortValue: (r) => r.costGroup,
        render: (r) => r.costGroup,
      },
      {
        key: 'unitCost',
        header: 'Unit cost',
        width: '96px',
        align: 'right',
        sortValue: (r) => r.unitCost,
        render: (r) => money(r.unitCost, c),
      },
      {
        key: 'basis',
        header: 'Cost basis',
        width: '128px',
        sortValue: (r) => r.costBasis,
        render: (r) => <CostBasisTag line={r} />,
      },
      {
        key: 'extended',
        header: `Cost per ${bom.unit}`,
        width: '104px',
        align: 'right',
        sortValue: (r) => r.extendedCost,
        render: (r) => (
          <span className="font-semibold">{moneyPrecise(r.extendedCost, c)}</span>
        ),
      },
    ],
    [bom.itemNumber, bom.unit, c, onOpenItem],
  )

  const operationColumns = useMemo<Column<RouteOperationLine>[]>(
    () => [
      {
        key: 'oper',
        header: 'Oper.',
        width: '60px',
        align: 'right',
        sortValue: (r) => r.operationNumber,
        render: (r) => r.operationNumber,
      },
      {
        key: 'desc',
        header: 'Operation',
        sortValue: (r) => r.description,
        render: (r) => (
          <span className="block truncate" title={r.description}>
            {r.description}
          </span>
        ),
      },
      {
        key: 'resource',
        header: 'Resource group',
        width: '130px',
        sortValue: (r) => r.resourceId,
        render: (r) => r.resourceId,
      },
      {
        key: 'group',
        header: 'Cost group',
        width: '95px',
        sortValue: (r) => r.costGroup,
        render: (r) => r.costGroup,
      },
      {
        key: 'cost',
        header: `Cost per ${bom.unit}`,
        width: '104px',
        align: 'right',
        sortValue: (r) => r.costPerUnit,
        render: (r) => (
          <span className="font-semibold">{money(r.costPerUnit, c)}</span>
        ),
      },
    ],
    [bom.unit, c],
  )

  const componentTotal = bom.components.reduce((s, l) => s + l.extendedCost, 0)
  const operationTotal = bom.operations.reduce((s, o) => s + o.costPerUnit, 0)

  return (
    <div className="space-y-4">
      <dl className="flex flex-wrap gap-x-8 gap-y-1 border border-stroke bg-[#FAF9F8] px-3 py-2">
        {[
          ['BOM', `${bom.bomId} · ${bom.bomVersion}`],
          ['Route', bom.routeId],
          ['Site', bom.siteId],
          ['Per series', `${qty(bom.perSeries)} ${bom.unit}`],
          ['Approved', shortDate(bom.approvedOn)],
        ].map(([label, value]) => (
          <div key={label} className="flex items-baseline gap-2">
            <dt className="text-sm text-ink-secondary">{label}</dt>
            <dd className="text-base font-semibold text-ink">{value}</dd>
          </div>
        ))}
      </dl>

      <section>
        <div className="mb-1 flex items-baseline justify-between gap-2 px-[2px]">
          <h3 className="text-md font-semibold text-ink">
            Bill of material lines
          </h3>
          <span className="text-sm text-ink-secondary">
            Material and packaging{' '}
            <span className="font-semibold tabular-nums text-ink">
              {money(componentTotal, c)}
            </span>{' '}
            per {bom.unit}
          </span>
        </div>
        <Grid
          columns={componentColumns}
          rows={bom.components}
          getRowId={(r) => `c${r.lineNumber}`}
          emptyMessage="This item has no bill of material lines."
          maxHeight="260px"
        />
      </section>

      <section>
        <div className="mb-1 flex items-baseline justify-between gap-2 px-[2px]">
          <h3 className="text-md font-semibold text-ink">Route operations</h3>
          <span className="text-sm text-ink-secondary">
            Labour and overhead{' '}
            <span className="font-semibold tabular-nums text-ink">
              {money(operationTotal, c)}
            </span>{' '}
            per {bom.unit}
          </span>
        </div>
        <Grid
          columns={operationColumns}
          rows={bom.operations}
          getRowId={(r) => `o${r.operationNumber}`}
          emptyMessage="This item has no route operations."
          maxHeight="220px"
        />
      </section>
    </div>
  )
}

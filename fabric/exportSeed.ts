/**
 * Exports the app's seeded demo data as the BRONZE layer of a Fabric
 * lakehouse — shaped like the raw F&O tables the Dataverse "Link to Microsoft
 * Fabric" actually lands, not like the friendly data entities.
 *
 *   npx tsx fabric/exportSeed.ts        → fabric/out/*.csv
 *
 * Why table-shaped: building analytical pages against nice entity shapes
 * proves nothing, because the real link delivers raw tables — RecId joins,
 * dataareaid for company, enums as integers, lowercase column names, and the
 * link's bookkeeping columns (sinkmodifiedon / isdelete). The silver views in
 * fabric/load_lakehouse.py are where that shape becomes usable, which is the
 * same medallion work a production build needs.
 *
 * Why from the seed: the lakehouse then contains EXACTLY the receipts the web
 * inquiry shows. The three F440 anchor loads land at $2.77 / $2.66 / $2.90 in
 * both places, so the two surfaces reconcile to the cent — run this script and
 * compare its summary against the app's Summary block.
 *
 * VERIFY: table and column sets here are REPRESENTATIVE of F&O, chosen to be
 * close enough that the silver SQL survives contact with the real link — but
 * they are not confirmed against one (same honesty as lib/odataConfig.ts).
 * Known simplifications, called out inline:
 *   - MarkupTrans keys on the receipt line / PO line RecId directly via
 *     transrecid + transtablename; the real join goes through InventTransOrigin
 *     and TransTableId.
 *   - ProdTable carries sourceitemid/sourcebatchid for the consumed-batch
 *     trace; the real trace goes through ProdBOM and InventTrans issues.
 *   - Enum integer values (purchstatus, moduletype, pricetype) follow the
 *     documented enums but must be reconciled before reuse.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { ReceiptRow } from '../web/src/types/domain'
import { expectedRows, seedRows, ITEMS, itemByNumber } from '../web/src/data/seed'
import { onHandBatches, shelfLifeOf } from '../web/src/data/productionSeed'
import { costGroupOfConversionCode } from '../web/src/lib/variance'
import { todayIso } from '../web/src/lib/format'

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), 'out')
const DATAAREAID = 'usmf'
const today = todayIso()

// F&O RecIds famously start in this range; a shared sequence across tables
// keeps every id unique the way a real instance's are.
let recId = 5_637_144_576
const nextRecId = () => ++recId

type Cell = string | number | undefined
const rowsOf = new Map<string, { columns: string[]; rows: Cell[][] }>()

function table(name: string, columns: string[]) {
  const bookkeeping = ['recid', 'dataareaid', 'sinkmodifiedon', 'isdelete']
  const all = [...columns, ...bookkeeping]
  rowsOf.set(name, { columns: all, rows: [] })
  return (values: Record<string, Cell>, modifiedOn: string): number => {
    const id = nextRecId()
    rowsOf.get(name)!.rows.push(
      all.map((c) =>
        c === 'recid'
          ? id
          : c === 'dataareaid'
            ? DATAAREAID
            : c === 'sinkmodifiedon'
              ? `${modifiedOn}T12:00:00Z`
              : c === 'isdelete'
                ? 0
                : values[c],
      ),
    )
    return id
  }
}

const csvCell = (v: Cell): string => {
  if (v === undefined || v === null) return ''
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

// ---------------------------------------------------------------------------
// Table writers
// ---------------------------------------------------------------------------

const inventTable = table('inventtable', [
  'itemid',
  'productname',
  'unitid',
  'itemgroupid',
])
const inventTableModule = table('inventtablemodule', [
  'itemid',
  'moduletype', // VERIFY: 0 = Invent, 1 = Purch, 2 = Sales
  'price',
  'unitid',
])
const inventItemPrice = table('inventitemprice', [
  'itemid',
  'pricetype', // VERIFY: 0 = Cost
  'price',
  'unitid',
  'activationdate',
])
const purchTable = table('purchtable', [
  'purchid',
  'orderaccount',
  'purchname',
])
const purchLine = table('purchline', [
  'purchid',
  'linenumber',
  'itemid',
  'purchprice',
  'purchqty',
  'lineamount',
  'purchunit',
  'deliverydate',
  'purchstatus', // VERIFY: 1 = Backorder (open), 2 = Received, 3 = Invoiced
  'inventdimid',
])
const vendPackingSlipTrans = table('vendpackingsliptrans', [
  'packingslipid',
  'deliverydate',
  'purchid',
  'linenumber',
  'itemid',
  'qty',
  'purchunit',
  'inventdimid',
  'purchlinerecid', // simplification — real join goes via InventTransOrigin
])
const markupTrans = table('markuptrans', [
  'transrecid',
  'transtablename', // simplification — stands in for TransTableId
  'moduletype', // VERIFY: 'Vend'
  'markupcode',
  'txt',
  'value',
])
const inventDim = table('inventdim', [
  'inventdimid',
  'inventsiteid',
  'inventlocationid',
  'wmslocationid',
  'inventbatchid',
])
const inventBatch = table('inventbatch', [
  'inventbatchid',
  'itemid',
  'proddate',
  'expdate',
])
const prodTable = table('prodtable', [
  'prodid',
  'itemid',
  'prodstatus', // VERIFY: 7 = Ended
  'qtygood',
  'finisheddate',
  'inventdimid',
  'sourceitemid', // simplification — see header comment
  'sourcebatchid',
])
const prodCalcTrans = table('prodcalctrans', [
  'prodid',
  'transdate',
  'costgroupid', // MAT | PKG | LAB | OVH
  'costcode',
  'costamount', // extended actual for the whole order
])
const inventSum = table('inventsum', [
  'itemid',
  'inventdimid',
  'physicalinvent',
  'physicalvalue',
  'closed',
])

// ---------------------------------------------------------------------------
// Shared registries
// ---------------------------------------------------------------------------

const dimIds = new Map<string, string>()
function dimIdOf(
  siteId: string,
  warehouseId: string,
  locationId: string | undefined,
  batchNumber: string | undefined,
  modifiedOn: string,
): string {
  const key = [siteId, warehouseId, locationId ?? '', batchNumber ?? ''].join('|')
  let id = dimIds.get(key)
  if (!id) {
    id = `DIM-${String(dimIds.size + 1).padStart(6, '0')}`
    dimIds.set(key, id)
    inventDim(
      {
        inventdimid: id,
        inventsiteid: siteId,
        inventlocationid: warehouseId,
        wmslocationid: locationId,
        inventbatchid: batchNumber,
      },
      modifiedOn,
    )
  }
  return id
}

const batchesSeen = new Set<string>()
function ensureBatch(row: ReceiptRow) {
  if (!row.batchNumber || batchesSeen.has(row.batchNumber)) return
  batchesSeen.add(row.batchNumber)
  const shelf = shelfLifeOf(row.itemNumber)
  const exp = shelf
    ? new Date(row.receiptDate + 'T00:00:00Z')
    : undefined
  if (exp) exp.setUTCDate(exp.getUTCDate() + (shelf ?? 0))
  inventBatch(
    {
      inventbatchid: row.batchNumber,
      itemid: row.itemNumber,
      proddate: row.receiptDate,
      expdate: exp ? exp.toISOString().slice(0, 10) : undefined,
    },
    row.receiptDate,
  )
}

const round2 = (v: number) => Math.round(v * 100) / 100
const round4 = (v: number) => Math.round(v * 10_000) / 10_000

// ---------------------------------------------------------------------------
// Item master
// ---------------------------------------------------------------------------

for (const item of ITEMS) {
  inventTable(
    {
      itemid: item.itemNumber,
      productname: item.productName,
      unitid: item.unit,
      itemgroupid: item.itemGroupId,
    },
    today,
  )
  inventItemPrice(
    {
      itemid: item.itemNumber,
      pricetype: 0,
      price: item.currentCost,
      unitid: item.unit,
      activationdate: today,
    },
    today,
  )
  inventTableModule(
    { itemid: item.itemNumber, moduletype: 2, price: item.sellingPrice, unitid: item.unit },
    today,
  )
  if (item.basePurchasePrice !== undefined) {
    inventTableModule(
      { itemid: item.itemNumber, moduletype: 1, price: item.basePurchasePrice, unitid: item.unit },
      today,
    )
  }
}

// ---------------------------------------------------------------------------
// Posted receipts, open POs, production orders
// ---------------------------------------------------------------------------

const posted = seedRows()
const expected = expectedRows(today)
const purchIdsSeen = new Set<string>()

function ensurePurchTable(row: ReceiptRow) {
  if (purchIdsSeen.has(row.purchaseOrderNumber)) return
  purchIdsSeen.add(row.purchaseOrderNumber)
  purchTable(
    {
      purchid: row.purchaseOrderNumber,
      orderaccount: row.vendorAccount,
      purchname: row.vendorName,
    },
    row.receiptDate,
  )
}

for (const row of [...posted, ...expected]) {
  ensureBatch(row)

  if (row.sourceType === 'Production') {
    // Report-as-finished: ProdTable + the actual cost split by cost group.
    const dim = dimIdOf(row.siteId, row.warehouseId, row.locationId, row.batchNumber, row.receiptDate)
    prodTable(
      {
        prodid: row.purchaseOrderNumber,
        itemid: row.itemNumber,
        prodstatus: 7,
        qtygood: row.quantityReceived,
        finisheddate: row.receiptDate,
        inventdimid: dim,
        sourceitemid: row.sourceItemNumber,
        sourcebatchid: row.sourceBatchNumber,
      },
      row.receiptDate,
    )
    prodCalcTrans(
      {
        prodid: row.purchaseOrderNumber,
        transdate: row.receiptDate,
        costgroupid: 'MAT',
        costcode: 'MATERIAL',
        costamount: round2(row.purchasePriceFob * row.quantityReceived),
      },
      row.receiptDate,
    )
    const groupId = { Material: 'MAT', Packaging: 'PKG', Labour: 'LAB', Overhead: 'OVH' } as const
    for (const ch of row.charges) {
      prodCalcTrans(
        {
          prodid: row.purchaseOrderNumber,
          transdate: row.receiptDate,
          costgroupid: groupId[costGroupOfConversionCode(ch.chargeCode)],
          costcode: ch.chargeCode,
          costamount: round2(ch.amount),
        },
        row.receiptDate,
      )
    }
    continue
  }

  // Purchase side: PO header + line, then a packing slip line if posted.
  ensurePurchTable(row)
  const isExpected = row.receiptStatus === 'Expected'
  const dim = dimIdOf(row.siteId, row.warehouseId, row.locationId, row.batchNumber, row.receiptDate)
  const lineRecId = purchLine(
    {
      purchid: row.purchaseOrderNumber,
      linenumber: row.purchaseLineNumber,
      itemid: row.itemNumber,
      purchprice: row.purchasePriceFob,
      purchqty: row.quantityReceived,
      lineamount: round2(row.purchasePriceFob * row.quantityReceived),
      purchunit: row.unit,
      deliverydate: row.receiptDate,
      purchstatus: isExpected ? 1 : 2,
      inventdimid: dim,
    },
    row.receiptDate,
  )

  const transRecId = isExpected
    ? lineRecId
    : vendPackingSlipTrans(
        {
          packingslipid: row.receiptNumber,
          deliverydate: row.receiptDate,
          purchid: row.purchaseOrderNumber,
          linenumber: row.purchaseLineNumber,
          itemid: row.itemNumber,
          qty: row.quantityReceived,
          purchunit: row.unit,
          inventdimid: dim,
          purchlinerecid: lineRecId,
        },
        row.receiptDate,
      )

  for (const ch of row.charges) {
    markupTrans(
      {
        transrecid: transRecId,
        transtablename: isExpected ? 'PurchLine' : 'VendPackingSlipTrans',
        moduletype: 'Vend',
        markupcode: ch.chargeCode,
        txt: ch.description,
        value: round2(ch.amount),
      },
      row.receiptDate,
    )
  }
}

// ---------------------------------------------------------------------------
// On-hand snapshot, as at today
// ---------------------------------------------------------------------------

for (const b of onHandBatches(today)) {
  const dim = dimIdOf(b.siteId, b.warehouseId, b.locationId, b.batchNumber, today)
  inventSum(
    {
      itemid: b.itemNumber,
      inventdimid: dim,
      physicalinvent: b.quantity,
      physicalvalue: round2(b.inventoryValue),
      closed: 0,
    },
    today,
  )
}

// ---------------------------------------------------------------------------
// Write files + reconciliation summary
// ---------------------------------------------------------------------------

mkdirSync(OUT_DIR, { recursive: true })
for (const [name, t] of rowsOf) {
  const csv = [t.columns.join(','), ...t.rows.map((r) => r.map(csvCell).join(','))].join('\n')
  writeFileSync(join(OUT_DIR, `${name}.csv`), csv + '\n', 'utf8')
  console.log(`${name}.csv`.padEnd(28) + `${t.rows.length} rows`)
}

console.log('\nReconciliation — compare against the app Summary block:')
for (const itemNumber of ['F440', 'RAW541', 'FG816', 'FG841']) {
  const item = itemByNumber(itemNumber)!
  const rows = posted.filter((r) => r.itemNumber === itemNumber)
  const qty = rows.reduce((s, r) => s + r.quantityReceived, 0)
  const landed = qty ? rows.reduce((s, r) => s + r.landedCost * r.quantityReceived, 0) / qty : 0
  const open = expected.filter((r) => r.itemNumber === itemNumber).length
  console.log(
    `  ${itemNumber.padEnd(7)} ${String(rows.length).padStart(3)} receipts · ` +
      `${qty.toLocaleString('en-US').padStart(10)} ${item.unit} · ` +
      `avg landed ${round4(landed).toFixed(4)} · ${open} open POs`,
  )
}
console.log(`\nWritten to ${OUT_DIR}`)

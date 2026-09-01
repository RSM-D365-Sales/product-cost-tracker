# Fabric starter — real Fabric, synthetic data (Tier 2)

Simulates what the Dataverse **Link to Microsoft Fabric** would land from a
D365 F&SC environment, using this repo's own seed — so the lakehouse contains
exactly the receipts the web inquiry shows, and the two surfaces reconcile to
the cent. Build the analytical pages against this; when a real link exists,
repoint the bronze tables and keep the silver/gold SQL.

## Files

```
exportSeed.ts        seed → out/*.csv, shaped like raw F&O tables
load_lakehouse.py    Fabric notebook: bronze → silver → gold, + reconciliation
out/                 generated CSVs (not committed — regenerate at will)
```

## Setup, end to end (~15 minutes)

1. **Export the seed.** From the repo root:

   ```bash
   npx tsx fabric/exportSeed.ts
   ```

   Note the reconciliation block it prints — those are the numbers the
   notebook must reproduce (F440: 55 receipts, avg landed ≈ 3.04, 4 open POs).

2. **Workspace + capacity.** Create a Fabric workspace on a trial capacity
   (60-day free) or a small F (F2) capacity. **Pause the capacity when not
   demoing** — that is the whole cost story.

3. **Lakehouse.** In the workspace: New → Lakehouse (e.g. `costlake`). Under
   **Files**, create a folder `seed` and upload everything in `fabric/out/`.

4. **Notebook.** New → Notebook, attach it to the lakehouse, paste the whole
   of `load_lakehouse.py` into one cell, run it. It loads 12 bronze tables,
   builds 4 silver and 2 gold tables, and prints the same reconciliation.

5. **Consume.** The SQL analytics endpoint now serves `silver_*` / `gold_*` to
   anything that speaks TDS; a semantic model over the gold tables gives
   Direct Lake Power BI. `gold_item_cost_points` is the demo opener: one row
   per item with current cost, sales price, landed (all / 90-day / last),
   expected landed from open POs, and production actual, side by side.

Re-running is the refresh: export again (the seed is relative to *today*, so
dates stay current), re-upload, re-run the notebook.

## What is simulated, honestly

- **Table-shaped, not entity-shaped.** The link lands raw F&O tables — RecId
  joins, `dataareaid`, enums as integers, lowercase columns, `sinkmodifiedon` /
  `isdelete` bookkeeping. The silver layer is where that becomes usable, which
  is exactly the medallion work a production build needs anyway.
- **Representative, not confirmed.** Table and column sets are close to real
  F&O but are NOT verified against a live link — same policy as
  `web/src/lib/odataConfig.ts`. Known simplifications are flagged `VERIFY` in
  `exportSeed.ts`: MarkupTrans keys directly on the receipt-line RecId (real
  join goes via InventTransOrigin), ProdTable carries the consumed-batch trace
  (really ProdBOM/InventTrans), and enum integer values need reconciling.
- **No-copy shortcuts and CDC cannot be simulated** — from the consumer side
  (SQL endpoint, semantic model) that difference is invisible.

## Cost points covered

| Cost point | Bronze source | Silver/gold |
|---|---|---|
| Purchase price (FOB) | `purchline` | `silver_product_receipts.purchprice` |
| Landed cost (FOB + charges) | `vendpackingsliptrans` + `markuptrans` | `silver_product_receipts.landed_unit` |
| Expected landed (open POs) | `purchline` (status 1) + estimated `markuptrans` | `silver_open_po_lines` |
| Production actual by cost group | `prodtable` + `prodcalctrans` (MAT/PKG/LAB/OVH) | `silver_production_costs` |
| Cost record & sales price | `inventitemprice` + `inventtablemodule` | `gold_item_cost_points` |
| On-hand valuation & expiry | `inventsum` + `inventbatch` | `silver_onhand_batches` |

## Natural next steps

- A tiny scheduled notebook that appends a few "posted receipts" every N
  minutes — the near-real-time demo beat.
- A semantic model + one Power BI page over `gold_landed_cost_monthly` and
  `gold_item_cost_points`, quoting the same figures as the web inquiry.
- A `fabric` analytical provider in the app: the Node proxy queries the SQL
  analytics endpoint, and the trend/variance baselines come from gold tables
  instead of the browser — the productionalization dry run.

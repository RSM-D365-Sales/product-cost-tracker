# Fabric notebook: loads the synthetic F&O-shaped seed into a lakehouse.
#
# Setup: create a Lakehouse, upload fabric/out/*.csv to Files/seed/, create a
# notebook attached to that lakehouse, paste this whole file into one cell and
# run it. Idempotent — every table is created with overwrite, so re-running
# after a fresh export is the refresh.
#
# Layers, mirroring what a production Fabric-link build needs:
#   bronze_*  raw F&O-table shapes exactly as exportSeed.ts wrote them
#   silver_*  decoded, joined, costed — the entity-like shapes pages query
#   gold_*    aggregates for the analytical pages (trend, cost points)
#
# The silver SQL is the deliverable that survives contact with the real link:
# when the actual tables arrive, the bronze names change and this logic stays.

from pyspark.sql import functions as F

SEED_PATH = "Files/seed"

BRONZE_TABLES = [
    "inventtable",
    "inventtablemodule",
    "inventitemprice",
    "purchtable",
    "purchline",
    "vendpackingsliptrans",
    "markuptrans",
    "inventdim",
    "inventbatch",
    "prodtable",
    "prodcalctrans",
    "inventsum",
]

# ---------------------------------------------------------------------------
# Bronze: CSV -> Delta, with dates and the link's bookkeeping column typed
# ---------------------------------------------------------------------------

for name in BRONZE_TABLES:
    df = (
        spark.read.option("header", True)
        .option("inferSchema", True)
        .csv(f"{SEED_PATH}/{name}.csv")
    )
    for col in df.columns:
        if col == "sinkmodifiedon":
            df = df.withColumn(col, F.to_timestamp(col))
        elif col.endswith("date"):
            df = df.withColumn(col, F.to_date(col))
    df.write.mode("overwrite").format("delta").saveAsTable(f"bronze_{name}")
    print(f"bronze_{name}: {df.count()} rows")

# ---------------------------------------------------------------------------
# Silver: posted product receipts, costed (FOB + allocated charges = landed)
# ---------------------------------------------------------------------------

spark.sql("""
CREATE OR REPLACE TABLE silver_product_receipts AS
SELECT
  r.recid                       AS receipt_recid,
  r.dataareaid,
  r.packingslipid,
  r.deliverydate,
  r.purchid,
  pl.linenumber,
  r.itemid,
  it.productname,
  pt.orderaccount               AS vendaccount,
  pt.purchname                  AS vendname,
  d.inventsiteid,
  d.inventlocationid,
  d.wmslocationid,
  d.inventbatchid,
  b.expdate,
  r.qty,
  pl.purchprice,
  COALESCE(m.charges, 0)                          AS charges_ext,
  ROUND(COALESCE(m.charges, 0) / r.qty, 6)        AS charges_unit,
  ROUND(pl.purchprice + COALESCE(m.charges, 0) / r.qty, 6) AS landed_unit
FROM bronze_vendpackingsliptrans r
JOIN bronze_purchline   pl ON pl.recid  = r.purchlinerecid
JOIN bronze_purchtable  pt ON pt.purchid = r.purchid
JOIN bronze_inventtable it ON it.itemid  = r.itemid
JOIN bronze_inventdim   d  ON d.inventdimid = r.inventdimid
LEFT JOIN bronze_inventbatch b
  ON b.inventbatchid = d.inventbatchid AND b.itemid = r.itemid
LEFT JOIN (
  SELECT transrecid, SUM(value) AS charges
  FROM bronze_markuptrans
  WHERE transtablename = 'VendPackingSlipTrans'
  GROUP BY transrecid
) m ON m.transrecid = r.recid
""")

# --- Open PO lines: expected receipts at vendor price + estimated charges ---

spark.sql("""
CREATE OR REPLACE TABLE silver_open_po_lines AS
SELECT
  pl.recid                     AS purchline_recid,
  pl.purchid,
  pt.orderaccount              AS vendaccount,
  pt.purchname                 AS vendname,
  pl.itemid,
  it.productname,
  pl.deliverydate              AS confirmed_delivery,
  pl.purchqty,
  pl.purchprice,
  ROUND(COALESCE(m.charges, 0) / pl.purchqty, 6)  AS est_charges_unit,
  ROUND(pl.purchprice + COALESCE(m.charges, 0) / pl.purchqty, 6) AS expected_landed_unit
FROM bronze_purchline pl
JOIN bronze_purchtable  pt ON pt.purchid = pl.purchid
JOIN bronze_inventtable it ON it.itemid  = pl.itemid
LEFT JOIN (
  SELECT transrecid, SUM(value) AS charges
  FROM bronze_markuptrans
  WHERE transtablename = 'PurchLine'
  GROUP BY transrecid
) m ON m.transrecid = pl.recid
WHERE pl.purchstatus = 1
""")

# --- Production orders: actual cost per unit, split by cost group -----------

spark.sql("""
CREATE OR REPLACE TABLE silver_production_costs AS
SELECT
  p.prodid,
  p.itemid,
  it.productname,
  p.finisheddate,
  p.qtygood,
  d.inventsiteid,
  d.inventlocationid,
  d.inventbatchid,
  p.sourceitemid,
  p.sourcebatchid,
  ROUND(SUM(CASE WHEN c.costgroupid = 'MAT' THEN c.costamount ELSE 0 END) / p.qtygood, 6) AS material_unit,
  ROUND(SUM(CASE WHEN c.costgroupid = 'PKG' THEN c.costamount ELSE 0 END) / p.qtygood, 6) AS packaging_unit,
  ROUND(SUM(CASE WHEN c.costgroupid = 'LAB' THEN c.costamount ELSE 0 END) / p.qtygood, 6) AS labour_unit,
  ROUND(SUM(CASE WHEN c.costgroupid = 'OVH' THEN c.costamount ELSE 0 END) / p.qtygood, 6) AS overhead_unit,
  ROUND(SUM(c.costamount) / p.qtygood, 6)                                                 AS total_unit
FROM bronze_prodtable p
JOIN bronze_prodcalctrans c ON c.prodid = p.prodid AND c.dataareaid = p.dataareaid
JOIN bronze_inventtable  it ON it.itemid = p.itemid
JOIN bronze_inventdim    d  ON d.inventdimid = p.inventdimid
GROUP BY p.prodid, p.itemid, it.productname, p.finisheddate, p.qtygood,
         d.inventsiteid, d.inventlocationid, d.inventbatchid,
         p.sourceitemid, p.sourcebatchid
""")

# --- On-hand batches with expiry and value ----------------------------------

spark.sql("""
CREATE OR REPLACE TABLE silver_onhand_batches AS
SELECT
  s.itemid,
  it.productname,
  d.inventsiteid,
  d.inventlocationid,
  d.wmslocationid,
  d.inventbatchid,
  b.proddate,
  b.expdate,
  DATEDIFF(b.expdate, current_date())     AS days_to_expiry,
  s.physicalinvent,
  s.physicalvalue,
  ROUND(s.physicalvalue / s.physicalinvent, 6) AS unit_cost
FROM bronze_inventsum s
JOIN bronze_inventtable it ON it.itemid = s.itemid
JOIN bronze_inventdim   d  ON d.inventdimid = s.inventdimid
LEFT JOIN bronze_inventbatch b
  ON b.inventbatchid = d.inventbatchid AND b.itemid = s.itemid
WHERE s.physicalinvent > 0
""")

# ---------------------------------------------------------------------------
# Gold: the aggregates the analytical pages read
# ---------------------------------------------------------------------------

# Landed cost by item and month — the trend chart's series, pre-aggregated.
spark.sql("""
CREATE OR REPLACE TABLE gold_landed_cost_monthly AS
SELECT
  itemid,
  productname,
  DATE_TRUNC('month', deliverydate)                AS month,
  COUNT(*)                                         AS receipts,
  SUM(qty)                                         AS qty,
  ROUND(SUM(purchprice * qty) / SUM(qty), 6)       AS avg_fob_unit,
  ROUND(SUM(charges_unit * qty) / SUM(qty), 6)     AS avg_charges_unit,
  ROUND(SUM(landed_unit * qty) / SUM(qty), 6)      AS avg_landed_unit
FROM silver_product_receipts
GROUP BY itemid, productname, DATE_TRUNC('month', deliverydate)
""")

# One row per item, every cost point side by side. The comparisons the app
# argues about — record vs landed vs expected vs production actual — as data.
spark.sql("""
CREATE OR REPLACE TABLE gold_item_cost_points AS
WITH landed AS (
  SELECT itemid,
         ROUND(SUM(landed_unit * qty) / SUM(qty), 6) AS avg_landed_all,
         ROUND(SUM(CASE WHEN deliverydate >= DATE_ADD(current_date(), -90) THEN landed_unit * qty END)
           / NULLIF(SUM(CASE WHEN deliverydate >= DATE_ADD(current_date(), -90) THEN qty END), 0), 6)
                                                     AS avg_landed_90d,
         MAX_BY(landed_unit, deliverydate)           AS last_landed
  FROM silver_product_receipts
  GROUP BY itemid
),
expectedpo AS (
  SELECT itemid,
         ROUND(SUM(expected_landed_unit * purchqty) / SUM(purchqty), 6) AS expected_landed
  FROM silver_open_po_lines
  GROUP BY itemid
),
prod AS (
  SELECT itemid,
         ROUND(SUM(total_unit * qtygood) / SUM(qtygood), 6) AS avg_production_cost
  FROM silver_production_costs
  GROUP BY itemid
)
SELECT
  it.itemid,
  it.productname,
  ip.price                AS current_cost,
  sm.price                AS sales_price,
  l.avg_landed_all,
  l.avg_landed_90d,
  l.last_landed,
  e.expected_landed,
  p.avg_production_cost
FROM bronze_inventtable it
LEFT JOIN bronze_inventitemprice   ip ON ip.itemid = it.itemid AND ip.pricetype = 0
LEFT JOIN bronze_inventtablemodule sm ON sm.itemid = it.itemid AND sm.moduletype = 2
LEFT JOIN landed     l ON l.itemid = it.itemid
LEFT JOIN expectedpo e ON e.itemid = it.itemid
LEFT JOIN prod       p ON p.itemid = it.itemid
""")

# ---------------------------------------------------------------------------
# Reconciliation — must match exportSeed.ts's console summary and the app
# ---------------------------------------------------------------------------

print("Reconciliation — compare against exportSeed.ts output and the app Summary block:")
display(spark.sql("""
SELECT r.itemid,
       COUNT(*)                                    AS receipts,
       SUM(r.qty)                                  AS qty,
       ROUND(SUM(r.landed_unit * r.qty) / SUM(r.qty), 4) AS avg_landed,
       COALESCE(o.open_pos, 0)                     AS open_pos
FROM silver_product_receipts r
LEFT JOIN (
  SELECT itemid, COUNT(*) AS open_pos FROM silver_open_po_lines GROUP BY itemid
) o ON o.itemid = r.itemid
WHERE r.itemid IN ('F440', 'RAW541')
GROUP BY r.itemid, o.open_pos
UNION ALL
SELECT p.itemid,
       COUNT(*),
       SUM(p.qtygood),
       ROUND(SUM(p.total_unit * p.qtygood) / SUM(p.qtygood), 4),
       0
FROM silver_production_costs p
WHERE p.itemid IN ('FG816', 'FG841')
GROUP BY p.itemid
ORDER BY itemid
"""))

display(spark.sql("SELECT * FROM gold_item_cost_points WHERE itemid IN ('F440','RAW541','FG816','FG841') ORDER BY itemid"))

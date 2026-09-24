/**
 * Renders the app in system Edge and asserts the inquiry actually works.
 *
 * Uses `channel: 'msedge'` rather than a bundled Chromium because the
 * Playwright browser CDN is blocked by the corporate proxy.
 *
 *   npm run dev        # in one terminal
 *   node verify.mjs    # in another
 */
import { chromium } from 'playwright'

const base = process.env.BASE_URL ?? 'http://localhost:5173'

const browser = await chromium.launch({ channel: 'msedge' })
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } })

const errors = []
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`[console] ${m.text()}`)
})
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`))

const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? ` — ${extra}` : ''}`)
  if (!ok) process.exitCode = 1
}

await page.goto(base, { waitUntil: 'networkidle' })
await page.waitForTimeout(400)

check(
  'page caption renders',
  (await page.locator('h1').innerText()) === 'Product cost inquiry',
)

// The bluestem title ribbon shows by default and carries the RSM sponsor mark,
// which the brand guide requires on every app.
check(
  'the bluestem ribbon shows by default with the RSM sponsor mark',
  (await page.getByText('Finance and Operations', { exact: true }).count()) === 1 &&
    (await page.getByRole('img', { name: 'bluestem' }).count()) === 1 &&
    (await page.getByRole('img', { name: 'RSM' }).isVisible()) &&
    (await page.getByText('Powered by', { exact: true }).isVisible()),
)

/** Asserts one hand-authored anchor row is rendered with the expected figures. */
async function checkAnchor(a) {
  const row = page.locator('table.f-grid tbody tr', { hasText: a.receipt }).first()
  const cells = await row.locator('td').allInnerTexts()
  const joined = cells.join(' | ')
  const ok = [a.order, a.qty, a.fob, a.aoc, a.landed].every((v) =>
    joined.includes(v),
  )
  check(`anchor ${a.receipt}`, ok, ok ? '' : joined)
}

/** The Item lookup's text input, on whichever page is open. */
const itemField = () =>
  page
    .locator('div.relative')
    .filter({ has: page.getByRole('button', { name: 'Open Item lookup' }) })
    .locator('input')

/** Types an item number into the Item lookup and runs the inquiry. */
async function runFor(itemNumber) {
  // The parameters block collapses itself once a run returns rows.
  const show = page.getByRole('button', { name: 'Show parameters' })
  if (await show.count()) await show.first().click()

  await itemField().fill(itemNumber)
  // Dismiss the lookup flyout so it does not cover the action pane.
  await page.keyboard.press('Escape')

  await page.getByRole('button', { name: 'Run', exact: true }).click()
  await page.waitForTimeout(900)
}

// The form opens with no item chosen, so nothing can be retrieved until one is.
check(
  'item is empty on load',
  (await itemField().inputValue()) === '',
  await itemField().inputValue(),
)
await page.getByRole('button', { name: 'Run', exact: true }).click()
await page.waitForTimeout(400)
check(
  'running with no item asks for one',
  (await page.locator('body').innerText()).includes('Item is a required field.'),
)
check(
  'grid stays empty until an item is chosen',
  (await page.locator('table.f-grid tbody').innerText()).includes(
    'Enter an item number and select Run',
  ),
)

await runFor('RAW-BLU')

const rowCount = await page.locator('table.f-grid tbody tr').count()
check('grid returns rows', rowCount > 0, `${rowCount} tbody rows`)

// Three receipts of RAW-BLU from V3014 Ridgeview Produce Exchange at the SAME
// $2.35 FOB price that land at three different costs. This is the demo's
// headline.
for (const a of [
  { order: 'PO-000241', receipt: 'PR-104812', qty: '42,000', fob: '$2.35', aoc: '$0.42', landed: '$2.77' },
  { order: 'PO-000258', receipt: 'PR-105196', qty: '38,000', fob: '$2.35', aoc: '$0.31', landed: '$2.66' },
  { order: 'PO-000273', receipt: 'PR-105644', qty: '40,000', fob: '$2.35', aoc: '$0.55', landed: '$2.90' },
]) {
  await checkAnchor(a)
}

// Every blueberry receipt lands in the Hart packing house's receiving cooler.
// Columns 1 and 2 are the select radio and the expander, so site is the 8th
// cell.
const siteCells = await page
  .locator('table.f-grid tbody tr td:nth-child(8)')
  .allInnerTexts()
const whsCells = await page
  .locator('table.f-grid tbody tr td:nth-child(9)')
  .allInnerTexts()
check(
  'blueberries received into HRT / HRT-RM',
  siteCells.length > 0 &&
    siteCells.every((s) => s.trim() === 'HRT') &&
    whsCells.every((s) => s.trim() === 'HRT-RM'),
  `sites ${[...new Set(siteCells.map((s) => s.trim()))]} / whs ${[...new Set(whsCells.map((s) => s.trim()))]}`,
)

// Summary block must be populated.
const summaryText = await page.locator('section', { hasText: 'Summary' }).first().innerText()
check('summary shows landed cost', /Average landed cost/.test(summaryText))

// Expanding a row must reveal the charge breakdown — the part a plain
// OData grid cannot show.
await page.locator('button[aria-label="Expand charges"]').first().click()
await page.waitForTimeout(300)
check(
  'charge breakdown expands',
  await page.getByText(/Total add-on cost over/).first().isVisible(),
)

await page.screenshot({ path: 'verify-inquiry.png', fullPage: true })
console.log('Screenshot written to verify-inquiry.png')

// --- Landed cost variance --------------------------------------------------
// Collapsed by default with the counts in the header; expanding it must list
// the out-of-bounds receipts with a direction and the causes that put them
// there. Two years of freight inflation guarantee flagged rows at ±5%.
const varianceTab = page
  .locator('section', { hasText: 'Landed cost variance' })
  .first()
await varianceTab.locator('button[aria-expanded]').first().click()
await page.waitForTimeout(300)

const varianceText = (await varianceTab.innerText()).replace(/\s+/g, ' ')
check(
  'variance panel reports baseline and tolerance counts',
  /Baseline landed cost/.test(varianceText) && /Within tolerance/.test(varianceText),
  varianceText.slice(0, 160),
)

const flaggedRows = await varianceTab.locator('table.f-grid tbody tr').count()
check(
  'variance grid flags out-of-bounds receipts with a direction',
  flaggedRows > 0 && /Above|Below/i.test(varianceText),
  `${flaggedRows} flagged rows`,
)

// The decomposition must name the causes — this is the "why", not just "how much".
await varianceTab.locator('button[aria-label="Expand charges"]').first().click()
await page.waitForTimeout(250)
const causeText = (await varianceTab.innerText()).replace(/\s+/g, ' ')
check(
  'flagged receipt decomposes into named causes',
  /Variance causes/.test(causeText) &&
    /Transportation/.test(causeText) &&
    /Purchase price \(FOB\)/.test(causeText),
  causeText.match(/Variance causes[^|]{0,120}/)?.[0] ?? '',
)

await page.screenshot({ path: 'verify-variance.png', fullPage: true })
console.log('Screenshot written to verify-variance.png')

// Collapse again so the receipts grid is the only grid the anchor checks see.
await varianceTab.locator('button[aria-expanded]').first().click()
await page.waitForTimeout(200)

// --- Expected receipts ------------------------------------------------------
// Open PO lines not yet received ride along in the grid, marked EXPECTED, and
// toggle off so history can be read without the pipeline in the way.
const receiptsSection = page
  .locator('section', { hasText: 'Product receipts' })
  .first()
check(
  'expected PO lines appear amongst the receipts',
  (await receiptsSection.locator('tbody tr', { hasText: 'PO-000920' }).count()) >
    0 && /expected/i.test(await receiptsSection.innerText()),
)

await page.getByRole('button', { name: 'Hide expected POs' }).click()
await page.waitForTimeout(200)
check(
  'expected POs toggle off',
  (await receiptsSection.locator('tbody tr', { hasText: 'PO-000920' }).count()) ===
    0,
)
await page.getByRole('button', { name: 'Show expected POs' }).click()
await page.waitForTimeout(200)

// --- Impact analysis --------------------------------------------------------
// Net requirements with pegging, and the procurement-agent simulation: moving
// a confirmed delivery out must put named downstream orders at risk.
const impactTab = page.locator('section', { hasText: 'Impact analysis' }).first()
await impactTab.locator('button[aria-expanded]').first().click()
await page.waitForTimeout(300)
const impactText = (await impactTab.innerText()).replace(/\s+/g, ' ')
check(
  'impact analysis nets open POs against pegged demand',
  /PP-000\d+/.test(impactText) &&
    /Downstream orders covered/.test(impactText) &&
    /PO-000931/.test(impactText),
  impactText.slice(0, 160),
)

await page.getByLabel('Shift PO-000931 by days').fill('7')
await page.waitForTimeout(300)
const simText = (await impactTab.innerText()).replace(/\s+/g, ' ')
check(
  'moving a PO out has impact on downstream orders',
  /has impact/i.test(simText) && /Impacted downstream orders/.test(simText),
  simText.match(/First shortfall[^A-Z]*/)?.[0] ?? simText.slice(0, 160),
)

await page.screenshot({ path: 'verify-impact.png', fullPage: true })
console.log('Screenshot written to verify-impact.png')

await page.getByRole('button', { name: 'Reset simulation' }).click()
await page.waitForTimeout(200)
// Collapse so later grid-wide checks only ever see the receipts grid.
await impactTab.locator('button[aria-expanded]').first().click()
await page.waitForTimeout(200)

// --- Finished goods --------------------------------------------------------
// The produced items are reported as finished against production orders, and
// each run must carry the actual cost of the blueberry batch it consumed.
await runFor('PK-BLU-PINT')

const fgRows = await page.locator('table.f-grid tbody tr').count()
check('PK-BLU-PINT returns production rows', fgRows > 0, `${fgRows} tbody rows`)

for (const a of [
  { order: 'P000318', receipt: 'PJ-000318', qty: '3,400', fob: '$24.93', aoc: '$3.63', landed: '$28.56' },
  { order: 'P000341', receipt: 'PJ-000341', qty: '3,100', fob: '$23.94', aoc: '$3.54', landed: '$27.48' },
  { order: 'P000369', receipt: 'PJ-000369', qty: '3,300', fob: '$26.10', aoc: '$3.76', landed: '$29.86' },
]) {
  await checkAnchor(a)
}

// Production rows carry no vendor, and the expanded detail traces the run back
// to the raw-material batch it consumed.
const producedRow = page
  .locator('table.f-grid tbody tr', { hasText: 'PJ-000318' })
  .first()
check(
  'production row shows no vendor',
  (await producedRow.innerText()).includes('Produced'),
)

await producedRow.locator('button[aria-label="Expand charges"]').click()
await page.waitForTimeout(300)
const detail = await page
  .locator('table.f-grid tbody tr', { hasText: 'consumed batch' })
  .first()
  .innerText()
check(
  'production row traces its consumed batch',
  detail.includes('RAW-BLU-26061A') && detail.includes('$24.93'),
  detail.replace(/\s+/g, ' ').slice(0, 160),
)

await page.screenshot({ path: 'verify-production.png', fullPage: true })
console.log('Screenshot written to verify-production.png')

// --- Cost trend ------------------------------------------------------------
await runFor('RAW-BLU')
await page.getByRole('button', { name: 'Cost trend', exact: true }).click()
await page.waitForTimeout(500)

const plot = page.locator('svg[role="img"]').first()
check('cost trend chart renders', await plot.isVisible())

// Read the stats through their data hooks: the panel's text also contains the
// SVG's own "Projected" region label and its money-formatted axis ticks, so
// scraping innerText matches the wrong things.
const stat = async (series, name) => {
  const text = await page
    .locator(`[data-series="${series}"] [data-stat="${name}"]`)
    .innerText()
  const n = Number(text.replace(/[^0-9.-]/g, ''))
  return { text: text.trim(), n }
}

const landedTrend = await stat('landed', 'trend')
const landedFit = await stat('landed', 'fit')
const fobTrend = await stat('fob', 'trend')
check(
  'trend reports slope and fit for both series',
  landedTrend.n > 0 && fobTrend.n > 0 && landedFit.n > 0,
  `landed ${landedTrend.text}/yr (r² ${landedFit.text}), fob ${fobTrend.text}/yr`,
)

// Charges inflate faster than goods, so landed must climb faster than FOB.
check(
  'landed cost climbs faster than purchase price',
  landedTrend.text.startsWith('+') && landedTrend.n > fobTrend.n,
  `landed +${landedTrend.n} vs fob +${fobTrend.n} per lb per year`,
)

// The projection must respond to the horizon, and move further along the trend.
const at6 = (await stat('landed', 'projected')).n
await page.getByRole('button', { name: '12 months', exact: true }).click()
await page.waitForTimeout(300)
const at12 = (await stat('landed', 'projected')).n
check(
  'longer horizon projects further along the trend',
  Number.isFinite(at6) && Number.isFinite(at12) && at12 > at6,
  `6mo $${at6} -> 12mo $${at12}`,
)

// Crosshair + tooltip.
const plotBox = await plot.boundingBox()
await page.mouse.move(
  plotBox.x + plotBox.width * 0.45,
  plotBox.y + plotBox.height * 0.5,
)
await page.waitForTimeout(250)
check(
  'hovering the plot reads a receipt',
  await page.locator('[role="status"]', { hasText: 'Landed cost' }).first().isVisible(),
)

await page.screenshot({ path: 'verify-trend.png', fullPage: true })
console.log('Screenshot written to verify-trend.png')

await page.getByRole('button', { name: 'Hide cost trend', exact: true }).click()
await page.waitForTimeout(200)

// --- Background catalogue --------------------------------------------------
// The filler items exist so the lookups and filters look real. They must return
// rows, and must NOT be receiving into a single warehouse only —
// that is what gives the site/warehouse filters something to do.
await runFor('PKG-CUP-2OZ')
const pkgRows = await page.locator('table.f-grid tbody tr').count()
const pkgWhs = new Set(
  (await page.locator('table.f-grid tbody tr td:nth-child(9)').allInnerTexts()).map(
    (s) => s.trim(),
  ),
)
check('background item returns rows', pkgRows > 0, `${pkgRows} tbody rows`)
check(
  'background items span more than one warehouse',
  pkgWhs.size > 1,
  [...pkgWhs].join(','),
)

// An unknown item must still fail cleanly rather than showing an empty grid.
await runFor('NOPE999')
check(
  'unknown item raises a named error',
  await page.getByText('does not exist').first().isVisible(),
)

// --- Production cost inquiry ----------------------------------------------
// Routed by hash, the way an embedding host deep-links a page. The standalone
// chrome's navigation pane is exercised separately at the end.
await page.evaluate(() => {
  window.location.hash = '#/production-cost'
})
await page.waitForTimeout(500)

check(
  'hash routing opens the production cost inquiry',
  (await page.locator('h1').innerText()) === 'Production cost inquiry',
)

/** Reads a stat tile from the plan summary, e.g. "Material at risk". */
const planStat = async (label) =>
  (
    await page
      .locator('div.border', { has: page.getByText(label, { exact: true }) })
      .first()
      .innerText()
  )
    .replace(/\s+/g, ' ')
    .trim()

/** Money out of a stat tile, as a number. */
const planMoney = async (label) =>
  Number(((await planStat(label)).match(/\$([\d,.]+)/)?.[1] ?? '').replace(/,/g, ''))

const planQuantity = async (label) =>
  Number(((await planStat(label)).match(/([\d,]+)\s+(?:ea|cs|lb)/)?.[1] ?? '').replace(/,/g, ''))

/** Types an item into the production page's Item lookup and re-runs. */
async function planFor(itemNumber) {
  const show = page.getByRole('button', { name: 'Show parameters' })
  if (await show.count()) await show.first().click()
  await itemField().fill(itemNumber)
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Run inquiry', exact: true }).click()
  await page.waitForTimeout(1000)
}

// This page opens empty too.
check(
  'production item is empty on load',
  (await itemField().inputValue()) === '',
  await itemField().inputValue(),
)
await planFor('PK-BLU-PINT')
await page.waitForTimeout(100)

const planRows = await page
  .locator('section', { hasText: 'Production plan' })
  .locator('table.f-grid tbody tr')
  .count()
check('production plan returns runs', planRows > 0, `${planRows} rows`)

// Every batch on hand must carry an expiry date and a landed cost that came
// from a real receipt — this is the join between the two pages.
const batchTable = await page
  .locator('section', { hasText: 'Available batches' })
  .first()
  .innerText()
check(
  'batches show expiry, shelf life and landed cost',
  /EXPIRING|AVAILABLE/.test(batchTable) && /RAW-BLU-\d{5}[A-Z]/.test(batchTable),
)

// The bill of material must show the raw material AND real packaging items,
// costed off stock on hand rather than a standard.
// The FastTab starts collapsed — the BOM is the evidence, not the answer.
await page
  .locator('section')
  .filter({ hasText: 'Bill of material and route' })
  .first()
  .locator('button[aria-expanded="false"]')
  .first()
  .click()
await page.waitForTimeout(300)
const bomText = await page
  .locator('section', { hasText: 'Bill of material and route' })
  .first()
  .innerText()
check(
  'bill of material lists components and route operations',
  // The cost-basis tag is CSS-uppercased, so match without regard to case.
  ['RAW-BLU', 'PKG-CLAM-PINT', 'PKG-CTN-RSC-12', 'on-hand average', 'pack line'].every((s) =>
    bomText.toLowerCase().includes(s.toLowerCase()),
  ),
  bomText.replace(/\s+/g, ' ').slice(0, 200),
)

// A consumable measured in fractions of a roll must not round to zero against
// a real cost — that reads as broken data rather than a small number.
check(
  'small BOM quantities keep their precision',
  /0\.00025/.test(bomText) && /\$0\.00[1-9]\d/.test(bomText),
  bomText.replace(/\s+/g, ' ').match(/PKG-LBL-CASE.{0,120}/)?.[0] ?? 'PKG-LBL-CASE line not found',
)

// Batch actual costing: runs of the same item on the same line must NOT all
// cost the same, because they consume different lots.
const unitCosts = new Set(
  (
    await page
      .locator('section', { hasText: 'Production plan' })
      .locator('table.f-grid tbody tr td:nth-child(14)')
      .allInnerTexts()
  ).map((s) => s.trim()),
)
check(
  'runs are costed at the lots they consume, not a standard',
  unitCosts.size > 1,
  `${unitCosts.size} distinct cost-per-unit values`,
)

// The headline: the oldest blueberry lot cannot be converted before it expires
// on the two committed lines, and the plan puts a number on the loss.
const atRiskBefore = await planMoney('Material at risk')
const outputBefore = await planQuantity('Planned output')
check(
  'plan quantifies material that will expire unconverted',
  atRiskBefore > 0,
  `$${atRiskBefore.toLocaleString('en-US')} at risk`,
)

// ...and committing the co-packer recovers it. This is the demo.
await page.getByRole('button', { name: 'Show parameters' }).first().click()
await page.waitForTimeout(250)
await page.locator('label', { hasText: 'HOL-CP1' }).locator('input').check()
await page.getByRole('button', { name: 'Run inquiry', exact: true }).click()
await page.waitForTimeout(1100)

const atRiskAfter = await planMoney('Material at risk')
const outputAfter = await planQuantity('Planned output')
check(
  'enabling the co-pack line recovers the at-risk material',
  atRiskAfter === 0 && outputAfter > outputBefore,
  `$${atRiskBefore.toLocaleString('en-US')} -> $${atRiskAfter} · output ${outputBefore.toLocaleString('en-US')} -> ${outputAfter.toLocaleString('en-US')}`,
)

await page.screenshot({ path: 'verify-production-plan.png', fullPage: true })
console.log('Screenshot written to verify-production-plan.png')

// The apple-slice line is constrained by how much it has, not by shelf life —
// the contrast that shows the blueberry result is about expiry, not volume.
await planFor('FC-APL-SLC-2OZ')
check(
  'long shelf life item has nothing at risk',
  (await planMoney('Material at risk')) === 0,
  await planStat('Material at risk'),
)

// A stale item cost is surfaced rather than silently used.
const rollupText = await page
  .locator('section', { hasText: 'Cost calculation' })
  .first()
  .innerText()
check(
  'cost calculation reports the variance to the item cost record',
  /Variance to current cost/.test(rollupText) && /\+\$/.test(rollupText),
  rollupText.replace(/\s+/g, ' ').match(/Variance to current cost \S+ \([^)]+\)/)?.[0] ?? '',
)

// --- Production cost variance ----------------------------------------------
// The bridge must split calculated-vs-actual across the four cost groups, and
// each group must drill down to the component or operation lines behind it.
const prodVarTab = page
  .locator('section', { hasText: 'Cost variance analysis' })
  .first()
await prodVarTab.locator('button[aria-expanded]').first().click()
await page.waitForTimeout(300)
const prodVarText = (await prodVarTab.innerText()).replace(/\s+/g, ' ')
check(
  'variance bridge splits the four cost groups',
  ['Material (food)', 'Packaging', 'Labour', 'Overhead', 'Runs outside tolerance'].every(
    (s) => prodVarText.includes(s),
  ),
  prodVarText.slice(0, 200),
)

await prodVarTab.getByRole('button', { name: 'Expand Packaging' }).click()
await page.waitForTimeout(250)
check(
  'packaging drills down to its component lines',
  ((await prodVarTab.innerText()).match(/PKG-CUP-2OZ/g) ?? []).length > 0,
)

await page.screenshot({ path: 'verify-production-variance.png', fullPage: true })
console.log('Screenshot written to verify-production-variance.png')

// --- Copilot ----------------------------------------------------------------
// The written analysis is composed from the same result the grids render, so
// it must quote the item and end with actions, and carry the caution line.
await page.getByRole('button', { name: 'Copilot', exact: true }).click()
await page.waitForTimeout(1400)
const copilotText = (
  await page.locator('aside[aria-label="Copilot"]').innerText()
).replace(/\s+/g, ' ')
check(
  'Copilot writes an analysis of the production activity',
  copilotText.includes('FC-APL-SLC-2OZ') &&
    copilotText.includes('Suggested actions') &&
    /AI-generated content may be incorrect/.test(copilotText),
  copilotText.slice(0, 160),
)
await page.screenshot({ path: 'verify-copilot.png', fullPage: true })
console.log('Screenshot written to verify-copilot.png')
await page.getByRole('button', { name: 'Close Copilot' }).click()
await page.waitForTimeout(200)

// Drilling a component through to its receipts closes the loop between the
// two pages.
await page.getByRole('button', { name: 'Component receipts' }).click()
await page.waitForTimeout(800)
check(
  'a component drills through to the product cost inquiry',
  (await page.locator('h1').innerText()) === 'Product cost inquiry' &&
    (await page.evaluate(() => location.hash)) === '#/product-cost?item=RAW-APL-HC',
  await page.evaluate(() => location.hash),
)

// --- Standalone chrome ------------------------------------------------------
// ?embed=1 drops the ribbon for hosting inside D365; ?embed=0 keeps it, and
// its navigation pane must route between the two inquiries.
await page.goto(`${base}/?embed=0#/product-cost`, { waitUntil: 'networkidle' })
await page.waitForTimeout(300)
check(
  'embed=0 keeps the bluestem ribbon',
  (await page.getByText('Finance and Operations', { exact: true }).count()) ===
    1 && (await page.locator('h1').innerText()) === 'Product cost inquiry',
)

await page.getByRole('button', { name: 'Expand the navigation pane' }).click()
await page.waitForTimeout(250)
await page
  .getByRole('button', { name: 'Production cost inquiry', exact: true })
  .click()
await page.waitForTimeout(500)
check(
  'navigation pane opens the production cost inquiry',
  (await page.locator('h1').innerText()) === 'Production cost inquiry' &&
    (await page.evaluate(() => location.hash)) === '#/production-cost',
)

await page.goto(`${base}/?embed=1#/product-cost`, { waitUntil: 'networkidle' })
await page.waitForTimeout(300)
check(
  'embed=1 drops the ribbon for hosting inside F&SC',
  (await page.getByText('Finance and Operations', { exact: true }).count()) === 0 &&
    (await page.locator('h1').innerText()) === 'Product cost inquiry',
)

check('no console/page errors', errors.length === 0, errors.join(' ; '))

await browser.close()

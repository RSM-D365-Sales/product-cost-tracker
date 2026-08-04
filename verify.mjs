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

await runFor('F440')

const rowCount = await page.locator('table.f-grid tbody tr').count()
check('grid returns rows', rowCount > 0, `${rowCount} tbody rows`)

// Three receipts of F440 from R1002 Davis Enterprises at the SAME $2.35 FOB
// price that land at three different costs. This is the demo's headline.
for (const a of [
  { order: 'PO-000241', receipt: 'PR-104812', qty: '42,000', fob: '$2.35', aoc: '$0.42', landed: '$2.77' },
  { order: 'PO-000258', receipt: 'PR-105196', qty: '38,000', fob: '$2.35', aoc: '$0.31', landed: '$2.66' },
  { order: 'PO-000273', receipt: 'PR-105644', qty: '40,000', fob: '$2.35', aoc: '$0.55', landed: '$2.90' },
]) {
  await checkAnchor(a)
}

// Every raw-material receipt lands in site 2 / warehouse 24. Columns 1 and 2
// are the select radio and the expander, so site is the 8th cell.
const siteCells = await page
  .locator('table.f-grid tbody tr td:nth-child(8)')
  .allInnerTexts()
const whsCells = await page
  .locator('table.f-grid tbody tr td:nth-child(9)')
  .allInnerTexts()
check(
  'raw material received into site 2 / warehouse 24',
  siteCells.length > 0 &&
    siteCells.every((s) => s.trim() === '2') &&
    whsCells.every((s) => s.trim() === '24'),
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

// --- Finished goods --------------------------------------------------------
// The produced items are reported as finished against production orders, and
// each run must carry the actual cost of the avocado batch it consumed.
await runFor('FG816')

const fgRows = await page.locator('table.f-grid tbody tr').count()
check('FG816 returns production rows', fgRows > 0, `${fgRows} tbody rows`)

for (const a of [
  { order: 'P000318', receipt: 'PJ-000318', qty: '12,400', fob: '$6.93', aoc: '$1.00', landed: '$7.93' },
  { order: 'P000341', receipt: 'PJ-000341', qty: '11,200', fob: '$6.65', aoc: '$0.97', landed: '$7.62' },
  { order: 'P000369', receipt: 'PJ-000369', qty: '12,000', fob: '$7.25', aoc: '$1.04', landed: '$8.29' },
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
  detail.includes('F440-26061A') && detail.includes('$6.93'),
  detail.replace(/\s+/g, ' ').slice(0, 160),
)

await page.screenshot({ path: 'verify-production.png', fullPage: true })
console.log('Screenshot written to verify-production.png')

// --- Cost trend ------------------------------------------------------------
await runFor('F440')
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
// rows, and must NOT be receiving into the focus items' warehouse 24 only —
// that is what gives the site/warehouse filters something to do.
await runFor('PKG101')
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
// Reached through the navigation pane, so the routing is exercised too rather
// than jumping straight to the hash.
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
await planFor('FG816')
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
  /EXPIRING|AVAILABLE/.test(batchTable) && /F440-\d{5}[A-Z]/.test(batchTable),
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
  ['F440', 'PKG420', 'PKG430', 'on-hand average', 'pack line'].every((s) =>
    bomText.toLowerCase().includes(s.toLowerCase()),
  ),
  bomText.replace(/\s+/g, ' ').slice(0, 200),
)

// A consumable measured in fractions of a roll must not round to zero against
// a real cost — that reads as broken data rather than a small number.
check(
  'small BOM quantities keep their precision',
  /0\.00025/.test(bomText) && /\$0\.0044/.test(bomText),
  bomText.replace(/\s+/g, ' ').match(/PKG305[^\n]*/)?.[0] ?? 'PKG305 line not found',
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

// The headline: the oldest avocado lot cannot be converted before it expires
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
await page.locator('label', { hasText: 'PL-CP1' }).locator('input').check()
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

// The canned line is constrained by how much it has, not by shelf life — the
// contrast that shows the avocado result is about expiry, not volume.
await planFor('FG841')
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

// Drilling a component through to its receipts closes the loop between the
// two pages.
await page.getByRole('button', { name: 'Component receipts' }).click()
await page.waitForTimeout(800)
check(
  'a component drills through to the product cost inquiry',
  (await page.locator('h1').innerText()) === 'Product cost inquiry' &&
    (await page.evaluate(() => location.hash)) === '#/product-cost?item=RAW541',
  await page.evaluate(() => location.hash),
)

check('no console/page errors', errors.length === 0, errors.join(' ; '))

await browser.close()

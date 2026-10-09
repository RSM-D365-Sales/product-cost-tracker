/**
 * Pre-demo check for the live items: is the proxy up, does every entity bind,
 * and what does each item in web/src/data/liveItems.ts actually have in
 * Dynamics 365 right now.
 *
 *   npm run dev:server            (one terminal)
 *   npm run check:live            (another)   [-- --company GOYA]
 *
 * Uses the same candidate names and binding as the app (lib/odataConfig.ts),
 * so "bound" here means "bound" in the browser. Talks to the proxy, never to
 * D365 directly — the secret stays in server/.env.
 */
import { readFileSync } from 'node:fs'
import {
  FINANCIAL_CHARGE_CODES,
  ODATA,
  OPEN_LINE_STATUSES,
  bindFields,
  candidates,
  type EntityKey,
} from '../web/src/lib/odataConfig.ts'
import { LIVE_ITEMS } from '../web/src/data/liveItems.ts'

const PROXY = (process.env.PROXY ?? 'http://localhost:8787').replace(/\/+$/, '')

function webEnv(name: string): string | undefined {
  try {
    const text = readFileSync(new URL('../web/.env', import.meta.url), 'utf8')
    const m = text.match(new RegExp(`^\\s*${name}\\s*=\\s*(.*)$`, 'm'))
    return m?.[1].trim() || undefined
  } catch {
    return undefined
  }
}

const argCompany = process.argv.indexOf('--company')
const COMPANY = (
  (argCompany > 0 ? process.argv[argCompany + 1] : undefined) ??
  webEnv('VITE_LIVE_COMPANY') ??
  webEnv('VITE_COMPANY') ??
  'USMF'
).toLowerCase()

const lit = (v: string) => `'${v.replace(/'/g, "''")}'`

async function query(
  set: string,
  params: Record<string, string>,
): Promise<{ status: number; rows: Record<string, unknown>[]; body: string }> {
  const qs = new URLSearchParams({ 'cross-company': 'true', ...params })
  const res = await fetch(`${PROXY}/api/odata/${set}?${qs}`, {
    headers: { Accept: 'application/json' },
  })
  const body = await res.text()
  if (!res.ok) return { status: res.status, rows: [], body }
  const json = JSON.parse(body) as { value?: Record<string, unknown>[] }
  return { status: res.status, rows: json.value ?? [], body }
}

const companyFilter = (f?: string) =>
  [`dataAreaId eq ${lit(COMPANY)}`, f].filter(Boolean).join(' and ')

let failures = 0
const fail = (msg: string) => {
  failures++
  console.log(`  ✗ ${msg}`)
}

async function main() {
  // --- 1. Proxy ------------------------------------------------------------
  console.log(`\nProxy  ${PROXY}`)
  let health: { configured?: boolean; d365Url?: string | null }
  try {
    health = (await (await fetch(`${PROXY}/api/health`)).json()) as typeof health
  } catch {
    console.log('  ✗ not reachable — start it with: npm run dev:server\n')
    process.exit(1)
  }
  if (!health.configured) {
    console.log('  ✗ running, but server/.env is incomplete (D365_URL / AZURE_*)\n')
    process.exit(1)
  }
  console.log(`  ✓ ${health.d365Url}   company ${COMPANY.toUpperCase()}`)

  // --- 2. Entity binding ---------------------------------------------------
  console.log('\nEntities')
  const bound: Partial<Record<EntityKey, { set: string; f: Record<string, string> }>> = {}
  for (const key of Object.keys(ODATA) as EntityKey[]) {
    const entity = ODATA[key]
    let done = false
    for (const set of candidates(entity.set)) {
      const r = await query(set, { $top: '1' })
      if (r.status === 404) continue
      if (r.status !== 200) {
        fail(`${key}: ${set} returned HTTP ${r.status} ${r.body.slice(0, 200)}`)
        done = true
        break
      }
      done = true
      const record = r.rows[0]
      if (!record) {
        console.log(`  ~ ${key.padEnd(22)} ${set} — no records anywhere; names unverified`)
        const f: Record<string, string> = {}
        for (const [k, spec] of Object.entries(entity.fields)) f[k] = candidates(spec)[0]
        bound[key] = { set, f }
        break
      }
      const present = new Set(Object.keys(record).filter((k) => !k.startsWith('@')))
      const { fields, missing } = bindFields(entity, present)
      const unbound = Object.entries(fields).filter(([, v]) => !v).map(([k]) => k)
      if (missing.length) {
        fail(`${key}: ${set} is missing required ${missing.join(', ')}`)
        console.log(`      exposes: ${[...present].sort().join(', ')}`)
      } else {
        console.log(
          `  ✓ ${key.padEnd(22)} ${set}` +
            (unbound.length ? `   (not exposed: ${unbound.join(', ')})` : ''),
        )
      }
      bound[key] = { set, f: fields }
      break
    }
    if (!done) {
      if (entity.optional) {
        console.log(`  ~ ${key.padEnd(22)} not found (optional) — tried ${candidates(entity.set).join(', ')}`)
      } else {
        fail(`${key}: none of ${candidates(entity.set).join(', ')} exist`)
      }
    }
  }

  // --- 3. The live items ---------------------------------------------------
  const rp = bound.releasedProducts
  const prl = bound.productReceiptLines
  const pol = bound.purchaseOrderLines
  if (!rp || !prl || !pol) {
    console.log(`\n${failures} problem(s) — fix the entities above first.\n`)
    process.exit(1)
  }

  console.log(`\nLive items in ${COMPANY.toUpperCase()}`)
  console.log('  item    released  sales    cost     receipts  open lines  name')
  for (const item of LIVE_ITEMS) {
    const p = await query(rp.set, {
      $filter: companyFilter(`${rp.f.itemNumber} eq ${lit(item.itemNumber)}`),
      $top: '1',
    })
    const prod = p.rows[0]
    if (!prod) {
      fail(`${item.itemNumber} is not released to ${COMPANY.toUpperCase()}`)
      continue
    }
    const [rec, lines] = await Promise.all([
      query(prl.set, {
        $filter: companyFilter(`${prl.f.itemNumber} eq ${lit(item.itemNumber)}`),
        $select: prl.f.productReceiptNumber,
      }),
      query(pol.set, {
        $filter: companyFilter(`${pol.f.itemNumber} eq ${lit(item.itemNumber)}`),
      }),
    ])
    const open = pol.f.lineStatus
      ? lines.rows.filter((l) => OPEN_LINE_STATUSES.includes(String(l[pol.f.lineStatus])))
      : lines.rows
    const money = (v: unknown) => (v == null ? '—' : Number(v).toFixed(2)).padStart(7)
    console.log(
      `  ${item.itemNumber.padEnd(7)} yes     ${money(prod[rp.f.salesPrice])}  ${money(
        rp.f.costPrice ? prod[rp.f.costPrice] : null,
      )}  ${String(rec.rows.length).padStart(8)}  ${String(open.length).padStart(10)}  ${String(
        prod[rp.f.productName] ?? '',
      )}`,
    )
  }

  if (FINANCIAL_CHARGE_CODES.length === 0) {
    console.log(
      '\n  note: FINANCIAL_CHARGE_CODES is empty, so every PO charge counts as add-on cost.\n' +
        '        List the financial codes in web/src/lib/odataConfig.ts if any charge capitalises into inventory.',
    )
  }

  console.log(
    failures
      ? `\n${failures} problem(s) found.\n`
      : '\nAll checks passed. An item with 0 receipts and 0 open lines will run empty until a PO is created.\n',
  )
  process.exit(failures ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

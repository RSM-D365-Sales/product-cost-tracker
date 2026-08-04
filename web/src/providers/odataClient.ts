import { ProviderError } from './types'

/**
 * Thin OData v4 client that talks to the Node proxy, never to F&O directly.
 *
 * F&O's OData endpoint does not emit CORS headers, so a browser cannot call it
 * from another origin no matter how the token is obtained. The proxy also keeps
 * the service-principal secret out of the bundle, which is the more important
 * of the two reasons.
 */

const API_BASE = (import.meta.env.VITE_API_BASE ?? '/api').replace(/\/+$/, '')
const COMPANY = (import.meta.env.VITE_COMPANY ?? 'USMF').toLowerCase()

/** Escapes a string literal for an OData filter (single quotes are doubled). */
export function lit(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

/** `A eq 'x' or A eq 'y' …` — used instead of `in` for broader F&O compatibility. */
export function anyOf(field: string, values: readonly string[]): string {
  if (values.length === 0) return 'false'
  return `(${values.map((v) => `${field} eq ${lit(v)}`).join(' or ')})`
}

export function and(...clauses: (string | undefined | false)[]): string {
  const kept = clauses.filter(Boolean) as string[]
  return kept.length ? kept.join(' and ') : ''
}

/** OData date literals are unquoted ISO dates. */
export function dateLit(iso: string): string {
  return iso.slice(0, 10)
}

export interface QueryOptions {
  filter?: string
  select?: string[]
  orderby?: string
  top?: number
  signal?: AbortSignal
  /** Set false for non-company-scoped entities. */
  companyScoped?: boolean
}

interface ODataPage<T> {
  value: T[]
  '@odata.nextLink'?: string
}

/**
 * Runs a query and follows server-driven paging to completion.
 *
 * `configKey` is only used to make failures actionable — a 404 on an entity set
 * points straight at the key in odataConfig.ts that needs correcting.
 */
export async function odataQuery<T = Record<string, unknown>>(
  entitySet: string,
  opts: QueryOptions = {},
  configKey?: string,
): Promise<T[]> {
  const params = new URLSearchParams()

  const companyScoped = opts.companyScoped !== false
  const filter = and(
    companyScoped ? `dataAreaId eq ${lit(COMPANY)}` : undefined,
    opts.filter,
  )

  if (filter) params.set('$filter', filter)
  if (opts.select?.length) params.set('$select', opts.select.join(','))
  if (opts.orderby) params.set('$orderby', opts.orderby)
  if (opts.top) params.set('$top', String(opts.top))
  if (companyScoped) params.set('cross-company', 'true')

  const rows: T[] = []
  let url = `${API_BASE}/odata/${entitySet}?${params.toString()}`

  // Bounded so a mis-specified filter can't spin forever against a big table.
  for (let page = 0; page < 40; page++) {
    const res = await fetch(url, {
      signal: opts.signal,
      headers: { Accept: 'application/json' },
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new ProviderError(
        res.status === 404
          ? `Entity set "${entitySet}" was not found in this environment.`
          : `OData request to "${entitySet}" failed (HTTP ${res.status}).`,
        configKey
          ? `Correct ODATA.${configKey} in web/src/lib/odataConfig.ts, then re-run. ${truncate(body)}`
          : truncate(body),
        res.status,
      )
    }

    const page_ = (await res.json()) as ODataPage<T>
    rows.push(...(page_.value ?? []))

    const next = page_['@odata.nextLink']
    if (!next) break

    // F&O returns an absolute nextLink pointing at the F&O host; rewrite it
    // back through the proxy so the browser keeps talking to one origin.
    url = `${API_BASE}/odata/next?url=${encodeURIComponent(next)}`
  }

  return rows
}

function truncate(s: string, max = 300): string {
  const clean = s.replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max)}…` : clean
}

/** Splits a key list into chunks so filter strings stay under URL length limits. */
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

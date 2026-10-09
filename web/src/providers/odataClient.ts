import { ProviderError } from './types'
import { demoKey } from '../lib/demoKey'

/**
 * Thin OData v4 client that talks to the Node proxy, never to F&O directly.
 *
 * F&O's OData endpoint does not emit CORS headers, so a browser cannot call it
 * from another origin no matter how the token is obtained. The proxy also keeps
 * the service-principal secret out of the bundle, which is the more important
 * of the two reasons.
 */

const API_BASE = (import.meta.env.VITE_API_BASE ?? '/api').replace(/\/+$/, '')

/**
 * The legal entity live queries run against. VITE_LIVE_COMPANY exists for the
 * hybrid provider, where the page header keeps the demo company and only the
 * live items are read from a real one.
 */
export const LIVE_COMPANY = (
  import.meta.env.VITE_LIVE_COMPANY ||
  import.meta.env.VITE_COMPANY ||
  'USMF'
).toUpperCase()
const COMPANY = LIVE_COMPANY.toLowerCase()

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

/**
 * F&O exposes dates as Edm.DateTimeOffset, which only compares against a full
 * unquoted timestamp — a bare 2026-01-01 is rejected. `end` widens an
 * inclusive upper bound to the last second of the day.
 */
export function dateLit(iso: string, end = false): string {
  return `${iso.slice(0, 10)}T${end ? '23:59:59' : '00:00:00'}Z`
}

export interface QueryOptions {
  filter?: string
  select?: string[]
  orderby?: string
  top?: number
  signal?: AbortSignal
  /** Set false for non-company-scoped entities. */
  companyScoped?: boolean
  /**
   * Query across every legal entity, without the company filter. Only used to
   * sample one record for field-name resolution, which must work even when the
   * demo company has no rows of that entity yet.
   */
  anyCompany?: boolean
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

  const companyScoped = opts.companyScoped !== false && !opts.anyCompany
  // The caller's filter is parenthesised: `and` binds tighter than `or`, so an
  // unwrapped `A or B` would escape the company clause.
  const filter = and(
    companyScoped ? `dataAreaId eq ${lit(COMPANY)}` : undefined,
    opts.filter ? `(${opts.filter})` : undefined,
  )

  if (filter) params.set('$filter', filter)
  if (opts.select?.length) params.set('$select', opts.select.join(','))
  if (opts.orderby) params.set('$orderby', opts.orderby)
  if (opts.top) params.set('$top', String(opts.top))
  if (companyScoped || opts.anyCompany) params.set('cross-company', 'true')

  const rows: T[] = []
  let url = `${API_BASE}/odata/${entitySet}?${params.toString()}`

  // Bounded so a mis-specified filter can't spin forever against a big table.
  for (let page = 0; page < 40; page++) {
    let res: Response
    try {
      res = await fetch(url, {
        signal: opts.signal,
        headers: {
          Accept: 'application/json',
          ...(demoKey ? { 'X-Demo-Key': demoKey } : {}),
        },
      })
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') throw e
      throw proxyDown()
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      // The Vite dev proxy answers 5xx with an empty or ECONNREFUSED body when
      // nothing is listening on the API port.
      if (res.status >= 500 && (!body.trim() || /ECONNREFUSED/i.test(body))) {
        throw proxyDown()
      }
      // The hosted proxy (functions/api) refuses before reaching D365 without
      // its access key, or when the deployment has no connection set up.
      if (res.status === 401) {
        throw new ProviderError(
          'Live data needs the access link.',
          'Open the live demo from the link you were given (it ends in ?key=…) — after that this browser remembers it.',
          401,
        )
      }
      if (res.status === 503) {
        throw new ProviderError(
          'This deployment is not connected to Dynamics 365.',
          'Live items run on the live deployment (or locally with "npm run dev:all"). The demo catalogue works here as normal.',
          503,
        )
      }
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

function proxyDown(): ProviderError {
  return new ProviderError(
    'Cannot reach the Dynamics 365 connection.',
    'The proxy that signs in to Finance and Supply Chain is not running. ' +
      'Start it with "npm run dev:server" (or "npm run dev:all"), then run the inquiry again.',
    503,
  )
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

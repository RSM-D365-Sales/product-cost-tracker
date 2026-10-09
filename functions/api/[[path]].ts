/**
 * Cloudflare Pages Function — the hosted twin of server/ (the local Express
 * proxy), serving /api/* for the live (hybrid) deployment.
 *
 * Same two jobs as the local proxy: keep the Azure AD client secret out of the
 * browser, and get around F&O's lack of CORS headers. Because this one is on
 * the internet, it adds three guards, all FAIL-CLOSED:
 *
 *   1. A gate, one of:
 *      - ALLOW_PUBLIC=true: no gate. Anyone who can reach the site can read
 *        through the proxy, within guards 2–4. Must be set explicitly.
 *      - DEMO_KEY (secret, 32+ chars): every /api/odata request must carry it
 *        in the X-Demo-Key header. The app reads it from the link it was
 *        opened with (…/?key=…). A shareable secret link — no login screen,
 *        nothing to set up beyond the variable. Rotate it if the link leaks.
 *      - Cloudflare Access (ACCESS_TEAM_DOMAIN + ACCESS_AUD): the request must
 *        carry an Access JWT for that application, signature verified here.
 *      With none of these configured the function refuses everything, so a
 *      half-configured deployment cannot leak tenant data by accident.
 *   4. Company scope (D365_COMPANY): every query is confined to that legal
 *      entity server-side, whatever filter the caller sends, so the proxy
 *      cannot be used to read the environment's other companies.
 *   2. An entity allowlist: only the entity sets named in
 *      web/src/lib/odataConfig.ts, so the service account cannot be used to
 *      browse customers, vendors' bank details or anything else.
 *   3. Read-only, known query options only: GET, and $filter / $select /
 *      $orderby / $top / cross-company. nextLinks must point back at the same
 *      environment and an allowlisted set.
 *
 * Configuration (Pages project → Settings → Variables and Secrets, runtime):
 *   D365_URL, AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET (secret),
 *   D365_COMPANY, and a gate: ALLOW_PUBLIC=true, DEMO_KEY (secret), or
 *   ACCESS_TEAM_DOMAIN + ACCESS_AUD.
 * The public project (product-tracker.rsmd365.com) has none of these set, so
 * there this function answers 503 and the site stays on demo data.
 */
import { ODATA, candidates } from '../../web/src/lib/odataConfig'

interface Env {
  D365_URL?: string
  AZURE_TENANT_ID?: string
  AZURE_CLIENT_ID?: string
  AZURE_CLIENT_SECRET?: string
  ACCESS_TEAM_DOMAIN?: string
  ACCESS_AUD?: string
  DEMO_KEY?: string
  ALLOW_PUBLIC?: string
  D365_COMPANY?: string
}

/** Shorter than this and a key is guessable; treated as not configured. */
const MIN_KEY_LENGTH = 32

/** The slice of the Pages Functions context this file uses. */
interface Context {
  request: Request
  env: Env
}

const ALLOWED_SETS = new Set(
  Object.values(ODATA).flatMap((e) => [...candidates(e.set)]),
)
const ALLOWED_PARAMS = new Set(['$filter', '$select', '$orderby', '$top', 'cross-company'])
const MAX_TOP = 1000

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })

export async function onRequest({ request, env }: Context): Promise<Response> {
  const url = new URL(request.url)
  const path = url.pathname.replace(/\/+$/, '')

  if (request.method !== 'GET') return json(405, { error: 'Read-only.' })

  const d365Url = (env.D365_URL ?? '').replace(/\/+$/, '')
  const configured = Boolean(
    d365Url && env.AZURE_TENANT_ID && env.AZURE_CLIENT_ID && env.AZURE_CLIENT_SECRET,
  )
  const demoKey = env.DEMO_KEY ?? ''
  const keyGate = demoKey.length >= MIN_KEY_LENGTH
  const accessGate = Boolean(env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD)
  const isPublic = env.ALLOW_PUBLIC?.trim().toLowerCase() === 'true'
  const gated = isPublic || keyGate || accessGate
  const company = (env.D365_COMPANY ?? '').trim().toLowerCase()

  // Health says only whether this deployment is wired up — never the URL or
  // company, since on production it is reachable by anyone.
  if (path === '/api/health') {
    return json(200, { ok: true, configured: configured && gated })
  }

  if (!path.startsWith('/api/odata/')) return json(404, { error: 'Not found.' })

  if (!configured || !gated) {
    return json(503, {
      error: 'The live Dynamics 365 connection is not configured on this deployment.',
    })
  }
  // A public proxy must at least be confined to one company.
  if (isPublic && !company) {
    return json(503, { error: 'ALLOW_PUBLIC requires D365_COMPANY to be set.' })
  }

  // Either gate admits the request; each is checked only when configured.
  const byKey =
    !isPublic &&
    keyGate &&
    (await sameSecret(request.headers.get('X-Demo-Key') ?? '', demoKey))
  const byAccess =
    !isPublic &&
    !byKey &&
    accessGate &&
    (await verifyAccess(request, env.ACCESS_TEAM_DOMAIN!, env.ACCESS_AUD!)) !== null
  if (!isPublic && !byKey && !byAccess) return json(401, { error: 'Not authorised.' })

  // --- Build the upstream URL ------------------------------------------------
  let upstream: URL
  if (path === '/api/odata/next') {
    try {
      upstream = new URL(url.searchParams.get('url') ?? '')
    } catch {
      return json(400, { error: 'Invalid nextLink.' })
    }
    const set = upstream.pathname.match(/^\/data\/([A-Za-z0-9_]+)$/)?.[1]
    if (upstream.origin !== new URL(d365Url).origin || !set || !ALLOWED_SETS.has(set)) {
      return json(400, { error: 'nextLink must point at an allowed entity in the configured environment.' })
    }
    for (const k of upstream.searchParams.keys()) {
      if (!ALLOWED_PARAMS.has(k) && k !== '$skiptoken') {
        return json(400, { error: `Query option ${k} is not allowed.` })
      }
    }
    // A genuine nextLink echoes the scoped filter this proxy sent; anything
    // else is a hand-made URL trying to page through another company.
    if (company && !isScoped(upstream.searchParams.get('$filter') ?? '', company)) {
      return json(400, { error: 'nextLink is outside the configured company.' })
    }
  } else {
    const set = path.slice('/api/odata/'.length)
    if (!/^[A-Za-z0-9_]+$/.test(set) || !ALLOWED_SETS.has(set)) {
      return json(403, { error: `Entity set "${set}" is not available through this proxy.` })
    }
    upstream = new URL(`${d365Url}/data/${set}`)
    for (const [k, v] of url.searchParams) {
      if (!ALLOWED_PARAMS.has(k)) return json(400, { error: `Query option ${k} is not allowed.` })
      if (k === '$top' && !(Number(v) > 0 && Number(v) <= MAX_TOP)) {
        return json(400, { error: `$top must be between 1 and ${MAX_TOP}.` })
      }
      upstream.searchParams.set(k, v)
    }
    if (company) {
      const filter = upstream.searchParams.get('$filter') ?? ''
      if (filter && !balanced(filter)) {
        return json(400, { error: 'Unbalanced parentheses or quotes in $filter.' })
      }
      upstream.searchParams.set('$filter', scope(filter, company))
      upstream.searchParams.set('cross-company', 'true')
    }
  }

  // --- Forward with the service principal's token -----------------------------
  try {
    let res = await d365Get(upstream.toString(), env, d365Url)
    if (res.status === 401) {
      tokenCache = null
      res = await d365Get(upstream.toString(), env, d365Url)
    }
    return new Response(res.body, {
      status: res.status,
      headers: {
        'content-type': res.headers.get('content-type') ?? 'application/json',
        'cache-control': 'no-store',
      },
    })
  } catch (e) {
    return json(502, {
      error: 'Upstream request to D365 failed.',
      detail: e instanceof Error ? e.message : String(e),
    })
  }
}

// ---------------------------------------------------------------------------
// Company scope
// ---------------------------------------------------------------------------

const companyClause = (company: string): string =>
  `dataAreaId eq '${company.replace(/'/g, "''")}'`

/** `dataAreaId eq 'c' and (<caller's filter>)`. Only call on a balanced filter. */
function scope(filter: string, company: string): string {
  return filter ? `${companyClause(company)} and (${filter})` : companyClause(company)
}

/**
 * True when parentheses balance and never close more than they opened, outside
 * string literals, and no literal is left open. That is what makes wrapping
 * the caller's filter in `( … )` safe: it cannot close our parenthesis early
 * and `or` its way past the company clause.
 */
function balanced(filter: string): boolean {
  let depth = 0
  let inString = false
  for (const ch of filter) {
    // OData escapes a quote inside a literal by doubling it, which toggles
    // twice and leaves the state where it was — no special case needed.
    if (ch === "'") inString = !inString
    else if (!inString && ch === '(') depth++
    else if (!inString && ch === ')' && --depth < 0) return false
  }
  return depth === 0 && !inString
}

/** True for exactly the shape scope() produces, for this company. */
function isScoped(filter: string, company: string): boolean {
  const head = companyClause(company)
  if (filter.toLowerCase() === head.toLowerCase()) return true
  const prefix = `${head} and (`
  if (!filter.toLowerCase().startsWith(prefix.toLowerCase()) || !filter.endsWith(')')) {
    return false
  }
  return balanced(filter.slice(prefix.length, -1))
}

/**
 * Compares a presented key with the configured one without leaking, through
 * timing, how many leading characters matched: both are hashed first, so the
 * comparison always runs over 32 bytes.
 */
async function sameSecret(presented: string, expected: string): Promise<boolean> {
  if (!presented) return false
  const enc = new TextEncoder()
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(presented)),
    crypto.subtle.digest('SHA-256', enc.encode(expected)),
  ])
  const x = new Uint8Array(a)
  const y = new Uint8Array(b)
  let diff = 0
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i]
  return diff === 0
}

// ---------------------------------------------------------------------------
// Azure AD client credentials, cached per isolate
// ---------------------------------------------------------------------------

let tokenCache: { token: string; expiresAt: number } | null = null

async function d365Get(target: string, env: Env, d365Url: string): Promise<Response> {
  const token = await accessToken(env, d365Url)
  return fetch(target, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  })
}

async function accessToken(env: Env, d365Url: string): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt - 60_000) return tokenCache.token
  const res = await fetch(
    `https://login.microsoftonline.com/${env.AZURE_TENANT_ID}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: env.AZURE_CLIENT_ID!,
        client_secret: env.AZURE_CLIENT_SECRET!,
        scope: `${d365Url}/.default`,
      }),
    },
  )
  if (!res.ok) {
    // Azure's error body can echo the client id; keep it out of the response.
    throw new Error(`Azure AD token request failed (HTTP ${res.status}).`)
  }
  const body = (await res.json()) as { access_token: string; expires_in: number }
  tokenCache = { token: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 }
  return body.access_token
}

// ---------------------------------------------------------------------------
// Cloudflare Access JWT verification
// ---------------------------------------------------------------------------

interface Jwk {
  kid: string
  kty: string
  n: string
  e: string
  alg?: string
}

let certCache: { keys: Jwk[]; fetchedAt: number } | null = null

async function accessKeys(teamDomain: string, refresh = false): Promise<Jwk[]> {
  if (!refresh && certCache && Date.now() - certCache.fetchedAt < 3_600_000) {
    return certCache.keys
  }
  const res = await fetch(`https://${teamDomain}.cloudflareaccess.com/cdn-cgi/access/certs`)
  if (!res.ok) throw new Error(`Access certs HTTP ${res.status}`)
  const body = (await res.json()) as { keys: Jwk[] }
  certCache = { keys: body.keys, fetchedAt: Date.now() }
  return body.keys
}

const b64url = (s: string): Uint8Array<ArrayBuffer> => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '='))
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

/**
 * Returns the signed-in email when the request carries a valid Access JWT for
 * this application, otherwise null. Checks signature (RS256 against the team's
 * published keys), audience, issuer and expiry.
 */
export async function verifyAccess(
  request: Request,
  teamDomain: string,
  aud: string,
): Promise<string | null> {
  const token =
    request.headers.get('Cf-Access-Jwt-Assertion') ??
    request.headers.get('cookie')?.match(/(?:^|;\s*)CF_Authorization=([^;]+)/)?.[1]
  if (!token) return null

  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    const header = JSON.parse(new TextDecoder().decode(b64url(parts[0]))) as { kid?: string; alg?: string }
    const claims = JSON.parse(new TextDecoder().decode(b64url(parts[1]))) as {
      aud?: string | string[]
      iss?: string
      exp?: number
      nbf?: number
      email?: string
    }
    if (header.alg !== 'RS256') return null

    let jwk = (await accessKeys(teamDomain)).find((k) => k.kid === header.kid)
    // Keys rotate; one refresh before giving up.
    if (!jwk) jwk = (await accessKeys(teamDomain, true)).find((k) => k.kid === header.kid)
    if (!jwk) return null

    const key = await crypto.subtle.importKey(
      'jwk',
      { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    )
    const ok = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      b64url(parts[2]),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
    )
    if (!ok) return null

    const now = Math.floor(Date.now() / 1000)
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
    if (!audiences.includes(aud)) return null
    if (claims.iss !== `https://${teamDomain}.cloudflareaccess.com`) return null
    if (!claims.exp || claims.exp < now) return null
    if (claims.nbf && claims.nbf > now + 60) return null

    return claims.email ?? 'service-token'
  } catch {
    return null
  }
}

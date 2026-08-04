import express from 'express'
import type { NextFunction, Request, Response } from 'express'
import { config, isConfigured } from './config.js'
import { d365Fetch, describeEntity, listEntitySets } from './d365.js'

/**
 * Backend proxy for the Product cost inquiry.
 *
 * Exists for two reasons, in order of importance:
 *   1. The Azure AD client secret must never reach the browser bundle.
 *   2. F&O's OData endpoint does not send CORS headers, so a browser cannot
 *      call it cross-origin regardless of how the token was obtained.
 *
 * It stays deliberately thin — auth and passthrough. The join and allocation
 * logic lives in the web app (or in X++ for the custom-service path) so there
 * is exactly one implementation of the cost maths, not two.
 */

const app = express()
app.use(express.json({ limit: '1mb' }))

// --- CORS -------------------------------------------------------------------
// Only needed when the SPA is served from a different origin than this proxy.
// In dev the Vite proxy makes everything same-origin, so this is a no-op.
app.use((req: Request, res: Response, next: NextFunction) => {
  const origin = req.headers.origin
  if (origin && config.allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  }
  if (req.method === 'OPTIONS') {
    res.sendStatus(204)
    return
  }
  next()
})

// --- Health -----------------------------------------------------------------

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({
    ok: true,
    configured: isConfigured(),
    company: config.company,
    // Never echo the secret; the URL is safe and useful for confirming which
    // environment a demo is pointed at.
    d365Url: isConfigured() ? config.d365Url : null,
  })
})

// --- OData passthrough ------------------------------------------------------

/**
 * Follows an @odata.nextLink. Kept separate from the generic route because the
 * link is an absolute F&O URL and must be validated before being fetched —
 * without the origin check this would be an open proxy.
 */
app.get('/api/odata/next', async (req: Request, res: Response) => {
  const url = String(req.query.url ?? '')
  if (!url.startsWith(`${config.d365Url}/`)) {
    res.status(400).json({
      error: 'nextLink must point at the configured D365 environment.',
    })
    return
  }
  await forward(url, res)
})

app.get('/api/odata/:entitySet', async (req: Request, res: Response) => {
  const entitySet = req.params.entitySet
  if (!/^[A-Za-z0-9_]+$/.test(entitySet)) {
    res.status(400).json({ error: 'Invalid entity set name.' })
    return
  }

  const qs = new URLSearchParams(
    req.query as Record<string, string>,
  ).toString()
  await forward(`${config.d365Url}/data/${entitySet}${qs ? `?${qs}` : ''}`, res)
})

async function forward(url: string, res: Response): Promise<void> {
  try {
    const upstream = await d365Fetch(url)
    const body = await upstream.text()
    res
      .status(upstream.status)
      .type(upstream.headers.get('content-type') ?? 'application/json')
      .send(body)
  } catch (e) {
    res.status(502).json({
      error: 'Upstream request to D365 failed.',
      detail: e instanceof Error ? e.message : String(e),
    })
  }
}

// --- Metadata probe ---------------------------------------------------------
// Used to reconcile web/src/lib/odataConfig.ts against a real environment.

app.get('/api/probe', async (req: Request, res: Response) => {
  try {
    const q = String(req.query.q ?? '').toLowerCase()
    const sets = await listEntitySets()
    const matches = q ? sets.filter((s) => s.toLowerCase().includes(q)) : sets
    res.json({ count: matches.length, entitySets: matches })
  } catch (e) {
    res.status(502).json({
      error: e instanceof Error ? e.message : String(e),
    })
  }
})

app.get('/api/probe/:entitySet', async (req: Request, res: Response) => {
  try {
    const result = await describeEntity(req.params.entitySet)
    res.json({
      entitySet: req.params.entitySet,
      ...result,
      note: result.sampled
        ? 'Field names read from one live record.'
        : 'The entity set exists but has no records in this company, so no field names could be sampled.',
    })
  } catch (e) {
    res.status(502).json({ error: e instanceof Error ? e.message : String(e) })
  }
})

// --- Custom service ---------------------------------------------------------

app.post('/api/service/product-cost', async (req: Request, res: Response) => {
  try {
    const { company, ...query } = req.body ?? {}

    const upstream = await d365Fetch(
      `/api/services/${config.servicePath}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          [config.serviceParam]: {
            ...query,
            company: company ?? config.company,
          },
        }),
      },
    )

    const text = await upstream.text()
    if (!upstream.ok) {
      res.status(upstream.status).type('application/json').send(text)
      return
    }

    // Custom services wrap the return value; unwrap the common shapes so the
    // client always sees the contract itself.
    let payload: unknown = JSON.parse(text)
    if (payload && typeof payload === 'object') {
      const obj = payload as Record<string, unknown>
      payload = obj.$result ?? obj.result ?? obj.value ?? payload
    }
    res.json(payload)
  } catch (e) {
    res.status(502).json({
      error: 'The custom service call failed.',
      detail: e instanceof Error ? e.message : String(e),
    })
  }
})

// --- Start ------------------------------------------------------------------

app.listen(config.port, () => {
  console.log(`Product cost proxy listening on http://localhost:${config.port}`)
  if (!isConfigured()) {
    console.warn(
      '\n  D365 connection is NOT configured — /api/odata and /api/service will fail.\n' +
        '  Copy server/.env.example to server/.env and fill it in.\n' +
        '  The web app runs fine without this while VITE_DATA_PROVIDER=mock.\n',
    )
  } else {
    console.log(`  Environment: ${config.d365Url}`)
    console.log(`  Company:     ${config.company}`)
  }
})

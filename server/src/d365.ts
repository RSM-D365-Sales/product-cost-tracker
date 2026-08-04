import { config } from './config.js'
import { getAccessToken, invalidateToken } from './auth.js'

/** Authenticated fetch against the F&O environment, with one 401 retry. */
export async function d365Fetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const url = path.startsWith('http')
    ? path
    : `${config.d365Url}${path.startsWith('/') ? '' : '/'}${path}`

  const send = async (): Promise<Response> => {
    const token = await getAccessToken()
    return fetch(url, {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    })
  }

  let res = await send()

  // A 401 after a successful token acquisition usually means the token was
  // revoked or the environment restarted. Drop the cache and try once more.
  if (res.status === 401) {
    invalidateToken()
    res = await send()
  }

  return res
}

/**
 * The OData service document at /data lists every entity set as JSON.
 *
 * This is deliberately used instead of $metadata: F&O's $metadata document is
 * tens of megabytes of XML, whereas the service document is a small JSON array
 * and answers the only question the probe needs to answer — "what is this
 * entity set actually called here?".
 */
export async function listEntitySets(): Promise<string[]> {
  const res = await d365Fetch('/data')
  if (!res.ok) {
    throw new Error(
      `Could not read the OData service document (HTTP ${res.status}).`,
    )
  }
  const json = (await res.json()) as {
    value?: { name?: string; kind?: string }[]
  }
  return (json.value ?? [])
    .filter((e) => !e.kind || e.kind === 'EntitySet')
    .map((e) => e.name ?? '')
    .filter(Boolean)
    .sort()
}

/**
 * Returns the property names of an entity by reading one record.
 *
 * Cheaper and more truthful than parsing $metadata: it shows exactly what the
 * environment serialises, including any extension fields.
 */
export async function describeEntity(
  entitySet: string,
): Promise<{ fields: string[]; sampled: boolean }> {
  const res = await d365Fetch(
    `/data/${encodeURIComponent(entitySet)}?$top=1&cross-company=true`,
  )
  if (!res.ok) {
    throw new Error(
      `Could not read ${entitySet} (HTTP ${res.status}). Check the entity set name.`,
    )
  }
  const json = (await res.json()) as { value?: Record<string, unknown>[] }
  const first = json.value?.[0]
  if (!first) return { fields: [], sampled: false }

  return {
    fields: Object.keys(first)
      .filter((k) => !k.startsWith('@'))
      .sort(),
    sampled: true,
  }
}

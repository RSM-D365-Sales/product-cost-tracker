import {
  ODATA,
  bindFields,
  candidates,
  type EntityKey,
} from '../lib/odataConfig'
import { odataQuery } from './odataClient'
import { ProviderError } from './types'

/**
 * Binds the candidate names in lib/odataConfig.ts to what THIS environment
 * actually exposes, by reading one record of each entity the first time it is
 * needed.
 *
 * A sampled record is more truthful than $metadata (it shows exactly what the
 * environment serialises, extension fields included) and a great deal smaller.
 * The binding is cached for the life of the page, so the cost is one extra
 * $top=1 call per entity per session.
 */

export interface ResolvedEntity {
  key: EntityKey
  set: string
  /** Logical field -> bound property name; '' when the entity has no candidate. */
  f: Record<string, string>
  /** False when the entity had no records to sample, so names are unverified. */
  sampled: boolean
}

const cache = new Map<EntityKey, Promise<ResolvedEntity | null>>()

/**
 * Resolves an entity. Returns null only for an entity marked `optional` whose
 * set does not exist; a required entity that cannot be bound throws a
 * ProviderError naming the config key and what the entity does expose.
 */
export function resolveEntity(
  key: EntityKey,
  signal?: AbortSignal,
): Promise<ResolvedEntity | null> {
  let hit = cache.get(key)
  if (!hit) {
    hit = resolve(key, signal)
    cache.set(key, hit)
    // A failed or cancelled resolution must not poison the session — the next
    // run gets a fresh attempt.
    hit.catch(() => cache.delete(key))
  }
  return hit
}

/** resolveEntity for entities that cannot be optional. */
export async function requireEntity(
  key: EntityKey,
  signal?: AbortSignal,
): Promise<ResolvedEntity> {
  const r = await resolveEntity(key, signal)
  if (!r) throw notFound(key)
  return r
}

async function resolve(
  key: EntityKey,
  signal?: AbortSignal,
): Promise<ResolvedEntity | null> {
  const entity = ODATA[key]

  for (const set of candidates(entity.set)) {
    let sample: Record<string, unknown>[]
    try {
      sample = await odataQuery(set, { top: 1, anyCompany: true, signal }, key)
    } catch (e) {
      if (e instanceof ProviderError && e.status === 404) continue
      throw e
    }

    const record = sample[0]
    if (!record) {
      // Nothing to sample anywhere: fall back to the first candidate of every
      // field. Queries against an empty entity return nothing either way, so an
      // unverified name costs nothing here.
      const f: Record<string, string> = {}
      for (const [logical, spec] of Object.entries(entity.fields)) {
        f[logical] = candidates(spec)[0]
      }
      return { key, set, f, sampled: false }
    }

    const present = new Set(Object.keys(record).filter((k) => !k.startsWith('@')))
    const { fields, missing } = bindFields(entity, present)
    if (missing.length > 0) {
      throw new ProviderError(
        `${set} does not expose the fields this inquiry needs.`,
        `Unbound: ${missing
          .map((m) => `${m} (tried ${candidates(entity.fields[m]).join(', ')})`)
          .join('; ')}. ` +
          `The entity exposes: ${[...present].sort().join(', ')}. ` +
          `Add the right name to ODATA.${key} in web/src/lib/odataConfig.ts.`,
      )
    }

    if (import.meta.env.DEV) {
      console.info(`[odata] ${key} → ${set}`, fields)
    }
    return { key, set, f: fields, sampled: true }
  }

  if (entity.optional) return null
  throw notFound(key)
}

function notFound(key: EntityKey): ProviderError {
  return new ProviderError(
    `None of the entity sets configured for ${key} exist in this environment.`,
    `Tried ${candidates(ODATA[key].set).join(', ')}. ` +
      'Find the right one with curl "http://localhost:8787/api/probe?q=<word>" ' +
      `and add it to ODATA.${key} in web/src/lib/odataConfig.ts.`,
    404,
  )
}

import type {
  ProductionCostQuery,
  ProductionCostResult,
} from '../types/production'
import { ProviderError } from './types'

/**
 * The production cost inquiry against a live environment, deliberately not
 * written yet.
 *
 * The product cost inquiry could be guessed at because it joins four entities
 * whose names are at least stable in shape. This one is not comparable: a
 * faithful implementation has to read the active BOM version for the item and
 * site, explode it, read the route and its cost categories, read on-hand by
 * batch with dimensions, and read batch expiry dates — and the entity names,
 * the site/version effectivity rules and the on-hand aggregation all differ
 * enough between environments that a guess would be a liability rather than a
 * head start. Shipping code that silently returns the wrong cost is worse than
 * shipping none.
 *
 * lib/odataConfig.ts lists the entity sets a real implementation would need and
 * how to check them against your environment with /api/probe. Until they are
 * confirmed, run this page on VITE_DATA_PROVIDER=mock.
 */
export function productionNotImplemented(
  source: string,
): (
  query: ProductionCostQuery,
  signal?: AbortSignal,
) => Promise<ProductionCostResult> {
  return async () => {
    throw new ProviderError(
      `The production cost inquiry is not implemented for the ${source} provider.`,
      'It needs bill of material, route, on-hand-by-batch and batch expiry ' +
        'entities, whose names have not been confirmed against a live ' +
        'environment. See the PRODUCTION INQUIRY section of ' +
        'web/src/lib/odataConfig.ts, then set VITE_DATA_PROVIDER=mock in ' +
        'web/.env to run this page on demo data in the meantime.',
      501,
    )
  }
}

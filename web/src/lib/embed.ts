/**
 * Whether the app is embedded — i.e. whether it should leave out its own
 * bluestem title ribbon ("Finance and Operations" bar).
 *
 * It is NOT embedded by default: the bluestem brand guide requires the RSM
 * sponsor mark, which lives on the ribbon, on every app. When the page is
 * hosted inside a real Dynamics 365 Finance and Supply Chain environment
 * (iframe / website host control), the host already has a bar and two of them
 * reads as a mockup, so `?embed=1` drops it.
 *
 * Resolution order, first hit wins:
 *   1. `?embed=1` / `?embed=0` in the query string (survives hash navigation):
 *      `.../index.html?embed=1#/product-cost`
 *   2. The same among the hash parameters: `#/product-cost?embed=1`
 *   3. `VITE_EMBED` in web/.env, to fix a build one way or the other.
 *   4. Standalone (ribbon shown).
 *
 * Latched once at module load. The hash form is therefore sticky for the
 * session even though in-app navigation rewrites the hash parameters.
 */

function asFlag(raw: string | null | undefined): boolean | undefined {
  if (raw == null) return undefined
  const v = raw.trim().toLowerCase()
  if (['1', 'true', 'yes', 'on', 'embed'].includes(v)) return true
  if (['0', 'false', 'no', 'off'].includes(v)) return false
  return undefined
}

function resolveEmbedded(): boolean {
  if (typeof window === 'undefined') return false

  const fromSearch = asFlag(
    new URLSearchParams(window.location.search).get('embed'),
  )

  const hash = window.location.hash
  const q = hash.indexOf('?')
  const fromHash =
    q >= 0 ? asFlag(new URLSearchParams(hash.slice(q + 1)).get('embed')) : undefined

  return fromSearch ?? fromHash ?? asFlag(import.meta.env.VITE_EMBED) ?? false
}

export const isEmbedded = resolveEmbedded()

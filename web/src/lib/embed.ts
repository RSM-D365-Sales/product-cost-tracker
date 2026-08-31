/**
 * Whether the app is running embedded inside another shell — typically an
 * iframe or website host control on a Dynamics 365 Finance and Supply Chain
 * workspace. Embedded, the page must not draw its own "Finance and Operations"
 * navigation bar: the host already has one, and two of them reads as a mockup.
 *
 * Resolution order, first hit wins:
 *   1. `?embed=1` in the query string (survives hash navigation, so it is the
 *      form to use in the workspace URL): `.../index.html?embed=1#/product-cost`
 *   2. `embed=1` among the hash parameters: `#/product-cost?embed=1`
 *   3. `VITE_EMBED=1` in web/.env, for a build that is only ever embedded.
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

/**
 * Whether the app draws its own "Finance and Operations" navigation bar.
 *
 * It does NOT by default: this workspace is built to be embedded inside a real
 * Dynamics 365 Finance and Supply Chain environment (iframe / website host
 * control), where the host already has that bar and two of them reads as a
 * mockup. For a standalone demo outside D365, `?embed=0` restores the full
 * chrome — banner, page search, and the navigation pane.
 *
 * Resolution order, first hit wins:
 *   1. `?embed=0` / `?embed=1` in the query string (survives hash navigation):
 *      `.../index.html?embed=0#/product-cost`
 *   2. The same among the hash parameters: `#/product-cost?embed=0`
 *   3. `VITE_EMBED` in web/.env, to fix a build one way or the other.
 *   4. Embedded (bar hidden).
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

  return fromSearch ?? fromHash ?? asFlag(import.meta.env.VITE_EMBED) ?? true
}

export const isEmbedded = resolveEmbedded()

/**
 * The access key for a hosted live deployment (functions/api, DEMO_KEY).
 *
 * The presenter is given a link with the key on it — …/?key=… or
 * …#/product-cost?key=… — so there is no login screen. On first load the key
 * is taken off the URL (so it is not left in the address bar or in a
 * screenshot), kept in localStorage for later visits from the same browser,
 * and sent as X-Demo-Key with every /api request. The server is what enforces
 * it; this file only carries it.
 */

const STORAGE_KEY = 'product-cost-tracker.demoKey'

function fromUrl(): string | null {
  const search = new URLSearchParams(window.location.search)
  const hash = window.location.hash
  const q = hash.indexOf('?')
  const hashParams = new URLSearchParams(q >= 0 ? hash.slice(q + 1) : '')
  const key = search.get('key') ?? hashParams.get('key')
  if (!key) return null

  // Strip it from the address bar, keeping every other parameter.
  search.delete('key')
  hashParams.delete('key')
  const route = q >= 0 ? hash.slice(0, q) : hash
  const hashQs = hashParams.toString()
  const qs = search.toString()
  window.history.replaceState(
    null,
    '',
    `${window.location.pathname}${qs ? `?${qs}` : ''}${route}${hashQs ? `?${hashQs}` : ''}`,
  )
  return key
}

function load(): string | null {
  const key = fromUrl()
  try {
    if (key) window.localStorage.setItem(STORAGE_KEY, key)
    return key ?? window.localStorage.getItem(STORAGE_KEY)
  } catch {
    // Storage blocked (private window, embedded third-party frame): the key
    // still works for this page load.
    return key
  }
}

/** Read once at startup, before the router looks at the hash. */
export const demoKey: string | null = typeof window === 'undefined' ? null : load()

import { useCallback, useEffect, useState } from 'react'

/**
 * Hash routing, hand-rolled.
 *
 * Two pages do not justify a router dependency, and the hash keeps the app
 * deployable to a static host — GitHub Pages included — with no rewrite rules.
 * It also survives the corporate proxy that blocks half of npm.
 *
 * Format: `#/<page>?item=FG816`. An unrecognised or absent hash resolves to the
 * product cost inquiry, so the bare URL opens where it always did.
 */

export type PageId = 'product-cost' | 'production-cost'

export interface Page {
  id: PageId
  /** Form caption. */
  title: string
  /** Module breadcrumb above the caption. */
  moduleTrail: string
  /** Navigation pane grouping. */
  module: string
}

export const PAGES: Page[] = [
  {
    id: 'product-cost',
    title: 'Product cost inquiry',
    moduleTrail:
      'Procurement and sourcing > Inquiries and reports > Product cost inquiry',
    module: 'Procurement and sourcing',
  },
  {
    id: 'production-cost',
    title: 'Production cost inquiry',
    moduleTrail:
      'Production control > Inquiries and reports > Production cost inquiry',
    module: 'Production control',
  },
]

const DEFAULT_PAGE: PageId = 'product-cost'

export interface Route {
  pageId: PageId
  params: URLSearchParams
}

function parse(hash: string): Route {
  const raw = hash.replace(/^#\/?/, '')
  const [path, search = ''] = raw.split('?')
  const pageId = PAGES.some((p) => p.id === path) ? (path as PageId) : DEFAULT_PAGE
  return { pageId, params: new URLSearchParams(search) }
}

export function buildHash(pageId: PageId, params?: Record<string, string>): string {
  const search = new URLSearchParams(
    Object.entries(params ?? {}).filter(([, v]) => v),
  ).toString()
  return `#/${pageId}${search ? `?${search}` : ''}`
}

export function useHashRoute(): Route & {
  navigate: (pageId: PageId, params?: Record<string, string>) => void
} {
  const [route, setRoute] = useState<Route>(() => parse(window.location.hash))

  useEffect(() => {
    const onChange = () => setRoute(parse(window.location.hash))
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])

  const navigate = useCallback(
    (pageId: PageId, params?: Record<string, string>) => {
      const next = buildHash(pageId, params)
      if (window.location.hash === next) {
        // Same target: the hashchange event will not fire, so re-read directly.
        setRoute(parse(next))
        return
      }
      window.location.hash = next
    },
    [],
  )

  return { ...route, navigate }
}

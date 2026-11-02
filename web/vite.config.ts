import { existsSync } from 'node:fs'
import { dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, normalizePath, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * VITE_EDITION picks a second edition of the app at build time, so one repo can
 * host two Cloudflare Pages projects. Unset, none of this runs and the build is
 * the default edition, byte for byte.
 */
const edition = process.env.VITE_EDITION === 'wheels' ? 'wheels' : undefined

// The header reads this straight from the env; a project that forgets the
// variable must not fall through to the default edition's company.
if (edition === 'wheels') process.env.VITE_COMPANY ||= 'NWR'

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), 'src')

/** Neutral ring favicon, inlined like the default one so no host path can 404. */
const WHEELS_FAVICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ccircle cx='16' cy='16' r='11' fill='none' stroke='%2300153D' stroke-width='6'/%3E%3C/svg%3E"

/**
 * Redirects any relative import of `src/<path>` to
 * `src/editions/<name>/<path>` when that file exists, so an edition overrides
 * exactly the modules it needs and nothing in the default edition branches.
 * Also retitles index.html, which is not a module.
 */
function editionOverrides(name: string): Plugin {
  const editionRoot = resolve(SRC, 'editions', name)

  return {
    name: 'edition-overrides',
    enforce: 'pre',
    resolveId(source, importer) {
      if (!importer || !source.startsWith('.')) return null
      const target = resolve(dirname(importer.split('?')[0]), source)
      const rel = relative(SRC, target)
      if (rel.startsWith('..') || rel.startsWith(`editions${sep}`)) return null

      for (const ext of ['.ts', '.tsx']) {
        const candidate = resolve(editionRoot, `${rel}${ext}`)
        if (existsSync(candidate)) return normalizePath(candidate)
      }
      return null
    },
    transformIndexHtml: {
      order: 'pre',
      handler: (html) =>
        html
          .replace(/<!--[\s\S]*?-->\s*/g, '')
          .replace(
            /<link rel="icon"[^>]*>/,
            `<link rel="icon" type="image/svg+xml" href="${WHEELS_FAVICON}" />`,
          )
          .replace(/<title>[^<]*<\/title>/, '<title>Product cost inquiry — Northline</title>'),
    },
  }
}

// BASE_PATH lets this deploy under a GitHub Pages subpath (e.g. /po-receipt-tracker/)
// the same way the HarborMaster demo does. Defaults to root for local dev.
export default defineConfig({
  plugins: [react(), ...(edition ? [editionOverrides(edition)] : [])],
  base: process.env.BASE_PATH ?? '/',
  server: {
    port: 5173,
    proxy: {
      // Everything under /api is forwarded to the Node proxy, which holds the
      // Azure AD service principal and talks to D365. Keeping this same-origin
      // in dev means the browser never needs CORS headers from F&SCM.
      '/api': {
        target: process.env.API_ORIGIN ?? 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
})

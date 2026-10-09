/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DATA_PROVIDER?: 'mock' | 'odata' | 'service' | 'hybrid'
  readonly VITE_API_BASE?: string
  readonly VITE_COMPANY?: string
  /**
   * Legal entity the live items are read from. Defaults to VITE_COMPANY; set
   * it under the hybrid provider, where the page header keeps the demo company.
   */
  readonly VITE_LIVE_COMPANY?: string
  /** Base URL of the F&O environment, used to build drill-through deep links. */
  readonly VITE_D365_URL?: string
  /**
   * The bluestem title ribbon is shown by default (it carries the RSM sponsor
   * mark). Set to 1 to build without it for embedding in a real F&SC
   * workspace; `?embed=1` on the URL does the same per-session — see
   * lib/embed.ts.
   */
  readonly VITE_EMBED?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

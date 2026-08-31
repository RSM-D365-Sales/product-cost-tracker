/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DATA_PROVIDER?: 'mock' | 'odata' | 'service'
  readonly VITE_API_BASE?: string
  readonly VITE_COMPANY?: string
  /** Base URL of the F&O environment, used to build drill-through deep links. */
  readonly VITE_D365_URL?: string
  /**
   * The Finance and Operations bar is hidden by default (the app is built to
   * be embedded in a real F&SC workspace). Set to 0 to build with the
   * standalone chrome; `?embed=0` on the URL does the same per-session — see
   * lib/embed.ts.
   */
  readonly VITE_EMBED?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

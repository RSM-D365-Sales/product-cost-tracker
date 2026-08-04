/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DATA_PROVIDER?: 'mock' | 'odata' | 'service'
  readonly VITE_API_BASE?: string
  readonly VITE_COMPANY?: string
  /** Base URL of the F&O environment, used to build drill-through deep links. */
  readonly VITE_D365_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

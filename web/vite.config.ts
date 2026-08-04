import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// BASE_PATH lets this deploy under a GitHub Pages subpath (e.g. /po-receipt-tracker/)
// the same way the HarborMaster demo does. Defaults to root for local dev.
export default defineConfig({
  plugins: [react()],
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

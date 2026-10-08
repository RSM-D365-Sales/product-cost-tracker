/**
 * Builds the web app and serves the production build for the recorder.
 *
 *   node demo-kit/serve.mjs                # build, then preview on http://localhost:5198
 *   node demo-kit/serve.mjs --port 5200    # another port (pass --base to record.mjs to match)
 *   node demo-kit/serve.mjs --no-build     # serve the existing web/dist as it is
 *
 * Why this exists rather than `npm run dev`: the Vite dev server hangs on this
 * OneDrive checkout, and BASE_PATH has to be "/" for a local run. Setting it
 * here, in Node, sidesteps both shells' quirks — Git Bash rewrites
 * BASE_PATH=/ into a Windows path, and PowerShell needs a separate $env: line.
 *
 * Leave it running in one terminal and record from another. Ctrl+C stops it.
 */
import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const web = join(here, '..', 'web')
// vite is hoisted to the workspace root or sits under web/, depending on the install
const vite = join(dirname(createRequire(join(web, 'package.json')).resolve('vite/package.json')), 'bin', 'vite.js')

const argv = process.argv.slice(2)
const port = argv.includes('--port') ? argv[argv.indexOf('--port') + 1] : '5198'
// The seeded provider and the ribbon are what the booth shows, whatever web/.env says.
const env = { ...process.env, BASE_PATH: '/', VITE_DATA_PROVIDER: 'mock', VITE_EMBED: '0' }

if (!argv.includes('--no-build')) {
  const build = spawnSync(process.execPath, [vite, 'build'], { cwd: web, env, stdio: 'inherit' })
  if (build.status !== 0) process.exit(build.status ?? 1)
}

const preview = spawn(process.execPath, [vite, 'preview', '--port', port, '--strictPort'], { cwd: web, env, stdio: 'inherit' })
preview.on('exit', (code) => process.exit(code ?? 0))
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => preview.kill())

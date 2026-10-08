/**
 * Lays a Windows text-to-speech scratch read of the voice-over over the tour
 * picture, so the narration pacing can be checked before a real voice is
 * recorded. Not for the show floor.
 *
 *   node demo-kit/scratch-vo.mjs                 # uses Microsoft Zira Desktop
 *   node demo-kit/scratch-vo.mjs --voice "Microsoft David Desktop" --rate -1
 *
 * Needs: demo-kit/out/product-cost-tracker-tour.mp4 + tour-timings.json (from
 * record.mjs), Windows (System.Speech via PowerShell), and an ffmpeg with AAC
 * (same lookup as record.mjs).
 *
 * Output: demo-kit/out/product-cost-tracker-tour-scratch-vo.mp4 and
 *         demo-kit/out/scratch-vo-report.txt (per-scene fit).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { SCENES, VIDEO, fmtTime } from './scenes.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const OUT = join(here, 'out')
const WAV = join(OUT, 'vo-scratch')
mkdirSync(WAV, { recursive: true })

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => (a.startsWith('--') ? [a.slice(2), arr[i + 1] ?? true] : [])).filter((p) => p.length))
const VOICE = args.voice ?? 'Microsoft Zira Desktop'
const RATE = Number(args.rate ?? 1)  // +1 ≈ a brisk 150 wpm narrator; 0 is a slow read

const mp4 = join(OUT, `${VIDEO.slug}-tour.mp4`)
const timingsPath = join(OUT, 'tour-timings.json')
if (!existsSync(mp4) || !existsSync(timingsPath)) {
  console.error('Run `node demo-kit/record.mjs --only tour` first (needs the mp4 and tour-timings.json).')
  process.exit(1)
}
const timings = JSON.parse(readFileSync(timingsPath, 'utf8'))

const ff = findFfmpeg()
if (!ff) { console.error('No ffmpeg with AAC found (set $FFMPEG or pip install imageio-ffmpeg).'); process.exit(1) }

// 1. synthesise one WAV per scene --------------------------------------------
// Lines go through a JSON file: PowerShell 5.1 treats curly apostrophes as quotes,
// so inlining the text is fragile.
// Say it the way a narrator would; SAPI otherwise reads "D365" as "three hundred sixty-five".
const spoken = (t) => t.replace(/D365/g, 'D three sixty-five').replace(/F&SC/g, 'F and S C').replace(/RSM/g, 'R S M').replace(/co-pack/gi, 'co pack')
const lines = SCENES.map((s, i) => ({ file: join(WAV, `${String(i + 1).padStart(2, '0')}-${s.id}.wav`), text: spoken(s.vo) }))
const linesPath = join(WAV, 'lines.json')
writeFileSync(linesPath, JSON.stringify(lines))
const ps1 = join(WAV, 'speak.ps1')
writeFileSync(ps1, `Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
try { $s.SelectVoice('${VOICE.replace(/'/g, "''")}') } catch { Write-Warning "voice not found, using default" }
$s.Rate = ${RATE}
$lines = Get-Content -Raw -Encoding UTF8 '${linesPath.replace(/'/g, "''")}' | ConvertFrom-Json
foreach ($l in $lines) { $s.SetOutputToWaveFile($l.file); $s.Speak($l.text) }
$s.Dispose()
`)
const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ps1], { encoding: 'utf8' })
if (r.status !== 0) { console.error(r.stderr || r.stdout); process.exit(1) }

// 2. measure each read against its scene budget -----------------------------
const report = [`Scratch VO fit — voice ${VOICE}, rate ${RATE}`, '']
const inputs = []
let worst = 0
SCENES.forEach((s, i) => {
  const file = join(WAV, `${String(i + 1).padStart(2, '0')}-${s.id}.wav`)
  const dur = wavSeconds(file)
  const t = timings.scenes.find((x) => x.id === s.id)
  const budget = t ? t.end - t.start : s.seconds
  const slack = budget - dur
  worst = Math.min(worst, slack)
  report.push(`${fmtTime(t?.start ?? 0)}  ${s.caption.padEnd(24)} read ${dur.toFixed(1)}s / scene ${budget.toFixed(1)}s  ${slack < 0 ? `OVER by ${(-slack).toFixed(1)}s` : `${slack.toFixed(1)}s spare`}`)
  inputs.push({ file, startMs: Math.round((t?.start ?? 0) * 1000) })
})
report.push('', worst < 0 ? 'At least one scene is over: trim the line in scenes.mjs or give the scene more seconds.' : 'Every scene fits with room to breathe.')
writeFileSync(join(OUT, 'scratch-vo-report.txt'), report.join('\n'))
console.log(report.join('\n'))

// 3. mux: delay each read to its scene start, mix, pair with the picture -----
const filter = inputs.map((x, i) => `[${i + 1}:a]adelay=${x.startMs}|${x.startMs}[a${i}]`).join(';') +
  `;${inputs.map((_, i) => `[a${i}]`).join('')}amix=inputs=${inputs.length}:normalize=0:duration=longest[mix]`
const out = join(OUT, `${VIDEO.slug}-tour-scratch-vo.mp4`)
const argv = ['-y', '-hide_banner', '-loglevel', 'error', '-i', mp4, ...inputs.flatMap((x) => ['-i', x.file]),
  '-filter_complex', filter, '-map', '0:v', '-map', '[mix]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-shortest', out]
const m = spawnSync(ff, argv, { encoding: 'utf8', stdio: ['ignore', 'inherit', 'inherit'] })
if (m.status === 0) console.log(`\n→ ${out}`)
else console.error('ffmpeg mux failed', m.status)

// ---------------------------------------------------------------------------
function wavSeconds(file) {
  const b = readFileSync(file)
  // PCM WAV from System.Speech: byte rate at offset 28, data size in the 'data' chunk
  const byteRate = b.readUInt32LE(28)
  let off = 12
  while (off + 8 <= b.length) {
    const id = b.toString('ascii', off, off + 4)
    const size = b.readUInt32LE(off + 4)
    if (id === 'data') return size / byteRate
    off += 8 + size + (size % 2)
  }
  return 0
}

function findFfmpeg() {
  const c = []
  if (process.env.FFMPEG) c.push(process.env.FFMPEG)
  c.push('ffmpeg')
  const py = spawnSync('python', ['-c', 'import imageio_ffmpeg,sys;sys.stdout.write(imageio_ffmpeg.get_ffmpeg_exe())'], { encoding: 'utf8' })
  if (py.status === 0 && py.stdout.trim()) c.push(py.stdout.trim())
  for (const x of c) {
    const r = spawnSync(x, ['-hide_banner', '-encoders'], { encoding: 'utf8' })
    if (r.status === 0 && /\baac\b/.test(r.stdout)) return x
  }
  return null
}

/**
 * Burns the voice-over transcript into the reel as on-screen subtitles, for the
 * muted show-floor loop.
 *
 *   node demo-kit/subtitle-reel.mjs
 *
 * Reads the narration from scenes.mjs (the same lines as voiceover-script.md),
 * splits each scene's line into cues at sentence breaks, times them across the
 * scene by length, renders every cue as a transparent 1920×1080 PNG with
 * Playwright, and overlays them on product-cost-tracker-reel.mp4. The tour half
 * of the reel is cut to the scripted timecodes, so a cue's time is just its
 * scene start plus the title card's length.
 *
 * Output: demo-kit/out/product-cost-tracker-reel-subtitled.mp4. The plain reel
 * is left as it is. Run record.mjs first (or `--only reel`) if the reel is stale.
 */
import { chromium } from 'playwright'
import { mkdirSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { SCENES, VIDEO, TOTAL_SECONDS, fmtTime } from './scenes.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const OUT = join(here, 'out')
const REEL_MP4 = join(OUT, `${VIDEO.slug}-reel.mp4`)
const SUB_MP4 = join(OUT, `${VIDEO.slug}-reel-subtitled.mp4`)
const CUE_DIR = join(OUT, 'subtitle-cues')
const { width: W, height: H } = VIDEO.frame

// Cue sizing and timing
const MAX_CUE_CHARS = 115 // two lines at the box width below
const LEAD_IN = 0.25 // seconds after the cut before the first cue appears
const TAIL = 0.35 // seconds before the next cut that the last cue clears
const MIN_CUE = 2 // no cue on screen for less than this
const FADE = 0.2

const poppins600 = readFileSync(join(here, 'assets', 'poppins-600.woff2')).toString('base64')

/** Sentences, merged greedily while they fit in one cue. */
function cuesFor(text) {
  const sentences = text.match(/[^.?!]+[.?!]+["”’]?/g)?.map((s) => s.trim()) ?? [text]
  const cues = []
  for (const s of sentences) {
    const last = cues.length - 1
    if (last >= 0 && cues[last].length + 1 + s.length <= MAX_CUE_CHARS) cues[last] += ' ' + s
    else cues.push(s)
  }
  return cues
}

/** Splits the scene's narration window across its cues by length, honouring MIN_CUE. */
function timeCues(sceneStart, seconds, cues) {
  const window = seconds - LEAD_IN - TAIL
  const lens = cues.map((c) => c.length)
  const total = lens.reduce((a, b) => a + b, 0)
  let durs = lens.map((l) => (l / total) * window)
  const short = durs.filter((d) => d < MIN_CUE).length
  if (short && short < durs.length) {
    const spare = window - short * MIN_CUE
    const longTotal = durs.filter((d) => d >= MIN_CUE).reduce((a, b) => a + b, 0)
    durs = durs.map((d) => (d < MIN_CUE ? MIN_CUE : (d / longTotal) * spare))
  }
  let t = sceneStart + LEAD_IN
  return cues.map((text, i) => {
    const cue = { text, start: t, end: t + durs[i] }
    t = cue.end
    return cue
  })
}

function buildCues() {
  const offset = VIDEO.interstitialSeconds
  const cues = []
  let start = 0
  for (const s of SCENES) {
    for (const c of timeCues(offset + start, s.seconds, cuesFor(s.vo))) cues.push({ ...c, scene: s.id })
    start += s.seconds
  }
  return cues
}

/** Lower-third palette, bottom-centre, sitting above the scene caption. */
const css = `
  @font-face{font-family:Poppins;font-weight:600;src:url(data:font/woff2;base64,${poppins600}) format('woff2')}
  html,body{margin:0;width:${W}px;height:${H}px;background:transparent;overflow:hidden}
  #cue{position:absolute;left:50%;bottom:136px;transform:translateX(-50%);max-width:1080px;width:max-content;
    box-sizing:border-box;padding:16px 30px 18px;border-radius:10px;background:rgba(0,21,61,.93);
    border-top:4px solid #009CDE;box-shadow:0 10px 30px rgba(0,0,0,.28);
    color:#fff;font-family:'Segoe UI',system-ui,sans-serif;font-weight:600;font-size:36px;line-height:1.32;
    text-align:center;text-wrap:balance}
`

async function renderCues(cues) {
  rmSync(CUE_DIR, { recursive: true, force: true })
  mkdirSync(CUE_DIR, { recursive: true })
  const browser = await chromium.launch({ channel: 'chromium' })
  try {
    const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })
    await page.setContent(`<style>${css}</style><div id="cue"></div>`)
    for (const [i, c] of cues.entries()) {
      await page.evaluate((t) => { document.getElementById('cue').textContent = t }, c.text)
      await page.evaluate(() => document.fonts.ready)
      c.png = join(CUE_DIR, `cue-${String(i + 1).padStart(2, '0')}.png`)
      await page.screenshot({ path: c.png, omitBackground: true })
    }
  } finally {
    await browser.close()
  }
}

function findFfmpeg() {
  const candidates = []
  if (process.env.FFMPEG) candidates.push(process.env.FFMPEG)
  candidates.push('ffmpeg')
  try {
    const py = spawnSync('python', ['-c', 'import imageio_ffmpeg,sys;sys.stdout.write(imageio_ffmpeg.get_ffmpeg_exe())'], { encoding: 'utf8' })
    if (py.status === 0 && py.stdout.trim()) candidates.push(py.stdout.trim())
  } catch { /* no python */ }
  for (const c of candidates) {
    const r = spawnSync(c, ['-hide_banner', '-encoders'], { encoding: 'utf8' })
    if (r.status === 0 && /libx264/.test(r.stdout)) return c
  }
  return null
}

function burn(cues) {
  const ff = findFfmpeg()
  if (!ff) throw new Error('No H.264 ffmpeg found. Install imageio-ffmpeg via pip, or set $FFMPEG.')
  const inputs = ['-i', REEL_MP4]
  const chains = []
  let prev = '[0:v]'
  cues.forEach((c, i) => {
    const d = c.end - c.start
    inputs.push('-loop', '1', '-framerate', '30', '-t', d.toFixed(3), '-i', c.png)
    chains.push(`[${i + 1}:v]format=rgba,fade=t=in:st=0:d=${FADE}:alpha=1,fade=t=out:st=${(d - FADE).toFixed(3)}:d=${FADE}:alpha=1,` +
      `setpts=PTS-STARTPTS+${c.start.toFixed(3)}/TB[c${i}]`)
    const outLabel = i === cues.length - 1 ? '[v]' : `[o${i}]`
    chains.push(`${prev}[c${i}]overlay=0:0:eof_action=pass${outLabel}`)
    prev = outLabel
  })
  const argv = ['-y', '-hide_banner', '-loglevel', 'error', ...inputs, '-filter_complex', chains.join(';'),
    '-map', '[v]', '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', '30',
    '-movflags', '+faststart', '-an', SUB_MP4]
  const r = spawnSync(ff, argv, { stdio: ['ignore', 'inherit', 'inherit'] })
  if (r.status !== 0) throw new Error(`ffmpeg failed with status ${r.status}`)
}

// ---------------------------------------------------------------------------
if (!existsSync(REEL_MP4)) {
  console.error(`Missing ${REEL_MP4}. Run node demo-kit/record.mjs first.`)
  process.exit(1)
}
const cues = buildCues()
console.log(`\nSubtitling reel (${VIDEO.interstitialSeconds}s card + ${TOTAL_SECONDS}s tour, ${cues.length} cues)`)
for (const c of cues) {
  const wps = c.text.split(/\s+/).length / (c.end - c.start)
  console.log(`  ${fmtTime(c.start)} – ${fmtTime(c.end)}  ${(c.end - c.start).toFixed(1).padStart(4)}s  ${wps.toFixed(1)} w/s  ${c.text}`)
}
await renderCues(cues)
burn(cues)
console.log(`  → ${SUB_MP4}\n\nDone.`)

/**
 * Records the Product Cost Tracker booth video with Playwright.
 *
 *   node demo-kit/record.mjs                       # tour + interstitial + combined reel
 *   node demo-kit/record.mjs --only tour           # just the app tour
 *   node demo-kit/record.mjs --only interstitial   # just the title card
 *   node demo-kit/record.mjs --only reel           # re-join the two existing MP4s
 *   node demo-kit/record.mjs --base http://localhost:5198 --no-captions
 *
 * The app must be running at --base (default http://localhost:5198). A
 * production build served by `vite preview` is the reliable way to do that on
 * this OneDrive checkout — `node demo-kit/serve.mjs` does both; see
 * demo-kit/README.md.
 *
 * Output (demo-kit/out/):
 *   product-cost-tracker-tour.webm / .mp4   the tour (length = sum of scenes.mjs seconds), 1920×1080
 *   interstitial.webm / .mp4                the 12 s title card between clips
 *   product-cost-tracker-reel.mp4           title card + tour as one file
 *   tour-timings.json                       measured scene boundaries (for VO alignment)
 *
 * Cuts land on the scripted timecodes exactly. Playwright's recorder does not keep
 * wall-clock time (it rounds every frame gap to 1/25 s and pads the tail), so the
 * overlay flips a 12 px marker in the bottom-right corner at each scene start; the
 * recorder finds those flips in the raw WebM and retimes each scene to its
 * scenes.mjs length (a speed change of a percent or two), then paints the marker out.
 *
 * MP4 (H.264) needs an ffmpeg with libx264. The script looks for, in order:
 * $FFMPEG, `ffmpeg` on PATH, the one bundled with Python's imageio-ffmpeg.
 * Playwright's own ffmpeg is VP8/WebM-only, so without one of those you get WebM.
 *
 * Nothing here mutates data. The app runs on its in-browser seed, and the tour
 * only picks an item, runs the inquiry, opens FastTabs, types a what-if into
 * the impact simulation and ticks a production line — all of it view state
 * that a browser refresh discards. It never clicks Export to Excel.
 */
import { chromium } from 'playwright'
import { mkdirSync, renameSync, readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { SCENES, VIDEO, ITEMS, TOTAL_SECONDS } from './scenes.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const args = parseArgs(process.argv.slice(2))
const BASE = (args.base ?? 'http://localhost:5198').replace(/\/$/, '')
const OUT = resolve(args.out ?? join(here, 'out'))
const CAPTIONS = !args['no-captions']
const ONLY = args.only ?? 'all'
const { width: W, height: H } = VIDEO.frame

const TOUR_WEBM = join(OUT, `${VIDEO.slug}-tour.webm`)
const TOUR_MP4 = join(OUT, `${VIDEO.slug}-tour.mp4`)
const CARD_WEBM = join(OUT, 'interstitial.webm')
const CARD_MP4 = join(OUT, 'interstitial.mp4')
const REEL_MP4 = join(OUT, `${VIDEO.slug}-reel.mp4`)

mkdirSync(OUT, { recursive: true })

const rsmWhite = 'data:image/png;base64,' + readFileSync(join(here, 'assets', 'rsm-logo-white.png')).toString('base64')

// ---------------------------------------------------------------------------
// Overlay injected into the app: a visible cursor, the lower-third caption and
// the closing card. Everything lives under window.__demo so scenes can call it.
// ---------------------------------------------------------------------------
const OVERLAY = String.raw`
(() => {
  if (window.__demo) return;
  const Z = 2147483000;
  const css = document.createElement('style');
  css.textContent = ${JSON.stringify(`
    #__demo-cursor{position:fixed;left:0;top:0;width:28px;height:28px;z-index:${2147483600};pointer-events:none;
      transform:translate(-9999px,-9999px);filter:drop-shadow(0 2px 3px rgba(0,0,0,.45));will-change:transform}
    .__demo-ripple{position:fixed;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;z-index:${2147483500};
      pointer-events:none;border:3px solid #009CDE;opacity:.9;animation:__demo-rip .55s ease-out forwards}
    @keyframes __demo-rip{from{transform:scale(.25);opacity:.9}to{transform:scale(1.15);opacity:0}}
    #__demo-sync{position:fixed;right:0;bottom:0;width:12px;height:12px;z-index:${2147483646};pointer-events:none;background:#DBDAD9}
    #__demo-caption{position:fixed;left:176px;bottom:52px;z-index:${2147483400};display:flex;align-items:stretch;
      opacity:0;transform:translateY(14px);transition:opacity .35s ease,transform .35s ease;pointer-events:none;
      font-family:'Segoe UI',system-ui,sans-serif;max-width:900px}
    #__demo-caption.on{opacity:1;transform:translateY(0)}
    #__demo-caption .bar{width:6px;background:#009CDE;border-radius:3px 0 0 3px;flex:none}
    #__demo-caption .box{background:rgba(0,21,61,.94);color:#fff;padding:12px 22px 13px 18px;border-radius:0 8px 8px 0;
      box-shadow:0 12px 32px rgba(0,21,61,.35)}
    #__demo-caption .t{font-family:Poppins,'Segoe UI',sans-serif;font-weight:600;font-size:22px;line-height:1.2;letter-spacing:-.005em}
    #__demo-caption .s{font-size:14.5px;color:#C9D1DB;margin-top:3px;line-height:1.35}
    #__demo-end{position:fixed;inset:0;z-index:${2147483450};background:#00153D;color:#fff;opacity:0;transition:opacity .5s ease;
      font-family:'Segoe UI',system-ui,sans-serif;display:grid;place-items:center}
    #__demo-end.on{opacity:1}
    #__demo-end .inner{display:flex;flex-direction:column;align-items:center;gap:18px;transform:translateY(-20px)}
    #__demo-end .wm{font-family:Poppins,'Segoe UI',sans-serif;font-weight:600;font-size:58px;letter-spacing:-.01em;line-height:1;display:flex;align-items:center;gap:16px}
    #__demo-end .wm .stem{color:#3F9C35}
    #__demo-end .title{font-family:Poppins,'Segoe UI',sans-serif;font-weight:600;font-size:92px;letter-spacing:-.015em;line-height:1.05;margin-top:12px}
    #__demo-end .tag{font-family:Poppins,'Segoe UI',sans-serif;font-weight:500;font-size:34px;color:#009CDE;margin-top:4px}
    #__demo-end .campus{font-size:17px;color:#9FB0CC;letter-spacing:.08em;text-transform:uppercase;margin-top:26px}
    #__demo-end .rsm{position:absolute;right:72px;bottom:56px;display:flex;align-items:center;gap:12px;color:#C9D1DB;font-size:15px}
    #__demo-end .rsm img{height:30px;width:auto;display:block}
    #__demo-end .inner > *{opacity:0;transform:translateY(10px);transition:opacity .5s ease,transform .5s ease}
    #__demo-end.on .inner > *{opacity:1;transform:none}
    #__demo-end.on .inner > :nth-child(2){transition-delay:.15s}
    #__demo-end.on .inner > :nth-child(3){transition-delay:.3s}
    #__demo-end.on .inner > :nth-child(4){transition-delay:.45s}
    #__demo-end.on .rsm{transition-delay:.6s}
  `)};
  const mark = (size) => '<svg viewBox="40 30 200 220" width="' + size + '" height="' + size + '" aria-hidden="true">' +
    '<path d="M62 232 Q75 150 150 130" stroke="#009CDE" stroke-width="26" stroke-linecap="round" fill="none"/>' +
    '<g transform="translate(155 108) rotate(-45)"><path d="M-72 0 C-40 -50 40 -50 72 0 C40 50 -40 50 -72 0 Z" fill="#3F9C35"/>' +
    '<path d="M-45 0 L45 0" stroke="#FFFFFF" stroke-width="8" stroke-linecap="round"/></g></svg>';
  const mount = () => {
    document.head.appendChild(css);
    const cur = document.createElement('div');
    cur.id = '__demo-cursor';
    cur.innerHTML = '<svg viewBox="0 0 28 28" width="28" height="28"><path d="M4 2.5 L4 22.5 L9.3 17.6 L13 26 L16.6 24.4 L12.9 16.2 L20.5 16.2 Z" fill="#fff" stroke="#00153D" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    document.body.appendChild(cur);
    // Sync marker: record.mjs flips its shade at each scene start and reads the
    // flips back out of the recording (see scanSync). Painted out of the MP4.
    const sync = document.createElement('div');
    sync.id = '__demo-sync';
    document.body.appendChild(sync);
    const cap = document.createElement('div');
    cap.id = '__demo-caption';
    cap.innerHTML = '<div class="bar"></div><div class="box"><div class="t"></div><div class="s"></div></div>';
    document.body.appendChild(cap);
    window.addEventListener('mousemove', (e) => { cur.style.transform = 'translate(' + e.clientX + 'px,' + e.clientY + 'px)'; }, true);
    window.addEventListener('mousedown', (e) => {
      const r = document.createElement('div'); r.className = '__demo-ripple';
      r.style.left = e.clientX + 'px'; r.style.top = e.clientY + 'px';
      document.body.appendChild(r); setTimeout(() => r.remove(), 600);
    }, true);
  };
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);

  window.__demo = {
    sync(color) { const el = document.getElementById('__demo-sync'); if (el) el.style.background = color; },
    caption(title, sub) {
      const el = document.getElementById('__demo-caption'); if (!el) return;
      const swap = () => { el.querySelector('.t').textContent = title; el.querySelector('.s').textContent = sub || ''; el.classList.add('on'); };
      if (el.classList.contains('on')) { el.classList.remove('on'); setTimeout(swap, 260); } else swap();
    },
    hideCaption() { const el = document.getElementById('__demo-caption'); if (el) el.classList.remove('on'); },
    hideCursor() { const el = document.getElementById('__demo-cursor'); if (el) el.style.display = 'none'; },
    endCard(opts) {
      const el = document.createElement('div'); el.id = '__demo-end';
      el.innerHTML = '<div class="inner">' +
        '<div class="wm">' + mark(66) + '<span>blue<span class="stem">stem</span></span></div>' +
        '<div class="title">' + opts.title + '</div>' +
        '<div class="tag">' + opts.tagline + '</div>' +
        '<div class="campus">' + opts.campus + '</div>' +
        '</div><div class="rsm"><span>Powered by</span><img alt="RSM" src="' + opts.rsm + '"></div>';
      document.body.appendChild(el);
      requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('on')));
    },
  };
})();`

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function moveTo(page, locator, steps = 18) {
  const box = await locator.boundingBox()
  if (!box) throw new Error('moveTo: element not visible: ' + locator)
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps })
}

async function click(page, locator, { settle = 250 } = {}) {
  await locator.waitFor({ state: 'visible', timeout: 15000 })
  await locator.scrollIntoViewIfNeeded()
  await moveTo(page, locator)
  await sleep(140)
  await page.mouse.down()
  await sleep(70)
  await page.mouse.up()
  await sleep(settle)
}

async function hover(page, locator, steps = 30) {
  await locator.waitFor({ state: 'visible', timeout: 15000 })
  await locator.scrollIntoViewIfNeeded()
  await moveTo(page, locator, steps)
}

async function scrollTop(page) {
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }))
  await sleep(450)
}

/** Smooth-scroll the window so `locator` sits `offset` px below the top edge. */
async function scrollToTop(page, locator, offset = 64) {
  await locator.evaluate((el, off) => {
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - off, behavior: 'smooth' })
  }, offset)
  await sleep(650)
}

// --- this app's furniture ---------------------------------------------------
/** Action pane / form buttons, by their exact caption. */
const btn = (page, name) => page.getByRole('button', { name, exact: true })
/** A FastTab (they are sibling <section>s, never nested). */
const fastTab = (page, title) => page.locator('section', { hasText: title }).first()
/** The header button that expands or collapses a FastTab. */
const fastTabToggle = (page, title) => fastTab(page, title).locator('button[aria-expanded]').first()
/** A stat tile in the production plan summary, e.g. "Material at risk". */
const planTile = (page, label) => page.locator('div.border', { has: page.getByText(label, { exact: true }) }).first()

/** Opens the Item lookup the way a presenter would and picks a record from it. */
async function pickItem(page, itemNumber, { dwell = 800 } = {}) {
  await click(page, page.getByRole('button', { name: 'Open Item lookup' }), { settle: 150 })
  const option = page
    .getByRole('option')
    .filter({ has: page.locator('span.font-semibold', { hasText: new RegExp(`^${itemNumber}$`) }) })
    .locator('button')
  await option.waitFor({ state: 'visible', timeout: 15000 })
  await sleep(dwell)
  await click(page, option, { settle: 250 })
}

// Marker shades. A is the status bar's own colour (invisible), B a shade darker,
// D the end card's Midnight. Scenes alternate A/B; the pre-roll sits on B.
const SYNC = { A: '#F3F2F1', B: '#DBDAD9', D: '#00153D' }
const syncLevel = (i) => (SCENES[i].id === 'end-card' ? 'D' : i % 2 === 0 ? 'A' : 'B')

async function caption(page, scene, step) {
  if (!CAPTIONS) return
  const c = step ?? scene
  await page.evaluate(([t, s]) => window.__demo?.caption(t, s), [c.caption, c.sub])
}

// ---------------------------------------------------------------------------
// Scene choreography. Each must finish inside its scenes.mjs budget; the runner
// pads to the budget so the cut lands on the scripted timecode.
// ---------------------------------------------------------------------------
const actions = {
  async inquiry(page) {
    await sleep(700)
    await pickItem(page, ITEMS.purchased)
    await click(page, btn(page, 'Run'), { settle: 100 })
    await page.getByText('Average landed cost').waitFor({ timeout: 20000 })
    await sleep(500)
    await hover(page, page.getByText('Average landed cost'), 22)
  },

  async landed(page) {
    // The three anchor loads sit a screen down inside the grid's own scroller.
    const row = (receipt) => page.locator('table.f-grid tbody tr', { hasText: receipt }).first()
    await page.mouse.move(W * 0.5, H * 0.72, { steps: 14 })
    await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' }))
    await row('PR-105644').evaluate((el) => {
      const scroller = el.closest('div.overflow-auto')
      const y = scroller.scrollTop + el.getBoundingClientRect().top - scroller.getBoundingClientRect().top
      scroller.scrollTo({ top: y - 80, behavior: 'smooth' })
    })
    await sleep(1100)
    // landed cost is the 13th cell (select, expand, order, receipt, item, date,
    // vendor, site, whs, qty, purchase, charges, landed)
    const landedCell = (receipt) => row(receipt).locator('td').nth(12)
    await hover(page, landedCell('PR-104812'), 16)
    await sleep(600)
    await hover(page, landedCell('PR-105196'), 16)
    await sleep(600)
    await hover(page, landedCell('PR-105644'), 12)
    await sleep(600)
    await click(page, row('PR-105644').locator('button[aria-label="Expand charges"]'), { settle: 300 })
    await hover(page, page.getByText('Detention and demurrage').first(), 20)
  },

  async 'variance-trend'(page, scene) {
    const [variance, trend] = scene.steps
    await scrollTop(page)
    await caption(page, scene, variance)
    await click(page, btn(page, 'Cost variance'), { settle: 400 })
    const tab = fastTab(page, 'Landed cost variance')
    await click(page, tab.locator('button[aria-label="Expand charges"]').first(), { settle: 300 })
    await hover(page, tab.getByText('Transportation', { exact: true }).first(), 18)
    await sleep(1500)

    await click(page, btn(page, 'Hide cost variance'), { settle: 150 })
    await caption(page, scene, trend)
    await click(page, btn(page, 'Cost trend'), { settle: 300 })
    const plot = fastTab(page, 'Cost trend').locator('svg[role="img"]').first()
    await plot.waitFor({ timeout: 15000 })
    await click(page, btn(page, '12 months'), { settle: 300 })
    const box = await plot.boundingBox()
    await page.mouse.move(box.x + box.width * 0.42, box.y + box.height * 0.5, { steps: 18 })
    await sleep(500)
    await page.mouse.move(box.x + box.width * 0.72, box.y + box.height * 0.42, { steps: 40 })
  },

  async impact(page) {
    await click(page, btn(page, 'Hide cost trend'), { settle: 150 })
    await click(page, fastTabToggle(page, 'Impact analysis'), { settle: 300 })
    await scrollToTop(page, fastTab(page, 'Impact analysis'))
    await sleep(900)
    // The vendor's change request: PO-000931 moved out a week. A what-if only —
    // nothing is saved, and the next inquiry run clears it.
    await click(page, page.getByLabel('Shift PO-000931 by days'), { settle: 150 })
    await page.keyboard.press('Control+A')
    await page.keyboard.type('7', { delay: 80 })
    await sleep(700)
    await hover(page, page.getByText('Impacted downstream orders'), 22)
    await sleep(300)
    await hover(page, fastTab(page, 'Impact analysis').getByText('PP-000126').last(), 14)
  },

  async production(page) {
    await scrollTop(page)
    await click(page, btn(page, 'Expand the navigation pane'), { settle: 500 })
    await click(page, page.getByRole('navigation', { name: 'Navigation pane' }).getByRole('button', { name: 'Production cost inquiry', exact: true }), { settle: 100 })
    await page.getByRole('heading', { level: 1, name: 'Production cost inquiry' }).waitFor({ timeout: 20000 })
    await sleep(300)
    await pickItem(page, ITEMS.produced, { dwell: 500 })
    await click(page, btn(page, 'Run'), { settle: 100 })
    await page.getByText('Variance to current cost').waitFor({ timeout: 20000 })
    await sleep(400)
    await hover(page, page.getByText('Variance to current cost'), 22)
  },

  async plan(page, scene) {
    const [before, after] = scene.steps
    const atRisk = planTile(page, 'Material at risk')
    await caption(page, scene, before)
    await scrollToTop(page, fastTab(page, 'Production plan'))
    await hover(page, atRisk, 20)
    await sleep(2500)

    // Commit the Holland co-packer and run again. Parameters are view state.
    await scrollTop(page)
    await click(page, btn(page, 'Show parameters'), { settle: 350 })
    await click(page, page.locator('label', { hasText: 'HOL-CP1' }).locator('input'), { settle: 350 })
    await click(page, btn(page, 'Run'), { settle: 100 })
    await page.getByText('Nothing expires unconverted').waitFor({ timeout: 20000 })
    await caption(page, scene, after)
    await scrollToTop(page, fastTab(page, 'Production plan'))
    await hover(page, atRisk, 20)
  },

  async copilot(page) {
    await scrollTop(page)
    await click(page, btn(page, 'Copilot'), { settle: 100 })
    const pane = page.locator('aside[aria-label="Copilot"]')
    await pane.getByText('Suggested actions').waitFor({ timeout: 20000 })
    await hover(page, pane.getByText('Cost position'), 26)
    await sleep(1200)
    await hover(page, pane.getByText('Suggested actions'), 34)
  },

  async 'end-card'(page) {
    await page.evaluate(() => { window.__demo?.hideCaption(); window.__demo?.hideCursor() })
    await sleep(250)
    await page.evaluate(
      (o) => window.__demo?.endCard(o),
      { title: VIDEO.title, tagline: VIDEO.tagline, campus: VIDEO.campus, rsm: rsmWhite },
    )
  },
}

// ---------------------------------------------------------------------------
// Recordings
// ---------------------------------------------------------------------------
async function recordTour(browser) {
  console.log(`\nRecording tour from ${BASE} (${TOTAL_SECONDS}s, captions ${CAPTIONS ? 'on' : 'off'})`)
  const context = await browser.newContext({
    viewport: { width: W, height: H },
    deviceScaleFactor: 1,
    recordVideo: { dir: OUT, size: { width: W, height: H } },
    colorScheme: 'light',
    locale: 'en-US',
    timezoneId: 'America/Detroit',
  })
  await context.addInitScript(OVERLAY)
  const videoStart = Date.now()
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))

  await page.goto(BASE + '/', { waitUntil: 'load' })
  await page.getByRole('heading', { level: 1, name: 'Product cost inquiry' }).waitFor({ timeout: 30000 })
  // the form opens empty; wait for the lookup to be there, then let fonts settle
  await page.getByRole('button', { name: 'Open Item lookup' }).waitFor({ timeout: 30000 })
  await page.evaluate(() => document.fonts.ready)
  await sleep(600)
  // Pre-roll with the cursor in motion. The recorder only starts writing once the
  // screen is changing, and scanSync needs to see the marker's pre-roll shade
  // before scene one flips it.
  for (let i = 0; i < 16; i++) {
    await page.mouse.move(W * 0.5 + 40 * Math.cos(i * 0.8), H * 0.5 + 40 * Math.sin(i * 0.8), { steps: 4 })
    await sleep(90)
  }
  await page.mouse.move(W * 0.5, H * 0.5, { steps: 4 })

  const t0 = Date.now()
  const timings = []
  let ranLong = 0
  for (const scene of SCENES) {
    const start = Date.now()
    process.stdout.write(`  ${scene.caption.padEnd(24)} ${String(scene.seconds).padStart(4)}s … `)
    await page.evaluate((c) => window.__demo?.sync(c), SYNC[syncLevel(SCENES.indexOf(scene))])
    await caption(page, scene)
    try {
      await actions[scene.id](page, scene)
    } catch (e) {
      console.log(`\n  ! ${scene.id}: ${e.message.split('\n')[0]}`)
      ranLong++
    }
    const used = (Date.now() - start) / 1000
    const pad = scene.seconds * 1000 - (Date.now() - start)
    if (pad < 0) { console.log(`ran long by ${(-pad / 1000).toFixed(1)}s`); ranLong++ }
    else { await sleep(pad); console.log(`ok (${used.toFixed(1)}s of action)`) }
    timings.push({ id: scene.id, caption: scene.caption, start: +((start - t0) / 1000).toFixed(2), end: +((Date.now() - t0) / 1000).toFixed(2), actionSeconds: +used.toFixed(2) })
  }

  // Hold past the last scene: the recorder pads the tail to the close time only when
  // more than a second has gone by since the last screen change.
  await sleep(1300)
  const tEnd = Date.now()
  const video = page.video()
  await context.close()
  const raw = await video.path()
  if (existsSync(TOUR_WEBM)) unlinkSync(TOUR_WEBM)
  renameSync(raw, TOUR_WEBM)

  const duration = timings.at(-1).end
  const sync = scanSync(TOUR_WEBM)
  const leadIn = sync ? sync.starts[0] : leadInOf(TOUR_WEBM, t0, tEnd) ?? (t0 - videoStart) / 1000
  if (sync) timings.forEach((t, k) => { t.videoStart = +sync.starts[k].toFixed(2) })
  writeFileSync(join(OUT, 'tour-timings.json'), JSON.stringify({ base: BASE, sync: sync ? 'marker' : 'lead-in estimate', leadInSeconds: +leadIn.toFixed(2), durationSeconds: sync ? TOTAL_SECONDS : duration, scenes: timings }, null, 2))
  if (errors.length) console.log('  page errors:', errors)
  if (ranLong) console.log(`  WARNING: ${ranLong} scene(s) failed or ran past their budget — fix before using this take.`)
  console.log(`  → ${TOUR_WEBM}`)
  if (sync) toMp4Synced(TOUR_WEBM, TOUR_MP4, sync)
  else {
    console.log('  WARNING: sync marker not found in the recording — cuts are estimated and may be up to a second off.')
    toMp4(TOUR_WEBM, TOUR_MP4, leadIn, duration)
  }
}

async function recordInterstitial(browser) {
  const secs = VIDEO.interstitialSeconds
  console.log(`\nRecording interstitial (${secs}s)`)
  const context = await browser.newContext({
    viewport: { width: W, height: H },
    deviceScaleFactor: 1,
    recordVideo: { dir: OUT, size: { width: W, height: H } },
  })
  const videoStart = Date.now()
  const page = await context.newPage()
  const q = new URLSearchParams({
    dur: String(secs),
    manual: '1',
    next: VIDEO.title,
    tagline: VIDEO.tagline,
    eyebrow: VIDEO.interstitial.eyebrow,
    pipe: VIDEO.interstitial.pipeline.map((p) => `${p.n}|${p.d}`).join('~'),
  })
  const url = pathToFileURL(join(here, 'interstitial.html')).href + '?' + q.toString()
  await page.goto(url, { waitUntil: 'load' })
  await page.evaluate(() => document.fonts.ready)
  await sleep(300)
  const t0 = Date.now()
  await page.evaluate(() => window.__startTimeline())
  await sleep(secs * 1000 + 1300)
  const tEnd = Date.now()
  const video = page.video()
  await context.close()
  if (existsSync(CARD_WEBM)) unlinkSync(CARD_WEBM)
  renameSync(await video.path(), CARD_WEBM)
  console.log(`  → ${CARD_WEBM}`)
  toMp4(CARD_WEBM, CARD_MP4, leadInOf(CARD_WEBM, t0, tEnd) ?? (t0 - videoStart) / 1000, secs)
}

/**
 * Title card + tour as one MP4. Both halves come out of toMp4() with identical
 * codec settings, so they are joined without re-encoding.
 */
function buildReel() {
  console.log('\nBuilding reel (title card + tour)')
  const ff = findFfmpeg()
  if (!ff) return console.log('  (no H.264 ffmpeg found — skipping the reel.)')
  if (!existsSync(CARD_MP4) || !existsSync(TOUR_MP4)) return console.log('  (need interstitial.mp4 and the tour mp4 first — run without --only.)')
  const list = join(OUT, 'reel-list.txt')
  writeFileSync(list, `file 'interstitial.mp4'\nfile '${VIDEO.slug}-tour.mp4'\n`)
  const r = spawnSync(ff, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', REEL_MP4], { encoding: 'utf8', stdio: ['ignore', 'inherit', 'inherit'] })
  if (r.status === 0) console.log(`  → ${REEL_MP4}  (${VIDEO.interstitialSeconds}s card + ${TOTAL_SECONDS}s tour)`)
  else console.log('  ffmpeg concat failed with status', r.status)
}

// ---------------------------------------------------------------------------
// MP4 conversion
// ---------------------------------------------------------------------------
let ffmpegPath
function findFfmpeg() {
  if (ffmpegPath !== undefined) return ffmpegPath
  const candidates = []
  if (process.env.FFMPEG) candidates.push(process.env.FFMPEG)
  candidates.push('ffmpeg')
  try {
    const py = spawnSync('python', ['-c', 'import imageio_ffmpeg,sys;sys.stdout.write(imageio_ffmpeg.get_ffmpeg_exe())'], { encoding: 'utf8' })
    if (py.status === 0 && py.stdout.trim()) candidates.push(py.stdout.trim())
  } catch { /* no python */ }
  for (const c of candidates) {
    const r = spawnSync(c, ['-hide_banner', '-encoders'], { encoding: 'utf8' })
    if (r.status === 0 && /libx264/.test(r.stdout)) return (ffmpegPath = c)
  }
  return (ffmpegPath = null)
}

/** Container duration in seconds, read from ffmpeg's banner (no ffprobe in imageio-ffmpeg). */
function mediaSeconds(file) {
  const ff = findFfmpeg()
  if (!ff) return null
  const r = spawnSync(ff, ['-hide_banner', '-i', file], { encoding: 'utf8' })
  const m = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(r.stderr ?? '')
  return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : null
}

/**
 * Seconds of video before the first scene. Playwright starts the file at the
 * first painted frame, not when the page object is created, so a wall-clock
 * stamp taken before newPage() overstates the lead-in by a second or three and
 * every cut lands early. The file does end when the context closes, so measure
 * back from there: lead-in = file length − (close time − scene-one start).
 */
function leadInOf(webm, t0, tEnd) {
  const total = mediaSeconds(webm)
  return total == null ? null : Math.max(0, total - (tEnd - t0) / 1000)
}

/**
 * Reads the sync marker back out of the raw recording: one grey value per frame
 * from the middle of the marker, classified A / B / D. Returns the video time at
 * which each scene starts, or null if the expected sequence isn't there.
 */
function scanSync(webm) {
  const ff = findFfmpeg()
  if (!ff) return null
  const r = spawnSync(ff, ['-hide_banner', '-loglevel', 'error', '-i', webm,
    '-vf', `fps=25,crop=6:6:${W - 9}:${H - 9},scale=1:1:flags=area`, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'],
    { maxBuffer: 64 * 1024 * 1024 })
  const px = r.stdout
  if (r.status !== 0 || !px?.length) return null
  const level = (v) => (v < 120 ? 'D' : v > 231 ? 'A' : 'B')
  let i = 0
  // before the overlay mounts the corner is blank page; the pre-roll proper sits on B
  while (i < px.length && level(px[i]) !== 'B') i++
  const starts = []
  for (let k = 0; k < SCENES.length; k++) {
    const want = syncLevel(k)
    while (i < px.length && level(px[i]) !== want) i++
    if (i >= px.length) return null
    starts.push(i / 25)
  }
  return { starts, total: px.length / 25 }
}

/**
 * One encode: each scene is cut out at its marker, stretched or squeezed to its
 * scripted seconds, and the pieces are joined. The marker is painted over with
 * the status bar colour (on the end card it is already the card's own colour).
 */
function toMp4Synced(webm, mp4, sync) {
  const ff = findFfmpeg()
  const speeds = []
  const parts = SCENES.map((s, k) => {
    const start = sync.starts[k]
    const end = k < SCENES.length - 1 ? sync.starts[k + 1] : Math.min(sync.total, start + s.seconds)
    speeds.push((end - start) / s.seconds)
    const cover = s.id === 'end-card' ? '' : `,drawbox=x=${W - 12}:y=${H - 12}:w=12:h=12:color=0xF3F2F1:t=fill`
    return `[0:v]trim=start=${start.toFixed(3)}:end=${end.toFixed(3)},setpts=(PTS-STARTPTS)*${(s.seconds / (end - start)).toFixed(6)}${cover}[s${k}]`
  })
  const graph = parts.join(';') + ';' + SCENES.map((_, k) => `[s${k}]`).join('') +
    `concat=n=${SCENES.length}:v=1:a=0,fps=30,scale=${W}:${H}:flags=lanczos,tpad=stop_mode=clone:stop_duration=2[v]`
  const argv = [
    '-y', '-hide_banner', '-loglevel', 'error', '-i', webm, '-filter_complex', graph, '-map', '[v]',
    '-t', TOTAL_SECONDS.toFixed(3), '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart', '-an', mp4,
  ]
  const r = spawnSync(ff, argv, { encoding: 'utf8', stdio: ['ignore', 'inherit', 'inherit'] })
  const worst = Math.max(...speeds.map((x) => Math.abs(x - 1))) * 100
  if (r.status === 0) console.log(`  → ${mp4}  (${TOTAL_SECONDS}s, cuts synced to the marker; largest retime ${worst.toFixed(1)}%)`)
  else console.log('  ffmpeg failed with status', r.status)
}

function toMp4(webm, mp4, leadIn, duration) {
  const ff = findFfmpeg()
  if (!ff) {
    console.log('  (no H.264 ffmpeg found — keeping WebM. Install imageio-ffmpeg via pip, or set $FFMPEG.)')
    return
  }
  const argv = [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-ss', leadIn.toFixed(3), '-i', webm, '-t', duration.toFixed(3),
    '-r', '30', '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p',
    '-vf', `scale=${W}:${H}:flags=lanczos`, '-movflags', '+faststart', '-an', mp4,
  ]
  const r = spawnSync(ff, argv, { encoding: 'utf8', stdio: ['ignore', 'inherit', 'inherit'] })
  if (r.status === 0) console.log(`  → ${mp4}  (trimmed ${leadIn.toFixed(2)}s lead-in, ${duration}s)`)
  else console.log('  ffmpeg failed with status', r.status)
}

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) continue
    const k = a.slice(2)
    const v = argv[i + 1]
    if (v && !v.startsWith('--')) { out[k] = v; i++ } else out[k] = true
  }
  return out
}

// ---------------------------------------------------------------------------
if (ONLY === 'reel') {
  buildReel()
} else {
  const browser = await chromium.launch({ channel: 'chromium' })
  try {
    if (ONLY === 'all' || ONLY === 'tour') await recordTour(browser)
    if (ONLY === 'all' || ONLY === 'interstitial') await recordInterstitial(browser)
  } finally {
    await browser.close()
  }
  if (ONLY === 'all') buildReel()
}
console.log('\nDone.')

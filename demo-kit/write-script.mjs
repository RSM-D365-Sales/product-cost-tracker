/**
 * Regenerates demo-kit/voiceover-script.md from scenes.mjs, injects the same
 * script into cheat-sheet.html, and writes the single-file cheat sheet.
 *   node demo-kit/write-script.mjs
 */
import { writeFileSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { SCENES, VIDEO, TOTAL_SECONDS, ALT_OPENERS, wordCount, fmtTime } from './scenes.mjs'

const here = dirname(fileURLToPath(import.meta.url))

let t = 0
const rows = SCENES.map((s) => {
  const start = t
  t += s.seconds
  const words = wordCount(s.vo)
  const wpm = Math.round((words / s.seconds) * 60)
  return { ...s, start, end: t, words, wpm }
})

const totalWords = rows.reduce((n, r) => n + r.words, 0)

const md = `# ${VIDEO.title} — booth video voice-over

*Generated from \`demo-kit/scenes.mjs\` by \`write-script.mjs\`. Edit the source, not this file.*

| | |
|---|---|
| Clip | ${VIDEO.title} (${VIDEO.company}) |
| Running time | **${fmtTime(TOTAL_SECONDS)}** (${TOTAL_SECONDS} s) |
| Narration | ${totalWords} words · ${Math.round((totalWords / TOTAL_SECONDS) * 60)} wpm average |
| Picture | \`demo-kit/out/${VIDEO.slug}-tour.mp4\` (1920×1080, 30 fps) |
| Title card between clips | \`demo-kit/interstitial.html\` → \`demo-kit/out/interstitial.mp4\` (${VIDEO.interstitialSeconds} s) |
| Card + tour, one file | \`demo-kit/out/${VIDEO.slug}-reel.mp4\` (${VIDEO.interstitialSeconds + TOTAL_SECONDS} s) |

Read it warm and unhurried. Each scene's narration is sized to finish about half a
second before the cut, so if you land early, hold the pause; don't fill it.
Say "D365" as *dee-three-sixty-five*, "RSM" as three letters, and "co-pack" as
the produce trade says it (*koh-pack*). "First-expired, first-out" is the
inventory rule, so give it the weight of a term, not a throwaway.

## Timed script

| # | Time | Scene | Narration | Words |
|---|---|---|---|---|
${rows
  .map(
    (r, i) =>
      `| ${i + 1} | ${fmtTime(r.start)} – ${fmtTime(r.end)} | **${r.caption}** | ${r.vo} | ${r.words} (${r.wpm} wpm) |`,
  )
  .join('\n')}

## Scene by scene

${rows
  .map(
    (r, i) => `### ${i + 1}. ${r.caption} · ${fmtTime(r.start)} – ${fmtTime(r.end)} (${r.seconds} s)

**On screen:** ${r.onScreen}

**Lower-third caption:** ${r.caption} — *${r.sub}*

**Narration:**

> ${r.vo}
`,
  )
  .join('\n')}

## Alternate openers

If the room wants a hook before scene 1, swap one of these in and trim the
first sentence of scene 1 to fit (each adds ~5 s, which takes the clip past 75 s,
so give the time back from scene 6 or 7 in scenes.mjs and re-record):

${ALT_OPENERS.map((o) => `- ${o}`).join('\n')}

## Recording notes

- The picture is recorded by \`node demo-kit/record.mjs\`; scene boundaries land on the
  timecodes above because the recorder holds each scene for exactly its budgeted seconds.
  \`demo-kit/out/tour-timings.json\` has the measured boundaries from the last run.
- \`node demo-kit/scratch-vo.mjs\` lays a Windows text-to-speech scratch read over the
  picture (\`${VIDEO.slug}-tour-scratch-vo.mp4\`) so timing can be checked before a real voice is recorded.
- Record the real voice-over as one take against the picture, or scene by scene and align
  each clip to its start timecode. Leave the last 0.5 s of every scene silent.
- Captions are burned in (bottom-left lower-third). On a muted show floor they carry the
  story alone; the voice-over is for the recorded social cut and anyone wearing headphones.
`

writeFileSync(join(here, 'voiceover-script.md'), md)

// ---------------------------------------------------------------------------
// Same script, injected into the cheat sheet between the vo-script markers, and
// a single self-contained copy (fonts + logos inlined) for sharing with the team.
// ---------------------------------------------------------------------------
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const voHtml = `
  <p>${fmtTime(TOTAL_SECONDS)} running time, ${totalWords} words, read warm and unhurried at about 150 words a minute. Each line is sized to finish half a second before the cut; if you land early, hold the pause. Say "D365" as <i>dee-three-sixty-five</i>, "RSM" as three letters and "co-pack" as <i>koh-pack</i>.</p>
  <div class="table-wrap">
  <table class="path vo">
    <thead><tr><th></th><th>Time</th><th>Scene · on screen</th><th>Narration</th><th>Words</th></tr></thead>
    <tbody>
${rows.map((r, i) => `      <tr>
        <td class="n">${i + 1}</td>
        <td class="t">${fmtTime(r.start)} – ${fmtTime(r.end)}</td>
        <td class="scene"><b>${esc(r.caption)}</b><span>${esc(r.onScreen)}</span></td>
        <td class="narr">${esc(r.vo)}</td>
        <td class="w">${r.words} · ${r.wpm} wpm</td>
      </tr>`).join('\n')}
    </tbody>
  </table>
  </div>
  <p>Alternate openers if the room wants a hook (each adds about 5 s): ${ALT_OPENERS.map((o) => `“${esc(o)}”`).join(' · ')}</p>
`
const sheetPath = join(here, 'cheat-sheet.html')
let sheet = readFileSync(sheetPath, 'utf8')
// A replacer function, not a replacement string: the script quotes prices, and
// "$28.90" in a replacement string is read as back-reference $2 followed by "8.90".
// Greedy on purpose, so everything between the first start and the last end goes.
sheet = sheet.replace(/(<!-- vo-script:start[^>]*-->)[\s\S]*(<!-- vo-script:end -->)/, (_, a, b) => `${a}${voHtml}  ${b}`)
sheet = sheet.replace(/<span class="total-s">[^<]*<\/span>/g, `<span class="total-s">${TOTAL_SECONDS}</span>`)
sheet = sheet.replace(/<span class="reel-s">[^<]*<\/span>/g, `<span class="reel-s">${VIDEO.interstitialSeconds + TOTAL_SECONDS}</span>`)
writeFileSync(sheetPath, sheet)

const mime = { woff2: 'font/woff2', png: 'image/png' }
const inlined = sheet.replace(/(url\(['"]?|src=")assets\/([\w.-]+)/g, (m, prefix, file) => {
  const ext = file.split('.').pop()
  const data = readFileSync(join(here, 'assets', file)).toString('base64')
  return `${prefix}data:${mime[ext]};base64,${data}`
}).replace('Self-contained: fonts and the RSM mark are local files in ./assets.', 'Generated by write-script.mjs from cheat-sheet.html with fonts and logos inlined; edit the source, not this file.')
writeFileSync(join(here, `${VIDEO.slug}-cheat-sheet.html`), inlined)
console.log(`cheat-sheet.html updated; ${VIDEO.slug}-cheat-sheet.html (single file) written`)

console.log(`voiceover-script.md written — ${rows.length} scenes, ${TOTAL_SECONDS}s, ${totalWords} words`)
for (const r of rows) {
  const budget = Math.floor(r.seconds * 2.5)
  const flag = r.words > budget ? '  <-- over budget' : ''
  if (flag) process.exitCode = 1
  console.log(`  ${fmtTime(r.start)}  ${r.caption.padEnd(22)} ${String(r.words).padStart(3)} words / ${budget} budget${flag}`)
}

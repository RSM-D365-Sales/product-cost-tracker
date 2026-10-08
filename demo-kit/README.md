# demo-kit — booth video and presenter kit

Everything needed to put Product Cost Tracker into the IFPA looping reel and to
walk someone through the live demo. Built the same way as
`../grower-harvesting/demo-kit`; the overlay, timing runner, MP4 conversion and
title card are shared, and only the scene list and the `actions` map differ.

| File | What it is |
|---|---|
| `scenes.mjs` | **Source of truth** for the video: scene order, seconds per scene, captions, voice-over lines, and the title card's labels. Edit this, then re-run the scripts below. |
| `serve.mjs` | Builds the web app with `BASE_PATH=/` and serves the production build on port 5198 for the recorder. |
| `record.mjs` | Drives the running app with Playwright and records the tour (1920×1080), the title card, and the two joined as one reel. Writes WebM and, when an H.264 ffmpeg is available, MP4. |
| `write-script.mjs` | Regenerates `voiceover-script.md`, injects the script into `cheat-sheet.html`, and writes the single-file `product-cost-tracker-cheat-sheet.html`. |
| `subtitle-reel.mjs` | Burns the voice-over transcript into the reel as timed subtitles for the muted show-floor loop. |
| `scratch-vo.mjs` | Lays a Windows text-to-speech read over the tour so pacing can be checked before a real voice is recorded. |
| `voiceover-script.md` | Generated. The narrator's copy with timecodes. |
| `interstitial.html` | The 12 s "Up next" title card shown between clips. Open in a browser (`?loop=1` to loop) or let `record.mjs` render it. Same card as the other Bluestem kits; the labels come from `scenes.mjs`. |
| `cheat-sheet.html` | Presenter cheat sheet source: click path, what to say, cast, Q&A, resets, plus the voice-over script (injected from `scenes.mjs`). |
| `product-cost-tracker-cheat-sheet.html` | **Generated.** The same sheet as one self-contained file (fonts and logos inlined). This is the one to share with the team. |
| `assets/` | Poppins woff2 and the RSM marks so the HTML pages work offline. |
| `out/` | Rendered videos and timing JSON (git-ignored). |

## Render the video

The app runs on its in-browser seed and dates everything relative to today, so
there is nothing to reseed. Check by eye before recording: run `RAW-BLU` and the
first four grid rows should be EXPECTED purchase orders dated in the coming weeks.

```powershell
# 1. build and serve the app (vite dev hangs on this OneDrive checkout; preview is reliable)
node demo-kit/serve.mjs                         # leave running; http://localhost:5198

# 2. record (new terminal)
node demo-kit/record.mjs                        # tour + title card + reel → demo-kit/out/
node demo-kit/record.mjs --only tour --no-captions
node demo-kit/record.mjs --only reel            # re-join the existing card and tour
node demo-kit/subtitle-reel.mjs                 # reel with the VO transcript burned in (muted loop)
node demo-kit/scratch-vo.mjs                    # optional: TTS pacing check
```

Everything goes through `node`, so no environment variables need setting in
either shell. `record.mjs` uses Playwright's full Chromium (`channel: 'chromium'`)
so the recording matches a real browser. For MP4 it needs an ffmpeg with
libx264: set `$env:FFMPEG`, put `ffmpeg` on PATH, or `pip install imageio-ffmpeg`.
Without one you still get WebM.

Output in `out/`:

| File | |
|---|---|
| `product-cost-tracker-tour.mp4` | The tour, cuts synced to the scripted timecodes; its length is the sum of the scene seconds. |
| `product-cost-tracker-tour.webm` | The raw recording as Playwright wrote it (pre-roll included, not retimed). |
| `interstitial.mp4` / `.webm` | The 12 s title card. |
| `product-cost-tracker-reel.mp4` | Title card then tour, one file. |
| `product-cost-tracker-reel-subtitled.mp4` | The reel with the narration as on-screen subtitles, timed to the scenes. **This is the one for the silent booth loop.** |
| `product-cost-tracker-tour-scratch-vo.mp4` | The tour with the TTS read (pacing check only, not for the show floor). |
| `tour-timings.json`, `scratch-vo-report.txt` | Measured scene boundaries and the per-scene narration fit. |

The recorder mutates nothing. The app has no backend on the seeded provider; the
tour picks an item, runs the inquiry, opens FastTabs, types one what-if into the
impact simulation and ticks one production line, all of which is view state a
refresh discards. It never clicks Export to Excel.

### How the cuts stay on the timecodes

Each scene is held to its `seconds` budget, and the recorder warns if an action
runs past it. That alone is not enough: Playwright's recorder does not keep
wall-clock time. It starts the file at the first screen change rather than when
the page opens, rounds every frame gap to 1/25 s, and pads the tail, so a scene
scripted at 8 s can come out anywhere from 7.5 s to 8.5 s in the raw WebM.

So the overlay flips a 12 px marker in the bottom-right corner at each scene
start. After recording, `scanSync` reads the marker back out of the WebM,
`toMp4Synced` cuts each scene at its flip, retimes it to its scripted length (a
percent or two) and paints the marker out. The cuts in the MP4 then sit on the
`voiceover-script.md` timecodes to the frame. `tour-timings.json` records where
each scene started in the raw video, and the recorder prints the largest retime.
If the marker can't be found it says so and falls back to an estimated trim; the
WebM is the raw recording and is never retimed.

## Change the script

Edit `scenes.mjs`, then:

```powershell
node demo-kit/write-script.mjs    # refresh voiceover-script.md and the cheat sheet; see the word check
node demo-kit/record.mjs          # re-record so the cuts land on the new timecodes
node demo-kit/scratch-vo.mjs      # confirm every scene still has spare time
```

Keep each scene's narration under `seconds × 2.5` words; the generator flags any
line that is over and exits non-zero.

## Cheat sheet figures

The numbers on the cheat sheet were read from the running app. The hand-authored
anchor rows in `web/src/data/seed.ts` never move, but averages can shift by a cent
as the two-year window rolls, and the seed can be edited. After a seed change,
re-run the click path and update `cheat-sheet.html`, then `write-script.mjs`.

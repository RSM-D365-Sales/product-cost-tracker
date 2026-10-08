Build the IFPA booth kit for this app, the way it was done in
../grower-harvesting/demo-kit (read that folder's README.md, scenes.mjs, record.mjs,
interstitial.html and cheat-sheet.html first and reuse them; don't start from scratch).

App: {Product Cost Tracker}
One-line hook (from ../Blustem-company-details/PUN_BANK.md): {PUN LINE}

Deliverables, all in ./demo-kit:
1. A 45–75 second screen-recorded tour of every page in this app, 1920×1080 MP4
   (H.264) plus WebM, recorded with Playwright from the running app. Visible cursor,
   burned-in lower-third captions per scene, Midnight end card with the bluestem mark,
   the hook line and the "Powered by RSM" mark bottom-right. Scene order, seconds and
   captions live in scenes.mjs as the single source of truth; the recorder holds each
   scene to its budget so cuts land on the scripted timecodes and warns if an action
   runs long. Choose scenes from what the app actually does: open each page, read its
   headings, KPIs, filters and tabs, and pick the 6–8 moments that show the story.
2. A voice-over script with timecodes, generated from scenes.mjs
   (voiceover-script.md): one line per scene, sized under seconds × 2.5 words, with a
   words-per-minute check. Lay a Windows text-to-speech scratch read over the picture
   (scratch-vo.mjs, rate +1, pronounce "D365" as "D three sixty-five") and adjust
   lines or seconds until every scene has spare time.ompt
3. The 12-second "Up next" title card: reuse interstitial.html, pass the app name via
   ?next= and render it to interstitial.mp4.
4. One self-contained HTML cheat sheet I can share with the team as a single file
   (fonts and logos inlined): at-a-glance strip (URL, persona, site, ERP environment,
   clip length), "before you walk up" checklist including what NOT to click, the story
   in thirty seconds, a numbered click path (Go to / Point at / Say) using the real
   names and figures from the app's seed data, cast and identifiers, likely questions
   with answers grounded in the README, "if something goes wrong", the loop order, and
   the full voice-over script appended as a section (injected from scenes.mjs so it
   can't drift). Publish it as a private artifact too and give me the link.
5. Provide me a single MP4 that combines the 45-75 second screen-recorded tour and the 12 second up next video.

Rules:
- Bluestem brand per ../Blustem-company-details/BRAND_GUIDE.md: Midnight #00153D
  chrome, RSM Blue #009CDE accent, RSM Green only for good status, Poppins 600
  headings (bundle the woff2, no font CDN), Segoe UI body, "Powered by RSM" at the
  right of title cards. Anything shown failing or at risk must be a fictional entity.
  No synthetic-data disclaimers in the UI or the cheat sheet beyond one presenter
  note.
- The recorder must not mutate data: only navigate, filter, switch tabs, open and
  cancel forms, hover. Never click anything that posts, saves, deletes or calls an
  external system.
- Before recording, open the app and confirm the data is current and on-brand (dates
  relative to today, Bluestem names). If this app reads from a database and the data
  is stale, stop and tell me how to reseed; don't record stale data.
- Serve a production build (vite build + vite preview) rather than the dev server;
  the dev server hangs on this OneDrive checkout. Set env vars from PowerShell, not
  Git Bash (Git Bash rewrites BASE_PATH=/ into a Windows path).
- Playwright: launch with channel 'chromium'. For MP4 use the ffmpeg from Python's
  imageio-ffmpeg (Playwright's bundled one is WebM-only); record.mjs already finds it.
- Rendered video goes in demo-kit/out (git-ignored). Don't commit or push unless I
  ask. Pull frames from the finished MP4 and look at them before telling me it's done.

Finish with: the paths of the MP4s, the running time, the artifact link, and anything
you could not verify.
```

Notes for reuse:
- The other VIBE apps are static (seed data baked in), so the "is the data current"
  step is a visual check rather than a database reseed.
- If an app has a different page structure, the scene list in scenes.mjs and the
  `actions` map in record.mjs are the only two things that need rewriting; the
  overlay, timing runner, MP4 conversion and interstitial carry over unchanged.
- Keep the interstitial identical across apps so the loop reads as one reel; only the
  `?next=` label changes.

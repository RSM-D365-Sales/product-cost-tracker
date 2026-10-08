/**
 * Single source of truth for the Product Cost Tracker booth video.
 *
 * Every other file in demo-kit/ derives from this one:
 *   record.mjs        — drives the app and records the tour, scene by scene,
 *                       holding each scene for exactly `seconds`
 *   write-script.mjs  — regenerates voiceover-script.md (timecodes + VO text)
 *                       and injects the same script into the cheat sheet
 *   scratch-vo.mjs    — builds a Windows text-to-speech scratch track so the
 *                       narration can be checked against the picture
 *
 * Edit the copy or the timings here, then re-run the scripts. Don't hand-edit
 * voiceover-script.md.
 *
 * Pacing: a relaxed read is ~150 words a minute (2.5 words a second). Each
 * scene's VO should sit just under `seconds * 2.5` words so the narrator is
 * never racing the cut.
 */

export const VIDEO = {
  title: 'Product Cost Tracker',
  // File-name stem for everything rendered into demo-kit/out
  slug: 'product-cost-tracker',
  company: 'Bluestem Fresh Produce',
  // PUN_BANK.md, "Product Cost Inquiry" row
  tagline: 'What’s it cost? Ask once, get the whole crate.',
  campus: 'Hart Packing House · Site HRT',
  // What the title card between loop videos says this clip is. The card's
  // layout and motion are shared across the Bluestem kits; only these labels
  // are passed in (see interstitial.html).
  interstitialSeconds: 12,
  interstitial: {
    eyebrow: 'Bluestem Fresh Produce · Hart Packing House · Site HRT',
    pipeline: [
      { n: 'Purchase Receipts', d: 'FOB price plus allocated charges' },
      { n: 'Landed Cost', d: 'Variance · trend · open POs' },
      { n: 'Batches On Hand', d: 'Valued at landed cost, first-expired-first-out' },
      { n: 'Production Plan', d: 'Every run costed at the lots it consumes' },
      { n: 'Dynamics 365 F&SC', d: 'Receipts · charges · BOMs · routes · on-hand' },
    ],
  },
  frame: { width: 1920, height: 1080 },
}

/** Items the tour runs. Both are seed anchors (web/src/data/seed.ts). */
export const ITEMS = { purchased: 'RAW-BLU', produced: 'PK-BLU-PINT' }

export const SCENES = [
  {
    id: 'inquiry',
    seconds: 8,
    caption: 'Product cost inquiry',
    sub: 'One item, every receipt, at landed cost',
    vo: 'What does a pound of blueberries really cost? Ask once: every receipt for the item, at its landed cost.',
    onScreen: 'Item lookup, pick RAW-BLU, Run. The Summary block fills: average purchase, add-on and landed cost, and the two margins.',
  },
  {
    id: 'landed',
    seconds: 9.5,
    caption: 'Landed cost by receipt',
    sub: 'Same $2.35 FOB price, three different landed costs',
    vo: 'Three loads at the same price land at three different costs. Expand one to see why: freight, cooling, customs, demurrage.',
    onScreen: 'Product receipts grid at the three $2.35 anchor loads; PR-105644 expanded to its charge breakdown ($0.55 a pound, demurrage included).',
  },
  {
    id: 'variance-trend',
    seconds: 10.5,
    caption: 'Variance and trend',
    sub: 'Which receipts left the pack, and where cost is heading',
    // Sub-captions shown as the scene steps through the two analysis FastTabs
    steps: [
      { caption: 'Landed cost variance', sub: 'Receipts outside tolerance, with the cause of each' },
      { caption: 'Cost trend', sub: 'Landed cost is climbing faster than purchase price' },
    ],
    vo: 'Cost variance flags every receipt outside tolerance and names the cause. Cost trend shows landed cost climbing faster than the purchase price.',
    onScreen: 'Landed cost variance FastTab with one flagged receipt expanded to its causes; then the Cost trend chart projected 12 months with the open POs as hollow marks.',
  },
  {
    id: 'impact',
    seconds: 9,
    caption: 'Impact analysis',
    sub: 'Simulate a vendor change before accepting it',
    vo: 'A vendor wants to slip a delivery a week? Simulate it first, and see which production order goes short.',
    onScreen: 'Impact analysis FastTab: PO-000931 shifted 7 days flips Covered to Has impact, with planned order PP-000126 short 42,000 lb.',
  },
  {
    id: 'production',
    seconds: 9,
    caption: 'Production cost inquiry',
    sub: 'A case of pints, costed from the lots on hand',
    vo: 'Production cost inquiry rolls up a case of pints from the lots actually on hand, and flags a stale item cost.',
    onScreen: 'Navigation pane to Production cost inquiry, pick PK-BLU-PINT, Run. Cost calculation: $30.36 a case against $28.90 on the item record.',
  },
  {
    id: 'plan',
    seconds: 12,
    caption: 'Production plan',
    sub: 'First-expired-first-out, with material at risk in dollars',
    steps: [
      { caption: 'Production plan', sub: 'First-expired-first-out, with material at risk in dollars' },
      { caption: 'Co-pack line switched on', sub: 'Material at risk goes to zero' },
    ],
    vo: 'The plan runs first-expired, first-out. Blueberries expiring tomorrow can’t all be packed in time, until the Holland co-pack line is switched on. At risk: zero.',
    onScreen: 'Production plan tiles with Material at risk $41,677.92; parameters, tick HOL-CP1, Run; the same tile at $0.00.',
  },
  {
    id: 'copilot',
    seconds: 8,
    caption: 'Copilot',
    sub: 'A written analysis of what the inquiry returned',
    vo: 'Copilot writes it up: cost position, variance drivers, material exposure and next actions, straight off the page.',
    onScreen: 'Copilot pane docked on the right: What was reviewed, Cost position, Variance drivers, Plan and material exposure, Suggested actions.',
  },
  {
    id: 'end-card',
    seconds: 8,
    caption: 'Product Cost Tracker',
    sub: 'What’s it cost? Ask once, get the whole crate.',
    vo: 'Product Cost Tracker, powered by RSM. What’s it cost? Ask once, get the whole crate.',
    onScreen: 'Midnight end card: bluestem mark, Product Cost Tracker, tagline, Powered by RSM bottom-right.',
  },
]

export const TOTAL_SECONDS = SCENES.reduce((t, s) => t + s.seconds, 0)

/** Alternate openers from PUN_BANK.md — swap into scene 1 if the room wants a hook. */
export const ALT_OPENERS = [
  'Spreadsheets are where margins go to hide. Let’s go find them.',
  'Here’s a problem every produce company knows by heart: three loads, one price, three different costs.',
]

export function wordCount(text) {
  return text.trim().split(/\s+/).filter(Boolean).length
}

export function fmtTime(sec) {
  const m = Math.floor(sec / 60)
  const s = sec - m * 60
  return `${m}:${s.toFixed(1).padStart(4, '0')}`
}

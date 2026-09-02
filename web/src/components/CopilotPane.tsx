import { useEffect, useState } from 'react'
import type { CopilotSection } from '../lib/copilot'
import { IconClear, IconCopilot } from './d365/Icons'

/**
 * The Copilot sidecar, styled after the F&SC one: a pane docked to the right
 * with the spark glyph, a generated analysis in short titled sections, and the
 * standard caution line in the footer.
 *
 * Docked, not overlaid: it renders into AppShell's `aside` slot, so opening it
 * RESIZES the form next to it — the grid stays fully scrollable and nothing on
 * the page is covered, which is how the real F&SC sidecar behaves.
 *
 * The "generation" is deterministic — lib/copilot.ts composes the sections
 * from the same result object the grids render — but the pane still takes a
 * beat to show them. Text that appears instantly reads as a label; text that
 * arrives reads as an answer, and the pause is also when the demo presenter
 * gets the room's eyes onto the pane.
 */

const THINKING_MS = 650

export function CopilotPane({
  open,
  onClose,
  sections,
  /** One line under the header naming what the analysis covers. */
  contextLabel,
}: {
  open: boolean
  onClose: () => void
  sections: CopilotSection[] | null
  contextLabel?: string
}) {
  const [thinking, setThinking] = useState(false)

  // Re-think whenever new sections arrive while open, or the pane opens onto
  // sections it has not shown yet.
  useEffect(() => {
    if (!open || !sections) return
    setThinking(true)
    const t = setTimeout(() => setThinking(false), THINKING_MS)
    return () => clearTimeout(t)
  }, [open, sections])

  if (!open) return null

  return (
    <aside
      role="complementary"
      aria-label="Copilot"
      className="flex min-h-0 w-[380px] max-w-[50vw] shrink-0 flex-col border-l border-stroke bg-surface shadow-flyout"
    >
      <header className="flex items-center gap-2 border-b border-stroke px-3 py-[9px]">
        <IconCopilot className="h-[18px] w-[18px] text-brand" />
        <span className="text-md font-semibold text-ink">Copilot</span>
        <span className="border border-stroke bg-[#F3F2F1] px-[5px] py-px text-2xs uppercase tracking-wide text-ink-secondary">
          Preview
        </span>
        <button
          type="button"
          onClick={onClose}
          className="f-btn-icon ml-auto"
          aria-label="Close Copilot"
          title="Close Copilot"
        >
          <IconClear className="h-4 w-4" />
        </button>
      </header>

      <div className="flex-1 overflow-auto px-3 py-3">
        {!sections ? (
          <div className="space-y-2 text-base text-ink-secondary">
            <p>
              Run an inquiry and Copilot will summarise the activity it
              returns: the cost position, what moved outside tolerance and in
              which direction, and what to do about it.
            </p>
          </div>
        ) : thinking ? (
          <div className="flex items-center gap-2 py-2 text-base text-ink-secondary">
            <span className="copilot-dots flex gap-[3px]" aria-hidden="true">
              <span className="h-[6px] w-[6px] rounded-full bg-brand" />
              <span className="h-[6px] w-[6px] rounded-full bg-brand" />
              <span className="h-[6px] w-[6px] rounded-full bg-brand" />
            </span>
            Working on it…
          </div>
        ) : (
          <div className="space-y-4">
            {contextLabel ? (
              <p
                className="copilot-section text-sm text-ink-secondary"
                style={{ animationDelay: '0ms' }}
              >
                {contextLabel}
              </p>
            ) : null}
            {sections.map((s, i) => (
              <section
                key={s.heading}
                className="copilot-section"
                style={{ animationDelay: `${(i + 1) * 140}ms` }}
              >
                <h3 className="mb-1 flex items-center gap-[6px] text-sm font-semibold text-ink">
                  <span className="h-[5px] w-[5px] shrink-0 rounded-full bg-brand" />
                  {s.heading}
                </h3>
                <div className="space-y-1">
                  {s.paragraphs.map((p) => (
                    <p key={p.slice(0, 40)} className="text-base leading-5 text-ink">
                      {p}
                    </p>
                  ))}
                  {s.bullets && s.bullets.length > 0 ? (
                    <ul className="list-disc space-y-1 pl-4 text-base leading-5 text-ink">
                      {s.bullets.map((b) => (
                        <li key={b.slice(0, 40)}>{b}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

      <footer className="border-t border-stroke px-3 py-2 text-xs text-ink-secondary">
        AI-generated content may be incorrect. Verify the figures against the
        inquiry before acting on them.
      </footer>
    </aside>
  )
}

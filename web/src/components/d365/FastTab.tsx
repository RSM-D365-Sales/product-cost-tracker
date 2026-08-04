import type { ReactNode } from 'react'
import { IconChevronDown, IconChevronRight } from './Icons'

/**
 * F&O FastTab: a collapsible section whose header carries the title on the left
 * and a row of read-only summary fields on the right, so a collapsed section
 * still tells you what's inside.
 */

export interface FastTabSummaryField {
  label: string
  value: ReactNode
}

interface FastTabProps {
  title: string
  expanded: boolean
  onToggle: () => void
  summary?: FastTabSummaryField[]
  children: ReactNode
  /** Rendered in the header, right of the title — e.g. a record count pill. */
  badge?: ReactNode
}

export function FastTab({
  title,
  expanded,
  onToggle,
  summary,
  children,
  badge,
}: FastTabProps) {
  const Chevron = expanded ? IconChevronDown : IconChevronRight

  return (
    <section className="border border-stroke bg-surface">
      <h2>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="flex w-full items-center gap-2 px-2 py-[7px] text-left transition-colors hover:bg-[#F3F2F1]"
        >
          <Chevron className="h-4 w-4 shrink-0 text-ink-secondary" />
          <span className="text-md font-semibold text-ink">{title}</span>
          {badge}

          {summary && summary.length > 0 ? (
            <span className="ml-auto hidden flex-wrap items-center justify-end gap-x-6 gap-y-1 pl-4 lg:flex">
              {summary.map((f) => (
                <span key={f.label} className="flex items-baseline gap-2">
                  <span className="text-sm text-ink-secondary">{f.label}</span>
                  <span className="text-base font-semibold tabular-nums text-ink">
                    {f.value}
                  </span>
                </span>
              ))}
            </span>
          ) : null}
        </button>
      </h2>

      {expanded ? (
        <div className="border-t border-stroke-subtle px-3 py-3">{children}</div>
      ) : null}
    </section>
  )
}

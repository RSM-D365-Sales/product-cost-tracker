import type { ReactNode } from 'react'
import { IconClear, IconError, IconInfo, IconWarning } from './Icons'

export type MessageKind = 'info' | 'warning' | 'error'

const STYLES: Record<
  MessageKind,
  { wrap: string; icon: typeof IconInfo; iconClass: string }
> = {
  info: {
    wrap: 'border-brand/30 bg-brand-tint text-ink',
    icon: IconInfo,
    iconClass: 'text-brand',
  },
  warning: {
    wrap: 'border-status-warn/40 bg-status-warnBg text-ink',
    icon: IconWarning,
    iconClass: 'text-status-warn',
  },
  error: {
    wrap: 'border-status-bad/35 bg-status-badBg text-ink',
    icon: IconError,
    iconClass: 'text-status-bad',
  },
}

/** The F&O message bar that drops in under the action pane. */
export function MessageBar({
  kind = 'info',
  title,
  detail,
  onDismiss,
}: {
  kind?: MessageKind
  title: ReactNode
  detail?: ReactNode
  onDismiss?: () => void
}) {
  const s = STYLES[kind]
  const Icon = s.icon

  return (
    <div
      role={kind === 'error' ? 'alert' : 'status'}
      className={`flex items-start gap-2 border px-3 py-2 text-base ${s.wrap}`}
    >
      <Icon className={`mt-[3px] h-4 w-4 shrink-0 ${s.iconClass}`} />
      <div className="min-w-0 flex-1">
        <div>{title}</div>
        {detail ? (
          <div className="mt-[2px] text-sm text-ink-secondary">{detail}</div>
        ) : null}
      </div>
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          className="f-btn-icon shrink-0"
          aria-label="Close"
          title="Close"
        >
          <IconClear className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  )
}

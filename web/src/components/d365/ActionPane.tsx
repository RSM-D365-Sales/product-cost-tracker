import type { ReactNode } from 'react'
import type { IconComponent } from './Icons'

/**
 * The F&O Action Pane: a tab strip over one or more groups of small
 * icon-and-label buttons, separated by hairline dividers.
 */

interface ActionPaneProps {
  tabs: string[]
  activeTab: string
  onTabChange: (tab: string) => void
  children: ReactNode
}

export function ActionPane({
  tabs,
  activeTab,
  onTabChange,
  children,
}: ActionPaneProps) {
  return (
    <div className="border border-stroke bg-surface">
      <div
        role="tablist"
        aria-label="Action pane"
        className="flex items-stretch gap-0 border-b border-stroke px-1"
      >
        {tabs.map((tab) => {
          const active = tab === activeTab
          return (
            <button
              key={tab}
              role="tab"
              type="button"
              aria-selected={active}
              onClick={() => onTabChange(tab)}
              className={[
                'relative select-none px-3 pb-[7px] pt-[8px] text-base transition-colors',
                active
                  ? 'font-semibold text-ink'
                  : 'text-ink-secondary hover:text-ink',
              ].join(' ')}
            >
              {tab}
              {active ? (
                <span className="absolute inset-x-2 -bottom-px h-[2px] bg-brand" />
              ) : null}
            </button>
          )
        })}
      </div>

      <div className="flex flex-wrap items-center gap-x-1 gap-y-1 px-2 py-[6px]">
        {children}
      </div>
    </div>
  )
}

/** A labelled cluster of buttons, following the F&O convention of a caption underneath. */
export function ActionGroup({
  label,
  children,
}: {
  label?: string
  children: ReactNode
}) {
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-1">{children}</div>
      {label ? (
        <div className="mt-[2px] px-1 text-xs text-ink-secondary">{label}</div>
      ) : null}
    </div>
  )
}

export function ActionDivider() {
  return <div className="mx-2 h-[26px] w-px self-start bg-stroke" />
}

interface ActionButtonProps {
  icon?: IconComponent
  children: ReactNode
  onClick?: () => void
  disabled?: boolean
  primary?: boolean
  title?: string
  type?: 'button' | 'submit'
}

export function ActionButton({
  icon: Icon,
  children,
  onClick,
  disabled,
  primary,
  title,
  type = 'button',
}: ActionButtonProps) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={['f-btn', primary ? 'f-btn-primary' : ''].join(' ')}
    >
      {Icon ? <Icon className="h-4 w-4 shrink-0" /> : null}
      <span>{children}</span>
    </button>
  )
}

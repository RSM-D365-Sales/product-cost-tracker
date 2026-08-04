import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { PAGES, type PageId } from '../../lib/route'
import {
  IconChevronRight,
  IconHelp,
  IconMenu,
  IconSearch,
  IconSettings,
  IconStar,
} from './Icons'

/**
 * The Finance and Operations application frame: dark navigation bar, module
 * breadcrumb, page caption, then the form body on the light canvas.
 */

interface AppShellProps {
  /** Small grey breadcrumb above the caption, e.g. "Procurement and sourcing > Inquiries and reports". */
  moduleTrail: string
  /** The form caption. */
  title: string
  company: string
  /** Rendered flush right in the caption row — usually the provider badge. */
  captionAside?: ReactNode
  children: ReactNode
  statusBar?: ReactNode
  /** Highlighted in the navigation pane. */
  activePageId?: PageId
  onNavigate?: (pageId: PageId) => void
}

export function AppShell({
  moduleTrail,
  title,
  company,
  captionAside,
  children,
  statusBar,
  activePageId,
  onNavigate,
}: AppShellProps) {
  const [navOpen, setNavOpen] = useState(false)

  return (
    <div className="flex h-full min-h-screen flex-col bg-canvas">
      <NavBar
        company={company}
        navOpen={navOpen}
        onToggleNav={onNavigate ? () => setNavOpen((v) => !v) : undefined}
      />

      {navOpen && onNavigate ? (
        <NavPane
          activePageId={activePageId}
          onNavigate={(id) => {
            onNavigate(id)
            setNavOpen(false)
          }}
          onDismiss={() => setNavOpen(false)}
        />
      ) : null}

      <div className="flex-1">
        <div className="mx-auto w-full max-w-[1600px] px-4 pb-8 pt-3">
          <div className="mb-1 flex items-center gap-2 text-sm text-ink-secondary">
            <span>{moduleTrail}</span>
          </div>

          <div className="mb-3 flex items-start gap-2">
            <h1 className="text-xl font-semibold leading-7 text-ink">{title}</h1>
            <button
              type="button"
              className="f-btn-icon mt-[2px]"
              title="Add to favorites"
              aria-label="Add to favorites"
            >
              <IconStar className="h-4 w-4" />
            </button>
            <div className="ml-auto">{captionAside}</div>
          </div>

          {children}
        </div>
      </div>

      {statusBar ? (
        <footer className="sticky bottom-0 border-t border-stroke bg-[#F3F2F1] px-4 py-[6px] text-sm text-ink-secondary">
          <div className="mx-auto w-full max-w-[1600px]">{statusBar}</div>
        </footer>
      ) : null}
    </div>
  )
}

function NavBar({
  company,
  navOpen,
  onToggleNav,
}: {
  company: string
  navOpen: boolean
  onToggleNav?: () => void
}) {
  return (
    <header className="flex h-[42px] shrink-0 items-center gap-1 bg-nav px-2 text-nav-text">
      <button
        type="button"
        onClick={onToggleNav}
        aria-expanded={onToggleNav ? navOpen : undefined}
        className="flex h-[30px] w-[30px] items-center justify-center transition-colors hover:bg-nav-hover"
        aria-label="Expand the navigation pane"
        title="Expand the navigation pane"
      >
        <IconMenu className="h-4 w-4" />
      </button>

      <span className="ml-1 mr-3 text-md font-semibold tracking-tight">
        Finance and Operations
      </span>

      <div className="hidden min-w-0 flex-1 items-center md:flex">
        <div className="relative w-full max-w-[420px]">
          <IconSearch className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-white/60" />
          <input
            className="h-[26px] w-full border border-white/25 bg-white/10 pl-7 pr-2 text-base text-white outline-none transition-colors placeholder:text-white/55 hover:bg-white/15 focus:border-white/60 focus:bg-white/20"
            placeholder="Search for a page"
            aria-label="Search for a page"
          />
        </div>
      </div>

      <div className="ml-auto flex items-center gap-1">
        <span className="mr-1 border border-white/25 px-2 py-[2px] text-sm tracking-wide">
          {company}
        </span>
        <NavIconButton label="Settings">
          <IconSettings className="h-4 w-4" />
        </NavIconButton>
        <NavIconButton label="Help">
          <IconHelp className="h-4 w-4" />
        </NavIconButton>
        <div
          className="ml-1 flex h-[26px] w-[26px] items-center justify-center rounded-full bg-white/20 text-sm font-semibold"
          title="Signed in"
        >
          RM
        </div>
      </div>
    </header>
  )
}

/**
 * The F&O navigation pane: modules down the left, the pages inside them
 * underneath. Only inquiry forms are listed because they are the only ones that
 * exist — a fake module tree would be more misleading than a short true one.
 */
function NavPane({
  activePageId,
  onNavigate,
  onDismiss,
}: {
  activePageId?: PageId
  onNavigate: (pageId: PageId) => void
  onDismiss: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismiss()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onDismiss])

  const modules = [...new Set(PAGES.map((p) => p.module))]

  return (
    <>
      <div
        className="fixed inset-0 top-[42px] z-20 bg-black/20"
        onClick={onDismiss}
        aria-hidden="true"
      />
      <nav
        aria-label="Navigation pane"
        className="fixed left-0 top-[42px] z-30 h-[calc(100%-42px)] w-[300px] overflow-auto border-r border-stroke bg-surface shadow-flyout"
      >
        <div className="border-b border-stroke-subtle px-3 py-2 text-sm font-semibold text-ink-secondary">
          Modules
        </div>
        {modules.map((module) => (
          <div key={module} className="border-b border-stroke-subtle py-1">
            <div className="px-3 py-1 text-sm font-semibold text-ink">
              {module}
            </div>
            {PAGES.filter((p) => p.module === module).map((page) => {
              const active = page.id === activePageId
              return (
                <button
                  key={page.id}
                  type="button"
                  onClick={() => onNavigate(page.id)}
                  aria-current={active ? 'page' : undefined}
                  className={[
                    'flex w-full items-center gap-1 py-[5px] pl-5 pr-3 text-left text-base transition-colors',
                    active
                      ? 'border-l-[3px] border-brand bg-brand-tint pl-[17px] font-semibold text-brand'
                      : 'hover:bg-[#F3F2F1]',
                  ].join(' ')}
                >
                  <IconChevronRight className="h-3 w-3 shrink-0 text-ink-secondary" />
                  {page.title}
                </button>
              )
            })}
          </div>
        ))}
      </nav>
    </>
  )
}

function NavIconButton({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <button
      type="button"
      className="flex h-[30px] w-[30px] items-center justify-center transition-colors hover:bg-nav-hover"
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  )
}

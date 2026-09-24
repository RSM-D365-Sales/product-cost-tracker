import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { PAGES, type PageId } from '../../lib/route'
import { isEmbedded } from '../../lib/embed'
import rsmLogoWhite from '../../assets/rsmus-logo-white.png'
import {
  IconChevronRight,
  IconHelp,
  IconMenu,
  IconSearch,
  IconSettings,
  IconStar,
} from './Icons'

/**
 * The Finance and Operations application frame: the bluestem title ribbon,
 * module breadcrumb, page caption, then the form body on the light canvas.
 *
 * The ribbon is Bluestem's themed F&O navigation bar (Midnight, bluestem logo
 * left, RSM sponsor mark right — BRAND_GUIDE.md). It shows by default because
 * the brand guide requires the RSM mark on every app. `?embed=1` (or
 * VITE_EMBED=1 — see lib/embed.ts) drops it when the page is hosted inside a
 * real F&SC workspace that already draws its own bar.
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
  /**
   * A docked right-hand sidecar — the Copilot pane. When present, the frame
   * switches to a fixed-height layout: the content column keeps its own
   * scrollbar and the sidecar hugs the right edge at full height, so the form
   * RESIZES next to it instead of being covered by an overlay. Pass null when
   * the sidecar is closed and the page scrolls normally again.
   */
  aside?: ReactNode
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
  aside,
  activePageId,
  onNavigate,
}: AppShellProps) {
  const [navOpen, setNavOpen] = useState(false)
  const docked = aside !== null && aside !== undefined && aside !== false

  return (
    <div
      className={
        docked
          ? 'flex h-screen flex-col overflow-hidden bg-canvas'
          : 'flex h-full min-h-screen flex-col bg-canvas'
      }
    >
      {isEmbedded ? null : (
        <NavBar
          company={company}
          navOpen={navOpen}
          onToggleNav={onNavigate ? () => setNavOpen((v) => !v) : undefined}
        />
      )}

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

      <div className={docked ? 'flex min-h-0 flex-1' : 'flex-1'}>
        <div className={docked ? 'min-w-0 flex-1 overflow-y-auto' : undefined}>
          <div className="mx-auto w-full max-w-[1600px] px-4 pb-8 pt-3">
            <div className="mb-1 flex items-center gap-2 text-sm text-ink-secondary">
              <span>{moduleTrail}</span>
            </div>

            <div className="mb-3 flex items-start gap-2">
              <h1 className="font-display text-xl font-semibold leading-7 text-midnight">
                {title}
              </h1>
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

        {aside}
      </div>

      {statusBar ? (
        <footer className="sticky bottom-0 border-t border-stroke bg-[#F3F2F1] px-4 py-[6px] text-sm text-ink-secondary">
          <div className="mx-auto w-full max-w-[1600px]">{statusBar}</div>
        </footer>
      ) : null}
    </div>
  )
}

/** Signed-in demo persona — Bluestem's produce buyer (employees.csv, E1017). */
const PERSONA = { initials: 'RD', name: 'Rosa Delgado', title: 'Buyer - Produce' }

/**
 * bluestem mark and wordmark, drawn for a Midnight ground: white stem rising
 * into the RSM Green leaf, "blue" in white and "stem" in green. Geometry is
 * the brand kit's bluestem_logo.svg.
 */
function BluestemLogo() {
  return (
    <span className="flex items-center gap-[6px]" aria-label="bluestem" role="img">
      <svg width="22" height="24" viewBox="40 30 200 220" aria-hidden="true">
        <path d="M62 232 Q75 150 150 130" stroke="#FFFFFF" strokeWidth="26" strokeLinecap="round" fill="none" />
        <g transform="translate(155 108) rotate(-45)">
          <path d="M-72 0 C-40 -50 40 -50 72 0 C40 50 -40 50 -72 0 Z" fill="#3F9C35" />
          <path d="M-45 0 L45 0" stroke="#FFFFFF" strokeWidth="8" strokeLinecap="round" />
        </g>
      </svg>
      <span className="font-display text-[20px] font-semibold leading-none tracking-tight" aria-hidden="true">
        blue<span className="text-rsmgreen">stem</span>
      </span>
    </span>
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
    <header className="flex h-[48px] shrink-0 items-center gap-1 bg-nav px-2 text-nav-text">
      <button
        type="button"
        onClick={onToggleNav}
        aria-expanded={onToggleNav ? navOpen : undefined}
        className="flex h-[32px] w-[32px] items-center justify-center transition-colors hover:bg-nav-hover"
        aria-label="Expand the navigation pane"
        title="Expand the navigation pane"
      >
        <IconMenu className="h-4 w-4" />
      </button>

      <span className="ml-1">
        <BluestemLogo />
      </span>

      <span className="mx-3 h-5 w-px bg-white/25" aria-hidden="true" />

      <span className="mr-3 font-display text-md font-semibold tracking-tight">
        Finance and Operations
      </span>

      <div className="hidden min-w-0 flex-1 items-center md:flex">
        <div className="relative w-full max-w-[380px]">
          <IconSearch className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-white/60" />
          <input
            className="h-[28px] w-full border border-white/25 bg-white/10 pl-7 pr-2 text-base text-white outline-none transition-colors placeholder:text-white/55 hover:bg-white/15 focus:border-rsmblue focus:bg-white/20"
            placeholder="Search for a page"
            aria-label="Search for a page"
          />
        </div>
      </div>

      <div className="ml-auto flex items-center gap-1">
        <span
          className="mr-1 border border-white/25 px-2 py-[2px] text-sm tracking-wide"
          title="Legal entity"
        >
          {company}
        </span>
        <NavIconButton label="Settings">
          <IconSettings className="h-4 w-4" />
        </NavIconButton>
        <NavIconButton label="Help">
          <IconHelp className="h-4 w-4" />
        </NavIconButton>

        {/* RSM sponsor mark — required on every bluestem app (BRAND_GUIDE.md):
            right end of the ribbon, divider before it, avatar after it. */}
        <span className="mx-2 h-6 w-px bg-white/25" aria-hidden="true" />
        <span className="flex items-center gap-[6px]">
          <span className="text-xs text-[#C9D1DB]">Powered by</span>
          <img src={rsmLogoWhite} alt="RSM" className="h-[22px] w-auto" />
        </span>

        <div
          className="ml-3 flex h-[30px] w-[30px] items-center justify-center rounded-full bg-rsmblue text-sm font-semibold"
          title={`Signed in as ${PERSONA.name}, ${PERSONA.title}`}
        >
          {PERSONA.initials}
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
        className="fixed inset-0 top-[48px] z-20 bg-black/20"
        onClick={onDismiss}
        aria-hidden="true"
      />
      <nav
        aria-label="Navigation pane"
        className="fixed left-0 top-[48px] z-30 h-[calc(100%-48px)] w-[300px] overflow-auto border-r border-stroke bg-surface shadow-flyout"
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
      className="flex h-[32px] w-[32px] items-center justify-center transition-colors hover:bg-nav-hover"
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  )
}

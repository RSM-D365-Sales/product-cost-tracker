import type { ReactNode, SVGProps } from 'react'

/**
 * Fluent-style line icons, inlined rather than pulled from a package so the
 * build stays dependency-free and safe to host under a strict CSP.
 * All are 16x16 on a 16-unit viewBox and inherit currentColor.
 */

type IconProps = {
  className?: string
  title?: string
}

export type IconComponent = (props: IconProps) => JSX.Element

function svg(path: ReactNode, extra?: Partial<SVGProps<SVGSVGElement>>) {
  return function Icon({ className = 'h-4 w-4', title }: IconProps) {
    return (
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
        aria-hidden={title ? undefined : true}
        role={title ? 'img' : undefined}
        {...extra}
      >
        {title ? <title>{title}</title> : null}
        {path}
      </svg>
    )
  }
}

export const IconMenu = svg(
  <>
    <path d="M2 4h12M2 8h12M2 12h12" />
  </>,
)

export const IconSearch = svg(
  <>
    <circle cx="7" cy="7" r="4.25" />
    <path d="M10.2 10.2 14 14" />
  </>,
)

export const IconStar = svg(
  <path d="M8 1.9 9.9 5.7l4.2.6-3 3 .7 4.2L8 11.5l-3.8 2 .7-4.2-3-3 4.2-.6z" />,
)

export const IconSettings = svg(
  <>
    <circle cx="8" cy="8" r="2.1" />
    <path d="M8 1.4v1.7M8 12.9v1.7M14.6 8h-1.7M3.1 8H1.4M12.7 3.3l-1.2 1.2M4.5 11.5l-1.2 1.2M12.7 12.7l-1.2-1.2M4.5 4.5 3.3 3.3" />
  </>,
)

export const IconHelp = svg(
  <>
    <circle cx="8" cy="8" r="6.2" />
    <path d="M6.3 6.1a1.75 1.75 0 1 1 2.3 1.66c-.42.15-.6.5-.6.94v.4" />
    <circle cx="8" cy="11.6" r=".65" fill="currentColor" stroke="none" />
  </>,
)

export const IconChevronDown = svg(<path d="M3.5 6 8 10.5 12.5 6" />)
export const IconChevronRight = svg(<path d="M6 3.5 10.5 8 6 12.5" />)
export const IconChevronUp = svg(<path d="M3.5 10 8 5.5 12.5 10" />)

export const IconRefresh = svg(
  <>
    <path d="M13.6 7A5.7 5.7 0 0 0 3.3 4.9" />
    <path d="M2.4 9A5.7 5.7 0 0 0 12.7 11.1" />
    <path d="M3.4 1.9v3h3M12.6 14.1v-3h-3" />
  </>,
)

export const IconExcel = svg(
  <>
    <path d="M9.2 2.2H3.4v11.6h5.8" />
    <path d="M9.2 1.3 13.6 2.4v11.2L9.2 14.7z" />
    <path d="M5 6l2.4 4M7.4 6 5 10" />
  </>,
)

export const IconFilter = svg(<path d="M2 3h12l-4.6 5.3v4.4l-2.8 1.4V8.3z" />)

export const IconClear = svg(<path d="M4 4l8 8M12 4l-8 8" />)

export const IconOpen = svg(
  <>
    <path d="M9.5 2.5H13.5v4" />
    <path d="M13.5 2.5 8 8" />
    <path d="M12.4 9.4v3.6a.9.9 0 0 1-.9.9H3a.9.9 0 0 1-.9-.9V4.5a.9.9 0 0 1 .9-.9h3.7" />
  </>,
)

export const IconInfo = svg(
  <>
    <circle cx="8" cy="8" r="6.2" />
    <path d="M8 7.3v4" />
    <circle cx="8" cy="4.9" r=".65" fill="currentColor" stroke="none" />
  </>,
)

export const IconWarning = svg(
  <>
    <path d="M8 1.9 15 14H1z" />
    <path d="M8 6.2v3.4" />
    <circle cx="8" cy="11.7" r=".65" fill="currentColor" stroke="none" />
  </>,
)

export const IconError = svg(
  <>
    <circle cx="8" cy="8" r="6.2" />
    <path d="M5.6 5.6l4.8 4.8M10.4 5.6l-4.8 4.8" />
  </>,
)

export const IconSpinner = svg(
  <>
    <circle cx="8" cy="8" r="6" className="opacity-25" />
    <path d="M14 8a6 6 0 0 0-6-6" />
  </>,
)

export const IconGrid = svg(
  <>
    <rect x="2" y="3" width="12" height="10" rx=".6" />
    <path d="M2 6.3h12M2 9.6h12M6.2 6.3V13" />
  </>,
)

export const IconExpand = svg(
  <>
    <path d="M2.5 6V2.5H6M14 6V2.5h-3.5M2.5 10v3.5H6M14 10v3.5h-3.5" />
  </>,
)

/** Plant with a stack — production. */
export const IconFactory = svg(
  <>
    <path d="M2 13.5V7l3.6 2.2V7L9.2 9.2V4.4h1.6l.5 9.1" />
    <path d="M1.4 13.5h13.2" />
    <path d="M4.4 11.4v1M7.6 11.4v1M10.8 11.4v1" />
  </>,
)

/** A stacked bill of material: parent with two indented children. */
export const IconTree = svg(
  <>
    <path d="M2.5 3h11" />
    <path d="M4.5 3v3.6h9M4.5 6.6v4.4h9" />
    <path d="M2.5 13h11" strokeDasharray="2 1.6" />
  </>,
)

/** A batch/lot carton. */
export const IconBox = svg(
  <>
    <path d="M8 1.9 14 5v6L8 14.1 2 11V5z" />
    <path d="M2 5l6 3 6-3M8 8v6.1" />
  </>,
)

/** A clock face with an alert stroke — shelf life running out. */
export const IconClock = svg(
  <>
    <circle cx="8" cy="8" r="6.2" />
    <path d="M8 4.4V8l2.6 1.6" />
  </>,
)

/** Axes with a rising line and a dashed continuation — a trend and its forecast. */
export const IconChart = svg(
  <>
    <path d="M2.5 2.5v11h11" />
    <path d="M4.5 11 7 8l2 1.5L11.5 5" />
    <path d="M11.5 5v0" strokeDasharray="0.1 2.2" />
    <path d="M11.5 5 14 3" strokeDasharray="2 1.6" />
  </>,
)

import { Fragment, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { IconChevronDown, IconChevronRight, IconSpinner } from './Icons'

export interface Column<T> {
  key: string
  header: string
  /** Any CSS width; the table is fixed-layout so these are respected. */
  width?: string
  align?: 'left' | 'right' | 'center'
  render: (row: T) => ReactNode
  /** Supply to make the column sortable. */
  sortValue?: (row: T) => string | number
  /** Wraps the header text in a title attribute for long captions. */
  headerTitle?: string
}

interface GridProps<T> {
  columns: Column<T>[]
  rows: T[]
  getRowId: (row: T) => string
  selectedId?: string | null
  onSelect?: (id: string) => void
  /** When supplied, each row gets an expander that reveals this content. */
  renderDetail?: (row: T) => ReactNode
  loading?: boolean
  emptyMessage?: string
  /** Height of the scroll viewport. */
  maxHeight?: string
}

type SortState = { key: string; dir: 'asc' | 'desc' } | null

/**
 * F&O-style data grid: sticky header, single-select radio column, optional
 * expandable detail row, and click-to-sort headers.
 */
export function Grid<T>({
  columns,
  rows,
  getRowId,
  selectedId,
  onSelect,
  renderDetail,
  loading,
  emptyMessage = 'There is no data to display.',
  maxHeight = '440px',
}: GridProps<T>) {
  const [sort, setSort] = useState<SortState>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const sorted = useMemo(() => {
    if (!sort) return rows
    const col = columns.find((c) => c.key === sort.key)
    if (!col?.sortValue) return rows
    const pick = col.sortValue
    // Copy first — never sort the array the caller handed us in place.
    return [...rows].sort((a, b) => {
      const av = pick(a)
      const bv = pick(b)
      const cmp = av < bv ? -1 : av > bv ? 1 : 0
      return sort.dir === 'asc' ? cmp : -cmp
    })
  }, [rows, sort, columns])

  const toggleSort = (col: Column<T>) => {
    if (!col.sortValue) return
    setSort((s) =>
      s?.key === col.key
        ? { key: col.key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
        : { key: col.key, dir: 'asc' },
    )
  }

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const leadingCols = (onSelect ? 1 : 0) + (renderDetail ? 1 : 0)

  return (
    <div className="border border-stroke bg-surface">
      <div className="overflow-auto" style={{ maxHeight }}>
        <table className="f-grid" style={{ tableLayout: 'fixed' }}>
          <colgroup>
            {onSelect ? <col style={{ width: '44px' }} /> : null}
            {renderDetail ? <col style={{ width: '30px' }} /> : null}
            {columns.map((c) => (
              <col key={c.key} style={{ width: c.width ?? 'auto' }} />
            ))}
          </colgroup>

          <thead>
            <tr>
              {onSelect ? (
                <th scope="col" className="text-center">
                  <span className="sr-only">Select</span>
                  <span aria-hidden="true">Select</span>
                </th>
              ) : null}
              {renderDetail ? (
                <th scope="col">
                  <span className="sr-only">Expand</span>
                </th>
              ) : null}

              {columns.map((c) => {
                const active = sort?.key === c.key
                return (
                  <th
                    key={c.key}
                    scope="col"
                    title={c.headerTitle}
                    aria-sort={
                      active
                        ? sort.dir === 'asc'
                          ? 'ascending'
                          : 'descending'
                        : undefined
                    }
                    className={
                      c.align === 'right'
                        ? 'text-right'
                        : c.align === 'center'
                          ? 'text-center'
                          : 'text-left'
                    }
                  >
                    {c.sortValue ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(c)}
                        className="inline-flex max-w-full items-center gap-1 hover:text-brand"
                      >
                        <span className="truncate">{c.header}</span>
                        {active ? (
                          <span className="shrink-0 text-2xs text-brand">
                            {sort.dir === 'asc' ? '▲' : '▼'}
                          </span>
                        ) : null}
                      </button>
                    ) : (
                      c.header
                    )}
                  </th>
                )
              })}
            </tr>
          </thead>

          <tbody>
            {loading ? (
              <tr>
                <td
                  colSpan={columns.length + leadingCols}
                  className="py-10 text-center text-ink-secondary"
                >
                  <span className="inline-flex items-center gap-2">
                    <IconSpinner className="h-4 w-4 animate-spin" />
                    Retrieving data&hellip;
                  </span>
                </td>
              </tr>
            ) : sorted.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length + leadingCols}
                  className="py-10 text-center text-ink-secondary"
                >
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              sorted.map((row) => {
                const id = getRowId(row)
                const isSelected = selectedId === id
                const isExpanded = expanded.has(id)
                const Chevron = isExpanded ? IconChevronDown : IconChevronRight

                return (
                  <Fragment key={id}>
                    <tr data-selected={isSelected}>
                      {onSelect ? (
                        <td className="text-center">
                          <input
                            type="radio"
                            name="grid-selection"
                            checked={isSelected}
                            onChange={() => onSelect(id)}
                            aria-label={`Select row ${id}`}
                            className="h-[13px] w-[13px] cursor-pointer accent-brand"
                          />
                        </td>
                      ) : null}

                      {renderDetail ? (
                        <td>
                          <button
                            type="button"
                            onClick={() => toggleExpand(id)}
                            aria-expanded={isExpanded}
                            aria-label={
                              isExpanded ? 'Collapse charges' : 'Expand charges'
                            }
                            className="flex h-5 w-5 items-center justify-center text-ink-secondary hover:text-brand"
                          >
                            <Chevron className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      ) : null}

                      {columns.map((c) => (
                        <td
                          key={c.key}
                          className={
                            c.align === 'right'
                              ? 'f-num'
                              : c.align === 'center'
                                ? 'text-center'
                                : ''
                          }
                        >
                          {c.render(row)}
                        </td>
                      ))}
                    </tr>

                    {renderDetail && isExpanded ? (
                      <tr>
                        <td
                          colSpan={columns.length + leadingCols}
                          className="!bg-[#FAF9F8] !p-0"
                        >
                          <div className="border-l-[3px] border-brand px-3 py-2">
                            {renderDetail(row)}
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

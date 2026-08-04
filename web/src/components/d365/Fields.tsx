import { useEffect, useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { Ref } from '../../types/domain'
import { IconChevronDown, IconSearch } from './Icons'

/** Label + control, stacked, at the F&O field width. */
export function Field({
  label,
  required,
  hint,
  children,
  className = '',
}: {
  label: string
  required?: boolean
  hint?: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className={className}>
      <span className="f-label">
        {label}
        {required ? (
          <span className="ml-[3px] text-status-bad" title="Required">
            *
          </span>
        ) : null}
      </span>
      {children}
      {hint ? (
        <p className="mt-[2px] text-xs text-ink-secondary">{hint}</p>
      ) : null}
    </div>
  )
}

export function TextField({
  label,
  value,
  onChange,
  placeholder,
  required,
  hint,
  className,
  onEnter,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  required?: boolean
  hint?: string
  className?: string
  onEnter?: () => void
}) {
  return (
    <Field label={label} required={required} hint={hint} className={className}>
      <input
        className="f-input"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && onEnter) onEnter()
        }}
      />
    </Field>
  )
}

export function DateField({
  label,
  value,
  onChange,
  disabled,
  className,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  disabled?: boolean
  className?: string
}) {
  return (
    <Field label={label} className={className}>
      <input
        type="date"
        className="f-input"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  )
}

export function NumberField({
  label,
  value,
  onChange,
  placeholder,
  min,
  hint,
  className,
}: {
  label: string
  value: number | ''
  onChange: (v: number | '') => void
  placeholder?: string
  min?: number
  hint?: string
  className?: string
}) {
  return (
    <Field label={label} hint={hint} className={className}>
      <input
        type="number"
        className="f-input f-input-num"
        value={value}
        min={min}
        placeholder={placeholder}
        onChange={(e) => {
          const raw = e.target.value
          onChange(raw === '' ? '' : Number(raw))
        }}
      />
    </Field>
  )
}

/**
 * F&O lookup field: free text with a dropdown of matching records. The user can
 * always type a value that isn't in the list — F&O validates on run, not on
 * keystroke, and a segment code the lookup hasn't loaded is still legitimate.
 */
export function LookupField({
  label,
  value,
  onChange,
  fetchOptions,
  required,
  placeholder,
  hint,
  className,
  disabled,
  onEnter,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  fetchOptions: (term: string, signal: AbortSignal) => Promise<Ref[]>
  required?: boolean
  placeholder?: string
  hint?: string
  className?: string
  disabled?: boolean
  onEnter?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [options, setOptions] = useState<Ref[]>([])
  const [loading, setLoading] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const wrapRef = useRef<HTMLDivElement>(null)
  const listId = useId()

  // Close on outside click, the way F&O flyouts behave.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  // Debounced fetch while the dropdown is open. The AbortController means a
  // fast typist never has an early response overwrite a later one.
  useEffect(() => {
    if (!open || disabled) return
    const ctrl = new AbortController()
    setLoading(true)
    const t = setTimeout(() => {
      fetchOptions(value, ctrl.signal)
        .then((opts) => {
          setOptions(opts)
          setHighlight(0)
        })
        .catch(() => {
          /* aborted or provider error — the dropdown just stays empty */
        })
        .finally(() => setLoading(false))
    }, 160)
    return () => {
      clearTimeout(t)
      ctrl.abort()
    }
  }, [open, value, disabled, fetchOptions])

  const commit = (v: string) => {
    onChange(v)
    setOpen(false)
  }

  return (
    <Field label={label} required={required} hint={hint} className={className}>
      <div ref={wrapRef} className="relative">
        <input
          className="f-input pr-7"
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            onChange(e.target.value)
            setOpen(true)
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setOpen(true)
              setHighlight((h) => Math.min(h + 1, options.length - 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setHighlight((h) => Math.max(h - 1, 0))
            } else if (e.key === 'Enter') {
              if (open && options[highlight]) {
                e.preventDefault()
                commit(options[highlight].id)
              } else {
                setOpen(false)
                onEnter?.()
              }
            } else if (e.key === 'Escape') {
              setOpen(false)
            }
          }}
        />

        <button
          type="button"
          tabIndex={-1}
          disabled={disabled}
          aria-label={`Open ${label} lookup`}
          onClick={() => setOpen((o) => !o)}
          className="absolute right-0 top-0 flex h-[26px] w-[24px] items-center justify-center text-ink-secondary transition-colors hover:text-ink disabled:text-ink-disabled"
        >
          <IconChevronDown className="h-3.5 w-3.5" />
        </button>

        {open && !disabled ? (
          <ul
            id={listId}
            role="listbox"
            className="absolute left-0 top-[27px] z-30 max-h-[260px] w-full min-w-[240px] overflow-auto border border-stroke bg-surface shadow-flyout"
          >
            {loading && options.length === 0 ? (
              <li className="px-2 py-2 text-sm text-ink-secondary">
                Loading&hellip;
              </li>
            ) : options.length === 0 ? (
              <li className="flex items-center gap-2 px-2 py-2 text-sm text-ink-secondary">
                <IconSearch className="h-3.5 w-3.5" />
                No matching records
              </li>
            ) : (
              options.map((o, i) => (
                <li key={o.id} role="option" aria-selected={i === highlight}>
                  <button
                    type="button"
                    onMouseEnter={() => setHighlight(i)}
                    onClick={() => commit(o.id)}
                    className={[
                      'flex w-full items-baseline gap-2 px-2 py-[5px] text-left text-base',
                      i === highlight ? 'bg-brand-tint' : 'hover:bg-[#F3F2F1]',
                    ].join(' ')}
                  >
                    <span className="font-semibold text-ink">{o.id}</span>
                    {o.name ? (
                      <span className="truncate text-sm text-ink-secondary">
                        {o.name}
                      </span>
                    ) : null}
                  </button>
                </li>
              ))
            )}
          </ul>
        ) : null}
      </div>
    </Field>
  )
}

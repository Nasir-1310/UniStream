'use client'
// components/admin/parts.tsx — small building blocks shared by the admin sections.

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, Copy, RefreshCw, type LucideIcon } from 'lucide-react'
import { Alert } from '@/components/ui'

// ── Section header ────────────────────────────────────────────────────────────

export function SectionHeader({
  id,
  title,
  description,
  actions,
}: {
  /** Section id; the heading gets id `admin-h-<id>` so navigation can focus it. */
  id: string
  title: string
  description?: ReactNode
  actions?: ReactNode
}) {
  return (
    <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between mb-5 sm:mb-6">
      <div className="min-w-0">
        <h1 id={`admin-h-${id}`} tabIndex={-1} className="text-xl sm:text-2xl font-bold text-white outline-none">
          {title}
        </h1>
        {description && <p className="mt-1 text-[13px] sm:text-sm text-slate-400">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 sm:justify-end">{actions}</div>}
    </header>
  )
}

// ── Card ──────────────────────────────────────────────────────────────────────

export function Card({
  title,
  description,
  icon: Icon,
  actions,
  children,
  className = '',
  bodyClassName = 'p-4 sm:p-5',
  id,
}: {
  title?: ReactNode
  description?: ReactNode
  icon?: LucideIcon
  actions?: ReactNode
  children?: ReactNode
  className?: string
  bodyClassName?: string
  id?: string
}) {
  return (
    <section id={id} className={`surface-card min-w-0 ${className}`}>
      {(title || actions) && (
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/[0.06] px-4 sm:px-5 py-3.5">
          <div className="flex items-start gap-3 min-w-0">
            {Icon && (
              <span className="mt-0.5 w-8 h-8 flex-shrink-0 rounded-lg bg-white/[0.04] border border-white/[0.08] flex items-center justify-center">
                <Icon className="w-4 h-4 text-slate-300" aria-hidden="true" />
              </span>
            )}
            <div className="min-w-0">
              {title && <h2 className="text-[15px] font-semibold text-white">{title}</h2>}
              {description && <p className="mt-0.5 text-[13px] text-slate-400">{description}</p>}
            </div>
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  )
}

// ── Stat card ─────────────────────────────────────────────────────────────────

const STAT_TONES = {
  neutral: 'text-slate-300 bg-white/[0.04] border-white/[0.08]',
  brand: 'text-indigo-300 bg-indigo-500/10 border-indigo-500/25',
  success: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/25',
  warning: 'text-amber-300 bg-amber-500/10 border-amber-500/25',
  info: 'text-sky-300 bg-sky-500/10 border-sky-500/25',
} as const

export function StatCard({
  label,
  value,
  icon: Icon,
  tone = 'neutral',
  hint,
  action,
}: {
  label: string
  value: ReactNode
  icon: LucideIcon
  tone?: keyof typeof STAT_TONES
  hint?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="surface-card p-4 sm:p-5 flex flex-col gap-3 min-w-0">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[12px] sm:text-[13px] font-medium text-slate-400 leading-tight">{label}</p>
        <span className={`w-8 h-8 flex-shrink-0 rounded-lg border flex items-center justify-center ${STAT_TONES[tone]}`}>
          <Icon className="w-4 h-4" aria-hidden="true" />
        </span>
      </div>
      <p className="text-2xl sm:text-3xl font-semibold text-white leading-none tracking-tight">{value}</p>
      {(hint || action) && (
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-[12px] text-slate-500 min-h-5">
          {hint && <span className="min-w-0">{hint}</span>}
          {action}
        </div>
      )}
    </div>
  )
}

// ── Copy to clipboard ─────────────────────────────────────────────────────────

/** Copy text; falls back to a hidden textarea where the async clipboard API is unavailable (http, old WebViews). */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* fall through */
  }
  try {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    area.style.top = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    area.remove()
    return ok
  } catch {
    return false
  }
}

export function CopyButton({
  text,
  label = 'Copy',
  copiedLabel = 'Copied',
  className = 'btn-outline btn-sm',
  iconOnly = false,
}: {
  text: string
  label?: string
  copiedLabel?: string
  className?: string
  iconOnly?: boolean
}) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const onClick = async () => {
    const ok = await copyText(text)
    setState(ok ? 'copied' : 'failed')
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setState('idle'), 2000)
  }

  const current = state === 'copied' ? copiedLabel : state === 'failed' ? 'Copy failed — select and copy' : label
  return (
    <button
      type="button"
      onClick={onClick}
      className={className}
      aria-label={iconOnly ? current : undefined}
      title={iconOnly ? current : undefined}
    >
      {state === 'copied' ? (
        <Check className="w-4 h-4 text-emerald-400" aria-hidden="true" />
      ) : (
        <Copy className="w-4 h-4" aria-hidden="true" />
      )}
      {!iconOnly && <span>{current}</span>}
      <span className="sr-only" aria-live="polite">
        {state === 'copied' ? 'Copied to clipboard' : ''}
      </span>
    </button>
  )
}

// ── Detail list ───────────────────────────────────────────────────────────────

export function DetailList({ items, className = '' }: { items: [ReactNode, ReactNode][]; className?: string }) {
  return (
    <dl className={`grid grid-cols-1 min-[420px]:grid-cols-2 gap-x-4 gap-y-3 ${className}`}>
      {items.map(([label, value], index) => (
        <div key={index} className="min-w-0">
          <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">{label}</dt>
          <dd className="mt-0.5 text-[13px] text-slate-200 break-words">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

// ── Loading / error ───────────────────────────────────────────────────────────

export function QueryError({ message, onRetry, title = 'Could not load this data' }: { message: string; onRetry?: () => void; title?: string }) {
  return (
    <Alert
      tone="danger"
      title={title}
      action={
        onRetry ? (
          <button type="button" onClick={onRetry} className="btn-outline btn-sm">
            <RefreshCw className="w-4 h-4" aria-hidden="true" />
            Try again
          </button>
        ) : undefined
      }
    >
      {message}
    </Alert>
  )
}

export function SkeletonRows({ count = 5, className = 'h-16' }: { count?: number; className?: string }) {
  return (
    <div className="space-y-2" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={`shimmer rounded-xl ${className}`} />
      ))}
    </div>
  )
}

// ── Checkbox with a 40px hit area ─────────────────────────────────────────────

export function Checkbox({
  checked,
  indeterminate = false,
  onChange,
  label,
  disabled,
}: {
  checked: boolean
  indeterminate?: boolean
  onChange: (checked: boolean) => void
  /** Screen-reader label, e.g. "Select Nasir Uddin". */
  label: string
  disabled?: boolean
}) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate
  }, [indeterminate])
  return (
    <label className="inline-flex w-10 h-10 -m-2 items-center justify-center cursor-pointer flex-shrink-0">
      <input
        ref={ref}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={e => onChange(e.target.checked)}
        className="w-4 h-4 rounded accent-indigo-500 cursor-pointer disabled:cursor-not-allowed"
      />
      <span className="sr-only">{label}</span>
    </label>
  )
}

// ── Status dot line (system checks) ───────────────────────────────────────────

export function CheckRow({
  ok,
  warn = false,
  label,
  detail,
}: {
  ok: boolean
  /** Not ok, but not an outage either (amber instead of red). */
  warn?: boolean
  label: ReactNode
  detail?: ReactNode
}) {
  const tone = ok ? 'bg-emerald-400' : warn ? 'bg-amber-400' : 'bg-red-400'
  const word = ok ? 'OK' : warn ? 'Needs attention' : 'Problem'
  return (
    <li className="flex items-start gap-3 py-2.5">
      <span className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${tone}`} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] text-slate-200">
          {label}
          <span className="sr-only"> — {word}</span>
        </p>
        {detail && <div className="mt-0.5 text-xs text-slate-500 break-words">{detail}</div>}
      </div>
    </li>
  )
}

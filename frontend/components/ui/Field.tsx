// components/ui/Field.tsx
import type { ReactNode } from 'react'
import { AlertCircle } from 'lucide-react'

export interface FieldProps {
  /** id of the input inside; the label points at it. */
  htmlFor: string
  label: ReactNode
  /** Shown under the input when there is no error. Rendered with id `${htmlFor}-hint`. */
  hint?: ReactNode
  /** Error text; rendered with id `${htmlFor}-error` in a live region. */
  error?: string | null
  /** Adds "(optional)" after the label. */
  optional?: boolean
  /** Extra element on the label row, e.g. a "Forgot password?" link. */
  labelAside?: ReactNode
  className?: string
  children: ReactNode
}

/**
 * Label + control + hint/error, wired for screen readers. Give the input
 * `aria-describedby={describedBy(id, error, hint)}` and `aria-invalid={!!error}`.
 */
export function Field({ htmlFor, label, hint, error, optional, labelAside, className = '', children }: FieldProps) {
  return (
    <div className={className}>
      <div className="flex items-center justify-between gap-3 mb-1.5">
        <label htmlFor={htmlFor} className="text-[13px] font-medium text-slate-300">
          {label}
          {optional && <span className="ml-1 font-normal text-slate-500">(optional)</span>}
        </label>
        {labelAside}
      </div>
      {children}
      {/* Always mounted so the live region announces errors as they appear. */}
      <div id={`${htmlFor}-error`} aria-live="polite" className="empty:hidden">
        {error && (
          <p className="mt-1.5 flex items-start gap-1.5 text-xs text-red-400">
            <AlertCircle className="w-3.5 h-3.5 mt-px flex-shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </p>
        )}
      </div>
      {!error && hint && (
        <p id={`${htmlFor}-hint`} className="mt-1.5 text-xs text-slate-500">
          {hint}
        </p>
      )}
    </div>
  )
}

/** `aria-describedby` value matching the ids Field renders. */
export function describedBy(id: string, error?: string | null, hint?: ReactNode): string | undefined {
  const ids = [error ? `${id}-error` : null, !error && hint ? `${id}-hint` : null].filter(Boolean)
  return ids.length ? ids.join(' ') : undefined
}

export default Field

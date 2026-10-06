'use client'
// components/ui/PasswordInput.tsx

import { forwardRef, useState, type InputHTMLAttributes, type ReactNode } from 'react'
import { AlertCircle, Eye, EyeOff } from 'lucide-react'
import { passwordStrength } from '@/lib/validation'
import { describedBy } from './Field'

export interface PasswordInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
  /** Required: wires the label, error and strength text to the input. */
  id: string
  /** Renders a <label>; omit if you render your own (point it at `id`). */
  label?: ReactNode
  /** Element on the label row, e.g. a "Forgot password?" link. */
  labelAside?: ReactNode
  /** Error text under the field (announced to screen readers). */
  error?: string | null
  /** Helper text shown when there is no error. */
  hint?: ReactNode
  /** Show the 4-step strength meter (for new passwords). */
  showStrength?: boolean
  /** Extra classes for the <input>. */
  inputClassName?: string
  /** Classes for the outer wrapper. */
  className?: string
}

const BAR_COLORS = ['bg-red-500', 'bg-red-500', 'bg-amber-400', 'bg-sky-400', 'bg-emerald-400']
const TEXT_COLORS = ['text-red-400', 'text-red-400', 'text-amber-300', 'text-sky-300', 'text-emerald-300']

/**
 * Password field with a show/hide toggle and an optional strength meter.
 * Works controlled (`value` + `onChange`) or uncontrolled.
 * autoComplete defaults to "new-password" with `showStrength`, else "current-password".
 */
export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(function PasswordInput(
  { id, label, labelAside, error, hint, showStrength = false, inputClassName = '', className = '', onChange, autoComplete, ...rest },
  ref,
) {
  const [visible, setVisible] = useState(false)
  const [innerValue, setInnerValue] = useState(typeof rest.defaultValue === 'string' ? rest.defaultValue : '')
  const value = typeof rest.value === 'string' ? rest.value : innerValue
  const strength = showStrength && value ? passwordStrength(value) : null
  const strengthId = `${id}-strength`
  const describedIds = [describedBy(id, error, hint), strength ? strengthId : undefined].filter(Boolean).join(' ') || undefined

  return (
    <div className={className}>
      {(label || labelAside) && (
        <div className="flex items-center justify-between gap-3 mb-1.5">
          {label ? (
            <label htmlFor={id} className="text-[13px] font-medium text-slate-300">
              {label}
            </label>
          ) : (
            <span />
          )}
          {labelAside}
        </div>
      )}

      <div className="relative">
        <input
          {...rest}
          ref={ref}
          id={id}
          type={visible ? 'text' : 'password'}
          autoComplete={autoComplete ?? (showStrength ? 'new-password' : 'current-password')}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedIds}
          onChange={event => {
            setInnerValue(event.target.value)
            onChange?.(event)
          }}
          className={`input-field pr-12 ${error ? 'input-error' : ''} ${inputClassName}`}
        />
        <button
          type="button"
          onClick={() => setVisible(v => !v)}
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
          aria-controls={id}
          disabled={rest.disabled}
          className="absolute inset-y-0 right-0 w-11 flex items-center justify-center rounded-r-lg text-slate-500
                     hover:text-slate-200 disabled:opacity-40 transition-colors"
        >
          {visible ? <EyeOff className="w-4 h-4" aria-hidden="true" /> : <Eye className="w-4 h-4" aria-hidden="true" />}
        </button>
      </div>

      {strength && (
        <div className="mt-2">
          <div className="flex gap-1" aria-hidden="true">
            {[1, 2, 3, 4].map(step => (
              <span
                key={step}
                className={`h-1 flex-1 rounded-full transition-colors ${
                  strength.score >= step ? BAR_COLORS[strength.score] : 'bg-white/10'
                }`}
              />
            ))}
          </div>
          <p id={strengthId} aria-live="polite" className="mt-1.5 text-xs text-slate-500">
            <span className={`font-semibold ${TEXT_COLORS[strength.score]}`}>{strength.label}</span>
            {strength.hint && !error ? <> · {strength.hint}</> : null}
          </p>
        </div>
      )}

      <div id={`${id}-error`} aria-live="polite" className="empty:hidden">
        {error && (
          <p className="mt-1.5 flex items-start gap-1.5 text-xs text-red-400">
            <AlertCircle className="w-3.5 h-3.5 mt-px flex-shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </p>
        )}
      </div>
      {!error && hint && !strength && (
        <p id={`${id}-hint`} className="mt-1.5 text-xs text-slate-500">
          {hint}
        </p>
      )}
    </div>
  )
})

export default PasswordInput

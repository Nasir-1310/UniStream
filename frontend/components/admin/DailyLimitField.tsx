'use client'
// components/admin/DailyLimitField.tsx
//
// Per-user daily download limit: follow the default setting, a custom
// number, or unlimited (the future paid plan). API encoding: null = default,
// -1 = unlimited, 0..10000 = custom.

import { useId } from 'react'
import { AlertCircle } from 'lucide-react'
import { DAILY_LIMIT_MAX, validateDailyLimit, type Validation } from '@/lib/validation'
import { formatLimit } from '@/lib/format'

export type LimitMode = 'default' | 'custom' | 'unlimited'

export interface LimitValue {
  mode: LimitMode
  /** Text of the custom number input (kept as typed). */
  custom: string
}

export function limitValueFrom(dailyLimit: number | null | undefined, fallbackCustom = 4): LimitValue {
  if (dailyLimit === null || dailyLimit === undefined) return { mode: 'default', custom: String(fallbackCustom) }
  if (dailyLimit < 0) return { mode: 'unlimited', custom: String(fallbackCustom) }
  return { mode: 'custom', custom: String(dailyLimit) }
}

/** The value to send as `daily_limit`, or the validation error for the custom number. */
export function limitToApi(value: LimitValue): Validation<number | null> {
  if (value.mode === 'default') return { ok: true, value: null }
  if (value.mode === 'unlimited') return { ok: true, value: -1 }
  return validateDailyLimit(value.custom)
}

/** "Default (4 / day)", "10 / day", "Unlimited" for a stored daily_limit. */
export function describeLimit(dailyLimit: number | null, defaultLimit: number | null | undefined): string {
  if (dailyLimit === null) return defaultLimit === null || defaultLimit === undefined ? 'Default' : `Default (${formatLimit(defaultLimit)})`
  return formatLimit(dailyLimit)
}

const OPTIONS: { mode: LimitMode; label: string }[] = [
  { mode: 'default', label: 'Default' },
  { mode: 'custom', label: 'Custom' },
  { mode: 'unlimited', label: 'Unlimited' },
]

export function DailyLimitField({
  value,
  onChange,
  defaultLimit,
  error,
  disabled,
}: {
  value: LimitValue
  onChange: (value: LimitValue) => void
  /** Current default setting, shown on the "Default" option. */
  defaultLimit: number | null | undefined
  error?: string | null
  disabled?: boolean
}) {
  const id = useId()
  const inputId = `${id}-custom`
  const hintId = `${id}-hint`
  const errorId = `${id}-error`

  const hint =
    value.mode === 'default'
      ? `Follows the default setting${defaultLimit !== null && defaultLimit !== undefined ? ` (currently ${formatLimit(defaultLimit)})` : ''}; changes when you change the default.`
      : value.mode === 'unlimited'
      ? 'No daily cap for this user.'
      : `Fixed for this user, from 0 to ${DAILY_LIMIT_MAX.toLocaleString('en-US')}. 0 pauses their downloads.`

  return (
    <fieldset disabled={disabled} className="min-w-0">
      <legend className="field-label">Daily download limit</legend>
      <div className="grid grid-cols-3 gap-1 rounded-xl border border-white/10 bg-[#0d0f1a] p-1">
        {OPTIONS.map(option => {
          const checked = value.mode === option.mode
          return (
            <label
              key={option.mode}
              className={`relative flex min-h-10 cursor-pointer flex-col items-center justify-center rounded-lg px-1.5 py-1.5 text-center
                text-[13px] font-medium transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2
                has-[:focus-visible]:outline-indigo-500/70 ${
                  checked ? 'bg-indigo-500/20 text-white shadow-inner shadow-indigo-500/10' : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]'
                }`}
            >
              <input
                type="radio"
                name={`${id}-mode`}
                value={option.mode}
                checked={checked}
                onChange={() => onChange({ ...value, mode: option.mode })}
                className="sr-only"
              />
              <span>{option.label}</span>
              {option.mode === 'default' && defaultLimit !== null && defaultLimit !== undefined && (
                <span className="text-[11px] font-normal text-slate-500">{formatLimit(defaultLimit)}</span>
              )}
            </label>
          )
        })}
      </div>

      {value.mode === 'custom' && (
        <div className="mt-2.5 flex items-center gap-2.5">
          <label htmlFor={inputId} className="sr-only">
            Downloads per day
          </label>
          <input
            id={inputId}
            type="number"
            inputMode="numeric"
            min={0}
            max={DAILY_LIMIT_MAX}
            step={1}
            value={value.custom}
            onChange={e => onChange({ ...value, custom: e.target.value })}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : hintId}
            className="input-field w-28 tabular-nums"
          />
          <span className="text-[13px] text-slate-400">downloads per day</span>
        </div>
      )}

      <div id={errorId} aria-live="polite" className="empty:hidden">
        {error && (
          <p className="mt-1.5 flex items-start gap-1.5 text-xs text-red-400">
            <AlertCircle className="w-3.5 h-3.5 mt-px flex-shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </p>
        )}
      </div>
      {!error && (
        <p id={hintId} className="mt-1.5 text-xs text-slate-500">
          {hint}
        </p>
      )}
    </fieldset>
  )
}

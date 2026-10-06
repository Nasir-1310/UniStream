// components/ui/Alert.tsx
import type { ReactNode } from 'react'
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from 'lucide-react'

export type AlertTone = 'info' | 'success' | 'warning' | 'danger'

const STYLES: Record<AlertTone, { box: string; icon: string; Icon: typeof Info }> = {
  info: { box: 'bg-sky-500/[0.07] border-sky-500/25 text-sky-100', icon: 'text-sky-400', Icon: Info },
  success: { box: 'bg-emerald-500/[0.07] border-emerald-500/25 text-emerald-100', icon: 'text-emerald-400', Icon: CheckCircle2 },
  warning: { box: 'bg-amber-500/[0.07] border-amber-500/25 text-amber-100', icon: 'text-amber-400', Icon: AlertTriangle },
  danger: { box: 'bg-red-500/[0.07] border-red-500/25 text-red-100', icon: 'text-red-400', Icon: AlertCircle },
}

export interface AlertProps {
  tone?: AlertTone
  title?: ReactNode
  children?: ReactNode
  /** Buttons/links shown under the text (wraps on mobile). */
  action?: ReactNode
  /** Shows a close button. */
  onDismiss?: () => void
  /**
   * Announce to screen readers when it appears: "polite" for notices,
   * "assertive" for errors that block the user. Default: assertive for danger.
   */
  live?: 'polite' | 'assertive' | 'off'
  className?: string
}

/** Inline banner for notices, warnings and form errors. */
export function Alert({ tone = 'info', title, children, action, onDismiss, live, className = '' }: AlertProps) {
  const s = STYLES[tone]
  const mode = live ?? (tone === 'danger' ? 'assertive' : 'polite')
  const role = mode === 'assertive' ? 'alert' : mode === 'polite' ? 'status' : undefined
  return (
    <div role={role} className={`flex items-start gap-3 rounded-xl border px-3.5 py-3 text-[13px] leading-relaxed ${s.box} ${className}`}>
      <s.Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${s.icon}`} aria-hidden="true" />
      <div className="flex-1 min-w-0 break-words">
        {title && <p className="font-semibold text-white">{title}</p>}
        {children && <div className={title ? 'mt-0.5 text-slate-300' : 'text-slate-200'}>{children}</div>}
        {action && <div className="mt-2.5 flex flex-wrap items-center gap-2">{action}</div>}
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="-mr-1.5 -mt-1.5 w-9 h-9 flex-shrink-0 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
        >
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      )}
    </div>
  )
}

export default Alert

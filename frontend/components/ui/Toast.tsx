'use client'
// components/ui/Toast.tsx
//
// Short, non-blocking notifications ("User approved", "Copied"). Errors that
// the user must act on belong next to the form instead (Alert / Field).
// The provider is mounted once in app/layout.tsx.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from 'lucide-react'

export type ToastTone = 'success' | 'error' | 'info' | 'warning'

export interface ToastOptions {
  /** Main line. */
  title: string
  /** Optional second line. */
  description?: ReactNode
  tone?: ToastTone
  /** Milliseconds before it disappears; 0 keeps it until dismissed. Default 4500 (errors 7000). */
  duration?: number
  /** One inline action, e.g. Undo or Retry. */
  action?: { label: string; onClick: () => void }
  /** Reuse an id to replace an existing toast instead of stacking a new one. */
  id?: string
}

type MessageOptions = Omit<ToastOptions, 'title' | 'tone'>

export interface ToastApi {
  /** Show a toast; returns its id. */
  show: (options: ToastOptions | string) => string
  success: (title: string, options?: MessageOptions) => string
  error: (title: string, options?: MessageOptions) => string
  info: (title: string, options?: MessageOptions) => string
  warning: (title: string, options?: MessageOptions) => string
  /** Dismiss one toast, or all when no id is given. */
  dismiss: (id?: string) => void
}

interface ToastItem extends ToastOptions {
  id: string
  tone: ToastTone
}

const MAX_VISIBLE = 4
let nextId = 0

const ToastContext = createContext<ToastApi | null>(null)

/** Provides useToast(); renders the toast viewport. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const dismiss = useCallback((id?: string) => {
    setToasts(current => (id === undefined ? [] : current.filter(t => t.id !== id)))
  }, [])

  const show = useCallback((input: ToastOptions | string) => {
    const options: ToastOptions = typeof input === 'string' ? { title: input } : input
    nextId += 1
    const id = options.id ?? `toast-${nextId}`
    const item: ToastItem = { ...options, id, tone: options.tone ?? 'info' }
    setToasts(current => {
      const others = current.filter(t => t.id !== id)
      return [...others, item].slice(-MAX_VISIBLE)
    })
    return id
  }, [])

  const api = useMemo<ToastApi>(
    () => ({
      show,
      dismiss,
      success: (title, options) => show({ ...options, title, tone: 'success' }),
      error: (title, options) => show({ ...options, title, tone: 'error' }),
      info: (title, options) => show({ ...options, title, tone: 'info' }),
      warning: (title, options) => show({ ...options, title, tone: 'warning' }),
    }),
    [show, dismiss],
  )

  return (
    <ToastContext.Provider value={api}>
      {children}
      <section
        aria-label="Notifications"
        aria-live="polite"
        data-toast-viewport
        className="pointer-events-none fixed inset-x-0 bottom-0 z-[70] flex flex-col items-center gap-2 px-3
                   pb-[max(0.75rem,env(safe-area-inset-bottom))]
                   sm:inset-x-auto sm:bottom-auto sm:right-4 sm:top-4 sm:w-[380px] sm:px-0 sm:pb-0"
      >
        {toasts.map(toast => (
          <ToastView key={toast.id} toast={toast} onDismiss={dismiss} />
        ))}
      </section>
    </ToastContext.Provider>
  )
}

const TONES: Record<ToastTone, { Icon: typeof Info; icon: string; bar: string }> = {
  success: { Icon: CheckCircle2, icon: 'text-emerald-400', bar: 'bg-emerald-400' },
  error: { Icon: AlertCircle, icon: 'text-red-400', bar: 'bg-red-400' },
  warning: { Icon: AlertTriangle, icon: 'text-amber-400', bar: 'bg-amber-400' },
  info: { Icon: Info, icon: 'text-sky-400', bar: 'bg-sky-400' },
}

function ToastView({ toast, onDismiss }: { toast: ToastItem; onDismiss: (id: string) => void }) {
  const [paused, setPaused] = useState(false)
  const duration = toast.duration ?? (toast.tone === 'error' ? 7000 : 4500)
  const tone = TONES[toast.tone]

  // Auto-dismiss; hovering or focusing the toast pauses it (restarts on leave).
  useEffect(() => {
    if (paused || duration <= 0) return
    const timer = window.setTimeout(() => onDismiss(toast.id), duration)
    return () => window.clearTimeout(timer)
  }, [paused, duration, onDismiss, toast.id, toast.title])

  return (
    <div
      role={toast.tone === 'error' ? 'alert' : 'status'}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className="ui-toast pointer-events-auto relative w-full max-w-[420px] overflow-hidden rounded-xl border border-white/10
                 bg-[#151829]/95 backdrop-blur-md shadow-xl shadow-black/40"
    >
      <span className={`absolute inset-y-0 left-0 w-1 ${tone.bar}`} aria-hidden="true" />
      <div className="flex items-start gap-3 py-3 pl-4 pr-2">
        <tone.Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${tone.icon}`} aria-hidden="true" />
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold text-white break-words">{toast.title}</p>
          {toast.description && <div className="mt-0.5 text-xs leading-relaxed text-slate-400 break-words">{toast.description}</div>}
          {toast.action && (
            <button
              type="button"
              onClick={() => {
                toast.action?.onClick()
                onDismiss(toast.id)
              }}
              className="mt-2 text-xs font-semibold text-indigo-300 hover:text-indigo-200 underline-offset-2 hover:underline"
            >
              {toast.action.label}
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => onDismiss(toast.id)}
          aria-label="Dismiss notification"
          className="w-9 h-9 -my-1.5 flex-shrink-0 inline-flex items-center justify-center rounded-lg text-slate-500 hover:text-white hover:bg-white/10 transition-colors"
        >
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}

const missingProvider: ToastApi = (() => {
  const warn = (title: string) => {
    if (process.env.NODE_ENV !== 'production') console.warn(`[toast] <ToastProvider> missing: ${title}`)
    return ''
  }
  return {
    show: input => warn(typeof input === 'string' ? input : input.title),
    success: warn,
    error: warn,
    info: warn,
    warning: warn,
    dismiss: () => {},
  }
})()

/**
 * ```tsx
 * const toast = useToast()
 * toast.success('Password changed')
 * toast.error(apiErrorMessage(err))
 * ```
 */
export function useToast(): ToastApi {
  return useContext(ToastContext) ?? missingProvider
}

export default ToastProvider

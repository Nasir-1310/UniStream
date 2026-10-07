'use client'
// components/ui/ConfirmDialog.tsx
//
// Confirmation for destructive or important actions. Use the component when
// you want the dialog to stay open while the action runs (return a promise
// from onConfirm; a rejection is shown inside the dialog), or the
// promise-based useConfirm() for a quick yes/no before acting.

import { createContext, useCallback, useContext, useId, useMemo, useState, type ReactNode } from 'react'
import { AlertTriangle, HelpCircle, ShieldAlert } from 'lucide-react'
import { apiErrorMessage } from '@/lib/api'
import { Modal } from './Modal'
import { Spinner } from './Spinner'

export type ConfirmTone = 'danger' | 'warning' | 'primary'

export interface ConfirmDialogProps {
  open: boolean
  title: ReactNode
  /** Explanation of what will happen. */
  message?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  /** "danger" = red button and Cancel focused first. Default "primary". */
  tone?: ConfirmTone
  /**
   * Require typing this exact text (e.g. "DELETE") before the confirm button
   * enables — for irreversible bulk actions.
   */
  requireText?: string
  /** Force the busy state (if you track it yourself instead of returning a promise). */
  loading?: boolean
  /**
   * Run the action. If it returns a promise the dialog shows a spinner and
   * can't be dismissed until it settles; on rejection the error is shown in
   * the dialog and it stays open. Close it yourself (onCancel / open=false) on success.
   */
  onConfirm: () => void | Promise<unknown>
  /** Cancel, Escape, backdrop or close button. */
  onCancel: () => void
  /** Extra content between the message and the buttons. */
  children?: ReactNode
}

const TONE_STYLES: Record<ConfirmTone, { button: string; iconBox: string; Icon: typeof HelpCircle }> = {
  danger: {
    button: 'btn-danger',
    iconBox: 'bg-red-500/10 border-red-500/25 text-red-400',
    Icon: ShieldAlert,
  },
  warning: {
    button: 'btn-primary',
    iconBox: 'bg-amber-500/10 border-amber-500/25 text-amber-400',
    Icon: AlertTriangle,
  },
  primary: {
    button: 'btn-primary',
    iconBox: 'bg-indigo-500/10 border-indigo-500/25 text-indigo-300',
    Icon: HelpCircle,
  },
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'primary',
  requireText,
  loading = false,
  onConfirm,
  onCancel,
  children,
}: ConfirmDialogProps) {
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const busy = loading || running
  const style = TONE_STYLES[tone]

  const close = () => {
    if (busy) return
    setError(null)
    onCancel()
  }

  const confirm = async () => {
    if (busy) return
    setError(null)
    let result: void | Promise<unknown>
    try {
      result = onConfirm()
    } catch (err) {
      setError(apiErrorMessage(err))
      return
    }
    if (result && typeof (result as Promise<unknown>).then === 'function') {
      setRunning(true)
      try {
        await result
      } catch (err) {
        setError(apiErrorMessage(err))
      } finally {
        setRunning(false)
      }
    }
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title={title}
      size="sm"
      dismissible={!busy}
      icon={
        <div className={`w-10 h-10 rounded-xl border flex items-center justify-center ${style.iconBox}`}>
          <style.Icon className="w-5 h-5" aria-hidden="true" />
        </div>
      }
    >
      {/* Remounts on every open, so the typed confirmation text starts empty. */}
      <ConfirmBody
        message={message}
        requireText={requireText}
        cancelLabel={cancelLabel}
        confirmLabel={confirmLabel}
        buttonClass={style.button}
        tone={tone}
        busy={busy}
        error={error}
        onCancel={close}
        onConfirm={confirm}
      >
        {children}
      </ConfirmBody>
    </Modal>
  )
}

interface ConfirmBodyProps {
  message?: ReactNode
  requireText?: string
  cancelLabel: string
  confirmLabel: string
  buttonClass: string
  tone: ConfirmTone
  busy: boolean
  error: string | null
  onCancel: () => void
  onConfirm: () => void
  children?: ReactNode
}

function ConfirmBody({
  message,
  requireText,
  cancelLabel,
  confirmLabel,
  buttonClass,
  tone,
  busy,
  error,
  onCancel,
  onConfirm,
  children,
}: ConfirmBodyProps) {
  const [typed, setTyped] = useState('')
  const inputId = useId()
  const matches = !requireText || typed.trim() === requireText

  return (
    <form
      onSubmit={e => {
        e.preventDefault()
        if (matches) onConfirm()
      }}
    >
      {message && <div className="text-sm leading-relaxed text-slate-300">{message}</div>}
      {children && <div className="mt-3">{children}</div>}

      {requireText && (
        <div className="mt-4">
          <label htmlFor={inputId} className="block text-[13px] text-slate-400 mb-1.5">
            Type <span className="font-mono font-semibold text-white">{requireText}</span> to confirm
          </label>
          <input
            id={inputId}
            data-autofocus
            value={typed}
            onChange={e => setTyped(e.target.value)}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            disabled={busy}
            className="input-field font-mono"
          />
        </div>
      )}

      <div aria-live="assertive" className="empty:hidden">
        {error && <p className="mt-3 rounded-lg border border-red-500/25 bg-red-500/[0.07] px-3 py-2 text-[13px] text-red-300">{error}</p>}
      </div>

      <div className="mt-5 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          // Destructive dialogs start on Cancel so a stray Enter does no harm.
          data-autofocus={tone === 'danger' && !requireText ? true : undefined}
          className="btn-secondary w-full sm:w-auto"
        >
          {cancelLabel}
        </button>
        <button
          type="submit"
          disabled={busy || !matches}
          data-autofocus={tone !== 'danger' && !requireText ? true : undefined}
          className={`${buttonClass} w-full sm:w-auto`}
        >
          {busy && <Spinner size="sm" label={null} />}
          {confirmLabel}
        </button>
      </div>
    </form>
  )
}

// ── useConfirm ────────────────────────────────────────────────────────────────

export type ConfirmOptions = Omit<ConfirmDialogProps, 'open' | 'onConfirm' | 'onCancel' | 'loading'>

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>

const ConfirmContext = createContext<ConfirmFn | null>(null)

/** Mounted once in app/layout.tsx; provides useConfirm(). */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<{ options: ConfirmOptions; resolve: (ok: boolean) => void } | null>(null)

  const confirm = useCallback<ConfirmFn>(
    options =>
      new Promise<boolean>(resolve => {
        setRequest(previous => {
          previous?.resolve(false) // a newer question replaces an unanswered one
          return { options, resolve }
        })
      }),
    [],
  )

  const settle = (ok: boolean) => {
    request?.resolve(ok)
    setRequest(null)
  }

  const value = useMemo(() => confirm, [confirm])

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      <ConfirmDialog
        open={request !== null}
        {...(request?.options ?? { title: '' })}
        onConfirm={() => settle(true)}
        onCancel={() => settle(false)}
      />
    </ConfirmContext.Provider>
  )
}

/**
 * Ask a yes/no question; resolves true when confirmed.
 *
 * ```tsx
 * const confirm = useConfirm()
 * if (await confirm({ title: 'Delete this log?', tone: 'danger', confirmLabel: 'Delete' })) { … }
 * ```
 */
export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext)
  if (!ctx) {
    throw new Error('useConfirm() needs <ConfirmProvider> (mounted in app/layout.tsx).')
  }
  return ctx
}

export default ConfirmDialog

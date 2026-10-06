'use client'
// components/ui/Modal.tsx
//
// Accessible dialog: focus moves in and is trapped while open, Escape and the
// backdrop close it, focus returns to the opener afterwards, and the page
// behind stops scrolling. Below the `sm` breakpoint it is a bottom sheet
// (easier to reach with a thumb); from `sm` up it is a centered card.

import { useEffect, useId, useRef, useSyncExternalStore, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'summary',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(',')

/** Visible, focusable elements inside `root`, in DOM order. */
function focusables(root: HTMLElement | null): HTMLElement[] {
  if (!root) return []
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    el => !el.hasAttribute('inert') && (el.offsetWidth > 0 || el.offsetHeight > 0 || el === document.activeElement),
  )
}

// Open dialogs, innermost last: only the top one reacts to Escape/Tab, so a
// ConfirmDialog opened from a Modal closes alone.
const openStack: symbol[] = []
let scrollLocks = 0
let savedOverflow = ''
let savedPaddingRight = ''

function lockScroll(): void {
  if (scrollLocks++ > 0) return
  const body = document.body
  savedOverflow = body.style.overflow
  savedPaddingRight = body.style.paddingRight
  // Keep the layout from jumping when the desktop scrollbar disappears.
  const scrollbar = window.innerWidth - document.documentElement.clientWidth
  if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`
  body.style.overflow = 'hidden'
}

function unlockScroll(): void {
  if (--scrollLocks > 0) return
  scrollLocks = 0
  document.body.style.overflow = savedOverflow
  document.body.style.paddingRight = savedPaddingRight
}

const noopSubscribe = () => () => {}
/** False during SSR/hydration, true in the browser — portals need document.body. */
function useIsClient(): boolean {
  return useSyncExternalStore(noopSubscribe, () => true, () => false)
}

const SIZES = {
  sm: 'sm:max-w-sm',
  md: 'sm:max-w-md',
  lg: 'sm:max-w-lg',
  xl: 'sm:max-w-2xl',
} as const

export interface ModalProps {
  open: boolean
  /** Called on Escape, backdrop click and the close button (unless `dismissible` is false). */
  onClose: () => void
  title: ReactNode
  /** Short text under the title; linked with aria-describedby. */
  description?: ReactNode
  /** Optional icon/illustration left of the title. */
  icon?: ReactNode
  children?: ReactNode
  /**
   * Action buttons. List Cancel first and the primary action last: on desktop
   * they sit left→right, on mobile they stack full-width with the primary on top.
   */
  footer?: ReactNode
  size?: keyof typeof SIZES
  /** Set false while saving so the dialog can't be closed mid-request. Default true. */
  dismissible?: boolean
  /** Element to focus on open; default: `[data-autofocus]`, else the first field/button in the body. */
  initialFocusRef?: RefObject<HTMLElement | null>
  hideCloseButton?: boolean
  /** Extra classes for the panel. */
  className?: string
}

/**
 * ```tsx
 * <Modal open={open} onClose={() => setOpen(false)} title="Edit user"
 *   footer={<><button className="btn-secondary" onClick={…}>Cancel</button><button className="btn-primary">Save</button></>}>
 *   …form fields…
 * </Modal>
 * ```
 */
export function Modal(props: ModalProps) {
  const isClient = useIsClient()
  if (!props.open || !isClient) return null
  return createPortal(<ModalPanel {...props} />, document.body)
}

function ModalPanel({
  onClose,
  title,
  description,
  icon,
  children,
  footer,
  size = 'md',
  dismissible = true,
  initialFocusRef,
  hideCloseButton,
  className = '',
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const descriptionId = useId()
  // Latest callbacks for the long-lived listeners below.
  const onCloseRef = useRef(onClose)
  const dismissibleRef = useRef(dismissible)
  useEffect(() => {
    onCloseRef.current = onClose
    dismissibleRef.current = dismissible
  })

  useEffect(() => {
    const id = Symbol('modal')
    openStack.push(id)
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    lockScroll()

    const panel = panelRef.current
    const target =
      initialFocusRef?.current ??
      panel?.querySelector<HTMLElement>('[data-autofocus]') ??
      focusables(bodyRef.current)[0] ??
      focusables(panel)[0] ??
      panel
    target?.focus({ preventScroll: true })

    const isTop = () => openStack[openStack.length - 1] === id

    const onKeyDown = (event: KeyboardEvent) => {
      if (!isTop()) return
      if (event.key === 'Escape') {
        event.stopPropagation()
        if (dismissibleRef.current) onCloseRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const items = focusables(panelRef.current)
      if (!items.length) {
        event.preventDefault()
        panelRef.current?.focus()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      if (event.shiftKey && (active === first || !panelRef.current?.contains(active))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (active === last || !panelRef.current?.contains(active))) {
        event.preventDefault()
        first.focus()
      }
    }

    // Pull focus back if something outside (e.g. a click on the page) took it.
    const onFocusIn = (event: FocusEvent) => {
      const current = panelRef.current
      if (!isTop() || !current || !(event.target instanceof Node)) return
      if (current.contains(event.target)) return
      // Toasts sit above dialogs and may be focused on purpose.
      if (event.target instanceof Element && event.target.closest('[data-toast-viewport]')) return
      ;(focusables(current)[0] ?? current).focus({ preventScroll: true })
    }

    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('focusin', onFocusIn)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('focusin', onFocusIn)
      const index = openStack.indexOf(id)
      if (index >= 0) openStack.splice(index, 1)
      unlockScroll()
      if (opener && opener.isConnected) opener.focus({ preventScroll: true })
    }
  }, [initialFocusRef])

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center sm:p-4">
      <div
        className="ui-backdrop absolute inset-0 bg-black/70 backdrop-blur-[2px]"
        aria-hidden="true"
        onClick={() => {
          if (dismissibleRef.current) onCloseRef.current()
        }}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={`ui-sheet relative flex w-full ${SIZES[size]} max-h-[92dvh] sm:max-h-[88dvh] flex-col
                    rounded-t-2xl sm:rounded-2xl border border-white/10 bg-[#111322] shadow-2xl shadow-black/50
                    outline-none ${className}`}
      >
        {/* Grab handle: signals "bottom sheet" on phones. */}
        <div className="sm:hidden mx-auto mt-2.5 h-1 w-10 rounded-full bg-white/15" aria-hidden="true" />

        <div className="flex items-start gap-3 px-5 pt-3.5 sm:pt-5 pb-3">
          {icon && <div className="flex-shrink-0 mt-0.5">{icon}</div>}
          <div className="flex-1 min-w-0">
            <h2 id={titleId} className="text-base sm:text-[17px] font-semibold text-white break-words">
              {title}
            </h2>
            {description && (
              <div id={descriptionId} className="mt-1 text-[13px] leading-relaxed text-slate-400">
                {description}
              </div>
            )}
          </div>
          {!hideCloseButton && (
            <button
              type="button"
              onClick={() => onCloseRef.current()}
              disabled={!dismissible}
              aria-label="Close"
              className="-mr-2 -mt-1 w-10 h-10 flex-shrink-0 inline-flex items-center justify-center rounded-lg
                         text-slate-400 hover:text-white hover:bg-white/10 disabled:opacity-40 disabled:pointer-events-none transition-colors"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          )}
        </div>

        <div
          ref={bodyRef}
          className={`flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 ${
            footer ? 'pb-4' : 'pb-[max(1.25rem,env(safe-area-inset-bottom))]'
          }`}
        >
          {children}
        </div>

        {footer && (
          <div
            className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 border-t border-white/[0.06] px-5 pt-3.5
                       pb-[max(0.875rem,env(safe-area-inset-bottom))] [&>*]:w-full sm:[&>*]:w-auto"
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

export default Modal

'use client'
// components/admin/ActionMenu.tsx
//
// "More actions" menu for table rows and cards. Rendered in a portal with
// fixed positioning so table cells and cards never clip it, and it opens
// upward when there is no room below (rows near the bottom nav on phones).

import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { EllipsisVertical, type LucideIcon } from 'lucide-react'

export interface ActionMenuItem {
  key: string
  label: string
  icon?: LucideIcon
  onSelect: () => void
  tone?: 'default' | 'danger'
  disabled?: boolean
  /** Draw a separator above this item. */
  separated?: boolean
}

const MENU_WIDTH = 232
const ITEM_HEIGHT = 40

interface Position {
  left: number
  top?: number
  bottom?: number
}

export function ActionMenu({
  label,
  items,
  disabled,
  trigger,
  triggerClassName = 'btn-icon border-white/10',
}: {
  /** Accessible name of the trigger, e.g. "More actions for Nasir". */
  label: string
  items: ActionMenuItem[]
  disabled?: boolean
  /** Custom trigger content; default ⋮. */
  trigger?: ReactNode
  triggerClassName?: string
}) {
  const [position, setPosition] = useState<Position | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuId = useId()
  const open = position !== null

  const close = (focusTrigger = true) => {
    setPosition(null)
    if (focusTrigger) triggerRef.current?.focus({ preventScroll: true })
  }

  const openMenu = () => {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return
    const height = items.length * ITEM_HEIGHT + 16
    const left = Math.min(Math.max(8, rect.right - MENU_WIDTH), window.innerWidth - MENU_WIDTH - 8)
    // Keep clear of the fixed bottom tab bar on phones (56px + safe area).
    const spaceBelow = window.innerHeight - rect.bottom - (window.innerWidth < 1024 ? 72 : 8)
    if (spaceBelow < height && rect.top > spaceBelow) {
      setPosition({ left, bottom: window.innerHeight - rect.top + 4 })
    } else {
      setPosition({ left, top: rect.bottom + 4 })
    }
  }

  // Focus the first item once the menu is in the DOM.
  useLayoutEffect(() => {
    if (!open) return
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus({ preventScroll: true })
  }, [open])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return
      setPosition(null)
    }
    const onDismiss = () => setPosition(null)
    // A page scroll moves the trigger away from the fixed menu; scrolling the menu itself is fine.
    const onScroll = (event: Event) => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return
      setPosition(null)
    }
    document.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('resize', onDismiss)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('resize', onDismiss)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [open])

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const entries = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [])
    const index = entries.indexOf(document.activeElement as HTMLElement)
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close()
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      entries[(index + 1) % entries.length]?.focus()
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      entries[(index - 1 + entries.length) % entries.length]?.focus()
    } else if (event.key === 'Home') {
      event.preventDefault()
      entries[0]?.focus()
    } else if (event.key === 'End') {
      event.preventDefault()
      entries[entries.length - 1]?.focus()
    } else if (event.key === 'Tab') {
      close(false)
    }
  }

  const select = (item: ActionMenuItem) => {
    // Return focus to the trigger first, so a dialog opened by the item
    // restores focus there when it closes.
    close()
    item.onSelect()
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={disabled}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={event => {
          if (!open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
            event.preventDefault()
            openMenu()
          }
        }}
        className={triggerClassName}
      >
        {trigger ?? <EllipsisVertical className="w-4 h-4" aria-hidden="true" />}
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            id={menuId}
            role="menu"
            aria-label={label}
            onKeyDown={onMenuKeyDown}
            style={{ left: position.left, top: position.top, bottom: position.bottom, width: MENU_WIDTH }}
            className="ui-menu fixed z-[55] max-h-[70vh] overflow-y-auto rounded-xl border border-white/10 bg-[#151829] p-1.5
                       shadow-2xl shadow-black/60"
          >
            {items.map(item => {
              const Icon = item.icon
              return (
                <div key={item.key}>
                  {item.separated && <div className="my-1 h-px bg-white/[0.07]" role="separator" />}
                  <button
                    type="button"
                    role="menuitem"
                    disabled={item.disabled}
                    onClick={() => select(item)}
                    className={`w-full h-10 flex items-center gap-2.5 rounded-lg px-2.5 text-left text-[13px] font-medium outline-none
                      transition-colors disabled:opacity-40 disabled:pointer-events-none focus-visible:outline-none
                      ${
                        item.tone === 'danger'
                          ? 'text-red-300 hover:bg-red-500/10 focus:bg-red-500/10'
                          : 'text-slate-200 hover:bg-white/[0.07] focus:bg-white/[0.07]'
                      }`}
                  >
                    {Icon && <Icon className="w-4 h-4 flex-shrink-0 opacity-80" aria-hidden="true" />}
                    <span className="truncate">{item.label}</span>
                  </button>
                </div>
              )
            })}
          </div>,
          document.body,
        )}
    </>
  )
}

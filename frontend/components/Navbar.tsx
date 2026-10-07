'use client'
// components/Navbar.tsx
//
// Sticky top bar used on every user-facing page. Reads the session itself,
// so pages just render <Navbar />: signed-in users see today's usage and an
// account menu; visitors see "Sign in".

import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  ChevronDown,
  Download,
  Infinity as InfinityIcon,
  LogIn,
  LogOut,
  UserCircle,
} from 'lucide-react'
import { useSession } from '@/lib/auth'
import type { PublicUser, Usage } from '@/lib/api'
import { formatPhone, formatTime, initials } from '@/lib/format'

export interface NavbarProps {
  /** Show the session controls (usage pill, account menu / Sign in). Default true. */
  showAuth?: boolean
  /** Extra controls on the right, before the session controls (e.g. admin actions). */
  rightSlot?: ReactNode
  /** Where the logo links; default "/download" when signed in, else "/". */
  homeHref?: string
}

export default function Navbar({ showAuth = true, rightSlot, homeHref }: NavbarProps) {
  const { user, loading, signOut } = useSession()

  return (
    <header className="sticky top-0 z-30 border-b border-white/[0.06] bg-[#0d0f1a]/85 backdrop-blur-md supports-[backdrop-filter]:bg-[#0d0f1a]/70">
      <div className="max-w-7xl mx-auto px-4 sm:px-8 h-14 flex items-center justify-between gap-3">
        <Link
          href={homeHref ?? (user ? '/download' : '/')}
          className="flex items-center gap-2 flex-shrink-0 rounded-lg py-2 -my-2"
          aria-label="UniStream Saver home"
        >
          <span className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center shadow-sm shadow-indigo-900/50">
            <Download className="w-4 h-4 text-white" strokeWidth={2.5} aria-hidden="true" />
          </span>
          <span className="max-[359px]:sr-only font-semibold text-[14px] text-white tracking-tight" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
            UniStream<span className="text-sky-400">Saver</span>
          </span>
        </Link>

        <div className="flex items-center gap-2 min-w-0">
          {rightSlot}
          {showAuth &&
            (loading ? (
              <div className="h-10 w-24 rounded-full shimmer" aria-hidden="true" />
            ) : user ? (
              <>
                <UsagePill usage={user.usage} />
                <AccountMenu user={user} onSignOut={signOut} />
              </>
            ) : (
              <Link href="/#auth" className="btn-outline">
                <LogIn className="w-4 h-4" aria-hidden="true" />
                Sign in
              </Link>
            ))}
        </div>
      </div>
    </header>
  )
}

// ── Usage pill ────────────────────────────────────────────────────────────────

function UsagePill({ usage }: { usage: Usage | undefined }) {
  if (!usage) return null
  const unlimited = usage.limit === null
  const remaining = unlimited ? 0 : Math.max(0, usage.remaining ?? (usage.limit ?? 0) - usage.used)
  const tone = unlimited
    ? 'border-indigo-500/30 bg-indigo-500/10 text-indigo-200'
    : remaining <= 0
    ? 'border-red-500/30 bg-red-500/10 text-red-200'
    : remaining === 1
    ? 'border-amber-500/30 bg-amber-500/10 text-amber-200'
    : 'border-white/10 bg-white/[0.04] text-slate-200'
  const description = unlimited
    ? `Unlimited downloads. ${usage.used} today.`
    : `${remaining} of ${usage.limit} downloads left today. Resets at ${formatTime(usage.resets_at, usage.timezone)}.`

  return (
    <Link
      href="/account"
      title={description}
      aria-label={`${description} Open account.`}
      className={`inline-flex items-center gap-1.5 h-10 px-3 rounded-full border text-[12px] font-semibold tabular-nums transition-colors hover:brightness-125 ${tone}`}
    >
      {unlimited ? (
        <>
          <InfinityIcon className="w-4 h-4" aria-hidden="true" />
          <span className="hidden sm:inline">Unlimited</span>
        </>
      ) : (
        <>
          <Download className="w-3.5 h-3.5" aria-hidden="true" />
          {/* Downloads left today: "2 left" on phones, "2 of 4 left" from sm up. */}
          <span className="whitespace-nowrap">
            {remaining}
            <span className="hidden sm:inline"> of {usage.limit}</span>
            <span className="font-normal opacity-70"> left</span>
          </span>
        </>
      )}
    </Link>
  )
}

// ── Account menu ──────────────────────────────────────────────────────────────

function menuItems(menu: HTMLElement | null): HTMLElement[] {
  return Array.from(menu?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])
}

function AccountMenu({ user, onSignOut }: { user: PublicUser; onSignOut: () => void }) {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const menuId = useId()
  const displayName = user.name || user.email || formatPhone(user.phone) || 'Account'

  // While open: close on outside press, and move focus into the menu.
  useEffect(() => {
    if (!open) return
    menuItems(menuRef.current)[0]?.focus()
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !wrapperRef.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  const close = (refocus: boolean) => {
    setOpen(false)
    if (refocus) buttonRef.current?.focus()
  }

  const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const list = menuItems(menuRef.current)
    const index = list.indexOf(document.activeElement as HTMLElement)
    switch (event.key) {
      case 'Escape':
        event.preventDefault()
        close(true)
        break
      case 'ArrowDown':
        event.preventDefault()
        list[(index + 1) % list.length]?.focus()
        break
      case 'ArrowUp':
        event.preventDefault()
        list[(index - 1 + list.length) % list.length]?.focus()
        break
      case 'Home':
        event.preventDefault()
        list[0]?.focus()
        break
      case 'End':
        event.preventDefault()
        list[list.length - 1]?.focus()
        break
      case 'Tab':
        close(false)
        break
    }
  }

  const itemClass =
    'flex w-full items-center gap-3 px-3 h-11 rounded-lg text-[13px] text-slate-200 hover:bg-white/[0.06] focus:bg-white/[0.06] outline-none transition-colors'

  return (
    <div ref={wrapperRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen(o => !o)}
        onKeyDown={event => {
          if (event.key === 'ArrowDown' && !open) {
            event.preventDefault()
            setOpen(true)
          }
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`Account menu for ${displayName}`}
        className="flex items-center gap-2 h-10 pl-1 pr-2 sm:pr-3 rounded-full border border-white/10 bg-white/[0.04] hover:bg-white/[0.08] transition-colors"
      >
        <span className="relative w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-sky-500 flex items-center justify-center text-[12px] font-bold text-white">
          {initials(user.name || user.email)}
          {user.temp_password && (
            <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-amber-400 ring-2 ring-[#0d0f1a]" aria-hidden="true" />
          )}
        </span>
        <span className="hidden md:block max-w-[140px] truncate text-[13px] font-medium text-slate-200">{displayName}</span>
        <ChevronDown className={`hidden sm:block w-4 h-4 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>

      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label="Account"
          onKeyDown={onMenuKeyDown}
          className="ui-menu absolute right-0 mt-2 w-[min(18rem,calc(100vw-2rem))] rounded-xl border border-white/10 bg-[#141729] p-1.5 shadow-2xl shadow-black/50 z-40"
        >
          <div className="px-3 pt-2 pb-2.5 mb-1 border-b border-white/[0.06]">
            <p className="text-sm font-semibold text-white truncate">{user.name || 'Account'}</p>
            <p className="text-xs text-slate-500 truncate">{user.email || formatPhone(user.phone)}</p>
          </div>

          {user.temp_password && (
            <Link
              href="/account#password"
              role="menuitem"
              tabIndex={-1}
              onClick={() => setOpen(false)}
              className="flex items-start gap-2.5 mx-0.5 mb-1 px-3 py-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-[12px] text-amber-200 outline-none focus:ring-2 focus:ring-amber-400/50"
            >
              <AlertTriangle className="w-4 h-4 mt-px flex-shrink-0 text-amber-400" aria-hidden="true" />
              <span>You&apos;re using a temporary password. Change it now.</span>
            </Link>
          )}

          <Link href="/download" role="menuitem" tabIndex={-1} onClick={() => setOpen(false)} className={itemClass}>
            <Download className="w-4 h-4 text-slate-400" aria-hidden="true" />
            Download videos
          </Link>
          <Link href="/account" role="menuitem" tabIndex={-1} onClick={() => setOpen(false)} className={itemClass}>
            <UserCircle className="w-4 h-4 text-slate-400" aria-hidden="true" />
            Account
          </Link>
          <div className="my-1 border-t border-white/[0.06]" role="separator" />
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            onClick={() => {
              setOpen(false)
              onSignOut()
            }}
            className={`${itemClass} text-red-300 hover:text-red-200`}
          >
            <LogOut className="w-4 h-4" aria-hidden="true" />
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}

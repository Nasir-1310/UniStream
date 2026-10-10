'use client'
// frontend/app/account/page.tsx
//
// The signed-in user's account: profile details, today's download allowance,
// password change (with a nudge while the admin-issued temporary password is
// still in use) and sign-out.

import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode } from 'react'
import Link from 'next/link'
import {
  CalendarDays,
  Download,
  Infinity as InfinityIcon,
  KeyRound,
  LogOut,
  Mail,
  Phone,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  type LucideIcon,
} from 'lucide-react'
import Navbar from '@/components/Navbar'
import Footer from '@/components/Footer'
import { Alert, PageLoader, PasswordInput, Spinner, StatusBadge, useToast } from '@/components/ui'
import { apiErrorMessage, apiErrorStatus, changePassword, type PublicUser, type Usage } from '@/lib/api'
import { useSession } from '@/lib/auth'
import { EMPTY, formatDateBn, formatNumber, formatPhone, formatTime, formatTimeUntilBn, initials, usagePercent } from '@/lib/format'
import { PASSWORD_MIN, validatePassword, validatePasswordConfirm } from '@/lib/validation'
import { bnError } from '@/lib/serverText'

// ── Clock (for "resets in 7 h 20 min") ────────────────────────────────────────
// A coarse external store: the snapshot only changes every 30 s, so renders
// stay cheap, and the server render (0) never shows a relative time.

const CLOCK_MS = 30_000

function subscribeClock(callback: () => void): () => void {
  const id = window.setInterval(callback, CLOCK_MS)
  document.addEventListener('visibilitychange', callback)
  return () => {
    window.clearInterval(id)
    document.removeEventListener('visibilitychange', callback)
  }
}
const readClock = () => Math.floor(Date.now() / CLOCK_MS) * CLOCK_MS
const readServerClock = () => 0

function useClock(): number {
  return useSyncExternalStore(subscribeClock, readClock, readServerClock)
}

/**
 * Set `.current` to an element in a submit handler; it gets focus once `busy`
 * is false again (disabled inputs can't take focus while the request runs).
 */
function useFocusWhenIdle(busy: boolean) {
  const target = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (busy || !target.current) return
    target.current.focus()
    target.current = null
  }, [busy])
  return target
}

function timezoneLabel(tz: string): string {
  return tz === 'Asia/Dhaka' ? '(বাংলাদেশ সময়)' : tz.replace(/_/g, ' ')
}

// ═════════════════════════════════════════════════════════════════════════════
// Page
// ═════════════════════════════════════════════════════════════════════════════

export default function AccountPage() {
  const { user, loading, error, refresh, signOut } = useSession({ required: true })

  let content: ReactNode
  if (user) {
    content = <AccountContent user={user} refresh={refresh} signOut={signOut} />
  } else if (error && !loading) {
    content = (
      <div className="max-w-md mx-auto surface-card p-5 sm:p-6">
        <Alert tone="danger" title="আপনার অ্যাকাউন্ট লোড করা যায়নি">
          {error}
        </Alert>
        <button type="button" onClick={() => refresh().catch(() => undefined)} className="btn-primary w-full mt-4">
          <RefreshCw className="w-4 h-4" aria-hidden="true" />
          আবার চেষ্টা করুন
        </button>
      </div>
    )
  } else {
    content = <PageLoader label="আপনার অ্যাকাউন্ট লোড হচ্ছে…" />
  }

  return (
    <div className="min-h-svh flex flex-col page-bg">
      <Navbar />
      <main id="main" className="relative z-10 flex-1 px-4 sm:px-8 py-6 sm:py-12">
        <div className="max-w-5xl mx-auto">{content}</div>
      </main>
      <Footer />
    </div>
  )
}

interface AccountContentProps {
  user: PublicUser
  refresh: () => Promise<PublicUser | null>
  signOut: () => void
}

function AccountContent({ user, refresh, signOut }: AccountContentProps) {
  // Arriving via /account#password (Navbar's temporary-password nudge): the
  // section didn't exist while the session loaded, so scroll to it now.
  useEffect(() => {
    if (window.location.hash !== '#password') return
    document.getElementById('password')?.scrollIntoView({ block: 'start' })
  }, [])

  function goToPasswordForm() {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    document.getElementById('password')?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' })
    document.getElementById('current-password')?.focus({ preventScroll: true })
  }

  return (
    <>
      <header className="mb-6 sm:mb-8">
        <h1 className="text-2xl sm:text-3xl font-bold text-white">অ্যাকাউন্ট</h1>
        <p className="mt-1.5 text-sm sm:text-[15px] text-slate-400">
          আপনার তথ্য, আজকের ডাউনলোড আর পাসওয়ার্ড।
        </p>
      </header>

      {user.temp_password && (
        <Alert
          tone="warning"
          title="আপনি অস্থায়ী পাসওয়ার্ড ব্যবহার করছেন"
          className="mb-6"
          action={
            <button type="button" onClick={goToPasswordForm} className="btn-outline btn-sm">
              <KeyRound className="w-4 h-4" aria-hidden="true" />
              নিজের পাসওয়ার্ড সেট করুন
            </button>
          }
        >
          অনুমোদনের ইমেইলে একটি অস্থায়ী পাসওয়ার্ড দেওয়া হয়েছিল। অ্যাকাউন্ট নিরাপদ রাখতে শুধু আপনি জানেন এমন পাসওয়ার্ড দিয়ে বদলে নিন।
        </Alert>
      )}

      <div className="grid gap-4 sm:gap-6 lg:grid-cols-5">
        <UsageCard usage={user.usage} refresh={refresh} className="lg:col-span-3 lg:order-2" />
        <ProfileCard user={user} className="lg:col-span-2 lg:order-1" />
      </div>

      <ChangePasswordSection user={user} />

      <section
        aria-labelledby="signout-title"
        className="mt-4 sm:mt-6 surface-card p-5 sm:p-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="min-w-0">
          <h2 id="signout-title" className="text-base font-semibold text-white">
            সাইন আউট
          </h2>
          <p className="mt-1 text-[13px] leading-relaxed text-slate-400 max-w-xl">
            এই ডিভাইসে ৩০ দিন পর্যন্ত সাইন ইন থাকবেন। ফোন হারিয়েছেন বা অন্যের কম্পিউটার ব্যবহার করেছেন? পাসওয়ার্ড
            বদলালে অন্য সব ডিভাইস থেকে সাইন আউট হয়ে যাবে।
          </p>
        </div>
        <button type="button" onClick={signOut} className="btn-secondary w-full sm:w-auto flex-shrink-0">
          <LogOut className="w-4 h-4" aria-hidden="true" />
          সাইন আউট
        </button>
      </section>
    </>
  )
}

// ── Profile ───────────────────────────────────────────────────────────────────

function DetailRow({ Icon, label, children }: { Icon: LucideIcon; label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-3">
      <Icon className="w-4 h-4 mt-0.5 flex-shrink-0 text-slate-500" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <dt className="text-xs text-slate-500">{label}</dt>
        <dd className="mt-0.5 text-sm text-slate-200 break-words">{children}</dd>
      </div>
    </div>
  )
}

function ProfileCard({ user, className = '' }: { user: PublicUser; className?: string }) {
  return (
    <section aria-labelledby="profile-title" className={`surface-card p-5 sm:p-6 ${className}`}>
      <div className="flex items-center gap-4">
        <span
          className="w-14 h-14 flex-shrink-0 rounded-2xl bg-gradient-to-br from-indigo-500 to-sky-500 flex items-center justify-center text-lg font-bold text-[#fff]"
          aria-hidden="true"
        >
          {initials(user.name || user.email)}
        </span>
        <div className="min-w-0">
          <h2 id="profile-title" className="text-lg font-semibold text-white truncate">
            {user.name || 'আপনার প্রোফাইল'}
          </h2>
          <div className="mt-1">
            <StatusBadge status={user.status} label={{ approved: 'অনুমোদিত', pending: 'অপেক্ষমাণ', blocked: 'ব্লক করা' }[user.status]} />
          </div>
        </div>
      </div>

      <dl className="mt-4 divide-y divide-white/[0.06] border-t border-white/[0.06]">
        <DetailRow Icon={Mail} label="ইমেইল">
          {user.email || EMPTY}
        </DetailRow>
        <DetailRow Icon={Phone} label="মোবাইল নম্বর">
          {formatPhone(user.phone)}
        </DetailRow>
        <DetailRow Icon={CalendarDays} label="সদস্য হয়েছেন">
          {formatDateBn(user.created_at, { time: false })}
        </DetailRow>
      </dl>
      <p className="mt-3 text-xs leading-relaxed text-slate-500">
        ইমেইল বা মোবাইল নম্বর দিয়ে সাইন ইন করতে পারবেন। এই তথ্য বদলাতে অ্যাডমিনের সাথে যোগাযোগ করুন।
      </p>
    </section>
  )
}

// ── Today's usage ─────────────────────────────────────────────────────────────

function UsageCard({
  usage,
  refresh,
  className = '',
}: {
  usage: Usage
  refresh: () => Promise<PublicUser | null>
  className?: string
}) {
  const toast = useToast()
  const now = useClock()
  const [refreshing, setRefreshing] = useState(false)
  const refreshedFor = useRef<string | null>(null)

  const unlimited = usage.limit === null
  const limit = usage.limit ?? 0
  const remaining = unlimited ? null : Math.max(0, usage.remaining ?? limit - usage.used)
  const percent = usagePercent(usage)
  const resetsAt = formatTime(usage.resets_at, usage.timezone)
  const resetPassed = now > 0 && now >= Date.parse(usage.resets_at)
  const resetsIn = now > 0 && !resetPassed ? formatTimeUntilBn(usage.resets_at, now) : null

  // Past midnight the cached numbers are yesterday's: fetch today's once.
  useEffect(() => {
    if (!resetPassed || refreshedFor.current === usage.resets_at) return
    refreshedFor.current = usage.resets_at
    refresh().catch(() => undefined)
  }, [resetPassed, usage.resets_at, refresh])

  async function onRefresh() {
    setRefreshing(true)
    try {
      await refresh()
    } catch (err) {
      toast.error('ব্যবহারের তথ্য রিফ্রেশ করা যায়নি', { description: apiErrorMessage(err) })
    } finally {
      setRefreshing(false)
    }
  }

  const barColor =
    remaining === null ? 'bg-indigo-400' : remaining === 0 ? 'bg-red-400' : remaining === 1 ? 'bg-amber-400' : 'bg-emerald-400'

  let status: ReactNode
  if (unlimited) {
    status = 'আপনার অ্যাকাউন্টে আনলিমিটেড ডাউনলোড।'
  } else if (limit === 0) {
    status = 'আপনার অ্যাকাউন্টে ডাউনলোড বন্ধ আছে। ভুল মনে হলে অ্যাডমিনের সাথে যোগাযোগ করুন।'
  } else if (remaining === 0) {
    status = 'আজকের সব ডাউনলোড ব্যবহার হয়ে গেছে। সীমা নতুন করে শুরু হলে আবার পাবেন।'
  } else {
    status = (
      <>
        আজ আরও <strong className="text-white">{formatNumber(remaining ?? 0)}</strong>টি ডাউনলোড বাকি।
      </>
    )
  }

  return (
    <section aria-labelledby="usage-title" className={`surface-card p-5 sm:p-6 flex flex-col ${className}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="usage-title" className="text-base font-semibold text-white">
            আজকের ডাউনলোড
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">শুধু সম্পূর্ণ ডাউনলোড গোনা হয়। লিংক দেখা ফ্রি।</p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          className="btn-icon -mr-2 -mt-1"
          aria-label="আজকের ব্যবহার রিফ্রেশ করুন"
          title="রিফ্রেশ"
        >
          {refreshing ? <Spinner size="sm" label={null} /> : <RefreshCw className="w-4 h-4" aria-hidden="true" />}
        </button>
      </div>

      <div className="mt-5 flex items-end gap-2" aria-hidden="true">
        {unlimited ? (
          <>
            <InfinityIcon className="w-9 h-9 text-indigo-300" />
            <span className="pb-1 text-sm text-slate-400">
              আনলিমিটেড · আজ {formatNumber(usage.used)}টি
            </span>
          </>
        ) : (
          <>
            <span className="text-4xl sm:text-5xl font-bold text-white tabular-nums leading-none" style={{ fontFamily: 'var(--font-display)' }}>
              {formatNumber(usage.used)}
            </span>
            <span className="pb-1 text-lg text-slate-500 tabular-nums">/ {formatNumber(limit)} ব্যবহৃত</span>
          </>
        )}
      </div>

      {!unlimited && (
        <div
          role="progressbar"
          aria-label="আজ ব্যবহার করা ডাউনলোড"
          aria-valuemin={0}
          aria-valuemax={limit}
          aria-valuenow={Math.min(usage.used, limit)}
          aria-valuetext={`${limit}টির মধ্যে ${usage.used}টি ব্যবহৃত`}
          className="mt-4 h-2.5 rounded-full bg-white/[0.07] overflow-hidden"
        >
          <div className={`h-full rounded-full transition-[width] duration-500 ${barColor}`} style={{ width: `${percent}%` }} />
        </div>
      )}

      <p className="mt-4 text-sm text-slate-300" aria-live="polite">
        {status}
      </p>
      {!unlimited && (
        <p className="mt-1 text-[13px] text-slate-500">
          নতুন করে শুরু: <span className="text-slate-300">{resetsAt}</span> {timezoneLabel(usage.timezone)}
          {resetsIn && <> · {resetsIn} পর</>}
        </p>
      )}

      {/* Pushes the footer down when the grid row is taller than this card. */}
      <div className="flex-1" aria-hidden="true" />
      <div className="mt-5 pt-5 border-t border-white/[0.06] flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {!unlimited ? (
          <p className="flex items-start gap-2 text-xs leading-relaxed text-slate-500">
            <Sparkles className="w-4 h-4 flex-shrink-0 text-violet-300" aria-hidden="true" />
            <span>আরও ডাউনলোড দরকার? অ্যাডমিনের সাথে যোগাযোগ করুন।</span>
          </p>
        ) : (
          <span />
        )}
        <Link href="/download" className="btn-primary btn-sm flex-shrink-0">
          <Download className="w-4 h-4" aria-hidden="true" />
          ভিডিও ডাউনলোড
        </Link>
      </div>
    </section>
  )
}

// ── Change password ───────────────────────────────────────────────────────────

function ChangePasswordSection({ user }: { user: PublicUser }) {
  const toast = useToast()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [currentServerError, setCurrentServerError] = useState<string | null>(null)
  const [nextServerError, setNextServerError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const currentRef = useRef<HTMLInputElement>(null)
  const nextRef = useRef<HTMLInputElement>(null)
  const confirmRef = useRef<HTMLInputElement>(null)
  const submitRef = useRef<HTMLButtonElement>(null)
  const focusAfterRef = useFocusWhenIdle(submitting)

  const nextCheck = validatePassword(next)
  const confirmCheck = validatePasswordConfirm(next, confirm)
  const sameAsCurrent = Boolean(next) && next === current

  const currentError = currentServerError ?? (submitted && !current ? 'বর্তমান পাসওয়ার্ড লিখুন।' : null)
  const nextError =
    nextServerError ??
    (submitted && !nextCheck.ok
      ? bnError(nextCheck.error)
      : submitted && sameAsCurrent
      ? 'বর্তমান পাসওয়ার্ড থেকে আলাদা একটি পাসওয়ার্ড দিন।'
      : null)
  const confirmError = submitted && nextCheck.ok && !sameAsCurrent && !confirmCheck.ok ? bnError(confirmCheck.error) : null

  const forgotHref = user.email ? `/forgot-password?email=${encodeURIComponent(user.email)}` : '/forgot-password'
  const temp = user.temp_password

  function clearMessages() {
    setFormError(null)
    setSaved(false)
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitted(true)
    clearMessages()
    if (!current) return currentRef.current?.focus()
    if (!nextCheck.ok || sameAsCurrent) return nextRef.current?.focus()
    if (!confirmCheck.ok) return confirmRef.current?.focus()

    setSubmitting(true)
    try {
      // Stores the new session: the old token stops working once the password changes.
      await changePassword(current, next)
      setCurrent('')
      setNext('')
      setConfirm('')
      setSubmitted(false)
      setSaved(true)
      toast.success('পাসওয়ার্ড বদলানো হয়েছে', { description: 'অন্য সব ডিভাইস থেকে সাইন আউট করা হয়েছে।' })
    } catch (err) {
      const status = apiErrorStatus(err)
      const message = apiErrorMessage(err, 'পাসওয়ার্ড বদলানো যায়নি। আবার চেষ্টা করুন।')
      if (status === 400 && /current password|বর্তমান পাসওয়ার্ড/i.test(message) && /incorrect|ভুল/i.test(message)) {
        setCurrentServerError(message)
        focusAfterRef.current = currentRef.current
      } else if (status === 400) {
        setNextServerError(message)
        focusAfterRef.current = nextRef.current
      } else {
        setFormError(message)
        focusAfterRef.current = submitRef.current
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section
      id="password"
      aria-labelledby="password-title"
      className="mt-4 sm:mt-6 surface-card p-5 sm:p-6 scroll-mt-20 md:grid md:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] md:gap-10"
    >
      <div>
        <div className="flex items-center gap-3">
          <span className="w-10 h-10 flex-shrink-0 rounded-xl bg-indigo-500/10 border border-indigo-500/25 flex items-center justify-center">
            <ShieldCheck className="w-5 h-5 text-indigo-300" aria-hidden="true" />
          </span>
          <h2 id="password-title" className="text-base sm:text-lg font-semibold text-white">
            {temp ? 'নিজের পাসওয়ার্ড সেট করুন' : 'পাসওয়ার্ড বদলান'}
          </h2>
        </div>
        <ul className="mt-4 space-y-2 text-[13px] leading-relaxed text-slate-400">
          <li>• অন্তত {PASSWORD_MIN}টি অক্ষর, তার মধ্যে একটি অক্ষর আর একটি সংখ্যা।</li>
          <li>• যত লম্বা, তত শক্তিশালী: ৩–৪ শব্দের ছোট একটি বাক্য দিন।</li>
          <li>• অন্য সাইটের পাসওয়ার্ড এখানে আবার ব্যবহার করবেন না।</li>
          <li>• এখানে সাইন ইন থাকবেন; অন্য ডিভাইস থেকে সাইন আউট হবে।</li>
        </ul>
      </div>

      <form onSubmit={onSubmit} noValidate className="mt-5 md:mt-0">
        {/* Lets password managers save the new password against the right account. */}
        <input
          type="text"
          name="username"
          autoComplete="username"
          value={user.email || user.phone || ''}
          readOnly
          hidden
        />

        {saved && (
          <Alert tone="success" className="mb-4" onDismiss={() => setSaved(false)}>
            পাসওয়ার্ড বদলানো হয়েছে। পরেরবার নতুন পাসওয়ার্ড দিয়ে সাইন ইন করবেন।
          </Alert>
        )}
        {formError && (
          <Alert tone="danger" className="mb-4" onDismiss={() => setFormError(null)}>
            {formError}
          </Alert>
        )}

        <div className="space-y-4">
          <PasswordInput
            ref={currentRef}
            id="current-password"
            name="current-password"
            label={temp ? 'অস্থায়ী পাসওয়ার্ড' : 'বর্তমান পাসওয়ার্ড'}
            labelAside={
              <Link href={forgotHref} className="text-[13px] font-medium text-indigo-300 hover:text-indigo-200 rounded py-1">
                ভুলে গেছেন?
              </Link>
            }
            hint={temp ? 'অনুমোদনের ইমেইলে পাওয়া পাসওয়ার্ড।' : undefined}
            autoComplete="current-password"
            value={current}
            onChange={e => {
              setCurrent(e.target.value)
              setCurrentServerError(null)
              clearMessages()
            }}
            disabled={submitting}
            error={currentError}
          />
          <PasswordInput
            ref={nextRef}
            id="new-password"
            name="new-password"
            label="নতুন পাসওয়ার্ড"
            showStrength
            autoComplete="new-password"
            value={next}
            onChange={e => {
              setNext(e.target.value)
              setNextServerError(null)
              clearMessages()
            }}
            disabled={submitting}
            error={nextError}
          />
          <PasswordInput
            ref={confirmRef}
            id="confirm-password"
            name="confirm-password"
            label="নতুন পাসওয়ার্ড আবার লিখুন"
            autoComplete="new-password"
            value={confirm}
            onChange={e => {
              setConfirm(e.target.value)
              clearMessages()
            }}
            disabled={submitting}
            error={confirmError}
          />
        </div>

        <button ref={submitRef} type="submit" className="btn-primary w-full sm:w-auto mt-5" disabled={submitting}>
          {submitting ? (
            <>
              <Spinner size="sm" label={null} /> সেভ হচ্ছে…
            </>
          ) : temp ? (
            'পাসওয়ার্ড সেভ করুন'
          ) : (
            'পাসওয়ার্ড আপডেট করুন'
          )}
        </button>
      </form>
    </section>
  )
}

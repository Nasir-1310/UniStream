'use client'
// frontend/app/page.tsx
//
// Landing page: what UniStream Saver is, the three supported platforms, how
// access works, and the auth card (Sign in / Request access). Signed-in
// visitors are sent straight to /download unless they followed an in-page
// link (e.g. /#faq from the footer), so the FAQ stays readable for them.

import {
  Suspense,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ClipboardPaste,
  Download,
  Facebook,
  Gauge,
  GraduationCap,
  Instagram,
  KeyRound,
  LogIn,
  MailCheck,
  MonitorSmartphone,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  UserPlus,
  Youtube,
  type LucideIcon,
} from 'lucide-react'
import Navbar from '@/components/Navbar'
import Footer from '@/components/Footer'
import { ContactSection } from '@/components/ContactCard'
import { Alert, Field, PasswordInput, Spinner, describedBy, useToast } from '@/components/ui'
import { apiErrorMessage, apiErrorStatus, login, register, warmBackend, type PublicUser } from '@/lib/api'
import { useSession } from '@/lib/auth'
import { CONTACT, CONTACT_MAILTO } from '@/lib/contact'
import { formatPhone } from '@/lib/format'
import { classifyLogin, errorOf, validateEmail, validateName, validatePhone, NAME_MAX } from '@/lib/validation'
import { bnError, translateServerText } from '@/lib/serverText'

type AuthTab = 'signin' | 'request'

/** Longest "Institution / department" we accept (the API allows more; this keeps rows tidy). */
const NOTE_MAX = 120
/** After this long, tell the user the free-tier server is probably waking up. */
const SLOW_REQUEST_MS = 8000

// ── URL hash as an external store ─────────────────────────────────────────────
// Read through useSyncExternalStore so the server render ('') and the browser
// agree during hydration, then the real hash takes over.

function subscribeHash(callback: () => void): () => void {
  window.addEventListener('hashchange', callback)
  return () => window.removeEventListener('hashchange', callback)
}
const getHash = () => window.location.hash
const getServerHash = () => ''

function firstName(name: string | null | undefined): string {
  return (name ?? '').trim().split(/\s+/)[0] ?? ''
}

/**
 * Set `.current` to an element in a submit handler; it gets focus once `busy`
 * is false again. Inputs are disabled while a request runs, and a disabled
 * element can't take focus, so focusing straight from the catch block fails.
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

// ═════════════════════════════════════════════════════════════════════════════
// Page
// ═════════════════════════════════════════════════════════════════════════════

export default function HomePage() {
  const router = useRouter()
  const { user, loading } = useSession()
  const hash = useSyncExternalStore(subscribeHash, getHash, getServerHash)
  const [tabChoice, setTabChoice] = useState<AuthTab | null>(null)
  const [loginValue, setLoginValue] = useState('')
  const tab: AuthTab = tabChoice ?? (hash === '#request' ? 'request' : 'signin')

  // Start waking the free-tier backend right away, so its ~50 s cold start
  // overlaps with the visitor reading and typing instead of their first submit.
  useEffect(() => {
    warmBackend()
  }, [])

  // Signed-in visitors belong on the downloader, unless they came for a section.
  const redirecting = !loading && Boolean(user) && !hash
  useEffect(() => {
    if (redirecting) router.replace('/download')
  }, [redirecting, router])

  /** Switch the auth card's tab, scroll it into view and move focus to the tab. */
  function openAuth(next: AuthTab, prefillLogin?: string) {
    setTabChoice(next)
    if (prefillLogin !== undefined) setLoginValue(prefillLogin)
    const card = document.getElementById('auth')
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    card?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' })
    window.requestAnimationFrame(() => {
      document.getElementById(`auth-tab-${next}`)?.focus({ preventScroll: true })
    })
  }

  return (
    <div className="min-h-svh flex flex-col page-bg">
      <AmbientGlow />
      <Navbar />

      <main id="main" className="relative z-10 flex-1">
        {/* ── Hero + auth card ─────────────────────────────────────────── */}
        <section
          aria-labelledby="hero-title"
          className="max-w-7xl mx-auto w-full px-4 sm:px-8 pt-6 pb-14 sm:pt-12 sm:pb-20 lg:pt-20 lg:pb-24"
        >
          <div className="grid gap-6 sm:gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)] lg:gap-x-16 lg:gap-y-8">
            <div className="lg:col-start-1 lg:row-start-1 lg:self-end">
              <p className="eyebrow-badge mb-4 sm:mb-6">
                <GraduationCap className="w-3.5 h-3.5" aria-hidden="true" />
                অনুমোদিত শিক্ষার্থীদের জন্য ফ্রি
              </p>
              <h1
                id="hero-title"
                className="text-[1.875rem] leading-[1.1] sm:text-5xl lg:text-[3.4rem] font-extrabold text-white max-w-2xl"
                style={{ letterSpacing: '-0.025em' }}
              >
                YouTube, Facebook ও Instagram ভিডিও সেভ করুন{' '}
                <span className="bg-gradient-to-r from-sky-400 via-indigo-400 to-violet-400 bg-clip-text text-transparent">
                  4K পর্যন্ত কোয়ালিটিতে।
                </span>
              </h1>
              <p className="mt-3 sm:mt-5 text-[15px] sm:text-base leading-relaxed text-slate-400 max-w-xl">
                সহজ আর দ্রুত: লিংক পেস্ট করুন, কোয়ালিটি বেছে নিন, ডাউনলোড করুন। অনুমোদিত শিক্ষার্থীদের জন্য ফ্রি, আর
                অ্যাকাউন্ট অনুযায়ী প্রতিদিন আনলিমিটেড ডাউনলোড।
              </p>
              <p className="mt-3 inline-flex items-start gap-2 text-[13px] sm:text-sm leading-relaxed text-violet-200/90">
                <Sparkles className="w-4 h-4 mt-px flex-shrink-0 text-violet-300" aria-hidden="true" />
                <span>এখন YouTube, Facebook ও Instagram — তিনটিতেই 4K পর্যন্ত।</span>
              </p>
            </div>

            <div id="auth" className="relative lg:col-start-2 lg:row-start-1 lg:row-span-2 lg:self-center scroll-mt-20">
              {/* Target for /#request links (that hash also opens the Request access tab). */}
              <span id="request" className="absolute top-0 scroll-mt-20" aria-hidden="true" />
              <AuthCard
                tab={tab}
                onTabChange={setTabChoice}
                loginValue={loginValue}
                onLoginValueChange={setLoginValue}
                user={user}
                redirecting={redirecting}
                onOpenAuth={openAuth}
              />
            </div>

            <div className="lg:col-start-1 lg:row-start-2 lg:self-start">
              <ul className="grid gap-2.5 sm:grid-cols-2 max-w-xl text-[14px] text-slate-300">
                {[
                  'প্রতিদিন আনলিমিটেড ডাউনলোড (অ্যাকাউন্ট অনুযায়ী)',
                  '4K Ultra HD পর্যন্ত, অথবা শুধু অডিও (MP3)',
                  'ফোনের ব্রাউজারেই চলে',
                  'কোনো বিজ্ঞাপন নেই, অ্যাপ ইনস্টলের ঝামেলা নেই',
                ].map(item => (
                  <li key={item} className="flex items-start gap-2.5">
                    <CheckCircle2 className="w-4 h-4 mt-[3px] flex-shrink-0 text-emerald-400" aria-hidden="true" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-6 flex flex-wrap items-center gap-2">
                <span className="text-[12px] text-slate-500 mr-1">যেখান থেকে ডাউনলোড করা যায়</span>
                <span className="platform-pill">
                  <Youtube className="w-3.5 h-3.5 text-red-400" aria-hidden="true" /> YouTube
                </span>
                <span className="platform-pill">
                  <Facebook className="w-3.5 h-3.5 text-blue-400" aria-hidden="true" /> Facebook
                </span>
                <span className="platform-pill">
                  <Instagram className="w-3.5 h-3.5 text-pink-400" aria-hidden="true" /> Instagram
                </span>
              </div>
            </div>
          </div>
        </section>

        <PlatformsSection />
        <HowItWorksSection onRequestAccess={() => openAuth('request')} />
        <FeaturesSection />
        <FaqSection onOpenAuth={openAuth} />
        <CtaSection onOpenAuth={openAuth} />
        <ContactSection />
      </main>

      <Footer showAdminLink />
    </div>
  )
}

function AmbientGlow() {
  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden" aria-hidden="true">
      <div
        className="absolute -top-32 left-1/2 -translate-x-1/2 w-[900px] h-[480px] rounded-full"
        style={{ background: 'radial-gradient(ellipse, rgb(var(--accent-rgb) / 0.10) 0%, transparent 65%)' }}
      />
      <div
        className="absolute top-[12%] -right-24 w-[420px] h-[420px] rounded-full"
        style={{ background: 'radial-gradient(circle, rgb(var(--tw-sky-400) / 0.07) 0%, transparent 65%)' }}
      />
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// Auth card
// ═════════════════════════════════════════════════════════════════════════════

interface AuthCardProps {
  tab: AuthTab
  onTabChange: (tab: AuthTab) => void
  loginValue: string
  onLoginValueChange: (value: string) => void
  user: PublicUser | null
  redirecting: boolean
  onOpenAuth: (tab: AuthTab, prefillLogin?: string) => void
}

const TABS: { id: AuthTab; label: string; Icon: LucideIcon }[] = [
  { id: 'signin', label: 'সাইন ইন', Icon: LogIn },
  { id: 'request', label: 'অ্যাক্সেসের অনুরোধ', Icon: UserPlus },
]

function AuthCard({ tab, onTabChange, loginValue, onLoginValueChange, user, redirecting, onOpenAuth }: AuthCardProps) {
  if (user) {
    return (
      <div className="portal-card p-6 sm:p-8">
        <SignedInPanel user={user} redirecting={redirecting} />
      </div>
    )
  }

  function onTabKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    const index = TABS.findIndex(t => t.id === tab)
    let next = -1
    if (event.key === 'ArrowRight') next = (index + 1) % TABS.length
    else if (event.key === 'ArrowLeft') next = (index - 1 + TABS.length) % TABS.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = TABS.length - 1
    if (next < 0) return
    event.preventDefault()
    onTabChange(TABS[next].id)
    document.getElementById(`auth-tab-${TABS[next].id}`)?.focus()
  }

  return (
    <div className="portal-card p-4 sm:p-7 shadow-2xl shadow-black/30">
      <div
        role="tablist"
        aria-label="সাইন ইন অথবা অ্যাক্সেসের অনুরোধ"
        className="relative grid grid-cols-2 gap-1 p-1 rounded-xl bg-white/[0.04] border border-white/[0.06]"
      >
        {TABS.map(({ id, label, Icon }) => {
          const selected = tab === id
          return (
            <button
              key={id}
              id={`auth-tab-${id}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`auth-panel-${id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => onTabChange(id)}
              onKeyDown={onTabKeyDown}
              className={`inline-flex items-center justify-center gap-2 min-h-11 px-2 rounded-lg text-[13px] sm:text-sm font-semibold transition-colors ${
                selected
                  ? 'bg-indigo-600 text-[#fff] shadow-sm shadow-indigo-900/30'
                  : 'text-slate-400 hover:text-white hover:bg-white/[0.05]'
              }`}
              style={{ fontFamily: 'var(--font-display)' }}
            >
              <Icon className="w-4 h-4 flex-shrink-0 max-[359px]:hidden" aria-hidden="true" />
              <span className="whitespace-nowrap">{label}</span>
            </button>
          )
        })}
      </div>

      {/* Both panels stay mounted so typed values survive switching tabs. */}
      <div
        id="auth-panel-signin"
        role="tabpanel"
        aria-labelledby="auth-tab-signin"
        hidden={tab !== 'signin'}
        className="relative pt-5 sm:pt-6"
      >
        <Suspense fallback={null}>
          <SessionExpiredNotice />
        </Suspense>
        <SignInForm value={loginValue} onValueChange={onLoginValueChange} onRequestAccess={() => onOpenAuth('request')} />
      </div>

      <div
        id="auth-panel-request"
        role="tabpanel"
        aria-labelledby="auth-tab-request"
        hidden={tab !== 'request'}
        className="relative pt-5 sm:pt-6"
      >
        <RequestAccessForm onSignIn={prefill => onOpenAuth('signin', prefill)} />
      </div>
    </div>
  )
}

/** Explains why a visitor landed here after their session ended (`/?session=expired`). */
function SessionExpiredNotice() {
  const params = useSearchParams()
  const [dismissed, setDismissed] = useState(false)
  if (dismissed || params.get('session') !== 'expired') return null
  return (
    <Alert tone="warning" title="আপনার সেশন শেষ হয়েছে" onDismiss={() => setDismissed(true)} className="mb-5">
      নিরাপত্তার জন্য আপনাকে সাইন আউট করা হয়েছে। চালিয়ে যেতে আবার সাইন ইন করুন।
    </Alert>
  )
}

function SignedInPanel({ user, redirecting }: { user: PublicUser; redirecting: boolean }) {
  const name = firstName(user.name)
  if (redirecting) {
    return (
      <div className="flex flex-col items-center text-center py-6 gap-3" role="status">
        <Spinner size="lg" label={null} className="text-indigo-400" />
        <p className="text-sm text-slate-300">সাইন ইন হয়েছে — ডাউনলোড পেজে নিয়ে যাচ্ছি…</p>
        <Link href="/download" className="text-[13px] text-indigo-300 hover:text-indigo-200 underline underline-offset-4">
          এখনই যান
        </Link>
      </div>
    )
  }
  return (
    <div className="relative">
      <div className="w-11 h-11 rounded-xl bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center mb-4">
        <CheckCircle2 className="w-5 h-5 text-emerald-400" aria-hidden="true" />
      </div>
      <h2 className="text-xl font-bold text-white">{name ? `আবার স্বাগতম, ${name}` : 'আপনি সাইন ইন করে আছেন'}</h2>
      <p className="mt-1.5 text-sm text-slate-400">
        সাইন ইন করা আছে: <span className="text-slate-200">{user.email || formatPhone(user.phone)}</span>
      </p>
      <div className="mt-6 grid gap-2.5 sm:grid-cols-2">
        <Link href="/download" className="btn-primary">
          <Download className="w-4 h-4" aria-hidden="true" />
          ভিডিও ডাউনলোড করুন
        </Link>
        <Link href="/account" className="btn-secondary">
          অ্যাকাউন্ট
        </Link>
      </div>
    </div>
  )
}

// ── Sign in ───────────────────────────────────────────────────────────────────

interface FormMessage {
  message: string
  status?: number
}

interface SignInFormProps {
  value: string
  onValueChange: (value: string) => void
  onRequestAccess: () => void
}

function SignInForm({ value, onValueChange, onRequestAccess }: SignInFormProps) {
  const router = useRouter()
  const toast = useToast()
  const [password, setPassword] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [loginTouched, setLoginTouched] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [slow, setSlow] = useState(false)
  const [formError, setFormError] = useState<FormMessage | null>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const submitRef = useRef<HTMLButtonElement>(null)
  const focusAfterRef = useFocusWhenIdle(submitting)

  const loginCheck = classifyLogin(value)
  const loginError = (submitted || (loginTouched && value.trim())) && !loginCheck.ok ? bnError(loginCheck.error) : null
  const passwordError = submitted && !password ? 'পাসওয়ার্ড লিখুন।' : null
  const forgotHref =
    loginCheck.ok && loginCheck.kind === 'email'
      ? `/forgot-password?email=${encodeURIComponent(loginCheck.value)}`
      : '/forgot-password'

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitted(true)
    setFormError(null)
    if (!loginCheck.ok) {
      document.getElementById('signin-login')?.focus()
      return
    }
    if (!password) {
      passwordRef.current?.focus()
      return
    }

    setSubmitting(true)
    const slowTimer = window.setTimeout(() => setSlow(true), SLOW_REQUEST_MS)
    try {
      const { user } = await login(loginCheck.value, password)
      const name = firstName(user.name)
      if (user.temp_password) {
        toast.warning('আপনি অস্থায়ী পাসওয়ার্ড ব্যবহার করছেন', {
          description: 'অ্যাকাউন্ট নিরাপদ রাখতে নিজের পাসওয়ার্ড সেট করুন।',
          duration: 12000,
          action: { label: 'এখনই বদলান', onClick: () => router.push('/account#password') },
        })
      } else {
        toast.success(name ? `আবার স্বাগতম, ${name}!` : 'আবার স্বাগতম!')
      }
      router.replace('/download')
    } catch (err) {
      const status = apiErrorStatus(err)
      setFormError({ message: apiErrorMessage(err, 'সাইন ইন হয়নি। আবার চেষ্টা করুন।'), status })
      if (status === 401) {
        // Clear the wrong password without flagging the now-empty field as
        // "Please enter your password." under the "Incorrect…" message.
        setPassword('')
        setSubmitted(false)
      }
      focusAfterRef.current = status === 401 ? passwordRef.current : submitRef.current
    } finally {
      window.clearTimeout(slowTimer)
      setSlow(false)
      setSubmitting(false)
    }
  }

  // 403 covers "waiting for approval", "blocked" and "no password yet": not
  // the visitor's mistake, so it's shown as a notice rather than an error.
  const needsPassword = formError ? /password yet|forgot password|পাসওয়ার্ড সেট|পাসওয়ার্ড ভুলে/i.test(formError.message) : false
  const errorTone = formError?.status === 403 || formError?.status === 429 ? 'warning' : 'danger'

  return (
    <form onSubmit={onSubmit} noValidate className="relative" aria-describedby="signin-intro">
      <h2 className="text-lg sm:text-xl font-bold text-white">আবার স্বাগতম</h2>
      <p id="signin-intro" className="mt-1 mb-5 text-[13px] sm:text-sm text-slate-400">
        রেজিস্ট্রেশনের সময় দেওয়া ইমেইল বা মোবাইল নম্বর দিয়ে সাইন ইন করুন।
      </p>

      {formError && (
        <Alert
          tone={errorTone}
          className="mb-4"
          onDismiss={() => setFormError(null)}
          action={
            needsPassword ? (
              <Link href={forgotHref} className="btn-outline btn-sm">
                <KeyRound className="w-4 h-4" aria-hidden="true" />
                পাসওয়ার্ড সেট করুন
              </Link>
            ) : undefined
          }
        >
          {formError.message}
        </Alert>
      )}

      <div className="space-y-4">
        <Field htmlFor="signin-login" label="ইমেইল বা মোবাইল নম্বর" error={loginError}>
          <input
            id="signin-login"
            name="login"
            type="text"
            inputMode="text"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="you@example.com অথবা 01XXXXXXXXX"
            value={value}
            onChange={e => {
              onValueChange(e.target.value)
              setFormError(null)
            }}
            onBlur={() => setLoginTouched(true)}
            disabled={submitting}
            aria-invalid={loginError ? true : undefined}
            aria-describedby={describedBy('signin-login', loginError)}
            className="input-field"
          />
        </Field>

        <PasswordInput
          ref={passwordRef}
          id="signin-password"
          name="password"
          label="পাসওয়ার্ড"
          labelAside={
            <Link
              href={forgotHref}
              className="text-[13px] font-medium text-indigo-300 hover:text-indigo-200 rounded py-1"
            >
              পাসওয়ার্ড ভুলে গেছেন?
            </Link>
          }
          autoComplete="current-password"
          value={password}
          onChange={e => {
            setPassword(e.target.value)
            setFormError(null)
          }}
          disabled={submitting}
          error={passwordError}
        />
      </div>

      <button ref={submitRef} type="submit" className="btn-primary w-full mt-5" disabled={submitting}>
        {submitting ? (
          <>
            <Spinner size="sm" label={null} /> সাইন ইন হচ্ছে…
          </>
        ) : (
          <>
            সাইন ইন <ArrowRight className="w-4 h-4" aria-hidden="true" />
          </>
        )}
      </button>
      <p aria-live="polite" className="empty:hidden mt-3 text-center text-xs text-slate-400">
        {slow ? 'সার্ভার চালু হচ্ছে। দিনের প্রথম সাইন ইনে এক মিনিট পর্যন্ত লাগতে পারে।' : ''}
      </p>

      <p className="mt-5 pt-4 border-t border-white/[0.06] text-center text-[13px] text-slate-400">
        নতুন?{' '}
        <button
          type="button"
          onClick={onRequestAccess}
          className="font-semibold text-indigo-300 hover:text-indigo-200 underline-offset-4 hover:underline py-2"
        >
          অ্যাক্সেসের অনুরোধ করুন — একদম ফ্রি
        </button>
      </p>
    </form>
  )
}

// ── Request access ────────────────────────────────────────────────────────────

type RequestField = 'name' | 'email' | 'phone'

interface RequestSuccess {
  name: string
  email: string
  phone: string
  message: string
}

function RequestAccessForm({ onSignIn }: { onSignIn: (prefill: string) => void }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [note, setNote] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [touched, setTouched] = useState<Record<RequestField, boolean>>({ name: false, email: false, phone: false })
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [slow, setSlow] = useState(false)
  const [formError, setFormError] = useState<FormMessage | null>(null)
  const [success, setSuccess] = useState<RequestSuccess | null>(null)
  const agreeId = useId()
  const submitRef = useRef<HTMLButtonElement>(null)
  const focusAfterRef = useFocusWhenIdle(submitting)

  const checks = {
    name: validateName(name),
    email: validateEmail(email),
    phone: validatePhone(phone),
  }
  const show = (field: RequestField) => submitted || (touched[field] && (field === 'name' ? name : field === 'email' ? email : phone).trim() !== '')
  const errors: Record<RequestField, string | null> = {
    name: show('name') ? bnError(errorOf(checks.name)) : null,
    email: show('email') ? bnError(errorOf(checks.email)) : null,
    phone: show('phone') ? bnError(errorOf(checks.phone)) : null,
  }
  const agreeError = submitted && !agreed ? 'চালিয়ে যেতে ব্যবহারের শর্তাবলি ও প্রাইভেসি পলিসিতে সম্মতি দিন।' : null
  const phoneHint = checks.phone.ok
    ? `এভাবে সেভ হবে: ${formatPhone(checks.phone.value)}`
    : 'বাংলাদেশি মোবাইল নম্বর, যেমন 01712-345678। বিদেশি নম্বর হলে + আর দেশের কোড দিয়ে শুরু করুন।'

  const touch = (field: RequestField) => setTouched(t => (t[field] ? t : { ...t, [field]: true }))

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitted(true)
    setFormError(null)
    const firstInvalid = (['name', 'email', 'phone'] as const).find(field => !checks[field].ok)
    if (firstInvalid) {
      document.getElementById(`request-${firstInvalid}`)?.focus()
      return
    }
    if (!agreed) {
      document.getElementById(agreeId)?.focus()
      return
    }
    if (!checks.name.ok || !checks.email.ok || !checks.phone.ok) return

    setSubmitting(true)
    const slowTimer = window.setTimeout(() => setSlow(true), SLOW_REQUEST_MS)
    try {
      const body = {
        name: checks.name.value,
        email: checks.email.value,
        phone: checks.phone.value,
        note: note.trim() || null,
      }
      const { message } = await register(body)
      setSuccess({ name: body.name, email: body.email, phone: body.phone, message })
    } catch (err) {
      setFormError({
        message: apiErrorMessage(err, 'অনুরোধ পাঠানো যায়নি। আবার চেষ্টা করুন।'),
        status: apiErrorStatus(err),
      })
      focusAfterRef.current = submitRef.current
    } finally {
      window.clearTimeout(slowTimer)
      setSlow(false)
      setSubmitting(false)
    }
  }

  function startOver() {
    setSuccess(null)
    setSubmitted(false)
    setTouched({ name: false, email: false, phone: false })
    setName('')
    setEmail('')
    setPhone('')
    setNote('')
    setAgreed(false)
  }

  if (success) {
    return <RequestSuccessPanel success={success} onSignIn={() => onSignIn(success.email)} onStartOver={startOver} />
  }

  const isDuplicate = formError?.status === 409
  // Prefill the sign-in form with whichever value is already registered.
  const duplicatePrefill =
    /phone|মোবাইল|ফোন/i.test(formError?.message ?? '') && checks.phone.ok
      ? checks.phone.value
      : checks.email.ok
      ? checks.email.value
      : ''

  return (
    <form onSubmit={onSubmit} noValidate className="relative" aria-describedby="request-intro">
      <h2 className="text-lg sm:text-xl font-bold text-white">অ্যাক্সেসের অনুরোধ</h2>
      <p id="request-intro" className="mt-1 mb-5 text-[13px] sm:text-sm text-slate-400">
        শিক্ষার্থীদের জন্য ফ্রি। অ্যাডমিন অনুমোদন দিলেই ইমেইলে পাসওয়ার্ড পাঠিয়ে দেব।
      </p>

      {formError && (
        <Alert
          tone={isDuplicate || formError.status === 429 ? 'warning' : 'danger'}
          className="mb-4"
          onDismiss={() => setFormError(null)}
          action={
            isDuplicate ? (
              <>
                <button
                  type="button"
                  className="btn-outline btn-sm"
                  onClick={() => onSignIn(duplicatePrefill)}
                >
                  <LogIn className="w-4 h-4" aria-hidden="true" />
                  সাইন ইন
                </button>
                <Link
                  href={
                    checks.email.ok
                      ? `/forgot-password?email=${encodeURIComponent(checks.email.value)}`
                      : '/forgot-password'
                  }
                  className="btn-outline btn-sm"
                >
                  <KeyRound className="w-4 h-4" aria-hidden="true" />
                  পাসওয়ার্ড রিসেট
                </Link>
              </>
            ) : undefined
          }
        >
          {formError.message}
        </Alert>
      )}

      <div className="space-y-4">
        <Field htmlFor="request-name" label="পুরো নাম" error={errors.name}>
          <input
            id="request-name"
            name="name"
            type="text"
            autoComplete="name"
            autoCapitalize="words"
            maxLength={NAME_MAX + 20}
            placeholder="যেমন: নুসরাত জাহান"
            value={name}
            onChange={e => {
              setName(e.target.value)
              setFormError(null)
            }}
            onBlur={() => touch('name')}
            disabled={submitting}
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={describedBy('request-name', errors.name)}
            className="input-field"
          />
        </Field>

        <Field
          htmlFor="request-email"
          label="ইমেইল"
          error={errors.email}
          hint="অনুমোদন আর পাসওয়ার্ড এখানেই যাবে, তাই নিয়মিত দেখেন এমন ইমেইল দিন।"
        >
          <input
            id="request-email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            maxLength={254}
            placeholder="you@example.com"
            value={email}
            onChange={e => {
              setEmail(e.target.value)
              setFormError(null)
            }}
            onBlur={() => touch('email')}
            disabled={submitting}
            aria-invalid={errors.email ? true : undefined}
            aria-describedby={describedBy(
              'request-email',
              errors.email,
              'অনুমোদন আর পাসওয়ার্ড এখানেই যাবে, তাই নিয়মিত দেখেন এমন ইমেইল দিন।',
            )}
            className="input-field"
          />
        </Field>

        <Field htmlFor="request-phone" label="মোবাইল নম্বর" error={errors.phone} hint={phoneHint}>
          <input
            id="request-phone"
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            maxLength={20}
            placeholder="01XXXXXXXXX"
            value={phone}
            onChange={e => {
              setPhone(e.target.value)
              setFormError(null)
            }}
            onBlur={() => touch('phone')}
            disabled={submitting}
            aria-invalid={errors.phone ? true : undefined}
            aria-describedby={describedBy('request-phone', errors.phone, phoneHint)}
            className="input-field"
          />
        </Field>

        <Field
          htmlFor="request-note"
          label="প্রতিষ্ঠান / বিভাগ"
          optional
          hint="অ্যাডমিনকে আপনাকে চিনতে সাহায্য করে।"
        >
          <input
            id="request-note"
            name="organization"
            type="text"
            autoComplete="organization"
            maxLength={NOTE_MAX}
            placeholder="যেমন: ঢাকা বিশ্ববিদ্যালয়, CSE"
            value={note}
            onChange={e => setNote(e.target.value)}
            disabled={submitting}
            aria-describedby={describedBy('request-note', null, 'অ্যাডমিনকে আপনাকে চিনতে সাহায্য করে।')}
            className="input-field"
          />
        </Field>

        <div>
          <label
            htmlFor={agreeId}
            className={`flex items-start gap-3 rounded-lg p-2 -m-2 cursor-pointer text-[13px] leading-relaxed ${
              agreeError ? 'text-red-200' : 'text-slate-400'
            }`}
          >
            <span className="relative mt-0.5 w-5 h-5 flex-shrink-0">
              <input
                id={agreeId}
                type="checkbox"
                checked={agreed}
                onChange={e => setAgreed(e.target.checked)}
                disabled={submitting}
                aria-invalid={agreeError ? true : undefined}
                aria-describedby={agreeError ? `${agreeId}-error` : undefined}
                className={`peer block w-5 h-5 appearance-none rounded-md border bg-page cursor-pointer transition-colors
                            checked:bg-indigo-600 checked:border-indigo-600 hover:border-white/40 disabled:opacity-50 ${
                              agreeError ? 'border-red-400/70' : 'border-white/25'
                            }`}
              />
              <Check
                className="pointer-events-none absolute inset-0 m-auto w-3.5 h-3.5 text-[#fff] opacity-0 peer-checked:opacity-100"
                strokeWidth={3}
                aria-hidden="true"
              />
            </span>
            <span>
              আমি{' '}
              <Link href="/terms" target="_blank" rel="noopener noreferrer" className="text-indigo-300 hover:text-indigo-200 underline underline-offset-2">
                ব্যবহারের শর্তাবলি
              </Link>{' '}
              ও{' '}
              <Link href="/privacy" target="_blank" rel="noopener noreferrer" className="text-indigo-300 hover:text-indigo-200 underline underline-offset-2">
                প্রাইভেসি পলিসি
              </Link>{' '}
              মেনে নিচ্ছি, এবং শুধু ব্যক্তিগত বা পড়াশোনার কাজে ভিডিও ডাউনলোড করব।
            </span>
          </label>
          <div id={`${agreeId}-error`} aria-live="polite" className="empty:hidden">
            {agreeError && <p className="mt-2 text-xs text-red-400">{agreeError}</p>}
          </div>
        </div>
      </div>

      <button ref={submitRef} type="submit" className="btn-primary w-full mt-5" disabled={submitting}>
        {submitting ? (
          <>
            <Spinner size="sm" label={null} /> অনুরোধ পাঠানো হচ্ছে…
          </>
        ) : (
          <>
            অনুরোধ পাঠান <ArrowRight className="w-4 h-4" aria-hidden="true" />
          </>
        )}
      </button>
      <p aria-live="polite" className="empty:hidden mt-3 text-center text-xs text-slate-400">
        {slow ? 'সার্ভার চালু হচ্ছে। প্রথমবার এক মিনিট পর্যন্ত লাগতে পারে।' : ''}
      </p>
    </form>
  )
}

function RequestSuccessPanel({
  success,
  onSignIn,
  onStartOver,
}: {
  success: RequestSuccess
  onSignIn: () => void
  onStartOver: () => void
}) {
  const headingRef = useRef<HTMLHeadingElement>(null)
  const name = firstName(success.name)

  // Move focus to the confirmation so screen readers announce it.
  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  const steps: { title: string; body: ReactNode }[] = [
    {
      title: 'অ্যাডমিন আপনার অনুরোধ দেখবেন',
      body: 'প্রতিটি অনুরোধ হাতে যাচাই করা হয়, তাই কত সময় লাগবে তা অ্যাডমিনের ওপর নির্ভর করে।',
    },
    {
      title: 'ইমেইলে পাসওয়ার্ড পাবেন',
      body: (
        <>
          পাঠানো হবে <span className="text-slate-200 break-all">{success.email}</span> ঠিকানায়। না পেলে Spam বা
          Promotions ফোল্ডার দেখুন।
        </>
      ),
    },
    {
      title: 'সাইন ইন করে নিজের পাসওয়ার্ড সেট করুন',
      body: (
        <>
          ইমেইল বা <span className="text-slate-200 whitespace-nowrap">{formatPhone(success.phone)}</span> আর অস্থায়ী
          পাসওয়ার্ড দিয়ে সাইন ইন করুন, তারপর অ্যাকাউন্ট পেজে পাসওয়ার্ড বদলে নিন।
        </>
      ),
    },
  ]

  return (
    <div className="relative fade-up">
      <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center mb-4">
        <MailCheck className="w-6 h-6 text-emerald-400" aria-hidden="true" />
      </div>
      <h2 ref={headingRef} tabIndex={-1} className="text-xl font-bold text-white outline-none">
        অনুরোধ পাঠানো হয়েছে{name ? `, ${name}` : ''}!
      </h2>
      <p role="status" className="mt-1.5 text-sm text-slate-400">
        {translateServerText(success.message) || 'আপনার অনুরোধ অ্যাডমিনের অনুমোদনের অপেক্ষায় আছে।'}
      </p>

      <ol className="mt-5 space-y-4">
        {steps.map((step, index) => (
          <li key={step.title} className="flex gap-3">
            <span
              className="w-7 h-7 flex-shrink-0 rounded-full bg-indigo-500/15 border border-indigo-500/30 text-indigo-200 text-[13px] font-bold flex items-center justify-center"
              aria-hidden="true"
            >
              {index + 1}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-white">{step.title}</p>
              <p className="mt-0.5 text-[13px] leading-relaxed text-slate-400">{step.body}</p>
            </div>
          </li>
        ))}
      </ol>

      <p className="mt-5 rounded-lg bg-white/[0.03] border border-white/[0.06] px-3.5 py-3 text-[12.5px] leading-relaxed text-slate-400">
        অনুমোদন না হওয়া পর্যন্ত সাইন ইন করলে দেখাবে যে অ্যাকাউন্ট অনুমোদনের অপেক্ষায় আছে। এটাই স্বাভাবিক — নতুন
        করে অনুরোধ পাঠানোর দরকার নেই।
      </p>

      <div className="mt-5 grid gap-2.5">
        <button type="button" onClick={onSignIn} className="btn-primary w-full">
          <LogIn className="w-4 h-4" aria-hidden="true" />
          সাইন ইন করতে যান
        </button>
        <button type="button" onClick={onStartOver} className="btn-ghost w-full">
          অন্য কারও জন্য অনুরোধ করুন
        </button>
      </div>
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// Marketing sections
// ═════════════════════════════════════════════════════════════════════════════

function SectionHeading({ id, eyebrow, title, intro }: { id: string; eyebrow: string; title: string; intro?: ReactNode }) {
  return (
    <div className="max-w-2xl mb-8 sm:mb-10">
      <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-sky-400">{eyebrow}</p>
      <h2 id={id} className="mt-2 text-2xl sm:text-3xl font-bold text-white">
        {title}
      </h2>
      {intro && <p className="mt-3 text-[15px] leading-relaxed text-slate-400">{intro}</p>}
    </div>
  )
}

const PLATFORM_CARDS: { name: string; Icon: LucideIcon; tone: string; ring: string; what: string; detail: string }[] = [
  {
    name: 'YouTube',
    Icon: Youtube,
    tone: 'text-red-400',
    ring: 'bg-red-500/10 border-red-500/20',
    what: 'লেকচার, টিউটোরিয়াল, Shorts',
    detail: 'ডেটা বাঁচানো 360p থেকে 4K Ultra HD পর্যন্ত যেকোনো কোয়ালিটি, অথবা শুধু অডিও MP3 হিসেবে।',
  },
  {
    name: 'Facebook',
    Icon: Facebook,
    tone: 'text-blue-400',
    ring: 'bg-blue-500/10 border-blue-500/20',
    what: 'পাবলিক ভিডিও ও Reels',
    detail: 'Share বাটন থেকে লিংক কপি করে পেস্ট করুন। পাবলিকলি শেয়ার করা ভিডিও ও Reels-এ কাজ করে।',
  },
  {
    name: 'Instagram',
    Icon: Instagram,
    tone: 'text-pink-400',
    ring: 'bg-pink-500/10 border-pink-500/20',
    what: 'পাবলিক Reels ও ভিডিও পোস্ট',
    detail: 'পোস্ট বা Reel-এর লিংক কপি করে পেস্ট করুন। শুধু পাবলিক অ্যাকাউন্টের ভিডিও।',
  },
]

function PlatformsSection() {
  return (
    <section aria-labelledby="platforms-title" className="border-t border-white/[0.05]">
      <div className="max-w-7xl mx-auto px-4 sm:px-8 py-14 sm:py-20">
        <SectionHeading
          id="platforms-title"
          eyebrow="যেসব প্ল্যাটফর্ম চলে"
          title="আপনার চেনা প্ল্যাটফর্ম থেকেই ডাউনলোড"
          intro="এগুলোর যেকোনোটির লিংক পেস্ট করুন, তারপর আপনার ডিভাইস আর ডেটা প্ল্যান অনুযায়ী কোয়ালিটি বেছে নিন।"
        />
        <ul className="grid gap-4 md:grid-cols-3">
          {PLATFORM_CARDS.map(({ name, Icon, tone, ring, what, detail }) => (
            <li key={name} className="feature-card flex flex-col">
              <div className="flex items-center gap-3">
                <span className={`w-11 h-11 rounded-xl border flex items-center justify-center ${ring}`}>
                  <Icon className={`w-5 h-5 ${tone}`} aria-hidden="true" />
                </span>
                <div>
                  <h3 className="text-base font-semibold text-white">{name}</h3>
                  <p className="text-[13px] text-slate-400">{what}</p>
                </div>
              </div>
              <p className="mt-4 text-[14px] leading-relaxed text-slate-400">{detail}</p>
            </li>
          ))}
        </ul>
        <p className="mt-5 text-[13px] text-slate-500">
          প্রাইভেট, মেম্বারশিপ-অনলি ও বয়সসীমা দেওয়া ভিডিও কাজ নাও করতে পারে। অন্য সাইট এখনো চালু হয়নি।
        </p>
      </div>
    </section>
  )
}

function HowItWorksSection({ onRequestAccess }: { onRequestAccess: () => void }) {
  const steps: { Icon: LucideIcon; title: string; body: string }[] = [
    {
      Icon: UserPlus,
      title: 'অ্যাক্সেসের অনুরোধ করুন',
      body: 'নাম, ইমেইল আর মোবাইল নম্বর দিন। এক মিনিটও লাগে না।',
    },
    {
      Icon: MailCheck,
      title: 'ইমেইলে পাসওয়ার্ড পান',
      body: 'অ্যাডমিন অনুমোদন দিলে ইমেইলে একটি অস্থায়ী পাসওয়ার্ড পাঠানো হবে। ইনবক্সে না পেলে Spam ফোল্ডার দেখুন।',
    },
    {
      Icon: ClipboardPaste,
      title: 'লিংক পেস্ট করে ডাউনলোড করুন',
      body: 'কোয়ালিটি বেছে নিয়ে ডিভাইসে সেভ করুন। অ্যাকাউন্ট অনুযায়ী প্রতিদিন আনলিমিটেড ডাউনলোড।',
    },
  ]
  return (
    <section aria-labelledby="how-title" className="border-t border-white/[0.05] bg-white/[0.012]">
      <div className="max-w-7xl mx-auto px-4 sm:px-8 py-14 sm:py-20">
        <SectionHeading id="how-title" eyebrow="কীভাবে কাজ করে" title="তিন ধাপে সাইন আপ থেকে ভিডিও সেভ" />
        <ol className="grid gap-4 md:grid-cols-3">
          {steps.map(({ Icon, title, body }, index) => (
            <li key={title} className="relative feature-card">
              <div className="flex items-center gap-3">
                <span
                  className="w-8 h-8 rounded-full bg-indigo-600 text-[#fff] text-sm font-bold flex items-center justify-center"
                  style={{ fontFamily: 'var(--font-display)' }}
                  aria-hidden="true"
                >
                  {index + 1}
                </span>
                <Icon className="w-5 h-5 text-indigo-300" aria-hidden="true" />
              </div>
              <h3 className="mt-4 text-base font-semibold text-white">
                <span className="sr-only">ধাপ {index + 1}: </span>
                {title}
              </h3>
              <p className="mt-1.5 text-[14px] leading-relaxed text-slate-400">{body}</p>
            </li>
          ))}
        </ol>
        <div className="mt-8">
          <button type="button" onClick={onRequestAccess} className="btn-primary w-full sm:w-auto">
            অ্যাক্সেসের অনুরোধ করুন <ArrowRight className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </section>
  )
}

function FeaturesSection() {
  const features: { Icon: LucideIcon; title: string; body: string; tone: string }[] = [
    {
      Icon: SlidersHorizontal,
      title: 'নিজের মতো কোয়ালিটি',
      body: 'বড় স্ক্রিনের জন্য 4K Ultra HD, মোবাইল ডেটা বাঁচাতে ছোট ফাইল, অথবা শুধু শোনার জন্য লেকচারের অডিও (MP3)।',
      tone: 'text-sky-300 bg-sky-500/10 border-sky-500/20',
    },
    {
      Icon: Gauge,
      title: 'প্রতিদিন আনলিমিটেড ডাউনলোড',
      body: 'অনুমোদিত শিক্ষার্থীরা অ্যাকাউন্ট অনুযায়ী প্রতিদিন আনলিমিটেড ডাউনলোড পান। শুধু সম্পূর্ণ ডাউনলোডই গোনা হয়।',
      tone: 'text-indigo-300 bg-indigo-500/10 border-indigo-500/20',
    },
    {
      Icon: ShieldCheck,
      title: 'প্রাইভেসি সবার আগে',
      body: 'সার্ভিস চালাতে যা দরকার শুধু সেটুকুই রাখি। পাসওয়ার্ড নিরাপদ hash হিসেবে রাখা হয় — অ্যাডমিনও তা দেখতে পারেন না।',
      tone: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20',
    },
    {
      Icon: MonitorSmartphone,
      title: 'ফোনের জন্যই বানানো',
      body: 'ফোন, ট্যাবলেট বা ল্যাপটপের যেকোনো আধুনিক ব্রাউজারে চলে। কিছু ইনস্টল করতে হয় না, কোনো বিজ্ঞাপন নেই।',
      tone: 'text-violet-300 bg-violet-500/10 border-violet-500/20',
    },
  ]
  return (
    <section aria-labelledby="features-title" className="border-t border-white/[0.05]">
      <div className="max-w-7xl mx-auto px-4 sm:px-8 py-14 sm:py-20">
        <SectionHeading id="features-title" eyebrow="কেন UniStream Saver" title="শিক্ষার্থীদের জন্য, একদম সহজ" />
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {features.map(({ Icon, title, body, tone }) => (
            <li key={title} className="feature-card">
              <span className={`w-10 h-10 rounded-xl border flex items-center justify-center ${tone}`}>
                <Icon className="w-5 h-5" aria-hidden="true" />
              </span>
              <h3 className="mt-4 text-[15px] font-semibold text-white">{title}</h3>
              <p className="mt-1.5 text-[14px] leading-relaxed text-slate-400">{body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

// ── FAQ ───────────────────────────────────────────────────────────────────────

const linkClass = 'text-indigo-300 hover:text-indigo-200 underline underline-offset-2'

function FaqSection({ onOpenAuth }: { onOpenAuth: (tab: AuthTab) => void }) {
  const inlineButton = (label: string, tab: AuthTab) => (
    <button type="button" onClick={() => onOpenAuth(tab)} className={`${linkClass} font-medium`}>
      {label}
    </button>
  )

  const faqs: { id: string; q: string; a: ReactNode }[] = [
    {
      id: 'faq-who',
      q: 'কারা UniStream Saver ব্যবহার করতে পারবেন?',
      a: (
        <>
          আপাতত শিক্ষার্থীদের জন্য চালু করা হয়েছে। নাম, ইমেইল আর মোবাইল নম্বর দিয়ে{' '}
          {inlineButton('অ্যাক্সেসের অনুরোধ করুন', 'request')}। সবার জন্য সার্ভিস দ্রুত আর ন্যায্য রাখতে অ্যাডমিন প্রতিটি অনুরোধ অনুমোদন করেন।
        </>
      ),
    },
    {
      id: 'faq-approval',
      q: 'অনুমোদন পেতে কত সময় লাগে?',
      a: (
        <>
          অ্যাডমিন প্রতিটি অনুরোধ হাতে দেখেন, তাই আপনার অনুরোধে কখন পৌঁছাবেন তার ওপর নির্ভর করে। নতুন করে অনুরোধ
          পাঠানোর দরকার নেই: অনুমোদন হলেই ইমেইলে অস্থায়ী পাসওয়ার্ড পাঠানো হবে। ততক্ষণ সাইন ইন করলে দেখাবে যে
          অ্যাকাউন্ট অনুমোদনের অপেক্ষায় আছে।
        </>
      ),
    },
    {
      id: 'faq-password',
      q: 'অনুমোদন পেয়েছি। পাসওয়ার্ড কোথায়?',
      a: (
        <>
          রেজিস্ট্রেশনের ইমেইল ঠিকানায় পাঠানো মেইলেই আছে। ইনবক্সে না পেলে Spam বা Promotions ফোল্ডার দেখুন। ইমেইল
          বা মোবাইল নম্বর আর ওই পাসওয়ার্ড দিয়ে সাইন ইন করুন, তারপর{' '}
          <Link href="/account" className={linkClass}>
            অ্যাকাউন্ট
          </Link>{' '}
          পেজে নিজের পাসওয়ার্ড সেট করুন। তবুও খুঁজে না পেলে{' '}
          <Link href="/forgot-password" className={linkClass}>
            পাসওয়ার্ড ভুলে গেছেন?
          </Link>{' '}
          থেকে নতুন লিংক নিন।
        </>
      ),
    },
    {
      id: 'faq-limit',
      q: 'কতগুলো ভিডিও ডাউনলোড করতে পারব?',
      a: (
        <>
          অ্যাকাউন্ট অনুযায়ী প্রতিদিন <strong className="text-slate-200">আনলিমিটেড ডাউনলোড</strong>। আপনার
          অ্যাকাউন্টে দৈনিক সীমা থাকলে তা বাংলাদেশ সময় রাত ১২টায় নতুন করে শুরু হয়। শুধু সম্পূর্ণ ডাউনলোড গোনা হয়:
          লিংক দেখা, বাতিল করা বা ব্যর্থ ডাউনলোড গোনা হয় না। আপনার সীমা সবসময় ডাউনলোড পেজের ওপরে দেখা যায়।
        </>
      ),
    },
    {
      id: 'faq-quality',
      q: 'কোন সাইট আর কোন কোয়ালিটি চলে?',
      a: (
        <>
          YouTube, Facebook ও Instagram — ভিডিওতে যা আছে তার মধ্যে{' '}
          <strong className="text-slate-200">4K Ultra HD</strong> পর্যন্ত যেকোনো কোয়ালিটি, অথবা শুধু অডিও MP3
          হিসেবে। প্রাইভেট, মেম্বারশিপ-অনলি ও বয়সসীমা দেওয়া ভিডিও কাজ নাও করতে পারে।
        </>
      ),
    },
    {
      id: 'faq-forgot',
      q: 'পাসওয়ার্ড ভুলে গেছি। এখন কী করব?',
      a: (
        <>
          সাইন ইন ফর্মে <strong className="text-slate-200">পাসওয়ার্ড ভুলে গেছেন?</strong> চাপুন আর ইমেইল দিন।
          ৬০ মিনিট কার্যকর একটি রিসেট লিংক পাঠানো হবে (না দেখলে Spam ফোল্ডার দেখুন)। নতুন পাসওয়ার্ড সেট করলেই সরাসরি
          সাইন ইন হয়ে যাবেন।
        </>
      ),
    },
    {
      id: 'faq-premium',
      q: 'এটা কি ফ্রি? পেইড প্ল্যান আসবে?',
      a: (
        <>
          হ্যাঁ, অনুমোদিত শিক্ষার্থীদের জন্য ফ্রি, অ্যাকাউন্ট অনুযায়ী প্রতিদিন আনলিমিটেড ডাউনলোড। কখনো পেইড প্ল্যান
          এলে তা হবে ঐচ্ছিক, আর আপনার স্পষ্ট সম্মতি ছাড়া কোনো টাকা নেওয়া হবে না।
        </>
      ),
    },
    {
      id: 'faq-use',
      q: 'কী ধরনের ভিডিও ডাউনলোড করা যাবে?',
      a: (
        <>
          নিজের ব্যক্তিগত বা পড়াশোনার কাজের ভিডিও, যেমন অফলাইনে পড়ার জন্য। কপিরাইট আর প্রতিটি প্ল্যাটফর্মের নিয়ম
          মেনে চলুন: অন্যের ভিডিও আবার আপলোড, শেয়ার বা বিক্রি করবেন না। বিস্তারিত জানতে{' '}
          <Link href="/terms" className={linkClass}>
            ব্যবহারের শর্তাবলি
          </Link>{' '}
          পড়ুন।
        </>
      ),
    },
    {
      id: 'faq-help',
      q: 'কিছু বুঝতে না পারলে কার সাথে যোগাযোগ করব?',
      a: (
        <>
          WhatsApp-এ <strong className="text-slate-200">{CONTACT.whatsapp}</strong> নম্বরে মেসেজ দিন, অথবা{' '}
          <a href={CONTACT_MAILTO} className={linkClass}>
            {CONTACT.email}
          </a>{' '}
          ঠিকানায় ইমেইল করুন। পেজের একদম নিচে{' '}
          <a href="#contact" className={linkClass}>
            যোগাযোগ
          </a>{' '}
          অংশেও তথ্য দেওয়া আছে।
        </>
      ),
    },
    {
      id: 'faq-data',
      q: 'আমার তথ্য দিয়ে কী করা হয়?',
      a: (
        <>
          অ্যাকাউন্ট চালানো, অ্যাকাউন্টের ইমেইল পাঠানো আর দৈনিক সীমা প্রয়োগের জন্য আপনার নাম, ইমেইল, মোবাইল নম্বর
          ও ডাউনলোড হিস্টোরি রাখা হয়। আপনার তথ্য বিক্রি করা হয় না, মার্কেটিং ইমেইলও পাঠানো হয় না। বিস্তারিত দেখুন{' '}
          <Link href="/privacy" className={linkClass}>
            প্রাইভেসি পলিসি
          </Link>
          -তে।
        </>
      ),
    },
  ]

  return (
    <section id="faq" aria-labelledby="faq-title" className="border-t border-white/[0.05] bg-white/[0.012] scroll-mt-14">
      <div className="max-w-3xl mx-auto px-4 sm:px-8 py-14 sm:py-20">
        <SectionHeading id="faq-title" eyebrow="সাহায্য ও প্রশ্নোত্তর" title="আপনার প্রশ্নের উত্তর" />
        <div className="space-y-2.5">
          {faqs.map(item => (
            <details
              key={item.id}
              id={item.id}
              className="group rounded-xl border border-white/[0.07] bg-white/[0.02] open:bg-white/[0.035] open:border-white/[0.1] transition-colors scroll-mt-20"
            >
              <summary className="flex items-center justify-between gap-4 cursor-pointer list-none [&::-webkit-details-marker]:hidden px-4 sm:px-5 py-4 min-h-12 rounded-xl text-[15px] font-semibold text-slate-100 hover:text-white">
                {item.q}
                <ChevronDown
                  className="w-5 h-5 flex-shrink-0 text-slate-500 transition-transform group-open:rotate-180"
                  aria-hidden="true"
                />
              </summary>
              <div className="px-4 sm:px-5 pb-5 -mt-1 text-[14px] leading-relaxed text-slate-400">{item.a}</div>
            </details>
          ))}
        </div>
      </div>
    </section>
  )
}

function CtaSection({ onOpenAuth }: { onOpenAuth: (tab: AuthTab) => void }) {
  return (
    <section aria-labelledby="cta-title" className="border-t border-white/[0.05]">
      <div className="max-w-7xl mx-auto px-4 sm:px-8 py-14 sm:py-20">
        <div className="portal-card px-5 py-8 sm:px-10 sm:py-12 text-center">
          <h2 id="cta-title" className="relative text-2xl sm:text-3xl font-bold text-white">
            প্রথম ভিডিও সেভ করতে প্রস্তুত?
          </h2>
          <p className="relative mt-3 text-[15px] text-slate-400 max-w-xl mx-auto">
            এক মিনিটেরও কম সময়ে অনুরোধ করুন। অনুমোদন হলেই ইমেইল পাবেন।
          </p>
          <div className="relative mt-7 flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3">
            <button type="button" onClick={() => onOpenAuth('request')} className="btn-primary">
              <UserPlus className="w-4 h-4" aria-hidden="true" />
              অ্যাক্সেসের অনুরোধ করুন
            </button>
            <button type="button" onClick={() => onOpenAuth('signin')} className="btn-secondary">
              <LogIn className="w-4 h-4" aria-hidden="true" />
              সাইন ইন
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}

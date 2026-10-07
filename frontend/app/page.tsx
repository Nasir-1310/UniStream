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
import { Alert, Field, PasswordInput, Spinner, describedBy, useToast } from '@/components/ui'
import { apiErrorMessage, apiErrorStatus, login, register, warmBackend, type PublicUser } from '@/lib/api'
import { useSession } from '@/lib/auth'
import { formatPhone } from '@/lib/format'
import { classifyLogin, errorOf, validateEmail, validateName, validatePhone, NAME_MAX } from '@/lib/validation'

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
    <div className="min-h-svh flex flex-col bg-[#0d0f1a]">
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
                Free for approved students
              </p>
              <h1
                id="hero-title"
                className="text-[1.875rem] leading-[1.1] sm:text-5xl lg:text-[3.4rem] font-extrabold text-white max-w-2xl"
                style={{ letterSpacing: '-0.025em' }}
              >
                Save YouTube, Facebook and Instagram videos{' '}
                <span className="bg-gradient-to-r from-sky-400 via-indigo-400 to-violet-400 bg-clip-text text-transparent">
                  in up to 1080p HD.
                </span>
              </h1>
              <p className="mt-3 sm:mt-5 text-[15px] sm:text-base leading-relaxed text-slate-400 max-w-xl">
                Simple and fast: paste a link, choose a quality and download. Free for approved students, with 4
                downloads a day.
              </p>
              <p className="mt-3 inline-flex items-start gap-2 text-[13px] sm:text-sm leading-relaxed text-violet-200/90">
                <Sparkles className="w-4 h-4 mt-px flex-shrink-0 text-violet-300" aria-hidden="true" />
                <span>Premium with unlimited downloads is coming soon.</span>
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
                  '4 free downloads a day',
                  'Up to 1080p HD, or audio only (MP3)',
                  'Works in your phone’s browser',
                  'No ads, no app to install',
                ].map(item => (
                  <li key={item} className="flex items-start gap-2.5">
                    <CheckCircle2 className="w-4 h-4 mt-[3px] flex-shrink-0 text-emerald-400" aria-hidden="true" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-6 flex flex-wrap items-center gap-2">
                <span className="text-[12px] text-slate-500 mr-1">Works with</span>
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
        style={{ background: 'radial-gradient(ellipse, rgba(79,70,229,0.13) 0%, transparent 65%)' }}
      />
      <div
        className="absolute top-[12%] -right-24 w-[420px] h-[420px] rounded-full"
        style={{ background: 'radial-gradient(circle, rgba(56,189,248,0.07) 0%, transparent 65%)' }}
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
  { id: 'signin', label: 'Sign in', Icon: LogIn },
  { id: 'request', label: 'Request access', Icon: UserPlus },
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
        aria-label="Sign in or request access"
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
                  ? 'bg-indigo-500/90 text-white shadow-sm shadow-indigo-900/40'
                  : 'text-slate-400 hover:text-white hover:bg-white/[0.05]'
              }`}
              style={{ fontFamily: "'Space Grotesk', sans-serif" }}
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
    <Alert tone="warning" title="Your session has ended" onDismiss={() => setDismissed(true)} className="mb-5">
      For your security you&apos;ve been signed out. Please sign in again to continue.
    </Alert>
  )
}

function SignedInPanel({ user, redirecting }: { user: PublicUser; redirecting: boolean }) {
  const name = firstName(user.name)
  if (redirecting) {
    return (
      <div className="flex flex-col items-center text-center py-6 gap-3" role="status">
        <Spinner size="lg" label={null} className="text-indigo-400" />
        <p className="text-sm text-slate-300">Signed in — taking you to your downloads…</p>
        <Link href="/download" className="text-[13px] text-indigo-300 hover:text-indigo-200 underline underline-offset-4">
          Continue now
        </Link>
      </div>
    )
  }
  return (
    <div className="relative">
      <div className="w-11 h-11 rounded-xl bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center mb-4">
        <CheckCircle2 className="w-5 h-5 text-emerald-400" aria-hidden="true" />
      </div>
      <h2 className="text-xl font-bold text-white">{name ? `Welcome back, ${name}` : 'You’re signed in'}</h2>
      <p className="mt-1.5 text-sm text-slate-400">
        Signed in as <span className="text-slate-200">{user.email || formatPhone(user.phone)}</span>.
      </p>
      <div className="mt-6 grid gap-2.5 sm:grid-cols-2">
        <Link href="/download" className="btn-primary">
          <Download className="w-4 h-4" aria-hidden="true" />
          Download videos
        </Link>
        <Link href="/account" className="btn-secondary">
          Account
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
  const loginError = (submitted || (loginTouched && value.trim())) && !loginCheck.ok ? loginCheck.error : null
  const passwordError = submitted && !password ? 'Please enter your password.' : null
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
        toast.warning('You’re using a temporary password', {
          description: 'Set your own password to keep your account safe.',
          duration: 12000,
          action: { label: 'Change now', onClick: () => router.push('/account#password') },
        })
      } else {
        toast.success(name ? `Welcome back, ${name}!` : 'Welcome back!')
      }
      router.replace('/download')
    } catch (err) {
      const status = apiErrorStatus(err)
      setFormError({ message: apiErrorMessage(err, 'Sign in failed. Please try again.'), status })
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
  const needsPassword = formError ? /password yet|forgot password/i.test(formError.message) : false
  const errorTone = formError?.status === 403 || formError?.status === 429 ? 'warning' : 'danger'

  return (
    <form onSubmit={onSubmit} noValidate className="relative" aria-describedby="signin-intro">
      <h2 className="text-lg sm:text-xl font-bold text-white">Welcome back</h2>
      <p id="signin-intro" className="mt-1 mb-5 text-[13px] sm:text-sm text-slate-400">
        Sign in with the email or phone number you registered with.
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
                Set a password
              </Link>
            ) : undefined
          }
        >
          {formError.message}
        </Alert>
      )}

      <div className="space-y-4">
        <Field htmlFor="signin-login" label="Email or phone number" error={loginError}>
          <input
            id="signin-login"
            name="login"
            type="text"
            inputMode="text"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="you@example.com or 01XXXXXXXXX"
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
          label="Password"
          labelAside={
            <Link
              href={forgotHref}
              className="text-[13px] font-medium text-indigo-300 hover:text-indigo-200 rounded py-1"
            >
              Forgot password?
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
            <Spinner size="sm" label={null} /> Signing in…
          </>
        ) : (
          <>
            Sign in <ArrowRight className="w-4 h-4" aria-hidden="true" />
          </>
        )}
      </button>
      <p aria-live="polite" className="empty:hidden mt-3 text-center text-xs text-slate-400">
        {slow ? 'The server is waking up. The first sign-in of the day can take up to a minute.' : ''}
      </p>

      <p className="mt-5 pt-4 border-t border-white/[0.06] text-center text-[13px] text-slate-400">
        New here?{' '}
        <button
          type="button"
          onClick={onRequestAccess}
          className="font-semibold text-indigo-300 hover:text-indigo-200 underline-offset-4 hover:underline py-2"
        >
          Request access — it&apos;s free
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
    name: show('name') ? errorOf(checks.name) : null,
    email: show('email') ? errorOf(checks.email) : null,
    phone: show('phone') ? errorOf(checks.phone) : null,
  }
  const agreeError = submitted && !agreed ? 'Please accept the Terms of Use and Privacy Policy to continue.' : null
  const phoneHint = checks.phone.ok
    ? `We'll save it as ${formatPhone(checks.phone.value)}.`
    : 'Bangladeshi mobile, e.g. 01712-345678. Outside Bangladesh? Start with + and your country code.'

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
        message: apiErrorMessage(err, 'We couldn’t send your request. Please try again.'),
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
    /phone/i.test(formError?.message ?? '') && checks.phone.ok
      ? checks.phone.value
      : checks.email.ok
      ? checks.email.value
      : ''

  return (
    <form onSubmit={onSubmit} noValidate className="relative" aria-describedby="request-intro">
      <h2 className="text-lg sm:text-xl font-bold text-white">Request access</h2>
      <p id="request-intro" className="mt-1 mb-5 text-[13px] sm:text-sm text-slate-400">
        Free for students. Once an admin approves you, we email you a password.
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
                  Sign in
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
                  Reset password
                </Link>
              </>
            ) : undefined
          }
        >
          {formError.message}
        </Alert>
      )}

      <div className="space-y-4">
        <Field htmlFor="request-name" label="Full name" error={errors.name}>
          <input
            id="request-name"
            name="name"
            type="text"
            autoComplete="name"
            autoCapitalize="words"
            maxLength={NAME_MAX + 20}
            placeholder="e.g. Nusrat Jahan"
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
          label="Email"
          error={errors.email}
          hint="Your approval and password are sent here, so use an inbox you check."
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
              'Your approval and password are sent here, so use an inbox you check.',
            )}
            className="input-field"
          />
        </Field>

        <Field htmlFor="request-phone" label="Mobile number" error={errors.phone} hint={phoneHint}>
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
          label="Institution / department"
          optional
          hint="Helps the admin recognise you."
        >
          <input
            id="request-note"
            name="organization"
            type="text"
            autoComplete="organization"
            maxLength={NOTE_MAX}
            placeholder="e.g. University of Dhaka, CSE"
            value={note}
            onChange={e => setNote(e.target.value)}
            disabled={submitting}
            aria-describedby={describedBy('request-note', null, 'Helps the admin recognise you.')}
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
                className={`peer block w-5 h-5 appearance-none rounded-md border bg-[#0d0f1a] cursor-pointer transition-colors
                            checked:bg-indigo-500 checked:border-indigo-500 hover:border-white/40 disabled:opacity-50 ${
                              agreeError ? 'border-red-400/70' : 'border-white/25'
                            }`}
              />
              <Check
                className="pointer-events-none absolute inset-0 m-auto w-3.5 h-3.5 text-white opacity-0 peer-checked:opacity-100"
                strokeWidth={3}
                aria-hidden="true"
              />
            </span>
            <span>
              I agree to the{' '}
              <Link href="/terms" target="_blank" rel="noopener noreferrer" className="text-indigo-300 hover:text-indigo-200 underline underline-offset-2">
                Terms of Use
              </Link>{' '}
              and{' '}
              <Link href="/privacy" target="_blank" rel="noopener noreferrer" className="text-indigo-300 hover:text-indigo-200 underline underline-offset-2">
                Privacy Policy
              </Link>
              , and will only download videos for personal or educational use.
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
            <Spinner size="sm" label={null} /> Sending request…
          </>
        ) : (
          <>
            Request access <ArrowRight className="w-4 h-4" aria-hidden="true" />
          </>
        )}
      </button>
      <p aria-live="polite" className="empty:hidden mt-3 text-center text-xs text-slate-400">
        {slow ? 'The server is waking up. This can take up to a minute the first time.' : ''}
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
      title: 'An admin reviews your request',
      body: 'Every request is checked by hand, so how long it takes depends on the admin.',
    },
    {
      title: 'You get an email with your password',
      body: (
        <>
          We&apos;ll send it to <span className="text-slate-200 break-all">{success.email}</span>. Check your Spam or
          Promotions folder if it doesn&apos;t arrive.
        </>
      ),
    },
    {
      title: 'Sign in and set your own password',
      body: (
        <>
          Use your email or <span className="text-slate-200 whitespace-nowrap">{formatPhone(success.phone)}</span> with
          the temporary password, then change it on your Account page.
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
        Request sent{name ? `, ${name}` : ''}!
      </h2>
      <p role="status" className="mt-1.5 text-sm text-slate-400">
        {success.message || 'Your request is waiting for admin approval.'}
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
        Until you&apos;re approved, signing in will say your account is waiting for approval. That&apos;s expected —
        no need to send another request.
      </p>

      <div className="mt-5 grid gap-2.5">
        <button type="button" onClick={onSignIn} className="btn-primary w-full">
          <LogIn className="w-4 h-4" aria-hidden="true" />
          Go to sign in
        </button>
        <button type="button" onClick={onStartOver} className="btn-ghost w-full">
          Request access for someone else
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
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sky-400">{eyebrow}</p>
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
    what: 'Lectures, tutorials, Shorts',
    detail: 'Choose anything from data-saving 360p up to 1080p Full HD, or save just the audio as an MP3.',
  },
  {
    name: 'Facebook',
    Icon: Facebook,
    tone: 'text-blue-400',
    ring: 'bg-blue-500/10 border-blue-500/20',
    what: 'Public videos and Reels',
    detail: 'Paste the link from the Share button. Works with videos and Reels that are shared publicly.',
  },
  {
    name: 'Instagram',
    Icon: Instagram,
    tone: 'text-pink-400',
    ring: 'bg-pink-500/10 border-pink-500/20',
    what: 'Public Reels and video posts',
    detail: 'Copy the post or Reel link and paste it in. Videos from public accounts only.',
  },
]

function PlatformsSection() {
  return (
    <section aria-labelledby="platforms-title" className="border-t border-white/[0.05]">
      <div className="max-w-7xl mx-auto px-4 sm:px-8 py-14 sm:py-20">
        <SectionHeading
          id="platforms-title"
          eyebrow="Supported platforms"
          title="Download from the platforms you already use"
          intro="Paste a link from any of these and choose the quality that suits your device and data plan."
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
          Private, members-only and age-restricted videos may not work. Other sites aren&apos;t supported yet.
        </p>
      </div>
    </section>
  )
}

function HowItWorksSection({ onRequestAccess }: { onRequestAccess: () => void }) {
  const steps: { Icon: LucideIcon; title: string; body: string }[] = [
    {
      Icon: UserPlus,
      title: 'Request access',
      body: 'Tell us your name, email and mobile number. It takes less than a minute.',
    },
    {
      Icon: MailCheck,
      title: 'Get your password by email',
      body: 'When an admin approves you, we email you a temporary password. Not in your inbox? Check your spam folder.',
    },
    {
      Icon: ClipboardPaste,
      title: 'Paste a link and download',
      body: 'Choose a quality and save it to your device. You get 4 downloads a day, reset at midnight Bangladesh time.',
    },
  ]
  return (
    <section aria-labelledby="how-title" className="border-t border-white/[0.05] bg-white/[0.012]">
      <div className="max-w-7xl mx-auto px-4 sm:px-8 py-14 sm:py-20">
        <SectionHeading id="how-title" eyebrow="How it works" title="From sign-up to saved video in three steps" />
        <ol className="grid gap-4 md:grid-cols-3">
          {steps.map(({ Icon, title, body }, index) => (
            <li key={title} className="relative feature-card">
              <div className="flex items-center gap-3">
                <span
                  className="w-8 h-8 rounded-full bg-indigo-500 text-white text-sm font-bold flex items-center justify-center"
                  style={{ fontFamily: "'Space Grotesk', sans-serif" }}
                  aria-hidden="true"
                >
                  {index + 1}
                </span>
                <Icon className="w-5 h-5 text-indigo-300" aria-hidden="true" />
              </div>
              <h3 className="mt-4 text-base font-semibold text-white">
                <span className="sr-only">Step {index + 1}: </span>
                {title}
              </h3>
              <p className="mt-1.5 text-[14px] leading-relaxed text-slate-400">{body}</p>
            </li>
          ))}
        </ol>
        <div className="mt-8">
          <button type="button" onClick={onRequestAccess} className="btn-primary w-full sm:w-auto">
            Request access <ArrowRight className="w-4 h-4" aria-hidden="true" />
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
      title: 'Choose your quality',
      body: 'Up to 1080p Full HD for a laptop, a small file to save mobile data, or audio only (MP3) for lectures you just want to hear.',
      tone: 'text-sky-300 bg-sky-500/10 border-sky-500/20',
    },
    {
      Icon: Gauge,
      title: 'A fair daily allowance',
      body: 'Approved students get 4 downloads a day. Only finished downloads count, and premium with unlimited downloads is coming soon.',
      tone: 'text-indigo-300 bg-indigo-500/10 border-indigo-500/20',
    },
    {
      Icon: ShieldCheck,
      title: 'Private by design',
      body: 'We keep only what the service needs. Passwords are stored as secure hashes, so no one, not even the admin, can read them.',
      tone: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20',
    },
    {
      Icon: MonitorSmartphone,
      title: 'Made for phones first',
      body: 'Works in any modern browser on your phone, tablet or laptop. Nothing to install, no ads.',
      tone: 'text-violet-300 bg-violet-500/10 border-violet-500/20',
    },
  ]
  return (
    <section aria-labelledby="features-title" className="border-t border-white/[0.05]">
      <div className="max-w-7xl mx-auto px-4 sm:px-8 py-14 sm:py-20">
        <SectionHeading id="features-title" eyebrow="Why UniStream Saver" title="Built for students, kept simple" />
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
      q: 'Who can use UniStream Saver?',
      a: (
        <>
          We&apos;re opening to students first. {inlineButton('Request access', 'request')} with your name, email and
          mobile number, and an admin approves each request so the service stays fast and fair for everyone.
        </>
      ),
    },
    {
      id: 'faq-approval',
      q: 'How long does approval take?',
      a: (
        <>
          The admin reviews every request by hand, so it depends on when they get to yours. You don&apos;t need to send
          another request: when you&apos;re approved, we email you a temporary password. Until then, signing in shows
          that your account is waiting for approval.
        </>
      ),
    },
    {
      id: 'faq-password',
      q: 'I was approved. Where is my password?',
      a: (
        <>
          It&apos;s in the email we sent to the address you registered with. If it isn&apos;t in your inbox, check your
          spam or promotions folder. Sign in with your email or mobile number and that password, then set your own
          password on the{' '}
          <Link href="/account" className={linkClass}>
            Account
          </Link>{' '}
          page. Still can&apos;t find it? Use{' '}
          <Link href="/forgot-password" className={linkClass}>
            Forgot password?
          </Link>{' '}
          to get a new link.
        </>
      ),
    },
    {
      id: 'faq-limit',
      q: 'How many videos can I download?',
      a: (
        <>
          Each account can download <strong className="text-slate-200">4 videos a day</strong>. The count resets at
          midnight Bangladesh time. Only finished downloads count: looking up a link, cancelling or a failed download
          doesn&apos;t use one. You can always see how many downloads you have left today at the top of the page.
        </>
      ),
    },
    {
      id: 'faq-quality',
      q: 'Which sites and qualities are supported?',
      a: (
        <>
          YouTube, Facebook and Instagram. On YouTube you can choose any quality up to{' '}
          <strong className="text-slate-200">1080p Full HD</strong>, or save just the audio as an MP3. Facebook and
          Instagram offer the qualities the post itself has. Private, members-only and age-restricted videos may not
          work.
        </>
      ),
    },
    {
      id: 'faq-forgot',
      q: 'I forgot my password. What now?',
      a: (
        <>
          Tap <strong className="text-slate-200">Forgot password?</strong> on the sign-in form and enter your email.
          We&apos;ll send a reset link that works for 60 minutes (check your spam folder if you don&apos;t see it). Once
          you set a new password you&apos;re signed in straight away.
        </>
      ),
    },
    {
      id: 'faq-premium',
      q: 'Is it free? Will there be a paid plan?',
      a: (
        <>
          Yes, it&apos;s free for approved students, with 4 downloads a day. A premium plan with unlimited downloads is
          coming soon. It will be optional, and nothing will ever be charged without your clear agreement.
        </>
      ),
    },
    {
      id: 'faq-use',
      q: 'What am I allowed to download?',
      a: (
        <>
          Videos for your own personal or educational use, such as offline study. Please respect copyright and each
          platform&apos;s rules: don&apos;t re-upload, share or sell other people&apos;s videos. Read the{' '}
          <Link href="/terms" className={linkClass}>
            Terms of Use
          </Link>{' '}
          for details.
        </>
      ),
    },
    {
      id: 'faq-data',
      q: 'What do you do with my information?',
      a: (
        <>
          We store your name, email, mobile number and download history to run your account, send account emails and
          apply the daily limit. We don&apos;t sell your data or send marketing emails. See the{' '}
          <Link href="/privacy" className={linkClass}>
            Privacy Policy
          </Link>
          .
        </>
      ),
    },
  ]

  return (
    <section id="faq" aria-labelledby="faq-title" className="border-t border-white/[0.05] bg-white/[0.012] scroll-mt-14">
      <div className="max-w-3xl mx-auto px-4 sm:px-8 py-14 sm:py-20">
        <SectionHeading id="faq-title" eyebrow="Help & FAQ" title="Questions, answered" />
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
            Ready to save your first video?
          </h2>
          <p className="relative mt-3 text-[15px] text-slate-400 max-w-xl mx-auto">
            Request access in under a minute. You&apos;ll get an email as soon as you&apos;re approved.
          </p>
          <div className="relative mt-7 flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3">
            <button type="button" onClick={() => onOpenAuth('request')} className="btn-primary">
              <UserPlus className="w-4 h-4" aria-hidden="true" />
              Request access
            </button>
            <button type="button" onClick={() => onOpenAuth('signin')} className="btn-secondary">
              <LogIn className="w-4 h-4" aria-hidden="true" />
              Sign in
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}

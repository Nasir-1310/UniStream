'use client'
// frontend/app/forgot-password/page.tsx
//
// Request a password-reset link. The API answers with the same neutral
// message whether or not the email belongs to an approved account (no
// account enumeration), so this page never says "no such user" either.

import { Suspense, useEffect, useRef, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { ArrowLeft, KeyRound, MailCheck, RefreshCw } from 'lucide-react'
import Navbar from '@/components/Navbar'
import Footer from '@/components/Footer'
import { Alert, Field, PageLoader, Spinner, describedBy } from '@/components/ui'
import { apiErrorMessage, apiErrorStatus, forgotPassword } from '@/lib/api'
import { validateEmail } from '@/lib/validation'
import { bnError, translateServerText } from '@/lib/serverText'

/** Seconds before "Resend" is offered again (the API allows 3 links per email per hour). */
const RESEND_COOLDOWN = 60
const FALLBACK_MESSAGE =
  'এই ইমেইলে কোনো অনুমোদিত অ্যাকাউন্ট থাকলে রিসেট লিংক পাঠানো হচ্ছে। ইনবক্স আর Spam ফোল্ডার দেখুন।'

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

export default function ForgotPasswordPage() {
  return (
    <div className="min-h-svh flex flex-col page-bg">
      <Navbar />
      <main id="main" className="relative z-10 flex-1 px-4 sm:px-8 py-8 sm:py-16">
        <div className="w-full max-w-md mx-auto">
          <Link
            href="/#auth"
            className="inline-flex items-center gap-1.5 min-h-10 mb-3 text-[13px] text-slate-400 hover:text-white transition-colors"
          >
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
            সাইন ইনে ফিরে যান
          </Link>
          <div className="portal-card p-5 sm:p-8">
            <Suspense fallback={<PageLoader fullScreen={false} label="লোড হচ্ছে…" />}>
              <ForgotPasswordForm />
            </Suspense>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  )
}

function ForgotPasswordForm() {
  const params = useSearchParams()
  // Prefilled when the visitor came from the sign-in form with an email typed.
  const [email, setEmail] = useState(() => params.get('email') ?? '')
  const [touched, setTouched] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<{ message: string; status?: number } | null>(null)
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [cooldown, setCooldown] = useState(0)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const emailRef = useRef<HTMLInputElement>(null)
  const focusAfterRef = useFocusWhenIdle(submitting)

  const check = validateEmail(email)
  const emailError = (submitted || (touched && email.trim())) && !check.ok ? bnError(check.error) : null

  // Count the resend cooldown down once a second.
  useEffect(() => {
    if (cooldown <= 0) return
    const id = window.setTimeout(() => setCooldown(c => c - 1), 1000)
    return () => window.clearTimeout(id)
  }, [cooldown])

  // Announce the confirmation by moving focus to it.
  useEffect(() => {
    if (sentTo) headingRef.current?.focus()
  }, [sentTo])

  async function send(address: string) {
    setSubmitting(true)
    setError(null)
    try {
      const res = await forgotPassword(address)
      setMessage(translateServerText(res.message) || FALLBACK_MESSAGE)
      setSentTo(address)
      setCooldown(RESEND_COOLDOWN)
      // A resend keeps the confirmation on screen; its button is now on cooldown.
      if (sentTo) focusAfterRef.current = headingRef.current
    } catch (err) {
      setError({
        message: apiErrorMessage(err, 'লিংক পাঠানো যায়নি। আবার চেষ্টা করুন।'),
        status: apiErrorStatus(err),
      })
      focusAfterRef.current = sentTo ? headingRef.current : emailRef.current
    } finally {
      setSubmitting(false)
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitted(true)
    if (!check.ok) {
      document.getElementById('forgot-email')?.focus()
      return
    }
    await send(check.value)
  }

  if (sentTo) {
    return (
      <div className="relative fade-up">
        <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center mb-4">
          <MailCheck className="w-6 h-6 text-emerald-400" aria-hidden="true" />
        </div>
        <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-bold text-white outline-none">
          ইমেইল দেখুন
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-400">{message}</p>

        <ul className="mt-5 space-y-2.5 text-[13px] leading-relaxed text-slate-400">
          <li className="flex gap-2.5">
            <span className="mt-2 w-1.5 h-1.5 rounded-full bg-indigo-400 flex-shrink-0" aria-hidden="true" />
            <span>
              পাঠানো হয়েছে <span className="text-slate-200 break-all">{sentTo}</span> ঠিকানায়। লিংকটি{' '}
              <strong className="text-slate-200">৬০ মিনিট</strong> কার্যকর থাকবে, আর একবারই ব্যবহার করা যাবে।
            </span>
          </li>
          <li className="flex gap-2.5">
            <span className="mt-2 w-1.5 h-1.5 rounded-full bg-indigo-400 flex-shrink-0" aria-hidden="true" />
            <span>কয়েক মিনিটেও না এলে Spam বা Promotions দেখুন, তারপর আবার পাঠান।</span>
          </li>
          <li className="flex gap-2.5">
            <span className="mt-2 w-1.5 h-1.5 rounded-full bg-indigo-400 flex-shrink-0" aria-hidden="true" />
            <span>
              লিংক শুধু অনুমোদিত অ্যাকাউন্টে পাঠানো হয়। এখনো অনুমোদনের অপেক্ষায়? অ্যাডমিন অনুমোদন দিলেই ইমেইলে
              পাসওয়ার্ড পাবেন।
            </span>
          </li>
        </ul>

        {error && (
          <Alert tone={error.status === 429 ? 'warning' : 'danger'} className="mt-5" onDismiss={() => setError(null)}>
            {error.message}
          </Alert>
        )}

        <div className="mt-6 grid gap-2.5">
          <Link href="/#auth" className="btn-primary w-full">
            সাইন ইনে ফিরে যান
          </Link>
          <button
            type="button"
            onClick={() => send(sentTo)}
            disabled={cooldown > 0 || submitting}
            className="btn-secondary w-full"
          >
            {submitting ? <Spinner size="sm" label={null} /> : <RefreshCw className="w-4 h-4" aria-hidden="true" />}
            {cooldown > 0 ? (
              <span>
                <span className="tabular-nums">{cooldown}</span> সেকেন্ড পর আবার পাঠানো যাবে
              </span>
            ) : (
              'আবার লিংক পাঠান'
            )}
          </button>
          <button
            type="button"
            onClick={() => {
              setSentTo(null)
              setSubmitted(false)
              setError(null)
            }}
            className="btn-ghost w-full"
          >
            অন্য ইমেইল দিন
          </button>
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} noValidate className="relative" aria-describedby="forgot-intro">
      <div className="w-12 h-12 rounded-xl bg-indigo-500/10 border border-indigo-500/25 flex items-center justify-center mb-4">
        <KeyRound className="w-6 h-6 text-indigo-300" aria-hidden="true" />
      </div>
      <h1 className="text-2xl font-bold text-white">পাসওয়ার্ড ভুলে গেছেন?</h1>
      <p id="forgot-intro" className="mt-2 mb-6 text-sm leading-relaxed text-slate-400">
        অ্যাকাউন্টের ইমেইল ঠিকানা দিন, নতুন পাসওয়ার্ড সেট করার লিংক পাঠিয়ে দেব।
      </p>

      {error && (
        <Alert tone={error.status === 429 ? 'warning' : 'danger'} className="mb-4" onDismiss={() => setError(null)}>
          {error.message}
        </Alert>
      )}

      <Field
        htmlFor="forgot-email"
        label="ইমেইল ঠিকানা"
        error={emailError}
        hint="মোবাইল নম্বর দিয়ে রেজিস্ট্রেশন করেছিলেন? তখন দেওয়া ইমেইলটি লিখুন।"
      >
        <input
          ref={emailRef}
          id="forgot-email"
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
            setError(null)
          }}
          onBlur={() => setTouched(true)}
          disabled={submitting}
          aria-invalid={emailError ? true : undefined}
          aria-describedby={describedBy(
            'forgot-email',
            emailError,
            'মোবাইল নম্বর দিয়ে রেজিস্ট্রেশন করেছিলেন? তখন দেওয়া ইমেইলটি লিখুন।',
          )}
          className="input-field"
        />
      </Field>

      <button type="submit" className="btn-primary w-full mt-6" disabled={submitting}>
        {submitting ? (
          <>
            <Spinner size="sm" label={null} /> লিংক পাঠানো হচ্ছে…
          </>
        ) : (
          'রিসেট লিংক পাঠান'
        )}
      </button>

      <p className="mt-6 pt-5 border-t border-white/[0.06] text-center text-[13px] text-slate-400">
        মনে পড়েছে?{' '}
        <Link href="/#auth" className="font-semibold text-indigo-300 hover:text-indigo-200 hover:underline underline-offset-4">
          সাইন ইন
        </Link>
      </p>
    </form>
  )
}
